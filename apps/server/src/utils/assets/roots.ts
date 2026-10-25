import type { Request } from "express";
import { lstat, mkdir, realpath, writeAtomic } from "@toonflow/file";
import { dirname, join } from "node:path";
import conf from "@/utils/conf";
import { resolveWorkspace } from "@/utils/workspace";

export type AssetLibraryKind = "global" | "project";
export type AssetLibrary = { kind: AssetLibraryKind; root: string; relativePath: string; fallback?: boolean; workspace?: string };
export type AssetLibrarySelector = { library?: AssetLibraryKind; directory?: string; cwd?: string };
export type ProjectLibraryLayout = { root: string; relativePath: "library" | "library-assets"; fallback: boolean; exists: boolean };

// ACT: 这三类目录保存索引、回收站和缩略图缓存；用户路径一旦进入会绕过元数据与安全边界。
export const internalAssetDirectories = new Set([".library", ".trash", ".thumbs"]);
// ACT: 项目根下这两个名字属于素材库或用户同名目录，文档树扫描与文件删除都必须绕开。
export const projectLibraryDirectoryNames = new Set(["library", "library-assets"]);

export async function getAssetsDirectory(options: { create?: boolean } = {}) {
  const directory = join(dirname(conf.path), "assets");
  try { return await realpath(directory); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    // ACT: 媒体 GET 不能在读路径上创建库目录；不存在时按 404 返回。
    if (options.create === false) throw Object.assign(new Error("全局素材库不存在"), { status: 404, code: "ENOENT" });
    await mkdir(directory, { recursive: true });
    return realpath(directory);
  }
}

function libraryMarker(root: string) {
  return join(root, ".library", "index.json");
}

async function isClaimedLibrary(root: string) {
  const info = await lstat(root).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!info || info.isSymbolicLink() || !info.isDirectory()) return false;
  const marker = await lstat(libraryMarker(root)).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  return marker?.isFile() === true;
}

async function claimLibrary(root: string) {
  await mkdir(join(root, ".library"), { recursive: true });
  // ACT: 标记文件就是可重建索引；先落空索引，声明该目录归素材库所有。
  await writeAtomic(libraryMarker(root), JSON.stringify({ version: 1, entries: {}, trash: {} }));
}

/**
 * 项目库优先使用 library；该目录已被用户占用时退回 library-assets。
 * create=false 只探测实际路径，不创建目录，供 /roots 返回给前端提示。
 */
export async function getProjectLibraryLayout(directory: string, options: { create?: boolean } = {}): Promise<ProjectLibraryLayout> {
  const create = options.create !== false;
  const primary = join(directory, "library");
  if (await isClaimedLibrary(primary)) return { root: await realpath(primary), relativePath: "library", fallback: false, exists: true };
  const primaryInfo = await lstat(primary).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!primaryInfo) {
    if (!create) return { root: primary, relativePath: "library", fallback: false, exists: false };
    await claimLibrary(primary);
    return { root: await realpath(primary), relativePath: "library", fallback: false, exists: true };
  }
  const fallback = join(directory, "library-assets");
  if (await isClaimedLibrary(fallback)) return { root: await realpath(fallback), relativePath: "library-assets", fallback: true, exists: true };
  const fallbackInfo = await lstat(fallback).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!fallbackInfo) {
    if (!create) return { root: fallback, relativePath: "library-assets", fallback: true, exists: false };
    await claimLibrary(fallback);
    return { root: await realpath(fallback), relativePath: "library-assets", fallback: true, exists: true };
  }
  throw Object.assign(new Error("项目下的 library 与 library-assets 都已被其他内容占用，无法创建素材库"), { status: 409, code: "ELIBRARYOCCUPIED" });
}

export async function getProjectLibraryDirectory(directory: string) {
  return (await getProjectLibraryLayout(directory)).root;
}

/** 拒绝内部目录的任何层级，避免索引与回收站被当成普通素材读写。 */
export function assertAssetRelativePath(path: string) {
  const parts = path.split(/[\\/]/);
  if (parts.some(part => internalAssetDirectories.has(part.toLocaleLowerCase()))) {
    throw Object.assign(new Error("不能访问素材库的内部目录"), { status: 403, code: "EINTERNAL" });
  }
}

export function normalizeAssetPath(path?: string) {
  const normalized = (path ?? "").replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/\/+$/, "");
  return normalized === "." ? "" : normalized;
}

/**
 * 解析库根。带 req 时项目目录必须通过工作区授权；不带 req 只供已经过授权的服务端内部调用。
 */
export async function openAssetLibrary(selector: AssetLibrarySelector, req?: Request, options: { sameOriginMedia?: boolean; create?: boolean } = {}): Promise<AssetLibrary> {
  const kind = selector.library ?? "global";
  const directory = selector.directory ?? selector.cwd;
  let workspace: string | undefined;
  if (directory) {
    workspace = req ? await resolveWorkspace(req, directory, { sameOriginMedia: options.sameOriginMedia }) : await realpath(directory);
  }
  if (kind === "project") {
    if (!workspace) throw Object.assign(new Error("项目素材库必须提供工作区目录 directory"), { status: 400 });
    if (!(await lstat(workspace)).isDirectory()) throw Object.assign(new Error("工作区目录不是文件夹"), { status: 400 });
    const layout = await getProjectLibraryLayout(workspace, { create: options.create !== false });
    // ACT: 媒体读取等只读路径不得为了响应 GET 而创建 .library 标记。
    if (!layout.exists) throw Object.assign(new Error("项目素材库不存在"), { status: 404, code: "ENOENT" });
    return { kind, root: layout.root, relativePath: layout.relativePath, fallback: layout.fallback, workspace };
  }
  return { kind, root: await getAssetsDirectory({ create: options.create !== false }), relativePath: "", ...(workspace ? { workspace } : {}) };
}
