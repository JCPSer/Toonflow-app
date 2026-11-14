import { describe, expect, test } from "bun:test";
import type { FrameKey } from "./frameOutputPlan";
import { createFrameOutputTool, type FrameOutputController, type FrameOutputState } from "./frameOutputTool";

function ok(key: FrameKey, on: boolean, path: string | null = on ? `assets/n/${key}.jpg` : null) {
  return { key, enabled: on, handleId: `${key}Frame`, path, pending: false, removedEdges: 0 };
}

function fakeFrames(apply: FrameOutputController["apply"] = async (key, on) => ok(key, on)) {
  const calls: [FrameKey, boolean][] = [];
  const states: Partial<Record<FrameKey, FrameOutputState>> = {};
  const controller: FrameOutputController = {
    apply(key, on, signal) {
      calls.push([key, on]);
      return apply(key, on, signal);
    },
    state(key) {
      return states[key] ?? { enabled: false, path: null };
    },
  };
  return { controller, calls, states };
}

describe("createFrameOutputTool", () => {
  test("grid 参数透传给 apply，未传的项返回当前状态", async () => {
    const { controller, calls } = fakeFrames();
    const tool = createFrameOutputTool(controller);
    const result = await tool.execute({ grid: true }, { signal: new AbortController().signal });
    expect(calls).toEqual([["grid", true]]);
    expect(result.grid).toMatchObject({ enabled: true, handleId: "gridFrame", path: "assets/n/grid.jpg" });
    expect(result.first).toMatchObject({ enabled: false, path: null, pending: false });
    expect(result.last).toMatchObject({ enabled: false, path: null, pending: false });
  });

  test("未传的项返回该路已有状态与 pendingReason", async () => {
    const { controller, states } = fakeFrames();
    states.grid = { enabled: true, path: null, pendingReason: "no-video" };
    const result = await createFrameOutputTool(controller).execute({}, { signal: new AbortController().signal });
    expect(result.grid).toMatchObject({ enabled: true, path: null, pending: true, pendingReason: "no-video" });
  });

  test("单项失败不阻断另一项，失败项带可读原因", async () => {
    const { controller } = fakeFrames(async (key, on) => {
      if (key === "grid") throw Object.assign(new Error("Request failed with status code 400"), { response: { data: { message: "视频已更换" } } });
      return ok(key, on, "assets/n/first.jpg");
    });
    const result = await createFrameOutputTool(controller).execute({ first: true, grid: true }, { signal: new AbortController().signal });
    expect(result.first).toMatchObject({ enabled: true, path: "assets/n/first.jpg" });
    expect(result.grid).toMatchObject({ enabled: false, path: null, error: "视频已更换" });
  });
});
