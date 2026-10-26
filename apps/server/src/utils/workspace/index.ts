import type { Request } from "express";
import { realpath, stat } from "@toonflow/file";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import conf from "@/utils/conf";
import { getMobileLinkConfig, isMobileLinkRequest } from "@/utils/mobileLink";
import { getRuntimePlatform } from "@/lib/platform";

export function isLocalWorkspaceRequest(req: Request) {
  if (isMobileLinkRequest(req)) return false;
  const localAddress = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress ?? "") && req.get("x-toonflow-local-client") !== "0";
  const localHost = ["localhost", "127.0.0.1", "[::1]"].includes(req.hostname);
  const origin = req.get("origin");
  const localOrigin = `${req.protocol}://${req.get("host")}`;
  const sameOrigin = origin === undefined ? req.get("referer")?.startsWith(`${localOrigin}/`) : origin === localOrigin;
  return localAddress && localHost && sameOrigin && req.get("x-toonflow-workspace") === "1";
}

/**
 * 桌面端项目可以位于 workspaces 根之外；媒体端点只认已经是项目的目录。
 * ACT: 除素材库标记外把 `.toonflow` 也算作项目标记——项目打开时会写 `.toonflow/ui.json`，
 * 而素材库索引 `.library/index.json` 要等素材面板首次列表才创建，只看后者会让新项目首屏缩略图 404。
 */
async function isKnownWorkspaceRoot(directory: string) {
  const exists = async (path: string, wantsDirectory = false) => {
    const info = await stat(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT" || error.code === "ENOTDIR") return null;
      throw error;
    });
    return wantsDirectory ? Boolean(info?.isDirectory()) : Boolean(info?.isFile());
  };
  for (const name of ["library", "library-assets"]) {
    if (await exists(join(directory, name, ".library", "index.json"))) return true;
  }
  return exists(join(directory, ".toonflow"), true);
}

export async function resolveWorkspace(req: Request, path: string, options: { sameOriginMedia?: boolean } = {}) {
  if (!isAbsolute(path)) throw Object.assign(new Error("工作目录必须是绝对路径"), { status: 400 });
  const directory = await realpath(path).catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT" || err.code === "ENOTDIR") throw Object.assign(new Error("工作目录不存在，请重新选择文件夹"), { status: 404 });
    throw err;
  });
  if (!(await stat(directory)).isDirectory()) throw Object.assign(new Error("工作目录不是文件夹，请重新选择"), { status: 404 });
  // ACT: 桌面宿主的 workspace-bound 请求（带工作区标记）可以打开本机任意已存在目录。
  if (getRuntimePlatform().local && isLocalWorkspaceRequest(req)) return directory;

  if (isMobileLinkRequest(req)) {
    for (const root of getMobileLinkConfig().directories) {
      const offset = relative(root, directory);
      if (offset !== ".." && !offset.startsWith(`..${sep}`) && !isAbsolute(offset)) return directory;
    }
  }

  const root = await realpath(resolve(dirname(conf.path), "workspaces")).catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") return null;
    throw err;
  });
  if (root) {
    const offset = relative(root, directory);
    if (offset !== ".." && !offset.startsWith(`..${sep}`) && !isAbsolute(offset)) return directory;
  }
  // ACT: 媒体端点没有工作区标记（<img>/<video> 无法带头），桌面端只放行已存在且带素材库标记的项目根，
  // 不能再因为“同源”就放行任意绝对路径；服务器部署则始终限制在 workspaces 根内。
  if (options.sameOriginMedia === true && getRuntimePlatform().local) {
    if (await isKnownWorkspaceRoot(directory)) return directory;
    throw Object.assign(new Error("项目素材库不存在"), { status: 404, code: "ENOENT" });
  }
  throw Object.assign(new Error("服务器部署只能使用服务器工作区"), { status: 403 });
}
