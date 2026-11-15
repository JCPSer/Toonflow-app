import { describe, expect, it } from "bun:test";
import { createSendToAgentTool, MAX_DISPATCH_DEPTH, type AgentDispatchContext } from "./sendToAgent";
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
    const { value, events } = context({ depth: MAX_DISPATCH_DEPTH });
    await expect(execute(value, { nodeId: "b", message: "x" })).rejects.toThrow("跳上限");
    expect(events).toHaveLength(0);
  });

  it("空消息不通过校验", async () => {
    const { value, events } = context();
    await expect(execute(value, { nodeId: "b", message: "   " })).rejects.toThrow();
    expect(events).toHaveLength(0);
  });
});
