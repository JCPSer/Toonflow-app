import { createHash, randomUUID } from "node:crypto";
import { constants, copyFile, createReadStream, lstat, mkdir, opendir, readFile, readdir, rename, rm, unlink, writeAtomic } from "@toonflow/file";
import { basename, dirname, extname, join, relative, sep } from "node:path";
import { getDocumentMimeType } from "@/lib/documentFormats";
import { mentionAssetType } from "@/lib/mentionSources";
import { copyWorkspaceFile, isWithin, lockWorkspaceFiles, protectWorkspaceRoot, resolveWorkspacePath, writeWorkspaceFile } from "@/modules/localRuntime/workspace/files";
import { addLibraryTrashEntry, clearLibraryTrash, getLibraryEntries, getLibraryEntry, getLibraryTrashEntry, listLibraryTrash, moveLibraryEntries,
  patchLibraryEntry, pruneLibraryEntries, reconcileLibraryEntries, removeLibraryEntries, removeLibraryTrashEntry, flushLibraryIndex,
  type LibraryEntry, type LibraryEntryRecord, type LibraryMetaPatch, type LibraryTrashEntry } from "./libraryMeta";
import { assertAssetRelativePath, internalAssetDirectories, normalizeAssetPath, type AssetLibrary, type AssetLibraryKind } from "./roots";
import { findAssetUsageBatch, findAssetUsages, type AssetUsageResult } from "./usage";

export const maxAssetBytes = 100 * 1024 * 1024;

export type AssetSortField = "name" | "mtime" | "size" | "type";
export type AssetSortOrder = "asc" | "desc";
export type AssetListOptions = {
  path?: string;
  cursor?: string;
  limit?: number;
  sort?: AssetSortField;
  order?: AssetSortOrder;
  query?: string;
  type?: string;
  favorite?: boolean;
  signal?: AbortSignal;
};
export type AssetEntry = {
  name: string;
  path: string;
  type: "file" | "directory";
  category: string;
  dataType?: string;
  size: number;
  mtimeMs: number;
  tags: string[];
  note: string;
  favorite: boolean;
  childCount?: number;
  /** 索引里还有、磁盘上已不存在（在 Finder 里被删/移动）。 */
  missing?: boolean;
};

type RawEntry = {
  name: string;
  path: string;
  type: "file" | "directory";
  category: string;
  dataType?: string;
  size: number;
  mtimeMs: number;
  dev: number;
  ino: number;
};

const maxScannedEntries = 50000;
/** 单次列表最多返回多少条"缺失"提示，避免索引异常时撑爆响应。 */
const maxMissingEntries = 200;
/** 目录子项数缓存：展开大目录时避免每次都把所有子目录读一遍。 */
const childCountCache = new Map<string, { at: number; count: number }>();
const childCountTtlMs = 2000;
const childCountConcurrency = 4;
const childCountCacheLimit = 2000;

function toRecord(entry: RawEntry): LibraryEntryRecord {
  return {
    path: entry.path,
    size: entry.size,
    mtimeMs: entry.mtimeMs,
    isDirectory: entry.type === "directory",
    dev: entry.dev,
    ino: entry.ino,
    ...(entry.dataType ? { dataType: entry.dataType } : {}),
  };
}

/** 索引里标记为 stale、且父目录正好是当前目录的条目。 */
function collectMissingEntries(index: Record<string, LibraryEntry>, parentPath: string): AssetEntry[] {
  const items: AssetEntry[] = [];
  for (const [path, entry] of Object.entries(index)) {
    if (!entry.stale) continue;
    const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    if (parent !== parentPath) continue;
    const name = path.slice(path.lastIndexOf("/") + 1);
    const isDirectory = entry.isDirectory === true;
    items.push({
      name,
      path,
      type: isDirectory ? "directory" : "file",
      category: assetCategory(name, isDirectory),
      ...(entry.dataType && !isDirectory ? { dataType: entry.dataType } : {}),
      size: entry.size ?? 0,
      mtimeMs: entry.mtimeMs ?? entry.addedAt,
      tags: entry.tags ?? [],
      note: entry.note ?? "",
      favorite: entry.favorite === true,
      missing: true,
    });
  }
  items.sort((left, right) => left.name.localeCompare(right.name, "zh-CN", { numeric: true }));
  return items;
}

/** 并发生数受控，命中 2s 缓存时直接复用。 */
async function countDirectoryChildren(root: string, raws: RawEntry[], signal?: AbortSignal) {
  const counts = new Map<string, number>();
  const directories = raws.filter(raw => raw.type === "directory");
  if (!directories.length) return counts;
  let cursor = 0;
  const worker = async () => {
    while (cursor < directories.length) {
      const raw = directories[cursor++]!;
      signal?.throwIfAborted();
      const cacheKey = `${root}\u0000${raw.path}`;
      const cached = childCountCache.get(cacheKey);
      if (cached && Date.now() - cached.at < childCountTtlMs) {
        counts.set(raw.path, cached.count);
        continue;
      }
      const info = await lstat(join(root, raw.path)).catch(() => null);
      const count = info?.isDirectory() ? (await readChildren(root, raw.path, signal)).length : 0;
      if (childCountCache.size >= childCountCacheLimit) childCountCache.clear();
      childCountCache.set(cacheKey, { at: Date.now(), count });
      counts.set(raw.path, count);
    }
  };
  await Promise.all(Array.from({ length: Math.min(childCountConcurrency, directories.length) }, () => worker()));
  return counts;
}

function slashPath(path: string) {
  return path.split(sep).join("/");
}

export function assetCategory(name: string, isDirectory: boolean) {
  if (isDirectory) return "directory";
  const { dataType, mimeType } = mentionAssetType(name);
  if (dataType === "IMAGE") return "image";
  if (dataType === "VIDEO") return "video";
  if (dataType === "AUDIO") return "audio";
  if (dataType === "FILE") return getDocumentMimeType(name, mimeType) ? "document" : "file";
  if (dataType === "STRING") return mimeType === "application/octet-stream" ? "file" : "text";
  return "other";
}

async function resolveLibraryPath(root: string, path: string, allowMissingParents = false) {
  assertAssetRelativePath(path);
  return resolveWorkspacePath(root, path, allowMissingParents);
}

/** 同一卷直接 rename；只有跨卷 EXDEV 才复制后删除，避免删除大文件时白拷一份。 */
async function movePath(source: string, target: string) {
  const info = await lstat(source);
  if (info.isSymbolicLink() || (!info.isFile() && !info.isDirectory())) throw Object.assign(new Error("只能移动普通文件或文件夹"), { status: 403 });
  try {
    await rename(source, target);
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
  }
  await copyWorkspaceFile(source, target);
  if (info.isDirectory()) await rm(source, { recursive: true, force: false });
  else await unlink(source);
}

async function readChildren(root: string, relativeDirectory: string, signal?: AbortSignal) {
  const directory = relativeDirectory ? join(root, relativeDirectory) : root;
  const entries: RawEntry[] = [];
  const handle = await opendir(directory);
  for await (const entry of handle) {
    signal?.throwIfAborted();
    // ACT: 隐藏文件（.DS_Store、.git 等）与内部目录一并对用户不可见，避免污染素材库。
    if (entry.name.startsWith(".") || internalAssetDirectories.has(entry.name.toLocaleLowerCase()) || entry.isSymbolicLink()) continue;
    if (!entry.isFile() && !entry.isDirectory()) continue;
    const absolute = join(directory, entry.name);
    const info = await lstat(absolute).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (!info || info.isSymbolicLink() || (!info.isFile() && !info.isDirectory())) continue;
    const path = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
    const type = info.isDirectory() ? "directory" : "file";
    entries.push({ name: entry.name, path, type, category: assetCategory(entry.name, info.isDirectory()), size: info.size, mtimeMs: info.mtimeMs,
      dev: info.dev, ino: info.ino,
      ...(!info.isDirectory() ? { dataType: mentionAssetType(entry.name).dataType } : {}) });
  }
  return entries;
}

async function collectEntries(root: string, relativeDirectory: string, recursive: boolean, signal?: AbortSignal) {
  const collected: RawEntry[] = [];
  const pending = [relativeDirectory];
  let truncated = false;
  while (pending.length) {
    signal?.throwIfAborted();
    const current = pending.shift()!;
    const entries = await readChildren(root, current, signal);
    for (const entry of entries) {
      collected.push(entry);
      if (entry.type === "directory" && recursive) pending.push(entry.path);
      if (collected.length >= maxScannedEntries) { truncated = true; break; }
    }
    if (truncated) break;
  }
  return { entries: collected, truncated };
}

function toEntry(raw: RawEntry, meta: { tags?: string[]; note?: string; favorite?: boolean } | undefined): AssetEntry {
  return { name: raw.name, path: raw.path, type: raw.type, category: raw.category, ...(raw.dataType ? { dataType: raw.dataType } : {}),
    size: raw.size, mtimeMs: raw.mtimeMs, tags: meta?.tags ?? [], note: meta?.note ?? "", favorite: meta?.favorite === true };
}

function cursorKey(library: AssetLibrary, options: AssetListOptions, relativeDirectory: string) {
  return JSON.stringify([library.root, relativeDirectory, options.query?.trim().toLocaleLowerCase() ?? "", options.type ?? "",
    options.favorite === true, options.sort ?? "name", options.order ?? "asc"]);
}

function readCursor(cursor: string | undefined, key: string) {
  if (!cursor) return 0;
  const separator = cursor.lastIndexOf(":");
  if (separator < 0) throw Object.assign(new Error("分页已失效，请重新查询"), { status: 409, code: "ECURSOR" });
  const encoded = cursor.slice(0, separator);
  const offset = Number(cursor.slice(separator + 1));
  if (encoded !== Buffer.from(key).toString("base64url") || !Number.isSafeInteger(offset) || offset < 0) {
    throw Object.assign(new Error("分页已失效，请重新查询"), { status: 409, code: "ECURSOR" });
  }
  return offset;
}

function matchesType(entry: RawEntry, type: string) {
  const normalized = type.toLocaleLowerCase();
  if (!normalized || normalized === "all") return true;
  if (normalized === "file") return entry.type === "file";
  return entry.category === normalized;
}

function compareEntries(left: AssetEntry, right: AssetEntry, sort: AssetSortField) {
  const byName = () => left.name.localeCompare(right.name, "zh-CN", { numeric: true });
  if (sort === "mtime") return left.mtimeMs - right.mtimeMs || byName();
  if (sort === "size") return left.size - right.size || byName();
  if (sort === "type") return left.category.localeCompare(right.category) || byName();
  return byName();
}

export async function listAssetEntries(library: AssetLibrary, options: AssetListOptions = {}) {
  const relativeDirectory = normalizeAssetPath(options.path);
  const resolved = await resolveLibraryPath(library.root, relativeDirectory);
  if (!(await lstat(resolved.path)).isDirectory()) throw Object.assign(new Error("只能列出文件夹内容"), { status: 400 });
  const query = options.query?.trim().toLocaleLowerCase() ?? "";
  const key = cursorKey(library, options, relativeDirectory);
  const offset = readCursor(options.cursor, key);
  const collected = await collectEntries(library.root, relativeDirectory, !!query, options.signal);
  await reconcileLibraryEntries(library.root, collected.entries.map(toRecord));
  if (!query && !collected.truncated) await pruneLibraryEntries(library.root, relativeDirectory, new Set(collected.entries.map(entry => entry.path)));
  const index = await getLibraryEntries(library.root);
  // ACT: 外部删掉的文件不在扫描结果里，单独作为"缺失"返回，不混进 items/total/cursor。
  const missing = query || collected.truncated ? undefined : collectMissingEntries(index, relativeDirectory);
  const items = collected.entries.filter(entry => {
    if (!matchesType(entry, options.type ?? "")) return false;
    const meta = index[entry.path];
    if (options.favorite === true && meta?.favorite !== true) return false;
    if (!query) return true;
    return `${entry.name} ${entry.path} ${(meta?.tags ?? []).join(" ")} ${meta?.note ?? ""}`.toLocaleLowerCase().includes(query);
  }).map(entry => toEntry(entry, index[entry.path]));
  const order = options.order === "desc" ? -1 : 1;
  items.sort((left, right) => compareEntries(left, right, options.sort ?? "name") * order);
  const limit = Math.max(1, Math.min(200, options.limit ?? 50));
  const page = items.slice(offset, offset + limit);
  const nextOffset = offset + page.length;
  return { items: page, total: items.length, truncated: collected.truncated,
    ...(missing && missing.length ? { missing: missing.slice(0, maxMissingEntries), missingTotal: missing.length } : {}),
    ...(nextOffset < items.length ? { nextCursor: `${Buffer.from(key).toString("base64url")}:${nextOffset}` } : {}) };
}

export async function treeAssetEntries(library: AssetLibrary, path?: string, signal?: AbortSignal) {
  const relativeDirectory = normalizeAssetPath(path);
  const resolved = await resolveLibraryPath(library.root, relativeDirectory);
  if (!(await lstat(resolved.path)).isDirectory()) throw Object.assign(new Error("只能列出文件夹内容"), { status: 400 });
  const raws = await readChildren(library.root, relativeDirectory, signal);
  const truncated = raws.length >= maxScannedEntries;
  // ACT: 子项数并发上限 4 + 2s 缓存，避免展开大目录时打出一串顺序读。
  const childCounts = await countDirectoryChildren(library.root, raws, signal);
  await reconcileLibraryEntries(library.root, raws.map(toRecord));
  const index = await getLibraryEntries(library.root);
  return { items: raws.map(raw => ({ ...toEntry(raw, index[raw.path]), ...(childCounts.has(raw.path) ? { childCount: childCounts.get(raw.path)! } : {}) })), truncated };
}

export async function createAssetDirectory(library: AssetLibrary, path: string) {
  const relativeDirectory = normalizeAssetPath(path);
  if (!relativeDirectory) throw Object.assign(new Error("请输入文件夹名称"), { status: 400 });
  const target = await resolveLibraryPath(library.root, relativeDirectory, true);
  protectWorkspaceRoot(library.root, target.path);
  const exists = await lstat(target.path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (exists) throw Object.assign(new Error("已存在同名文件或目录"), { status: 409, code: "EEXIST" });
  await mkdir(target.path, { recursive: true });
  const info = await lstat(target.path);
  await patchLibraryEntry(library.root, relativeDirectory, {}, { size: info.size, mtimeMs: info.mtimeMs });
  // ACT: 目录结构变化立即落盘，不依赖 200ms 合并窗口；进程异常退出后索引仍与磁盘一致。
  await flushLibraryIndex(library.root);
  return { path: relativeDirectory };
}

export async function moveAssetEntry(library: AssetLibrary, source: string, targetDirectory: string) {
  const sourcePath = normalizeAssetPath(source);
  const targetPath = normalizeAssetPath(targetDirectory);
  if (!sourcePath) throw Object.assign(new Error("不能移动素材库根目录"), { status: 400 });
  const from = await resolveLibraryPath(library.root, sourcePath);
  protectWorkspaceRoot(library.root, from.path);
  const target = await resolveLibraryPath(library.root, targetPath);
  if (!(await lstat(target.path)).isDirectory()) throw Object.assign(new Error("目标必须是文件夹"), { status: 400 });
  const destination = join(target.path, basename(from.path));
  if (destination === from.path) return { path: sourcePath };
  const destinationPath = slashPath(relative(library.root, destination));
  if (isWithin(from.path, destination)) throw Object.assign(new Error("不能把文件夹移动到自身的子目录"), { status: 400 });
  const exists = await lstat(destination).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (exists) throw Object.assign(new Error("目标位置已存在同名文件或目录"), { status: 409, code: "EEXIST" });
  const release = lockWorkspaceFiles([from.path, destination]);
  try {
    const info = await lstat(from.path);
    await movePath(from.path, destination);
    await moveLibraryEntries(library.root, sourcePath, destinationPath, info.isDirectory());
    await flushLibraryIndex(library.root);
  } finally { release(); }
  return { path: destinationPath };
}

/** 兼容旧 rename 参数：target 是完整目标路径而不是目标目录。 */
export async function moveAssetEntryTo(library: AssetLibrary, source: string, target: string) {
  const sourcePath = normalizeAssetPath(source);
  if (!sourcePath) throw Object.assign(new Error("不能移动素材库根目录"), { status: 400 });
  const from = await resolveLibraryPath(library.root, sourcePath);
  protectWorkspaceRoot(library.root, from.path);
  const destination = await resolveLibraryPath(library.root, target);
  if (destination.path === from.path) return { path: sourcePath };
  if (isWithin(from.path, destination.path)) throw Object.assign(new Error("不能把文件夹移动到自身的子目录"), { status: 400 });
  const exists = await lstat(destination.path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (exists) throw Object.assign(new Error("目标位置已存在同名文件或目录"), { status: 409, code: "EEXIST" });
  const destinationPath = slashPath(relative(library.root, destination.path));
  const release = lockWorkspaceFiles([from.path, destination.path]);
  try {
    const info = await lstat(from.path);
    await movePath(from.path, destination.path);
    await moveLibraryEntries(library.root, sourcePath, destinationPath, info.isDirectory());
    await flushLibraryIndex(library.root);
  } finally { release(); }
  return { path: destinationPath };
}

export async function renameAssetEntry(library: AssetLibrary, path: string, name: string) {
  const sourcePath = normalizeAssetPath(path);
  if (!sourcePath) throw Object.assign(new Error("不能重命名素材库根目录"), { status: 400 });
  if (!name || name === "." || name === ".." || /[\\/]/.test(name) || internalAssetDirectories.has(name.toLocaleLowerCase())) {
    throw Object.assign(new Error("名称无效"), { status: 400, code: "EINVALIDNAME" });
  }
  const slash = sourcePath.lastIndexOf("/");
  const target = slash < 0 ? name : `${sourcePath.slice(0, slash)}/${name}`;
  if (target === sourcePath) return { path: sourcePath };
  return moveAssetEntryTo(library, sourcePath, target);
}

export async function writeAssetEntry(library: AssetLibrary, path: string, content: string | Uint8Array,
  options: { revision?: string; overwrite?: boolean } = {}) {
  if (Buffer.byteLength(content) > maxAssetBytes) throw Object.assign(new Error("素材文件不能超过 100 MB"), { status: 413, code: "EFBIG" });
  const relativePath = normalizeAssetPath(path);
  if (!relativePath) throw Object.assign(new Error("请输入文件名"), { status: 400 });
  const target = await resolveLibraryPath(library.root, relativePath);
  protectWorkspaceRoot(library.root, target.path);
  const release = lockWorkspaceFiles([target.path]);
  try {
    const current = await lstat(target.path).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (current?.isDirectory()) throw Object.assign(new Error("同名位置是文件夹"), { status: 409, code: "EEXIST" });
    if (options.revision !== undefined) {
      if (!current) throw Object.assign(new Error("素材不存在"), { status: 404, code: "ENOENT" });
      const revision = createHash("sha256").update(await readFile(target.path)).digest("hex");
      if (revision !== options.revision) throw Object.assign(new Error("素材已被修改，请重新读取后再更新"), { status: 409, code: "ESTALE" });
    }
    const exclusive = options.revision === undefined && options.overwrite !== true;
    await writeWorkspaceFile(target.path, content, exclusive);
    const info = await lstat(target.path);
    await patchLibraryEntry(library.root, relativePath, {}, { size: info.size, mtimeMs: info.mtimeMs, dataType: mentionAssetType(relativePath).dataType });
    return { path: relativePath, revision: createHash("sha256").update(content).digest("hex") };
  } finally { release(); }
}

export async function readAssetEntry(library: AssetLibrary, path: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const relativePath = normalizeAssetPath(path);
  if (!relativePath) throw Object.assign(new Error("只能读取普通素材文件"), { status: 400 });
  const target = await resolveLibraryPath(library.root, relativePath);
  const release = lockWorkspaceFiles([target.path]);
  try {
    const info = await lstat(target.path);
    if (!info.isFile()) throw Object.assign(new Error("只能读取普通素材文件"), { status: 400 });
    if (info.size > maxAssetBytes) throw Object.assign(new Error("素材文件不能超过 100 MB"), { status: 413, code: "EFBIG" });
    const content = await readFile(target.path, { signal });
    if (content.byteLength > maxAssetBytes) throw Object.assign(new Error("素材文件不能超过 100 MB"), { status: 413, code: "EFBIG" });
    return { path: relativePath, content, revision: createHash("sha256").update(content).digest("hex") };
  } finally { release(); }
}

async function measureDirectorySize(path: string, budget = { remaining: maxScannedEntries }): Promise<number> {
  const info = await lstat(path);
  if (!info.isDirectory()) return info.size;
  let total = 0;
  const handle = await opendir(path);
  for await (const entry of handle) {
    if (budget.remaining-- <= 0) break;
    const child = join(path, entry.name);
    const childInfo = await lstat(child).catch(() => null);
    if (!childInfo || childInfo.isSymbolicLink()) continue;
    total += childInfo.isDirectory() ? await measureDirectorySize(child, budget) : childInfo.size;
  }
  return total;
}

function trashManifestPath(root: string, id: string) {
  return join(root, ".trash", id, ".trash.json");
}

async function writeTrashManifest(root: string, id: string, entry: LibraryTrashEntry) {
  await writeAtomic(trashManifestPath(root, id), JSON.stringify(entry));
}

async function readTrashManifest(root: string, id: string): Promise<LibraryTrashEntry | null> {
  try {
    const value = JSON.parse(await readFile(trashManifestPath(root, id), "utf8")) as Partial<LibraryTrashEntry>;
    if (typeof value.path !== "string" || typeof value.name !== "string") return null;
    const meta = value.meta && typeof value.meta === "object" ? value.meta : undefined;
    return { path: normalizeAssetPath(value.path), name: value.name,
      deletedAt: typeof value.deletedAt === "number" ? value.deletedAt : Date.now(),
      size: typeof value.size === "number" ? value.size : 0, isDirectory: value.isDirectory === true,
      ...(meta ? { meta: {
        ...(Array.isArray(meta.tags) ? { tags: meta.tags.filter((tag): tag is string => typeof tag === "string") } : {}),
        ...(typeof meta.note === "string" ? { note: meta.note } : {}),
        ...(meta.favorite === true ? { favorite: true } : {}),
      } } : {}) };
  } catch { return null; }
}

/** manifest 是回收站的事实来源，索引只是可重建缓存。 */
async function scanTrashManifests(root: string) {
  const entries: Record<string, LibraryTrashEntry> = {};
  const directory = join(root, ".trash");
  const items = await readdir(directory, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return [];
    throw error;
  });
  for (const item of items) {
    if (!item.isDirectory()) continue;
    const entry = await readTrashManifest(root, item.name);
    if (entry) entries[item.name] = entry;
  }
  return entries;
}

function referencedError(usage: AssetUsageResult) {
  return Object.assign(new Error("素材正被画布或会话引用，或引用检查未完成，请确认后再删除"), {
    status: 409, code: "EREFERENCED", usages: usage.usages, checked: usage.checked,
  });
}

type RemovalOutcome = {
  path: string;
  result?: { path: string; trashId?: string; permanent?: boolean };
  cause?: unknown;
};

/** 删除已经完成路径解析和引用校验的条目。 */
async function deleteResolvedAsset(library: AssetLibrary, relativePath: string, targetPath: string, info: Awaited<ReturnType<typeof lstat>>,
  options: { permanent?: boolean }) {
  const release = lockWorkspaceFiles([targetPath]);
  try {
    if (options.permanent === true) {
      await rm(targetPath, { recursive: info.isDirectory(), force: false });
      await removeLibraryEntries(library.root, relativePath);
      await flushLibraryIndex(library.root);
      return { path: relativePath, permanent: true };
    }
    const id = randomUUID();
    const trashDirectory = join(library.root, ".trash", id);
    await mkdir(trashDirectory, { recursive: true });
    const size = info.isDirectory() ? await measureDirectorySize(targetPath) : Number(info.size);
    // ACT: 标签/备注/收藏只存在于索引，删除时必须随回收站 manifest 保存，恢复时写回。
    const indexed = await getLibraryEntry(library.root, relativePath);
    const meta = indexed && (indexed.tags?.length || indexed.note || indexed.favorite === true) ? {
      ...(indexed.tags?.length ? { tags: indexed.tags } : {}),
      ...(indexed.note ? { note: indexed.note } : {}),
      ...(indexed.favorite === true ? { favorite: true } : {}),
    } : undefined;
    const entry: LibraryTrashEntry = { path: relativePath, name: basename(targetPath), deletedAt: Date.now(), size,
      isDirectory: info.isDirectory(), ...(meta ? { meta } : {}) };
    try {
      await movePath(targetPath, join(trashDirectory, entry.name));
      await writeTrashManifest(library.root, id, entry);
    } catch (error) {
      await rm(trashDirectory, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
    await addLibraryTrashEntry(library.root, id, entry);
    await removeLibraryEntries(library.root, relativePath);
    await flushLibraryIndex(library.root);
    return { path: relativePath, trashId: id };
  } finally { release(); }
}

/**
 * 批量删除：先统一扫描一次引用（force 时完全跳过），再逐项删除。
 * 返回与输入顺序一致的逐项结果；引用错误保留 usages/checked 供 409 响应和前端二次确认。
 */
export async function removeAssetEntries(library: AssetLibrary, paths: string[],
  options: { permanent?: boolean; force?: boolean } = {}): Promise<RemovalOutcome[]> {
  const resolved: { index: number; relativePath: string; targetPath: string; info: Awaited<ReturnType<typeof lstat>> }[] = [];
  const outcomes: RemovalOutcome[] = new Array(paths.length);
  for (const [index, path] of paths.entries()) {
    try {
      const relativePath = normalizeAssetPath(path);
      if (!relativePath) throw Object.assign(new Error("不能删除素材库根目录"), { status: 400 });
      const target = await resolveLibraryPath(library.root, relativePath);
      protectWorkspaceRoot(library.root, target.path);
      resolved.push({ index, relativePath, targetPath: target.path, info: await lstat(target.path) });
    } catch (cause) {
      outcomes[index] = { path, cause };
    }
  }
  let usageItems: AssetUsageResult[] | undefined;
  if (options.force !== true && resolved.length) {
    const batch = await findAssetUsageBatch({
      workspace: library.workspace, kind: library.kind, libraryPath: library.relativePath,
      targets: resolved.map(item => ({ path: item.relativePath, isDirectory: item.info.isDirectory() })),
    });
    usageItems = batch.items;
  }
  for (const [position, item] of resolved.entries()) {
    const usage = usageItems?.[position];
    // ACT: 部分检查说明可能还有引用未扫到，必须按“有引用”处理；force 明确授权时才允许越过。
    if (usage && (usage.usages.length || usage.checked !== "complete")) {
      outcomes[item.index] = { path: paths[item.index]!, cause: referencedError(usage) };
      continue;
    }
    try {
      outcomes[item.index] = { path: paths[item.index]!, result: await deleteResolvedAsset(library, item.relativePath, item.targetPath, item.info, options) };
    } catch (cause) {
      outcomes[item.index] = { path: paths[item.index]!, cause };
    }
  }
  return outcomes.map((outcome, index) => outcome ?? { path: paths[index]!, cause: new Error("删除未执行") });
}

export async function removeAssetEntry(library: AssetLibrary, path: string, options: { permanent?: boolean; force?: boolean } = {}) {
  const [outcome] = await removeAssetEntries(library, [path], options);
  if (outcome?.cause !== undefined) throw outcome.cause;
  return outcome!.result!;
}

export async function listTrash(library: AssetLibrary) {
  // manifest 优先，索引补齐旧回收站项。
  const entries = { ...await listLibraryTrash(library.root), ...await scanTrashManifests(library.root) };
  const items = Object.entries(entries).map(([id, entry]) => ({ id, ...entry })).sort((left, right) => right.deletedAt - left.deletedAt);
  return { items, usage: items.reduce((total, item) => total + item.size, 0) };
}

async function uniqueRestoreTarget(root: string, path: string) {
  const exists = async (candidate: string) => {
    const resolved = await resolveLibraryPath(root, candidate, true);
    return !!(await lstat(resolved.path).catch(() => null));
  };
  if (!(await exists(path))) return path;
  const directory = dirname(path);
  const extension = extname(path);
  const stem = basename(path, extension);
  for (let index = 2; index < 10000; index++) {
    const candidate = `${directory && directory !== "." ? `${directory}/` : ""}${stem} (${index})${extension}`;
    if (!(await exists(candidate))) return candidate;
  }
  throw Object.assign(new Error("同名文件过多，无法恢复"), { status: 409, code: "EEXIST" });
}

/**
 * 把任意普通文件复制进目标库（工作区→库或库→库），不改动源文件；重名自动追加 " (2)"。
 * 调用方负责解析并授权 sourcePath，本函数只做文件系统与目标库路径校验。
 */
export async function importFileIntoLibrary(target: AssetLibrary, sourcePath: string, options: { targetDir?: string; name?: string } = {}) {
  const sourceInfo = await lstat(sourcePath);
  if (sourceInfo.isSymbolicLink() || !sourceInfo.isFile()) throw Object.assign(new Error("只能导入普通文件，不支持文件夹或符号链接"), { status: 400, code: "EINVALIDSOURCE" });
  if (sourceInfo.size > maxAssetBytes) throw Object.assign(new Error("素材文件不能超过 100 MB"), { status: 413, code: "EFBIG" });
  const targetDirectory = normalizeAssetPath(options.targetDir);
  const directory = await resolveLibraryPath(target.root, targetDirectory);
  if (!(await lstat(directory.path)).isDirectory()) throw Object.assign(new Error("目标必须是文件夹"), { status: 400, code: "ENOTDIR" });
  protectWorkspaceRoot(target.root, directory.path);
  const name = options.name?.trim() || basename(sourcePath);
  if (!name || name === "." || name === ".." || /[\\/]/.test(name)) throw Object.assign(new Error("文件名无效"), { status: 400, code: "EINVALIDNAME" });
  assertAssetRelativePath(targetDirectory ? `${targetDirectory}/${name}` : name);
  const requestedPath = targetDirectory ? `${targetDirectory}/${name}` : name;
  const targetPath = await resolveLibraryPath(target.root, await uniqueRestoreTarget(target.root, requestedPath), true);
  const relativePath = slashPath(relative(target.root, targetPath.path));
  protectWorkspaceRoot(target.root, targetPath.path);
  const release = lockWorkspaceFiles([sourcePath, targetPath.path]);
  let created = false;
  try {
    await copyFile(sourcePath, targetPath.path, constants.COPYFILE_EXCL);
    created = true;
    const info = await lstat(targetPath.path);
    if (!info.isFile() || info.size > maxAssetBytes) throw Object.assign(new Error("素材文件不能超过 100 MB"), { status: 413, code: "EFBIG" });
    const hash = createHash("sha256");
    // 分块计算 revision，避免把 100 MB 素材整体读进内存。
    for await (const chunk of createReadStream(targetPath.path)) hash.update(chunk as Buffer);
    await reconcileLibraryEntries(target.root, [{ path: relativePath, size: info.size, mtimeMs: info.mtimeMs, dataType: mentionAssetType(relativePath).dataType }]);
    await flushLibraryIndex(target.root);
    return { path: relativePath, revision: hash.digest("hex"), size: info.size };
  } catch (error) {
    if (created) await unlink(targetPath.path).catch(() => {});
    throw error;
  } finally { release(); }
}

async function reconcileRestoredPath(root: string, relativePath: string, absolutePath: string, depth = 0) {
  if (depth > 64) return;
  const info = await lstat(absolutePath);
  await reconcileLibraryEntries(root, [{ path: relativePath, size: info.size, mtimeMs: info.mtimeMs,
    ...(info.isFile() ? { dataType: mentionAssetType(relativePath).dataType } : {}) }]);
  if (!info.isDirectory()) return;
  const handle = await opendir(absolutePath);
  for await (const entry of handle) {
    if (entry.name.startsWith(".") || internalAssetDirectories.has(entry.name.toLocaleLowerCase()) || entry.isSymbolicLink()) continue;
    const childRelative = `${relativePath}/${entry.name}`;
    const childAbsolute = join(absolutePath, entry.name);
    const childInfo = await lstat(childAbsolute).catch(() => null);
    if (!childInfo || childInfo.isSymbolicLink()) continue;
    await reconcileRestoredPath(root, childRelative, childAbsolute, depth + 1);
  }
}

export async function restoreAssetEntry(library: AssetLibrary, id: string) {
  if (!/^[\w-]+$/.test(id)) throw Object.assign(new Error("回收站项目 ID 无效"), { status: 400 });
  // manifest 是事实来源；旧回收站没有 manifest 时才回退索引缓存。
  const entry = await readTrashManifest(library.root, id) ?? await getLibraryTrashEntry(library.root, id);
  if (!entry) throw Object.assign(new Error("回收站项目不存在"), { status: 404, code: "ENOENT" });
  const source = join(library.root, ".trash", id, entry.name);
  const info = await lstat(source).catch(() => null);
  if (!info) throw Object.assign(new Error("回收站文件已被外部修改或删除"), { status: 404, code: "ENOENT" });
  const targetPath = await uniqueRestoreTarget(library.root, entry.path);
  const target = await resolveLibraryPath(library.root, targetPath, true);
  protectWorkspaceRoot(library.root, target.path);
  await mkdir(dirname(target.path), { recursive: true });
  const release = lockWorkspaceFiles([source, target.path]);
  try {
    await movePath(source, target.path);
    await rm(join(library.root, ".trash", id), { recursive: true, force: true });
    await removeLibraryTrashEntry(library.root, id);
    await reconcileRestoredPath(library.root, targetPath, target.path);
    // ACT: 删除时保存在 manifest 里的标签/备注/收藏在恢复后写回索引（目录写在根路径上）。
    if (entry.meta) await patchLibraryEntry(library.root, targetPath, entry.meta);
    await flushLibraryIndex(library.root);
  } finally { release(); }
  return { path: targetPath };
}

export async function purgeTrash(library: AssetLibrary, options: { id?: string; all?: boolean } = {}) {
  if (options.all === true) {
    await rm(join(library.root, ".trash"), { recursive: true, force: true });
    await clearLibraryTrash(library.root);
    await flushLibraryIndex(library.root);
    return { all: true };
  }
  const id = options.id;
  if (!id || !/^[\w-]+$/.test(id)) throw Object.assign(new Error("回收站项目 ID 无效"), { status: 400 });
  await rm(join(library.root, ".trash", id), { recursive: true, force: true });
  await removeLibraryTrashEntry(library.root, id);
  await flushLibraryIndex(library.root);
  return { id };
}

export async function patchAssetMetadata(library: AssetLibrary, path: string, patch: LibraryMetaPatch) {
  const relativePath = normalizeAssetPath(path);
  if (!relativePath) throw Object.assign(new Error("请提供素材路径"), { status: 400 });
  const target = await resolveLibraryPath(library.root, relativePath);
  const info = await lstat(target.path);
  const tags = patch.tags?.map(tag => tag.trim()).filter(Boolean).slice(0, 20).map(tag => tag.slice(0, 32));
  const note = patch.note?.slice(0, 2000);
  const entry = await patchLibraryEntry(library.root, relativePath, {
    ...(patch.tags !== undefined ? { tags } : {}),
    ...(patch.note !== undefined ? { note } : {}),
    ...(patch.favorite !== undefined ? { favorite: patch.favorite } : {}),
  }, { size: info.size, mtimeMs: info.mtimeMs, ...(info.isFile() ? { dataType: mentionAssetType(relativePath).dataType } : {}) });
  await flushLibraryIndex(library.root);
  return { path: relativePath, tags: entry.tags ?? [], note: entry.note ?? "", favorite: entry.favorite === true };
}

export async function getAssetUsages(library: AssetLibrary, path: string) {
  const relativePath = normalizeAssetPath(path);
  if (!relativePath) throw Object.assign(new Error("请提供素材路径"), { status: 400 });
  const target = await resolveLibraryPath(library.root, relativePath);
  const info = await lstat(target.path).catch(() => null);
  const result = await findAssetUsages({ workspace: library.workspace, kind: library.kind, libraryPath: library.relativePath,
    path: relativePath, isDirectory: info?.isDirectory() === true });
  return { path: relativePath, ...result };
}

/** 批量引用检查：只扫描一次，所有路径共享同一份预算。 */
export async function getAssetUsagesBatch(library: AssetLibrary, paths: string[]) {
  const targets: { path: string; isDirectory: boolean }[] = [];
  for (const path of paths) {
    const relativePath = normalizeAssetPath(path);
    if (!relativePath) throw Object.assign(new Error("请提供素材路径"), { status: 400 });
    const target = await resolveLibraryPath(library.root, relativePath);
    const info = await lstat(target.path).catch(() => null);
    targets.push({ path: relativePath, isDirectory: info?.isDirectory() === true });
  }
  const result = await findAssetUsageBatch({ workspace: library.workspace, kind: library.kind, libraryPath: library.relativePath, targets });
  return { items: result.items.map(item => ({ path: item.path, usages: item.usages, checked: item.checked })) };
}

export async function assertAssetExists(library: AssetLibrary, path: string) {
  const relativePath = normalizeAssetPath(path);
  const target = await resolveLibraryPath(library.root, relativePath);
  return { path: relativePath, absolute: target.path, info: await lstat(target.path) };
}
