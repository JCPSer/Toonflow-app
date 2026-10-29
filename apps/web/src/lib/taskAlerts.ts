/**
 * 节点任务结果 → 提示音 / 桌面通知 / 未读横幅。
 *
 * ACT: 节点包是独立 UMD，宿主拿不到它们的回调，只能订阅 window 上的 toonflow:node-task 事件。
 * 这里负责把「某个节点跑完了」翻译成用户能感知的反馈，并做阈值过滤与 1 秒窗口合并。
 */
import { watch } from "vue";
import { NODE_TASK_EVENT, type NodeTaskDetail } from "@toonflow/nodes-scaffold/nodeBusy";
import { playChime } from "@/lib/chime";
import { notifyDesktop } from "@/lib/desktopNotify";
import { generalSettings } from "@/stores/settings";
import { useTaskAlertsStore, formatTaskDuration, type TaskAlertKind } from "@/stores/taskAlerts";
import { useWorkspaceStore } from "@/stores/workspace";

/** 单次运行太短的任务（点一下就好的节点）不值得提醒。 */
const MIN_DURATION_MS = 30_000;
/** 合并窗口：同一批任务的完成事件通常前后脚到达，1 秒内只打扰用户一次。 */
const MERGE_WINDOW_MS = 1000;
const INSTALL_KEY = "__toonflowTaskAlerts";
const FALLBACK_LABEL = "节点";

type QueuedTask = NodeTaskDetail & { nodeLabel: string; canvasId?: string; canvasKey?: string };
type Batch = { done: QueuedTask[]; failed: QueuedTask[] };

// ACT: 节点名与所属画布只有画布实例知道（Vue Flow 在该组件里），事件 detail 只带 nodeId；
// 由画布注入解析器，非画布页面/已删除节点统一兜底为「节点」。
// 同时挂载多个画布（后台画布只是 hidden），所以用集合而不是单个解析器，
// 否则后挂载的画布会把前一个顶掉，后台画布的完成事件就查不到名字。
type NodeSource = { label?: string; canvasId?: string; canvasKey?: string };
type NodeLabelSource = (nodeId: string) => NodeSource | undefined;
const labelSources = new Set<NodeLabelSource>();

/** 由画布注入节点解析器，返回撤销函数。 */
export function setNodeLabelResolver(resolver: NodeLabelSource) {
  labelSources.add(resolver);
  return () => { labelSources.delete(resolver); };
}

let pending: Batch | undefined;
let mergeTimer: ReturnType<typeof setTimeout> | undefined;
let storeReady = false;

/**
 * ACT: installTaskAlerts 在 pinia 安装之前调用（与 installMediaPlayback 同位置），
 * 所以 store 只在第一次真正需要时获取；顺便在这里挂切项目的清空逻辑。
 */
function taskAlertsStore() {
  if (!storeReady) {
    storeReady = true;
    const workspace = useWorkspaceStore();
    watch(() => workspace.project?.directory, () => useTaskAlertsStore().clear());
  }
  return useTaskAlertsStore();
}

function nodeSource(nodeId: string): NodeSource {
  for (const source of labelSources) {
    const found = source(nodeId);
    if (found?.label || found?.canvasId) return found;
  }
  return {};
}

function shouldPlayChime() {
  const mode = generalSettings.value.completionSound;
  if (mode === "off") return false;
  if (mode === "always") return true;
  return !document.hasFocus();
}

/** 系统通知只在桌面应用里发；前台时横幅就在眼前，不重复打扰。 */
function shouldNotify() {
  return generalSettings.value.taskNotification && !document.hasFocus();
}

function describe(kind: TaskAlertKind, list: QueuedTask[]) {
  const action = kind === "done" ? "已完成" : "执行失败";
  if (list.length === 1) return `${list[0].nodeLabel} ${action} · 耗时 ${formatTaskDuration(list[0].durationMs)}`;
  const labels = list.map(item => item.nodeLabel);
  return `${list.length} 个节点${action}：${labels.slice(0, 3).join("、")}${labels.length > 3 ? " 等" : ""}`;
}

function flush() {
  const batch = pending;
  pending = undefined;
  mergeTimer = undefined;
  if (!batch || (!batch.done.length && !batch.failed.length)) return;
  const store = taskAlertsStore();
  // ACT: 无论是否发声都要写进未读队列——用户可能正因「仅后台」档位而没听到声音，横幅是保底通道。
  for (const [kind, list] of [["done", batch.done], ["failed", batch.failed]] as const) {
    for (const item of list) {
      store.push({ nodeId: item.nodeId, nodeLabel: item.nodeLabel, kind, durationMs: item.durationMs, at: Date.now(), canvasId: item.canvasId, canvasKey: item.canvasKey });
    }
  }
  // ACT: 同一窗口既有成功又有失败时按失败音收尾，不能让上行音把「有节点挂了」听成一切顺利。
  if (shouldPlayChime()) playChime(batch.failed.length ? "failure" : "success");
  if (shouldNotify()) {
    if (batch.failed.length) notifyDesktop({ title: "Toonflow", body: describe("failed", batch.failed) });
    if (batch.done.length) notifyDesktop({ title: "Toonflow", body: describe("done", batch.done) });
  }
}

function onNodeTask(event: Event) {
  const detail = (event as CustomEvent<NodeTaskDetail>).detail;
  if (!detail || typeof detail.nodeId !== "string") return;
  // ACT: 手动停止按需求不提醒；跑得太短的任务也不打扰。
  if (detail.cancelled) return;
  if (!Number.isFinite(detail.durationMs) || detail.durationMs < MIN_DURATION_MS) return;
  pending ??= { done: [], failed: [] };
  const source = nodeSource(detail.nodeId);
  (detail.ok ? pending.done : pending.failed).push({ ...detail, nodeLabel: source.label?.trim() || FALLBACK_LABEL, canvasId: source.canvasId, canvasKey: source.canvasKey });
  mergeTimer ??= setTimeout(flush, MERGE_WINDOW_MS);
}

/** 应用启动时调用一次（幂等）；真正使用时才需要 pinia。 */
export function installTaskAlerts() {
  if (typeof window === "undefined") return;
  const scope = window as Window & { [INSTALL_KEY]?: boolean };
  if (scope[INSTALL_KEY]) return;
  scope[INSTALL_KEY] = true;
  window.addEventListener(NODE_TASK_EVENT, onNodeTask);
}
