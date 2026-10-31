import { describe, expect, test } from "bun:test";
import { FRAME_EPSILON, frameTarget } from "./frameTarget";

describe("frameTarget", () => {
  test("首帧落在第 1 帧内，且不等于 0（0 不会派发 seeked）", () => {
    expect(frameTarget("first", 20)).toBe(FRAME_EPSILON);
    expect(frameTarget("first", 20)).toBeGreaterThan(0);
  });

  test("尾帧落在最后一帧内", () => {
    // 20.041s / 24fps：最后一帧是 [20.0, 20.041]，尾帧目标必须落在这个区间
    expect(frameTarget("last", 20.041)).toBeCloseTo(20.04, 5);
    expect(frameTarget("last", 20.041)).toBeGreaterThan(20);
    expect(frameTarget("last", 20.041)).toBeLessThan(20.041);
  });

  test("当前帧原样返回，超出时长时夹到末尾", () => {
    expect(frameTarget("current", 20, 3.5)).toBe(3.5);
    expect(frameTarget("current", 20, 0)).toBe(0);
    expect(frameTarget("current", 20, 999)).toBeCloseTo(19.999, 5);
  });

  test("时长未知/非法时不会产生 NaN 或负值", () => {
    for (const duration of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      for (const command of ["first", "last", "current"] as const) {
        const value = frameTarget(command, duration, 0);
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
      }
    }
  });

  test("极短视频（短于 epsilon）不越界", () => {
    expect(frameTarget("first", 0.0005)).toBe(0.0005);
    expect(frameTarget("last", 0.0005)).toBeCloseTo(0.0005, 6);
  });

  test("当前帧非法输入按 0 处理", () => {
    expect(frameTarget("current", 20, Number.NaN)).toBe(0);
    expect(frameTarget("current", 20, -5)).toBe(0);
  });
});
