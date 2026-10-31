import { lstat, rm } from "@toonflow/file";
import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { error, success } from "@/lib/responseFormat";
import { importProject } from "@/modules/workspaceShare/import";
import { ShareContainerError } from "@/modules/workspaceShare/container";
import { createTask, settle } from "@/modules/workspaceShare/tasks";
import { resolveTaskScope } from "./scope";
import { temporaryDirectory } from "./tmp";

// ACT: 导入一律落在工作区根目录，避免误传「当前工程目录」把新工程嵌进旧工程里面。
const inputSchema = z.strictObject({
  filePath: z.string().min(1).max(4096),
  password: z.string().max(200).optional(),
});

export default Router().post("/", validateFields(inputSchema.shape), async (req, res) => {
  u.mcpControl.assertAppRequest(req);
  // ACT: 传的是本机绝对路径，只有桌面客户端能这么用；服务器/移动端一律拒绝。
  if (!req.app.locals.desktop) return res.status(404).json(error("此接口仅在桌面客户端中可用", null, 404));
  const input = inputSchema.parse(req.body);
  const parent = await resolveTaskScope(req);
  if (!input.filePath.toLowerCase().endsWith(".tfproj")) throw Object.assign(new Error("只能导入 .tfproj 分享文件"), { status: 415 });
  if (!await lstat(input.filePath).catch(() => null)) throw Object.assign(new Error("分享文件不存在或已被移动"), { status: 404 });

  // ACT: 任务归属按「目标父目录」记录，状态查询与取消都要求同一个目录，避免跨会话串号。
  const task = createTask(parent);
  res.json(success({ id: task.id, phase: "importing" }));
  void (async () => {
    let keepTemporary = false;
    try {
      const result = await importProject({
        filePath: input.filePath,
        parent,
        password: input.password || undefined,
        signal: task.controller.signal,
        onProgress: patch => Object.assign(task, patch),
      });
      settle(task, { result: { manifest: result.manifest, path: result.directory }, phase: "importing" });
    } catch (cause) {
      // ACT: 口令错误时保留临时包——拖拽入口不会再上传第二次，删掉就再也解不开了。
      keepTemporary = cause instanceof ShareContainerError && cause.code === "SHARE_PASSWORD";
      settle(task, { error: cause instanceof Error ? cause.message : String(cause), cancelled: task.controller.signal.aborted });
    } finally {
      if (!keepTemporary && u.workspaceFile.isWithin(temporaryDirectory(), input.filePath)) await rm(input.filePath).catch(() => {});
    }
  })();
});
