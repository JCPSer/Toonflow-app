<template>
  <div ref="rootElement" class="assetPanelCloseTrigger" :class="{ flipped }">
    <div class="hoverZone" aria-hidden="true" @mouseenter="onEnter" @mouseleave="onHoverEnd" />
    <button
      ref="buttonElement"
      class="triggerButton"
      :class="{ visible }"
      type="button"
      :aria-label="translate('关闭素材库')"
      :title="translate('关闭素材库')"
      aria-controls="assetLibraryPanel"
      @mouseenter="onEnter"
      @mouseleave="onHoverEnd"
      @focus="reveal"
      @blur="scheduleHide"
      @click="emit('close')">
      <icon-chevron-left :size="18" aria-hidden="true" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { translate } from "@toonflow/i18n/vue";
import { IconChevronLeft } from "@tabler/icons-vue";
import { useHoverReveal } from "@/pages/workspace/components/useHoverReveal";

const emit = defineEmits<{ close: [] }>();
const rootElement = ref<HTMLElement>();
const buttonElement = ref<HTMLButtonElement>();
const flipped = ref(false);
const { visible, show, onHoverStart, onHoverEnd, scheduleHide } = useHoverReveal(buttonElement);

// ACT: 热区与按钮默认在面板外侧；浮层被拖到贴视口右缘、放不下 44px 时翻到面板内侧，
// 否则按钮会被窗口裁掉。52 = 8 间距 + 36 按钮 + 8 余量。
// 读内联 left/width 而不是 getBoundingClientRect：面板滑入/滑出时 aside 带 translateX，
// rect 是动画中间值；窗口缩放时 rect 也要等下一帧才更新。
function updatePlacement() {
  const panel = rootElement.value?.closest<HTMLElement>(".floatingPanel");
  if (!panel) return;
  const rect = panel.getBoundingClientRect();
  const left = Number.parseFloat(panel.style.left);
  const width = Number.parseFloat(panel.style.width);
  const right = (Number.isFinite(left) ? left : rect.left) + (Number.isFinite(width) ? width : rect.width);
  flipped.value = right + 52 > window.innerWidth;
}

function onEnter() {
  updatePlacement();
  onHoverStart();
}

function reveal() {
  updatePlacement();
  show();
}

function handleResize() {
  // ACT: floatingPanel 的 resize 监听先注册，它只改响应式值，DOM 在微任务里才更新；
  // 必须等一帧再读，否则窗口放大时会按旧宽度误判回退。
  void nextTick(updatePlacement);
}

onMounted(() => window.addEventListener("resize", handleResize));
onBeforeUnmount(() => window.removeEventListener("resize", handleResize));
</script>

<style scoped lang="scss">
.assetPanelCloseTrigger {
  position: absolute;
  z-index: 3;
  top: 50%;
  right: 0;
  width: 0;
  height: 0;
  // ACT: 容器不接收指针，只有外侧热区条与按钮本身接收，面板内容与右边缘缩放不受影响。
  pointer-events: none;

  // ACT: 触发条从 12×160 放大到 40×240，覆盖按钮并留出绕行空间；
  // 12px 时鼠标稍微绕一下就离开判定区，按钮在到达前收起。
  .hoverZone {
    position: absolute;
    top: -120px;
    right: -40px;
    width: 40px;
    height: 240px;
    pointer-events: auto;
  }

  .triggerButton {
    position: absolute;
    top: -18px;
    right: -44px;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    padding: 0;
    border: 1px solid var(--el-border-color-light);
    border-radius: 50%;
    background: color-mix(in srgb, var(--el-bg-color-overlay) 70%, transparent);
    box-shadow: var(--el-box-shadow-light);
    color: var(--el-text-color-regular);
    cursor: pointer;
    opacity: 0;
    pointer-events: none;
    transform: translateX(-8px);
    transition: opacity 0.16s ease, transform 0.16s ease, color 0.16s ease;
    backdrop-filter: blur(6px);

    &.visible {
      opacity: 1;
      pointer-events: auto;
      transform: translateX(0);
    }

    &:hover,
    &:focus-visible {
      color: var(--el-color-primary);
    }

    &:focus-visible {
      outline: 2px solid var(--el-color-primary);
      outline-offset: 2px;
    }
  }

  // ACT: 贴右缘时翻到面板内侧；回退态只淡入淡出不做位移——首次翻转与显示同帧发生，
  // 若保留 -8px 的隐藏位移，会从错误方向滑入，且面板内侧也没有向外滑出的空间。
  &.flipped {
    .triggerButton { right: 8px; }
    .triggerButton:not(.visible) { transform: none; }
  }
}

@media (prefers-reduced-motion: reduce) {
  .assetPanelCloseTrigger .triggerButton {
    transition: none;
  }
}

// 触屏没有 hover：入口永远不显示，隐形热区只会吞掉面板外侧的点击。
@media (hover: none) {
  .assetPanelCloseTrigger { display: none; }
}
</style>
