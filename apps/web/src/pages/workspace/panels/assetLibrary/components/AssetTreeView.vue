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
          :class="{ rootNode: data.root, groupNode: data.group, foreignNode: data.projectRoot || isOtherProject(data), dropTarget: dropTargetKey === data.id, favorite: data.favorite }"
          :draggable="!data.root && !data.projectRoot && !data.group && !isForeign(data) && data.type === 'directory'"
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
          <span v-if="typeof data.childCount === 'number' && !data.root" class="childCount">{{ displayChildCount(data) }}</span>
        </span>
      </template>
    </el-tree>
  </aside>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { translate } from "@toonflow/i18n/vue";
import type { LoadFunction, TreeInstance, TreeNodeData } from "element-plus";
import { IconFolder, IconFolderOpen, IconStarFilled } from "@tabler/icons-vue";
import { getTree, toAssetError } from "../api";
import { isTransientAssetFailure } from "../useAssetLibrary";
import { activeAssetDrag, canDropInto, clearAssetDrag, hasInternalDrag, readInternalDrag, setInternalDrag } from "../types";
import type { AssetDragPayload, AssetEntry, AssetLibraryKind, AssetTreeNode } from "../types";

const props = withDefaults(defineProps<{
  library: AssetLibraryKind;
  directory?: string;
  /** 首页分组模式：传入项目列表后，树根改为「项目（分组）+ 全局」，展开项目才按需加载。 */
  projects?: { directory: string; name: string }[];
  activeDirectory?: string;
  currentPath: string;
  expandedKeys: string[];
  refreshKey?: number;
  /** 上传等「只增内容」操作按目录累加的条目数，树不重建也能让「N 项」保持实时。 */
  countExtra?: Record<string, number>;
}>(), { refreshKey: 0, projects: undefined, activeDirectory: "", countExtra: () => ({}) });
const emit = defineEmits<{
  navigate: [path: string];
  "select-library": [library: AssetLibraryKind, path?: string];
  "select-project": [payload: { directory: string; name: string; path: string }];
  menu: [event: MouseEvent, entry: AssetEntry];
  move: [payload: AssetDragPayload, targetPath: string];
  expanded: [keys: string[]];
  error: [message: string];
}>();

const treeRef = ref<TreeInstance>();

function displayChildCount(data: { id?: string; childCount?: number }) {
  // ACT: 用节点身份（library:path / library:directory:path）取增量，避免同名目录跨库串计数。
  const extra = data.id ? (props.countExtra[data.id] ?? 0) : 0;
  return (data.childCount ?? 0) + extra;
}
const dropTargetKey = ref<string>();
const treeProps = {
  label: "name",
  isLeaf: (data: TreeNodeData) => (data as AssetTreeNode).type === "file",
};
const currentKey = ref("");
let expanded = new Set<string>(props.expandedKeys);

const grouped = computed(() => props.projects !== undefined);
const GROUPS_ROOT = "root:projects";
// grouped 模式下把分组展开状态放在本地，避免被"按项目分桶"的 expanded 打散。
const localExpanded = ref<string[]>(grouped.value ? [GROUPS_ROOT] : []);
// ACT: 分组模式下也要恢复已展开的目录，否则每次切库重建树都会把它折叠回去（看起来像闪了一下）。
const defaultExpandedKeys = computed(() => grouped.value
  ? [...new Set([GROUPS_ROOT, ...localExpanded.value, ...props.expandedKeys])]
  : [...new Set(["root:project", "root:global", ...props.expandedKeys])]);

function rootNodes(): AssetTreeNode[] {
  const roots: AssetTreeNode[] = [];
  if (!grouped.value && props.directory) roots.push({ id: "root:project", library: "project", path: "", name: translate("本项目"), type: "directory", category: "directory", size: 0, mtimeMs: 0, tags: [], note: "", favorite: false, isLeaf: false, root: true });
  if (grouped.value) roots.push({ id: GROUPS_ROOT, library: "project", path: "", name: translate("项目"), type: "directory", category: "directory", size: 0, mtimeMs: 0, tags: [], note: "", favorite: false, isLeaf: false, root: true, group: true });
  roots.push({ id: "root:global", library: "global", path: "", name: translate("全局"), type: "directory", category: "directory", size: 0, mtimeMs: 0, tags: [], note: "", favorite: false, isLeaf: false, root: true });
  return roots;
}

/** 节点身份：项目库的节点必须带项目目录，全局库一律不带，否则同名目录会撞 key。 */
function nodeIdentity(library: AssetLibraryKind, directory: string | undefined, path: string) {
  return grouped.value && library === "project" && directory ? `${library}:${directory}:${path}` : `${library}:${path}`;
}

function toTreeNode(entry: AssetEntry, library: AssetLibraryKind, directory?: string): AssetTreeNode {
  return {
    ...entry,
    id: nodeIdentity(library, directory, entry.path),
    library,
    ...(directory ? { directory } : {}),
    isLeaf: entry.type === "file",
    ...(entry.type === "directory" ? { childCount: entry.childCount ?? 0 } : {}),
  };
}

function projectNodes(): AssetTreeNode[] {
  return (props.projects ?? []).map(project => ({
    id: `project:${project.directory}`,
    library: "project",
    directory: project.directory,
    path: "",
    name: project.name,
    type: "directory",
    category: "directory",
    size: 0,
    mtimeMs: 0,
    tags: [],
    note: "",
    favorite: false,
    isLeaf: false,
    projectRoot: true,
  }));
}

/** 同一目录的读取：只有项目库才带 directory，全局库不允许携带当前项目目录。 */
function nodeDirectory(data: AssetTreeNode) {
  if (data.library === "global") return undefined;
  return data.directory ?? props.activeDirectory ?? props.directory;
}

/** 不能在当前上下文直接操作的节点：另一个库，或同一库下的另一个项目。 */
function isForeign(data: AssetTreeNode) {
  if (data.library !== props.library) return true;
  if (!grouped.value) return false;
  const directory = data.directory;
  return !!directory && directory !== props.activeDirectory;
}

/** 同库跨项目：点击需要先切项目；跨库节点不灰显，点击直接切库。 */
function isOtherProject(data: AssetTreeNode) {
  return data.library === props.library && isForeign(data);
}

const loadNode: LoadFunction = async (node, resolve) => {
  if (node.level === 0) {
    resolve(rootNodes() as unknown as TreeNodeData[]);
    void nextTick(syncCurrentKey);
    return;
  }
  const data = node.data as AssetTreeNode;
  if (data.group) {
    resolve(projectNodes() as unknown as TreeNodeData[]);
    return;
  }
  if (!data || data.type !== "directory") {
    resolve([]);
    return;
  }
  const directory = nodeDirectory(data);
  const relativePath = data.projectRoot || data.root ? "" : data.path;
  // ACT: 首次打开项目时库根可能刚被创建，失败一次自动重试再报错。
  for (let attempt = 0; ; attempt++) {
    try {
      const result = await getTree({ library: data.library, directory }, relativePath);
      // 目录树只渲染目录，文件统一放在右侧网格，避免大树生成上千个节点。
      resolve(result.items.filter(entry => entry.type === "directory").map(entry => toTreeNode(entry, data.library, directory)) as unknown as TreeNodeData[]);
      return;
    } catch (cause) {
      if (attempt === 0 && isTransientAssetFailure(cause)) {
        await new Promise(done => setTimeout(done, 300));
        continue;
      }
      emit("error", toAssetError(cause).message);
      resolve([]);
      return;
    }
  }
};

function nodeKey(data: AssetTreeNode) {
  if (data.group) return GROUPS_ROOT;
  if (data.root) return `root:${data.library}`;
  return nodeIdentity(data.library, data.directory, data.path);
}

function syncCurrentKey() {
  const directory = props.library === "project" ? props.activeDirectory : undefined;
  if (!props.currentPath) {
    // 分组模式下"项目库根"由项目节点代表，直接高亮它而不是一个不存在的 root key。
    currentKey.value = grouped.value && props.library === "project" && props.activeDirectory
      ? `project:${props.activeDirectory}`
      : `root:${props.library}`;
  } else {
    currentKey.value = nodeIdentity(props.library, directory, props.currentPath);
  }
  void nextTick(() => treeRef.value?.setCurrentKey(currentKey.value));
}

function onNodeClick(data: AssetTreeNode) {
  // 分组节点本身不是一个路径：点击等同展开/收起，否则删掉顶部下拉后它是唯一的项目入口却点不动。
  if (data.group) {
    const node = treeRef.value?.getNode(GROUPS_ROOT);
    if (!node) return;
    if (node.expanded) node.collapse();
    else node.expand();
    return;
  }
  if (data.projectRoot && data.directory) {
    emit("select-project", { directory: data.directory, name: data.name, path: "" });
    return;
  }
  if (data.root) {
    if (data.library !== props.library) emit("select-library", data.library, "");
    else emit("navigate", "");
    return;
  }
  if (data.type !== "directory") return;
  // ACT: 跨库节点必须切库，否则会拿当前库的根去访问另一个库的路径（表现为"点了全局还是空"）。
  if (data.library !== props.library) {
    emit("select-library", data.library, data.path);
    return;
  }
  if (isOtherProject(data) && data.directory) {
    emit("select-project", { directory: data.directory, name: data.name, path: data.path });
    return;
  }
  emit("navigate", data.path);
}

function onNodeDoubleClick(data: AssetTreeNode) {
  if (data.root || data.group) return;
  if (data.library !== props.library) {
    emit("select-library", data.library, data.path);
    return;
  }
  if (isOtherProject(data) && data.directory) {
    emit("select-project", { directory: data.directory, name: data.name, path: data.path });
    return;
  }
  emit("navigate", data.path);
}

function onNodeExpand(data: AssetTreeNode) {
  const key = nodeKey(data);
  if (grouped.value) {
    localExpanded.value = [...new Set([...localExpanded.value, key])];
    return;
  }
  expanded.add(key);
  emit("expanded", [...expanded]);
}

function onNodeCollapse(data: AssetTreeNode) {
  const key = nodeKey(data);
  if (grouped.value) {
    localExpanded.value = localExpanded.value.filter(item => item !== key && !item.startsWith(`${key}/`));
    return;
  }
  expanded = new Set([...expanded].filter(item => item !== key && !item.startsWith(`${key}/`)));
  emit("expanded", [...expanded]);
}

function onNodeContextMenu(event: Event, data: AssetTreeNode) {
  event.preventDefault();
  event.stopPropagation();
  const mouseEvent = event as MouseEvent;
  // ACT: 跨项目节点不能用当前项目的 selector 执行删除/重命名，直接屏蔽上下文菜单。
  if (data.group || data.projectRoot || isForeign(data)) return;
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
  if (grouped.value && (props.library !== "project" || !props.activeDirectory)) return;
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
  if (data.group || data.projectRoot || isForeign(data)) return false;
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
  if (grouped.value) return;
  expanded = new Set(keys);
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
