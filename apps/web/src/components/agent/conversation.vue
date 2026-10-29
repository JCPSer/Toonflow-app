<template>
  <div class="agentConversation">
    <messageList
      :messages="messages"
      :directory="directory"
      :active="active"
      :disabled="disabled"
      :locked="locked"
      :busy="busy"
      :remoteRunning="remoteRunning"
      :compacting="compacting"
      :editingId="editingId"
      :deletingId="deletingId"
      :voiceActive="voiceActive"
      :subAgent="!!initialSession?.parentFile"
      @fillPrompt="input?.fillPrompt($event)"
      @copy="copyMessage"
      @edit="input?.editMessage($event)"
      @delete="deleteMessage"
      @rewind="rewindMessage"
      @fork="forkMessage"
      @cancelEdit="input?.cancelEdit()" />
    <div v-if="compacting" class="compactionStatus" role="status">
      <el-icon class="is-loading" aria-hidden="true"><icon-loader-2 :size="14" /></el-icon>
      <span>正在压缩上下文…</span>
    </div>
    <div v-else-if="retryNotice" class="retryStatus" role="status">
      <el-icon class="is-loading" aria-hidden="true"><icon-loader-2 :size="14" /></el-icon>
      <span>{{ retryNotice }}</span>
    </div>
    <div v-else-if="busy && silentSeconds >= 10" class="compactionStatus" role="status">
      <el-icon class="is-loading" aria-hidden="true"><icon-loader-2 :size="14" /></el-icon>
      <span>等待模型响应… {{ silentSeconds }}s</span>
    </div>
    <div
      v-if="!initialSession?.parentFile && autoCompactEnabled && contextPercent >= compactThreshold && !compacting"
      class="compactionStatus contextAlert"
      :class="contextPercent >= 90 ? 'danger' : 'warning'"
      role="alert">
      <icon-alert-triangle :size="14" aria-hidden="true" />
      <span>
        <template v-if="contextPercent >= 90">上下文已使用 {{ contextDisplayPercent }}%，建议立即压缩</template>
        <template v-else>上下文已使用 {{ contextDisplayPercent }}%，已达自动压缩阈值 {{ compactThreshold }}%</template>
      </span>
      <el-button
        v-if="contextPercent >= 90 || contextPercent >= compactThreshold"
        link
        type="danger"
        size="small"
        :loading="manualCompacting"
        :disabled="compactBlocked"
        aria-label="立即压缩上下文"
        title="立即压缩上下文"
        @click="compactContext">立即压缩</el-button>
    </div>
    <div v-if="goal" class="goalBanner" role="status" aria-live="polite">
      <span class="goalIcon" aria-hidden="true">🎯</span>
      <span class="goalText" :title="goal.goal">目标：{{ goal.goal }}</span>
      <span class="goalState">{{ goalBannerText(goal) }}</span>
      <el-button v-if="goal.status === 'active'" text size="small" @click="stopGoalLoop">暂停</el-button>
      <el-button v-else-if="goal.status === 'paused'" text size="small" @click="resumeGoalLoop">继续</el-button>
      <el-button text size="small" @click="clearGoal()">清除</el-button>
    </div>
    <messageInput
      ref="input"
      v-model:selectedModel="selectedModel"
      v-model:reasoningEffort="reasoningEffort"
      v-model:editingId="editingId"
      v-model:voiceActive="voiceActive"
      v-model:restoringAttachment="restoringAttachment"
      :active="active"
      :disabled="disabled"
      :busy="busy"
      :remoteRunning="remoteRunning"
      :deletingId="deletingId"
      :directory="directory"
      :history="historyMessages"
      :contextUsage="contextUsage"
      :stats="stats"
      :contextWindow="contextWindow"
      :acceptPending="acceptPending !== false"
      :showModel="showModelPicker !== false"
      :autoFocus="autoFocus !== false"
      :queue="queuePreview"
      @submit="submitMessage"
      @stop="stopMessage"
      @enqueue="enqueueMessage"
      @sendQueued="sendQueuedNow"
      @removeQueued="removeQueued" />
  </div>
</template>

<script setup lang="ts">
import { locale, translate } from "@toonflow/i18n/vue";
import { computed, inject, nextTick, onBeforeUnmount, reactive, ref, watch } from "vue";
import axios from "axios";
import { IconAlertTriangle, IconLoader2 } from "@tabler/icons-vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { getReadableFileExtension, getReadableFileMimeType } from "@toonflow/server/documentFormats";
import useWorkspaceFiles from "@/lib/workspaceFiles";
import { writeClipboardText } from "@/lib/clipboard";
import anonymousData from "@/lib/anonymousData";
import { trackStream } from "@/lib/netProbe";
import { agentSettings, modelChoices } from "@/stores/settings";
import { useWorkspaceStore } from "@/stores/workspace";
import type { AgentAttachment, AgentConversation, AgentMessage } from "./types";
import type { AgentMention } from "@toonflow/server/agent/types";
import type { AgentEvent } from "@toonflow/server/agent/types";
import { createConversationStream, readAgentEvents } from "./replyStream";
import { mentionPlainText } from "./mentionText";
import type { CanvasContext } from "@toonflow/tool-canvas/runtime";
import messageList from "./conversation/messageList.vue";
import messageInput from "./conversation/messageInput.vue";
import { defaultMaxRounds, donePattern, goalPath, goalReviewPrompt, stripDoneMark, type GoalState } from "./conversation/goal";

const props = withDefaults(defineProps<{
  active: boolean;
  initialSession: AgentConversation | null;
  sessionFile?: string;
  disabled: boolean;
  /** 画布 Agent 节点注入的直接上游引用：发送这一刻现取，保证上游正文与开关状态都是最新的。 */
  loadExtraMentions?: () => Promise<AgentMention[]>;
  /** 节点面板不参与全局「加入对话」队列，否则会和主面板抢同一条待发消息。 */
  acceptPending?: boolean;
  /** 节点面板不提供模型选择入口，统一跟随全局设置。 */
  showModelPicker?: boolean;
  /** 打开时是否把焦点放进输入框；画布节点面板关闭它，避免点了节点就无法用 Backspace 删除。 */
  autoFocus?: boolean;
  /** 画布 Agent 节点绑定；服务端据此给会话打 toonflowAgentNode 标记并从历史里隐藏。 */
  nodeBinding?: { canvasId: string; nodeId: string };
}>(), {
  // ACT: Boolean 类型 prop 缺省会被 Vue 强制转成 false，这三个开关的默认语义必须是开，
  // 否则模型下拉、待发消息接收、打开即聚焦会全部静默失效。
  acceptPending: true,
  showModelPicker: true,
  autoFocus: true,
});
const emit = defineEmits<{
  session: [file: string];
  forked: [payload: { file: string; name: string }];
  rewound: [conversation: AgentConversation];
  sent: [prompt: string];
  /** 发送开始即上报，供节点/画布在流结束前就能显示摘要。 */
  promptStart: [prompt: string];
  status: [phase: "idle" | "waiting" | "thinking" | "running"];
  /** 服务端报告会话文件不存在（早期中止后 SDK 没落盘），外层应清掉绑定，下次发送重新建。 */
  sessionLost: [];
  /** askUser 发起提问：外层用来在画布上提示「这个节点在等你回答」。 */
  question: [payload: { callId: string; title: string; question: string }];
  /** 提问被回答或本轮结束时撤销，参数是发起时的 callId。 */
  questionEnd: [callId: string];
  /** 整轮以失败或被用户停止收场；成功不单独上报，节点按默认成功处理。 */
  turnEnd: [outcome: "failed" | "cancelled"];
  event: [event: AgentEvent];
  compactState: [state: { disabled: boolean; loading: boolean }];
  /** 压缩上下文的进行状态（含服务端自动压缩）。面板据此保活实例、把角标写成「压缩中」。 */
  compacting: [value: boolean];
}>();
const workspaceStore = useWorkspaceStore();
const directory = workspaceStore.project?.directory;
const createCanvasContext = inject<(() => CanvasContext | undefined) | undefined>("canvas", undefined);
const messages = ref<AgentMessage[]>((props.initialSession?.messages ?? []).map(message => ({ ...message })));
// ACT: 历史只取当前会话里有内容的用户消息；相邻重复按内容+提及+附件去重，避免翻出两条一模一样的。
const historyMessages = computed(() => {
  const list: AgentMessage[] = [];
  let previousKey = "";
  for (const message of messages.value) {
    if (message.role !== "user" || message.error) continue;
    if (!message.content.trim() && !message.attachments?.length && !message.mentions?.length) continue;
    const key = JSON.stringify([
      message.content,
      message.mentions?.map(mention => mention.id) ?? [],
      message.attachments?.map(attachment => [attachment.name, attachment.mimeType, attachment.file?.size ?? 0]) ?? [],
    ]);
    if (key === previousKey) continue;
    previousKey = key;
    list.push(message);
  }
  return list;
});
const stream = createConversationStream(messages);
const remoteRunning = ref(props.initialSession?.running ?? false);
const stats = ref(props.initialSession?.stats);
const contextUsage = ref(props.initialSession?.contextUsage);
const busy = ref(false);
const compacting = ref(false);
const manualCompacting = ref(false);
// ACT: 一轮结束到「续发真正开始」之间有一个空档（等 nextTick / 写目标状态）。这期间 busy 已是 false，
// 面板会以为空闲把实例卸载、连带 abort 刚发出的请求，所以用这个标记把这段窗口显式保活。
const resuming = ref(false);
const retryNotice = ref<string>();
const silentSeconds = ref(0);
let silenceTimer: ReturnType<typeof setInterval> | undefined;
let lastEventAt = 0;
const deletingId = ref<string>();
// ACT: 回退/复制正在改写会话文件，期间必须挡住发送与其它消息操作，否则会撞上文件锁。
const sessionAction = ref<"rewind" | "fork">();
const restoringAttachment = ref(false);
const input = ref<InstanceType<typeof messageInput>>();
const voiceActive = ref(false);
const locked = computed(() => props.disabled || busy.value || deletingId.value !== undefined || restoringAttachment.value || voiceActive.value || sessionAction.value !== undefined);
const compactBlocked = computed(() => locked.value || remoteRunning.value || compacting.value || !props.sessionFile);
const compactState = computed(() => ({ disabled: compactBlocked.value, loading: manualCompacting.value }));
watch(compactState, state => emit("compactState", state), { immediate: true });
// ACT: 面板关掉只是 v-show 隐藏，压缩本身还在跑。「正在压缩」不能只留在本地 ref 里——
// 外层面板要拿它决定「不卸载实例」和节点角标文案，否则关一次面板状态就看起来没了。
const busyCompacting = computed(() => compacting.value || manualCompacting.value);
watch(busyCompacting, value => emit("compacting", value));
const editingId = ref<string>();
let controller: AbortController | undefined;
type QueuedDraft = { id: string; prompt: string; attachments: AgentAttachment[]; mentions: AgentMention[]; mentionedIds: string[]; preview: string };
// ACT: 生成中发送不直接打断：先进队列，本轮结束后自动发；要立刻发再点「立即发送/打断」。
const sendQueue = ref<QueuedDraft[]>([]);
const queuePreview = computed(() => sendQueue.value.map(item => ({ id: item.id, preview: item.preview })));
let resumeAfterStop: QueuedDraft | undefined;
let stoppedByUser = false;
const pendingMessage = props.initialSession?.parentFile || props.acceptPending === false ? undefined : workspaceStore.pendingAgentMessage;
// ACT: 节点面板用它把「理解中 / 运行中」画到节点上。四态由发送与事件推进，不能从消息推断——
// 已下发但还没有任何 assistant 活动时，消息列表和空闲状态没有区别。
const phase = ref<"idle" | "waiting" | "thinking" | "running">(
  props.initialSession?.running ? "running"
    : (props.initialSession?.messages ?? []).some(message => message.role === "user") ? "waiting" : "idle"
);
watch(phase, value => emit("status", value), { immediate: true });
// ACT: 回退/删光消息后要能退回「待开始」，否则节点一直挂着「等待输入」。
function syncPhase() {
  if (busy.value || remoteRunning.value) return;
  phase.value = messages.value.some(message => message.role === "user") ? "waiting" : "idle";
}
const selectedModel = ref(pendingMessage?.model ?? (props.initialSession?.providerId && props.initialSession.modelId
  ? JSON.stringify([props.initialSession.providerId, props.initialSession.modelId]) : ""));
const reasoningEffort = ref(pendingMessage?.reasoningEffort ?? props.initialSession?.thinkingLevel ?? "");
const selectedModelChoice = computed(() => modelChoices.value.find(item => item.value === selectedModel.value));
// ACT: 新会话没有历史模型；节点面板又按需求隐藏了模型选择器，没有兜底就永远发不出去
// （只会弹「请先选择模型」且无处可选）。这里跟主面板一样落到第一个可用模型。
watch(modelChoices, items => {
  if (selectedModel.value && items.some(item => item.value === selectedModel.value)) return;
  const fallback = items.find(item => !item.hidden)?.value;
  if (fallback) selectedModel.value = fallback;
}, { immediate: true });
const contextWindow = computed(() => contextUsage.value?.contextWindow ?? selectedModelChoice.value?.contextWindow ?? 262144);
const contextPercent = computed(() => {
  const usage = contextUsage.value;
  if (!usage) return 0;
  if (typeof usage.percent === "number" && Number.isFinite(usage.percent)) return Math.min(100, Math.max(0, usage.percent));
  return usage.tokens != null && usage.contextWindow > 0 ? Math.min(100, Math.max(0, usage.tokens / usage.contextWindow * 100)) : 0;
});
const contextDisplayPercent = computed(() => Math.round(contextPercent.value));
// ACT: 提示阈值跟随设置页，关闭自动压缩后不再提示「接近自动压缩」，避免文案与真实行为不一致。
const compactThreshold = computed(() => agentSettings.value.compactPercent);
const autoCompactEnabled = computed(() => agentSettings.value.autoCompact);
function applyEvent(event: AgentEvent) {
  switch (event.type) {
    case "subAgent":
    case "subAgentEvent": emit("event", event); break;
    case "report":
      if (event.parentFile !== props.sessionFile) { emit("event", event); break; }
      if (!messages.value.some(message => message.id === event.id)) messages.value.push({
        id: event.id, role: "assistant", content: event.content,
        parts: [{ id: event.id, type: "text", content: event.content }], report: { file: event.file, name: event.name },
      });
      break;
    case "compaction": compacting.value = event.active; break;
    case "session": emit("session", event.file); break;
    case "stats": stats.value = event.stats; contextUsage.value = event.contextUsage; break;
    // ACT: 服务端看门狗触发自动重试时，告诉用户还在推进，而不是只有转圈。
    case "retry":
      retryNotice.value = `连接异常（${event.errorMessage}），${Math.max(1, Math.round(event.delayMs / 1000))} 秒后自动重试（${event.attempt}/${event.maxAttempts}）`;
      break;
    case "text":
    case "thinking":
    case "tool":
      retryNotice.value = undefined;
      // ACT: 收到任一 assistant 活动就算「运行中」；此前一律是「理解中」，
      // 否则工具优先的轮次会卡在理解中好几分钟。
      phase.value = "running";
      stream.receive(event);
      break;
    default: stream.receive(event);
  }
}

function receiveEvent(event: AgentEvent) {
  if (event.type === "done" || event.type === "error") {
    remoteRunning.value = false;
    compacting.value = false;
    phase.value = "waiting";
  } else if (["userMessage", "text", "thinking", "tool"].includes(event.type)) remoteRunning.value = true;
  lastEventAt = performance.now();
  applyEvent(event);
}

function startSilenceWatch() {
  stopSilenceWatch();
  lastEventAt = performance.now();
  silentSeconds.value = 0;
  silenceTimer = setInterval(() => {
    silentSeconds.value = busy.value ? Math.floor((performance.now() - lastEventAt) / 1000) : 0;
  }, 1000);
}

function stopSilenceWatch() {
  if (silenceTimer) clearInterval(silenceTimer);
  silenceTimer = undefined;
  silentSeconds.value = 0;
  retryNotice.value = undefined;
}

/** ACT: 外层据此决定卸载时机；有草稿时必须保留实例，否则关闭面板就丢输入。 */
function hasDraft() {
  return input.value?.hasDraft?.() ?? false;
}

/** 面板据此判断能否安全卸载：续发窗口、队列、目标循环都算"还有活要干"。 */
function hasPendingWork() {
  return busy.value || resuming.value || sendQueue.value.length > 0 || !!resumeAfterStop;
}

defineExpose({ receiveEvent, compactContext, hasDraft, hasPendingWork });

// ACT: 目标存在项目里（.agent/goals/<会话>.json），打断/关面板/重启后重新打开还能接着跑。
const goal = ref<GoalState | null>(null);
let goalLoaded = false;
let goalSuspended = false;
/** 当前目标属于哪个会话文件；undefined 表示"新会话、仅内存"。 */
let goalOwner: string | undefined;

function goalFiles() {
  return directory ? useWorkspaceFiles(directory) : undefined;
}

async function persistGoal(next: GoalState | null) {
  const sessionFile = props.sessionFile;
  goal.value = next;
  goalOwner = next ? sessionFile : undefined;
  const files = goalFiles();
  if (!sessionFile || !files) return;
  try {
    if (!next) await files.remove(goalPath(sessionFile)).catch(() => {});
    else await files.writeJson(goalPath(sessionFile), next);
  } catch (error) {
    console.warn("保存目标失败", error);
  }
}

async function loadGoal() {
  const sessionFile = props.sessionFile;
  const files = goalFiles();
  // ACT: 新会话还没有会话文件时目标只在内存；第一次回复生成文件名后要把它落盘，
  // 不能反过来用磁盘上的"空"覆盖掉刚设定的目标。
  if (!sessionFile || !files) {
    if (!sessionFile) { goal.value = null; goalOwner = undefined; }
    goalLoaded = true;
    return;
  }
  if (goalOwner === sessionFile) { goalLoaded = true; return; }
  if (goalOwner === undefined && goal.value) {
    await persistGoal(goal.value);
    goalLoaded = true;
    return;
  }
  goalLoaded = false;
  try {
    const stored = await files.readJson<GoalState>(goalPath(sessionFile));
    goal.value = stored && typeof stored.goal === "string" && stored.goal.trim()
      ? { goal: stored.goal, round: Number(stored.round) || 0, maxRounds: Number(stored.maxRounds) || defaultMaxRounds,
        status: stored.status === "paused" || stored.status === "done" ? stored.status : "active", updatedAt: stored.updatedAt ?? "" }
      : null;
  } catch {
    goal.value = null;
    goalOwner = undefined;
  } finally {
    goalLoaded = true;
  }
}

function goalBannerText(state: GoalState) {
  const status = state.status === "active" ? "进行中" : state.status === "paused" ? "已暂停" : "已达成";
  return `${status} · 第 ${state.round}/${state.maxRounds} 轮`;
}

function goalHelp() {
  return [
    "用法：",
    "/goal <目标>          设定目标并开始自动循环",
    "/goal                 查看当前目标与状态",
    "/goal stop            暂停循环（保留目标）",
    "/goal reset [新目标]  重置轮次；带内容则改目标",
    "/goal off | none | cancel  清除目标并关闭循环",
    "/compact              立即压缩上下文",
    `循环方式：每轮结束由模型自评是否达成，达成时输出 ${"[[GOAL:DONE]]"}；未达成自动进入下一轮（默认上限 ${defaultMaxRounds} 轮）。`,
  ].join("\n");
}

async function runGoalRound(reason: "auto" | "resume") {
  const state = goal.value;
  if (!state || state.status !== "active" || busy.value || !goalLoaded) return;
  if (state.round >= state.maxRounds) {
    await persistGoal({ ...state, status: "paused", updatedAt: new Date().toISOString() });
    ElMessage.warning(`目标已达 ${state.maxRounds} 轮上限，已暂停；可 /goal reset 继续`);
    return;
  }
  const next: GoalState = { ...state, round: state.round + 1, updatedAt: new Date().toISOString() };
  // ACT: 写盘与拼草稿期间 busy 还是 false，实例一旦被卸载这个循环就静默停摆；用 resuming 保活。
  resuming.value = true;
  try {
    await persistGoal(next);
    const draft: QueuedDraft = { id: crypto.randomUUID(), prompt: goalReviewPrompt(next), attachments: [], mentions: [], mentionedIds: [], preview: `目标回顾（第 ${next.round} 轮）` };
    await sendMessage(undefined, draft);
  } finally {
    resuming.value = false;
  }
  if (reason === "resume") ElMessage.info("已恢复目标循环");
}

/** 指令模式：以 / 开头的输入不进模型，先由客户端处理。返回 true 表示已消费。 */
async function handleCommand(text: string) {
  const [rawName, ...rest] = text.trim().split(/\s+/);
  // ACT: 判定用大小写不敏感的正则，这里必须同样归一化，否则 `/Compact` 会被判定命中却没人处理。
  const name = (rawName ?? "").toLowerCase();
  const args = rest.join(" ").trim();
  if (name === "/compact") {
    await compactContext();
    return true;
  }
  if (name !== "/goal") return false;
  const sub = rest[0]?.toLowerCase();
  if (!args) {
    await ElMessageBox.alert(goal.value
      ? `目标：${goal.value.goal}\n状态：${goalBannerText(goal.value)}`
      : "当前对话没有设置目标。", "目标状态", { confirmButtonText: "知道了" }).catch(() => {});
    return true;
  }
  if (!goal.value && ["stop", "reset"].includes(sub ?? "") && rest.length === 1) {
    ElMessage.info("当前对话还没有目标");
    return true;
  }
  if (["off", "none", "cancel"].includes(sub ?? "") && rest.length === 1) {
    await persistGoal(null);
    ElMessage.success("已清除目标并关闭循环");
    return true;
  }
  if (sub === "stop" && rest.length === 1 && goal.value) {
    await persistGoal({ ...goal.value, status: "paused", updatedAt: new Date().toISOString() });
    ElMessage.success("目标循环已暂停，发送 /goal reset 可继续");
    return true;
  }
  if (sub === "help" || sub === "?") {
    await ElMessageBox.alert(goalHelp(), "指令说明", { confirmButtonText: "知道了" }).catch(() => {});
    return true;
  }
  if (sub === "reset") {
    const target = rest.slice(1).join(" ").trim() || goal.value?.goal;
    if (!target) { ElMessage.warning("请提供目标内容，例如 /goal reset 完成开场白稿子"); return true; }
    await persistGoal({ goal: target, round: 0, maxRounds: goal.value?.maxRounds ?? defaultMaxRounds, status: "active", updatedAt: new Date().toISOString() });
    ElMessage.success(`目标已重置：${target}`);
    void runGoalRound("auto");
    return true;
  }
  // 其余情况一律视为设定新目标（含 /goal 重新描述）。
  const target = sub === "set" ? rest.slice(1).join(" ").trim() : args;
  if (!target) { ElMessage.warning("请输入目标内容"); return true; }
  await persistGoal({ goal: target, round: 0, maxRounds: defaultMaxRounds, status: "active", updatedAt: new Date().toISOString() });
  ElMessage.success(`目标已设定：${target}（每轮结束自动回顾，最多 ${defaultMaxRounds} 轮）`);
  // ACT: 设定即开跑——用户写 /goal 就是要它开始，不必再手动发一条"开始"。
  if (!busy.value) void runGoalRound("auto");
  return true;
}

function clearGoal() {
  goalSuspended = false;
  void persistGoal(null);
}

function stopGoalLoop() {
  if (goal.value?.status !== "active") return;
  goalSuspended = true;
  void persistGoal({ ...goal.value, status: "paused", updatedAt: new Date().toISOString() });
  ElMessage.info("目标循环已暂停");
}

function resumeGoalLoop() {
  if (!goal.value) return;
  goalSuspended = false;
  void persistGoal({ ...goal.value, status: "active", updatedAt: new Date().toISOString() }).then(() => {
    if (!busy.value) void runGoalRound("resume");
  });
}

watch(() => props.sessionFile, () => { void loadGoal(); }, { immediate: true });
watch(() => props.active, (active, _previous, onCleanup) => {
  // ACT: 打断后重新打开对话要能接着跑；只在激活时补一次，且必须没有正在生成的轮次。
  if (!active || goalSuspended) return;
  const timer = setTimeout(() => {
    if (props.active && goalLoaded && goal.value?.status === "active" && !busy.value) void runGoalRound("resume");
  }, 1500);
  onCleanup(() => clearTimeout(timer));
});

function takeDraft() {
  const draft = input.value?.getDraft();
  if (!draft) return undefined;
  const prompt = draft.prompt.trim();
  if (!prompt && !draft.attachments.length) return undefined;
  return {
    id: crypto.randomUUID(),
    prompt,
    attachments: draft.attachments.map(item => ({ ...item })),
    mentions: draft.mentions.map(item => ({ ...item })),
    mentionedIds: [...draft.mentionedIds],
    preview: prompt || draft.attachments[0]?.name || "附件",
  } satisfies QueuedDraft;
}

/**
 * ACT: 只有内置指令才由客户端消费。`/skill:xxx` 这类是发给模型的正文（服务端认这个前缀），
 * 判断必须放在清草稿之前——先清后判会让「拼错命令」或「技能」的输入被静默吞掉。
 */
function isBuiltinCommand(text: string) {
  return /^\/(compact|goal)(\s|$)/i.test(text.trim());
}

function submitMessage() {
  if (editingId.value) return sendMessage(messages.value.find(item => item.id === editingId.value));
  // ACT: 指令模式：只有 /compact、/goal 由客户端消费，其它以 / 开头的输入照常发给模型。
  const commandText = input.value?.getDraft()?.prompt?.trim() ?? "";
  if (isBuiltinCommand(commandText)) {
    void input.value?.clearDraft();
    void handleCommand(commandText).catch(error => ElMessage.error(error instanceof Error ? error.message : "指令执行失败"));
    return;
  }
  // ACT: 生成中直接点发送 = 打断当前轮并立即发这条，不静默进队列（那会让人以为没发出去）。
  if (busy.value) {
    const draft = takeDraft();
    if (!draft) return;
    resumeAfterStop = draft;
    stoppedByUser = false;
    void input.value?.clearDraft();
    controller?.abort();
    return;
  }
  return sendMessage();
}

function enqueueMessage() {
  const draft = takeDraft();
  if (!draft) return;
  sendQueue.value.push(draft);
  void input.value?.clearDraft();
}

function removeQueued(index: number) {
  sendQueue.value.splice(index, 1);
}

function sendQueuedNow(index: number) {
  const [draft] = sendQueue.value.splice(index, 1);
  if (!draft) return;
  if (!busy.value) { void sendMessage(undefined, draft); return; }
  resumeAfterStop = draft;
  stoppedByUser = false;
  controller?.abort();
}

async function copyMessage(content: string) {
  try {
    await writeClipboardText(content);
    ElMessage.success("已复制");
  } catch {
    ElMessage.error("复制失败，请重试");
  }
}

async function deleteMessage(item: AgentMessage) {
  if (locked.value || remoteRunning.value || item.streaming || item.report) return;
  deletingId.value = item.id;
  try {
    if (item.entryId || item.replyTo) {
      if (!directory || !props.sessionFile) throw new Error("请重新打开对话后再删除");
      const { data } = await axios.delete<{ code: number; data: AgentConversation; message?: string }>("/api/agent/message", {
        data: {
          directory, sessionFile: props.sessionFile,
          ...(item.replyTo ? { replyTo: item.replyTo } : { entryIds: [item.entryId!] }),
        },
        headers: { "x-toonflow-workspace": "1" },
      });
      if (data.code !== 200) throw new Error(data.message || "删除消息失败");
      stats.value = data.data.stats;
      contextUsage.value = data.data.contextUsage;
    }
    messages.value = messages.value.filter(message => message.id !== item.id &&
      !(item.replyTo && message.role === "assistant" && !message.report && message.replyTo === item.replyTo));
    syncPhase();
  } catch (error) {
    const message = axios.isAxiosError<{ message?: string }>(error) ? error.response?.data?.message : undefined;
    ElMessage.error(message || (error instanceof Error ? error.message : "删除消息失败"));
  } finally {
    deletingId.value = undefined;
  }
}

function sessionUnavailable() {
  if (!directory || !props.sessionFile) {
    ElMessage.warning("请重新打开对话后再操作");
    return true;
  }
  return false;
}

// ACT: 回退会物理删除这条之后的所有对话，先确认再执行；工作区文件、画布和附件不回滚。
async function rewindMessage(item: AgentMessage) {
  if (locked.value || remoteRunning.value || item.streaming || item.report || !item.entryId || sessionUnavailable()) return;
  try {
    await ElMessageBox.confirm(
      "回退到这条消息之前？它之后的对话会被永久删除，不会回滚工作区文件、画布和附件。",
      "回退对话",
      { type: "warning", confirmButtonText: "回退", cancelButtonText: "取消" },
    );
  } catch {
    return;
  }
  const sessionFile = props.sessionFile;
  if (!sessionFile) return;
  sessionAction.value = "rewind";
  try {
    const { data } = await axios.post<{ code: number; data: AgentConversation; message?: string }>("/api/agent/rewind", {
      directory, sessionFile, entryId: item.entryId,
    }, { headers: { "x-toonflow-workspace": "1" } });
    if (data.code !== 200) throw new Error(data.message || "回退失败");
    messages.value = data.data.messages.map(message => ({ ...message }));
    stats.value = data.data.stats;
    contextUsage.value = data.data.contextUsage;
    editingId.value = undefined;
    syncPhase();
    emit("rewound", data.data);
    await input.value?.fillRewind(item.content, item.attachments, item.mentions);
  } catch (error) {
    ElMessage.error(axios.isAxiosError<{ message?: string }>(error) ? error.response?.data?.message || "回退失败"
      : error instanceof Error ? error.message : "回退失败");
  } finally {
    sessionAction.value = undefined;
  }
}

// ACT: 手动压缩直接替换会话历史，正在生成或压缩时禁止操作，避免与服务端写文件冲突。
async function compactContext() {
  if (compactBlocked.value || manualCompacting.value || sessionUnavailable()) return;
  const sessionFile = props.sessionFile;
  if (!sessionFile) return;
  manualCompacting.value = true;
  compacting.value = true;
  try {
    const { data } = await axios.post<{ code: number; data: AgentConversation; message?: string }>("/api/agent/compact", {
      directory, sessionFile,
    }, { headers: { "x-toonflow-workspace": "1" } });
    if (data.code !== 200) throw new Error(data.message || "压缩上下文失败");
    messages.value = data.data.messages.map(message => ({ ...message }));
    stats.value = data.data.stats;
    contextUsage.value = data.data.contextUsage;
    editingId.value = undefined;
    ElMessage.success("上下文已压缩");
  } catch (error) {
    ElMessage.error(axios.isAxiosError<{ message?: string }>(error) ? error.response?.data?.message || "压缩上下文失败"
      : error instanceof Error ? error.message : "压缩上下文失败");
  } finally {
    manualCompacting.value = false;
    compacting.value = false;
  }
}

async function forkMessage(item: AgentMessage) {
  if (locked.value || remoteRunning.value || item.streaming || item.report || !item.entryId || sessionUnavailable()) return;
  const sessionFile = props.sessionFile;
  if (!sessionFile) return;
  sessionAction.value = "fork";
  try {
    const { data } = await axios.post<{ code: number; data: { file: string; name: string; conversation: AgentConversation }; message?: string }>("/api/agent/fork", {
      directory, sessionFile, entryId: item.entryId,
    }, { headers: { "x-toonflow-workspace": "1" } });
    if (data.code !== 200) throw new Error(data.message || "复制会话失败");
    emit("forked", { file: data.data.file, name: data.data.name });
    ElMessage.success(`已复制为新会话「${data.data.name}」`);
  } catch (error) {
    ElMessage.error(axios.isAxiosError<{ message?: string }>(error) ? error.response?.data?.message || "复制会话失败"
      : error instanceof Error ? error.message : "复制会话失败");
  } finally {
    sessionAction.value = undefined;
  }
}

function stopMessage() {
  // ACT: 用户主动停止时队列保留但不自动续发，避免"点了停止却还在发"。
  stoppedByUser = true;
  controller?.abort();
}

async function uploadAttachments(attachments: AgentAttachment[], directory: string, signal: AbortSignal) {
  if (!attachments.some(item => item.file)) return;
  const files = useWorkspaceFiles(directory);
  for (const path of ["assets", "assets/chat"]) {
    await files.mkdir(path).catch(error => {
      if (error?.response?.data?.data?.code !== "EEXIST") throw error;
    });
    signal.throwIfAborted();
  }
  for (const attachment of attachments) {
    if (!attachment.file) continue;
    attachment.mimeType = getReadableFileMimeType(attachment.name, attachment.mimeType) ?? attachment.mimeType;
    const readableExtension = getReadableFileExtension(attachment.name, attachment.mimeType);
    const extension = readableExtension ? `.${readableExtension}` : attachment.name.match(/\.[a-zA-Z0-9]{1,10}$/)?.[0].toLowerCase() ?? "";
    const path = `assets/chat/${crypto.randomUUID()}${extension}`;
    await files.write(path, attachment.file, true, signal);
    attachment.path = path;
    attachment.file = undefined;
    signal.throwIfAborted();
  }
}

async function sendCanvasResult(event: Extract<AgentEvent, { type: "canvasCall" }>, canvasContext: CanvasContext | undefined, signal: AbortSignal) {
  let body: string;
  try {
    if (!canvasContext) throw new Error("当前页面没有激活的画布");
    const result = await canvasContext.call(event, signal);
    body = JSON.stringify({ directory, callId: event.callId, result: result ?? null });
  } catch (error) {
    body = JSON.stringify({ directory, callId: event.callId, error: (error instanceof Error && error.message ? error.message : translate("画布操作失败")).slice(0, 8000) });
  }
  const cancelled = signal.aborted;
  if (cancelled) body = JSON.stringify({ directory, callId: event.callId, error: translate("画布操作已取消") });
  const response = await fetch("/api/agent/canvasResult", {
    method: "POST",
    headers: { "Accept-Language": locale.value, "Content-Type": "application/json", "x-toonflow-workspace": "1" },
    body,
    keepalive: cancelled,
    signal: cancelled ? AbortSignal.timeout(5000) : signal,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.message || "画布操作结果回传失败");
  }
}

async function sendMessage(source?: AgentMessage, queued?: QueuedDraft) {
  const instance = input.value;
  const draft = instance?.getDraft();
  const editing = !queued && source && editingId.value === source.id;
  const fromSource = !queued && source && !editing;
  let prompt = (queued ? queued.prompt : fromSource ? source.content : (draft?.prompt ?? "")).trim();
  const attachments = reactive((queued ? queued.attachments : fromSource ? source.attachments ?? [] : draft?.attachments ?? []).map(item => ({ ...item })));
  const mentionedIds = queued ? queued.mentionedIds
    : fromSource ? (source.mentions ?? []).filter(mention => prompt.includes(`{{mention:${mention.id}}}`)).map(mention => mention.id)
    : draft?.mentionedIds ?? [];
  const references = queued ? queued.mentions : fromSource ? source.mentions ?? [] : draft?.mentions ?? [];
  const mentions = references.filter(mention => mentionedIds.includes(mention.id)).map(mention => ({ ...mention }));
  if (mentionedIds.some(id => !mentions.some(mention => mention.id === id))) return ElMessage.warning("存在无法读取的提及，请删除后重新选择");
  const typed = queued ? queued.prompt.trim() : prompt;
  if (!queued && !source && editingId.value !== undefined) return;
  const resendIndex = fromSource ? messages.value.findIndex(item => item.id === source.id) : -1;
  if (fromSource && (source.role !== "user" || resendIndex < 0)) return;
  const resendFrom = fromSource ? source.entryId ?? messages.value.slice(resendIndex + 1).find(item => item.role === "user" && item.entryId)?.entryId : undefined;
  if (locked.value || !instance || (!typed && !attachments.length)) return;
  const model = selectedModelChoice.value;
  if (!directory) return ElMessage.warning("请先打开项目");
  if (!model) return ElMessage.warning("请先选择模型");

  const requestController = new AbortController();
  const canvasContext = createCanvasContext?.();
  controller = requestController;
  busy.value = true;
  resuming.value = false;
  compacting.value = false;
  startSilenceWatch();
  // ACT: 节点面板注入的直接上游引用在「发送这一刻」现取，而不是打开面板时取一次——
  // 上游正文改了、图片重新生成、开关刚关掉，都要在下一轮生效。
  // 服务端按 `{{mention:id}}` 令牌校验引用，令牌和引用必须成对出现，缺一个整条消息会被拒。
  // 放在 busy 置真之后：取数期间已被 lock 住，连点不会重复发送；重发历史消息沿用原引用，不补。
  if (!fromSource) {
    let extras: AgentMention[] = [];
    try { extras = (await props.loadExtraMentions?.()) ?? []; }
    catch { extras = []; }
    for (const item of extras) {
      if (mentions.length >= 20) break;
      if (mentions.some(mention => mention.id === item.id)) continue;
      if (!prompt.includes(`{{mention:${item.id}}}`)) prompt = `${prompt} {{mention:${item.id}}}`.trim();
      mentions.push({ ...item });
    }
  }
  const reply = reactive<AgentMessage>({ id: crypto.randomUUID(), role: "assistant", content: "", parts: [], streaming: true });
  const userMessage = reactive<AgentMessage>({ id: crypto.randomUUID(), role: "user", content: prompt, attachments, mentions });
  let ownsStream = !remoteRunning.value;
  let forwarded = false;
  if (!fromSource) {
    messages.value.push(userMessage);
    if (ownsStream) messages.value.push(reply);
  }
  let accepted = false;
  if (ownsStream) stream.begin(reply);
  const handledCanvasCalls = new Set<string>();
  const pendingQuestions = new Map<string, string>();
  const activeChildFiles = new Set<string>();
  let releaseAgentStream: (() => void) | undefined;
  const finishStats = anonymousData.startAgent();
  // ACT: 已下发即可算「理解中」；节点摘要也要在这时就更新，不能等整轮结束。
  phase.value = "thinking";
  emit("promptStart", mentionPlainText(prompt, mentions) || attachments[0]?.name || "新对话");
  try {
    if (!fromSource) await instance.clearDraft();
    requestController.signal.throwIfAborted();
    await uploadAttachments(attachments, directory, requestController.signal);
    // ACT: 打断后立刻重发时，服务端可能还没把旧请求从"正在运行"里摘掉；409 时短暂重试，
    // 否则用户会觉得"点了打断发送却没发出去"。
    let response!: Response;
    for (let attempt = 0; attempt < 4; attempt++) {
      response = await fetch("/api/agent", {
        method: "POST",
        headers: { "Accept-Language": locale.value, "Content-Type": "application/json", "x-toonflow-workspace": "1" },
        body: JSON.stringify({ prompt, mentions, attachments: attachments.map(({ name, path, mimeType }) => ({ name, path, mimeType })), directory, providerId: model.providerId, modelId: model.modelId, thinkingLevel: reasoningEffort.value || undefined, sessionFile: props.sessionFile, resendFrom, nodeBinding: props.nodeBinding, canvas: canvasContext ? { id: canvasContext.id, tools: canvasContext.tools } : undefined }),
        signal: requestController.signal,
      });
      if (response.status !== 409 || attempt === 3) break;
      await new Promise(resolve => setTimeout(resolve, 300 * (attempt + 1)));
      requestController.signal.throwIfAborted();
    }
    // ACT: 这条 NDJSON 整轮占一条同源连接，登记到探针里，复现时能看出长连接是不是把 6 条塞满了。
    releaseAgentStream = trackStream("/api/agent");
    for await (const event of readAgentEvents(response, requestController.signal)) {
      lastEventAt = performance.now();
      // 子任务复用发起委派时的画布与取消通道，界面切换不改变工具执行目标。
      let toolEvent: AgentEvent = event;
      let scope = "";
      while (toolEvent.type === "subAgentEvent") {
        if (toolEvent.event.type === "done" || toolEvent.event.type === "error") activeChildFiles.delete(toolEvent.file);
        else activeChildFiles.add(toolEvent.file);
        scope += `${toolEvent.file}/`;
        toolEvent = toolEvent.event;
      }
      if (toolEvent.type === "question") {
        pendingQuestions.set(`${scope}${toolEvent.toolCallId}`, toolEvent.callId);
        emit("question", { callId: toolEvent.callId, title: toolEvent.title, question: toolEvent.question });
      }
      if (toolEvent.type === "tool" && toolEvent.tool.status !== "running") {
        const key = `${scope}${toolEvent.tool.id}`;
        const answered = pendingQuestions.get(key);
        if (pendingQuestions.delete(key) && answered) emit("questionEnd", answered);
      }
      if (toolEvent.type === "canvasCall") {
        if (handledCanvasCalls.has(toolEvent.callId)) throw new Error("收到重复的画布调用");
        handledCanvasCalls.add(toolEvent.callId);
        await sendCanvasResult(toolEvent, canvasContext, requestController.signal);
        continue;
      }
      switch (event.type) {
        case "accepted":
          forwarded = true;
          if (ownsStream) {
            stream.finish();
            messages.value = messages.value.filter(message => message !== reply);
          }
          break;
        case "userMessage":
          if (!ownsStream) {
            messages.value.push(reply);
            stream.begin(reply);
          }
          userMessage.entryId = event.id;
          reply.replyTo = event.id;
          if (source && !accepted) {
            messages.value.splice(resendIndex, messages.value.length - resendIndex, userMessage, reply);
            stats.value = undefined;
            contextUsage.value = undefined;
            await instance.restoreEditingDraft();
          }
          accepted = true;
          ownsStream = true;
          applyEvent(event);
          break;
        case "stats":
          if (source && !accepted) break;
          applyEvent(event);
          break;
        default: applyEvent(event);
      }
    }
    if (source && !accepted) throw new Error("服务端未确认重发，请重新打开对话后重试");
    finishStats("success");
    emit("sent", mentionPlainText(prompt, mentions) || attachments[0]?.name || "新对话");
  } catch (error) {
    const aborted = requestController.signal.aborted;
    finishStats(aborted ? "cancelled" : "failed");
    // ACT: 整轮结果要在 status 回落为 waiting 之前上报——节点收到 waiting 就会降 busy 并派发完成事件。
    emit("turnEnd", aborted ? "cancelled" : "failed");
    const responseMessage = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
    const message = aborted ? "已停止生成" : responseMessage || (error instanceof Error ? error.message : "发送失败，请重试");
    if ((source && !accepted) || !ownsStream) { userMessage.error = message; ElMessage.error(message); }
    else reply.error = message;
    // ACT: 首轮在写入任何 assistant 条目之前就结束（比如立刻点停止），SDK 不会落盘，
    // 之后再发只会一直 404。把这次失败告诉外层清掉绑定，下次发送重新建会话。
    if (/会话不存在/.test(message)) emit("sessionLost");
    if (ownsStream && props.initialSession?.parentFile && props.sessionFile) {
      emit("event", { type: "subAgentEvent", file: props.sessionFile, event: { type: "error", message } });
    }
  } finally {
    releaseAgentStream?.();
    releaseAgentStream = undefined;
    for (const file of activeChildFiles) emit("event", { type: "subAgentEvent", file, event: { type: "error", message: "委派连接已结束，请重新打开子会话查看结果" } });
    // ACT: Bun 的流断开事件可能不触发；主动结束仍在等待的提问，不依赖断开通知。
    for (const callId of pendingQuestions.values()) {
      emit("questionEnd", callId);
      void fetch("/api/agent/answer", {
        method: "POST", headers: { "Accept-Language": locale.value, "Content-Type": "application/json", "x-toonflow-workspace": "1" },
        body: JSON.stringify({ directory, callId, cancelled: true }), keepalive: true,
      }).catch(() => {});
    }
    if (ownsStream && !forwarded) stream.finish();
    // ACT: replyStream 处理 error 行时直接抛错、不会走到 receiveEvent，这里兜底复位。
    if (ownsStream) remoteRunning.value = false;
    // ACT: 结束（成功/失败/被停止）统一回到「等待输入」，不新增第五个状态标签。
    phase.value = "waiting";
    stopSilenceWatch();
    compacting.value = false;
    busy.value = false;
    controller = undefined;
    const interrupted = resumeAfterStop;
    resumeAfterStop = undefined;
    const stopped = stoppedByUser;
    stoppedByUser = false;
    const goalWillContinue = !!goal.value && !stopped && !requestController.signal.aborted && (accepted || !!reply.content.trim()) && goal.value.status === "active" && !donePattern().test(reply.content);
    const handOff = !!interrupted || (!stopped && sendQueue.value.length > 0) || goalWillContinue;
    // ACT: 续发/打断重发会在同一个同步任务里把 phase 又改回 thinking，pre-flush 的 watcher
    // 只看得到最终值，节点 busy 就没有下降沿、这一轮的完成提醒会被整轮吞掉。等一帧再续发；
    // 这一帧里 busy 已是 false，用 resuming 把实例保活，否则面板会把会话卸载并 abort 掉刚发的请求。
    resuming.value = handOff;
    if (handOff) await nextTick();
    // ACT: 打断发送优先；否则用户主动停止时不续发队列，自然结束时自动补发队首。
    if (interrupted) void sendMessage(undefined, interrupted);
    else if (!stopped && sendQueue.value.length) void sendMessage(undefined, sendQueue.value.shift());
    else if (goal.value && !stopped && !requestController.signal.aborted && (accepted || reply.content.trim())) {
      const state = goal.value;
      if (state.status === "active" && !donePattern().test(reply.content)) {
        void runGoalRound("auto");
      } else {
        resuming.value = false;
        if (state.status === "active") {
          // ACT: 达成标记只用于判定，不让它出现在气泡里。
          reply.content = stripDoneMark(reply.content);
          void persistGoal({ ...state, status: "done", updatedAt: new Date().toISOString() });
          ElMessage.success(`目标已达成（第 ${state.round} 轮）`);
        }
      }
    } else {
      resuming.value = false;
    }
  }
}

watch(() => props.acceptPending !== false && !props.initialSession?.parentFile && !!workspaceStore.pendingAgentMessage && props.active && !locked.value && !!input.value && !!createCanvasContext?.(), async ready => {
  const message = workspaceStore.pendingAgentMessage;
  const instance = input.value;
  if (!ready || !message || !instance || message.directory !== directory) return;
  workspaceStore.pendingAgentMessage = null;
  await instance.fillPrompt(message.prompt, message.attachments ?? []);
  if (input.value === instance && props.active) void sendMessage();
}, { flush: "post" });

onBeforeUnmount(() => {
  controller?.abort();
  stopSilenceWatch();
});
</script>

<style lang="scss">
.agentConversation {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;

  .goalBanner {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 8px 12px 0;
    padding: 4px 8px;
    border: 1px solid var(--el-border-color-lighter);
    border-radius: var(--el-border-radius-base);
    background: var(--el-fill-color-lighter);
    font-size: 12px;
    color: var(--el-text-color-secondary);

    .goalText {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--el-text-color-regular);
    }

    .goalState { flex-shrink: 0; }
    .el-button { margin-left: 0; padding: 0 4px; }
  }

  .compactionStatus {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    gap: 6px;
    margin: 0 12px 8px;
    color: var(--el-text-color-secondary);
    font-size: 12px;
  }

  .retryStatus {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    gap: 6px;
    margin: 0 12px 8px;
    color: var(--el-color-warning);
    font-size: 12px;
  }

  .contextAlert {
    &.warning { color: var(--el-color-warning); }
    &.danger { color: var(--el-color-danger); }

    > span { min-width: 0; }
    .el-button { flex-shrink: 0; margin-left: 4px; padding: 0; }
  }
}
</style>
