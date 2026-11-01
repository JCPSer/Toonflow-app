import { z, type NodeToolDefinition } from "@toonflow/nodes-scaffold/runtime";
import { FRAME_OUTPUTS, type FrameKey } from "./frameOutputPlan";

/** 一次开关的完整结果，供 Agent 直接使用（路径为工作区相对路径）。 */
export type FrameApplyResult = {
  key: FrameKey;
  enabled: boolean;
  handleId: string;
  path: string | null;
  /** true = 端口已建立但还没有帧（节点尚无视频，或视频就绪后会补抽）。 */
  pending: boolean;
  /** pending 的原因：no-video = 还没有视频；extracting = 抽帧在途；idle = 已开启但没有帧也没有任务在跑（通常是上次失败）。 */
  pendingReason?: "no-video" | "extracting" | "idle";
  /** 该路最近一次失败原因；成功或重新开启后清空。 */
  error?: string;
  /** 关闭时被宿主断开的连线数。 */
  removedEdges: number;
};

export type FrameOutputState = { enabled: boolean; path: string | null; pendingReason?: "no-video" | "extracting" | "idle"; error?: string };

/**
 * 工具需要的全部能力，`useFrameOutputs` 的返回值天然满足。
 * 保持接口最小，桩对象即可单测，不依赖 Vue 生命周期。
 */
export type FrameOutputController = {
  apply(key: FrameKey, on: boolean, signal?: AbortSignal): Promise<FrameApplyResult>;
  state(key: FrameKey): FrameOutputState;
};

/** axios 的 message 只有状态码，真正原因在响应体里；工具要把可读原因交给模型。 */
export function frameErrorMessage(cause: unknown) {
  const payload = (cause as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
  if (typeof payload === "string" && payload.trim()) return payload;
  return cause instanceof Error && cause.message ? cause.message : "抽帧失败";
}

function toToolResult(result: FrameApplyResult) {
  return {
    enabled: result.enabled,
    handleId: result.handleId,
    path: result.path,
    pending: result.pending,
    ...(result.pendingReason ? { pendingReason: result.pendingReason } : {}),
    ...(result.error ? { error: result.error } : {}),
    removedEdges: result.removedEdges,
  };
}

const frameOutputParameters = z.strictObject({
  first: z.boolean().optional().describe("是否开启首帧输出"),
  last: z.boolean().optional().describe("是否开启尾帧输出"),
});

/**
 * `setFrameOutputs` 的唯一定义：两个视频节点共用，保证 Agent 看到的能力一致。
 * 未传的项返回当前状态，Agent 一次调用即可拿到全貌。
 */
export function createFrameOutputTool(frames: FrameOutputController): NodeToolDefinition<typeof frameOutputParameters> {
  return {
    name: "setFrameOutputs",
    description:
      "开启或关闭此视频节点的首帧/尾帧输出端口。开启时按当前视频抽取 JPEG 并写入输出值，抽完才返回；节点还没有视频时先建端口并返回 pending=true、pendingReason=no-video，视频就绪后自动补帧。视频生成节点正在生成时会先对旧视频抽帧，生成完成后自动重抽；需要最新画面请等生成结束再查询。需要把首帧/尾帧交给下游图片节点时先调用本工具，再用 connectNodes 连接 firstFrame/lastFrame。关闭会移除端口并断开其上的连线，返回 removedEdges。未传的项保持原状态。",
    parameters: frameOutputParameters,
    async execute(patch, { signal }) {
      const result: Partial<Record<FrameKey, ReturnType<typeof toToolResult> & { error?: string }>> = {};
      for (const meta of FRAME_OUTPUTS) {
        signal?.throwIfAborted();
        const on = patch[meta.key];
        if (on === undefined) {
          const current = frames.state(meta.key);
          result[meta.key] = {
            enabled: current.enabled,
            handleId: meta.handleId,
            path: current.path,
            pending: current.enabled && !current.path,
            ...(current.pendingReason ? { pendingReason: current.pendingReason } : {}),
            ...(current.error ? { error: current.error } : {}),
            removedEdges: 0,
          };
          continue;
        }
        try {
          result[meta.key] = toToolResult(await frames.apply(meta.key, on, signal));
        } catch (cause) {
          // ACT: 调用方主动取消要整体 reject，不能吞成某一项的业务错误。
          if (signal?.aborted) throw cause;
          // ACT: 单项失败不抛整体错误，另一项的成功结果仍要交给 Agent。
          const current = frames.state(meta.key);
          result[meta.key] = {
            enabled: current.enabled,
            handleId: meta.handleId,
            path: current.path,
            pending: current.enabled && !current.path,
            ...(current.pendingReason ? { pendingReason: current.pendingReason } : {}),
            removedEdges: 0,
            error: frameErrorMessage(cause),
          };
        }
      }
      return result;
    },
  };
}
