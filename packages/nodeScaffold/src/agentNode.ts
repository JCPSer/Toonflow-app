import { computed, inject, type ComputedRef } from "vue";

/** Agent 节点状态：无会话/未发过消息、有会话但不在跑、已下发未见回应、流进行中、正在压缩上下文。 */
export type AgentNodeStatus = "idle" | "waiting" | "thinking" | "running" | "compacting";

export type AgentNodeStatusTable = Record<string, AgentNodeStatus>;

// ACT: 节点包是独立打包的 UMD，宿主的 provide 与节点包的 inject 分属两个 Bundle，
// 普通 Symbol 在两边不相等，必须走 Symbol.for 的全局注册表才能对上。
export const AGENT_NODE_STATUS_KEY = Symbol.for("toonflow.agentNodeStatus");

// ACT: 状态由画布层的面板实例维护并 provide；不能写进 node.data —— 画布对 data 有 500ms
// 防抖保存，状态每次变化都会落盘。没有宿主时退化为 idle，保证节点单独渲染不炸。
export function useAgentNodeStatus(nodeId: string): ComputedRef<AgentNodeStatus> {
  const table = inject<AgentNodeStatusTable | undefined>(AGENT_NODE_STATUS_KEY, undefined);
  return computed(() => table?.[nodeId] ?? "idle");
}
