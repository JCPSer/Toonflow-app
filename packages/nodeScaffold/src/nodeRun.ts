/**
 * 节点「主操作」注册表：让画布快捷键（⌘Enter）能触发当前选中节点的生成。
 *
 * ACT: 节点包是独立 UMD，宿主与节点包的模块实例并不相同；和 nodeBusy 一样用 Symbol.for
 * 挂在 globalThis 上共享，只按 nodeId 存一个可调用函数，不进入画布 JSON。
 */

export type NodeRunHandler = () => unknown;

const nodeRunKey = Symbol.for("toonflow.nodeRun");
const host = globalThis as unknown as Record<symbol, Map<string, NodeRunHandler> | undefined>;
const handlers = (host[nodeRunKey] ??= new Map<string, NodeRunHandler>());

/** 注册/覆盖节点的运行入口；返回注销函数（只注销自己注册的那一份）。 */
export function registerNodeRun(nodeId: string, run: NodeRunHandler) {
  handlers.set(nodeId, run);
  return () => {
    if (handlers.get(nodeId) === run) handlers.delete(nodeId);
  };
}

export function getNodeRun(nodeId: string): NodeRunHandler | undefined {
  return handlers.get(nodeId);
}

/** 节点是否声明了运行入口（非生成类节点不声明）。 */
export function hasNodeRun(nodeId: string) {
  return handlers.has(nodeId);
}
