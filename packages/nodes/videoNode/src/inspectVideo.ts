import {
  ensureNodeDirectory,
  type BrowserFfmpegFactory,
  type FfprobeData,
  type WorkspaceFiles,
} from "@toonflow/nodes-scaffold/runtime";
import { frameErrorMessage } from "./frameOutputTool";
import { runFfmpegCommand } from "./ffmpegTask";
import {
  defaultGridCount,
  frameFile,
  frameFilePattern,
  gridCell,
  gridFile,
  gridFilePattern,
  gridFilter,
  gridLayout,
  gridSampleTimes,
  inspectDirectoryPath,
  inspectFolder,
  inspectJpegOptions,
  isStaleOutput,
  normalizeCaptureSeconds,
  readVideoMeta,
  temporaryFile,
  videoMapSpec,
  type GridCount,
} from "./inspectPlan";

const probeTimeoutMs = 15000;
const commandTimeoutMs = 25000;
/**
 * 一次截帧调用的总预算。节点函数本身有 120s 的调用闸门（nodeTools），
 * 6 个点各 25s 会到 150s，必须在预算内收尾并把已成功的帧返回给 Agent。
 */
const captureBudgetMs = 90000;
/** 剩余预算低于这个值就不再开新点，免得点到一半被闸门整体打断。 */
const captureMinimumBudgetMs = 3000;

export type VideoInspectMedia = { path: string; mimeType: string };

export type VideoInspectSource = {
  id: string;
  getFiles: () => WorkspaceFiles;
  createFfmpeg: (signal?: AbortSignal, options?: { silentRequired?: boolean }) => Promise<BrowserFfmpegFactory>;
  /** 节点当前视频；没有视频时返回 undefined。 */
  getVideo: () => VideoInspectMedia | undefined;
  /** 节点正在生成/处理时返回可读原因，工具据此直接拒绝。 */
  blockedReason?: () => string | undefined;
};

export type SampleFramesResult = {
  path: string;
  count: GridCount;
  columns: number;
  rows: number;
  /** 每格对应的原片时间点（秒），按从左到右、从上到下排列。 */
  frameTimes: number[];
  duration: number;
  width: number;
  height: number;
  source: string;
  note: string;
};

export type CaptureFrameResult = {
  frames: { seconds: number; path: string }[];
  failures: { seconds: number; error: string }[];
  /** 预算用完时只截了前若干个点，剩下的需要再次调用。 */
  truncated: boolean;
  duration: number;
  source: string;
  note: string;
};

function probeVideo(factory: BrowserFfmpegFactory, path: string, signal: AbortSignal) {
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

function ignoreExisting(error: { response?: { data?: { data?: { code?: string } } } }) {
  if (error.response?.data?.data?.code !== "EEXIST") throw error;
}

async function prepare(source: VideoInspectSource, signal: AbortSignal) {
  const video = source.getVideo();
  if (!video) throw new Error("该节点还没有视频，无法查看");
  const blocked = source.blockedReason?.();
  if (blocked) throw new Error(blocked);
  const files = source.getFiles();
  const factory = await source.createFfmpeg(signal, { silentRequired: true });
  signal.throwIfAborted();
  return { video, files, factory };
}

/** 视频在抽帧途中被替换或清空时，旧帧不能当成当前画面交给 Agent。 */
function ensureSameVideo(source: VideoInspectSource, video: VideoInspectMedia) {
  const current = source.getVideo();
  if (!current || current.path !== video.path) throw new Error("视频已更换或已清空，请重新查看");
}

function baseName(path: string) {
  return path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
}

/**
 * 每次调用只清同类产物：宫格对宫格、单帧对单帧，两类互不影响；临时文件一并回收。
 * ACT: `keep` 是本次刚写好的临时文件——它同样以 `.tmp.jpg` 结尾，不排除就会被当成上一轮的残留删掉，
 * 随后 settleOutput 找不到文件，误报成「未生成文件（视频时长或可用帧数不足）」。
 */
export async function clearOutputs(files: WorkspaceFiles, directory: string, pattern: RegExp, keep?: string) {
  const kept = keep ? baseName(keep) : undefined;
  const listed = await files.list(directory).catch(() => undefined);
  for (const entry of listed?.entries ?? []) {
    if (entry.type !== "file" || !isStaleOutput(entry.name, pattern, kept)) continue;
    await files.remove(entry.path).catch(() => {});
  }
}

/** 目录列表可能滞后于写入；列表没命中时再读一次文件，避免把写好的产物误判成缺失。 */
async function temporaryExists(files: WorkspaceFiles, directory: string, temporary: string) {
  const name = baseName(temporary);
  const listed = await files.list(directory).catch(() => undefined);
  // 列表请求失败时不做判断，交给后面的改名结果定夺，不能凭空判失败。
  if (listed === undefined) return true;
  if (listed.entries.some(entry => entry.type === "file" && entry.name === name)) return true;
  return files.read(temporary).then(() => true, () => false);
}

/**
 * 先写唯一临时名再改名：固定文件名 + 「文件已存在即通过」会把上一版视频的帧当成新结果。
 * ACT: 只有确认临时文件已写好才动旧产物——先删 target 再改名，失败时上一轮可用的图还在。
 * 改名成功即证明文件已完整落盘（服务端是 copy + unlink），不需要再查一次目录。
 */
export async function settleOutput(files: WorkspaceFiles, directory: string, temporary: string, target: string) {
  if (!(await temporaryExists(files, directory, temporary))) {
    // ACT: 帧数不足时 ffmpeg 可能退出 0 但 tile 拼不出图，别让 Agent 只看到笼统的「未生成文件」。
    throw new Error("抽帧失败：未生成文件（视频时长或可用帧数不足）");
  }
  await files.remove(target).catch(() => {});
  await files.rename(temporary, target);
}

async function dropTemporary(files: WorkspaceFiles, temporary: string) {
  await files.remove(temporary).catch(() => {});
}

/** 「Agent 查看视频」的唯一实现：两个视频节点共用，保证 Agent 看到的能力一致。 */
export function createVideoInspect(source: VideoInspectSource) {
  // ACT: 同一节点的两次查看串行执行——并发时清理与 rename 会互相删掉对方刚写好的图。
  let queue: Promise<unknown> = Promise.resolve();
  /** 首次真正写产物时才登记清理，没看过的节点不在关窗时发无意义的删除请求。 */
  let releaseCleanup: (() => Promise<void> | void) | undefined;

  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(task, task);
    queue = run.catch(() => {});
    return run;
  }

  async function inspectDirectory(files: WorkspaceFiles, signal: AbortSignal) {
    const directory = inspectDirectoryPath(source.id);
    const nodeDirectory = await ensureNodeDirectory(files, source.id);
    const target = `${nodeDirectory}/${inspectFolder}`;
    await files.mkdir(target).catch(ignoreExisting);
    signal.throwIfAborted();
    releaseCleanup ??= registerVideoInspectCleanup(directory, () => {
      // ACT: 卸载时注入可能已不存在，取文件实例本身也要兜住，清理失败不能冒泡到卸载流程。
      try { return files.remove(directory, true).catch(() => {}); }
      catch { return Promise.resolve(); }
    });
    return target;
  }

  async function sample(count: GridCount, signal: AbortSignal): Promise<SampleFramesResult> {
    const { video, files, factory } = await prepare(source, signal);
    const meta = readVideoMeta(await probeVideo(factory, video.path, signal));
    const { columns, rows } = gridLayout(count);
    const directory = await inspectDirectory(files, signal);
    const target = `${directory}/${gridFile(count)}`;
    const temporary = temporaryFile(directory, `contact-${count}`);
    try {
      // ACT: 不 seek——fps 滤镜把首个采样点放在半格处，正好是「不贴开头」的效果，seek 会再偏移半格。
      // ACT: -map 0:V:0（大写 V）排除封面图，避免首帧被 attached_pic 抢走。
      const task = factory(video.path).noAudio()
        .outputOptions(...inspectJpegOptions, "-frames:v", "1", "-map", videoMapSpec(meta), "-vf", gridFilter(meta.duration, count, gridCell(meta.width, meta.height)))
        .output(temporary);
      await runFfmpegCommand(task, signal, {
        timeoutMs: commandTimeoutMs,
        timeoutMessage: "抽帧超时，视频可能过大或编码不受支持",
        abortMessage: "抽帧已取消",
      });
      ensureSameVideo(source, video);
      // ACT: 先确认新图能落地再清旧宫格——顺序反了的话，新图失败时上一轮可用的宫格已经被删掉。
      await settleOutput(files, directory, temporary, target);
      await clearOutputs(files, directory, gridFilePattern, target);
    } catch (cause) {
      await dropTemporary(files, temporary);
      throw cause;
    }
    return {
      path: target,
      count,
      columns,
      rows,
      frameTimes: gridSampleTimes(meta.duration, count),
      duration: Math.round(meta.duration * 100) / 100,
      width: meta.width,
      height: meta.height,
      source: video.path,
      note: "宫格仅用于查看，不是节点输出；需要用 read 工具打开 path 查看图片。宫格不包含片尾最后一小段，需要时用 captureFrame；再次调用会覆盖本张宫格。",
    };
  }

  async function capture(seconds: readonly number[], signal: AbortSignal): Promise<CaptureFrameResult> {
    const { video, files, factory } = await prepare(source, signal);
    const meta = readVideoMeta(await probeVideo(factory, video.path, signal));
    const points = normalizeCaptureSeconds(seconds, meta.duration);
    const directory = await inspectDirectory(files, signal);
    const frames: CaptureFrameResult["frames"] = [];
    const failures: CaptureFrameResult["failures"] = [];
    const startedAt = Date.now();
    let cleared = false;
    let truncated = false;
    for (const point of points) {
      signal.throwIfAborted();
      const remaining = captureBudgetMs - (Date.now() - startedAt);
      if (remaining < captureMinimumBudgetMs) {
        truncated = true;
        break;
      }
      const target = `${directory}/${frameFile(point)}`;
      const temporary = temporaryFile(directory, `frame-${Math.round(point * 1000)}ms`);
      try {
        const task = factory(video.path).noAudio()
          .inputOptions("-ss", point.toFixed(3))
          .outputOptions(...inspectJpegOptions, "-frames:v", "1", "-map", videoMapSpec(meta))
          .output(temporary);
        await runFfmpegCommand(task, signal, {
          timeoutMs: Math.min(commandTimeoutMs, remaining),
          timeoutMessage: "抽帧超时，视频可能过大或编码不受支持",
          abortMessage: "抽帧已取消",
        });
        ensureSameVideo(source, video);
        await settleOutput(files, directory, temporary, target);
        // ACT: 第一张成功落地后才清旧单帧：全部失败时不能把上一轮可用结果删掉。
        if (!cleared) {
          await clearOutputs(files, directory, frameFilePattern, target);
          cleared = true;
        }
        frames.push({ seconds: point, path: target });
      } catch (cause) {
        await dropTemporary(files, temporary);
        if (signal.aborted) throw cause;
        failures.push({ seconds: point, error: frameErrorMessage(cause) });
      }
    }
    if (!frames.length) throw new Error(failures[0]?.error ?? "抽帧失败");
    return {
      frames,
      failures,
      truncated,
      duration: Math.round(meta.duration * 100) / 100,
      source: video.path,
      note: truncated
        ? `为控制在单次调用时长内，只截取了前 ${frames.length} 个时间点；剩余时间点请再次调用。单帧仅用于查看，不是节点输出；需要用 read 工具打开各 path 查看图片；再次调用会覆盖上一批单帧。`
        : "单帧仅用于查看，不是节点输出；需要用 read 工具打开各 path 查看图片；再次调用会覆盖上一批单帧。",
    };
  }

  /** 视频换了就清掉旧产物：否则 Agent 上下文里的旧路径还能 read 到上一版画面。 */
  async function clear() {
    await queue.catch(() => {});
    try { await source.getFiles().remove(inspectDirectoryPath(source.id), true); }
    catch { /* 目录不存在或已卸载，忽略 */ }
  }

  return {
    sampleFrames: (count: GridCount = defaultGridCount, signal: AbortSignal) => enqueue(() => sample(count, signal)),
    captureFrame: (seconds: readonly number[], signal: AbortSignal) => enqueue(() => capture(seconds, signal)),
    clear,
    /** 节点卸载时调用：先等在途查看结算，最后一个持有该目录的实例卸载才真正删除。 */
    dispose: async () => {
      await queue.catch(() => {});
      const release = releaseCleanup;
      releaseCleanup = undefined;
      await release?.();
    },
  };
}

export type VideoInspect = ReturnType<typeof createVideoInspect>;

type CleanupEntry = { count: number; cleanup: () => Promise<void> | void };

/**
 * 把查看产物清理函数登记到页面共享表（Symbol 与 `apps/web/src/lib/videoInspectFiles.ts` 一致）。
 * 节点是独立 UMD 包，不能直接 import 前端模块；关窗时由关闭闸门统一调用。
 * ACT: 按目录引用计数——同一 nodeId 可能同时在两块画布实例上挂着，先卸载的那个不能删另一位还在用的产物。
 */
export function registerVideoInspectCleanup(directory: string, cleanup: () => Promise<void> | void) {
  const host = globalThis as unknown as Record<symbol, Map<string, CleanupEntry> | undefined>;
  const registryKey = Symbol.for("toonflow.videoInspectCleanups");
  const registry = host[registryKey] ?? (host[registryKey] = new Map());
  const existing = registry.get(directory);
  if (existing) existing.count += 1;
  else registry.set(directory, { count: 1, cleanup });
  let released = false;
  return () => {
    if (released) return undefined;
    released = true;
    const entry = registry.get(directory);
    if (!entry) return undefined;
    entry.count -= 1;
    if (entry.count > 0) return undefined;
    registry.delete(directory);
    return entry.cleanup();
  };
}
