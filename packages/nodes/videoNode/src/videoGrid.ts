/**
 * 宫格抽帧的公共部分：探测视频信息、拼 ffmpeg 输出参数。
 * 「查看视频」与宫格输出端口共用这一份，避免两处各写一套滤镜与流选择。
 * 临时文件命名、rename、旧产物清理与代次校验由调用方负责（两边的生命周期不同）。
 */

import type { BrowserFfmpegFactory, FfprobeData } from "@toonflow/nodes-scaffold/runtime";
import { gridCell, gridFilter, readVideoMeta, videoMapSpec, type GridCount } from "./inspectPlan";
import { JPEG_OUTPUT_OPTIONS } from "./jpegOptions";

const probeTimeoutMs = 15000;

/** ACT: ffprobe 走宿主命令，超时与取消都要能杀掉解析进程，否则调用方会一直等。 */
export function probeVideo(factory: BrowserFfmpegFactory, path: string, signal: AbortSignal) {
  return new Promise<FfprobeData>((resolve, reject) => {
    const command = factory(path);
    let settled = false;
    const finish = (reason: unknown, data?: FfprobeData) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      if (reason !== undefined) reject(reason);
      else resolve(data!);
    };
    const abort = () => { command.kill(); finish(signal.reason ?? new Error("读取视频信息已取消")); };
    const timer = setTimeout(() => { command.kill(); finish(new Error("读取视频信息超时")); }, probeTimeoutMs);
    if (signal.aborted) return abort();
    signal.addEventListener("abort", abort, { once: true });
    command.ffprobe((error, data) => finish(error ?? undefined, data));
  });
}

export type GridVideoMeta = ReturnType<typeof readVideoMeta>;

/** 探测并归一：时长取视频流与容器较小值，旋转视频按实际画面交换宽高。 */
export async function probeVideoMeta(factory: BrowserFfmpegFactory, path: string, signal: AbortSignal) {
  return readVideoMeta(await probeVideo(factory, path, signal));
}

/** 宫格输出参数：`fps` 采样 → 等比缩放 → 补边 → 拼图，一次解完直接出图。 */
export function gridOutputOptions(meta: { duration: number; width: number; height: number; index?: number }, count: GridCount) {
  return [
    ...JPEG_OUTPUT_OPTIONS,
    "-frames:v", "1",
    "-map", videoMapSpec(meta),
    "-vf", gridFilter(meta.duration, count, gridCell(meta.width, meta.height)),
  ];
}
