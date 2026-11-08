import type { BrowserFfmpegCommand } from "@toonflow/nodes-scaffold/runtime";

export type FfmpegTaskOptions = {
  timeoutMs: number;
  timeoutMessage: string;
  abortMessage: string;
};

/**
 * 执行一条宿主 ffmpeg 命令，统一处理超时与取消。
 * ACT: kill 只是取消握手，子进程还在收尾；必须等 end/error 到达（或 2s 宽限）才算结束，
 * 否则调用方立刻删目录会和仍在写盘的 ffmpeg 交错。
 * ACT: kill 后宿主会先回一个 AbortError，如果直接透传，超时的真实原因会被「已取消」盖掉，
 * 所以先记下超时/取消原因，end 与 error 都以它为准。
 */
export function runFfmpegCommand(command: BrowserFfmpegCommand, signal: AbortSignal, options: FfmpegTaskOptions) {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let stopReason: unknown;
    const abortError = () => signal.reason ?? new Error(options.abortMessage);
    function finish(reason?: unknown) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      if (reason === undefined) resolve();
      else reject(reason);
    }
    function stop(reason: unknown) {
      stopReason ??= reason;
      command.kill("SIGKILL");
      setTimeout(() => finish(stopReason), 2000);
    }
    function abort() { stop(abortError()); }
    const timer = setTimeout(() => stop(new Error(options.timeoutMessage)), options.timeoutMs);
    if (signal.aborted) return abort();
    signal.addEventListener("abort", abort, { once: true });
    command.on("end", () => finish(stopReason ?? (signal.aborted ? abortError() : undefined)));
    command.on("error", (reason: Error) => finish(stopReason ?? (signal.aborted ? abortError() : reason)));
    // ACT: run() 同步抛错时也要清掉定时器与 abort 监听，不能把 Promise 之外的资源留着。
    try { command.run(); } catch (reason) { finish(reason); }
  });
}
