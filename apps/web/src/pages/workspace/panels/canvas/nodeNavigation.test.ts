import { describe, expect, test } from "bun:test";
import {
  boundingRect,
  nodeRect,
  pickNodeInDirection,
  pickNodeNearestPoint,
  rectCenter,
  rectDistance,
  type NavigationNode,
} from "./nodeNavigation";

// 尺寸置 0，让坐标直接等于中心，断言不用来回加减半个宽高。
function dot(id: string, x: number, y: number, extra: Partial<NavigationNode> = {}): NavigationNode {
  return { id, type: "imageNode", position: { x, y }, dimensions: { width: 0, height: 0 }, ...extra };
}

function box(id: string, x: number, y: number, width: number, height: number, extra: Partial<NavigationNode> = {}): NavigationNode {
  return { id, type: "imageNode", position: { x, y }, dimensions: { width, height }, ...extra };
}

describe("geometry", () => {
  test("nodeRect 优先使用 computedPosition", () => {
    const node: NavigationNode = { id: "a", position: { x: 0, y: 0 }, computedPosition: { x: 30, y: 40 }, dimensions: { width: 10, height: 20 } };
    expect(nodeRect(node)).toEqual({ x: 30, y: 40, width: 10, height: 20 });
  });

  test("nodeRect 没有尺寸时按 0 处理", () => {
    expect(nodeRect({ id: "a", position: { x: 5, y: 6 } })).toEqual({ x: 5, y: 6, width: 0, height: 0 });
  });

  test("boundingRect 覆盖所有节点，空数组返回 undefined", () => {
    expect(boundingRect([])).toBeUndefined();
    expect(boundingRect([box("a", 0, 0, 100, 100), box("b", 200, 50, 100, 100)])).toEqual({ x: 0, y: 0, width: 300, height: 150 });
  });

  test("rectCenter 与 rectDistance", () => {
    expect(rectCenter({ x: 0, y: 0, width: 100, height: 50 })).toEqual({ x: 50, y: 25 });
    expect(rectDistance({ x: 0, y: 0, width: 100, height: 100 }, { x: 50, y: 50 })).toBe(0);
    expect(rectDistance({ x: 0, y: 0, width: 100, height: 100 }, { x: 130, y: 140 })).toBeCloseTo(50);
  });
});

describe("pickNodeInDirection", () => {
  test("四个方向各取最近的节点", () => {
    const nodes = [dot("origin", 0, 0), dot("left", -100, 0), dot("right", 100, 0), dot("up", 0, -100), dot("down", 0, 100)];
    expect(pickNodeInDirection(nodes, { x: 0, y: 0 }, "left")?.id).toBe("left");
    expect(pickNodeInDirection(nodes, { x: 0, y: 0 }, "right")?.id).toBe("right");
    expect(pickNodeInDirection(nodes, { x: 0, y: 0 }, "up")?.id).toBe("up");
    expect(pickNodeInDirection(nodes, { x: 0, y: 0 }, "down")?.id).toBe("down");
  });

  test("同方向取更近的，不受其它方向影响", () => {
    const nodes = [dot("near", 200, 0), dot("far", 900, 0), dot("behind", -50, 0), dot("above", 0, -50)];
    expect(pickNodeInDirection(nodes, { x: 0, y: 0 }, "right")?.id).toBe("near");
  });

  test("45° 边界仍然可达，超出 45° 被忽略", () => {
    expect(pickNodeInDirection([dot("edge", 100, 100)], { x: 0, y: 0 }, "right")?.id).toBe("edge");
    expect(pickNodeInDirection([dot("outside", 100, 101)], { x: 0, y: 0 }, "right")).toBeUndefined();
  });

  test("反向节点不算候选", () => {
    expect(pickNodeInDirection([dot("behind", -100, 0)], { x: 0, y: 0 }, "right")).toBeUndefined();
  });

  test("已选中、分组、隐藏、不可选的节点都不参与", () => {
    const nodes = [
      dot("selected", 100, 0, { selected: true }),
      dot("group", 200, 0, { type: "canvasGroup" }),
      dot("hidden", 300, 0, { hidden: true }),
      dot("locked", 400, 0, { selectable: false }),
    ];
    expect(pickNodeInDirection(nodes, { x: 0, y: 0 }, "right")).toBeUndefined();
  });

  test("没有候选时返回 undefined", () => {
    expect(pickNodeInDirection([], { x: 0, y: 0 }, "up")).toBeUndefined();
    expect(pickNodeInDirection([dot("only", 0, 0)], { x: 0, y: 0 }, "up")).toBeUndefined();
  });

  test("显式排除集合对普通节点生效", () => {
    const nodes = [dot("a", 100, 0), dot("b", 200, 0)];
    expect(pickNodeInDirection(nodes, { x: 0, y: 0 }, "right", new Set(["a"]))?.id).toBe("b");
    expect(pickNodeNearestPoint(nodes, { x: 0, y: 0 }, new Set(["a"]))?.id).toBe("b");
  });

  test("同分时结果稳定（按 id 兜底）", () => {
    const first = pickNodeInDirection([dot("b", 100, 0), dot("a", 100, 0)], { x: 0, y: 0 }, "right");
    const second = pickNodeInDirection([dot("a", 100, 0), dot("b", 100, 0)], { x: 0, y: 0 }, "right");
    expect(first?.id).toBe("a");
    expect(second?.id).toBe("a");
  });

  test("优先使用 computedPosition", () => {
    const node: NavigationNode = { id: "offset", position: { x: 100, y: 0 }, computedPosition: { x: -100, y: 0 }, dimensions: { width: 0, height: 0 } };
    expect(pickNodeInDirection([node], { x: 0, y: 0 }, "right")).toBeUndefined();
    expect(pickNodeInDirection([node], { x: 0, y: 0 }, "left")?.id).toBe("offset");
  });

  test("从选区外接框中心出发", () => {
    const selected = [box("a", 0, 0, 100, 100, { selected: true }), box("b", 200, 0, 100, 100, { selected: true })];
    const origin = rectCenter(boundingRect(selected)!);
    expect(origin).toEqual({ x: 150, y: 50 });
    const next = pickNodeInDirection([...selected, dot("target", 600, 50)], origin, "right");
    expect(next?.id).toBe("target");
  });
});

describe("pickNodeNearestPoint", () => {
  test("按到矩形的最短距离，不按中心距离", () => {
    const big = box("big", -500, -500, 1200, 1000);
    const near = box("near", 20, 20, 10, 10);
    expect(pickNodeNearestPoint([big, near], { x: 0, y: 0 })?.id).toBe("big");
  });

  test("跳过分组、隐藏与不可选节点", () => {
    const nodes = [
      dot("group", 0, 0, { type: "canvasGroup" }),
      dot("hidden", 10, 0, { hidden: true }),
      dot("locked", 20, 0, { selectable: false }),
      dot("ok", 30, 0),
    ];
    expect(pickNodeNearestPoint(nodes, { x: 0, y: 0 })?.id).toBe("ok");
  });

  test("同距离时按 id 兜底", () => {
    expect(pickNodeNearestPoint([dot("b", 100, 0), dot("a", -100, 0)], { x: 0, y: 0 })?.id).toBe("a");
  });

  test("没有可选节点时返回 undefined", () => {
    expect(pickNodeNearestPoint([], { x: 0, y: 0 })).toBeUndefined();
  });
});
