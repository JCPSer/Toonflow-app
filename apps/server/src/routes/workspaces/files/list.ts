import { readdir } from "@toonflow/file";
import { join, relative, sep } from "node:path";
import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";

const router = Router();

export default router.get("/", validateFields({ directory: z.string().min(1).max(4096), path: z.string().max(4096).optional() }, "query"), async (req, res) => {
  const { directory, path } = await u.workspaceFile.resolveWorkspaceFile(req, req.query.directory as string, (req.query.path as string | undefined) ?? "");
  const entries = await readdir(path, { withFileTypes: true });
  const atWorkspaceRoot = path === directory;
  res.set("Cache-Control", "no-store").json(success({
    directory,
    empty: entries.length === 0,
    entries: entries.filter(entry => (entry.isFile() || entry.isDirectory())
      // ACT: 项目素材库由素材面板管理，不在文档树中暴露，避免误删或被当普通目录移动。
      && !(atWorkspaceRoot && ["library", "library-assets"].includes(entry.name.toLocaleLowerCase()))).map(entry => ({
      name: entry.name, path: relative(directory, join(path, entry.name)).split(sep).join("/"), type: entry.isDirectory() ? "directory" : "file",
    })).sort((a, b) => a.name.localeCompare(b.name, "zh-CN", { numeric: true })),
  }));
});
