<template>
  <section class="homeAssetView" aria-label="素材库">
    <div class="homeAssetBar">
      <el-select
        v-model="tagFilter"
        class="tagFilter"
        size="small"
        clearable
        filterable
        allow-create
        default-first-option
        :placeholder="translate('按标签筛选')"
        :aria-label="translate('按标签筛选')"
        @change="applyTagFilter">
        <el-option v-for="tag in tagOptions" :key="tag" :label="tag" :value="tag" />
      </el-select>
      <span v-if="selectedCount" class="selectionHint">{{ translate("已选 {count} 项", { count: selectedCount }) }}</span>
      <el-button v-if="selectedCount" size="small" :icon="IconTag" @click="openBatchTags">{{ translate("添加标签") }}</el-button>
      <el-button v-if="selectedCount" size="small" :icon="IconStar" :loading="batchFavoriteSaving" @click="toggleBatchFavorite">
        {{ allFavorited ? translate("取消收藏") : translate("收藏") }}
      </el-button>
      <el-button v-if="selectedCount" size="small" text @click="contentRef?.clearSelection()">{{ translate("取消选择") }}</el-button>
      <span class="barSpacer" />
      <el-button
        v-if="selectedCount === 1"
        text
        size="small"
        class="detailHint"
        :title="selectedEntries[0]?.path"
        @click="selectedEntries[0] && openDetail(selectedEntries[0])">
        {{ translate("详情：{name}", { name: selectedEntries[0]?.name ?? "" }) }}
      </el-button>
    </div>

    <AssetLibraryContent
      ref="contentRef"
      embedded
      :directory="activeDirectory || undefined"
      :projects="projects"
      can-show-detail
      @select-project="onSelectProject"
      @show-detail="openDetail" />

    <assetDetailDrawer
      v-model="detailVisible"
      :entry="detailEntry"
      :library="activeLibrary"
      :directory="activeDirectory || undefined"
      @edit="onEditMeta" />

    <el-dialog
      v-model="batchTagVisible"
      :title="translate('添加标签')"
      width="min(420px, calc(100vw - 24px))"
      align-center
      append-to-body
      :close-on-click-modal="false">
      <p class="batchTagHint">{{ translate("为选中的 {count} 项追加标签，不会覆盖已有标签。", { count: selectedCount }) }}</p>
      <el-select
        v-model="batchTags"
        class="batchTagSelect"
        multiple
        filterable
        allow-create
        default-first-option
        :reserve-keyword="false"
        :placeholder="translate('输入后回车创建标签')"
        :aria-label="translate('标签')" />
      <template #footer>
        <el-button :disabled="batchSaving" @click="batchTagVisible = false">{{ translate("取消") }}</el-button>
        <el-button type="primary" :loading="batchSaving" :disabled="!batchTags.length" @click="applyBatchTags">{{ translate("添加") }}</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { translate } from "@toonflow/i18n/vue";
import { IconStar, IconTag } from "@tabler/icons-vue";
import { useWorkspaceStore } from "@/stores/workspace";
import AssetLibraryContent from "@/pages/workspace/panels/assetLibrary/index.vue";
import assetDetailDrawer from "./assetDetailDrawer.vue";
import { patchMeta, patchMetas, toAssetError } from "@/pages/workspace/panels/assetLibrary/api";
import { batchErrorMessage, type AssetEntry } from "@/pages/workspace/panels/assetLibrary/types";

const workspace = useWorkspaceStore();
// ACT: 首页默认全局库；在左侧「项目」分组里点开某个项目才切过去。
const activeDirectory = ref("");
const projects = computed(() => workspace.projectList.map(project => ({ directory: project.directory, name: project.name })));

function onSelectProject(payload: { directory: string; path: string }) {
  activeDirectory.value = payload.directory;
}

/** 详情只在显式请求时打开（右键 / ⌘I / 工具栏按钮），单击选中不再自动弹。 */
function openDetail(entry: AssetEntry) {
  detailEntry.value = entry;
  detailVisible.value = true;
}

const contentRef = ref<InstanceType<typeof AssetLibraryContent>>();
const selectedEntries = computed<AssetEntry[]>(() => contentRef.value?.selectedEntries ?? []);
const selectedCount = computed(() => selectedEntries.value.length);
const entries = computed<AssetEntry[]>(() => contentRef.value?.entries ?? []);
const activeLibrary = computed(() => contentRef.value?.library ?? "global");
const tagOptions = computed(() => [...new Set(entries.value.flatMap(entry => entry.tags))].sort((left, right) => left.localeCompare(right)));

const detailVisible = ref(false);
const detailEntry = ref<AssetEntry>();
const tagFilter = ref("");
const batchTagVisible = ref(false);
const batchTags = ref<string[]>([]);
const batchSaving = ref(false);
const batchFavoriteSaving = ref(false);
const allFavorited = computed(() => selectedCount.value > 0 && selectedEntries.value.every(entry => entry.favorite));

// ACT: 单击只选中；详情抽屉只在显式请求时打开。打开后跟随选中项更新，选中被清空则关闭。
watch(selectedEntries, list => {
  if (!list.length) {
    detailVisible.value = false;
    detailEntry.value = undefined;
    return;
  }
  if (detailVisible.value) detailEntry.value = list[0];
});

// 工具栏搜索被清空时，同步清掉标签筛选的高亮。
watch(() => contentRef.value?.query, value => {
  if (!value) tagFilter.value = "";
});

function applyTagFilter(value: string | undefined) {
  contentRef.value?.setSearchQuery(value?.trim() ?? "");
}

function openBatchTags() {
  batchTags.value = [];
  batchTagVisible.value = true;
}

async function applyBatchTags() {
  // 与服务端一致：单个标签最多 32 字符，超长部分截断。
  const tags = [...new Set(batchTags.value.map(tag => tag.trim().slice(0, 32)).filter(Boolean))];
  const targets = [...(contentRef.value?.selectedEntries ?? [])];
  const selector = contentRef.value?.selector();
  if (!tags.length || !targets.length || !selector) return;
  batchSaving.value = true;
  let succeeded = 0;
  const failures: string[] = [];
  for (const entry of targets) {
    try {
      const merged = [...new Set([...entry.tags, ...tags])].slice(0, 20);
      await patchMeta(selector, entry.path, { tags: merged });
      entry.tags = merged;
      succeeded++;
    } catch (cause) {
      failures.push(`${entry.name}: ${toAssetError(cause).message}`);
    }
  }
  batchSaving.value = false;
  batchTagVisible.value = false;
  if (succeeded) ElMessage.success(translate("已为 {count} 项添加标签", { count: succeeded }));
  if (failures.length) ElMessage.error(translate("{count} 项添加失败：{detail}", { count: failures.length, detail: failures.slice(0, 3).join("；") }));
  await contentRef.value?.refresh();
}

async function toggleBatchFavorite() {
  const targets = [...selectedEntries.value];
  const selector = contentRef.value?.selector();
  if (!targets.length || !selector) return;
  const favorite = !allFavorited.value;
  batchFavoriteSaving.value = true;
  try {
    const result = await patchMetas(selector, targets.map(entry => entry.path), { favorite });
    const succeeded = new Set(result.items.filter(item => item.ok).map(item => item.path));
    for (const entry of targets) if (succeeded.has(entry.path)) entry.favorite = favorite;
    if (succeeded.size) {
      ElMessage.success(favorite
        ? translate("已收藏 {count} 项", { count: succeeded.size })
        : translate("已取消收藏 {count} 项", { count: succeeded.size }));
    }
    const failures = result.items.filter(item => !item.ok);
    if (failures.length) {
      ElMessage.error(translate("{count} 项操作失败：{detail}", {
        count: failures.length,
        detail: failures.slice(0, 3).map(item => batchErrorMessage(item.error) || item.path).join("；"),
      }));
    }
  } catch (cause) {
    ElMessage.error(toAssetError(cause).message);
  } finally {
    batchFavoriteSaving.value = false;
  }
}

function onEditMeta(entry: AssetEntry) {
  contentRef.value?.openMeta(entry);
}

/** 离开素材库时收起 append-to-body 的浮层，否则它们会浮在首页上。 */
function closeOverlays() {
  detailVisible.value = false;
  detailEntry.value = undefined;
  batchTagVisible.value = false;
  batchTags.value = [];
}

defineExpose({ closeOverlays });
</script>

<style scoped lang="scss">
.homeAssetView {
  /* ACT: 首页的雾状背景是 absolute，这里必须是定位元素才能盖在它上面，否则背景会画到顶栏之上。 */
  position: relative;
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  height: 100%;
}

.homeAssetBar {
  display: flex;
  flex-shrink: 0;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 8px clamp(12px, 2vw, 24px);
  border-bottom: 1px solid var(--el-border-color-lighter);

  .tagFilter { flex-shrink: 0; width: 180px; max-width: 100%; }

  .selectionHint,
  .detailHint {
    overflow: hidden;
    color: var(--el-text-color-secondary);
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .detailHint { max-width: 40%; }
  .barSpacer { flex: 1; }

  .el-button { margin: 0; }
}

.batchTagHint {
  margin: 0 0 10px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.batchTagSelect { width: 100%; }
</style>
