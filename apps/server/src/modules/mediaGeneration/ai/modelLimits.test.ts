import { describe, expect, it } from "bun:test";
import { resolveModelLimits } from "./modelLimits";

const builtin = [
  { id: "claude-sonnet-4-6", provider: "anthropic", contextWindow: 1_000_000, maxTokens: 128_000 },
  { id: "claude-sonnet-4-6", provider: "openrouter", contextWindow: 1_000_000, maxTokens: 128_000 },
];

describe("resolveModelLimits", () => {
  it("用户填写的窗口覆盖硬编码表，输出上限按表回落", () => {
    const limits = resolveModelLimits("OpenCode-DP", { id: "deepseek-v4.1-flash", contextWindow: 512_000 }, []);
    expect(limits).toEqual({ contextWindow: 512_000, maxTokens: 393_216 });
  });

  it("用户未填写时沿用硬编码表", () => {
    const limits = resolveModelLimits("OpenCode-DP", { id: "deepseek-v4.1-flash" }, []);
    expect(limits).toEqual({ contextWindow: 1_048_576, maxTokens: 393_216 });
  });

  it("只填输出上限时，窗口仍按表", () => {
    const limits = resolveModelLimits("OpenCode-DP", { id: "deepseek-v4.1-flash", maxOutputTokens: 64_000 }, []);
    expect(limits).toEqual({ contextWindow: 1_048_576, maxTokens: 64_000 });
  });

  it("正则命中同样适用于表；用户值仍然优先", () => {
    expect(resolveModelLimits("x", { id: "deepseek-v4.1-flash-0001" }, []).contextWindow).toBe(1_048_576);
    expect(resolveModelLimits("x", { id: "deepseek-v4.1-flash-0001", contextWindow: 256_000 }, []).contextWindow).toBe(256_000);
  });

  it("表未命中时使用内置目录；跨供应商参数一致才采用", () => {
    const limits = resolveModelLimits("openrouter", { id: "claude-sonnet-4-6" }, builtin);
    expect(limits).toEqual({ contextWindow: 1_000_000, maxTokens: 128_000 });
  });

  it("内置目录跨供应商参数不一致时回落兜底值", () => {
    const inconsistent = [
      { id: "mystery-model", provider: "a", contextWindow: 200_000, maxTokens: 32_000 },
      { id: "mystery-model", provider: "b", contextWindow: 400_000, maxTokens: 64_000 },
    ];
    expect(resolveModelLimits("c", { id: "mystery-model" }, inconsistent))
      .toEqual({ contextWindow: 262_144, maxTokens: 32_768 });
  });

  it("用户填写 0 / 负数 / 非有限数视为未填", () => {
    for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const limits = resolveModelLimits("x", { id: "deepseek-v4.1-flash", contextWindow: value, maxOutputTokens: value }, []);
      expect(limits).toEqual({ contextWindow: 1_048_576, maxTokens: 393_216 });
    }
  });

  it("完全未知的模型使用兜底值", () => {
    expect(resolveModelLimits("x", { id: "unknown-model" }, []))
      .toEqual({ contextWindow: 262_144, maxTokens: 32_768 });
  });

  it("没有精确供应商时，同 id 参数完全一致才采用共识值", () => {
    const limits = resolveModelLimits("my-relay", { id: "claude-sonnet-4-6" }, builtin);
    expect(limits).toEqual({ contextWindow: 1_000_000, maxTokens: 128_000 });
  });

  it("存在精确供应商时优先取该供应商，即使其他供应商参数不同", () => {
    const mixed = [
      { id: "mystery-model", provider: "relay", contextWindow: 300_000, maxTokens: 48_000 },
      { id: "mystery-model", provider: "other", contextWindow: 500_000, maxTokens: 64_000 },
    ];
    expect(resolveModelLimits("RELAY", { id: "mystery-model" }, mixed))
      .toEqual({ contextWindow: 300_000, maxTokens: 48_000 });
  });

  it("表未命中、只填窗口时，输出上限由内置目录补齐", () => {
    expect(resolveModelLimits("anthropic", { id: "claude-sonnet-4-6", contextWindow: 400_000 }, builtin))
      .toEqual({ contextWindow: 400_000, maxTokens: 128_000 });
  });

  it("null 视为未填", () => {
    expect(resolveModelLimits("x", { id: "deepseek-v4.1-flash", contextWindow: null, maxOutputTokens: null }, []))
      .toEqual({ contextWindow: 1_048_576, maxTokens: 393_216 });
  });
});
