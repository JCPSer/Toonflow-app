<template>
  <el-dialog
    :model-value="modelValue"
    :title="translate('标签与备注')"
    width="min(460px, calc(100vw - 24px))"
    align-center
    append-to-body
    :close-on-click-modal="false"
    @update:model-value="emit('update:modelValue', $event)">
    <div v-if="entry" class="metaForm">
      <div class="metaPath" :title="entry.path">{{ entry.name }}</div>
      <el-form label-position="top">
        <el-form-item :label="translate('标签')">
          <el-select
            v-model="tags"
            multiple
            filterable
            allow-create
            default-first-option
            :reserve-keyword="false"
            class="tagSelect"
            :placeholder="translate('输入后回车创建标签')"
            :aria-label="translate('标签')" />
        </el-form-item>
        <el-form-item :label="translate('备注')">
          <el-input
            v-model="note"
            type="textarea"
            :rows="4"
            maxlength="2000"
            show-word-limit
            :placeholder="translate('记录用途、来源或注意事项')"
            :aria-label="translate('备注')" />
        </el-form-item>
        <el-form-item :label="translate('收藏')">
          <el-switch v-model="favorite" :aria-label="translate('收藏')" />
        </el-form-item>
      </el-form>
    </div>
    <template #footer>
      <el-button :disabled="saving" @click="emit('update:modelValue', false)">{{ translate("取消") }}</el-button>
      <el-button type="primary" :loading="saving" @click="submit">{{ translate("保存") }}</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { translate } from "@toonflow/i18n/vue";
import type { AssetEntry } from "../types";

const props = defineProps<{
  modelValue: boolean;
  entry?: AssetEntry;
  saving?: boolean;
}>();
const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  save: [patch: { tags: string[]; note: string; favorite: boolean }];
}>();

const tags = ref<string[]>([]);
const note = ref("");
const favorite = ref(false);

watch(() => [props.modelValue, props.entry] as const, ([visible, entry]) => {
  if (!visible || !entry) return;
  tags.value = [...entry.tags];
  note.value = entry.note;
  favorite.value = entry.favorite;
}, { immediate: true });

function submit() {
  emit("save", { tags: tags.value, note: note.value, favorite: favorite.value });
}
</script>

<style scoped lang="scss">
.metaForm {
  .metaPath {
    margin-bottom: 12px;
    overflow: hidden;
    color: var(--el-text-color-secondary);
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tagSelect { width: 100%; }
}
</style>
