<template>
  <div
    v-for="entry in mountedEntries"
    :key="entry.nodeId"
    v-show="entry.visible"
    :ref="element => setPanelElement(entry.nodeId, element)"
    class="agentNodePanel nowheel nopan"
    role="dialog"
    aria-modal="false"
    tabindex="-1"
    :aria-label="`${entry.label} 的对话`"
    :style="panelStyle(entry.nodeId)"
    @pointerdown.stop
    @wheel.stop
    @click.stop
    @dblclick.stop>
    <header class="agentNodePanelHeader">
      <span class="agentNodePanelTitle">
        <icon-robot :size="14" aria-hidden="true" />
        {{ entry.label }}
      </span>
      <span class="agentNodePanelActions">
        <el-button
          v-if="entry.sessionFile"
          text
          circle
          size="small"
          aria-label="压缩上下文"
          title="压缩上下文"
          :disabled="entry.compact?.disabled !== false"
          :loading="entry.compact?.loading"
          @click="compact(entry.nodeId)">
          <icon-arrows-minimize :size="14" />
        </el-button>
        <el-button text circle size="small" aria-label="关闭对话" title="关闭对话" @click="close()">
          <icon-x :size="14" />
        </el-button>
      </span>
    </header>
    <div v-if="!entry.loaded" class="agentNodePanelLoading" role="status">
      <el-icon class="is-loading" aria-hidden="true"><icon-loader-2 :size="14" /></el-icon>
      <span>正在读取对话…</span>
    </div>
    <conversation
      v-else
      :ref="element => setConversationElement(entry.nodeId, element)"
      :active="entry.visible && panelActive"
      :initial-session="entry.initial"
      :session-file="entry.sessionFile"
      :disabled="false"
      :extra-mentions="entry.mentions"
      :accept-pending="false"
      :show-model-picker="false"
      :node-binding="{ canvasId, nodeId: entry.nodeId }"
      @session="file => onSession(entry.nodeId, file)"
      @status="phase => onStatus(entry.nodeId, phase)"
      @promptStart="prompt => onPromptStart(entry.nodeId, prompt)"
      @sessionLost="onSessionLost(entry.nodeId)"
      @rewound="conversation => onRewound(entry.nodeId, conversation)"
      @compactState="state => { entry.compact = state; }"
      @forked="payload => onForked(entry.nodeId, payload)" />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import axios from "axios";
import { useVueFlow } from "@vue-flow/core";
import { IconArrowsMinimize, IconLoader2, IconRobot, IconX } from "@tabler/icons-vue";
import { ElMessage } from "element-plus";
import { getTargetSources, type AgentNodeStatus } from "@toonflow/nodes-scaffold/runtime";
import type { AgentMention } from "@toonflow/server/agent/types";
import type { AgentConversation } from "@/components/agent/types";
import { useWorkspaceStore } from "@/stores/workspace";
import conversation from "@/components/agent/conversation.vue";

const props = defineProps<{
  runtimeKey?: string;
  active: boolean;
  canvasId: string;
  /** canvas 层维护的状态表，节点包通过 inject 读取；这里只写。 */
  statuses: Record<string, AgentNodeStatus>;
}>();

type AgentNodeData = { label?: string; agentSessionFile?: string; agentSessionCloneFrom?: string; agentLastPrompt?: string };
type PanelEntry = {
  nodeId: string;
  label: string;
  initial: AgentConversation | null;
  sessionFile?: string;
  running: boolean;
  visible: boolean;
  loaded: boolean;
  mentions: AgentMention[];
  compact?: { disabled: boolean; loading: boolean };
};

const PANEL_MAX_WIDTH = 380;
const PANEL_MAX_HEIGHT = 560;
const flow = useVueFlow(props.runtimeKey);
const { viewport, dimensions, findNode, getEdges, getNodes, updateNodeData, addNodes } = flow;
const workspaceStore = useWorkspaceStore();
const directory = computed(() => workspaceStore.project?.directory);
const entries = reactive<Record<string, PanelEntry>>({});
const panelElements = new Map<string, HTMLElement>();
const conversationElements = new Map<string, InstanceType<typeof conversation>>();
const loadingNodeIds = new Set<string>();
const currentNodeId = ref<string>();
const panelActive = computed(() => props.active);
const mountedEntries = computed(() => Object.values(entries));

function nodeData(nodeId: string) {
  return (findNode(nodeId)?.data ?? {}) as AgentNodeData;
}

function setPanelElement(nodeId: string, element: unknown) {
  if (element instanceof HTMLElement) panelElements.set(nodeId, element);
  else panelElements.delete(nodeId);
}

function setConversationElement(nodeId: string, element: unknown) {
  if (element) conversationElements.set(nodeId, element as InstanceType<typeof conversation>);
  else conversationElements.delete(nodeId);
}

// ACT: 压缩上下文由对话组件自己守卫（运行中/无会话/已有操作在跑都会挡），这里只负责转发和反馈。
function compact(nodeId: string) {
  void conversationElements.get(nodeId)?.compactContext();
}

function panelStyle(nodeId: string) {
  const node = findNode(nodeId);
  if (!node) return { display: "none" };
  const { x, y, zoom } = viewport.value;
  const { width, height } = dimensions.value;
  // ACT: 面板整体夹在画布内，否则 .vue-flow 的 overflow:hidden 会把它裁掉；
  // 画布本身比面板还窄/矮时（分栏拖动），面板宽度跟着容器缩。
  const panelWidth = Math.max(240, Math.min(PANEL_MAX_WIDTH, width - 16));
  const panelHeight = Math.max(200, Math.min(PANEL_MAX_HEIGHT, height - 24));
  const nodeWidth = node.dimensions.width || 300;
  const anchorLeft = x + (node.computedPosition.x + nodeWidth) * zoom + 12;
  const left = anchorLeft + panelWidth > width - 8 ? x + node.computedPosition.x * zoom - panelWidth - 12 : anchorLeft;
  const top = Math.max(8, Math.min(y + node.computedPosition.y * zoom, height - panelHeight - 8));
  return {
    left: `${Math.max(8, Math.min(left, width - panelWidth - 8))}px`,
    top: `${top}px`,
    width: `${panelWidth}px`,
    height: `${panelHeight}px`,
  };
}

function statusOf(error: unknown) {
  return (error as { status?: number; response?: { status?: number } })?.status
    ?? (error as { response?: { status?: number } })?.response?.status;
}

async function request<T>(url: string, config: Record<string, unknown>) {
  try {
    const response = await axios.request<{ code: number; data: T; message?: string }>({
      url, headers: { "x-toonflow-workspace": "1" }, ...config,
    });
    if (response.data.code !== 200) throw Object.assign(new Error(response.data.message || "请求失败"), { status: response.data.code });
    return response.data.data;
  } catch (error) {
    if (axios.isAxiosError(error)) throw Object.assign(new Error((error.response?.data as { message?: string } | undefined)?.message || "请求失败"), { status: error.response?.status });
    throw error;
  }
}

async function cloneSession(nodeId: string, source: string) {
  if (!directory.value) return undefined;
  const data = await request<{ file: string }>("/api/agent/clone", { method: "post", data: { directory: directory.value, sessionFile: source } });
  updateNodeData(nodeId, { agentSessionFile: data.file });
  return data.file;
}

async function loadSession(nodeId: string) {
  const entry = entries[nodeId];
  if (!entry) return;
  const data = nodeData(nodeId);
  let file = data.agentSessionFile;
  // ACT: 待克隆指针先消费再请求——克隆失败（源工程已删、源正在跑）时不能留着它，
  // 否则每次打开都会重试同一个坏指针，还会把后来正常建好的会话顶掉。
  if (data.agentSessionCloneFrom) {
    const source = data.agentSessionCloneFrom;
    updateNodeData(nodeId, { agentSessionCloneFrom: undefined });
    try {
      file = (await cloneSession(nodeId, source)) ?? file;
    } catch {
      file = data.agentSessionFile;
      ElMessage.warning("分支会话创建失败，已按空会话开始");
    }
  }
  if (!file || !directory.value) {
    entry.initial = null;
    entry.sessionFile = undefined;
    return;
  }
  entry.sessionFile = file;
  try {
    entry.initial = await request<AgentConversation>("/api/agent/get", { params: { directory: directory.value, sessionFile: file } });
  } catch (error) {
    if (statusOf(error) === 404) {
      // ACT: 文件真的不在了才解绑；500/网络错误保留绑定，避免一次抖动就把会话弄丢。
      updateNodeData(nodeId, { agentSessionFile: undefined, agentLastPrompt: undefined });
      entry.initial = null;
      entry.sessionFile = undefined;
      ElMessage.warning("会话文件已丢失，已重新开始");
    } else {
      entry.initial = null;
      ElMessage.error("会话读取失败，请重新打开面板重试");
    }
  }
}

// ACT: 注入的直接上游按端口摘要取引用（身份 + 上游概览），与「@节点」同构；
// 媒体只传指针。源值不可用的上游直接跳过，不阻断发送。
async function buildMentions(nodeId: string): Promise<AgentMention[]> {
  if (!directory.value || !props.canvasId) return [];
  const sources = getTargetSources(nodeId, "in", getNodes.value, getEdges.value);
  const ids = [...new Set(sources.map(source => source.node.id))].filter(id => id !== nodeId).slice(0, 20);
  const mentions: AgentMention[] = [];
  for (const id of ids) {
    try {
      mentions.push(await request<AgentMention>("/api/agent/mentionSource", {
        params: { directory: directory.value, operation: "selectNode", canvasId: props.canvasId, nodeId: id },
      }));
    } catch {
      // 上游节点可能正在删除或未就绪，跳过即可。
    }
  }
  return mentions;
}

let mentionTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleMentions() {
  if (mentionTimer !== undefined) clearTimeout(mentionTimer);
  mentionTimer = setTimeout(() => {
    mentionTimer = undefined;
    for (const entry of Object.values(entries)) {
      void buildMentions(entry.nodeId).then(mentions => {
        if (entries[entry.nodeId]) entries[entry.nodeId].mentions = mentions;
      });
    }
  }, 250);
}

async function open(nodeId: string) {
  if (!findNode(nodeId)) return;
  // ACT: 同一时刻只留一个可见面板；点另一个节点时先收起前一个（运行中的只隐藏不卸载）。
  if (currentNodeId.value && currentNodeId.value !== nodeId) {
    const previous = entries[currentNodeId.value];
    if (previous) previous.visible = false;
  }
  const entry = entries[nodeId] ?? (entries[nodeId] = {
    nodeId, label: "Agent", initial: null, sessionFile: undefined,
    running: false, visible: false, loaded: false, mentions: [],
  });
  entry.label = nodeData(nodeId).label ?? "Agent";
  entry.visible = true;
  currentNodeId.value = nodeId;
  await nextTick();
  panelElements.get(nodeId)?.focus({ preventScroll: true });
  if (!entry.loaded && !loadingNodeIds.has(nodeId)) {
    loadingNodeIds.add(nodeId);
    try {
      await loadSession(nodeId);
    } finally {
      loadingNodeIds.delete(nodeId);
      if (entries[nodeId]) entries[nodeId].loaded = true;
    }
  }
  scheduleMentions();
}

function unmountIfIdle(nodeId: string) {
  const entry = entries[nodeId];
  if (!entry || entry.visible || entry.running) return;
  delete entries[nodeId];
  panelElements.delete(nodeId);
  conversationElements.delete(nodeId);
  props.statuses[nodeId] = "idle";
}

function close(nodeId?: string) {
  const target = nodeId ?? currentNodeId.value;
  if (!target) return;
  if (currentNodeId.value === target) currentNodeId.value = undefined;
  const entry = entries[target];
  if (!entry) return;
  entry.visible = false;
  // ACT: 运行中只隐藏不卸载——conversation 卸载会 abort 请求，等于把这一轮杀掉。
  void nextTick(() => unmountIfIdle(target));
}

function onSession(nodeId: string, file: string) {
  updateNodeData(nodeId, { agentSessionFile: file });
  const entry = entries[nodeId];
  if (entry) entry.sessionFile = file;
}

function onStatus(nodeId: string, phase: AgentNodeStatus) {
  props.statuses[nodeId] = phase;
  const entry = entries[nodeId];
  if (!entry) return;
  entry.running = phase === "thinking" || phase === "running";
  void nextTick(() => unmountIfIdle(nodeId));
}

function onPromptStart(nodeId: string, prompt: string) {
  updateNodeData(nodeId, { agentLastPrompt: prompt.slice(0, 120) });
}

function onSessionLost(nodeId: string) {
  updateNodeData(nodeId, { agentSessionFile: undefined });
  const entry = entries[nodeId];
  if (entry) entry.sessionFile = undefined;
}

function onRewound(nodeId: string, session: AgentConversation) {
  const last = [...(session.messages ?? [])].reverse().find(message => message.role === "user");
  updateNodeData(nodeId, { agentLastPrompt: last ? last.content.slice(0, 120) : undefined });
}

async function onForked(nodeId: string, payload: { file: string; name: string }) {
  const node = findNode(nodeId);
  if (!node) return;
  const width = node.dimensions.width || 300;
  addNodes({
    id: crypto.randomUUID(),
    type: "remote-agentNode",
    position: { x: node.computedPosition.x + width + 80, y: node.computedPosition.y + 80 },
    data: { label: `${nodeData(nodeId).label ?? "Agent"} · 分支`, agentSessionFile: payload.file },
  });
  ElMessage.success("已复制出新的 Agent 节点");
}

// ACT: 节点集合用 id 串做键——Vue Flow 的 getNodes 是同一个响应式数组，增删走 push/splice，
// 直接 watch 数组引用或长度在部分路径上不会触发；拼字符串能稳定感知增删。
const nodeIdsKey = computed(() => getNodes.value.map(node => node.id).join("|"));
const edgeIdsKey = computed(() => getEdges.value.map(edge => `${edge.source}>${edge.target}@${edge.targetHandle ?? ""}`).join("|"));

watch(nodeIdsKey, () => {
  const nodeId = currentNodeId.value;
  if (nodeId && !findNode(nodeId)) close(nodeId);
  // 节点被删后它的状态也一并清掉，撤销回来时先按未知状态显示。
  for (const key of Object.keys(props.statuses)) if (!findNode(key)) delete props.statuses[key];
});

watch([edgeIdsKey, nodeIdsKey], scheduleMentions);

watch([() => props.active, () => props.canvasId], ([active]) => {
  if (!active) close();
}, { flush: "post" });

// ACT: Esc 关闭面板；技能/提及弹层等内部控件会 preventDefault，这里让它们先处理。
function onKeydown(event: KeyboardEvent) {
  if (event.key !== "Escape" || event.defaultPrevented || !currentNodeId.value) return;
  close();
}
onMounted(() => window.addEventListener("keydown", onKeydown));

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
  if (mentionTimer !== undefined) clearTimeout(mentionTimer);
  for (const nodeId of Object.keys(entries)) delete entries[nodeId];
  currentNodeId.value = undefined;
});

defineExpose({ open, close, isOpen: () => !!currentNodeId.value });
</script>

<style lang="scss" scoped>
.agentNodePanel {
  position: absolute;
  z-index: 10;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--el-border-color-light);
  border-radius: 12px;
  background: var(--el-bg-color-overlay);
  box-shadow: var(--el-box-shadow);
  pointer-events: auto;
  outline: none;
  /* 画布统一 user-select: none，对话正文要能选中复制。 */
  user-select: text;
  -webkit-user-select: text;

  .agentNodePanelHeader {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 6px 6px 6px 10px;
    border-bottom: 1px solid var(--el-border-color-lighter);
    color: var(--el-text-color-secondary);
    font-size: 12px;

    .agentNodePanelActions {
      display: flex;
      align-items: center;
      gap: 2px;
      flex: none;
    }

    .agentNodePanelTitle {
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }
  }

  .agentNodePanelLoading {
    display: flex;
    flex: 1;
    align-items: center;
    justify-content: center;
    gap: 6px;
    color: var(--el-text-color-secondary);
    font-size: 12px;
  }

  :deep(.agentConversation) {
    min-height: 0;
  }
}
</style>
