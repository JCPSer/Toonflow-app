<template>
  <el-dialog
    :model-value="modelValue"
    :title="translate('素材正被引用')"
    width="min(520px, calc(100vw - 24px))"
    align-center
    append-to-body
    :close-on-click-modal="false"
    @update:model-value="emit('update:modelValue', $event)">
    <p class="referenceIntro">
      {{ translate("下列画布或会话正在引用所选素材。删除后这些引用会失效。") }}
    </p>
    <ul class="referenceList" role="list">
      <li v-for="(usage, index) in usages" :key="`${usage.file}-${usage.nodeId ?? index}`" class="referenceItem">
        <span class="referenceKind">{{ usage.kind === "canvas" ? translate("画布") : translate("会话") }}</span>
        <span class="referenceMain">
          <span class="referenceName">{{ usage.name }}</span>
          <span class="referenceFile">{{ usage.file }}<template v-if="usage.nodeId"> · {{ translate("节点 {id}", { id: usage.nodeId }) }}</template></span>
        </span>
      </li>
    </ul>
    <p v-if="entries.length" class="referenceEntries">
      {{ translate("待删除：{names}", { names: entries.map(entry => entry.name).join("、") }) }}
    </p>
    <template #footer>
      <el-button @click="emit('update:modelValue', false)">{{ translate("取消") }}</el-button>
      <el-button type="danger" @click="emit('confirm')">{{ translate("仍然删除") }}</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { translate } from "@toonflow/i18n/vue";
import type { AssetEntry, AssetUsage } from "../types";

withDefaults(defineProps<{ modelValue: boolean; usages: AssetUsage[]; entries: AssetEntry[] }>(), { usages: () => [], entries: () => [] });
const emit = defineEmits<{ "update:modelValue": [value: boolean]; confirm: [] }>();
</script>

<style scoped lang="scss">
.referenceIntro {
  margin: 0 0 10px;
  color: var(--el-text-color-regular);
  font-size: 13px;
  line-height: 1.6;
}

.referenceList {
  max-height: 260px;
  margin: 0;
  padding: 0;
  overflow: auto;
  list-style: none;

  .referenceItem {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 7px 8px;
    border-bottom: 1px solid var(--el-border-color-lighter);

    &:last-child { border-bottom: 0; }

    .referenceKind {
      flex-shrink: 0;
      padding: 1px 6px;
      border-radius: var(--el-border-radius-small);
      color: var(--el-color-primary);
      background: var(--el-color-primary-light-9);
      font-size: 11px;
    }

    .referenceMain {
      display: flex;
      flex-direction: column;
      min-width: 0;

      .referenceName { font-size: 12px; }
      .referenceFile {
        overflow: hidden;
        color: var(--el-text-color-secondary);
        font-size: 10px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    }
  }
}

.referenceEntries {
  margin: 10px 0 0;
  color: var(--el-text-color-secondary);
  font-size: 11px;
}
</style>
