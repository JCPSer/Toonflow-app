<template>
  <teleport to="body">
    <aside
      v-bind="$attrs"
      v-show="visible"
      ref="panelElement"
      class="floatingPanel"
      :class="{ docked, 'dock-left': dockSide === 'left', 'dock-right': dockSide === 'right', dragging: interaction?.mode === 'move', resizing: interaction !== undefined && interaction.mode !== 'move' }"
      :style="panelStyle"
      @pointerdown="startPanelMove"
      @pointermove="moveInteraction"
      @pointerup="stopInteraction"
      @pointercancel="stopInteraction"
      @lostpointercapture="stopInteraction"
      @keydown="handlePanelKeydown"
      @dblclick="handlePanelDoubleClick">
      <div
        v-for="handle in resizeHandles"
        :key="handle.edge"
        class="resizeHandle"
        :class="handle.edge"
        role="separator"
        :aria-label="handle.label"
        :aria-orientation="handle.orientation"
        :aria-valuemin="handle.min"
        :aria-valuemax="handle.max"
        :aria-valuenow="handle.value"
        tabindex="0"
        @pointerdown.stop="startInteraction($event, handle.edge)"
        @keydown="resizeWithKeyboard($event, handle.edge)" />
      <slot />
    </aside>
  </teleport>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, shallowRef, watch } from "vue";

type ResizeEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

const visible = defineModel<boolean>("visible", { default: false });
const docked = defineModel<boolean>("docked", { default: false });
const width = defineModel<number>("width", { default: 420 });
// 0 表示未手动设置高度，浮层沿用视口 80%。
const height = defineModel<number>("height", { default: 0 });
const props = withDefaults(defineProps<{
  dockSide?: "left" | "right";
  defaultWidth?: number;
  defaultHeight?: number;
  minWidth?: number;
  minHeight?: number;
  /** 停靠时最多占视口宽度的比例。 */
  maxDockRatio?: number;
  dragSelector?: string;
  excludeSelector?: string;
  resizeEdges?: ResizeEdge[];
  resetOnDoubleClick?: boolean;
  resetOnEscape?: boolean;
  /** 浮层位置由上层会话状态驱动；null 表示未手动拖动过。 */
  left?: number | null;
  top?: number | null;
}>(), {
  dockSide: "right",
  defaultWidth: 420,
  defaultHeight: 0,
  minWidth: 320,
  minHeight: 240,
  maxDockRatio: 0.45,
  dragSelector: "",
  excludeSelector: "",
  resizeEdges: () => ["n", "s", "e", "w", "ne", "nw", "se", "sw"] as ResizeEdge[],
  resetOnDoubleClick: true,
  resetOnEscape: true,
  left: null,
  top: null,
});
type FloatingPanelLayout = { left: number; top: number; width: number; height: number };
const emit = defineEmits<{ resize: [width: number]; layout: [layout: FloatingPanelLayout] }>();

const panelElement = ref<HTMLElement>();
const viewport = reactive({ width: window.innerWidth, height: window.innerHeight });
const gap = computed(() => Math.min(15, viewport.width / 2, viewport.height / 2));
const maxFloatingWidth = computed(() => Math.max(0, viewport.width - gap.value * 2));
const maxFloatingHeight = computed(() => Math.max(0, viewport.height - gap.value * 2));
const effectiveWidth = computed(() => {
  const limit = docked.value ? Math.max(0, viewport.width * props.maxDockRatio) : maxFloatingWidth.value;
  return Math.max(0, Math.min(width.value || props.minWidth, limit));
});
const effectiveHeight = computed(() => {
  if (docked.value) return viewport.height;
  const preferred = height.value > 0 ? height.value : viewport.height * 0.8;
  return Math.max(0, Math.min(preferred, maxFloatingHeight.value));
});

// 拖拽期间用本地坐标保证跟手；拖拽结束通过 layout 事件交给上层写入会话状态。
const left = ref(0);
const top = ref(0);

const panelStyle = computed(() => ({
  left: `${docked.value ? (props.dockSide === "left" ? 0 : viewport.width - effectiveWidth.value) : left.value}px`,
  top: `${docked.value ? 0 : top.value}px`,
  width: `${effectiveWidth.value}px`,
  height: `${effectiveHeight.value}px`,
}));

type Handle = { edge: ResizeEdge; label: string; orientation: "horizontal" | "vertical"; min: number; max: number; value: number };
const dockedEdge = computed<ResizeEdge>(() => props.dockSide === "left" ? "e" : "w");
const resizeHandles = computed<Handle[]>(() => {
  const edges = docked.value ? [dockedEdge.value] : props.resizeEdges;
  return edges.map(edge => {
    const vertical = edge === "n" || edge === "s";
    return {
      edge,
      label: resizeLabel(edge),
      orientation: vertical ? "horizontal" : "vertical",
      min: Math.min(vertical ? props.minHeight : props.minWidth, vertical ? viewport.height : viewport.width),
      max: vertical ? viewport.height : Math.min(maxFloatingWidth.value, viewport.width),
      value: Math.round(vertical ? effectiveHeight.value : effectiveWidth.value),
    };
  });
});

function resizeLabel(edge: ResizeEdge) {
  if (edge === "n") return "从上方调整面板高度";
  if (edge === "s") return "从下方调整面板高度";
  if (edge === "e") return "从右侧调整面板宽度";
  if (edge === "w") return "从左侧调整面板宽度";
  if (edge === "ne") return "从右上角调整面板大小";
  if (edge === "nw") return "从左上角调整面板大小";
  if (edge === "se") return "从右下角调整面板大小";
  return "从左下角调整面板大小";
}

function clampSize(value: number, min: number, max: number) {
  // 视口过小时 max 可能小于 min，此时以视口上限为准。
  return Math.max(Math.min(min, max), Math.min(value, max));
}

function clampFloatingPosition() {
  if (docked.value) return;
  const maxLeft = Math.max(gap.value, viewport.width - effectiveWidth.value - gap.value);
  const maxTop = Math.max(gap.value, viewport.height - effectiveHeight.value - gap.value);
  left.value = Math.min(maxLeft, Math.max(gap.value, left.value));
  top.value = Math.min(maxTop, Math.max(gap.value, top.value));
}

function resetPosition() {
  left.value = props.dockSide === "left"
    ? gap.value
    : Math.max(gap.value, viewport.width - effectiveWidth.value - 15);
  top.value = Math.max(gap.value, viewport.height - effectiveHeight.value - 15);
  clampFloatingPosition();
}

let unmounting = false;
const interaction = shallowRef<{
  mode: "move" | ResizeEdge;
  pointerId: number;
  element: HTMLElement;
  startX: number;
  startY: number;
  startLeft: number;
  startTop: number;
  startWidth: number;
  startHeight: number;
}>();

function isEditable(target: HTMLElement) {
  return !!target.closest("button, input, textarea, select, a, [contenteditable='true'], .el-input, .el-select, .el-dropdown");
}

function startPanelMove(event: PointerEvent) {
  if (event.button !== 0 || interaction.value || docked.value || !props.dragSelector) return;
  const target = event.target as HTMLElement;
  if (!target.closest(props.dragSelector) || isEditable(target)) return;
  if (props.excludeSelector && target.closest(props.excludeSelector)) return;
  startInteraction(event, "move");
}

function startInteraction(event: PointerEvent, mode: "move" | ResizeEdge) {
  if (event.button !== 0 || interaction.value) return;
  if (docked.value && mode !== "move" && mode !== dockedEdge.value) return;
  event.preventDefault();
  const element = event.currentTarget as HTMLElement;
  element.setPointerCapture(event.pointerId);
  interaction.value = {
    mode,
    pointerId: event.pointerId,
    element,
    startX: event.clientX,
    startY: event.clientY,
    startLeft: left.value,
    startTop: top.value,
    startWidth: effectiveWidth.value,
    startHeight: effectiveHeight.value,
  };
}

function applyResize(edge: ResizeEdge, start: { left: number; top: number; width: number; height: number }, dx: number, dy: number) {
  if (docked.value) {
    const next = props.dockSide === "left" ? start.width + dx : start.width - dx;
    width.value = clampSize(next, props.minWidth, Math.max(0, viewport.width * props.maxDockRatio));
    return;
  }
  let nextWidth = start.width;
  let nextHeight = start.height;
  let nextLeft = start.left;
  let nextTop = start.top;
  if (edge.includes("e")) nextWidth = start.width + dx;
  if (edge.includes("w")) nextWidth = start.width - dx;
  if (edge.includes("s")) nextHeight = start.height + dy;
  if (edge.includes("n")) nextHeight = start.height - dy;
  if (edge.includes("w")) nextWidth = Math.min(nextWidth, start.left + start.width - gap.value);
  if (edge.includes("e")) nextWidth = Math.min(nextWidth, viewport.width - gap.value - start.left);
  if (edge.includes("n")) nextHeight = Math.min(nextHeight, start.top + start.height - gap.value);
  if (edge.includes("s")) nextHeight = Math.min(nextHeight, viewport.height - gap.value - start.top);
  nextWidth = clampSize(nextWidth, props.minWidth, maxFloatingWidth.value);
  nextHeight = clampSize(nextHeight, props.minHeight, maxFloatingHeight.value);
  if (edge.includes("w")) nextLeft = start.left + (start.width - nextWidth);
  if (edge.includes("n")) nextTop = start.top + (start.height - nextHeight);
  left.value = Math.max(gap.value, nextLeft);
  top.value = Math.max(gap.value, nextTop);
  width.value = nextWidth;
  height.value = nextHeight;
  clampFloatingPosition();
}

function moveInteraction(event: PointerEvent) {
  const current = interaction.value;
  if (!current || current.pointerId !== event.pointerId) return;
  const dx = event.clientX - current.startX;
  const dy = event.clientY - current.startY;
  if (current.mode === "move") {
    const maxLeft = Math.max(gap.value, viewport.width - effectiveWidth.value - gap.value);
    const maxTop = Math.max(gap.value, viewport.height - effectiveHeight.value - gap.value);
    left.value = Math.min(maxLeft, Math.max(gap.value, current.startLeft + dx));
    top.value = Math.min(maxTop, Math.max(gap.value, current.startTop + dy));
    return;
  }
  applyResize(current.mode, { left: current.startLeft, top: current.startTop, width: current.startWidth, height: current.startHeight }, dx, dy);
}

function emitLayout() {
  // ACT: docked 时只上报宽高；left/top 保持上层传入的原值（可能为 null），
  // 避免把本地预设坐标写成“用户拖动过”。现有消费者只透传写值，null 会被按原值保存。
  const layout = docked.value
    ? { left: props.left, top: props.top, width: width.value, height: height.value }
    : { left: left.value, top: top.value, width: width.value, height: height.value };
  emit("layout", layout as unknown as FloatingPanelLayout);
}

function stopInteraction(event?: PointerEvent) {
  const current = interaction.value;
  if (event && current?.pointerId !== event.pointerId) return;
  interaction.value = undefined;
  if (current?.element.hasPointerCapture(current.pointerId)) current.element.releasePointerCapture(current.pointerId);
  if (current?.element === document.activeElement) current.element.blur();
  if (!current || unmounting) return;
  // ACT: 只在拖拽/缩放结束时上报一次；单纯点击标题不应触发保存。
  if (current.mode === "move" && current.startLeft === left.value && current.startTop === top.value) return;
  emitLayout();
}

function resizeWithKeyboard(event: KeyboardEvent, edge: ResizeEdge) {
  const horizontal = edge.includes("e") || edge.includes("w");
  const keys = horizontal ? ["ArrowLeft", "ArrowRight"] : ["ArrowUp", "ArrowDown"];
  const index = keys.indexOf(event.key);
  if (index < 0) return;
  event.preventDefault();
  const dx = horizontal ? (index === 0 ? -16 : 16) : 0;
  const dy = horizontal ? 0 : (index === 0 ? -16 : 16);
  applyResize(edge, { left: left.value, top: top.value, width: effectiveWidth.value, height: effectiveHeight.value }, dx, dy);
  emitLayout();
}

function resetPanel() {
  width.value = props.defaultWidth;
  height.value = props.defaultHeight;
  resetPosition();
  emitLayout();
}

function handlePanelDoubleClick(event: MouseEvent) {
  if (!props.resetOnDoubleClick || !props.dragSelector) return;
  const target = event.target as HTMLElement;
  if (!target.closest(props.dragSelector) || isEditable(target)) return;
  if (props.excludeSelector && target.closest(props.excludeSelector)) return;
  resetPanel();
}

function handlePanelKeydown(event: KeyboardEvent) {
  if (!props.resetOnEscape || event.key !== "Escape" || !visible.value) return;
  const target = event.target as HTMLElement;
  if (isEditable(target) || target.closest("[contenteditable='true']")) return;
  resetPanel();
}

function resizeViewport() {
  stopInteraction();
  // 沿用旧 agent 面板的右下锚点：视口变化时保持浮层与右下角的距离，而不是固定左上角。
  const rightOffset = viewport.width - left.value - effectiveWidth.value;
  const bottomOffset = viewport.height - top.value - effectiveHeight.value;
  viewport.width = window.innerWidth;
  viewport.height = window.innerHeight;
  if (!docked.value) {
    left.value = viewport.width - effectiveWidth.value - rightOffset;
    top.value = viewport.height - effectiveHeight.value - bottomOffset;
  }
  clampFloatingPosition();
}

watch([visible, docked], () => stopInteraction());
watch([effectiveWidth, effectiveHeight], () => {
  if (docked.value) return;
  clampFloatingPosition();
});
watch([visible, docked, effectiveWidth], () => {
  emit("resize", visible.value && docked.value ? effectiveWidth.value : 0);
}, { immediate: true });
// ACT: 位置完全由上层传入的会话状态驱动；恢复后必须重新 clamp，防止历史坐标落在视口外。
watch(() => [props.left, props.top] as const, ([nextLeft, nextTop]) => {
  if (typeof nextLeft === "number" && Number.isFinite(nextLeft)
    && typeof nextTop === "number" && Number.isFinite(nextTop)) {
    left.value = nextLeft;
    top.value = nextTop;
    clampFloatingPosition();
    return;
  }
  resetPosition();
}, { immediate: true });

window.addEventListener("resize", resizeViewport);
onBeforeUnmount(() => {
  unmounting = true;
  stopInteraction();
  window.removeEventListener("resize", resizeViewport);
});
</script>

<style scoped lang="scss">
.floatingPanel {
  position: fixed;
  z-index: 1001;
  box-sizing: border-box;
  max-width: 100vw;
  max-height: 100dvh;
  border: 1px solid var(--el-border-color-light);
  border-radius: var(--ui-radius-large, 12px);
  background: color-mix(in srgb, var(--el-bg-color-overlay) 70%, transparent);
  backdrop-filter: blur(6px);
  box-shadow: var(--el-box-shadow-light);

  &.docked {
    border-width: 0;
    border-radius: 0;
    background: var(--el-bg-color-overlay);
    box-shadow: none;
    // ACT: 停靠态底色不透明，模糊只会让画布内容每帧重新合成，纯浪费。
    backdrop-filter: none;
  }

  &.dock-left.docked {
    border-right: 1px solid var(--el-border-color-light);
  }

  &.dock-right.docked {
    border-left: 1px solid var(--el-border-color-light);
  }

  &.dragging {
    user-select: none;
  }

  &.resizing {
    user-select: none;
  }

  .resizeHandle {
    position: absolute;
    z-index: 2;
    touch-action: none;

    &.n,
    &.s {
      right: 8px;
      left: 8px;
      height: 5px;
      cursor: ns-resize;
    }
    &.n { top: 0; }
    &.s { bottom: 0; }

    &.e,
    &.w {
      top: 8px;
      bottom: 8px;
      width: 5px;
      cursor: ew-resize;
    }
    &.e { right: 0; }
    &.w { left: 0; }

    &.ne,
    &.nw,
    &.se,
    &.sw {
      width: 10px;
      height: 10px;
    }
    &.ne { top: 0; right: 0; cursor: nesw-resize; }
    &.nw { top: 0; left: 0; cursor: nwse-resize; }
    &.se { right: 0; bottom: 0; cursor: nwse-resize; }
    &.sw { bottom: 0; left: 0; cursor: nesw-resize; }

    &:hover,
    &:focus-visible {
      background: var(--el-color-primary-light-5);
    }
  }
}
</style>
