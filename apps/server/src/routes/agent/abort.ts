import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import u from "@/utils";

// ACT: 画布调度器硬打断用。会话可能属于用户面板请求，dispatcher 拿不到那个 AbortController，
// 只能由服务端按会话文件找到活动会话并等它收尾。
export default Router().post("/", validateFields({
  directory: z.string().min(1).max(4096),
  sessionFile: z.string().regex(/^[\w-]+\.jsonl$/),
}), async (req, res) => {
  const { directory, sessionFile } = req.body as { directory: string; sessionFile: string };
  const { path } = await u.workspaceFile.resolveWorkspaceFile(req, directory, `.agent/sessions/${sessionFile}`);
  const result = await u.agent.abortAgentSession(path);
  res.set("Cache-Control", "no-store").json(success({ result }));
});
