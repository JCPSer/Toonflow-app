import { t } from "@/lib/i18n";
import { readFile } from "@toonflow/file";
import { join } from "node:path";
import { DefaultResourceLoader, SettingsManager, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { buildSystemPrompt } from "@/agent/runtime/prompt";
import { autoCompactStrategy, getAgentPreferences } from "@/agent/runtime/preferences";
import { loadAgentSkills } from "@/agent/skills";
import { resolveWorkspacePath } from "@/modules/localRuntime/workspace/files";
import { isMemoryEnabled, readDocument } from "@/modules/platformCore/personalization";
import conf from "@/modules/platformCore/conf";
import { getRuntimePlatform } from "@/lib/platform";

/**
 * 会话设置。主会话按用户偏好与模型窗口决定压缩阈值；子会话复用同一套压缩配置但关闭重试。
 * 没有窗口信息时沿用 SDK 默认预留量，保持旧调用点行为不变。
 */
export function createAgentSettings(contextWindow?: number, options: { retry?: boolean; maxOutputTokens?: number } = {}) {
  const window = typeof contextWindow === "number" && Number.isFinite(contextWindow) && contextWindow > 0 ? contextWindow : 0;
  const { autoCompact } = getAgentPreferences();
  // ACT: 预留量必须覆盖模型最大输出，否则高百分比下「输入 + 输出」仍会超出窗口。
  const strategy = autoCompactStrategy(window, options.maxOutputTokens ?? 0);
  return SettingsManager.inMemory({
    compaction: { enabled: autoCompact && strategy.enabled, reserveTokens: strategy.reserveTokens, keepRecentTokens: strategy.keepRecentTokens },
    // ACT: 重试由 requests.ts 的空闲看门狗触发，次数上限压到 2，避免长时间静默等待。
    retry: options.retry === false
      ? { enabled: false, provider: { maxRetries: 0 } }
      : { enabled: true, maxRetries: 2, baseDelayMs: 2000 },
  });
}

export async function createAgentResources(cwd: string, tools: ToolDefinition[], settings = createAgentSettings(), instructions = "") {
  const savedPrompt = conf.get("settings", {}).agentSystemPrompt;
  const systemPrompt = typeof savedPrompt === "string" ? savedPrompt : undefined;
  const agentDir = join(cwd, ".agent");
  const { path: agentsPath } = await resolveWorkspacePath(cwd, "AGENTS.md");
  const agentsContent = await readFile(agentsPath, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return "";
    throw new Error(t`读取工作区 AGENTS.md 失败：${error.message}`, { cause: error });
  });
  const [globalAgents, memory] = await Promise.all([readDocument("agents"), isMemoryEnabled() ? readDocument("memory") : { content: "" }]);
  const skills = loadAgentSkills(cwd);
  const sdkSkills = tools.some(tool => tool.name === "skillOperator")
    ? { ...skills, skills: skills.skills.map(skill => ({ ...skill, disableModelInvocation: true })) }
    : skills;
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager: settings,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    // ACT: 仅自动载入工作区根目录的 AGENTS.md，关闭 SDK 向父目录和其他指令文件的自动扫描。
    noContextFiles: true,
    agentsFilesOverride: () => ({ agentsFiles: agentsContent.trim() ? [{ path: agentsPath, content: agentsContent.replace(/^\uFEFF/, "") }] : [] }),
    // ACT: 技能正文按需读取；每个会话独立创建 loader，避免 SDK 的会话绑定互相覆盖。
    skillsOverride: () => sdkSkills,
    systemPrompt: "",
    systemPromptOverride: () => [buildSystemPrompt({ systemPrompt, tools, skills: skills.skills, platform: getRuntimePlatform().os }), instructions].filter(Boolean).join("\n\n"),
    appendSystemPrompt: [
      globalAgents.content.trim() ? `## 全局协作规范（AGENTS.md）\n${globalAgents.content}` : "",
      memory.content.trim() ? `## 全局长期记忆\n以下是跨对话保存的偏好与事实，使用前核对适用项目，以用户本轮要求为准。\n<global_memory>\n${memory.content}\n</global_memory>` : "",
    ].filter(Boolean),
  });
  await resourceLoader.reload();
  return { agentDir, settingsManager: settings, resourceLoader };
}
