import { lstat, rm, rmdir } from "@toonflow/file";
import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { scheduleThumbnailSweep } from "@/utils/assets/thumb";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";

const router = Router();

export default router.delete("/", validateFields({ directory: z.string().min(1).max(4096), path: z.string().max(4096), recursive: z.boolean().optional() }), async (req, res) => {
  const { directory, path } = await u.workspaceFile.resolveWorkspaceFile(req, req.body.directory, req.body.path);
  u.workspaceFile.protectWorkspaceRoot(directory, path);
  u.workspaceFile.protectWorkspaceLibraryPath(directory, path);
  const release = u.workspaceFile.lockWorkspaceFiles([path]);
  try {
    if ((await lstat(path)).isDirectory() && req.body.recursive !== true) await rmdir(path);
    else await rm(path, { recursive: req.body.recursive === true });
  } finally { release(); }
  // ACT: 删除后源文件的 realpath 已失效，无法反推缩略图缓存键；交给去抖清扫回收（同时覆盖递归删除与改名）。
  scheduleThumbnailSweep();
  res.json(success());
});
