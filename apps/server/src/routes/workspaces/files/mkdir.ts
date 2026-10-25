import { mkdir } from "@toonflow/file";
import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";

const router = Router();

export default router.post("/", validateFields({ directory: z.string().min(1).max(4096), path: z.string().max(4096) }), async (req, res) => {
  const { directory, path } = await u.workspaceFile.resolveWorkspaceFile(req, req.body.directory, req.body.path);
  u.workspaceFile.protectWorkspaceRoot(directory, path);
  // ACT: 前端 projectUi 首次写指针前需要创建 .toonflow；只放行该目录本身。
  u.workspaceFile.protectWorkspaceLibraryPath(directory, path, { allowProjectUiDirectory: true });
  const release = u.workspaceFile.lockWorkspaceFiles([path]);
  try { await mkdir(path); }
  finally { release(); }
  res.json(success());
});
