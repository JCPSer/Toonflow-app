/**
 * 以固定并发度执行任务，任务全部保留并排队；索引在 await 之前取号，保证每个任务只执行一次。
 * worker 抛错不会中断其他任务：其余任务继续执行，全部结束后再抛出首个错误（多个错误合并为 AggregateError）。
 */
export async function runWithConcurrency<T>(items: readonly T[], limit: number,
  worker: (item: T, index: number) => Promise<void>): Promise<void> {
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError("并发上限必须是正整数");
  let cursor = 0;
  const failures: unknown[] = [];
  const lanes = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: lanes }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      try {
        await worker(items[index]!, index);
      } catch (error) {
        failures.push(error);
      }
    }
  }));
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, `${failures.length} 个任务执行失败`);
}
