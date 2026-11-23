import { computed, ref, type Ref } from "vue";
import { nodeTools, z } from "@toonflow/nodes-scaffold/nodeTools";
import type { NodeOutputs } from "@toonflow/nodes-scaffold/values";
import { waitForGenerationStatus, type NodeGenerationStatus } from "./generationStatus";

export { waitForGenerationStatus, type NodeGenerationStatus } from "./generationStatus";

export function useNodeGeneration(outputs: Readonly<Ref<NodeOutputs>>, cancel: () => void) {
  const status = ref<NodeGenerationStatus>("idle");
  const error = ref("");
  const cancelled = ref(false);
  const generating = computed(() => status.value === "running");
  // ACT: outputs 可能是上一次成功留下的；succeeded 才代表本次生成有新结果，cancelled 区分用户取消与真实失败。
  const getStatus = () => ({ status: status.value, cancelled: cancelled.value, outputs: outputs.value, ...(error.value ? { error: error.value } : {}) });

  nodeTools.register({
    name: "getGenerationStatus",
    description: "查询本次打开节点后的生成状态（idle/running/succeeded/failed）、是否取消、当前输出和最近一次生成错误。只做即时查询；需要等生成结束时用 waitForGeneration，不要 sleep 或反复轮询。当前输出可能来自之前的生成，只有 succeeded 表示本次生成成功",
    parameters: z.strictObject({}),
    execute: getStatus,
  });
  nodeTools.register({
    name: "waitForGeneration",
    // ACT: 阻塞到本次生成结束，返回终态与输出；调用时已结束则立即返回。
    description: "等待本次生成结束（阻塞到 succeeded 或 failed），返回 status、cancelled、error 和 outputs；启动生成后直接调用它，不要用 sleep、bash 或反复 getGenerationStatus 轮询。取消/停止/打断会结束等待并报中断。outputs 可能来自之前的生成，只有 status=succeeded 表示本次成功",
    parameters: z.strictObject({}),
    async execute(_args, { signal }) {
      await waitForGenerationStatus(status, signal);
      return getStatus();
    },
  });
  nodeTools.register({
    name: "cancelGeneration",
    description: "请求停止当前后台生成；cancellationRequested 表示已发出停止请求，随后用 waitForGeneration 等它真正结束。不会删除已有输出，不能保证供应商撤销任务或费用",
    parameters: z.strictObject({}),
    execute() {
      const cancellationRequested = generating.value;
      if (cancellationRequested) cancel();
      return { ...getStatus(), cancellationRequested };
    },
  });

  /**
   * 执行一次生成。report 用来把结果写进全局节点任务表（markNodeOutcome）：
   * ACT: 必须在 status 变成 failed 之前调用——节点 busy 的下降沿会立刻派发完成事件，
   * 晚一步宿主读到的就是默认的 succeeded，失败提醒会被吞掉。
   */
  async function run<T>(task: () => Promise<T>, report?: (outcome: "failed" | "cancelled", reason?: string) => void): Promise<T> {
    if (generating.value) throw new Error("节点正在生成，请等待完成");
    status.value = "running";
    error.value = "";
    cancelled.value = false;
    try {
      const result = await task();
      status.value = "succeeded";
      return result;
    } catch (failure) {
      const aborted = failure instanceof Error && failure.name === "AbortError";
      const message = (failure as { response?: { data?: { message?: string } } })?.response?.data?.message;
      const reason = message || (failure instanceof Error ? failure.message : "生成失败");
      report?.(aborted ? "cancelled" : "failed", reason);
      status.value = "failed";
      cancelled.value = aborted;
      error.value = aborted ? "生成已取消" : reason;
      throw failure;
    }
  }

  return { generating, run };
}
