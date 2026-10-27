// ACT: 应用层访问 agent 能力的唯一门面。反向依赖（应用 → agent）只允许出现在本文件与组合根装配文件，
// agent 自身只依赖 agent/host.ts 契约，两者方向相反，静态依赖环由此断开。
export * as agent from "@/agent";
export { agentLog } from "@/agent/log";
export { createAgentToolContext, createAgentTools } from "@/agent/tools";
export { createAgentModel, getAgentModelConfiguration } from "@/agent/runtime/model";
export { defaultSystemPrompt, maxSystemPromptLength } from "@/agent/runtime/prompt";
export { getToolResultText } from "@/agent/runtime/sessions";
export { configureAgentRequests } from "@/agent/runtime/requests";
export * as canvas from "@/agent/bridge/canvas";
export * as question from "@/agent/bridge/question";
export * as a2aSettings from "@/agent/a2a/settings";
export { createA2aRouter } from "@/agent/a2a";
export * as mentionFiles from "@/agent/mentionFiles";
export type { AgentEvent } from "@/agent/runtime/types";
