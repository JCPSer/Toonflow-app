/**
 * 「当前项目还有多少节点在跑」的汇总表。
 *
 * ACT: 运行态分散在三处——nodeBusy 的全局 busy/running 注册表（跨 UMD 节点包共享）、
 * 每个画布实例各一份的 Agent 状态表、以及 Agent 面板里的「提问中」标记。前两者都只能由
 * 挂载中的画布实例自己遍历自己的节点算出来，所以这里做成「各实例上报 + 退出前读一次」的注册表，
 * 而不是响应式 store：只有弹确认框（退出项目/关窗/切项目）的那一刻需要数字。
 *
 * ACT: busy 是全局按 nodeId 存的（`isNodeBusy` 没有画布维度），两块画布若存在同 id 节点，
 * 两个实例都会看到「这一个」在跑；所以 busy 必须跨画布按 nodeId 去重，只有实例本地的
 * Agent 状态与提问标记才用 canvasKey:nodeId 复合键。
 */
type CanvasReport = { busy: Set<string>; local: Set<string> };

const registry = new Map<string, CanvasReport>();

/**
 * 整组替换某个画布实例的上报。
 * @param busy 来自全局 busy 表的节点（本实例自己的节点里命中 isNodeBusy 的那些）
 * @param local 只属于本实例的状态：Agent thinking/running/compacting、提问中未回答
 */
export function syncCanvasRunningNodes(canvasKey: string, busy: Iterable<string>, local: Iterable<string>) {
  const report = { busy: new Set(busy), local: new Set(local) };
  if (report.busy.size === 0 && report.local.size === 0) registry.delete(canvasKey);
  else registry.set(canvasKey, report);
}

/** 画布实例卸载（关标签、切项目、退出工作区）时清掉它名下的条目。 */
export function removeCanvasRunningNodes(canvasKey: string) {
  registry.delete(canvasKey);
}

/**
 * 当前运行中的节点数量。
 * ACT: 纯读取，不触发响应式；调用方拿到的是调用瞬间的快照。
 */
export function countRunningNodes() {
  const busy = new Set<string>();
  const local = new Set<string>();
  for (const [canvasKey, report] of registry) {
    for (const id of report.busy) busy.add(id);
    // 同一节点既 busy 又被 Agent 状态覆盖时只算一次，不要重复抬高提示里的数字。
    for (const id of report.local) if (!report.busy.has(id)) local.add(`${canvasKey}:${id}`);
  }
  return busy.size + local.size;
}
