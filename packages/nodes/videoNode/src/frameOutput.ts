import { computed, onMounted, onScopeDispose, ref, toValue, type MaybeRefOrGetter, type Ref } from "vue";
import { useVueFlow } from "@vue-flow/core";
import { ElMessage } from "element-plus";
import {
  ensureNodeDirectory,
  isNodeOutput,
  isTypeCompatible,
  type BrowserFfmpegCommand,
  type BrowserFfmpegFactory,
  type NodeData,
  type NodeHandle,
  type NodeOutputs,
  type WorkspaceFiles,
} from "@toonflow/nodes-scaffold/runtime";
import {
  buildFrameHandles,
  enabledFrameOutputs,
  FRAME_OUTPUTS,
  frameOutputMeta,
  frameOutputOptions,
  type FrameKey,
  type FrameOutputConfig,
} from "./frameOutputPlan";

export type { FrameKey, FrameOutputConfig } from "./frameOutputPlan";
export { buildFrameHandles, FRAME_OUTPUTS, staticNodeHandles } from "./frameOutputPlan";

const VIDEO_MIME = /^video\//;
const CAPTURE_TIMEOUT_MS = 30000;

function frameUrl(outputs: NodeOutputs, handleId: string) {
  const output = outputs[handleId];
  return output?.dataType === "IMAGE" ? output.value.url : undefined;
}

function splitPath(path: string) {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? { directory: "", name: path } : { directory: path.slice(0, slash), name: path.slice(slash + 1) };
}

type FrameOutputOptions = {
  id: MaybeRefOrGetter<string>;
  /** vue-flow 的节点本体（响应式对象，直接读 `node.data`），不是 Ref。 */
  node: { data: NodeData };
  outputs: Ref<NodeOutputs>;
  handles: Ref<NodeHandle[]>;
  /** 声明期端口，用于重建端口表。 */
  baseHandles: readonly NodeHandle[];
  getFiles: () => WorkspaceFiles;
  createFfmpeg: (signal?: AbortSignal, options?: { silentRequired?: boolean }) => Promise<BrowserFfmpegFactory>;
};

/**
 * 首帧 / 尾帧输出端口的唯一实现：端口增删、抽帧、值回填、切换视频时的清空与重抽。
 * 两个视频节点都只调用这里，避免各自写一份 ffmpeg 命令。
 */
export function useFrameOutputs(options: FrameOutputOptions) {
  const { node, outputs, handles, baseHandles, getFiles, createFfmpeg } = options;
  const id = computed(() => toValue(options.id));
  // ACT: 端口消失时宿主会自己删悬空连线（nodeSkeleton 监听 props.handles），这里只负责计数与提示。
  const { getEdges } = useVueFlow();

  const config = computed<FrameOutputConfig>(() => {
    const value = (node.data as NodeData & { frameOutputs?: unknown }).frameOutputs;
    return value && typeof value === "object" && !Array.isArray(value) ? value as FrameOutputConfig : {};
  });
  const enabled = computed(() => Object.fromEntries(FRAME_OUTPUTS.map((item) => [item.key, config.value[item.key] === true])) as Record<FrameKey, boolean>);
  const values = computed(() => Object.fromEntries(FRAME_OUTPUTS.map((item) => [item.key, frameUrl(outputs.value, item.handleId)])) as Record<FrameKey, string | undefined>);
  const busy = ref(false);
  const error = ref<string>();

  // ACT: 所有抽帧串行排队，同一节点不会有两个 ffmpeg 进程同时写同名文件。
  let queue: Promise<void> = Promise.resolve();
  let controller: AbortController | undefined;
  /** 单调递增的「意图代次」：只用来判断结果是否已经过时，不用来决定 busy。 */
  let epoch = 0;
  /** 在途操作计数。busy 只由它决定——任何提前 return 都必须走 finally 减一，否则 UI 永久禁用。 */
  let activeOps = 0;

  function beginOp() {
    activeOps += 1;
    busy.value = true;
  }

  function endOp() {
    activeOps = Math.max(0, activeOps - 1);
    if (!activeOps) busy.value = false;
  }

  function writeConfig(next: FrameOutputConfig) {
    (node.data as NodeData & { frameOutputs?: FrameOutputConfig }).frameOutputs = next;
  }

  function currentVideoPath() {
    const output = outputs.value.video;
    return output?.dataType === "VIDEO" && VIDEO_MIME.test(output.value.mimeType) ? output.value.url : undefined;
  }

  /** 立即清空所有已开启端口的值：旧帧一概不能留给下游。 */
  function clear() {
    controller?.abort();
    controller = undefined;
    epoch += 1;
    for (const item of FRAME_OUTPUTS) if (enabled.value[item.key]) delete outputs.value[item.handleId];
    error.value = undefined;
  }

  function runFfmpeg(command: BrowserFfmpegCommand, signal: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      function finish(reason?: unknown) {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        if (reason === undefined) resolve();
        else reject(reason);
      }
      // ACT: kill 只是取消握手，宿主子进程还在收尾；等 end/error 到达（或 2s 宽限）才算结束。
      function stop(reason: unknown) {
        command.kill("SIGKILL");
        window.setTimeout(() => finish(reason), 2000);
      }
      function abort() { stop(signal.reason ?? new Error("抽帧已取消")); }
      const timer = window.setTimeout(() => stop(new Error("视频抽帧超时")), CAPTURE_TIMEOUT_MS);
      if (signal.aborted) return abort();
      signal.addEventListener("abort", abort, { once: true });
      command.on("end", () => finish(signal.aborted ? signal.reason ?? new Error("抽帧已取消") : undefined));
      command.on("error", (reason: Error) => finish(reason));
      command.run();
    });
  }

  async function extract(key: FrameKey, sourcePath: string, signal: AbortSignal, token: number) {
    const meta = frameOutputMeta(key);
    const files = getFiles();
    const directory = await ensureNodeDirectory(files, id.value);
    signal.throwIfAborted();
    const target = `${directory}/${meta.fileName}`;
    // ACT: 先写唯一临时名再 rename。固定文件名 + 「文件已存在即通过」的校验，会在一路静默失败时
    // 把上一版视频的旧帧当成新帧回填；临时名让「没写盘」必然暴露，也避免半截文件被下游读到。
    const temporary = `${directory}/${meta.fileName}.${crypto.randomUUID()}.tmp.jpg`;
    const factory = await createFfmpeg(signal, { silentRequired: true });
    signal.throwIfAborted();
    const { input, output } = frameOutputOptions(key);
    const instance = factory(sourcePath).noAudio();
    const task = input.length
      ? instance.inputOptions(...input).outputOptions(...output).output(temporary)
      : instance.outputOptions(...output).output(temporary);
    try {
      await runFfmpeg(task, signal);
      // ACT: rename 之前再确认代次——过期结果连文件都不能落，否则会覆盖新视频刚抽好的同名帧。
      if (token !== epoch) throw new Error("抽帧已过期");
      const temporaryName = splitPath(temporary).name;
      const listed = await files.list(directory).catch(() => undefined);
      if (!listed?.entries.some((entry) => entry.type === "file" && entry.name === temporaryName)) throw new Error(`${meta.label}抽取失败：未生成文件`);
      // ACT: 工作区的 rename 是「不覆盖」语义（目标已存在直接 409 EEXIST），重抽时必须先删旧帧。
      await files.remove(target).catch(() => {});
      await files.rename(temporary, target);
    } catch (cause) {
      await files.remove(temporary).catch(() => {});
      throw cause;
    }
    return target;
  }

  /**
   * 抽一张，返回可写回的路径；代次已过期时返回 undefined（结果作废）。
   * ACT: 这里**不能**判断「端口是否已开启」——开启端口时配置要等抽帧成功才写入，
   * 提前用 enabled 过滤会把这一次的结果丢掉，表现为「端口勾上了但永远没图」。
   */
  async function extractFrame(key: FrameKey, sourcePath: string, signal: AbortSignal, token: number) {
    const path = await extract(key, sourcePath, signal, token);
    signal.throwIfAborted();
    return token === epoch ? path : undefined;
  }

  function writeValue(key: FrameKey, path: string) {
    outputs.value[frameOutputMeta(key).handleId] = { dataType: "IMAGE", value: { url: path, mimeType: "image/jpeg" } };
  }

  function describe(cause: unknown) {
    // ACT: axios 的 message 只有「Request failed with status code 409」，真正原因在响应体里。
    const payload = (cause as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
    if (typeof payload === "string" && payload.trim()) return payload;
    return cause instanceof Error && cause.message ? cause.message : "抽帧失败";
  }

  async function runJob(source: string, wanted: readonly { key: FrameKey; label: string }[], signal: AbortSignal) {
    beginOp();
    const token = ++epoch;
    try {
      for (const item of wanted) {
        if (signal.aborted || token !== epoch) return;
        if (!enabled.value[item.key]) continue;
        try {
          const path = await extractFrame(item.key, source, signal, token);
          // ACT: 抽帧途中端口被关掉时不能把值写回去。
          if (path && enabled.value[item.key]) writeValue(item.key, path);
        } catch (cause) {
          // ACT: 一路失败不阻断另一路；成功的那张照常回填。
          if (signal.aborted || token !== epoch) return;
          error.value = describe(cause);
          ElMessage.warning(error.value);
        }
      }
      if (token === epoch) error.value = undefined;
    } finally {
      endOp();
    }
  }

  /**
   * 视频变了：先清空全部已开启端口，再按排队重抽。
   * `sourcePath` 省略时读取当前 video 输出。
   */
  function refresh(sourcePath?: string) {
    const source = sourcePath ?? currentVideoPath();
    clear();
    const wanted = enabledFrameOutputs(config.value);
    if (!source || !wanted.length) return queue;
    const next = new AbortController();
    controller = next;
    queue = queue.catch(() => {}).then(() => runJob(source, wanted, next.signal));
    return queue;
  }

  /** 开关某一项：开启先抽帧再出端口；关闭先计数再移除端口。 */
  async function toggle(key: FrameKey, on: boolean) {
    const meta = frameOutputMeta(key);
    if (on === enabled.value[key]) return;
    const next = { ...config.value, [key]: on };
    if (!on) {
      // ACT: 关闭要作废在途抽帧，否则那一轮抽完会把已删除端口的值写回来。
      controller?.abort();
      controller = undefined;
      epoch += 1;
      delete outputs.value[meta.handleId];
      writeConfig(next);
      handles.value = buildFrameHandles(next, baseHandles);
      error.value = undefined;
      // ACT: 帧文件保留——节点复制会复制 outputs 里的同一路径，删文件会误伤复制节点。
      const attached = getEdges.value.filter((edge) => edge.source === id.value && edge.sourceHandle === meta.handleId).length;
      if (attached) ElMessage.info(`已关闭${meta.label}输出，断开 ${attached} 条连线`);
      return;
    }
    const source = currentVideoPath();
    if (!source) {
      writeConfig(next);
      handles.value = buildFrameHandles(next, baseHandles);
      return;
    }
    const current = new AbortController();
    controller?.abort();
    controller = current;
    beginOp();
    const token = ++epoch;
    try {
      const path = await extractFrame(key, source, current.signal, token);
      if (!path || current.signal.aborted || token !== epoch) return;
      writeConfig(next);
      handles.value = buildFrameHandles(next, baseHandles);
      // ACT: 配置要先落，端口才出得来；值紧随其后写入，两者一起生效。
      writeValue(key, path);
      error.value = undefined;
    } catch (cause) {
      if (current.signal.aborted || token !== epoch) {
        // ACT: 用户刚点的「开启」被视频变化打断，不能静默丢弃。
        ElMessage.info(`视频已更新，请重新开启${meta.label}输出`);
        return;
      }
      error.value = describe(cause);
      ElMessage.warning(`开启${meta.label}输出失败：${error.value}`);
    } finally {
      endOp();
    }
  }

  // ACT: 极端时序下 useNode 初始化时拿不到节点数据，动态端口与已保存的值会被丢弃；
  // 这里在同一个 setup 内按 node.data 自愈一次，早于宿主的同步 watchEffect。
  const expected = buildFrameHandles(config.value, baseHandles);
  const saved = (node.data as NodeData).outputs ?? {};
  const missingHandle = expected.some((item) => !handles.value.some((current) => current.id === item.id && current.type === item.type));
  const missingValue = enabledFrameOutputs(config.value).some((item) => saved[item.handleId] && !outputs.value[item.handleId]);
  if (missingHandle || missingValue) {
    handles.value = expected;
    for (const item of enabledFrameOutputs(config.value)) {
      const restore = saved[item.handleId];
      // ACT: 只补回合法且类型匹配的值，别绕过 useNode 的过滤把坏数据塞回去。
      if (!outputs.value[item.handleId] && isNodeOutput(restore) && isTypeCompatible(restore.dataType, "IMAGE")) outputs.value[item.handleId] = restore;
    }
  }

  onMounted(async () => {
    if ((node.data as NodeData).disabled === true) return;
    const wanted = enabledFrameOutputs(config.value);
    if (!wanted.length) return;
    const files = getFiles();
    // ACT: 按**当前值指向的实际路径**校验，而不是固定文件名。复制出来的节点值指向源节点目录，
    // 用固定名会误判缺失并清掉本来可用的图；分享包裁剪导致文件真缺时才补抽。
    let missing = false;
    for (const item of wanted) {
      const url = values.value[item.key];
      if (!url) { missing = true; continue; }
      const { directory, name } = splitPath(url);
      const listed = directory ? await files.list(directory).catch(() => undefined) : undefined;
      if (!listed?.entries.some((entry) => entry.type === "file" && entry.name === name)) missing = true;
    }
    if (missing) void refresh();
  });

  onScopeDispose(() => {
    controller?.abort();
    controller = undefined;
  });

  return { config, enabled, values, busy, error, clear, refresh, toggle };
}
