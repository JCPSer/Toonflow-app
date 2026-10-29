<template>
  <div v-if="documentTarget" class="nodeDocumentPlaceholder" :style="canvasSize" aria-hidden="true" />
  <teleport :to="documentTarget ?? 'body'" :disabled="!documentTarget">
  <div ref="skeletonElement" v-bind="$attrs" class="nodeSkeleton" :class="{ documentNode: documentTarget, running: ringActive }" @wheel.capture="zoomCanvas" @dblclick.stop="focusNode" @contextmenu="documentTarget && openMenu($event)">
    <el-dropdown
      v-if="!readOnly"
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
          <el-dropdown-item v-if="assetOutputs.length && saveNodeToAssets" command="saveAsset" :icon="IconFolderPlus">保存到素材库</el-dropdown-item>
          <el-dropdown-item :divided="!!(assetOutputs.length && saveNodeToAssets)" command="copy" :icon="IconCopy">复制节点</el-dropdown-item>
          <el-dropdown-item command="duplicate" :icon="IconCopyPlus">创建副本</el-dropdown-item>
          <el-dropdown-item command="delete" :icon="IconTrash">删除节点</el-dropdown-item>
          <el-dropdown-item divided command="clipboard" :icon="IconCopy" :disabled="!copyNodeToClipboard || copyingToClipboard">
            复制到剪贴板
          </el-dropdown-item>
        </el-dropdown-menu>
      </template>
    </el-dropdown>
    <div
      v-if="!readOnly && (documentTarget || (topVisible && slotsVisible))"
      class="floatingSlot topSlot nodrag nopan nowheel"
      :style="{ width: typeof topWidth === 'number' ? `${topWidth}px` : topWidth }"
      @pointerdown.stop
      @mousedown.stop
      @dblclick.stop
      @keydown.stop
      @contextmenu.stop>
      <slot name="top">
        <el-card class="mediaToolbar" shadow="never" :bodyStyle="{ padding: '6px' }">
          <el-button
            :icon="IconFolderPlus"
            :disabled="!assetOutputs.length || !saveNodeToAssets"
            text
            title="添加到素材库"
            aria-label="添加到素材库"
            @click.stop="handleCommand('saveAsset')">添加到素材库</el-button>
          <el-button
            v-if="nodeAgentContext && !documentTarget"
            :icon="IconAt"
            :loading="addingToAgentContext"
            :disabled="addingToAgentContext"
            text
            :title="hasAgentContextOutput ? '将该节点的输出加入右侧 Agent 对话上下文' : '该节点暂无输出，将该节点本身加入右侧 Agent 对话上下文'"
            aria-label="加入对话上下文"
            data-node-agent-context
            @pointerdown.stop
            @mousedown.stop
            @dblclick.stop
            @click.stop="addToAgentContext">加入对话</el-button>
          <slot name="topActions" />
          <el-divider direction="vertical" />
          <slot name="topRightActions" />
          <el-button
            :tag="downloadUrl || !downloadResolver ? 'a' : 'button'"
            :href="downloadUrl || undefined"
            :download="downloadName"
            :icon="IconDownload"
            :disabled="!downloadUrl && !downloadResolver"
            :loading="downloading"
            :aria-busy="downloading"
            text
            :title="downloading ? '正在保存…' : '下载'"
            aria-label="下载"
            @downloadstate="downloading = $event.detail"
            @click.stop="!downloadUrl && downloadResolver && downloadNow()" />
          <el-button
            v-if="fullscreenVisible"
            :icon="IconMaximize"
            :disabled="!downloadUrl && !downloadResolver"
            text
            title="全屏"
            aria-label="全屏"
            @click.stop="!downloadUrl && downloadResolver ? openFullscreen() : emit('fullscreen')" />
        </el-card>
      </slot>
    </div>
    <div
      v-if="!readOnly && $slots.bottom && (documentTarget || bottomPinned || (bottomVisible && slotsVisible))"
      class="floatingSlot bottomSlot nodrag nopan nowheel"
      :style="{ width: typeof bottomWidth === 'number' ? `${bottomWidth}px` : bottomWidth }"
      @pointerdown.stop
      @mousedown.stop
      @dblclick.stop
      @keydown.stop
      @contextmenu.stop>
      <slot name="bottom" />
    </div>
    <div v-show="!documentTarget" class="titleBar">
      <component :is="icon ?? IconBox" class="titleIcon" :size="16" aria-hidden="true" />
      <input
        v-if="editingLabel && !readOnly"
        ref="labelInput"
        v-model="labelDraft"
        class="labelInput nodrag nopan"
        aria-label="节点名称"
        @pointerdown.stop
        @mousedown.stop
        @dblclick.stop
        @keydown.stop
        @keydown.enter="confirmLabel"
        @keydown.esc.prevent="editingLabel = false"
        @blur="saveLabel" />
      <span
        v-else
        class="labelText"
        :tabindex="readOnly ? undefined : 0"
        :title="readOnly ? label : `${label}（双击编辑名称）`"
        @dblclick="!readOnly && ($event.stopPropagation(), editLabel())"
        @keydown.enter.stop.prevent="editLabel">
        {{ label }}
      </span>
      <div v-if="!readOnly" class="nodeActions nodrag nopan" @pointerdown.stop @mousedown.stop @dblclick.stop>
        <el-button
          :icon="IconRefresh"
          :loading="loading || reloading"
          :disabled="loading || !reloadRemoteNode"
          text
          title="刷新节点"
          aria-label="刷新节点"
          @click.stop="reloadNode" />
        <el-button :icon="IconTrash" text title="移除节点" aria-label="移除节点" @click.stop="deleteNode" :loading="deleting" />
      </div>
    </div>
    <div class="cardContainer">
      <el-card
        class="contentCard"
        :class="{ selected: node.selected }"
        shadow="never"
        :bodyStyle="{ padding: '8px' }"
        :style="{ minHeight: `${cardHeight}px` }">
        <div v-if="loading" class="loadingContent" role="status" aria-label="节点加载中">
          <icon-loader2 class="loadingIcon" :size="24" aria-hidden="true" />
          <span>加载中...</span>
        </div>
        <slot v-else-if="previewReady || documentTarget" />
      </el-card>
      <template v-for="group in handleGroups" :key="group.type">
        <handle
          v-for="(item, index) in group.items"
          :id="item.id"
          :key="item.id"
          v-show="!documentTarget"
          class="nodeHandle"
          :class="{
            connected: isHandleConnected(item),
            connectedNodeActive: isHandleNodeActive(item),
            linking: localStartHandle?.id === item.id && localStartHandle.type === group.type,
          }"
          :type="group.type"
          :connectable="!readOnly && !loading"
          :position="group.position"
          :isValidConnection="validateConnection"
          :data-connection-status="getHandleStatus(item)"
          :style="{ top: `${((index + 1) / (group.items.length + 1)) * 100}%` }"
          :title="`${item.label ?? item.id} · ${Array.isArray(item.dataType) ? item.dataType.join(' / ') : item.dataType}`"
          :aria-label="`${item.label ?? item.id} · ${Array.isArray(item.dataType) ? item.dataType.join(' / ') : item.dataType}`"
          @pointermove="moveHandle"
          @pointerleave="resetHandle"
          @pointercancel="resetHandle">
          <component :is="isHandleConnected(item) ? IconCircleDot : IconCircleDashed" class="handleIcon" :size="18" aria-hidden="true" />
        </handle>
      </template>
      <!-- ACT: 角标相对 cardContainer 定位（只包住卡片），bottom:100% 才正好停在卡片上边框之外；
           挂在节点根层会把标题栏高度也算进去，导致偏离卡片约 28px。
           计时隔离在 durationBadge 内部，避免每秒重渲染时连带 <slot> 的节点内容一起重建。 -->
      <durationBadge v-if="!documentTarget" class="durationBadge" :busy="busy" :active="!documentTarget" />
    </div>
  </div>
  </teleport>
</template>

<script setup lang="ts">
import { computed, inject, nextTick, onScopeDispose, ref, shallowRef, watch, watchEffect, type Component, type ShallowRef } from "vue";
import { Handle, Position, getTransformForBounds, pointToRendererPoint, useNode, useVueFlow, wheelDelta } from "@vue-flow/core";
import {
  IconRefresh,
  IconTrash,
  IconCopy,
  IconCopyPlus,
  IconFolderPlus,
  IconDownload,
  IconMaximize,
  IconBox,
  IconCircleDashed,
  IconCircleDot,
  IconLoader2,
  IconAt,
} from "@tabler/icons-vue";
import { ElCard, ElButton, ElDivider, ElDropdown, ElDropdownMenu, ElDropdownItem, ElMessage } from "element-plus";
import type { DropdownInstance } from "element-plus";
import { validateConnection } from "./connection";
import { useNodeEvent } from "./nodeEvent";
import { clearNodeBusy, markNodeBusy } from "./nodeBusy";
import durationBadge from "./durationBadge.vue";
import type { NodeConnectionFeedback, NodeData, NodeHandle } from "./connection";
import { isNodeOutput, type NodeOutput } from "./values";
import type { NodeDocumentContext } from "./nodeDocument";

defineOptions({ inheritAttrs: false });

const topVisible = defineModel<boolean>("topVisible", { default: false });
const bottomVisible = defineModel<boolean>("bottomVisible", { default: false });
const emit = defineEmits<{ fullscreen: [] }>();
const downloading = ref(false);
const props = withDefaults(
  defineProps<
    NodeData & {
      icon?: Component;
      loading?: boolean;
      readOnly?: boolean;
      previewReady?: boolean;
      /** 生成/思考中：卡片呼吸描边，提示节点仍在运行。 */
      running?: boolean;
      /** ACT: 正在跑耗时任务（AI 生成、帧分析、导出等）：卡片右上角显示运行时长。与 running 解耦。 */
      busy?: boolean;
      topWidth?: string | number;
      bottomWidth?: string | number;
      downloadUrl?: string;
      downloadName?: string;
      /** ACT: 按需下载/全屏——媒体节点未播放前不持有 Blob，点击时再向节点要地址。 */
      downloadResolver?: () => Promise<string>;
      fullscreenResolver?: () => Promise<void>;
      fullscreenVisible?: boolean;
      /** ACT: 生成中钉住底栏，避免取消选中/多选/拖拽时底栏被卸载导致无法停止。 */
      bottomPinned?: boolean;
    }
  >(),
  {
    label: "未命名节点",
    handles: () => [],
    outputs: () => ({}),
    previewReady: true,
    readOnly: false,
    running: false,
    busy: false,
    fullscreenVisible: true,
    bottomPinned: false,
    topWidth: "20vw",
    bottomWidth: "20vw",
  }
);
// ACT: 媒体节点未播放时不持有 Blob，下载/全屏按钮点击时才向节点索取真实地址。
async function downloadNow() {
  if (!props.downloadResolver) return;
  downloading.value = true;
  try {
    const href = await props.downloadResolver();
    if (!href) return;
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = props.downloadName ?? "";
    anchor.rel = "noopener";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  } catch (error) {
    console.warn("下载失败", error);
  } finally {
    downloading.value = false;
  }
}

async function openFullscreen() {
  if (!props.fullscreenResolver) return void emit("fullscreen");
  try { await props.fullscreenResolver(); }
  catch (error) { console.warn("全屏失败", error); }
}

const handleGroups = computed(() => [
  { type: "target" as const, position: Position.Left, items: props.handles.filter((item) => item.type === "target") },
  { type: "source" as const, position: Position.Right, items: props.handles.filter((item) => item.type === "source") },
]);
const cardHeight = computed(() => Math.max(100, ...handleGroups.value.map((group) => (group.items.length + 1) * 44)));
const { id: nodeId, node } = useNode();
// ACT: 把 busy 登记到全局表，画布据此判断切换/退出项目是否会中断正在跑的任务。
let busyReported = false;
watch(() => props.busy, (busy) => {
  if (busy === busyReported) return;
  busyReported = busy;
  markNodeBusy(nodeId, busy);
}, { immediate: true });
onScopeDispose(() => {
  if (!busyReported) return;
  busyReported = false;
  clearNodeBusy(nodeId);
});
// ACT: 呼吸描边对所有节点统一生效——节点包只要上报 busy（生成、转写、导出、裁剪、上传、打光等）
// 就算在跑；再留 running 作为显式入口，两种来源取并集。延迟 400ms 再亮，
// 避免裁剪、上传这类一闪而过的操作闪一下又消失；亮起后至少保持 600ms，
// 否则 500ms 的操作会在第 400ms 亮、第 500ms 灭，看起来更像闪屏而不是「在工作」。
const RING_DELAY_MS = 400;
const RING_MIN_ON_MS = 600;
const ringActive = ref(false);
let ringTimer: ReturnType<typeof setTimeout> | undefined;
let ringStartedAt = 0;
watch([() => props.busy, () => props.running], ([busy, running]) => {
  clearTimeout(ringTimer);
  if (busy || running) {
    ringTimer = setTimeout(() => {
      ringActive.value = true;
      ringStartedAt = performance.now();
    }, RING_DELAY_MS);
    return;
  }
  if (!ringActive.value) return;
  const remain = RING_MIN_ON_MS - (performance.now() - ringStartedAt);
  if (remain <= 0) {
    ringActive.value = false;
    return;
  }
  ringTimer = setTimeout(() => { ringActive.value = false; }, remain);
}, { immediate: true });
onScopeDispose(() => clearTimeout(ringTimer));
const documentContext = inject<NodeDocumentContext | undefined>("nodeDocument", undefined);
const documentTarget = computed(() => props.readOnly ? undefined : documentContext?.targets.get(nodeId));
const skeletonElement = ref<HTMLElement>();
const canvasSize = shallowRef<{ width: string; height: string }>();
let documentLease: symbol | undefined;
function mountDocument(target: HTMLElement) {
  if (props.readOnly) throw new Error("只读节点不能挂载到工作区文档");
  const element = skeletonElement.value;
  if (!documentContext || !element || !target.isConnected) throw new Error("节点视图尚未就绪");
  if (!documentTarget.value) canvasSize.value = {
    width: `${element.offsetWidth || node.dimensions.width || 220}px`,
    height: `${element.offsetHeight || node.dimensions.height || 128}px`,
  };
  const lease = Symbol();
  documentLease = lease;
  // ACT: 只移动原节点的界面，保留画布中的运行实例和尺寸；同一节点仅允许一个文档显示位置。
  documentContext.targets.set(nodeId, target);
  return () => {
    if (documentLease !== lease) return;
    documentLease = undefined;
    documentContext.targets.delete(nodeId);
    void nextTick(() => {
      if (!documentTarget.value) updateNodeInternals([nodeId]);
    });
  };
}
watch(() => props.loading, loading => {
  if (props.readOnly) return;
  if (loading) {
    if (documentContext?.mounts.get(nodeId) === mountDocument) documentContext.mounts.delete(nodeId);
  } else documentContext?.mounts.set(nodeId, mountDocument);
}, { immediate: true });
onScopeDispose(() => {
  documentLease = undefined;
  if (documentContext?.mounts.get(nodeId) !== mountDocument) return;
  documentContext.mounts.delete(nodeId);
  documentContext.targets.delete(nodeId);
});
const selectionConnection = inject<ShallowRef<NodeConnectionFeedback | undefined> | undefined>("selectionConnection", undefined);const nodeEvent = useNodeEvent();
if (!props.readOnly) node.isValidTargetPos = (...args) => !props.readOnly && nodeEvent.emit("canConnect", ...args);
const {
  d3Zoom,
  d3Selection,
  zoomActivationKeyCode,
  zoomOnPinch,
  setViewport,
  minZoom,
  maxZoom,
  viewport,
  vueFlowRef,
  addNodes,
  addEdges,
  toObject,
  getNodes,
  getSelectedNodes,
  findNode,
  addSelectedNodes,
  removeSelectedElements,
  removeNodes,
  removeEdges,
  updateNodeInternals,
  connectionLookup,
  snapToGrid,
  snapGrid,
  connectionStartHandle,
  connectionEndHandle,
  connectionStatus,
  onPaneClick,
  onPaneContextMenu,
  onSelectionContextMenu,
  onConnectStart,
  onMoveStart,
  onNodeContextMenu,
  onNodeDragStart,
  onNodeClick,
  onSelectionStart,
} = useVueFlow();
const localStartHandle = computed(() => (connectionStartHandle.value?.nodeId === nodeId ? connectionStartHandle.value : undefined));
const localEndHandle = computed(() => (connectionEndHandle.value?.nodeId === nodeId ? connectionEndHandle.value : undefined));
const localSelectionConnection = computed(() => (selectionConnection?.value?.nodeId === nodeId ? selectionConnection.value : undefined));
const connectedHandles = computed<Set<string>>((previous) => {
  const connected = new Set(
    props.handles.filter((item) => connectionLookup.value.get(`${nodeId}-${item.type}-${item.id}`)?.size).map((item) => `${item.type}-${item.id}`)
  );
  return previous?.size === connected.size && [...connected].every((key) => previous.has(key)) ? previous : connected;
});

async function focusNode(event: MouseEvent) {
  if (documentTarget.value) return;
  const element = event.currentTarget as HTMLElement;
  await nextTick();
  const flowElement = vueFlowRef.value;
  if (!flowElement || !element.isConnected) return;
  const flowRect = flowElement.getBoundingClientRect();
  const agentWidth = Math.max(0, parseFloat(getComputedStyle(flowElement).getPropertyValue("--agentWidth")) || 0);
  const availableWidth = flowRect.width - agentWidth;
  if (availableWidth <= 0 || flowRect.height <= 0) return;
  const rects = [element, ...element.querySelectorAll<HTMLElement>(":scope > .floatingSlot")]
    .filter((item) => item.getClientRects().length)
    .map((item) => item.getBoundingClientRect());
  const left = Math.min(...rects.map((rect) => rect.left));
  const top = Math.min(...rects.map((rect) => rect.top));
  const origin = pointToRendererPoint({ x: left - flowRect.left, y: top - flowRect.top }, viewport.value);
  const targetViewport = getTransformForBounds(
    {
      ...origin,
      width: (Math.max(...rects.map((rect) => rect.right)) - left) / viewport.value.zoom,
      height: (Math.max(...rects.map((rect) => rect.bottom)) - top) / viewport.value.zoom,
    },
    availableWidth, flowRect.height, minZoom.value, maxZoom.value, 0.2
  );
  await setViewport(targetViewport, { duration: 300 });
}

function zoomCanvas(event: WheelEvent) {
  if (documentTarget.value) return;
  if (document.fullscreenElement) return;
  if (!(zoomActivationKeyCode.value === true || (event.ctrlKey && zoomOnPinch.value)) || !d3Zoom.value || !d3Selection.value) return;
  const bounds = d3Selection.value.node()?.getBoundingClientRect();
  if (!bounds) return;
  event.preventDefault();
  event.stopPropagation();
  d3Zoom.value.scaleBy(d3Selection.value, 2 ** wheelDelta(event), [event.clientX - bounds.left, event.clientY - bounds.top]);
}

const slotsHiddenByInteraction = ref(false);
// ACT: 多选只操作节点；未选中的节点仍可通过 v-model 主动打开槽位。
const slotsVisible = computed(() => !slotsHiddenByInteraction.value && (!node.selected || getSelectedNodes.value.length <= 1));
onSelectionStart(() => {
  slotsHiddenByInteraction.value = true;
});
onNodeDragStart(({ nodes }) => {
  if (nodes.some((item) => item.id === nodeId)) slotsHiddenByInteraction.value = true;
});
onNodeClick(({ node: clickedNode }) => {
  if (clickedNode.id === nodeId) slotsHiddenByInteraction.value = false;
});
const editingLabel = ref(false);
const labelDraft = ref("");
const labelInput = ref<HTMLInputElement>();


const reloadRemoteNode = inject<((type: string) => Promise<void>) | undefined>("reloadRemoteNode", undefined);
const reloading = ref(false);
const deleting = ref(false);
const menu = ref<DropdownInstance>();
const menuAnchor = shallowRef({ getBoundingClientRect: () => new DOMRect() });
onPaneClick(() => menu.value?.handleClose());
onPaneContextMenu(() => menu.value?.handleClose());
onSelectionContextMenu(() => menu.value?.handleClose());
onConnectStart(() => menu.value?.handleClose());
onMoveStart(() => menu.value?.handleClose());
onNodeContextMenu(({ event, node }) => {
  if (node.id === nodeId) void openMenu(event);
  else menu.value?.handleClose();
});

async function reloadNode() {
  if (props.readOnly || !reloadRemoteNode || reloading.value) return;
  reloading.value = true;
  try {
    await reloadRemoteNode(node.type);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "节点刷新失败");
  } finally {
    reloading.value = false;
  }
}

async function openMenu(event: MouseEvent | TouchEvent) {
  if (props.readOnly) return;
  event.preventDefault();
  if (documentTarget.value) event.stopPropagation();
  menu.value?.handleClose();
  const point = "changedTouches" in event ? event.changedTouches[0] : event;
  if (!point) return;
  menuAnchor.value = { getBoundingClientRect: () => new DOMRect(point.clientX, point.clientY, 0, 0) };
  await nextTick();
  menu.value?.handleOpen();
}

async function deleteNode() {
  if (props.readOnly || deleting.value) return;
  deleting.value = true;
  try {
    await nodeEvent.emit("delete");
    removeNodes(nodeId);
  } catch (error) {
    const message = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
    ElMessage.error(message || (error instanceof Error ? error.message : "节点删除失败"));
  } finally {
    deleting.value = false;
  }
}

const copyNodeToClipboard = inject<((node: { type?: string; data: NodeData }) => Promise<void>) | undefined>("copyNodeToClipboard", undefined);
const copyingToClipboard = ref(false);
const saveNodeToAssets = inject<((label: string, outputs: { label: string; output: NodeOutput }[]) => void) | undefined>(
  "saveNodeToAssets",
  undefined
);
const assetOutputs = computed(() =>
  props.handles.flatMap((handle) => {
    const output = props.outputs[handle.id];
    if (handle.type !== "source" || !output || (output.dataType === "STRING" && !output.value.trim())) return [];
    return [{ label: handle.label ?? handle.id, output }];
  })
);
// ACT: 快捷加入对话上下文的能力由画布注入；插件或独立使用时未注入则不渲染按钮。
const nodeAgentContext = inject<((nodeId: string, anchor: HTMLElement) => Promise<void> | void) | undefined>("nodeAgentContext", undefined);
const addingToAgentContext = ref(false);
// ACT: 与提及解析保持一致：文本需非空，媒体输出由 isNodeOutput 校验 url 与 mimeType。
const hasAgentContextOutput = computed(() =>
  Object.values(props.outputs).some((output) =>
    !!output && isNodeOutput(output) && (output.dataType !== "STRING" || !!output.value.trim())
  )
);

async function addToAgentContext(event: MouseEvent) {
  // ACT: 没有可用输出也能加入上下文——画布侧会改为插入「节点引用」，只带节点身份。
  if (!nodeAgentContext || addingToAgentContext.value) return;
  addingToAgentContext.value = true;
  try {
    await nodeAgentContext(nodeId, event.currentTarget as HTMLElement);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "加入对话上下文失败");
  } finally {
    addingToAgentContext.value = false;
  }
}

async function handleCommand(command: string) {
  if (props.readOnly) return;
  if (command === "saveAsset") saveNodeToAssets?.(props.label, assetOutputs.value);
  if (command === "clipboard" && copyNodeToClipboard && !copyingToClipboard.value) {
    copyingToClipboard.value = true;
    try {
      const patch = await nodeEvent.emit("copy");
      const data = { ...node.data, ...patch };
      await copyNodeToClipboard({ type: node.type, data });
      ElMessage.success("已复制到剪贴板");
    } catch (error) {
      ElMessage.error(error instanceof Error ? error.message : "节点复制失败");
    } finally {
      copyingToClipboard.value = false;
    }
  }
  if (command === "delete") void deleteNode();
  if (command === "copy" || command === "duplicate") {
    let data: NodeData;
    try {
      const patch = await nodeEvent.emit("copy");
      data = JSON.parse(JSON.stringify({ ...node.data, ...patch }));
    } catch (error) {
      ElMessage.error(error instanceof Error ? error.message : "节点复制失败");
      return;
    }
    if (findNode(nodeId) !== node) return;
    const id = crypto.randomUUID();
    const incomingEdges = command === "duplicate" ? toObject().edges.filter((edge) => edge.target === nodeId) : [];
    const copyPosition = { x: node.position.x, y: node.position.y + node.dimensions.height + 32 };
    const nearbyNodes = getNodes.value
      .filter(
        (item) =>
          item.parentNode === node.parentNode &&
          item.position.x < copyPosition.x + node.dimensions.width &&
          item.position.x + item.dimensions.width > copyPosition.x
      )
      .sort((a, b) => a.position.y - b.position.y);
    for (const item of nearbyNodes) {
      if (copyPosition.y < item.position.y + item.dimensions.height + 32 && copyPosition.y + node.dimensions.height + 32 > item.position.y)
        copyPosition.y = item.position.y + item.dimensions.height + 32;
    }
    // ACT: 副本位置是按节点实测高度算的，几乎必然带小数；这里吸附一次，
    // 否则「创建副本」每次都会留下一个贴不到网格上的节点。
    if (snapToGrid.value) {
      const [gridX, gridY] = snapGrid.value ?? [16, 16];
      copyPosition.x = Math.round(copyPosition.x / gridX) * gridX;
      copyPosition.y = Math.round(copyPosition.y / gridY) * gridY;
    }
    removeSelectedElements();
    addNodes({
      id,
      zIndex: node.zIndex,
      type: node.type,
      position: copyPosition,
      data: { ...data, label: `${props.label} - 副本` },
      parentNode: node.parentNode,
    });
    await nextTick();
    addSelectedNodes([findNode(id)!]);
    addEdges(incomingEdges.map((edge) => ({ ...JSON.parse(JSON.stringify(edge)), id: crypto.randomUUID(), target: id, selected: false })));
  }
}

async function editLabel() {
  if (props.readOnly) return;
  labelDraft.value = props.label;
  editingLabel.value = true;
  await nextTick();
  labelInput.value?.select();
}

function saveLabel() {
  if (props.readOnly || !editingLabel.value) return;
  const label = labelDraft.value.trim();
  if (label) node.data.label = label;
  editingLabel.value = false;
}

function confirmLabel(event: KeyboardEvent) {
  if (props.readOnly || event.isComposing) return;
  event.preventDefault();
  saveLabel();
}

function moveHandle(event: PointerEvent) {
  if (event.pointerType === "touch") return;
  const element = event.currentTarget as HTMLElement;
  const rect = element.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  // 以 Handle 中心为原点，按画布缩放还原距离，限制总偏移半径为 6px。
  const x = ((event.clientX - rect.left - rect.width / 2) / rect.width) * 18;
  const y = ((event.clientY - rect.top - rect.height / 2) / rect.height) * 18;
  const strength = Math.min(0.3, 6 / (Math.hypot(x, y) || 1));
  element.style.setProperty("--handleX", `${x * strength}px`);
  element.style.setProperty("--handleY", `${y * strength}px`);
}

function resetHandle(event: PointerEvent) {
  const element = event.currentTarget as HTMLElement;
  element.style.removeProperty("--handleX");
  element.style.removeProperty("--handleY");
}

function isHandleConnected(item: NodeHandle) {
  return connectedHandles.value.has(`${item.type}-${item.id}`);
}

function isHandleNodeActive(item: NodeHandle) {
  const connections = connectionLookup.value.get(`${nodeId}-${item.type}-${item.id}`);
  if (!connections?.size) return false;
  if (node.selected || node.dragging) return true;
  for (const connection of connections.values()) {
    const otherNode = findNode(item.type === "source" ? connection.target : connection.source);
    if (otherNode?.selected || otherNode?.dragging) return true;
  }
  return false;
}

function getHandleStatus(item: NodeHandle) {
  const selection = localSelectionConnection.value;
  if (selection?.handles.some((handle) => handle.id === item.id && handle.type === item.type)) return selection.status;
  const target = localEndHandle.value;
  return target?.id === item.id && target.type === item.type ? connectionStatus.value : null;
}

watchEffect(() => {
  if (props.readOnly || props.loading) return;
  // 仅同步端口快照供跨节点校验；端口状态由具体 node 维护。
  if (JSON.stringify(node.data.handles) !== JSON.stringify(props.handles)) node.data.handles = props.handles.map((item) => ({ ...item }));
});
watchEffect(() => {
  if (props.readOnly || props.loading) return;
  // 输出由 node 持有，画布仅共享当前值；不使用 JSON 比较或触发端口重测。
  node.data.outputs = props.outputs;
});
// 比较内容，避免内联数组的新引用触发渲染循环。
watch(
  () => JSON.stringify([props.label, props.handles, props.readOnly]),
  () => {
    if (props.readOnly || props.loading) return;
    removeEdges((edges) =>
      edges.filter(
        (edge) =>
          (edge.source === nodeId && !props.handles.some((item) => item.type === "source" && item.id === edge.sourceHandle)) ||
          (edge.target === nodeId && !props.handles.some((item) => item.type === "target" && item.id === edge.targetHandle))
      )
    );
    if (!documentTarget.value) updateNodeInternals([nodeId]);
  },
  { flush: "post" }
);
</script>

<style scoped>
.nodeSkeleton {
  position: relative;
  width: 220px;
  color: var(--el-text-color-primary);
  text-align: left;

  &.documentNode {
    display: flex;
    flex-direction: column;
    gap: 16px;
    width: 100% !important;
    min-width: 0;

    .floatingSlot {
      position: static;
      width: 100% !important;
      transform: none;

      &.topSlot { order: 0; }
      &.bottomSlot { order: 2; }
    }

    .cardContainer {
      order: 1;
      min-width: 0;
    }
  }

  &:hover .cardContainer .nodeHandle .handleIcon {
    opacity: 1;
  }

  &:hover .titleBar .nodeActions {
    visibility: visible;
  }

  .floatingSlot {
    position: absolute;
    left: 50%;
    z-index: 2;
    transform: translateX(-50%);

    &.topSlot {
      bottom: calc(100% + 12px);
    }
    &.bottomSlot {
      top: calc(100% + 12px);
    }

    .mediaToolbar {
      &:deep(.el-button) {
        width: auto;
        min-width: 32px;
        height: 32px;
        margin: 0;
        padding: 0 8px;
        text-decoration: none;
      }
    }
  }

  .titleBar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 4px 8px;
    font-size: 14px;
    line-height: 20px;

    .titleIcon {
      flex-shrink: 0;
    }

    .labelText {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      cursor: grab;
      user-select: none;

      &:active {
        cursor: grabbing;
      }
    }

    .labelInput {
      flex: 1;
      min-width: 0;
      width: 100%;
      padding: 0 4px;
      border: 1px solid var(--el-color-primary);
      border-radius: var(--el-border-radius-small);
      outline: none;
      background: var(--el-bg-color);
      color: inherit;
      font: inherit;
      line-height: inherit;
    }

    .nodeActions {
      visibility: hidden;
      display: flex;
      flex-shrink: 0;
      gap: 2px;

      .el-button {
        width: 24px;
        height: 24px;
        margin: 0;
        padding: 0;
      }
    }
  }

  .cardContainer {
    position: relative;

    /* ACT: 运行时长浮标相对卡片定位，bottom:100% 正好贴在卡片上边框之外；right:0 靠右上角向左凸，
       避开右侧输出端口（right:-12px）。因为整块都在卡片之外，v-loading 的遮罩覆盖不到它，
       无需抬高 z-index（那样反而会让角标越过相邻节点绘制）。
       pointer-events:none 保证不拦画布拖拽与滚轮。 */
    .durationBadge {
      position: absolute;
      right: 0;
      bottom: calc(100% + 3px);
      z-index: 2;
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      padding: 1px 6px;
      border: 1px solid var(--el-border-color);
      border-radius: 999px;
      background: var(--el-bg-color-overlay);
      color: var(--el-text-color-regular);
      font-size: 11px;
      font-variant-numeric: tabular-nums;
      line-height: 16px;
      white-space: nowrap;
      pointer-events: none;
      user-select: none;

      &.isDone {
        color: var(--el-text-color-secondary);
      }
    }

    .contentCard.selected {
      border-color: color-mix(in srgb, var(--el-color-primary) 50%, var(--el-border-color-light));
    }

    .contentCard .loadingContent {
      display: flex;
      min-height: 84px;
      align-items: center;
      justify-content: center;
      gap: 8px;
      color: var(--el-text-color-secondary);
      font-size: 12px;

      .loadingIcon {
        color: var(--el-color-primary);
        animation: nodeLoading 1s linear infinite;
        @media (prefers-reduced-motion: reduce) {
          animation: none;
        }
      }
    }

    .nodeHandle {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 18px;
      height: 18px;
      border: 0;
      background: transparent;
      color: var(--el-text-color-secondary);

      &.vue-flow__handle-left {
        left: -12px;
      }

      &.vue-flow__handle-right {
        right: -12px;
      }

      &::before {
        content: "";
        position: absolute;
        inset: -13px;
        border-radius: 50%;
      }

      .handleIcon {
        pointer-events: none;
        opacity: 0;
        transform: translate(var(--handleX, 0px), var(--handleY, 0px));
        transition: transform 120ms ease-out, opacity 120ms ease-out;
      }

      &.connected .handleIcon,
      &.linking .handleIcon,
      &.connecting .handleIcon,
      &[data-connection-status] .handleIcon {
        opacity: 1;
      }

      &:hover,
      &.linking,
      &.connecting,
      &[data-connection-status="valid"] {
        color: var(--el-color-primary);
      }

      &[data-connection-status="invalid"] {
        color: var(--el-color-danger);
        cursor: not-allowed;
      }

      @media (prefers-reduced-motion: reduce) {
        .handleIcon {
          transform: none;
          transition: none;
        }
      }
    }
  }
  /* R4: 生成/思考中给卡片加呼吸描边。只动 box-shadow，避免影响选中态 border-color 与节点尺寸。 */
  &.running .contentCard {
    animation: nodeRunning 1.6s ease-in-out infinite;
  }

  @media (prefers-reduced-motion: reduce) {
    &.running .contentCard {
      animation: none;
      box-shadow: 0 0 0 2px var(--el-color-primary-light-5);
    }
  }
}
@keyframes nodeLoading {
  to {
    transform: rotate(360deg);
  }
}
@keyframes nodeRunning {
  0%,
  100% {
    box-shadow: 0 0 0 2px var(--el-color-primary-light-5);
  }
  50% {
    box-shadow: 0 0 0 6px transparent;
  }
}
</style>
