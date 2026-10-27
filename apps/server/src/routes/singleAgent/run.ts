import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { translateError } from "@/lib/i18n";
import u from "@/utils";
import { thinkingLevels } from "@/lib/modelReasoning";

const inputSchema = z.strictObject({
  sessionId: z.uuid(), runId: z.uuid(), prompt: z.string().trim().min(1).max(100000),
  providerId: z.string().min(1).max(200), modelId: z.string().min(1).max(500),
  thinkingLevel: z.enum(thinkingLevels).optional(),
});

export default Router().post("/", validateFields(inputSchema.shape), async (req, res) => {
  u.mcpControl.assertAppRequest(req);
  const input = inputSchema.parse(req.body);
  u.agentRuntime.getAgentModelConfiguration(input.providerId, input.modelId, input.thinkingLevel);
  const controller = new AbortController();
  // ACT: 中止必须带具体原因，否则客户端工具只能看到「工具调用已取消」，无法判断是页面断开还是网络中断。
  const abortWith = (reason: string) => () => { if (!controller.signal.aborted) controller.abort(new Error(reason)); };
  const onResponseClose = abortWith("对话连接已关闭");
  const onRequestAborted = abortWith("请求已中断");
  const onSocketClose = abortWith("网络连接已断开");
  res.once("close", onResponseClose);
  req.once("aborted", onRequestAborted);
  req.socket.once("close", onSocketClose);
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  try {
    await u.singleAgent.run(input, event => {
      if (!res.destroyed) res.write(`${JSON.stringify(event.type === "error" ? { ...event, message: translateError(new Error(event.message)) } : event)}\n`);
    }, controller.signal, () => {
      res.set({ "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no" });
      res.flushHeaders();
      heartbeat = setInterval(() => { if (!res.destroyed && !res.writableNeedDrain) res.write("\n"); }, 1000);
    });
    if (!res.destroyed) res.end();
  } finally {
    clearInterval(heartbeat);
    res.off("close", onResponseClose);
    req.off("aborted", onRequestAborted);
    req.socket.off("close", onSocketClose);
  }
});
