/**
 * Agent 提问提示音：与节点完成/失败共用「节点提示音」开关，音型独立（同音双击）。
 *
 * ACT: 多个画布节点或子 Agent 可能在同一瞬间提问，1 秒内只保留第一声；
 * 判定复用 taskAlerts.shouldPlayChime，避免开关口径在两处漂移。
 */
import { playChime } from "@/lib/chime";
import { MERGE_WINDOW_MS, shouldPlayChime } from "@/lib/taskAlerts";

/** 上次响铃时间；合并窗口与节点完成提醒共用 MERGE_WINDOW_MS，避免两处各改各的。 */
let lastPlayedAt = Number.NEGATIVE_INFINITY;

/** 画布 Agent 提问时调用：按提示音开关判定（不看前后台），1 秒内的密集提问只响第一声。 */
export function playQuestionChime() {
  if (!shouldPlayChime()) return;
  const now = performance.now();
  if (now - lastPlayedAt < MERGE_WINDOW_MS) return;
  lastPlayedAt = now;
  playChime("question");
}
