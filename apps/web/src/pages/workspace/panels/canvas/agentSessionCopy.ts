type AgentNodeData = {
  agentSessionFile?: string;
  agentSessionCloneFrom?: string;
  agentLastPrompt?: string;
};

/**
 * 复制/粘贴 Agent 节点时，把会话绑定降级成「待克隆」指针。
 * 节点包自己的 copy 事件会做同样的事，但事件依赖节点组件已挂载；旧版节点包、脚本加载失败或
 * 其它绕过节点事件的路径都会让副本原样带走 agentSessionFile，两个节点共用一个 jsonl 就变成孪生会话。
 * 这里在画布层再兜一次底，保证任何复制路径都不会共享会话文件。
 */
export function detachAgentSession<T extends { type?: string; data?: unknown }>(node: T): T {
  if (node.type !== "remote-agentNode") return node;
  const data = node.data as AgentNodeData | undefined;
  if (!data?.agentSessionFile) return node;
  return {
    ...node,
    data: {
      ...(node.data as Record<string, unknown>),
      agentSessionFile: undefined,
      agentSessionCloneFrom: data.agentSessionFile,
      agentLastPrompt: undefined,
    },
  } as T;
}
