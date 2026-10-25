<template>
  <el-drawer
    :model-value="modelValue"
    :title="entry?.name || translate('素材详情')"
    direction="rtl"
    size="min(440px, calc(100vw - 24px))"
    append-to-body
    destroy-on-close
    :modal="false"
    modal-penetrable
    :lock-scroll="false"
    :close-on-click-modal="false"
    class="assetDetailDrawer"
    @update:model-value="emit('update:modelValue', $event)">
    <div v-if="entry" class="assetDetail">
      <div class="detailPreview">
        <img v-if="kind === 'image'" class="previewImage" :src="readUrl" :alt="entry.name" @error="previewError = translate('图片无法加载，文件可能已损坏。')" />
        <video v-else-if="kind === 'video'" :key="readUrl" class="previewVideo" :src="readUrl" :aria-label="entry.name" controls playsinline preload="metadata" @error="previewError = translate('视频无法播放，文件可能已损坏或浏览器不支持该编码。')" />
        <audio v-else-if="kind === 'audio'" :key="readUrl" class="previewAudio" :src="readUrl" :aria-label="entry.name" controls preload="metadata" @error="previewError = translate('音频无法播放，文件可能已损坏或浏览器不支持该编码。')" />
        <iframe v-else-if="kind === 'document' && isPdf" class="previewDocument" :src="readUrl" :title="entry.name" />
        <pre v-else-if="kind === 'document' && isTextDocument" class="previewText">{{ docTextLoading ? translate("正在读取…") : (docTextError || docText) }}</pre>
        <div v-else class="previewPlaceholder">
          <component :is="kind === 'directory' ? IconFolder : IconFile" :size="44" stroke="1.25" aria-hidden="true" />
          <span v-if="kind === 'directory'">{{ translate("文件夹 · 共 {count} 项", { count: entry.childCount ?? 0 }) }}</span>
          <span v-else-if="kind === 'document'">{{ translate("此格式暂不支持内嵌预览，可下载后查看。") }}</span>
          <span v-else>{{ translate("该文件暂无预览") }}</span>
        </div>
        <el-alert v-if="previewError" class="previewError" :title="previewError" type="error" :closable="false" show-icon />
      </div>

      <dl class="detailMeta">
        <div class="metaRow"><dt>{{ translate("名称") }}</dt><dd :title="entry.name">{{ entry.name }}</dd></div>
        <div class="metaRow"><dt>{{ translate("路径") }}</dt><dd :title="entry.path">{{ entry.path || "/" }}</dd></div>
        <div class="metaRow"><dt>{{ translate("类型") }}</dt><dd>{{ typeLabel }}</dd></div>
        <div class="metaRow"><dt>{{ translate("大小") }}</dt><dd>{{ entry.type === "directory" ? translate("{count} 项", { count: entry.childCount ?? 0 }) : formatAssetSize(entry.size) }}</dd></div>
        <div class="metaRow"><dt>{{ translate("修改时间") }}</dt><dd>{{ modifiedLabel }}</dd></div>
      </dl>

      <section class="detailSection">
        <header class="sectionHeader">
          <h4>{{ translate("标签") }}</h4>
          <el-button text size="small" @click="emit('edit', entry)">{{ translate("编辑") }}</el-button>
        </header>
        <div v-if="entry.tags.length" class="tagList">
          <el-tag v-for="tag in entry.tags" :key="tag" size="small" type="info" disable-transitions>{{ tag }}</el-tag>
        </div>
        <span v-else class="emptyHint">{{ translate("暂无标签") }}</span>
      </section>

      <section class="detailSection">
        <header class="sectionHeader">
          <h4>{{ translate("备注") }}</h4>
          <el-button text size="small" @click="emit('edit', entry)">{{ translate("编辑") }}</el-button>
        </header>
        <p v-if="entry.note" class="detailNote">{{ entry.note }}</p>
        <span v-else class="emptyHint">{{ translate("暂无备注") }}</span>
      </section>

      <section class="detailSection">
        <header class="sectionHeader">
          <h4>{{ translate("收藏") }}</h4>
          <el-switch v-model="favoriteModel" :loading="favoriteSaving" :disabled="favoriteSaving" :aria-label="translate('收藏')" />
        </header>
      </section>

      <section class="detailSection">
        <header class="sectionHeader">
          <h4>{{ translate("引用位置") }}</h4>
          <el-button text size="small" :loading="usageLoading" @click="loadUsages">{{ translate("刷新") }}</el-button>
        </header>
        <div v-if="usageLoading" class="emptyHint">{{ translate("正在查询引用位置…") }}</div>
        <el-alert v-else-if="usageError" :title="usageError" type="error" :closable="false" show-icon />
        <ul v-else-if="usages.length" class="usageList">
          <li v-for="(usage, index) in usages" :key="`${usage.kind}-${usage.file}-${index}`">
            <component :is="usage.kind === 'canvas' ? IconVector : IconMessage" :size="14" aria-hidden="true" />
            <span class="usageName">{{ usage.name || usage.file }}</span>
            <span class="usageKind">{{ usage.kind === "canvas" ? translate("画布") : translate("会话") }}</span>
          </li>
        </ul>
        <span v-else class="emptyHint">{{ translate("未发现引用") }}</span>
      </section>

      <div class="detailActions">
        <el-button size="small" :icon="IconDownload" :disabled="entry.type === 'directory'" @click="download">{{ translate("下载") }}</el-button>
      </div>
    </div>
  </el-drawer>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import axios from "axios";
import { ElMessage } from "element-plus";
import { locale, translate } from "@toonflow/i18n/vue";
import { IconDownload, IconFile, IconFolder, IconMessage, IconVector } from "@tabler/icons-vue";
import saveFile from "@/lib/saveFile";
import { assetDownloadUrl, assetReadUrl, getUsages, patchMeta, toAssetError } from "@/pages/workspace/panels/assetLibrary/api";
import { assetKind, formatAssetSize } from "@/pages/workspace/panels/assetLibrary/types";
import type { AssetEntry, AssetLibraryKind, AssetUsage } from "@/pages/workspace/panels/assetLibrary/types";

const props = defineProps<{
  modelValue: boolean;
  entry?: AssetEntry;
  library: AssetLibraryKind;
  directory?: string;
}>();
const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  edit: [entry: AssetEntry];
}>();

const textExtensions = new Set([
  "txt", "md", "markdown", "json", "jsonl", "csv", "tsv", "log", "xml", "yaml", "yml", "html", "htm",
  "js", "mjs", "cjs", "ts", "tsx", "jsx", "vue", "css", "scss", "less", "py", "sh", "bat", "sql", "ini", "toml", "srt", "vtt",
]);

const previewError = ref("");
const docText = ref("");
const docTextLoading = ref(false);
const docTextError = ref("");
const favoriteSaving = ref(false);
const usageLoading = ref(false);
const usageError = ref("");
const usages = ref<AssetUsage[]>([]);
let usageRequest = 0;

const selector = computed(() => ({ library: props.library, directory: props.directory }));
const kind = computed(() => props.entry ? assetKind(props.entry) : undefined);
const extension = computed(() => props.entry?.name.match(/\.([^.]+)$/)?.[1]?.toLowerCase() ?? "");
const isPdf = computed(() => extension.value === "pdf");
const isTextDocument = computed(() => textExtensions.has(extension.value));
const readUrl = computed(() => props.entry && props.modelValue ? assetReadUrl(selector.value, props.entry.path) : "");
const typeLabel = computed(() => {
  if (!props.entry) return "";
  if (kind.value === "directory") return translate("文件夹");
  if (kind.value === "image") return translate("图片");
  if (kind.value === "video") return translate("视频");
  if (kind.value === "audio") return translate("音频");
  if (kind.value === "document") return translate("文档");
  return translate("文件");
});
const modifiedLabel = computed(() => props.entry?.mtimeMs
  ? new Date(props.entry.mtimeMs).toLocaleString(locale.value, { hour12: false })
  : "-");
const favoriteModel = computed({
  get: () => props.entry?.favorite === true,
  set: value => { void saveFavorite(value); },
});

watch(() => [props.modelValue, props.entry?.path] as const, ([visible, path], _previous, onCleanup) => {
  previewError.value = "";
  docText.value = "";
  docTextError.value = "";
  docTextLoading.value = false;
  usages.value = [];
  usageError.value = "";
  if (!visible || !path || !props.entry) return;
  void loadUsages();
  if (!isTextDocument.value) return;
  let cancelled = false;
  onCleanup(() => { cancelled = true; });
  docTextLoading.value = true;
  void fetch(readUrl.value, { headers: { "x-toonflow-workspace": "1" } })
    .then(response => {
      if (!response.ok) throw new Error(translate("无法读取文档（{status}）", { status: response.status }));
      return response.text();
    })
    .then(text => { if (!cancelled) docText.value = text; })
    .catch(cause => { if (!cancelled) docTextError.value = cause instanceof Error ? cause.message : translate("无法读取文档"); })
    .finally(() => { if (!cancelled) docTextLoading.value = false; });
}, { immediate: true });

async function loadUsages() {
  const entry = props.entry;
  const request = ++usageRequest;
  if (!entry || entry.type === "directory") { usages.value = []; usageLoading.value = false; return; }
  usageLoading.value = true;
  usageError.value = "";
  try {
    const result = await getUsages(selector.value, entry.path);
    if (request === usageRequest) usages.value = result.usages;
  } catch (cause) {
    if (request === usageRequest) usageError.value = toAssetError(cause).message;
  } finally {
    if (request === usageRequest) usageLoading.value = false;
  }
}

async function saveFavorite(next: boolean) {
  const entry = props.entry;
  if (!entry) return;
  const previous = entry.favorite;
  // 乐观更新，网格星标立即同步；失败再回滚。
  entry.favorite = next;
  favoriteSaving.value = true;
  try {
    await patchMeta(selector.value, entry.path, { favorite: next });
    ElMessage.success(next ? translate("已收藏") : translate("已取消收藏"));
  } catch (cause) {
    entry.favorite = previous;
    ElMessage.error(toAssetError(cause).message);
  } finally {
    favoriteSaving.value = false;
  }
}

async function download() {
  const entry = props.entry;
  if (!entry || entry.type === "directory") return;
  try {
    const url = assetDownloadUrl(selector.value, entry.path);
    await saveFile(() => axios.get<Blob>(url, {
      responseType: "blob",
      headers: { "x-toonflow-workspace": "1" },
    }).then(response => response.data), entry.name);
  } catch (cause) {
    ElMessage.error(toAssetError(cause).message);
  }
}
</script>

<style scoped lang="scss">
.assetDetail {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding-bottom: 16px;

  .detailPreview {
    position: relative;
    display: flex;
    flex-direction: column;
    min-height: 140px;
    overflow: hidden;
    border: 1px solid var(--el-border-color-lighter);
    border-radius: var(--ui-radius-large, 10px);
    background: var(--el-fill-color-extra-light);

    .previewImage { display: block; width: 100%; max-height: 300px; object-fit: contain; background: var(--el-fill-color-light); }
    .previewVideo { display: block; width: 100%; max-height: 300px; background: #000; }
    .previewAudio { display: block; width: calc(100% - 20px); margin: 24px 10px; }
    .previewDocument { display: block; width: 100%; height: 320px; border: 0; background: #fff; }
    .previewText {
      max-height: 320px;
      margin: 0;
      overflow: auto;
      padding: 10px 12px;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      font-family: var(--el-font-family-mono, monospace);
      font-size: 12px;
      line-height: 1.6;
    }
    .previewPlaceholder {
      display: flex;
      flex: 1;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 8px;
      min-height: 140px;
      padding: 20px;
      color: var(--el-text-color-secondary);
      font-size: 12px;
      text-align: center;
    }
    .previewError { border-radius: 0; }
  }

  .detailMeta {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 0;

    .metaRow {
      display: flex;
      gap: 10px;
      min-width: 0;
      font-size: 12px;
      line-height: 18px;

      dt { flex-shrink: 0; width: 68px; color: var(--el-text-color-secondary); }
      dd {
        flex: 1;
        min-width: 0;
        margin: 0;
        overflow: hidden;
        color: var(--el-text-color-primary);
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    }
  }

  .detailSection {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding-top: 10px;
    border-top: 1px solid var(--el-border-color-lighter);
    font-size: 12px;

    .sectionHeader {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;

      h4 { margin: 0; font-size: 12px; font-weight: 600; color: var(--el-text-color-regular); }
      .el-button { margin: 0; padding: 0 4px; }
    }

    .tagList { display: flex; flex-wrap: wrap; gap: 6px; }
    .detailNote { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.6; color: var(--el-text-color-primary); }
    .emptyHint { color: var(--el-text-color-placeholder); }

    .usageList {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin: 0;
      padding: 0;
      list-style: none;

      li {
        display: flex;
        align-items: center;
        gap: 6px;
        min-width: 0;

        svg { flex-shrink: 0; color: var(--el-text-color-secondary); }
        .usageName { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .usageKind { flex-shrink: 0; margin-left: auto; color: var(--el-text-color-placeholder); font-size: 11px; }
      }
    }
  }

  .detailActions {
    display: flex;
    justify-content: flex-end;
    padding-top: 10px;
    border-top: 1px solid var(--el-border-color-lighter);
  }
}
</style>
