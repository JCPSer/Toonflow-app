// 分组删除后重贴合的纯函数回归脚本（无 DOM / 无 Vue Flow 运行时依赖）。
// 运行：cd apps/web && bun scripts/check-group-refit.ts
import assert from "node:assert/strict";
import { captureGroupChildren, fitGroupBounds, GROUP_MIN_HEIGHT, GROUP_MIN_WIDTH, refitGroupsAfterRemoval } from "../src/pages/workspace/panels/canvas/selectionNodes";
import type { GraphNode } from "@vue-flow/core";

type Fixture = {
  id: string;
  type?: string;
  parentNode?: string;
  position: { x: number; y: number };
  dimensions: { width: number; height: number };
  style?: Record<string, unknown>;
};

const makeNode = (input: Fixture) => ({
  id: input.id,
  type: input.type ?? "textNode",
  parentNode: input.parentNode,
  position: { ...input.position },
  dimensions: { ...input.dimensions },
  style: { ...(input.style ?? {}) },
}) as unknown as GraphNode;

const makeGroup = (id: string, position: { x: number; y: number }, width: number, height: number, parentNode?: string) =>
  makeNode({ id, type: "canvasGroup", parentNode, position, dimensions: { width, height }, style: { width: `${width}px`, height: `${height}px` } });

const sizeOf = (node: GraphNode) => ({ width: node.dimensions.width, height: node.dimensions.height });
const styleWidth = (node: GraphNode) => Number.parseFloat(String((node.style as Record<string, unknown>).width));
const absolute = (node: GraphNode, nodes: GraphNode[]) => {
  let x = node.position.x;
  let y = node.position.y;
  let parent = node.parentNode;
  const visited = new Set<string>();
  while (parent && !visited.has(parent)) {
    visited.add(parent);
    const next = nodes.find(item => item.id === parent);
    if (!next) break;
    x += next.position.x;
    y += next.position.y;
    parent = next.parentNode;
  }
  return { x, y };
};

let passed = 0;
function check(name: string, run: () => void) {
  try {
    run();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

check("删掉一个子节点后组收紧，剩余节点绝对坐标不变", () => {
  const group = makeGroup("g", { x: 100, y: 100 }, 640, 400);
  const a = makeNode({ id: "a", parentNode: "g", position: { x: 32, y: 48 }, dimensions: { width: 200, height: 120 } });
  const b = makeNode({ id: "b", parentNode: "g", position: { x: 300, y: 48 }, dimensions: { width: 200, height: 120 } });
  const c = makeNode({ id: "c", parentNode: "g", position: { x: 568, y: 48 }, dimensions: { width: 200, height: 120 } });
  const nodes = [group, a, b, c];
  const beforeA = absolute(a, nodes);
  const beforeB = absolute(b, nodes);
  const previous = captureGroupChildren(nodes);
  nodes.splice(nodes.indexOf(c), 1);
  assert.equal(refitGroupsAfterRemoval(nodes, previous), 1);
  // 右边界 = b.x + b.width = 500，左内边距 32（left 已是 32，吸附后不位移），组宽 = 500 + 32
  assert.equal(styleWidth(group), 532);
  assert.equal(styleWidth(group), group.dimensions.width);
  assert.deepEqual(absolute(a, nodes), beforeA);
  assert.deepEqual(absolute(b, nodes), beforeB);
});

check("删空后组缩到 160×96 且位置不变", () => {
  const group = makeGroup("g", { x: 240, y: 160 }, 640, 400);
  const a = makeNode({ id: "a", parentNode: "g", position: { x: 32, y: 48 }, dimensions: { width: 200, height: 120 } });
  const nodes = [group, a];
  const previous = captureGroupChildren(nodes);
  nodes.splice(nodes.indexOf(a), 1);
  refitGroupsAfterRemoval(nodes, previous);
  assert.deepEqual(sizeOf(group), { width: GROUP_MIN_WIDTH, height: GROUP_MIN_HEIGHT });
  assert.deepEqual(group.position, { x: 240, y: 160 });
});

check("嵌套组：内层删空后外层跟着收缩", () => {
  const outer = makeGroup("outer", { x: 0, y: 0 }, 800, 600);
  const inner = makeGroup("inner", { x: 32, y: 48 }, 400, 300, "outer");
  const a = makeNode({ id: "a", parentNode: "inner", position: { x: 32, y: 48 }, dimensions: { width: 160, height: 100 } });
  const b = makeNode({ id: "b", parentNode: "inner", position: { x: 240, y: 48 }, dimensions: { width: 160, height: 100 } });
  const nodes = [outer, inner, a, b];
  const previous = captureGroupChildren(nodes);
  nodes.splice(nodes.indexOf(a), 1);
  nodes.splice(nodes.indexOf(b), 1);
  refitGroupsAfterRemoval(nodes, previous);
  assert.deepEqual(sizeOf(inner), { width: GROUP_MIN_WIDTH, height: GROUP_MIN_HEIGHT });
  // 外层只剩内层这一块：宽 = inner.x + inner.width + 32
  assert.equal(styleWidth(outer), inner.position.x + GROUP_MIN_WIDTH + 32);
});

check("整组连同子节点删除：外层组重新贴合", () => {
  const outer = makeGroup("outer", { x: 0, y: 0 }, 800, 600);
  const inner = makeGroup("inner", { x: 32, y: 48 }, 240, 200, "outer");
  const keep = makeNode({ id: "keep", parentNode: "outer", position: { x: 300, y: 48 }, dimensions: { width: 160, height: 100 } });
  const a = makeNode({ id: "a", parentNode: "inner", position: { x: 32, y: 48 }, dimensions: { width: 160, height: 100 } });
  const nodes = [outer, inner, keep, a];
  const previous = captureGroupChildren(nodes);
  nodes.splice(nodes.indexOf(a), 1);
  nodes.splice(nodes.indexOf(inner), 1);
  assert.equal(refitGroupsAfterRemoval(nodes, previous), 1);
  assert.equal(styleWidth(outer), keep.position.x + keep.dimensions.width + 32);
});

check("只增不减不触发", () => {
  const group = makeGroup("g", { x: 0, y: 0 }, 400, 300);
  const a = makeNode({ id: "a", parentNode: "g", position: { x: 32, y: 48 }, dimensions: { width: 160, height: 100 } });
  const nodes = [group, a];
  const previous = captureGroupChildren(nodes);
  nodes.push(makeNode({ id: "b", parentNode: "g", position: { x: 240, y: 48 }, dimensions: { width: 160, height: 100 } }));
  assert.equal(refitGroupsAfterRemoval(nodes, previous), 0);
  assert.equal(styleWidth(group), 400);
});

check("重复贴合幂等：第二次不产生任何几何 diff", () => {
  const group = makeGroup("g", { x: 117, y: 93 }, 400, 300);
  const a = makeNode({ id: "a", parentNode: "g", position: { x: 40, y: 56 }, dimensions: { width: 173, height: 101 } });
  const b = makeNode({ id: "b", parentNode: "g", position: { x: 260, y: 70 }, dimensions: { width: 120, height: 90 } });
  const nodes = [group, a, b];
  fitGroupBounds(nodes, new Set([group]));
  const snapshot = JSON.stringify(nodes.map(node => [node.id, node.position, node.style, node.dimensions]));
  fitGroupBounds(nodes, new Set([group]));
  assert.equal(JSON.stringify(nodes.map(node => [node.id, node.position, node.style, node.dimensions])), snapshot);
});

check("按 id 取当前对象：基线里的旧组对象不会被误改", () => {
  const stale = makeGroup("g", { x: 0, y: 0 }, 640, 400);
  const a = makeNode({ id: "a", parentNode: "g", position: { x: 32, y: 48 }, dimensions: { width: 200, height: 120 } });
  const b = makeNode({ id: "b", parentNode: "g", position: { x: 300, y: 48 }, dimensions: { width: 200, height: 120 } });
  const previous = captureGroupChildren([stale, a, b]);
  // 模拟 setNodes 换新对象：组对象重建，id 不变，b 已删除
  const group = makeGroup("g", { x: 0, y: 0 }, 640, 400);
  const nodes = [group, a];
  refitGroupsAfterRemoval(nodes, previous);
  // 贴合结果写在当前对象上：右边界 232 + 右内边距 32 = 264（left 吸附到 0，不位移）
  assert.equal(styleWidth(group), 264);
  // 基线里的旧对象必须原样不动
  assert.equal(styleWidth(stale), 640);
});

check("未测量的子节点不误缩组", () => {
  const group = makeGroup("g", { x: 0, y: 0 }, 640, 400);
  const a = makeNode({ id: "a", parentNode: "g", position: { x: 32, y: 48 }, dimensions: { width: 0, height: 0 } });
  const b = makeNode({ id: "b", parentNode: "g", position: { x: 240, y: 48 }, dimensions: { width: 160, height: 100 } });
  const nodes = [group, a, b];
  fitGroupBounds(nodes, new Set([group]));
  assert.equal(styleWidth(group), 640);
});

console.log(`\n${passed} 项全部通过`);
