import { computed, ref, type Ref } from "vue";
import { nodeTools, z } from "@toonflow/nodes-scaffold/nodeTools";
import type { NodeOutputs } from "@toonflow/nodes-scaffold/values";

export function useNodeGeneration(outputs: Readonly<Ref<NodeOutputs>>, cancel: () => void) {
  const status = ref<"idle" | "running" | "succeeded" | "failed">("idle");
  const error = ref("");
  const generating = computed(() => status.value === "running");
  const getStatus = () => ({ status: status.value, outputs: outputs.value, ...(error.value ? { error: error.value } : {}) });

  nodeTools.register({
    name: "getGenerationStatus",
    description: "查询本次打开节点后的生成状态（idle/running/succeeded/failed）、当前输出和最近一次生成错误。当前输出可能来自之前的生成；idle 不表示没有历史输出，只有 succeeded 表示本次生成成功",
    parameters: z.strictObject({}),
    execute: getStatus,
  });
  nodeTools.register({
    name: "cancelGeneration",
    description: "请求停止当前后台生成；cancellationRequested 表示已发出停止请求，随后用 getGenerationStatus 查询终止状态。不会删除已有输出，不能保证供应商撤销任务或费用",
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
    try {
      const result = await task();
      status.value = "succeeded";
      return result;
    } catch (failure) {
      const cancelled = failure instanceof Error && failure.name === "AbortError";
      const message = (failure as { response?: { data?: { message?: string } } })?.response?.data?.message;
      const reason = message || (failure instanceof Error ? failure.message : "生成失败");
      report?.(cancelled ? "cancelled" : "failed", reason);
      status.value = "failed";
      error.value = cancelled ? "生成已取消" : reason;
      throw failure;
    }
  }

  return { generating, run };
}
