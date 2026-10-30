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
      :load-extra-mentions="() => buildMentions(entry.nodeId)"
      :accept-pending="false"
      :auto-focus="false"
      :node-binding="{ canvasId, nodeId: entry.nodeId }"
      @session="file => onSession(entry.nodeId, file)"
      @status="phase => onStatus(entry.nodeId, phase)"
      @promptStart="prompt => onPromptStart(entry.nodeId, prompt)"
      @sessionLost="onSessionLost(entry.nodeId)"
      @rewound="conversation => onRewound(entry.nodeId, conversation)"
      @compactState="state => { entry.compact = state; }"
      @compacting="value => onCompacting(entry.nodeId, value)"
      @question="payload => onQuestion(entry.nodeId, payload)"
      @questionEnd="callId => onQuestionEnd(entry.nodeId, callId)"
      @turnEnd="outcome => onTurnEnd(entry.nodeId, outcome)"
      @forked="payload => onForked(entry.nodeId, payload)" />
  </div>
</template>

<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import axios from "axios";
import { useVueFlow } from "@vue-flow/core";
import { IconArrowsMinimize, IconLoader2, IconRobot, IconX } from "@tabler/icons-vue";
import { ElMessage } from "element-plus";
import { getTargetSources, type AgentNodeStatus } from "@toonflow/nodes-scaffold/runtime";
import { markNodeOutcome } from "@toonflow/nodes-scaffold/nodeBusy";
import type { AgentMention } from "@toonflow/server/agent/types";
import type { AgentConversation, AgentQuestionNotice } from "@/components/agent/types";
import { useWorkspaceStore } from "@/stores/workspace";
import { generalSettings } from "@/stores/settings";
import { gridSize, snapOffset, snapPoint } from "../snapNodes";
import conversation from "@/components/agent/conversation.vue";

const props = defineProps<{
  runtimeKey?: string;
  active: boolean;
  canvasId: string;
  /** canvas 层维护的状态表，节点包通过 inject 读取；这里只写。 */
  statuses: Record<string, AgentNodeStatus>;
}>();

const emit = defineEmits<{
  /** 未读提问列表变化，canvas 层据此渲染顶部横幅。 */
  questions: [list: AgentQuestionNotice[]];
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
  compact?: { disabled: boolean; loading: boolean };
  /** 压缩上下文进行中；期间面板关闭也不卸载实例，重开仍是同一个对话（横幅还在跑）。 */
  compacting: boolean;
  /** 最近一次由对话组件上报的 phase，压缩结束后用它回落角标状态。 */
  phase: AgentNodeStatus;
  /** 未读提问；面板打开（=已读）后清空。 */
  question?: { callId: string; title: string; question: string };
};

// ACT: 输入框一行要放模型名 + 6 个动作按钮，380px 下必然叠字；面板放宽到 440 后常规宽度不再折叠。
const PANEL_MAX_WIDTH = 440;
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
// ACT: 只有「用户没在看这个对话」的提问才算未读；面板正开着时提问卡片就在眼前，不该再弹横幅。
const questionNotices = computed<AgentQuestionNotice[]>(() => Object.values(entries)
  .filter(entry => entry.question)
  .map(entry => ({ nodeId: entry.nodeId, label: entry.label, title: entry.question!.title, question: entry.question!.question })));
watch(questionNotices, list => emit("questions", list), { deep: true, flush: "post", immediate: true });

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
  // ACT: 待克隆指针只在"重试也没用"的情况下才丢弃（源工程已删、文件不存在）。
  // 源会话正在运行时服务端返回 409，等这一轮结束再打开就能克隆成功，所以必须保留指针，
  // 否则一次误点就把副本永久变成空会话，和源会话彻底断链。
  if (data.agentSessionCloneFrom) {
    const source = data.agentSessionCloneFrom;
    try {
      file = (await cloneSession(nodeId, source)) ?? file;
      updateNodeData(nodeId, { agentSessionCloneFrom: undefined });
    } catch (error) {
      file = data.agentSessionFile;
      if (statusOf(error) === 409) {
        ElMessage.warning("源会话正在运行，请等这一轮结束后再打开这个副本");
        close(nodeId);
        return;
      }
      updateNodeData(nodeId, { agentSessionCloneFrom: undefined });
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

// ACT: 画布自动保存有防抖；生成上游快照前必须先落盘，否则服务端读到的还是旧画布。
const flushCanvasSave = inject<(() => Promise<void>) | undefined>("flushCanvasSave", undefined);

// ACT: 注入的直接上游按端口摘要取引用（身份 + 该节点自身输出摘要 + 上游概览），与「@节点」同构；
// 媒体只传指针。源值不可用的上游直接跳过，不阻断发送。
// 关掉「Agent 上游上下文」开关后不再自动引用，回到只有 @ 手动引用的行为。
// 每次发送前现取（而不是打开面板时取一次）：上游正文改了、图片重新生成了、开关刚关掉，
// 都要在下一轮生效，否则模型看到的永远是第一次打开面板时的旧快照。
async function buildMentions(nodeId: string): Promise<AgentMention[]> {
  if (!directory.value || !props.canvasId || !generalSettings.value.agentUpstreamContext) return [];
  const sources = getTargetSources(nodeId, "in", getNodes.value, getEdges.value);
  // ACT: 禁用节点不进入自动上游上下文；服务端也会拒绝，这里先过滤避免一次无谓请求与丢弃。
  const ids = [...new Set(sources.filter(source => source.node.data?.disabled !== true).map(source => source.node.id))]
    .filter(id => id !== nodeId).slice(0, 20);
  if (!ids.length) return [];
  // ACT: 服务端按磁盘画布解析上游，先把待写盘的画布刷下去，否则刚连的线、刚改的正文会读到旧版本。
  await flushCanvasSave?.().catch(() => undefined);
  // ACT: 上游彼此独立，并发取；单条失败只丢这一条，不拖垮整轮。
  const settled = await Promise.allSettled(ids.map(id => request<AgentMention>("/api/agent/mentionSource", {
    params: { directory: directory.value, operation: "selectNode", canvasId: props.canvasId, nodeId: id },
  })));
  return settled.flatMap(item => (item.status === "fulfilled" ? [item.value] : []));
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
    running: false, visible: false, loaded: false,
    // ACT: phase 只作「压缩结束后回落」的底稿，取当前角标值；万一残留的是 compacting 就归零，
    // 否则压缩结束会把「压缩中」又写回去，角标永远卡住。
    compacting: false, phase: props.statuses[nodeId] === "compacting" ? "idle" : (props.statuses[nodeId] ?? "idle"),
  });
  entry.label = nodeData(nodeId).label ?? "Agent";
  entry.visible = true;
  // ACT: 打开即已读——用户已经看到这条对话，横幅立刻让位；没回答就关掉也不反复弹。
  entry.question = undefined;
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
}

function unmountIfIdle(nodeId: string) {
  const entry = entries[nodeId];
  if (!entry || entry.visible || entry.running) return;
  // ACT: 压缩中不卸载——压缩请求没有 abort 通道，卸载只会把「正在压缩」的本地 UI 和后续
  // 刷新历史的结果一起丢掉，重开面板就只剩一个看起来没动过的旧会话。
  if (entry.compacting) return;
  // ACT: 输入框里有没发出去的草稿时不卸载——卸载会把编辑器和附件一起带走，重开就空了。
  if (conversationElements.get(nodeId)?.hasDraft?.()) return;
  // ACT: 一轮结束到续发真正开始之间 busy 已是 false，卸载会 abort 刚发出的请求，
  // 队列/目标循环就是这样被静默丢掉的；有挂起工作一律保活。
  if (conversationElements.get(nodeId)?.hasPendingWork?.()) return;
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
  // ACT: 面板收起即视为空闲；有草稿的实例不会被卸载，状态必须在这里复位，否则卡片一直显示运行中。
  // 压缩中不能写 idle——重开前角标会先假摔成「待开始」，交给 onCompacting 结束时回落。
  if (entry.compacting) props.statuses[target] = "compacting";
  else if (!entry.running) props.statuses[target] = "idle";
  // ACT: 运行中只隐藏不卸载——conversation 卸载会 abort 请求，等于把这一轮杀掉。
  void nextTick(() => unmountIfIdle(target));
}

function onSession(nodeId: string, file: string) {
  updateNodeData(nodeId, { agentSessionFile: file });
  const entry = entries[nodeId];
  if (entry) entry.sessionFile = file;
}

function onStatus(nodeId: string, phase: AgentNodeStatus) {
  const entry = entries[nodeId];
  if (entry) {
    entry.running = phase === "thinking" || phase === "running";
    entry.phase = phase;
  }
  // ACT: 压缩中角标固定「压缩中」；phase 仍照常记账，压缩一结束就能回到理解中/运行中。
  props.statuses[nodeId] = entry?.compacting ? "compacting" : phase;
  if (entry) void nextTick(() => unmountIfIdle(nodeId));
}

// ACT: 压缩是对话组件内部的异步过程，面板关掉以后它还在跑；状态必须由面板记账，
// 这样「重开面板」和「节点角标」看到的是同一份真源，而不是各算各的。
function onCompacting(nodeId: string, value: boolean) {
  const entry = entries[nodeId];
  if (!entry) return;
  entry.compacting = value;
  if (value) {
    props.statuses[nodeId] = "compacting";
    return;
  }
  // 压缩结束回落到 phase 派生值（thinking/running/waiting），不能一律写 idle：
  // 自动压缩可能夹在一轮生成中间，写完会把正在跑的节点显示成空闲。
  props.statuses[nodeId] = entry.phase;
  void nextTick(() => unmountIfIdle(nodeId));
}

function onQuestion(nodeId: string, payload: { callId: string; title: string; question: string }) {
  const entry = entries[nodeId];
  if (!entry) return;
  // ACT: 面板已经开着并且画布在前台时，提问卡片就在用户眼前，直接算已读。
  entry.question = entry.visible && panelActive.value ? undefined : payload;
}

function onQuestionEnd(nodeId: string, callId: string) {
  const entry = entries[nodeId];
  if (entry?.question?.callId === callId) entry.question = undefined;
}

// ACT: 结果要赶在 status 回落为 waiting 之前写进全局任务表——节点降 busy 时会立刻派发完成事件。
function onTurnEnd(nodeId: string, outcome: "failed" | "cancelled") {
  markNodeOutcome(nodeId, outcome);
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
    // ACT: 分支节点要落在网格上——节点宽度带小数时直接加 80 会得到非网格坐标。
    position: snapPoint({ x: node.computedPosition.x + snapOffset(width + 80, gridSize(flow)), y: node.computedPosition.y + 80 }, gridSize(flow)),
    data: { label: `${nodeData(nodeId).label ?? "Agent"} · 分支`, agentSessionFile: payload.file },
  });
  ElMessage.success("已复制出新的 Agent 节点");
}

// ACT: 节点集合用 id 串做键——Vue Flow 的 getNodes 是同一个响应式数组，增删走 push/splice，
// 直接 watch 数组引用或长度在部分路径上不会触发；拼字符串能稳定感知增删。
const nodeIdsKey = computed(() => getNodes.value.map(node => node.id).join("|"));

watch(nodeIdsKey, () => {
  const nodeId = currentNodeId.value;
  if (nodeId && !findNode(nodeId)) close(nodeId);
  // 节点被删后它的状态也一并清掉，撤销回来时先按未知状态显示。
  for (const key of Object.keys(props.statuses)) if (!findNode(key)) delete props.statuses[key];
  // ACT: 有草稿的 entry 不会被 unmountIfIdle 回收，节点真删掉时必须在这里显式清，否则实例泄漏。
  for (const key of Object.keys(entries)) {
    if (findNode(key)) continue;
    delete entries[key];
    panelElements.delete(key);
    conversationElements.delete(key);
  }
});

watch([() => props.active, () => props.canvasId], ([active], previous) => {
  // ACT: 换画布时节点集合整体变了，带草稿保留下来的 entry 也必须清掉，避免跨画布串会话。
  // 但压缩中的实例要留下：压缩请求没有 abort 通道，销毁等于把「正在压缩」与后续刷新一起丢掉。
  if (previous?.[1] !== undefined && previous[1] !== props.canvasId) {
    for (const key of Object.keys(entries)) {
      if (entries[key]?.compacting) {
        entries[key].visible = false;
        continue;
      }
      delete entries[key];
      panelElements.delete(key);
      conversationElements.delete(key);
    }
    currentNodeId.value = undefined;
    return;
  }
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

  /* ACT: 面板只有 380px 宽，原生滚动条会贴在输入框右上、正好压住轮次目录条（系统开了「始终显示
     滚动条」时尤其明显，看起来像一条无主的竖条）。这里隐藏原生滚动条，滚轮/触控板滚动照常。 */
  :deep(.messageList) {
    scrollbar-width: none;

    &::-webkit-scrollbar {
      display: none;
    }
  }

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
