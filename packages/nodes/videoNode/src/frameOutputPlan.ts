/**
 * 首帧 / 尾帧输出的纯逻辑：端口表与 ffmpeg 参数。
 * 不依赖 Vue、ffmpeg 运行时或工作区，便于单测；宿主调用见 `frameOutput.ts`。
 */

export type FrameKey = "first" | "last";
export type FrameOutputConfig = Partial<Record<FrameKey, boolean>>;

export type FrameOutputMeta = { key: FrameKey; handleId: string; fileName: string; label: string };

/** ACT: handleId 一旦发布就不能改——画布 JSON 里的连线与输出值都以它为键。 */
export const FRAME_OUTPUTS: readonly FrameOutputMeta[] = [
  { key: "first", handleId: "firstFrame", fileName: "frame-first.jpg", label: "首帧" },
  { key: "last", handleId: "lastFrame", fileName: "frame-last.jpg", label: "尾帧" },
];

/** ACT: JPEG q:v 2 约等于 95 质量；4:4:4 不降采样色度，下游当生成参考时不会出现彩边。 */
export const JPEG_OUTPUT_OPTIONS = ["-c:v", "mjpeg", "-q:v", "2", "-pix_fmt", "yuvj444p", "-update", "1", "-y"] as const;

export function frameOutputMeta(key: FrameKey): FrameOutputMeta {
  return FRAME_OUTPUTS.find((item) => item.key === key)!;
}

export function enabledFrameOutputs(config: FrameOutputConfig | undefined): FrameOutputMeta[] {
  return FRAME_OUTPUTS.filter((item) => config?.[item.key] === true);
}

/**
 * 按已开启的项拼出完整端口表；同名端口先剔除，避免重复。
 * 顺序固定为「声明期端口 → 首帧 → 尾帧」，关闭中间一路时后面的端口上移。
 */
export function buildFrameHandles<T extends { id: string; type: "source" | "target" }>(
  config: FrameOutputConfig | undefined,
  base: readonly T[],
): (T | { id: string; type: "source"; dataType: "IMAGE"; label: string })[] {
  const owned = new Set(FRAME_OUTPUTS.map((item) => item.handleId));
  return [
    ...base.filter((item) => !owned.has(item.id)),
    ...enabledFrameOutputs(config).map((item) => ({ id: item.handleId, type: "source" as const, dataType: "IMAGE" as const, label: `${item.label}输出` })),
  ];
}

/** 声明期端口：`defineOptions({ handles })` 挂在组件类型上，与 useNode 取默认值的口径一致。 */
export function staticNodeHandles<T extends { id: string; type: "source" | "target" }>(component: unknown): T[] {
  const handles = (component as { handles?: unknown } | undefined)?.handles;
  return Array.isArray(handles) ? handles as T[] : [];
}

/**
 * 抽一帧的 ffmpeg 参数。
 * - 首帧：不 seek，取第一帧。
 * - 尾帧：`-sseof -1` 是**输入选项**，从末尾 1s 解到结尾，逐帧覆盖同一文件，落盘即最后一帧。
 * - `-map 0:v:0` 固定首个视频流，避开带封面图（attached_pic）的素材；`-update 1` 让 image2 复用固定文件名。
 */
export function frameOutputOptions(key: FrameKey) {
  const output = [...JPEG_OUTPUT_OPTIONS, "-map", "0:v:0"];
  if (key === "first") output.push("-frames:v", "1");
  return { input: key === "last" ? ["-sseof", "-1"] : [], output };
}
