import { Router } from "express";
import { z } from "zod";
import type { Context, Message } from "@earendil-works/pi-ai";
import { validateFields } from "@/lib/middleware";
import u from "@/utils";
import { translateError, translateMessage, validationOptions } from "@/lib/i18n";

const textPart = z.object({ type: z.literal("text"), text: z.string(), textSignature: z.string().optional() });
const imagePart = z.object({ type: z.literal("image"), data: z.string(), mimeType: z.string().startsWith("image/") });
const messageSchema: z.ZodType<Message> = z.discriminatedUnion("role", [
  z.object({
    role: z.literal("user"), content: z.union([z.string(), z.array(z.union([textPart, imagePart])).max(1000)]),
    timestamp: z.number().nonnegative(),
  }),
  z.looseObject({
    role: z.literal("assistant"),
    content: z.array(z.discriminatedUnion("type", [
      textPart,
      z.object({ type: z.literal("thinking"), thinking: z.string(), thinkingSignature: z.string().optional(), redacted: z.boolean().optional() }),
      z.object({
        type: z.literal("toolCall"), id: z.string().min(1), name: z.string().min(1), arguments: z.record(z.string(), z.json()),
        thoughtSignature: z.string().optional(), namespace: z.string().optional(),
      }),
    ])).max(1000),
    api: z.string().min(1), provider: z.string().min(1), model: z.string().min(1), timestamp: z.number().nonnegative(),
    stopReason: z.enum(["pending", "stop", "length", "toolUse", "error", "aborted", "deferred"]),
    usage: z.looseObject({
      input: z.number().nonnegative(), output: z.number().nonnegative(), cacheRead: z.number().nonnegative(), cacheWrite: z.number().nonnegative(),
      totalTokens: z.number().nonnegative(),
      cost: z.object({ input: z.number(), output: z.number(), cacheRead: z.number(), cacheWrite: z.number(), total: z.number() }),
    }),
  }),
  z.looseObject({
    role: z.literal("toolResult"), toolCallId: z.string().min(1), toolName: z.string().min(1),
    content: z.array(z.union([textPart, imagePart])).max(1000), isError: z.boolean(), timestamp: z.number().nonnegative(),
  }),
]);

const contextSchema: z.ZodType<Context> = z.object({
  systemPrompt: z.string().max(100000).optional(),
  messages: z.array(messageSchema).min(1).max(2000),
  tools: z.array(z.object({
    name: z.string().regex(/^[a-z][a-zA-Z0-9]{0,63}$/),
    description: z.string().min(1).max(10000),
    parameters: z.record(z.string(), z.json()).refine(value => value.type === "object" && JSON.stringify(value).length <= 100000, "工具参数必须是 JSON 对象结构，且不超过 100 KB"),
    constrainedSampling: z.union([
      z.literal(false),
      z.object({ type: z.literal("json_schema"), strict: z.enum(["prefer", "require"]) }),
      z.object({ type: z.literal("grammar"), variants: z.object({ openai_lark: z.string().optional(), openai_regex: z.string().optional() }) }),
    ]).optional(),
  })).max(32).refine(tools => new Set(tools.map(tool => tool.name)).size === tools.length, "工具名称不能重复").optional(),
}).refine(context => Buffer.byteLength(JSON.stringify(context)) <= 8000000, "模型上下文不能超过 8 MB");

const inputSchema = z.object({
  providerId: z.string().min(1), modelId: z.string().min(1),
  context: contextSchema,
  directory: z.string().min(1).max(4096).optional(),
  references: z.array(u.ai.aiReferenceSchema).max(32).optional(),
  // ACT: 必须声明 runId，否则 Zod 会静默 strip，stop 路由永远找不到这个 run。
  runId: z.uuid().optional(),
});

export default Router().post("/", validateFields(inputSchema.shape), async (req, res) => {
  const input = inputSchema.parse(req.body, validationOptions());
  const runId = input.runId;
  const controller = new AbortController();
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const close = () => {
    clearInterval(heartbeat);
    // 正常结束后 res.end() 也会触发 close，只在真正断线时记一条。
    if (!res.writableEnded) console.log(`[ai.generate] socket close runId=${runId ?? "-"}`);
    controller.abort();
  };
  res.once("close", close);
  req.once("aborted", close);
  // ACT: 兼容不同运行时的关闭事件；Bun 1.3.14 的静默 SSE 仍可能不通知，不能保证立即停止上游。
  req.socket.once("close", close);
  try {
    // 同步注册，早于本请求的任何 await，stop 路由才能命中；命中墓碑时 register 内部会立即 abort。
    if (runId) {
      u.aiRuns.registerRun(runId, controller);
      controller.signal.addEventListener("abort", () => {
        if (!res.writableEnded) console.log(`[ai.generate] run abort runId=${runId}`);
      }, { once: true });
    }
    const configured = u.ai.getConfiguredModel(input.providerId, input.modelId);
    const directory = input.references?.some(item => item.dataType !== "STRING")
      ? await u.workspace.resolveWorkspace(req, input.directory ?? "") : undefined;
    const references = await u.ai.readAiReferences(directory, input.references ?? [], controller.signal, configured.provider);
    const stream = u.ai.streamAi(configured, input.context, controller.signal, references);
    res.set({ "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" });
    res.flushHeaders();
    heartbeat = setInterval(() => {
      if (!res.destroyed && !res.writableEnded && !res.writableNeedDrain) res.write(": keepalive\n\n");
    }, 20000);
    heartbeat.unref();
    const send = (event: object) => { if (!res.destroyed && !res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`); };
    try {
      for await (const event of stream) {
        if (event.type === "text_delta" || event.type === "thinking_delta") {
          send({ type: event.type === "text_delta" ? "text" : "reasoning", delta: event.delta });
        }
      }
      const message = await stream.result();
      if (message.stopReason === "error" || message.stopReason === "aborted") throw new Error(message.errorMessage || "模型请求失败");
      send({ type: "done", message });
    } catch (error) {
      // 用户停止时不再发 error 事件，直接结束响应即可。
      if (controller.signal.aborted) console.log(`[ai.generate] stream ended by abort runId=${runId ?? "-"}`);
      else send({ type: "error", message: error instanceof Error ? translateError(error) : translateMessage("模型请求失败") });
    } finally {
      if (!res.writableEnded) res.end();
    }
  } catch (error) {
    // 未发 SSE 头时这里是干净的 200 空响应；已发头也能直接结束。其它错误照常抛出。
    if (!controller.signal.aborted) throw error;
    console.log(`[ai.generate] stream ended by abort runId=${runId ?? "-"}`);
    if (!res.writableEnded) res.end();
  } finally {
    clearInterval(heartbeat);
    res.off("close", close);
    req.off("aborted", close);
    req.socket.off("close", close);
    // 正常、异常、停止都要回收，避免活跃 run 泄漏。
    if (runId) u.aiRuns.detachRun(runId, controller);
  }
});
