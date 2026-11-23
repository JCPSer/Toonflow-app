import { Router } from "express";
import { z } from "zod";
import type { CanvasInfo } from "@toonflow/tools-scaffold/runtime";
import type { AgentEvent } from "@/agentRuntime";
import { validateFields } from "@/lib/middleware";
import u from "@/utils";
import { translateError, translateMessage } from "@/lib/i18n";
import { thinkingLevels } from "@/lib/modelReasoning";
import { dispatchDepthSchema } from "@/agent/dispatchDepthSchema";
import { success } from "@/lib/responseFormat";
import { hasBus, publishBus, registerBusRun, unregisterBusRun } from "@/agent/bus";

const inputSchema = z.object({
  prompt: z.string().trim(), directory: z.string().min(1),
  attachments: u.agent.agentAttachmentsSchema.optional(),
  mentions: u.agent.agentMentionsSchema.optional(),
  providerId: z.string().min(1), modelId: z.string().min(1),
  thinkingLevel: z.enum(thinkingLevels).optional(),
  sessionFile: z.string().regex(/^[\w-]+\.jsonl$/).optional(),
  resendFrom: z.string().min(1).max(128).optional(),
  nodeBinding: u.agent.agentNodeBindingSchema.optional(),
  // ACT: 画布 dispatcher 派发时为父任务深度 +1；面板直接发送为 0。
  // 这里只做硬边界（0 至设置允许的最大值），具体用户上限由 sendToAgent 在本次运行内判断。
  dispatchDepth: dispatchDepthSchema,
  // ACT: 全局角色库 id；服务端按 id 解析提示词，不接受前端拼好的整段系统提示。
  roleId: z.string().min(1).max(64).optional(),
  canvas: z.strictObject({
    id: z.string().min(1).max(256),
    tools: z.array(z.strictObject({
      nodeId: z.string().min(1).max(256),
      name: z.string().max(101).regex(/^node:[a-z][a-zA-Z0-9]*$/),
      nodeLabel: z.string().max(200).optional(),
      description: z.string().max(4000),
      parameters: z.record(z.string(), z.json()).refine(value => value.type === "object", "函数参数必须是 object JSON Schema"),
    })).max(1000),
  }).optional(),
});

export default Router().post("/", validateFields(inputSchema.shape), async (req, res) => {
  const { directory, canvas, ...options } = req.body as z.infer<typeof inputSchema>;
  const cwd = await u.workspace.resolveWorkspace(req, directory);
  u.agentRuntime.getAgentModelConfiguration(options.providerId, options.modelId, options.thinkingLevel);

  // ACT: 事件总线模式：启动请求短返回 runId，整轮事件走窗口唯一的长连接。
  // 这样多个 Agent 并行时不再各占一条 HTTP/1.1 连接（WebKit 同源上限 6 条）。
  const busId = req.get("x-agent-bus-id");
  if (busId) {
    if (!hasBus(busId)) return void res.status(409).json({ code: 409, reason: "bus_closed", message: translateMessage("事件通道已断开，请重试") });
    // ACT: runId 由客户端生成并在启动前就登记订阅，避免「事件早于订阅」丢掉 session/stats；
    // 同时也让启动响应丢失时仍能按 runId 取消。
    const requestedRunId = req.get("x-agent-run-id");
    if (requestedRunId && !z.string().uuid().safeParse(requestedRunId).success) {
      return void res.status(400).json({ code: 400, message: translateMessage("运行标识无效") });
    }
    const runId = requestedRunId ?? crypto.randomUUID();
    const controller = new AbortController();
    const send = (event: AgentEvent) => {
      if (event.type === "error") event = { ...event, message: translateMessage(event.message) };
      if (event.type === "session") options.sessionFile = event.file;
      u.agent.trackAgentEvent(cwd, options.sessionFile, event);
      publishBus(busId, runId, event);
    };
    const bridge = canvas ? u.canvas.createCanvasContext(cwd, canvas as CanvasInfo, send) : undefined;
    const questions = u.question.createQuestionContext(cwd, send, () => controller.abort());
    // ACT: 初始化完成后再登记，避免初始化抛错留下未注销的 controller。
    if (!registerBusRun(busId, runId, controller)) {
      bridge?.dispose();
      questions.dispose();
      return void res.status(409).json({ code: 409, reason: "duplicate_run", message: translateMessage("运行标识重复，请重试") });
    }
    res.json(success({ runId }));
    void (async () => {
      try {
        await u.agent.run(
          { ...options, cwd, canvas: bridge?.context, question: questions.context, signal: controller.signal },
          send,
        );
        send({ type: "done" });
      } catch (error) {
        const code = typeof error === "object" && error && "code" in error && typeof error.code === "string" ? error.code : undefined;
        send({ type: "error", message: error instanceof Error ? translateError(error) : translateMessage("Agent 运行失败"), ...(code ? { code } : {}) });
      } finally {
        bridge?.dispose();
        questions.dispose();
        unregisterBusRun(busId, runId);
      }
    })();
    return;
  }

  res.set({ "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" });
  res.flushHeaders();
  const send = (event: AgentEvent) => {
    if (event.type === "error") event = { ...event, message: translateMessage(event.message) };
    if (event.type === "session") options.sessionFile = event.file;
    u.agent.trackAgentEvent(cwd, options.sessionFile, event);
    if (!res.destroyed) res.write(`${JSON.stringify(event)}\n`);
  };
  const bridge = canvas ? u.canvas.createCanvasContext(cwd, canvas as CanvasInfo, send) : undefined;
  const controller = new AbortController();
  const questions = u.question.createQuestionContext(cwd, send, () => controller.abort());
  const heartbeat = setInterval(() => {
    if (!res.destroyed && !res.writableEnded && !res.writableNeedDrain) res.write("\n");
  }, 20000);
  const close = () => { clearInterval(heartbeat); bridge?.dispose(); questions.dispose(); controller.abort(); };
  res.once("close", close);
  req.once("aborted", close);
  req.socket.once("close", close);
  try {
    await u.agent.run({ ...options, cwd, canvas: bridge?.context, question: questions.context, signal: controller.signal, onCancel: close }, send);
    send({ type: "done" });
  } catch (error) {
    // ACT: 响应头已经 flush，状态码不可能再改；把机器码放进事件里，客户端才能可靠地判断"会话忙、可重试"。
    const code = typeof error === "object" && error && "code" in error && typeof error.code === "string" ? error.code : undefined;
    send({ type: "error", message: error instanceof Error ? translateError(error) : translateMessage("Agent 运行失败"), ...(code ? { code } : {}) });
  } finally {
    clearInterval(heartbeat);
    res.off("close", close);
    req.off("aborted", close);
    req.socket.off("close", close);
    bridge?.dispose();
    questions.dispose();
    res.end();
  }
});
