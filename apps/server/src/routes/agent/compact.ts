import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";

export default Router().post("/", validateFields({
  directory: z.string().min(1).max(4096),
  sessionFile: z.string().regex(/^[\w-]+\.jsonl$/),
}), async (req, res) => {
  const { directory, sessionFile } = req.body as { directory: string; sessionFile: string };
  const { directory: cwd, path } = await u.workspaceFile.resolveWorkspaceFile(req, directory, `.agent/sessions/${sessionFile}`);
  // ACT: 客户端断开后摘要调用仍在烧 token 且占着会话文件锁，断开即中止压缩。
  const controller = new AbortController();
  const abort = () => controller.abort();
  res.once("close", abort);
  req.once("aborted", abort);
  try {
    res.set("Cache-Control", "no-store").json(success(await u.agent.compactAgentSession(cwd, path, controller.signal)));
  } finally {
    res.off("close", abort);
    req.off("aborted", abort);
  }
});
