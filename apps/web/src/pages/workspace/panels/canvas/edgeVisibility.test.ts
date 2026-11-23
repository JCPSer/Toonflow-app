import { describe, expect, it } from "bun:test";
import { edgeIntersectsViewBox, viewBoxOfViewport } from "./edgeVisibility";

const box = { x1: 0, y1: 0, x2: 1000, y2: 800 };

describe("edgeIntersectsViewBox", () => {
  it("两端都在视口内", () => {
    expect(edgeIntersectsViewBox(100, 100, 900, 700, box)).toBe(true);
  });

  it("两端都在视口外但横穿视口", () => {
    expect(edgeIntersectsViewBox(-500, 400, 1500, 400, box)).toBe(true);
  });

  it("整体在视口上方/下方时裁掉", () => {
    expect(edgeIntersectsViewBox(100, -900, 900, -700, box)).toBe(false);
    expect(edgeIntersectsViewBox(100, 900, 900, 1100, box)).toBe(false);
  });

  it("整体在视口左侧/右侧时裁掉", () => {
    expect(edgeIntersectsViewBox(-900, 100, -500, 700, box)).toBe(false);
    expect(edgeIntersectsViewBox(1500, 100, 1900, 700, box)).toBe(false);
  });

  it("端点顺序颠倒不影响判定", () => {
    expect(edgeIntersectsViewBox(900, 700, 100, 100, box)).toBe(true);
  });

  it("贴着边界时算可见", () => {
    expect(edgeIntersectsViewBox(1000, 800, 1200, 900, box)).toBe(true);
  });
});

describe("viewBoxOfViewport", () => {
  it("视口为零尺寸时返回 undefined，边保持全量渲染", () => {
    expect(viewBoxOfViewport({ x: 0, y: 0, zoom: 1 }, { width: 0, height: 0 })).toBeUndefined();
    expect(viewBoxOfViewport({ x: 0, y: 0, zoom: 0 }, { width: 800, height: 600 })).toBeUndefined();
  });

  it("按平移与缩放换算画布坐标，并外扩半屏", () => {
    // 视口 800×600、zoom=2、平移 (-400,-300)（x': (0-(-400))/2=200 起画布坐标）
    const result = viewBoxOfViewport({ x: -400, y: -300, zoom: 2 }, { width: 800, height: 600 })!;
    expect(result.x1).toBe(200 - 200);
    expect(result.y1).toBe(150 - 150);
    expect(result.x2).toBe(600 + 200);
    expect(result.y2).toBe(450 + 150);
  });

  it("外扩比例可调，0 表示严格等于当前视口", () => {
    const result = viewBoxOfViewport({ x: 0, y: 0, zoom: 1 }, { width: 800, height: 600 }, 0)!;
    expect(result).toEqual({ x1: 0, y1: 0, x2: 800, y2: 600 });
  });
});
