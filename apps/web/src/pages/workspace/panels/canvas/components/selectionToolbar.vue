<template>
  <el-card
    v-if="visible"
    ref="toolbar"
    class="selectionToolbar nodrag nopan nowheel"
    shadow="never"
    :bodyStyle="{ padding: '4px' }"
    :style="toolbarStyle"
    @pointerdown.stop
    @mousedown.stop
    @click.stop
    @dblclick.stop
    @contextmenu.stop
    @keydown.stop>
    <div class="toolbarActions">
      <el-button
        v-for="action in layoutActions"
        :key="action.mode"
        text
        :icon="action.icon"
        :disabled="!canArrangeSelection"
        @click="operate(action.mode)">{{ action.label }}</el-button>
      <span class="toolbarDivider" aria-hidden="true" />
      <el-button text :icon="IconCopyPlus" :disabled="busy || disabled" @click="operate('duplicate')">创建副本</el-button>
      <el-button text :icon="IconBoxMultiple" :disabled="busy || disabled" @click="operate('group')">打组</el-button>
      <el-button text :icon="IconDeselect" :disabled="busy || disabled || !hasGroup" @click="operate('ungroup')">解组</el-button>
      <span class="toolbarDivider" aria-hidden="true" />
      <el-tooltip :disabled="canSaveToAssets" content="仅支持图片/视频节点" placement="top">
        <span class="toolbarItem">
          <el-button text :icon="IconLibraryPlus" :loading="saving" :disabled="busy || disabled || !canSaveToAssets" @click="saveToAssets">加入素材库</el-button>
        </span>
      </el-tooltip>
      <template v-if="disableTargets.length || enableTargets.length">
        <span class="toolbarDivider" aria-hidden="true" />
        <el-button
          v-if="disableTargets.length"
          text
          :icon="IconCircleOff"
          title="禁用选中节点"
          :disabled="busy || disabled || !canDisableSelection"
          @click="setSelectionDisabled(true)">禁用</el-button>
        <el-button
          v-if="enableTargets.length"
          text
          :icon="IconCircleCheck"
          title="解除选中节点的禁用"
          :disabled="busy || disabled || !canEnableSelection"
          @click="setSelectionDisabled(false)">解除禁用</el-button>
      </template>
    </div>
  </el-card>
</template>

<script setup lang="ts">
import { computed, inject, nextTick, ref } from "vue";
import { getRectOfNodes, useVueFlow, type GraphNode, type Node, type XYPosition } from "@vue-flow/core";
import { ElButton, ElCard, ElMessage, ElTooltip } from "element-plus";
import {
  IconCopyPlus, IconBoxMultiple, IconDeselect, IconLibraryPlus, IconCircleCheck, IconCircleOff,
  IconLayoutGrid, IconLayoutColumns, IconLayoutRows,
} from "@tabler/icons-vue";
import { useNodeEvent } from "@toonflow/nodes-scaffold/nodeEvent";
import { useWorkspaceStore } from "@/stores/workspace";
import { finishGroupDrag, getSelectionRoots, getSelectionTree } from "../selectionNodes";
import { gridSize, snapOffset, snapPoint, subtractPoint } from "../snapNodes";
import { arrangeSelection, type ArrangeSelectionMode } from "../arrangeSelection";
import { expandSelectionForAssets, getAssetSource, saveSelectionToAssets } from "../saveSelectionToAssets";

const props = defineProps<{
  batchHistory: (action: () => Promise<void>) => Promise<void>;
  getSignal: () => AbortSignal;
  disabled?: boolean;
}>();
const flow = useVueFlow();
const workspace = useWorkspaceStore();
const toolbar = ref<InstanceType<typeof ElCard>>();
const busy = ref(false);
const saving = ref(false);
const layoutActions = [
  { mode: "horizontal", label: "水平排列", icon: IconLayoutColumns },
  { mode: "vertical", label: "垂直排列", icon: IconLayoutRows },
  { mode: "grid", label: "宫格排列", icon: IconLayoutGrid },
] as const;
const selectionRoots = computed(() => getSelectionRoots(flow.getSelectedNodes.value, flow.getNodes.value));
const canArrangeSelection = computed(() => !busy.value && !props.disabled && selectionRoots.value.length > 1
  && selectionRoots.value.every(node => node.draggable !== false
    && Number.isFinite(node.dimensions.width) && node.dimensions.width > 0
    && Number.isFinite(node.dimensions.height) && node.dimensions.height > 0));
const hasGroup = computed(() => flow.getSelectedNodes.value.some(node => node.type === "canvasGroup"));
// ACT: 分组只是容器，先展开到叶子节点再判定，选一个分组就等于选它里面的所有图片/视频。
// 禁用节点既不能入库也不参与可入库判定，和「禁用」按钮用同一套 eligible 口径。
const assetSelection = computed(() => expandSelectionForAssets(flow.getSelectedNodes.value, flow.getNodes.value)
  .filter(node => node.data?.disabled !== true));
const canSaveToAssets = computed(() => assetSelection.value.length > 0 && assetSelection.value.every(node => !!getAssetSource(node)));
const setNodeDisabled = inject<((ids: string[], value: boolean) => Promise<boolean>) | undefined>("toonflow:setNodeDisabled", undefined);
const isNodeRunning = inject<((nodeId: string) => boolean) | undefined>("toonflow:isNodeRunning", undefined);
const eligibleNodes = computed(() => flow.getSelectedNodes.value.filter(node => node.type !== "canvasGroup"));
const disableTargets = computed(() => eligibleNodes.value.filter(node => node.data?.disabled !== true));
const enableTargets = computed(() => eligibleNodes.value.filter(node => node.data?.disabled === true));
// ACT: 运行中的节点实际会被写入通道跳过；全部都在跑时按钮直接置灰，避免点了没反应。
const canDisableSelection = computed(() => !busy.value && !props.disabled && disableTargets.value.some(node => !isNodeRunning?.(node.id)));
const canEnableSelection = computed(() => !busy.value && !props.disabled && enableTargets.value.some(node => !isNodeRunning?.(node.id)));

async function setSelectionDisabled(value: boolean) {
  if (busy.value || props.disabled) return;
  const ids = (value ? disableTargets.value : enableTargets.value).map(node => node.id);
  if (!ids.length) return;
  await setNodeDisabled?.(ids, value);
}
const visible = computed(() => !props.disabled && !flow.userSelectionActive.value && flow.getSelectedNodes.value.length > 0
  && (flow.nodesSelectionActive.value || hasGroup.value));
const toolbarStyle = computed(() => {
  const bounds = getRectOfNodes(flow.getSelectedNodes.value);
  const { x, y, zoom } = flow.viewport.value;
  const width = toolbar.value?.$el.offsetWidth ?? 0;
  const height = toolbar.value?.$el.offsetHeight ?? 0;
  const left = Math.max(width / 2 + 8, Math.min(x + (bounds.x + bounds.width / 2) * zoom, flow.dimensions.value.width - width / 2 - 8));
  // ACT: 顶部导航约占 56px，留出 8px 间隔；高度变化时再按导航实际尺寸定位。
  const top = Math.max(height + 64, Math.min(y + bounds.y * zoom - 12 - (hasGroup.value ? 30 * zoom : 0), flow.dimensions.value.height - 8));
  return { left: `${left}px`, top: `${top}px` };
});

async function duplicateNodes(selection: GraphNode[], signal: AbortSignal, withEdges = true, positions?: Map<string, XYPosition>) {
  const nodes = getSelectionTree(selection, flow.getNodes.value);
  const roots = getSelectionRoots(nodes, flow.getNodes.value);
  const rootsIds = new Set(roots.map(node => node.id));
  const bounds = getRectOfNodes(nodes);
  const ids = new Map(nodes.map(node => [node.id, crypto.randomUUID()]));
  const snapshot = flow.toObject();
  const savedNodes = new Map(snapshot.nodes.map(node => [node.id, node]));
  const incomingEdges = withEdges ? snapshot.edges.filter(edge => ids.has(edge.target)) : [];
  const copies = await Promise.all(nodes.map(async node => {
    const patch = await useNodeEvent(node.id, flow).emit("copy");
    signal.throwIfAborted();
    const saved = savedNodes.get(node.id)!;
    const copy = JSON.parse(JSON.stringify({ ...saved, data: { ...saved.data, ...patch } })) as Node;
    Reflect.deleteProperty(copy, "initialized");
    copy.id = ids.get(node.id)!;
    copy.parentNode = ids.get(saved.parentNode ?? "") ?? saved.parentNode;
    // ACT: 副本偏移量按节点实际尺寸算，宽度常带小数；向上取整到网格倍数，副本才会落在网格上。
    copy.position = positions ? { ...positions.get(node.id)! }
      : { x: saved.position.x + (rootsIds.has(node.id) ? snapOffset(bounds.width + 64, gridSize(flow)) : 0), y: saved.position.y };
    copy.data = { ...copy.data, label: `${copy.data?.label || "未命名节点"} - 副本` };
    return copy;
  }));
  signal.throwIfAborted();
  if (nodes.some(node => flow.findNode(node.id) !== node)) throw new Error("节点已变化，请重新创建副本");
  const edges = incomingEdges.filter(edge => ids.has(edge.source) || flow.findNode(edge.source)).map(edge => ({
    ...JSON.parse(JSON.stringify(edge)),
    id: crypto.randomUUID(),
    source: ids.get(edge.source) ?? edge.source,
    target: ids.get(edge.target)!,
    selected: false,
  }));
  flow.addNodes(copies);
  flow.addEdges(edges);
  return { ids, rootIds: roots.map(node => ids.get(node.id)!) };
}

function groupNodes(selection: GraphNode[]) {
  const roots = getSelectionRoots(selection, flow.getNodes.value);
  if (!roots.length) return [];
  const rootIds = new Set(roots.map(node => node.id));
  const bounds = getRectOfNodes(roots);
  const parentNode = roots.every(node => node.parentNode === roots[0]!.parentNode) ? roots[0]!.parentNode : undefined;
  const parentPosition = flow.findNode(parentNode)?.computedPosition ?? { x: 0, y: 0 };
  // ACT: 内边距取网格（16）的倍数——32/48；否则组在网格上、子节点却永远差 8px。
  const grid = gridSize(flow);
  // ACT: 吸附只在绝对坐标上做一次。组位置存的是"绝对 − 父绝对"，子节点位置必须减"组的绝对原点"；
  // 两者混用会让组内打组时子节点整体平移一个父组的绝对位置——表现为新组是空的、节点飞到别处。
  const groupOrigin = snapPoint({ x: bounds.x - 32, y: bounds.y - 48 }, grid);
  const groupPosition = subtractPoint(groupOrigin, parentPosition);
  const id = crypto.randomUUID();
  const group: Node = {
    id,
    type: "canvasGroup",
    parentNode,
    position: groupPosition,
    style: { width: `${bounds.width + 64}px`, height: `${bounds.height + 80}px` },
    connectable: false,
    expandParent: false,
    data: { label: "分组" },
  };
  const nodes: Node[] = flow.getNodes.value.map(node => rootIds.has(node.id) ? {
    ...node,
    parentNode: id,
    // ACT: 子节点按"吸附后的绝对坐标 − 组的绝对原点"计算；只有组位置对齐没有意义，
    // 选中的节点本身带小数时子节点依然会错位，之后任何一次贴合都会把组再推离网格。
    position: subtractPoint(snapPoint(node.computedPosition, grid), groupOrigin),
    extent: undefined,
    expandParent: false,
  } : node);
  nodes.splice(nodes.findIndex(node => rootIds.has(node.id)), 0, group);
  flow.setNodes(nodes);
  return [id];
}

function ungroupNodes(selection: GraphNode[]) {
  const groups = new Map(selection.filter(node => node.type === "canvasGroup").map(node => [node.id, node]));
  const promoted: string[] = [];
  for (const node of flow.getNodes.value) {
    if (!node.parentNode || !groups.has(node.parentNode) || groups.has(node.id)) continue;
    const visited = new Set<string>();
    let parentNode: string | undefined = node.parentNode;
    while (parentNode && groups.has(parentNode) && !visited.has(parentNode)) {
      visited.add(parentNode);
      parentNode = groups.get(parentNode)!.parentNode;
    }
    if (parentNode && visited.has(parentNode)) parentNode = undefined;
    const parentPosition = flow.findNode(parentNode)?.computedPosition ?? { x: 0, y: 0 };
    flow.updateNode(node.id, {
      parentNode,
      // ACT: 吸附作用在绝对坐标上，再减父组绝对位置；对相对差值吸附在父组离网时等于没吸。
      position: subtractPoint(snapPoint(node.computedPosition, gridSize(flow)), parentPosition),
      extent: undefined,
      expandParent: false,
    });
    promoted.push(node.id);
  }
  flow.removeNodes([...groups.keys()], true, false);
  return [...selection.filter(node => !groups.has(node.id)).map(node => node.id), ...promoted];
}

function mergeGroups(selection: GraphNode[]) {
  const groups = getSelectionRoots(selection.filter(node => node.type === "canvasGroup"), flow.getNodes.value);
  if (groups.length < 2) throw new Error("请至少选择两个分组");
  const first = groups[0]!;
  const groupIds = new Set(groups.map(node => node.id));
  const bounds = getRectOfNodes(groups);
  const parentNode = groups.every(node => node.parentNode === first.parentNode) ? first.parentNode : undefined;
  const parentPosition = flow.findNode(parentNode)?.computedPosition ?? { x: 0, y: 0 };
  const style = typeof first.style === "function" ? first.style(first) : first.style;
  const grid = gridSize(flow);
  const mergedOrigin = snapPoint({ x: bounds.x, y: bounds.y }, grid);
  const merged: GraphNode = {
    ...first,
    parentNode,
    // ACT: mergedOrigin 已经是吸附过的绝对坐标，这里只做"绝对 − 父绝对"，不能再吸附一次相对差值。
    position: subtractPoint(mergedOrigin, parentPosition),
    dimensions: { width: bounds.width, height: bounds.height },
    style: { ...style, width: `${bounds.width}px`, height: `${bounds.height}px` },
  };
  const nodes: Node[] = flow.getNodes.value.flatMap(node => {
    if (groupIds.has(node.id)) return [];
    return node.parentNode && groupIds.has(node.parentNode) ? [{
      ...node,
      parentNode: first.id,
      // ACT: 子节点用"吸附后的绝对坐标 − 吸附后的组原点"，与建组同口径，否则合并完组对齐、内容不对齐。
      position: subtractPoint(snapPoint(node.computedPosition, grid), mergedOrigin),
      extent: undefined,
      expandParent: false,
    }] : [node];
  });
  const firstChild = nodes.findIndex(node => node.parentNode === first.id);
  nodes.splice(firstChild < 0 ? nodes.length : firstChild, 0, merged);
  flow.setNodes(nodes);
  return [first.id];
}

async function selectNodes(ids: string[], signal: AbortSignal) {
  await nextTick();
  signal.throwIfAborted();
  flow.removeSelectedElements();
  const nodes = ids.flatMap(id => flow.findNode(id) ?? []);
  flow.addSelectedNodes(getSelectionRoots(nodes, flow.getNodes.value));
  flow.nodesSelectionActive.value = true;
  flow.updateNodeInternals(ids);
}

function startDragCopy(selection: GraphNode[], withEdges: boolean) {
  const nodes = getSelectionTree(selection, flow.getNodes.value);
  if (busy.value || props.disabled || !nodes.length) return;
  const roots = getSelectionRoots(nodes, flow.getNodes.value);
  const startPositions = new Map(nodes.map(node => [node.id, { ...node.position }]));
  const positions = new Map(startPositions);
  const signal = props.getSignal();
  const ended = Promise.withResolvers<void>();
  const finish = () => ended.resolve();
  let copies: Map<string, string> | undefined;
  let started = false;

  function moveCopies() {
    for (const node of roots) {
      const copy = flow.findNode(copies?.get(node.id));
      if (copy) {
        copy.position = { ...positions.get(node.id)! };
        copy.dragging = true;
      }
    }
  }

  async function createCopies() {
    busy.value = true;
    signal.addEventListener("abort", finish, { once: true });
    try {
      await props.batchHistory(async () => {
        signal.throwIfAborted();
        const result = await duplicateNodes(selection, signal, withEdges, positions);
        copies = result.ids;
        moveCopies();
        await ended.promise;
        signal.throwIfAborted();
        const created = result.rootIds.flatMap(id => flow.findNode(id) ?? []);
        created.forEach(node => { node.dragging = false; });
        await nextTick();
        signal.throwIfAborted();
        finishGroupDrag(flow.getNodes.value, created);
      });
    } catch (error) {
      if (!signal.aborted) ElMessage.error(error instanceof Error ? error.message : "拖动复制失败");
    } finally {
      signal.removeEventListener("abort", finish);
      busy.value = false;
    }
  }

  return {
    update() {
      if (signal.aborted) return;
      // ACT: Vue Flow 固定拖动原节点 ID；同一帧还原原位置，只让副本跟随，松手后统一提交历史。
      for (const node of roots) {
        if (flow.findNode(node.id) !== node) continue;
        positions.set(node.id, { ...node.position });
        node.position = { ...startPositions.get(node.id)! };
        node.dragging = false;
      }
      moveCopies();
      if (!started) {
        started = true;
        void createCopies();
      }
    },
    finish,
  };
}

async function saveToAssets() {
  const directory = workspace.project?.directory;
  if (saving.value || busy.value || props.disabled || !directory || !canSaveToAssets.value) return;
  // ACT: 固定开始时的选中集合；批量入库期间用户继续点选不会把范围和序号带偏。
  // 只传 eligible：分组已展开，禁用节点在上面的 assetSelection 里已剔除。
  const selection = [...assetSelection.value];
  saving.value = true;
  try {
    const result = await saveSelectionToAssets(flow, selection, directory);
    if (result.saved) {
      ElMessage.success(`已加入 ${result.saved} 个素材${result.renamed ? `，其中 ${result.renamed} 个重名已自动改名` : ""}`);
    }
    if (result.failed.length) {
      ElMessage.error(`失败 ${result.failed.length} 个：${result.failed[0]!.label}（${result.failed[0]!.reason}）`);
    }
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "加入素材库失败");
  } finally {
    saving.value = false;
  }
}

async function operate(command: "duplicate" | "group" | "ungroup" | "mergeGroup" | ArrangeSelectionMode) {
  if (busy.value || props.disabled) return;
  const selection = [...flow.getSelectedNodes.value];
  if (!selection.length) return;
  const signal = props.getSignal();
  busy.value = true;
  try {
    await props.batchHistory(async () => {
      signal.throwIfAborted();
      if (command === "duplicate" || command === "group" || command === "ungroup" || command === "mergeGroup") {
        const ids = command === "duplicate" ? (await duplicateNodes(selection, signal)).rootIds
          : command === "group" ? groupNodes(selection)
          : command === "mergeGroup" ? mergeGroups(selection) : ungroupNodes(selection);
        await selectNodes(ids, signal);
      } else {
        arrangeSelection(flow, selection, command);
      }
    });
  } catch (error) {
    if (!signal.aborted) ElMessage.error(error instanceof Error ? error.message : "选区操作失败");
  } finally {
    busy.value = false;
  }
}

defineExpose({ operate, startDragCopy, busy });
</script>

<style scoped lang="scss">
.selectionToolbar {
  position: absolute;
  z-index: 6;
  width: max-content;
  transform: translate(-50%, -100%);

  .toolbarActions {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 2px;
    white-space: nowrap;

    .el-button {
      height: 28px;
      margin: 0;
      padding: 0 8px;
    }

    // tooltip 需要可接收悬停事件的触发元素，禁用按钮本身不派发鼠标事件。
    .toolbarItem {
      display: inline-flex;
    }

    .toolbarDivider {
      height: 16px;
      margin: 0 4px;
      border-left: 1px solid var(--el-border-color-lighter);
    }
  }
}
</style>
