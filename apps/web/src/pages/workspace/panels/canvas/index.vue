<template>
  <div
    ref="canvasElement"
    class="canvas"
    :class="{ edgesHidden: !showEdges, handMode, multiSelectionMode: flow.multiSelectionActive.value, compositingEnabled: generalSettings.canvasCompositingEnabled }"
    :style="{ '--canvasEdgeColor': generalSettings.canvasEdgeColorMode === 'custom' ? generalSettings.canvasEdgeColor : 'var(--el-color-primary)' }"
    @dblclick="openNodeMenu"
    @wheel.capture="zoomCanvas"
    @gesturestart.capture="zoomCanvas"
    @gesturechange.capture="zoomCanvas"
    @gestureend.capture="zoomCanvas"
    @pointerdown.capture="onCanvasPointerDown"
    @click.capture="updateCanvasSelection"
    @auxclick.capture="preventMiddleClick"
    @pointermove="pointerPosition = { x: $event.clientX, y: $event.clientY }; if (!$event.buttons) updateCanvasSelection($event)"
    @pointerleave="pointerPosition = undefined"
    @contextmenu.capture="forwardGroupContextMenu"
    @dragover="dragFilesOver"
    @drop="dropFiles">
    <vue-flow
      :id="runtimeKey"
      :only-render-visible-elements="false"
      :nodes-draggable="true"
      :node-types="nodeTypes"
      :snap-to-grid="snapEnabled"
      :snap-grid="[16, 16]"
      :min-zoom="0.2"
      :max-zoom="8"
      :nodes-connectable="true"
      :connection-mode="ConnectionMode.Strict"
      :nodes-focusable="false"
      :edges-focusable="false"
      :edges-updatable="false"
      :elevate-nodes-on-select="true"
      :elevate-edges-on-select="false"
      :disable-keyboard-a11y="true"
      :selectNodesOnDrag="false"
      :auto-pan-on-node-drag="false"
      :auto-pan-on-connect="false"
      :zoom-on-double-click="false"
      :zoomOnScroll="false"
      :zoomOnPinch="active && !settingsVisible"
      :panOnScroll="active && !settingsVisible && !defaultWheelZoom"
      :panOnScrollSpeed="1"
      :panOnDrag="handMode || isMobile ? true : defaultDragPan ? [0, 1] : [1]"
      :panOnScrollMode="PanOnScrollMode.Free"
      :delete-key-code="null"
      :selectionKeyCode="active && !settingsVisible && !handMode && !isMobile && selectionKeyPressed"
      :selectionMode="SelectionMode.Partial"
      :multi-selection-key-code="null"
      :zoomActivationKeyCode="zoomKeyPressed ? true : null"
      :pan-activation-key-code="null"
      v-model="flowData"
      @connect="addEdges"
      @edgeClick="showEdgeDisconnect"
      @paneClick="edgeDisconnect = undefined"
      @moveStart="edgeDisconnect = undefined"
      :default-edge-options="defaultEdgeOptions">
      <template v-for="type in remoteNodeTypes" :key="type" #[`node-${type}`]="nodeProps">
        <remoteNode
          v-bind="nodeProps"
          :component="nodeTypes[type]"
          :error="nodeErrors[type]"
          :loading="nodeLoads.has(type) || (nodeListLoading && !nodeTypes[type] && !nodeErrors[type])" />
      </template>
      <background :gap="16" pattern-color="var(--el-border-color)" />
      <canvasEmpty
        v-if="active && !settingsVisible && project?.directory && canvasReady && !flow.getNodes.value.length"
        :availableNodes="availableNodes"
        @create="createEmptyNode" />
      <canvasMenu ref="canvasMenuRef" v-model:canvasId="canvasId" :directory="project?.directory" :initialCanvasId="initialCanvasId" :activateCanvas="activateCanvas" :flushSave="flushCanvases ?? flushCanvasSave" />
      <canvasControls
        ref="canvasControlsRef"
        v-model:assetsVisible="assetsVisible"
        v-model:snapEnabled="snapEnabled"
        v-model:showEdges="showEdges"
        v-model:showMap="showMap"
        :active="active"
        :canvasId="canvasId"
        :directory="project?.directory"
        :batchHistory="canvasHistory.batch"
        @update:showEdges="edgeDisconnect = undefined" />
      <nodeMenu
        :key="JSON.stringify(['nodeMenu', project?.directory, canvasId])"
        ref="nodeMenuRef"
        :remoteNodes="availableNodes"
        :pasteNode="pasteClipboardNode"
        :uploadFiles="canvasId && project?.directory ? selectFiles : undefined"
        :canUndo="canUndo"
        :canRedo="canRedo"
        :selectionBusy="selectionToolbarRef?.busy"
        :batchHistory="canvasHistory.batch"
        @duplicateSelection="selectionToolbarRef?.operate('duplicate')"
        @history="canvasHistory.commit"
        @undo="changeHistory('undo')"
        @redo="changeHistory('redo')" />
      <selectionToolbar
        :key="JSON.stringify(['selectionToolbar', project?.directory, canvasId])"
        ref="selectionToolbarRef"
        :batchHistory="canvasHistory.batch"
        :getSignal="() => canvasController.signal"
        :disabled="!canvasId || !project?.directory" />
      <nodeSearch ref="nodeSearchRef" :disabled="!active || settingsVisible || !canvasId || !project?.directory" />
      <agentNodePanel
        ref="agentNodePanelRef"
        :runtime-key="runtimeKey"
        :active="active === true"
        :canvas-id="canvasId"
        :statuses="agentNodeStatuses" />
    </vue-flow>
    <teleport to="body">
      <div
        v-if="agentPortMenu"
        ref="agentPortMenuElement"
        class="agentPortMenu"
        role="menu"
        aria-label="选择输出端口"
        tabindex="-1"
        :style="{ left: `${agentPortMenu.x}px`, top: `${agentPortMenu.y}px` }"
        @pointerdown.stop
        @mousedown.stop
        @click.stop
        @keydown.stop="handleAgentPortMenuKeydown"
        @focusout="handleAgentPortMenuFocusOut">
        <div class="agentPortMenuTitle">{{ agentPortMenu.nodeLabel }}</div>
        <button
          v-for="(output, index) in agentPortMenu.outputs"
          :key="output.id"
          ref="agentPortMenuItems"
          type="button"
          role="menuitem"
          class="agentPortMenuItem"
          :class="{ active: index === agentPortMenu.index }"
          :disabled="!output.available"
          :aria-disabled="!output.available"
          @mouseenter="hoverAgentPortItem(index, output.available)"
          @click="chooseAgentOutput(output)">
          <mentionThumbnail class="agentPortThumbnail" :thumbnail="output.thumbnail" :directory="project?.directory">
            <component :is="agentOutputIcon(output.dataType)" :size="16" />
          </mentionThumbnail>
          <span class="agentPortText">
            <span class="agentPortName">{{ output.name }}</span>
            <span class="agentPortMeta">{{ output.dataType }}<template v-if="output.preview"> · {{ output.preview }}</template></span>
          </span>
          <span v-if="!output.available" class="agentPortEmpty">暂无内容</span>
        </button>
      </div>
    </teleport>
    <teleport to="body">
      <el-button
        v-if="edgeDisconnect && findEdge(edgeDisconnect.id)"
        class="edgeDisconnect"
        type="danger"
        circle
        aria-label="断开连接"
        title="断开连接"
        :style="{ left: `${edgeDisconnect.x}px`, top: `${edgeDisconnect.y}px` }"
        @click.stop="
          removeEdges(edgeDisconnect.id);
          edgeDisconnect = undefined;
        "
        @mouseleave="edgeDisconnect = undefined">
        <icon-unlink :size="16" />
      </el-button>
    </teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, markRaw, nextTick, onBeforeUnmount, onMounted, onScopeDispose, provide, reactive, ref, shallowReactive, shallowRef, watch } from "vue";
import axios from "axios";
import { debounce } from "lodash-es";
import { ElMessage } from "element-plus";
import { isMobile, isDesktop } from "@/lib/platform";
import { storeToRefs } from "pinia";
import { IconUnlink, IconFileText, IconPhoto, IconVideo, IconMusic, IconFile } from "@tabler/icons-vue";
import * as vueRuntime from "vue";
import * as vueFlowRuntime from "@vue-flow/core";
import * as elementPlusRuntime from "element-plus";
import * as threeRuntime from "three";
import { runAgentLoop } from "@earendil-works/pi-agent-core";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import "element-plus/dist/index.css";
import {
  VueFlow,
  PanOnScrollMode,
  ConnectionMode,
  SelectionMode,
  useVueFlow,
  wheelDelta,
  isMacOs,
  isNode,
  type Node,
  type Edge,
  type GraphEdge,
  type GraphNode,
  type EdgeMouseEvent,
  type NodeTypesObject,
  type XYPosition,
} from "@vue-flow/core";
import { Background } from "@vue-flow/background";
import { useCanvasTools } from "./useCanvasTools";
import type { CanvasContext } from "@toonflow/tool-canvas/runtime";
import { loadNodeComponent } from "./loadNodeComponent";
import { pauseMediaIn } from "@/lib/mediaPlayback";
import { useCanvasHistory } from "./useCanvasHistory";
import { copyNodeToClipboard, copyNodesToClipboard, nodeClipboardCommand, readClipboardNodes } from "./nodeClipboard";
import { readClipboardFiles, readClipboardText, writeClipboardImage } from "@/lib/clipboard";
import nodeMenu from "./components/nodeMenu.vue";
import remoteNode from "./components/remoteNode.vue";
import canvasMenu from "./components/canvasMenu.vue";
import canvasControls from "./components/canvasControls.vue";
import canvasEmpty from "./components/canvasEmpty.vue";
import { useAssetLibraryStore } from "@/stores/assetLibrary";
import { useSessionStateStore } from "@/stores/sessionState";
import groupNode from "./components/groupNode.vue";
import selectionToolbar from "./components/selectionToolbar.vue";
import nodeSearch from "./components/nodeSearch.vue";
import agentNodePanel from "./components/agentNodePanel.vue";
import mentionThumbnail from "@/components/agent/mentionThumbnail.vue";
import { useMentionSources, type MentionOutput } from "@/components/agent/mentionSources";
import { useAgentComposerStore } from "@/stores/agentComposer";
import { finishGroupDrag, getSelectionTree } from "./selectionNodes";
import type { NodeOutput } from "@toonflow/nodes-scaffold/values";
import type { NodeConnectionFeedback, NodeHandle } from "@toonflow/nodes-scaffold/connection";
import { useNodeEvent } from "@toonflow/nodes-scaffold/nodeEvent";
import { AGENT_NODE_STATUS_KEY, type AgentNodeStatus } from "@toonflow/nodes-scaffold/agentNode";
import type { NodeDocumentContext, NodeDocumentState } from "@toonflow/nodes-scaffold/nodeDocument";
import { useNodeToolsContext } from "@toonflow/nodes-scaffold/nodeTools";
import { useWorkspaceStore } from "@/stores/workspace";
import { generalSettings } from "@/stores/settings";
import { getShortcutBindings, shortcutLabel, shortcutMatches, shortcutPressed } from "@/lib/canvasShortcuts";
import useWorkspaceFiles from "@/lib/workspaceFiles";
import anonymousData from "@/lib/anonymousData";
import { createClipboardMediaFile, dropCanvasFiles, getClipboardMediaFiles, importCanvasFiles, isCanvasFileDrag } from "./canvasDrop";
import "@vue-flow/core/dist/style.css";
import "@vue-flow/core/dist/theme-default.css";
import "@vue-flow/minimap/dist/style.css";

const props = withDefaults(defineProps<{
  active?: boolean;
  settingsVisible?: boolean;
  runtimeKey?: string;
  initialCanvasId?: string;
  activateCanvas?: (canvasId: string, signal?: AbortSignal) => Promise<void>;
  resolveCanvasContext?: (canvasId: string) => CanvasContext | undefined;
  flushCanvases?: (action?: () => Promise<void>) => Promise<void>;
}>(), { active: true, settingsVisible: false });
const { project } = storeToRefs(useWorkspaceStore());

const canvasElement = ref<HTMLElement>();
const flowData = ref<(Node | Edge)[]>([]);
const canvasId = ref("");
const nodeMenuRef = ref<InstanceType<typeof nodeMenu>>();
const canvasMenuRef = ref<InstanceType<typeof canvasMenu>>();
const canvasControlsRef = ref<InstanceType<typeof canvasControls>>();
const selectionToolbarRef = ref<InstanceType<typeof selectionToolbar>>();
const nodeSearchRef = ref<InstanceType<typeof nodeSearch>>();
const nodeTypes = shallowRef<NodeTypesObject>({ canvasGroup: markRaw(groupNode) });
const nodeConfigs = shallowRef<Record<string, Record<string, unknown>>>({});
const nodeOptions = ref<{ type: string; label: string }[]>([]);
const nodeLoads = shallowReactive(new Map<string, Promise<void>>());
const nodeReloads = new Set<string>();
const nodeErrors = ref<Record<string, string>>({});
const availableNodes = computed(() => nodeOptions.value.filter(node => nodeTypes.value[node.type] && !nodeErrors.value[node.type]));
const nodeListLoading = ref(true);
const remoteNodeTypes = computed(() => [
  ...new Set((flowData.value as { type?: string }[]).map((item) => item.type).filter((type): type is string => !!type?.startsWith("remote-"))),
]);
let loadRequest = 0;
// ACT: 画布视图开关是本机编辑习惯（不属于某张画布内容），统一放会话状态并在所有画布实例间共享。
const sessionState = useSessionStateStore();
function canvasViewModel(key: "snap" | "showEdges" | "showMap") {
  return computed<boolean>({
    get: () => sessionState.state.canvasView[key],
    set: value => sessionState.set(`canvasView.${key}`, value),
  });
}
const snapEnabled = canvasViewModel("snap");
const showMap = canvasViewModel("showMap");
const zoomKeyPressed = ref(false);
const panKeyPressed = ref(false);
const selectionKeyPressed = ref(false);
const defaultWheelZoom = computed(() => getShortcutBindings(generalSettings.value.canvasShortcuts.zoom).includes("None"));
const defaultDragPan = computed(() => getShortcutBindings(generalSettings.value.canvasShortcuts.pan).includes("None"));
const selectedTool = defineModel<"move" | "hand">("selectedTool", { default: "move" });
const handMode = computed(() => props.active && !props.settingsVisible && (selectedTool.value === "hand" || panKeyPressed.value));
let pointerPosition: XYPosition | undefined;
const pressedCodes = new Set<string>();
let gestureScale: number | undefined;
let copyingNodes = false;
const showEdges = canvasViewModel("showEdges");
const assetLibraryStore = useAssetLibraryStore();
const assetsVisible = computed({
  get: () => assetLibraryStore.visible,
  set: (value: boolean) => { assetLibraryStore.visible = value; },
});
const edgeDisconnect = ref<{ id: string; x: number; y: number }>();
const flow = useVueFlow(props.runtimeKey);
const nodeDocument: NodeDocumentContext = { targets: shallowReactive(new Map()), mounts: new Map(), states: shallowReactive(new Map()) };
const canvasDirty = ref(false);
const canvasSaveError = ref("");
const documentObservers = new Set<() => void>();
onScopeDispose(() => { for (const release of documentObservers) release(); });
provide("nodeDocument", nodeDocument);
onScopeDispose(anonymousData.observeCanvas(() => props.active && canvasId.value
  ? { nodes: flow.nodes.value, edgeCount: flow.edges.value.length }
  : undefined));
let dragCopy: ReturnType<InstanceType<typeof selectionToolbar>["startDragCopy"]>;
flow.onNodeDragStart(({ event, nodes }) => {
  dragCopy = undefined;
  if (!props.active || props.settingsVisible) return;
  const shortcuts = generalSettings.value.canvasShortcuts;
  const withEdges = shortcutPressed(event, shortcuts.duplicateOnDrag, pressedCodes);
  if (withEdges || shortcutPressed(event, shortcuts.copyOnDrag, pressedCodes)) {
    dragCopy = selectionToolbarRef.value?.startDragCopy(nodes, withEdges);
  }
});
flow.onNodeDrag(() => dragCopy?.update());
flow.onNodeDragStop(({ nodes }) => {
  const copy = dragCopy;
  dragCopy = undefined;
  if (copy) copy.finish();
  else finishGroupDrag(flow.getNodes.value, nodes);
});
const requestNodeAssetsCleanup = inject<((directory: string, nodeIds: string[]) => void) | undefined>("requestNodeAssetsCleanup");
// ACT: Agent 节点的会话文件不能随节点删除立刻删——撤销历史里还留着这个节点，撤销回来就成了空壳。
// 这里在节点离开画布时先记账，等它被撤销栈淘汰（onNodesDropped）再真正删除；撤销回来则划掉账。
const pendingAgentSessionCleanup = new Map<string, string>();
let knownAgentSessions = new Map<string, string>();
// ACT: 不能用 `watch(() => flow.getNodes.value)` —— 增删是 push/splice，同一个数组代理不会换引用，
// 监听不到；拼 id 串才能稳定感知节点增删（数据字段变化不需要在这里处理）。
watch(() => flow.getNodes.value.map(node => node.id).join("|"), () => {
  const current = new Map<string, string>();
  for (const node of flow.getNodes.value) {
    const file = (node.data as { agentSessionFile?: string } | undefined)?.agentSessionFile;
    if (node.type === "remote-agentNode" && file) current.set(node.id, file);
  }
  for (const [id, file] of knownAgentSessions) if (!current.has(id)) pendingAgentSessionCleanup.set(id, file);
  for (const id of current.keys()) pendingAgentSessionCleanup.delete(id);
  knownAgentSessions = current;
}, { flush: "post" });

function isAgentSessionReferenced(sessionFile: string) {
  return flow.getNodes.value.some(node => {
    const data = node.data as { agentSessionFile?: string; agentSessionCloneFrom?: string } | undefined;
    return data?.agentSessionFile === sessionFile || data?.agentSessionCloneFrom === sessionFile;
  });
}

async function cleanupAgentSessions(directory: string, nodeIds: string[]) {
  for (const nodeId of nodeIds) {
    const sessionFile = pendingAgentSessionCleanup.get(nodeId);
    if (!sessionFile) continue;
    // ACT: 复制出的节点还没打开过时会话指针仍指向源文件，源节点被删不能把别人的会话删掉。
    if (isAgentSessionReferenced(sessionFile)) {
      pendingAgentSessionCleanup.delete(nodeId);
      continue;
    }
    try {
      const response = await fetch("/api/agent/session", {
        method: "DELETE",
        headers: { "Content-Type": "application/json", "x-toonflow-workspace": "1" },
        body: JSON.stringify({ directory, sessionFile }),
      });
      if (response.ok) {
        pendingAgentSessionCleanup.delete(nodeId);
      } else if (response.status === 409) {
        // ACT: 会话还在跑；节点已经被撤销栈淘汰，不会再有下一次淘汰事件触发重试，自己排一次。
        setTimeout(() => void cleanupAgentSessions(directory, [nodeId]), 10_000);
      }
    } catch {
      // 网络失败同样下次再试。
    }
  }
}

const canvasHistory = useCanvasHistory(flow, () =>
  project.value?.directory && canvasId.value ? JSON.stringify([project.value.directory, canvasId.value]) : "",
  {
    directory: () => project.value?.directory,
    onNodesDropped: (directory, nodeIds) => {
      requestNodeAssetsCleanup?.(directory, nodeIds);
      void cleanupAgentSessions(directory, nodeIds);
    },
  }
);
const { canUndo, canRedo } = canvasHistory;
provide("batchCanvasHistory", canvasHistory.batch);
// ACT: 分组删除必须连内容一起走画布的删除链路（delete 生命周期 + 不可删校验 + 撤销批次）。
// 分组本体是 pointer-events:none，够不到画布菜单，所以在这里把删除能力显式提供出去。
provide("deleteNodeSelection", (nodes: GraphNode[]) => {
  const menu = nodeMenuRef.value;
  if (!menu) return Promise.reject(new Error("画布尚未就绪"));
  return canvasHistory.batch(() => menu.deleteSelection(nodes));
});
const getNodeTools = useNodeToolsContext();
const { addNodes, addEdges, removeEdges, findEdge, findNode, toObject, viewport, screenToFlowCoordinate } = flow;
provide("copyNodeToClipboard", async (node: Parameters<typeof copyNodeToClipboard>[0]) => {
  const directory = project.value?.directory;
  if (!directory) throw new Error("请先选择工作目录");
  if (await copyImageNodeToClipboard(directory, node)) return;
  await copyNodeToClipboard(node, directory);
});
provide("retainNodeFiles", true);
provide("selectionConnection", shallowRef<NodeConnectionFeedback>());
provide("saveNodeToAssets", (label: string, outputs: { label: string; output: NodeOutput }[]) => assetLibraryStore.requestSave(label, outputs));
const agentComposer = useAgentComposerStore();
const mentionSources = useMentionSources(() => project.value?.directory);
const showAgentPanel = inject<(() => void) | undefined>("showAgentPanel", undefined);
type AgentPortMenuState = { nodeId: string; nodeLabel: string; outputs: MentionOutput[]; index: number; x: number; y: number };
const agentPortMenu = ref<AgentPortMenuState>();
const agentPortMenuElement = ref<HTMLElement>();
const agentPortMenuItems = ref<HTMLElement[]>([]);

function agentOutputIcon(dataType: string) {
  if (dataType === "IMAGE" || dataType === "MASK") return IconPhoto;
  if (dataType === "VIDEO") return IconVideo;
  if (dataType === "AUDIO") return IconMusic;
  if (dataType === "FILE") return IconFile;
  return IconFileText;
}

function closeAgentPortMenu() {
  agentPortMenu.value = undefined;
}

function hoverAgentPortItem(index: number, available: boolean) {
  if (agentPortMenu.value && available) agentPortMenu.value.index = index;
}

function firstAvailableIndex(outputs: MentionOutput[]) {
  return Math.max(0, outputs.findIndex(output => output.available));
}

function moveAgentPortIndex(delta: 1 | -1) {
  const menu = agentPortMenu.value;
  if (!menu) return;
  const length = menu.outputs.length;
  let index = menu.index;
  for (let step = 0; step < length; step++) {
    index = (index + delta + length) % length;
    if (menu.outputs[index]?.available) { menu.index = index; break; }
  }
  void nextTick(() => agentPortMenuItems.value[index]?.focus());
}

function handleAgentPortMenuKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    closeAgentPortMenu();
    return;
  }
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    event.stopPropagation();
    moveAgentPortIndex(event.key === "ArrowDown" ? 1 : -1);
    return;
  }
  if (event.key === "Enter" || event.key === " ") {
    const menu = agentPortMenu.value;
    const output = menu?.outputs[menu.index];
    if (!output?.available) return;
    event.preventDefault();
    event.stopPropagation();
    void chooseAgentOutput(output);
  }
}

function handleAgentPortMenuFocusOut(event: FocusEvent) {
  if (event.relatedTarget instanceof Node && agentPortMenuElement.value?.contains(event.relatedTarget)) return;
  closeAgentPortMenu();
}

async function openAgentPortMenu(nodeId: string, anchor: HTMLElement, outputs: MentionOutput[]) {
  const node = findNode(nodeId);
  const label = typeof node?.data?.label === "string" && node.data.label.trim() ? node.data.label : nodeId;
  const rect = anchor.getBoundingClientRect();
  const width = 240;
  agentPortMenu.value = {
    nodeId,
    nodeLabel: label,
    outputs,
    index: firstAvailableIndex(outputs),
    x: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
    y: Math.min(rect.bottom + 6, window.innerHeight - 72),
  };
  await nextTick();
  const element = agentPortMenuElement.value;
  const menu = agentPortMenu.value;
  if (!element || !menu) return;
  // 下方空间不足时翻到按钮上方。
  if (element.getBoundingClientRect().bottom > window.innerHeight - 8) {
    menu.y = Math.max(8, rect.top - element.offsetHeight - 6);
  }
  (agentPortMenuItems.value[menu.index] ?? element).focus();
}

async function chooseAgentOutput(output: MentionOutput) {
  const menu = agentPortMenu.value;
  if (!menu || !output.available) return;
  const { nodeId } = menu;
  closeAgentPortMenu();
  await insertNodeAgentMention(nodeId, output.id);
}

async function insertNodeAgentMention(nodeId: string, outputId?: string) {
  const activeCanvasId = canvasId.value;
  if (!activeCanvasId || !project.value?.directory) return ElMessage.warning("请先打开画布");
  try {
    // ACT: 复用 mention 解析的正式链路，插入结果与手动 @ 节点输出完全一致；不传 outputId 即引用节点本身。
    const mention = outputId
      ? await mentionSources.selectCanvas({ canvasId: activeCanvasId, nodeId, outputId })
      : await mentionSources.selectNode({ canvasId: activeCanvasId, nodeId });
    showAgentPanel?.();
    agentComposer.push(mention, project.value?.directory);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "加入对话上下文失败");
  }
}

async function addNodeToAgentContextFromToolbar(nodeId: string, anchor: HTMLElement) {
  const activeCanvasId = canvasId.value;
  if (!activeCanvasId || !project.value?.directory) return ElMessage.warning("请先打开画布");
  closeAgentPortMenu();
  if (!findNode(nodeId)) return ElMessage.warning("节点已不存在");
  let outputs: MentionOutput[];
  try {
    outputs = await mentionSources.outputs({ canvasId: activeCanvasId, nodeId });
  } catch (error) {
    return ElMessage.error(error instanceof Error ? error.message : "读取节点输出失败");
  }
  const available = outputs.filter(output => output.available);
  // ACT: 空节点改为引用节点本身，不再提示「暂无输出」把路堵死。
  if (!available.length) return insertNodeAgentMention(nodeId);
  if (available.length === 1) return insertNodeAgentMention(nodeId, available[0]!.id);
  if (!anchor.isConnected) return;
  await openAgentPortMenu(nodeId, anchor, outputs);
}

provide("nodeAgentContext", addNodeToAgentContextFromToolbar);
flow.onPaneClick(() => {
  closeAgentPortMenu();
  agentNodePanelRef.value?.close();
});flow.onMoveStart(closeAgentPortMenu);
flow.onNodeDragStart(closeAgentPortMenu);
flow.onNodeClick(({ node, event }) => {
  if (event.target instanceof Element && event.target.closest("[data-node-agent-context]")) return;
  closeAgentPortMenu();
  // ACT: 单击 Agent 节点即打开它自己的对话面板，点其它节点或画布空白关闭——同一时刻只留一个。
  if (node.type === "remote-agentNode") void agentNodePanelRef.value?.open(node.id);
  else agentNodePanelRef.value?.close();
});
watch([canvasId, () => project.value?.directory], closeAgentPortMenu, { flush: "post" });
let canvasController = new AbortController();
let workspaceController = new AbortController();
const createCanvasContext = useCanvasTools({
  availableNodes,
  flushSave: flushCanvasSave,
  menu() {
    if (!canvasMenuRef.value) throw new Error("画布菜单尚未就绪");
    return canvasMenuRef.value;
  },
  getCanvasBinding: () => ({ id: canvasId.value, signal: canvasController.signal }),
  resolveCanvasContext: id => props.resolveCanvasContext?.(id),
});
function getCanvasContext() {
  return canvasId.value || canvasMenuRef.value?.initialized ? createCanvasContext(canvasId.value, canvasController.signal, workspaceController.signal) : undefined;
}
const canvasReady = computed(() => !!canvasId.value && !nodeListLoading.value && nodeLoads.size === 0);
// ACT: Agent 节点状态由对话面板写入、节点包 inject 读取。必须在画布层 provide ——
// 面板与节点都是 <vue-flow> 的子节点，面板自己 provide 的话节点收不到（兄弟节点不共享注入）。
// 只放内存：写进 node.data 会触发画布 500ms 防抖保存，状态每秒变化会一直写盘。
const agentNodeStatuses = reactive<Record<string, AgentNodeStatus>>({});
provide(AGENT_NODE_STATUS_KEY, agentNodeStatuses);
const agentNodePanelRef = ref<InstanceType<typeof agentNodePanel>>();
provide("canvas", getCanvasContext);
// ACT: 后台画布只是 hidden + inert，不卸载；节点里的 Esc 兜底必须知道"我在不在前台画布"，
// 否则在画布 B 按 Esc 会把画布 A 里仍在生成的节点停掉。
provide("canvasActive", computed(() => props.active === true));
defineExpose({ canvasId, canvasReady, getCanvasContext, addNodeAtPointer, readDocumentNode, saveDocumentNode, mountDocumentNode, observeDocumentNode, prepareCanvasDelete, flushSave: flushCanvasSave, cancelSave: cancelCanvasSave,
  openNodeSearch: () => nodeSearchRef.value?.open(),
  getCanvases: (signal?: AbortSignal) => {
    if (!canvasMenuRef.value) throw new Error("画布菜单尚未就绪");
    return canvasMenuRef.value.getCanvases(signal);
  },
  syncCanvasPath: (previous: string, target: string) => canvasMenuRef.value?.syncCanvasPath(previous, target),
  getMentionNodes: () => flow.nodes.value, findMentionNode: flow.findNode, getMentionEdges: () => flow.getEdges.value,
  getRetainedNodes: canvasHistory.getRetainedNodes,
  get canvasListReady() { return canvasMenuRef.value?.initialized ?? false; },
  get saveBusy() { return savePaused; }, get loadError() { return canvasMenuRef.value?.loadError ?? ""; },
});

async function prepareCanvasDelete() {
  const directory = project.value?.directory;
  const fileName = canvasId.value;
  const nodes = [...flow.getNodes.value];
  const signal = AbortSignal.any([workspaceController.signal, canvasController.signal]);
  function checkCanvas() {
    signal.throwIfAborted();
    if (!directory || directory !== project.value?.directory || !fileName || fileName !== canvasId.value) {
      throw new Error("工作区或画布已切换，请重新删除");
    }
  }
  checkCanvas();
  await nextTick();
  checkCanvas();
  // 宿主已暂停画布保存；这里只执行节点生命周期，文件删除成功后由宿主取消保存并卸载。
  for (const node of nodes) {
    if (flow.findNode(node.id) !== node) throw new Error("画布节点已变化，请重新删除");
    await useNodeEvent(node.id, flow).emit("delete");
    checkCanvas();
    if (flow.findNode(node.id) !== node) throw new Error("画布节点已变化，请重新删除");
  }
  if (flow.getNodes.value.length !== nodes.length || nodes.some(node => flow.findNode(node.id) !== node)) {
    throw new Error("画布节点已变化，请重新删除");
  }
}

type DocumentNodeData = { label?: string; handles?: NodeHandle[]; outputs?: Record<string, NodeOutput | undefined>; textPath?: string };

function checkDocumentDirectory(directory: string) {
  if (!directory || directory !== project.value?.directory) throw new Error("工作目录已切换，请重新打开节点");
}

function observeDocumentNode(directory: string, canvasPath: string, nodeId: string, onState: (state: NodeDocumentState) => void) {
  checkDocumentDirectory(directory);
  if (canvasId.value !== canvasPath || !findNode(nodeId)) throw new Error("节点不存在，请刷新文件树");
  const stop = watch((): NodeDocumentState => {
    const node = findNode(nodeId);
    const state = nodeDocument.states.get(nodeId);
    return { dirty: !!node && (canvasDirty.value || !!state?.dirty),
      error: state?.error || canvasSaveError.value || (node && nodeErrors.value[node.type]) || "", deleted: !node };
  }, onState, { immediate: true, flush: "sync" });
  const release = () => { stop(); documentObservers.delete(dispose); };
  const dispose = () => { onState({ dirty: false, error: "", deleted: true }); release(); };
  documentObservers.add(dispose);
  return {
    release,
    async flushSave() {
      checkDocumentDirectory(directory);
      if (!findNode(nodeId)) throw new Error("节点已删除，请刷新文件树");
      await flushCanvasSave();
    },
  };
}

async function mountDocumentNode(directory: string, canvasPath: string, nodeId: string, target: HTMLElement) {
  checkDocumentDirectory(directory);
  if (canvasId.value !== canvasPath) throw new Error("画布已切换，请重新打开节点");
  await nextTick();
  checkDocumentDirectory(directory);
  const node = findNode(nodeId);
  if (!node) throw new Error("节点已删除，请刷新文件树");
  if (nodeErrors.value[node.type]) throw new Error(nodeErrors.value[node.type]);
  const mount = nodeDocument.mounts.get(nodeId);
  if (!mount) throw new Error("当前节点未提供文档视图，请确认节点正常加载并更新节点插件");
  const release = mount(target);
  try {
    await nextTick();
    checkDocumentDirectory(directory);
    if (!target.isConnected || !target.querySelector(".documentNode")) throw new Error("节点文档视图加载失败，请重新打开节点");
    return release;
  } catch (error) {
    release();
    throw error;
  }
}

function documentHandles(node: Node<DocumentNodeData>) {
  const handles = node.data?.handles;
  if (Array.isArray(handles) && handles.length) {
    return handles.filter(
      (handle) =>
        handle &&
        typeof handle.id === "string" &&
        handle.type === "source" &&
        (Array.isArray(handle.dataType) ? handle.dataType.includes("STRING") : handle.dataType === "STRING")
    );
  }
  return Object.entries(node.data?.outputs ?? {}).flatMap(([id, output]) => (output?.dataType === "STRING" ? [{ id, label: id }] : []));
}

async function readDocumentCanvas(directory: string, canvasPath: string, nodeId: string) {
  checkDocumentDirectory(directory);
  const files = useWorkspaceFiles(directory);
  const canvas = await files.readJson<{ toonflowCanvas?: boolean; nodes?: Node<DocumentNodeData>[] }>(canvasPath);
  checkDocumentDirectory(directory);
  if (canvas?.toonflowCanvas !== true || !Array.isArray(canvas.nodes)) throw new Error("文件不是有效画布");
  const node = canvas.nodes.find((item) => item && item.id === nodeId);
  if (!node) throw new Error("节点已删除，请刷新文件树");
  if (node.data !== undefined && (!node.data || typeof node.data !== "object" || Array.isArray(node.data))) throw new Error("节点数据无效");
  const liveNode = canvasId.value === canvasPath ? findNode(nodeId) : undefined;
  if (canvasId.value === canvasPath && !liveNode) throw new Error("节点已删除，请刷新文件树");
  const textPath = node.data?.textPath;
  if (
    textPath !== undefined &&
    (typeof textPath !== "string" ||
      !textPath.trim() ||
      /^(?:[a-z][a-z\d+.-]*:|[\\/])/i.test(textPath) ||
      textPath.includes("\0") ||
      textPath.split(/[\\/]/).includes(".."))
  )
    throw new Error("文本文件路径必须位于工作区内");
  return { files, canvas, node, liveNode, textPath };
}

async function readDocumentNode(directory: string, canvasPath: string, nodeId: string) {
  checkDocumentDirectory(directory);
  await flushCanvasSave();
  const { files, node, liveNode, textPath } = await readDocumentCanvas(directory, canvasPath, nodeId);
  const source = liveNode ?? node;
  const handles = documentHandles(source);
  const storedText = textPath === undefined ? undefined : await files.readText(textPath);
  checkDocumentDirectory(directory);
  return {
    label: typeof source.data?.label === "string" ? source.data.label : nodeId,
    outputs: handles.map((handle) => {
      const output = source.data?.outputs?.[handle.id];
      return {
        id: handle.id,
        label: handle.label || handle.id,
        text: output?.dataType === "STRING" && typeof output.value === "string" ? output.value : storedText ?? "",
      };
    }),
  };
}

async function saveDocumentNode(directory: string, canvasPath: string, nodeId: string, handleId: string, text: string, expectedText?: string) {
  checkDocumentDirectory(directory);
  await flushCanvasSave(async () => {
    const { files, canvas, node, liveNode, textPath } = await readDocumentCanvas(directory, canvasPath, nodeId);
    if (!documentHandles(liveNode ?? node).some((handle) => handle.id === handleId)) throw new Error("文本输出已删除，请重新打开节点");
    if (expectedText !== undefined) {
      const output = (liveNode ?? node).data?.outputs?.[handleId];
      const currentText = output?.dataType === "STRING" && typeof output.value === "string" ? output.value : textPath === undefined ? "" : await files.readText(textPath);
      if (currentText !== expectedText) throw new Error("文档内容已变化，请重新读取后编辑");
    }
    if (liveNode?.type === "remote-textNode") {
      await getNodeTools().call({ nodeId, name: "node:setText", args: { text } }, canvasController.signal);
      checkDocumentDirectory(directory);
      // 节点工具已同步输出并排队保存；等待期间用户可能继续编辑，不能再写入旧文本快照。
      return;
    }
    if (liveNode && canvasId.value === canvasPath && findNode(nodeId) === liveNode) {
      const output = liveNode.data.outputs?.[handleId];
      if (output?.dataType === "STRING") output.value = text;
      else if (textPath === undefined) (liveNode.data.outputs ??= {})[handleId] = { dataType: "STRING", value: text };
    }
    canvasMenuRef.value?.syncDocumentNode(canvasPath, nodeId, handleId, text, textPath === undefined);
    if (textPath !== undefined) {
      await files.write(textPath, text);
    } else {
      const data = (node.data ??= {});
      const output = data.outputs?.[handleId];
      if (output?.dataType === "STRING") output.value = text;
      else (data.outputs ??= {})[handleId] = { dataType: "STRING", value: text };
      await files.writeJson(canvasPath, canvas);
    }
    checkDocumentDirectory(directory);
  });
}

// ACT: 分组是一整块矩形，会把组内的连线整个盖住——线点不中、右键只有系统菜单。
// 做法是「穿透探测」：左键按下时临时让组体退出命中测试，看光标（含 6px 容差）下有没有连线；
// 有就当作点了那条线（弹断开气泡并挡住拖动），没有就让事件继续落到组上，拖动照旧。
const edgeProbeOffsets: [number, number][] = [[0, 0], [6, 0], [-6, 0], [0, 6], [0, -6], [4, 4], [-4, -4], [4, -4], [-4, 4]];

function edgeIdUnderGroup(group: HTMLElement, x: number, y: number) {
  group.style.pointerEvents = "none";
  try {
    for (const [dx, dy] of edgeProbeOffsets) {
      const element = document.elementFromPoint(x + dx, y + dy);
      const edge = element?.closest?.(".vue-flow__edge");
      const id = edge?.getAttribute("data-id");
      if (id) return id;
    }
  } finally {
    group.style.pointerEvents = "";
  }
  return undefined;
}

function groupBodyOf(target: EventTarget | null) {
  if (!(target instanceof Element)) return undefined;
  if (target.closest(".groupLabel, .groupLabelInput, .resizeCorner")) return undefined;
  return target.closest<HTMLElement>(".vue-flow__node-canvasGroup") ?? undefined;
}

function onCanvasPointerDown(event: PointerEvent) {
  probeGroupEdgeClick(event);
  updateCanvasSelection(event);
}

function probeGroupEdgeClick(event: PointerEvent) {
  if (event.button !== 0) return;
  const group = groupBodyOf(event.target);
  if (!group) return;
  const id = edgeIdUnderGroup(group, event.clientX, event.clientY);
  if (!id || !findEdge(id)) return;
  event.preventDefault();
  event.stopPropagation();
  edgeDisconnect.value = { id, x: event.clientX, y: event.clientY };
}

function forwardGroupContextMenu(event: MouseEvent) {
  const group = groupBodyOf(event.target);
  if (!group) return;
  event.preventDefault();
  event.stopPropagation();
  // 组内右键与组外一致：走画布空白同一条路径（nodesOnly=false 才是完整操作菜单），
  // 组自己的菜单在标题栏上。
  nodeMenuRef.value?.openMenu(event, false);
}

function showEdgeDisconnect({ event, edge }: EdgeMouseEvent) {
  if (!(event instanceof MouseEvent)) return;
  event.stopPropagation();
  edgeDisconnect.value = { id: edge.id, x: event.clientX, y: event.clientY };
}

function dragFilesOver(event: DragEvent) {
  if (!props.active || props.settingsVisible || !canvasId.value || !project.value?.directory || !isCanvasFileDrag(event)) return;
  if (!(event.target instanceof Element) || !event.target.closest(".vue-flow__pane")) return;
  event.preventDefault();
  event.dataTransfer!.dropEffect = "copy";
  return true;
}

async function dropFiles(event: DragEvent) {
  const directory = project.value?.directory;
  if (!directory || !dragFilesOver(event)) return;
  try {
    await canvasHistory.batch(() => dropCanvasFiles(event, { directory, availableNodes: availableNodes.value, signal: canvasController.signal, flow }));
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "文件导入失败");
  }
}

function selectFiles(position: { x: number; y: number }) {
  const directory = project.value?.directory;
  if (!props.active || props.settingsVisible || !canvasId.value || !directory) return;
  const context = { directory, availableNodes: availableNodes.value, signal: canvasController.signal, flow };
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = true;
  input.onchange = async () => {
    const files = Array.from(input.files ?? []);
    if (!files.length || context.signal.aborted) return;
    try {
      await canvasHistory.batch(() => importCanvasFiles(files, position, context));
    } catch (error) {
      ElMessage.error(error instanceof Error ? error.message : "文件导入失败");
    }
  };
  input.click();
}

function openNodeMenu(event: MouseEvent) {
  if (event.target instanceof Element && event.target.classList.contains("vue-flow__pane")) nodeMenuRef.value?.openMenu(event, true);
}

function createEmptyNode(type: string) {
  if (!props.active || props.settingsVisible || !project.value?.directory || !canvasReady.value || flow.getNodes.value.length) return;
  const rect = canvasElement.value?.getBoundingClientRect();
  if (!rect) return;
  const center = screenToFlowCoordinate({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
  void nodeMenuRef.value?.addNode(type, { x: center.x - 200, y: center.y - 160 });
}

function addNodeAtPointer() {
  if (!props.active || props.settingsVisible || !project.value?.directory || !canvasReady.value) return;
  const rect = canvasElement.value?.getBoundingClientRect();
  if (!rect) return;
  const position = pointerPosition ?? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  void nodeMenuRef.value?.openMenu(new MouseEvent("contextmenu", { clientX: position.x, clientY: position.y }), true);
}

async function changeHistory(direction: "undo" | "redo") {
  try {
    await canvasHistory[direction]();
    edgeDisconnect.value = undefined;
  } catch (error) {
    ElMessage.error(
      axios.isAxiosError<{ message?: string }>(error)
        ? error.response?.data.message || "恢复画布失败"
        : error instanceof Error
        ? error.message
        : "恢复画布失败"
    );
  }
}

let saving = Promise.resolve();
let flushing = Promise.resolve();
let saveError: unknown;
let savePaused = false;
let saveCancelled = false;
let changedWhilePaused = false;
let saveRevision = 0;
const saveCanvas = debounce((directory: string, fileName: string) => {
  const flow = toObject();
  const revision = saveRevision;
  // ACT: 同页保存按顺序完成，防止慢请求覆盖后续修改；不处理多个客户端的并发编辑。
  saving = saving.then(async () => {
    try {
      await useWorkspaceFiles(directory).writeJson(fileName, { toonflowCanvas: true, nodes: flow.nodes, edges: flow.edges, viewport: flow.viewport });
      saveError = undefined;
      canvasSaveError.value = "";
      if (revision === saveRevision) canvasDirty.value = false;
    } catch (err) {
      saveError = err;
      canvasSaveError.value = axios.isAxiosError<{ message?: string }>(err) ? err.response?.data.message || err.message : err instanceof Error ? err.message : "画布保存失败";
      ElMessage.error(
        axios.isAxiosError<{ message?: string }>(err)
          ? err.response?.data.message || "画布保存失败"
          : err instanceof Error
          ? err.message
          : "画布保存失败"
      );
    }
  });
}, 500);

function scheduleCanvasSave() {
  if (saveCancelled) return;
  canvasDirty.value = true;
  saveRevision++;
  if (savePaused) {
    changedWhilePaused = true;
    return;
  }
  const directory = project.value?.directory;
  if (directory && canvasId.value) saveCanvas(directory, canvasId.value);
}

function scheduleCanvasChange() {
  scheduleCanvasSave();
  canvasHistory.record();
}

const elementSaveWatchers = new Map<Node | Edge, () => void>();
const nodeRuntimeFields = new Set([
  "data",
  "computedPosition",
  "handleBounds",
  "selected",
  "dimensions",
  "isParent",
  "resizing",
  "dragging",
  "events",
]);
const edgeRuntimeFields = new Set(["data", "selected", "sourceNode", "targetNode", "sourceX", "sourceY", "targetX", "targetY", "events"]);
// ACT: 仅增删、替换元素时扫描列表；位移与 data 各自监听，单个节点变化不遍历其余节点。
watch(
  () => [...flow.nodes.value, ...flow.edges.value],
  (elements) => {
    const current = new Set<Node | Edge>(elements);
    for (const [element, stop] of elementSaveWatchers) {
      if (!current.has(element)) {
        stop();
        elementSaveWatchers.delete(element);
      }
    }
    for (const element of elements) {
      if (elementSaveWatchers.has(element)) continue;
      // 与 toObject 排除的运行态字段保持一致，其他自定义持久字段仍参与自动保存。
      const runtimeFields = isNode(element) ? nodeRuntimeFields : edgeRuntimeFields;
      const stopFields = watch(
        () =>
          Object.keys(element)
            .filter((key) => !runtimeFields.has(key))
            .map((key) => Reflect.get(element, key)),
        scheduleCanvasChange,
        { deep: true, flush: "post" }
      );
      const stopData = watch(() => element.data, scheduleCanvasSave, { deep: true, flush: "post" });
      const stopName = isNode(element)
        ? watch(
            () => element.data?.label,
            () => canvasHistory.record(),
            { flush: "post" }
          )
        : () => {};
      elementSaveWatchers.set(element, () => {
        stopFields();
        stopData();
        stopName();
      });
    }
    scheduleCanvasChange();
  },
  { immediate: true, flush: "post" }
);
onScopeDispose(() => elementSaveWatchers.forEach((stop) => stop()));
watch(() => [viewport.value.x, viewport.value.y, viewport.value.zoom], scheduleCanvasSave, { flush: "post" });

watch(
  [() => project.value?.directory, canvasId],
  ([directory, fileName], [previousDirectory, previousFileName]) => {
    if (directory !== previousDirectory) {
      workspaceController.abort(new Error("工作区已切换，本轮画布操作已停止"));
      workspaceController = new AbortController();
    }
    edgeDisconnect.value = undefined;
    dragCopy = undefined;
    pointerPosition = undefined;
    resetCanvasKeys();
    // 同一实例只在重新装载画布时失效；重命名仅更新保存路径。
    if (directory !== previousDirectory || !fileName || !previousFileName) {
      canvasController.abort(new Error("画布已重新加载，本次画布调用已停止"));
      canvasController = new AbortController();
    }
    if (!savePaused) saveCanvas.flush();
  },
  { flush: "sync" }
);

// ACT: 切换显示面板不会卸载画布；仅清理交互，不中断本轮工具调用。
// 素材库面板的可见性归全局 store，切换画布/文档时不再强制关闭。
watch(() => props.active, (active) => {
  edgeDisconnect.value = undefined;
  dragCopy = undefined;
  pointerPosition = undefined;
  resetCanvasKeys();
  // ACT: 后台画布仍保留节点与播放器；切走时暂停本画布内的音视频，避免多路解码。
  if (!active && canvasElement.value) pauseMediaIn(canvasElement.value, { audio: false });
}, { flush: "sync" });

function flushCanvasSave(action?: () => Promise<void>): Promise<void> {
  // ACT: 完整保存及其文件操作串行执行，重命名暂停期间的显式保存也必须等待。
  const next = flushing.then(() => saveCanvasState(action)).then(() => { canvasSaveError.value = ""; }, error => {
    canvasSaveError.value = axios.isAxiosError<{ message?: string }>(error) ? error.response?.data.message || error.message : error instanceof Error ? error.message : "画布保存失败";
    throw error;
  });
  flushing = next.catch(() => {});
  return next;
}

async function saveCanvasState(action?: () => Promise<void>) {
  if (saveCancelled) throw new Error("画布保存已取消");
  await Promise.all(flow.getNodes.value.map((node) => useNodeEvent(node.id, flow).emit("save")));
  await nextTick();
  if (saveCancelled) throw new Error("画布保存已取消");
  if (saveError && project.value?.directory && canvasId.value) saveCanvas(project.value.directory, canvasId.value);
  if (action) savePaused = true;
  try {
    let revision: number;
    do {
      if (saveCancelled) throw new Error("画布保存已取消");
      revision = saveRevision;
      if (changedWhilePaused && project.value?.directory && canvasId.value) {
        saveCanvas(project.value.directory, canvasId.value);
        changedWhilePaused = false;
      }
      saveCanvas.flush();
      await saving;
      if (saveError) throw saveError;
      // 画布写入期间节点可能完成生成，等新增落盘后重新保存变化。
      await Promise.all(flow.getNodes.value.map((node) => useNodeEvent(node.id, flow).emit("save")));
      await nextTick();
    } while (revision !== saveRevision);
    if (saveCancelled) throw new Error("画布保存已取消");
    await action?.();
  } finally {
    if (action && !saveCancelled) {
      savePaused = false;
      if (changedWhilePaused && project.value?.directory && canvasId.value) saveCanvas(project.value.directory, canvasId.value);
      changedWhilePaused = false;
    }
  }
}

function cancelCanvasSave() {
  saveCancelled = true;
  savePaused = true;
  changedWhilePaused = false;
  saveCanvas.cancel();
}
function canUseCanvasClipboard(event: Event) {
  const target = event.target;
  return props.active && !event.defaultPrevented && !props.settingsVisible && !!canvasId.value && !!project.value?.directory
    && target instanceof Element
    && !target.closest("input, textarea, select, button, [contenteditable]:not([contenteditable='false']), [role='textbox'], [role='slider'], [role='dialog'], #agentPanel")
    && (target === document.body || target === document.documentElement || canvasElement.value?.contains(target));
}

function beforeClipboard(event: Event) {
  if (!canUseCanvasClipboard(event)) return;
  if (event.type === "beforecopy" && (!flow.getSelectedNodes.value.length || window.getSelection()?.toString())) return;
  // ACT: WKWebView 通过 beforecopy/beforepaste 判定非输入区能否使用原生编辑菜单。
  event.preventDefault();
}

function copyNode(event: ClipboardEvent) {
  if (!canUseCanvasClipboard(event) || !flow.getSelectedNodes.value.length || window.getSelection()?.toString()) return;
  event.preventDefault();
  void copySelectedNodes();
}

function imageOutput(data: { outputs?: Record<string, NodeOutput | undefined> } | undefined) {
  for (const output of Object.values(data?.outputs ?? {})) {
    if (output?.dataType !== "IMAGE" || !output.value || typeof output.value !== "object") continue;
    if (typeof output.value.url === "string" && output.value.url) return output.value;
  }
}

async function copyImageNodeToClipboard(directory: string, node: Parameters<typeof copyNodeToClipboard>[0]) {
  const output = imageOutput(node.data);
  if (!output) return false;
  const content = await useWorkspaceFiles(directory).read(output.url);
  await writeClipboardImage(new Blob([content], { type: output.mimeType || "image/png" }));
  return true;
}

async function copySelectedNodes() {
  if (copyingNodes || !project.value?.directory) return;
  const nodes = getSelectionTree(flow.getSelectedNodes.value, flow.getNodes.value);
  if (!nodes.length) return;
  const directory = project.value.directory;
  const signal = canvasController.signal;
  copyingNodes = true;
  try {
    if (nodes.length === 1 && await copyImageNodeToClipboard(directory, { data: nodes[0]!.data ?? {} })) {
      ElMessage.success("已复制图片");
      return;
    }
    const ids = new Set(nodes.map(node => node.id));
    const snapshot = toObject();
    const savedNodes = new Map(snapshot.nodes.map(node => [node.id, node]));
    const copies = await Promise.all(nodes.map(async node => {
      const patch = await useNodeEvent(node.id, flow).emit("copy");
      const saved = savedNodes.get(node.id)!;
      const parentNode = ids.has(saved.parentNode ?? "") ? saved.parentNode : undefined;
      return { ...saved, data: { ...saved.data, ...patch }, parentNode,
        ...(saved.parentNode && !parentNode ? { extent: undefined, expandParent: false } : {}),
        position: parentNode ? { ...saved.position } : { x: node.computedPosition.x, y: node.computedPosition.y } };
    }));
    signal.throwIfAborted();
    if (nodes.some(node => findNode(node.id) !== node)) throw new Error("节点已变化，请重新复制");
    const edges = snapshot.edges.filter(edge => ids.has(edge.source) && ids.has(edge.target));
    await copyNodesToClipboard(copies, edges, directory);
  } catch (error) {
    if (!signal.aborted) ElMessage.error(error instanceof Error ? error.message : "节点复制失败");
  } finally {
    copyingNodes = false;
  }
}

async function pasteNode(event: ClipboardEvent) {
  if (!canUseCanvasClipboard(event)) return;
  const text = event.clipboardData?.getData("text/plain") ?? "";
  if (nodeClipboardCommand.test(text)) {
    event.preventDefault();
    await pasteNodeAtCenter(text);
    return;
  }
  const canvasSignal = canvasController.signal;
  let files = getClipboardMediaFiles(event);
  if (files.length || text.trim()) event.preventDefault();
  // ACT: 部分 WebView 不向 paste 事件暴露剪贴板文件，桌面端回退到原生剪贴板读取。
  if (!files.length && isDesktop) files = await readClipboardFiles().catch(() => []);
  if (canvasSignal.aborted) return;
  if (!files.length && text.trim()) files = [new File([text], "粘贴文本.txt", { type: "text/plain" })];
  if (!files.length) return;
  event.preventDefault();
  const position = pastePosition();
  if (position) await importCanvasContent(files, position);
}

function pastePosition() {
  const rect = canvasElement.value?.getBoundingClientRect();
  if (!rect) return;
  const point = pointerPosition && pointerPosition.x >= rect.left && pointerPosition.x <= rect.right && pointerPosition.y >= rect.top && pointerPosition.y <= rect.bottom
    ? pointerPosition
    : { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  return screenToFlowCoordinate(point);
}

async function pasteNodeAtCenter(command?: string) {
  const position = pastePosition();
  if (position) await pasteClipboardNode(position, command);
}

async function importCanvasContent(files: File[], position: { x: number; y: number }) {
  const directory = project.value?.directory;
  if (!directory) return false;
  const canvasSignal = canvasController.signal;
  try {
    await canvasHistory.batch(() => importCanvasFiles(files, position, { directory, availableNodes: availableNodes.value, signal: canvasSignal, flow }));
    return true;
  } catch (error) {
    if (!canvasSignal.aborted) ElMessage.error(error instanceof Error ? error.message : "剪贴板内容导入失败");
    return false;
  }
}

async function pasteClipboardNode(position: { x: number; y: number }, command?: string) {
  if (!props.active || !canvasId.value || !project.value?.directory) return false;
  const canvasSignal = canvasController.signal;
  try {
    const directory = project.value.directory;
    const text = command ?? (await readClipboardText());
    const snapshot = await readClipboardNodes(text, directory);
    if (canvasSignal.aborted) return false;
    if (snapshot) {
      if (snapshot.nodes.some(node => node.type !== "canvasGroup" && !availableNodes.value.some(item => item.type === node.type))) {
        throw new Error("请先安装并启用对应的节点插件");
      }
      const ids = new Map(snapshot.nodes.map(node => [node.id, crypto.randomUUID()]));
      const roots = snapshot.nodes.filter(node => !node.parentNode);
      const left = Math.min(...roots.map(node => node.position.x));
      const top = Math.min(...roots.map(node => node.position.y));
      await canvasHistory.batch(async () => {
        flow.removeSelectedElements();
        addNodes(snapshot.nodes.map(node => ({ ...node, id: ids.get(node.id)!, parentNode: ids.get(node.parentNode ?? ""), selected: true,
          position: node.parentNode ? node.position : { x: position.x + node.position.x - left, y: position.y + node.position.y - top } })));
        await nextTick();
        if (canvasSignal.aborted) return;
        addEdges(snapshot.edges.map(edge => ({ ...edge, id: crypto.randomUUID(), source: ids.get(edge.source)!, target: ids.get(edge.target)! })));
      });
      return true;
    }
    const files = await readClipboardFiles().catch((error): File[] => {
      if (text.trim()) return [];
      throw error;
    });
    if (canvasSignal.aborted) return false;
    if (!files.length && text.trim()) files.push(new File([text], "粘贴文本.txt", { type: "text/plain" }));
    if (!files.length) throw new Error("剪贴板中没有可粘贴的节点、文本、图片、视频或音频");
    return await importCanvasContent(files, position);
  } catch (error) {
    const pasteShortcut = generalSettings.value.canvasShortcuts.paste;
    const clipboardMessage = getShortcutBindings(pasteShortcut).some(binding => /^(Ctrl|Meta)\+KeyV$/.test(binding))
      ? `无法读取剪贴板，请在画布上按 ${shortcutLabel(pasteShortcut)} 粘贴`
      : "无法读取剪贴板，请允许浏览器访问剪贴板";
    if (!canvasSignal.aborted)
      ElMessage.error(
        error instanceof DOMException && error.name === "NotAllowedError" ? clipboardMessage : error instanceof Error ? error.message : "剪贴板内容粘贴失败"
      );
    return false;
  }
}
function zoomCanvas(event: WheelEvent | (Event & { scale: number })) {
  if (event.type === "gestureend") gestureScale = undefined;
  if (!props.active || props.settingsVisible || document.fullscreenElement || flow.userSelectionActive.value) return;
  if (!(event.target instanceof Element) || !event.target.closest(".vue-flow__pane, .vue-flow__node, .vue-flow__edge, .vue-flow__nodesselection")) return;
  let factor: number;
  let point = pointerPosition;
  if ("scale" in event) {
    if (!Number.isFinite(event.scale) || event.scale <= 0) return;
    factor = event.type === "gesturechange" && gestureScale !== undefined ? event.scale / gestureScale : 1;
    gestureScale = event.type === "gestureend" ? undefined : event.scale;
  } else {
    // ACT: Chromium 捏合发送 Ctrl+wheel，但不发送 Control 按键；WebKit 使用上方原生 gesture 事件。
    const pinching = event.ctrlKey && !pressedCodes.has("ControlLeft") && !pressedCodes.has("ControlRight");
    // 无需按键的滚轮缩放让节点控件保留自己的滚动；显式缩放快捷键及捏合仍沿用原行为。
    if (defaultWheelZoom.value && !pinching && !zoomKeyPressed.value
      && event.target.closest(".nowheel, input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='slider']")) return;
    if (!pinching && !shortcutPressed(event, generalSettings.value.canvasShortcuts.zoom, pressedCodes)) {
      if (!event.ctrlKey) return;
      // 实体 Ctrl 未绑定缩放时，阻止 Vue Flow 和节点骨架将它误判为捏合。
      factor = 1;
    } else if (pinching && gestureScale !== undefined) {
      factor = 1;
    } else if (pinching) {
      factor = 2 ** (-event.deltaY * 0.02);
    } else {
      // ACT: @vue-flow/core 的 wheelDelta 在 macOS 下若检测到 event.ctrlKey 会额外乘以 10（误判为捏合微步）；非捏合的实体 Ctrl 滚轮缩放需剔除该倍数，保留标准滚轮速度。
      const delta = wheelDelta(event) / (event.ctrlKey && isMacOs() ? 10 : 1);
      factor = 2 ** delta;
    }
    point = { x: event.clientX, y: event.clientY };
  }
  const zoom = flow.d3Zoom.value;
  const selection = flow.d3Selection.value;
  if (!zoom || !selection) return;
  event.preventDefault();
  event.stopPropagation();
  if (factor === 1) return;
  const bounds = selection.node()?.getBoundingClientRect();
  if (!bounds) return;
  point ??= { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
  selection.call<[number, [number, number], Event]>(zoom.scaleBy, factor, [point.x - bounds.left, point.y - bounds.top], event);
}

function preventMiddleClick(event: MouseEvent) {
  if (event.button === 1) event.preventDefault();
}

function updateCanvasSelection(event: MouseEvent | KeyboardEvent) {
  // 失焦期间可能漏掉修饰键；不能在按下到抬起之间改变已命中的选区，避免 click 落到画布清空选择。
  if (event.type === "pointerdown" && event.target instanceof Element && event.target.closest(".vue-flow__nodesselection-rect")) return;
  flow.multiSelectionActive.value = props.active && !props.settingsVisible && !handMode.value
    && shortcutPressed(event, generalSettings.value.canvasShortcuts.multiSelection, pressedCodes);
}

function updateCanvasKeys(event: KeyboardEvent) {
  if (event.type === "keydown") {
    pressedCodes.add(event.code);
  } else pressedCodes.delete(event.code);
  if (!props.active || props.settingsVisible) return resetCanvasKeys();
  const target = event.target;
  const shortcuts = generalSettings.value.canvasShortcuts;
  // ACT: 面板打开时焦点可能在 body 上（点消息正文不改焦点），这时 Delete/Backspace
  // 会落到画布快捷键上，把正被使用的 Agent 节点删掉。
  const panelOpenOnBody = !!agentNodePanelRef.value?.isOpen?.() && (target === document.body || target === document.documentElement);
  const inCanvas =
    target instanceof Element &&
    !panelOpenOnBody &&
    !target.closest("[role='dialog'], #agentPanel") &&
    (target === document.body || target === document.documentElement || canvasElement.value?.contains(target));
  // None 只配置默认鼠标手势，不能触发会禁用节点交互的临时抓手或节点内部缩放。
  zoomKeyPressed.value = !event.isComposing && shortcutPressed(event, getShortcutBindings(shortcuts.zoom).filter(binding => binding !== "None").join(" / "), pressedCodes);
  selectionKeyPressed.value = !event.isComposing && shortcutPressed(event, shortcuts.selection, pressedCodes);
  if (!selectionKeyPressed.value && !flow.userSelectionActive.value) flow.userSelectionRect.value = null;
  const editing =
    !(target instanceof Element) ||
    !!target.closest("input, textarea, select, button, [contenteditable]:not([contenteditable='false']), [role='textbox'], [role='slider']");
  panKeyPressed.value = !!inCanvas && !editing && !event.isComposing
    && shortcutPressed(event, getShortcutBindings(shortcuts.pan).filter(binding => binding !== "None").join(" / "), pressedCodes);
  updateCanvasSelection(event);
  if (event.type === "keyup" || event.defaultPrevented || event.isComposing || !inCanvas || editing) return;
  const action = ([
    "group", "mergeGroup", "ungroup", "addNode", "moveTool", "handTool", "arrange", "search",
    "delete", "copy", "paste", "undo", "redo", "zoomIn", "zoomOut", "fitView",
  ] as const).find((action) =>
    shortcutMatches(event, shortcuts[action])
  );
  if (!action) {
    const nativeClipboardKey = (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey
      && (event.code === "KeyV" || event.code === "KeyC" && flow.getSelectedNodes.value.length && !window.getSelection()?.toString());
    if (panKeyPressed.value || nativeClipboardKey) event.preventDefault();
    return;
  }
  if (!canvasId.value || !project.value?.directory) return;
  if (action === "copy" && (!flow.getSelectedNodes.value.length || window.getSelection()?.toString())) return;
  // 桌面快捷键直接复用原生剪贴板桥接；浏览器 Ctrl/Cmd+V 保留原生事件，避免额外读取权限。
  if (!isDesktop && action === "paste" && event.code === "KeyV" && (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey) return;
  event.preventDefault();
  if (event.repeat) return;
  if (action === "delete") {
    const nodes = [...flow.getSelectedNodes.value];
    const menu = nodeMenuRef.value;
    if (!menu || !nodes.some((node) => node.deletable !== false)) return;
    void canvasHistory
      .batch(() => menu.deleteSelection(nodes))
      .catch((error) => {
        ElMessage.error(error instanceof Error ? error.message : "节点删除失败");
      });
    return;
  }
  if (action === "copy") void copySelectedNodes();
  else if (action === "paste") void pasteNodeAtCenter();
  else if (action === "undo" || action === "redo") void changeHistory(action);
  else if (action === "group" || action === "mergeGroup" || action === "ungroup") {
    void selectionToolbarRef.value?.operate(action);
  } else if (action === "addNode") addNodeAtPointer();
  else if (action === "moveTool" || action === "handTool") selectedTool.value = action === "handTool" ? "hand" : "move";
  else if (action === "arrange") void canvasControlsRef.value?.arrangeNodes();
  else if (action === "search") nodeSearchRef.value?.open();
  else void flow[action]();
}

function resetCanvasKeys() {
  pressedCodes.clear();
  gestureScale = undefined;
  zoomKeyPressed.value = false;
  panKeyPressed.value = false;
  selectionKeyPressed.value = getShortcutBindings(generalSettings.value.canvasShortcuts.selection).includes("None");
  flow.multiSelectionActive.value = false;
  if (!flow.userSelectionActive.value) flow.userSelectionRect.value = null;
}

watch([() => props.active, () => props.settingsVisible, () => generalSettings.value.canvasShortcuts], resetCanvasKeys, { deep: true, flush: "sync", immediate: true });

function refreshInstalled(event: WindowEventMap["toonflow:plugin-installed"]) {
  if (event.detail.type === "node") void loadRemoteNodes(event.detail.name);
}

const refreshNodeConfig = () => { void loadRemoteNodes(); };

onMounted(() => {
  // 在捕获阶段同步修饰键，避免节点编辑器截断 keydown/keyup 后缩放状态丢失或卡住。
  window.addEventListener("keydown", updateCanvasKeys, true);
  window.addEventListener("keyup", updateCanvasKeys, true);
  window.addEventListener("blur", resetCanvasKeys);
  window.addEventListener("toonflow:plugin-installed", refreshInstalled);
  window.addEventListener("toonflow:node-config-updated", refreshNodeConfig);
  document.addEventListener("paste", pasteNode);
  document.addEventListener("copy", copyNode);
  document.addEventListener("beforecopy", beforeClipboard);
  document.addEventListener("beforepaste", beforeClipboard);
  void loadRemoteNodes();
});
onBeforeUnmount(() => {
  window.removeEventListener("keydown", updateCanvasKeys, true);
  window.removeEventListener("keyup", updateCanvasKeys, true);
  window.removeEventListener("blur", resetCanvasKeys);
  window.removeEventListener("toonflow:plugin-installed", refreshInstalled);
  window.removeEventListener("toonflow:node-config-updated", refreshNodeConfig);
  document.removeEventListener("paste", pasteNode);
  document.removeEventListener("copy", copyNode);
  document.removeEventListener("beforecopy", beforeClipboard);
  document.removeEventListener("beforepaste", beforeClipboard);
  workspaceController.abort(new Error("工作区已关闭"));
  canvasController.abort(new Error("画布已关闭"));
  saveCanvas.flush();
  loadRequest++;
});

const nodeWindow = window as typeof window & {
  toonflowNodeHost?: { vue: typeof vueRuntime; vueFlow: typeof vueFlowRuntime; elementPlus: typeof elementPlusRuntime; three: typeof threeRuntime; ai: { runAgentLoop: typeof runAgentLoop; createAssistantMessageEventStream: typeof createAssistantMessageEventStream } };
  toonflowNodes?: NodeTypesObject;
};
nodeWindow.toonflowNodeHost = { vue: vueRuntime, vueFlow: vueFlowRuntime, elementPlus: elementPlusRuntime, three: threeRuntime, ai: { runAgentLoop, createAssistantMessageEventStream } };
provide("nodeConfig", (nodeType: string) => nodeConfigs.value[nodeType] ?? {});
provide("workspaceFiles", () => {
  const directory = project.value?.directory;
  if (!directory) throw new Error("请先选择工作目录");
  return useWorkspaceFiles(directory);
});
provide("workspaceDirectory", () => {
  const directory = project.value?.directory;
  if (!directory) throw new Error("请先选择工作目录");
  return directory;
});
provide("reloadRemoteNode", (type: string) => {
  const name = type.replace(/^remote-/, "");
  if (!type.startsWith("remote-") || !/^[a-z][a-zA-Z0-9]*$/.test(name)) throw new Error("节点类型无效");
  return loadNode(name, `/api/nodes/files?name=${name}`, true);
});

async function loadNode(name: string, url: string, force = false): Promise<void> {
  const nodeType = `remote-${name}`;
  const signal = canvasController.signal;
  const pending = nodeLoads.get(nodeType);
  if (pending) {
    if (!force) return pending;
    await pending.catch(() => {});
  }
  if (!force && nodeTypes.value[nodeType] && !nodeErrors.value[nodeType]) return;
  if (force) {
    signal.throwIfAborted();
    // ACT: 复用画布修订号收敛等待期间的编辑；持续修改画布时延后刷新，不额外维护节点修订状态。
    let revision: number;
    do {
      revision = saveRevision;
      await Promise.all(flow.getNodes.value.filter(node => node.type === nodeType).map(node => useNodeEvent(node.id, flow).emit("save", "reload")));
      await nextTick();
      signal.throwIfAborted();
    } while (revision !== saveRevision);
    const loading = nodeLoads.get(nodeType);
    if (loading) return loading;
  }
  delete nodeErrors.value[nodeType];
  const nodeLoad = loadNodeComponent(name, url, force)
    .then((remoteNode) => {
      // 同类型节点共享组件，运行错误由每个节点自己的边界显示。
      nodeTypes.value = { ...nodeTypes.value, [nodeType]: markRaw(remoteNode) };
    })
    .catch((error) => {
      nodeErrors.value[nodeType] = error instanceof Error ? error.message : String(error);
      throw error;
    })
    .finally(() => nodeLoads.delete(nodeType));
  nodeLoads.set(nodeType, nodeLoad);
  return nodeLoad;
}

async function loadRemoteNodes(reloadName?: string) {
  if (reloadName) nodeReloads.add(reloadName);
  const requestId = ++loadRequest;
  const signal = canvasController.signal;
  nodeListLoading.value = true;
  try {
    const { data } = await axios.get<{ code: number; data: { name: string; displayName: string; url: string; enabled?: boolean; config?: Record<string, unknown> }[] }>(
      "/api/nodes/get",
      { headers: { "Cache-Control": "no-cache", "x-toonflow-workspace": "1" } }
    );
    if (requestId !== loadRequest) return;
    if (data.code !== 200 || !Array.isArray(data.data)) throw new Error("节点列表格式错误");
    const nodes = data.data.filter(node => {
      if (!node || typeof node.name !== "string" || !/^[a-z][a-zA-Z0-9]*$/.test(node.name) || node.url !== `/api/nodes/files?name=${node.name}`) {
        console.error("节点地址无效", node);
        return false;
      }
      return true;
    });
    nodeConfigs.value = Object.fromEntries(nodes.map(node => [`remote-${node.name}`, node.config ?? {}]));
    const enabledNodes = nodes.filter(node => node.enabled !== false);
    // 节点各自加载完成后即可出现在菜单中，不等待其他节点的脚本。
    nodeOptions.value = enabledNodes.map(node => ({ type: `remote-${node.name}`, label: node.displayName }))
      .sort((left, right) => left.type.localeCompare(right.type));
    // ACT: 安装事件合并到最新列表请求，避免连续更新不同节点时丢失较早的刷新名称。
    const reloadNames = new Set(nodeReloads);
    nodeReloads.clear();
    await Promise.all(
      enabledNodes.map(async (node) => {
        const nodeType = `remote-${node.name}`;
        try {
          if (nodeTypes.value[nodeType] && !nodeErrors.value[nodeType] && !reloadNames.has(node.name)) return;
          await loadNode(node.name, node.url, reloadNames.has(node.name));
        } catch (error) {
          console.error("加载远端节点失败", node, error);
          // 保存拒绝时旧组件仍可用，不从节点菜单中移除；脚本加载错误仍排除。
          if (nodeTypes.value[nodeType] && !nodeErrors.value[nodeType]) {
            if (reloadNames.has(node.name) && !signal.aborted) ElMessage.warning({
              message: `${node.displayName}已安装，但当前节点无法刷新。请等待任务结束后，点击节点右上角的刷新按钮。`,
              grouping: true,
            });
          }
        }
      })
    );
  } catch (error) {
    if (requestId === loadRequest) console.error("获取远端节点列表失败", error);
  } finally {
    if (requestId === loadRequest) nodeListLoading.value = false;
  }
}

const defaultEdgeOptions = markRaw({
  type: "simplebezier",
  animated: false,
  class: ({ sourceNode, targetNode }: GraphEdge) => {
    if (!sourceNode.selected && !sourceNode.dragging && !targetNode.selected && !targetNode.dragging) return "";
    return ["edgeNodeActive", generalSettings.value.canvasEdgeColorMode !== "none" && "edgeActive", generalSettings.value.canvasEdgeAnimationEnabled && "animated"].filter(Boolean).join(" ");
  },
  focusable: false,
  selectable: false,
  updatable: false,
  interactionWidth: 40,
});
</script>

<style lang="scss" scoped>
.canvas {
  width: 100%;
  height: 100%;
  // ACT: 画布内的一切（浮层、状态条、节点浮动面板）都不允许撑出页面，否则会触发窗口级滚动条。
  overflow: hidden;
  // ACT: 画布容器必须禁用原生文本选择。框选空白区域时浏览器仍会选中画布里的文字，
  // macOS 的选中高亮是灰蓝色，WKWebView 在缩放层上重绘该高亮会留下残影（Chromium 不会）。
  -webkit-user-select: none;
  user-select: none;

  &.compositingEnabled :deep(.vue-flow__transformationpane) {
    will-change: transform;
  }

  &.handMode :deep(.vue-flow__transformationpane),
  &.handMode :deep(.vue-flow__transformationpane *) {
    pointer-events: none !important;
  }

  &.handMode :deep(.vue-flow__pane) {
    cursor: grab;
  }

  &.edgesHidden :deep(.vue-flow__edges:not(:has(.edgeNodeActive))) {
    display: none;
  }
  &.edgesHidden :deep(.vue-flow__handle:not(.connectedNodeActive)) {
    // Vue Flow 仍会测量隐藏端口，必须保留布局以免零尺寸污染连线坐标。
    visibility: hidden !important;
  }

  :deep(.vue-flow__edge.edgeActive .vue-flow__edge-path) {
    stroke: var(--canvasEdgeColor);
  }

  &:has(.selectionConnection) :deep(.vue-flow__node:not(.selected) .nodeHandle.target .handleIcon) {
    opacity: 1;
  }

  // ACT: 禁止给 .vue-flow__edges 加 contain:paint —— Vue Flow 的 edges SVG 尺寸等于可视区，
  // 但连线坐标是画布坐标系（平移后常见几千 px），超出自身盒子的部分完全依赖官方样式里的
  // overflow: visible 绘制。paint containment 强制裁剪到元素自身盒子，平移后所有连线都在盒子外，
  // 表现就是「连线全没了」。降频只能靠下面的 steps()，不能靠图层隔离。

  // ACT: 虚线流动原本用 linear 插值，stroke-dashoffset 每帧取值都不同，浏览器必须逐帧光栅化 SVG path。
  // steps() 把连续插值改成离散跳变，只在跳变时失效：20 步 / 2s = 10Hz，视觉上仍是流动虚线，
  // 但失效频率从 ~60Hz 降到 10Hz。offset 从 10 走到 0，正好覆盖一个 dasharray 周期，可无缝循环。
  :deep(.vue-flow__edge.animated path) {
    animation: canvasEdgeFlow 2s steps(20) infinite;
  }

  @keyframes canvasEdgeFlow {
    from {
      stroke-dashoffset: 10;
    }
    to {
      stroke-dashoffset: 0;
    }
  }

  :deep(.vue-flow__nodesselection-rect) {
    box-sizing: content-box;
    padding: 8px;
    margin: -8px;
    border-radius: 4px;
  }

  &.multiSelectionMode :deep(.vue-flow__nodesselection-rect) {
    pointer-events: none;
  }
}
.agentPortMenu {
  position: fixed;
  z-index: 3000;
  width: 240px;
  max-height: min(320px, 60vh);
  overflow: auto;
  padding: 4px;
  border: 1px solid var(--el-border-color-light);
  border-radius: var(--el-border-radius-base);
  background: var(--el-bg-color-overlay);
  box-shadow: var(--el-box-shadow-light);
  outline: none;

  .agentPortMenuTitle {
    padding: 6px 8px 4px;
    overflow: hidden;
    color: var(--el-text-color-secondary);
    font-size: 12px;
    line-height: 16px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .agentPortMenuItem {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 8px;
    border: 0;
    border-radius: var(--el-border-radius-small);
    background: transparent;
    color: var(--el-text-color-primary);
    font: inherit;
    text-align: left;
    cursor: pointer;

    .agentPortThumbnail {
      width: 32px;
      height: 32px;
      border-radius: 4px;
      pointer-events: none;
    }

    .agentPortText {
      display: flex;
      flex: 1;
      min-width: 0;
      flex-direction: column;
      gap: 2px;
    }

    .agentPortName {
      overflow: hidden;
      font-size: 13px;
      line-height: 18px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .agentPortMeta {
      overflow: hidden;
      color: var(--el-text-color-secondary);
      font-size: 11px;
      line-height: 15px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .agentPortEmpty {
      flex-shrink: 0;
      color: var(--el-text-color-placeholder);
      font-size: 11px;
    }

    &:hover:not(:disabled),
    &.active:not(:disabled) {
      background: var(--el-fill-color-light);
    }

    &:focus-visible {
      outline: 2px solid var(--el-color-primary);
      outline-offset: -2px;
    }

    &:disabled {
      cursor: not-allowed;
      opacity: 0.5;
    }
  }
}
.edgeDisconnect {
  position: fixed;
  z-index: 1000;
  width: 32px;
  height: 32px;
  padding: 0;
  transform: translate(-50%, -50%);
}
</style>
