<template>
  <span class="mentionContent"><template v-for="(part, index) in parts" :key="index"><el-tooltip v-if="part.mention" :content="sourceLabel(part.mention)" :showArrow="false"><button class="mentionTag" type="button" :aria-label="`预览 ${mentionName(part.mention)}`" @click="preview(part.mention.id)"><mentionThumbnail v-if="mentionThumbnailProps(part.mention).thumbnail" class="inlineMentionThumbnail" v-bind="mentionThumbnailProps(part.mention)" :directory="directory"><icon-at :size="13" /></mentionThumbnail><icon-at v-else :size="13" /><span class="mentionLabel">{{ mentionName(part.mention) }}</span></button></el-tooltip><template v-else>{{ part.text }}</template></template></span>
  <el-dialog v-model="previewVisible" :title="selected?.label || '提及内容'" width="min(720px, 90vw)" alignCenter appendToBody destroyOnClose>
    <div v-if="selected" class="mentionPreview">
      <p class="mentionSource">{{ sourceLabel(selected) }}</p>
      <p v-if="loading || error" :role="error ? 'alert' : 'status'">{{ loading ? '正在读取…' : error }}</p>
      <img v-else-if="previewUrl && ['IMAGE', 'MASK'].includes(selected.dataType)" :src="previewUrl" :alt="selected.label" @error="error = '无法预览该图片'" />
      <video v-else-if="previewUrl && selected.dataType === 'VIDEO'" :src="previewUrl" controls playsinline preload="metadata" @error="error = '无法预览该视频'" />
      <audio v-else-if="previewUrl && selected.dataType === 'AUDIO'" :src="previewUrl" controls preload="metadata" @error="error = '无法预览该音频'" />
      <p v-else-if="selected.dataType === 'FILE'" class="fileName"><icon-file :size="20" />{{ selected.label }}</p>
      <template v-else-if="selected.dataType === 'NODE'">
        <ul v-if="selfItem" class="mentionUpstream">
          <li>
            <span class="mentionUpstreamSource">本节点输出<template v-if="selfItem.outputName"> · {{ selfItem.outputName }}</template></span>
            <span class="mentionUpstreamText">{{ selfItem.preview }}</span>
          </li>
        </ul>
        <ul v-if="upstreamList.length" class="mentionUpstream">
          <li v-for="item in upstreamList" :key="`${item.targetHandle}:${item.nodeId}:${item.outputId}`">
            <span class="mentionUpstreamSource">{{ item.nodeName }}<template v-if="item.outputName"> · {{ item.outputName }}</template><template v-if="item.targetHandleName"> → {{ item.targetHandleName }}</template></span>
            <span class="mentionUpstreamText">{{ item.preview }}</span>
          </li>
        </ul>
        <p v-else-if="!selfItem" class="fileName"><icon-at :size="20" />该节点当前既没有输出摘要，也没有直接上游，引用只含节点身份，完整内容由助手用画布工具读取。</p>
        <p class="mentionHint">输出与上游摘要最多 150 字，完整内容由助手按路径或 nodeId 读取。</p>
      </template>
      <template v-else-if="textSummary">
        <pre>{{ textSummary }}</pre>
        <p class="mentionHint">正文摘要（最多 150 字），完整内容由助手按路径读取。</p>
      </template>
      <template v-else>
        <p v-if="pointerOnly" class="fileName">正文摘要不可用（内容过大或尚未生成），完整内容由助手按路径读取。</p>
        <template v-else>
          <pre>{{ textValue.slice(0, 12000) }}</pre>
          <p v-if="textValue.length > 12000">…（预览已截取，发送保留完整内容）</p>
        </template>
      </template>
      <el-button v-if="removable" text type="danger" @click="removeSelected">移除此引用</el-button>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import axios from "axios";
import { IconAt, IconFile } from "@tabler/icons-vue";
import type { AgentMention } from "@toonflow/server/agent/types";
import useWorkspaceFiles from "@/lib/workspaceFiles";
import { mentionLibraryLabel, mentionName, mentionParts, mentionThumbnailProps } from "./mentionText";
import mentionThumbnail from "./mentionThumbnail.vue";

const props = defineProps<{ content?: string; mentions?: AgentMention[]; directory?: string; removable?: boolean }>();
const emit = defineEmits<{ remove: [id: string] }>();
const parts = computed(() => mentionParts(props.content ?? "", props.mentions));
const previewVisible = ref(false);
const selectedId = ref("");
const selected = computed(() => props.mentions?.find(mention => mention.id === selectedId.value));
const previewUrl = ref("");
const loading = ref(false);
const error = ref("");
const textValue = computed(() => {
  const value = selected.value?.value;
  return typeof value === "string" ? value : JSON.stringify(value, null, 2) ?? "";
});
// ACT: 文本输出引用现在是「指针 + 正文摘要」，气泡要直接显示摘要；只有指针（摘要读不到）时给一句说明，
// 不要把 { path, mimeType } 的 JSON 当正文摊给用户看。
type MentionUpstreamItem = { targetHandle: string; targetHandleName?: string; nodeId: string; nodeName: string; outputId: string; outputName?: string; preview: string };
const valueRecord = computed(() => {
  const value = selected.value?.value;
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
});
const textSummary = computed(() => {
  const summary = valueRecord.value?.summary;
  return typeof summary === "string" ? summary : "";
});
const pointerOnly = computed(() => typeof valueRecord.value?.path === "string" && !textSummary.value);
const upstreamList = computed<MentionUpstreamItem[]>(() => {
  const upstream = valueRecord.value?.upstream;
  return Array.isArray(upstream) ? upstream as MentionUpstreamItem[] : [];
});
// ACT: 节点自身的输出摘要（self）渲染在「上游」之前——模型先看到这个节点产出了什么，再看它的输入。
const selfItem = computed<MentionUpstreamItem | undefined>(() => {
  const self = valueRecord.value?.self;
  return self && typeof self === "object" && !Array.isArray(self) ? self as MentionUpstreamItem : undefined;
});

function sourceLabel(mention: AgentMention) {
  if (mention.source.kind === "asset") return `${mentionLibraryLabel(mention)} / ${mention.source.path}`;
  // ACT: 节点引用没有输出名，只显示到节点；输出引用保持原有「画布 / 节点 / 输出（节点 id）」。
  return mention.source.outputName
    ? `${mention.source.canvasName} / ${mention.source.nodeName} / ${mention.source.outputName}（${mention.source.nodeId}）`
    : `${mention.source.canvasName} / ${mention.source.nodeName}（${mention.source.nodeId}）`;
}

function preview(id: string) {
  selectedId.value = id;
  previewVisible.value = true;
}

function removeSelected() {
  emit("remove", selectedId.value);
  previewVisible.value = false;
}

watch([previewVisible, selected, () => props.directory], async ([visible, mention, directory], _old, onCleanup) => {
  previewUrl.value = "";
  error.value = "";
  loading.value = false;
  if (!visible || !mention || !["IMAGE", "MASK", "VIDEO", "AUDIO"].includes(mention.dataType)) return;
  const value = mention.value as { url?: string; mimeType?: string } | null;
  let release = () => {};
  const controller = new AbortController();
  onCleanup(() => { controller.abort(); release(); });
  loading.value = true;
  try {
    const thumbnailProps = mentionThumbnailProps(mention);
    if (mention.source.kind === "asset" && thumbnailProps.globalAsset) {
      const params: Record<string, string> = { path: mention.source.path };
      if (thumbnailProps.library === "project") {
        if (!directory) throw new Error("请先打开工作区");
        params.library = "project";
        params.directory = directory;
      }
      const { data } = await axios.get<Blob>("/api/assets/read", {
        params, responseType: "blob", signal: controller.signal, headers: { "x-toonflow-workspace": "1" },
      });
      controller.signal.throwIfAborted();
      previewUrl.value = URL.createObjectURL(data);
      const url = previewUrl.value;
      release = () => URL.revokeObjectURL(url);
    } else if (directory && value?.url) {
      const preview = useWorkspaceFiles(directory).acquireUrl(value.url, value.mimeType);
      release = preview.release;
      const url = await preview.url;
      if (!controller.signal.aborted) previewUrl.value = url;
    } else throw new Error("引用文件不存在");
  } catch (cause) {
    if (!controller.signal.aborted) error.value = axios.isAxiosError(cause) ? cause.response?.data?.message || "无法读取引用文件，文件可能已被删除" : cause instanceof Error ? cause.message : "无法读取引用";
  } finally {
    if (!controller.signal.aborted) loading.value = false;
  }
});

defineExpose({ preview });
</script>

<style scoped lang="scss">
.mentionContent {
  white-space: pre-wrap;
  overflow-wrap: anywhere;

  .mentionTag {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    max-width: 100%;
    margin: 1px 2px;
    padding: 1px 5px;
    border: none;
    border-radius: var(--el-border-radius-small);
    background: var(--el-color-primary-light-9);
    color: var(--el-color-primary);
    font: inherit;
    text-align: left;
    vertical-align: middle;
    overflow-wrap: anywhere;
    cursor: pointer;

    svg { flex-shrink: 0; }
    .inlineMentionThumbnail { width: 24px; height: 24px; border-radius: 3px; }
    .mentionLabel { min-width: 0; }
  }
}

.mentionPreview {
  .mentionSource { color: var(--el-text-color-secondary); overflow-wrap: anywhere; }
  img, video { display: block; max-width: 100%; max-height: 60vh; margin: auto; }
  audio { width: 100%; }
  pre { max-height: 55vh; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; }
  .fileName { display: flex; align-items: center; gap: 8px; }
  .mentionHint { margin: 6px 0 0; color: var(--el-text-color-secondary); font-size: 12px; }

  .mentionUpstream {
    max-height: 55vh;
    margin: 0;
    padding: 0;
    overflow: auto;
    list-style: none;

    li { padding: 8px 0; border-bottom: 1px solid var(--el-border-color-lighter); }
    li:last-child { border-bottom: none; }
    .mentionUpstreamSource { display: block; color: var(--el-text-color-secondary); font-size: 12px; overflow-wrap: anywhere; }
    .mentionUpstreamText { display: block; margin-top: 4px; white-space: pre-wrap; overflow-wrap: anywhere; }
  }
}
</style>
