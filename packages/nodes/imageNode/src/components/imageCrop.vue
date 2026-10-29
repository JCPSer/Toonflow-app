<template>
  <!-- ACT: 裁剪是几何精度操作，节点卡片 240px 的预览拖不准，所以用独立弹窗承载大图交互。 -->
  <el-dialog
    v-model="visible"
    class="cropDialog"
    title="裁剪"
    width="min(920px, calc(100vw - 32px))"
    alignCenter
    appendToBody
    destroyOnClose
    :closeOnClickModal="!applying"
    :closeOnPressEscape="!applying"
    :beforeClose="beforeClose"
    @closed="persistLast">
    <div class="cropBody nodrag nopan nowheel">
      <div class="cropPresets" role="group" aria-label="裁剪比例">
        <button
          v-for="preset in presets"
          :key="preset.key"
          type="button"
          :class="{ active: ratioKey === preset.key }"
          :aria-pressed="ratioKey === preset.key"
          :disabled="applying"
          @click="choosePreset(preset)">
          {{ preset.label }}
        </button>
        <button
          type="button"
          class="flipButton"
          :class="{ active: flipped }"
          :aria-pressed="flipped"
          :disabled="applying || !naturalSize"
          title="左右镜像"
          aria-label="左右镜像"
          @click="flipped = !flipped">
          <icon-flip-horizontal :size="14" aria-hidden="true" />
          翻转
        </button>
        <span class="sourceSize">{{ naturalSize ? `${naturalSize.width} × ${naturalSize.height}` : "读取中…" }}</span>
      </div>
      <div class="cropStage">
        <div
          ref="stage"
          class="cropStageInner"
          tabindex="0"
          :aria-label="naturalSize ? `裁剪画布，原图 ${naturalSize.width} × ${naturalSize.height}` : '裁剪画布'"
          @pointerdown="startPointer"
          @keydown="onKeydown"
          @dblclick.stop>
          <div ref="frame" class="cropFrame">
            <img ref="imageElement" :src="src" :class="{ mirrored: flipped }" alt="待裁剪图片" draggable="false" @load="onLoad" @error="onError" />
            <template v-if="rect && naturalSize">
              <i class="cropMask top" :style="maskStyle.top" aria-hidden="true" />
              <i class="cropMask bottom" :style="maskStyle.bottom" aria-hidden="true" />
              <i class="cropMask left" :style="maskStyle.left" aria-hidden="true" />
              <i class="cropMask right" :style="maskStyle.right" aria-hidden="true" />
              <div class="cropBox" :style="boxStyle">
                <i class="cropGrid v1" aria-hidden="true" /><i class="cropGrid v2" aria-hidden="true" />
                <i class="cropGrid h1" aria-hidden="true" /><i class="cropGrid h2" aria-hidden="true" />
                <span
                  v-for="handle in handles"
                  :key="handle"
                  :class="['cropHandle', handle]"
                  :aria-label="`调整裁剪框 ${handle}`"
                  role="presentation"
                  @pointerdown.stop="startResize(handle, $event)" />
              </div>
            </template>
          </div>
        </div>
      </div>
      <div class="cropFields">
        <label><span>X</span><el-input-number v-model="fields.x" :min="0" :max="Math.max(1, naturalSize?.width ?? 1)" :precision="0" :disabled="applying || !rect" controlsPosition="right" aria-label="裁剪框左边距" @change="applyFields" /></label>
        <label><span>Y</span><el-input-number v-model="fields.y" :min="0" :max="Math.max(1, naturalSize?.height ?? 1)" :precision="0" :disabled="applying || !rect" controlsPosition="right" aria-label="裁剪框上边距" @change="applyFields" /></label>
        <label><span>宽</span><el-input-number v-model="fields.width" :min="1" :max="Math.max(1, naturalSize?.width ?? 1)" :precision="0" :disabled="applying || !rect" controlsPosition="right" aria-label="裁剪宽度" @change="applyFields" /></label>
        <label><span>高</span><el-input-number v-model="fields.height" :min="1" :max="Math.max(1, naturalSize?.height ?? 1)" :precision="0" :disabled="applying || !rect" controlsPosition="right" aria-label="裁剪高度" @change="applyFields" /></label>
      </div>
      <p class="cropStatus" :class="{ danger: overLimit }" aria-live="polite">{{ statusMessage }}</p>
    </div>
    <template #footer>
      <div class="cropFooter">
        <el-button v-if="previous" :disabled="applying" @click="restorePrevious">恢复裁剪前</el-button>
        <span class="spacer" />
        <el-button :disabled="applying" @click="close">取消</el-button>
        <el-button type="primary" :loading="applying" :disabled="!canApply" @click="apply">{{ applyLabel }}</el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, reactive, ref, watch } from "vue";
import { useNode, useVueFlow } from "@vue-flow/core";
import { ElButton, ElDialog, ElInputNumber } from "element-plus";
import { IconFlipHorizontal } from "@tabler/icons-vue";
import { useNodeFiles, type NodeMediaValue } from "@toonflow/nodes-scaffold/runtime";
import { showNodeError } from "@toonflow/node-shared/showNodeError";

type Rect = { x: number; y: number; width: number; height: number };
type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
type CropState = {
  last?: Rect & { url: string; flipped?: boolean };
  previous?: NodeMediaValue;
  appliedUrl?: string;
};
type Gesture =
  | { kind: "create"; anchor: Point; origin: Point; armed: boolean }
  | { kind: "move"; start: Point; from: Rect }
  | { kind: "resize"; handle: Handle; start: Point; from: Rect; alt: boolean };
type Point = { x: number; y: number };

const props = defineProps<{ src: string; source?: NodeMediaValue; active: boolean; disabled?: boolean }>();
const emit = defineEmits<{
  applied: [result: { path: string; mimeType: string; fromUrl: string; formatChanged: boolean; width: number; height: number; rect: Rect; flipped: boolean; cropped: boolean }];
  restore: [];
}>();
const { node } = useNode();
const { getSelectedNodes, onNodeDragStart, onSelectionStart, onMoveStart } = useVueFlow();
const files = useNodeFiles();
const getCanvas = inject<(() => { id: string } | undefined) | undefined>("canvas", undefined);

const handles: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
// ACT: 只允许 png/jpg/jpeg/webp 原样保留扩展名，其余格式统一回退 PNG（与缩放保持一致）。
const outputFormats: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };
const presets = [
  { key: "free", label: "自由" },
  { key: "source", label: "原图" },
  { key: "1:1", label: "1:1", ratio: 1 },
  { key: "4:3", label: "4:3", ratio: 4 / 3 },
  { key: "3:4", label: "3:4", ratio: 3 / 4 },
  { key: "16:9", label: "16:9", ratio: 16 / 9 },
  { key: "9:16", label: "9:16", ratio: 9 / 16 },
] as const;
const MAX_PIXELS = 64_000_000;

const visible = ref(false);
const applying = ref(false);
const stage = ref<HTMLElement>();
const frame = ref<HTMLElement>();
const imageElement = ref<HTMLImageElement>();
const naturalSize = ref<{ width: number; height: number }>();
const loadFailed = ref(false);
const rect = ref<Rect>();
const flipped = ref(false);
const rectSource = ref("");
const ratioKey = ref<string>("free");
const fields = reactive({ x: 0, y: 0, width: 0, height: 0 });
const sizeCache = new Map<string, { width: number; height: number }>();
let gesture: Gesture | undefined;
let gestureAbort: AbortController | undefined;
let controller: AbortController | undefined;
let job: Promise<void> | undefined;
let persistTimer: ReturnType<typeof setTimeout> | undefined;

const cropState = computed<CropState>(() => {
  const value = (node.data as { crop?: unknown }).crop;
  return value && typeof value === "object" && !Array.isArray(value) ? value as CropState : {};
});
// ACT: 只有当前输出仍是上次裁剪结果时才可恢复；上传/AI 改写后旧记录不再有效。
const previous = computed(() => {
  const value = cropState.value.previous;
  return value && typeof value.url === "string" && typeof value.mimeType === "string"
    && cropState.value.appliedUrl === props.source?.url ? value : undefined;
});
const ratioValue = computed(() => {
  const preset = presets.find(item => item.key === ratioKey.value);
  if (preset && "ratio" in preset) return preset.ratio as number;
  if (ratioKey.value === "source" && naturalSize.value) return naturalSize.value.width / naturalSize.value.height;
  return undefined;
});
const unchanged = computed(() => !!rect.value && !!naturalSize.value
  && rect.value.width === naturalSize.value.width && rect.value.height === naturalSize.value.height);
const overLimit = computed(() => !!rect.value && rect.value.width * rect.value.height > MAX_PIXELS);
// ACT: 整图 + 已翻转也算有效操作——弹窗要能当"翻转工具"用，否则只想翻一下也得先随便框一块。
const canApply = computed(() => !!props.source && !!rect.value && !!naturalSize.value && (!unchanged.value || flipped.value) && !overLimit.value && !applying.value && !props.disabled);
const applyLabel = computed(() => {
  if (applying.value) return "正在编码…";
  return unchanged.value ? "应用翻转" : "应用裁剪";
});
const statusMessage = computed(() => {
  if (!props.src) return "";
  if (loadFailed.value) return "该图片格式无法在浏览器内解码，请先转为 PNG/JPEG 再裁剪";
  if (!naturalSize.value) return "正在读取图片尺寸…";
  if (!rect.value) return "在图片上拖拽以选择裁剪区域";
  if (overLimit.value) return "裁剪区域超过 64 MP，请缩小范围";
  if (unchanged.value) return flipped.value ? "整图镜像，应用后替换为左右翻转的图片" : "当前是整图，拖拽框选要保留的区域";
  return `${rect.value.width} × ${rect.value.height}，已选原图的 ${percentage()}%`;
});

// ACT: 百分比必须夹紧并定点化——浮点残差会产出 `7.1e-15%` / `100.00000000000001%` 这类非法 CSS，
// 浏览器会整条丢弃并保留上一帧的值，遮罩与裁剪框就会错位。
function pct(value: number) {
  return `${Math.min(100, Math.max(0, Math.round(value * 1000) / 1000))}%`;
}

const boxStyle = computed(() => {
  const size = naturalSize.value;
  const value = rect.value;
  if (!size || !value) return {};
  return {
    left: pct(value.x / size.width * 100),
    top: pct(value.y / size.height * 100),
    width: pct(value.width / size.width * 100),
    height: pct(value.height / size.height * 100),
  };
});
// ACT: 用四块遮罩而不是 box-shadow——阴影会在图片边缘被裁掉，且手柄会跟着一起被裁。
const maskStyle = computed(() => {
  const size = naturalSize.value;
  const value = rect.value;
  if (!size || !value) return { top: {}, bottom: {}, left: {}, right: {} };
  const top = value.y / size.height * 100;
  const bottom = 100 - top - value.height / size.height * 100;
  const left = value.x / size.width * 100;
  const right = 100 - left - value.width / size.width * 100;
  return {
    top: { left: "0%", top: "0%", width: "100%", height: pct(top) },
    bottom: { left: "0%", top: pct(100 - bottom), width: "100%", height: pct(bottom) },
    left: { left: "0%", top: pct(top), width: pct(left), height: pct(value.height / size.height * 100) },
    right: { left: pct(100 - right), top: pct(top), width: pct(right), height: pct(value.height / size.height * 100) },
  };
});

watch(() => props.src, () => {
  cancel();
  visible.value = false;
  rect.value = undefined;
  rectSource.value = "";
  flipped.value = false;
  ratioKey.value = "free";
  naturalSize.value = props.source ? sizeCache.get(props.source.url) : undefined;
}, { flush: "sync" });
watch(() => props.disabled, disabled => { if (disabled) close(); }, { flush: "sync" });
watch(() => props.active, active => { if (!active) close(); });
watch(() => getSelectedNodes.value.length, count => { if (count !== 1) close(); });
watch(() => getCanvas?.()?.id, () => { cancel(); visible.value = false; }, { flush: "sync" });
watch(visible, open => { if (!open) cancelGesture(); });
onNodeDragStart(() => close());
onSelectionStart(() => close());
onMoveStart(() => close());
onBeforeUnmount(() => {
  cancel();
  cancelGesture();
  clearTimeout(persistTimer);
});

defineExpose({ open, applying, visible, cancel, cancelApply });

function open() {
  if (props.disabled || !props.src) return;
  visible.value = true;
  // ACT: 弹窗内图片每次打开都要重新加载，尺寸先取缓存，避免闪一帧空框。
  naturalSize.value = props.source ? sizeCache.get(props.source.url) : naturalSize.value;
  void nextTick(() => stage.value?.focus({ preventScroll: true }));
}

function close() {
  if (!visible.value) return;
  persistLast();
  visible.value = false;
}

function beforeClose(done: () => void) {
  if (applying.value) return;
  done();
}

function cancelGesture() {
  gesture = undefined;
  gestureAbort?.abort();
  gestureAbort = undefined;
}

function cancel() {
  controller?.abort();
  cancelGesture();
  void job?.catch(() => {});
}

async function restorePrevious() {
  if (applying.value) return;
  emit("restore");
  close();
}

function onLoad(event: Event) {
  const image = event.currentTarget as HTMLImageElement;
  if (!image.naturalWidth || !image.naturalHeight) return;
  loadFailed.value = false;
  const size = { width: image.naturalWidth, height: image.naturalHeight };
  naturalSize.value = size;
  if (props.source) sizeCache.set(props.source.url, size);
  if (!rect.value || rectSource.value !== props.source?.url) {
    rectSource.value = props.source?.url ?? "";
    const last = cropState.value.last;
    // ACT: 上次没应用就关掉的框按源 url 关联，源图换了就自动回到整图。
    flipped.value = !!last && last.url === props.source?.url && last.flipped === true;
    rect.value = last && last.url === props.source?.url && last.width > 0 && last.height > 0
      ? clampRect({ x: last.x, y: last.y, width: last.width, height: last.height }, nextRatio())
      : { x: 0, y: 0, width: size.width, height: size.height };
    syncFields();
  }
}

function onError() {
  loadFailed.value = true;
  naturalSize.value = undefined;
  rect.value = undefined;
}

function syncFields() {
  const value = rect.value;
  if (!value) return;
  fields.x = value.x;
  fields.y = value.y;
  fields.width = value.width;
  fields.height = value.height;
}

function percentage() {
  const size = naturalSize.value;
  const value = rect.value;
  if (!size || !value) return 100;
  return Math.max(1, Math.round(value.width * value.height / (size.width * size.height) * 100));
}

function nextRatio() {
  return ratioValue.value;
}

function clampPoint(x: number, y: number): Point {
  const size = naturalSize.value ?? { width: 1, height: 1 };
  return {
    x: Math.max(0, Math.min(size.width, Math.round(x))),
    y: Math.max(0, Math.min(size.height, Math.round(y))),
  };
}

function toImagePoint(event: PointerEvent): Point {
  const image = imageElement.value;
  if (!image) return clampPoint(0, 0);
  const bounds = image.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return clampPoint(0, 0);
  const size = naturalSize.value ?? { width: 1, height: 1 };
  return clampPoint(
    (event.clientX - bounds.left) / bounds.width * size.width,
    (event.clientY - bounds.top) / bounds.height * size.height,
  );
}

/** 夹紧到图片内，并按比例修正（比例优先于自由尺寸）。 */
function clampRect(value: Rect, ratio?: number): Rect {
  const size = naturalSize.value ?? { width: 1, height: 1 };
  let width = Math.max(1, Math.min(size.width, Math.round(value.width)));
  let height = Math.max(1, Math.min(size.height, Math.round(value.height)));
  if (ratio) {
    if (width / height > ratio) width = height * ratio;
    else height = width / ratio;
    if (width > size.width) { width = size.width; height = width / ratio; }
    if (height > size.height) { height = size.height; width = height * ratio; }
  }
  width = Math.max(1, Math.min(size.width, Math.round(width)));
  height = Math.max(1, Math.min(size.height, Math.round(height)));
  return {
    x: Math.max(0, Math.min(size.width - width, Math.round(value.x))),
    y: Math.max(0, Math.min(size.height - height, Math.round(value.y))),
    width,
    height,
  };
}

function choosePreset(preset: typeof presets[number]) {
  if (applying.value) return;
  ratioKey.value = preset.key;
  const size = naturalSize.value;
  const value = rect.value;
  const ratio = nextRatio();
  if (!ratio || !size || !value) return;
  // ACT: 切比例时以当前框中心为锚取内接最大框，避免框突然贴边或越界。
  const centerX = value.x + value.width / 2;
  const centerY = value.y + value.height / 2;
  const fitted = clampRect({ x: value.x, y: value.y, width: value.width, height: value.height }, ratio);
  rect.value = clampRect({ x: centerX - fitted.width / 2, y: centerY - fitted.height / 2, width: fitted.width, height: fitted.height }, ratio);
  syncFields();
}

function applyFields() {
  if (applying.value || !naturalSize.value) return;
  const size = naturalSize.value;
  const current = rect.value ?? { x: 0, y: 0, width: size.width, height: size.height };
  const ratio = nextRatio();
  let next: Rect = {
    x: Math.max(0, Math.min(size.width - 1, Math.round(fields.x))),
    y: Math.max(0, Math.min(size.height - 1, Math.round(fields.y))),
    width: Math.max(1, Math.min(size.width, Math.round(fields.width))),
    height: Math.max(1, Math.min(size.height, Math.round(fields.height))),
  };
  // ACT: 比例锁定时，改哪一个数字就以它为准推出另一维，否则勾了 1:1 还能填出 800×600。
  if (ratio) {
    if (next.width !== current.width) next.height = next.width / ratio;
    else if (next.height !== current.height) next.width = next.height * ratio;
  }
  // ACT: 用户明确输入的 X/Y 优先保留——溢出时收缩宽高，而不是把输入的坐标改回 0。
  if (next.x + next.width > size.width) next.width = Math.max(1, size.width - next.x);
  if (next.y + next.height > size.height) next.height = Math.max(1, size.height - next.y);
  if (ratio && next.width / next.height > ratio) next.height = Math.min(size.height - next.y, next.width / ratio);
  else if (ratio) next.width = Math.min(size.width - next.x, next.height * ratio);
  rect.value = clampRect(next, ratio);
  syncFields();
}

function startPointer(event: PointerEvent) {
  if (applying.value || props.disabled || !naturalSize.value || !imageElement.value) return;
  if (event.button !== 0) return;
  stage.value?.focus({ preventScroll: true });
  const point = toImagePoint(event);
  const value = rect.value;
  // ACT: 整图时"框内拖拽"没有移动空间，必须按新建处理，否则首次打开根本拖不出选区。
  const inside = !!value && !unchanged.value
    && point.x >= value.x && point.x <= value.x + value.width
    && point.y >= value.y && point.y <= value.y + value.height;
  gesture = inside
    ? { kind: "move", start: point, from: { ...value! } }
    : { kind: "create", anchor: point, origin: point, armed: false };
  listen();
}

function startResize(handle: Handle, event: PointerEvent) {
  if (applying.value || props.disabled || event.button !== 0 || !rect.value) return;
  gesture = { kind: "resize", handle, start: toImagePoint(event), from: { ...rect.value }, alt: event.altKey };
  listen();
}

function listen() {
  // ACT: 只换监听器，不能把刚建立的手势一起清掉。
  gestureAbort?.abort();
  const abort = gestureAbort = new AbortController();
  window.addEventListener("pointermove", onPointerMove, { passive: false, signal: abort.signal });
  window.addEventListener("pointerup", endGesture, { signal: abort.signal });
  window.addEventListener("pointercancel", endGesture, { signal: abort.signal });
}

function onPointerMove(event: PointerEvent) {
  if (!gesture) return;
  // ACT: 指针在窗口外释放时收不到 pointerup，用 buttons 归零兜底，避免松手后继续拖。
  if (event.buttons === 0) return endGesture();
  event.preventDefault();
  const point = toImagePoint(event);
  if (gesture.kind === "create") {
    // ACT: 单击（位移 < 3px）不重建选区，否则点一下遮罩就把已调好的框重置成 1×1。
    if (!gesture.armed) {
      if (Math.hypot(point.x - gesture.origin.x, point.y - gesture.origin.y) * (imageElement.value ? imageElement.value.clientWidth / (naturalSize.value?.width || 1) : 1) < 3) return;
      gesture.armed = true;
    }
  }
  rect.value = gesture.kind === "create" ? fromCreate(gesture, point)
    : gesture.kind === "move" ? fromMove(gesture, point)
    : fromResize(gesture, point);
  syncFields();
}

function limitOf(anchor: number, size: number, dir: number) {
  if (dir > 0) return size - anchor;
  if (dir < 0) return anchor;
  return 2 * Math.min(anchor, size - anchor);
}

function fromCreate(current: Extract<Gesture, { kind: "create" }>, point: Point): Rect {
  const size = naturalSize.value ?? { width: 1, height: 1 };
  const ratio = nextRatio();
  const dirX = point.x < current.anchor.x ? -1 : 1;
  const dirY = point.y < current.anchor.y ? -1 : 1;
  const limitW = limitOf(current.anchor.x, size.width, dirX);
  const limitH = limitOf(current.anchor.y, size.height, dirY);
  let width = Math.min(limitW, Math.abs(point.x - current.anchor.x));
  let height = Math.min(limitH, Math.abs(point.y - current.anchor.y));
  if (ratio) {
    // ACT: 比例锁时先按主导轴推出另一维，再按锚点侧的可用空间回夹，保证锚点不漂。
    if (width / Math.max(1, height) > ratio) height = width / ratio;
    else width = height * ratio;
    if (height > limitH) { height = limitH; width = height * ratio; }
    if (width > limitW) { width = limitW; height = width / ratio; }
  }
  width = Math.max(1, width);
  height = Math.max(1, height);
  // ACT: 反方向拖拽时锚点变成右下角，x/y 跟着翻转，否则框会跑到反方向。
  return clampRect({
    x: dirX > 0 ? current.anchor.x : current.anchor.x - width,
    y: dirY > 0 ? current.anchor.y : current.anchor.y - height,
    width,
    height,
  }, ratio);
}

function fromMove(current: Extract<Gesture, { kind: "move" }>, point: Point): Rect {
  const size = naturalSize.value ?? { width: 1, height: 1 };
  return {
    x: Math.max(0, Math.min(size.width - current.from.width, current.from.x + point.x - current.start.x)),
    y: Math.max(0, Math.min(size.height - current.from.height, current.from.y + point.y - current.start.y)),
    width: current.from.width,
    height: current.from.height,
  };
}

function fromResize(current: Extract<Gesture, { kind: "resize" }>, point: Point): Rect {
  const size = naturalSize.value ?? { width: 1, height: 1 };
  const ratio = nextRatio();
  const { from, handle } = current;
  const west = handle.includes("w");
  const east = handle.includes("e");
  const north = handle.includes("n");
  const south = handle.includes("s");
  const dirX = east ? 1 : west ? -1 : 0;
  const dirY = south ? 1 : north ? -1 : 0;
  const centerX = from.x + from.width / 2;
  const centerY = from.y + from.height / 2;

  if (current.alt && dirX !== 0 && dirY !== 0) {
    // ACT: Alt + 角手柄以框中心为锚对称缩放；尺寸按"指针到中心"的距离算，夹到中心两侧的可用空间。
    const limitW = limitOf(centerX, size.width, 0);
    const limitH = limitOf(centerY, size.height, 0);
    let width = Math.min(limitW, 2 * Math.abs(point.x - centerX));
    let height = Math.min(limitH, 2 * Math.abs(point.y - centerY));
    if (ratio) {
      if (width / Math.max(1, height) > ratio) height = width / ratio;
      else width = height * ratio;
      if (height > limitH) { height = limitH; width = height * ratio; }
      if (width > limitW) { width = limitW; height = width / ratio; }
    }
    width = Math.max(1, width);
    height = Math.max(1, height);
    return clampRect({ x: centerX - width / 2, y: centerY - height / 2, width, height }, ratio);
  }

  // ACT: 拖哪条边，对边固定——所有尺寸都先按锚点侧可用空间夹紧，再摆位置，锚点不会漂。
  const anchorX = dirX > 0 ? from.x : dirX < 0 ? from.x + from.width : centerX;
  const anchorY = dirY > 0 ? from.y : dirY < 0 ? from.y + from.height : centerY;
  const limitW = limitOf(anchorX, size.width, dirX);
  const limitH = limitOf(anchorY, size.height, dirY);
  let width = dirX === 0 ? from.width : Math.min(limitW, Math.abs(point.x - anchorX));
  let height = dirY === 0 ? from.height : Math.min(limitH, Math.abs(point.y - anchorY));

  if (ratio) {
    if (dirX !== 0 && dirY !== 0) {
      if (width / Math.max(1, height) > ratio) height = width / ratio;
      else width = height * ratio;
    } else if (dirX !== 0) {
      height = width / ratio;
    } else {
      width = height * ratio;
    }
    if (height > limitH) { height = limitH; width = height * ratio; }
    if (width > limitW) { width = limitW; height = width / ratio; }
  }
  width = Math.max(1, width);
  height = Math.max(1, height);

  return clampRect({
    x: dirX > 0 ? anchorX : dirX < 0 ? anchorX - width : anchorX - width / 2,
    y: dirY > 0 ? anchorY : dirY < 0 ? anchorY - height : anchorY - height / 2,
    width,
    height,
  }, ratio);
}

function endGesture() {
  gesture = undefined;
  gestureAbort?.abort();
  gestureAbort = undefined;
}

function onKeydown(event: KeyboardEvent) {
  if (!rect.value || applying.value) return;
  const step = event.shiftKey ? 10 : 1;
  const map: Record<string, [number, number]> = {
    ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step],
  };
  const delta = map[event.key];
  if (!delta) return;
  event.preventDefault();
  const size = naturalSize.value ?? { width: 1, height: 1 };
  rect.value = {
    ...rect.value,
    x: Math.max(0, Math.min(size.width - rect.value.width, rect.value.x + delta[0])),
    y: Math.max(0, Math.min(size.height - rect.value.height, rect.value.y + delta[1])),
  };
  syncFields();
}

// ACT: last 只在关闭弹窗时落一次。拖拽过程中每帧写 node.data 会持续触发画布自动保存。
function persistLast() {
  clearTimeout(persistTimer);
  persistTimer = undefined;
  const value = rect.value;
  if (!value || !props.source || rectSource.value !== props.source.url) return;
  const data = node.data as { crop?: CropState };
  data.crop = { ...data.crop, last: { url: props.source.url, ...value, flipped: flipped.value } };
}

// ACT: 以 source.mimeType 为准——上传名与内容不符时（.jpg 里其实是 PNG），按扩展名编码会把透明区编成黑块。
function resolveOutputFormat(url: string, mimeType?: string) {
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

function ignoreMissing(error: unknown) {
  if ((error as { response?: { data?: { data?: { code?: string } } } })?.response?.data?.data?.code === "ENOENT") return;
  showNodeError(error, "裁剪临时文件清理失败");
}

function apply() {
  if (!canApply.value || !props.source || !rect.value) return;
  job = runApply(props.source.url, { ...rect.value });
}

async function runApply(startUrl: string, area: Rect) {
  const { extension, mimeType, formatChanged } = resolveOutputFormat(startUrl, props.source?.mimeType);
  const mirror = flipped.value;
  const current = controller = new AbortController();
  const signal = current.signal;
  applying.value = true;
  let workspace: ReturnType<typeof files.getWorkspaceFiles> | undefined;
  let path = "";
  let committed = false;
  let canvas: HTMLCanvasElement | undefined;
  try {
    const image = imageElement.value;
    if (!image || !image.complete || !image.naturalWidth) throw new Error("图片尚未加载完成");
    canvas = document.createElement("canvas");
    canvas.width = area.width;
    canvas.height = area.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法创建画布");
    // ACT: 预览是 CSS 镜像，drawImage 拿的是原图；翻转时把源矩形按镜像换算，并把绘制结果再镜像一次。
    const sourceX = mirror ? (naturalSize.value?.width ?? area.width) - area.x - area.width : area.x;
    if (mirror) {
      context.translate(area.width, 0);
      context.scale(-1, 1);
    }
    context.drawImage(image, sourceX, area.y, area.width, area.height, 0, 0, area.width, area.height);
    signal.throwIfAborted();
    const blob = await new Promise<Blob>((resolve, reject) => canvas!.toBlob(
      value => value ? resolve(value) : reject(new Error("图片编码失败")),
      mimeType,
      mimeType === "image/png" ? undefined : 0.92,
    ));
    signal.throwIfAborted();
    if (!node.id || /[\\/]/.test(node.id) || node.id === "." || node.id === "..") throw new Error("节点 ID 不能作为文件夹名称");
    workspace = files.getWorkspaceFiles();
    path = `assets/${node.id}/${unchanged.value ? "flip" : "crop"}-${area.width}x${area.height}-${Date.now()}.${extension}`;
    await workspace.mkdir("assets").catch(ignoreExists);
    await workspace.mkdir(`assets/${node.id}`).catch(ignoreExists);
    await workspace.write(path, blob, true);
    signal.throwIfAborted();
    committed = true;
    emit("applied", { path, mimeType, fromUrl: startUrl, formatChanged, width: area.width, height: area.height, rect: area, flipped: mirror, cropped: !unchanged.value });
    visible.value = false;
  } catch (error) {
    if (!signal.aborted) showNodeError(error, "图片裁剪失败");
  } finally {
    if (!committed && workspace && path) await workspace.remove(path).catch(ignoreMissing);
    if (canvas) canvas.width = canvas.height = 0;
    if (controller === current) {
      controller = undefined;
      applying.value = false;
      job = undefined;
    }
  }
}

async function cancelApply() {
  controller?.abort();
  await job?.catch(() => {});
}
</script>

<style scoped lang="scss">
.cropBody {
  color: var(--el-text-color-primary);
  font-size: 12px;
}

.cropPresets {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 12px;

  button {
    padding: 5px 12px;
    border: 1px solid var(--el-border-color-lighter);
    border-radius: 6px;
    background: var(--el-fill-color-light);
    color: var(--el-text-color-regular);
    font: inherit;
    cursor: pointer;

    &:hover, &.active { border-color: var(--el-color-primary); color: var(--el-color-primary); background: var(--el-color-primary-light-9); }
    &:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 2px; }
    &:disabled { cursor: wait; opacity: 0.65; }
  }

  .flipButton {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .sourceSize {
    margin-left: auto;
    color: var(--el-text-color-secondary);
    font-variant-numeric: tabular-nums;
  }
}

.cropStage {
  display: grid;
  place-items: center;
  padding: 14px;
  border-radius: 8px;
  background: var(--el-fill-color-light);
}

.cropStageInner {
  display: flex;
  justify-content: center;
  outline: none;
  touch-action: none;
  cursor: crosshair;
}

.cropFrame {
  position: relative;
  display: inline-block;
  max-width: 100%;
  line-height: 0;

  img {
    display: block;
    max-width: 100%;
    max-height: 62vh;
    user-select: none;
    -webkit-user-drag: none;
  }
}

.cropFrame img.mirrored {
  transform: scaleX(-1);
}

.cropMask {
  position: absolute;
  background: rgb(0 0 0 / 55%);
  pointer-events: none;
}

.cropBox {
  position: absolute;
  pointer-events: none;
  outline: 1px solid rgb(255 255 255 / 95%);
  box-shadow: 0 0 0 1px rgb(0 0 0 / 35%);
  cursor: move;
  touch-action: none;
}

.cropGrid {
  position: absolute;
  background: rgb(255 255 255 / 35%);
  pointer-events: none;

  &.v1 { top: 0; bottom: 0; left: 33.33%; width: 1px; }
  &.v2 { top: 0; bottom: 0; left: 66.66%; width: 1px; }
  &.h1 { left: 0; right: 0; top: 33.33%; height: 1px; }
  &.h2 { left: 0; right: 0; top: 66.66%; height: 1px; }
}

.cropHandle {
  position: absolute;
  pointer-events: auto;
  width: 12px;
  height: 12px;
  border: 1px solid rgb(0 0 0 / 45%);
  border-radius: 2px;
  background: #fff;
  box-shadow: 0 0 2px rgb(0 0 0 / 30%);
  touch-action: none;

  &.nw { top: -6px; left: -6px; cursor: nwse-resize; }
  &.n  { top: -6px; left: 50%; margin-left: -6px; cursor: ns-resize; }
  &.ne { top: -6px; right: -6px; cursor: nesw-resize; }
  &.e  { top: 50%; right: -6px; margin-top: -6px; cursor: ew-resize; }
  &.se { bottom: -6px; right: -6px; cursor: nwse-resize; }
  &.s  { bottom: -6px; left: 50%; margin-left: -6px; cursor: ns-resize; }
  &.sw { bottom: -6px; left: -6px; cursor: nesw-resize; }
  &.w  { top: 50%; left: -6px; margin-top: -6px; cursor: ew-resize; }
}

.cropFields {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  margin-top: 14px;

  label {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
    color: var(--el-text-color-regular);

    .el-input-number { width: 100%; }
  }
}

.cropStatus {
  min-height: 18px;
  margin: 8px 0 0;
  color: var(--el-text-color-secondary);
  line-height: 18px;

  &.danger { color: var(--el-color-danger); }
}

.cropFooter {
  display: flex;
  align-items: center;
  gap: 8px;

  .spacer { flex: 1; }
}
</style>
