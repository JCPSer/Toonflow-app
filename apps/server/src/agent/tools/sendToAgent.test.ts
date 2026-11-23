import { describe, expect, it } from "bun:test";
import { createSendToAgentTool, type AgentDispatchContext } from "./sendToAgent";
import { DEFAULT_DISPATCH_MAX_DEPTH } from "@/agent/runtime/dispatchLimits";
import type { AgentEvent } from "@/agent/runtime/types";

function context(overrides: Partial<AgentDispatchContext> = {}) {
  const events: AgentEvent[] = [];
  const value: AgentDispatchContext = {
    sessionFile: "s.jsonl", nodeId: "a", canvasId: "c.json",
    providerId: "p", modelId: "m", depth: 0,
    send: event => { events.push(event); },
    ...overrides,
  };
  return { value, events };
}

async function execute(context: AgentDispatchContext, params: unknown) {
  return createSendToAgentTool(context).execute!("call", params as never, undefined as never, () => {}, undefined as never);
}

describe("sendToAgent", () => {
  it("下发 agentDispatch 并立即返回任务 id", async () => {
    const { value, events } = context();
    const result = await execute(value, { nodeId: "b", message: "写一个分镜" });
    const payload = JSON.parse((result.content[0] as { text: string }).text);
    expect(payload.accepted).toBe(true);
    expect(typeof payload.taskId).toBe("string");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "agentDispatch", fromNodeId: "a", toNodeId: "b", message: "写一个分镜", depth: 0,
      model: { providerId: "p", modelId: "m" },
    });
  });

  it("不能派给自己", async () => {
    const { value, events } = context();
    await expect(execute(value, { nodeId: "a", message: "x" })).rejects.toThrow("不能把任务派给自己");
    expect(events).toHaveLength(0);
  });

  it("超过跳数上限拒绝", async () => {
    const { value, events } = context({ depth: DEFAULT_DISPATCH_MAX_DEPTH });
    await expect(execute(value, { nodeId: "b", message: "x" })).rejects.toThrow("跳上限");
    expect(events).toHaveLength(0);
  });

  it("开发者设置的上限生效：3 跳后拒绝、2 跳仍可派发", async () => {
    const blocked = context({ depth: 3, maxDepth: 3 });
    await expect(execute(blocked.value, { nodeId: "b", message: "x" })).rejects.toThrow("3 跳上限");
    expect(blocked.events).toHaveLength(0);

    const allowed = context({ depth: 2, maxDepth: 3 });
    await execute(allowed.value, { nodeId: "b", message: "x" });
    expect(allowed.events).toHaveLength(1);
    // 事件要把本次生效的上限一并下发，画布兜底才能与本次派发链保持一致。
    expect(allowed.events[0]).toMatchObject({ type: "agentDispatch", maxDepth: 3 });
  });

  it("不限制档（1000）允许远大于 32 的深度", async () => {
    const { value, events } = context({ depth: 100, maxDepth: 1000 });
    await execute(value, { nodeId: "b", message: "继续" });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "agentDispatch", maxDepth: 1000 });
  });

  it("空消息不通过校验", async () => {
    const { value, events } = context();
    await expect(execute(value, { nodeId: "b", message: "   " })).rejects.toThrow();
    expect(events).toHaveLength(0);
  });
});
