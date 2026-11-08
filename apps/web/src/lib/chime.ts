/**
 * 任务提示音：用 WebAudio 现场合成，不引入音频文件；音量由设置页的「提示音音量」控制（缺省 40%，0 静音）。
 *
 * ACT: AudioContext 必须在用户手势里创建/恢复，否则浏览器（含桌面 WebView）会把它挂在
 * suspended 上，之后所有提示音都静默。启动时挂一次 pointerdown 做解锁，播放前再 resume 一次兜底。
 */

import { generalSettings } from "@/stores/settings";

export type ChimeKind = "success" | "failure" | "question";

/** 每种提醒的双音音高：完成上行、失败下行，提问用同音双击拉开区分。 */
const chimePitches: Record<ChimeKind, readonly [number, number]> = {
  success: [660, 880],
  failure: [880, 660],
  question: [880, 880],
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

/** 播放一组双音（音高见 chimePitches）。同一时刻只播一组。 */
export function playChime(kind: ChimeKind) {
  const volume = currentVolume();
  // ACT: 调到 0 时连正在响的一声也立刻停掉，否则刚调静音还会听到上一次的尾音。
  if (volume <= 0) { stopCurrent?.(); return; }
  const audio = getContext();
  if (!audio) return;
  void audio.resume().catch(() => {});
  // ACT: 连续完成多个节点时，新提示音先停掉旧的，避免两段双音叠成刺耳的噪音。
  stopCurrent?.();
  const [first, second] = chimePitches[kind];
  const oscillators: OscillatorNode[] = [];
  const gains: GainNode[] = [];
  let cursor = audio.currentTime;
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
  stopCurrent = () => {
    for (const oscillator of oscillators) {
      try { oscillator.stop(); }
      catch { /* 已经自然结束的振荡器再停会抛错，忽略。 */ }
    }
    for (const gain of gains) gain.disconnect();
    stopCurrent = undefined;
  };
}
