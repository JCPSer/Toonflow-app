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

export function fitGroupBounds(nodes: GraphNode[], groups: Set<GraphNode>) {
  for (const group of getSelectionTree([...groups], nodes).reverse()) {
    if (!groups.has(group)) continue;
    const children = nodes.filter(node => node.parentNode === group.id);
    if (!children.length || children.some(node => !node.dimensions.width || !node.dimensions.height)) continue;
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
    const style = typeof group.style === "function" ? group.style(group) : group.style;
    group.style = { ...style, width: `${width}px`, height: `${height}px` };
    group.dimensions = { width, height };
  }
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
