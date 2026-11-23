<template>
  <div
    v-if="items.length || notices.length"
    class="agentQueueDock"
    @pointerdown.stop
    @wheel.stop
    @click.stop>
    <div v-if="expanded" class="agentQueuePanel">
      <div class="agentQueueHeader">
        <span class="agentQueueTitle">
          <icon-list-check :size="14" aria-hidden="true" />
          <span>{{ items.length ? `排队中的派发 · ${items.length}` : "派发队列提示" }}</span>
        </span>
        <button type="button" class="agentQueueToggle" aria-label="收起排队列表" @click.stop="expanded = false">收起</button>
      </div>
      <!-- ACT: live region 只包住提示与条数；等待时长每秒变化，放进去会让读屏器每秒播报。 -->
      <div class="agentQueueNoticeList" aria-live="polite">
        <div v-for="notice in notices" :key="notice.id" class="agentQueueNotice">
          <icon-alert-triangle :size="13" aria-hidden="true" />
          <span>{{ notice.text }}</span>
        </div>
      </div>
      <div v-for="item in items" :key="item.taskId" class="agentQueueItem">
        <div class="agentQueueRow">
          <span v-if="item.kind === 'result'" class="agentQueueRoute" :title="item.toLabel">
            结果回传 · {{ item.toLabel }}
          </span>
          <span v-else class="agentQueueRoute" :title="`${item.fromLabel} → ${item.toLabel}`">
            {{ item.fromLabel }} → {{ item.toLabel }}
          </span>
          <span class="agentQueueMeta" :title="item.reason" aria-hidden="true">{{ item.reason }} · {{ formatWaiting(item.queuedAt) }}</span>
          <button
            v-if="item.kind === 'task'"
            type="button"
            class="agentQueueAction"
            :class="{ confirming: confirmingId === item.taskId }"
            :aria-label="confirmingId === item.taskId ? '确认撤销这条排队消息' : '撤销这条排队消息'"
            @click.stop="requestCancel(item.taskId)">
            {{ confirmingId === item.taskId ? "确认撤销" : "撤销" }}
          </button>
        </div>
        <div class="agentQueueMessage" :title="item.messageFull">{{ item.message || "（空消息）" }}</div>
      </div>
    </div>
    <button
      type="button"
      class="agentQueueChip"
      :aria-expanded="expanded"
      :aria-label="expanded ? '收起排队列表' : `排队中的派发 ${items.length} 条，展开查看`"
      @click.stop="toggle">
      <icon-list-check :size="14" aria-hidden="true" />
      <span>{{ items.length ? `排队 ${items.length}` : "队列提示" }}</span>
      <span v-if="notices.length" class="agentQueueDot" aria-hidden="true" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue";
import { IconAlertTriangle, IconListCheck } from "@tabler/icons-vue";
import type { QueueNotice, QueuedTaskView } from "../agentDispatcher";

const props = defineProps<{
  /** dispatcher 的只读队列快照，顺序即出队顺序。 */
  items: QueuedTaskView[];
  /** 替换/去重/撤销的限时提示。 */
  notices: QueueNotice[];
}>();

const emit = defineEmits<{ cancel: [taskId: string] }>();

const expanded = ref(false);
const now = ref(Date.now());
const confirmingId = ref<string>();
let clock: ReturnType<typeof setInterval> | undefined;
let confirmTimer: ReturnType<typeof setTimeout> | undefined;

function stopClock() {
  if (!clock) return;
  clearInterval(clock);
  clock = undefined;
}

/** ACT: 只在展开且有条目时走秒，否则空转。 */
function syncClock(running: boolean) {
  if (running && !clock) clock = setInterval(() => { now.value = Date.now(); }, 1000);
  else if (!running) stopClock();
}

function toggle() {
  expanded.value = !expanded.value;
  if (expanded.value) now.value = Date.now();
  syncClock(expanded.value && props.items.length > 0);
}

function formatWaiting(queuedAt: number) {
  const seconds = Math.max(0, Math.floor((now.value - queuedAt) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m${String(seconds % 60).padStart(2, "0")}s`;
}

function requestCancel(taskId: string) {
  if (confirmingId.value !== taskId) {
    confirmingId.value = taskId;
    clearTimeout(confirmTimer);
    confirmTimer = setTimeout(() => { confirmingId.value = undefined; }, 3000);
    return;
  }
  clearTimeout(confirmTimer);
  confirmingId.value = undefined;
  emit("cancel", taskId);
}

// ACT: 只有当「条目和提示都空了」才收起——撤销最后一条时会同时产生提示，
// 立刻收起会把「已撤销」的结果藏起来，用户看不到自己的操作生效。
watch([() => props.items.length, () => props.notices.length], ([items, notices]) => {
  if (!items && !notices) {
    stopClock();
    expanded.value = false;
    return;
  }
  syncClock(expanded.value && items > 0);
});

// ACT: 同一发送方替换时条数不变，必须按 taskId 判断确认目标是否还在，不能只看长度。
watch(() => props.items.map(item => item.taskId), ids => {
  if (!confirmingId.value || ids.includes(confirmingId.value)) return;
  confirmingId.value = undefined;
  clearTimeout(confirmTimer);
});

watch(expanded, value => {
  if (value) now.value = Date.now();
  syncClock(value && props.items.length > 0);
});

onBeforeUnmount(() => {
  stopClock();
  clearTimeout(confirmTimer);
});
</script>

<style lang="scss" scoped>
.agentQueueDock {
  position: absolute;
  /* ACT: 右下角是画布控件与小地图，顶部是横幅；左下角留一块不冲突的区域。 */
  bottom: 12px;
  left: 12px;
  z-index: 5;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  max-width: min(360px, calc(100% - 24px));

  .agentQueueChip,
  .agentQueuePanel {
    box-sizing: border-box;
    border: 1px solid var(--el-border-color-light);
    border-radius: 10px;
    background: var(--el-bg-color-overlay);
    box-shadow: var(--el-box-shadow);
  }

  .agentQueueChip {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 10px;
    color: var(--el-text-color-regular);
    font: inherit;
    font-size: 12px;
    cursor: pointer;

    &:hover { color: var(--el-color-primary); }
  }

  .agentQueueDot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--el-color-warning);
  }

  .agentQueuePanel {
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 100%;
    max-height: min(300px, 45vh);
    padding: 6px;
    overflow-y: auto;
    /* ACT: 列表从底部向上生长，最新入队排在后面，与出队顺序一致。 */
    scrollbar-width: thin;
  }

  .agentQueueHeader {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 2px 4px;
  }

  .agentQueueTitle {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--el-text-color-regular);
    font-size: 12px;
    font-weight: 500;
    white-space: nowrap;
  }

  .agentQueueToggle {
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

  .agentQueueNoticeList {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .agentQueueNotice {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    padding: 4px 6px;
    border-radius: 6px;
    background: var(--el-color-warning-light-9);
    color: var(--el-color-warning-dark-2);
    font-size: 12px;
    line-height: 1.4;

    svg { flex-shrink: 0; margin-top: 1px; }
  }

  .agentQueueItem {
    padding: 4px 6px;
    border-radius: 6px;

    &:hover { background: var(--el-fill-color-light); }
  }

  .agentQueueRow {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }

  .agentQueueRoute {
    overflow: hidden;
    min-width: 0;
    color: var(--el-text-color-primary);
    font-size: 12px;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .agentQueueMeta {
    flex-shrink: 0;
    margin-left: auto;
    color: var(--el-text-color-secondary);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .agentQueueAction {
    flex-shrink: 0;
    padding: 1px 6px;
    border: 1px solid var(--el-border-color);
    border-radius: 4px;
    background: transparent;
    color: var(--el-text-color-regular);
    font: inherit;
    font-size: 12px;
    cursor: pointer;

    &:hover {
      border-color: var(--el-color-danger);
      color: var(--el-color-danger);
    }

    &.confirming {
      border-color: var(--el-color-danger);
      background: var(--el-color-danger);
      color: var(--el-color-white);
    }
  }

  .agentQueueMessage {
    display: -webkit-box;
    overflow: hidden;
    margin-top: 2px;
    color: var(--el-text-color-secondary);
    font-size: 12px;
    line-height: 1.45;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    word-break: break-word;
  }
}
</style>
