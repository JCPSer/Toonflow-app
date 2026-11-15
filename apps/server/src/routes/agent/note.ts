import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import u from "@/utils";

export default Router().post("/", validateFields({
  directory: z.string().min(1).max(4096),
  sessionFile: z.string().regex(/^[\w-]+\.jsonl$/),
  content: z.string().trim().min(1).max(8000),
}), async (req, res) => {
  const { directory, sessionFile, content } = req.body as { directory: string; sessionFile: string; content: string };
  const { directory: cwd } = await u.workspaceFile.resolveWorkspaceFile(req, directory, `.agent/sessions/${sessionFile}`);
  res.set("Cache-Control", "no-store").json(success(await u.agent.appendAgentNote(cwd, sessionFile, content)));
});
