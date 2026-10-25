<template>
  <section class="assetTrashView" :aria-label="translate('回收站')">
    <header class="trashHeader">
      <el-button text size="small" :icon="IconArrowLeft" @click="emit('back')">{{ translate("返回素材库") }}</el-button>
      <span class="trashSummary">
        {{ translate("回收站") }}<span v-if="items.length"> · {{ translate("{count} 项", { count: items.length }) }} · {{ formatAssetSize(usage) }}</span>
      </span>
      <span class="trashSpacer" />
      <el-button text size="small" :icon="IconRefresh" :loading="loading" :aria-label="translate('刷新回收站')" @click="emit('refresh')" />
      <el-button text size="small" type="danger" :icon="IconTrashX" :disabled="!items.length || loading" @click="emit('empty')">
        {{ translate("清空回收站") }}
      </el-button>
    </header>

    <div v-loading="loading" class="trashScroll">
      <ul v-if="items.length" class="trashList" role="list">
        <li v-for="item in items" :key="item.id" class="trashItem">
          <span class="trashIcon">
            <icon-folder v-if="item.isDirectory" :size="20" aria-hidden="true" />
            <icon-file v-else :size="20" aria-hidden="true" />
          </span>
          <span class="trashInfo">
            <span class="trashName" :title="item.name">{{ item.name }}</span>
            <span class="trashPath" :title="item.path">{{ item.path }}</span>
          </span>
          <span class="trashMeta">
            <span>{{ formatDate(item.deletedAt) }}</span>
            <span>{{ formatAssetSize(item.size) }}</span>
          </span>
          <span class="trashActions">
            <el-button text size="small" :icon="IconRestore" :disabled="loading" @click="emit('restore', item)">{{ translate("恢复") }}</el-button>
            <el-button text size="small" type="danger" :icon="IconTrash" :disabled="loading" @click="emit('purge', item)">{{ translate("彻底删除") }}</el-button>
          </span>
        </li>
      </ul>
      <div v-else-if="!loading" class="trashEmpty">
        <icon-trash :size="42" stroke="1.25" aria-hidden="true" />
        <strong>{{ translate("回收站是空的") }}</strong>
        <span>{{ translate("删除的素材会先放到这里，可以随时恢复。") }}</span>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { translate } from "@toonflow/i18n/vue";
import { IconArrowLeft, IconFile, IconFolder, IconRefresh, IconRestore, IconTrash, IconTrashX } from "@tabler/icons-vue";
import { formatAssetSize } from "../types";
import type { AssetTrashItem } from "../types";

withDefaults(defineProps<{ items: AssetTrashItem[]; usage?: number; loading?: boolean }>(), { usage: 0, loading: false });
const emit = defineEmits<{
  back: [];
  refresh: [];
  restore: [item: AssetTrashItem];
  purge: [item: AssetTrashItem];
  empty: [];
}>();

function formatDate(value: number) {
  return new Date(value).toLocaleString();
}
</script>

<style scoped lang="scss">
.assetTrashView {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;

  .trashHeader {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    border-bottom: 1px solid var(--el-border-color-lighter);
    font-size: 12px;

    .trashSummary { color: var(--el-text-color-secondary); }
    .trashSpacer { flex: 1; }
    .el-button { margin: 0; padding: 4px 6px; }
  }

  .trashScroll {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 8px;
  }

  .trashList {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .trashItem {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px;
    border: 1px solid var(--el-border-color-lighter);
    border-radius: var(--el-border-radius-base);

    .trashIcon {
      display: flex;
      flex-shrink: 0;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      color: var(--el-text-color-secondary);
      background: var(--el-fill-color-light);
      border-radius: var(--el-border-radius-base);
    }

    .trashInfo {
      display: flex;
      flex: 1;
      flex-direction: column;
      min-width: 0;

      .trashName { overflow: hidden; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
      .trashPath { overflow: hidden; color: var(--el-text-color-secondary); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
    }

    .trashMeta {
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
      align-items: flex-end;
      color: var(--el-text-color-secondary);
      font-size: 10px;
      line-height: 15px;
    }

    .trashActions {
      display: flex;
      flex-shrink: 0;
      gap: 2px;

      .el-button { margin: 0; padding: 4px 5px; }
    }
  }

  .trashEmpty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-height: 240px;
    padding: 30px 16px;
    color: var(--el-text-color-secondary);
    text-align: center;

    strong { color: var(--el-text-color-primary); font-size: 14px; }
    span { font-size: 12px; }
  }
}
</style>
