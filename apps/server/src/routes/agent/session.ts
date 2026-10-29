import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";

export default Router().delete("/", validateFields({
  directory: z.string().min(1).max(4096),
  sessionFile: z.string().regex(/^[\w-]+\.jsonl$/),
}), async (req, res) => {
  const { directory, sessionFile } = req.body as { directory: string; sessionFile: string };
  const resolved = await u.workspaceFile.resolveWorkspaceFile(req, directory, `.agent/sessions/${sessionFile}`)
    .catch((error: NodeJS.ErrnoException) => {
      // ACT: 目录或文件已不存在时删除仍是幂等的成功，不把 ENOENT 报成失败。
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
  if (resolved) await u.agent.removeAgentSession(resolved.directory, resolved.path);
  res.json(success());
});
