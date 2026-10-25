<template>
  <div
    ref="rootElement"
    class="assetLibraryContent"
    :class="{ embedded }"
    tabindex="-1"
    @keydown="onKeydown"
    @dragenter="onRootDragEnter"
    @dragover="onRootDragOver"
    @dragleave="onRootDragLeave"
    @drop="onRootDrop">
    <AssetToolbar
      v-if="!trashVisible"
      v-model:view="viewModel"
      v-model:sort="sortModel"
      v-model:order="orderModel"
      v-model:query="queryModel"
      :loading="loading"
      :selection-count="selection.size"
      :mock="mockMode"
      :can-write="canWrite"
      :library="library"
      :project-available="projectAvailable"
      @switch-library="setLibrary"
      :search-placeholder="searchScopeLabel"
      @create-folder="createFolder()"
      @upload="chooseUpload()"
      @refresh="refresh"
      @submit-search="submitSearch"
      @clear-search="clearSearchNow"
      @open-trash="openTrash"
      @empty-trash="emptyTrashFromToolbar"
      @move-selection="requestMove(selectedEntries)"
      @delete-selection="deleteEntries(selectedEntries)"
      @clear-selection="clearSelection" />

    <el-alert
      v-if="!trashVisible && projectFallback"
      class="libraryNotice"
      type="warning"
      :closable="false"
      show-icon
      :title="translate('项目已有同名 library 文件夹，素材库改用 {path}', { path: projectFallbackPath })" />

    <el-alert
      v-if="!trashVisible && libraryError && entries.length > 0"
      class="libraryNotice"
      type="error"
      :closable="false"
      show-icon
      :title="libraryError">
      <template #default>
        <el-button text size="small" @click="refresh">{{ translate("重试") }}</el-button>
      </template>
    </el-alert>

    <div class="libraryBody">
      <AssetTreeView
        v-if="!trashVisible && view === 'tree'"
        :library="library"
        :directory="directory"
        :projects="projects"
        :active-directory="directory"
        :current-path="currentPath"
        :expanded-keys="expandedKeys"
        :refresh-key="treeVersion"
        @navigate="navigate"
        @select-library="setLibrary"
        @select-project="onSelectProject"
        @menu="showEntryMenu"
        @move="moveDraggedEntry"
        @expanded="setExpanded"
        @error="showMessage" />

      <AssetGridView
        v-if="!trashVisible"
        :entries="entries"
        :selection="selection"
        :library="library"
        :directory="directory"
        :view="view"
        :current-path="currentPath"
        :query="query"
        :loading="loading"
        :loading-more="loadingMore"
        :has-more="hasMore"
        :empty-kind="emptyKind"
        :empty-message="libraryError"
        @select="selectEntry"
        @open="openEntry"
        @menu="showEntryMenu"
        @navigate="navigate"
        @move="moveDraggedEntry"
        @error="showMessage"
        @upload-drop="onUploadDrop"
        @load-more="loadMore"
        @clear-selection="clearSelection"
        @background-menu="showBackgroundMenu"
        @create-folder="createFolder()"
        @upload="chooseUpload()"
        @refresh="refresh"
        @clear-search="clearSearchNow"
        @switch-global="setLibrary('global')" />

      <AssetTrashView
        v-else
        :items="trashItems"
        :usage="trashUsage"
        :loading="trashLoading"
        @back="exitTrash"
        @refresh="loadTrash"
        @restore="restoreTrashItem"
        @purge="purgeTrashItem"
        @empty="emptyTrash" />
    </div>

    <AssetUploadQueue
      :items="upload.items.value"
      @retry="upload.retry"
      @clear-finished="upload.clearFinished"
      @dismiss="upload.dismiss" />

    <AssetContextMenu ref="contextMenuRef" :show-detail="canShowDetail" @command="handleMenuCommand" />
    <AssetMoveDialog
      v-model="moveVisible"
      :library="library"
      :directory="directory"
      :entries="moveTargets"
      :initial-target="moveInitialTarget"
      @confirm="confirmMove"
      @error="showMessage" />
    <AssetMetaDialog
      v-model="metaVisible"
      :entry="metaEntry"
      :saving="metaSaving"
      @save="saveMeta" />
    <AssetReferenceDialog
      v-model="referenceVisible"
      :entries="referenceEntries"
      :usages="referenceUsages"
      @confirm="confirmForceDelete" />
    <AssetPreview
      v-model="previewVisible"
      :entry="previewEntry"
      :library="library"
      :directory="directory" />
    <SaveToLibraryDialog
      ref="saveDialogRef"
      :library="library"
      :directory="directory"
      :current-path="currentPath"
      :source-directory="directory"
      allow-library-switch
      @saved="onSavedToLibrary" />

    <input ref="fileInput" class="fileInput" type="file" multiple aria-hidden="true" tabindex="-1" @change="onFilesChosen" />

    <div v-if="fileDragActive" class="fileDropOverlay" aria-hidden="true">
      <icon-upload :size="40" stroke="1.25" />
      <strong>{{ translate("松开即可上传到当前文件夹") }}</strong>
      <span>{{ currentPath || (library === "project" ? translate("本项目素材库根目录") : translate("全局素材库根目录")) }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { ElMessage } from "element-plus";
import { translate } from "@toonflow/i18n/vue";
import { IconUpload } from "@tabler/icons-vue";
import type { NodeOutput } from "@toonflow/nodes-scaffold/values";
import AssetToolbar from "./components/AssetToolbar.vue";
import AssetTreeView from "./components/AssetTreeView.vue";
import AssetGridView from "./components/AssetGridView.vue";
import AssetTrashView from "./components/AssetTrashView.vue";
import AssetContextMenu, { type AssetMenuCommand } from "./components/AssetContextMenu.vue";
import AssetMoveDialog from "./components/AssetMoveDialog.vue";
import AssetMetaDialog from "./components/AssetMetaDialog.vue";
import AssetReferenceDialog from "./components/AssetReferenceDialog.vue";
import AssetPreview from "./components/AssetPreview.vue";
import AssetUploadQueue from "./components/AssetUploadQueue.vue";
import SaveToLibraryDialog from "./components/SaveToLibraryDialog.vue";
import { useAssetLibrary } from "./useAssetLibrary";
import { useAssetActions } from "./useAssetActions";
import { useAssetUpload } from "./useAssetUpload";
import { mockMode } from "./mock";
import type { AssetEntry, AssetSortField, AssetSortOrder, AssetView } from "./types";
import { hasFileDrag } from "./types";

const props = withDefaults(defineProps<{
  directory?: string;
  embedded?: boolean;
  /** 首页分组模式：传入项目列表后，树里出现「项目」分组，展开才按需加载。 */
  projects?: { directory: string; name: string }[];
  /** 宿主是否提供详情视图（首页弹窗有，工作区面板暂没有）。 */
  canShowDetail?: boolean;
}>(), { embedded: false, projects: undefined, canShowDetail: false });
const emit = defineEmits<{
  "select-project": [{ directory: string; path: string }];
  /** 显式请求打开详情（右键菜单 / ⌘I），由宿主决定用抽屉还是别的形态。 */
  "show-detail": [entry: AssetEntry];
}>();

const lib = useAssetLibrary(() => props.directory);

/** 切换项目：先把目标目录的库状态设为「项目库根目录」，再通知父级换 directory。 */
function onSelectProject(payload: { directory: string; path: string }) {
  if (!payload.directory) return;
  lib.store.update({ library: "project", path: payload.path }, payload.directory);
  emit("select-project", { directory: payload.directory, path: payload.path });
}
const {
  entries, loading, loadingMore, nextCursor, displayError: libraryError, query, library, view, sort, order,
  currentPath, selection, selectedEntries, expandedKeys, treeVersion, projectFallback, projectFallbackPath,
  projectAvailable, emptyKind, searchScopeLabel, selector, init, refresh, navigate, goUp, setLibrary, setView,
  setSort, toggleOrder, submitSearch, clearSearch, selectEntry, selectAll, clearSelection, setExpanded, loadMore,
} = lib;
const actions = useAssetActions(lib);
const {
  previewVisible, previewEntry, moveVisible, moveTargets, moveInitialTarget, metaVisible, metaEntry, metaSaving,
  referenceVisible, referenceEntries, referenceUsages, trashVisible, trashItems, trashUsage, trashLoading,
  showMessage, openEntry, createFolder, renameEntryAction, requestMove, confirmMove, deleteEntries,
  confirmForceDelete, toggleFavorite, saveMeta, downloadEntry, moveDraggedEntry, openTrash, loadTrash, exitTrash,
  restoreTrashItem, purgeTrashItem, emptyTrash, emptyTrashFromToolbar,
} = actions;

const rootElement = ref<HTMLElement>();
const fileInput = ref<HTMLInputElement>();
const contextMenuRef = ref<InstanceType<typeof AssetContextMenu>>();
const saveDialogRef = ref<InstanceType<typeof SaveToLibraryDialog>>();

const viewModel = computed<AssetView>({ get: () => view.value, set: setView });
const sortModel = computed<AssetSortField>({ get: () => sort.value, set: value => { if (value !== sort.value) setSort(value); } });
const orderModel = computed<AssetSortOrder>({ get: () => order.value, set: value => { if (value !== order.value) toggleOrder(); } });
const queryModel = computed<string>({ get: () => query.value, set: value => { query.value = value; } });
const hasMore = computed(() => !!nextCursor.value);
const canWrite = computed(() => library.value === "global" || projectAvailable.value);

const upload = useAssetUpload({ selector, onComplete: refresh });
let uploadTarget = "";
let fileDragDepth = 0;
const fileDragActive = ref(false);

onMounted(() => { void init(); });

function focusRoot() {
  rootElement.value?.focus({ preventScroll: true });
}

function onKeydown(event: KeyboardEvent) {
  if (!(event.target instanceof HTMLElement)) return;
  const modifier = event.metaKey || event.ctrlKey;
  // ⌘I：显式打开选中项详情。放在输入框守卫之前，焦点在搜索框时也能用。
  if (modifier && event.key.toLowerCase() === "i") {
    if (trashVisible.value || selectedEntries.value.length !== 1 || !props.canShowDetail) return;
    event.preventDefault();
    event.stopPropagation();
    emit("show-detail", selectedEntries.value[0]!);
    return;
  }
  if (event.target.closest("input, textarea, select, button, a, [contenteditable='true'], .el-input, .el-select")) return;
  if (modifier && event.key.toLowerCase() === "a") {
    if (trashVisible.value) return;
    event.preventDefault();
    event.stopPropagation();
    selectAll();
    return;
  }
  if (event.key === "Escape") {
    contextMenuRef.value?.closeMenu();
    if (trashVisible.value) {
      event.preventDefault();
      event.stopPropagation();
      exitTrash();
      return;
    }
    if (selection.value.size) {
      event.preventDefault();
      event.stopPropagation();
      clearSelection();
    }
    // 未处理时交给面板外壳执行尺寸复位。
    return;
  }
  if (event.key === "Backspace") {
    if (trashVisible.value) {
      event.preventDefault();
      event.stopPropagation();
      exitTrash();
    } else if (currentPath.value) {
      event.preventDefault();
      event.stopPropagation();
      goUp();
    }
    return;
  }
  if (trashVisible.value) return;
  if (event.key === "Delete") {
    if (!selectedEntries.value.length) return;
    event.preventDefault();
    event.stopPropagation();
    void deleteEntries(selectedEntries.value);
    return;
  }
  if (event.key === "F2" || event.key === "Enter") {
    if (selectedEntries.value.length !== 1) return;
    event.preventDefault();
    event.stopPropagation();
    void renameEntryAction(selectedEntries.value[0]!);
  }
}

function onRootDragEnter(event: DragEvent) {
  if (!hasFileDrag(event)) return;
  fileDragDepth++;
  fileDragActive.value = true;
}

function onRootDragOver(event: DragEvent) {
  if (!hasFileDrag(event)) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
}

function onRootDragLeave() {
  if (!fileDragActive.value) return;
  fileDragDepth = Math.max(0, fileDragDepth - 1);
  if (!fileDragDepth) fileDragActive.value = false;
}

function onRootDrop(event: DragEvent) {
  if (!hasFileDrag(event)) return;
  event.preventDefault();
  fileDragDepth = 0;
  fileDragActive.value = false;
  const files = Array.from(event.dataTransfer?.files ?? []);
  if (files.length) upload.addFiles(files, currentPath.value);
}

function chooseUpload(targetPath = currentPath.value) {
  uploadTarget = targetPath;
  fileInput.value?.click();
}

function onFilesChosen(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  if (files.length) upload.addFiles(files, uploadTarget || currentPath.value);
  input.value = "";
}

function onUploadDrop(files: File[], targetPath: string) {
  fileDragDepth = 0;
  fileDragActive.value = false;
  if (files.length) upload.addFiles(files, targetPath);
}

function showEntryMenu(event: MouseEvent, entry: AssetEntry) {
  if (!entry.path) {
    // 库根节点只提供“新建文件夹 / 上传到此”，避免误删或重命名整个库。
    contextMenuRef.value?.openMenu(event, entry, true);
    return;
  }
  if (!selection.value.has(entry.path)) selectEntry(entry, "single");
  contextMenuRef.value?.openMenu(event, entry);
}

function showBackgroundMenu(event: MouseEvent) {
  const name = currentPath.value.split("/").at(-1) || (library.value === "project" ? translate("本项目") : translate("全局"));
  contextMenuRef.value?.openMenu(event, {
    name, path: currentPath.value, type: "directory", category: "directory", size: 0, mtimeMs: 0,
    tags: [], note: "", favorite: false,
  }, true);
}

async function handleMenuCommand(command: AssetMenuCommand, entry: AssetEntry) {
  contextMenuRef.value?.closeMenu();
  if (command === "open") return openEntry(entry);
  if (command === "detail") {
    emit("show-detail", entry);
    return;
  }
  if (command === "move") return requestMove([entry]);
  if (command === "new-subfolder") return createFolder(entry.path);
  if (command === "upload-here") return chooseUpload(entry.path);
  if (command === "meta") {
    metaEntry.value = entry;
    metaVisible.value = true;
    return;
  }
  if (command === "favorite") {
    await toggleFavorite(entry);
    return;
  }
  if (command === "download") {
    await downloadEntry(entry);
    return;
  }
  if (command === "rename") {
    await renameEntryAction(entry);
    return;
  }
  if (command === "delete") {
    await deleteEntries([entry]);
  }
}

function clearSearchNow() {
  query.value = "";
  clearSearch();
  void lib.loadList(true);
}

/** 管理页的标签筛选复用工具栏搜索，避免维护第二套过滤状态。 */
function setSearchQuery(value: string) {
  query.value = value;
  submitSearch();
}

function openMeta(entry: AssetEntry) {
  metaEntry.value = entry;
  metaVisible.value = true;
}

function onSavedToLibrary(path: string) {
  ElMessage.success(translate("已保存到 {path}", { path }));
  void refresh();
  treeVersion.value++;
}

function openSave(label: string, outputs: { label: string; output: NodeOutput }[]) {
  saveDialogRef.value?.open(label, outputs);
}

defineExpose({
  openSave, refresh, navigate, focusRoot,
  // 首页素材库页面需要的只读句柄：选中项、当前库/目录、搜索联动与元数据操作。
  selectedEntries, entries, query, library, currentPath, selector,
  setSearchQuery, toggleFavorite, openMeta, clearSelection,
});
</script>

<style scoped lang="scss">
.assetLibraryContent {
  position: relative;
  display: flex;
  flex: 1;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--el-bg-color-overlay);
  outline: none;

  .libraryNotice { flex-shrink: 0; margin: 0; border-radius: 0; }

  .libraryBody {
    display: flex;
    flex: 1;
    min-width: 0;
    min-height: 0;
  }

  .fileInput {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    opacity: 0;
    pointer-events: none;
  }

  .fileDropOverlay {
    position: absolute;
    inset: 6px;
    z-index: 10;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    border: 2px dashed var(--el-color-primary);
    border-radius: var(--ui-radius-large, 12px);
    color: var(--el-color-primary);
    background: color-mix(in srgb, var(--el-bg-color-overlay) 88%, transparent);
    pointer-events: none;

    strong { font-size: 14px; }
    span { max-width: 80%; overflow: hidden; color: var(--el-text-color-secondary); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
  }
}
</style>
