import { describe, expect, test } from "bun:test";
import { runWithConcurrency } from "./concurrency";

describe("runWithConcurrency", () => {
  test("同时运行数不超过上限，且每个任务只执行一次", async () => {
    const seen: number[] = [];
    let active = 0;
    let peak = 0;
    await runWithConcurrency(Array.from({ length: 20 }, (_, index) => index), 3, async index => {
      seen.push(index);
      active++;
      peak = Math.max(peak, active);
      await Bun.sleep(5);
      active--;
    });
    expect(peak).toBeLessThanOrEqual(3);
    expect(seen.sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, index) => index));
  });

  test("任务数少于上限时全部执行", async () => {
    const seen: string[] = [];
    await runWithConcurrency(["a", "b"], 8, async item => { seen.push(item); });
    expect(seen.sort()).toEqual(["a", "b"]);
  });

  test("空列表直接结束", async () => {
    await expect(runWithConcurrency([], 8, async () => { throw new Error("不应执行"); })).resolves.toBeUndefined();
  });

  test("非法上限抛错", async () => {
    await expect(runWithConcurrency([1], 0, async () => {})).rejects.toThrow("并发上限必须是正整数");
    await expect(runWithConcurrency([1], 1.5, async () => {})).rejects.toThrow("并发上限必须是正整数");
  });

  test("单个任务失败不会漏掉其余任务", async () => {
    const seen: number[] = [];
    const promise = runWithConcurrency([0, 1, 2, 3], 2, async index => {
      seen.push(index);
      if (index === 1) throw new Error("任务 1 失败");
    });
    await expect(promise).rejects.toThrow("任务 1 失败");
    expect(seen.sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
  });

  test("多个任务失败合并为 AggregateError", async () => {
    await expect(runWithConcurrency([0, 1, 2], 1, async index => {
      throw new Error(`失败 ${index}`);
    })).rejects.toBeInstanceOf(AggregateError);
  });
});
