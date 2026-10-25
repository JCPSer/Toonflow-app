<template>
  <el-dialog
    :model-value="modelValue"
    :title="translate('移动到…')"
    width="min(420px, calc(100vw - 24px))"
    align-center
    append-to-body
    :close-on-click-modal="false"
    @update:model-value="emit('update:modelValue', $event)">
    <p class="moveSummary">
      {{ translate("将 {count} 项移动到以下文件夹：", { count: entries.length }) }}
    </p>
    <AssetDestinationTree
      :key="treeKey"
      v-model="target"
      :library="library"
      :directory="directory"
      :root-label="translate('素材库根目录')"
      :disabled-paths="disabledDestination"
      @error="emit('error', $event)" />
    <template #footer>
      <el-button @click="emit('update:modelValue', false)">{{ translate("取消") }}</el-button>
      <el-button type="primary" :disabled="!canMove" @click="emit('confirm', target)">{{ translate("移动") }}</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { translate } from "@toonflow/i18n/vue";
import AssetDestinationTree from "./AssetDestinationTree.vue";
import type { AssetEntry, AssetLibraryKind } from "../types";
import { isSameOrDescendant, parentAssetPath } from "../types";

const props = defineProps<{
  modelValue: boolean;
  library: AssetLibraryKind;
  directory?: string;
  entries: AssetEntry[];
  initialTarget?: string;
}>();
const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  confirm: [target: string];
  error: [message: string];
}>();

const target = ref(props.initialTarget ?? "");
const treeKey = ref(0);

watch(() => props.modelValue, visible => {
  if (visible) {
    target.value = props.initialTarget ?? "";
    treeKey.value++;
  }
});

const canMove = computed(() => props.entries.some(entry =>
  parentAssetPath(entry.path) !== target.value
  && !(entry.type === "directory" && isSameOrDescendant(target.value, entry.path))));

function disabledDestination(path: string) {
  if (props.entries.some(entry => entry.type === "directory" && isSameOrDescendant(path, entry.path))) return true;
  return props.entries.every(entry => parentAssetPath(entry.path) === path);
}
</script>

<style scoped lang="scss">
.moveSummary {
  margin: 0 0 10px;
  color: var(--el-text-color-regular);
  font-size: 13px;
}
</style>
