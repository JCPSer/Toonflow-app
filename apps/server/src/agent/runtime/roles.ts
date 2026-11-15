import { z } from "zod";
import { getAgentHost } from "@/agent/host";

export const AGENT_ROLE_LIMITS = { count: 50, name: 40, description: 200, prompt: 20000 } as const;

/** ACT: 角色是全局可复用的 Agent 身份（名称 + 系统提示词），存在设置里，不跟随项目。 */
export const agentRoleSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().trim().min(1).max(AGENT_ROLE_LIMITS.name),
  description: z.string().trim().max(AGENT_ROLE_LIMITS.description).optional(),
  prompt: z.string().trim().min(1).max(AGENT_ROLE_LIMITS.prompt),
  updatedAt: z.string().max(40).optional(),
});

export const agentRolesSchema = z.array(agentRoleSchema).max(AGENT_ROLE_LIMITS.count);

export type AgentRole = z.infer<typeof agentRoleSchema>;

/**
 * ACT: 保存与读取共用同一套清洗：坏项丢弃、id 去重、超长截断、数量截断。
 * 角色库混在设置里，不能因为一条脏角色让整个设置保存失败。
 */
export function sanitizeAgentRoles(raw: unknown): AgentRole[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const roles: AgentRole[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const source = item as Record<string, unknown>;
    const id = typeof source.id === "string" ? source.id.trim() : "";
    if (!id || id.length > 64 || seen.has(id)) continue;
    const name = typeof source.name === "string" ? source.name.trim().slice(0, AGENT_ROLE_LIMITS.name) : "";
    const prompt = typeof source.prompt === "string" ? source.prompt.trim().slice(0, AGENT_ROLE_LIMITS.prompt) : "";
    if (!name || !prompt) continue;
    const description = typeof source.description === "string" && source.description.trim()
      ? source.description.trim().slice(0, AGENT_ROLE_LIMITS.description) : undefined;
    const updatedAt = typeof source.updatedAt === "string" && source.updatedAt.length <= 40 ? source.updatedAt : undefined;
    seen.add(id);
    roles.push({ id, name, prompt, ...(description ? { description } : {}), ...(updatedAt ? { updatedAt } : {}) });
    if (roles.length >= AGENT_ROLE_LIMITS.count) break;
  }
  return roles;
}

/** 读设置里的角色库；清洗规则与保存一致，避免 UI 可用、服务端却找不到。 */
export function listAgentRoles(): AgentRole[] {
  return sanitizeAgentRoles((getAgentHost().settings.get("settings", {}) as { agentRoles?: unknown }).agentRoles);
}

export function findAgentRole(id: string | undefined): AgentRole | undefined {
  if (!id) return undefined;
  return listAgentRoles().find(role => role.id === id);
}

/**
 * ACT: 角色提示词放在最前，默认/自定义系统提示作为补充。
 * 只做纯文本拼接，不展开 {{tools}} 等占位符——占位符由默认提示段自己处理。
 * 职责、语气、工作范围以角色为准；工具授权、算力确认、资料与凭据边界仍按软件规则执行。
 */
export function composeRolePrompt(rolePrompt: string | undefined, basePrompt: string) {
  const role = rolePrompt?.trim();
  if (!role) return basePrompt;
  return `## 角色设定（优先）\n${role}\n\n以下是软件的通用规则与运行环境说明，作为补充：职责、语气与工作范围以本段为准；工具授权、算力确认、资料与凭据边界仍按软件规则执行。\n\n${basePrompt}`;
}
