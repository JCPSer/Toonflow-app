<template>
  <nodeSkeleton
    v-bind="nodeProps"
    :running="generating"
    :bottomVisible="node.selected"
    :topVisible="node.selected"
    topWidth="max-content"
    :downloadUrl="downloadUrl"
    :downloadName="`${nodeProps.label || '文本'}.md`"
    :bottomWidth="660"
    @fullscreen="fullscreen = true; editing = true">
    <div class="textContent" :class="{ empty: !outputs.text.value.trim() }">
      <el-alert v-if="documentState.error" :title="documentState.error" type="error" :closable="false" showIcon>
        <el-button text size="small" :disabled="generating || textReloading" @click="editing = true">查看并复制当前正文</el-button>
        <el-button text size="small" :disabled="generating" :loading="textReloading" @click="reloadText">重新读取磁盘</el-button>
      </el-alert>
      <div v-if="outputs.text.value.trim() && previewReady" class="textPreview nopan nowheel" aria-label="文本内容">
        <markdownPreview :modelValue="outputs.text.value" :files="textReady ? textFiles : undefined" :path="textPath" :active="previewReady" />
      </div>
      <el-button class="editButton nodrag nopan" :icon="IconEdit" :disabled="generating || !textReady" text @dblclick.stop @click.stop="editing = true">编辑</el-button>
    </div>
    <template #bottom>
      <el-card class="promptCard" shadow="never" :bodyStyle="{ padding: '14px 16px 12px' }" @keydown.esc="handlePromptEsc">
        <div class="promptHeader" v-if="refList.length">
          <referenceItem
            v-model="refList"
            @preview="setReferencePreview"
            @remove="removeReference" />
        </div>
        <promptInput v-model="promptModel" v-model:text="prompt" :references="referenceMentions" />
        <div class="promptFooter">
          <el-select v-model="model" class="modelSelect" filterable :loading="modelsLoading" :disabled="generating" placeholder="选择模型" aria-label="生成模型" noDataText="请先在设置中添加模型" placement="top-start" @visible-change="visible => visible && loadModels()">
            <template #prefix><icon-sparkles :size="17" /></template>
            <el-option-group v-for="provider in modelGroups" :key="provider.id" :label="provider.label">
              <el-option v-for="item in provider.models" :key="item.modelId" :label="item.label" :value="JSON.stringify([item.providerId, item.modelId])" />
            </el-option-group>
          </el-select>
          <div class="promptActions">
            <el-button
              class="sendButton"
              :icon="generating ? IconPlayerStop : IconArrowUp"
              :disabled="generating ? false : (!prompt.trim() || !selectedModel || !textReady)"
              :title="generating ? '停止生成' : '生成'"
              :aria-label="generating ? '停止生成' : '生成'"
              @click="generating ? stopGeneration() : generateText()" />
          </div>
        </div>
      </el-card>
    </template>
  </nodeSkeleton>
  <el-dialog v-model="editing" title="编辑文本" width="min(860px, calc(100vw - 32px))" :fullscreen="fullscreen" alignCenter appendToBody @closed="fullscreen = false">
    <div class="textEditor" :class="{ fullscreen }">
      <markdownEditor v-model="outputs.text.value" :files="textReady ? textFiles : undefined" :path="textPath" :active="editing" :disabled="generating || textReloading" :readonly="!!documentState.error" ariaLabel="编辑文本内容" />
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, inject, onMounted, onScopeDispose, ref, watch, type ComputedRef } from "vue";
import { useVueFlow } from "@vue-flow/core";
import { ElAlert, ElButton, ElCard, ElSelect, ElDialog, ElOption, ElOptionGroup, ElMessage, ElMessageBox } from "element-plus";
import { IconEdit, IconFileText, IconSparkles, IconArrowUp, IconPlayerStop } from "@tabler/icons-vue";
import { nodeSkeleton, nodeTools, notifyGenerateStop, useNode, z, type NodeAiModel, type NodeHandle } from "@toonflow/nodes-scaffold/runtime";
import { groupNodeModels } from "@toonflow/node-shared/groupNodeModels";
import { useNodeReferences } from "@toonflow/node-shared/useNodeReferences";
import markdownEditor from "./markdownEditor.vue";
import markdownPreview from "./markdownPreview.vue";
import referenceItem from "@toonflow/node-shared/referenceItem";
import promptInput from "@toonflow/node-shared/promptInput";
import { useNodeDocumentState, type NodeDocumentContext } from "@toonflow/nodes-scaffold/nodeDocument";

type PromptModel = NonNullable<InstanceType<typeof promptInput>["$props"]["modelValue"]>;

defineOptions({
  inheritAttrs: false,
  icon: IconFileText,
  handles: [
    { id: "in", type: "target", dataType: ["VIDEO", "IMAGE", "STRING", "FILE"], label: "视频、图片、文本、文件输入" },
    { id: "text", type: "source", dataType: "STRING", label: "文本输出" },
  ] satisfies NodeHandle[],
});
const { node, nodeProps, outputs, ai, files, nodeEvent, previewReady } = useNode({
  label: "文本",
  outputs: { text: { dataType: "STRING", value: "" } },
});
const { refList, referenceMentions, setReferencePreview, removeReference } = useNodeReferences();
const editing = ref(false);
const fullscreen = ref(false);
const downloadUrl = ref("");
const documentContext = inject<NodeDocumentContext | undefined>("nodeDocument", undefined);
watch([() => outputs.value.text.value, () => node.selected || !!documentContext?.targets.has(node.id)], ([text, visible], _previous, onCleanup) => {
  downloadUrl.value = "";
  if (!visible || !text.trim()) return;
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
  downloadUrl.value = url;
  onCleanup(() => URL.revokeObjectURL(url));
}, { immediate: true });
const data = computed(() => node.data as typeof node.data & { prompt?: string; promptModel?: PromptModel; model?: string; textPath?: string; textSnapshot?: string });
const prompt = computed({ get: () => data.value.prompt ?? "", set: (value: string) => { data.value.prompt = value; } });
const model = computed({ get: () => data.value.model ?? "", set: (value: string) => { data.value.model = value; } });
const models = ref<NodeAiModel[]>([]);
const modelsLoading = ref(false);
const generating = ref(false);
// ACT: delta 先进缓冲、按固定时间片写回 outputs，避免每个 token 都触发节点与画布重绘。
let streamBuffer = "";
let streamReceived = false;
let streamClosed = false;
let streamFlushTimer: ReturnType<typeof setTimeout> | undefined;
function flushStream() {
  if (streamFlushTimer !== undefined) { clearTimeout(streamFlushTimer); streamFlushTimer = undefined; }
  if (streamReceived) outputs.value.text.value = streamBuffer;
}
function scheduleStreamFlush() {
  if (streamFlushTimer !== undefined) return;
  // ACT: 长文解析更贵，按长度自适应降频；时间片恒定，不随 delta 频率变化。
  streamFlushTimer = setTimeout(flushStream, streamBuffer.length > 20000 ? 400 : 200);
}
const stopping = ref(false);
const stopRequested = ref(false);
// ACT: controller 与 runId 只服务当前这一次生成，放进 ref 会无谓触发渲染。
let generationController: AbortController | undefined;
let activeRunId: string | undefined;
const selectedModel = computed(() => models.value.find(item => JSON.stringify([item.providerId, item.modelId]) === model.value));
const modelGroups = computed(() => groupNodeModels(models.value, model.value));
const textReady = ref(false);
const textReloading = ref(false);
const textPath = `assets/${node.id}/content.md`;
let textFiles: ReturnType<typeof files.getWorkspaceFiles>;
let textLoading: Promise<void> | undefined;
let textSaving = Promise.resolve();
let textSnapshot: Awaited<ReturnType<typeof textFiles.readTextSnapshot>> | undefined;
let textRevision = 0;
const documentState = useNodeDocumentState();
function saveText(value: string) {
  const revision = ++textRevision;
  documentState.dirty = true;
  textSaving = textSaving.catch(() => {}).then(async () => {
    if (!textSnapshot) throw new Error("文本尚未加载，无法保存");
    textSnapshot.revision = await textFiles.writeTextSnapshot(textPath, value, textSnapshot);
    textSnapshot.text = value;
    if (revision === textRevision && outputs.value.text.value === value) {
      documentState.dirty = false;
      documentState.error = "";
    }
  }).catch(error => {
    documentState.error = (error as { response?: { data?: { message?: string } } })?.response?.data?.message
      || (error instanceof Error ? error.message : "文本保存失败");
    throw error;
  });
  return textSaving;
}
nodeEvent.on("save", async (reason) => {
  await textLoading;
  if (!textReady.value) throw new Error("文本尚未加载，无法保存");
  if (reason === "reload" && generating.value) throw new Error("文本正在生成，请完成后再刷新节点");
  // 普通编辑已由 watcher 入队；生成中补存已收到的片段，不因画布保存重复写未改动的文本。
  if (generating.value && streamReceived) saveText(streamBuffer);
  let pending: Promise<void>;
  do {
    pending = textSaving;
    try { await pending; }
    catch { await saveText(outputs.value.text.value); }
  } while (pending !== textSaving);
  if (reason === "reload" && generating.value) throw new Error("文本正在生成，请完成后再刷新节点");
});
onMounted(() => { textLoading = loadText(); });
async function loadText(fromDisk = false) {
  textReloading.value = true;
  textReady.value = false;
  try {
    if (!node.id || /[\\/]/.test(node.id) || node.id === "." || node.id === "..") throw new Error("节点 ID 不能作为文件夹名称");
    if (data.value.textPath !== undefined && data.value.textPath !== textPath) throw new Error("文本文件路径无效");
    textFiles = files.getWorkspaceFiles();
    if (data.value.textPath || fromDisk) textSnapshot = await textFiles.readTextSnapshot(textPath);
    const value = fromDisk ? textSnapshot!.text : data.value.textSnapshot !== undefined ? data.value.textSnapshot : textSnapshot?.text ?? outputs.value.text.value;
    if (typeof value !== "string") throw new Error("文本内容无效");
    if (!data.value.textPath && !fromDisk) {
      for (const directory of ["assets", `assets/${node.id}`]) {
        await textFiles.mkdir(directory).catch((error: { response?: { data?: { data?: { code?: string } } } }) => {
          if (error.response?.data?.data?.code !== "EEXIST") throw error;
        });
      }
      await textFiles.write(textPath, value, true).catch((error: { response?: { data?: { data?: { code?: string } } } }) => {
        if (error.response?.data?.data?.code !== "EEXIST") throw error;
      });
      textSnapshot = await textFiles.readTextSnapshot(textPath);
      if (textSnapshot.text !== value) throw new Error("文本文件已被其他编辑器修改，请重新加载节点");
    } else if (textSnapshot && textSnapshot.text !== value) {
      textSnapshot.revision = await textFiles.writeTextSnapshot(textPath, value, textSnapshot);
      textSnapshot.text = value;
    }
    outputs.value.text.value = value;
    data.value.textPath = textPath;
    delete data.value.textSnapshot;
    // ACT: 成功落盘后才排除内联正文；迁移失败时画布仍保留原内容。
    if (!Object.hasOwn(outputs.value, "toJSON")) Object.defineProperty(outputs.value, "toJSON", { value: () => ({}) });
    textSaving = Promise.resolve();
    textReady.value = true;
    documentState.dirty = false;
    documentState.error = "";
  } catch (error) {
    documentState.error = (error as { response?: { data?: { message?: string } } })?.response?.data?.message
      || (error instanceof Error ? error.message : "文本加载失败");
    ElMessage.error(documentState.error);
  } finally { textReloading.value = false; }
}

async function reloadText() {
  if (generating.value || textReloading.value) return;
  const confirmed = await ElMessageBox.confirm("重新读取将用磁盘内容替换当前正文。未保存的修改会被放弃，请先复制需要保留的内容。", "重新读取文本", {
    confirmButtonText: "重新读取", cancelButtonText: "取消", type: "warning", closeOnClickModal: false,
  }).then(() => true, () => false);
  if (!confirmed || generating.value || textReloading.value) return;
  const fromDisk = textReady.value || !!textSnapshot || !!data.value.textPath;
  textReloading.value = true;
  textReady.value = false;
  await textSaving.catch(() => {});
  textLoading = loadText(fromDisk);
  await textLoading;
}

watch(() => outputs.value.text.value, async (value) => {
  if (!textReady.value) return;
  documentState.dirty = true;
  if (generating.value) return;
  try { await saveText(value); }
  catch (error) { ElMessage.error(error instanceof Error ? error.message : "文本保存失败"); }
}, { flush: "sync" });
nodeEvent.on("copy", () => {
  if (!textReady.value) throw new Error("文本尚未加载");
  return { textPath: undefined, textSnapshot: outputs.value.text.value };
});

onMounted(loadModels);

async function loadModels() {
  if (modelsLoading.value) return;
  modelsLoading.value = true;
  try {
    models.value = await ai.getModels();
    if (!model.value) {
      const first = models.value.find(item => !item.hidden);
      model.value = first ? JSON.stringify([first.providerId, first.modelId]) : "";
    }
  } catch (error) {
    if (error instanceof Error && error.name !== "AbortError") ElMessage.error(error.message);
  } finally {
    modelsLoading.value = false;
  }
}

const { getSelectedNodes } = useVueFlow();
// ACT: 画布外（文档面板等）没有这个注入，默认视为前台，保证节点在其它上下文也能用 Esc 停止。
const canvasActive = inject<ComputedRef<boolean>>("canvasActive", computed(() => true));

async function generateText() {
  const choice = selectedModel.value;
  if (!textReady.value || generating.value || stopping.value || !choice || !prompt.value.trim()) return;
  const controller = new AbortController();
  const runId = crypto.randomUUID();
  generationController = controller;
  activeRunId = runId;
  stopRequested.value = false;
  generating.value = true;
  streamBuffer = "";
  streamReceived = false;
  streamClosed = false;
  try {
    if (refList.value.some(item => item.value === undefined)) throw new Error("引用节点暂无内容，请先补充引用内容");
    const references = refList.value
      .filter(item => item.value !== undefined && (item.dataType === "STRING" || item.dataType === "IMAGE" || item.dataType === "VIDEO" || item.dataType === "FILE"))
      .map(item => item.dataType === "STRING" ? { dataType: item.dataType, value: item.value } : { dataType: item.dataType, value: { ...item.value } });
    const input = { providerId: choice.providerId, modelId: choice.modelId, prompt: prompt.value.trim(), references };
    const directory = references.some(item => item.dataType !== "STRING") ? (await textFiles.list()).directory : undefined;
    const result = await ai.generate({
      ...input,
      directory,
      runId,
      signal: controller.signal,
      onEvent(event) {
        // ACT: generate 结束/中止后仍可能有迟到回调，run 已关闭的一律忽略。
        if (event.type !== "text" || streamClosed) return;
        streamReceived = true;
        streamBuffer += event.delta;
        scheduleStreamFlush();
      },
    });
    // 中止后保留停止瞬间累计的文本，不用完整结果覆盖；成功但正文为空时同样保留已收到的片段。
    if (!controller.signal.aborted && result.text) { streamBuffer = result.text; streamReceived = true; }
  } catch (error) {
    // 用户主动停止（含服务端先行中止）不弹错。
    if (!stopRequested.value && !controller.signal.aborted && error instanceof Error && error.name !== "AbortError") ElMessage.error(error.message);
  } finally {
    // 节点卸载/切画布等隐式中断不是用户点的停止，需补发通知避免上游请求继续跑。
    if (controller.signal.aborted && !stopRequested.value) void notifyGenerateStop(runId);
    // ACT: 一个 delta 都没收到就失败时不能覆盖原正文，否则会把磁盘内容清空。
    streamClosed = true;
    flushStream();
    // 卸载会取消请求并停止 watcher，生成收尾必须自行保存已收到的正文。
    if (streamReceived) {
      try { await saveText(outputs.value.text.value); }
      catch (error) { ElMessage.error(error instanceof Error ? error.message : "文本保存失败"); }
    }
    generating.value = false;
    stopping.value = false;
    stopRequested.value = false;
    generationController = undefined;
    activeRunId = undefined;
  }
}

function stopGeneration() {
  if (!generating.value || stopping.value) return;
  stopping.value = true;
  stopRequested.value = true;
  generationController?.abort();
  if (activeRunId) void notifyGenerateStop(activeRunId);
}

function handlePromptEsc(event: KeyboardEvent) {
  // ACT: 输入法组词时 Esc 是取消候选，不能当作停止生成。
  if (event.isComposing || !generating.value || event.defaultPrevented) return;
  event.preventDefault();
  event.stopPropagation();
  stopGeneration();
}

function handleWindowKeydown(event: KeyboardEvent) {
  if (event.isComposing || event.key !== "Escape" || !generating.value || !node.selected || event.defaultPrevented) return;
  // ACT: 只在本画布处于前台时响应——后台画布的节点仍保留选中态，不隔离会误停。
  if (!canvasActive.value) return;
  // 只在当前仅选中本节点时兜底；多选不响应，避免一次停掉多个节点。
  const selected = getSelectedNodes.value;
  if (selected.length !== 1 || selected[0]?.id !== node.id) return;
  event.preventDefault();
  stopGeneration();
}
onMounted(() => window.addEventListener("keydown", handleWindowKeydown));
onScopeDispose(() => {
  window.removeEventListener("keydown", handleWindowKeydown);
  if (streamFlushTimer !== undefined) { clearTimeout(streamFlushTimer); streamFlushTimer = undefined; }
  // 卸载时主动 abort 本地 controller，让 finally 能识别隐式中断并补发 stop。
  generationController?.abort();
});
const promptModel = computed({ get: () => data.value.promptModel ?? [], set: (value: PromptModel) => { data.value.promptModel = value; } });

nodeTools.register({
  name: "setText",
  description: "修改此节点的文本输出",
  parameters: z.strictObject({ text: z.string() }),
  async execute({ text }) {
    if (!textReady.value) throw new Error("文本尚未加载");
    if (generating.value) throw new Error("文本生成中，请稍后修改");
    if (outputs.value.text.value === text) await saveText(text);
    else { outputs.value.text.value = text; await textSaving; }
    return { text };
  },
});
</script>

<style lang="scss" scoped>
.textEditor {
  height: min(560px, calc(100dvh - 144px));
  min-height: 0;

  &.fullscreen {
    height: calc(100dvh - 112px);
  }
}

.textContent {
  min-height: 110px;

  &.empty {
    display: flex;
    align-items: center;
    justify-content: center;

    .editButton {
      margin: 0;
    }
  }

  .textPreview {
    min-height: 110px;
    max-height: 240px;
    overflow: auto;
    overflow-wrap: anywhere;
    user-select: none;

    // ACT: 长文只布局可视区附近的段落，滚动时再展开，避免每个条目都参与画布的合成与布局。
    .textNodeMarkdown > * {
      content-visibility: auto;
      contain-intrinsic-size: auto 120px;
    }
  }

  .editButton {
    display: flex;
    margin-left: auto;
  }
}

.promptCard {
  .promptHeader {
    display: flex;
    align-items: flex-start;
    gap: 12px;
  }

  .promptFooter {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;

    .modelSelect {
      width: 190px;
      min-width: 0;

      &:deep(.el-select__wrapper) {
        gap: 6px;
        padding: 0;
        box-shadow: none;
        background: transparent;
      }
    }

    .promptActions {
      display: flex;
      align-items: center;
      gap: 12px;

      .toolButton {
        width: 28px;
        height: 28px;
        padding: 0;
      }

      .generationCount {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        color: var(--el-text-color-secondary);
        font-size: 12px;
      }

      .sendButton {
        width: 32px;
        height: 32px;
        margin: 0;
        padding: 0;
        --el-button-bg-color: var(--el-text-color-primary);
        --el-button-border-color: transparent;
        --el-button-text-color: var(--el-bg-color);
        --el-button-hover-bg-color: var(--el-text-color-regular);
        --el-button-hover-border-color: transparent;
        --el-button-hover-text-color: var(--el-bg-color);
      }
    }
  }
}
</style>
