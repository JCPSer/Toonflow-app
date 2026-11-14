<template>
  <el-dialog
    v-model="visible"
    class="adjustDialog"
    title="调整"
    width="min(760px, calc(100vw - 32px))"
    alignCenter
    appendToBody
    destroyOnClose
    :closeOnClickModal="!applying"
    :closeOnPressEscape="!applying"
    :beforeClose="beforeClose"
    @closed="dispose">
    <div class="adjustBody nodrag nopan nowheel">
      <div class="adjustStage">
        <canvas ref="previewCanvas" class="adjustCanvas" role="img" :aria-label="`颜色调整预览${source ? `，${thumbLabel}` : ''}`" />
        <p class="adjustHint">{{ applying ? "正在导出调整后的图片…" : loading ? "正在准备预览…" : "拖动滑杆实时预览；应用后会替换为调整过的图片" }}</p>
      </div>
      <div class="adjustControls">
        <label v-for="channel in adjustChannels" :key="channel.key" class="adjustRow">
          <span class="adjustLabel">{{ channel.label }}</span>
          <input
            v-model.number="params[channel.key]"
            type="range"
            min="-100"
            max="100"
            step="1"
            :disabled="applying || loading"
            :aria-label="channel.label" />
          <b class="adjustValue">{{ params[channel.key] > 0 ? `+${params[channel.key]}` : params[channel.key] }}</b>
          <span v-if="channel.cold" class="adjustRangeHint">{{ channel.cold }} ↔ {{ channel.warm }}</span>
        </label>
        <div class="adjustActions">
          <el-button :disabled="applying || loading || isDefault" @click="reset">重置</el-button>
          <el-button v-if="previous" :disabled="applying" @click="restorePrevious">恢复调整前</el-button>
        </div>
      </div>
    </div>
    <template #footer>
      <el-button :disabled="applying" @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="applying" :disabled="!canApply" @click="apply">应用</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from "vue";
import { useNode, useVueFlow } from "@vue-flow/core";
import { ElButton, ElDialog } from "element-plus";
import { useNodeFiles, type NodeMediaValue } from "@toonflow/nodes-scaffold/runtime";
import { showNodeError } from "@toonflow/node-shared/showNodeError";
import { adjustChannels, applyAdjustments, defaultAdjustParams, isAdjustDefault, type AdjustParams } from "../imageAdjust";

type AdjustState = {
  previous?: NodeMediaValue;
  appliedUrl?: string;
};

const props = defineProps<{ src: string; source?: NodeMediaValue; active: boolean; disabled?: boolean }>();
const emit = defineEmits<{
  applied: [result: { path: string; mimeType: string; fromUrl: string; formatChanged: boolean; width: number; height: number }];
  restore: [];
}>();

const { node } = useNode();
const { getSelectedNodes, onNodeDragStart, onSelectionStart, onMoveStart } = useVueFlow();
const files = useNodeFiles();

/** 预览用的缩略图长边：太大拖滑杆会掉帧，太小看不出色偏。 */
const PREVIEW_MAX_EDGE = 800;
/** 全尺寸重新编码前的像素上限，与 canvas 的通用限制保持一致。 */
const MAX_PIXELS = 64_000_000;

const visible = ref(false);
const applying = ref(false);
const loading = ref(false);
const previewCanvas = ref<HTMLCanvasElement>();
const params = reactive<AdjustParams>({ ...defaultAdjustParams });
const thumbSize = ref({ width: 0, height: 0 });

const isDefault = computed(() => isAdjustDefault(params));
const thumbLabel = computed(() => thumbSize.value.width ? `${thumbSize.value.width} × ${thumbSize.value.height} 缩略预览` : "");
const canApply = computed(() => !!props.source && !applying.value && !loading.value && !isDefault.value && !props.disabled);

const adjustState = computed<AdjustState>(() => {
  const value = (node.data as { adjust?: unknown }).adjust;
  return value && typeof value === "object" && !Array.isArray(value) ? value as AdjustState : {};
});
// ACT: 只有当前输出仍是上次调整结果时才可恢复；上传/AI 改写后旧记录不再有效。
const previous = computed(() => {
  const value = adjustState.value.previous;
  return value && typeof value.url === "string" && typeof value.mimeType === "string"
    && adjustState.value.appliedUrl === props.source?.url ? value : undefined;
});

let base: ImageData | undefined;
/** 预览复用的帧缓冲：拖滑杆时每帧都新建 ImageData 会产生大量短命对象。 */
let frameBuffer: ImageData | undefined;
let frame = 0;
let prepareToken = 0;
/** 导出中：取消/卸载时中止，避免写盘完成后再覆盖已变化的输出。 */
let controller: AbortController | undefined;
let job: Promise<void> | undefined;

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片加载失败，可能格式不受支持"));
    image.src = src;
  });
}

function renderPreview() {
  const canvas = previewCanvas.value;
  if (!canvas || !base) return;
  const context = canvas.getContext("2d");
  if (!context) return;
  // 每帧从基准像素复制一份再套参数，避免多次调整相互累加；缓冲复用，避免每帧分配。
  if (!frameBuffer || frameBuffer.width !== base.width || frameBuffer.height !== base.height) {
    frameBuffer = new ImageData(new Uint8ClampedArray(base.data.length), base.width, base.height);
  }
  frameBuffer.data.set(base.data);
  applyAdjustments(frameBuffer.data, params);
  context.putImageData(frameBuffer, 0, 0);
}

function scheduleRender() {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    renderPreview();
  });
}

function dispose() {
  if (frame) cancelAnimationFrame(frame);
  frame = 0;
  base = undefined;
  frameBuffer = undefined;
  prepareToken += 1;
  loading.value = false;
}

function beforeClose(done: () => void) {
  // ACT: 导出中不允许关闭——X 与 Esc/遮罩不同，Element Plus 默认会直接关，必须显式拦。
  if (applying.value) return;
  done();
}

async function cancelApply() {
  controller?.abort();
  await job?.catch(() => {});
}

async function prepare() {
  dispose();
  const token = prepareToken;
  base = undefined;
  loading.value = true;
  try {
    const image = await loadImage(props.src);
    if (token !== prepareToken || !visible.value) return;
    const scale = Math.min(1, PREVIEW_MAX_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const offscreen = document.createElement("canvas");
    offscreen.width = width;
    offscreen.height = height;
    const context = offscreen.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("无法创建预览画布");
    context.drawImage(image, 0, 0, width, height);
    base = context.getImageData(0, 0, width, height);
    thumbSize.value = { width, height };
    syncCanvasSize();
    renderPreview();
  } catch (error) {
    if (token === prepareToken && visible.value) showNodeError(error, "预览生成失败");
  } finally {
    if (token === prepareToken) loading.value = false;
  }
}

function syncCanvasSize() {
  const canvas = previewCanvas.value;
  if (!canvas || !base) return;
  canvas.width = base.width;
  canvas.height = base.height;
}

// ACT: el-dialog 是懒渲染的，prepare 结束时 canvas 可能还没挂上；等它出现再定尺寸并补一帧。
watch(previewCanvas, canvas => {
  if (!canvas || !base) return;
  syncCanvasSize();
  renderPreview();
});

// ACT: 滑杆高频输入，用 rAF 合帧；参数全部为 0 时也走同一条路径，保证预览回到原图。
watch(params, scheduleRender, { deep: true });

watch(() => props.src, () => {
  void cancelApply();
  dispose();
  visible.value = false;
  Object.assign(params, defaultAdjustParams);
  thumbSize.value = { width: 0, height: 0 };
}, { flush: "sync" });
watch(() => props.disabled, disabled => { if (disabled && visible.value) visible.value = false; }, { flush: "sync" });
watch(() => props.active, active => { if (!active && visible.value) visible.value = false; });
watch(() => getSelectedNodes.value.length, count => { if (count !== 1 && visible.value) visible.value = false; });
onNodeDragStart(() => { visible.value = false; });
onSelectionStart(() => { visible.value = false; });
onMoveStart(() => { visible.value = false; });

function open() {
  if (props.disabled || !props.src) return;
  Object.assign(params, defaultAdjustParams);
  visible.value = true;
  void nextTick(() => { void prepare(); });
}

function reset() {
  Object.assign(params, defaultAdjustParams);
}

function restorePrevious() {
  if (applying.value) return;
  emit("restore");
  visible.value = false;
}

// ACT: 以 source.mimeType 为准——上传名与内容不符时（.jpg 里其实是 PNG），按扩展名编码会把透明区编成黑块。
function resolveOutputFormat(url: string, mimeType?: string) {
  const outputFormats: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };
  const extension = url.match(/\.([a-zA-Z0-9]{1,10})$/)?.[1]?.toLowerCase() ?? "";
  if (mimeType) {
    const matched = Object.entries(outputFormats).find(([, value]) => value === mimeType);
    if (matched) return { extension: matched[0] === "jpeg" ? "jpg" : matched[0], mimeType, formatChanged: false };
    // 动图（gif/apng/webp 动图）经 canvas 只留首帧，统一落成静态 PNG。
    return { extension: "png", mimeType: "image/png", formatChanged: true };
  }
  const known = outputFormats[extension];
  return known
    ? { extension, mimeType: known, formatChanged: false }
    : { extension: "png", mimeType: "image/png", formatChanged: true };
}

function ignoreExists(error: unknown) {
  if ((error as { response?: { data?: { data?: { code?: string } } } })?.response?.data?.data?.code !== "EEXIST") throw error;
}

function apply() {
  if (!canApply.value || !props.source) return;
  // ACT: 入口快照全部输入。编码/写盘期间输出可能被 MCP 工具或上传替换，await 之后
  // 再读 props 会让 fromUrl 校验失效（父节点拿到的是新 url，校验通过后旧结果覆盖新图）。
  job = runApply({
    src: props.src,
    url: props.source.url,
    mimeType: props.source.mimeType,
    params: { ...params },
  });
}

type ApplySnapshot = { src: string; url: string; mimeType?: string; params: AdjustParams };

async function runApply(snapshot: ApplySnapshot) {
  const { extension, mimeType, formatChanged } = resolveOutputFormat(snapshot.url, snapshot.mimeType);
  const current = controller = new AbortController();
  const signal = current.signal;
  applying.value = true;
  let path = "";
  let committed = false;
  let canvas: HTMLCanvasElement | undefined;
  let workspace: ReturnType<typeof files.getWorkspaceFiles> | undefined;
  try {
    const image = await loadImage(snapshot.src);
    signal.throwIfAborted();
    if (image.naturalWidth * image.naturalHeight > MAX_PIXELS) throw new Error("图片过大（超过 64 MP），请先缩放再调整颜色");
    canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("无法创建画布");
    context.drawImage(image, 0, 0);
    const data = context.getImageData(0, 0, canvas.width, canvas.height);
    applyAdjustments(data.data, snapshot.params);
    context.putImageData(data, 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) => canvas!.toBlob(
      value => value ? resolve(value) : reject(new Error("图片编码失败")),
      mimeType,
      mimeType === "image/png" ? undefined : 0.92,
    ));
    signal.throwIfAborted();
    if (!node.id || /[\\/]/.test(node.id) || node.id === "." || node.id === "..") throw new Error("节点 ID 不能作为文件夹名称");
    workspace = files.getWorkspaceFiles();
    path = `assets/${node.id}/adjust-${canvas.width}x${canvas.height}-${Date.now()}.${extension}`;
    await workspace.mkdir("assets").catch(ignoreExists);
    await workspace.mkdir(`assets/${node.id}`).catch(ignoreExists);
    await workspace.write(path, blob, true);
    signal.throwIfAborted();
    committed = true;
    emit("applied", { path, mimeType, fromUrl: snapshot.url, formatChanged, width: canvas.width, height: canvas.height });
    visible.value = false;
  } catch (error) {
    if (!signal.aborted) showNodeError(error, "颜色调整失败");
  } finally {
    // ACT: 清理用入口拿到的 workspace 实例——期间切项目会让 getWorkspaceFiles() 抛错，
    // 那样会跳过下面的 applying 复位。
    if (!committed && path && workspace) await workspace.remove(path).catch(() => {});
    if (canvas) canvas.width = canvas.height = 0;
    if (controller === current) {
      controller = undefined;
      applying.value = false;
      job = undefined;
    }
  }
}

onBeforeUnmount(() => {
  void cancelApply();
  dispose();
});

defineExpose({ open, visible, applying, cancelApply });
</script>

<style scoped lang="scss">
.adjustBody {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 260px;
  gap: 16px;
  color: var(--el-text-color-primary);
  font-size: 12px;
}

.adjustStage {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.adjustCanvas {
  display: block;
  width: 100%;
  max-height: 52vh;
  object-fit: contain;
  border-radius: 8px;
  background: var(--el-fill-color-light);
}

.adjustHint {
  margin: 0;
  color: var(--el-text-color-secondary);
}

.adjustControls {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.adjustRow {
  display: grid;
  grid-template-columns: 44px 1fr 36px;
  align-items: center;
  gap: 6px;

  input[type="range"] {
    width: 100%;
  }
}

.adjustLabel {
  color: var(--el-text-color-regular);
}

.adjustValue {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.adjustRangeHint {
  grid-column: 2 / 4;
  color: var(--el-text-color-placeholder);
  font-size: 11px;
}

.adjustActions {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}
</style>
