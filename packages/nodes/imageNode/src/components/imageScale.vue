<template>
  <el-popover
    v-model:visible="visible"
    virtualTriggering
    :virtualRef="trigger"
    placement="bottom-start"
    :width="340"
    :persistent="false"
    :showArrow="false"
    :disabled="disabled || !src"
    :popperStyle="{ maxWidth: 'calc(100vw - 24px)', padding: '16px', borderRadius: '12px' }">
    <div class="scalePanel nodrag nopan nowheel" @pointerdown.stop @mousedown.stop @dblclick.stop @keydown.stop @keydown.esc.prevent="closePanel">
      <div class="panelHeader">
        <strong>缩放</strong>
        <span>保持比例</span>
      </div>
      <!-- ACT: 复用节点预览已加载的图片尺寸，避免打开面板时再读一遍工作区文件。 -->
      <img v-if="visible && src" class="sizeProbe" :src="src" alt="" aria-hidden="true" @load="readPreviewSize" @error="readSizeFromFile" />
      <div class="sizeRow">
        <span>原图</span>
        <strong>{{ sourceSize ? `${sourceSize.width} × ${sourceSize.height}` : "—" }}</strong>
      </div>
      <div class="factorRow">
        <label>
          <span>倍率</span>
          <el-input-number v-model="factor" :min="0.05" :max="8" :step="0.05" :precision="2" :disabled="applying" controlsPosition="right" aria-label="缩放倍率" />
        </label>
        <div class="presetRow" role="group" aria-label="倍率快捷选择">
          <button
            v-for="preset in presetFactors"
            :key="preset"
            type="button"
            :class="{ active: Math.abs(factor - preset) < 0.001 }"
            :aria-pressed="Math.abs(factor - preset) < 0.001"
            :disabled="applying"
            @click="factor = preset">{{ Math.round(preset * 100) }}%</button>
        </div>
      </div>
      <div class="paramRow">
        <label>
          <span>长边≤</span>
          <el-input-number v-model="maxEdge" :min="0" :max="8192" :step="64" :precision="0" :disabled="applying" controlsPosition="right" aria-label="长边上限" />
        </label>
        <span class="hint">0 表示不启用</span>
      </div>
      <div class="targetRow">
        <span>目标</span>
        <strong>{{ targetSize ? `${targetSize.width} × ${targetSize.height}` : "—" }}</strong>
        <span v-if="targetPercent" class="percent">({{ targetPercent }}%)</span>
      </div>
      <p v-if="statusMessage" class="status" :class="{ danger: overLimit }" aria-live="polite">{{ statusMessage }}</p>
      <el-button class="applyButton" type="primary" :loading="applying" :disabled="!canApply || disabled" @click="apply">
        {{ applying ? "正在缩放…" : "应用缩放" }}
      </el-button>
      <el-button v-if="previous" class="restoreButton" :disabled="applying || disabled" aria-label="恢复缩放前的图片" @click="emit('restore')">
        恢复缩放前
      </el-button>
    </div>
  </el-popover>
</template>

<script setup lang="ts">
import { computed, inject, onBeforeUnmount, ref, watch } from "vue";
import { useNode, useVueFlow } from "@vue-flow/core";
import { ElButton, ElInputNumber, ElMessage, ElPopover } from "element-plus";
import { useNodeFfmpeg, useNodeFiles, type NodeMediaValue } from "@toonflow/nodes-scaffold/runtime";
import { showNodeError } from "@toonflow/node-shared/showNodeError";

type ImageSize = { width: number; height: number };
type ScalePrevious = NodeMediaValue;
type AppliedResult = { path: string; mimeType: string; fromUrl: string; formatChanged: boolean; width: number; height: number };
type ScaleData = { factor?: number; maxEdge?: number; previous?: ScalePrevious; appliedUrl?: string };

const props = defineProps<{ src: string; source?: NodeMediaValue; active: boolean; disabled?: boolean }>();
const emit = defineEmits<{ applied: [result: AppliedResult]; restore: [] }>();
const { node } = useNode();
const { getSelectedNodes, onNodeDragStart, onSelectionStart, onMoveStart } = useVueFlow();
const files = useNodeFiles();
const loadFfmpeg = useNodeFfmpeg();
const getCanvas = inject<(() => { id: string } | undefined) | undefined>("canvas", undefined);
const visible = ref(false);
const trigger = ref<HTMLElement>();
const applying = ref(false);
const sourceSize = ref<ImageSize>();
const sizeCache = new Map<string, ImageSize>();
// ACT: 只允许 png/jpg/jpeg/webp 原样保留扩展名，其余格式统一回退 PNG（见需求矩阵 R5）。
const outputFormats: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };
const presetFactors = [0.5, 0.75, 1];
const MAX_PIXELS = 64_000_000;

const stored = computed(() => {
  const value = (node.data as { scale?: unknown }).scale;
  return value && typeof value === "object" && !Array.isArray(value) ? value as ScaleData : {};
});
const factor = ref(clampFactor(stored.value.factor));
const maxEdge = ref(clampMaxEdge(stored.value.maxEdge));
const previous = computed(() => {
  const value = stored.value.previous;
  // ACT: 只有当前输出仍是上次缩放结果时才可恢复；上传/AI 改写后旧记录不再有效。
  return value && typeof value.url === "string" && typeof value.mimeType === "string"
    && stored.value.appliedUrl === props.source?.url ? value : undefined;
});
const targetSize = computed(() => sourceSize.value ? computeTarget(sourceSize.value, clampFactor(factor.value), clampMaxEdge(maxEdge.value)) : undefined);
const unchanged = computed(() => !!sourceSize.value && !!targetSize.value
  && targetSize.value.width === sourceSize.value.width && targetSize.value.height === sourceSize.value.height);
// ACT: 尺寸未变时原图即使超过 64 MP 也允许原样跳过，因此先判断 unchanged。
const overLimit = computed(() => !!targetSize.value && !unchanged.value && targetSize.value.width * targetSize.value.height > MAX_PIXELS);
const canApply = computed(() => !!sourceSize.value && !!targetSize.value && !unchanged.value && !overLimit.value);
const targetPercent = computed(() => {
  if (!sourceSize.value || !targetSize.value) return 0;
  return Math.round(targetSize.value.width / sourceSize.value.width * 100);
});
const statusMessage = computed(() => {
  if (!props.src) return "";
  if (!sourceSize.value) return "正在读取图片尺寸…";
  if (overLimit.value) return "目标尺寸超过 64 MP，请降低倍率或设置长边";
  if (unchanged.value) return "尺寸未变化，不会重新编码";
  return "";
});

let controller: AbortController | undefined;
let job: Promise<void> | undefined;
let persistTimer: ReturnType<typeof setTimeout> | undefined;

watch([factor, maxEdge], () => {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(persistParams, 400);
}, { flush: "post" });
watch(() => props.src, () => {
  controller?.abort();
  visible.value = false;
  sourceSize.value = props.source ? sizeCache.get(props.source.url) : undefined;
}, { flush: "sync" });
watch(() => props.disabled, disabled => { if (disabled) visible.value = false; }, { flush: "sync" });
watch(() => props.active, active => { if (!active) visible.value = false; });
watch(() => getSelectedNodes.value.length, count => { if (count !== 1) visible.value = false; });
watch(() => getCanvas?.()?.id, () => { controller?.abort(); visible.value = false; }, { flush: "sync" });
onNodeDragStart(() => { visible.value = false; });
onSelectionStart(() => { visible.value = false; });
onMoveStart(() => { visible.value = false; });
onBeforeUnmount(() => {
  controller?.abort();
  clearTimeout(persistTimer);
});

defineExpose({ open, applying, visible, cancel });

function open(event: MouseEvent) {
  if (props.disabled || !props.src) return;
  trigger.value = event.currentTarget as HTMLElement;
  visible.value = !visible.value;
  if (visible.value && props.source) sourceSize.value = sizeCache.get(props.source.url) ?? sourceSize.value;
}

function closePanel() {
  visible.value = false;
  trigger.value?.focus();
}

function clampFactor(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(8, Math.max(0.05, number)) : 1;
}

function clampMaxEdge(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.min(8192, Math.round(number)) : 0;
}

function roundSize(width: number, height: number): ImageSize {
  return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
}

function computeTarget(size: ImageSize, scale: number, limit: number): ImageSize {
  let target = roundSize(size.width * scale, size.height * scale);
  if (limit > 0) {
    const longest = Math.max(target.width, target.height);
    if (longest > limit) {
      const ratio = limit / longest;
      target = roundSize(target.width * ratio, target.height * ratio);
    }
  }
  return target;
}

function resolveOutputFormat(url: string) {
  const extension = url.match(/\.([a-zA-Z0-9]{1,10})$/)?.[1]?.toLowerCase() ?? "";
  const mimeType = outputFormats[extension];
  return mimeType
    ? { extension, mimeType, formatChanged: false }
    : { extension: "png", mimeType: "image/png", formatChanged: true };
}

function persistParams() {
  clearTimeout(persistTimer);
  const data = node.data as { scale?: ScaleData };
  data.scale = { ...data.scale, factor: clampFactor(factor.value), maxEdge: clampMaxEdge(maxEdge.value) };
}

function readPreviewSize(event: Event) {
  const image = event.currentTarget as HTMLImageElement;
  if (!image.naturalWidth || !image.naturalHeight) return;
  const size = { width: image.naturalWidth, height: image.naturalHeight };
  sourceSize.value = size;
  if (props.source) sizeCache.set(props.source.url, size);
}

async function readSizeFromFile() {
  const source = props.source;
  if (!source || sourceSize.value) return;
  try {
    const content = await files.getWorkspaceFiles().read(source.url);
    const objectUrl = URL.createObjectURL(new Blob([content], { type: source.mimeType }));
    let size: ImageSize;
    try {
      const image = new Image();
      image.src = objectUrl;
      await image.decode();
      size = { width: image.naturalWidth, height: image.naturalHeight };
      // ACT: 浏览器解不了的格式（如 TIFF）交给宿主 ffprobe，否则这类图片永远无法缩放。
      if (!size.width || !size.height) size = await probeSize(source.url);
    } catch {
      size = await probeSize(source.url);
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
    if (props.source?.url !== source.url) return;
    sourceSize.value = size;
    sizeCache.set(source.url, size);
  } catch (error) {
    if (props.source?.url === source.url) showNodeError(error, "图片尺寸读取失败");
  }
}

async function probeSize(path: string): Promise<ImageSize> {
  const factory = await loadFfmpeg();
  const media = await new Promise<{ streams: { codec_type?: string; width?: number; height?: number }[] }>((resolve, reject) => {
    factory(path).ffprobe((error, data) => error ? reject(error) : resolve(data));
  });
  const stream = media.streams.find(item => item.codec_type === "video" && item.width && item.height);
  if (!stream?.width || !stream?.height) throw new Error("无法读取图片尺寸");
  return { width: stream.width, height: stream.height };
}

function ignoreExists(error: unknown) {
  if ((error as { response?: { data?: { data?: { code?: string } } } })?.response?.data?.data?.code !== "EEXIST") throw error;
}

function ignoreMissing(error: unknown) {
  if ((error as { response?: { data?: { data?: { code?: string } } } })?.response?.data?.data?.code === "ENOENT") return;
  ElMessage.error("临时图片清理失败");
}

function apply() {
  if (applying.value || props.disabled || !props.source || !sourceSize.value || !targetSize.value || !canApply.value) return;
  job = runApply(props.source.url);
}

async function runApply(startUrl: string) {
  const size = targetSize.value!;
  const { extension, mimeType, formatChanged } = resolveOutputFormat(startUrl);
  const current = controller = new AbortController();
  const signal = current.signal;
  applying.value = true;
  let workspace: ReturnType<typeof files.getWorkspaceFiles> | undefined;
  let path = "";
  let committed = false;
  try {
    persistParams();
    workspace = files.getWorkspaceFiles();
    path = `assets/${node.id}/resize-${size.width}x${size.height}-${Date.now()}.${extension}`;
    await workspace.mkdir("assets").catch(ignoreExists);
    await workspace.mkdir(`assets/${node.id}`).catch(ignoreExists);
    signal.throwIfAborted();
    const factory = await loadFfmpeg(signal);
    signal.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      const command = factory(startUrl)
        .videoFilters(`scale=${size.width}:${size.height}:flags=lanczos`)
        .outputOptions("-frames:v", "1", "-update", "1")
        .on("error", error => reject(error))
        .on("end", () => resolve());
      signal.addEventListener("abort", () => command.kill(), { once: true });
      command.save(path);
    });
    signal.throwIfAborted();
    committed = true;
    emit("applied", { path, mimeType, fromUrl: startUrl, formatChanged, width: size.width, height: size.height });
  } catch (error) {
    if (!signal.aborted) showNodeError(error, "图片缩放失败");
  } finally {
    if (!committed && workspace && path) await workspace.remove(path).catch(ignoreMissing);
    if (controller === current) {
      controller = undefined;
      applying.value = false;
      job = undefined;
    }
  }
}

async function cancel() {
  controller?.abort();
  await job?.catch(() => {});
}
</script>

<style scoped lang="scss">
.scalePanel {
  position: relative;
  color: var(--el-text-color-primary);
  font-size: 12px;

  .panelHeader {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 14px;

    span { color: var(--el-text-color-secondary); font-size: 12px; }
  }

  .sizeProbe {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
    pointer-events: none;
  }

  .sizeRow,
  .targetRow {
    display: flex;
    align-items: baseline;
    gap: 8px;
    color: var(--el-text-color-secondary);
    font-variant-numeric: tabular-nums;

    strong { color: var(--el-text-color-primary); font-size: 13px; }
  }

  .factorRow {
    display: flex;
    align-items: flex-end;
    gap: 10px;
    margin-top: 12px;

    label {
      display: flex;
      flex-direction: column;
      gap: 6px;
      width: 118px;
      flex: none;

      span { color: var(--el-text-color-regular); }
    }

    .el-input-number { width: 100%; }

    .presetRow {
      display: flex;
      flex: 1;
      gap: 4px;

      button {
        flex: 1;
        padding: 6px 0;
        border: 1px solid var(--el-border-color-lighter);
        border-radius: 6px;
        background: var(--el-fill-color-light);
        color: var(--el-text-color-regular);
        font: inherit;
        cursor: pointer;

        &.active, &:hover { border-color: var(--el-color-primary); color: var(--el-color-primary); background: var(--el-color-primary-light-9); }
        &:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 2px; }
        &:disabled { cursor: wait; opacity: 0.65; }
      }
    }
  }

  .paramRow {
    display: flex;
    align-items: flex-end;
    gap: 10px;
    margin-top: 12px;

    label {
      display: flex;
      flex-direction: column;
      gap: 6px;
      width: 118px;
      flex: none;

      span { color: var(--el-text-color-regular); }
    }

    .el-input-number { width: 100%; }
    .hint { line-height: 32px; color: var(--el-text-color-secondary); }
  }

  .targetRow {
    margin-top: 14px;
    padding-top: 12px;
    border-top: 1px solid var(--el-border-color-lighter);

    .percent { color: var(--el-text-color-secondary); }
  }

  .status {
    min-height: 18px;
    margin: 6px 0 10px;
    color: var(--el-text-color-secondary);
    line-height: 18px;

    &.danger { color: var(--el-color-danger); }
  }

  .applyButton,
  .restoreButton { width: 100%; }

  .restoreButton { margin: 8px 0 0; }
}
</style>
