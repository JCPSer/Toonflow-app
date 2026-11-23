import { describe, expect, it } from "bun:test";
import { DEFAULT_DISPATCH_MAX_DEPTH, MAX_DISPATCH_MAX_DEPTH, MIN_DISPATCH_MAX_DEPTH, UNLIMITED_DISPATCH_MAX_DEPTH, normalizeDispatchMaxDepth, resolveDispatchLimit } from "./dispatchLimits";

describe("normalizeDispatchMaxDepth", () => {
  it("缺省与非法类型回落到 8", () => {
    expect(normalizeDispatchMaxDepth(undefined)).toBe(DEFAULT_DISPATCH_MAX_DEPTH);
    expect(normalizeDispatchMaxDepth(null)).toBe(8);
    expect(normalizeDispatchMaxDepth("12")).toBe(8);
    expect(normalizeDispatchMaxDepth(Number.NaN)).toBe(8);
    expect(normalizeDispatchMaxDepth(Number.POSITIVE_INFINITY)).toBe(8);
  });

  it("按 1–32 钳制", () => {
    expect(normalizeDispatchMaxDepth(0)).toBe(MIN_DISPATCH_MAX_DEPTH);
    expect(normalizeDispatchMaxDepth(-5)).toBe(1);
    expect(normalizeDispatchMaxDepth(100)).toBe(MAX_DISPATCH_MAX_DEPTH);
  });

  it("小数取整", () => {
    expect(normalizeDispatchMaxDepth(3.4)).toBe(3);
    expect(normalizeDispatchMaxDepth(3.6)).toBe(4);
  });

  it("范围内的值原样返回", () => {
    for (const value of [1, 3, 8, 16, 32]) expect(normalizeDispatchMaxDepth(value)).toBe(value);
  });
});

describe("resolveDispatchLimit", () => {
  it("运行期允许「不限制」档的 1000", () => {
    expect(resolveDispatchLimit(UNLIMITED_DISPATCH_MAX_DEPTH)).toBe(1000);
    expect(resolveDispatchLimit(200)).toBe(200);
  });

  it("超过绝对兜底仍被压回 1000，非法值回到默认 8", () => {
    expect(resolveDispatchLimit(5000)).toBe(1000);
    expect(resolveDispatchLimit(undefined)).toBe(8);
    expect(resolveDispatchLimit("16")).toBe(8);
  });
});
