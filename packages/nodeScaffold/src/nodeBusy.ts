/**
 * 全局「节点正在跑耗时任务」登记表 + 任务结束信号。
 *
 * ACT: 画布需要知道当前是否还有节点在跑（切换项目、退出项目前提示中断风险），但运行态只存在于
 * 各个节点包内部——唯一全节点一致的信号是 nodeSkeleton 的 busy。节点包是独立 UMD，宿主的 Map
 * 与节点包的 Map 不是同一个实例，所以用 Symbol.for 的全局注册表共享，做法同 agentNodeStatus。
 *
 * ACT: 完成/失败提醒同样只能从这里出发：宿主拿不到节点包的模块实例，订阅不到回调；改用 window
 * 上的原生 CustomEvent 派发，节点包与宿主在同一页面，天然共用同一个 window。
 */

export type NodeTaskOutcome = "succeeded" | "failed" | "cancelled";

export type NodeTaskDetail = {
  nodeId: string;
  ok: boolean;
  cancelled: boolean;
  durationMs: number;
};

/** 节点任务结束时派发的事件名；宿主（apps/web）据此接提示音、系统通知与未读横幅。 */
export const NODE_TASK_EVENT = "toonflow:node-task";

type NodeTaskState = {
  startedAt: number;
  outcome: NodeTaskOutcome;
  reason?: string;
};

const busyNodesKey = Symbol.for("toonflow.busyNodes");
const host = globalThis as unknown as Record<symbol, Map<string, NodeTaskState> | undefined>;
const busyNodes = (host[busyNodesKey] ??= new Map<string, NodeTaskState>());

/**
 * 标记节点开始/结束耗时任务。
 * 开始只登记一次起点（busy 是布尔量，同一节点重复上报不叠加）；结束先算耗时、派发事件，再删条目。
 */
export function markNodeBusy(nodeId: string, busy: boolean) {
  const current = busyNodes.get(nodeId);
  if (busy) {
    // ACT: 起点只认第一次；重复上报若重置 startedAt，节点跑几分钟也只能算到最后一次上报的几秒。
    if (!current) busyNodes.set(nodeId, { startedAt: performance.now(), outcome: "succeeded" });
    // ACT: 续轮会复用同一条记录，但结果必须复位——否则上一轮写下的 cancelled/failed 会污染这一轮，
    // 出现「这一轮明明成功却按取消丢弃」或「失败归属到错误的轮次」。
    else {
      current.outcome = "succeeded";
      delete current.reason;
    }
    return;
  }
  if (!current) return;
  busyNodes.delete(nodeId);
  const detail: NodeTaskDetail = {
    nodeId,
    ok: current.outcome === "succeeded",
    cancelled: current.outcome === "cancelled",
    durationMs: Math.max(0, Math.round(performance.now() - current.startedAt)),
  };
  // ACT: 没有 window 的环境（node 侧单测、构建期）不派发；守卫成本为零。
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent<NodeTaskDetail>(NODE_TASK_EVENT, { detail }));
}

/**
 * 写入本次运行的结果，默认成功。只改标记不派发——必须在 busy=false 之前调用，
 * 这样下降沿读到的结果是最终值（生成节点用 useNodeGeneration 的 report 参数保证顺序）。
 */
export function markNodeOutcome(nodeId: string, outcome: NodeTaskOutcome, reason?: string) {
  const current = busyNodes.get(nodeId);
  if (!current) return;
  current.outcome = outcome;
  current.reason = reason;
}

/** 节点卸载时把该节点的条目整体清掉，避免切画布/切项目后留下幽灵运行态；不补发完成事件。 */
export function clearNodeBusy(nodeId: string) {
  busyNodes.delete(nodeId);
}

export function hasRunningNodes() {
  return busyNodes.size > 0;
}

/** 兜底清理：只保留当前画布里确实存在的节点。 */
export function pruneBusyNodes(liveNodeIds: Iterable<string>) {
  const live = new Set(liveNodeIds);
  for (const nodeId of [...busyNodes.keys()]) if (!live.has(nodeId)) busyNodes.delete(nodeId);
}
