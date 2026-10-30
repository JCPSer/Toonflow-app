import type { GraphNode } from "@vue-flow/core";
import { snapPoint, snapValue, subtractPoint } from "./snapNodes";

export function getSelectionRoots(selection: GraphNode[], nodes: GraphNode[]) {
  const selected = new Map(selection.map(node => [node.id, node]));
  const byId = new Map(nodes.map(node => [node.id, node]));
  return [...selected.values()].filter(node => {
    const visited = new Set([node.id]);
    let parentId = node.parentNode;
    while (parentId && !visited.has(parentId)) {
      if (selected.has(parentId)) return false;
      visited.add(parentId);
      parentId = byId.get(parentId)?.parentNode;
    }
    return true;
  });
}

export function getSelectionTree(selection: GraphNode[], nodes: GraphNode[]) {
  const children = new Map<string, GraphNode[]>();
  for (const node of nodes) {
    if (!node.parentNode) continue;
    const siblings = children.get(node.parentNode) ?? [];
    siblings.push(node);
    children.set(node.parentNode, siblings);
  }
  const result: GraphNode[] = [];
  const visited = new Set<string>();
  function visit(node: GraphNode) {
    if (visited.has(node.id)) return;
    visited.add(node.id);
    result.push(node);
    children.get(node.id)?.forEach(visit);
  }
  getSelectionRoots(selection, nodes).forEach(visit);
  selection.forEach(visit);
  return result;
}

// ACT: 空分组没有内容可贴，统一收成一个能放下标题栏的最小矩形（10×16 / 6×16，仍落在网格上）。
// 手柄缩放的下限是 120×80，两者口径不同：这里是"贴合结果"，那里是"用户手工操作"。
export const GROUP_MIN_WIDTH = 160;
export const GROUP_MIN_HEIGHT = 96;

function setGroupSize(group: GraphNode, width: number, height: number) {
  // ACT: 尺寸没变就不写样式——拖动换组、删除都会重复贴合，无条件赋值会让每次触碰都产生一次保存。
  // 比较基准取 style 上的宽高而不是 dimensions：dimensions 是运行态字段，会被 ResizeObserver 从 DOM 覆盖。
  const style = typeof group.style === "function" ? group.style(group) : group.style;
  const current = (style ?? {}) as Record<string, unknown>;
  if (Number.parseFloat(String(current.width)) !== width || Number.parseFloat(String(current.height)) !== height) {
    group.style = { ...current, width: `${width}px`, height: `${height}px` };
  }
  group.dimensions = { width, height };
}

export function fitGroupBounds(nodes: GraphNode[], groups: Set<GraphNode>) {
  let fitted = 0;
  for (const group of getSelectionTree([...groups], nodes).reverse()) {
    if (!groups.has(group)) continue;
    const children = nodes.filter(node => node.parentNode === group.id);
    if (!children.length) {
      // ACT: 删到空、拖出最后一个子节点都走这里——缩到最小尺寸，位置不动，分组本身保留。
      setGroupSize(group, GROUP_MIN_WIDTH, GROUP_MIN_HEIGHT);
      fitted++;
      continue;
    }
    if (children.some(node => !node.dimensions.width || !node.dimensions.height)) continue;
    // ACT: 内边距必须是网格（16）的倍数，否则"组落在网格上"不等于"子节点落在网格上"，
    // 建完组子节点就永久差 8px。左右 32、上 48、下 32。
    // left/top 再吸附一次：子节点本身可能带小数（节点包生成、粘贴、自动排版都会），
    // 不吸附的话这次贴合就把组永久推离网格，后面拖拽也修不回来。
    const left = snapValue(Math.min(...children.map(node => node.position.x)) - 32);
    const top = snapValue(Math.min(...children.map(node => node.position.y)) - 48);
    const width = Math.max(...children.map(node => node.position.x + node.dimensions.width)) - left + 32;
    const height = Math.max(...children.map(node => node.position.y + node.dimensions.height)) - top + 32;
    if (left || top) {
      group.position = { x: group.position.x + left, y: group.position.y + top };
      for (const child of children) child.position = { x: child.position.x - left, y: child.position.y - top };
    }
    setGroupSize(group, width, height);
    fitted++;
  }
  return fitted;
}

/**
 * 记一份「分组 → 直接子节点」的基线，供删除后做差用。
 * 只收 canvasGroup 作为父，普通节点之间没有归属关系。
 */
export function captureGroupChildren(nodes: GraphNode[]) {
  const result = new Map<string, Set<string>>();
  for (const node of nodes) if (node.type === "canvasGroup") result.set(node.id, new Set());
  for (const node of nodes) {
    const siblings = node.parentNode ? result.get(node.parentNode) : undefined;
    if (siblings) siblings.add(node.id);
  }
  return result;
}

/**
 * 删除后重贴合：谁少了直接子节点就贴合谁，并把它的全部祖先分组一起带上（嵌套组向外传播）。
 * 只处理「减少」方向——粘贴、新增、拖入不触发，避免把组越粘越大。
 * 返回受影响的组数（供调用方打点，贴合是否真的发生由 fitGroupBounds 自己判断）。
 */
export function refitGroupsAfterRemoval(nodes: GraphNode[], previous: Map<string, Set<string>>) {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const current = captureGroupChildren(nodes);
  const affected = new Set<GraphNode>();
  for (const [groupId, previousChildren] of previous) {
    // ACT: 组对象必须按 id 从当前数组重取——fitGroupBounds 用对象身份判断，
    // 拿 setNodes 之前的老对象会出现"子节点被平移、组本身没动"的错位。
    const group = byId.get(groupId);
    if (!group || group.type !== "canvasGroup") continue;
    const currentChildren = current.get(groupId) ?? new Set<string>();
    if ([...previousChildren].some(id => !currentChildren.has(id))) affected.add(group);
  }
  if (!affected.size) return 0;
  // ACT: 内层组收缩后外层并没有少直接子节点，只按"谁少了子节点"不会传播到外层，必须显式补祖先。
  for (const group of [...affected]) {
    const visited = new Set([group.id]);
    let parent = byId.get(group.parentNode ?? "");
    while (parent && !visited.has(parent.id)) {
      visited.add(parent.id);
      if (parent.type === "canvasGroup") affected.add(parent);
      parent = byId.get(parent.parentNode ?? "");
    }
  }
  fitGroupBounds(nodes, affected);
  return affected.size;
}


export function finishGroupDrag(nodes: GraphNode[], draggedNodes: GraphNode[]) {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const affected = new Set<GraphNode>();
  function ancestors(node: GraphNode) {
    const result: GraphNode[] = [];
    const visited = new Set([node.id]);
    let parent = byId.get(node.parentNode ?? "");
    while (parent && !visited.has(parent.id)) {
      visited.add(parent.id);
      result.push(parent);
      parent = byId.get(parent.parentNode ?? "");
    }
    return result;
  }
  // 所有归属判断使用松手时的矩形，避免先贴合的组吸收原本不相交的节点。
  const rectangles = new Map(nodes.map(node => {
    const parents = ancestors(node);
    const position = parents.reduce((point, parent) => ({ x: point.x + parent.position.x, y: point.y + parent.position.y }), { ...node.position });
    return [node.id, { ...position, ...node.dimensions, depth: parents.length }];
  }));
  const groups = nodes.filter(node => node.type === "canvasGroup" && !node.hidden).sort((a, b) => {
    const first = rectangles.get(a.id)!;
    const second = rectangles.get(b.id)!;
    return second.depth - first.depth || first.width * first.height - second.width * second.height;
  });
  function intersects(node: GraphNode, group: GraphNode) {
    const a = rectangles.get(node.id)!;
    const b = rectangles.get(group.id)!;
    return a.width > 0 && a.height > 0 && b.width > 0 && b.height > 0
      && a.x < b.x + b.width && a.x + a.width > b.x
      && a.y < b.y + b.height && a.y + a.height > b.y;
  }
  let reparented = false;
  for (const node of getSelectionRoots(draggedNodes.filter(node => byId.get(node.id) === node), nodes)) {
    const parent = byId.get(node.parentNode ?? "");
    ancestors(node).filter(ancestor => ancestor.type === "canvasGroup").forEach(ancestor => affected.add(ancestor));
    if (!node.dimensions.width || !node.dimensions.height) continue;
    const retainsParent = parent?.type === "canvasGroup" && intersects(node, parent);
    const target = groups.find(group => {
      const parents = ancestors(group);
      return group !== node && intersects(node, group) && !parents.includes(node) && (!retainsParent || parents.includes(parent));
    }) ?? (retainsParent ? parent : undefined);
    if (target === parent || (!target && parent?.type !== "canvasGroup")) continue;
    const position = rectangles.get(node.id)!;
    const parentPosition = target ? rectangles.get(target.id)! : { x: 0, y: 0 };
    node.parentNode = target?.id;
    // ACT: 换组后要保证"绝对坐标"落在网格上，而不是相对坐标——父组本身可能不在网格上，
    // 只吸附差值等于没吸。用父组当前的真实绝对位置换算，子节点绝对坐标才会真的对齐。
    node.position = subtractPoint(snapPoint(position), parentPosition);
    node.extent = undefined;
    node.expandParent = false;
    reparented = true;
    ancestors(node).filter(ancestor => ancestor.type === "canvasGroup").forEach(ancestor => affected.add(ancestor));
  }

  fitGroupBounds(nodes, affected);
  if (reparented) nodes.splice(0, nodes.length, ...getSelectionTree(nodes, nodes));
}
