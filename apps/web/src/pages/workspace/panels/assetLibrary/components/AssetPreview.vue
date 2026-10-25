<template>
  <el-image-viewer
    v-if="entry && kind === 'image' && url"
    :url-list="[url]"
    teleported
    @close="emit('update:modelValue', false)" />

  <el-dialog
    :model-value="playerVisible"
    :title="entry?.name"
    width="min(820px, calc(100vw - 24px))"
    align-center
    append-to-body
    destroy-on-close
    @update:model-value="emit('update:modelValue', $event)">
    <div v-if="entry" class="assetPreview">
      <el-alert v-if="!url || error" :title="error || translate('当前文件无法预览')" type="error" :closable="false" show-icon />
      <video v-else-if="kind === 'video'" :key="url" class="previewVideo" :src="url" :aria-label="entry.name" controls playsinline preload="metadata" @error="error = translate('视频无法播放，文件可能已损坏或浏览器不支持该编码。')" />
      <audio v-else-if="kind === 'audio'" :key="url" class="previewAudio" :src="url" :aria-label="entry.name" controls preload="metadata" @error="error = translate('音频无法播放，文件可能已损坏或浏览器不支持该编码。')" />
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { translate } from "@toonflow/i18n/vue";
import { assetReadUrl } from "../api";
import { assetKind } from "../types";
import type { AssetEntry, AssetLibraryKind } from "../types";

const props = defineProps<{
  modelValue: boolean;
  entry?: AssetEntry;
  library: AssetLibraryKind;
  directory?: string;
}>();
const emit = defineEmits<{ "update:modelValue": [value: boolean] }>();
const error = ref("");

const kind = computed(() => props.entry ? assetKind(props.entry) : undefined);
// ACT: 播放器显隐必须跟随 v-model。之前写成「有 entry 就为真」，关闭后 entry 仍在，
// 值恒为 true，el-dialog 内部的 visible 再也收不到 false→true 的跳变，第二次点开无反应。
const playerVisible = computed(() => props.modelValue && !!props.entry && (kind.value === "video" || kind.value === "audio"));
const url = computed(() => {
  if (!props.entry || !props.modelValue) return "";
  const entryKind = assetKind(props.entry);
  if (entryKind !== "image" && entryKind !== "video" && entryKind !== "audio") return "";
  return assetReadUrl({ library: props.library, directory: props.directory }, props.entry.path);
});

watch(() => [props.modelValue, props.entry] as const, () => { error.value = ""; });
</script>

<style scoped lang="scss">
.assetPreview {
  .previewVideo {
    display: block;
    width: 100%;
    max-height: 68dvh;
    background: #000;
  }

  .previewAudio { display: block; width: 100%; }
}
</style>
