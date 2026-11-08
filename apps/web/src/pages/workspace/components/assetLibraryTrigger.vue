<template>
  <button
    class="assetLibraryTrigger"
    type="button"
    :aria-label="translate('打开素材库')"
    :title="translate('打开素材库')"
    aria-controls="assetLibraryPanel"
    @click="emit('open')">
    <icon-folders :size="18" aria-hidden="true" />
  </button>
</template>

<script setup lang="ts">
import { translate } from "@toonflow/i18n/vue";
import { IconFolders } from "@tabler/icons-vue";

// ACT: 入口改为常驻显示：悬停判定区在 WKWebView 下容易在鼠标绕行时丢失，
// 用户又需要频繁打开素材库，直接固定可见比反复“出现-消失”更可靠。
const emit = defineEmits<{ open: [] }>();
</script>

<style scoped lang="scss">
.assetLibraryTrigger {
  position: fixed;
  z-index: 6;
  top: 50%;
  left: 8px;
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
  transform: translateY(-50%);
  transition: color 0.16s ease;
  backdrop-filter: blur(6px);

  &:hover,
  &:focus-visible {
    color: var(--el-color-primary);
  }

  &:focus-visible {
    outline: 2px solid var(--el-color-primary);
    outline-offset: 2px;
  }
}
</style>
