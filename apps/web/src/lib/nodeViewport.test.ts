import { describe, expect, it } from "bun:test";
import { revealNodeInViewport } from "@toonflow/nodes-scaffold/nodeViewport";

function fakeFlow(setCenter: () => Promise<boolean>) {
  return {
    updateNodeInternals: () => {},
    dimensions: { value: { width: 1200, height: 800 } },
    viewport: { value: { x: 0, y: 0, zoom: 1 } },
    findNode: () => ({ computedPosition: { x: 5000, y: 5000 }, dimensions: { width: 240, height: 180 } }),
    setCenter,
  } as never;
}

describe("revealNodeInViewport", () => {
  it("setCenter 永不返回时也会在动画时长后兜底返回", async () => {
    const started = performance.now();
    const revealed = await revealNodeInViewport(fakeFlow(() => new Promise<boolean>(() => {})), "n1", { duration: 50 });
    expect(revealed).toBe(true);
    expect(performance.now() - started).toBeLessThan(2000);
  });

  it("setCenter 正常返回时立即完成", async () => {
    let called = 0;
    const revealed = await revealNodeInViewport(fakeFlow(async () => { called++; return true; }), "n1", { duration: 50 });
    expect(revealed).toBe(true);
    expect(called).toBe(1);
  });

  it("节点已在视口内时不触发 setCenter", async () => {
    let called = 0;
    const flow = {
      updateNodeInternals: () => {},
      dimensions: { value: { width: 1200, height: 800 } },
      viewport: { value: { x: 0, y: 0, zoom: 1 } },
      findNode: () => ({ computedPosition: { x: 100, y: 100 }, dimensions: { width: 240, height: 180 } }),
      setCenter: async () => { called++; return true; },
    } as never;
    expect(await revealNodeInViewport(flow, "n1", { duration: 50 })).toBe(false);
    expect(called).toBe(0);
  });
});
