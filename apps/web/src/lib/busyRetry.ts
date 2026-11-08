import axios from "axios";

/**
 * 文件冲突（EBUSY）的退避重试。
 *
 * ACT: 服务端的变更类文件操作是「先取锁再执行」，冲突时立刻返回 409 EBUSY，此时没有任何副作用，
 * 重试是安全的。节点批量结束时短时间撞同一路径很常见，退避半秒内基本都能排到。
 * ACT: 只认 409 + data.code=EBUSY；其他 409（版本冲突 EEXIST/ESTALE）不允许自动重试。
 */

export interface BusyRetryOptions {
  /** 最多尝试次数（含首次），默认 4。 */
  attempts?: number;
  /** 首次退避毫秒数，按指数翻倍，默认 60。 */
  baseDelayMs?: number;
  /** 测试用：替换计时器。 */
  sleep?: (ms: number) => Promise<void>;
  /** 测试用：替换抖动随机数。 */
  random?: () => number;
}

const defaultSleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export function isBusyError(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return false;
  if (error.response?.status !== 409) return false;
  const payload = error.response.data as { data?: { code?: string } } | undefined;
  return payload?.data?.code === "EBUSY";
}

export async function withBusyRetry<T>(action: () => Promise<T>, options: BusyRetryOptions = {}): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 4);
  const baseDelay = Math.max(0, options.baseDelayMs ?? 60);
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;
  for (let attempt = 0; ; attempt++) {
    try {
      return await action();
    } catch (error) {
      if (attempt >= attempts - 1 || !isBusyError(error)) throw error;
      // ACT: 60/120/240ms 加 0–60ms 抖动，避免多个节点同时醒来再次撞车。
      await sleep(baseDelay * 2 ** attempt + Math.floor(random() * 60));
    }
  }
}
