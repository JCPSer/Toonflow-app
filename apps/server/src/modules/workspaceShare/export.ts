import { createHash } from "node:crypto";
import { createReadStream, lstat, mkdir, readdir, readFile, rm, stat } from "@toonflow/file";
import { dirname, extname, join, relative } from "node:path";
import u from "@/utils";
import { findCanvases } from "./discover";
import { markdownImageSources, referencedPaths, resolveMarkdownPath, rewriteMediaPaths, sanitizeCanvas } from "./collect";
import { compressMedia, hasAlpha, isAnimated, mediaKind, planCompression, probeEncoders } from "./compress";
import { writeShareFile } from "./container";
import type { ShareManifest, ShareSourceEntry } from "./types";

/** 这些扩展名走 deflate；其余（媒体、模型）直接 store。 */
const DEFLATE_EXTENSIONS = new Set([".json", ".md", ".txt", ""]);
/** 与缩略图一致，避免导出把 CPU 打满。 */
const COMPRESS_CONCURRENCY = 2;
const STALE_STAGING_MS = 24 * 60 * 60 * 1000;

function isDeflatable(path: string) {
  return DEFLATE_EXTENSIONS.has(extname(path).toLowerCase());
}

async function hashFile(path: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

function hashBytes(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * ACT: 画布里的引用是不可信输入——导入的分享包能塞进 `assets/../../../.ssh/id_rsa`。
 * 这里统一拒绝穿越、绝对路径与 scheme，并要求确实是普通文件（目录/FIFO 会让读哈希挂死）。
 */
async function resolveRef(root: string, ref: string) {
  if (!ref || /^(?:[a-z][a-z\d+.-]*:|[\\/])/i.test(ref) || ref.split(/[\\/]+/).includes("..")) return null;
  const absolute = join(root, ref);
  if (!u.workspaceFile.isWithin(root, absolute)) return null;
  const info = await lstat(absolute).catch(() => null);
  return info?.isFile() ? absolute : null;
}

async function mapLimit<T>(items: T[], limit: number, worker: (item: T, index: number) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      await worker(items[index]!, index);
    }
  }));
}

interface TextNodeContent {
  textPath: string;
  content: string;
  images: { raw: string; resolved: string }[];
}

export interface ExportProjectOptions {
  root: string;
  name: string;
  appVersion: string;
  target: string;
  password?: string;
  signal: AbortSignal;
  onProgress(patch: { phase?: "collecting" | "compressing" | "packing"; done?: number; total?: number; bytes?: number; currentFile?: string; missing?: string[]; skippedLarger?: string[] }): void;
}

export async function exportProject(options: ExportProjectOptions): Promise<ShareManifest> {
  const { root, signal, onProgress } = options;
  signal.throwIfAborted();

  const canvases = await findCanvases(root);
  if (!canvases.length) throw Object.assign(new Error("这个工程里没有找到有效的画布文件，无法分享"), { status: 400 });

  onProgress({ phase: "collecting", done: 0, total: canvases.length });
  const cleaned = new Map<string, Record<string, unknown>>();
  const referenced = new Set<string>();
  const textNodes: TextNodeContent[] = [];
  for (const [index, path] of canvases.entries()) {
    signal.throwIfAborted();
    const content = await readFile(join(root, path));
    const { canvas } = sanitizeCanvas(JSON.parse(new TextDecoder().decode(content)));
    cleaned.set(path, canvas);
    for (const ref of referencedPaths(canvas)) referenced.add(ref);
    const nodes = await collectTextNodes(canvas, root);
    for (const node of nodes) {
      textNodes.push(node);
      referenced.add(node.textPath);
      for (const image of node.images) referenced.add(image.resolved);
    }
    onProgress({ done: index + 1, total: canvases.length, currentFile: path });
  }

  // ACT: 引用到但读不到的输出文件不阻断导出（节点会显示占位）；正文与 3D 模型丢了会被空内容覆盖，必须阻断。
  const missing: string[] = [];
  const available: { ref: string; absolute: string }[] = [];
  for (const ref of referenced) {
    const absolute = await resolveRef(root, ref);
    if (absolute) available.push({ ref, absolute });
    else missing.push(ref);
  }
  for (const required of requiredPaths(cleaned.values())) {
    if (!await resolveRef(root, required)) throw Object.assign(new Error(`节点正文或模型文件缺失，无法分享：${required}`), { status: 400 });
  }
  onProgress({ missing });

  const status = await u.ffmpeg.getStatus();
  if (!status.tools.ffmpeg.path || !status.tools.ffprobe.path) {
    throw Object.assign(new Error("分享前需要压缩媒体，请先在设置中安装 FFmpeg"), { status: 409, code: "FFMPEG_REQUIRED" });
  }
  const ffmpeg = status.tools.ffmpeg.path;
  const ffprobe = status.tools.ffprobe.path;
  const encoders = await probeEncoders(ffmpeg, signal);
  if (!encoders.has("libx264")) throw Object.assign(new Error("当前 FFmpeg 不含 libx264 编码器，无法压缩视频，请在设置中重新安装"), { status: 409 });

  const stagingRoot = join(root, ".toonflow");
  await sweepStaleStaging(stagingRoot);
  const staging = join(stagingRoot, `share-${crypto.randomUUID()}`);
  await mkdir(staging, { recursive: true });
  // ACT: 导出期间持锁，防止编辑器/Agent 并发写盘导致「哈希与打包内容不一致」的包。
  const release = u.workspaceFile.lockWorkspaceFiles([root]);
  try {
    const mapping = new Map<string, { path: string; mimeType?: string }>();
    const sources: ShareSourceEntry[] = [];
    const skippedLarger: string[] = [];
    const used = new Set<string>(available.map(item => item.ref));
    let done = 0;

    onProgress({ phase: "compressing", done: 0, total: available.length });
    await mapLimit(available, COMPRESS_CONCURRENCY, async item => {
      signal.throwIfAborted();
      const { ref: path, absolute } = item;
      const kind = mediaKind(path);
      if (kind === "other") {
        // ACT: deflate 需要原始字节在内存里（容器要提前算出 storedSize 才能写 manifest）；文本都很小。
        if (isDeflatable(path)) {
          const bytes = await readFile(absolute);
          sources.push({ path, bytes, codec: "deflate", size: bytes.byteLength, sha256: hashBytes(bytes) });
        } else {
          sources.push({ path, file: absolute, codec: "store", size: (await stat(absolute)).size, sha256: await hashFile(absolute) });
        }
        onProgress({ done: ++done, currentFile: path });
        return;
      }
      const animated = await isAnimated(ffprobe, absolute, signal).catch(() => false);
      const alpha = kind === "image" && !animated ? await hasAlpha(ffmpeg, absolute, signal).catch(() => true) : false;
      const plan = planCompression(path, { kind, alpha, animated });
      // ACT: 并发下不能靠 "最后压入的那条" 定位，先构造好再压入。
      const storeOriginal = async () => {
        const source: ShareSourceEntry = { path, file: absolute, codec: "store", size: 0, sha256: "" };
        await fillSize(source);
        sources.push(source);
      };
      if (plan.action === "skip") {
        await storeOriginal();
        onProgress({ done: ++done, currentFile: path });
        return;
      }
      const stem = path.slice(0, -extname(path).length);
      // ACT: 改名可能撞上本来就存在的同目录文件（a.png→a.jpg 撞 a.jpg），必须保证包内路径唯一。
      // 同格式（png→png、jpg→jpg）目标就是它自己，不算撞车。
      const nextPath = uniquePath(`${stem}${plan.outputExt}`, used, path);
      const output = join(staging, nextPath);
      await mkdir(dirname(output), { recursive: true });
      const wrote = await compressMedia({ ffmpeg, input: absolute, output, plan, signal });
      if (!wrote) {
        skippedLarger.push(path);
        await storeOriginal();
        onProgress({ done: ++done, currentFile: path });
        return;
      }
      mapping.set(path, { path: nextPath, mimeType: plan.outputMime });
      sources.push({ path: nextPath, file: output, codec: "store", size: (await stat(output)).size, sha256: await hashFile(output) });
      onProgress({ done: ++done, currentFile: path });
    });
    onProgress({ skippedLarger });

    // 正文里的插图换了扩展名，content.md 本身也得改写，否则导入后链接指向不存在的文件。
    const rewrittenText = new Map<string, Uint8Array>();
    for (const node of textNodes) {
      const touched = node.images.filter(image => mapping.has(image.resolved));
      if (!touched.length) continue;
      let content = node.content;
      for (const image of touched) {
        const target = mapping.get(image.resolved)!.path;
        const next = relative(dirname(node.textPath), target).split(/[\\/]+/).join("/");
        content = content.split(image.raw).join(next);
      }
      rewrittenText.set(node.textPath, new TextEncoder().encode(content));
    }
    if (rewrittenText.size) {
      const kept = sources.filter(source => !rewrittenText.has(source.path));
      sources.length = 0;
      sources.push(...kept);
      for (const [path, bytes] of rewrittenText) sources.push({ path, bytes, codec: "deflate", size: bytes.byteLength, sha256: hashBytes(bytes) });
    }

    // 画布要带上改名后的路径与 mimeType，并且只保留还活着的引用。
    for (const [path, canvas] of cleaned) {
      const next = mapping.size ? rewriteMediaPaths(canvas, mapping).canvas : canvas;
      const bytes = new TextEncoder().encode(JSON.stringify(next));
      sources.push({ path, bytes, codec: "deflate", size: bytes.byteLength, sha256: hashBytes(bytes) });
    }

    onProgress({ phase: "packing", done: 0, total: sources.length });
    return await writeShareFile(options.target, {
      sources,
      manifestBase: {
        format: "tfproj",
        version: 1,
        createdAt: new Date().toISOString(),
        appVersion: options.appVersion,
        project: { name: options.name },
        canvases,
      },
      password: options.password,
      signal,
      onProgress: progress => onProgress({ done: progress.done, total: progress.total, bytes: progress.bytes, currentFile: progress.currentFile }),
    });
  } finally {
    release();
    await rm(staging, { recursive: true }).catch(() => {});
  }
}

async function fillSize(source: ShareSourceEntry) {
  if (!source.file) return;
  source.size = (await stat(source.file)).size;
  source.sha256 = await hashFile(source.file);
}

function uniquePath(path: string, used: Set<string>, own?: string) {
  if (path === own || !used.has(path)) { used.add(path); return path; }
  const extension = extname(path);
  const stem = path.slice(0, -extension.length);
  for (let index = 2; index < 1000; index++) {
    const candidate = `${stem}-${index}${extension}`;
    if (!used.has(candidate)) { used.add(candidate); return candidate; }
  }
  const fallback = `${stem}-${crypto.randomUUID().slice(0, 8)}${extension}`;
  used.add(fallback);
  return fallback;
}

/** 进程崩溃会留下 `.toonflow/share-*`；服务器不知道用户开过哪些工程，只能在该工程被导出时顺手清扫。 */
async function sweepStaleStaging(stagingRoot: string) {
  const entries = await readdir(stagingRoot, { withFileTypes: true }).catch(() => []);
  const now = Date.now();
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("share-")) continue;
    const path = join(stagingRoot, entry.name);
    const info = await stat(path).catch(() => null);
    if (info && now - info.mtimeMs > STALE_STAGING_MS) await rm(path, { recursive: true }).catch(() => {});
  }
}

/** 正文与 3D 模型丢了会被空内容覆盖，属于必须存在的引用。 */
function requiredPaths(canvases: Iterable<Record<string, unknown>>) {
  const required = new Set<string>();
  for (const canvas of canvases) {
    const nodes = Array.isArray(canvas.nodes) ? canvas.nodes as { data?: { textPath?: unknown; modelPath?: unknown; frameAnalysisResult?: { manifest?: unknown } } }[] : [];
    for (const node of nodes) {
      for (const value of [node.data?.textPath, node.data?.modelPath, node.data?.frameAnalysisResult?.manifest]) {
        if (typeof value === "string" && value) required.add(value);
      }
    }
  }
  return required;
}

/** 文本节点的正文不在 data 里，插图路径也只能从 content.md 里解析。 */
async function collectTextNodes(canvas: Record<string, unknown>, root: string): Promise<TextNodeContent[]> {
  const nodes = Array.isArray(canvas.nodes) ? canvas.nodes as { data?: { textPath?: unknown } }[] : [];
  const found: TextNodeContent[] = [];
  for (const node of nodes) {
    const textPath = node.data?.textPath;
    if (typeof textPath !== "string" || !textPath) continue;
    if (!await resolveRef(root, textPath)) continue;
    const content = await readFile(join(root, textPath)).then(bytes => new TextDecoder().decode(bytes)).catch(() => null);
    if (content === null) continue;
    const images = markdownImageSources(content)
      .map(raw => ({ raw, resolved: resolveMarkdownPath(raw, textPath) }))
      .filter((image): image is { raw: string; resolved: string } => Boolean(image.resolved));
    found.push({ textPath, content, images });
  }
  return found;
}
