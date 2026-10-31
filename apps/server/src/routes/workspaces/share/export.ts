import { basename } from "node:path";
import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { error, success } from "@/lib/responseFormat";
import { exportProject } from "@/modules/workspaceShare/export";
import { createTask, settle } from "@/modules/workspaceShare/tasks";

const inputSchema = z.strictObject({
  directory: z.string().min(1).max(4096),
  name: z.string().trim().min(1).max(200),
  saveToken: z.string().min(1).max(200),
  password: z.string().max(200).optional(),
});

export default Router().post("/", validateFields(inputSchema.shape), async (req, res) => {
  u.mcpControl.assertAppRequest(req);
  // ACT: 保存位置由主进程 token 保管，服务器模式没有这套能力，给出可读的拒绝而不是 TypeError。
  if (!req.app.locals.desktop) return res.status(404).json(error("此接口仅在桌面客户端中可用", null, 404));
  const input = inputSchema.parse(req.body);
  const root = await u.workspace.resolveWorkspace(req, input.directory);
  // ACT: 一次性 token 由主进程保管路径，前端全程拿不到绝对路径；取回即失效。
  const target = u.desktop.getDesktopRuntime(req).takeSaveTarget(input.saveToken);
  if (!target.toLowerCase().endsWith(".tfproj")) throw Object.assign(new Error("分享文件必须使用 .tfproj 扩展名"), { status: 400 });
  if (u.workspaceFile.isWithin(root, target)) throw Object.assign(new Error("不能把分享包保存到工程目录内部"), { status: 400 });

  const task = createTask(root);
  res.json(success({ id: task.id, phase: task.phase }));
  void (async () => {
    try {
      const manifest = await exportProject({
        root,
        name: input.name || basename(root),
        appVersion: String(req.app.locals.appVersion ?? ""),
        target,
        password: input.password || undefined,
        signal: task.controller.signal,
        onProgress: patch => Object.assign(task, patch),
      });
      settle(task, { result: { manifest, path: target }, phase: "packing" });
    } catch (error) {
      settle(task, { error: error instanceof Error ? error.message : String(error), cancelled: task.controller.signal.aborted });
    }
  })();
});
