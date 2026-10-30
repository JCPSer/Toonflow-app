import { z } from "zod";
import { basename } from "node:path";
import { stat, unlink } from "@toonflow/file";
import {
  createAgentSession,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import type { CanvasContext, QuestionContext } from "@toonflow/tools-scaffold/runtime";
import { getAgentHost, type AgentHost } from "@/agent/host";
import type { AgentEvent, AgentMention, AgentToolCall } from "@/agent/runtime/types";
import { agentMentionsSchema, mentionPrompt, snapshotMentions, validateMentionTokens } from "@/agent/runtime/mentions";
import { createAgentTools } from "@/agent/tools";
import { createAgentResources, createAgentSettings } from "@/agent/runtime/resources";
import { createAgentModel, getAgentModelConfiguration } from "@/agent/runtime/model";
import { configureAgentRequests } from "@/agent/runtime/requests";
import { getAgentImageReference, getOffloadedImageText, readAgentImage } from "@/agent/runtime/imageAttachments";
import { createSubAgentTool } from "@/agent/tools/subAgent";
import { createMemoryTool } from "@/agent/tools/memory";
import { createReportTool } from "@/agent/tools/report";
import { runDelegatedAgent } from "@/agent/runtime/delegation";
import { forgetMicrocompactState, wasMicrocompacted } from "@/agent/runtime/requests";
import {
  agentAttachmentsSchema, agentNodeBindingSchema, appendAgentNodeMarker, getActiveAgentSession, getAgentContext, getAgentStats,
  getParentSessionFile, getSubAgentInfo, getToolResultText, hasPendingAgentQuestion, pruneAgentSessionFile, registerAgentSession, updateSubAgent,
  type ActiveAgentSession, type AgentNodeBinding,
} from "@/agent/runtime/sessions";
import type { ThinkingLevel } from "@toonflow/formats/modelReasoning";

type AgentOptions = {
  prompt: string;
  attachments?: z.infer<typeof agentAttachmentsSchema>;
  mentions?: AgentMention[];
  cwd: string;
  providerId: string;
  modelId: string;
  thinkingLevel?: ThinkingLevel;
  sessionFile?: string;
  resendFrom?: string;
  nodeBinding?: AgentNodeBinding;
  canvas?: CanvasContext;
  question?: QuestionContext;
  signal?: AbortSignal;
  onCancel?: () => void;
};

export async function run(
  {
    prompt,
    attachments = [],
    mentions = [],
    cwd,
    providerId,
    modelId,
    thinkingLevel,
    sessionFile,
    resendFrom,
    nodeBinding,
    canvas,
    question,
    signal,
    onCancel,
  }: AgentOptions,
  send: (event: AgentEvent) => void
) {
  const host = getAgentHost();
  attachments = agentAttachmentsSchema.parse(attachments);
  mentions = agentMentionsSchema.parse(mentions);
  nodeBinding = nodeBinding ? agentNodeBindingSchema.parse(nodeBinding) : undefined;
  validateMentionTokens(prompt, mentions);
  if (!prompt.trim() && !attachments.length && !mentions.length) throw Object.assign(new Error("请输入消息、提及或添加附件"), { status: 400 });
  getAgentModelConfiguration(providerId, modelId, thinkingLevel);
  const attachmentContents: (z.infer<typeof agentAttachmentsSchema>[number] & { content?: string })[] = [];
  for (const attachment of attachments) {
    const { path } = await host.workspace.resolveWorkspacePath(cwd, attachment.path);
    const info = await stat(path);
    if (!info.isFile() || !info.size || info.size > 100 * 1024 * 1024) {
      throw Object.assign(new Error("附件必须是工作区内非空且不超过 100 MB 的文件"), { status: 400 });
    }
    // ACT: 附件也只给指针，不再把纯文本全文塞进上下文——与引用同口径，统一由模型按需 read。
    attachmentContents.push(attachment);
  }
  if (resendFrom && !sessionFile) throw Object.assign(new Error("重发需要指定原对话"), { status: 400 });
  signal?.throwIfAborted();
  const { path: sessionsDir } = await host.workspace.resolveWorkspacePath(cwd, ".agent/sessions", true);
  const sessionPath = sessionFile ? (await host.workspace.resolveWorkspacePath(sessionsDir, sessionFile)).path : undefined;
  const active = sessionPath ? getActiveAgentSession(sessionPath) : undefined;
  if (active && hasPendingAgentQuestion(active)) {
    // ACT: 新消息结束旧提问，必须等旧执行释放文件锁后再继续，避免并发写入同一会话。
    await active.abort();
    signal?.throwIfAborted();
  } else if (active) {
    if (!getParentSessionFile(active.history)) throw Object.assign(new Error("对话正在运行，请等待回复完成"), { status: 409 });
    if (resendFrom) throw Object.assign(new Error("子 Agent 运行时不能重发历史消息"), { status: 409 });
    if (!active.session?.isStreaming) throw Object.assign(new Error("子 Agent 正在准备或结束回复，请稍后发送"), { status: 409 });
    if (attachments.length || mentions.length) throw Object.assign(new Error("请等子 Agent 当前回复结束后发送附件或提及"), { status: 400 });
    await active.session.prompt(prompt.trim(), { streamingBehavior: "steer", expandPromptTemplates: false });
    send({ type: "accepted" });
    return;
  }
  const { provider, runtime, effectiveThinkingLevel, model: configuredModel } = await createAgentModel(providerId, modelId, thinkingLevel);
  if (sessionPath) {
    const file = await stat(sessionPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") throw Object.assign(new Error("会话不存在，请重新打开对话"), { status: 404 });
      throw error;
    });
    if (!file.isFile()) throw Object.assign(new Error("会话必须是普通文件"), { status: 400 });
  }
  // ACT: SDK 新会话先分配文件名、首条回复才落盘；只锁所属文件，允许不同对话同时运行。
  const newHistory = sessionPath ? undefined : SessionManager.create(cwd, sessionsDir);
  const release = host.workspace.lockWorkspaceFiles([sessionPath ?? newHistory!.getSessionFile()!]);
  const controller = new AbortController();
  signal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  const finished = Promise.withResolvers<void>();
  let unregister = () => {};
  let mentionFiles: string[] = [];
  let messageAccepted = false;
  let sessionFilePath: string | undefined;
  let branchIds: string[] | undefined;
  try {
    const history = newHistory ?? SessionManager.open(sessionPath!, sessionsDir, cwd);
    sessionFilePath = history.getSessionFile() ?? undefined;
    const file = basename(history.getSessionFile()!);
    const parentFile = getParentSessionFile(history);
    const child = getSubAgentInfo(history)?.data;
    if (nodeBinding) {
      try {
        // 新会话此时已有文件名，标记会随首条回复一起落盘；已有标记的会话不重复写入。
        appendAgentNodeMarker(history, nodeBinding);
      } catch (error) {
        // ACT: 标记只服务历史过滤，写入失败不能阻断本轮对话。
        console.warn("[agent.nodeBinding] 节点会话标记写入失败", error);
      }
    }
    const liveTools = new Map<string, AgentToolCall>();
    const publish = send;
    send = event => {
      if (event.type === "tool") {
        const tool = { ...liveTools.get(event.tool.id), ...event.tool };
        if (tool.status !== "running") delete tool.question;
        liveTools.set(tool.id, tool);
      }
      publish(event);
    };
    const active: ActiveAgentSession = {
      history, send, tools: liveTools,
      entryOffset: history.getEntries().length,
      abort: () => { controller.abort(); onCancel?.(); return finished.promise; },
    };
    unregister = registerAgentSession(history.getSessionFile()!, active);
    const tools = await createAgentTools(cwd, canvas, question);
    if (host.personalization.isMemoryEnabled()) {
      const memoryTool = createMemoryTool();
      if (tools.some(tool => tool.name === memoryTool.name)) throw new Error("工具名称 memory 已被内置全局记忆工具占用");
      tools.push(memoryTool);
    }
    if (parentFile && child) {
      if (tools.some(tool => tool.name === "report")) throw new Error("工具名称 report 已被内置上报工具占用");
      tools.push(createReportTool(cwd, parentFile, file, child.name, send));
    }
    tools.push(await createSubAgentTool({
      cwd, tools, canvas, modelRuntime: runtime, model: runtime.getModel(providerId, modelId), thinkingLevel: effectiveThinkingLevel,
      runTask: (name, task, taskSignal, onProgress) => runDelegatedAgent({
        cwd, parentFile: file, name, task, providerId, modelId, thinkingLevel, canvas, signal: taskSignal, send, onProgress, run,
      }),
    }));
    // ACT: 压缩阈值依赖模型窗口，必须先把模型配置带到设置里。
    const resources = await createAgentResources(cwd, tools, createAgentSettings(configuredModel.contextWindow, { maxOutputTokens: configuredModel.maxOutputTokens }), child
      ? `## 子 Agent 职责\n你正在执行委派任务：${JSON.stringify({ name: child.name, task: child.task })}。遵守当前工作区规则与授权，用户可以进入此子会话补充要求。重要进展与最终结论使用 report 上报父 Agent。`
      : "");
    const resendEntry = resendFrom ? history.getBranch().find((item) => item.id === resendFrom) : undefined;
    if (resendFrom && (resendEntry?.type !== "message" || resendEntry.message.role !== "user")) {
      throw Object.assign(new Error("重发消息不在当前对话中，请重新打开对话"), { status: 400 });
    }
    const savedMentions = resendFrom ? history.getBranch().findLast(entry => entry.type === "custom" && entry.customType === "toonflowUserMessage" && (entry.data as { messageId?: string })?.messageId === resendFrom) : undefined;
    const previousMentions = savedMentions?.type === "custom" ? agentMentionsSchema.safeParse((savedMentions.data as { mentions?: unknown })?.mentions) : undefined;
    const snapshots = await snapshotMentions(cwd, mentions, previousMentions?.success ? previousMentions.data : [], signal);
    mentionFiles = snapshots.created;
    mentions = agentMentionsSchema.parse(snapshots.mentions);
    const previous = history.buildSessionContext();
    if (previous.model && (previous.model.provider !== providerId || previous.model.modelId !== modelId))
      history.appendModelChange(providerId, modelId);
    if (previous.messages.length && previous.thinkingLevel !== effectiveThinkingLevel) history.appendThinkingLevelChange(effectiveThinkingLevel);
    history.appendCustomEntry("toonflowReasoning", { thinkingLevel: thinkingLevel ?? null });
    const { session } = await createAgentSession({
      cwd,
      ...resources,
      modelRuntime: runtime,
      model: runtime.getModel(providerId, modelId),
      thinkingLevel: effectiveThinkingLevel,
      sessionManager: history,
      tools: tools.map((tool) => tool.name),
      customTools: tools,
    });
    configureAgentRequests(session);
    active.session = session;

    const streamFunction = session.agent.streamFunction;
    session.agent.streamFunction = async (...args) => {
      const compacting = session.isCompacting;
      const stream = await streamFunction(...args);
      // ACT: 摘要落盘前拒绝空正文，压缩、重试和普通回复仍由 SDK 处理。
      if (compacting) {
        const response = await stream.result();
        if (response.stopReason === "stop" && !response.content.some(part => part.type === "text" && part.text.trim())) {
          throw new Error("模型返回了空摘要，已保留原上下文");
        }
      }
      return stream;
    };

    // ACT: 历史和本轮引用共用文件能力判断与协议转换，会话只保存工作区快照路径。
    const mediaContents = new Map<string, ReturnType<AgentHost["models"]["readAiReferences"]>>();
    const onPayload = session.agent.onPayload;
    session.agent.onPayload = async (payload, requestModel) => {
      const body = (await onPayload?.(payload, requestModel) ?? payload) as Record<string, unknown>;
      sendUserMessage();
      const imageReferences = new Map(history.getBranch().flatMap(entry => {
        const reference = entry.type === "custom" && entry.customType === "toonflowImageAttachment"
          ? getAgentImageReference({ type: "text", text: "", toonflowImage: entry.data }) : undefined;
        return reference ? [[reference.id, reference] as const] : [];
      }));
      const offloadedImages = new Set(history.getBranch().flatMap(entry => {
        const images = entry.type === "custom" && entry.customType === "toonflowImageOffload" ? (entry.data as { images?: unknown })?.images : undefined;
        return Array.isArray(images) ? images.filter((id): id is string => typeof id === "string") : [];
      }));
      const mediaMessages = new Map<string, { id: string; references: Parameters<AgentHost["models"]["readAiReferences"]>[1] }>();
      for (const entry of history.getBranch()) {
        if (entry.type !== "custom" || !["toonflowAttachments", "toonflowUserMessage"].includes(entry.customType)) continue;
        const parsed = z.object({ messageId: z.string(), attachments: agentAttachmentsSchema, mentions: agentMentionsSchema.optional() }).safeParse(entry.data);
        if (!parsed.success) continue;
        const references: Parameters<AgentHost["models"]["readAiReferences"]>[1] = [
          ...parsed.data.attachments.filter(item => item.mimeType.startsWith("video/")).map(item => ({ dataType: "VIDEO" as const, value: { url: item.path, mimeType: item.mimeType } })),
          ...(parsed.data.mentions ?? []).filter(item => ["IMAGE", "MASK", "VIDEO"].includes(item.dataType)).map(item => ({
            dataType: item.dataType === "VIDEO" ? "VIDEO" as const : "IMAGE" as const, value: item.value as { url: string; mimeType: string },
          })),
        ];
        const message = history.getEntry(parsed.data.messageId);
        if (!references.length || message?.type !== "message" || message.message.role !== "user") continue;
        const content = message.message.content;
        for (const part of typeof content === "string" ? [{ type: "text", text: content }] : content) {
          if (part.type === "text") mediaMessages.set(part.text, { id: entry.id, references });
        }
      }
      if (!mediaMessages.size) return body;
      const field = provider.protocol === "openai-responses" ? "input" : "messages";
      const textType = provider.protocol === "openai-responses" ? "input_text" : "text";
      const messages = body[field] as { role?: string; content?: string | { type: string; text?: string }[] }[];
      return { ...body, [field]: await Promise.all(messages.map(async message => {
        if (message.role !== "user") return message;
        const parts = typeof message.content === "string" ? [{ type: textType, text: message.content }] : message.content;
        if (!parts?.some(part => part.type === textType && mediaMessages.has(part.text ?? ""))) return message;
        const content = await Promise.all(parts.map(async (part, partIndex) => {
          const source = part.type === textType && part.text ? mediaMessages.get(part.text) : undefined;
          if (!source) return [part];
          const content = host.models.referenceContent(provider.protocol, part.text!, []);
          for (const [index, media] of source.references.entries()) {
            const id = `user:${source.id}:${partIndex}:${index}`;
            const saved = imageReferences.get(id);
            if (saved && offloadedImages.has(id)) {
              content.push({ type: textType, text: `{{ref ${index + 1}}}` });
              content.push({ type: textType, text: getOffloadedImageText(saved) });
              continue;
            }
            const key = saved ? saved.path : `${source.id}:${index}`;
            if (!mediaContents.has(key)) mediaContents.set(key, saved
              ? readAgentImage(cwd, saved, signal).then(image => [{ dataType: "IMAGE", value: `data:${image.mimeType};base64,${image.data}` }])
              : host.models.readAiReferences(cwd, [media], signal, provider));
            content.push(...host.models.referenceContent(provider.protocol, "", await mediaContents.get(key)!, index).slice(1).map(content =>
              ["image", "image_url", "input_image"].includes((content as { type: string }).type) ? { ...content, toonflowImageId: id } : content));
          }
          return content;
        }));
        return { ...message, content: content.flat() };
      })) };
    };

    const resumeLeafId = history.getLeafId();
    let userMessageId = history.getBranch().findLast((entry) => entry.type === "message" && entry.message.role === "user")?.id;
    function sendUserMessage() {
      const entry = history.getBranch().findLast((item) => item.type === "message" && item.message.role === "user");
      if (!entry || entry.id === userMessageId) return;
      userMessageId = entry.id;
      const firstMessage = !messageAccepted;
      messageAccepted = true;
      if (firstMessage && (attachments.length || mentions.length || prompt.trimStart().startsWith("/skill:"))) {
        history.appendCustomEntry("toonflowUserMessage", { messageId: entry.id, content: prompt.trim(), attachments, mentions });
        if (!history.getSessionName() && history.getBranch().filter((item) => item.type === "message" && item.message.role === "user").length === 1) {
          history.appendSessionInfo((prompt.trim().replace(/\{\{mention:([^{}]+)\}\}/g, (text, id: string) => {
            const mention = mentions.find(item => item.id === id);
            return mention ? `@${mention.label}` : text;
          }) || attachments[0]?.name || mentions[0]?.label || "新对话").slice(0, 60));
        }
      }
      const saved = history.getBranch().findLast(item => item.type === "custom" && item.customType === "toonflowUserMessage" && (item.data as { messageId?: string })?.messageId === entry.id);
      const original = saved?.type === "custom" ? saved.data as { content: string; attachments: z.infer<typeof agentAttachmentsSchema>; mentions?: AgentMention[] } : undefined;
      const content = entry.type === "message" && entry.message.role === "user" ? entry.message.content : "";
      send({ type: "userMessage", id: entry.id, content: original?.content ?? (typeof content === "string" ? content : getToolResultText(content)), attachments: original?.attachments, mentions: original?.mentions });
    }
    let firstTokenAt: number | undefined;
    let modelError: string | undefined;
    let limited = false;
    let compactionError: string | undefined;
    let messageIndex = 0;
    const toolBlocks = new Map<string, string>();
    const timing = { outputTokens: 0, decodeMs: 0 };
    session.subscribe((event) => {
      if (event.type === "compaction_start" || event.type === "compaction_end") {
        send({ type: "compaction", active: event.type === "compaction_start" });
        if (event.type === "compaction_end" && event.errorMessage) {
          compactionError = host.i18n.t`上下文压缩失败：${event.errorMessage}`;
        }
      }
      // ACT: 自动重试期间前端原本完全静默，透出后可以显示「正在重试（n/m）」。
      if (event.type === "auto_retry_start") {
        send({ type: "retry", attempt: event.attempt, maxAttempts: event.maxAttempts, delayMs: event.delayMs, errorMessage: event.errorMessage });
      }
      if (event.type === "message_start" && event.message.role === "assistant") {
        sendUserMessage();
        messageIndex++;
        firstTokenAt = undefined;
      }
      if (event.type === "message_update") {
        const update = event.assistantMessageEvent;
        if (update.type === "text_delta" || update.type === "thinking_delta" || update.type === "toolcall_delta") {
          if (update.delta) firstTokenAt ??= performance.now();
        }
        if ("contentIndex" in update) {
          const blockId = `${messageIndex}:${update.contentIndex}`;
          if (update.type === "text_start" || update.type === "thinking_start") {
            const part = update.partial.content[update.contentIndex];
            send({
              type: update.type === "text_start" ? "text" : "thinking",
              blockId,
              content: part?.type === "thinking" && part.redacted ? part.thinking : "",
            });
          }
          if (update.type === "text_delta" || update.type === "thinking_delta") {
            send({ type: update.type === "text_delta" ? "text" : "thinking", blockId, delta: update.delta });
          }
          if (update.type === "text_end" || update.type === "thinking_end") {
            send({ type: update.type === "text_end" ? "text" : "thinking", blockId, content: update.content, done: true });
          }
          if (update.type === "toolcall_start" || update.type === "toolcall_end") {
            const part = update.type === "toolcall_end" ? update.toolCall : update.partial.content[update.contentIndex];
            if (part?.type === "toolCall") {
              toolBlocks.set(part.id, blockId);
              send({ type: "tool", blockId, tool: { id: part.id, name: part.name, args: part.arguments, status: "running" } });
            }
          }
        }
      }
      if (event.type === "tool_execution_start" || event.type === "tool_execution_end") {
        const tool = { id: event.toolCallId, name: event.toolName };
        send({
          type: "tool",
          blockId: toolBlocks.get(event.toolCallId) ?? event.toolCallId,
          tool:
            event.type === "tool_execution_start"
              ? { ...tool, args: event.args, status: "running" }
              : { ...tool, status: event.isError ? "error" : "success", result: getToolResultText(event.result.content) },
        });
      }
      if (event.type === "tool_execution_update") {
        send({
          type: "tool",
          blockId: toolBlocks.get(event.toolCallId) ?? event.toolCallId,
          tool: { id: event.toolCallId, name: event.toolName, status: "running", result: getToolResultText(event.partialResult.content) },
        });
      }
      if (event.type === "message_end" && event.message.role === "assistant") {
        event.message.content.forEach((part, index) => {
          const blockId = `${messageIndex}:${index}`;
          if (part.type === "text" || part.type === "thinking") {
            send({ type: part.type, blockId, content: part.type === "text" ? part.text : part.thinking, done: true });
          } else if (part.type === "toolCall") {
            toolBlocks.set(part.id, blockId);
            send({ type: "tool", blockId, tool: { id: part.id, name: part.name, args: part.arguments, status: "running" } });
          }
        });
        if (firstTokenAt !== undefined && event.message.usage.output > 0) {
          const decodeMs = performance.now() - firstTokenAt;
          if (decodeMs > 0) {
            timing.outputTokens += event.message.usage.output;
            timing.decodeMs += decodeMs;
          }
        }
        firstTokenAt = undefined;
        modelError = event.message.stopReason === "error" ? event.message.errorMessage || "模型请求失败"
          : event.message.stopReason === "length" ? "模型回复因长度限制被截断，未能完整生成回答。" : undefined;
        limited = event.message.stopReason === "length";
        // ACT: 回复条目的 id 只有落盘后才有（SDK 先通知监听器、再 appendMessage），
        // 所以放到微任务里读刚追加的那条并发给前端。缺了它前端「复制为新会话」会一直是禁用态。
        const entryCount = history.getEntries().length;
        queueMicrotask(() => {
          const entry = history.getEntries().slice(entryCount).find(item => item.type === "message" && item.message.role === "assistant");
          if (entry) send({ type: "assistantEntry", id: entry.id });
        });
      }
      if (event.type === "message_end" || event.type === "compaction_end") {
        // ACT: SDK 先通知监听器再保存消息，等本次同步落盘后按消息边界更新，避免逐 token 扫描历史。
        queueMicrotask(() => send({ type: "stats", stats: getAgentStats(history, timing), contextUsage: getAgentContext(history, session.model?.contextWindow) }));
      }
    });
    const abort = () => {
      void session.abort();
    };
    signal?.addEventListener("abort", abort, { once: true });
    let failure: unknown;
    try {
      signal?.throwIfAborted();
      if (parentFile && child) {
        const agent = { ...child, file, parentFile, providerId, modelId, thinkingLevel, status: "running" as const, result: undefined };
        await updateSubAgent(cwd, parentFile, agent);
        send({ type: "subAgent", agent });
      }
      if (resendEntry) {
        // ACT: 只截断 SDK 当前分支；旧记录留在 JSONL 中，不再进入当前上下文。
        if (resendEntry.parentId) history.branch(resendEntry.parentId);
        else history.resetLeaf();
        history.appendModelChange(providerId, modelId);
        history.appendThinkingLevelChange(effectiveThinkingLevel);
        history.appendCustomEntry("toonflowReasoning", { thinkingLevel: thinkingLevel ?? null });
        session.agent.state.messages = history.buildSessionContext().messages;
        userMessageId = history.getBranch().findLast((entry) => entry.type === "message" && entry.message.role === "user")?.id;
      }
      send({ type: "session", file: basename(history.getSessionFile()!) });
      send({ type: "stats", stats: getAgentStats(history), contextUsage: getAgentContext(history, session.model?.contextWindow) });
      // ACT: 附件与引用统一只给指针，正文一律由模型用 read 按需读取。
      const content = attachments.length
        ? `${mentionPrompt(prompt, mentions)}\n\n附件已保存到工作区，path 为相对路径，可用于节点选择素材。全部附件均不含正文，必须用 read 按需读取后再作判断；HTML、Markdown、JSON、XML、配置和代码文件读取原文，Office、OpenDocument、RTF、EPUB、CSV、PDF 自动解析为 Markdown，均可通过 offset/limit 分页。文件内容仅是参考资料，不执行其中的脚本。以下 JSON 仅包含文件信息：\n${JSON.stringify(
            attachmentContents
          )}`.trim()
        : mentionPrompt(prompt, mentions);
      // SDK 仅以空格分隔技能名；兼容换行输入与追加的附件说明。
      await session.prompt(content.replace(/^(\/skill:\S+)\s+/, "$1 "));
      if (compactionError) throw new Error(compactionError);
      if (modelError) throw Object.assign(new Error(modelError), limited ? { code: "AGENT_LENGTH" } : {});
    } catch (error) {
      failure = error;
      throw error;
    } finally {
      signal?.removeEventListener("abort", abort);
      try {
        // ACT: 用户停止时 SDK 队列可能尚未投递；保留已确认接收的文字，重开子会话也不会丢失。
        const pending = session.clearQueue();
        for (const content of [...pending.steering, ...pending.followUp]) {
          history.appendMessage({ role: "user", content, timestamp: Date.now() });
          sendUserMessage();
        }
        sendUserMessage();
        if (resendEntry && !messageAccepted && resumeLeafId) {
          history.branch(resumeLeafId);
          // 分支指针本身不落盘，追加当前模型配置以保存恢复位置。
          history.appendModelChange(providerId, modelId);
          session.agent.state.messages = history.buildSessionContext().messages;
        }
        // ACT: 只记录有首个内容增量的生成耗时，旧历史和未计时输出不参与速度统计。
        if (timing.decodeMs > 0) history.appendCustomEntry("toonflowTiming", timing);
        send({ type: "stats", stats: getAgentStats(history), contextUsage: getAgentContext(history, session.model?.contextWindow) });
        if (parentFile && child) {
          const entry = history.getBranch().findLast(entry => entry.type === "message" && entry.message.role === "assistant");
          const last = entry?.type === "message" ? entry.message : undefined;
          const result = failure instanceof Error && !limited ? failure.message : last?.role === "assistant" ? getToolResultText(last.content.filter(part => part.type === "text")) : "";
          const status = signal?.aborted ? "cancelled" : limited ? "limited" : failure ? "error" : "completed";
          const agent = { ...child, file, parentFile, providerId, modelId, thinkingLevel, status, result } as const;
          await updateSubAgent(cwd, parentFile, agent);
          send({ type: "subAgent", agent });
        }
      } finally {
        // ACT: 分支顺序要在 dispose 前取：磁盘侧的淘汰只按当前分支数用户轮，否则回退/重发留下的旧分支会把边界往后推。
        branchIds = history.getBranch().map((entry) => entry.id);
        session.dispose();
      }
    }
  } finally {
    unregister();
    release();
    finished.resolve();
    // ACT: 磁盘侧淘汰放在释放锁之后、自己重新抢一把锁：抢不到（用户已经发下一条、会话正被删）就跳过，下次 run 再补。
    // 只有「这一轮真正发给模型的请求被 microcompact 裁过」才允许淘汰，否则模型下一轮还会看到这些原文。
    if (sessionFilePath && branchIds && wasMicrocompacted(sessionFilePath)) {
      try {
        const unlock = host.workspace.lockWorkspaceFiles([sessionFilePath]);
        try {
          await pruneAgentSessionFile(sessionFilePath, branchIds);
        } finally {
          unlock();
        }
      } catch (error) {
        console.warn("淘汰旧工具结果跳过", error);
      }
    }
    if (sessionFilePath) forgetMicrocompactState(sessionFilePath);
    if (!messageAccepted) await Promise.all(mentionFiles.map(path => unlink(path)));
  }
}

export * from "@/agent/runtime/sessions";
export { agentMentionsSchema } from "@/agent/runtime/mentions";
