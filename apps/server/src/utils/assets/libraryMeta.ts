import { mkdir, readFile, rename, rm, writeAtomic } from "@toonflow/file";
import { join } from "node:path";
import { internalAssetDirectories } from "./roots";

export type LibraryEntry = {
  tags?: string[];
  note?: string;
  favorite?: boolean;
  size?: number;
  mtimeMs?: number;
  dataType?: string;
  addedAt: number;
  /** 外部删除后保留索引项，列取时标记为 stale，避免永久残留成有效数据。 */
  stale?: boolean;
};
export type LibraryTrashMeta = { tags?: string[]; note?: string; favorite?: boolean };
export type LibraryTrashEntry = { path: string; name: string; deletedAt: number; size: number; isDirectory: boolean; meta?: LibraryTrashMeta };
export type LibraryIndex = { version: 1; entries: Record<string, LibraryEntry>; trash: Record<string, LibraryTrashEntry> };
export type LibraryMetaPatch = { tags?: string[]; note?: string; favorite?: boolean };
export type LibraryEntryRecord = { path: string; size: number; mtimeMs: number; dataType?: string };

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
        ...(entry.stale === true ? { stale: true } : {}),
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

export async function reconcileLibraryEntries(root: string, records: LibraryEntryRecord[]) {
  if (!records.length) return;
  const state = await stateFor(root);
  let changed = false;
  for (const record of records) {
    const path = normalizePath(record.path);
    if (isInternal(path)) continue;
    const current = state.index.entries[path];
    if (!current) {
      state.index.entries[path] = { size: record.size, mtimeMs: record.mtimeMs, ...(record.dataType ? { dataType: record.dataType } : {}), addedAt: Date.now() };
      changed = true;
      continue;
    }
    if (current.size !== record.size) { current.size = record.size; changed = true; }
    if (current.mtimeMs !== record.mtimeMs) { current.mtimeMs = record.mtimeMs; changed = true; }
    if (record.dataType && current.dataType !== record.dataType) { current.dataType = record.dataType; changed = true; }
    if (current.stale) { delete current.stale; changed = true; }
  }
  if (changed) schedule(root, state);
}

/**
 * 非递归列取后真正清理该目录已不存在的索引项（包括之前标记为 stale 的项）。
 * 文件系统始终是列表的真实来源，索引只保留仍存在的路径。
 */
export async function pruneLibraryEntries(root: string, directory: string, keep: Set<string>) {
  const state = await stateFor(root);
  const parentPath = normalizePath(directory);
  let changed = false;
  for (const key of Object.keys(state.index.entries)) {
    const parent = key.includes("/") ? key.slice(0, key.lastIndexOf("/")) : "";
    if (parent !== parentPath || keep.has(key)) continue;
    delete state.index.entries[key];
    changed = true;
  }
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
