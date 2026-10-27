interface ExecHandle {
  terminate(): void;
  finished: Promise<void>;
}

const running = new Map<string, ExecHandle>();

// ACT: Bun 的静默 SSE 不保证触发断开事件，显式取消接口才是终止命令的主要途径；这里保存可取消的句柄。
export function registerExec(key: string, handle: ExecHandle) {
  if (running.has(key)) throw Object.assign(new Error("命令已在执行"), { status: 409 });
  running.set(key, handle);
}

export function unregisterExec(key: string) {
  running.delete(key);
}

// ACT: 命中后等待路由收尾完成再返回，调用方拿到响应时进程组已经结束。
export async function cancelExec(key: string) {
  const handle = running.get(key);
  if (!handle) return false;
  handle.terminate();
  await handle.finished;
  return true;
}
