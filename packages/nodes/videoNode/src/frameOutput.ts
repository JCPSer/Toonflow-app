import { computed, nextTick, onMounted, onScopeDispose, ref, toValue, type MaybeRefOrGetter, type Ref } from "vue";
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
  GRID_OUTPUT_COUNT,
  type FrameCaptureKey,
  type FrameKey,
  type FrameOutputConfig,
} from "./frameOutputPlan";
import { frameErrorMessage, type FrameApplyResult, type FrameOutputState } from "./frameOutputTool";
import { runFfmpegCommand } from "./ffmpegTask";
import { gridOutputOptions, probeVideoMeta } from "./videoGrid";

export type { FrameKey, FrameOutputConfig } from "./frameOutputPlan";
export { buildFrameHandles, FRAME_OUTPUTS, staticNodeHandles } from "./frameOutputPlan";
export { createFrameOutputTool } from "./frameOutputTool";
export type { FrameApplyResult, FrameOutputState } from "./frameOutputTool";
export type { FrameOutputController } from "./frameOutputTool";

const VIDEO_MIME = /^video\//;
const CAPTURE_TIMEOUT_MS = 30000;
/**
 * ACT: 宫格要解完整段视频才能按 fps 采样，比单帧慢很多，单独放宽。
 * 三路串行的典型耗时在工具 120s 闸门内，但三路都超时的最坏情况会撞上闸门（整体取消，而非按路报错）。
 */
const GRID_CAPTURE_TIMEOUT_MS = 45000;

/** 抽帧结果被更新的调用/视频变化作废；UI 与工具都要把它和真实失败区分开。 */
export class FrameSupersededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FrameSupersededError";
  }
}

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
 * 首帧 / 尾帧 / 宫格输出端口的唯一实现：端口增删、抽帧、值回填、切换视频时的清空与重抽。
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
  /** 每路独立错误：关闭 A 不能把 B 的失败原因一起清掉。 */
  const errors = Object.fromEntries(FRAME_OUTPUTS.map((item) => [item.key, undefined])) as Record<FrameKey, string | undefined>;
  // ACT: 汇总必须遍历 FRAME_OUTPUTS——写死 first/last 时，宫格单独失败会静默丢失提示。
  function summarizeFrameErrors() {
    const messages = FRAME_OUTPUTS.flatMap((item) => errors[item.key] ? [errors[item.key]!] : []);
    return messages.length ? messages.join("；") : undefined;
  }
  function setFrameError(key: FrameKey, cause?: unknown) {
    errors[key] = cause === undefined ? undefined : describe(cause);
    error.value = summarizeFrameErrors();
  }

  // ACT: refresh 的整轮抽帧串行排队；单路开关有自己的 controller，不能互相取消。
  let queue: Promise<void> = Promise.resolve();
  /** 整轮代次：clear() 一升，排队中还没开跑的旧 runJob 必须整轮作废。 */
  let round = 0;
  /** 该路是否有一轮 refresh 已入队但还没开始：retry 与 pendingReason 都要看它。 */
  const queuedRounds = Object.fromEntries(FRAME_OUTPUTS.map((item) => [item.key, undefined])) as Record<FrameKey, number | undefined>;
  const controllers = Object.fromEntries(FRAME_OUTPUTS.map((item) => [item.key, undefined])) as Record<FrameKey, AbortController | undefined>;
  /** 每路一个单调递增的「意图代次」：只判断该路结果是否过时，关闭/开启一路不会作废另一路。 */
  const epochs = Object.fromEntries(FRAME_OUTPUTS.map((item) => [item.key, 0])) as Record<FrameKey, number>;
  /** 正在「开启」但配置尚未落盘的项：视频变化时 refresh 要把这些意图一并接过去。 */
  const pendingEnables = new Set<FrameKey>();
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

  function abortFrame(key: FrameKey) {
    controllers[key]?.abort();
    controllers[key] = undefined;
    epochs[key] += 1;
  }

  function abortAll() {
    for (const item of FRAME_OUTPUTS) abortFrame(item.key);
  }

  /** 立即清空所有已开启端口的值：旧帧一概不能留给下游。 */
  function clear() {
    round += 1;
    abortAll();
    for (const item of FRAME_OUTPUTS) {
      if (enabled.value[item.key]) delete outputs.value[item.handleId];
      errors[item.key] = undefined;
    }
    error.value = undefined;
  }

  function runFfmpeg(command: BrowserFfmpegCommand, signal: AbortSignal, key: FrameKey) {
    return runFfmpegCommand(command, signal, {
      timeoutMs: key === "grid" ? GRID_CAPTURE_TIMEOUT_MS : CAPTURE_TIMEOUT_MS,
      timeoutMessage: key === "grid" ? "宫格抽取超时，视频可能过大或过长" : "视频抽帧超时",
      abortMessage: "抽帧已取消",
    });
  }

  /**
   * 临时文件提交：确认已写盘 → 代次仍有效 → 删旧 → 再确认 → rename。
   * ACT: 工作区的 rename 是「不覆盖」语义（目标已存在直接 409 EEXIST），重抽时必须先删旧帧。
   * ACT: remove 与 rename 之间还隔着 await，过期结果连目标文件都不能碰，否则会删掉新一次刚写好的帧。
   */
  async function commitTemporary(files: WorkspaceFiles, temporary: string, target: string, isValid: () => boolean, label: string) {
    const temporaryName = splitPath(temporary).name;
    const listed = await files.list(splitPath(temporary).directory).catch(() => undefined);
    // ACT: 目录列表可能滞后于写入（inspect 为此加了同样的兜底）；列表没命中时再读一次文件，
    // 否则刚抽好的宫格会被误判成「未生成文件」，整次结果丢弃。
    const exists = listed === undefined
      || listed.entries.some((entry) => entry.type === "file" && entry.name === temporaryName)
      || await files.read(temporary).then(() => true, () => false);
    if (!exists) throw new Error(`${label}抽取失败：未生成文件`);
    if (!isValid()) throw new Error("抽帧已过期");
    await files.remove(target).catch(() => {});
    if (!isValid()) throw new Error("抽帧已过期");
    await files.rename(temporary, target);
  }

  async function extract(key: FrameKey, sourcePath: string, signal: AbortSignal, token: number) {
    const meta = frameOutputMeta(key);
    const files = getFiles();
    // ACT: 先检查取消再建目录，已取消的调用不该留下空节点目录。
    signal.throwIfAborted();
    const directory = await ensureNodeDirectory(files, id.value);
    signal.throwIfAborted();
    const target = `${directory}/${meta.fileName}`;
    // ACT: 先写唯一临时名再 rename。固定文件名 + 「文件已存在即通过」的校验，会在一路静默失败时
    // 把上一版视频的旧帧当成新帧回填；临时名让「没写盘」必然暴露，也避免半截文件被下游读到。
    const temporary = `${directory}/${meta.fileName}.${crypto.randomUUID()}.tmp.jpg`;
    const factory = await createFfmpeg(signal, { silentRequired: true });
    signal.throwIfAborted();
    const instance = factory(sourcePath).noAudio();
    try {
      // ACT: 宫格必须先探测时长与画面尺寸才能拼 fps/tile；首/尾帧不需要 probe。
      const task = key === "grid"
        ? instance.outputOptions(...gridOutputOptions(await probeVideoMeta(factory, sourcePath, signal), GRID_OUTPUT_COUNT)).output(temporary)
        : buildCaptureTask(instance, key, temporary);
      await runFfmpeg(task, signal, key);
      // ACT: 调用方中途取消时 epoch 不一定变（apply 的外部 signal 只 abort 自己的 controller），必须连 signal 一起判。
      await commitTemporary(files, temporary, target, () => token === epochs[key] && !signal.aborted, meta.label);
    } catch (cause) {
      await files.remove(temporary).catch(() => {});
      throw cause;
    }
    return target;
  }

  function buildCaptureTask(instance: BrowserFfmpegCommand, key: FrameCaptureKey, temporary: string) {
    const { input, output } = frameOutputOptions(key);
    return input.length
      ? instance.inputOptions(...input).outputOptions(...output).output(temporary)
      : instance.outputOptions(...output).output(temporary);
  }

  /**
   * 抽一张，返回可写回的路径；代次已过期时返回 undefined（结果作废）。
   * ACT: 这里**不能**判断「端口是否已开启」——开启端口时配置要等抽帧成功才写入，
   * 提前用 enabled 过滤会把这一次的结果丢掉，表现为「端口勾上了但永远没图」。
   */
  async function extractFrame(key: FrameKey, sourcePath: string, signal: AbortSignal, token: number) {
    const path = await extract(key, sourcePath, signal, token);
    signal.throwIfAborted();
    return token === epochs[key] ? path : undefined;
  }

  function writeValue(key: FrameKey, path: string) {
    outputs.value[frameOutputMeta(key).handleId] = { dataType: "IMAGE", value: { url: path, mimeType: "image/jpeg" } };
  }

  // ACT: axios 的 message 只有「Request failed with status code 409」，真正原因在响应体里。
  const describe = frameErrorMessage;

  type JobTicket = { round: number; epochs: Record<FrameKey, number>; explicitSource: boolean };

  async function runJob(source: string, wanted: readonly { key: FrameKey; label: string }[], ticket: JobTicket) {
    beginOp();
    let failed = false;
    try {
      for (const item of wanted) {
        // ACT: 排队期间视频又变了/被清空：整轮作废，绝不能拿旧 source 回填。
        // 显式传入 sourcePath 的调用由调用方负责（它可能还没写进 outputs.video）。
        if (ticket.round !== round || (!ticket.explicitSource && source !== currentVideoPath())) return;
        // ACT: 排队期间 Agent/用户对该路做了新的开关，以那次为准，本轮的旧 source 不得覆盖。
        if (ticket.epochs[item.key] !== epochs[item.key] || !enabled.value[item.key]) continue;
        // ACT: 每路独立 controller/代次——关闭或重开另一路不能把这一路正在抽的帧取消掉，
        // 否则该端口会 enabled 但永远没值（refresh 开头已经清空过旧值）。
        const current = new AbortController();
        controllers[item.key]?.abort();
        controllers[item.key] = current;
        const token = ++epochs[item.key];
        try {
          const path = await extractFrame(item.key, source, current.signal, token);
          // ACT: 抽帧途中端口被关掉时不能把值写回去。
          if (path && enabled.value[item.key] && token === epochs[item.key]) {
            writeValue(item.key, path);
            setFrameError(item.key);
          }
        } catch (cause) {
          // ACT: 一路失败不阻断另一路；成功的那张照常回填。
          if (current.signal.aborted || token !== epochs[item.key]) continue;
          failed = true;
          setFrameError(item.key, cause);
          ElMessage.warning(errors[item.key]!);
        } finally {
          if (controllers[item.key] === current) controllers[item.key] = undefined;
        }
      }
      // ACT: 只在整轮没有被作废且三路都无失败时收尾，不能把 apply 写入的失败原因清掉。
      if (!failed && ticket.round === round && !summarizeFrameErrors()) error.value = undefined;
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
    // ACT: 某路正在「开启」时（宫格要抽几十秒），video 变化会 abort 这次开启；先把开启意图落盘，
    // 否则 clear() 之后 config 里没有它，新一轮不会补抽，用户的开关被静默回退。
    if (pendingEnables.size) {
      const next = { ...config.value };
      for (const key of pendingEnables) next[key] = true;
      writeConfig(next);
      handles.value = buildFrameHandles(config.value, baseHandles);
    }
    clear();
    const wanted = enabledFrameOutputs(config.value);
    if (!source || !wanted.length) return queue;
    // ACT: 入队时快照整轮与每路代次；排队期间任何新意图都会让这轮跳过对应项。
    const ticket: JobTicket = { round, epochs: { ...epochs }, explicitSource: sourcePath !== undefined };
    for (const item of wanted) queuedRounds[item.key] = round;
    queue = queue.catch(() => {}).then(() => runJob(source, wanted, ticket)).finally(() => {
      // ACT: 只清本轮留下的排队标记；更新的 refresh 已经把自己的 round 写进去，不能被旧轮抹掉。
      for (const item of wanted) if (queuedRounds[item.key] === ticket.round) queuedRounds[item.key] = undefined;
    });
    return queue;
  }

  /** 读取某一项的当前状态，工具在未传该字段时用它补齐返回值。 */
  function state(key: FrameKey): FrameOutputState {
    const path = frameUrl(outputs.value, frameOutputMeta(key).handleId) ?? null;
    const isEnabled = enabled.value[key];
    return {
      enabled: isEnabled,
      path,
      ...(errors[key] ? { error: errors[key] } : {}),
      // ACT: 同样是「没值」，没有视频 / 正在抽帧（含已入队） / 失败后闲置对 Agent 的含义不同，必须分开。
      ...(isEnabled && !path ? {
        pendingReason: !currentVideoPath() ? "no-video" as const
          : controllers[key] || queuedRounds[key] === round ? "extracting" as const
            : "idle" as const,
      } : {}),
    };
  }

  /**
   * 可编程核心：开启先抽帧再出端口；关闭先计数再移除端口。失败一律抛出，不弹 UI。
   * 工具与 `toggle` 共用，避免两套状态机。
   */
  async function apply(key: FrameKey, on: boolean, signal?: AbortSignal): Promise<FrameApplyResult> {
    const meta = frameOutputMeta(key);
    if (on === enabled.value[key]) {
      const current = state(key);
      const inflight = Boolean(controllers[key]) || queuedRounds[key] === round;
      // ACT: 已开启但没值、也没有在途/排队的抽帧时，再调一次就是明确的重试意图，不能当空操作返回。
      const retry = on && !current.path && Boolean(currentVideoPath()) && !inflight;
      // ACT: 关闭请求遇到在途开启时不能早退——必须落下去 abort，让「最后一次为准」成立。
      if (!retry && !(!on && inflight)) {
        return {
          key,
          enabled: on,
          handleId: meta.handleId,
          path: current.path,
          pending: on && !current.path,
          ...(current.pendingReason ? { pendingReason: current.pendingReason } : {}),
          ...(current.error ? { error: current.error } : {}),
          removedEdges: 0,
        };
      }
    }
    signal?.throwIfAborted();
    if (!on) {
      // ACT: 必须先计数再改 handles——宿主在 handles 变化后的 post flush 才删悬空边，晚读恒为 0。
      const attached = getEdges.value.filter((edge) => edge.source === id.value && edge.sourceHandle === meta.handleId).length;
      // ACT: 只作废这一路的在途抽帧，另一路已开启端口不能被连带取消。
      abortFrame(key);
      delete outputs.value[meta.handleId];
      // ACT: 写回时重新读 config，别用入口快照——另一路可能在等待期间刚被开关。
      writeConfig({ ...config.value, [key]: false });
      handles.value = buildFrameHandles(config.value, baseHandles);
      setFrameError(key);
      // ACT: 帧文件保留——节点复制会复制 outputs 里的同一路径，删文件会误伤复制节点。
      await nextTick();
      return { key, enabled: false, handleId: meta.handleId, path: null, pending: false, removedEdges: attached };
    }
    const source = currentVideoPath();
    if (!source) {
      signal?.throwIfAborted();
      writeConfig({ ...config.value, [key]: true });
      handles.value = buildFrameHandles(config.value, baseHandles);
      setFrameError(key);
      await nextTick();
      return { key, enabled: true, handleId: meta.handleId, path: null, pending: true, pendingReason: "no-video", removedEdges: 0 };
    }
    const current = new AbortController();
    controllers[key]?.abort();
    controllers[key] = current;
    const callSignal = signal ? AbortSignal.any([current.signal, signal]) : current.signal;
    beginOp();
    pendingEnables.add(key);
    const token = ++epochs[key];
    try {
      const path = await extractFrame(key, source, callSignal, token);
      // ACT: 调用方主动取消时先报取消，不能包装成「抽帧结果已失效」误导 Agent。
      if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("操作已取消");
      if (!path || callSignal.aborted || token !== epochs[key]) throw new FrameSupersededError(`抽帧结果已失效，请重新开启${meta.label}输出`);
      // ACT: 写回时重新读 config，避免覆盖另一路在抽帧期间的开关。
      writeConfig({ ...config.value, [key]: true });
      handles.value = buildFrameHandles(config.value, baseHandles);
      // ACT: 配置要先落，端口才出得来；值紧随其后写入，两者一起生效。
      writeValue(key, path);
      setFrameError(key);
      // ACT: node.data.handles 由 nodeSkeleton 的 post-flush 同步；工具返回后 Agent 会立刻 connectNodes。
      await nextTick();
      return { key, enabled: true, handleId: meta.handleId, path, pending: false, removedEdges: 0 };
    } catch (cause) {
      if (cause instanceof FrameSupersededError) throw cause;
      if (signal?.aborted) throw cause instanceof Error ? cause : new Error("操作已取消");
      if (callSignal.aborted || token !== epochs[key]) {
        // ACT: 视频切换竞态：refresh 已把开启意图落盘并排了新一轮，这里按 pending 交回，
        // 不能报「请重新开启」——用户会以为开关被回退，实际马上就会补上。
        if (enabled.value[key]) {
          const current = state(key);
          return {
            key,
            enabled: true,
            handleId: meta.handleId,
            path: current.path,
            pending: true,
            ...(current.pendingReason ? { pendingReason: current.pendingReason } : {}),
            ...(current.error ? { error: current.error } : {}),
            removedEdges: 0,
          };
        }
        throw new FrameSupersededError(`抽帧结果已失效，请重新开启${meta.label}输出`);
      }
      setFrameError(key, cause);
      throw cause;
    } finally {
      pendingEnables.delete(key);
      endOp();
      if (controllers[key] === current) controllers[key] = undefined;
    }
  }

  /** 手动菜单的 UI 壳：负责提示文案，状态变化全部交给 `apply`。 */
  async function toggle(key: FrameKey, on: boolean) {
    const meta = frameOutputMeta(key);
    try {
      const result = await apply(key, on);
      if (!on && result.removedEdges) ElMessage.info(`已关闭${meta.label}输出，断开 ${result.removedEdges} 条连线`);
    } catch (cause) {
      // ACT: 被视频更新/新调用打断不是失败，按原行为提示重新开启。
      if (cause instanceof FrameSupersededError) return void ElMessage.info(cause.message);
      if (on) ElMessage.warning(`开启${meta.label}输出失败：${describe(cause)}`);
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
    abortAll();
  });

  // ACT: `cancel` 只中止在途抽帧、保留输出值——删除节点时用它；`clear` 是「视频变了」，会清值。
  return { config, enabled, values, busy, error, clear, cancel: abortAll, refresh, toggle, apply, state };
}
