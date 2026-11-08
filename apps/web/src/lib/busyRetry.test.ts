import { describe, expect, test } from "bun:test";

import { isBusyError, withBusyRetry } from "./busyRetry";

function axiosError(status: number, code?: string) {
  return Object.assign(new Error(code ?? "request failed"), {
    isAxiosError: true,
    response: { status, data: code ? { code: status, data: { code } } : undefined },
  });
}

/** 记录每次退避的毫秒数，避免真的等待。 */
function recorder() {
  const delays: number[] = [];
  return { delays, sleep: async (ms: number) => { delays.push(ms); } };
}

describe("isBusyError", () => {
  test("只认 409 + data.code=EBUSY", () => {
    expect(isBusyError(axiosError(409, "EBUSY"))).toBe(true);
  });

  test("其他 409（EEXIST/ESTALE）不重试", () => {
    expect(isBusyError(axiosError(409, "EEXIST"))).toBe(false);
    expect(isBusyError(axiosError(409, "ESTALE"))).toBe(false);
  });

  test("状态不是 409、或不是 axios 错误时不重试", () => {
    expect(isBusyError(axiosError(500, "EBUSY"))).toBe(false);
    expect(isBusyError(new Error("EBUSY"))).toBe(false);
  });

  test("409 但响应体没有 code 时不重试", () => {
    expect(isBusyError(axiosError(409))).toBe(false);
  });
});

describe("withBusyRetry", () => {
  test("冲突后按 60/120/240 退避，成功后返回结果", async () => {
    const { delays, sleep } = recorder();
    let calls = 0;
    const result = await withBusyRetry(async () => {
      calls++;
      if (calls < 3) throw axiosError(409, "EBUSY");
      return "ok";
    }, { sleep, random: () => 0 });
    expect(result).toBe("ok");
    expect(calls).toBe(3);
    expect(delays).toEqual([60, 120]);
  });

  test("连续冲突超过 4 次后抛出原始错误", async () => {
    const { delays, sleep } = recorder();
    let calls = 0;
    const failure = axiosError(409, "EBUSY");
    await expect(withBusyRetry(async () => { calls++; throw failure; }, { sleep, random: () => 0 })).rejects.toBe(failure);
    expect(calls).toBe(4);
    expect(delays).toEqual([60, 120, 240]);
  });

  test("非 EBUSY 错误立即抛出，不等待", async () => {
    const { delays, sleep } = recorder();
    let calls = 0;
    await expect(withBusyRetry(async () => { calls++; throw axiosError(409, "EEXIST"); }, { sleep })).rejects.toBeDefined();
    expect(calls).toBe(1);
    expect(delays).toEqual([]);
  });

  test("attempts=1 时只执行一次", async () => {
    const { sleep } = recorder();
    let calls = 0;
    await expect(withBusyRetry(async () => { calls++; throw axiosError(409, "EBUSY"); }, { attempts: 1, sleep })).rejects.toBeDefined();
    expect(calls).toBe(1);
  });

  test("baseDelayMs=0 时不等待基准时长，只保留抖动", async () => {
    const { delays, sleep } = recorder();
    let calls = 0;
    await withBusyRetry(async () => {
      calls++;
      if (calls < 2) throw axiosError(409, "EBUSY");
      return true;
    }, { baseDelayMs: 0, sleep, random: () => 0 });
    expect(delays).toEqual([0]);
  });

  test("退避带抖动但不小于基准", async () => {
    const { delays, sleep } = recorder();
    let calls = 0;
    await withBusyRetry(async () => {
      calls++;
      if (calls < 2) throw axiosError(409, "EBUSY");
      return true;
    }, { sleep, random: () => 1 });
    expect(delays).toEqual([120]); // 60 + floor(1 * 60)
  });
});
