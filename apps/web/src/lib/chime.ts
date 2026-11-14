/**
 * 任务提示音：用 WebAudio 现场合成，不引入音频文件；音量由设置页的「提示音音量」控制（缺省 40%，0 静音）。
 *
 * ACT: AudioContext 必须在用户手势里创建/恢复，否则浏览器（含桌面 WebView）会把它挂在
 * suspended 上，之后所有提示音都静默。
 *
 * ACT: 锁屏/切后台会被系统中断音频会话（WKWebView 下 state 变 suspended 或 interrupted）。
 * 所以「解锁一次就把手势监听摘掉」的做法撑不过长时间运行——那正是「刚开始有、锁屏后再也不响」
 * 的成因。这里改成四条常驻恢复通道：手势、回前台/解锁唤醒、定时健康自检、播放前兜底；
 * resume 不成功则重建 AudioContext（旧实例可能已坏死，只有新实例才能恢复）。
 *
 * ACT: 所有 resume 都必须有超时。WebKit 在音频会话被系统中断时，resume() 返回的 Promise 可能
 * 长期不 settle；一旦把它当成在途任务复用，手势/唤醒/自检会一起被卡死，等于把原 bug 换层皮。
 */

import { generalSettings } from "@/stores/settings";

export type ChimeKind = "success" | "failure" | "question";

/** 每种提醒的双音音高：完成上行、失败下行，提问用同音双击拉开区分。 */
const chimePitches: Record<ChimeKind, readonly [number, number]> = {
  success: [660, 880],
  failure: [880, 660],
  question: [880, 880],
};

/** 单次 resume 的最长等待：超时按失败处理，继续走重建。 */
const RESUME_TIMEOUT_MS = 1500;
/** 重建冷却起点；连续重建仍起不来就指数退避，避免用户在坏死环境里点一下造一个实例。 */
const REBUILD_COOLDOWN_MS = 5000;
const REBUILD_COOLDOWN_MAX_MS = 300_000;
/**
 * ACT: state 报 running 但音频会话其实死了的情况只能靠时钟识别——
 * running 的上下文 currentTime 一定在推进，墙钟走了很久而它原地不动就是冻结。
 */
const FROZEN_WINDOW_MS = 5000;
/** 健康自检间隔；WKWebView 后台会节流，只作兜底，不指望它单独生效。 */
const HEALTH_INTERVAL_MS = 60_000;
/** 回前台/解锁后的重试时刻（毫秒）：系统音频会话通常先于 WebView 就绪，需要退避。 */
const WAKE_RETRY_DELAYS = [0, 300, 1500, 5000] as const;
/** 需要手势的输入事件；passive 监听只读状态，不干扰业务。 */
const GESTURE_EVENTS = ["pointerdown", "keydown", "touchstart"] as const;

/** AudioContextState 之外，WebKit 还会报 interrupted，这里一并收进可观测状态。 */
type ChimeState = AudioContextState | "interrupted" | "unavailable";

type ChimeStats = {
  /** 从 running 掉到非 running 的次数。 */
  interruptions: number;
  /** 重建 AudioContext 的次数。 */
  resurrections: number;
  /** 播放时上下文不可用的次数（说明这一声很可能没被听到）。 */
  suspendedChimes: number;
  /** 最近一次状态变化的可读描述。 */
  lastEvent: string;
  /** 最近一次排音时的上下文时钟与墙钟，用来判断 state 是否在说谎。 */
  lastPlay: { audioTime: number; wallTime: number } | undefined;
};

/**
 * ACT: 音量由设置页的「提示音音量」百分比决定（0-100，缺省 40），不再写死固定增益——
 * 同一份提示音在不同机器/不同听音环境下感受差别很大。0 直接不发声，避免“以为关了”却还有残响。
 */
function currentVolume() {
  // generalSettings 已做 0-100 归一化，这里只换算成增益，不再重复兜底。
  return generalSettings.value.completionSoundVolume / 100;
}
/** 两个音之间的静默间隔。 */
const GAP_SECONDS = 0.06;
/** 指数衰减到接近零的终点；exponentialRamp 不允许到 0。 */
const SILENCE = 0.0001;

let context: AudioContext | undefined;
let stopCurrent: (() => void) | undefined;
/** 在途的恢复任务：同一瞬间的手势/唤醒/播放共用一次 resume，避免互相打断。 */
let resumeTask: { promise: Promise<boolean>; rebuild: boolean } | undefined;
let lastRebuildAt = Number.NEGATIVE_INFINITY;
/** 连续重建仍未恢复的次数，用于指数退避。 */
let rebuildFailures = 0;
/** 唤醒重试序列的代际标记：新一轮唤醒作废旧序列。 */
let wakeToken = 0;
const stats: ChimeStats = {
  interruptions: 0,
  resurrections: 0,
  suspendedChimes: 0,
  lastEvent: "init",
  lastPlay: undefined,
};

function audioConstructor() {
  if (typeof window === "undefined") return undefined;
  return window.AudioContext
    ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
}

/** 新建一个上下文并挂状态监听；创建失败返回 undefined，调用方保持旧实例不变。 */
function createContext(): AudioContext | undefined {
  const Constructor = audioConstructor();
  if (!Constructor) return undefined;
  let previous: AudioContextState = "suspended";
  try {
    const audio = new Constructor();
    previous = audio.state;
    audio.addEventListener("statechange", () => {
      const state = audio.state;
      // ACT: 只有当前实例的状态变化才算数；被 close() 的旧实例会补一条 closed 事件，
      // 顺手覆盖 lastEvent 会把真正的排障线索（rebuild:xxx）冲掉。
      if (audio === context) {
        stats.lastEvent = `statechange:${previous}->${state}`;
        if (previous === "running" && state !== "running") {
          stats.interruptions += 1;
          console.warn("[chime] 音频上下文被中断：", state);
        }
      }
      previous = state;
    });
    return audio;
  } catch (error) {
    console.error("创建音频上下文失败：", error);
    return undefined;
  }
}

function ensureContext() {
  // closed 是确定死亡，直接丢弃新建，不必等冷却——冷却只用来挡「反复失败的重建」。
  if (context?.state === "closed") context = createContext();
  context ??= createContext();
  return context;
}

function rebuildCooldown() {
  return Math.min(REBUILD_COOLDOWN_MS * 2 ** rebuildFailures, REBUILD_COOLDOWN_MAX_MS);
}

/**
 * ACT: 旧实例可能已经坏死（换过输出设备、长时间被系统中断），resume() 永远不返回 running。
 * 只有新实例能救；但重建本身也需要后续手势，所以只在确实失败时做，并加冷却。
 */
function rebuildContext(reason: string) {
  const now = performance.now();
  if (now - lastRebuildAt < rebuildCooldown()) return undefined;
  const next = createContext();
  if (!next) return undefined;
  lastRebuildAt = now;
  rebuildFailures += 1;
  // ACT: 先把旧图停掉再换实例——close() 失败时旧上下文还活着，排好的音会在之后某刻响，
  // 而这时 stopCurrent 已经被丢弃，再也停不掉。
  stopCurrent?.();
  const old = context;
  context = next;
  stats.resurrections += 1;
  stats.lastEvent = `rebuild:${reason}`;
  console.info("[chime] 重建音频上下文：", reason);
  if (old) void old.close().catch(() => { /* 已关闭或不可关闭都忽略。 */ });
  return next;
}

// ACT: 返回 plain boolean 而不是类型谓词——谓词会把「不 running」的负分支收窄成 never，
// 后续对 state 的比较会被 TS 判成恒假，正是上一版踩过的坑。
function isRunning(audio: AudioContext | undefined) {
  return !!audio && audio.state === "running";
}

/** 上下文时钟是否冻结：running 却原地不动，说明音频会话已死但 state 还没更新。 */
function isFrozen(audio: AudioContext) {
  const last = stats.lastPlay;
  if (!last || !isRunning(audio)) return false;
  return performance.now() - last.wallTime > FROZEN_WINDOW_MS
    && audio.currentTime - last.audioTime < 0.001;
}

/** 可真正出声的上下文：running 且时钟在走。 */
function isUsable(audio: AudioContext | undefined) {
  if (!audio) return false;
  return isRunning(audio) && !isFrozen(audio);
}

/** 读取当前可观测状态，供设置页与诊断钩子使用。 */
function chimeState(): ChimeState {
  if (!context) return "unavailable";
  return context.state as ChimeState;
}

async function tryResume(audio: AudioContext) {
  // ACT: resume() 可能永不 settle，必须自己设超时；Promise.race 会给原 Promise 挂上处理，
  // 即使它稍后才 reject 也不会变成未处理拒绝。
  try {
    await Promise.race([
      audio.resume(),
      new Promise<void>(resolve => { setTimeout(resolve, RESUME_TIMEOUT_MS); }),
    ]);
  } catch {
    return false;
  }
  // ACT: 用属性读取而不是直接比较，避免 TS 按上一次判断把 state 收窄成「不可能 running」。
  if (!isRunning(audio)) return false;
  rebuildFailures = 0;
  return true;
}

export type ResumeChimeOptions = {
  /** 失败时是否重建上下文；唤醒/自检没有手势，重建也起不来，传 false。 */
  rebuild?: boolean;
};

function startResume(rebuild: boolean): Promise<boolean> {
  const audio = ensureContext();
  if (!audio) return Promise.resolve(false);
  if (isUsable(audio)) return Promise.resolve(true);
  // ACT: 只有在「当前实例已冻结」时才跳过 resume 直接重建——对冻结的上下文 resume 会立刻
  // 返回成功（state 本来就是 running），永远走不到重建分支。
  const frozen = isRunning(audio);
  const task = (async () => {
    // ACT: 调用方多为 fire-and-forget 的手势回调，异常必须在这里吃掉，不能变成未处理拒绝。
    try {
      if (!frozen && await tryResume(audio)) return true;
      if (!rebuild) return false;
      const next = rebuildContext(frozen ? "context-frozen" : "resume-failed");
      return next ? await tryResume(next) : false;
    } catch {
      return false;
    }
  })();
  resumeTask = { promise: task, rebuild };
  void task.finally(() => { if (resumeTask?.promise === task) resumeTask = undefined; });
  return task;
}

/** 把音频上下文拉到 running；返回是否成功。失败时按需重建实例再试一次。 */
export function resumeChime(options: ResumeChimeOptions = {}): Promise<boolean> {
  const { rebuild = true } = options;
  const pending = resumeTask;
  if (!pending) return startResume(rebuild);
  // ACT: 在途任务不允许重建、而本次请求允许时，不能直接复用它——那会吞掉唯一一次重建机会。
  if (!rebuild || pending.rebuild) return pending.promise;
  return pending.promise.then(ok => (ok ? true : startResume(true)));
}

/** 当前环境是否有可用的音频上下文构造器。 */
export function chimeSupported() {
  return !!audioConstructor();
}

/**
 * ACT: 手势监听常驻，不再「成功一次就解绑」——长时间运行期间系统会反复中断音频会话，
 * 每次中断后都需要一条能重新拉起的手势通道；处理函数先判状态，可用时开销只是一次读取。
 */
export function installChimeUnlock() {
  if (typeof window === "undefined") return;
  const scope = window as Window & { __toonflowChimeInstalled?: boolean };
  if (scope.__toonflowChimeInstalled) {
    installChimeDiagnostics();
    return;
  }
  scope.__toonflowChimeInstalled = true;
  const onGesture = () => { if (!isUsable(context)) void resumeChime(); };
  for (const event of GESTURE_EVENTS) window.addEventListener(event, onGesture, { capture: true, passive: true });
  // ACT: 无手势也能恢复的机会：解锁/切回前台后系统音频会话恢复，退避重试往往就能拉起来。
  // 只有已经创建过上下文（用户在这次会话里动过）才尝试——没有手势时新建的实例同样起不来。
  const needRecovery = () => !!context && !isUsable(context);
  const onWake = () => { if (needRecovery()) scheduleWakeRecovery(); };
  document.addEventListener("visibilitychange", () => { if (!document.hidden) onWake(); });
  window.addEventListener("focus", onWake);
  window.addEventListener("pageshow", onWake);
  setInterval(() => { if (needRecovery()) void resumeChime({ rebuild: false }); }, HEALTH_INTERVAL_MS);
  installChimeDiagnostics();
}

function scheduleWakeRecovery() {
  const token = ++wakeToken;
  let index = 0;
  const step = () => {
    // ACT: 新一轮唤醒已经接管，旧的退避序列必须作废，否则会叠出多条重试。
    if (token !== wakeToken) return;
    void resumeChime({ rebuild: false }).then((ok) => {
      if (ok || token !== wakeToken) return;
      index += 1;
      if (index < WAKE_RETRY_DELAYS.length) setTimeout(step, WAKE_RETRY_DELAYS[index]);
    });
  };
  setTimeout(step, WAKE_RETRY_DELAYS[0]);
}

type ChimeDiagnostics = {
  readonly state: ChimeState;
  readonly stats: ChimeStats;
  resume: () => Promise<boolean>;
  play: (kind: ChimeKind) => void;
};

/** 诊断钩子：复现「又不响了」时直接在控制台看状态，不需要临时插桩。 */
function installChimeDiagnostics() {
  if (typeof window === "undefined") return;
  (window as Window & { __toonflowChime?: ChimeDiagnostics }).__toonflowChime = {
    get state() { return chimeState(); },
    get stats() { return { ...stats }; },
    resume: () => resumeChime(),
    play: kind => playChime(kind),
  };
}

/** 播放一组双音（音高见 chimePitches）。同一时刻只播一组，且绝不向调用方抛错。 */
export function playChime(kind: ChimeKind) {
  const volume = currentVolume();
  // ACT: 调到 0 时连正在响的一声也立刻停掉，否则刚调静音还会听到上一次的尾音。
  if (volume <= 0) { stopCurrent?.(); return; }
  const pending = resumeTask;
  if (pending && !isUsable(context)) {
    // ACT: 在途恢复可能重建上下文并关掉当前实例，此时排的音会排在一张已关闭的图上。
    // 等它落地（内部有超时）再排，代价是这一声最多晚 1.5 秒。
    void pending.promise.then(() => renderChime(kind, volume)).catch(() => {});
    return;
  }
  renderChime(kind, volume);
}

function renderChime(kind: ChimeKind, volume: number) {
  const audio = ensureContext();
  if (!audio) return;
  if (!isUsable(audio)) {
    stats.suspendedChimes += 1;
    stats.lastEvent = `play-while-${chimeState()}`;
    // ACT: 这里不重建——没有手势时新建的实例同样起不来，还会把可能自愈的旧实例换掉。
    // 排音照排：suspended 时 currentTime 不推进，一旦恢复就会在恢复瞬间播出。
    void resumeChime({ rebuild: false });
  }
  // ACT: 连续完成多个节点时，新提示音先停掉旧的，避免两段双音叠成刺耳的噪音。
  stopCurrent?.();
  const [first, second] = chimePitches[kind];
  const oscillators: OscillatorNode[] = [];
  const gains: GainNode[] = [];
  try {
    let cursor = audio.currentTime;
    stats.lastPlay = { audioTime: cursor, wallTime: performance.now() };
    [first, second].forEach((frequency, index) => {
      const duration = index === 0 ? 0.09 : 0.12;
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(volume, cursor);
      gain.gain.exponentialRampToValueAtTime(SILENCE, cursor + duration);
      oscillator.connect(gain).connect(audio.destination);
      oscillator.start(cursor);
      oscillator.stop(cursor + duration);
      cursor += duration + GAP_SECONDS;
      oscillators.push(oscillator);
      gains.push(gain);
    });
  } catch (error) {
    // ACT: 上下文 closed 时 createOscillator 会抛 InvalidStateError。提示音绝不能让调用方
    // （taskAlerts 的提示音后面的桌面通知、设置页试听）中断，这里收掉并让下次手势去重建。
    console.warn("[chime] 排音失败：", error);
    stats.lastEvent = `render-failed:${chimeState()}`;
    stopCurrent = undefined;
    return;
  }
  stopCurrent = () => {
    for (const oscillator of oscillators) {
      try { oscillator.stop(); }
      catch { /* 已经自然结束的振荡器再停会抛错，忽略。 */ }
    }
    for (const gain of gains) {
      try { gain.disconnect(); }
      catch { /* 上下文已关闭时断开连接会抛错，忽略。 */ }
    }
    stopCurrent = undefined;
  };
}
