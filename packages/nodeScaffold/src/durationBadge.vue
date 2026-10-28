<template>
  <!-- ACT: 运行时长角标单独成组件，只为隔离响应式更新——计时状态若放在 nodeSkeleton 里，
       每秒变化都会让骨架重渲染，连带 <slot> 里的节点内容（markdown 预览、播放器等）一起重建。
       本组件只渲染一段文字，父级样式（.durationBadge）通过根元素继承生效。
       aria-live="off" 防止读屏软件每秒播报一次滚秒；完整语义放在 aria-label。 -->
  <span v-if="label" class="durationBadge" :class="{ isDone: done }" role="timer" aria-live="off" :aria-label="ariaLabel">{{ label }}</span>
</template>

<script setup lang="ts">
import { onScopeDispose, ref, watch } from "vue";

const props = defineProps<{ busy?: boolean; active?: boolean }>();
const elapsedMs = ref(0);
const done = ref(false);
const label = ref("");
const ariaLabel = ref("");
let startedAt = 0;
let ticker: ReturnType<typeof setInterval> | undefined;

function pad(value: number) {
  return String(value).padStart(2, "0");
}

// 运行中 00:42 / 1:05:30；秒级精度用墙钟差值算，定时器被节流也不会累积漂移。
function formatDuration(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  return hours ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

// 结束后用更紧凑的人类可读格式：42s / 3m12s / 1h05m。
function formatElapsed(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  if (total < 60) return `${total}s`;
  if (total < 3600) return `${Math.floor(total / 60)}m${pad(total % 60)}s`;
  return `${Math.floor(total / 3600)}h${pad(Math.floor((total % 3600) / 60))}m`;
}

function stopTicker() {
  if (ticker === undefined) return;
  clearInterval(ticker);
  ticker = undefined;
}

function render() {
  label.value = props.busy ? formatDuration(elapsedMs.value) : done.value ? `耗时 ${formatElapsed(elapsedMs.value)}` : "";
  ariaLabel.value = props.busy ? `节点已运行 ${formatDuration(elapsedMs.value)}` : done.value ? `节点本次耗时 ${formatElapsed(elapsedMs.value)}` : "";
}

watch(() => props.busy, busy => {
  if (busy) {
    stopTicker();
    startedAt = performance.now();
    elapsedMs.value = 0;
    done.value = false;
    render();
    ticker = setInterval(() => { elapsedMs.value = performance.now() - startedAt; render(); }, 1000);
  } else if (ticker !== undefined) {
    // 只有本次确实跑过才定格；初始的 false 因为没有 ticker 会直接跳过，不会显示「耗时 0s」。
    stopTicker();
    elapsedMs.value = performance.now() - startedAt;
    done.value = true;
    render();
  }
}, { immediate: true });

// 文档面板模式不显示角标，此时不必空转定时器。
watch(() => props.active, active => {
  if (active) return;
  stopTicker();
  label.value = "";
});

onScopeDispose(stopTicker);
</script>
