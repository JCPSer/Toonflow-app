import { randomUUID } from "node:crypto";
import { dirname, extname } from "node:path";
import { mkdir, open, rename, rm, stat } from "@toonflow/file";

export type MediaKind = "video" | "image" | "other";

export interface CompressionFacts {
  kind: MediaKind;
  alpha: boolean;
  animated: boolean;
}

/** 压缩计划：action=skip 时 outputExt/outputMime 保持原样，调用方按原文件打包。 */
export interface CompressionPlan {
  action: "transcode" | "skip";
  /** 含点，如 ".mp4" */
  outputExt: string;
  outputMime: string;
  reason?: string;
}

export interface CompressMediaOptions {
  ffmpeg: string;
  input: string;
  output: string;
  plan: CompressionPlan;
  signal?: AbortSignal;
}

const videoExtensions = new Set([".mp4", ".mov", ".m4v", ".webm", ".mkv"]);
const imageExtensions = new Set([".png", ".apng", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".tif", ".tiff"]);

const mediaMime: Record<string, string> = {
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".m4v": "video/x-m4v",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".png": "image/png",
  ".apng": "image/apng",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
};

// ACT: 逗号会切分 filterchain，必须用 ffmpeg 自己的单引号把表达式包起来；整个值作为单个 argv 传入，
// 不加 shell 层引号。宽度显式取偶（641x361 源），高度交给 -2。
const videoScale = "scale='trunc(min(1920,iw)/2)*2':-2";
const imageScale = "scale='min(2048,iw)':'min(2048,ih)':force_original_aspect_ratio=decrease";
// ACT: alpha 判定只关心最小 alpha 值，缩到 1024 以内可把逐像素扫描的内存限制在 4 MiB；alpha 平面均匀时缩放不改变取值。
const alphaScanScale = "scale='min(1024,iw)':'min(1024,ih)':force_original_aspect_ratio=decrease";

export function mediaKind(path: string): MediaKind {
  const extension = extname(path).toLowerCase();
  if (videoExtensions.has(extension)) return "video";
  if (imageExtensions.has(extension)) return "image";
  return "other";
}

export function planCompression(input: string, facts: CompressionFacts): CompressionPlan {
  const extension = extname(input).toLowerCase();
  const originalMime = mediaMime[extension] ?? "application/octet-stream";
  if (facts.kind === "video") {
    // ACT: webm/mkv/mov 与 mp4 一样统一转 H.264 MP4，换格式必须改名（调用方同步改写画布 mimeType）。
    return { action: "transcode", outputExt: ".mp4", outputMime: "video/mp4" };
  }
  if (facts.kind !== "image") {
    return { action: "skip", outputExt: extension, outputMime: originalMime, reason: "非图片/视频文件" };
  }
  if (extension === ".gif") {
    return { action: "skip", outputExt: extension, outputMime: originalMime, reason: "GIF 动图不压缩" };
  }
  if (extension === ".svg") {
    return { action: "skip", outputExt: extension, outputMime: originalMime, reason: "SVG 矢量图不压缩" };
  }
  if (extension === ".tif" || extension === ".tiff") {
    return { action: "skip", outputExt: extension, outputMime: originalMime, reason: "TIFF 不压缩" };
  }
  if (facts.animated) {
    return { action: "skip", outputExt: extension, outputMime: originalMime, reason: "动态图（APNG/动态 WebP）不压缩" };
  }
  if (facts.alpha) {
    // ACT: 有 alpha 只缩放不改格式；非 PNG/WebP 的带 alpha 图片保守落到 PNG，避免 JPEG 静默丢透明。
    const keepWebp = extension === ".webp";
    return keepWebp
      ? { action: "transcode", outputExt: ".webp", outputMime: "image/webp" }
      : { action: "transcode", outputExt: ".png", outputMime: "image/png" };
  }
  return { action: "transcode", outputExt: ".jpg", outputMime: "image/jpeg" };
}

/** 解析 `ffmpeg -encoders`，返回小写编码器名集合；前置检查 libx264 用。 */
export async function probeEncoders(ffmpeg: string, signal?: AbortSignal): Promise<Set<string>> {
  const child = Bun.spawn([ffmpeg, "-hide_banner", "-encoders"], {
    stdin: "ignore", stdout: "pipe", stderr: "ignore", windowsHide: true, signal,
  });
  const [output, code] = await Promise.all([child.stdout.text(), child.exited]);
  signal?.throwIfAborted();
  if (code !== 0) throw new Error(`FFmpeg 读取编码器列表失败（${code}）`);
  const encoders = new Set<string>();
  for (const line of output.split(/\r?\n/)) {
    // 形如 ` V....D libx264   libx264 H.264 ...`；表头 ` V..... = Video` 因 "=" 不匹配而跳过。
    const match = /^\s*[VAS][A-Z.]{5}\s+([a-zA-Z0-9_]+)\s+\S/.exec(line);
    if (match?.[1]) encoders.add(match[1].toLowerCase());
  }
  return encoders;
}

/** 首帧解码到 rgba 后扫描 alpha 字节：存在 <255 即视为含 alpha（pal8+tRNS 也能检出）。 */
export async function hasAlpha(ffmpeg: string, input: string, signal?: AbortSignal): Promise<boolean> {
  const child = Bun.spawn([ffmpeg, "-hide_banner", "-v", "error", "-i", input,
    "-map", "0:v:0", "-frames:v", "1", "-vf", alphaScanScale,
    "-f", "rawvideo", "-pix_fmt", "rgba", "-"], {
    stdin: "ignore", stdout: "pipe", stderr: "pipe", windowsHide: true, signal,
  });
  const [output, stderr, code] = await Promise.all([
    new Response(child.stdout).arrayBuffer(), child.stderr.text(), child.exited,
  ]);
  signal?.throwIfAborted();
  if (code !== 0) throw new Error(`FFmpeg 读取 alpha 失败（${code}）：${stderr.trim().slice(0, 300)}`);
  const bytes = new Uint8Array(output);
  if (bytes.length < 4) throw new Error("FFmpeg 未返回可用的 RGBA 帧");
  for (let index = 3; index < bytes.length; index += 4) {
    if (bytes[index] < 255) return true;
  }
  return false;
}

/** 动态图判定：ffprobe 的 nb_frames>1 / duration>0 / codec=apng，失败时回退读容器头。 */
export async function isAnimated(ffprobe: string, input: string, signal?: AbortSignal): Promise<boolean> {
  signal?.throwIfAborted();
  try {
    const child = Bun.spawn([ffprobe, "-v", "error", "-select_streams", "v:0",
      "-show_entries", "stream=codec_name,nb_frames,duration:format=duration",
      "-of", "json", "-i", input], {
      stdin: "ignore", stdout: "pipe", stderr: "ignore", windowsHide: true, signal,
    });
    const [output, code] = await Promise.all([child.stdout.text(), child.exited]);
    signal?.throwIfAborted();
    if (code === 0) {
      const data = JSON.parse(output) as {
        streams?: { codec_name?: string; nb_frames?: string; duration?: string }[];
        format?: { duration?: string };
      };
      const stream = data.streams?.[0];
      if (stream?.codec_name?.toLowerCase() === "apng") return true;
      const frames = Number(stream?.nb_frames);
      if (Number.isFinite(frames) && frames > 1) return true;
      const duration = Number(stream?.duration ?? data.format?.duration);
      if (Number.isFinite(duration) && duration > 0) return true;
    }
  } catch (error) {
    if (signal?.aborted) throw error;
  }
  // ACT: 当前 ffmpeg 6.0 的 webp 解复用器读不了动画 WebP（无 nb_frames/duration），补一次容器头嗅探。
  return animatedContainer(await readHeader(input));
}

function animatedContainer(header: Uint8Array): boolean {
  const bytes = Buffer.from(header.buffer, header.byteOffset, header.byteLength);
  if (bytes.subarray(0, 4).toString("latin1") === "RIFF"
    && bytes.subarray(8, 12).toString("latin1") === "WEBP"
    && bytes.subarray(12, 16).toString("latin1") === "VP8X") {
    // VP8X 的 flags 字节：bit1 = ANIMATION
    return (header[20] & 0x02) !== 0;
  }
  if (header[0] === 0x89 && bytes.subarray(1, 4).toString("latin1") === "PNG") {
    return bytes.includes("acTL");
  }
  return false;
}

async function readHeader(input: string, length = 8192): Promise<Uint8Array> {
  try {
    const handle = await open(input, "r");
    try {
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, 0);
      return buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  } catch {
    return Buffer.alloc(0);
  }
}

async function hasAudioStream(ffmpeg: string, input: string, signal?: AbortSignal): Promise<boolean> {
  // ACT: 只读元数据不产出输出文件，故退出码为 1 属正常；流信息在 stderr。无音轨时不要传 -c:a。
  const child = Bun.spawn([ffmpeg, "-hide_banner", "-i", input], {
    stdin: "ignore", stdout: "ignore", stderr: "pipe", windowsHide: true, signal,
  });
  const [stderr] = await Promise.all([child.stderr.text(), child.exited]);
  signal?.throwIfAborted();
  return stderr.split(/\r?\n/).some(line => line.includes("Stream #") && line.includes("Audio:"));
}

function transcodeArgs(options: CompressMediaOptions, temporary: string, audio: boolean): string[] {
  const { ffmpeg, input, plan } = options;
  const base = [ffmpeg, "-hide_banner", "-v", "error", "-y", "-i", input];
  if (plan.outputMime.startsWith("video/")) {
    return [...base,
      "-map", "0:v:0", "-map", "0:a:0?",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "24", "-pix_fmt", "yuv420p",
      "-vf", videoScale,
      ...(audio ? ["-c:a", "aac", "-b:a", "128k", "-ac", "2"] : []),
      "-movflags", "+faststart", "-fps_mode", "passthrough", temporary];
  }
  if (plan.outputMime === "image/jpeg") {
    return [...base, "-frames:v", "1", "-vf", imageScale,
      "-q:v", "3", "-pix_fmt", "yuvj420p", "-update", "1", temporary];
  }
  // ACT: 保留 alpha 的 PNG/WebP 只缩放，不传 -pix_fmt，避免把透明通道拍平。
  return [...base, "-frames:v", "1", "-vf", imageScale, "-update", "1", temporary];
}

/**
 * 执行计划中的转码，返回是否真的写了 output。
 * 体积反而变大时删除临时文件、保留原文件并返回 false；调用方据此回退为原样打包。
 */
export async function compressMedia(options: CompressMediaOptions): Promise<boolean> {
  const { ffmpeg, input, output, plan, signal } = options;
  if (plan.action === "skip") return false;
  signal?.throwIfAborted();
  await mkdir(dirname(output), { recursive: true });
  const temporary = `${output}.${randomUUID()}.tmp${plan.outputExt}`;
  const video = plan.outputMime.startsWith("video/");
  try {
    const audio = video ? await hasAudioStream(ffmpeg, input, signal) : false;
    signal?.throwIfAborted();
    const child = Bun.spawn(transcodeArgs(options, temporary, audio), {
      stdin: "ignore", stdout: "ignore", stderr: "pipe", windowsHide: true, signal,
    });
    const [stderr, code] = await Promise.all([child.stderr.text(), child.exited]);
    signal?.throwIfAborted();
    if (code !== 0) throw new Error(`FFmpeg 压缩失败（${code}）：${input}：${stderr.trim().slice(0, 300)}`);
    const [source, compressed] = await Promise.all([stat(input), stat(temporary)]);
    if (!compressed.size) throw new Error(`FFmpeg 未写出有效文件：${input}`);
    if (compressed.size > source.size) {
      await rm(temporary, { force: true }).catch(() => {});
      return false;
    }
    await rename(temporary, output);
    return true;
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}
