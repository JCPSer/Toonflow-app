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
      :contextUsage="contextUsage"
      :stats="stats"
      :contextWindow="contextWindow"
      @submit="submitMessage"
      @stop="stopMessage" />
  </div>
</template>

<script setup lang="ts">
import { locale, translate } from "@toonflow/i18n/vue";
import { computed, inject, onBeforeUnmount, reactive, ref, watch } from "vue";
import axios from "axios";
import { IconAlertTriangle, IconLoader2 } from "@tabler/icons-vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { getReadableFileExtension, getReadableFileMimeType } from "@toonflow/server/documentFormats";
import useWorkspaceFiles from "@/lib/workspaceFiles";
import { writeClipboardText } from "@/lib/clipboard";
import anonymousData from "@/lib/anonymousData";
import { agentSettings, modelChoices } from "@/stores/settings";
import { useWorkspaceStore } from "@/stores/workspace";
import type { AgentAttachment, AgentConversation, AgentMessage } from "./types";
import type { AgentEvent } from "@toonflow/server/agent/types";
import { createConversationStream, readAgentEvents } from "./replyStream";
import { mentionPlainText } from "./mentionText";
import type { CanvasContext } from "@toonflow/tool-canvas/runtime";
import messageList from "./conversation/messageList.vue";
import messageInput from "./conversation/messageInput.vue";

const props = defineProps<{ active: boolean; initialSession: AgentConversation | null; sessionFile?: string; disabled: boolean }>();
const emit = defineEmits<{
  session: [file: string];
  forked: [payload: { file: string; name: string }];
  rewound: [conversation: AgentConversation];
  sent: [prompt: string];
  event: [event: AgentEvent];
  compactState: [state: { disabled: boolean; loading: boolean }];
}>();
const workspaceStore = useWorkspaceStore();
const directory = workspaceStore.project?.directory;
const createCanvasContext = inject<(() => CanvasContext | undefined) | undefined>("canvas", undefined);
const messages = ref<AgentMessage[]>((props.initialSession?.messages ?? []).map(message => ({ ...message })));
const stream = createConversationStream(messages);
const remoteRunning = ref(props.initialSession?.running ?? false);
const stats = ref(props.initialSession?.stats);
const contextUsage = ref(props.initialSession?.contextUsage);
const busy = ref(false);
const compacting = ref(false);
const manualCompacting = ref(false);
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
const editingId = ref<string>();
let controller: AbortController | undefined;
const pendingMessage = props.initialSession?.parentFile ? undefined : workspaceStore.pendingAgentMessage;
const selectedModel = ref(pendingMessage?.model ?? (props.initialSession?.providerId && props.initialSession.modelId
  ? JSON.stringify([props.initialSession.providerId, props.initialSession.modelId]) : ""));
const reasoningEffort = ref(pendingMessage?.reasoningEffort ?? props.initialSession?.thinkingLevel ?? "");
const selectedModelChoice = computed(() => modelChoices.value.find(item => item.value === selectedModel.value));
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
      stream.receive(event);
      break;
    default: stream.receive(event);
  }
}

function receiveEvent(event: AgentEvent) {
  if (event.type === "done" || event.type === "error") {
    remoteRunning.value = false;
    compacting.value = false;
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

defineExpose({ receiveEvent, compactContext });

function submitMessage() {
  return sendMessage(editingId.value ? messages.value.find(item => item.id === editingId.value) : undefined);
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

async function sendMessage(source?: AgentMessage) {
  const instance = input.value;
  const draft = instance?.getDraft();
  const editing = source && editingId.value === source.id;
  const prompt = (source && !editing ? source.content : (draft?.prompt ?? "")).trim();
  const attachments = reactive((source && !editing ? source.attachments ?? [] : draft?.attachments ?? []).map(item => ({ ...item })));
  const mentionedIds = source && !editing ? (source.mentions ?? []).filter(mention => prompt.includes(`{{mention:${mention.id}}}`)).map(mention => mention.id)
    : draft?.mentionedIds ?? [];
  const references = source && !editing ? source.mentions ?? [] : draft?.mentions ?? [];
  const mentions = references.filter(mention => mentionedIds.includes(mention.id)).map(mention => ({ ...mention }));
  if (mentionedIds.some(id => !mentions.some(mention => mention.id === id))) return ElMessage.warning("存在无法读取的提及，请删除后重新选择");
  if (!source && editingId.value !== undefined) return;
  const resendIndex = source ? messages.value.findIndex(item => item.id === source.id) : -1;
  if (source && (source.role !== "user" || resendIndex < 0)) return;
  const resendFrom = source ? source.entryId ?? messages.value.slice(resendIndex + 1).find(item => item.role === "user" && item.entryId)?.entryId : undefined;
  if (locked.value || !instance || (!prompt && !attachments.length)) return;
  const model = selectedModelChoice.value;
  if (!directory) return ElMessage.warning("请先打开项目");
  if (!model) return ElMessage.warning("请先选择模型");

  const requestController = new AbortController();
  const canvasContext = createCanvasContext?.();
  controller = requestController;
  busy.value = true;
  compacting.value = false;
  startSilenceWatch();
  const reply = reactive<AgentMessage>({ id: crypto.randomUUID(), role: "assistant", content: "", parts: [], streaming: true });
  const userMessage = reactive<AgentMessage>({ id: crypto.randomUUID(), role: "user", content: prompt, attachments, mentions });
  let ownsStream = !remoteRunning.value;
  let forwarded = false;
  if (!source) {
    messages.value.push(userMessage);
    if (ownsStream) messages.value.push(reply);
  }
  let accepted = false;
  if (ownsStream) stream.begin(reply);
  const handledCanvasCalls = new Set<string>();
  const pendingQuestions = new Map<string, string>();
  const activeChildFiles = new Set<string>();
  const finishStats = anonymousData.startAgent();
  try {
    if (!source) await instance.clearDraft();
    requestController.signal.throwIfAborted();
    await uploadAttachments(attachments, directory, requestController.signal);
    const response = await fetch("/api/agent", {
      method: "POST",
      headers: { "Accept-Language": locale.value, "Content-Type": "application/json", "x-toonflow-workspace": "1" },
      body: JSON.stringify({ prompt, mentions, attachments: attachments.map(({ name, path, mimeType }) => ({ name, path, mimeType })), directory, providerId: model.providerId, modelId: model.modelId, thinkingLevel: reasoningEffort.value || undefined, sessionFile: props.sessionFile, resendFrom, canvas: canvasContext ? { id: canvasContext.id, tools: canvasContext.tools } : undefined }),
      signal: requestController.signal,
    });
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
      if (toolEvent.type === "question") pendingQuestions.set(`${scope}${toolEvent.toolCallId}`, toolEvent.callId);
      if (toolEvent.type === "tool" && toolEvent.tool.status !== "running") pendingQuestions.delete(`${scope}${toolEvent.tool.id}`);
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
    finishStats(requestController.signal.aborted ? "cancelled" : "failed");
    const responseMessage = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
    const message = requestController.signal.aborted ? "已停止生成" : responseMessage || (error instanceof Error ? error.message : "发送失败，请重试");
    if ((source && !accepted) || !ownsStream) { userMessage.error = message; ElMessage.error(message); }
    else reply.error = message;
    if (ownsStream && props.initialSession?.parentFile && props.sessionFile) {
      emit("event", { type: "subAgentEvent", file: props.sessionFile, event: { type: "error", message } });
    }
  } finally {
    for (const file of activeChildFiles) emit("event", { type: "subAgentEvent", file, event: { type: "error", message: "委派连接已结束，请重新打开子会话查看结果" } });
    // ACT: Bun 的流断开事件可能不触发；主动结束仍在等待的提问，不依赖断开通知。
    for (const callId of pendingQuestions.values()) {
      void fetch("/api/agent/answer", {
        method: "POST", headers: { "Accept-Language": locale.value, "Content-Type": "application/json", "x-toonflow-workspace": "1" },
        body: JSON.stringify({ directory, callId, cancelled: true }), keepalive: true,
      }).catch(() => {});
    }
    if (ownsStream && !forwarded) stream.finish();
    // ACT: replyStream 处理 error 行时直接抛错、不会走到 receiveEvent，这里兜底复位。
    if (ownsStream) remoteRunning.value = false;
    stopSilenceWatch();
    compacting.value = false;
    busy.value = false;
    controller = undefined;
  }
}

watch(() => !props.initialSession?.parentFile && !!workspaceStore.pendingAgentMessage && props.active && !locked.value && !!input.value && !!createCanvasContext?.(), async ready => {
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
