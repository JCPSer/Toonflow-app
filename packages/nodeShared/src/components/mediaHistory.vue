<template>
  <el-button :icon="IconHistory" :disabled="disabled" text title="历史记录" aria-label="历史记录" @click.stop="visible = true">历史记录</el-button>
  <el-dialog v-model="visible" :title="`${mediaType === 'image' ? '图片' : '视频'}历史记录`" width="min(760px, calc(100vw - 32px))" appendToBody destroyOnClose>
    <div v-loading="loading" class="mediaHistory nodrag nopan nowheel" @pointerdown.stop @mousedown.stop @dblclick.stop @keydown.stop>
      <el-alert v-if="loadError" :title="loadError" type="error" :closable="false" />
      <el-empty v-else-if="!loading && !items.length" description="暂无历史记录" />
      <template v-else-if="items.length">
        <el-alert v-if="actionError" :title="actionError" type="error" :closable="false" show-icon />
        <div class="historyContent">
          <div class="historyList" aria-label="历史文件">
            <div v-for="item in pageItems" :key="item.url" class="historyRow">
              <button
                type="button"
                class="historyItem"
                :class="{ selected: selected?.url === item.url }"
                :aria-pressed="selected?.url === item.url"
                :title="item.url"
                @click="selected = item">
                <span class="fileName">{{ item.url.split('/').at(-1) }}</span>
                <span v-if="isCurrent(item)" class="currentLabel">当前结果</span>
              </button>
              <el-button
                class="historyDelete"
                text
                :icon="IconTrash"
                :disabled="disabled || loading || deleting || !isOwned(item)"
                :title="isOwned(item) ? `删除 ${item.url.split('/').at(-1)}` : '该文件属于其他节点，无法在此删除'"
                :aria-label="isOwned(item) ? `删除 ${item.url.split('/').at(-1)}` : '该文件属于其他节点，无法在此删除'"
                @click.stop="removeItem(item)" />
            </div>
          </div>
          <div class="historyPreview" v-loading="!!selected && !previewReady && !previewError">
            <el-alert v-if="previewError" :title="previewError" type="error" :closable="false" />
            <img v-else-if="previewUrl && mediaType === 'image'" :src="previewUrl" alt="历史图片预览" @load="previewReady = true" @error="previewError = '无法预览该图片'" />
            <video v-else-if="previewUrl" :src="previewUrl" controls playsinline preload="auto" aria-label="历史视频预览" @loadeddata="previewReady = true" @error="previewError = '无法预览该视频'" />
          </div>
        </div>
        <el-pagination v-model:currentPage="page" :pageSize="pageSize" :total="items.length" layout="prev, pager, next" hideOnSinglePage />
      </template>
    </div>
    <template #footer>
      <div class="historyFooter">
        <el-button type="danger" plain :icon="IconTrash" :disabled="disabled || loading || deleting || !selected || !isOwned(selected)" :loading="deleting" @click="deleteSelected">删除</el-button>
        <div class="footerEnd">
          <el-button :disabled="deleting" @click="visible = false">关闭</el-button>
          <el-button type="primary" :disabled="disabled || loading || deleting || !selected || !previewUrl || !previewReady || !!previewError" @click="selectOutput">设为当前结果</el-button>
        </div>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useNode } from "@vue-flow/core";
import { ElAlert, ElButton, ElDialog, ElEmpty, ElLoading, ElPagination } from "element-plus";
import { IconHistory, IconTrash } from "@tabler/icons-vue";
import { useNodeFiles } from "@toonflow/nodes-scaffold/workspaceFiles";
import type { NodeMediaValue } from "@toonflow/nodes-scaffold/values";

const props = defineProps<{ mediaType: "image" | "video"; current?: NodeMediaValue; disabled?: boolean }>();
const emit = defineEmits<{ select: [value: NodeMediaValue]; clear: [] }>();
const vLoading = ElLoading.directive;
const { id } = useNode();
const files = useNodeFiles();
const visible = ref(false);
const loading = ref(false);
const deleting = ref(false);
const loadError = ref("");
const actionError = ref("");
const previewError = ref("");
const previewReady = ref(false);
const items = ref<NodeMediaValue[]>([]);
const selected = ref<NodeMediaValue>();
const page = ref(1);
const pageSize = 20;
// ACT: 每次打开弹窗换一代，进行中的删除回来时只保留副作用，不再改写新列表。
let actionToken = 0;
const pageItems = computed(() => items.value.slice((page.value - 1) * pageSize, page.value * pageSize));
const mimeTypes: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif",
  avif: "image/avif", apng: "image/apng", bmp: "image/bmp", svg: "image/svg+xml", ico: "image/x-icon", tif: "image/tiff", tiff: "image/tiff",
  mp4: "video/mp4", m4v: "video/mp4", webm: "video/webm", mov: "video/quicktime", mkv: "video/x-matroska", avi: "video/x-msvideo", ogv: "video/ogg",
};
const previewFile = computed(() => visible.value ? selected.value : undefined);
watch(previewFile, () => { previewError.value = ""; }, { flush: "sync" });
// ACT: 目录列表仅保存路径，每页显示 20 条，只读取选中文件；海量目录需服务端分页时再扩展 list。
const previewUrl = files.useFileUrl(previewFile, () => { previewError.value = "历史文件读取失败，文件可能已被移动或删除"; });
watch([previewFile, previewUrl], () => { previewReady.value = false; }, { flush: "sync" });

watch(() => props.disabled, disabled => { if (disabled) visible.value = false; });
watch(visible, async (open, _previous, onCleanup) => {
  let cancelled = false;
  onCleanup(() => { cancelled = true; });
  actionToken++;
  items.value = [];
  selected.value = undefined;
  loadError.value = "";
  actionError.value = "";
  page.value = 1;
  if (!open) return;
  loading.value = true;
  try {
    const { entries } = await files.getWorkspaceFiles().list(`assets/${id}`).catch((error: { response?: { data?: { data?: { code?: string } } } }) => {
      if (error.response?.data?.data?.code !== "ENOENT") throw error;
      return { entries: [] };
    });
    if (cancelled) return;
    const results = new Map<string, NodeMediaValue>();
    for (const entry of entries) {
      const mimeType = mimeTypes[entry.name.split(".").at(-1)?.toLowerCase() ?? ""];
      if (entry.type === "file" && mimeType?.startsWith(`${props.mediaType}/`)) {
        const url = entry.path.replaceAll("\\", "/");
        results.set(url, { url, mimeType });
      }
    }
    // ACT: 副本使用新 ID，但当前结果仍可能引用原节点文件；只补当前结果，不继承原目录的全部历史。
    const current = props.current && { ...props.current, url: props.current.url.replaceAll("\\", "/") };
    if (current) results.set(current.url, current);
    items.value = [...results.values()].sort((left, right) => left.url.localeCompare(right.url, "zh-CN", { numeric: true }));
    selected.value = current ?? items.value[0];
    page.value = Math.floor(Math.max(0, items.value.findIndex(item => item.url === selected.value?.url)) / pageSize) + 1;
  } catch (error) {
    if (!cancelled) {
      const message = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
      loadError.value = message || (error instanceof Error ? error.message : "历史记录读取失败");
    }
  } finally {
    if (!cancelled) loading.value = false;
  }
});

function selectOutput() {
  if (props.disabled || loading.value || !selected.value || !previewUrl.value || !previewReady.value || previewError.value) return;
  emit("select", { ...selected.value });
  visible.value = false;
}

function isCurrent(item: NodeMediaValue) {
  return !!props.current && item.url === props.current.url.replaceAll("\\", "/");
}

// ACT: 复制/粘贴节点只换 ID，输出仍指向原节点目录；跨节点文件删了会毁掉原节点，必须挡住。
function isOwned(item: NodeMediaValue) {
  const owner = `assets/${id}/`.toLowerCase();
  return item.url.replaceAll("\\", "/").toLowerCase().startsWith(owner);
}

function deleteSelected() {
  if (selected.value) void removeItem(selected.value);
}

// ACT: 历史文件位于节点素材目录，删除即物理删除；删除当前结果时同步清空节点输出，避免悬空引用。
async function removeItem(item: NodeMediaValue) {
  if (props.disabled || loading.value || deleting.value) return;
  if (!isOwned(item)) {
    actionError.value = "该文件属于其他节点，无法在此删除";
    return;
  }
  const index = items.value.findIndex(entry => entry.url === item.url);
  if (index < 0) return;
  const token = actionToken;
  const selectedUrl = selected.value?.url;
  deleting.value = true;
  actionError.value = "";
  try {
    await files.getWorkspaceFiles().remove(item.url).catch((error: { response?: { data?: { data?: { code?: string } } } }) => {
      if (error.response?.data?.data?.code !== "ENOENT") throw error;
    });
    if (isCurrent(item)) emit("clear");
    // 弹窗被关闭/重开时列表已重置，旧请求只保留副作用，不再改动新列表。
    if (token !== actionToken) return;
    // 删的不是当前预览项时保留原选中，避免预览被顺手换掉。
    const remaining = items.value.filter(entry => entry.url !== item.url);
    items.value = remaining;
    selected.value = remaining.find(entry => entry.url === selectedUrl) ?? remaining[Math.min(index, remaining.length - 1)];
    page.value = Math.min(page.value, Math.max(1, Math.ceil(remaining.length / pageSize)));
  } catch (error) {
    if (token !== actionToken) return;
    const message = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
    actionError.value = message || (error instanceof Error ? error.message : "删除失败");
  } finally {
    deleting.value = false;
  }
}
</script>

<style scoped lang="scss">
.mediaHistory {
  min-height: 300px;

  .historyContent {
    display: grid;
    grid-template-columns: minmax(140px, 1fr) minmax(0, 2fr);
    gap: 16px;

    .historyList {
      height: 360px;
      overflow: auto;

      .historyRow {
        position: relative;

        &:hover .historyDelete,
        &:focus-within .historyDelete { opacity: 1; }
      }

      .historyDelete {
        position: absolute;
        top: 50%;
        right: 4px;
        width: 26px;
        height: 26px;
        margin: 0;
        padding: 0;
        transform: translateY(-50%);
        color: var(--el-color-danger);
        opacity: 0;
        transition: opacity 0.12s;

        /* ACT: 触屏没有 hover，隐藏的删除按钮仍可命中，直接删文件，所以常显。 */
        @media (hover: none) { opacity: 1; }
      }

      .historyItem {
        display: block;
        width: 100%;
        padding: 10px 34px 10px 10px;
        border: 1px solid transparent;
        border-radius: var(--el-border-radius-base);
        background: transparent;
        color: var(--el-text-color-primary);
        font: inherit;
        text-align: left;
        cursor: pointer;

        &:hover { background: var(--el-fill-color-light); }
        &.selected { border-color: var(--el-color-primary); background: var(--el-color-primary-light-9); }
        &:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: -2px; }
        .fileName { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .currentLabel { color: var(--el-color-primary); font-size: 12px; }
      }
    }

    .historyPreview {
      display: grid;
      place-items: center;
      height: 360px;
      min-width: 0;
      background: var(--el-fill-color-light);
      border-radius: var(--el-border-radius-base);

      img, video { width: 100%; max-height: 360px; object-fit: contain; }
    }
  }

  .el-pagination { justify-content: center; margin-top: 16px; }
}

/* ACT: footer slot 渲染在 el-dialog__footer，与 .mediaHistory 是兄弟节点，样式不能写在它内部。 */
.historyFooter {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;

  .footerEnd { display: flex; gap: 12px; }
}
</style>
