import conf from "@/modules/platformCore/conf";

/**
 * ACT: 上下文与权限相关的用户偏好集中在这里读取，避免各调用点各自解析 settings 结构。
 * settings.agent.compactPercent / toolOutputMaxBytes 由设置页写入；developer.agentFullAccess 在开发者选项里。
 */
export type AgentPreferences = {
  compactPercent: number;
  autoCompact: boolean;
  toolOutputMaxBytes: number;
  toolOutputPreviewBytes: number;
  fullAccess: boolean;
};

const DEFAULT_COMPACT_PERCENT = 80;
const DEFAULT_TOOL_OUTPUT_MAX_BYTES = 20 * 1024;
const DEFAULT_TOOL_OUTPUT_PREVIEW_BYTES = 4 * 1024;

function pickNumber(value: unknown, min: number, max: number, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;
}

export function getAgentPreferences(): AgentPreferences {
  const settings = conf.get("settings", {}) as { agent?: Record<string, unknown>; developer?: Record<string, unknown> };
  const agent = settings.agent ?? {};
  return {
    compactPercent: pickNumber(agent.compactPercent, 50, 95, DEFAULT_COMPACT_PERCENT),
    autoCompact: typeof agent.autoCompact === "boolean" ? agent.autoCompact : true,
    toolOutputMaxBytes: pickNumber(agent.toolOutputMaxBytes, 4096, 4 * 1024 * 1024, DEFAULT_TOOL_OUTPUT_MAX_BYTES),
    toolOutputPreviewBytes: pickNumber(agent.toolOutputPreviewBytes, 1024, 64 * 1024, DEFAULT_TOOL_OUTPUT_PREVIEW_BYTES),
    fullAccess: settings.developer?.agentFullAccess === true,
  };
}

/** 自动压缩预留量：百分比越高越晚压缩，但必须覆盖模型最大输出，且不超过窗口一半。 */
export function compactReserveTokens(contextWindow: number, percent = getAgentPreferences().compactPercent, maxOutputTokens = 0) {
  if (!Number.isFinite(contextWindow) || contextWindow <= 0) return 16384;
  const byPercent = Math.round(contextWindow * (1 - Math.min(95, Math.max(50, percent)) / 100));
  const reserve = Math.max(byPercent, maxOutputTokens, 4096);
  // ACT: 预留不能吃掉半个窗口，否则小窗口模型会每轮都触发压缩。
  return Math.min(reserve, Math.floor(contextWindow / 2));
}

/**
 * 自动压缩策略：窗口太小时直接关闭（压缩后仍可能超限），并给出与窗口匹配的保留量。
 * keepRecent + 预留 + 摘要余量必须小于窗口，否则会陷入「压完立刻再压」。
 */
export function autoCompactStrategy(contextWindow: number, maxOutputTokens = 0, percent = getAgentPreferences().compactPercent) {
  if (!Number.isFinite(contextWindow) || contextWindow <= 0) return { enabled: false, reserveTokens: 16384, keepRecentTokens: 20000 };
  if (contextWindow <= 16384) return { enabled: false, reserveTokens: 4096, keepRecentTokens: Math.max(1000, Math.floor(contextWindow / 4)) };
  const reserveTokens = compactReserveTokens(contextWindow, percent, maxOutputTokens);
  const budget = contextWindow - reserveTokens;
  const byEighth = Math.floor(contextWindow / 8);
  const keepRecentTokens = Math.max(1000, Math.min(20000, byEighth, budget - 2048));
  return { enabled: true, reserveTokens, keepRecentTokens };
}

export const agentArtifactsDirectory = ".agent/artifacts";
