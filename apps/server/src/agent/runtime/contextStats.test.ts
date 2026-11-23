import { describe, expect, it } from "bun:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { getAgentContext, getAgentStats } from "./sessions";

describe("getAgentContext", () => {
  it("空会话返回 0，并按窗口与输出上限给出有效压缩阈值", () => {
    const history = SessionManager.inMemory("/tmp/toonflow-context-test");
    const context = getAgentContext(history, 512_000, 393_216, 50);
    expect(context?.tokens).toBe(0);
    expect(context?.contextWindow).toBe(512_000);
    // reserve 封顶窗口一半 → 有效阈值 50%。
    expect(context?.compactPercent).toBeCloseTo(50, 5);
  });

  it("压缩后按摘要 + 保留条目 + 尾部条目估算", () => {
    const history = SessionManager.inMemory("/tmp/toonflow-context-test");
    const keptId = history.appendMessage({ role: "user", content: "x".repeat(4000), timestamp: Date.now() });
    history.appendCompaction("summary", keptId, 5000);
    const context = getAgentContext(history, 100_000, 0, 50);
    // 摘要约 2 tokens + 保留的用户消息约 1000 tokens，明显高于“只算摘要”。
    expect(context?.tokens).toBeGreaterThan(900);
    expect(context?.tokens).toBeLessThan(1500);
  });

  function appendUsageReply(history: SessionManager, tokens = 100_000) {
    return history.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "ok" }],
      provider: "test",
      model: "test-model",
      usage: { input: tokens - 1000, output: 500, cacheRead: 500, cacheWrite: 0, totalTokens: tokens },
      stopReason: "end_turn",
      timestamp: Date.now(),
    } as never);
  }

  it("有 usage 时以 usage 为基准，只补算其后的尾部条目", () => {
    const history = SessionManager.inMemory("/tmp/toonflow-context-test");
    history.appendMessage({ role: "user", content: "hi", timestamp: Date.now() });
    appendUsageReply(history);
    history.appendMessage({ role: "user", content: "y".repeat(4000), timestamp: Date.now() });
    const context = getAgentContext(history, 200_000, 0, 50);
    // usage 100000 + 尾部约 1000，不能把 usage 丢掉从零估算。
    expect(context?.tokens).toBeGreaterThan(100_500);
    expect(context?.tokens).toBeLessThan(102_500);
  });

  it("删除消息后仍沿用最后一次 usage，不切换到缺静态前缀的估算", () => {
    const history = SessionManager.inMemory("/tmp/toonflow-context-test");
    history.appendMessage({ role: "user", content: "hi", timestamp: Date.now() });
    appendUsageReply(history);
    history.appendCustomEntry("toonflowDeletedEntry", { messageId: "whatever" });
    const context = getAgentContext(history, 200_000, 0, 50);
    expect(context?.tokens).toBeGreaterThanOrEqual(100_000);
  });

  it("content 为 null 的旧消息不会抛异常（对齐 SDK 归一化）", () => {
    const history = SessionManager.inMemory("/tmp/toonflow-context-test");
    history.appendMessage({ role: "user", content: null, timestamp: Date.now() } as never);
    expect(() => getAgentContext(history, 100_000, 0, 50)).not.toThrow();
  });

  it("firstKeptEntryId 找不到时只算摘要与压缩后的条目", () => {
    const history = SessionManager.inMemory("/tmp/toonflow-context-test");
    history.appendMessage({ role: "user", content: "x".repeat(4000), timestamp: Date.now() });
    history.appendCompaction("summary", "missing-id", 5000);
    history.appendMessage({ role: "user", content: "z".repeat(400), timestamp: Date.now() });
    const context = getAgentContext(history, 100_000, 0, 50);
    expect(context?.tokens).toBeLessThan(300);
  });

  it("传入 branch 与内部读取结果一致", () => {
    const history = SessionManager.inMemory("/tmp/toonflow-context-test");
    history.appendMessage({ role: "user", content: "hi", timestamp: Date.now() });
    const branch = history.getBranch();
    const implicit = getAgentContext(history, 100_000, 0, 50);
    const explicit = getAgentContext(history, 100_000, 0, 50, branch);
    expect(explicit?.tokens).toBe(implicit?.tokens);
    expect(explicit?.compactPercent).toBe(implicit?.compactPercent);
    const timing = { outputTokens: 100, decodeMs: 1000 };
    expect(getAgentStats(history, timing, branch)).toEqual(getAgentStats(history, timing));
  });

  it("没有窗口信息时不返回上下文", () => {
    const history = SessionManager.inMemory("/tmp/toonflow-context-test");
    expect(getAgentContext(history, 0, 0)).toBeUndefined();
  });
});
