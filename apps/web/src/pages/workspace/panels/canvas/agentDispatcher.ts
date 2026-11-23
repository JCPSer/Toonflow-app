import { ref } from "vue";
import type { CanvasContext } from "@toonflow/tool-canvas/runtime";
import type { AgentEvent } from "@toonflow/server/agent/types";
import { resolveDispatchLimit } from "@toonflow/server/agent/dispatchLimits";
import { streamAgentRun } from "@/components/agent/agentRun";
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
  /** 去重键：任务结束时释放，允许同样的消息在上一轮完成后再发一次。 */
  dedupeKey?: string;
  /** 被打断的原因：写进原派发方的取消 note，面板/父 Agent 能看出不是用户停的。 */
  interruptReason?: string;
  /** ACT: 收尾只允许执行一次；打断与停止等路径可能同时到达，重复 finish 会重复写取消 note。 */
  finished?: boolean;
  /** 入队时间：排队面板显示等待时长，不参与调度。 */
  queuedAt: number;
};

/** 给 UI 的队列只读快照：Task 里有 AbortController 等不可渲染字段，不能让界面直接持有。 */
export type QueuedTaskView = {
  taskId: string;
  kind: Task["kind"];
  fromNodeId: string;
  fromLabel: string;
  toNodeId: string;
  toLabel: string;
  message: string;
  /** 完整文本，列表摘要用 message，悬停提示用 messageFull。 */
  messageFull: string;
  queuedAt: number;
  /** 当前为什么还没开始，直接给用户看。 */
  reason: string;
};

/** 队列的限时提示（替换/去重/撤销）。 */
export type QueueNotice = { id: string; text: string; at: number };

export type AgentDispatcherOptions = {
  canvasId: () => string;
  directory: () => string | undefined;
  findNode: (nodeId: string) => NodeLike | undefined;
  updateNodeData: (nodeId: string, data: Record<string, unknown>) => void;
  getCanvasContext: () => CanvasContext | undefined;
  statuses: Record<string, string>;
  /** 关系层：派发/回传期间的可视化箭头，由画布宿主提供响应式数组。 */
  links?: AgentLink[];
  /** 任务链深度上限（开发者设置）；缺省 8，与 sendToAgent 共用同一口径。 */
  maxDepth?: () => number;
  /** 面板桥：打开对应节点时用于镜像事件与提问。 */
  panel?: () => {
    applyExternalEvent?(nodeId: string, sessionFile: string, event: AgentEvent): void;
    questionsFor?(nodeId: string): void;
    /** 打断用户在面板里手动发起的运行；返回是否命中（面板没打开/没在跑时返回 false）。 */
    interruptRun?(nodeId: string, reason: string): boolean;
  } | undefined;
  onQuestions?: (nodeId: string, event: Extract<AgentEvent, { type: "question" }>) => void;
  onQuestionDone?: (nodeId: string, toolCallId: string) => void;
};

export const AGENT_DISPATCHER_KEY = Symbol.for("toonflow.agentDispatcher");

const MAX_RUNNING = 4;
const DEDUPE_WINDOW_MS = 60_000;
const RESULT_MAX_CHARS = 8000;
const QUEUE_MESSAGE_MAX = 160;
const MAX_QUEUE_NOTICES = 3;
const QUEUE_NOTICE_TTL_MS = 8000;

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

/** 发一次派发请求并把事件交给调用方；中断/忙错误由调用方决定是否重试。 */
async function postDispatchRequest(directory: string, body: Record<string, unknown>, signal: AbortSignal, onEvent: (event: AgentEvent) => void | Promise<void>) {
  // ACT: 与面板共用同一入口：默认走窗口级事件总线，6 个 Agent 并行时不再各占一条连接。
  for await (const event of streamAgentRun(body, { directory, signal })) await onEvent(event);
}

export function createAgentDispatcher(options: AgentDispatcherOptions) {
  const queue: Task[] = [];
  const running = new Map<string, Task>();
  /** 打断闸门：旧运行真正收尾前，该节点不允许启动新任务，否则会撞上服务端的重入检查。 */
  const preempting = new Map<string, Promise<void>>();
  let disposed = false;
  const flashTimers = new Set<ReturnType<typeof setTimeout>>();
  const runningNodes = new Set<string>();
  const panelRunning = new Set<string>();
  const dedupe = new Map<string, number>();
  /** ACT: 已投递过取消 note 的 taskId；打断、停止、排队撤销可能先后命中同一任务，note 只能写一次。 */
  const cancelNotedTaskIds = new Set<string>();
  /** 去重提示每个 seen 时间戳只发一次，避免 Agent 反复发同样内容时刷屏。 */
  const dedupeNoticeAt = new Map<string, number>();
  const pendingQuestions = new Map<string, Extract<AgentEvent, { type: "question" }>[]>();

  // ACT: 队列快照供画布队列面板渲染；只读，调度仍以内部 queue 为准。
  const queueView = ref<QueuedTaskView[]>([]);
  const queueNotices = ref<QueueNotice[]>([]);
  /** 按提示 id 记录定时器：提示被挤出上限时要一起清掉，否则定时器数量只增不减。 */
  const noticeTimers = new Map<string, ReturnType<typeof setTimeout>>();

  const keyOf = (task: Pick<Task, "fromNodeId" | "toNodeId" | "message">) => `${task.fromNodeId}->${task.toNodeId}:${task.message}`;

  function labelFor(nodeId: string) {
    return labelOf(options.findNode(nodeId), nodeId);
  }

  /** 队列为什么还没轮到：与 canStart/pump 的实际判定保持一致，否则用户会看到「空等」。 */
  function queueReason(task: Task) {
    if (preempting.has(task.toNodeId)) return "等待上一轮收尾";
    if (findRunningTask(task.toNodeId)) return "目标正在执行其他任务";
    if (panelRunning.has(task.toNodeId)) return "目标面板正在运行";
    if (running.size >= MAX_RUNNING) return "并发已满";
    return "等待调度";
  }

  function syncQueueView() {
    queueView.value = queue.map(task => ({
      taskId: task.taskId,
      kind: task.kind,
      fromNodeId: task.fromNodeId,
      fromLabel: labelFor(task.fromNodeId),
      toNodeId: task.toNodeId,
      toLabel: labelFor(task.toNodeId),
      message: task.message.slice(0, QUEUE_MESSAGE_MAX),
      messageFull: task.message,
      queuedAt: task.queuedAt,
      reason: queueReason(task),
    }));
  }

  function notifyQueue(text: string) {
    // ACT: dispose 之后流里仍可能冒事件，不能往已清空的提示区里写。
    if (disposed) return;
    const notice: QueueNotice = { id: crypto.randomUUID(), text, at: Date.now() };
    queueNotices.value = [...queueNotices.value, notice].slice(-MAX_QUEUE_NOTICES);
    const timer = setTimeout(() => {
      noticeTimers.delete(notice.id);
      queueNotices.value = queueNotices.value.filter(item => item.id !== notice.id);
    }, QUEUE_NOTICE_TTL_MS);
    noticeTimers.set(notice.id, timer);
    // 被挤出展示上限的提示不会再出现，定时器也要一并清掉。
    const visible = new Set(queueNotices.value.map(item => item.id));
    for (const [id, pending] of noticeTimers) {
      if (visible.has(id)) continue;
      clearTimeout(pending);
      noticeTimers.delete(id);
    }
  }

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
    if (disposed) return;
    if (!options.directory() || !options.canvasId()) return;
    // 服务端工具已按自身深度拦截过一次；这里再兜一层，防止旧客户端或手工事件绕过。
    // ACT: 优先用服务端随事件下发的上限——它是本次派发链捕获的快照，中途改设置也不会
    // 出现「服务端已受理、画布按新值丢弃」；老服务端/手工事件没有该字段时才读本地设置。
    const maxDepth = resolveDispatchLimit(event.maxDepth ?? options.maxDepth?.());
    if (event.depth + 1 > maxDepth) return;
    const target = isAgentNode(event.toNodeId);
    if (!target) return;
    if (event.toNodeId === event.fromNodeId) return;
    const dedupeKey = keyOf({ fromNodeId: event.fromNodeId, toNodeId: event.toNodeId, message: event.message });
    const seen = dedupe.get(dedupeKey);
    const now = Date.now();
    // ACT: 去重只拦「完全相同的消息」：这是防派发风暴，不是任务语义——
    // 同一 Agent 想改变对方正在做的事，就发一条内容不同的新指令，会走下面的打断分支。
    if (seen && now - seen < DEDUPE_WINDOW_MS) {
      // ACT: 静默吞消息最让人困惑（用户以为发了却没反应），同一个 seen 只提示一次。
      if (dedupeNoticeAt.get(dedupeKey) !== seen) {
        dedupeNoticeAt.set(dedupeKey, seen);
        notifyQueue(`「${labelFor(event.fromNodeId)} → ${labelFor(event.toNodeId)}」60 秒内重复的相同消息已忽略`);
      }
      return;
    }
    dedupe.set(dedupeKey, now);
    // 清理过期键，避免长时间画布会话无限增长。
    for (const [key, at] of dedupe) if (now - at >= DEDUPE_WINDOW_MS) dedupe.delete(key);
    for (const [key, at] of dedupeNoticeAt) if (now - at >= DEDUPE_WINDOW_MS) dedupeNoticeAt.delete(key);

    // ACT: 同一发送方对同一节点的旧排队消息只留最新一条；其他 Agent 的排队不动。
    let replaced = false;
    for (let index = queue.length - 1; index >= 0; index--) {
      const queued = queue[index]!;
      if (queued.kind !== "task" || queued.toNodeId !== event.toNodeId || queued.fromNodeId !== event.fromNodeId) continue;
      removeLink(queued.taskId, "dispatch");
      if (queued.dedupeKey) dedupe.delete(queued.dedupeKey);
      queue.splice(index, 1);
      replaced = true;
    }
    if (replaced) {
      notifyQueue(`「${labelFor(event.fromNodeId)} → ${labelFor(event.toNodeId)}」的旧排队消息已被同一 Agent 的新消息替换`);
    }

    const fromNode = options.findNode(event.fromNodeId);
    const fromSession = event.fromSession || (typeof fromNode?.data?.agentSessionFile === "string" ? fromNode.data.agentSessionFile : undefined);
    pushLink({
      taskId: event.taskId, fromNodeId: event.fromNodeId, toNodeId: event.toNodeId,
      kind: "dispatch", status: "queued", message: event.message.slice(0, 300),
    });
    const task: Task = {
      taskId: event.taskId, kind: "task", depth: event.depth + 1,
      fromNodeId: event.fromNodeId, toNodeId: event.toNodeId,
      fromSession, toSession: target.sessionFile,
      message: event.message, model: event.model, dedupeKey, queuedAt: Date.now(),
      prompt: `【来自 Agent「${labelOf(fromNode, event.fromNodeId)}」的任务 #${event.taskId}】\n${event.message}\n\n完成后直接把结果作为本轮回复，不要复述任务。`,
    };
    queue.push(task);

    // ACT: 打断规则——同一发送方的新消息硬打断它自己上一条；别的 Agent 的任务在跑时只排队。
    const runningTask = findRunningTask(event.toNodeId);
    if (runningTask) {
      if (runningTask.fromNodeId === event.fromNodeId) {
        preemptTask(runningTask, "被同一 Agent 的更新消息打断");
        moveToFront(task);
      }
    } else if (panelRunning.has(event.toNodeId)) {
      preemptPanel(event.toNodeId);
      moveToFront(task);
    }
    pump();
  }

  function findRunningTask(nodeId: string) {
    for (const task of running.values()) if (task.toNodeId === nodeId) return task;
    return undefined;
  }

  function moveToFront(task: Task) {
    const index = queue.indexOf(task);
    if (index > 0) {
      queue.splice(index, 1);
      queue.unshift(task);
    }
  }

  function enqueueResultTo(nodeId: string, sessionFile: string, model: DispatchModel | undefined, depth: number, text: string, taskId: string, status: string, fromLabel: string) {
    queue.push({
      taskId: crypto.randomUUID(), kind: "result", depth,
      fromNodeId: nodeId, toNodeId: nodeId,
      toSession: sessionFile, message: text, model, queuedAt: Date.now(),
      prompt: `【Agent 任务结果】来自「${fromLabel}」的任务 #${taskId}，状态：${status}\n\n${text || "（对方没有返回文本结果）"}\n\n请基于这个结果继续当前工作；如需追派，再用 sendToAgent。`,
    });
    pump();
  }

  function sessionFileOf(nodeId: string) {
    const file = options.findNode(nodeId)?.data?.agentSessionFile;
    return typeof file === "string" && file ? file : undefined;
  }

  /** 请求服务端打断并等它收尾；返回状态，方便调用方区分"没有会话"和"没退干净"。 */
  async function abortSession(sessionFile: string | undefined) {
    const directory = options.directory();
    if (!directory || !sessionFile) return "none" as const;
    try {
      const response = await fetch("/api/agent/abort", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-toonflow-workspace": "1" },
        body: JSON.stringify({ directory, sessionFile }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) return "timeout" as const;
      const body = await response.json().catch(() => null) as { data?: { result?: string } } | null;
      const result = body?.data?.result;
      return result === "finished" || result === "none" ? result : "timeout" as const;
    } catch {
      return "timeout" as const;
    }
  }

  async function waitTaskEnd(taskId: string, timeoutMs = 5_000) {
    const deadline = Date.now() + timeoutMs;
    while (running.has(taskId) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
  }

  /** 闸门：同一节点的打断工作串行执行，全部结束后才放开该节点。 */
  function holdNode(nodeId: string, work: () => Promise<void>) {
    const previous = preempting.get(nodeId) ?? Promise.resolve();
    const next = previous.then(work, work).catch(() => undefined).finally(() => {
      if (preempting.get(nodeId) === next) preempting.delete(nodeId);
      if (!disposed) pump();
    });
    preempting.set(nodeId, next);
  }

  /** 同一发送方的更新消息：硬打断旧任务，新任务插到队首。 */
  function preemptTask(task: Task, reason: string) {
    task.interruptReason = reason;
    const sessionFile = task.toSession ?? sessionFileOf(task.toNodeId);
    holdNode(task.toNodeId, async () => {
      task.controller?.abort();
      if (!sessionFile) {
        // 会话文件还没回写（刚起步），等本地任务释放即可，服务端会因连接断开自行中止。
        await waitTaskEnd(task.taskId);
        return;
      }
      const result = await abortSession(sessionFile);
      if (result === "timeout") await waitTaskEnd(task.taskId);
    });
  }

  /** 用户在面板里手动发起的运行：本地先停，再让服务端收尾；返回是否命中。 */
  function preemptPanel(nodeId: string) {
    const reason = "当前对话已被其他 Agent 的新消息打断";
    const sessionFile = sessionFileOf(nodeId);
    const hit = options.panel?.()?.interruptRun?.(nodeId, reason) ?? false;
    if (!hit && !sessionFile) return false;
    holdNode(nodeId, async () => {
      if (sessionFile) await abortSession(sessionFile);
      // 正常情况下面板 finally 会 notePanelRun(false)；等不到就强制放开闸门，避免节点永久卡住。
      const deadline = Date.now() + 3_000;
      while (panelRunning.has(nodeId) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
      if (panelRunning.has(nodeId) && !disposed) {
        panelRunning.delete(nodeId);
        setStatus(nodeId, "idle");
      }
    });
    return true;
  }

  function canStart(task: Task) {
    if (preempting.has(task.toNodeId)) return false;
    return !runningNodes.has(task.toNodeId) && !panelRunning.has(task.toNodeId);
  }

  function pump() {
    if (disposed) return;
    if (running.size >= MAX_RUNNING) {
      // ACT: 并发满了队列不会变，但「并发已满」这个原因刚成立，快照要跟上。
      syncQueueView();
      return;
    }
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
      void runTask(task).catch(() => {
        // ACT: 兜底释放。runTask 内部已用 finally 保证 finish；这里只防 finish 自身异常把节点永久卡住。
        if (!running.has(task.taskId)) return;
        running.delete(task.taskId);
        runningNodes.delete(task.toNodeId);
        setStatus(task.toNodeId, "idle");
        pump();
      });
    }
    syncQueueView();
  }

  async function runTask(task: Task) {
    const directory = options.directory();
    const canvasId = options.canvasId();
    if (!directory || !canvasId) {
      // ACT: 画布/目录已不可用（切换项目/关闭实例），把排队的箭头收掉，别留一根灰线。
      updateLink(task.taskId, "failed");
      flashLink(task.taskId, "dispatch", 220);
      syncQueueView();
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
    try {
      // ACT: 取画布上下文、解析模型都放进 try：这里任何一步抛错都不能把节点永久留在 running 表里。
      const canvasContext = options.getCanvasContext();
      // 模型回退链：目标会话记录 → 节点上次选择（agentModel）→ 派发方模型。
      const nodeModel = options.findNode(task.toNodeId)?.data?.agentModel as DispatchModel | undefined;
      // ACT: 目标节点选了角色就按它的角色跑；服务端按 id 解析提示词。
      const nodeRole = options.findNode(task.toNodeId)?.data?.agentRoleId;
      const model = sessionFile
        ? (await readSessionModel(directory, sessionFile, AbortSignal.timeout(5000)).catch(() => undefined)) ?? nodeModel ?? task.model
        : nodeModel ?? task.model;
      controller.signal.throwIfAborted();
      if (!model) throw new Error("目标 Agent 没有可用的模型，请先在它的面板里选择模型");
      const body = {
        prompt: task.prompt, directory,
        providerId: model.providerId, modelId: model.modelId,
        ...(model.thinkingLevel ? { thinkingLevel: model.thinkingLevel } : {}),
        ...(sessionFile ? { sessionFile } : {}),
        nodeBinding: { canvasId, nodeId: task.toNodeId },
        dispatchDepth: task.depth,
        ...(typeof nodeRole === "string" && nodeRole ? { roleId: nodeRole } : {}),
        ...(canvasContext ? { canvas: { id: canvasContext.id, tools: canvasContext.tools } } : {}),
      };
      const onEvent = async (live: AgentEvent) => {
        if (live.type === "session") {
          sessionFile = live.file;
          task.toSession = live.file;
          options.updateNodeData(task.toNodeId, { agentSessionFile: live.file, agentLastPrompt: task.prompt.slice(0, 120) });
          inject(task, live);
          return;
        }
        if (live.type === "canvasCall") {
          await handleCanvasCall(task, live, canvasContext, controller.signal);
          return;
        }
        if (live.type === "question") {
          const list = pendingQuestions.get(task.toNodeId) ?? [];
          list.push(live);
          pendingQuestions.set(task.toNodeId, list);
          options.onQuestions?.(task.toNodeId, live);
          inject(task, live);
          return;
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
          return;
        }
        if (live.type === "error") errorMessage = live.message;
        inject(task, live);
        if (live.type === "text" || live.type === "thinking" || live.type === "tool") setStatus(task.toNodeId, "running");
      };
      // ACT: 打断后立即重发时服务端可能还在收尾（EBUSY）。这是可重试的「忙」，不是业务失败；
      // 该错误在创建会话/写盘之前抛出，重发不会重复投递。
      for (let attempt = 0; ; attempt++) {
        try {
          await postDispatchRequest(directory, body, controller.signal, onEvent);
          break;
        } catch (error) {
          const busy = (error as { code?: string } | null)?.code === "EBUSY";
          if (!busy || attempt >= 10 || controller.signal.aborted) throw error;
          await new Promise(resolve => setTimeout(resolve, 150));
          controller.signal.throwIfAborted();
        }
      }
      succeeded = true;
    } catch (error) {
      if (task.stopped || controller.signal.aborted) errorMessage = "已取消";
      else errorMessage = error instanceof Error ? error.message : "任务执行失败";
    } finally {
      // ACT: 无论成功、失败还是提前抛错，都必须释放 running 表，否则该节点会一直显示在跑、
      // 后续派活全部停在队列里（也就是“唤不醒”）。读取结果也加超时，避免本地接口挂住不返回。
      const result = succeeded && sessionFile && !controller.signal.aborted
        ? await readLastAssistantText(directory, sessionFile, AbortSignal.timeout(8000)).catch(() => "")
        : "";
      if (running.has(task.taskId)) finish(task, succeeded && !controller.signal.aborted, errorMessage, result);
    }
  }

  function finish(task: Task, ok: boolean, errorMessage: string, result = "") {
    // ACT: dispose 后 abort 触发的 finish 不能再往已清空的链接层、面板和父会话写东西。
    // ACT: 同一任务只收尾一次；打断/停止可能让完成路径同时到达，重复收尾会重复回传或重复写取消 note。
    if (disposed || task.finished) return;
    task.finished = true;
    const status = task.stopped || task.controller?.signal.aborted ? "cancelled" : ok ? "completed" : "failed";
    task.controller?.abort();
    if (task.dedupeKey) dedupe.delete(task.dedupeKey);
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
  async function deliverCancelNote(task: Task, queued = false) {
    const directory = options.directory();
    if (!directory || !task.fromSession) return false;
    // ACT: 同一 taskId 只投递一次；排队撤销与运行中断可能先后命中同一任务，重复投递会让父会话出现两条相同通知。
    if (cancelNotedTaskIds.has(task.taskId)) return false;
    cancelNotedTaskIds.add(task.taskId);
    const label = labelOf(options.findNode(task.toNodeId), task.toNodeId);
    const reason = task.interruptReason ? `（${task.interruptReason}）` : "";
    // ACT: 排队中被撤销的任务从未执行，不能写成「没有新的输出」，否则父 Agent 会以为它跑过。
    const content = queued
      ? `【Agent 任务结果】来自「${label}」的任务 #${task.taskId} 在排队中被用户撤销，尚未开始执行${reason}。如需继续，请重新派发或直接给它发消息。`
      : `【Agent 任务结果】来自「${label}」的任务 #${task.taskId} 已被停止${reason}，没有新的输出。如需继续，请重新派发或直接给它发消息。`;
    try {
      const response = await fetch("/api/agent/note", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-toonflow-workspace": "1" },
        body: JSON.stringify({ directory, sessionFile: task.fromSession, content }),
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error(`note ${response.status}`);
      const body = await response.json().catch(() => null) as { data?: { id?: string } } | null;
      const id = body?.data?.id;
      if (!id) throw new Error("note 未返回消息 id");
      injectEvent(task.fromNodeId, task.fromSession, { type: "note", id, content });
      return true;
    } catch {
      // ACT: 投递失败时释放标记，允许后续收尾路径再试一次；成功则不再重复。
      cancelNotedTaskIds.delete(task.taskId);
    }
    return false;
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

  /** 面板开始/结束自己的用户请求；外部运行时 dispatcher 需等待。 */
  function notePanelRun(nodeId: string, runningNow: boolean) {
    if (runningNow) {
      panelRunning.add(nodeId);
    } else {
      panelRunning.delete(nodeId);
    }
    pump();
  }

  /**
   * 撤销一条尚未开始的排队任务：只对派发任务生效（结果回传撤销会让父 Agent 永远收不到结果）。
   * ACT: 必须释放去重键，否则用户撤销后立刻重发同样内容会被 60 秒去重吞掉，看起来像撤销把节点静音了。
   */
  function cancelQueued(taskId: string) {
    if (disposed) return false;
    const index = queue.findIndex(task => task.taskId === taskId && task.kind === "task");
    if (index < 0) return false;
    const [task] = queue.splice(index, 1);
    if (!task) return false;
    if (task.dedupeKey) dedupe.delete(task.dedupeKey);
    removeLink(task.taskId, "dispatch");
    task.interruptReason = "排队中被用户撤销";
    void deliverCancelNote(task, true).then(notified => {
      if (!notified) notifyQueue(`已撤销「${labelFor(task.fromNodeId)} → ${labelFor(task.toNodeId)}」，但未能通知原 Agent`);
    });
    notifyQueue(`已撤销「${labelFor(task.fromNodeId)} → ${labelFor(task.toNodeId)}」的排队消息`);
    syncQueueView();
    pump();
    return true;
  }

  /**
   * 用户停止某节点：只清掉「停止这一刻」的排队任务与去重记录、中断在跑的任务。
   * ACT: 不要额外把节点标成「已停止」——停下某个任务不等于拒绝之后的派活，
   * 否则别的 Agent 再派过来会被静默丢弃，看上去就是「这个节点再也唤不醒」。
   */
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
    syncQueueView();
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
    for (const timer of noticeTimers.values()) clearTimeout(timer);
    noticeTimers.clear();
    preempting.clear();
    for (const task of running.values()) task.controller?.abort();
    running.clear();
    queue.length = 0;
    syncQueueView();
    queueNotices.value = [];
    options.links?.splice(0, options.links.length);
  }

  return {
    enqueueFromEvent, notePanelRun, stop, cancelQueued, replayQuestions, dispose, pendingQuestions,
    queueView, queueNotices,
  };
}
