import { describe, expect, it } from "bun:test";
import { isLongRunningCanvasCall, isLongRunningNodeTool } from "@toonflow/tools-scaffold/runtime";

describe("长任务画布调用豁免", () => {
  it("带 node: 前缀的 waitForGeneration 判定为长任务", () => {
    expect(isLongRunningNodeTool("node:waitForGeneration")).toBe(true);
    expect(isLongRunningNodeTool("waitForGeneration")).toBe(true);
  });

  it("其它节点函数仍受 120 秒时限", () => {
    expect(isLongRunningNodeTool("node:getGenerationStatus")).toBe(false);
    expect(isLongRunningNodeTool("node:generateVideo")).toBe(false);
    expect(isLongRunningNodeTool("")).toBe(false);
  });

  it("nodeTools 转发时按内层函数名判定", () => {
    expect(isLongRunningCanvasCall({ name: "nodeTools", args: { nodeId: "n1", name: "node:waitForGeneration", args: {} } })).toBe(true);
    expect(isLongRunningCanvasCall({ name: "nodeTools", args: { nodeId: "n1", name: "node:getGenerationStatus", args: {} } })).toBe(false);
    expect(isLongRunningCanvasCall({ name: "readNodes", args: { nodeId: "n1", name: "node:waitForGeneration" } })).toBe(false);
    expect(isLongRunningCanvasCall({ name: "nodeTools" })).toBe(false);
  });
});
