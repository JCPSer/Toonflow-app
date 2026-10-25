<template>
  <section v-if="items.length" class="uploadQueue" :aria-label="translate('上传队列')">
    <header class="queueHeader">
      <span>{{ translate("上传队列") }}</span>
      <span class="queueStats">{{ doneCount }} / {{ items.length }}</span>
      <span class="queueSpacer" />
      <el-button v-if="doneCount" text size="small" @click="emit('clear-finished')">{{ translate("清除已完成") }}</el-button>
      <el-button text size="small" :icon="IconX" :aria-label="translate('关闭上传队列')" @click="emit('dismiss')" />
    </header>
    <ul class="queueList">
      <li v-for="item in items" :key="item.id" class="queueItem" :class="item.status">
        <span class="queueName" :title="item.file.name">{{ item.file.name }}</span>
        <el-progress
          v-if="item.status === 'uploading' || item.status === 'queued'"
          class="queueProgress"
          :percentage="item.progress"
          :stroke-width="4"
          :show-text="false" />
        <span v-if="item.status === 'done'" class="queueState done">{{ translate("已完成") }}</span>
        <span v-else-if="item.status === 'error'" class="queueState error" :title="item.error">{{ item.error }}</span>
        <el-button v-if="item.status === 'error'" text size="small" :icon="IconRefresh" :aria-label="translate('重试上传 {name}', { name: item.file.name })" @click="emit('retry', item)" />
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { translate } from "@toonflow/i18n/vue";
import { IconRefresh, IconX } from "@tabler/icons-vue";
import type { UploadItem } from "../useAssetUpload";

const props = defineProps<{ items: UploadItem[] }>();
const emit = defineEmits<{
  retry: [item: UploadItem];
  dismiss: [];
  "clear-finished": [];
}>();
const doneCount = computed(() => props.items.filter(item => item.status === "done").length);
</script>

<style scoped lang="scss">
.uploadQueue {
  flex-shrink: 0;
  max-height: 168px;
  margin: 6px 8px 8px;
  overflow: hidden;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: var(--el-border-radius-base);
  background: var(--el-bg-color-overlay);
  box-shadow: var(--el-box-shadow-light);

  .queueHeader {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 6px;
    border-bottom: 1px solid var(--el-border-color-lighter);
    font-size: 11px;

    .queueStats { color: var(--el-text-color-secondary); font-variant-numeric: tabular-nums; }
    .queueSpacer { flex: 1; }
    .el-button { margin: 0; padding: 2px 4px; }
  }

  .queueList {
    max-height: 130px;
    margin: 0;
    padding: 4px 6px;
    overflow: auto;
    list-style: none;
  }

  .queueItem {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 22px;
    font-size: 11px;

    .queueName {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .queueProgress { flex: 0 0 72px; }
    .queueState {
      flex-shrink: 0;
      max-width: 130px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--el-text-color-secondary);

      &.error { color: var(--el-color-danger); }
      &.done { color: var(--el-color-success); }
    }

    .el-button { margin: 0; padding: 2px; }
  }
}
</style>
