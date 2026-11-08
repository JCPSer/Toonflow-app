/**
 * 等待共享任务，但保留每个调用方自己的取消语义：取消只结束本次等待，不中断共享任务本身。
 * 共享任务必须自己处理取消；这里只负责让等待者立即退出，并保证两个分支都被消费。
 */
export function awaitAbortable<T>(task: Promise<T>, signal?: AbortSignal) {
  if (!signal) return task;
  // 统一返回 Promise：已取消时也走 reject，避免调用方需要同时处理同步抛错。
  try { signal.throwIfAborted(); } catch (error) { return Promise.reject(error); }
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      try { signal.throwIfAborted(); } catch (error) { reject(error); }
    };
    signal.addEventListener("abort", abort, { once: true });
    task.then(
      value => { signal.removeEventListener("abort", abort); resolve(value); },
      error => { signal.removeEventListener("abort", abort); reject(error); },
    );
  });
}
