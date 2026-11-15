import { describe, expect, it } from "bun:test";
import { computeAgentLinkPath } from "./agentLinks";

const node = (x: number, y: number, width = 300, height = 120) => ({
  position: { x, y }, computedPosition: { x, y }, dimensions: { width, height },
});

describe("computeAgentLinkPath", () => {
  it("目标在右侧：从源右中点连到目标左中点", () => {
    const path = computeAgentLinkPath(node(0, 0), node(600, 0), { x: 0, y: 0, zoom: 1 })!;
    expect(path.d).toBe("M 300 60 C 450 60, 450 60, 600 60");
    expect(path.tipX).toBe(450);
    expect(path.tipY).toBe(48);
  });

  it("跟随画布缩放与偏移", () => {
    const path = computeAgentLinkPath(node(0, 0), node(600, 0), { x: 100, y: 50, zoom: 2 })!;
    expect(path.d.startsWith("M 700 170 C")).toBe(true);
    expect(path.d.endsWith("1300 170")).toBe(true);
  });

  it("目标在左侧：换边出发，箭头向左", () => {
    const path = computeAgentLinkPath(node(600, 0), node(0, 0), { x: 0, y: 0, zoom: 1 })!;
    expect(path.d.startsWith("M 600 60 C")).toBe(true);
    expect(path.d.endsWith("300 60")).toBe(true);
    expect(path.d).toBe("M 600 60 C 450 60, 450 60, 300 60");
  });

  it("缺少绝对坐标或尺寸时回退", () => {
    expect(computeAgentLinkPath({ position: { x: 0, y: 0 } }, node(300, 0), { x: 0, y: 0, zoom: 1 })).toBeUndefined();
    const path = computeAgentLinkPath({ position: { x: 0, y: 0 }, computedPosition: { x: 0, y: 0 } }, node(600, 0), { x: 0, y: 0, zoom: 1 })!;
    expect(path.d.startsWith("M 300 60")).toBe(true);
  });
});
