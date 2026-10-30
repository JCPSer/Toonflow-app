<template>
  <panel class="canvasMenuPanel" position="top-left">
    <el-card class="canvasMenu" shadow="never" :bodyStyle="{ padding: '2px 4px' }">
      <div class="menuContent">
        <el-input v-model="projectNameDraft" class="workspaceNameInput" :style="{ '--workspaceName': JSON.stringify(projectNameDraft || ' ') }" size="small" :title="directory" :disabled="!workspaceStore.project || switching" aria-label="项目名称"
          @keydown.stop @keydown.enter="saveProjectName" @keydown.esc.prevent="projectNameDraft = workspaceName" @blur="saveProjectName" />
        <el-popover v-model:visible="projectListVisible" trigger="click" placement="bottom-start" :width="320" :showArrow="false" :disabled="!workspaceStore.project">
          <template #reference>
            <el-button class="projectTrigger" text :loading="switching" :disabled="switching || !workspaceStore.project" aria-label="切换项目" :aria-expanded="projectListVisible" title="切换项目">
              <component :is="projectListVisible ? IconChevronUp : IconChevronDown" :size="14" aria-hidden="true" />
            </el-button>
          </template>
          <div class="projectPicker" @keydown.esc="projectListVisible = false">
            <el-input v-model="projectQuery" :prefixIcon="IconSearch" placeholder="搜索项目" aria-label="搜索项目" clearable @keydown.esc.stop="projectQuery = ''" />
            <el-scrollbar maxHeight="min(360px, calc(100dvh - 198px))">
              <el-button v-for="item in filteredProjects" :key="item.directory" class="projectEntry" text :title="item.directory" :aria-current="item.directory === workspaceStore.project?.directory" @click="chooseProject(item)">
                <span class="projectEntryText">
                  <span class="projectEntryName">{{ item.name }}</span>
                  <span class="projectEntryPath">{{ item.directory }}</span>
                </span>
                <icon-check v-if="item.directory === workspaceStore.project?.directory" :size="16" aria-hidden="true" />
              </el-button>
              <el-text v-if="!filteredProjects.length" class="projectEmpty" type="info">没有匹配的项目</el-text>
            </el-scrollbar>
          </div>
        </el-popover>
        <el-divider direction="vertical" />
        <el-popover v-model:visible="canvasListVisible" trigger="click" placement="bottom-start" :width="320" :showArrow="false" :disabled="!directory">
          <template #reference>
            <el-button class="canvasTrigger" text :loading="busy" :disabled="busy || switching || !directory" aria-label="切换画布" :aria-expanded="canvasListVisible">
              <span>{{ activeCanvasName }}</span><component :is="canvasListVisible ? IconChevronUp : IconChevronDown" :size="14" aria-hidden="true" />
            </el-button>
          </template>
          <div ref="canvasPicker" class="canvasPicker" @keydown.esc="canvasListVisible = false">
            <div class="pickerToolbar">
              <el-input v-model="searchQuery" :prefixIcon="IconSearch" placeholder="搜索画布" aria-label="搜索画布" clearable @keydown.esc.stop="searchQuery = ''" />
              <el-button class="iconButton" text :icon="IconFolderPlus" :disabled="pickerBusy || editingId !== null || folderDraft !== null" title="新建文件夹" aria-label="新建画布文件夹" @click="startFolder" />
              <el-button class="iconButton" text :icon="IconPlus" :disabled="pickerBusy || editingId !== null || folderDraft !== null" title="新增画布" aria-label="新增画布" @click="handleAddCanvas" />
            </div>
            <el-scrollbar v-loading="loadingTree" maxHeight="min(440px, calc(100dvh - 198px))">
              <el-tree v-if="canvasListVisible" ref="canvasTree" class="canvasTree" :data="treeEntries" nodeKey="path" :props="{ label: 'name', isLeaf: entry => entry.type === 'file' || entry.draft || entry.empty === true }" lazy :load="loadTreeNode" :defaultExpandedKeys="expandedFolders" :autoExpandParent="false" :icon="IconChevronRight" :currentNodeKey="activeCanvasId" :filterNodeMethod="filterEntry" highlightCurrent emptyText="" @nodeClick="selectEntry" @nodeExpand="expandFolder" @nodeCollapse="collapseFolder">
                <template #default="{ data, node }">
                  <div class="canvasEntry" :title="data.path" @contextmenu="openItemMenu($event, data)">
                    <component v-if="data.type === 'directory'" :is="node.expanded && !node.isLeaf ? IconFolderOpen : IconFolder" class="folderIcon" :size="18" aria-hidden="true" />
                    <icon-vector v-else class="canvasIcon" :size="18" />
                    <el-input v-if="data.draft" ref="folderInput" v-model="folderDraft" class="nameEditor" size="small" aria-label="文件夹名称" :disabled="busy" :maxlength="120" @click.stop @keydown.stop @keydown.enter.prevent="saveFolder" @keydown.esc.prevent="cancelFolder" @blur="saveFolder" />
                    <el-input v-else-if="editingId === data.path" ref="nameInput" v-model="canvasName" class="nameEditor" size="small" :disabled="busy" :maxlength="120" :aria-label="newCanvasId === data.path ? '新画布名称' : '画布名称'" @click.stop @keydown.stop @keydown.enter="saveCanvas" @keydown.esc.prevent="finishEdit" @blur="saveCanvas" />
                    <span v-else class="entryName">{{ data.name }}</span>
                    <icon-check v-if="activeCanvasId === data.path" class="selectedIcon" :size="16" aria-hidden="true" />
                    <el-button v-if="!data.draft && editingId !== data.path" class="moreButton" text :icon="IconDots" :disabled="pickerBusy || editingId !== null || folderDraft !== null" :aria-label="'更多 ' + data.name" title="更多" @click.stop="openItemMenu($event, data)" />
                  </div>
                </template>
              </el-tree>
            </el-scrollbar>
            <el-text v-if="renameError" type="danger" role="alert">{{ renameError }}</el-text>
          </div>
        </el-popover>
      </div>
    </el-card>
    <div class="menuExtension"><slot /></div>
  </panel>
  <panel v-if="visibleProviderBalances.length" class="balanceMenuPanel" position="top-right">
    <div class="balanceList" tabindex="0" aria-label="供应商余额">
      <el-card v-for="item in visibleProviderBalances" :key="item.id" class="balanceCard" shadow="never" :bodyStyle="{ padding: '2px 4px' }">
        <el-popover v-if="item.id === 'tfRouter'" :visible="balanceVisible" @update:visible="value => { if (!rechargeVisible) balanceVisible = value; }" trigger="click" placement="bottom-end" :width="360" :showArrow="false">
          <template #reference>
            <el-button class="balanceTrigger" text :aria-busy="item.loading" :title="item.error || 'TF-Router 剩余可用余额'" aria-label="TF-Router 余额与充值">
              <span class="providerLabel">{{ item.label }}</span>
              <span>{{ item.balance ? `${balanceFormat.format(Math.min(item.balance.balance, item.balance.keyBalance ?? Infinity))} ${item.balance.unit}` : '—' }}</span>
            </el-button>
          </template>
          <tfAccount v-if="balanceVisible" :apiKey="tfBalanceApiKey" :visible="balanceVisible" :saveApiKey="saveTfMediaApiKey" @rechargeVisibleChange="rechargeVisible = $event" />
        </el-popover>
        <el-button v-else class="balanceTrigger" text :loading="item.loading" :title="item.error || `点击刷新 ${item.label} 余额`" :aria-label="`刷新 ${item.label} 余额`" @click="refreshProviderBalance(item.id)">
          <span class="providerLabel">{{ item.label }}</span>
          <span>{{ item.balance ? `${balanceFormat.format(Math.min(item.balance.balance, item.balance.keyBalance ?? Infinity))} ${item.balance.unit}` : '—' }}</span>
        </el-button>
      </el-card>
    </div>
  </panel>
  <el-dropdown ref="itemMenu" trigger="contextmenu" virtualTriggering :virtualRef="menuAnchor" placement="bottom-start" :showArrow="false" :hideOnClick="false" :appendTo="canvasPicker" popperClass="canvasActionMenu" @command="handleItemCommand" @visibleChange="(opened: boolean) => { if (!opened) moveVisible = false; }">
    <template #dropdown>
      <el-dropdown-menu v-if="menuEntry">
        <el-dropdown-item command="move" :disabled="pickerBusy">
          <el-popover v-model:visible="moveVisible" trigger="hover" placement="right-start" :width="220" :offset="0" :showArrow="false" :showAfter="0" :hideAfter="150" :appendTo="canvasPicker">
            <template #reference><span class="moveTrigger"><span class="moveLabel">移动到</span><icon-chevron-right :size="14" /></span></template>
            <div class="moveDestinations" role="menu" aria-label="移动到目录" @click.stop @keydown.stop>
              <el-button text :icon="IconFolderPlus" :disabled="pickerBusy" role="menuitem" @click="createMoveFolder">新建文件夹</el-button>
              <el-scrollbar maxHeight="260px">
                <el-button v-for="folder in moveFolders" :key="folder.path" text :icon="IconFolder" :disabled="pickerBusy || destinationDisabled(folder.path)" role="menuitem" :title="folder.label" @click="moveEntry(folder.path)">{{ folder.label }}</el-button>
              </el-scrollbar>
            </div>
          </el-popover>
        </el-dropdown-item>
        <el-dropdown-item command="rename" :disabled="pickerBusy">重命名</el-dropdown-item>
        <el-dropdown-item class="deleteAction" command="delete" :disabled="pickerBusy || (menuEntry.type === 'directory' && !menuEntry.empty)" :title="menuEntry.type === 'directory' && !menuEntry.empty ? '请先移出或删除文件夹内的内容' : undefined">删除</el-dropdown-item>
      </el-dropdown-menu>
    </template>
  </el-dropdown>
</template>

<script setup lang="ts">
import axios from "axios";
import { locale, translate } from "@toonflow/i18n/vue";
import { computed, inject, nextTick, onBeforeUnmount, ref, shallowRef, watch, type ShallowRef } from "vue";
import { Panel, useVueFlow, type FlowExportObject } from "@vue-flow/core";
import { ElMessage, ElMessageBox, type DropdownInstance, type FilterNodeMethodFunction, type InputInstance, type LoadFunction, type TreeInstance } from "element-plus";
import { IconVector, IconCheck, IconChevronDown, IconChevronUp, IconChevronRight, IconDots, IconFolder, IconFolderOpen, IconFolderPlus, IconPlus, IconSearch } from "@tabler/icons-vue";
import { useWorkspaceStore } from "@/stores/workspace";
import useWorkspaceFiles from "@/lib/workspaceFiles";
import { readLastCanvas } from "@/lib/projectUi";
import { getCanvasAssetDirectories, isCanvasFile } from "@/pages/workspace/canvasFile";
import tfAccount from "@/components/settings/tfAccount.vue";
import { providerBalances, tfBalanceApiKey, saveTfMediaApiKey, refreshProviderBalance } from "@/lib/providerBilling";

const props = defineProps<{
  directory?: string;
  initialCanvasId?: string;
  activateCanvas?: (id: string, signal?: AbortSignal) => Promise<void>;
  flushSave: (action?: () => Promise<void>) => Promise<void>;
  /** ACT: 项目切换（保存 + 换目录）进行中，避免重复点击或在保存期间再次切换。 */
  switching?: boolean;
}>();
const workspaceStore = useWorkspaceStore();
const emit = defineEmits<{ switchProject: [project: { directory: string; name: string }] }>();
const projectListVisible = ref(false);
const projectQuery = ref("");
const filteredProjects = computed(() => {
  const query = projectQuery.value.trim().toLocaleLowerCase();
  return [...workspaceStore.projectList]
    .sort((left, right) => right.lastOpenedAt - left.lastOpenedAt)
    .filter(project => !query || project.name.toLocaleLowerCase().includes(query) || project.directory.toLocaleLowerCase().includes(query));
});
// ACT: 只负责"选了哪个项目"；保存、运行中断判断与目录重定位都在画布层统一处理。
function chooseProject(project: { directory: string; name: string }) {
  projectListVisible.value = false;
  projectQuery.value = "";
  if (project.directory === workspaceStore.project?.directory) return;
  emit("switchProject", project);
}
const balanceVisible = ref(false);
const rechargeVisible = ref(false);
const balanceFormat = computed(() => new Intl.NumberFormat(locale.value, { maximumFractionDigits: 6 }));
const visibleProviderBalances = computed(() => providerBalances.value.filter(item => item.id !== "tfRouter" || (item.balance && !item.error)));
const workspaceName = computed(() => workspaceStore.project?.name || "未命名工作区");
const projectNameDraft = ref("");
watch([() => workspaceStore.project?.directory, workspaceName], () => {
  projectNameDraft.value = workspaceName.value;
}, { immediate: true });

function saveProjectName(event: Event) {
  if (event instanceof KeyboardEvent && event.isComposing) return;
  const project = workspaceStore.project;
  if (project) workspaceStore.renameProject(project.directory, projectNameDraft.value);
  projectNameDraft.value = workspaceName.value;
}

type Canvas = { id: string; name: string; flow?: Pick<FlowExportObject, "nodes" | "edges" | "viewport"> };
const canvases = inject<ShallowRef<Canvas[]>>("canvasList", shallowRef<Canvas[]>([]));
const getRetainedNodes = inject<(id: string) => { id: string; data?: unknown }[]>("canvasAssetNodes", () => []);
const performFileAction = inject<(directory: string, action: "copy" | "rename" | "move" | "delete", path: string, target?: string, entryType?: "canvas" | "directory") => Promise<void>>("performWorkspaceFileAction");
const boundCanvas = shallowRef<Canvas>();
const activeCanvasId = defineModel<string>("canvasId", { default: "" });
watch(canvases, () => {
  if (boundCanvas.value) activeCanvasId.value = canvases.value.includes(boundCanvas.value) ? boundCanvas.value.id : "";
}, { flush: "sync" });
const canvasListVisible = ref(false);
const activeCanvasName = computed(() => canvases.value.find(canvas => canvas.id === activeCanvasId.value)?.name || translate("选择画布"));
const busy = ref(false);
const initialized = ref(false);
const loadError = ref("");
const editingId = ref<string | null>(null);
const newCanvasId = ref<string | null>(null);
const nameInput = ref<InputInstance>();
const canvasName = ref("");
const renameError = ref("");
const { toObject, setNodes, setEdges, setViewport } = useVueFlow();
type CanvasEntry = { path: string; name: string; type: "file" | "directory"; children?: CanvasEntry[]; empty?: boolean; draft?: boolean };
const folders = inject<ShallowRef<CanvasEntry[]>>("canvasFolders", shallowRef<CanvasEntry[]>([]));
const loadedDirectories = inject<ShallowRef<string[]>>("canvasLoadedDirectories", shallowRef<string[]>([]));
const expandedFolders = ref<string[]>([]);
const pendingDirectories = new Map<string, Promise<void>>();
let treeController = new AbortController();
const canvasTree = ref<TreeInstance>();
const canvasPicker = ref<HTMLElement>();
const searchQuery = ref("");
const loadingTree = ref(false);
const pickerBusy = computed(() => busy.value || loadingTree.value);
const folderDraft = ref<string | null>(null);
const folderInput = ref<InputInstance>();
const draftFolderPath = crypto.randomUUID();
const itemMenu = ref<DropdownInstance>();
const menuAnchor = shallowRef({ getBoundingClientRect: () => new DOMRect() });
const menuEntry = shallowRef<CanvasEntry>();
const moveVisible = ref(false);
let treeRequest = 0;
const treeEntries = computed(() => {
  const entries: CanvasEntry[] = [];
  const visibleCanvases = canvases.value.filter(canvas => !canvas.id.split("/").slice(0, -1).some(name => ["assets", ".agent", "library", "library-assets"].includes(name.toLowerCase())));
  const directories = new Map<string, CanvasEntry & { children: CanvasEntry[] }>();
  for (const folder of folders.value) directories.set(folder.path, { ...folder, children: [] });
  for (const canvas of visibleCanvases) {
    const parts = canvas.id.split("/").slice(0, -1);
    parts.forEach((name, index) => {
      const path = parts.slice(0, index + 1).join("/");
      if (!directories.has(path)) directories.set(path, { path, name, type: "directory", children: [], empty: false });
    });
  }
  for (const entry of [...directories.values(), ...visibleCanvases.map(canvas => ({ path: canvas.id, name: canvas.name, type: "file" as const }))]
    .sort((left, right) => Number(left.type !== "directory") - Number(right.type !== "directory") || left.name.localeCompare(right.name, "zh-CN", { numeric: true }))) {
    (directories.get(parentPath(entry.path))?.children ?? entries).push(entry);
  }
  if (folderDraft.value !== null) entries.unshift({ path: draftFolderPath, name: folderDraft.value, type: "directory", draft: true });
  return entries;
});
const moveFolders = computed(() => [{ path: "", label: translate("画布根目录") }, ...folders.value.map(folder => ({ path: folder.path, label: folder.path }))]);

function parentPath(path: string) { return path.slice(0, path.lastIndexOf("/") + 1).replace(/\/$/, ""); }
const filterEntry: FilterNodeMethodFunction = (query: string, entry) => !!entry.draft || String(entry.path).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
watch([searchQuery, treeEntries], async () => { await nextTick(); canvasTree.value?.filter(searchQuery.value); });
watch(canvasListVisible, opened => {
  if (!opened) { treeRequest++; loadingTree.value = false; itemMenu.value?.handleClose(); cancelFolder(); }
});
onBeforeUnmount(() => {
  treeController.abort();
  // 离开画布后停止缩略图预热，避免继续向服务端发无效请求。
  thumbnailWarmToken++;
});

function treeChildren(path: string): CanvasEntry[] {
  let entries = treeEntries.value;
  if (!path) return entries;
  let current = "";
  for (const name of path.split("/")) {
    current = current ? `${current}/${name}` : name;
    entries = entries.find(entry => entry.path === current)?.children ?? [];
  }
  return entries;
}

function mergeCanvases(loaded: Canvas[]) {
  const known = new Set(canvases.value.map(canvas => canvas.id));
  const added = loaded.filter(canvas => !known.has(canvas.id));
  if (added.length) canvases.value = [...canvases.value, ...added];
}

async function loadDirectory(path: string) {
  if (loadedDirectories.value.includes(path)) return;
  const pending = pendingDirectories.get(path);
  if (pending) return pending;
  const directory = props.directory;
  if (!directory) return;
  const signal = treeController.signal;
  const task = (async () => {
    const loaded = await listCanvases(directory, path, false, signal);
    checkCanvasDirectory(directory, signal);
    const names = new Set(loaded.folders.map(folder => folder.path));
    const removed = folders.value.filter(folder => parentPath(folder.path) === path && !names.has(folder.path)).map(folder => folder.path);
    loadedDirectories.value = [...loadedDirectories.value.filter(value => !removed.some(folder => value === folder || value.startsWith(`${folder}/`))), path];
    folders.value = [...folders.value.filter(folder => parentPath(folder.path) !== path && !removed.some(value => folder.path.startsWith(`${value}/`)))
      .map(folder => folder.path === path ? { ...folder, empty: loaded.empty } : folder), ...loaded.folders];
    mergeCanvases(loaded.canvases);
  })();
  pendingDirectories.set(path, task);
  try { await task; }
  finally { if (pendingDirectories.get(path) === task) pendingDirectories.delete(path); }
}

const loadTreeNode: LoadFunction = (node, resolve, reject) => {
  const path = node.level === 0 ? "" : String(node.data.path);
  if (node.level === 0) { resolve(treeChildren(path)); return; }
  if (!expandedFolders.value.includes(path)) expandedFolders.value.push(path);
  if (loadedDirectories.value.includes(path)) { resolve(treeChildren(path)); return; }
  void loadDirectory(path).then(() => resolve(treeChildren(path))).catch(error => {
    reject();
    expandedFolders.value = expandedFolders.value.filter(value => value !== path);
    if (!axios.isCancel(error) && !(error instanceof Error && error.name === "AbortError")) renameError.value = errorMessage(error, "读取文件夹失败");
  });
};

function collapseFolder(entry: CanvasEntry) {
  expandedFolders.value = expandedFolders.value.filter(path => path !== entry.path && !path.startsWith(`${entry.path}/`));
}

function expandFolder(entry: CanvasEntry) {
  if (!expandedFolders.value.includes(entry.path)) expandedFolders.value.push(entry.path);
}

watch(searchQuery, (query, _previous, onCleanup) => {
  if (!query.trim()) return;
  const controller = new AbortController();
  const timer = setTimeout(() => { void getCanvases(controller.signal).catch(error => {
    if (!controller.signal.aborted) renameError.value = errorMessage(error, "搜索画布失败");
  }); }, 250);
  onCleanup(() => { clearTimeout(timer); controller.abort(); });
});

watch(moveVisible, (visible, _previous, onCleanup) => {
  if (!visible || !props.directory) return;
  const directory = props.directory;
  const controller = new AbortController();
  onCleanup(() => controller.abort());
  void listCanvasEntries(directory, "", true, controller.signal).then(loaded => {
    checkCanvasDirectory(directory, controller.signal);
    folders.value = loaded.folders;
  }).catch(error => { if (!controller.signal.aborted) renameError.value = errorMessage(error, "读取移动目录失败"); });
});

async function refreshTree() {
  const directory = props.directory;
  if (!directory) return;
  const request = ++treeRequest;
  loadingTree.value = true;
  try {
    treeController.abort();
    treeController = new AbortController();
    pendingDirectories.clear();
    loadedDirectories.value = [];
    await loadDirectory("");
  } catch (error) {
    if (request !== treeRequest || directory !== props.directory) return;
    throw error;
  } finally { if (request === treeRequest) loadingTree.value = false; }
}

function selectEntry(entry: CanvasEntry) {
  if (entry.type === "file" && !pickerBusy.value && editingId.value === null && folderDraft.value === null) void handleSwitchCanvas(entry.path);
}

watch(() => props.directory, async (directory, _previous, onCleanup) => {
  let cancelled = false;
  treeController.abort();
  treeController = new AbortController();
  const controller = treeController;
  onCleanup(() => { cancelled = true; controller.abort(); });
  pendingDirectories.clear();
  expandedFolders.value = [];
  initialized.value = false;
  busy.value = true;
  loadError.value = "";
  treeRequest++;
  if (props.initialCanvasId === undefined) { folders.value = []; loadedDirectories.value = []; }
  folderDraft.value = null;
  searchQuery.value = "";
  boundCanvas.value = undefined;
  activeCanvasId.value = "";
  try {
    if (props.initialCanvasId === undefined) canvases.value = [];
    newCanvasId.value = null;
    editingId.value = null;
    renameError.value = "";
    if (!directory) return;
    if (props.initialCanvasId === "") return;
    if (props.initialCanvasId) {
      await applyCanvas(props.initialCanvasId, directory);
      return;
    }
    // 与根目录列表并行读取上次打开的画布指针；读取本身不写盘。
    // 指针缺失/损坏（404、格式不符）由 readLastCanvas 返回 null；网络/5xx/权限错误必须上抛到
    // 外层 loadError，绝不能当作“没有指针”回退到第一个画布，否则 canvasHost 会把错误画布写回指针。
    const savedPromise = readLastCanvas(directory, controller.signal);
    // 并行读取期间先吞掉拒绝事件，避免产生未处理拒绝；真正的错误在下面 await 时抛出。
    savedPromise.catch(() => {});
    const entries = await listCanvases(directory, "", false, controller.signal);
    if (cancelled) return;
    const saved = await savedPromise;
    if (cancelled) return;

    folders.value = entries.folders;
    loadedDirectories.value = [""];
    canvases.value = entries.canvases;

    // 1) 指针命中根目录画布；2) 否则载入指针所在父目录后再命中。
    let target = saved && canvases.value.some(canvas => canvas.id === saved) ? saved : undefined;
    if (saved && !target) {
      const parent = parentPath(saved);
      if (parent) {
        try { await loadDirectory(parent); }
        catch (error) {
          if (cancelled || controller.signal.aborted) throw error;
          ElMessage.warning(errorMessage(error, "读取上次画布所在文件夹失败，已回退到第一个画布"));
        }
      }
      if (cancelled) return;
      if (canvases.value.some(canvas => canvas.id === saved)) target = saved;
    }
    // 命中子目录画布时展开祖先文件夹，保证树中可见并高亮。
    if (target) expandCanvasAncestors(target);

    // 3) 根目录第一张；4) 递归子目录第一张；5) 全新项目新建「画布1」；6) 只有子目录但无画布时保持空态。
    if (!target) target = await firstAvailableCanvas(directory, entries, controller.signal);
    if (cancelled) return;
    if (target) {
      try {
        await applyCanvas(target, directory, controller.signal);
      } catch (error) {
        // 只有指针目标已被删除或格式无效才静默回退；网络错误继续抛出，避免悄悄换画布。
        if (!saved || target !== saved || !isCanvasFallbackError(error) || cancelled) throw error;
        target = await firstAvailableCanvas(directory, entries, controller.signal, saved);
        if (cancelled || !target) return;
        await applyCanvas(target, directory, controller.signal);
      }
    }
  } catch (err) {
    if (!cancelled) {
      loadError.value = errorMessage(err, "读取画布失败");
      if (!props.initialCanvasId) ElMessage.error(loadError.value);
    }
  } finally {
    if (!cancelled) { busy.value = false; initialized.value = true; }
  }
}, { immediate: true });

function errorMessage(err: unknown, fallback: string) {
  return axios.isAxiosError<{ message?: string }>(err) ? err.response?.data.message || fallback : err instanceof Error ? err.message : fallback;
}

type CanvasListing = { canvases: Canvas[]; folders: CanvasEntry[] };

/** 上一次画布位于子目录时，展开它的祖先文件夹，使懒加载树能显示并高亮该节点。 */
function expandCanvasAncestors(canvasId: string) {
  const parts = canvasId.split("/").slice(0, -1);
  for (let index = 1; index <= parts.length; index++) {
    const path = parts.slice(0, index).join("/");
    if (!expandedFolders.value.includes(path)) expandedFolders.value.push(path);
  }
}

/** 仅“文件已不存在/不是有效画布”允许静默回退；网络与权限错误交由外层提示。 */
function isCanvasFallbackError(error: unknown) {
  if (axios.isAxiosError(error) && error.response?.status === 404) return true;
  return error instanceof Error && (error.message === "画布文件格式无效" || error.message === "画布不存在，请重新获取画布列表");
}

/**
 * 按 6.2 的兜底顺序挑选要打开的画布：根目录第一张 → 递归子目录第一张 → 新建「画布1」。
 * 根目录只有子目录且所有子目录都没有画布时返回 undefined，由界面保持空态。
 */
async function firstAvailableCanvas(directory: string, listing: CanvasListing, signal?: AbortSignal, exclude?: string) {
  const rootCanvas = listing.canvases.find(canvas => canvas.id !== exclude);
  if (rootCanvas) return rootCanvas.id;
  if (listing.folders.length) {
    // ACT: 使用 listCanvases 的 recursive 能力一次性列出全部子目录画布，不再走 activateCanvas/ensureCanvas。
    const loaded = await listCanvases(directory, "", true, signal);
    checkCanvasDirectory(directory, signal);
    folders.value = loaded.folders;
    loadedDirectories.value = ["", ...loaded.folders.map(folder => folder.path)];
    mergeCanvases(loaded.canvases);
    return loaded.canvases.find(canvas => canvas.id !== exclude)?.id;
  }
  // 根目录既无画布也无子目录：保持现有行为，新建「画布1」。
  try {
    const created = await createCanvasFile(directory, "画布1", signal);
    checkCanvasDirectory(directory, signal);
    mergeCanvases([created]);
    return created.id;
  } catch (err) {
    if (!axios.isAxiosError<{ data?: { code?: string } }>(err) || err.response?.status !== 409 || err.response.data.data?.code !== "EEXIST") throw err;
    // 同时打开工作区时，读取另一请求刚创建的默认画布，不覆盖同名文件。
    const refreshed = await listCanvases(directory, "", false, signal);
    checkCanvasDirectory(directory, signal);
    folders.value = refreshed.folders;
    loadedDirectories.value = [""];
    mergeCanvases(refreshed.canvases);
    const existing = refreshed.canvases.find(canvas => canvas.id !== exclude);
    if (existing) return existing.id;
    // 画布1.json 若被其他 JSON 占用，则使用下一个空闲名称，保留原文件。
    const created = await createCanvasFile(directory, undefined, signal);
    checkCanvasDirectory(directory, signal);
    mergeCanvases([created]);
    return created.id;
  }
}

function peekCanvases() {
  return canvases.value.map(({ id, name }) => ({ id, name }));
}

async function getCanvases(signal?: AbortSignal) {
  const directory = getCanvasDirectory(signal);
  const callSignal = AbortSignal.any([treeController.signal, ...(signal ? [signal] : [])]);
  const loaded = await listCanvases(directory, "", true, callSignal);
  checkCanvasDirectory(directory, callSignal);
  loadedDirectories.value = ["", ...loaded.folders.map(folder => folder.path)];
  folders.value = loaded.folders;
  mergeCanvases(loaded.canvases);
  return loaded.canvases.map(({ id, name }) => ({ id, name }));
}

function getCanvasDirectory(signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (!props.directory) throw new Error("请先选择工作目录");
  if (busy.value || editingId.value !== null) throw new Error("画布正在加载或编辑，请稍后重试");
  return props.directory;
}

function checkCanvasDirectory(directory: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (props.directory !== directory) throw new Error("工作目录已切换，本次画布操作已停止");
}

// ACT: 打开画布后按顺序预热图片缩略图。单张服务端生成约 0.3 s，提前排队能让用户第一次平移时
// 不再逐张等待；串行（等上一张返回再发下一张，服务端全局并发只有 2）避免把视口内的 <img> 挤到队尾。
// 切换画布/卸载时 token 失效即停。
const thumbnailPathPattern = /\.(?:png|jpe?g|webp|bmp|avif)$/i;
let thumbnailWarmToken = 0;
function preheatThumbnails(directory: string, nodes: { data?: unknown }[], signal?: AbortSignal) {
  const files = useWorkspaceFiles(directory);
  const warm = files.warmThumb;
  if (!warm) return;
  const paths = new Set<string>();
  for (const node of nodes) {
    const outputs = (node.data as { outputs?: Record<string, { dataType?: string; value?: { url?: string } } | undefined> } | undefined)?.outputs;
    for (const output of Object.values(outputs ?? {})) {
      const url = output?.value?.url;
      // 服务端按扩展名判定，这里同样只看扩展名（mimeType 由调用方传入，不可信）。
      if (output?.dataType === "IMAGE" && url && thumbnailPathPattern.test(url)) paths.add(url);
    }
  }
  if (!paths.size) return;
  const token = ++thumbnailWarmToken;
  void (async () => {
    await new Promise(resolve => setTimeout(resolve, 800));
    for (const path of paths) {
      if (token !== thumbnailWarmToken || signal?.aborted) return;
      await warm(path, 1024);
    }
  })();
}

async function applyCanvas(canvasId: string, directory: string, signal?: AbortSignal) {
  checkCanvasDirectory(directory, signal);
  const nextCanvas = canvases.value.find(canvas => canvas.id === canvasId);
  const currentCanvas = canvases.value.find(canvas => canvas.id === activeCanvasId.value);
  if (!nextCanvas) throw new Error("画布不存在，请重新获取画布列表");
  if (nextCanvas === currentCanvas) return;
  if (currentCanvas && props.activateCanvas) {
    await props.activateCanvas(canvasId, signal);
    checkCanvasDirectory(directory, signal);
    return;
  }
  if (!nextCanvas.flow) {
    const data = await useWorkspaceFiles(directory).readJson<Partial<NonNullable<Canvas["flow"]>> & { toonflowCanvas?: boolean } | null>(nextCanvas.id);
    checkCanvasDirectory(directory, signal);
    if (data?.toonflowCanvas !== true || !Array.isArray(data.nodes) || !Array.isArray(data.edges) || !data.viewport
      || ![data.viewport.x, data.viewport.y, data.viewport.zoom].every(Number.isFinite) || data.viewport.zoom <= 0) throw new Error("画布文件格式无效");
    // 旧画布可能保存了临时导出进度，重新打开时任务已不存在。
    for (const node of data.nodes) if (node.type === "remote-videoNode" && node.data) delete node.data.exportProgress;
    nextCanvas.flow = { nodes: data.nodes, edges: data.edges, viewport: data.viewport };
  }
  await props.flushSave();
  checkCanvasDirectory(directory, signal);
  if (currentCanvas) currentCanvas.flow = toObject();
  // 应用画布数据时暂时清空文件名，避免初始化触发自动保存。
  activeCanvasId.value = "";
  setNodes(nextCanvas.flow.nodes);
  // 命中宽度由画布统一配置，不使用旧文件中的覆盖值。
  setEdges(nextCanvas.flow.edges.map(({ interactionWidth, ...edge }) => edge));
  await setViewport(nextCanvas.flow.viewport);
  await nextTick();
  checkCanvasDirectory(directory);
  boundCanvas.value = nextCanvas;
  activeCanvasId.value = nextCanvas.id;
  signal?.throwIfAborted();
  preheatThumbnails(directory, nextCanvas.flow.nodes, signal);
}

async function switchCanvas(canvasId: string, signal?: AbortSignal) {
  const directory = getCanvasDirectory(signal);
  canvasListVisible.value = false;
  busy.value = true;
  try {
    if (props.activateCanvas) await props.activateCanvas(canvasId, signal);
    else await applyCanvas(canvasId, directory, signal);
    checkCanvasDirectory(directory, signal);
  } finally {
    if (props.directory === directory) busy.value = false;
  }
}

async function handleSwitchCanvas(canvasId: string) {
  const directory = props.directory;
  try {
    await switchCanvas(canvasId);
  } catch (err) {
    if (props.directory === directory) ElMessage.error(errorMessage(err, "切换画布失败"));
  }
}

async function removeCanvas(canvas: Canvas) {
  if (busy.value || editingId.value !== null || !props.directory) return;
  const directory = props.directory;
  const id = canvas.id;
  busy.value = true;
  canvasListVisible.value = false;
  try {
    const confirmed = await ElMessageBox.confirm(`确定删除“${canvas.name}”？对应的 ${id} 文件及独占的节点素材也会被删除，其他画布共用的素材会保留。此操作不可撤销。`, "删除画布", {
      type: "warning", confirmButtonText: "删除", cancelButtonText: "取消", closeOnClickModal: false,
    }).then(() => true, () => false);
    if (!confirmed) return;
    checkCanvasDirectory(directory);
    const nextCanvas = canvases.value.find(item => item.id !== id);
    if (nextCanvas && activeCanvasId.value === id) await applyCanvas(nextCanvas.id, directory);
    const files = useWorkspaceFiles(directory);
    const readNodes = async (canvasId: string) => {
      const data = await files.readJson<{ toonflowCanvas?: boolean; nodes?: { id: string; data?: unknown }[] }>(canvasId);
      if (data?.toonflowCanvas !== true || !Array.isArray(data.nodes) || data.nodes.some(node => !node || typeof node.id !== "string")) {
        throw new Error(`无法确认 ${canvasId} 的素材引用`);
      }
      return [...data.nodes, ...getRetainedNodes(canvasId)];
    };
    let removedNodes: { id: string; data?: unknown }[] = [];
    await props.flushSave(async () => {
      checkCanvasDirectory(directory);
      if (canvas.id !== id || !canvases.value.includes(canvas)) throw new Error("画布已变更，请重新选择");
      removedNodes = await readNodes(id);
      if (!performFileAction) {
        await files.remove(id);
        checkCanvasDirectory(directory);
        canvases.value = canvases.value.filter(item => item !== canvas);
        await nextTick();
      }
    });
    // coordinator 自己进入保存临界区，必须在上一次 flush 完成后调用，避免重入保存队列。
    if (performFileAction) await performFileAction(directory, "delete", id);
    await props.flushSave(async () => {
      checkCanvasDirectory(directory);
      const retainedNodes = (await Promise.all((await listCanvases(directory, "", true)).canvases.map(canvas => readNodes(canvas.id)))).flat();
      const assetDirectories = getCanvasAssetDirectories(removedNodes, retainedNodes);
      checkCanvasDirectory(directory);
      const results = await Promise.allSettled(assetDirectories.map(path => files.remove(path, true).catch(error => {
        if (!axios.isAxiosError<{ data?: { code?: string } }>(error) || error.response?.data.data?.code !== "ENOENT") throw error;
      })));
      const failed = results.flatMap((result, index) => result.status === "rejected" ? [assetDirectories[index]] : []);
      if (failed.length) throw new Error(`画布已删除，但 ${failed.length} 个素材目录清理失败：${failed.join("、")}`);
    });
    if (props.directory === directory) ElMessage.success("画布已删除");
  } catch (err) {
    if (props.directory === directory) ElMessage.error(errorMessage(err, "删除画布失败"));
  } finally {
    if (props.directory === directory) busy.value = false;
  }
}

async function createCanvasFile(directory: string, name?: string, signal?: AbortSignal) {
  if (name !== undefined) name = normalizeCanvasName(name);
  const files = useWorkspaceFiles(directory);
  const flow = { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } };
  for (let number = 1; ; number++) {
    checkCanvasDirectory(directory, signal);
    const canvasName = name ?? `画布${number}`;
    const id = `${canvasName}.json`;
    try {
      await files.writeJson(id, { toonflowCanvas: true, ...flow }, true);
      return { id, name: canvasName, flow };
    } catch (err) {
      if (name !== undefined || !axios.isAxiosError<{ data?: { code?: string } }>(err) || err.response?.status !== 409 || err.response.data.data?.code !== "EEXIST") throw err;
    }
  }
}

async function listCanvasEntries(directory: string, path = "", recursive = false, signal?: AbortSignal) {
  const files = useWorkspaceFiles(directory);
  const { entries, empty } = await files.list(path, signal);
  const folders: CanvasEntry[] = [];
  // ACT: 初始化与展开只读当前一层；完整查询仅由搜索、Agent 列举及文件操作显式触发。
  for (let index = 0; index < entries.length; index++) {
    checkCanvasDirectory(directory, signal);
    const entry = entries[index]!;
    if (entry.type !== "directory" || ["assets", ".agent"].includes(entry.name.toLowerCase())) continue;
    const folder: CanvasEntry = { ...entry };
    folders.push(folder);
    if (recursive) {
      const children = await files.list(entry.path, signal);
      folder.empty = children.empty;
      entries.push(...children.entries);
    }
  }
  return { entries, empty, folders: folders.sort((left, right) => left.path.localeCompare(right.path, "zh-CN", { numeric: true })) };
}

async function listCanvases(directory: string, path = "", recursive = false, signal?: AbortSignal) {
  const files = useWorkspaceFiles(directory);
  const { entries, folders, empty } = await listCanvasEntries(directory, path, recursive, signal);
  const loaded = await Promise.all(entries.filter(entry => entry.type === "file" && /\.json$/i.test(entry.name)).map(async entry => {
    if (!(await isCanvasFile(files, entry.path, signal))) return null;
    return { id: entry.path, name: entry.name.slice(0, -5) };
  }));
  return {
    canvases: loaded.filter(canvas => canvas !== null).sort((left, right) => left.name.localeCompare(right.name, "zh-CN", { numeric: true })),
    folders,
    empty,
  };
}

async function addCanvas(name?: string, signal?: AbortSignal): Promise<string> {
  const directory = getCanvasDirectory(signal);
  busy.value = true;
  try {
    const canvas = await createCanvasFile(directory, name, signal);
    checkCanvasDirectory(directory);
    canvases.value = [...canvases.value, canvas];
    signal?.throwIfAborted();
    await applyCanvas(canvas.id, directory, signal);
    canvasListVisible.value = false;
    return canvas.id;
  } finally {
    if (props.directory === directory) busy.value = false;
  }
}

async function handleAddCanvas() {
  if (pickerBusy.value || editingId.value !== null || folderDraft.value !== null || !props.directory) return;
  const directory = props.directory;
  busy.value = true;
  try {
    const canvas = await createCanvasFile(directory);
    checkCanvasDirectory(directory);
    canvases.value = [...canvases.value, canvas];
    searchQuery.value = "";
    newCanvasId.value = canvas.id;
    busy.value = false;
    await editCanvas(canvas);
  } catch (err) {
    if (props.directory === directory) ElMessage.error(errorMessage(err, "新增画布失败"));
  } finally {
    if (props.directory === directory) busy.value = false;
  }
}

async function editCanvas(canvas: { id: string; name: string }) {
  if (busy.value || editingId.value !== null) return;
  editingId.value = canvas.id;
  canvasName.value = canvas.name;
  renameError.value = "";
  await nextTick();
  nameInput.value?.focus();
  nameInput.value?.select();
}

async function startFolder() {
  if (pickerBusy.value || editingId.value !== null || folderDraft.value !== null) return;
  searchQuery.value = "";
  renameError.value = "";
  folderDraft.value = "新建文件夹";
  await nextTick();
  folderInput.value?.focus();
  folderInput.value?.select();
}

function cancelFolder() { if (!busy.value) folderDraft.value = null; }

function normalizeFolderName(name: string) {
  name = normalizeCanvasName(name, "文件夹");
  if (name.toLowerCase() === "assets") throw new Error("assets 是节点素材目录，请使用其他文件夹名称");
  if (name.toLowerCase() === ".agent") throw new Error(".agent 是 Agent 数据目录，请使用其他文件夹名称");
  if (name.toLowerCase() === "library") throw new Error("library 是项目素材库目录，请使用其他文件夹名称");
  if (name.toLowerCase() === "library-assets") throw new Error("library-assets 是项目素材库的备用目录，请使用其他文件夹名称");
  if (name.toLowerCase() === ".toonflow") throw new Error(".toonflow 是项目配置目录，请使用其他文件夹名称");
  return name;
}

async function saveFolder(event?: Event) {
  if (event instanceof KeyboardEvent && event.isComposing) return;
  if (folderDraft.value === null || busy.value || !props.directory) return;
  if (!folderDraft.value.trim()) { cancelFolder(); return; }
  const directory = props.directory;
  busy.value = true;
  renameError.value = "";
  try {
    const name = normalizeFolderName(folderDraft.value);
    await useWorkspaceFiles(directory).mkdir(name);
    checkCanvasDirectory(directory);
    folderDraft.value = null;
    await refreshTree();
  } catch (error) {
    if (directory === props.directory) renameError.value = errorMessage(error, "创建文件夹失败");
  } finally { if (directory === props.directory) busy.value = false; }
}

function openItemMenu(event: MouseEvent, entry: CanvasEntry) {
  event.preventDefault();
  if (pickerBusy.value || editingId.value !== null || folderDraft.value !== null || entry.draft) return;
  itemMenu.value?.handleClose();
  menuEntry.value = entry;
  moveVisible.value = false;
  const target = event.currentTarget as HTMLElement;
  const rect = event.type === "contextmenu" ? new DOMRect(event.clientX, event.clientY, 0, 0) : target.getBoundingClientRect();
  menuAnchor.value = { getBoundingClientRect: () => rect };
  void nextTick(() => itemMenu.value?.handleOpen());
}

function destinationDisabled(path: string) {
  const entry = menuEntry.value;
  return !entry || path === parentPath(entry.path) || (entry.type === "directory" && (path === entry.path || path.startsWith(`${entry.path}/`)));
}

async function relocateEntry(entry: CanvasEntry, target: string, directory: string) {
  checkCanvasDirectory(directory);
  if (!performFileAction) throw new Error("工作区文件管理尚未就绪");
  await performFileAction(directory, "move", entry.path, target, entry.type === "directory" ? "directory" : "canvas");
  checkCanvasDirectory(directory);
  await refreshTree();
}

async function moveEntry(path: string, createFolder = false) {
  const entry = menuEntry.value;
  const directory = props.directory;
  if (!entry || !directory || pickerBusy.value || destinationDisabled(path)) return;
  itemMenu.value?.handleClose();
  busy.value = true;
  renameError.value = "";
  try {
    if (createFolder) {
      await useWorkspaceFiles(directory).mkdir(path);
      checkCanvasDirectory(directory);
    }
    await relocateEntry(entry, `${path ? `${path}/` : ""}${entry.path.split("/").at(-1)}`, directory);
  } catch (error) {
    if (directory === props.directory) renameError.value = errorMessage(error, "移动失败");
  } finally { if (directory === props.directory) busy.value = false; }
}

async function createMoveFolder() {
  const directory = props.directory;
  itemMenu.value?.handleClose();
  try {
    const { value } = await ElMessageBox.prompt("新文件夹将创建在画布根目录", "新建文件夹", {
      inputValue: "新建文件夹", confirmButtonText: "创建并移动", cancelButtonText: "取消",
      inputValidator: name => { try { normalizeFolderName(name); return true; } catch (error) { return (error as Error).message; } },
    });
    if (directory !== props.directory) return;
    await moveEntry(normalizeFolderName(value), true);
  } catch (error) { if (error !== "cancel" && error !== "close") ElMessage.error(errorMessage(error, "创建文件夹失败")); }
}

async function handleItemCommand(command: string) {
  const entry = menuEntry.value;
  const directory = props.directory;
  if (!entry || !directory || pickerBusy.value) return;
  if (command === "move") { moveVisible.value = true; return; }
  itemMenu.value?.handleClose();
  if (entry.type === "file") {
    const canvas = canvases.value.find(canvas => canvas.id === entry.path);
    if (canvas) {
      if (command === "rename") await editCanvas(canvas);
      else if (command === "delete") await removeCanvas(canvas);
    }
    return;
  }
  busy.value = true;
  renameError.value = "";
  try {
    if (command === "rename") {
      const { value } = await ElMessageBox.prompt("文件夹名称", "重命名", {
        inputValue: entry.name, confirmButtonText: "保存", cancelButtonText: "取消",
        inputValidator: name => { try { normalizeFolderName(name); return true; } catch (error) { return (error as Error).message; } },
      });
      const name = normalizeFolderName(value);
      if (name !== entry.name) await relocateEntry(entry, `${parentPath(entry.path) ? `${parentPath(entry.path)}/` : ""}${name}`, directory);
    } else if (command === "delete") {
      await ElMessageBox.confirm(`确定删除文件夹“${entry.name}”？`, "删除文件夹", { type: "warning", confirmButtonText: "删除", cancelButtonText: "取消" });
      checkCanvasDirectory(directory);
      // 只删除真实空目录；隐藏文件和普通文档也应阻止删除，不能依据过滤后的画布树递归删除。
      await useWorkspaceFiles(directory).remove(entry.path);
      checkCanvasDirectory(directory);
      await refreshTree();
    }
  } catch (error) {
    if (directory === props.directory && error !== "cancel" && error !== "close") renameError.value = errorMessage(error, "文件夹操作失败");
  } finally { if (directory === props.directory) busy.value = false; }
}

async function finishEdit() {
  if (busy.value) return;
  editingId.value = null;
  renameError.value = "";
  const createdId = newCanvasId.value;
  newCanvasId.value = null;
  if (createdId) await handleSwitchCanvas(createdId);
}

function normalizeCanvasName(name: string, label = "画布") {
  name = name.trim();
  if (!name || name.length > 120 || /[<>:"/\\|?*\x00-\x1f]/.test(name) || /[. ]$/.test(name)
    || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) {
    throw new Error(label === "文件夹" ? "文件夹名称不是有效文件名" : "画布名称不是有效文件名");
  }
  return name;
}

async function renameCanvasFile(id: string, name: string, directory: string, signal?: AbortSignal) {
  checkCanvasDirectory(directory, signal);
  const canvas = canvases.value.find(item => item.id === id);
  if (!canvas) throw new Error("画布不存在，请重新获取画布列表");
  name = normalizeCanvasName(name);
  if (name === canvas.name) return;
  const target = `${id.slice(0, id.lastIndexOf("/") + 1)}${name}.json`;
  if (performFileAction) {
    await performFileAction(directory, "rename", id, target);
    checkCanvasDirectory(directory, signal);
    return;
  }
  await props.flushSave(async () => {
    checkCanvasDirectory(directory, signal);
    await useWorkspaceFiles(directory).rename(id, target);
    checkCanvasDirectory(directory);
    // 文件已改名时先更新保存路径，再响应取消，避免自动保存重新创建旧文件。
    if (activeCanvasId.value === id) activeCanvasId.value = target;
    if (newCanvasId.value === id) newCanvasId.value = target;
    if (editingId.value === id) editingId.value = target;
    Object.assign(canvas, { id: target, name });
    canvases.value = [...canvases.value];
    signal?.throwIfAborted();
  });
  checkCanvasDirectory(directory, signal);
}

function syncCanvasPath(previous: string, target: string) {
  if (activeCanvasId.value === previous) activeCanvasId.value = target;
  if (newCanvasId.value === previous) newCanvasId.value = target;
  if (editingId.value === previous) editingId.value = target;
}

async function renameCanvas(canvasId: string, name: string, signal?: AbortSignal) {
  const directory = getCanvasDirectory(signal);
  busy.value = true;
  try {
    await renameCanvasFile(canvasId, name, directory, signal);
  } finally {
    if (props.directory === directory) busy.value = false;
  }
}

async function saveCanvas(event?: Event) {
  if (event instanceof KeyboardEvent && event.isComposing) return;
  const id = editingId.value;
  if (busy.value || !props.directory || id === null) return;
  const directory = props.directory;
  const canvas = canvases.value.find(item => item.id === id);
  if (!canvasName.value.trim() || canvasName.value.trim() === canvas?.name) {
    await finishEdit();
    return;
  }
  busy.value = true;
  renameError.value = "";
  try {
    await renameCanvasFile(id, canvasName.value, directory);
    busy.value = false;
    await finishEdit();
  } catch (err) {
    if (props.directory === directory) {
      renameError.value = errorMessage(err, "重命名画布失败");
      canvasListVisible.value = true;
    }
  } finally {
    if (props.directory === directory) busy.value = false;
  }
}

function syncDocumentNode(canvasId: string, nodeId: string, handleId: string, text: string, inline: boolean) {
  const node = canvases.value.find(canvas => canvas.id === canvasId)?.flow?.nodes.find(node => node.id === nodeId);
  if (!node) return;
  const data = node.data ??= {};
  const output = data.outputs?.[handleId];
  if (output?.dataType === "STRING") output.value = text;
  else if (inline) (data.outputs ??= {})[handleId] = { dataType: "STRING", value: text };
}

defineExpose({ getCanvases, peekCanvases, initialized, addCanvas, switchCanvas, renameCanvas, syncCanvasPath, syncDocumentNode, loadError });
</script>

<style lang="scss" scoped>
.canvasMenuPanel.vue-flow__panel {
  left: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  max-width: calc(50% - 90px);
}

.balanceMenuPanel.vue-flow__panel {
  max-width: calc(50% - 90px);

  .balanceList {
    display: flex;
    gap: 6px;
    max-width: 520px;
    overflow-x: auto;
    scrollbar-width: thin;

    .balanceCard {
      flex-shrink: 0;
      font-variant-numeric: tabular-nums;
      .providerLabel { color: var(--el-text-color-secondary); font-size: 12px; }
      .balanceTrigger {
        height: 28px;
        padding: 0 3px;
        font-size: 13px;
        :deep(> span) { display: flex; align-items: center; gap: 4px; }
      }
    }
  }
}

@container canvasWorkspace (max-width: 1040px) {
  .balanceMenuPanel.vue-flow__panel {
    top: 50px;
    max-width: calc(100% - 30px);
  }
}

.canvasPicker {
  .iconButton { width: 28px; height: 28px; padding: 0; margin: 0; }

  .pickerToolbar {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-bottom: 8px;
    .el-input { flex: 1; min-width: 0; }
    .iconButton { flex-shrink: 0; }
  }

  .canvasTree {
    background: transparent;
    :deep(.el-tree-node__content) { height: 36px; border-radius: var(--el-border-radius-base); }
    :deep(.el-tree-node__expand-icon) { padding: 6px; }

    .canvasEntry {
      display: flex;
      align-items: center;
      gap: 8px;
      flex: 1;
      min-width: 0;
      height: 100%;
      padding-right: 4px;

      .folderIcon, .canvasIcon { flex-shrink: 0; color: var(--el-text-color-secondary); }
      .entryName { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
      .nameEditor { flex: 1; min-width: 0; }
      .selectedIcon { flex-shrink: 0; color: var(--el-color-primary); }
      .moreButton { width: 24px; height: 24px; padding: 0; margin: 0; flex-shrink: 0; opacity: 0; }

      &:hover, &:focus-within { .moreButton { opacity: 1; } }
      @media (hover: none) { .moreButton { opacity: 1; } }
    }
  }
}

.moveTrigger {
  display: flex;
  align-items: center;
  width: 100%;
  .moveLabel { flex: 1; min-width: 132px; }
}

:global(.canvasActionMenu .deleteAction) { color: var(--el-color-danger); }

.moveDestinations {
  .el-button {
    display: flex;
    justify-content: flex-start;
    width: 100%;
    margin: 0;
    padding: 8px;
    font-weight: normal;
    :deep(> span) {
      display: block;
      text-align: left;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }
}

.menuExtension {
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
}

.canvasMenu {
  margin-left: 76px;
  min-width: 0;

  .menuContent {
    display: flex;
    align-items: center;
    gap: 2px;

    .el-divider { margin: 0 3px; }

    .workspaceNameInput {
      width: auto;
      height: 28px;
      min-width: 2em;
      max-width: 180px;
      font-size: 13px;

      &::after {
        content: var(--workspaceName);
        padding: 0 7px;
        white-space: pre;
        visibility: hidden;
      }

      :deep(.el-input__wrapper) {
        position: absolute;
        inset: 0;
        background: transparent;
        box-shadow: none;
      }

      :deep(.el-input__inner) {
        font-family: inherit;
        font-weight: inherit;
        letter-spacing: inherit;
      }
    }

    .canvasTrigger {
      min-width: 0;
      height: 28px;
      padding: 0 3px;
      font-size: 13px;
      :deep(> span) { display: flex; align-items: center; gap: 4px; min-width: 0; }
      span { min-width: 0; max-width: 160px; overflow: hidden; text-overflow: ellipsis; }
    }

  }
}

.projectTrigger {
  width: 20px;
  height: 28px;
  padding: 0;
  margin: 0 2px 0 0;
  flex-shrink: 0;
}

.projectPicker {
  display: flex;
  flex-direction: column;
  gap: 6px;

  .projectEntry {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    height: auto;
    padding: 6px 8px;
    margin: 0;
    justify-content: flex-start;
    text-align: left;

    .projectEntryText { display: flex; flex-direction: column; gap: 1px; min-width: 0; flex: 1; }
    .projectEntryName { font-size: 13px; line-height: 1.4; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .projectEntryPath { font-size: 11px; line-height: 1.3; color: var(--el-text-color-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; direction: rtl; }
    svg { flex-shrink: 0; color: var(--el-color-primary); }
  }

  .projectEmpty { display: block; padding: 8px; font-size: 12px; }
}

</style>
