import { randomUUID } from "node:crypto";
import { mkdir, realpath } from "@toonflow/file";
import { dirname, extname, relative, sep } from "node:path";
import { lockWorkspaceFiles, protectWorkspaceLibraryPath, protectWorkspaceRoot, resolveWorkspacePath, writeWorkspaceFile } from "@/modules/localRuntime/workspace/files";
import type { MentionQuery } from "@/lib/mentionSources";
import { createAssetDirectory as createLibraryDirectory, listAssetEntries, moveAssetEntryTo, readAssetEntry, removeAssetEntry,
  writeAssetEntry, type AssetSortField, type AssetSortOrder } from "./library";
import { getAssetsDirectory, openAssetLibrary, type AssetLibrary, type AssetLibraryKind, type AssetLibrarySelector } from "./roots";

export { getAssetsDirectory, getProjectLibraryDirectory, openAssetLibrary } from "./roots";
export * from "./library";
export { ensureAssetThumbnail } from "./thumb";
export { assertAssetRequest } from "./guard";

export type AssetQueryOptions = MentionQuery & {
  path?: string;
  root?: string;
  library?: AssetLibraryKind;
  directory?: string;
  sort?: AssetSortField;
  order?: AssetSortOrder;
  type?: string;
  favorite?: boolean;
};

async function selectedLibrary(selector?: AssetLibrarySelector) {
  return openAssetLibrary(selector ?? {});
}

export async function readAssetFile(path: string, signal?: AbortSignal, selector?: AssetLibrarySelector) {
  return readAssetEntry(await selectedLibrary(selector), path, signal);
}

export async function writeAssetFile(path: string, content: string | Uint8Array, revision?: string, selector?: AssetLibrarySelector) {
  return writeAssetEntry(await selectedLibrary(selector), path, content, { revision });
}

export async function createAssetDirectory(path: string, selector?: AssetLibrarySelector) {
  return createLibraryDirectory(await selectedLibrary(selector), path);
}

/** 旧参数语义：target 是完整目标路径。 */
export async function moveAsset(path: string, target: string, selector?: AssetLibrarySelector) {
  return moveAssetEntryTo(await selectedLibrary(selector), path, target);
}

/** 默认进入回收站；与旧实现的永久删除不同，这是本次素材库整改的明确行为。 */
export async function removeAsset(path: string, selector?: AssetLibrarySelector, options: { permanent?: boolean; force?: boolean } = {}) {
  return removeAssetEntry(await selectedLibrary(selector), path, options);
}

export async function importAssetFile(cwd: string, path: string, target?: string, signal?: AbortSignal, selector?: AssetLibrarySelector) {
  const source = await readAssetFile(path, signal, selector);
  const directory = await realpath(cwd);
  const workspacePath = target ?? `assets/imported/${randomUUID()}${extname(source.path)}`;
  const destination = await resolveWorkspacePath(directory, workspacePath, target === undefined);
  protectWorkspaceRoot(directory, destination.path);
  protectWorkspaceLibraryPath(directory, destination.path);
  const release = lockWorkspaceFiles([destination.path]);
  try {
    signal?.throwIfAborted();
    if (target === undefined) await mkdir(dirname(destination.path), { recursive: true });
    const checked = await resolveWorkspacePath(directory, workspacePath);
    protectWorkspaceLibraryPath(directory, checked.path);
    signal?.throwIfAborted();
    await writeWorkspaceFile(checked.path, source.content, true);
    return { path: source.path, workspacePath: relative(directory, checked.path).split(sep).join("/"), revision: source.revision };
  } finally { release(); }
}

export async function queryAssets(options: AssetQueryOptions) {
  const library: AssetLibrary = options.root
    ? { kind: options.library ?? "global", root: options.root, relativePath: "" }
    : await selectedLibrary({ library: options.library, directory: options.directory });
  return listAssetEntries(library, options);
}
