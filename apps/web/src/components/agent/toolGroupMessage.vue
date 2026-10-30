<template>
  <div class="toolGroup">
    <button type="button" class="toolGroupHeader" :data-status="status" :aria-expanded="expanded" @click="emit('toggle', $event)">
      <icon-tool :size="14" aria-hidden="true" />
      <span class="toolGroupTitle">{{ title }}</span>
      <component :is="expanded ? IconChevronDown : IconChevronRight" :size="14" class="toolGroupIcon" aria-hidden="true" />
    </button>
    <div v-if="expanded" class="toolGroupBody">
      <toolMessage
        v-for="tool in tools"
        :key="tool.id"
        :tool="tool"
        compact
        :directory="directory"
        :toolSessionId="toolSessionId"
        @copy="emit('copy', $event)" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { IconChevronDown, IconChevronRight, IconTool } from "@tabler/icons-vue";
import type { AgentToolCall } from "@toonflow/server/agent/types";
import toolMessage from "./toolMessage.vue";

const props = defineProps<{ tools: AgentToolCall[]; expanded: boolean; directory?: string; toolSessionId?: string }>();
const emit = defineEmits<{ toggle: [event: MouseEvent]; copy: [content: string] }>();

const counts = computed(() => {
  const result = { success: 0, error: 0, running: 0, interrupted: 0 };
  for (const tool of props.tools) result[tool.status] += 1;
  return result;
});
// ACT: 进行中优先展示，失败数始终附带——部分失败后工具仍会继续跑，不能只显示一种状态。
const status = computed(() => (counts.value.error ? "error" : counts.value.running ? "running" : counts.value.interrupted ? "interrupted" : "success"));
const title = computed(() => {
  const total = props.tools.length;
  if (!counts.value.running && !counts.value.error && !counts.value.interrupted) return `${total} 个工具调用 · 已完成`;
  // 全部中断时不要显示"0 完成 · N 中断"，直接给中断口径。
  if (!counts.value.success && !counts.value.running && !counts.value.error) return `${total} 个工具调用 · ${counts.value.interrupted} 中断`;
  const parts = [`${counts.value.success} 完成`];
  if (counts.value.running) parts.push(`${counts.value.running} 进行中`);
  if (counts.value.error) parts.push(`${counts.value.error} 失败`);
  if (counts.value.interrupted) parts.push(`${counts.value.interrupted} 中断`);
  return `${total} 个工具调用 · ${parts.join(" · ")}`;
});
</script>

<style scoped lang="scss">
.toolGroup {
  min-width: 0;
}

.toolGroupHeader {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-width: 0;
  padding: 2px 0;
  border: none;
  background: transparent;
  color: var(--el-text-color-secondary);
  font-size: 13px;
  text-align: left;
  cursor: pointer;

  &:hover {
    color: var(--el-text-color-primary);
  }

  &[data-status="error"] .toolGroupTitle {
    color: var(--el-color-danger);
  }

  &[data-status="interrupted"] .toolGroupTitle {
    color: var(--el-color-warning);
  }

  &:focus-visible {
    outline: 1px solid var(--el-color-primary);
    outline-offset: 2px;
  }
}

.toolGroupTitle {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.toolGroupIcon {
  flex-shrink: 0;
}

.toolGroupBody {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 2px 0 4px 6px;
  padding-left: 8px;
  border-left: 1px solid var(--el-border-color-lighter);
}
</style>
