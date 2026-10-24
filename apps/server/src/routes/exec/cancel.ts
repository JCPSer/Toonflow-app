import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import { validationOptions } from "@/lib/i18n";
import u from "@/utils";

const inputSchema = z.object({
  directory: z.string().min(1).max(4096),
  requestId: z.uuid(),
}).strict();

export default Router().post("/", validateFields(inputSchema.shape), async (req, res) => {
  u.mcpControl.assertAppRequest(req);
  if (!u.workspace.isLocalWorkspaceRequest(req)) throw Object.assign(new Error("仅允许本机 Toonflow 页面执行命令"), { status: 403 });
  const input = inputSchema.parse(req.body, validationOptions());
  // ACT: 与 exec 一致，键必须基于解析后的工作区根目录，子目录 cwd 不参与。
  const root = await u.workspace.resolveWorkspace(req, input.directory);
  if (!(await u.exec.cancelExec(`${root}\0${input.requestId}`))) throw Object.assign(new Error("没有正在运行的命令"), { status: 404 });
  res.json(success());
});
