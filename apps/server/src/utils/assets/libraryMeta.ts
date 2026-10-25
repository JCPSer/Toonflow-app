import { lstat, mkdir, readFile, rename, rm, writeAtomic } from "@toonflow/file";
import { join } from "node:path";
import { internalAssetDirectories } from "./roots";

export type LibraryEntry = {
  tags?: string[];
  note?: string;
  favorite?: boolean;
  size?: number;
  mtimeMs?: number;
  dataType?: string;
  isDirectory?: boolean;
  addedAt: number;
  /** 设备号 + inode：外部改名/移动后凭它把元数据接到新路径。 */
  dev?: number;
  ino?: number;
  /** 外部删除后保留索引项，列取时标记为 stale，避免永久残留成有效数据。 */
  stale?: boolean;
  staleAt?: number;
};
export type LibraryTrashMeta = { tags?: string[]; note?: string; favorite?: boolean };
export type LibraryTrashEntry = { path: string; name: string; deletedAt: number; size: number; isDirectory: boolean; meta?: LibraryTrashMeta };
export type LibraryIndex = { version: 1; entries: Record<string, LibraryEntry>; trash: Record<string, LibraryTrashEntry> };
export type LibraryMetaPatch = { tags?: string[]; note?: string; favorite?: boolean };
export type LibraryEntryRecord = {
  path: string;
  size: number;
  mtimeMs: number;
  dataType?: string;
  isDirectory?: boolean;
  dev?: number;
  ino?: number;
};

type State = {
  index: LibraryIndex;
  loaded: boolean;
  loading?: Promise<void>;
  dirty: boolean;
  timer?: ReturnType<typeof setTimeout>;
  writing: Promise<void>;
};

const states = new Map<string, State>();

function emptyIndex(): LibraryIndex {
  return { version: 1, entries: {}, trash: {} };
}

function normalizePath(path: string) {
  const normalized = path.replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/\/+$/, "");
  return normalized === "." ? "" : normalized;
}

function isInternal(path: string) {
  return !path || path.split("/").some(part => internalAssetDirectories.has(part.toLocaleLowerCase()));
}

function normalizeMeta(meta: LibraryTrashMeta): LibraryTrashMeta {
  return {
    ...(Array.isArray(meta.tags) ? { tags: meta.tags.filter(tag => typeof tag === "string") } : {}),
    ...(typeof meta.note === "string" ? { note: meta.note } : {}),
    ...(meta.favorite === true ? { favorite: true } : {}),
  };
}

function normalizeIndex(value: unknown): LibraryIndex {
  if (!value || typeof value !== "object" || Array.isArray(value)) return emptyIndex();
  const source = value as { entries?: unknown; trash?: unknown };
  const index = emptyIndex();
  if (source.entries && typeof source.entries === "object" && !Array.isArray(source.entries)) {
    for (const [key, value] of Object.entries(source.entries)) {
      const path = normalizePath(key);
      if (isInternal(path) || !value || typeof value !== "object" || Array.isArray(value)) continue;
      const entry = value as Partial<LibraryEntry>;
      index.entries[path] = {
        ...(Array.isArray(entry.tags) ? { tags: entry.tags.filter(tag => typeof tag === "string") } : {}),
        ...(typeof entry.note === "string" ? { note: entry.note } : {}),
        ...(entry.favorite === true ? { favorite: true } : {}),
        ...(typeof entry.size === "number" && Number.isFinite(entry.size) ? { size: entry.size } : {}),
        ...(typeof entry.mtimeMs === "number" && Number.isFinite(entry.mtimeMs) ? { mtimeMs: entry.mtimeMs } : {}),
        ...(typeof entry.dataType === "string" ? { dataType: entry.dataType } : {}),
        ...(entry.isDirectory === true ? { isDirectory: true } : {}),
        ...(typeof entry.dev === "number" && Number.isFinite(entry.dev) ? { dev: entry.dev } : {}),
        ...(typeof entry.ino === "number" && Number.isFinite(entry.ino) ? { ino: entry.ino } : {}),
        ...(entry.stale === true ? { stale: true } : {}),
        ...(entry.stale === true
          ? { staleAt: typeof entry.staleAt === "number" && Number.isFinite(entry.staleAt) ? entry.staleAt : Date.now() }
          : {}),
        addedAt: typeof entry.addedAt === "number" && Number.isFinite(entry.addedAt) ? entry.addedAt : Date.now(),
      };
    }
  }
  if (source.trash && typeof source.trash === "object" && !Array.isArray(source.trash)) {
    for (const [id, value] of Object.entries(source.trash)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const entry = value as Partial<LibraryTrashEntry>;
      if (typeof entry.path !== "string" || typeof entry.name !== "string") continue;
      index.trash[id] = {
        path: normalizePath(entry.path),
        name: entry.name,
        deletedAt: typeof entry.deletedAt === "number" ? entry.deletedAt : Date.now(),
        size: typeof entry.size === "number" && Number.isFinite(entry.size) ? entry.size : 0,
        isDirectory: entry.isDirectory === true,
        ...(entry.meta && typeof entry.meta === "object" && !Array.isArray(entry.meta) ? { meta: normalizeMeta(entry.meta as LibraryTrashMeta) } : {}),
      };
    }
  }
  return index;
}

async function stateFor(root: string) {
  let state = states.get(root);
  if (!state) {
    state = { index: emptyIndex(), loaded: false, dirty: false, writing: Promise.resolve() };
    states.set(root, state);
  }
  if (state.loaded) return state;
  if (!state.loading) {
    state.loading = (async () => {
      try {
        const raw = await readFile(join(root, ".library", "index.json"), "utf8");
        state!.index = normalizeIndex(JSON.parse(raw));
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        // ACT: 索引只是可重建缓存；解析失败先留 .bak 再立刻重建，避免库根因此失去归属标记。
        if (code !== "ENOENT") {
          console.warn("素材库索引损坏，将重建：", root, error);
          const indexPath = join(root, ".library", "index.json");
          await rm(`${indexPath}.bak`, { force: true }).catch(() => {});
          await rename(indexPath, `${indexPath}.bak`).catch(renameError => console.warn("素材库索引备份失败：", root, renameError));
          state!.index = emptyIndex();
          await writeAtomic(indexPath, JSON.stringify(state!.index)).catch(writeError => {
            state!.dirty = true;
            console.warn("素材库索引重建失败：", root, writeError);
          });
        } else {
          state!.index = emptyIndex();
        }
      } finally {
        state!.loaded = true;
        state!.loading = undefined;
      }
    })();
  }
  await state.loading;
  return state;
}

async function persist(root: string, state: State) {
  const payload = JSON.stringify(state.index);
  state.dirty = false;
  try {
    await mkdir(join(root, ".library"), { recursive: true });
    // writeAtomic 内部使用临时文件 + rename，避免读到写了一半的索引。
    await writeAtomic(join(root, ".library", "index.json"), payload);
  } catch (error) {
    state.dirty = true;
    throw error;
  }
}

function schedule(root: string, state: State) {
  state.dirty = true;
  if (state.timer) return;
  state.timer = setTimeout(() => {
    state.timer = undefined;
    void flushLibraryIndex(root).catch(error => console.warn("素材库索引写入失败：", root, error));
  }, 200);
  state.timer.unref?.();
}

export async function flushLibraryIndex(root: string) {
  const state = await stateFor(root);
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = undefined;
  }
  state.writing = state.writing.catch(() => {}).then(async () => {
    // ACT: 写入期间可能继续产生变更，循环到稳定为止；所有写入串行复用同一 Promise 链。
    while (state.dirty) await persist(root, state);
  });
  await state.writing;
}

export async function getLibraryEntries(root: string) {
  return (await stateFor(root)).index.entries;
}

export async function getLibraryEntry(root: string, path: string) {
  const state = await stateFor(root);
  return state.index.entries[normalizePath(path)];
}

/** 索引里保留的"已消失条目"上限与保留期：超出后自动回收，避免索引无限膨胀。 */
const staleRetentionMs = 30 * 24 * 60 * 60 * 1000;
const maxStaleEntries = 5000;

function buildInodeMap(index: LibraryIndex) {
  const map = new Map<string, string>();
  for (const [path, entry] of Object.entries(index.entries)) {
    // ACT: stale 条目也要参与匹配——文件可能只是被移动到了别的目录，挪过去时应把元数据接上。
    if (entry.ino === undefined || entry.dev === undefined || entry.ino <= 0 || entry.dev <= 0) continue;
    map.set(`${entry.dev}:${entry.ino}`, path);
  }
  return map;
}

async function pathExists(path: string) {
  return await lstat(path).then(() => true).catch(() => false);
}

/** 把 source（及其子项）的索引整体搬到 target，返回被搬走的源条目。 */
function migrateLibraryEntry(state: State, source: string, target: string, isDirectory: boolean) {
  let moved: LibraryEntry | undefined;
  for (const [key, value] of Object.entries(state.index.entries)) {
    const next = isDirectory
      ? (key === source ? target : key.startsWith(`${source}/`) ? `${target}${key.slice(source.length)}` : undefined)
      : key === source ? target : undefined;
    if (next === undefined) continue;
    delete state.index.entries[key];
    state.index.entries[next] = value;
    if (key === source) moved = value;
  }
  return moved;
}

export async function reconcileLibraryEntries(root: string, records: LibraryEntryRecord[]) {
  if (!records.length) return;
  const state = await stateFor(root);
  const byInode = buildInodeMap(state.index);
  let changed = false;
  for (const record of records) {
    const path = normalizePath(record.path);
    if (isInternal(path)) continue;
    let current = state.index.entries[path];
    // ACT: 外部改名/移动时路径变了、inode 没变，把标签/备注/收藏接到新路径上。
    // 旧路径仍在磁盘上（硬链接或副本）时不迁移，避免抢走另一份的元数据。
    if (!current && record.ino !== undefined && record.dev !== undefined && record.ino > 0 && record.dev > 0) {
      const source = byInode.get(`${record.dev}:${record.ino}`);
      const sourceEntry = source ? state.index.entries[source] : undefined;
      // 类型必须一致；文件还要求大小相同（改名不改大小），避免 inode 复用时把元数据错挂到新文件上。
      const sameKind = !!sourceEntry && (sourceEntry.isDirectory === true) === (record.isDirectory === true) &&
        (record.isDirectory === true || sourceEntry.size === undefined || sourceEntry.size === record.size);
      if (source && source !== path && sameKind && !(await pathExists(join(root, source)))) {
        current = migrateLibraryEntry(state, source, path, record.isDirectory === true) ?? state.index.entries[path];
        byInode.set(`${record.dev}:${record.ino}`, path);
        changed = true;
      }
    }
    if (!current) {
      state.index.entries[path] = {
        size: record.size,
        mtimeMs: record.mtimeMs,
        ...(record.isDirectory !== undefined ? { isDirectory: record.isDirectory } : {}),
        ...(record.dataType ? { dataType: record.dataType } : {}),
        ...(record.dev !== undefined ? { dev: record.dev } : {}),
        ...(record.ino !== undefined ? { ino: record.ino } : {}),
        addedAt: Date.now(),
      };
      changed = true;
      continue;
    }
    if (current.size !== record.size) { current.size = record.size; changed = true; }
    if (current.mtimeMs !== record.mtimeMs) { current.mtimeMs = record.mtimeMs; changed = true; }
    if (record.dataType && current.dataType !== record.dataType) { current.dataType = record.dataType; changed = true; }
    if (record.isDirectory !== undefined && current.isDirectory !== record.isDirectory) { current.isDirectory = record.isDirectory; changed = true; }
    if (record.dev !== undefined && current.dev !== record.dev) { current.dev = record.dev; changed = true; }
    if (record.ino !== undefined && current.ino !== record.ino) { current.ino = record.ino; changed = true; }
    if (current.stale) { delete current.stale; delete current.staleAt; changed = true; }
  }
  if (changed) schedule(root, state);
}

/** 回收超期或超量的 stale 条目。 */
function purgeStaleEntries(state: State, now: number) {
  const staleKeys = Object.keys(state.index.entries).filter(key => state.index.entries[key]?.stale);
  if (!staleKeys.length) return false;
  let changed = false;
  const alive: string[] = [];
  for (const key of staleKeys) {
    const entry = state.index.entries[key]!;
    // 老索引没有 staleAt：当作"刚失效"，避免升级后被立刻清空。
    if (now - (entry.staleAt ?? now) > staleRetentionMs) {
      delete state.index.entries[key];
      changed = true;
    } else {
      alive.push(key);
    }
  }
  if (alive.length > maxStaleEntries) {
    alive.sort((a, b) => (state.index.entries[a]?.staleAt ?? 0) - (state.index.entries[b]?.staleAt ?? 0));
    for (const key of alive.slice(0, alive.length - maxStaleEntries)) {
      delete state.index.entries[key];
      changed = true;
    }
  }
  return changed;
}

/**
 * 非递归列取后把该目录已不存在的索引项标记为 stale（不是删除）。
 * 文件系统仍是列表的真实来源；标记过的条目会作为"缺失"提示出来，超期后才真正回收。
 */
export async function pruneLibraryEntries(root: string, directory: string, keep: Set<string>) {
  const state = await stateFor(root);
  const parentPath = normalizePath(directory);
  const now = Date.now();
  let changed = false;
  const vanished: string[] = [];
  for (const [key, entry] of Object.entries(state.index.entries)) {
    const parent = key.includes("/") ? key.slice(0, key.lastIndexOf("/")) : "";
    if (parent !== parentPath || keep.has(key)) continue;
    if (!entry.stale) {
      entry.stale = true;
      entry.staleAt = now;
      changed = true;
    }
    // 类型未知时也按目录展开一次前缀，防止"目录被删 → 后代索引永远没人清理"。
    if (entry.isDirectory !== false) vanished.push(key);
  }
  if (vanished.length) {
    const prefixes = vanished.map(key => `${key}/`);
    for (const [key, entry] of Object.entries(state.index.entries)) {
      if (entry.stale) continue;
      if (prefixes.some(prefix => key.startsWith(prefix))) {
        entry.stale = true;
        entry.staleAt = now;
        changed = true;
      }
    }
  }
  if (purgeStaleEntries(state, now)) changed = true;
  if (changed) schedule(root, state);
}

export async function patchLibraryEntry(root: string, path: string, patch: LibraryMetaPatch, facts?: { size?: number; mtimeMs?: number; dataType?: string }) {
  const state = await stateFor(root);
  const key = normalizePath(path);
  if (!key || isInternal(key)) throw Object.assign(new Error("素材路径无效"), { status: 400 });
  const current = state.index.entries[key];
  const next: LibraryEntry = { ...current, addedAt: current?.addedAt ?? Date.now() };
  if (patch.tags !== undefined) next.tags = patch.tags;
  if (patch.note !== undefined) next.note = patch.note;
  if (patch.favorite !== undefined) { if (patch.favorite) next.favorite = true; else delete next.favorite; }
  if (facts?.size !== undefined) next.size = facts.size;
  if (facts?.mtimeMs !== undefined) next.mtimeMs = facts.mtimeMs;
  if (facts?.dataType) next.dataType = facts.dataType;
  if (facts) delete next.stale;
  state.index.entries[key] = next;
  schedule(root, state);
  return next;
}

export async function removeLibraryEntries(root: string, path: string) {
  const state = await stateFor(root);
  const key = normalizePath(path);
  let changed = false;
  for (const entry of Object.keys(state.index.entries)) {
    if (entry === key || entry.startsWith(`${key}/`)) {
      delete state.index.entries[entry];
      changed = true;
    }
  }
  if (changed) schedule(root, state);
}

export async function moveLibraryEntries(root: string, source: string, target: string, isDirectory: boolean) {
  const state = await stateFor(root);
  const from = normalizePath(source);
  const to = normalizePath(target);
  let changed = false;
  for (const [key, value] of Object.entries(state.index.entries)) {
    const next = isDirectory ? (key === from ? to : key.startsWith(`${from}/`) ? `${to}${key.slice(from.length)}` : undefined)
      : key === from ? to : undefined;
    if (next === undefined) continue;
    delete state.index.entries[key];
    state.index.entries[next] = value;
    changed = true;
  }
  if (changed) schedule(root, state);
}

export async function listLibraryTrash(root: string) {
  return (await stateFor(root)).index.trash;
}

export async function getLibraryTrashEntry(root: string, id: string) {
  return (await stateFor(root)).index.trash[id];
}

export async function addLibraryTrashEntry(root: string, id: string, entry: LibraryTrashEntry) {
  const state = await stateFor(root);
  state.index.trash[id] = entry;
  schedule(root, state);
}

export async function removeLibraryTrashEntry(root: string, id: string) {
  const state = await stateFor(root);
  if (!state.index.trash[id]) return;
  delete state.index.trash[id];
  schedule(root, state);
}

export async function clearLibraryTrash(root: string) {
  const state = await stateFor(root);
  if (!Object.keys(state.index.trash).length) return;
  state.index.trash = {};
  schedule(root, state);
}
