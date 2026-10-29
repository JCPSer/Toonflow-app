import type { GraphNode } from "@vue-flow/core";
import type { useVueFlow } from "@vue-flow/core";

type Flow = ReturnType<typeof useVueFlow>;

// ACT: 网格吸附只有一个真源。Vue Flow 只会吸附"用户拖拽"和"指针投影"（useDrag / project），
// 项目自己算出来的坐标（建组内边距、复制偏移、自动排列、分组缩放）它一概不管，
// 所以这些地方写 position 之前都必须过一遍这里，否则就会出现永远贴着网格差几像素的节点。
export const DEFAULT_GRID = 16;

export function gridSize(flow: Pick<Flow, "snapGrid">) {
  const size = flow.snapGrid.value?.[0];
  return Number.isFinite(size) && size > 0 ? size : DEFAULT_GRID;
}

export function snapValue(value: number, grid = DEFAULT_GRID) {
  return Math.round(value / grid) * grid;
}

export function snapPoint(point: { x: number; y: number }, grid = DEFAULT_GRID) {
  return { x: snapValue(point.x, grid), y: snapValue(point.y, grid) };
}

export function subtractPoint(point: { x: number; y: number }, origin: { x: number; y: number }) {
  return { x: point.x - origin.x, y: point.y - origin.y };
}

// ACT: 复制/排列这类"往外让开"的位移只能向上取整，否则取整到更小的倍数会和原节点重叠。
export function snapOffset(delta: number, grid = DEFAULT_GRID) {
  return Math.ceil(delta / grid) * grid;
}

export type NodeMove = { id: string; position: { x: number; y: number } };

/**
 * ACT: 把画布上所有节点（含分组子节点、嵌套分组）的绝对坐标吸附到网格。
 * 只做计算不改状态——调用方拿到结果后自行决定是否写回、是否进历史。
 * 绝对坐标各自取整，父节点的新绝对坐标向下传递，因此组内相对间距在"整组一起偏 8px"的场景下完全不变。
 */
export function normalizeNodesToGrid(flow: Pick<Flow, "getNodes" | "snapGrid">): NodeMove[] {
  const grid = gridSize(flow);
  const nodes = flow.getNodes.value as GraphNode[];
  if (!nodes.length) return [];
  const byId = new Map(nodes.map(node => [node.id, node]));
  const children = new Map<string, GraphNode[]>();
  for (const node of nodes) {
    if (!node.parentNode) continue;
    const list = children.get(node.parentNode) ?? [];
    list.push(node);
    children.set(node.parentNode, list);
  }
  // 旧绝对坐标要在写入前全部算好：写回时父节点已经变了，不能边写边算。
  const absolute = new Map<string, { x: number; y: number }>();
  const resolving = new Set<string>();
  const resolve = (node: GraphNode): { x: number; y: number } => {
    const cached = absolute.get(node.id);
    if (cached) return cached;
    // ACT: parentNode 数据损坏成环时不能无限递归——按"当成根节点"处理，画布还能打开。
    if (resolving.has(node.id)) return { x: 0, y: 0 };
    resolving.add(node.id);
    const parent = node.parentNode ? byId.get(node.parentNode) : undefined;
    const base = parent ? resolve(parent) : { x: 0, y: 0 };
    const value = { x: base.x + node.position.x, y: base.y + node.position.y };
    resolving.delete(node.id);
    absolute.set(node.id, value);
    return value;
  };
  const moves: NodeMove[] = [];
  const walk = (node: GraphNode, parentNext: { x: number; y: number }) => {
    const next = snapPoint(resolve(node), grid);
    const position = { x: next.x - parentNext.x, y: next.y - parentNext.y };
    if (position.x !== node.position.x || position.y !== node.position.y) moves.push({ id: node.id, position });
    for (const child of children.get(node.id) ?? []) walk(child, next);
  };
  for (const node of nodes) if (!node.parentNode) walk(node, { x: 0, y: 0 });
  return moves;
}
