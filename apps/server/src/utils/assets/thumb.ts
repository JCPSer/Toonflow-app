import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, realpath, rename, unlink } from "@toonflow/file";
import { dirname, join } from "node:path";
import { mentionAssetType } from "@/agent/mentionSources";
import conf from "@/utils/conf";
import { getStatus } from "@/utils/ffmpeg";

const thumbEdge = 256;
const maxConcurrent = 2;
const cacheDirectory = join(dirname(conf.path), "cache", "thumbs");
let active = 0;
const waiters: (() => void)[] = [];
const pending = new Map<string, Promise<void>>();

async function withSlot<T>(task: () => Promise<T>) {
  if (active >= maxConcurrent) await new Promise<void>(resolve => waiters.push(resolve));
  active++;
  try { return await task(); }
  finally {
    active--;
    waiters.shift()?.();
  }
}

async function ffmpegPath() {
  const status = await getStatus();
  return status.tools.ffmpeg.path;
}

async function generateThumbnail(absolutePath: string, cachePath: string, dataType: string, size: number) {
  const ffmpeg = await ffmpegPath();
  if (!ffmpeg) throw new Error("FFmpeg 不可用");
  await mkdir(cacheDirectory, { recursive: true });
  const temporary = join(cacheDirectory, `.${randomUUID()}.jpg`);
  const args = [ffmpeg, "-y", ...(dataType === "VIDEO" ? ["-ss", "0.5"] : []), "-i", absolutePath,
    "-frames:v", "1", "-vf", `scale=${size}:${size}:force_original_aspect_ratio=decrease`,
    "-q:v", "3", "-pix_fmt", "yuvj420p", "-f", "image2", temporary];
  try {
    // ACT: 缓存目录可能不在项目库所在卷，直接调用已验证路径的 ffmpeg，避免把临时文件写进项目。
    const child = Bun.spawn(args, { stdout: "ignore", stderr: "pipe", windowsHide: true });
    const [code] = await Promise.all([child.exited, child.stderr.text()]);
    if (code !== 0) throw new Error(`FFmpeg 生成缩略图失败（${code}）`);
    await rename(temporary, cachePath);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

/**
 * 返回缓存文件与 ETag；无法生成或 FFmpeg 不可用时返回 null，由前端回退 /read 原图或图标。
 * 缓存放在数据目录而不是库根，避免缩略图进入项目复制和项目包。
 */
export async function ensureAssetThumbnail(root: string, relativePath: string, absolutePath: string, size: number, mtimeMs: number,
  edge = thumbEdge) {
  const dataType = mentionAssetType(relativePath).dataType;
  if (dataType !== "IMAGE" && dataType !== "VIDEO") return null;
  const real = await realpath(absolutePath);
  const requestedEdge = Math.max(1, Math.min(2048, Math.round(edge)));
  // ACT: 缓存键包含目标边长，切换 size 时不会复用旧尺寸的缩略图。
  const hash = createHash("sha1").update(`${real}|${size}|${mtimeMs}|${requestedEdge}`).digest("hex");
  const cachePath = join(cacheDirectory, `${hash}.jpg`);
  if (await lstat(cachePath).catch(() => null)) return { path: cachePath, etag: hash };
  const existing = pending.get(cachePath);
  if (existing) {
    await existing.catch(() => {});
    return await lstat(cachePath).catch(() => null) ? { path: cachePath, etag: hash } : null;
  }
  const task = withSlot(() => generateThumbnail(real, cachePath, dataType, requestedEdge)).finally(() => { pending.delete(cachePath); });
  pending.set(cachePath, task);
  try { await task; }
  catch (error) {
    if (await lstat(cachePath).catch(() => null)) return { path: cachePath, etag: hash };
    console.warn("缩略图生成失败：", relativePath, error);
    return null;
  }
  return { path: cachePath, etag: hash };
}
