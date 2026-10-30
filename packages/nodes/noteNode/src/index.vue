<template>
  <nodeSkeleton
    v-bind="nodeProps"
    class="noteNode"
    :topVisible="node.selected"
    topWidth="max-content"
    :fullscreenVisible="false"
    style="width: 100%; height: 100%">
    <template #top>
      <div class="noteToolbar nodrag nopan" @pointerdown.stop @mousedown.stop @dblclick.stop @keydown.stop @contextmenu.stop>
        <button
          v-for="color in backgrounds"
          :key="color.value"
          type="button"
          class="swatch"
          :class="{ active: background === color.value }"
          :style="{ background: color.value }"
          :title="`背景色：${color.label}`"
          :aria-label="`背景色：${color.label}`"
          :aria-pressed="background === color.value"
          @click.stop="setBackground(color.value)">
          <icon-check v-if="background === color.value" :size="12" aria-hidden="true" />
        </button>
        <span class="toolbarDivider" aria-hidden="true" />
        <el-dropdown trigger="click" placement="bottom-end" @command="setTextColor">
          <button type="button" class="textColorTrigger" title="字体颜色" aria-label="字体颜色">
            <span class="dot" :style="{ background: textColor }" aria-hidden="true" />
            <span>字体</span>
            <icon-chevron-down :size="12" aria-hidden="true" />
          </button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item v-for="color in textColors" :key="color.value" :command="color.value">
                <span class="dot" :style="{ background: color.value }" aria-hidden="true" />
                {{ color.label }}
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </template>
    <div class="noteBody" :class="{ editing }" @dblclick.stop="startEdit">
      <textarea
        v-if="editing"
        ref="editorEl"
        v-model="draft"
        class="noteEditor nodrag nopan nowheel"
        aria-label="便签正文"
        @blur="commitEdit"
        @keydown.stop="onEditorKey"
        @contextmenu.stop
        @pointerdown.stop />
      <div v-else class="noteText nopan nowheel">
        <template v-if="text">{{ text }}</template>
        <span v-else class="placeholder">双击输入便签…</span>
      </div>
      <button
        v-for="corner in corners"
        v-show="node.selected"
        :key="corner.name"
        type="button"
        class="resizeCorner nodrag nopan"
        :class="corner.name"
        :aria-label="`调整便签${corner.label}`"
        @pointerdown.stop.prevent="startResize($event, corner)"
        @pointermove.stop="moveResize"
        @pointerup.stop="finishResize"
        @pointercancel="finishResize"
        @lostpointercapture="finishResize"
        @mousedown.stop
        @click.stop
        @dblclick.stop />
    </div>
  </nodeSkeleton>
</template>

<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useVueFlow, type GraphNode } from "@vue-flow/core";
import { ElDropdown, ElDropdownItem, ElDropdownMenu, ElMessage } from "element-plus";
import { IconCheck, IconChevronDown, IconNote } from "@tabler/icons-vue";
import { nodeSkeleton, useNode } from "@toonflow/nodes-scaffold/runtime";

defineOptions({ inheritAttrs: false, icon: IconNote });

const DEFAULT_WIDTH = 320;
const DEFAULT_HEIGHT = 240;
const MIN_WIDTH = 160;
const MIN_HEIGHT = 160;
const DEFAULT_BG = "#FFF5B8";
const DEFAULT_TEXT = "#1F1F1F";

const backgrounds = [
  { value: "#FFF5B8", label: "黄色" },
  { value: "#FBD5E0", label: "粉色" },
  { value: "#CFE3FF", label: "蓝色" },
  { value: "#D5F0D3", label: "绿色" },
  { value: "#E4D9F7", label: "紫色" },
  { value: "#E9E9E9", label: "灰色" },
];
const textColors = [
  { value: "#1F1F1F", label: "黑色" },
  { value: "#5C5C5C", label: "深灰" },
  { value: "#FFFFFF", label: "白色" },
  { value: "#C0392B", label: "红色" },
  { value: "#1A5FB4", label: "蓝色" },
  { value: "#2E7D32", label: "绿色" },
];

const flow = useVueFlow();
const batchHistory = inject<((action: () => Promise<void>) => Promise<void>) | undefined>("batchCanvasHistory", undefined);
const { node, nodeProps, nodeEvent } = useNode({ label: "便签" });
const data = node.data as Record<string, unknown> & { noteText?: string; noteStyle?: string };

type StyleMap = Record<string, unknown>;

function styleOf(): StyleMap {
  const style = node.style;
  return style && typeof style === "object" ? { ...(style as StyleMap) } : {};
}

// ACT: 合并写而不是整体替换——width/height 与两枚颜色变量互不覆盖，画布历史据此记一步。
function setStyle(patch: StyleMap) {
  node.style = { ...styleOf(), ...patch } as GraphNode["style"];
}

const background = computed(() => String(styleOf()["--note-bg"] ?? DEFAULT_BG));
const textColor = computed(() => String(styleOf()["--note-color"] ?? DEFAULT_TEXT));

function setBackground(value: string) {
  setStyle({ "--note-bg": value });
}

function setTextColor(value: string) {
  setStyle({ "--note-color": value });
}

function applyStyleDefaults() {
  const style = styleOf();
  const patch: StyleMap = {};
  if (!style.width) patch.width = `${DEFAULT_WIDTH}px`;
  if (!style.height) patch.height = `${DEFAULT_HEIGHT}px`;
  if (!style["--note-bg"]) patch["--note-bg"] = DEFAULT_BG;
  if (!style["--note-color"]) patch["--note-color"] = DEFAULT_TEXT;
  if (Object.keys(patch).length) setStyle(patch);
}

// ACT: 复制/创建副本只透传 data，尺寸与配色靠这个临时字段带过去；解析失败不应阻断挂载。
function applyCopiedStyle(raw: unknown) {
  if (typeof raw !== "string") return;
  try {
    const parsed = JSON.parse(raw) as StyleMap;
    if (!parsed || typeof parsed !== "object") return;
    const patch: StyleMap = {};
    if (typeof parsed.width === "string" && /^\d+(?:\.\d+)?px$/.test(parsed.width)) patch.width = parsed.width;
    if (typeof parsed.height === "string" && /^\d+(?:\.\d+)?px$/.test(parsed.height)) patch.height = parsed.height;
    // 颜色只接受 #rgb/#rrggbb，避免被篡改成 url(...) 之类的值进入 background/fill。
    const color = /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i;
    if (typeof parsed["--note-bg"] === "string" && color.test(parsed["--note-bg"])) patch["--note-bg"] = parsed["--note-bg"];
    if (typeof parsed["--note-color"] === "string" && color.test(parsed["--note-color"])) patch["--note-color"] = parsed["--note-color"];
    if (Object.keys(patch).length) setStyle(patch);
  } catch {
    // 旧版本或手工改坏的剪贴数据：忽略即可。
  }
}

const text = computed(() => (typeof data.noteText === "string" ? data.noteText : ""));
const editing = ref(false);
const draft = ref("");
const editorEl = ref<HTMLTextAreaElement>();

async function startEdit() {
  if (editing.value) return;
  draft.value = text.value;
  editing.value = true;
  await nextTick();
  const element = editorEl.value;
  if (!element) return;
  element.focus();
  const end = element.value.length;
  element.setSelectionRange(end, end);
}

function commitEdit() {
  if (!editing.value) return;
  if (draft.value !== text.value) data.noteText = draft.value;
  editing.value = false;
}

function onEditorKey(event: KeyboardEvent) {
  if (event.isComposing) return;
  if (event.key !== "Escape") return;
  event.preventDefault();
  commitEdit();
  editorEl.value?.blur();
}

type ResizeCorner = { name: string; label: string; x: number; y: number };
const corners: ResizeCorner[] = [
  { name: "topLeft", label: "左上角", x: -1, y: -1 },
  { name: "topRight", label: "右上角", x: 1, y: -1 },
  { name: "bottomLeft", label: "左下角", x: -1, y: 1 },
  { name: "bottomRight", label: "右下角", x: 1, y: 1 },
];

type ResizeState = {
  corner: ResizeCorner;
  element: HTMLElement;
  pointerId: number;
  point: { x: number; y: number };
  position: { x: number; y: number };
  width: number;
  height: number;
  resolve: () => void;
};
const resizing = ref<ResizeState>();

function gridSize() {
  const size = flow.snapGrid.value?.[0];
  return Number.isFinite(size) && (size as number) > 0 ? (size as number) : 16;
}

function snapValue(value: number, grid = gridSize()) {
  return Math.round(value / grid) * grid;
}

// ACT: 尺寸向上取整，避免把内容切掉。
function snapOffset(value: number, grid = gridSize()) {
  return Math.ceil(value / grid) * grid;
}

// ACT: 组内子节点的 position 是相对父组的；直接吸附相对坐标会让节点永久偏离网格，必须先换算成绝对坐标。
function absolutePosition(target: GraphNode) {
  if (!target.parentNode) return { ...target.position };
  const parent = flow.findNode(target.parentNode);
  if (!parent) return { ...target.position };
  return { x: parent.computedPosition.x + target.position.x, y: parent.computedPosition.y + target.position.y };
}

function startResize(event: PointerEvent, corner: ResizeCorner) {
  if (event.button !== 0 || resizing.value) return;
  const action = () => new Promise<void>(resolve => {
    const element = event.currentTarget as HTMLElement;
    resizing.value = {
      corner,
      element,
      pointerId: event.pointerId,
      point: flow.screenToFlowCoordinate({ x: event.clientX, y: event.clientY }),
      position: { ...node.position },
      width: node.dimensions.width || DEFAULT_WIDTH,
      height: node.dimensions.height || DEFAULT_HEIGHT,
      resolve,
    };
    node.resizing = true;
    element.setPointerCapture(event.pointerId);
  });
  void (batchHistory ? batchHistory(action) : action()).catch(error => {
    finishResize();
    ElMessage.error(error instanceof Error ? error.message : "便签缩放失败");
  });
}

function moveResize(event: PointerEvent) {
  const state = resizing.value;
  if (!state || event.pointerId !== state.pointerId) return;
  if (flow.findNode(node.id) !== node) return finishResize();
  const point = flow.screenToFlowCoordinate({ x: event.clientX, y: event.clientY });
  const width = Math.max(MIN_WIDTH, state.width + (point.x - state.point.x) * state.corner.x);
  const height = Math.max(MIN_HEIGHT, state.height + (point.y - state.point.y) * state.corner.y);
  const position = {
    x: state.position.x + (state.corner.x < 0 ? state.width - width : 0),
    y: state.position.y + (state.corner.y < 0 ? state.height - height : 0),
  };
  node.dimensions = { width, height };
  flow.updateNode(node.id, {
    position,
    style: { ...styleOf(), width: `${width}px`, height: `${height}px` } as GraphNode["style"],
  });
}

function finishResize(event?: PointerEvent) {
  const state = resizing.value;
  if (!state || (event && event.pointerId !== state.pointerId)) return;
  resizing.value = undefined;
  node.resizing = false;
  if (state.element.hasPointerCapture(state.pointerId)) state.element.releasePointerCapture(state.pointerId);
  // 按了没动就不改——避免点一下手柄把小数尺寸吸成整格。
  const moved = node.position.x !== state.position.x || node.position.y !== state.position.y
    || node.dimensions.width !== state.width || node.dimensions.height !== state.height;
  if (!moved) return state.resolve();
  const grid = gridSize();
  const width = snapOffset(node.dimensions.width, grid);
  const height = snapOffset(node.dimensions.height, grid);
  const absolute = absolutePosition(node);
  const snapped = { x: snapValue(absolute.x, grid), y: snapValue(absolute.y, grid) };
  const parent = node.parentNode ? flow.findNode(node.parentNode) : undefined;
  const position = parent
    ? { x: snapped.x - parent.computedPosition.x, y: snapped.y - parent.computedPosition.y }
    : snapped;
  node.dimensions = { width, height };
  node.position = position;
  flow.updateNode(node.id, {
    position,
    style: { ...styleOf(), width: `${width}px`, height: `${height}px` } as GraphNode["style"],
  });
  state.resolve();
}

// ACT: 复制/创建副本/复制到剪贴板只带 data；把当前 style 以临时字段带过去，挂载时写回并删除。
nodeEvent.on("copy", () => ({ noteStyle: JSON.stringify(styleOf()) }));
// ACT: 切换画布/项目会先触发 save 再卸载；正在输入的正文要在落盘前提交，不能只靠卸载兜底。
nodeEvent.on("save", () => { commitEdit(); });

onMounted(() => {
  applyCopiedStyle(data.noteStyle);
  delete data.noteStyle;
  applyStyleDefaults();
});

// ACT: 缩放期间节点被卸载（删除/切换画布/插件重挂载）时 finishResize 不会触发，
// batchCanvasHistory 的 action 永远不返回，画布历史会一直处于分组中而无法提交；这里兜底收尾。
onBeforeUnmount(() => {
  commitEdit();
  finishResize();
});

// ACT: 撤销到挂载前/旧画布的快照会让 style 整体消失；补回默认尺寸，避免节点塌成骨架默认值。
watch(
  () => [styleOf().width, styleOf().height],
  () => {
    const style = styleOf();
    if (!style.width || !style.height) applyStyleDefaults();
  },
  { flush: "post" },
);
</script>

<style lang="scss" scoped>
// ACT: 骨架是多根节点 + teleport，Vue 不会把本组件的 scopeId 传到骨架内部，
// :deep 全部落空；这里用唯一类名做全局选择器，把外壳改成便签形态。
:global(.nodeSkeleton.noteNode) {
  display: flex;
  flex-direction: column;
}

:global(.noteNode .cardContainer) {
  flex: 1;
  min-height: 0;
  display: flex;
}

:global(.noteNode .contentCard) {
  flex: 1;
  min-height: 0;
  border: none;
  border-radius: 10px;
  background: var(--note-bg, #fff5b8);
  box-shadow: 0 2px 6px rgb(0 0 0 / 12%);
}

:global(.noteNode .contentCard.selected) {
  outline: 2px solid var(--el-color-primary);
  outline-offset: -1px;
}

:global(.noteNode .contentCard .el-card__body) {
  height: 100%;
  padding: 0 !important;
}

.noteToolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-radius: 10px;
  background: var(--el-bg-color-overlay);
  box-shadow: var(--el-box-shadow-light);

  .swatch {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    padding: 0;
    border: 1px solid rgb(0 0 0 / 15%);
    border-radius: 50%;
    color: rgb(0 0 0 / 65%);
    cursor: pointer;

    &.active {
      box-shadow: 0 0 0 2px var(--el-color-primary);
    }
  }

  .toolbarDivider {
    width: 1px;
    height: 18px;
    background: var(--el-border-color);
  }

  .textColorTrigger {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 4px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--el-text-color-regular);
    font-size: 12px;
    cursor: pointer;

    &:hover {
      background: var(--el-fill-color-light);
    }
  }
}

// ACT: 字色下拉默认 teleport 到 body，祖先选择器失效，色点必须放在顶层才能命中。
.dot {
  display: inline-block;
  width: 12px;
  height: 12px;
  border: 1px solid rgb(0 0 0 / 15%);
  border-radius: 50%;
}

.noteBody {
  position: relative;
  box-sizing: border-box;
  height: 100%;
  padding: 10px 12px;
}

.noteText,
.noteEditor {
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 0;
  color: var(--note-color, #1f1f1f);
  font-family: inherit;
  font-size: 14px;
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.noteText {
  overflow: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
}

.noteEditor {
  border: none;
  outline: none;
  background: transparent;
  resize: none;
  overflow: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
}

// ACT: 便签正文要窄滚动条，避免默认 12–17px 占掉卡片宽度。
.noteText::-webkit-scrollbar,
.noteEditor::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

.noteText::-webkit-scrollbar-thumb,
.noteEditor::-webkit-scrollbar-thumb {
  border-radius: 3px;
  background: rgb(0 0 0 / 20%);
}

.placeholder {
  opacity: 0.45;
  user-select: none;
}

.resizeCorner {
  position: absolute;
  width: 12px;
  height: 12px;
  padding: 0;
  border: 1px solid var(--el-color-primary);
  border-radius: 2px;
  background: var(--el-bg-color);
  opacity: 0.9;
  touch-action: none;

  &.topLeft { top: 2px; left: 2px; cursor: nwse-resize; }
  &.topRight { top: 2px; right: 2px; cursor: nesw-resize; }
  &.bottomLeft { bottom: 2px; left: 2px; cursor: nesw-resize; }
  &.bottomRight { bottom: 2px; right: 2px; cursor: nwse-resize; }
}
</style>
