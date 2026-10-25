import { ref } from "vue";
import type { AssetEntry, AssetLibraryKind, AssetListOptions, AssetListResult, AssetRoots, AssetTrashItem, AssetTrashResult, AssetTreeResult } from "./types";
import { joinAssetPath, normalizeAssetPath, parentAssetPath } from "./types";

/** 服务端素材接口尚未就绪时启用本地演示数据；任一次真实请求成功后自动关闭。 */
export const mockMode = ref(false);

type MockRecord = {
  library: AssetLibraryKind;
  path: string;
  name: string;
  type: "file" | "directory";
  size: number;
  mtimeMs: number;
  tags: string[];
  note: string;
  favorite: boolean;
};

type MockTrashRecord = { id: string; library: AssetLibraryKind; records: MockRecord[]; deletedAt: number; isDirectory: boolean; size: number; path: string; name: string };

type MockState = {
  records: Map<string, MockRecord>;
  trash: MockTrashRecord[];
  objectUrls: Map<string, string>;
};

let state: MockState | undefined;

function key(library: AssetLibraryKind, path: string) {
  return `${library}:${normalizeAssetPath(path)}`;
}

function categoryFor(name: string, type: "file" | "directory") {
  if (type === "directory") return "directory";
  if (/\.(avif|apng|bmp|gif|ico|jpe?g|png|svg|webp)$/i.test(name)) return "image";
  if (/\.(mp4|m4v|webm|mov|mkv|avi|ogv)$/i.test(name)) return "video";
  if (/\.(mp3|wav|ogg|opus|flac|m4a|aac)$/i.test(name)) return "audio";
  if (/\.(md|markdown|txt|json|xml|csv|html|css|js|ts|ndjson)$/i.test(name)) return "document";
  return "file";
}

function placeholderImage(label: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240" viewBox="0 0 320 240"><rect width="320" height="240" fill="#e8eef7"/><circle cx="252" cy="58" r="22" fill="#c7d5e8"/><path d="M0 200 90 118l58 52 44-36 128 106H0Z" fill="#b5c7dd"/><text x="160" y="224" text-anchor="middle" font-family="sans-serif" font-size="14" fill="#5d6b7d">${escapeXml(label)}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function escapeXml(value: string) {
  return value.replace(/[<>&'"]/g, char => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[char] ?? char));
}

function addRecord(library: AssetLibraryKind, path: string, type: "file" | "directory", size = 0, mtimeMs = Date.now()) {
  const normalized = normalizeAssetPath(path);
  const name = normalized.split("/").at(-1) ?? normalized;
  state!.records.set(key(library, normalized), { library, path: normalized, name, type, size, mtimeMs, tags: [], note: "", favorite: normalized.includes("女主") });
}

function seed() {
  const created: MockState = { records: new Map(), trash: [], objectUrls: new Map() };
  state = created;
  const now = Date.now();
  addRecord("project", "角色", "directory");
  addRecord("project", "角色/女主", "directory");
  addRecord("project", "角色/女主/女主立绘.png", "file", 842_133, now - 86_400_000 * 3);
  addRecord("project", "角色/女主/表情差分.png", "file", 512_000, now - 86_400_000 * 2);
  addRecord("project", "场景", "directory");
  addRecord("project", "场景/森林晨雾.jpg", "file", 2_411_331, now - 86_400_000);
  addRecord("project", "场景/森林晨雾.mp4", "file", 18_221_033, now - 3_600_000);
  addRecord("project", "旁白.txt", "file", 1_024, now - 600_000);
  addRecord("global", "参考", "directory");
  addRecord("global", "参考/配色方案.jpg", "file", 388_120, now - 86_400_000 * 9);
  addRecord("global", "品牌", "directory");
  addRecord("global", "品牌/logo.png", "file", 64_320, now - 86_400_000 * 12);
  addRecord("global", "音效", "directory");
  addRecord("global", "音效/点击.wav", "file", 88_221, now - 86_400_000 * 4);
}

function ensure() {
  if (!state) seed();
  return state!;
}

function toEntry(record: MockRecord): AssetEntry {
  return {
    name: record.name,
    path: record.path,
    type: record.type,
    category: categoryFor(record.name, record.type),
    ...(record.type === "file" ? { dataType: categoryFor(record.name, "file").toUpperCase() } : {}),
    size: record.size,
    mtimeMs: record.mtimeMs,
    tags: [...record.tags],
    note: record.note,
    favorite: record.favorite,
    ...(record.type === "directory" ? { childCount: childrenOf(record.library, record.path).length } : {}),
  };
}

function childrenOf(library: AssetLibraryKind, path: string) {
  const normalized = normalizeAssetPath(path);
  return [...ensure().records.values()].filter(record => record.library === library && parentAssetPath(record.path) === normalized && record.path !== normalized);
}

function descendantsOf(library: AssetLibraryKind, path: string) {
  const normalized = normalizeAssetPath(path);
  return [...ensure().records.values()].filter(record => record.library === library
    && (normalized === "" ? record.path !== "" : record.path === normalized || record.path.startsWith(`${normalized}/`)));
}

function sortRecords(records: MockRecord[], sort: AssetListOptions["sort"], order: AssetListOptions["order"]) {
  const direction = order === "desc" ? -1 : 1;
  const field = sort ?? "name";
  return [...records].sort((left, right) => {
    const byName = left.name.localeCompare(right.name, "zh-CN", { numeric: true });
    const value = field === "mtime" ? left.mtimeMs - right.mtimeMs : field === "size" ? left.size - right.size
      : field === "type" ? categoryFor(left.name, left.type).localeCompare(categoryFor(right.name, right.type)) : byName;
    return (value || byName) * direction;
  });
}

export function mockRoots(directory?: string): AssetRoots {
  return {
    global: { library: "global", root: "/mock/assets", exists: true },
    project: directory ? { library: "project", root: `${directory.replace(/[\\/]+$/, "")}/library`, exists: true } : null,
  };
}

export function mockTree(library: AssetLibraryKind, path?: string): AssetTreeResult {
  return { items: sortRecords(childrenOf(library, path ?? ""), "name", "asc").map(toEntry), truncated: false };
}

export function mockList(options: AssetListOptions): AssetListResult {
  const library = options.library;
  const base = normalizeAssetPath(options.path);
  const query = options.query?.trim().toLocaleLowerCase() ?? "";
  const source = (query ? descendantsOf(library, base) : childrenOf(library, base)).filter(record => {
    if (options.type && options.type !== "all" && categoryFor(record.name, record.type) !== options.type) return false;
    if (options.favorite === true && !record.favorite) return false;
    if (!query) return true;
    return `${record.name} ${record.path} ${record.tags.join(" ")} ${record.note}`.toLocaleLowerCase().includes(query);
  });
  const sorted = sortRecords(source, options.sort, options.order).map(toEntry);
  const offset = Math.max(0, Number(options.cursor ?? 0) || 0);
  const limit = options.limit ?? 100;
  const items = sorted.slice(offset, offset + limit);
  const nextOffset = offset + items.length;
  return { items, total: sorted.length, truncated: false, ...(nextOffset < sorted.length ? { nextCursor: String(nextOffset) } : {}) };
}

export function mockMkdir(library: AssetLibraryKind, path: string) {
  const normalized = normalizeAssetPath(path);
  if (!normalized) throw new Error("请输入文件夹名称");
  if (ensure().records.has(key(library, normalized))) throw Object.assign(new Error("已存在同名文件或目录"), { code: "EEXIST" });
  addRecord(library, normalized, "directory");
  return { path: normalized };
}

export function mockMove(library: AssetLibraryKind, source: string, targetDirectory: string) {
  const from = normalizeAssetPath(source);
  const target = normalizeAssetPath(targetDirectory);
  if (!from) throw new Error("不能移动素材库根目录");
  if (target === from || target.startsWith(`${from}/`)) throw new Error("不能把文件夹移动到自身的子目录");
  const destination = joinAssetPath(target, from.split("/").at(-1)!);
  if (ensure().records.has(key(library, destination))) throw Object.assign(new Error("目标位置已存在同名文件或目录"), { code: "EEXIST" });
  const records = descendantsOf(library, from);
  for (const record of records) {
    ensure().records.delete(key(library, record.path));
    const nextPath = destination + record.path.slice(from.length);
    ensure().records.set(key(library, nextPath), { ...record, path: nextPath, name: nextPath.split("/").at(-1) ?? record.name });
  }
  return { path: destination };
}

export function mockRename(library: AssetLibraryKind, path: string, name: string) {
  const normalized = normalizeAssetPath(path);
  const parent = parentAssetPath(normalized);
  return mockMoveTo(library, normalized, joinAssetPath(parent, name));
}

export function mockMoveTo(library: AssetLibraryKind, source: string, target: string) {
  const from = normalizeAssetPath(source);
  const to = normalizeAssetPath(target);
  if (!from) throw new Error("不能移动素材库根目录");
  if (to === from) return { path: from };
  if (to.startsWith(`${from}/`)) throw new Error("不能把文件夹移动到自身的子目录");
  if (ensure().records.has(key(library, to))) throw Object.assign(new Error("目标位置已存在同名文件或目录"), { code: "EEXIST" });
  const records = descendantsOf(library, from);
  for (const record of records) {
    ensure().records.delete(key(library, record.path));
    const nextPath = to + record.path.slice(from.length);
    ensure().records.set(key(library, nextPath), { ...record, path: nextPath, name: nextPath.split("/").at(-1) ?? record.name });
  }
  return { path: to };
}

export function mockSave(library: AssetLibraryKind, path: string, blob: Blob) {
  const normalized = normalizeAssetPath(path);
  if (ensure().records.has(key(library, normalized))) {
    const existing = ensure().records.get(key(library, normalized))!;
    if (existing.type === "directory") throw Object.assign(new Error("同名位置是文件夹"), { code: "EEXIST" });
    ensure().records.delete(key(library, normalized));
    const previous = ensure().objectUrls.get(key(library, normalized));
    if (previous) URL.revokeObjectURL(previous);
  }
  const name = normalized.split("/").at(-1) ?? normalized;
  const url = URL.createObjectURL(blob);
  ensure().objectUrls.set(key(library, normalized), url);
  addRecord(library, normalized, "file", blob.size, Date.now());
  return { path: normalized, revision: String(blob.size) };
}

export function mockAssetUrl(library: AssetLibraryKind, path: string) {
  const stateValue = ensure();
  const normalized = normalizeAssetPath(path);
  const uploaded = stateValue.objectUrls.get(key(library, normalized));
  if (uploaded) return uploaded;
  const record = stateValue.records.get(key(library, normalized));
  if (record && categoryFor(record.name, record.type) === "image") return placeholderImage(record.name);
  return "";
}

export function mockRemove(library: AssetLibraryKind, path: string, options: { permanent?: boolean; force?: boolean } = {}) {
  const normalized = normalizeAssetPath(path);
  const records = descendantsOf(library, normalized);
  if (!records.length) throw new Error("找不到这个文件或文件夹");
  for (const record of records) {
    ensure().records.delete(key(library, record.path));
    const url = ensure().objectUrls.get(key(library, record.path));
    if (url) URL.revokeObjectURL(url);
    ensure().objectUrls.delete(key(library, record.path));
  }
  if (options.permanent) return { path: normalized, permanent: true };
  const root = records.find(record => record.path === normalized) ?? records[0]!;
  const id = crypto.randomUUID();
  ensure().trash.push({
    id,
    library,
    records,
    deletedAt: Date.now(),
    isDirectory: root.type === "directory",
    size: records.reduce((total, record) => total + record.size, 0),
    path: normalized,
    name: root.name,
  });
  return { path: normalized, trashId: id };
}

export function mockTrash(library: AssetLibraryKind): AssetTrashResult {
  const items = ensure().trash.filter(item => item.library === library).sort((left, right) => right.deletedAt - left.deletedAt)
    .map(item => ({ id: item.id, path: item.path, name: item.name, deletedAt: item.deletedAt, size: item.size, isDirectory: item.isDirectory }));
  return { items, usage: items.reduce((total, item) => total + item.size, 0) };
}

export function mockRestore(library: AssetLibraryKind, id: string) {
  const entry = ensure().trash.find(item => item.library === library && item.id === id);
  if (!entry) throw new Error("回收站项目不存在");
  const root = entry.records.find(record => record.path === entry.path) ?? entry.records[0];
  if (!root) throw new Error("回收站文件已被外部修改或删除");
  let target = entry.path;
  for (let index = 2; ensure().records.has(key(library, target)); index++) {
    const name = entry.name;
    const dot = name.lastIndexOf(".");
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const suffix = dot > 0 ? name.slice(dot) : "";
    const parent = parentAssetPath(entry.path);
    target = joinAssetPath(parent, `${stem} (${index})${suffix}`);
  }
  for (const record of entry.records) {
    const nextPath = target + record.path.slice(entry.path.length);
    ensure().records.set(key(library, nextPath), { ...record, path: nextPath, name: nextPath.split("/").at(-1) ?? record.name });
  }
  ensure().trash = ensure().trash.filter(item => item.id !== id);
  return { path: target };
}

export function mockPurge(library: AssetLibraryKind, options: { id?: string; all?: boolean }) {
  if (options.all) {
    ensure().trash = ensure().trash.filter(item => item.library !== library);
    return { all: true };
  }
  ensure().trash = ensure().trash.filter(item => item.library !== library || item.id !== options.id);
  return { id: options.id };
}

export function mockMeta(library: AssetLibraryKind, path: string, patch: { tags?: string[]; note?: string; favorite?: boolean }) {
  const record = ensure().records.get(key(library, path));
  if (!record) throw new Error("找不到这个文件或文件夹");
  if (patch.tags !== undefined) record.tags = patch.tags.slice(0, 20).map(tag => tag.slice(0, 32));
  if (patch.note !== undefined) record.note = patch.note.slice(0, 2000);
  if (patch.favorite !== undefined) record.favorite = patch.favorite;
  return { path: record.path, tags: record.tags, note: record.note, favorite: record.favorite };
}

/** 让演示数据看起来像是从磁盘加载的缩略图；mock 模式下不会产生真实网络请求。 */
export function mockThumbnail(library: AssetLibraryKind, path: string) {
  return mockAssetUrl(library, path);
}
