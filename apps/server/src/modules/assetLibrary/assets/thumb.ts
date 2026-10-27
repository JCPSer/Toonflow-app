import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, readFile, realpath, rename, rm, stat, unlink, writeFile } from "@toonflow/file";
import { dirname, join } from "node:path";
import { mentionAssetType } from "@/lib/mentionSources";
import conf from "@/modules/platformCore/conf";
import { getStatus } from "@/modules/mediaGeneration/ffmpeg";

const thumbEdge = 256;
const maxConcurrent = 2;
// ACT: 缓存放在数据目录而不是库根，避免缩略图进入项目复制和项目包。
const cacheDirectory = join(dirname(conf.path), "cache", "thumbs");
// ACT: 缓存目录按「源文件 realpath 的 sha1」分一级，删除源文件时可直接整目录回收，无需反推尺寸组合。
const sourceFileName = "source.txt";
const maxSweepAgeMs = 10 * 60 * 1000;
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

export function thumbnailCacheDirectory(absolutePath: string) {
  return join(cacheDirectory, createHash("sha1").update(absolutePath).digest("hex"));
}

export function thumbnailCacheFile(absolutePath: string, edge: number, size: number, mtimeMs: number) {
  // ACT: 文件名保留 size 与 mtime，避免同路径原地覆写时命中旧帧（部分文件系统 mtime 精度约 2s）。
  return join(thumbnailCacheDirectory(absolutePath), `${edge}-${size}-${mtimeMs}.jpg`);
}

export function thumbnailETag(absolutePath: string, edge: number, size: number, mtimeMs: number) {
  return createHash("sha1").update(`${absolutePath}|${edge}|${size}|${mtimeMs}`).digest("hex");
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
    await mkdir(dirname(cachePath), { recursive: true });
    await rename(temporary, cachePath);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

/**
 * 返回缓存文件与 ETag；无法生成或 FFmpeg 不可用时返回 null，由前端按类型回退原图/图标或直接挂载原视频。
 */
export async function ensureAssetThumbnail(root: string, relativePath: string, absolutePath: string, size: number, mtimeMs: number,
  edge = thumbEdge) {
  const dataType = mentionAssetType(relativePath).dataType;
  if (dataType !== "IMAGE" && dataType !== "VIDEO") return null;
  const real = await realpath(absolutePath);
  const requestedEdge = Math.max(1, Math.min(2048, Math.round(edge)));
  const cachePath = thumbnailCacheFile(real, requestedEdge, size, mtimeMs);
  const etag = thumbnailETag(real, requestedEdge, size, mtimeMs);
  if (await lstat(cachePath).catch(() => null)) return { path: cachePath, etag };
  const existing = pending.get(cachePath);
  if (existing) {
    await existing.catch(() => {});
    return await lstat(cachePath).catch(() => null) ? { path: cachePath, etag } : null;
  }
  const task = withSlot(async () => {
    // ACT: 记录源文件路径，供启动清扫判断缓存是否已成为孤儿。
    await mkdir(thumbnailCacheDirectory(real), { recursive: true });
    await writeFile(join(thumbnailCacheDirectory(real), sourceFileName), real, { mode: 0o666 }).catch(() => {});
    await generateThumbnail(real, cachePath, dataType, requestedEdge);
  }).finally(() => { pending.delete(cachePath); });
  pending.set(cachePath, task);
  try { await task; }
  catch (error) {
    if (await lstat(cachePath).catch(() => null)) return { path: cachePath, etag };
    console.warn("缩略图生成失败：", relativePath, error);
    return null;
  }
  return { path: cachePath, etag };
}

/** 源文件被删除后回收其全部缩略图；路径必须已不存在于磁盘时才调用。 */
export async function dropThumbnailCache(absolutePath: string) {
  await rm(thumbnailCacheDirectory(absolutePath), { recursive: true, force: true }).catch(() => {});
}

let sweepTimer: ReturnType<typeof setTimeout> | undefined;
let sweeping: Promise<void> | undefined;

/** 删除/改名等操作后调用：去抖后清扫孤儿缓存，覆盖递归删除与回收站移动。 */
export function scheduleThumbnailSweep(delay = 5000) {
  if (sweepTimer) clearTimeout(sweepTimer);
  sweepTimer = setTimeout(() => { sweepTimer = undefined; void sweepThumbnailCache(); }, delay);
}

/** 清扫源文件已不存在的缩略图目录；外接卷未挂载、并发生成中的目录一律跳过。 */
export async function sweepThumbnailCache(maxAgeMs = maxSweepAgeMs) {
  if (sweeping) return sweeping;
  sweeping = (async () => {
    const entries = await readdir(cacheDirectory, { withFileTypes: true }).catch(() => []);
    const now = Date.now();
    for (const entry of entries) {
      const full = join(cacheDirectory, entry.name);
      if (!entry.isDirectory()) {
        // ACT: 遗留的扁平缓存与中断的临时文件只在足够旧时清理，避免删掉正在写入的文件。
        const info = await stat(full).catch(() => null);
        if (info && now - info.mtimeMs > maxAgeMs) await unlink(full).catch(() => {});
        continue;
      }
      const source = await readFile(join(full, sourceFileName), "utf8").catch(() => null);
      if (source === null) {
        const info = await stat(full).catch(() => null);
        if (info && now - info.mtimeMs > maxAgeMs) await rm(full, { recursive: true, force: true }).catch(() => {});
        continue;
      }
      const parent = dirname(source);
      if (!(await stat(parent).catch(() => null))) continue;
      if (await stat(source).catch(() => null)) continue;
      await rm(full, { recursive: true, force: true }).catch(() => {});
    }
  })().catch(error => console.warn("缩略图清扫失败", error)).finally(() => { sweeping = undefined; });
  return sweeping;
}
