import { lstat } from "@toonflow/file";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { z } from "zod";
import { Router } from "express";
import u from "@/utils";
import { getRuntimePlatform } from "@/lib/platform";
import { success } from "@/lib/responseFormat";
import { assertAssetRelativePath } from "@/modules/assetLibrary/assets/roots";
import { resolveWorkspacePath } from "@/modules/localRuntime/workspace/files";
import { directoryField, libraryField, requestLibrary, validateAssetFields } from "@/modules/assetLibrary/assets/routeSchema";

const router = Router();

// ACT: 只等待进程成功拉起就 unref，避免文件管理器未启动时阻塞请求。
async function spawnDetached([command, args]: [string, string[]]) {
  const child = spawn(command, args, process.platform === "win32" ? { windowsHide: true, stdio: "ignore" } : { stdio: "ignore" });
  await new Promise<void>((done, fail) => { child.once("error", fail); child.once("spawn", done); });
  child.unref();
}

// ACT: 背景/库根没有可定位的相对路径，reveal 允许空串定位到库根自身；共用的 pathField 不能放宽，其它路由靠它挡空值。
const revealPathField = z.string().max(4096)
  // ACT: 空串表示库根；"." 或首尾空白既不是有效相对路径，也会让 404 文案说不清。
  .refine(value => value === "" || (value === value.trim() && value !== "."), "路径无效");

export default router.post("/", validateAssetFields({ library: libraryField, directory: directoryField, path: revealPathField }), async (req, res) => {
  // ACT: 远程浏览器的 Origin 与 req.host 相同，同源校验拦不住；再用本机标记 + 桌面/本机开发做双重守卫。
  if (!u.workspace.isLocalWorkspaceRequest(req)) throw Object.assign(new Error("仅支持本机访问时在文件管理器中显示"), { status: 403 });
  const desktop = u.desktop.getDesktopRuntime(req);
  if (!desktop && !getRuntimePlatform().nativeDevelopment) {
    throw Object.assign(new Error("仅支持桌面客户端或本机开发页面打开文件所在位置"), { status: 403 });
  }

  const library = await requestLibrary(req, { library: req.body.library, directory: req.body.directory }, false, { create: false });
  const relativePath = req.body.path as string;
  assertAssetRelativePath(relativePath);
  const { path } = await resolveWorkspacePath(library.root, relativePath);
  const info = await lstat(path);
  // ACT: showItemInFolder 只会选中父目录里的该项；目录要直接进入，所以单独走 open/explorer。
  if (info.isDirectory() && desktop) {
    await spawnDetached(process.platform === "win32" ? [resolve(process.env.WINDIR ?? "C:\\Windows", "explorer.exe"), [path]] : ["/usr/bin/open", [path]]);
    res.json(success());
    return;
  }
  if (info.isDirectory()) {
    await spawnDetached(process.platform === "win32" ? [resolve(process.env.WINDIR ?? "C:\\Windows", "explorer.exe"), [path]] : ["/usr/bin/open", [path]]);
  } else if (desktop) desktop.showItemInFolder(path);
  else {
    await spawnDetached(process.platform === "win32"
      ? [resolve(process.env.WINDIR ?? "C:\\Windows", "explorer.exe"), ["/select,", path]]
      : ["/usr/bin/open", ["-R", path]]);
  }

  res.json(success());
});
