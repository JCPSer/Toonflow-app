import { lstat } from "@toonflow/file";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { Router } from "express";
import u from "@/utils";
import { getRuntimePlatform } from "@/lib/platform";
import { success } from "@/lib/responseFormat";
import { assertAssetRelativePath } from "@/modules/assetLibrary/assets/roots";
import { resolveWorkspacePath } from "@/modules/localRuntime/workspace/files";
import { directoryField, libraryField, pathField, requestLibrary, validateAssetFields } from "@/modules/assetLibrary/assets/routeSchema";

const router = Router();

export default router.post("/", validateAssetFields({ library: libraryField, directory: directoryField, path: pathField }), async (req, res) => {
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
  await lstat(path);

  if (desktop) desktop.showItemInFolder(path);
  else {
    const child = process.platform === "win32"
      ? spawn(resolve(process.env.WINDIR ?? "C:\\Windows", "explorer.exe"), ["/select,", path], { windowsHide: true, stdio: "ignore" })
      : spawn("/usr/bin/open", ["-R", path], { stdio: "ignore" });
    await new Promise<void>((done, fail) => { child.once("error", fail); child.once("spawn", done); });
    child.unref();
  }

  res.json(success());
});
