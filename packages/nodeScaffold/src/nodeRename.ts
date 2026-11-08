/**
 * 节点「重命名」入口注册表：让画布快捷键（单选节点后按 Enter）能进入节点标题编辑。
 *
 * ACT: 节点包是独立 UMD，宿主与节点包的模块实例并不相同；和 nodeBusy / nodeRun 一样用
 * Symbol.for 挂在 globalThis 上共享，只按 nodeId 存一个可调用函数，不进入画布 JSON。
 */

export type NodeRenameHandler = () => unknown;

const nodeRenameKey = Symbol.for("toonflow.nodeRename");
const host = globalThis as unknown as Record<symbol, Map<string, NodeRenameHandler> | undefined>;
const handlers = (host[nodeRenameKey] ??= new Map<string, NodeRenameHandler>());

/** 注册/覆盖节点的重命名入口；返回注销函数（只注销自己注册的那一份）。 */
export function registerNodeRename(nodeId: string, rename: NodeRenameHandler) {
  handlers.set(nodeId, rename);
  return () => {
    if (handlers.get(nodeId) === rename) handlers.delete(nodeId);
  };
}

export function getNodeRename(nodeId: string): NodeRenameHandler | undefined {
  return handlers.get(nodeId);
}

/** 节点是否声明了重命名入口（只读预览、手工安装的旧节点包不声明）。 */
export function hasNodeRename(nodeId: string) {
  return handlers.has(nodeId);
}
