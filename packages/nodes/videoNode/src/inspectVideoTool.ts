import { z, type NodeToolDefinition } from "@toonflow/nodes-scaffold/runtime";
import { defaultGridCount, maxCapturePoints } from "./inspectPlan";
import type { VideoInspect } from "./inspectVideo";

const sampleParameters = z.strictObject({
  count: z.union([z.literal(4), z.literal(9), z.literal(16)]).optional()
    .describe(`宫格帧数：4 = 2×2、9 = 3×3、16 = 4×4，默认 ${defaultGridCount}`),
});

const captureParameters = z.strictObject({
  seconds: z.array(z.number().finite().min(0)).min(1).max(maxCapturePoints)
    .describe(`要截取的时间点（秒），1–${maxCapturePoints} 个，自动去重排序`),
});

/**
 * 两个视频节点共用的 Agent 查看工具：宫格看全片结构、单帧看细节。
 * 未注册到画布 UI，只通过「节点函数」暴露给 Agent。
 */
export function createVideoInspectTools(inspect: VideoInspect) {
  const sampleFrames: NodeToolDefinition<typeof sampleParameters> = {
    name: "sampleFrames",
    description:
      "把此节点的视频按时间均匀抽帧拼成一张宫格联系表，用于快速了解全片的构图、动作、转场与节奏（不含片尾最后一小段，需要时再用 captureFrame）。"
      + `count 可选 4（2×2）、9（3×3，默认）、16（4×4）。返回的 path 是工作区相对路径，必须用 read 工具打开图片才能看到画面；`
      + "frameTimes 按从左到右、从上到下给出每格对应的秒数（近似值，误差不超过一个采样间隔）。宫格只用于查看，不是节点输出，不改变首尾帧端口；"
      + "再次调用会覆盖上一批产物，之前返回的 path 会失效。",
    parameters: sampleParameters,
    execute({ count }, { signal }) {
      return inspect.sampleFrames(count ?? defaultGridCount, signal ?? new AbortController().signal);
    },
  };

  const captureFrame: NodeToolDefinition<typeof captureParameters> = {
    name: "captureFrame",
    description:
      "按指定时间点从此节点的视频截取全分辨率单帧，一次可传 1–6 个时间点（秒）。"
      + "返回每张图的 path（工作区相对路径），必须用 read 工具打开才能看到画面；个别时间点失败会列在 failures 里，其余照常返回；"
      + "一次调用时间预算有限，返回 truncated=true 表示还没截完，需要再次调用。"
      + "单帧只用于查看，不是节点输出；再次调用会覆盖上一批产物，之前返回的 path 会失效。只想先了解全片时优先用 sampleFrames，避免逐点截帧。",
    parameters: captureParameters,
    execute({ seconds }, { signal }) {
      return inspect.captureFrame(seconds, signal ?? new AbortController().signal);
    },
  };

  return { sampleFrames, captureFrame };
}
