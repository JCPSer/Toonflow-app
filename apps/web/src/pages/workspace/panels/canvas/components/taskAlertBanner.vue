<template>
  <div
    v-if="alerts.length"
    class="taskAlertBanner"
    :class="{ hasFailed: failedCount > 0 }"
    role="status"
    aria-live="polite"
    @pointerdown.stop
    @wheel.stop
    @click.stop>
    <div class="taskAlertHeader">
      <span class="taskAlertTitle">
        <icon-bell :size="14" aria-hidden="true" />
        <span>{{ title }}</span>
      </span>
      <button type="button" class="taskAlertClear" @click.stop="emit('clear')">全部忽略</button>
    </div>
    <button
      v-for="alert in visibleAlerts"
      :key="alert.id"
      type="button"
      class="taskAlertItem"
      :title="`${alert.nodeLabel} · 耗时 ${formatTaskDuration(alert.durationMs)}`"
      @click.stop="emit('select', alert)">
      <icon-alert-triangle v-if="alert.kind === 'failed'" class="taskAlertIcon failed" :size="14" aria-hidden="true" />
      <icon-circle-check v-else class="taskAlertIcon done" :size="14" aria-hidden="true" />
      <span class="taskAlertNode">{{ alert.nodeLabel }}</span>
      <span class="taskAlertMeta">· 耗时 {{ formatTaskDuration(alert.durationMs) }}</span>
      <icon-chevron-right class="taskAlertChevron" :size="14" aria-hidden="true" />
    </button>
    <div v-if="hiddenCount" class="taskAlertMore">还有 {{ hiddenCount }} 条</div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { IconAlertTriangle, IconBell, IconChevronRight, IconCircleCheck } from "@tabler/icons-vue";
import { formatTaskDuration, type TaskAlert } from "@/stores/taskAlerts";

const props = defineProps<{
  /** 未读提醒，按新到旧排列；组件只负责展示，读写状态由宿主决定。 */
  alerts: TaskAlert[];
}>();

const emit = defineEmits<{
  /** 点击一条提醒：宿主负责切画布、选中并平移到该节点；带上整条提醒才能跨画布定位。 */
  select: [alert: TaskAlert];
  /** 全部忽略。 */
  clear: [];
}>();

/** 最多展开 3 条，其余折叠成计数，避免横幅盖住画布。 */
const MAX_VISIBLE = 3;
const visibleAlerts = computed(() => props.alerts.slice(0, MAX_VISIBLE));
const hiddenCount = computed(() => Math.max(0, props.alerts.length - MAX_VISIBLE));
const failedCount = computed(() => props.alerts.filter(alert => alert.kind === "failed").length);
const title = computed(() => {
  const done = props.alerts.length - failedCount.value;
  return [
    failedCount.value ? `${failedCount.value} 个节点执行失败` : "",
    done ? `${done} 个节点已完成` : "",
  ].filter(Boolean).join(" · ");
});
</script>

<style lang="scss" scoped>
.taskAlertBanner {
  position: absolute;
  z-index: 5;
  top: 12px;
  left: 50%;
  display: flex;
  flex-direction: column;
  gap: 2px;
  box-sizing: border-box;
  width: max-content;
  max-width: min(520px, calc(100% - 32px));
  padding: 6px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 10px;
  background: var(--el-bg-color-overlay);
  box-shadow: var(--el-box-shadow);
  transform: translateX(-50%);

  &.hasFailed { border-color: var(--el-color-danger-light-5); }

  .taskAlertHeader {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 2px 4px;
  }

  .taskAlertTitle {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--el-text-color-regular);
    font-size: 12px;
    font-weight: 500;
    white-space: nowrap;
  }

  .taskAlertClear {
    flex-shrink: 0;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--el-text-color-secondary);
    font: inherit;
    font-size: 12px;
    cursor: pointer;

    &:hover { color: var(--el-color-primary); }
  }

  .taskAlertItem {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    padding: 4px 6px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--el-text-color-regular);
    font: inherit;
    font-size: 12px;
    text-align: left;
    cursor: pointer;

    &:hover { background: var(--el-fill-color-light); }

    .taskAlertIcon {
      flex-shrink: 0;

      &.failed { color: var(--el-color-danger); }
      &.done { color: var(--el-color-success); }
    }

    .taskAlertNode {
      overflow: hidden;
      min-width: 0;
      color: var(--el-text-color-primary);
      white-space: nowrap;
      text-overflow: ellipsis;
    }

    .taskAlertMeta {
      flex-shrink: 0;
      color: var(--el-text-color-secondary);
      font-variant-numeric: tabular-nums;
    }

    .taskAlertChevron {
      flex-shrink: 0;
      margin-left: auto;
      color: var(--el-text-color-placeholder);
    }
  }

  .taskAlertMore {
    padding: 2px 6px;
    color: var(--el-text-color-secondary);
    font-size: 12px;
  }
}
</style>
