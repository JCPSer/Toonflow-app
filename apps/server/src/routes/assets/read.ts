import { lstat } from "@toonflow/file";
import { sendFile } from "@/modules/platformCore/fileHttp";
import { basename } from "node:path";
import { Router } from "express";
import { z } from "zod";
import { assertAssetRelativePath } from "@/modules/assetLibrary/assets/roots";
import { protectWorkspaceRoot, resolveWorkspacePath } from "@/modules/localRuntime/workspace/files";
import { validateAssetFields, directoryField, libraryField, pathField, requestLibrary } from "@/modules/assetLibrary/assets/routeSchema";

const router = Router();

export default router.get("/", validateAssetFields({ path: pathField, download: z.literal("true").optional(),
  library: libraryField, directory: directoryField }, "query"), async (req, res, next) => {
  // ACT: 浏览器内联展示不能带自定义头；下载动作必须走严格 workspace 校验。
  const library = await requestLibrary(req, { library: req.query.library as "global" | "project" | undefined,
    directory: req.query.directory as string | undefined }, req.query.download !== "true", { create: false });
  assertAssetRelativePath(req.query.path as string);
  const { path } = await resolveWorkspacePath(library.root, req.query.path as string);
  protectWorkspaceRoot(library.root, path);
  if (!(await lstat(path)).isFile()) throw Object.assign(new Error("只能读取文件"), { status: 400 });
  if (req.query.download === "true") res.attachment(basename(path));
  res.set({ "Cache-Control": "no-store", "Content-Security-Policy": "sandbox", "X-Content-Type-Options": "nosniff" });
  await sendFile(res, path, { dotfiles: "allow" }, err => { if (err) next(err); });
});
