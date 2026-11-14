import { describe, expect, it } from "bun:test";
import { autoCompactStrategy, compactReserveTokens } from "./preferences";

describe("autoCompactStrategy", () => {
  it("200k 窗口按窗口 1/4 保留，而不是旧的 2 万上限", () => {
    const strategy = autoCompactStrategy(200_000, 0, 80);
    expect(strategy.reserveTokens).toBe(40_000);
    expect(strategy.keepRecentTokens).toBe(50_000);
  });

  it("1M 窗口命中 6 万上限", () => {
    const strategy = autoCompactStrategy(1_000_000, 0, 80);
    expect(strategy.keepRecentTokens).toBe(60_000);
  });

  it("小窗口按窗口 1/4 保留", () => {
    expect(autoCompactStrategy(64_000, 0, 80).keepRecentTokens).toBe(16_000);
    expect(autoCompactStrategy(20_000, 0, 80).keepRecentTokens).toBe(5_000);
  });

  it("压缩百分比 50–95 下保留量与预留量仍小于窗口", () => {
    for (const window of [16_385, 20_000, 32_000, 64_000, 128_000, 200_000, 400_000, 1_000_000]) {
      for (const percent of [50, 60, 80, 95]) {
        for (const maxOutput of [0, 8_000, 32_000]) {
          const strategy = autoCompactStrategy(window, maxOutput, percent);
          expect(strategy.enabled).toBe(true);
          expect(strategy.keepRecentTokens + strategy.reserveTokens).toBeLessThan(window);
          expect(strategy.keepRecentTokens).toBeLessThanOrEqual(Math.floor(window / 4));
          expect(strategy.keepRecentTokens).toBeLessThanOrEqual(60_000);
        }
      }
    }
  });

  it("默认 80% 阈值下摘要预算也能装进窗口", () => {
    for (const window of [20_000, 64_000, 200_000, 1_000_000]) {
      const strategy = autoCompactStrategy(window, 0, 80);
      const summaryBudget = Math.floor(0.8 * strategy.reserveTokens);
      expect(strategy.keepRecentTokens + strategy.reserveTokens + summaryBudget).toBeLessThan(window);
    }
  });

  it("窗口不超过 16k 时不启用自动压缩", () => {
    const strategy = autoCompactStrategy(16_384, 0, 80);
    expect(strategy.enabled).toBe(false);
    expect(strategy.keepRecentTokens).toBe(4_096);
  });

  it("预留量至少覆盖模型最大输出，且不超过半个窗口", () => {
    expect(compactReserveTokens(200_000, 80, 100_000)).toBe(100_000);
    expect(compactReserveTokens(32_000, 80, 100_000)).toBe(16_000);
  });
});
