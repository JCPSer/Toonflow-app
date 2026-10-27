import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { AssistantMessage, AssistantMessageEvent, ImageContent, Message, TextContent } from "@earendil-works/pi-ai";
import { estimateTokens, type AgentSession } from "@earendil-works/pi-coding-agent";
import { createHash, randomUUID } from "node:crypto";
import { getAgentImageReference, getOffloadedImageText, readAgentImage, saveAgentImage } from "@/agent/runtime/imageAttachments";
import { offloadToolContent } from "@/agent/runtime/toolOutput";
import { getAgentPreferences } from "@/agent/runtime/preferences";
import type { AgentImageReference } from "@/agent/runtime/imageAttachments";
import { getRequestFiles, type RequestFile } from "@/modules/mediaGeneration/ai/requestFiles";
import { createFileTransport, FileRequestLimitError } from "@/modules/mediaGeneration/ai/files";
import conf from "@/modules/platformCore/conf";
import { agentLog } from "@/lib/agentLog";

function contentHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

const MICROCOMPACT_CONTEXT_RATIO = 0.5;
const MICROCOMPACT_KEEP_TURNS = 3;
const MICROCOMPACT_MIN_CHARS = 400;
// 这些文本本身就是「指针」，再裁一次会让模型失去唯一的文件路径。
const KEEP_POINTER_TEXT = /\[输出过大|\.agent\/artifacts\/|图片已移出本次模型上下文|\[工具结果已裁剪/;

/**
 * ACT: 上下文超过模型窗口一半时，把最近 3 个用户轮以外的旧工具结果文本压成一行指针。
 * 裁剪边界按「用户轮」而不是「最近 N 条结果」固定，避免每轮滑动导致请求前缀变化、缓存失效。
 * 只改本次请求的副本：会话文件、UI 历史、图片块都保持原样；关闭自动压缩时不启用。
 */
function microCompactMessages(messages: Message[], contextWindow: number) {
  if (!Number.isFinite(contextWindow) || contextWindow <= 0) return messages;
  if (!getAgentPreferences().autoCompact) return messages;
  let boundary = 0;
  let users = 0;
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index].role !== "user") continue;
    if (++users > MICROCOMPACT_KEEP_TURNS) { boundary = index + 1; break; }
  }
  if (!boundary) return messages;
  const contextTokens = messages.reduce((total, message) => total + estimateTokens(message), 0);
  if (contextTokens <= contextWindow * MICROCOMPACT_CONTEXT_RATIO) return messages;
  let changed = false;
  const compacted = messages.map((message, index) => {
    if (index >= boundary || message.role !== "toolResult") return message;
    const toolName = typeof message.toolName === "string" ? message.toolName.trim() : "";
    if (!toolName) return message;
    // 错误结果往往很短且是关键线索，保留原文。
    if ((message as { isError?: boolean }).isError) return message;
    const texts = message.content.filter((part): part is TextContent => part.type === "text");
    if (!texts.length || texts.some(part => KEEP_POINTER_TEXT.test(part.text))) return message;
    const chars = texts.reduce((total, part) => total + part.text.length, 0);
    if (chars < MICROCOMPACT_MIN_CHARS) return message;
    let markerAdded = false;
    const content: (TextContent | ImageContent)[] = [];
    for (const part of message.content) {
      if (part.type !== "text") { content.push(part); continue; }
      // 多条文本合并成一个指针，非文本部分保留原位置顺序。
      if (markerAdded) continue;
      markerAdded = true;
      content.push({ type: "text", text: `[工具结果已裁剪：${toolName}，约 ${chars} 字符；需要时重新调用该工具，或用 read 分页读取相关文件]` });
    }
    changed = true;
    return { ...message, content };
  });
  return changed ? compacted : messages;
}

type AgentRequestLimits = { responseMs: number; idleMs: number; hardMs: number };
type TimeoutPhase = "response" | "idle" | "limit";

// ACT: 上游代理经常「连上但不吐字」；没有空闲判定时会一直等到用户手动停止。
const DEFAULT_AGENT_REQUEST_LIMITS: AgentRequestLimits = { responseMs: 180_000, idleMs: 120_000, hardMs: 1_800_000 };

function resolveAgentRequestLimits(): AgentRequestLimits {
  const agent = (conf.get("settings", {}) as { agent?: { requestTimeoutMs?: unknown; idleTimeoutMs?: unknown; requestHardLimitMs?: unknown } }).agent;
  const pick = (value: unknown, fallback: number) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.round(number)) : fallback;
  };
  return {
    responseMs: pick(agent?.requestTimeoutMs, DEFAULT_AGENT_REQUEST_LIMITS.responseMs),
    idleMs: pick(agent?.idleTimeoutMs, DEFAULT_AGENT_REQUEST_LIMITS.idleMs),
    hardMs: pick(agent?.requestHardLimitMs, DEFAULT_AGENT_REQUEST_LIMITS.hardMs),
  };
}

function timeoutMessage(phase: TimeoutPhase, seconds: number, visible: boolean) {
  // ACT: 已流出内容时重试会整轮重放并重复输出，因此终态文案不能命中 pi-ai 的可重试正则。
  if (visible) return phase === "limit"
    ? `本次回复超过 ${seconds} 秒上限，已中断并保留已生成内容`
    : `等待模型响应超时（${seconds} 秒无新内容），已保留已生成内容`;
  // ACT: 末尾英文关键词用于命中 pi-ai 的可重试判定，用户看到的是中文部分。
  return phase === "limit"
    ? `模型服务响应超过 ${seconds} 秒上限，已触发自动重试 [timeout]`
    : `模型服务 ${seconds} 秒无响应，已触发自动重试 [timeout]`;
}

// ACT: 单次请求的空闲看门狗。只中止本次尝试，不影响用户「停止」所用的全局 signal。
function createRequestGuard(limits: AgentRequestLimits) {
  const controller = new AbortController();
  const startedAt = Date.now();
  const state = { visible: false, phase: "response" as TimeoutPhase };
  let failure: Error | undefined;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let hardTimer: ReturnType<typeof setTimeout> | undefined;
  let rejectExpired: ((error: Error) => void) | undefined;
  const expired = new Promise<never>((_, reject) => { rejectExpired = reject; });
  expired.catch(() => {}); // 未被 race 时避免成为未处理的拒绝
  const stopIdle = () => { if (idleTimer) clearTimeout(idleTimer); idleTimer = undefined; };
  const trigger = (phase: TimeoutPhase) => {
    if (controller.signal.aborted) return;
    stopIdle();
    if (hardTimer) clearTimeout(hardTimer);
    hardTimer = undefined;
    state.phase = phase;
    const seconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
    failure = new Error(timeoutMessage(phase, seconds, state.visible));
    agentLog("model.request.timeout", { phase, seconds, visible: state.visible });
    rejectExpired?.(failure);
    controller.abort(failure);
  };
  const arm = (ms: number, phase: TimeoutPhase) => {
    stopIdle();
    if (!ms) return;
    idleTimer = setTimeout(() => trigger(phase), ms);
  };
  arm(limits.responseMs, "response");
  if (limits.hardMs) hardTimer = setTimeout(() => trigger("limit"), limits.hardMs);
  return {
    controller,
    state,
    /** 请求开始 → 首个流事件；拿到首事件后改用事件间隔计时。 */
    touch() { if (!controller.signal.aborted) arm(limits.idleMs, "idle"); },
    signal(extra?: AbortSignal | null) { return extra ? AbortSignal.any([extra, controller.signal]) : controller.signal; },
    race<T>(value: Promise<T>) { return Promise.race([value, expired]); },
    timedOut() { return failure; },
    dispose() { stopIdle(); if (hardTimer) clearTimeout(hardTimer); hardTimer = undefined; },
  };
}

type RequestGuard = ReturnType<typeof createRequestGuard>;

export function configureAgentRequests(session: AgentSession, limits?: { maxRequestImageBytes?: number; maxRequestBytes?: number }) {
  for (const value of Object.values(limits ?? {})) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) throw new Error("图片请求预算必须为正安全整数");
  }
  const history = session.sessionManager;
  const cwd = history.getCwd();
  const afterToolCall = session.agent.afterToolCall;
  let toolFailure: { error: unknown } | undefined;
  session.agent.afterToolCall = async (call, signal) => {
    try {
      const observationId = randomUUID();
      const content: (TextContent | ImageContent)[] = [];
      for (const [index, part] of call.result.content.entries()) {
        content.push(part.type === "image" ? await saveAgentImage(cwd, part, `tool:${observationId}:${index}`, signal) : part);
      }
      // ACT: 三个组合入口均禁用 Pi 扩展；先附件化再交原 hook，避免 SDK 二次缩放和重复尺寸说明。
      const previous = await afterToolCall?.({ ...call, result: { ...call.result, content } }, signal);
      const result: (TextContent | ImageContent)[] = [];
      for (const [index, part] of (previous?.content ?? content).entries()) {
        result.push(part.type === "image" ? await saveAgentImage(cwd, part, `hook:${observationId}:${index}`, signal) : part);
      }
      // ACT: 图片附件化完成后再处理文本，超长输出落盘并只留指针/预览；读取 artifacts 本身时跳过，避免读回来又被锁进预览。
      const readingArtifact = call.toolCall.name === "read" && JSON.stringify(call.toolCall.arguments ?? {}).includes(`/${"artifacts"}/`);
      return { ...previous, content: await offloadToolContent(cwd, call.toolCall.name, result, signal, { skip: readingArtifact }) };
    } catch (error) {
      if (!signal?.aborted) toolFailure = { error };
      throw error;
    }
  };

  const streamFunction = session.agent.streamFunction;
  session.agent.streamFunction = (model, context, options) => {
    const output = createAssistantMessageEventStream();
    void (async () => {
      let partial: AssistantMessage | undefined;
      const requestLimits = resolveAgentRequestLimits();
      let guard: RequestGuard | undefined;
      try {
        if (toolFailure) { const { error } = toolFailure; toolFailure = undefined; throw error; }
        const providers = conf.get("settings", {}).customProviders;
        const provider = Array.isArray(providers) ? providers.find(item => item?.id === model.provider) : undefined;
        // ACT: 取鉴权（含 OAuth 刷新）也可能挂住，计时从这一步就开始。
        guard = createRequestGuard(requestLimits);
        const auth = await session.modelRuntime.getAuth(model, { apiKey: options?.apiKey, env: options?.env, signal: guard.signal(options?.signal) });
        const apiKey = options?.apiKey ?? auth?.auth.apiKey;
        const files = createFileTransport({
          apiUrl: auth?.auth.baseUrl ?? model.baseUrl,
          apiKey: apiKey ?? "",
          protocol: model.api,
        }, { fetch: options?.fetch, signal: options?.signal });
        const maxRequestImageBytes = limits?.maxRequestImageBytes ?? provider?.maxRequestImageBytes ?? 20 * 1024 * 1024;
        const maxRequestBytes = limits?.maxRequestBytes ?? provider?.maxRequestBytes ?? 32 * 1024 * 1024;
        for (const value of [maxRequestImageBytes, maxRequestBytes]) {
          if (!Number.isSafeInteger(value) || value <= 0) throw new Error("图片请求预算必须为正安全整数");
        }
        const references = new Map<string, AgentImageReference>();
        const offloaded = new Set<string>();
        const invalidThinking = new Set<string>();
        const branch = history.getBranch();
        const messageEntries = new Map(branch.flatMap(entry => entry.type === "message" ? [[contentHash(entry.message), entry.id] as const] : []));
        for (const entry of branch) {
          if (entry.type !== "custom") continue;
          if (entry.customType === "toonflowImageAttachment") {
            const reference = getAgentImageReference({ type: "text", text: "", toonflowImage: entry.data });
            if (!reference) throw new Error("历史图片附件记录无效");
            references.set(reference.id, reference);
          }
          if (entry.customType === "toonflowImageOffload") {
            const data = entry.data as { images?: unknown; thinking?: unknown } | null;
            if (!data || !Array.isArray(data.images) || !data.images.every(id => typeof id === "string")
              || !Array.isArray(data.thinking) || !data.thinking.every(id => typeof id === "string")) throw new Error("历史图片卸载记录无效");
            for (const id of data.images) offloaded.add(id);
            for (const id of data.thinking) invalidThinking.add(id);
          }
        }
        const loaded = new Map<string, ImageContent>();
        async function readImage(reference: AgentImageReference) {
          if (!loaded.has(reference.path)) loaded.set(reference.path, await readAgentImage(cwd, reference, options?.signal));
          return loaded.get(reference.path)!;
        }
        function recordOffload(ids: string[]) {
          const images = ids.filter(id => !offloaded.has(id));
          const thinking = context.messages.filter(message => message.role === "assistant" && message.content.some(part => part.type === "thinking"))
            .map(contentHash).filter(key => !invalidThinking.has(key));
          if (!images.length && !thinking.length) return false;
          options?.signal?.throwIfAborted();
          history.appendCustomEntry("toonflowImageOffload", { images, thinking });
          for (const id of images) offloaded.add(id);
          for (const key of thinking) invalidThinking.add(key);
          return true;
        }
        function hasLaterAssistant(id: string) {
          const entryId = id.startsWith("user:") ? id.split(":")[1] : id.startsWith("legacy:") ? id.split(":")[1] : undefined;
          const index = branch.findIndex(entry => entry.id === entryId);
          return index >= 0 && branch.slice(index + 1).some(entry => entry.type === "message" && entry.message.role === "assistant");
        }
        let networkRecoveries = 0;
        for (;;) {
          options?.signal?.throwIfAborted();
          guard?.dispose();
          const attempt = createRequestGuard(requestLimits);
          guard = attempt;
          const imageQueue = new Map<string, AgentImageReference[]>();
          const messages: Message[] = [];
          for (const [messageIndex, message] of context.messages.entries()) {
            if (message.role === "assistant" || typeof message.content === "string") { messages.push(message); continue; }
            const content: (TextContent | ImageContent)[] = [];
            for (const [index, part] of message.content.entries()) {
              let reference = getAgentImageReference(part);
              if ("toonflowImage" in part && !reference) throw new Error("图片附件引用无效");
              if (part.type === "image") {
                const entryId = messageEntries.get(contentHash(message)) ?? contentHash(message);
                const id = `legacy:${entryId}:${index}`;
                reference = references.get(id);
                if (!reference) {
                  const saved = await saveAgentImage(cwd, part, id, options?.signal);
                  reference = saved.toonflowImage;
                  history.appendCustomEntry("toonflowImageAttachment", reference);
                  references.set(id, reference);
                  // 附件路径文本也改变历史前缀；首次迁移时退出旧 thinking 链，后续新 thinking 正常保留。
                  if (context.messages.slice(messageIndex + 1).some(item => item.role === "assistant")) recordOffload([]);
                }
              }
              if (!reference) { content.push(part); continue; }
              references.set(reference.id, reference);
              if (offloaded.has(reference.id)) {
                content.push({ type: "text", text: getOffloadedImageText(reference) });
                continue;
              }
              const image = await readImage(reference);
              const key = contentHash(image.data);
              imageQueue.set(key, [...(imageQueue.get(key) ?? []), reference]);
              const text = part.type === "text" ? part.text
                : `[图片附件：${reference.sourcePath}]${reference.note ? `\n${reference.note}` : ""}`;
              content.push({ type: "text", text }, image);
            }
            messages.push({ ...message, content });
          }
          const requestContext = {
            ...context,
            messages: messages.flatMap((message, index) => {
              if (message.role !== "assistant" || !invalidThinking.has(contentHash(context.messages[index]))) return [message];
              const content = message.content.filter(part => part.type !== "thinking");
              return content.length ? [{ ...message, content }] : [];
            }),
          };
          let restart = false;
          const rebuildRequest = new Error("图片上下文已调整，重新构建请求");
          let http413 = false;
          let fatalError: { error: unknown } | undefined;
          let activeImages: { reference: AgentImageReference; file: RequestFile }[] = [];
          function offloadBytes(target: number, count = 0, useFileBytes = false) {
            const ids: string[] = [];
            let removed = 0;
            let removedCount = 0;
            const sizes = new Map<string, { bytes: number; count: number }>();
            for (const image of activeImages) {
              const previous = sizes.get(image.reference.id) ?? { bytes: 0, count: 0 };
              sizes.set(image.reference.id, {
                bytes: previous.bytes + (useFileBytes ? image.reference.bytes : image.file.inlineBytes),
                count: previous.count + 1,
              });
            }
            for (const [id, size] of sizes) {
              if (offloaded.has(id) || !size.bytes) continue;
              ids.push(id);
              removed += size.bytes;
              removedCount += size.count;
              if (removed >= target && removedCount >= count) break;
            }
            if (!ids.length) return false;
            recordOffload(ids);
            return true;
          }
          const request = files.fetch;
          // ACT: microcompact 只作用于发给模型的副本，避免改动会话文件与 UI 历史。
          const requestMessages = microCompactMessages(requestContext.messages, model.contextWindow);
          const stream = await streamFunction(model, { ...requestContext, messages: requestMessages }, {
            ...options,
            apiKey,
            onPayload: async (payload, requestModel) => {
              try {
                const body = await options?.onPayload?.(payload, requestModel) ?? payload;
                const images = getRequestFiles(body).filter(file => file.mimeType.toLowerCase().startsWith("image/"));
                const imageCursors = new Map<string, number>();
                activeImages = [];
                for (const image of images) {
                  options?.signal?.throwIfAborted();
                  const imageKey = contentHash(image.data);
                  const cursor = imageCursors.get(imageKey) ?? 0;
                  let reference = image.id ? references.get(image.id) : imageQueue.get(imageKey)?.[cursor];
                  if (!image.id) imageCursors.set(imageKey, cursor + 1);
                  const fromContext = !image.id && Boolean(reference);
                  if (!reference) {
                    if (!image.id) throw new Error("onPayload 注入的图片必须提供稳定的 toonflowImageId，每次重新观察图片时使用新 ID");
                    const saved = await saveAgentImage(cwd, { type: "image", data: image.data, mimeType: image.mimeType }, image.id, options?.signal);
                    reference = saved.toonflowImage;
                    history.appendCustomEntry("toonflowImageAttachment", reference);
                    references.set(image.id, reference);
                    const fixed = await readImage(reference);
                    if ((fixed.data !== image.data || fixed.mimeType !== image.mimeType || reference.note) && hasLaterAssistant(image.id)) {
                      restart = recordOffload([]) || restart;
                    }
                  }
                  if (offloaded.has(reference.id)) { image.offload(getOffloadedImageText(reference)); continue; }
                  const fixed = await readImage(reference);
                  image.replace(fixed, fromContext ? undefined : reference.note);
                  activeImages.push({ reference, file: image });
                }
                if (restart) throw rebuildRequest;
                try { await files.prepare(body); }
                catch (error) {
                  // 文件 ID 只缩小 JSON；供应商仍限制图片总字节和张数，超限也按旧观察卸载。
                  if (error instanceof FileRequestLimitError && offloadBytes(error.excessBytes, error.excessCount, true)) {
                    restart = true;
                    throw rebuildRequest;
                  }
                  throw error;
                }
                const imageBytes = activeImages.reduce((sum, image) => sum + image.file.inlineBytes, 0);
                const bodyBytes = Buffer.byteLength(JSON.stringify(body), "utf8");
                // ACT: 上传后再计内联 base64 与 JSON；文件 ID 不再占用内联预算，超限仍卸载旧观察。
                if (imageBytes > maxRequestImageBytes || bodyBytes > maxRequestBytes) {
                  if (!offloadBytes(Math.max(imageBytes - maxRequestImageBytes, bodyBytes - maxRequestBytes))) {
                    throw new Error(`模型请求的非图片内容超过 ${maxRequestBytes} 字节预算，请压缩对话或减少附件内容后重试`);
                  }
                  restart = true;
                }
                if (restart) throw rebuildRequest;
                return body;
              } catch (error) {
                if (error !== rebuildRequest) fatalError = { error };
                throw error;
              }
            },
            fetch: Object.assign(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
              init?.signal?.throwIfAborted();
              const attemptSignal = attempt.signal(init?.signal);
              if (typeof init?.body === "string" && Buffer.byteLength(init.body, "utf8") > maxRequestBytes) {
                try {
                  restart = offloadBytes(Buffer.byteLength(init.body, "utf8") - maxRequestBytes);
                  if (!restart) fatalError = { error: new Error(`模型请求的非图片内容超过 ${maxRequestBytes} 字节预算，请压缩对话或减少附件内容后重试`) };
                } catch (error) { fatalError = { error }; }
                return new Response(JSON.stringify({ error: { message: "请求超过本地字节限制" } }), {
                  status: 413, headers: { "content-type": "application/json", "x-should-retry": "false" },
                });
              }
              // ACT: 工具或用户等待可能让代理关闭空闲连接；每轮重新握手，避免 Bun 复用失效 socket。
              const response = await request(input, { ...init, signal: attemptSignal, keepalive: false });
              if (response.status !== 413) return response;
              http413 = true;
              const headers = new Headers(response.headers);
              headers.set("x-should-retry", "false");
              return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
            }, request),
          });
          let visible = false;
          let start: AssistantMessageEvent | undefined;
          let retry = false;
          for await (const event of stream) {
            // ACT: 每收到一个事件就重置空闲计时；首事件之前一直按「响应超时」计。
            attempt.touch();
            if ("partial" in event) partial = event.partial;
            if (event.type === "start") { start = event; continue; }
            if (event.type === "error") {
              options?.signal?.throwIfAborted();
              if (attempt.timedOut()) throw attempt.timedOut();
              if (fatalError) throw fatalError.error;
              const imageBytes = activeImages.reduce((sum, image) => sum + image.file.inlineBytes, 0);
              if (!visible && (restart || (http413 && networkRecoveries < 4
                && offloadBytes(Math.max(1, networkRecoveries === 3 ? imageBytes : imageBytes / 2))))) {
                if (http413) networkRecoveries++;
                retry = true;
                break;
              }
            }
            if (start) { output.push(start); start = undefined; }
            output.push(event);
            visible = true;
            attempt.state.visible = true;
            if (event.type === "done" || event.type === "error") return;
          }
          if (retry) continue;
          if (attempt.timedOut()) throw attempt.timedOut();
          // ACT: 流被悄悄掐断时 result() 可能永不落地，用同一个看门狗兜底。
          const message = await attempt.race(stream.result());
          if (start) output.push(start);
          output.push(message.stopReason === "error" || message.stopReason === "aborted"
            ? { type: "error", reason: message.stopReason, error: message }
            : { type: "done", reason: message.stopReason as "stop" | "length" | "toolUse", message });
          return;
        }
      } catch (error) {
        const message: AssistantMessage = {
          role: "assistant", content: partial?.content ?? [], api: model.api, provider: model.provider, model: model.id,
          stopReason: options?.signal?.aborted ? "aborted" : "error",
          errorMessage: guard?.timedOut()?.message ?? (error instanceof Error ? error.message : String(error)),
          usage: partial?.usage ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
          timestamp: Date.now(),
        };
        output.push({ type: "error", reason: message.stopReason as "error" | "aborted", error: message });
      } finally {
        guard?.dispose();
        output.end();
      }
    })();
    return output;
  };
}
