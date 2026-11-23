import { watch, type Ref } from "vue";

export type NodeGenerationStatus = "idle" | "running" | "succeeded" | "failed";

/**
 * ACT: 等到本次生成不再处于 running。状态变化就 resolve，不轮询、不猜时长；
 * 工具调用被中断（停止/打断/节点卸载）时用 AbortError 结束等待，避免把整轮卡死。
 * 单独成文是为了能脱离节点运行时做纯逻辑单测。
 */
export function waitForGenerationStatus(status: Readonly<Ref<NodeGenerationStatus>>, signal?: AbortSignal) {
  if (status.value !== "running") return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    let stop: (() => void) | undefined;
    const cleanup = () => {
      stop?.();
      signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(signal?.reason ?? Object.assign(new Error("生成等待已中断"), { name: "AbortError" }));
    };
    // flush: sync —— 状态从 running 切到终态的同一拍就放行，不额外等一次渲染。
    stop = watch(status, value => {
      if (value === "running") return;
      cleanup();
      resolve();
    }, { flush: "sync" });
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
