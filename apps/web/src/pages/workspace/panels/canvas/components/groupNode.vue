<template>
  <div class="groupNode" :class="{ selected, resizing: !!resize }">
    <el-dropdown
      ref="menu"
      trigger="contextmenu"
      virtualTriggering
      :virtualRef="menuAnchor"
      placement="bottom-start"
      :showArrow="false"
      :showTimeout="0"
      :hideTimeout="0"
      @command="handleCommand">
      <template #dropdown>
        <el-dropdown-menu>
          <el-dropdown-item command="rename" :icon="IconPencil">重命名分组</el-dropdown-item>
          <el-dropdown-item command="delete" :icon="IconTrash" divided>删除分组</el-dropdown-item>
        </el-dropdown-menu>
      </template>
    </el-dropdown>
    <input
      v-if="editingLabel && !readOnly"
      ref="labelInput"
      v-model="labelDraft"
      class="groupLabelInput nodrag nopan"
      aria-label="分组名称"
      @pointerdown.stop
      @mousedown.stop
      @click.stop
      @dblclick.stop
      @keydown.stop
      @keydown.enter="confirmLabel"
      @keydown.esc.prevent="editingLabel = false"
      @blur="saveLabel" />
    <span
      v-else
      class="groupLabel"
      :tabindex="readOnly ? undefined : 0"
      :title="readOnly ? data.label || '分组' : `${data.label || '分组'}（双击编辑名称）`"
      @dblclick.stop="editLabel"
      @keydown.enter.stop.prevent="editLabel"
      @contextmenu.stop.prevent="openMenu($event)">
      <span class="groupLabelText">{{ data.label || "分组" }}</span>
    </span>
    <button
      v-for="corner in readOnly ? [] : resizeCorners"
      :key="corner.name"
      class="resizeCorner nodrag nopan"
      :class="corner.name"
      type="button"
      :aria-label="`调整分组${corner.label}`"
      @pointerdown.stop.prevent="startResize($event, corner)"
      @pointermove.stop="moveResize"
      @pointerup.stop="finishResize"
      @pointercancel="finishResize"
      @lostpointercapture="finishResize"
      @mousedown.stop
      @click.stop
      @dblclick.stop />
  </div>
</template>

<script setup lang="ts">
import { inject, nextTick, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { useVueFlow, type GraphNode, type NodeProps } from "@vue-flow/core";
import { ElMessage, type DropdownInstance } from "element-plus";
import { IconPencil, IconTrash } from "@tabler/icons-vue";
import { gridSize, snapOffset, snapPoint } from "../snapNodes";

const props = withDefaults(defineProps<NodeProps & { readOnly?: boolean }>(), { readOnly: false });
const flow = useVueFlow();
const batchHistory = inject<((action: () => Promise<void>) => Promise<void>) | undefined>("batchCanvasHistory", undefined);
// ACT: 分组必须连内容一起删。复用画布的删除链路（含 delete 生命周期、不可删节点校验、撤销批次），
// 自己 removeNodes 只会留下 parentNode 指向已删节点的孤儿。
const deleteSelection = inject<((nodes: GraphNode[]) => Promise<void>) | undefined>("deleteNodeSelection", undefined);
const editingLabel = ref(false);
const labelDraft = ref("");
const labelInput = ref<HTMLInputElement>();
const resizeCorners = [
  { name: "topLeft", label: "左上角", x: -1, y: -1 },
  { name: "topRight", label: "右上角", x: 1, y: -1 },
  { name: "bottomLeft", label: "左下角", x: -1, y: 1 },
  { name: "bottomRight", label: "右下角", x: 1, y: 1 },
] as const;
type ResizeCorner = typeof resizeCorners[number];
const resize = shallowRef<{
  node: GraphNode;
  corner: ResizeCorner;
  element: HTMLElement;
  pointerId: number;
  point: { x: number; y: number };
  position: { x: number; y: number };
  width: number;
  height: number;
  resolve: () => void;
}>();

async function editLabel() {
  if (props.readOnly) return;
  labelDraft.value = props.data.label || "分组";
  editingLabel.value = true;
  await nextTick();
  labelInput.value?.select();
}

function saveLabel() {
  if (props.readOnly || !editingLabel.value) return;
  const label = labelDraft.value.trim();
  if (label) flow.updateNodeData(props.id, { label });
  editingLabel.value = false;
}

function confirmLabel(event: KeyboardEvent) {
  if (props.readOnly || event.isComposing) return;
  event.preventDefault();
  saveLabel();
}

// ACT: 分组本体已经 pointer-events:none（让组内的连线和画布能收到事件），
// 所以菜单只能从标题栏拉起来，和节点骨架一样用虚拟锚点定位到光标。
const menu = ref<DropdownInstance>();
const menuAnchor = shallowRef({ getBoundingClientRect: () => new DOMRect() });

async function openMenu(event: MouseEvent) {
  if (props.readOnly) return;
  event.preventDefault();
  event.stopPropagation();
  menu.value?.handleClose();
  menuAnchor.value = { getBoundingClientRect: () => new DOMRect(event.clientX, event.clientY, 0, 0) };
  await nextTick();
  menu.value?.handleOpen();
}

async function handleCommand(command: string) {
  if (props.readOnly) return;
  if (command === "rename") return void editLabel();
  if (command !== "delete") return;
  const node = flow.findNode(props.id);
  if (!node) return;
  if (!deleteSelection) return ElMessage.error("当前环境无法删除分组");
  await deleteSelection([node]);
}

function startResize(event: PointerEvent, corner: ResizeCorner) {
  if (props.readOnly || event.button !== 0 || resize.value) return;
  const node = flow.findNode(props.id);
  if (!node) return;
  const action = () => new Promise<void>(resolve => {
    if (props.readOnly) return resolve();
    const element = event.currentTarget as HTMLElement;
    resize.value = {
      node, corner, element, pointerId: event.pointerId,
      point: flow.screenToFlowCoordinate({ x: event.clientX, y: event.clientY }),
      position: { ...node.position }, width: node.dimensions.width, height: node.dimensions.height, resolve,
    };
    node.resizing = true;
    element.setPointerCapture(event.pointerId);
  });
  void (batchHistory ? batchHistory(action) : action()).catch(error => {
    finishResize();
    ElMessage.error(error instanceof Error ? error.message : "分组缩放失败");
  });
}

function moveResize(event: PointerEvent) {
  if (props.readOnly) return finishResize();
  const state = resize.value;
  if (!state || event.pointerId !== state.pointerId) return;
  if (flow.findNode(props.id) !== state.node) return finishResize();
  const point = flow.screenToFlowCoordinate({ x: event.clientX, y: event.clientY });
  const width = Math.max(120, state.width + (point.x - state.point.x) * state.corner.x);
  const height = Math.max(80, state.height + (point.y - state.point.y) * state.corner.y);
  const position = {
    x: state.position.x + (state.corner.x < 0 ? state.width - width : 0),
    y: state.position.y + (state.corner.y < 0 ? state.height - height : 0),
  };
  const dx = position.x - state.node.position.x;
  const dy = position.y - state.node.position.y;
  for (const child of flow.getNodes.value) {
    if (child.parentNode === props.id) flow.updateNode(child.id, { position: { x: child.position.x - dx, y: child.position.y - dy } });
  }
  flow.updateNode(props.id, {
    position,
    style: { ...(typeof state.node.style === "object" ? state.node.style : {}), width: `${width}px`, height: `${height}px` },
  });
  state.node.dimensions = { width, height };
}

function finishResize(event?: PointerEvent) {
  const state = resize.value;
  if (!state || (event && event.pointerId !== state.pointerId)) return;
  resize.value = undefined;
  state.node.resizing = false;
  if (state.element.hasPointerCapture(state.pointerId)) state.element.releasePointerCapture(state.pointerId);
  // ACT: 按了没动就不改——否则点一下手柄会把旧的小数尺寸"吸"成整格，看着像误操作。
  const moved = state.node.position.x !== state.position.x || state.node.position.y !== state.position.y
    || state.node.dimensions.width !== state.width || state.node.dimensions.height !== state.height;
  if (!moved) return state.resolve();
  // ACT: 只在收手时吸附一次。逐帧吸附会让手柄发顿，而且子节点是按帧增量平移的，反复取整会累积漂移。
  // 尺寸往上取整（不能把子节点切掉），位置就近取整，子节点按位置变化量反向补偿，保持原位对齐。
  const grid = gridSize(flow);
  const width = snapOffset(state.node.dimensions.width, grid);
  const height = snapOffset(state.node.dimensions.height, grid);
  const position = snapPoint(state.node.position, grid);
  const dx = position.x - state.node.position.x;
  const dy = position.y - state.node.position.y;
  if (dx || dy) {
    for (const child of flow.getNodes.value) {
      if (child.parentNode !== props.id) continue;
      flow.updateNode(child.id, { position: { x: child.position.x - dx, y: child.position.y - dy } });
    }
  }
  if (dx || dy || width !== state.node.dimensions.width || height !== state.node.dimensions.height) {
    const style = typeof state.node.style === "object" ? state.node.style : {};
    state.node.dimensions = { width, height };
    flow.updateNode(props.id, { position, style: { ...style, width: `${width}px`, height: `${height}px` } });
  }
  state.resolve();
}

onBeforeUnmount(() => finishResize());
watch(() => props.readOnly, readOnly => {
  if (!readOnly) return;
  editingLabel.value = false;
  finishResize();
});

watch(
  () => props.readOnly ? [] : flow.getNodes.value.filter(node => node.parentNode === props.id),
  children => {
    if (props.readOnly) return;
    // ACT: 拖动期间保持分组框不变，松手后由画布统一贴合内容。
    children.forEach(node => { node.expandParent = false; });
  },
  { immediate: true },
);
</script>

<style lang="scss" scoped>
.groupNode {
  position: relative;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  border: 1px solid var(--el-border-color);
  border-radius: var(--el-border-radius-base);
  background: color-mix(in srgb, var(--el-fill-color-light) 25%, transparent);
  // ACT: 分组本体只是一块视觉矩形，不能参与命中——否则组内空白处的框选、连线点击和右键全被它吞掉。
  // 需要交互的部分（标题栏、缩放手柄）各自把 pointer-events 打开。
  pointer-events: none;

  &.selected {
    border-color: color-mix(in srgb, var(--el-color-primary) 50%, var(--el-border-color));
  }

  // ACT: 本体穿透后拿不到 :hover，缩放手柄改由选中态显形（拖动过程中保持）。
  &.selected,
  &.resizing {
    .resizeCorner { opacity: 1; }
  }

  .groupLabel,
  .groupLabelInput {
    position: absolute;
    left: 0;
    right: 0;
    bottom: calc(100% + 8px);
    box-sizing: border-box;
    height: 26px;
    padding: 0 2px;
    line-height: 20px;
    cursor: move;
    // ACT: 标题栏要整条可拖、可右键，所以单独恢复命中；视觉上仍只有一行小字。
    pointer-events: auto;
  }

  .groupLabel {
    display: flex;
    align-items: center;
    color: var(--el-text-color-secondary);
    font-size: 12px;
    user-select: none;

    .groupLabelText {
      flex: 1;
      // ACT: flex 项的自动最小尺寸是 min-content，不置 0 的话 nowrap 文本会撑破容器、省略号失效。
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }

  .groupLabelInput {
    width: 100%;
    padding: 0 3px;
    border: 1px solid var(--el-color-primary);
    border-radius: var(--el-border-radius-small);
    outline: none;
    background: var(--el-bg-color);
    color: var(--el-text-color-primary);
    font-family: inherit;
    font-size: 12px;
  }

  .resizeCorner {
    position: absolute;
    width: 9px;
    height: 9px;
    padding: 0;
    border: 1px solid var(--el-color-primary);
    border-radius: 2px;
    background: var(--el-bg-color);
    opacity: 0;
    pointer-events: auto;
    touch-action: none;

    &:focus-visible { opacity: 1; }
    &.topLeft { top: -5px; left: -5px; cursor: nwse-resize; }
    &.topRight { top: -5px; right: -5px; cursor: nesw-resize; }
    &.bottomLeft { bottom: -5px; left: -5px; cursor: nesw-resize; }
    &.bottomRight { bottom: -5px; right: -5px; cursor: nwse-resize; }
  }
}
</style>
