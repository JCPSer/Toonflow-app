import { dirname, join } from "node:path";
import { mkdir, rm } from "@toonflow/file";
import { t } from "@/lib/i18n";
import { createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import type { AgentSession, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { QuestionContext } from "@toonflow/tools-scaffold/runtime";
import {
  agentLog, configureAgentRequests, createAgentModel, createAgentToolContext, getToolResultText, question,
} from "@/agentRuntime";
import { listTools, loadTool, validateToolConfig } from "@/modules/pluginMarket/plugins/tools";
import { browserRuntime } from "@/modules/agentAccess/browser";
import conf from "@/modules/platformCore/conf";
import type { ThinkingLevel } from "@/lib/modelReasoning";
import type { SingleAgentEvent, SingleAgentResult, SingleAgentStatus, SingleAgentToolDescriptor, SingleAgentToolReference, SingleAgentToolResult } from "./types";

type ClientCall = {
  finish(result: SingleAgentToolResult | Error): void;
  onUpdate?: Parameters<ToolDefinition["execute"]>[3];
};
type RunState = {
  id: string;
  controller: AbortController;
  session?: AgentSession;
  status: SingleAgentStatus;
  pauseRequested: boolean;
  activeActions: number;
  gate?: ReturnType<typeof Promise.withResolvers<void>>;
  finished: ReturnType<typeof Promise.withResolvers<void>>;
  send(event: SingleAgentEvent): void;
  questions?: ReturnType<typeof question.createQuestionContext>;
  questionIds: Set<string>;
  clientCalls: Map<string, ClientCall>;
};
type SingleSession = {
  id: string;
  cwd: string;
  workspaceAvailable: boolean;
  history: SessionManager;
  systemPrompt: string;
  tools: ToolDefinition[];
  active?: RunState;
  closed: boolean;
  closing?: Promise<void>;
};

// ACT: 临时对话只保存在当前进程内，关闭后销毁；多进程部署需共享会话及回调通道。
const sessions = new Map<string, SingleSession>();

// 客户端工具回传丢失时会一直挂到整轮被中止；硬超时只兜这种异常，静态检查实际只需毫秒级。
const CLIENT_TOOL_TIMEOUT_MS = 600_000;

// ACT: 中止原因必须原样透传，否则工具结果只有「已取消」，用户与模型都无法判断是关闭对话、停止回复还是断网。
function abortDetail(signal?: AbortSignal) {
  const reason: unknown = signal?.reason;
  const detail = reason instanceof Error ? reason.message : typeof reason === "string" ? reason : "";
  return detail.replace(/\s+/g, " ").trim().slice(0, 200);
}

function clientToolAbortError(signal?: AbortSignal) {
  const detail = abortDetail(signal);
  return Object.assign(new Error(detail ? `工具调用被中止：${detail}` : "工具调用被中止：对话已关闭或已停止"), { code: "TOOL_ABORTED" });
}

function getSession(sessionId: string) {
  const session = sessions.get(sessionId);
  if (!session || session.closed) throw Object.assign(new Error("临时对话不存在或已关闭"), { status: 404 });
  return session;
}

function setStatus(active: RunState, status: SingleAgentStatus) {
  if (active.status === status) return;
  active.status = status;
  active.send({ type: "status", status });
}

function finishAction(active: RunState) {
  active.activeActions--;
  if (active.pauseRequested && !active.activeActions && !active.controller.signal.aborted) setStatus(active, "paused");
}

async function waitForResume(active: RunState) {
  const signal = active.controller.signal;
  signal.throwIfAborted();
  if (!active.pauseRequested) return;
  if (!active.activeActions) setStatus(active, "paused");
  active.gate ??= Promise.withResolvers<void>();
  const gate = active.gate;
  const abort = () => gate.reject(signal.reason);
  signal.addEventListener("abort", abort, { once: true });
  try { await gate.promise; signal.throwIfAborted(); }
  finally { signal.removeEventListener("abort", abort); }
}

function createClientTool(session: SingleSession, descriptor: SingleAgentToolDescriptor): ToolDefinition {
  return {
    ...descriptor,
    label: descriptor.label || descriptor.name,
    executionMode: descriptor.executionMode ?? "sequential",
    async execute(toolCallId, args, signal, onUpdate) {
      const active = session.active;
      if (!active || session.closed) throw new Error("临时对话已结束");
      signal?.throwIfAborted();
      const callId = crypto.randomUUID();
      const startedAt = Date.now();
      agentLog("clientTool.dispatch", { session: session.id, run: active.id, callId, tool: descriptor.name,
        bytes: JSON.stringify(args ?? {}).length });
      return new Promise<SingleAgentToolResult>((resolve, reject) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const finish = (result: SingleAgentToolResult | Error) => {
          if (!active.clientCalls.delete(callId)) return;
          if (timer) clearTimeout(timer);
          signal?.removeEventListener("abort", abort);
          agentLog("clientTool.result", { session: session.id, run: active.id, callId, tool: descriptor.name,
            ms: Date.now() - startedAt, outcome: result instanceof Error ? result : "ok", controllerAborted: active.controller.signal.aborted });
          if (result instanceof Error) reject(result);
          else resolve(result);
        };
        const abort = () => finish(clientToolAbortError(signal));
        active.clientCalls.set(callId, { finish, onUpdate });
        signal?.addEventListener("abort", abort, { once: true });
        timer = setTimeout(() => finish(new Error(`客户端工具在 ${CLIENT_TOOL_TIMEOUT_MS / 1000} 秒内没有返回结果，已中止本次调用`)), CLIENT_TOOL_TIMEOUT_MS);
        active.send({ type: "clientTool", callId, toolCallId, name: descriptor.name, args: args as Record<string, unknown> });
      });
    },
  };
}

export async function create(options: {
  tools: (SingleAgentToolReference | SingleAgentToolDescriptor)[];
  directory?: string;
  systemPrompt?: string;
}, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const id = crypto.randomUUID();
  const cwd = options.directory ?? join(dirname(conf.path), "singleAgent", id);
  if (!options.directory) await mkdir(cwd, { recursive: true });
  const session: SingleSession = {
    id, cwd, workspaceAvailable: !!options.directory, history: SessionManager.inMemory(cwd),
    systemPrompt: options.systemPrompt ?? "", tools: [], closed: false,
  };
  sessions.set(id, session);
  try {
    const question: QuestionContext = { ask: (...args) => {
      const active = session.active;
      if (!active?.questions) throw new Error("临时对话未在运行");
      return active.questions.context.ask(...args);
    } };
    const context = createAgentToolContext(cwd, {}, undefined, question, session.workspaceAvailable);
    const available = new Map((await listTools()).map(tool => [tool.name, tool]));
    const names = new Set<string>();
    for (const reference of options.tools) {
      signal?.throwIfAborted();
      let definitions: ToolDefinition[];
      if (typeof reference !== "string" && "name" in reference) definitions = [createClientTool(session, reference)];
      else {
        const pluginName = typeof reference === "string" ? reference : reference.plugin;
        const info = available.get(pluginName);
        if (!info?.enabled) throw Object.assign(new Error(t`工具插件 ${pluginName} 未安装或未启用`), { status: 400 });
        if (info.loadError) throw new Error(info.loadError);
        const { plugin, metadata } = await loadTool(pluginName);
        definitions = await plugin.createTools({ ...context, config: validateToolConfig(plugin, info.config) });
        const selected = typeof reference === "string" ? undefined : reference.names;
        if (selected?.some(name => !definitions.some(tool => tool.name === name))) throw Object.assign(new Error(t`插件 ${pluginName} 未提供所选工具`), { status: 400 });
        definitions = definitions.filter(tool => !selected || selected.includes(tool.name)).map(tool => ({
          ...tool, promptGuidelines: [...(metadata.prompt ? [metadata.prompt] : []), ...(tool.promptGuidelines ?? [])],
        }));
      }
      for (const tool of definitions) {
        if (!tool.name || typeof tool.execute !== "function") throw new Error("插件返回了无效的工具");
        if (names.has(tool.name)) throw Object.assign(new Error(t`工具名称重复：${tool.name}`), { status: 400 });
        names.add(tool.name);
        session.tools.push(tool);
      }
    }
    signal?.throwIfAborted();
    return { sessionId: id };
  } catch (error) {
    await close(id);
    throw error;
  }
}

export async function run(options: {
  sessionId: string;
  runId: string;
  prompt: string;
  providerId: string;
  modelId: string;
  thinkingLevel?: ThinkingLevel;
}, send: (event: SingleAgentEvent) => void, signal?: AbortSignal, onStart?: () => void) {
  const state = getSession(options.sessionId);
  if (state.active) throw Object.assign(new Error("此对话正在运行，请等待当前回复完成"), { status: 409 });
  const active: RunState = {
    id: options.runId, controller: new AbortController(), status: "idle", pauseRequested: false, activeActions: 0,
    finished: Promise.withResolvers<void>(), send, questionIds: new Set(), clientCalls: new Map(),
  };
  state.active = active;
  const startedAt = Date.now();
  agentLog("run.start", { session: state.id, run: active.id, provider: options.providerId, model: options.modelId,
    tools: state.tools.map(tool => tool.name) });
  // ACT: 外部信号必须带上原始原因，否则客户端工具只能看到「已取消」，无法区分关闭对话、停止回复和断网。
  const abort = () => { active.controller.abort(signal?.reason ?? new Error("对话连接已关闭")); };
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  const stopSdk = () => { void active.session?.abort(); };
  active.controller.signal.addEventListener("abort", stopSdk, { once: true });
  active.controller.signal.addEventListener("abort", () => {
    agentLog("run.abort", { session: state.id, run: active.id, ms: Date.now() - startedAt,
      reason: active.controller.signal.reason, status: active.status });
  }, { once: true });
  const toolResults: SingleAgentResult["toolResults"] = [];
  const imageToolResults = new Map<string, SingleAgentToolResult>();
  try {
    onStart?.();
    setStatus(active, "running");
    active.controller.signal.throwIfAborted();
    active.questions = question.createQuestionContext(state.id, event => {
      active.questionIds.add(event.callId);
      send(event);
    }, () => active.controller.abort(new Error("用户取消了提问")));
    const tools = state.tools.map(tool => ({
      ...tool,
      async execute(...args: Parameters<ToolDefinition["execute"]>) {
        await waitForResume(active);
        active.activeActions++;
        const signal = args[2] ? AbortSignal.any([args[2], active.controller.signal]) : active.controller.signal;
        // ACT: 运行信号（SDK）与整轮控制器是两条独立信号，只有分别记录才能判断中止到底来自哪里。
        args[2]?.addEventListener("abort", () => {
          if (active.controller.signal.aborted) return;
          agentLog("run.signal.abort", { session: state.id, run: active.id, tool: tool.name, reason: args[2]?.reason });
        }, { once: true });
        try {
          const result = await tool.execute(args[0], args[1], signal, args[3], args[4]);
          // 对外工具结果保留图片；会话内部由共享图片入口保存附件引用。
          if (result.content.some(part => part.type === "image")) imageToolResults.set(args[0], result);
          return result;
        }
        finally { finishAction(active); }
      },
    }));
    const { runtime, effectiveThinkingLevel } = await createAgentModel(options.providerId, options.modelId, options.thinkingLevel);
    active.controller.signal.throwIfAborted();
    const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
    const agentDir = join(state.cwd, ".agent");
    const systemPrompt = [...new Set([state.systemPrompt || "请根据用户要求完成当前任务，按需使用提供的工具。", ...tools.flatMap(tool => tool.promptGuidelines ?? [])])].filter(Boolean).join("\n\n");
    const resourceLoader = new DefaultResourceLoader({
      cwd: state.cwd, agentDir, settingsManager,
      noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
      systemPrompt: "", systemPromptOverride: () => systemPrompt, appendSystemPrompt: [],
    });
    await resourceLoader.reload();
    active.controller.signal.throwIfAborted();
    const { session } = await createAgentSession({
      cwd: state.cwd, agentDir, modelRuntime: runtime, model: runtime.getModel(options.providerId, options.modelId),
      thinkingLevel: effectiveThinkingLevel, sessionManager: state.history, settingsManager, resourceLoader,
      tools: tools.map(tool => tool.name), customTools: tools,
    });
    configureAgentRequests(session);
    active.session = session;
    active.controller.signal.throwIfAborted();
    const streamFunction = session.agent.streamFunction;
    session.agent.streamFunction = async (...args) => {
      await waitForResume(active);
      active.activeActions++;
      try {
        const stream = await streamFunction(...args);
        void stream.result().then(() => finishAction(active), () => finishAction(active));
        return stream;
      } catch (error) { finishAction(active); throw error; }
    };
    let messageIndex = 0;
    const toolBlocks = new Map<string, string>();
    session.subscribe(event => {
      if (event.type === "message_start" && event.message.role === "assistant") messageIndex++;
      if (event.type === "message_update") {
        const update = event.assistantMessageEvent;
        if ("contentIndex" in update) {
          const blockId = `${messageIndex}:${update.contentIndex}`;
          if (update.type === "text_start" || update.type === "thinking_start") send({ type: update.type === "text_start" ? "text" : "thinking", blockId, content: "" });
          if (update.type === "text_delta" || update.type === "thinking_delta") send({ type: update.type === "text_delta" ? "text" : "thinking", blockId, delta: update.delta });
          if (update.type === "text_end" || update.type === "thinking_end") send({ type: update.type === "text_end" ? "text" : "thinking", blockId, content: update.content, done: true });
          if (update.type === "toolcall_start" || update.type === "toolcall_end") {
            const part = update.type === "toolcall_end" ? update.toolCall : update.partial.content[update.contentIndex];
            if (part?.type === "toolCall") {
              toolBlocks.set(part.id, blockId);
              send({ type: "tool", blockId, tool: { id: part.id, name: part.name, args: part.arguments, status: "running" } });
            }
          }
        }
      }
      if (event.type === "message_end" && event.message.role === "assistant") event.message.content.forEach((part, index) => {
        const blockId = `${messageIndex}:${index}`;
        if (part.type === "text" || part.type === "thinking") send({ type: part.type, blockId, content: part.type === "text" ? part.text : part.thinking, done: true });
        if (part.type === "toolCall") {
          toolBlocks.set(part.id, blockId);
          send({ type: "tool", blockId, tool: { id: part.id, name: part.name, args: part.arguments, status: "running" } });
        }
      });
      if (event.type === "tool_execution_start" || event.type === "tool_execution_end" || event.type === "tool_execution_update") {
        const result = event.type === "tool_execution_end" ? event.result : event.type === "tool_execution_update" ? event.partialResult : undefined;
        send({ type: "tool", blockId: toolBlocks.get(event.toolCallId) ?? event.toolCallId, tool: {
          id: event.toolCallId, name: event.toolName, status: event.type === "tool_execution_end" ? active.controller.signal.aborted ? "interrupted" : event.isError ? "error" : "success" : "running",
          ...(event.type === "tool_execution_start" ? { args: event.args } : { result: getToolResultText(result!.content) }),
        } });
        if (event.type === "tool_execution_end") {
          const result = { id: event.toolCallId, name: event.toolName, result: event.isError ? event.result : imageToolResults.get(event.toolCallId) ?? event.result };
          imageToolResults.delete(event.toolCallId);
          toolResults.push(result);
          send({ type: "toolResult", ...result });
        }
      }
    });
    await session.prompt(options.prompt, { expandPromptTemplates: false });
    active.controller.signal.throwIfAborted();
    const reply = session.messages.findLast(message => message.role === "assistant");
    if (!reply || reply.role !== "assistant") throw new Error("模型未返回回复");
    if (reply.stopReason === "error" || reply.stopReason === "aborted") throw new Error(reply.errorMessage || "模型请求失败");
    if (reply.stopReason === "length") throw new Error("模型回复因长度限制被截断，未能完整生成回答。");
    send({ type: "complete", text: reply.content.filter(part => part.type === "text").map(part => part.text).join("\n"), toolResults });
  } catch (error) {
    agentLog("run.failed", { session: state.id, run: active.id, ms: Date.now() - startedAt, aborted: active.controller.signal.aborted,
      reason: active.controller.signal.reason, error: error instanceof Error ? error : "临时对话执行失败" });
    send({ type: "error", message: active.controller.signal.aborted ? "本次回复已停止" : error instanceof Error ? error.message : "临时对话执行失败" });
  } finally {
    agentLog("run.end", { session: state.id, run: active.id, ms: Date.now() - startedAt });
    active.controller.signal.removeEventListener("abort", stopSdk);
    signal?.removeEventListener("abort", abort);
    active.questions?.dispose();
    for (const call of active.clientCalls.values()) call.finish(new Error("临时对话已结束"));
    try {
      if (active.session) {
        try { await active.session.abort(); }
        finally { active.session.dispose(); }
      }
    } finally {
      state.active = undefined;
      try { setStatus(active, "idle"); send({ type: "done" }); }
      finally { active.finished.resolve(); }
    }
  }
}

export async function control(sessionId: string, action: "pause" | "resume" | "stop" | "close", runId?: string) {
  // ACT: 前端只有这里能主动中止整轮，落日志才能区分「用户点了停止/关了对话框」与「服务端自己断的」。
  agentLog("control", { session: sessionId, action, runId });
  if (action === "close") { await close(sessionId); return { status: "idle" as const }; }
  const active = getSession(sessionId).active;
  if (!active) return { status: "idle" as const };
  if (active.id !== runId) throw Object.assign(new Error("当前回复已变化，控制请求已失效"), { status: 409 });
  if (action === "pause") {
    active.pauseRequested = true;
    setStatus(active, active.activeActions ? "pausing" : "paused");
  } else if (action === "resume") {
    active.pauseRequested = false;
    active.gate?.resolve();
    active.gate = undefined;
    setStatus(active, "running");
  } else {
    active.controller.abort(new Error("本次回复已停止"));
    await active.finished.promise;
    return { status: "idle" as const };
  }
  return { status: active.status };
}

export function toolResult(sessionId: string, callId: string, response: { result?: SingleAgentToolResult; error?: string; partial?: boolean }) {
  const call = getSession(sessionId).active?.clientCalls.get(callId);
  if (!call) throw Object.assign(new Error("工具调用不存在或已结束"), { status: 404 });
  if (response.partial) { if (response.result) call.onUpdate?.(response.result); return; }
  call.finish(response.error !== undefined ? new Error(response.error) : response.result!);
}

export function answer(sessionId: string, callId: string, response: Parameters<typeof question.answerQuestion>[2]) {
  const session = getSession(sessionId);
  if (!session.active?.questionIds.has(callId)) throw Object.assign(new Error("提问不属于此对话或已结束"), { status: 404 });
  const result = question.answerQuestion(session.id, callId, response);
  session.active.questionIds.delete(callId);
  return result;
}

export function getBrowserScope(sessionId: string, browserSessionId: string): string {
  const session = getSession(sessionId);
  if (!browserRuntime.hasOwner(session.cwd, session.history.getSessionId(), browserSessionId)) throw Object.assign(new Error("浏览器会话不属于此临时对话"), { status: 404 });
  return session.cwd;
}

export function assertWorkspaceBrowserAccess(browserSessionId: string) {
  // ACT: 临时对话数量由打开的弹窗决定；若未来支持大量常驻任务，改用浏览器会话到任务的索引。
  for (const session of sessions.values()) {
    if (browserRuntime.hasOwner(session.cwd, session.history.getSessionId(), browserSessionId)) throw Object.assign(new Error("请通过临时对话身份访问此浏览器"), { status: 403 });
  }
}

export async function close(sessionId: string) {
  const session = sessions.get(sessionId);
  if (!session) return;
  if (session.closing) return session.closing;
  session.closed = true;
  const active = session.active;
  agentLog("session.close", { session: sessionId, active: !!active });
  // ACT: 先给挂起的客户端工具最具体的原因，再中止整轮；否则 abort 监听器会抢先把它改写成通用中止原因。
  active?.questions?.dispose();
  if (active) for (const call of active.clientCalls.values()) call.finish(new Error("临时对话已关闭"));
  active?.controller.abort(new Error("临时对话已关闭"));
  session.closing = (async () => {
    try {
      try { await browserRuntime.closeOwner(session.cwd, session.history.getSessionId()); }
      finally { await active?.finished.promise; }
    } finally {
      sessions.delete(sessionId);
      // 仅清理 create 分配的私有目录，用户提供的工作区由用户管理。
      if (!session.workspaceAvailable) await rm(join(dirname(conf.path), "singleAgent", session.id), { recursive: true, force: true });
    }
  })();
  return session.closing;
}
