<template>
  <aside
    class="assetTreeView"
    :aria-label="translate('素材目录树')"
    @dragover="onBlankDragOver"
    @dragleave="onBlankDragLeave"
    @drop="onBlankDrop">
    <el-tree
      ref="treeRef"
      :key="refreshKey"
      class="assetTree"
      node-key="id"
      lazy
      :load="loadNode"
      :props="treeProps"
      :default-expanded-keys="defaultExpandedKeys"
      :current-node-key="currentKey"
      highlight-current
      :expand-on-click-node="false"
      :indent="12"
      empty-text=""
      @node-click="onNodeClick"
      @node-expand="onNodeExpand"
      @node-collapse="onNodeCollapse"
      @node-contextmenu="onNodeContextMenu">
      <template #default="{ data, node }">
        <span
          class="treeRow"
          :class="{ rootNode: data.root, dropTarget: dropTargetKey === data.id, favorite: data.favorite }"
          :draggable="!data.root && data.type === 'directory'"
          :title="data.root ? data.name : data.path"
          @dragstart.stop="onDragStart($event, data)"
          @dragend.stop="onDragEnd"
          @dragover="onNodeDragOver($event, data)"
          @dragleave="onNodeDragLeave($event, data)"
          @drop="onNodeDrop($event, data)"
          @dblclick.stop="onNodeDoubleClick(data)">
          <component :is="node.expanded && !node.isLeaf ? IconFolderOpen : IconFolder" class="folderIcon" :size="16" aria-hidden="true" />
          <span class="nodeName">{{ data.name }}</span>
          <icon-star-filled v-if="data.favorite && !data.root" class="star" :size="12" :title="translate('已收藏')" aria-hidden="true" />
          <span v-if="typeof data.childCount === 'number' && !data.root" class="childCount">{{ data.childCount }}</span>
        </span>
      </template>
    </el-tree>
  </aside>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import { translate } from "@toonflow/i18n/vue";
import type { LoadFunction, TreeInstance, TreeNodeData } from "element-plus";
import { IconFolder, IconFolderOpen, IconStarFilled } from "@tabler/icons-vue";
import { getTree, toAssetError } from "../api";
import { activeAssetDrag, canDropInto, clearAssetDrag, hasInternalDrag, readInternalDrag, setInternalDrag } from "../types";
import type { AssetDragPayload, AssetEntry, AssetLibraryKind, AssetTreeNode } from "../types";

const props = withDefaults(defineProps<{
  library: AssetLibraryKind;
  directory?: string;
  currentPath: string;
  expandedKeys: string[];
  refreshKey?: number;
}>(), { refreshKey: 0 });
const emit = defineEmits<{
  navigate: [path: string];
  "select-library": [library: AssetLibraryKind];
  menu: [event: MouseEvent, entry: AssetEntry];
  move: [payload: AssetDragPayload, targetPath: string];
  expanded: [keys: string[]];
  error: [message: string];
}>();

const treeRef = ref<TreeInstance>();
const dropTargetKey = ref<string>();
const treeProps = {
  label: "name",
  isLeaf: (data: TreeNodeData) => (data as AssetTreeNode).type === "file",
};
const currentKey = ref("");
let expanded = new Set<string>(props.expandedKeys);

const defaultExpandedKeys = ref<string[]>([...new Set(["root:project", "root:global", ...props.expandedKeys])]);

function rootNodes(): AssetTreeNode[] {
  const roots: AssetTreeNode[] = [];
  if (props.directory) roots.push({ id: "root:project", library: "project", path: "", name: translate("本项目"), type: "directory", category: "directory", size: 0, mtimeMs: 0, tags: [], note: "", favorite: false, isLeaf: false, root: true });
  roots.push({ id: "root:global", library: "global", path: "", name: translate("全局"), type: "directory", category: "directory", size: 0, mtimeMs: 0, tags: [], note: "", favorite: false, isLeaf: false, root: true });
  return roots;
}

function toTreeNode(entry: AssetEntry, library: AssetLibraryKind): AssetTreeNode {
  return {
    ...entry,
    id: `${library}:${entry.path}`,
    library,
    isLeaf: entry.type === "file",
    ...(entry.type === "directory" ? { childCount: entry.childCount ?? 0 } : {}),
  };
}

const loadNode: LoadFunction = async (node, resolve) => {
  if (node.level === 0) {
    resolve(rootNodes() as unknown as TreeNodeData[]);
    void nextTick(syncCurrentKey);
    return;
  }
  const data = node.data as AssetTreeNode;
  if (!data || data.type !== "directory") {
    resolve([]);
    return;
  }
  try {
    const result = await getTree({ library: data.library, directory: props.directory }, data.root ? "" : data.path);
    // 目录树只渲染目录，文件统一放在右侧网格，避免大树生成上千个节点。
    resolve(result.items.filter(entry => entry.type === "directory").map(entry => toTreeNode(entry, data.library)) as unknown as TreeNodeData[]);
  } catch (cause) {
    emit("error", toAssetError(cause).message);
    resolve([]);
  }
};

function nodeKey(data: AssetTreeNode) {
  return data.root ? `root:${data.library}` : `${data.library}:${data.path}`;
}

function syncCurrentKey() {
  currentKey.value = props.currentPath ? `${props.library}:${props.currentPath}` : `root:${props.library}`;
  void nextTick(() => treeRef.value?.setCurrentKey(currentKey.value));
}

function onNodeClick(data: AssetTreeNode) {
  if (data.root) {
    if (data.library !== props.library) emit("select-library", data.library);
    emit("navigate", "");
    return;
  }
  if (data.type === "directory") emit("navigate", data.path);
}

function onNodeDoubleClick(data: AssetTreeNode) {
  if (data.root) return;
  emit("navigate", data.path);
}

function onNodeExpand(data: AssetTreeNode) {
  expanded.add(nodeKey(data));
  emit("expanded", [...expanded]);
}

function onNodeCollapse(data: AssetTreeNode) {
  const key = nodeKey(data);
  expanded = new Set([...expanded].filter(item => item !== key && !item.startsWith(`${key}/`)));
  emit("expanded", [...expanded]);
}

function onNodeContextMenu(event: Event, data: AssetTreeNode) {
  event.preventDefault();
  event.stopPropagation();
  const mouseEvent = event as MouseEvent;
  if (data.root) {
    if (data.library !== props.library) emit("select-library", data.library);
    emit("menu", mouseEvent, { name: data.name, path: "", type: "directory", category: "directory", size: 0, mtimeMs: 0, tags: [], note: "", favorite: false });
    return;
  }
  const { id: _id, library: _library, isLeaf: _isLeaf, root: _root, ...entry } = data;
  emit("menu", mouseEvent, entry);
}

function onBlankDragOver(event: DragEvent) {
  if (!hasInternalDrag(event)) return;
  if (event.target instanceof Element && event.target.closest(".treeRow")) return;
  const payload = activeAssetDrag.value;
  if (!payload || !canDropInto(payload, { library: props.library, path: "" }, "root")) {
    dropTargetKey.value = undefined;
    return;
  }
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  dropTargetKey.value = `root:${props.library}`;
}

function onBlankDragLeave(event: DragEvent) {
  const related = event.relatedTarget;
  if (related instanceof Node && (event.currentTarget as HTMLElement).contains(related)) return;
  dropTargetKey.value = undefined;
}

function onBlankDrop(event: DragEvent) {
  const target = event.target;
  if (target instanceof Element && target.closest(".treeRow")) return;
  dropTargetKey.value = undefined;
  const payload = readInternalDrag(event);
  clearAssetDrag();
  if (!payload || !payload.path) return;
  event.preventDefault();
  event.stopPropagation();
  if (!canDropInto(payload, { library: props.library, path: "" }, "root")) {
    if (payload.library !== props.library) emit("error", translate("请用收藏复制到另一个素材库，素材库之间不支持直接移动"));
    return;
  }
  emit("move", payload, "");
}

function parentOf(path: string) {
  return path.split("/").slice(0, -1).join("/");
}

function onDragStart(event: DragEvent, data: AssetTreeNode) {
  if (data.root || data.type !== "directory") return;
  setInternalDrag(event, { library: data.library, path: data.path, name: data.name, type: "directory" });
}

function onDragEnd() {
  dropTargetKey.value = undefined;
  clearAssetDrag();
}

function acceptsDrop(data: AssetTreeNode) {
  return data.type === "directory";
}

function canDropHere(data: AssetTreeNode) {
  const payload = activeAssetDrag.value;
  if (!payload) return false;
  return canDropInto(payload, { library: data.library, path: data.root ? "" : data.path }, data.root ? "root" : "directory");
}

function onNodeDragOver(event: DragEvent, data: AssetTreeNode) {
  if (!acceptsDrop(data) || !hasInternalDrag(event)) return;
  if (!canDropHere(data)) {
    dropTargetKey.value = undefined;
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  dropTargetKey.value = data.id;
}

function onNodeDragLeave(event: DragEvent, data: AssetTreeNode) {
  if (dropTargetKey.value !== data.id) return;
  const related = event.relatedTarget;
  if (related instanceof Node && (event.currentTarget as HTMLElement).contains(related)) return;
  dropTargetKey.value = undefined;
}

function onNodeDrop(event: DragEvent, data: AssetTreeNode) {
  dropTargetKey.value = undefined;
  if (!acceptsDrop(data)) return;
  const payload = readInternalDrag(event);
  clearAssetDrag();
  if (!payload) return;
  event.preventDefault();
  event.stopPropagation();
  const targetPath = data.root ? "" : data.path;
  if (payload.library !== data.library) {
    emit("error", translate("请用收藏复制到另一个素材库，素材库之间不支持直接移动"));
    return;
  }
  if (!canDropInto(payload, { library: data.library, path: targetPath }, data.root ? "root" : "directory")) {
    emit("error", translate("不能把文件夹移动到自身或它的子文件夹"));
    return;
  }
  emit("move", payload, targetPath);
}

watch(() => props.currentPath, syncCurrentKey, { immediate: false });
watch(() => props.library, () => { syncCurrentKey(); }, { immediate: false });
watch(() => props.expandedKeys, keys => {
  expanded = new Set(keys);
  defaultExpandedKeys.value = [...new Set(["root:project", "root:global", ...keys])];
}, { deep: true });
watch(() => props.refreshKey, () => { syncCurrentKey(); }, { flush: "post" });
syncCurrentKey();
</script>

<style scoped lang="scss">
.assetTreeView {
  display: flex;
  flex: 0 0 172px;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  padding: 4px 4px 8px 0;
  border-right: 1px solid var(--el-border-color-lighter);
  overscroll-behavior: contain;

  .assetTree {
    flex: 1;
    min-height: 0;
    background: transparent;
    --el-tree-node-hover-bg-color: var(--el-fill-color-light);

    :deep(.el-tree-node__content) {
      height: 30px;
      border-radius: var(--el-border-radius-base);
    }

    :deep(.el-tree-node.is-current > .el-tree-node__content) {
      color: var(--el-color-primary);
      background: var(--el-color-primary-light-9);
    }

    .treeRow {
      display: flex;
      flex: 1;
      align-items: center;
      gap: 6px;
      min-width: 0;
      padding-right: 8px;
      font-size: 12px;

      &[draggable="true"] { cursor: grab; }
      &.rootNode { color: var(--el-text-color-primary); font-weight: 600; }
      &.dropTarget {
        border-radius: var(--el-border-radius-base);
        outline: 1px solid var(--el-color-primary);
        outline-offset: -1px;
        background: var(--el-color-primary-light-9);
      }

      .folderIcon { flex-shrink: 0; color: var(--el-text-color-secondary); }
      .nodeName { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .star { flex-shrink: 0; color: var(--el-color-warning); }
      .childCount {
        flex-shrink: 0;
        color: var(--el-text-color-placeholder);
        font-size: 10px;
        font-variant-numeric: tabular-nums;
      }
    }
  }
}
</style>
