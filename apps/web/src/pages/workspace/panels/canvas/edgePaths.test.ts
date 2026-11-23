import { describe, expect, it } from "bun:test";
import { Position } from "@vue-flow/core";
import { buildEdgeGeometries, canvasFollowTransform, handleAnchor, pickHandle, toCanvasPoint } from "./edgePaths";

const node = (overrides: Partial<Parameters<typeof handleAnchor>[0]> = {}) => ({
  id: "n1",
  position: { x: 100, y: 50 },
  computedPosition: { x: 100, y: 50 },
  dimensions: { width: 200, height: 100 },
  ...overrides,
});

describe("handleAnchor", () => {
  it("有 handle 时按端口盒四边取锚点", () => {
    const handle = { x: 20, y: 10, width: 8, height: 8, position: Position.Right };
    expect(handleAnchor(node(), handle)).toEqual({ x: 128, y: 64 });
    expect(handleAnchor(node(), { ...handle, position: Position.Left })).toEqual({ x: 120, y: 64 });
    expect(handleAnchor(node(), { ...handle, position: Position.Top })).toEqual({ x: 124, y: 60 });
    expect(handleAnchor(node(), { ...handle, position: Position.Bottom })).toEqual({ x: 124, y: 68 });
  });

  it("没有 handle 时退回节点盒 + 兜底方位", () => {
    expect(handleAnchor(node(), undefined, Position.Bottom)).toEqual({ x: 200, y: 150 });
    expect(handleAnchor(node(), undefined, Position.Top)).toEqual({ x: 200, y: 50 });
  });

  it("优先用 computedPosition（父节点偏移后）", () => {
    const moved = node({ computedPosition: { x: 300, y: 400 } });
    expect(handleAnchor(moved, { x: 0, y: 0, width: 0, height: 0, position: Position.Left })).toEqual({ x: 300, y: 400 });
  });
});

describe("pickHandle", () => {
  const handles = [{ id: "a", x: 0, y: 0, width: 1, height: 1 }, { id: "b", x: 0, y: 0, width: 1, height: 1 }];
  it("按 id 命中，缺省取第一个，指定 id 不存在时返回 undefined（与库内 getEdgeHandle 一致）", () => {
    expect(pickHandle(handles, "b")?.id).toBe("b");
    expect(pickHandle(handles, undefined)?.id).toBe("a");
    expect(pickHandle(handles, "missing")).toBeUndefined();
    expect(pickHandle([], "a")).toBeUndefined();
  });
});

describe("canvasFollowTransform", () => {
  const rect = { x: 100, y: 50 };

  it("视口不变时只做位移，位图原点落在画布坐标对应的屏幕位置", () => {
    const viewport = { x: 0, y: 0, zoom: 1 };
    expect(canvasFollowTransform({ scale: 1, rect }, viewport)).toEqual({ k: 1, tx: 100, ty: 50 });
  });

  it("平移时 k 恒为 1，位移等于屏幕位移", () => {
    const moved = canvasFollowTransform({ scale: 1, rect }, { x: -120, y: -80, zoom: 1 });
    expect(moved.k).toBe(1);
    expect(moved.tx).toBe(-20);
    expect(moved.ty).toBe(-30);
  });

  it("缩放时整体拉伸：位图像素换算回当前屏幕", () => {
    const { k, tx, ty } = canvasFollowTransform({ scale: 1, rect }, { x: -30, y: 0, zoom: 2 });
    expect(k).toBe(2);
    // 位图像素 p=10（栅格时屏幕 10px）→ 画布 110 → 当前屏幕 110*2-30
    expect(10 * k + tx).toBe(190);
    expect(0 * k + ty).toBe(100);
  });

  it("位图降采样时 k > 1，位图仍精确贴合画布坐标", () => {
    // scale=0.5：位图 1 CSS px = 2 画布单位；当前 zoom=1 → k=2
    const { k, tx } = canvasFollowTransform({ scale: 0.5, rect }, { x: 0, y: 0, zoom: 1 });
    expect(k).toBe(2);
    // 位图像素 p=20 → 画布 100+40 → 屏幕 140
    expect(20 * k + tx).toBe(140);
  });
});

describe("buildEdgeGeometries", () => {
  const source = node({ id: "s", position: { x: 0, y: 0 }, computedPosition: { x: 0, y: 0 }, handleBounds: { source: [{ id: "out", x: 200, y: 40, width: 8, height: 8, position: Position.Right }] } });
  const target = node({ id: "t", position: { x: 400, y: 0 }, computedPosition: { x: 400, y: 0 }, handleBounds: { target: [{ id: "in", x: 0, y: 40, width: 8, height: 8, position: Position.Left }] } });
  const nodes = new Map([["s", source], ["t", target]]);
  const box = { x1: -1000, y1: -1000, x2: 1000, y2: 1000 };

  it("生成带 M/C 的路径，端点落在 handle 锚点上", () => {
    const [edge] = buildEdgeGeometries([{ id: "e1", source: "s", target: "t" }], nodes, box);
    expect(edge?.d.startsWith("M208,44")).toBe(true);
    expect(edge?.d).toContain("C");
    expect(edge?.box).toEqual({ x1: 208, y1: 44, x2: 400, y2: 44 });
  });

  it("不满足 keepBox 的边被丢弃", () => {
    const tiny = { x1: 0, y1: 0, x2: 10, y2: 10 };
    expect(buildEdgeGeometries([{ id: "e1", source: "s", target: "t" }], nodes, tiny)).toHaveLength(0);
  });

  it("端点节点缺失时跳过，不抛错", () => {
    expect(buildEdgeGeometries([{ id: "e1", source: "s", target: "ghost" }], nodes, box)).toHaveLength(0);
  });
});

describe("toCanvasPoint", () => {
  it("按缩放与平移还原画布坐标", () => {
    expect(toCanvasPoint({ x: 10, y: 20 }, { x: 0, y: 0, zoom: 2 })).toEqual({ x: 5, y: 10 });
    expect(toCanvasPoint({ x: 0, y: 0 }, { x: -100, y: -50, zoom: 0.5 })).toEqual({ x: 200, y: 100 });
  });
});
