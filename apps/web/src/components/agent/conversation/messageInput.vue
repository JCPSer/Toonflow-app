<template>
  <div class="messageInput" :class="{ draggingAttachments, voiceActive }" @dragenter.capture="dragEnterAttachments" @dragover.capture="dragOverAttachments" @dragleave.capture="dragLeaveAttachments" @drop.capture="dropAttachments">
    <div v-if="draggingAttachments" class="attachmentDropHint" role="status">
      <icon-paperclip :size="20" aria-hidden="true" />
      <span>松开添加附件</span>
      <small>图片、视频、文档或代码文件</small>
    </div>
    <div v-if="editingId" class="editingBanner"><span>编辑消息</span><el-button text size="small" :disabled="busy || voiceActive" @click="cancelEdit">取消</el-button></div>
    <div
      class="senderResizeHandle"
      role="separator"
      aria-orientation="horizontal"
      aria-label="调整输入框高度"
      aria-valuemin="44"
      :aria-valuemax="senderMaxHeight"
      :aria-valuenow="senderHeight"
      tabindex="0"
      title="拖动调整输入框高度"
      @focus="senderHeight = sender?.chatElement.rollBox.clientHeight ?? 44"
      @pointerdown="startSenderResize"
      @pointermove="moveSenderResize"
      @pointerup="stopSenderResize"
      @pointercancel="stopSenderResize"
      @lostpointercapture="stopSenderResize"
      @keydown.up.prevent="setSenderHeight((sender?.chatElement.rollBox.clientHeight ?? 44) + 16)"
      @keydown.down.prevent="setSenderHeight((sender?.chatElement.rollBox.clientHeight ?? 44) - 16)" />
    <attachmentList v-if="draftAttachments.length" class="draftAttachments" :attachments="draftAttachments" :directory="directory" removable restorable :disabled="locked" @remove="draftAttachments.splice($event, 1)" @restore="restoreTextAttachment" />
    <div v-if="commandHints.length" class="commandHints" role="menu" aria-label="指令">
      <button v-for="item in commandHints" :key="item.command" type="button" class="commandHint" role="menuitem" @click="fillPrompt(item.command)">
        <code>{{ item.command }}</code><span>{{ item.hint }}</span>
      </button>
    </div>
    <div v-if="props.queue?.length" class="sendQueue" role="status" aria-live="polite">
      <span class="queueTitle">待发送 {{ props.queue.length }}</span>
      <div v-for="(item, index) in props.queue" :key="item.id" class="queueItem">
        <span class="queueText" :title="item.preview">{{ item.preview }}</span>
        <el-button text size="small" :disabled="props.disabled" title="打断当前生成并立即发送" @click="emit('sendQueued', index)">立即发送</el-button>
        <el-button text size="small" :icon="IconX" :disabled="props.disabled" aria-label="移除待发送消息" title="移除" @click="emit('removeQueued', index)" />
      </div>
    </div>
    <div class="senderInput" @pointerdown.capture="armVoiceInput" @contextmenu="voiceActive && $event.preventDefault()" @dragstart="voiceActive && $event.preventDefault()">
      <div ref="senderElement" class="senderEditor" @keydown.capture="handleSenderKeydown"></div>
      <div v-if="voiceActive" class="voiceOverlay" role="status" aria-live="polite">
        <div class="voiceFeedback">
          <span class="voiceWave" aria-hidden="true"><span v-for="(level, index) in voiceBars" :key="index" :style="{ height: `${3 + level * 21}px` }" /></span>
          <span>{{ voiceState === 'starting' ? '正在启动语音识别…' : voiceState === 'listening' ? '开始说话，松开结束' : '正在识别…' }}</span>
        </div>
        <div v-if="voiceText" class="voiceTranscript">{{ voiceText }}</div>
      </div>
    </div>
    <teleport v-for="target in draftMentionTargets" :key="target.key" :to="target.element"><mentionThumbnail v-bind="mentionThumbnailProps(target.mention)" :directory="directory"><icon-photo :size="14" /></mentionThumbnail></teleport>
    <mentionContent ref="draftMentionPreview" :mentions="draftMentions" :directory="directory" removable @remove="removeDraftMention" />
    <div ref="actionsElement" class="senderActions">
      <modelPopover v-if="showModel !== false" v-model="selectedModel" v-model:reasoningEffort="reasoningEffort" :active="active" :disabled="disabled || voiceActive" />
      <input ref="attachmentInput" type="file" :accept="attachmentAccept" multiple hidden :disabled="locked" @change="selectAttachments" />
      <el-button text circle :disabled="locked" aria-label="添加附件" title="添加附件" @click="attachmentInput?.click()"><icon-paperclip :size="16" /></el-button>
      <mentionMenu ref="mentionMenuRef" :directory="directory" :active="active" :disabled="locked || !directory" :query="mentionQuery" :editor="senderElement" :currentCanvasId="createCanvasContext?.()?.id" @open="captureMentionPosition" @select="insertMentions" @dismiss="mentionQuery = undefined" />
      <skillMenu ref="skillMenuRef" :directory="directory" :active="active" :disabled="locked || !directory" :query="skillQuery" :editor="senderElement" @select="selectSkill" @dismiss="skillQuery = undefined" />
      <el-button v-if="voiceButtonVisible && !collapsed" class="voiceButton" :class="{ voiceActive }" text circle :disabled="!voiceSupported || (!voiceActive && locked)" :aria-label="voiceButtonLabel" :aria-pressed="voiceActive" :title="voiceButtonLabel" @click="voiceActive ? cancelVoiceInput() : startVoiceInput()"><icon-microphone :size="18" /></el-button>
      <contextUsagePopover v-if="!collapsed" v-model:visible="contextMenuVisible" :usage="contextUsage" :stats="stats" :contextWindow="contextWindow" :disabled="voiceActive" />
      <el-popover v-if="collapsed" placement="top-start" trigger="click" :width="200" :showArrow="false" popperClass="agentToolbarMorePopover">
        <template #reference>
          <el-button class="moreButton" text circle aria-label="更多输入工具" title="更多输入工具"><icon-dots :size="16" /></el-button>
        </template>
        <div class="toolbarMore">
          <el-button v-if="voiceButtonVisible" text size="small" :disabled="!voiceSupported || (!voiceActive && locked)" @click="voiceActive ? cancelVoiceInput() : startVoiceInput()">
            <icon-microphone :size="14" />
            <span>语音输入</span>
          </el-button>
          <span class="toolbarMoreUsage">{{ contextPercentText }}</span>
        </div>
      </el-popover>
      <template v-if="busy">
        <el-button class="queueButton" text circle :disabled="props.disabled || !composable" aria-label="加入待发送队列" title="加入待发送队列，本轮结束后自动发送" @click="enqueueDraft">
          <el-badge v-if="props.queue?.length" :value="props.queue.length" :offset="[-2, 4]"><icon-arrow-up :size="16" /></el-badge>
          <icon-arrow-up v-else :size="16" />
        </el-button>
        <el-button class="interruptButton" type="primary" circle :disabled="props.disabled || !composable" aria-label="打断并立即发送" title="打断当前生成并立即发送" @click="emit('submit')">
          <icon-bolt :size="15" />
        </el-button>
        <el-button class="stopButton" text circle aria-label="停止生成" title="停止生成" @click="emit('stop')">
          <icon-player-stop-filled :size="14" />
        </el-button>
      </template>
      <el-button v-else class="sendButton" type="primary" circle :disabled="locked" :aria-label="editingId ? '重发消息' : '发送消息'" :title="editingId ? '重发消息' : '发送消息'" @click="emit('submit')">
        <icon-arrow-up :size="16" />
      </el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { locale, t, translate } from "@toonflow/i18n/vue";
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { IconArrowUp, IconBolt, IconDots, IconMicrophone, IconPaperclip, IconPhoto, IconPlayerStopFilled, IconX } from "@tabler/icons-vue";
import { ElMessage } from "element-plus";
import { getReadableFileMimeType, readableFileAccept } from "@toonflow/server/documentFormats";
import type { AgentContext, AgentMention, AgentStats } from "@toonflow/server/agent/types";
import type { CanvasContext } from "@toonflow/tool-canvas/runtime";
import modelPopover from "@/components/modelPopover.vue";
import { voiceInputEnabled } from "@/lib/agentInputSettings";
import skillMenu from "../skillMenu.vue";
import mentionMenu from "../mentionMenu.vue";
import mentionContent from "../mentionContent.vue";
import mentionThumbnail from "../mentionThumbnail.vue";
import { mentionName, mentionParts, mentionThumbnailProps } from "../mentionText";
import attachmentList from "../attachmentList.vue";
import { createPastedTextFile, readTextAttachment } from "../textAttachments";
import type { AgentAttachment, AgentMessage } from "../types";
import { useAgentComposerStore } from "@/stores/agentComposer";
import contextUsagePopover from "./contextUsage.vue";
import useVoiceInput from "./useVoiceInput";
import xSender, { type AnyTagProps } from "x-sender";
import "x-sender/lib/XSender.css";

const props = defineProps<{ active: boolean; disabled: boolean; busy: boolean; remoteRunning: boolean; deletingId?: string; directory?: string; contextUsage?: AgentContext; stats?: AgentStats; contextWindow: number; history?: AgentMessage[]; acceptPending?: boolean; showModel?: boolean; autoFocus?: boolean; queue?: { id: string; preview: string }[] }>();
const emit = defineEmits<{ submit: []; stop: []; enqueue: []; sendQueued: [index: number]; removeQueued: [index: number] }>();
const selectedModel = defineModel<string>("selectedModel", { required: true });
const reasoningEffort = defineModel<string>("reasoningEffort", { required: true });
const editingId = defineModel<string>("editingId");
const recording = defineModel<boolean>("voiceActive", { default: false });
const restoringAttachment = defineModel<boolean>("restoringAttachment", { default: false });
const createCanvasContext = inject<(() => CanvasContext | undefined) | undefined>("canvas", undefined);
const draftAttachments = ref<AgentAttachment[]>([]);
const attachmentInput = ref<HTMLInputElement>();
const draggingAttachments = ref(false);
let attachmentDragDepth = 0;
const attachmentAccept = `image/*,video/*,${readableFileAccept}`;
const draftMentions = ref<AgentMention[]>([]);
const draftMentionTargets = shallowRef<{ key: symbol; element: HTMLElement; mention: AgentMention }[]>([]);
const draftMentionPreview = ref<InstanceType<typeof mentionContent>>();
// ACT: 历史只在当前会话内生效；进入条件是草稿完全为空，翻出的消息要连提及与附件一起还原。
let historyIndex: number | null = null;
let historyFilling = false;
let historyQueue: Promise<void> = Promise.resolve();
let editDraft: { model: AnyTagProps[][]; mentions: AgentMention[]; attachments: AgentAttachment[] } | undefined;
let sender: xSender | undefined;
const senderElement = ref<HTMLElement>();
const skillMenuRef = ref<InstanceType<typeof skillMenu>>();
const skillQuery = ref<string>();
const mentionMenuRef = ref<InstanceType<typeof mentionMenu>>();
const mentionQuery = ref<string>();
const agentComposer = useAgentComposerStore();
let mentionPosition: { node: ReturnType<xSender["getCurrentNode"]>; remove: number } | undefined;
let insertingMentions = false;
const senderHeight = ref(44);
const senderMaxHeight = ref(Math.max(44, window.innerHeight / 2));
let senderResize: { pointerId: number; y: number; height: number } | undefined;
const contextMenuVisible = ref(false);
// ACT: 生成中不再锁输入框——用户可以继续编辑、把内容加入待发送队列，或打断后立即发送。
const locked = computed(() => props.disabled || props.deletingId !== undefined || restoringAttachment.value || voiceActive.value);
/** 有内容才能入队/发送；不含"正在生成"这个条件。 */
const senderText = ref("");
function commandMatches(token: string) {
  return ["goal", "compact"].some(name => name.startsWith(token.toLocaleLowerCase()));
}
/** 输入 / 开头且还没打空格时给指令提示；同时 suppresses 技能菜单，避免「输入 /go 只看到技能」。 */
const commandHints = computed(() => {
  const match = /^\/([^\s/]*)$/.exec(senderText.value.trimStart());
  if (!match || !commandMatches(match[1] ?? "")) return [];
  return [
    { command: "/compact", hint: "立即压缩上下文" },
    { command: "/goal ", hint: "设定目标并自动循环；/goal 查看状态" },
    { command: "/goal stop", hint: "暂停目标循环" },
    { command: "/goal reset", hint: "重置轮次或改目标" },
    { command: "/goal off", hint: "清除目标并关闭循环" },
  ];
});
const composable = computed(() => !!senderText.value.trim() || draftAttachments.value.length > 0 || draftMentions.value.length > 0);
function enqueueDraft() {
  if (props.disabled || (!composable.value && !draftMentions.value.length)) return;
  emit("enqueue");
}
// ACT: 开关放在「设置 → 常规」；关闭后按钮与长按手势都要失效，不能只藏按钮。
const { voiceSupported, voiceState, voiceText, voiceActive, voiceButtonLabel, voiceLevel, armVoiceInput, startVoiceInput, clearVoicePress, cancelVoiceInput } = useVoiceInput({
  getSender: () => sender,
  active: () => props.active,
  enabled: () => voiceInputEnabled.value,
  disabled: () => props.disabled,
  locked: () => locked.value,
  onStart() {
    mentionQuery.value = undefined;
    skillQuery.value = undefined;
    contextMenuVisible.value = false;
  },
});
// voiceSupported 是普通布尔（初始化时判定一次），只有开关是响应式的。
const voiceButtonVisible = computed(() => voiceSupported && voiceInputEnabled.value);
const voiceBars = computed(() => [0.35, 0.65, 0.85, 1, 0.85, 0.65, 0.35].map(weight => voiceLevel.value * weight));
watch(voiceActive, value => { recording.value = value; }, { flush: "sync" });

// ACT: 工具条按钮多、面板窄时模型名会被压成 0 宽并和右侧按钮叠字；放不下就把
// 「语音 + 上下文用量」一起收进「⋯」（两者在菜单里仍可达），模型名才拿得到位置。
const actionsElement = ref<HTMLElement>();
const collapsed = ref(false);
/** .senderActions 的左右内边距 + 子项 gap，与样式表保持一致。 */
const ACTIONS_PADDING = 16;
const ACTIONS_GAP = 6;
/** 模型按钮至少要放得下图标 + 一段省略号文字 + 思考强度（再窄才值得收按钮）。 */
const MODEL_ROOM = 132;
/** 折叠后展开能多出多少（语音 28 + 上下文 24 − 更多按钮 28）。 */
const COMPACT_GAIN = 24;
/** 展开阈值高于折叠阈值，留出滞回带，避免在临界宽度来回抖。 */
const EXPAND_ROOM = MODEL_ROOM + 12;
const contextPercentText = computed(() => {
  const tokens = props.contextUsage?.tokens;
  if (tokens == null || !props.contextWindow) return "上下文用量暂无数据";
  return `上下文已用 ${(tokens / props.contextWindow * 100).toFixed(0)}%`;
});

function modelRoom() {
  const element = actionsElement.value;
  // 没有模型按钮时不存在「模型名被压扁」的问题，不需要折叠。
  if (!element || props.showModel === false) return Number.POSITIVE_INFINITY;
  let used = 0;
  let count = 0;
  for (const child of Array.from(element.children)) {
    if (!(child instanceof HTMLElement) || child.classList.contains("modelPopover")) continue;
    used += child.offsetWidth;
    count++;
  }
  // count 是「非模型」子项数；模型按钮自己也占一格 gap 的余量，够用即可。
  return element.clientWidth - ACTIONS_PADDING - used - (count + 1) * ACTIONS_GAP;
}

let fittingToolbar = false;
async function fitToolbar() {
  if (fittingToolbar) return;
  fittingToolbar = true;
  try {
    // ACT: 折叠让测量结果在两种布局之间跳，最多来回一次就停，不再迭代。
    for (let step = 0; step < 2; step++) {
      const room = modelRoom();
      if (!collapsed.value && room < MODEL_ROOM) {
        collapsed.value = true;
      } else if (collapsed.value && room + COMPACT_GAIN >= EXPAND_ROOM) {
        collapsed.value = false;
      } else break;
      await nextTick();
    }
  } finally {
    fittingToolbar = false;
  }
}

function placeholderText() {
  return translate(voiceButtonVisible.value ? "输入消息，长按语音输入，@ 提及节点输出或全局素材…" : "输入消息，@ 提及节点输出或全局素材…");
}

watch([locale, voiceButtonVisible], () => {
  if (!sender) return;
  sender.updateConfig({ placeholder: placeholderText() });
  sender.chatElement.richText.setAttribute("aria-label", translate("消息"));
  for (const line of sender.chatEditor.NODES) for (const tag of line.children) {
    if (tag.type === "Mention") tag.$el.setAttribute("aria-label", t`预览 ${tag.name}`);
  }
  void fitToolbar();
});
watch([() => props.busy, selectedModel, () => props.active], () => { void fitToolbar(); }, { flush: "post" });

let actionsObserver: ResizeObserver | undefined;
onMounted(() => {
  const element = actionsElement.value;
  if (!element || typeof ResizeObserver === "undefined") return;
  actionsObserver = new ResizeObserver(() => { void fitToolbar(); });
  actionsObserver.observe(element);
  void fitToolbar();
});
onBeforeUnmount(() => {
  actionsObserver?.disconnect();
  actionsObserver = undefined;
});
watch([locked, () => props.active], ([locked, active]) => {
  if (!active) historyIndex = null;
  if (!active || locked) resetAttachmentDrag();
  if (!active || locked) sender?.disable();
  else {
    // ACT: enable() 内部会 focus()；节点面板不自动聚焦时把它还回去，否则每跑完一轮焦点又跳进输入框。
    // 用「enable 之前焦点是否已在本输入框」区分：用户自己在打字就不动他的光标。
    const hadFocus = !!senderElement.value?.contains(document.activeElement);
    sender?.enable();
    if (props.autoFocus === false && !hadFocus) (document.activeElement as HTMLElement | null)?.blur?.();
  }
});
watch(() => props.active, active => {
  if (!active) contextMenuVisible.value = false;
}, { flush: "sync" });

function getDraftContent() {
  return sender?.getModel().map((line, lineIndex) => line.map((tag, tagIndex) => {
    if (tag.type === "Mention") return `{{mention:${tag.id}}}`;
    if (tag.type === "Write") return tag.text;
    return sender?.chatEditor.NODES[lineIndex]?.children[tagIndex]?.$el.textContent ?? "";
  }).join("")).join("\n").replace(/[\ufeff\u200b]/g, "") ?? "";
}

// ACT: 只有完全空的草稿才允许进入历史；仅有附件或仅有提及都算有内容。
function draftEmpty() {
  return (sender?.getText().trim() ?? "") === "" && draftMentions.value.length === 0 && draftAttachments.value.length === 0;
}

// ACT: 历史还原不能复用 fillRewind——它会清 editingId，和“编辑消息”互相打断。
async function restoreHistory(item?: AgentMessage) {
  const instance = sender;
  if (!instance || locked.value) return;
  const mentions = item?.mentions ?? [];
  const content = item?.content ?? "";
  draftMentions.value = [...mentions];
  draftAttachments.value = [...(item?.attachments ?? [])];
  mentionMenuRef.value?.closeMenu();
  skillQuery.value = undefined;
  const model: AnyTagProps[][] = content.split("\n").map(line => mentionParts(line, mentions).map(part => part.mention
    ? { type: "Mention", id: part.mention.id, name: mentionName(part.mention) } : { type: "Write", text: part.text }));
  historyFilling = true;
  try {
    await instance.reset({ clearHistory: false, chatNode: model });
    // ACT: reset 之后还可能有排队到下一 tick 的 change 回调，多等一帧再放开标记，避免被当成用户编辑。
    await new Promise<void>(resolve => instance.nextTick(() => resolve()));
  } finally { historyFilling = false; }
  if (sender === instance) instance.focus("last");
}

// ACT: 索引同步推进、只在队列里做还原，连按方向键不会因为 reset 未完成而丢键。
function stepHistory(direction: -1 | 1) {
  const list = props.history ?? [];
  if (historyIndex === null) {
    if (direction !== -1 || !list.length || !draftEmpty()) return false;
    historyIndex = list.length - 1;
  } else {
    // 消息列表可能被压缩/删除缩短，先把索引夹回有效范围，避免按旧索引还原错消息。
    if (historyIndex >= list.length) historyIndex = list.length ? list.length - 1 : null;
    if (historyIndex === null) return false;
    const next = historyIndex + direction;
    if (next < 0) return true;
    if (next >= list.length) historyIndex = null;
    else historyIndex = next;
  }
  const index = historyIndex;
  // ACT: 记下消息 id 而不是位置；排队期间列表被替换时据此找回或直接退出。
  const expectedId = index === null ? undefined : list[index]?.id;
  historyQueue = historyQueue.then(async () => {
    if (!sender || !props.active || locked.value) return;
    if (expectedId === undefined) { await restoreHistory(); return; }
    const item = (props.history ?? []).find(message => message.id === expectedId);
    if (!item) { historyIndex = null; return; }
    await restoreHistory(item);
  }).catch(() => {});
  return true;
}

// ACT: x-sender 会拦截不带 Shift 的左右键做自定义跳转；带 ⌘/Ctrl/Alt 时必须放行给原生编辑（行首、文首、按词）。
function handleModifiedArrow(event: KeyboardEvent) {
  if (event.isComposing || event.keyCode === 229) return false;
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return false;
  if (!(event.metaKey || event.ctrlKey || event.altKey)) return false;
  event.stopPropagation();
  return true;
}

function handleHistoryKey(event: KeyboardEvent) {
  // ACT: 输入法组合期间方向键用于候选词，不能拿来翻历史。
  if (event.isComposing || event.keyCode === 229) return false;
  if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return false;
  if (props.disabled || props.busy || props.deletingId !== undefined || restoringAttachment.value || voiceActive.value || editingId.value !== undefined) return false;
  if (historyIndex === null) {
    if (event.key !== "ArrowUp" || !draftEmpty() || !props.history?.length) return false;
    event.preventDefault();
    event.stopPropagation();
    stepHistory(-1);
    return true;
  }
  // 已在历史模式内不再要求草稿为空，否则翻出第一条后就无法继续上下浏览。
  event.preventDefault();
  event.stopPropagation();
  stepHistory(event.key === "ArrowUp" ? -1 : 1);
  return true;
}

function captureMentionPosition() {
  const node = sender?.getCurrentNode();
  mentionPosition = node?.instance?.$el.isConnected ? { node: { ...node }, remove: mentionQuery.value === undefined ? 0 : mentionQuery.value.length + 1 } : undefined;
  skillQuery.value = undefined;
}

function updateMentionQuery() {
  if (!sender || insertingMentions || sender.chatEditor.isComposition || !sender.chatElement.richText.contains(sender.getSelection().anchorNode)) return;
  const current = sender.getCurrentNode();
  const before = current?.instance?.type === "Write" ? current.instance.text.slice(0, current.offset) : "";
  mentionQuery.value = /(?:^|[^\w@])@([^\s@]*)$/.exec(before)?.[1];
  if (mentionQuery.value !== undefined) captureMentionPosition();
}

function handleSenderKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") historyIndex = null;
  const id = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>("[data-agent-mention]")?.dataset.agentMention : undefined;
  if (id && ["Enter", " "].includes(event.key)) {
    event.preventDefault();
    event.stopPropagation();
    draftMentionPreview.value?.preview(id);
    return;
  }
  if (mentionMenuRef.value?.handleKeydown(event)) return;
  // ACT: x-sender 只把 Ctrl+Y 当重做，⌘⇧Z 会命中它自己的撤销判定（不判 Shift），这里接管并显式重做。
  if (!event.isComposing && event.keyCode !== 229 && (event.metaKey || event.ctrlKey) && event.shiftKey && (event.key === "Z" || event.key === "z" || event.code === "KeyZ")) {
    event.preventDefault();
    event.stopPropagation();
    void sender?.redo();
    return;
  }
  skillMenuRef.value?.handleKeydown(event);
  if (event.defaultPrevented) return;
  if (handleModifiedArrow(event)) return;
  handleHistoryKey(event);
}

// ACT: 同一画布输出或素材只允许出现一次；重复加入时提示而不是再插入一个标签。
function mentionIdentity(mention: AgentMention) {
  const source = mention.source;
  // ACT: 节点引用没有 outputId，用空串占位；否则会拼出 "undefined"，与输出引用的键撞车。
  return source.kind === "canvas"
    ? `canvas:${source.canvasId}:${source.nodeId}:${source.outputId ?? ""}`
    : `asset:${source.library ?? "global"}:${source.path}`;
}

async function insertMentions(mentions: AgentMention[], focusEnd = false) {
  const instance = sender;
  if (!instance || locked.value || !props.active) return;
  const tagIds = new Set(instance.getTagData().mention.map(item => item.id));
  const existingKeys = new Set(draftMentions.value.filter(item => tagIds.has(item.id)).map(mentionIdentity));
  const fresh = mentions.filter(mention => {
    const key = mentionIdentity(mention);
    if (existingKeys.has(key)) return false;
    existingKeys.add(key);
    return true;
  });
  if (!fresh.length) {
    if (mentions.length) ElMessage.info("已在上下文中");
    return;
  }
  if (tagIds.size + fresh.length > 20) return ElMessage.warning("每条消息最多提及 20 个输出或素材");
  insertingMentions = true;
  try {
    // 节点快捷加入始终追加到草稿末尾，忽略手动 @ 残留的插入位置。
    const position = focusEnd ? undefined : mentionPosition;
    if (position?.node.instance.$el.isConnected) position.node.instance.focus(position.node.offset);
    else instance.focus("last");
    if (position?.remove) await instance.backspace(-position.remove);
    for (const mention of fresh) {
      if (sender !== instance || !props.active) break;
      draftMentions.value.push(mention);
      await instance.setMention({ id: mention.id, name: mentionName(mention) });
    }
    // 节点快捷加入没有 mentionPosition，插入后把光标停在末尾；手动 @ 保持原插入位置。
    if (focusEnd && sender === instance) instance.focus("last");
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "添加提及失败");
  } finally {
    mentionQuery.value = undefined;
    mentionPosition = undefined;
    insertingMentions = false;
  }
}

let drainingAgentComposer = false;
async function drainAgentComposer() {
  // ACT: 节点面板不消费全局「加入对话」队列——否则画布上点「加入对话」可能落在某个节点的输入框里。
  if (props.acceptPending === false) return;
  if (drainingAgentComposer || !sender || locked.value || !props.active || !agentComposer.queue.length) return;
  drainingAgentComposer = true;
  try {
    while (sender && !locked.value && props.active && agentComposer.queue.length) {
      await insertMentions(agentComposer.take(props.directory), true);
    }
  } finally {
    drainingAgentComposer = false;
  }
}

watch(() => agentComposer.queue.length, () => { void drainAgentComposer(); }, { flush: "post" });
watch([() => props.active, locked], ([active, isLocked]) => {
  if (active && !isLocked) void drainAgentComposer();
}, { flush: "post" });

async function removeDraftMention(id: string) {
  if (!locked.value) await sender?.removeMention([id]);
}

async function selectSkill(name: string) {
  const instance = sender;
  if (!instance || locked.value) return;
  const model = instance.getModel();
  const first = model[0]?.[0];
  if (first?.type === "Write") first.text = `/skill:${name} ${first.text.replace(skillQuery.value !== undefined ? /^\/\S*/ : /^\s*\/skill:\S+(?:\s+|$)/, "")}`;
  if (!model.length) model.push([]);
  if (first?.type !== "Write") model[0]!.unshift({ type: "Write", text: `/skill:${name} ` });
  skillQuery.value = undefined;
  mentionMenuRef.value?.closeMenu();
  await instance.reset({ clearHistory: false, chatNode: model });
  if (sender === instance) instance.focus("last");
}

async function fillPrompt(prompt: string, attachments?: AgentAttachment[]) {
  const instance = sender;
  if (!instance || locked.value) return;
  draftMentions.value = [];
  if (attachments) draftAttachments.value = [...attachments];
  await instance.reset({ clearHistory: false, chatNode: [[{ type: "Write", text: prompt }]] });
  if (sender === instance) instance.focus("last");
}

// ACT: 回退要连提及和附件一起还原；不能复用 fillPrompt，它只填纯文本，mention token 会变成原文。
async function fillRewind(content: string, attachments?: AgentAttachment[], mentions?: AgentMessage["mentions"]) {
  const instance = sender;
  if (!instance || locked.value) return;
  editingId.value = undefined;
  draftMentions.value = [...(mentions ?? [])];
  draftAttachments.value = [...(attachments ?? [])];
  mentionMenuRef.value?.closeMenu();
  const model: AnyTagProps[][] = content.split("\n").map(line => mentionParts(line, mentions).map(part => part.mention
    ? { type: "Mention", id: part.mention.id, name: mentionName(part.mention) } : { type: "Write", text: part.text }));
  await instance.reset({ clearHistory: false, chatNode: model });
  if (sender === instance) instance.focus("last");
}

async function editMessage(item: AgentMessage) {
  const instance = sender;
  if (!instance || locked.value || props.remoteRunning || item.role !== "user") return;
  if (!editingId.value) editDraft = { model: instance.getModel(), mentions: [...draftMentions.value], attachments: [...draftAttachments.value] };
  editingId.value = item.id;
  draftMentions.value = [...item.mentions ?? []];
  draftAttachments.value = [...item.attachments ?? []];
  mentionMenuRef.value?.closeMenu();
  const model: AnyTagProps[][] = item.content.split("\n").map(line => mentionParts(line, item.mentions).map(part => part.mention
    ? { type: "Mention", id: part.mention.id, name: mentionName(part.mention) } : { type: "Write", text: part.text }));
  await instance.reset({ chatNode: model });
  if (sender === instance) instance.focus("last");
}

async function restoreEditingDraft() {
  const draft = editDraft;
  editDraft = undefined;
  editingId.value = undefined;
  draftMentions.value = draft?.mentions ?? [];
  draftAttachments.value = draft?.attachments ?? [];
  await sender?.reset({ chatNode: draft?.model });
}

async function cancelEdit() {
  if (props.busy || props.deletingId !== undefined || voiceActive.value) return;
  clearVoicePress();
  await restoreEditingDraft();
}

function setSenderHeight(height: number) {
  if (!sender) return;
  senderMaxHeight.value = Math.max(44, window.innerHeight / 2);
  senderHeight.value = Math.max(44, Math.min(senderMaxHeight.value, Math.round(height)));
  sender.chatElement.rollBox.style.height = `${senderHeight.value}px`;
}

function startSenderResize(event: PointerEvent) {
  if (event.button !== 0 || senderResize || !sender || voiceActive.value) return;
  event.preventDefault();
  senderResize = { pointerId: event.pointerId, y: event.clientY, height: sender.chatElement.rollBox.getBoundingClientRect().height };
  senderHeight.value = senderResize.height;
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
}

function moveSenderResize(event: PointerEvent) {
  if (senderResize?.pointerId !== event.pointerId) return;
  setSenderHeight(senderResize.height + senderResize.y - event.clientY);
}

function stopSenderResize(event: PointerEvent) {
  if (senderResize?.pointerId === event.pointerId) senderResize = undefined;
}

async function restoreTextAttachment(index: number) {
  const instance = sender;
  const attachment = draftAttachments.value[index];
  if (!instance || locked.value || !props.active || attachment?.mimeType !== "text/plain") return;
  restoringAttachment.value = true;
  try {
    const text = await readTextAttachment(attachment, props.directory);
    if (sender !== instance || !props.active || props.disabled || !draftAttachments.value.includes(attachment)) return;
    instance.focus("last");
    await instance.setText(`${instance.isEmpty(false) ? "" : "\n"}${text}`);
    if (sender === instance) draftAttachments.value = draftAttachments.value.filter(item => item !== attachment);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "还原文本附件失败，请重试");
  } finally {
    restoringAttachment.value = false;
  }
}

function pasteAttachments(event: ClipboardEvent) {
  const files = Array.from(event.clipboardData?.files ?? []);
  if (!files.length) {
    try {
      const file = createPastedTextFile(event.clipboardData?.getData("text/plain") ?? "");
      if (file) files.push(file);
    } catch (error) {
      event.preventDefault();
      event.stopImmediatePropagation();
      ElMessage.warning(error instanceof Error ? error.message : "无法添加文本附件");
      return;
    }
  }
  if (!files.length) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  addAttachments(files);
}

function selectAttachments(event: Event) {
  const input = event.target as HTMLInputElement;
  addAttachments(Array.from(input.files ?? []));
  input.value = "";
}

function resetAttachmentDrag() {
  attachmentDragDepth = 0;
  draggingAttachments.value = false;
}

function dragEnterAttachments(event: DragEvent) {
  if (!event.dataTransfer?.types.includes("Files")) return;
  attachmentDragDepth++;
  dragOverAttachments(event);
}

function dragOverAttachments(event: DragEvent) {
  if (!event.dataTransfer?.types.includes("Files")) return;
  event.preventDefault();
  event.stopPropagation();
  draggingAttachments.value = !locked.value && props.active;
  if (draggingAttachments.value) attachmentDragDepth = Math.max(1, attachmentDragDepth);
  event.dataTransfer.dropEffect = draggingAttachments.value ? "copy" : "none";
}

function dragLeaveAttachments(event: DragEvent) {
  if (!attachmentDragDepth) return;
  event.stopPropagation();
  if (--attachmentDragDepth === 0) resetAttachmentDrag();
}

function dropAttachments(event: DragEvent) {
  resetAttachmentDrag();
  const files = Array.from(event.dataTransfer?.files ?? []);
  if (!files.length) return;
  event.preventDefault();
  event.stopPropagation();
  addAttachments(files);
}

function addAttachments(files: File[]) {
  if (locked.value) return;
  for (const file of files) {
    const readableMimeType = getReadableFileMimeType(file.name, file.type);
    const mimeType = readableMimeType ?? file.type.split(";")[0]!.trim().toLowerCase();
    if (!readableMimeType && !/^(image|video)\//.test(mimeType)) {
      ElMessage.warning("只支持图片、视频和受支持的文本或文档文件");
      continue;
    }
    if (!file.size || file.size > 100 * 1024 * 1024) {
      ElMessage.warning("附件不能为空且不能超过 100 MB");
      continue;
    }
    if (mimeType === "text/plain" && file.size > 400000) {
      ElMessage.warning("文本附件不能超过 400000 字节");
      continue;
    }
    if (draftAttachments.value.length >= 20) {
      ElMessage.warning("每条消息最多添加 20 个附件");
      break;
    }
    draftAttachments.value.push({ name: file.name, path: "", mimeType, file });
  }
}

watch(senderElement, (element, _previous, onCleanup) => {
  if (!element) return;
  const instance = new xSender(element, {
    // ACT: 画布 Agent 节点面板打开时不抢焦点，否则点完节点再按 Backspace 只会删输入框里的字。
    autoFocus: props.autoFocus !== false && props.active,
    placeholder: placeholderText(),
    chatStyle: { minHeight: "44px", maxHeight: "50vh", fontSize: "14px", lineHeight: "24px" },
    keyboardSendFun: event => event.key === "Enter" && !event.shiftKey && !event.isComposing,
    keyboardWrapFun: event => event.key === "Enter" && event.shiftKey && !event.isComposing,
  });
  sender = instance;
  if (!props.active || locked.value) instance.disable();
  instance.bus.on("agentConversation", xSender.EventSet.EVENT_COMMON_SEND, () => { historyIndex = null; emit("submit"); });
  instance.bus.on("agentConversation", xSender.EventSet.EVENT_COMMON_CHANGE, () => {
    // ACT: 程序填充历史同样会触发 change，用 historyFilling 区分；用户真正编辑后退出历史模式。
    if (!historyFilling && historyIndex !== null) historyIndex = null;
    senderText.value = instance.getText();
    const token = /^\/([^\s/]*)$/.exec(instance.getText())?.[1];
    skillQuery.value = token !== undefined && commandMatches(token) ? undefined : token;
    const targets: typeof draftMentionTargets.value = [];
    for (const line of instance.chatEditor.NODES) for (const tag of line.children) {
      if (tag.type !== "Mention") continue;
      tag.$el.dataset.agentMention = tag.id;
      tag.$el.setAttribute("role", "button");
      tag.$el.setAttribute("tabindex", "0");
      tag.$el.setAttribute("aria-label", t`预览 ${tag.name}`);
      const mention = draftMentions.value.find(item => item.id === tag.id);
      if (!mention || !mentionThumbnailProps(mention).thumbnail) continue;
      const content = tag.$el.querySelector<HTMLElement>(".chat-tag-mention");
      if (!content) continue;
      let element = content.querySelector<HTMLElement>(".agentMentionThumbnail");
      if (!element) {
        element = document.createElement("span");
        element.className = "agentMentionThumbnail";
        const label = document.createElement("span");
        label.className = "agentMentionLabel";
        label.textContent = content.textContent;
        content.replaceChildren(element, label);
      }
      targets.push({ key: draftMentionTargets.value.find(target => target.element === element)?.key ?? Symbol(), element, mention });
    }
    draftMentionTargets.value = targets;
    void instance.nextTick(() => { if (sender === instance) updateMentionQuery(); });
  });
  instance.bus.on("agentConversation", xSender.EventSet.EVENT_COMMON_TAG_CLICK, (tag: { type: string; id?: string }) => {
    if (tag.type === "Mention" && tag.id) draftMentionPreview.value?.preview(tag.id);
  });
  // 输入框挂载后消费面板打开前已排队的提及。
  void drainAgentComposer();
  const editor = instance.chatElement.richText;
  const nextTick = instance.nextTick.bind(instance);
  instance.nextTick = callback => nextTick(() => { if (sender === instance && editor.isConnected) return typeof callback === "function" ? callback() : callback; });
  const chatEditor = instance.chatEditor as typeof instance.chatEditor & { insertNodes(nodes: AnyTagProps[][]): Promise<void> };
  const insertNodes = chatEditor.insertNodes.bind(chatEditor);
  chatEditor.insertNodes = async nodes => {
    // 异步粘贴和输入法回调在编辑器卸载后不再新建输入节点。
    if (sender === instance && editor.isConnected) await insertNodes(nodes);
  };
  editor.setAttribute("role", "textbox");
  editor.setAttribute("aria-label", translate("消息"));
  editor.setAttribute("aria-multiline", "true");
  element.addEventListener("paste", pasteAttachments, true);
  window.addEventListener("dragend", resetAttachmentDrag, true);
  window.addEventListener("drop", resetAttachmentDrag, true);
  window.addEventListener("blur", resetAttachmentDrag);
  const updateCursor = (event: Event) => { if (!(event instanceof KeyboardEvent) || event.key !== "Escape") updateMentionQuery(); };
  editor.addEventListener("keyup", updateCursor);
  editor.addEventListener("compositionend", updateCursor);
  onCleanup(() => {
    cancelVoiceInput();
    draftMentionTargets.value = [];
    sender = undefined;
    senderResize = undefined;
    element.removeEventListener("paste", pasteAttachments, true);
    window.removeEventListener("dragend", resetAttachmentDrag, true);
    window.removeEventListener("drop", resetAttachmentDrag, true);
    window.removeEventListener("blur", resetAttachmentDrag);
    resetAttachmentDrag();
    editor.removeEventListener("keyup", updateCursor);
    editor.removeEventListener("compositionend", updateCursor);
    // ACT: XSender 1.4.6 的排队聚焦不会随 destroy 取消；保留回调所需字段，库修复后可恢复直接销毁。
    Object.assign(instance.chatEditor, { focusFirst: () => {}, focusLast: () => {}, focusMark: () => {}, cursorView: () => {} });
    for (const line of instance.chatEditor.NODES) for (const tag of line.children) {
      if (tag.type === "Write" || tag.type === "Input") tag.focus = () => {};
    }
    instance.bus.offKeyEvent("agentConversation");
    instance.bus.emit(xSender.EventSet.EVENT_COMMON_DESTROY);
  });
});


function getDraft() {
  return { prompt: getDraftContent(), attachments: draftAttachments.value, mentions: draftMentions.value, mentionedIds: sender?.getTagData().mention.map(mention => mention.id) ?? [] };
}

async function clearDraft() {
  historyIndex = null;
  draftAttachments.value = [];
  draftMentions.value = [];
  await sender?.reset();
}

/** ACT: 面板关闭时会问"还有没有没发出去的内容"，有就保留实例，避免草稿被卸载带走。 */
function hasDraft() {
  return !!sender?.getText().trim() || draftAttachments.value.length > 0 || draftMentions.value.length > 0 || editingId.value !== undefined;
}

defineExpose({ getDraft, clearDraft, hasDraft, fillPrompt, fillRewind, editMessage, cancelEdit, restoreEditingDraft, insertMentions });
</script>

<style lang="scss">
.agentConversation {
  .messageInput {
    --chat-text: var(--el-text-color-primary);
    --chat-text-placeholder: var(--el-text-color-placeholder);
    --chat-rect-padding: 12px;
    --chat-mention-text: var(--el-color-primary);
    position: relative;
    flex-shrink: 0;
    margin: 0 12px 8px;
    border: 1px solid var(--el-border-color-light);
    border-radius: calc(var(--ui-radius) * 2.75);
    background: var(--el-bg-color);
    box-shadow: 0 4px 16px rgb(0 0 0 / 8%);

    &:focus-within {
      border-color: var(--el-color-primary-light-5);
    }

    &.draggingAttachments {
      border-color: var(--el-color-primary-light-5);
    }

    &.voiceActive {
      border-color: var(--el-color-primary);
      box-shadow: 0 0 0 2px var(--el-color-primary-light-9);

      .senderInput {
        min-height: 100px;
        touch-action: none;
        user-select: none;
      }
    }

    .senderInput {
      position: relative;

      .voiceOverlay {
        position: absolute;
        inset: 0;
        z-index: 12;
        overflow: auto;
        padding: 12px;
        border-radius: calc(var(--ui-radius) * 2.75);
        background: var(--el-bg-color);
        color: var(--el-text-color-placeholder);
        font-size: 14px;
        line-height: 24px;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        pointer-events: none;

        .voiceFeedback {
          display: flex;
          align-items: center;
          gap: 10px;
          min-height: 24px;
          color: var(--el-color-primary);

          .voiceWave {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 3px;
            height: 24px;
            flex-shrink: 0;

            > span {
              width: 3px;
              min-height: 3px;
              border-radius: 3px;
              background: currentColor;
              transition: height 60ms linear;
            }
          }
        }

        .voiceTranscript { color: var(--el-text-color-primary); }

        @media (prefers-reduced-motion: reduce) {
          .voiceFeedback .voiceWave > span { transition: none; }
        }
      }
    }

    .attachmentDropHint {
      position: absolute;
      inset: 0;
      z-index: 13;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 4px;
      border-radius: inherit;
      background: var(--el-bg-color);
      color: var(--el-text-color-primary);
      font-size: 14px;
      font-weight: 500;
      pointer-events: none;

      > svg {
        color: var(--el-text-color-secondary);
      }

      small {
        color: var(--el-text-color-secondary);
        font-size: 12px;
        font-weight: 400;
      }
    }

    .senderResizeHandle {
      position: absolute;
      z-index: 12;
      top: -4px;
      right: 12px;
      left: 12px;
      height: 8px;
      border-radius: 4px;
      cursor: ns-resize;
      touch-action: none;
      user-select: none;

      &:focus-visible {
        outline: 2px solid var(--el-color-primary);
        outline-offset: 2px;
      }
    }

    .draftAttachments {
      padding: 12px 12px 0;
    }

    .commandHints {
      display: flex;
      flex-direction: column;
      gap: 1px;
      padding: 6px 12px 0;

      .commandHint {
        display: flex;
        align-items: baseline;
        gap: 8px;
        width: 100%;
        padding: 4px 6px;
        border: 0;
        border-radius: var(--el-border-radius-base);
        background: transparent;
        color: var(--el-text-color-regular);
        font: inherit;
        font-size: 12px;
        text-align: left;
        cursor: pointer;

        code { font-size: 12px; color: var(--el-color-primary); }
        span { color: var(--el-text-color-secondary); }
        &:hover { background: var(--el-fill-color-light); }
      }
    }

    .sendQueue {
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: 6px 12px 0;
      font-size: 12px;
      color: var(--el-text-color-secondary);

      .queueTitle { font-weight: 600; }

      .queueItem {
        display: flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
      }

      .queueText {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--el-text-color-regular);
      }
    }

    .senderEditor .chat-placeholder-wrap {
      font-size: 14px;
      font-style: normal;
      line-height: 24px;
    }

    .editingBanner {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 3px 12px;
      border-bottom: 1px solid var(--el-border-color-lighter);
      color: var(--el-text-color-secondary);
      font-size: 12px;
    }

    .senderEditor .chat-tag-mention {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      max-width: 100%;
      vertical-align: middle;
      border-radius: var(--el-border-radius-small);
      background: var(--el-color-primary-light-9);
      color: var(--el-color-primary);
      white-space: normal;
      overflow-wrap: anywhere;
      cursor: pointer;

      .agentMentionThumbnail {
        display: inline-flex;
        flex-shrink: 0;

        .mentionThumbnail { width: 24px; height: 24px; border-radius: 3px; }
      }
      .agentMentionLabel { min-width: 0; }
    }

    .senderActions {
      display: flex;
      /* ACT: 面板最窄 320px 时按钮放不下，宁可折行也不能压着模型名叠字。 */
      flex-wrap: wrap;
      justify-content: flex-end;
      align-items: center;
      gap: 4px 6px;
      min-width: 0;
      padding: 2px 8px 6px;

      > .el-button {
        margin-left: 0;
      }

      .modelPopover {
        flex: 1;
        /* ACT: 模型名可以被省略，但不能被压到 0 宽——那正是叠字的成因。 */
        min-width: 96px;
        margin-right: auto;
      }

      .moreButton {
        width: 28px;
        height: 28px;
        flex-shrink: 0;
        margin: 0;
        padding: 0;
        color: var(--el-text-color-secondary);
      }

      .contextButton {
        width: 24px;
        height: 24px;
        flex-shrink: 0;
        margin: 0;
        padding: 0;

        &.is-text {
          background-color: transparent;
        }
      }

      .queueButton, .interruptButton, .stopButton {
        width: 28px;
        height: 28px;
        flex-shrink: 0;
        margin: 0;
        padding: 0;
      }

      .queueButton { color: var(--el-text-color-secondary); }

      .voiceButton {
        width: 28px;
        height: 28px;
        flex-shrink: 0;
        padding: 0;
        color: var(--el-text-color-secondary);

        &.voiceActive {
          background-color: var(--el-color-primary);
          color: white;
          box-shadow: 0 0 0 4px var(--el-color-primary-light-8);
        }
      }

      .sendButton {
        width: 34px;
        height: 34px;
        border: none;
        transform: translateY(-2px);
      }
    }
  }
}

/* 弹出层 teleport 到 body，样式必须放在 .agentConversation 之外。 */
.agentToolbarMorePopover .toolbarMore {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;

  .toolbarMoreUsage {
    color: var(--el-text-color-secondary);
    font-size: 12px;
  }
}
</style>
