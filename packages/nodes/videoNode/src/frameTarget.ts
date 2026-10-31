export type FrameCommand = "current" | "first" | "last";

// ACT: 浏览器 currentTime 的语义是「包含该时刻的那一帧」，但把它设成与当前值相同的数不会派发 seeked，
// 截帧会一直等到超时。0.001s 仍落在首帧内（任何 fps < 1000 都成立），又能触发一次真实 seek。
export const FRAME_EPSILON = 0.001;

/**
 * 兜底取帧（canvas）的目标时刻。有宿主 ffmpeg 时不用它，但两处口径必须一致：
 * 首帧 = 第一帧，尾帧 = 最后一帧，当前帧 = 播放器当前显示的帧。
 */
export function frameTarget(command: FrameCommand, duration: number, currentTime = 0) {
  const total = Number.isFinite(duration) && duration > 0 ? duration : 0;
  // ACT: 比 epsilon 还短的视频（<1ms）取 duration 本身，不能退化成 0——0 不会派发 seeked。
  const maximum = total > 0 ? Math.min(total, Math.max(FRAME_EPSILON, total - FRAME_EPSILON)) : FRAME_EPSILON;
  if (command === "first") return Math.min(FRAME_EPSILON, maximum);
  if (command === "last") return maximum;
  const current = Number.isFinite(currentTime) ? Math.max(0, currentTime) : 0;
  return Math.min(current, maximum);
}
