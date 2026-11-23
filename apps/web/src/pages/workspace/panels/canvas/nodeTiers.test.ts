import { describe, expect, it } from "bun:test";
import { intersectsViewBox, planNodeTiers, type TierNodeBox } from "./nodeTiers";

const keep = { x1: 0, y1: 0, x2: 1000, y2: 800 };
// renderBox 必须比 restoreBox 大：出大框才降级，进小框才恢复，中间一圈维持原状态。
const render = { x1: -300, y1: -300, x2: 1300, y2: 1100 };
const node = (id: string, x: number, y: number, width = 240, height = 160): TierNodeBox => ({ id, x, y, width, height });

describe("intersectsViewBox", () => {
  it("完全在内、部分相交、贴边都算相交", () => {
    expect(intersectsViewBox(node("a", 100, 100), keep)).toBe(true);
    expect(intersectsViewBox(node("b", 950, 750), keep)).toBe(true);
    expect(intersectsViewBox(node("c", 1000, 800), keep)).toBe(true);
  });

  it("完全在外不算相交", () => {
    expect(intersectsViewBox(node("a", 1001, 0), keep)).toBe(false);
    expect(intersectsViewBox(node("b", 0, -161), keep)).toBe(false);
  });
});

describe("planNodeTiers", () => {
  it("框外的未降级节点进入 demote", () => {
    const plan = planNodeTiers([node("far", 5000, 5000), node("near", 100, 100)], render, keep, new Set());
    expect(plan.demote).toEqual(["far"]);
    expect(plan.restore).toEqual([]);
  });

  it("迟滞带内维持原状：既不重复降级也不提前恢复", () => {
    // 在 restore 外、render 内
    const band = node("band", 1050, 100);
    expect(planNodeTiers([band], render, keep, new Set()).demote).toEqual([]);
    expect(planNodeTiers([band], render, keep, new Set(["band"])).restore).toEqual([]);
  });

  it("进入 restore 框的已降级节点恢复", () => {
    const plan = planNodeTiers([node("back", 200, 200)], render, keep, new Set(["back"]));
    expect(plan.restore).toEqual(["back"]);
    expect(plan.demote).toEqual([]);
  });

  it("已降级且仍在框外时保持降级", () => {
    const plan = planNodeTiers([node("far", 5000, 5000)], render, keep, new Set(["far"]));
    expect(plan.demote).toEqual([]);
    expect(plan.restore).toEqual([]);
  });

  it("未测量的节点不降级，避免盒子塌成 0", () => {
    const plan = planNodeTiers([node("unmeasured", 5000, 5000, 0, 0)], render, keep, new Set());
    expect(plan.demote).toEqual([]);
  });
});
