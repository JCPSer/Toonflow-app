<template>
  <div class="messageViewport t-chat t-chat--normal">
    <div ref="messageList" class="messageList t-chat__list" :class="{ hasTurnRail: turns.length > 1 }" role="region" aria-label="对话消息" tabindex="0" @wheel.passive="cancelJump" @touchstart.passive="cancelJump">
      <chat-item v-if="!messages.length && !disabled" role="assistant" variant="text">
        <template #content>
          <section class="welcomeMessage" aria-label="开始新对话">
            <div class="welcomeHeader">
              <span class="welcomeIcon" aria-hidden="true"><span class="welcomeLogo" :style="{ maskImage: `url(${logoUrl})` }" /></span>
              <div>
                <p class="welcomeLabel">你好，我是 Toonflow 助手</p>
                <h3>从一个想法开始</h3>
              </div>
            </div>
            <p class="welcomeDescription">聊聊你的故事、画面或镜头，让我们一起把想法落到画布上。</p>
            <div class="welcomeSuggestions">
              <el-button v-for="item in welcomeSuggestions" :key="item.label" class="welcomeSuggestion" text bg :disabled="locked" :aria-label="`填入提示：${item.label}`" @click="emit('fillPrompt', item.prompt)">
                <component :is="item.icon" :size="19" aria-hidden="true" />
                <span class="suggestionContent"><strong>{{ item.label }}</strong><span>{{ item.description }}</span></span>
                <icon-arrow-up-right class="suggestionArrow" :size="15" aria-hidden="true" />
              </el-button>
            </div>
            <p class="welcomeHint">点击填入提示，也可以直接输入，或添加图片、视频和文档。</p>
          </section>
        </template>
      </chat-item>
      <div class="messageSpace" :style="{ height: `${messageVirtualizer.getTotalSize()}px` }">
        <div
          v-for="{ item, row } in visibleMessages"
          :key="item.id"
          :ref="measureMessage"
          :data-index="row.index"
          :data-message-id="item.id"
          :data-live-message="item.streaming || item.id === browserMessages.liveMessageId || undefined"
          class="messageRow"
          :style="{ transform: `translateY(${row.start}px)` }"
          :class="{ userMessage: item.role === 'user', editingMessage: editingId === item.id }">
          <chat-item :role="item.role" :variant="item.role === 'user' ? 'base' : 'text'" :textLoading="!!item.streaming && !compacting && !item.parts?.some(part => part.type === 'tool' || part.content)" animation="moving" @vue:updated="measureMessage($event.el?.parentElement ?? null)">
            <template #content>
              <div class="messageContent">
                <div v-if="item.report" class="reportHeader"><icon-users-group :size="14" />{{ item.report.name }} 上报</div>
                <template v-for="block in blocksOf(item)" :key="block.kind === 'toolGroup' ? block.key : block.part.id">
                  <toolGroupMessage
                    v-if="block.kind === 'toolGroup'"
                    :tools="block.tools"
                    :expanded="expandedGroups.has(block.key)"
                    :directory="directory"
                    @toggle="toggleGroup(block.key, $event)"
                    @copy="emit('copy', $event)" />
                  <chat-reasoning v-else-if="block.part.type === 'thinking' && block.part.content" class="messageReasoning" :collapsed="block.part.collapsed ?? true" expandIconPlacement="left" @update:collapsed="block.part.collapsed = $event">
                    <template #expandIcon><component :is="(block.part.collapsed ?? true) ? IconChevronRight : IconChevronDown" :size="14" aria-hidden="true" /></template>
                    <template #header>
                      <span class="reasoningHeader">
                        <icon-atom :size="14" />
                        <span>思考</span>
                        <span v-if="block.part.duration !== undefined" class="thinkingDuration">{{ block.part.duration.toFixed(1) }} 秒</span>
                      </span>
                    </template>
                    <messageMarkdown v-if="!(block.part.collapsed ?? true)" :content="block.part.content" :streaming="!!item.streaming" :directory="directory" />
                  </chat-reasoning>
                  <toolMessage v-else-if="block.part.type === 'tool' && !isBrowserTool(block.part.tool)" v-model:collapsed="block.part.collapsed" :tool="block.part.tool" :directory="directory" @copy="emit('copy', $event)" />
                  <messageMarkdown v-else-if="block.part.type === 'text' && block.part.content" :content="block.part.content" :streaming="!!item.streaming" :directory="directory" />
                </template>
                <attachmentList v-if="item.attachments?.length" :attachments="item.attachments" :directory="directory" favoritable />
                <div v-if="item.role === 'user'" class="messageText"><mentionContent :content="item.content" :mentions="item.mentions" :directory="directory" /></div>
                <div v-if="item.error" class="messageError" role="alert">{{ item.error }}</div>
              </div>
            </template>
          </chat-item>
          <div v-if="!item.streaming" class="messageActions">
            <template v-if="editingId === item.id">
              <el-button text size="small" :disabled="busy || deletingId !== undefined || voiceActive" @click="emit('cancelEdit')"><icon-x :size="14" />取消</el-button>
              <span class="editingHint">正在下方编辑</span>
            </template>
            <template v-else>
              <el-button v-if="item.content" class="messageAction" text circle aria-label="复制消息" title="复制消息" @click="emit('copy', mentionPlainText(item.content, item.mentions))"><icon-copy :size="14" /></el-button>
              <template v-if="item.role === 'user'">
                <el-button v-if="!subAgent" class="messageAction" text circle :disabled="locked || remoteRunning || !item.entryId" aria-label="回退到这里" title="回退到这里：丢弃这条消息之后的所有对话" @click="emit('rewind', item)"><icon-arrow-back-up :size="14" /></el-button>
                <el-button class="messageAction" text circle :disabled="locked || remoteRunning" aria-label="编辑消息" title="编辑消息" @click="emit('edit', item)"><icon-pencil :size="14" /></el-button>
              </template>
              <el-button v-else-if="item.role === 'assistant' && !item.report && !subAgent" class="messageAction" text circle :disabled="locked || remoteRunning || !item.entryId" aria-label="复制为新会话" title="复制为新会话：截到这轮结束另存一份对话" @click="emit('fork', item)"><icon-git-fork :size="14" /></el-button>
              <el-button v-if="!item.report" class="messageAction" text circle :loading="deletingId === item.id" :disabled="locked || remoteRunning" aria-label="删除消息" title="删除消息" @click="emit('delete', item)"><icon-trash v-if="deletingId !== item.id" :size="14" /></el-button>
            </template>
          </div>
          <chat-reasoning v-if="browserMessages.tools.has(item.id) && !expandToolCalls" class="browserPreview messageReasoning" :collapsed="!browserExpanded(item)" expandIconPlacement="left" @update:collapsed="toggleBrowser(item, $event)">
            <template #expandIcon><component :is="browserExpanded(item) ? IconChevronDown : IconChevronRight" :size="14" aria-hidden="true" /></template>
            <template #header>
              <span class="reasoningHeader">
                <icon-world :size="14" />
                <span>浏览器操作 {{ browserMessages.tools.get(item.id)!.length }} 次</span>
              </span>
            </template>
            <browserPanel
              v-if="browserExpanded(item)"
              :tools="browserMessages.tools.get(item.id)!"
              :directory="directory"
              :active="active"
              :live="item.id === browserMessages.liveMessageId" />
          </chat-reasoning>
          <browserPanel v-else-if="browserMessages.tools.has(item.id)" class="browserPreview" :tools="browserMessages.tools.get(item.id)!" :directory="directory" :active="active" :live="item.id === browserMessages.liveMessageId" />
        </div>
      </div>
    </div>
    <!-- ACT: 长对话只能靠滚轮往上翻太慢。右侧给一条轮次目录：收起态只占 22px 显示短横，
         悬停向左展开显示每条提问，点击跳转。索引取 displayedMessages 的下标，与虚拟列表同源，
         避免用 props.messages 的下标导致错位。轮数不足 2 条时整条不渲染。 -->
    <nav v-if="turns.length > 1" class="turnRail" aria-label="对话轮次目录">
      <div class="turnRailList">
        <button v-for="(turn, position) in turns" :key="turn.id" type="button" class="turnRailItem" :title="turn.label" :aria-label="`跳到第 ${position + 1} 条提问：${turn.label}`" @click="jumpToTurn(turn.index)">
          <span class="turnRailBar" aria-hidden="true" />
          <span class="turnRailIndex">{{ position + 1 }}</span>
          <span class="turnRailLabel">{{ turn.label }}</span>
        </button>
      </div>
    </nav>
    <el-button v-if="messages.length && !atLatestMessage" class="scrollBottom" circle aria-label="回到最新消息" title="回到最新消息" @click="messageVirtualizer.scrollToEnd()"><icon-arrow-down :size="18" /></el-button>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch, type ComponentPublicInstance } from "vue";
import { defaultRangeExtractor, measureElement, observeElementRect, useVirtualizer } from "@tanstack/vue-virtual";
import { IconArrowBackUp, IconArrowDown, IconArrowUpRight, IconAtom, IconChevronDown, IconChevronRight, IconCopy, IconGitFork, IconMovie, IconPencil, IconPhoto, IconTrash, IconUsersGroup, IconVector, IconWorld, IconX } from "@tabler/icons-vue";
import logoUrl from "@toonflow/assets/logo.svg";
import browserPanel from "@toonflow/tool-browser/panel";
import { isBrowserTool } from "@toonflow/tool-browser/client";
import type { AgentToolCall } from "@toonflow/server/agent/types";
import chatItem from "@tdesign-vue-next/chat/es/chat-item";
import chatReasoning from "@tdesign-vue-next/chat/es/chat-reasoning";
import messageMarkdown from "@/components/messageMarkdown.vue";
import attachmentList from "../attachmentList.vue";
import mentionContent from "../mentionContent.vue";
import { mentionPlainText } from "../mentionText";
import toolMessage from "../toolMessage.vue";
import toolGroupMessage from "../toolGroupMessage.vue";
import { generalSettings } from "@/stores/settings";
import type { AgentMessage, AgentMessagePart } from "../types";
import "tdesign-vue-next/es/style/index.css";
import "@tdesign-vue-next/chat/es/style/index.css";

const props = defineProps<{ messages: AgentMessage[]; directory?: string; active: boolean; disabled: boolean; locked: boolean; busy: boolean; remoteRunning: boolean; compacting: boolean; editingId?: string; deletingId?: string; voiceActive: boolean; subAgent?: boolean }>();
const emit = defineEmits<{ fillPrompt: [prompt: string]; copy: [content: string]; edit: [message: AgentMessage]; delete: [message: AgentMessage]; rewind: [message: AgentMessage]; fork: [message: AgentMessage]; cancelEdit: [] }>();
const browserMessages = computed(() => {
  const groups = new Map<string, { id: string; tools: AgentToolCall[] }>();
  let turnId: string | undefined;
  let liveMessageId: string | undefined;
  for (const message of props.messages) {
    if (message.role === "user") {
      turnId = message.entryId ?? message.id;
      liveMessageId = undefined;
      continue;
    }
    if (message.replyTo && message.replyTo !== turnId) {
      turnId = message.replyTo;
      liveMessageId = undefined;
    }
    const tools = message.parts?.flatMap(part => part.type === "tool" && isBrowserTool(part.tool) ? [part.tool] : []);
    if (!tools?.length) continue;
    const replyId = turnId ?? message.id;
    let group = groups.get(replyId);
    if (!group) { group = { id: message.id, tools: [] }; groups.set(replyId, group); }
    group.tools.push(...tools);
    liveMessageId = group.id;
  }
  return { tools: new Map([...groups.values()].map(group => [group.id, group.tools])), liveMessageId };
});
// 同轮浏览器调用共用该轮首条浏览器消息底部的画面，原始工具记录仍完整保留。
const displayedMessages = computed(() => props.messages.filter(message => browserMessages.value.tools.has(message.id) || message.role === "user" || message.error || message.report || message.attachments?.length ||
  !message.parts?.length || message.parts.some(part => part.type !== "tool" || !isBrowserTool(part.tool))));

// ACT: 折叠工具调用只改渲染层——同一消息内连续的工具调用聚合成一行，单个工具保持原卡片。
const expandToolCalls = computed(() => generalSettings.value.expandToolCalls === true);
type RenderBlock =
  | { kind: "part"; part: AgentMessagePart }
  | { kind: "toolGroup"; key: string; tools: AgentToolCall[] };
function buildBlocks(message: AgentMessage): RenderBlock[] {
  const parts = message.parts ?? [];
  if (expandToolCalls.value) return parts.map(part => ({ kind: "part", part }));
  const blocks: RenderBlock[] = [];
  // ACT: 保留原始 part 引用——单工具走原卡片，折叠状态存在 part 上，重建对象会让展开状态丢失。
  let run: Extract<AgentMessagePart, { type: "tool" }>[] = [];
  const flush = () => {
    if (run.length === 1) blocks.push({ kind: "part", part: run[0] });
    else if (run.length > 1) blocks.push({ kind: "toolGroup", key: `${message.id}:${run[0].id}`, tools: run.map(item => item.tool) });
    run = [];
  };
  for (const part of parts) {
    // 浏览器画面统一在该轮底部渲染，既不打断 run，也不在这里渲染。
    if (part.type === "tool" && isBrowserTool(part.tool)) continue;
    // 交互式提问（askUser）必须单独可见，等回答完 question 被清掉后才并回聚合行。
    if (part.type === "tool" && !part.tool.question) { run.push(part); continue; }
    // 空的 text/thinking 不参与渲染，也不能把连续的工具调用拆成两行。
    // 模型常在工具之间吐一个换行，纯空白同样不可见，按空处理。
    if ((part.type === "text" || part.type === "thinking") && !part.content.trim()) continue;
    flush();
    blocks.push({ kind: "part", part });
  }
  flush();
  return blocks;
}
const blocksCache = computed(() => new Map(displayedMessages.value.map(message => [message.id, buildBlocks(message)])));
function blocksOf(message: AgentMessage) {
  return blocksCache.value.get(message.id) ?? [];
}
const expandedGroups = ref<Set<string>>(new Set());
// ACT: 用户主动展开时不要自动贴底，否则刚点开的那一行会被滚出视口。
let userExpanding = false;
// ACT: 虚拟列表在「贴底」状态下会把行高变化的高度差直接加回 scrollTop，
// 展开最新一条聚合行时标题会被顶出视口。记录被点行的屏幕位置，渲染后再按差值还原。
// 行高会先经 @vue:updated、再经虚拟器自己的 ResizeObserver 落定，因此要连续几帧收敛，
// 连续两帧稳定才收手；期间任何一次新的展开都会让旧收敛失效。
let expandAnchor: { element: HTMLElement; top: number } | undefined;
let expandToken = 0;
function restoreExpandAnchor() {
  const anchor = expandAnchor;
  if (!anchor || !messageList.value) return 0;
  const delta = anchor.element.getBoundingClientRect().top - anchor.top;
  if (Math.abs(delta) >= 1) messageList.value.scrollTop += delta;
  return delta;
}
function toggleGroup(key: string, event?: MouseEvent) {
  const token = ++expandToken;
  userExpanding = true;
  const element = event?.currentTarget instanceof HTMLElement ? event.currentTarget : undefined;
  expandAnchor = element ? { element, top: element.getBoundingClientRect().top } : undefined;
  const next = new Set(expandedGroups.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  expandedGroups.value = next;
  const settle = (frame: number, stable: number) => {
    if (token !== expandToken) return;
    const delta = restoreExpandAnchor();
    const nextStable = Math.abs(delta) < 1 ? stable + 1 : 0;
    if (nextStable >= 2 || frame >= 8) {
      expandAnchor = undefined;
      userExpanding = false;
      return;
    }
    requestAnimationFrame(() => settle(frame + 1, nextStable));
  };
  void nextTick(() => { requestAnimationFrame(() => settle(0, 0)); });
}

const browserOpened = ref<Set<string>>(new Set());
const browserCollapsed = ref<Set<string>>(new Set());
function browserExpanded(message: AgentMessage) {
  if (browserCollapsed.value.has(message.id)) return false;
  const tools = browserMessages.value.tools.get(message.id) ?? [];
  return browserOpened.value.has(message.id)
    || tools.some(tool => tool.status === "running")
    || (!!message.streaming && message.id === browserMessages.value.liveMessageId);
}
function toggleBrowser(message: AgentMessage, collapsed: boolean) {
  const opened = new Set(browserOpened.value);
  const closed = new Set(browserCollapsed.value);
  if (collapsed) { opened.delete(message.id); closed.add(message.id); }
  else { closed.delete(message.id); opened.add(message.id); }
  browserOpened.value = opened;
  browserCollapsed.value = closed;
}
const messageList = ref<HTMLDivElement>();
const atLatestMessage = ref(true);
let messageListInitialized = false;
// 目录跳转收敛期间独占滚动位置（虚拟器的 onChange 会读它，因此声明在使用之前）。
let jumping = false;
let messageScrollOffset = 0;
const messageKeys = computed(() => displayedMessages.value.map(item => item.id));
// ACT: 只常驻当前轮的实时画面，历史浏览器消息仍按需挂载，避免长对话累积连接和 DOM。
const retainedMessages = computed(() => displayedMessages.value.flatMap((item, index) => item.streaming || item.id === props.editingId || item.id === browserMessages.value.liveMessageId ? [index] : []));
const messageVirtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>(computed(() => {
  const keys = messageKeys.value;
  const retained = retainedMessages.value;
  return {
    count: keys.length,
    getScrollElement: () => messageList.value ?? null,
    getItemKey: (index: number) => keys[index]!,
    estimateSize: () => 240,
    overscan: 3,
    paddingStart: 12,
    anchorTo: "end" as const,
    followOnAppend: true,
    scrollEndThreshold: 48,
    useAnimationFrameWithResizeObserver: true,
    useCachedMeasurements: !props.active,
    // ACT: 实时行读取当前高度，避免延后执行的观察记录覆盖本轮同步测量；历史行仍使用缓存。
    measureElement: (element, entry, instance) => props.active && element.dataset.liveMessage ? element.offsetHeight : measureElement(element, entry, instance),
    // ACT: v-show 隐藏时保留视口与行高，避免零尺寸清空正在输入的工具表单。
    observeElementRect: (instance, onChange) => observeElementRect(instance, rect => { if (rect.height) onChange(rect); }),
    rangeExtractor: range => [...new Set([...defaultRangeExtractor(range), ...retained])].sort((left, right) => left - right),
    onChange(instance) {
      // ACT: 跳转收敛期间由 jumpToTurn 独占滚动位置，这里不要用 isAtEnd 把贴底标志改回去。
      if (jumping) return;
      if (!messageListInitialized || !props.active || !messageList.value?.clientHeight) return;
      atLatestMessage.value = instance.isAtEnd();
      messageScrollOffset = instance.scrollOffset ?? 0;
    },
  };
}));
const visibleMessages = computed(() => messageVirtualizer.value.getVirtualItems().map(row => ({ row, item: displayedMessages.value[row.index]! })));
// ACT: 轮次目录与虚拟列表共用 displayedMessages，下标即虚拟行号；标签取纯文本并压缩空白，
// 只有附件或引用的提问也要给一个可辨识的占位，否则目录里会出现空白行。
const turns = computed(() => displayedMessages.value.flatMap((message, index) => {
  if (message.role !== "user") return [];
  const label = mentionPlainText(message.content, message.mentions).replace(/\s+/g, " ").trim();
  return [{ id: message.id, index, label: label || (message.attachments?.length ? "（附件）" : "（引用）") }];
}));

// ACT: 目录跳转只靠 scrollToIndex 不够准——动态高度列表对未测量行只能用 240px 估算，
// 落点误差随行号累积，且实时行测量/图片加载还会把位置再推开一次。
// 所以粗跳之后按真实 DOM 位置收敛：每轮用 setTimeout 让一次渲染落地，最多 24 轮（约 1s），
// 连续 3 次 |delta| ≤ 2px 才收手（冷启动时总高会连续变化，只到位一次等于没到位）。
let jumpToken = 0;
function nextFrame() {
  // 用定时器而不是 rAF：窗口被遮挡时 rAF 会被节流甚至暂停，跳转就会卡在中间。
  return new Promise<void>(resolve => setTimeout(resolve, 40));
}
function cancelJump() {
  if (!jumping) return;
  jumpToken++;
  jumping = false;
}
async function jumpToTurn(index: number) {
  const instance = messageVirtualizer.value;
  const list = messageList.value;
  if (!list || index < 0 || index >= messageKeys.value.length) return;
  const token = ++jumpToken;
  jumping = true;
  // ACT: 先退出「贴底」状态，否则跳转后实时行测量完成会把视图拉回最新消息。
  atLatestMessage.value = false;
  instance.scrollToIndex(index, { align: "start" });
  const messageId = messageKeys.value[index];
  let stable = 0;
  try {
    for (let attempt = 0; attempt < 24; attempt++) {
      await nextFrame();
      if (token !== jumpToken) return;
      const listTop = list.getBoundingClientRect().top;
      // 行是绝对定位 + transform，offsetTop 不反映真实位置，只能用 rect 差值。
      const row = messageId ? list.querySelector<HTMLElement>(`[data-message-id="${messageId}"]`) : null;
      if (row) {
        const delta = row.getBoundingClientRect().top - listTop;
        if (Math.abs(delta) <= 2) {
          if (++stable >= 3) break;
          continue;
        }
        stable = 0;
        list.scrollTop += delta;
        continue;
      }
      // 目标行没进渲染窗口：估算偏差可能把窗口带偏好几屏。用已渲染行的真实高度和位置推一步，
      // 推完再量——每轮都会新测量一批行，误差逐轮收敛。步长夹到不足一屏，避免一次冲过头再来回摆。
      stable = 0;
      const samples = [...list.querySelectorAll<HTMLElement>("[data-index]")]
        .map(element => ({ index: Number(element.dataset.index), height: element.getBoundingClientRect().height }))
        .filter(sample => Number.isFinite(sample.index));
      if (!samples.length) {
        instance.scrollToIndex(index, { align: "start" });
        continue;
      }
      const nearest = samples.reduce((best, sample) => Math.abs(sample.index - index) < Math.abs(best.index - index) ? sample : best);
      const average = Math.max(60, Math.min(1200, samples.reduce((sum, sample) => sum + sample.height, 0) / samples.length));
      const limit = Math.max(120, list.clientHeight * 0.8);
      const step = Math.max(-limit, Math.min(limit, (index - nearest.index) * average));
      list.scrollTop += step || Math.sign(index - nearest.index) * list.clientHeight * 0.8;
    }
  } finally {
    if (token === jumpToken) {
      jumping = false;
      // 内容不满一屏、或点的就是当前位置时不会产生位移，也就没有 scroll 事件，
      // atLatestMessage 会一直停在 false，右下角就会挂出一个点不掉的「回到最新消息」。
      // 这里按跳转后的真实位置重算一次即可。
      atLatestMessage.value = instance.isAtEnd();
    }
  }
}
let messageMeasurePending = false;

function measureMessage(element: Element | ComponentPublicInstance | null) {
  const instance = messageVirtualizer.value;
  if (!(element instanceof HTMLDivElement) || !props.active || !atLatestMessage.value || !element.dataset.liveMessage) {
    instance.measureElement(element instanceof HTMLDivElement ? element : null);
    return;
  }
  const index = instance.indexFromElement(element);
  const height = element.offsetHeight;
  const changed = instance.itemSizeCache.get(instance.options.getItemKey(index)) !== height;
  instance.measureElement(element);
  // 自动滚动时库会跳过同步测量；在本次 DOM 提交内校正，避免画面随换行先下移再被拉回。
  instance.resizeItem(index, height);
  if (!changed || messageMeasurePending || userExpanding) return;
  messageMeasurePending = true;
  void nextTick(() => {
    messageMeasurePending = false;
    if (props.active && atLatestMessage.value && !userExpanding) instance.scrollToEnd();
  });
}

watch([() => props.active, messageList], async ([active, element]) => {
  if (!active || !element) return;
  await nextTick();
  if (!props.active) return;
  if (!messageListInitialized || atLatestMessage.value) messageVirtualizer.value.scrollToEnd();
  else messageVirtualizer.value.scrollToOffset(messageScrollOffset);
  messageListInitialized = true;
}, { immediate: true, flush: "post" });
const welcomeSuggestions = [
  { label: "搭建创作画布", description: "把创意串成清晰的节点流程", icon: IconVector, prompt: "帮我搭建一个创作画布，先和我确认需要的节点与流程。" },
  { label: "梳理故事分镜", description: "拆解故事，安排画面与镜头", icon: IconMovie, prompt: "帮我把故事整理成分镜，先和我确认故事内容、时长和画面风格。" },
  { label: "生成图片素材", description: "为角色和场景寻找视觉方向", icon: IconPhoto, prompt: "帮我生成图片素材，先和我确认画面内容、风格和使用的模型。" },
];
</script>

<style lang="scss">
.agentConversation {
  .messageViewport {
    position: relative;
    flex: 1;
    min-height: 0;

    .messageList {
      overflow-anchor: none;
      scrollbar-gutter: stable;
    }

    /* ACT: 只有真的渲染目录条时才留空槽；轮次不足 2 条时不留，否则右侧会挂一条无主的空白。 */
    .messageList.hasTurnRail {
      padding-right: 34px;
    }

    /* ACT: 轮次目录。收起态只有一条短横，悬停向左扩成浮层显示提问，不挤压消息区。
       高度跟条目数走并整体垂直居中：以前用 top/bottom 撑满容器，条目少时看着靠上，
       悬停展开后浮层也几乎占满整条高度。max-height 的 104px 留给上下边缘和右下角
       「回到最新消息」按钮（按钮 bottom:12、直径约 32px，两侧各剩 52px 正好不重叠），
       条目超上限才滚动。
       整个 nav 与列表都 pointer-events: none，只有每一行可交互——否则这条 26px 宽的竖条
       会盖住滚动条并在右边缘吃掉滚轮事件（nav 是滚动容器的兄弟节点，事件不会传过去）。 */
    .turnRail {
      position: absolute;
      top: 50%;
      right: 2px;
      max-height: calc(100% - 104px);
      z-index: 2;
      display: flex;
      /* ACT: 必须是纵向 flex。横向 flex 下列表宽度按内容收缩，收起态内容宽度是 0
         （短横是绝对定位、不撑宽），overflow:hidden 就把整条目录裁没了——
         表现是右侧只剩一块 34px 的空白槽。纵向 flex 下 align-items: stretch 会把
         列表撑满 26px 宽，高度仍按条目数走。 */
      flex-direction: column;
      width: 26px;
      padding: 4px 0;
      border: 1px solid transparent;
      border-radius: 8px;
      pointer-events: none;
      transform: translateY(-50%);
      transition: width 0.16s ease;

      /* 用 :has() 而不是 :hover/:focus-within：鼠标点击后按钮仍保持焦点，
         :focus-within 会让浮层在鼠标移开很久之后还挂着；键盘则只认 :focus-visible。 */
      &:has(.turnRailItem:hover),
      &:has(.turnRailItem:focus-visible) {
        width: 260px;
        border-color: var(--el-border-color-lighter);
        background: var(--el-bg-color-overlay);
        box-shadow: var(--el-box-shadow-light);

        .turnRailList {
          overflow-y: auto;
          scrollbar-width: thin;
        }

        .turnRailItem {
          padding: 0 8px;
        }

        /* 收起态与展开态只切换显示对象：短横绝对居中、不参与布局，文字常态 display:none，
           这样 26px 宽的收起态不会把文字挤成一团，展开时也不会有行高跳动。 */
        .turnRailIndex,
        .turnRailLabel {
          display: block;
        }

        .turnRailBar {
          display: none;
        }
      }
    }

    .turnRailList {
      display: flex;
      /* ACT: 不能 flex: 1 —— 那会把列表撑满 nav 的可用高度，只有三条提问时浮层也是一整条。
         flex: 0 1 auto 让高度按条目数收缩，撞到 nav 的 max-height 才由 overflow 接管。 */
      flex: 0 1 auto;
      min-width: 0;
      flex-direction: column;
      /* 行之间不留缝隙，否则指针在两行之间移动的瞬间 `:has(hover)` 会闪断收起。 */
      gap: 0;
      min-height: 0;
      /* 收起态裁掉超出高度的行；悬停展开后才可滚动（滚动事件仍会从行冒泡到列表）。 */
      overflow: hidden;
      pointer-events: none;
      scrollbar-width: none;
    }

    .turnRailItem {
      position: relative;
      display: flex;
      flex: none;
      align-items: center;
      height: 20px;
      padding: 0;
      /* 只有行本身接收指针，nav 与列表保持穿透，右侧滚动条与滚轮不受影响。 */
      pointer-events: auto;
      border: 0;
      border-radius: 4px;
      background: none;
      color: var(--el-text-color-regular);
      font-size: 12px;
      cursor: pointer;

      &:hover,
      &:focus-visible {
        background: var(--el-fill-color-light);
        color: var(--el-color-primary);
        outline: none;
      }

      &:hover .turnRailBar,
      &:focus-visible .turnRailBar {
        background: var(--el-color-primary);
      }
    }

    /* 收起态的可视部分：一根绝对居中的短横，不参与布局，因此 26px 宽度下仍严格居中。 */
    .turnRailBar {
      position: absolute;
      inset: 0;
      width: 12px;
      height: 3px;
      margin: auto;
      border-radius: 2px;
      background: var(--el-text-color-placeholder);
      transition: background 0.16s ease;
    }

    .turnRailIndex,
    .turnRailLabel {
      display: none;
      white-space: nowrap;
    }

    .turnRailIndex {
      flex: none;
      width: 18px;
      color: var(--el-text-color-secondary);
      font-variant-numeric: tabular-nums;
      text-align: right;
    }

    .turnRailLabel {
      flex: 1;
      min-width: 0;
      margin-left: 8px;
      overflow: hidden;
      text-overflow: ellipsis;
      text-align: left;
    }

    @media (prefers-reduced-motion: reduce) {
      .turnRail,
      .turnRailBar,
      .turnRailIndex,
      .turnRailLabel {
        transition: none;
      }
    }

    .messageSpace {
      position: relative;
      width: 100%;
    }

    .scrollBottom {
      position: absolute;
      right: 16px;
      bottom: 12px;
      z-index: 1;
    }

    .welcomeMessage {
      display: flex;
      flex-direction: column;
      gap: 18px;
      padding: 28px 16px 16px;
      color: var(--el-text-color-primary);

      .welcomeHeader {
        display: flex;
        align-items: center;
        gap: 12px;

        .welcomeIcon {
          display: grid;
          place-items: center;
          flex-shrink: 0;
          width: 42px;
          height: 42px;
          border-radius: var(--ui-radius-large);
          background: var(--el-color-primary-light-9);
          color: var(--el-color-primary);

          .welcomeLogo {
            width: 28px;
            height: 28px;
            background: currentColor;
            mask-size: contain;
            mask-position: center;
            mask-repeat: no-repeat;
          }
        }

        .welcomeLabel { margin: 0 0 4px; font-size: 12px; color: var(--el-text-color-secondary); }
        h3 { margin: 0; font-size: 18px; font-weight: 600; line-height: 1.4; }
      }

      .welcomeDescription { margin: 0; font-size: 13px; line-height: 1.7; color: var(--el-text-color-regular); }

      .welcomeSuggestions {
        display: flex;
        flex-direction: column;
        gap: 8px;

        .welcomeSuggestion {
          height: auto;
          margin: 0;
          padding: 12px;
          text-align: left;
          white-space: normal;
          line-height: 1.5;

          > span { display: flex; align-items: center; gap: 12px; width: 100%; min-width: 0; }
          svg { flex-shrink: 0; color: var(--el-text-color-secondary); }
          .suggestionContent {
            display: flex;
            flex: 1;
            flex-direction: column;
            gap: 2px;
            min-width: 0;
            strong { font-size: 13px; font-weight: 500; }
            span { font-size: 12px; color: var(--el-text-color-secondary); }
          }
          .suggestionArrow { color: var(--el-text-color-placeholder); }
        }
      }

      .welcomeHint { margin: 0; font-size: 12px; line-height: 1.6; color: var(--el-text-color-secondary); }
    }

    .messageRow {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      box-sizing: border-box;
      padding: 0 12px 12px;

      .messageActions {
        display: flex;
        align-items: center;
        gap: 4px;
        margin-top: 4px;

        .el-button {
          margin: 0;

          .tabler-icon {
            flex-shrink: 0;
          }
        }

        .messageAction {
          width: 24px;
          height: 24px;
          padding: 0;
          color: var(--el-text-color-secondary);
        }
      }

      .browserPreview { margin-top: 6px; }

      &.userMessage .messageActions {
        justify-content: flex-end;
      }

      &.editingMessage .t-chat__inner.user .t-chat__content .t-chat__detail {
        width: 100%;
        max-width: 100%;
        padding: 0;
        background: transparent;
      }
    }

    .t-chat__inner {
      margin-bottom: 0;

      .t-chat__content {
        min-width: 0;
        padding-top: 0;

        .t-chat__detail {
          width: 100%;
          max-width: 100%;
          padding: 0;
        }
      }

      &.user .t-chat__content .t-chat__detail {
        width: auto;
        max-width: 80%;
        padding: 6px 10px;
        border-radius: calc(var(--ui-radius) * 1.25);
        background: color-mix(in srgb, var(--el-text-color-secondary) 12%, var(--el-bg-color));
      }
    }

    .messageContent {
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 0;
      overflow-wrap: anywhere;
      color: var(--el-text-color-primary);
    }

    // ACT: 浏览器操作折叠挂在 .messageRow 下、不在 .messageContent 内，两处共用同一套折叠样式。
    .messageReasoning {
        padding-top: 0;

        .t-collapse-panel__wrapper {
          background: transparent;

          .t-collapse-panel__header {
            padding: 2px 0;
            font-size: 13px;
            line-height: 20px;
          }

          .t-collapse-panel__icon {
            width: 16px;
            height: 20px;
            margin-right: 6px;
            color: var(--el-text-color-secondary);
          }

          .t-collapse-panel__body {
            background: transparent;

            .t-collapse-panel__content {
              padding: 4px 0 4px 22px;
              background: transparent;
              color: var(--el-text-color-secondary);
            }
          }
        }
      }

      .reasoningHeader {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        color: var(--el-text-color-secondary);

        .thinkingDuration {
          font-variant-numeric: tabular-nums;
        }
      }

    .messageContent {
      .messageText {
        white-space: pre-wrap;
        font-size: 13px;
        line-height: 1.6;
      }

      .messageError {
        color: var(--el-color-danger);
        font-size: 12px;
      }

      .reportHeader {
        display: flex;
        align-items: center;
        gap: 6px;
        color: var(--el-text-color-secondary);
        font-size: 12px;
      }

      .messageMarkdown {
        display: block;
        min-width: 0;
        max-width: 100%;
        font-size: 13px;
        line-height: 1.6;
      }
    }
  }
}
</style>
