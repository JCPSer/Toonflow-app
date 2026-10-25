import { ref } from "vue";
import { defineStore } from "pinia";
import type { AgentMention } from "@toonflow/server/agent/types";

export type AgentComposerEntry = { mention: AgentMention; directory?: string };

function normalizeDirectory(directory?: string) {
  return (directory ?? "").replaceAll("\\", "/").replace(/\/+$/, "");
}

// ACT: 节点快捷加入只在内存排队，由当前激活的 agent 输入框取走；刷新页面即清空，不写 localStorage。
export const useAgentComposerStore = defineStore("agentComposer", () => {
  const queue = ref<AgentComposerEntry[]>([]);

  function push(mention: AgentMention, directory?: string) {
    queue.value.push({ mention, directory });
  }

  /** 只取与当前项目匹配的项；切换项目后残留的旧画布 mention 直接丢弃。 */
  function take(directory?: string): AgentMention[] {
    const current = normalizeDirectory(directory);
    const matched = queue.value
      .filter(item => normalizeDirectory(item.directory) === current)
      .map(item => item.mention);
    queue.value = [];
    return matched;
  }

  return { queue, push, take };
});
