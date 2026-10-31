<template>
  <div class="shareDropOverlay" role="status" aria-live="polite">
    <div class="shareDropCard">
      <icon-file-import :size="28" aria-hidden="true" />
      <strong>松开导入工程</strong>
      <span>仅支持 .tfproj 工程分享文件</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { IconFileImport } from "@tabler/icons-vue";
</script>

<style scoped lang="scss">
.shareDropOverlay {
  position: absolute;
  inset: 0;
  z-index: 3000;
  display: grid;
  place-items: center;
  padding: 24px;
  background: color-mix(in srgb, var(--el-bg-color) 72%, transparent);
  backdrop-filter: blur(2px);
  pointer-events: none;

  .shareDropCard {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    max-width: min(420px, 90vw);
    padding: 28px 40px;
    border: 1px dashed var(--el-color-primary-light-3);
    border-radius: calc(var(--ui-radius) * 3);
    background: var(--el-bg-color-overlay);
    box-shadow: var(--el-box-shadow-light);
    color: var(--el-text-color-primary);

    > svg { color: var(--el-color-primary); }
    strong { font-size: 15px; font-weight: 500; }
    span { color: var(--el-text-color-secondary); font-size: 12px; }
  }
}
</style>
