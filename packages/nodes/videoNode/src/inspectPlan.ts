/**
 * 「Agent 查看视频」的纯逻辑：宫格排布、采样时间点、探测结果解析、文件名与清理规则。
 * 不依赖 Vue、ffmpeg 运行时或工作区，便于单测；执行见 `inspectVideo.ts`。
 */

export type GridCount = 4 | 9 | 16;
export const defaultGridCount: GridCount = 9;
/** 一次截帧最多几个时间点：再多会让 Agent 读图成本超过宫格。 */
export const maxCapturePoints = 6;
export const gridLayouts: Record<GridCount, { columns: number; rows: number }> = {
  4: { columns: 2, rows: 2 },
  9: { columns: 3, rows: 3 },
  16: { columns: 4, rows: 4 },
};
/**
 * 单格长边像素：3×3 横屏宫格 1536×864，4×4 恰好 2048×1152（`read` 的上限），2×2 为 1024×576。
 * ACT: 512 是「不被模型二次缩放」的上限——Claude 系视觉长边约 1568，再大只是多花 token；
 * 短边按视频比例算，竖屏视频不会只剩中间一条画面。
 * 取偶数是因为补边滤镜在 yuv420p 等格式下不接受奇数尺寸，不能只靠 `-pix_fmt yuvj444p` 兜底。
 */
export const gridCellLongEdge = 512;
export const gridCellMinEdge = 64;
export const gridCellFallbackRatio = 16 / 9;
/** 多采一帧：fps 滤镜在时长与输出帧率整除时可能少出一帧，多出的那帧由 tile 丢弃。 */
export const gridSampleExtra = 1;
export const inspectFolder = "inspect";
/** 两类产物各自覆盖：宫格对宫格、单帧对单帧，调用之间不会互相删掉。 */
export const gridFilePattern = /^contact-[0-9]+\.jpg$/;
export const frameFilePattern = /^frame-[0-9]+ms\.jpg$/;
/** 临时文件也必须被清理规则命中：取消或崩溃时不能留下半截图。 */
export const temporaryFilePattern = /\.tmp\.jpg$/;

/**
 * 清理判定：同类旧产物、以及上一轮残留的临时文件都该删。
 * ACT: `keep` 是本次刚写好的临时文件——它也以 `.tmp.jpg` 结尾，必须排除，
 * 否则会被清理规则顺手删掉，导致随后「文件是否生成」的检查失败，误报成帧数不足。
 */
export function isStaleOutput(name: string, pattern: RegExp, keep?: string) {
  if (keep !== undefined && name === keep) return false;
  return pattern.test(name) || temporaryFilePattern.test(name);
}

/** ACT: 与首/尾帧、宫格输出共用同一份 JPEG 参数，避免调质量时两处漂移。 */
export { JPEG_OUTPUT_OPTIONS as inspectJpegOptions } from "./jpegOptions";

export function isGridCount(value: unknown): value is GridCount {
  return value === 4 || value === 9 || value === 16;
}

export function gridLayout(count: GridCount) {
  return gridLayouts[count];
}

/** fps 滤镜的输出帧率：多取一帧余量，避免整除时少一帧导致拼不出图。 */
export function gridFps(duration: number, count: GridCount) {
  return (count + gridSampleExtra) / duration;
}

/**
 * 采样点：fps 滤镜把帧对齐到输出时间轴的中点，第一个采样点就是半个间隔处，
 * 因此格 i 对应原片 `(i + 0.5) * 时长 / (帧数 + 1)`——首格不贴开头、末格也不落片尾。
 */
export function gridSampleTimes(duration: number, count: GridCount): number[] {
  const interval = duration / (count + gridSampleExtra);
  return Array.from({ length: count }, (_, index) => {
    const seconds = Math.min(duration - 0.01, (index + 0.5) * interval);
    return Math.max(0, Math.round(seconds * 100) / 100);
  });
}

/** 旋转 90°/270° 的视频，ffprobe 的宽高是编码尺寸，实际画面要反过来——宫格单格比例按实际画面算。 */
export function displaySize(width: number, height: number, rotation = 0) {
  const normalized = Math.abs(rotation) % 360;
  return normalized === 90 || normalized === 270 ? { width: height, height: width } : { width, height };
}

function evenEdge(size: number) {
  return Math.max(gridCellMinEdge, Math.floor(size / 2) * 2);
}

/** 单格尺寸跟随视频比例：长边固定 400，短边按比例缩，竖屏不会只剩一条画面。 */
export function gridCell(width: number, height: number) {
  const ratio = width > 0 && height > 0 ? width / height : gridCellFallbackRatio;
  if (ratio >= 1) return { width: gridCellLongEdge, height: evenEdge(gridCellLongEdge / ratio) };
  return { width: evenEdge(gridCellLongEdge * ratio), height: gridCellLongEdge };
}

/**
 * 宫格滤镜链：先按等比缩小到单格、再补黑边到单格尺寸（等比时补 0–1 像素），最后拼图。
 * `fps` 取 `(帧数 + 1) / 时长`，一条命令解完直接出图，不做场景检测。
 */
export function gridFilter(duration: number, count: GridCount, cell: { width: number; height: number }) {
  const { columns, rows } = gridLayout(count);
  const fps = gridFps(duration, count).toFixed(6);
  return [
    `fps=${fps}`,
    // ACT: setsar=1 把非方形像素归一到 1:1，否则变形素材拼格后整体比例会偏。
    `scale=${cell.width}:${cell.height}:force_original_aspect_ratio=decrease,setsar=1`,
    `pad=${cell.width}:${cell.height}:(ow-iw)/2:(oh-ih)/2:color=black`,
    `tile=${columns}x${rows}`,
  ].join(",");
}

/** 查看产物目录：与 nodes-scaffold 的 ensureNodeDirectory（`assets/<nodeId>`）保持一致。 */
export function inspectDirectoryPath(nodeId: string) {
  return `assets/${nodeId}/${inspectFolder}`;
}

export function gridFile(count: GridCount) {
  return `contact-${count}.jpg`;
}

/** 毫秒命名：整数、排序稳定，也能避免 3.20 与 3.2 生成两个文件。 */
export function frameFile(seconds: number) {
  // ACT: 先把秒归一到百分秒再换算，3.204 与 3.2 落到同一个文件名，不会留下两份几乎相同的帧。
  return `frame-${Math.round(seconds * 100) * 10}ms.jpg`;
}

/** 唯一临时名：固定文件名 + 「文件已存在即通过」会把上一版视频的帧当成新结果。 */
export function temporaryFile(directory: string, name: string) {
  return `${directory}/.${name}.${crypto.randomUUID()}.tmp.jpg`;
}

/** 时间点去重排序并把越界项拒掉；返回给 Agent 的 seconds 与文件名共用这一份结果。 */
export function normalizeCaptureSeconds(values: readonly number[], duration: number): number[] {
  if (!Array.isArray(values) || !values.length) throw new Error("至少需要一个时间点（秒）");
  if (values.length > maxCapturePoints) throw new Error(`一次最多截取 ${maxCapturePoints} 个时间点`);
  const unique = new Map<number, number>();
  for (const value of values) {
    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("时间点必须是秒数");
    if (value < 0) throw new Error("时间点不能为负数");
    // ACT: 先归一再判越界：9.999 会四舍五入成 10.00，按原值放行后 ffmpeg 必然取不到帧。
    const seconds = Math.round(value * 100) / 100;
    if (seconds >= duration) throw new Error(`时间点 ${seconds} 超出视频时长 ${duration.toFixed(2)} 秒`);
    unique.set(Math.round(seconds * 1000), seconds);
  }
  return [...unique.values()].sort((left, right) => left - right);
}

export type ProbeStream = {
  index?: number;
  codec_type?: string;
  width?: number;
  height?: number;
  duration?: string | number;
  disposition?: { attached_pic?: number };
  tags?: { rotate?: string };
  side_data_list?: { rotation?: number }[];
};
/** ACT: ffprobe 的时长在格式层是字符串、在部分流层是数字，两种都要能读。 */
export type ProbeData = { format?: { duration?: string | number }; streams?: ProbeStream[] };

/** 手机视频常见旋转标记：旧版 ffprobe 放 tags.rotate，新版放 side_data_list 的 Display Matrix。 */
export function streamRotation(stream: ProbeStream) {
  const tag = Number(stream.tags?.rotate);
  if (Number.isFinite(tag) && tag) return tag;
  const side = stream.side_data_list?.find(item => typeof item.rotation === "number")?.rotation;
  return Number.isFinite(side) ? side! : 0;
}

/**
 * ACT: 只认带画面且不是封面图的视频流。
 * ACT: 时长取「视频流时长」与「容器时长」的较小值——音轨比画面长时，容器时长会让 fps 采样越过
 * 视频末帧，tile 收到的帧数不足就不会出图；两者都没有才报错。
 */
export function readVideoMeta(data: ProbeData) {
  const stream = data.streams?.find(item => item.codec_type === "video" && !item.disposition?.attached_pic);
  if (!stream) throw new Error("文件里没有可用的视频画面");
  const candidates = [Number(stream.duration), Number(data.format?.duration)].filter(value => Number.isFinite(value) && value > 0);
  const duration = candidates.length ? Math.min(...candidates) : 0;
  if (!(duration > 0)) throw new Error("无法读取视频时长，无法按时间抽帧");
  const size = displaySize(Number(stream.width) || 0, Number(stream.height) || 0, streamRotation(stream));
  return { duration, width: size.width, height: size.height, index: stream.index };
}

/**
 * ffmpeg 的流选择：
 * ACT: `0:v:0` 会算上封面图（attached_pic），按 ffprobe 的流序号精确取；序号缺失时用大写 `V` 跳过封面图。
 */
export function videoMapSpec(meta: { index?: number }) {
  return typeof meta.index === "number" ? `0:${meta.index}` : "0:V:0";
}
