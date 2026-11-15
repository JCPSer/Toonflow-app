import type { CanvasContext } from "@toonflow/tool-canvas/runtime";
import type { AgentEvent } from "@toonflow/server/agent/types";
import { readAgentEvents } from "@/components/agent/replyStream";
import type { AgentLink, AgentLinkStatus } from "./agentLinks";

/**
 * ACT: 同画布 Agent 派发调度器。
 * 服务端只下发 agentDispatch 意图；真正的排队、并发、画布调用、结果回传都在这里，
 * 复用现有 /api/agent 流与画布上下文，页面关闭即中断（明确不支持刷新后继续）。
 */

export type DispatchModel = { providerId: string; modelId: string; thinkingLevel?: string };
type DispatchEvent = Extract<AgentEvent, { type: "agentDispatch" }>;
type NodeLike = { id: string; type?: string; data?: Record<string, unknown> };

type Task = {
  taskId: string;
  kind: "task" | "result";
  depth: number;
  fromNodeId: string;
  toNodeId: string;
  fromSession?: string;
  toSession?: string;
  message: string;
  prompt: string;
  model?: DispatchModel;
  controller?: AbortController;
  stopped?: boolean;
};

export type AgentDispatcherOptions = {
  canvasId: () => string;
  directory: () => string | undefined;
  findNode: (nodeId: string) => NodeLike | undefined;
  updateNodeData: (nodeId: string, data: Record<string, unknown>) => void;
  getCanvasContext: () => CanvasContext | undefined;
  statuses: Record<string, string>;
  /** 关系层：派发/回传期间的可视化箭头，由画布宿主提供响应式数组。 */
  links?: AgentLink[];
  /** 面板桥：打开对应节点时用于镜像事件与提问。 */
  panel?: () => {
    applyExternalEvent?(nodeId: string, sessionFile: string, event: AgentEvent): void;
    questionsFor?(nodeId: string): void;
  } | undefined;
  onQuestions?: (nodeId: string, event: Extract<AgentEvent, { type: "question" }>) => void;
  onQuestionDone?: (nodeId: string, toolCallId: string) => void;
};

export const AGENT_DISPATCHER_KEY = Symbol.for("toonflow.agentDispatcher");

const MAX_RUNNING = 4;
const MAX_DEPTH = 8;
const DEDUPE_WINDOW_MS = 60_000;
const RESULT_MAX_CHARS = 8000;

const labelOf = (node: NodeLike | undefined, fallback: string) =>
  typeof node?.data?.label === "string" && node.data.label.trim() ? node.data.label.trim() : fallback;

function textOfMessage(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((part): part is { type: "text"; text: string } =>
    !!part && typeof part === "object" && (part as { type?: string }).type === "text" && typeof (part as { text?: string }).text === "string")
    .map(part => part.text).join("\n");
}

/** 结果回传前读取目标会话最后一条 assistant 文本；不做“读整个历史猜任务”的推断。 */
async function readLastAssistantText(directory: string, sessionFile: string, signal: AbortSignal): Promise<string> {
  // ACT: 会话读取和其他工作区接口一样需要 x-toonflow-workspace；缺了会 403，结果被误判成「没有文本」。
  const response = await fetch(`/api/agent/get?directory=${encodeURIComponent(directory)}&sessionFile=${encodeURIComponent(sessionFile)}`, {
    headers: { "x-toonflow-workspace": "1" }, signal,
  });
  if (!response.ok) return "";
  const body = await response.json().catch(() => null) as { data?: { messages?: { role?: string; content?: string; report?: unknown }[] } } | null;
  const messages = body?.data?.messages ?? [];
  // ACT: 一轮可能以工具调用收尾，最后一条 assistant 只有 toolCall；往前找最近一条真正带文本的回复。
  const lastUser = messages.findLastIndex(message => message.role === "user");
  const last = messages.slice(Math.max(0, lastUser + 1)).findLast(message =>
    message.role === "assistant" && !message.report && (message.content ?? "").trim());
  return (last?.content ?? "").slice(0, RESULT_MAX_CHARS);
}

async function readSessionModel(directory: string, sessionFile: string, signal: AbortSignal): Promise<DispatchModel | undefined> {
  const response = await fetch(`/api/agent/get?directory=${encodeURIComponent(directory)}&sessionFile=${encodeURIComponent(sessionFile)}`, {
    headers: { "x-toonflow-workspace": "1" }, signal,
  });
  if (!response.ok) return undefined;
  const body = await response.json().catch(() => null) as { data?: { providerId?: string; modelId?: string; thinkingLevel?: string } } | null;
  const providerId = body?.data?.providerId;
  const modelId = body?.data?.modelId;
  return providerId && modelId ? { providerId, modelId, thinkingLevel: body?.data?.thinkingLevel } : undefined;
}

export function createAgentDispatcher(options: AgentDispatcherOptions) {
  const queue: Task[] = [];
  const running = new Map<string, Task>();
  let disposed = false;
  const flashTimers = new Set<ReturnType<typeof setTimeout>>();
  const runningNodes = new Set<string>();
  const panelRunning = new Set<string>();
  const dedupe = new Map<string, number>();
  const pendingQuestions = new Map<string, Extract<AgentEvent, { type: "question" }>[]>();
  // ACT: 用户点停止后该节点要「粘住」，否则同节点排队任务或随后 finish 的结果会立刻把它拉起。
  // 只有用户在该面板里手动发送（notePanelRun true）才算继续。
  const pausedNodes = new Set<string>();

  const keyOf = (task: Pick<Task, "fromNodeId" | "toNodeId" | "message">) => `${task.fromNodeId}->${task.toNodeId}:${task.message}`;

  function setStatus(nodeId: string, status: string) {
    options.statuses[nodeId] = status;
  }

  function pushLink(link: Omit<AgentLink, "id" | "createdAt">) {
    if (!options.links || disposed) return;
    options.links.push({ ...link, id: crypto.randomUUID(), createdAt: Date.now() });
  }

  function updateLink(taskId: string, status: AgentLinkStatus) {
    const link = options.links?.find(item => item.taskId === taskId && item.kind === "dispatch");
    if (link) link.status = status;
  }

  function removeLink(taskId: string, kind: AgentLink["kind"]) {
    const links = options.links;
    if (!links) return;
    const index = links.findIndex(item => item.taskId === taskId && item.kind === kind);
    if (index >= 0) links.splice(index, 1);
  }

  /** ACT: 任务结束后箭头只保留一瞬间用于看结果色，然后从画布消失。 */
  function flashLink(taskId: string, kind: AgentLink["kind"], delayMs: number) {
    const timer = setTimeout(() => {
      flashTimers.delete(timer);
      removeLink(taskId, kind);
    }, delayMs);
    flashTimers.add(timer);
  }

  function isAgentNode(nodeId: string): { node: NodeLike; sessionFile?: string } | undefined {
    const node = options.findNode(nodeId);
    if (!node || node.type !== "remote-agentNode" || node.data?.disabled === true) return undefined;
    const sessionFile = typeof node.data?.agentSessionFile === "string" ? node.data.agentSessionFile : undefined;
    return { node, sessionFile };
  }

  function enqueueFromEvent(event: DispatchEvent) {
    if (!options.directory() || !options.canvasId()) return;
    // 服务端工具已按自身深度拦截过一次；这里再兜一层，防止旧客户端或手工事件绕过。
    if (event.depth + 1 > MAX_DEPTH) return;
    const target = isAgentNode(event.toNodeId);
    if (!target) return;
    if (event.toNodeId === event.fromNodeId) return;
    // 用户已停止该节点：派活不再入队，避免“停了又被拉起来”。
    if (pausedNodes.has(event.toNodeId)) return;
    const dedupeKey = keyOf({ fromNodeId: event.fromNodeId, toNodeId: event.toNodeId, message: event.message });
    const seen = dedupe.get(dedupeKey);
    const now = Date.now();
    if (seen && now - seen < DEDUPE_WINDOW_MS) return;
    dedupe.set(dedupeKey, now);
    // 清理过期键，避免长时间画布会话无限增长。
    for (const [key, at] of dedupe) if (now - at >= DEDUPE_WINDOW_MS) dedupe.delete(key);

    const fromNode = options.findNode(event.fromNodeId);
    const fromSession = event.fromSession || (typeof fromNode?.data?.agentSessionFile === "string" ? fromNode.data.agentSessionFile : undefined);
    pushLink({
      taskId: event.taskId, fromNodeId: event.fromNodeId, toNodeId: event.toNodeId,
      kind: "dispatch", status: "queued", message: event.message.slice(0, 300),
    });
    queue.push({
      taskId: event.taskId, kind: "task", depth: event.depth + 1,
      fromNodeId: event.fromNodeId, toNodeId: event.toNodeId,
      fromSession, toSession: target.sessionFile,
      message: event.message, model: event.model,
      prompt: `【来自 Agent「${labelOf(fromNode, event.fromNodeId)}」的任务 #${event.taskId}】\n${event.message}\n\n完成后直接把结果作为本轮回复，不要复述任务。`,
    });
    pump();
  }

  function enqueueResultTo(nodeId: string, sessionFile: string, model: DispatchModel | undefined, depth: number, text: string, taskId: string, status: string, fromLabel: string) {
    if (pausedNodes.has(nodeId)) return;
    queue.push({
      taskId: crypto.randomUUID(), kind: "result", depth,
      fromNodeId: nodeId, toNodeId: nodeId,
      toSession: sessionFile, message: text, model,
      prompt: `【Agent 任务结果】来自「${fromLabel}」的任务 #${taskId}，状态：${status}\n\n${text || "（对方没有返回文本结果）"}\n\n请基于这个结果继续当前工作；如需追派，再用 sendToAgent。`,
    });
    pump();
  }

  function canStart(task: Task) {
    return !pausedNodes.has(task.toNodeId) && !runningNodes.has(task.toNodeId) && !panelRunning.has(task.toNodeId);
  }

  function pump() {
    if (running.size >= MAX_RUNNING) return;
    for (let index = 0; index < queue.length && running.size < MAX_RUNNING; index++) {
      const task = queue[index]!;
      if (!canStart(task)) continue;
      if (!isAgentNode(task.toNodeId) && task.kind === "task") {
        // ACT: 目标节点被删/禁用后，排队任务丢弃时箭头也要一起收掉，否则会留一根永久虚线。
        removeLink(task.taskId, "dispatch");
        queue.splice(index--, 1);
        continue;
      }
      queue.splice(index--, 1);
      void runTask(task).catch(() => {});
    }
  }

  async function runTask(task: Task) {
    const directory = options.directory();
    const canvasId = options.canvasId();
    if (!directory || !canvasId) {
      // ACT: 画布/目录已不可用（切换项目/关闭实例），把排队的箭头收掉，别留一根灰线。
      updateLink(task.taskId, "failed");
      flashLink(task.taskId, "dispatch", 220);
      return;
    }
    const controller = new AbortController();
    task.controller = controller;
    running.set(task.taskId, task);
    runningNodes.add(task.toNodeId);
    setStatus(task.toNodeId, "thinking");
    updateLink(task.taskId, "running");
    let succeeded = false;
    let errorMessage = "";
    let sessionFile = task.toSession;
    const canvasContext = options.getCanvasContext();
    // 模型回退链：目标会话记录 → 节点上次选择（agentModel）→ 派发方模型。
    const nodeModel = options.findNode(task.toNodeId)?.data?.agentModel as DispatchModel | undefined;
    // ACT: 目标节点选了角色就按它的角色跑；服务端按 id 解析提示词。
    const nodeRole = options.findNode(task.toNodeId)?.data?.agentRoleId;
    const model = sessionFile
      ? (await readSessionModel(directory, sessionFile, controller.signal).catch(() => undefined)) ?? nodeModel ?? task.model
      : nodeModel ?? task.model;
    if (!model) {
      errorMessage = "目标 Agent 没有可用的模型，请先在它的面板里选择模型";
      finish(task, false, errorMessage);
      return;
    }
    try {
      const response = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-toonflow-workspace": "1" },
        body: JSON.stringify({
          prompt: task.prompt, directory,
          providerId: model.providerId, modelId: model.modelId,
          ...(model.thinkingLevel ? { thinkingLevel: model.thinkingLevel } : {}),
          ...(sessionFile ? { sessionFile } : {}),
          nodeBinding: { canvasId, nodeId: task.toNodeId },
          dispatchDepth: task.depth,
          ...(typeof nodeRole === "string" && nodeRole ? { roleId: nodeRole } : {}),
          ...(canvasContext ? { canvas: { id: canvasContext.id, tools: canvasContext.tools } } : {}),
        }),
        signal: controller.signal,
      });
      for await (const event of readAgentEvents(response, controller.signal)) {
        const live = event as AgentEvent;
        if (live.type === "session") {
          sessionFile = live.file;
          task.toSession = live.file;
          options.updateNodeData(task.toNodeId, { agentSessionFile: live.file, agentLastPrompt: task.prompt.slice(0, 120) });
          inject(task, live);
          continue;
        }
        if (live.type === "canvasCall") {
          await handleCanvasCall(task, live, canvasContext, controller.signal);
          continue;
        }
        if (live.type === "question") {
          const list = pendingQuestions.get(task.toNodeId) ?? [];
          list.push(live);
          pendingQuestions.set(task.toNodeId, list);
          options.onQuestions?.(task.toNodeId, live);
          inject(task, live);
          continue;
        }
        if (live.type === "tool" && live.tool.status !== "running") {
          const list = pendingQuestions.get(task.toNodeId) ?? [];
          const next = list.filter(item => item.toolCallId !== live.tool.id);
          if (next.length) pendingQuestions.set(task.toNodeId, next);
          else pendingQuestions.delete(task.toNodeId);
          options.onQuestionDone?.(task.toNodeId, live.tool.id);
        }
        if (live.type === "agentDispatch") {
          enqueueFromEvent(live);
          continue;
        }
        if (live.type === "error") errorMessage = live.message;
        if (live.type === "accepted" || live.type === "stats" || live.type === "done" || live.type === "userMessage") inject(task, live);
        else inject(task, live);
        if (live.type === "text" || live.type === "thinking" || live.type === "tool") setStatus(task.toNodeId, "running");
      }
      succeeded = true;
    } catch (error) {
      if (task.stopped || controller.signal.aborted) errorMessage = "已取消";
      else errorMessage = error instanceof Error ? error.message : "任务执行失败";
    }
    const result = succeeded && sessionFile && !controller.signal.aborted
      ? await readLastAssistantText(directory, sessionFile, new AbortController().signal).catch(() => "")
      : "";
    finish(task, succeeded && !controller.signal.aborted, errorMessage, result);
  }

  function finish(task: Task, ok: boolean, errorMessage: string, result = "") {
    // ACT: dispose 后 abort 触发的 finish 不能再往已清空的链接层、面板和父会话写东西。
    if (disposed) return;
    const status = task.stopped || task.controller?.signal.aborted ? "cancelled" : ok ? "completed" : "failed";
    task.controller?.abort();
    running.delete(task.taskId);
    runningNodes.delete(task.toNodeId);
    // ACT: 后台流被停止/失败时不会再收到服务端的 done；补一个终止事件让面板复位流式状态。
    inject(task, { type: "done" });
    setStatus(task.toNodeId, "idle");
    // ACT: 任务结束（含被取消）时要把残留提问提醒一起收掉，否则横幅会永远挂着。
    for (const question of pendingQuestions.get(task.toNodeId) ?? []) options.onQuestionDone?.(task.toNodeId, question.toolCallId);
    pendingQuestions.delete(task.toNodeId);
    // ACT: 派发箭头在结束时立刻退场，改用反向脉冲表示结果回到父节点。
    updateLink(task.taskId, status);
    flashLink(task.taskId, "dispatch", 220);
    if (task.fromSession) {
      pushLink({
        taskId: task.taskId, fromNodeId: task.toNodeId, toNodeId: task.fromNodeId,
        kind: "result", status, message: (result || errorMessage || "").slice(0, 300) || "已回传结果",
      });
      flashLink(task.taskId, "result", 1600);
      // ACT: 被用户停止的任务只给父会话留一条取消通知，不自动开新一轮，避免“停了又自己跑”。
      if (status === "cancelled") void deliverCancelNote(task);
      else enqueueResultTo(task.fromNodeId, task.fromSession, task.model, task.depth, result || errorMessage, task.taskId, status, labelOf(options.findNode(task.toNodeId), task.toNodeId));
      setStatus(task.fromNodeId, "waiting");
    }
    pump();
  }

  /** 派发任务被停止：把取消结果写进父会话并镜像到面板，但不触发父 Agent 运行。 */
  async function deliverCancelNote(task: Task) {
    const directory = options.directory();
    if (!directory || !task.fromSession) return;
    const label = labelOf(options.findNode(task.toNodeId), task.toNodeId);
    const content = `【Agent 任务结果】来自「${label}」的任务 #${task.taskId} 已被停止，没有新的输出。如需继续，请重新派发或直接给它发消息。`;
    try {
      const response = await fetch("/api/agent/note", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-toonflow-workspace": "1" },
        body: JSON.stringify({ directory, sessionFile: task.fromSession, content }),
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) return;
      const body = await response.json().catch(() => null) as { data?: { id?: string } } | null;
      const id = body?.data?.id;
      if (id) injectEvent(task.fromNodeId, task.fromSession, { type: "note", id, content });
    } catch { /* 写不进去时父节点保持等待输入，不影响停止本身 */ }
  }

  async function handleCanvasCall(task: Task, event: Extract<AgentEvent, { type: "canvasCall" }>, context: CanvasContext | undefined, signal: AbortSignal) {
    let body: string;
    try {
      if (!context) throw new Error("画布未打开，无法执行画布操作");
      const result = await context.call(event, signal, { canvasId: options.canvasId(), nodeId: task.toNodeId });
      body = JSON.stringify({ directory: options.directory(), callId: event.callId, result: result ?? null });
    } catch (error) {
      body = JSON.stringify({ directory: options.directory(), callId: event.callId, error: error instanceof Error ? error.message : "画布操作失败" });
    }
    await fetch("/api/agent/canvasResult", {
      method: "POST", headers: { "Content-Type": "application/json", "x-toonflow-workspace": "1" },
      body, signal: AbortSignal.timeout(5000),
    }).catch(() => {});
  }

  function injectEvent(nodeId: string, sessionFile: string, event: AgentEvent) {
    try { options.panel?.()?.applyExternalEvent?.(nodeId, sessionFile, event); }
    catch { /* 面板未挂载/会话不一致时忽略，任务本身继续 */ }
  }

  function inject(task: Task, event: AgentEvent) {
    injectEvent(task.toNodeId, task.toSession ?? "", event);
  }

  /** 面板开始/结束自己的用户请求；外部运行时 dispatcher 需等待。用户手动发送即视为继续，解除停止标记。 */
  function notePanelRun(nodeId: string, runningNow: boolean) {
    if (runningNow) {
      panelRunning.add(nodeId);
      pausedNodes.delete(nodeId);
    } else {
      panelRunning.delete(nodeId);
    }
    pump();
  }

  /** 用户停止某节点：清掉它的排队任务与去重记录、中断在跑的任务，并粘住该节点直到用户手动继续。 */
  function stop(nodeId: string) {
    let hit = false;
    for (let index = queue.length - 1; index >= 0; index--) {
      if (queue[index]!.toNodeId !== nodeId) continue;
      removeLink(queue[index]!.taskId, "dispatch");
      queue.splice(index, 1);
      hit = true;
    }
    for (const key of [...dedupe.keys()]) {
      if (key.startsWith(`${nodeId}->`) || key.includes(`->${nodeId}:`)) dedupe.delete(key);
    }
    for (const task of running.values()) {
      if (task.toNodeId !== nodeId) continue;
      task.stopped = true;
      task.controller?.abort();
      hit = true;
    }
    if (hit) pausedNodes.add(nodeId);
    return hit;
  }

  function replayQuestions(nodeId: string) {
    const sessionFile = typeof options.findNode(nodeId)?.data?.agentSessionFile === "string"
      ? options.findNode(nodeId)!.data!.agentSessionFile as string : "";
    for (const event of pendingQuestions.get(nodeId) ?? []) {
      try {
        // ACT: 面板刚打开时历史里还没有这条提问对应的工具调用；先补一个 running 工具块，提问卡片才能挂上去。
        options.panel?.()?.applyExternalEvent?.(nodeId, sessionFile, {
          type: "tool",
          blockId: `question:${event.toolCallId}`,
          tool: { id: event.toolCallId, name: "askUser", args: {}, status: "running" },
        });
        options.panel?.()?.applyExternalEvent?.(nodeId, sessionFile, event);
      } catch { /* 忽略 */ }
    }
  }

  function dispose() {
    disposed = true;
    for (const timer of flashTimers) clearTimeout(timer);
    flashTimers.clear();
    for (const task of running.values()) task.controller?.abort();
    running.clear();
    queue.length = 0;
    options.links?.splice(0, options.links.length);
  }

  return { enqueueFromEvent, notePanelRun, stop, replayQuestions, dispose, pendingQuestions };
}
