/**
 * 节点任务提示音：用 WebAudio 现场合成，不引入音频文件，也不依赖系统音量之外的任何配置。
 *
 * ACT: AudioContext 必须在用户手势里创建/恢复，否则浏览器（含桌面 WebView）会把它挂在
 * suspended 上，之后所有提示音都静默。启动时挂一次 pointerdown 做解锁，播放前再 resume 一次兜底。
 */

export type ChimeKind = "success" | "failure";

/** 单音总音量。节点提醒是背景信息，不能盖过用户正在试听的素材。 */
const VOLUME = 0.18;
/** 两个音之间的静默间隔。 */
const GAP_SECONDS = 0.06;
/** 指数衰减到接近零的终点；exponentialRamp 不允许到 0。 */
const SILENCE = 0.0001;

let context: AudioContext | undefined;
let stopCurrent: (() => void) | undefined;

function getContext(): AudioContext | undefined {
  if (typeof window === "undefined") return undefined;
  if (context) return context;
  const Constructor = window.AudioContext
    ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Constructor) return undefined;
  try {
    context = new Constructor();
  } catch (error) {
    console.error("创建音频上下文失败：", error);
    return undefined;
  }
  return context;
}

/** 首次手势时调用：创建并恢复上下文，之后的播放在没有真实用户手势时也能出声。 */
export function unlockChime() {
  const audio = getContext();
  void audio?.resume().catch(() => {});
}

/** 播放一组双音：成功上行 660→880，失败下行 880→660。同一时刻只播一组。 */
export function playChime(kind: ChimeKind) {
  const audio = getContext();
  if (!audio) return;
  void audio.resume().catch(() => {});
  // ACT: 连续完成多个节点时，新提示音先停掉旧的，避免两段双音叠成刺耳的噪音。
  stopCurrent?.();
  const [first, second] = kind === "success" ? [660, 880] : [880, 660];
  const oscillators: OscillatorNode[] = [];
  const gains: GainNode[] = [];
  let cursor = audio.currentTime;
  [first, second].forEach((frequency, index) => {
    const duration = index === 0 ? 0.09 : 0.12;
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(VOLUME, cursor);
    gain.gain.exponentialRampToValueAtTime(SILENCE, cursor + duration);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start(cursor);
    oscillator.stop(cursor + duration);
    cursor += duration + GAP_SECONDS;
    oscillators.push(oscillator);
    gains.push(gain);
  });
  stopCurrent = () => {
    for (const oscillator of oscillators) {
      try { oscillator.stop(); }
      catch { /* 已经自然结束的振荡器再停会抛错，忽略。 */ }
    }
    for (const gain of gains) gain.disconnect();
    stopCurrent = undefined;
  };
}
