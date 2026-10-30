<template>
  <div class="imageEditor" :class="{ editing: mode }">
    <img ref="sourceImage" :src="shownSrc || undefined" :alt="alt" draggable="false" @load="emit('load', $event)" @error="onImageError" />
    <canvas
      v-if="mode"
      ref="paintCanvas"
      class="paintCanvas nodrag nopan nowheel"
      :class="{ inpaint: mode === 'inpaint' }"
      :style="{ aspectRatio: `${sourceImage?.naturalWidth} / ${sourceImage?.naturalHeight}`, cursor: tool === 'text' ? 'text' : 'crosshair' }"
      :aria-label="mode === 'inpaint' ? '涂抹需要重绘的区域' : '图片标记画布'"
      @pointerdown.stop.prevent="startStroke"
      @pointermove.stop.prevent="moveStroke"
      @pointerup.stop.prevent="finishStroke"
      @pointercancel.stop="cancelStroke"
      @lostpointercapture="cancelStroke"
      @mousedown.stop
      @dblclick.stop
      @contextmenu.stop.prevent />
    <textarea
      v-if="textDraft"
      ref="textInput"
      v-model="textDraft.text"
      class="textInput nodrag nopan nowheel"
      :style="textStyle"
      :rows="Math.max(1, textDraft.text.split('\n').length)"
      aria-label="标记文本"
      placeholder="输入文本"
      wrap="off"
      @pointerdown.stop
      @mousedown.stop
      @dblclick.stop
      @keydown.stop="handleTextKey"
      @blur="commitText" />
  </div>
  <teleport v-if="mode && toolbarTarget" :to="toolbarTarget">
    <div class="paintToolbar" @keydown.esc.stop.prevent="!busy && cancel()">
      <el-button class="exitButton" :icon="IconX" :disabled="busy" text :title="mode === 'mark' ? '取消标记' : '取消局部重绘'" :aria-label="mode === 'mark' ? '取消标记' : '取消局部重绘'" @click="cancel">{{ mode === 'mark' ? '标记' : '局部重绘' }}</el-button>
      <el-button :icon="IconBrush" :type="tool === 'brush' ? 'primary' : 'default'" :disabled="busy" text title="画笔" aria-label="画笔" :aria-pressed="tool === 'brush'" @click="tool = 'brush'" />
      <template v-if="mode === 'mark'">
        <el-button :icon="IconSquare" :type="tool === 'rectangle' ? 'primary' : 'default'" :disabled="busy" text title="矩形" aria-label="矩形" :aria-pressed="tool === 'rectangle'" @click="tool = 'rectangle'" />
        <el-button :icon="IconCircle" :type="tool === 'circle' ? 'primary' : 'default'" :disabled="busy" text title="圆形" aria-label="圆形" :aria-pressed="tool === 'circle'" @click="tool = 'circle'" />
        <el-button :icon="IconTypography" :type="tool === 'text' ? 'primary' : 'default'" :disabled="busy" text title="文本" aria-label="文本" :aria-pressed="tool === 'text'" @click="tool = 'text'" />
      </template>
      <el-button :icon="IconEraser" :type="tool === 'eraser' ? 'primary' : 'default'" :disabled="busy" text title="橡皮擦" aria-label="橡皮擦" :aria-pressed="tool === 'eraser'" @click="tool = 'eraser'" />
      <input v-if="mode === 'mark'" v-model="color" type="color" class="brushColor" :disabled="busy" title="画笔颜色" aria-label="画笔颜色" />
      <label class="brushSize">{{ tool === 'text' ? '字号' : '粗细' }}<input v-model.number="toolSize" type="range" :min="tool === 'text' ? 12 : 2" max="60" :disabled="busy" :aria-label="tool === 'text' ? '文本字号' : '画笔粗细'" /><span>{{ toolSize }}</span></label>
      <el-button :icon="IconArrowBackUp" :disabled="busy || !strokeCount" text title="撤销" aria-label="撤销" @click="undo" />
      <el-button :icon="IconArrowForwardUp" :disabled="busy || strokeCount === historyLength" text title="恢复" aria-label="恢复" @click="redo" />
      <el-button :icon="IconTrash" :disabled="busy || !hasDrawing" text title="清空标记" aria-label="清空标记" @click="clear" />
      <el-button v-if="mode === 'mark'" class="saveButton" :icon="IconCheck" :disabled="!hasDrawing && !textDraft?.text.trim()" :loading="busy" type="primary" @click="saveMark">保存</el-button>
    </div>
  </teleport>
</template>

<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useNode, useVueFlow } from "@vue-flow/core";
import { ElButton, ElMessage } from "element-plus";
import { IconBrush, IconEraser, IconSquare, IconCircle, IconTypography, IconArrowBackUp, IconArrowForwardUp, IconTrash, IconCheck, IconX } from "@tabler/icons-vue";
import { revealNodeInViewport, uploadNodeFile, useNodeFiles } from "@toonflow/nodes-scaffold/runtime";
import { showNodeError } from "@toonflow/node-shared/showNodeError";
import { useImageVariationNode } from "../useImageVariationNode";
import { buildInpaintPrompt, type InpaintDraftInput } from "../imageInpaint";

const props = defineProps<{ src: string; previewSrc?: string; alt: string; toolbarTarget?: HTMLElement; disabled?: boolean }>();
const emit = defineEmits<{ load: [event: Event]; error: [event: Event] }>();
const { node } = useNode();
const flow = useVueFlow();
const { addNodes, addEdges, findNode, getNodes, nodeTypes } = flow;
const files = useNodeFiles();
const createVariation = useImageVariationNode();
const getCanvas = inject<(() => { id: string } | undefined) | undefined>("canvas", undefined);
const batchHistory = inject<(action: () => Promise<void>) => Promise<void>>("batchCanvasHistory", action => action());
const sourceImage = ref<HTMLImageElement>();
const paintCanvas = ref<HTMLCanvasElement>();
const mode = ref<"inpaint" | "mark">();
// ACT: 画布卡片只解码缩略图；进入标记/局部重绘时才切到原图，因为导出像素来自这张 <img>。
// 记住"哪个缩略图地址失败过"，原图到达后不要把 src 再切回同一个坏地址。
const failedThumb = ref<string>();
const editingSrc = ref<string>();
const thumbSrc = computed(() => props.previewSrc && props.previewSrc !== failedThumb.value ? props.previewSrc : "");
const shownSrc = computed(() => editingSrc.value ?? (thumbSrc.value || props.src));
watch([() => props.src, () => props.previewSrc], _value => {
  // 地址变化（换图）才重置失败记录；同一地址失败后保持回退，避免反复请求。
  if (props.previewSrc !== failedThumb.value) failedThumb.value = undefined;
});
function onImageError(event: Event) {
  // 缩略图不可用（未生成/格式不支持/旧后端 400）时静默换回原图，不能把节点变成"预览失败"。
  if (props.previewSrc && thumbSrc.value === props.previewSrc && props.previewSrc !== props.src) {
    failedThumb.value = props.previewSrc;
    return;
  }
  // 原图还没就绪时不要报错（此时 shownSrc 可能是空串），等它到了自然会重新渲染。
  if (!props.src) return;
  editingSrc.value = undefined;
  emit("error", event);
}
const busy = ref(false);
const tool = ref<"brush" | "eraser" | "rectangle" | "circle" | "text">("brush");
const color = ref("#ff4545");
const brushSize = ref(16);
const fontSize = ref(24);
const toolSize = computed({
  get: () => tool.value === "text" ? fontSize.value : brushSize.value,
  set: value => { if (tool.value === "text") fontSize.value = value; else brushSize.value = value; },
});
const strokeCount = ref(0);
const historyLength = ref(0);
const hasDrawing = ref(false);
type Point = { x: number; y: number };
type Stroke = { tool: typeof tool.value | "clear"; color: string; size: number; points: Point[]; text?: string };
const textInput = ref<HTMLTextAreaElement>();
const textDraft = ref<(Stroke & { text: string })>();
const textStyle = computed(() => {
  const canvas = paintCanvas.value;
  const draft = textDraft.value;
  if (!canvas || !draft) return {};
  const scale = canvas.clientWidth / canvas.width;
  const point = draft.points[0]!;
  return { left: `${canvas.offsetLeft + point.x * scale}px`, top: `${canvas.offsetTop + point.y * scale}px`, width: `${Math.max(40, canvas.clientWidth - point.x * scale)}px`, fontSize: `${draft.size * scale}px`, color: draft.color };
});
let strokes: Stroke[] = [];
let draftStroke: Stroke | undefined;
let pointerId: number | undefined;
let operation: AbortController | undefined;
// ACT: 进入编辑要等原图解码，等待期间可能被 cancel()/换图打断；用代次判断这次进入是否还有效。
let editToken = 0;

function cancel() {
  editToken++;
  operation?.abort();
  mode.value = undefined;
  editingSrc.value = undefined;
  strokes = [];
  strokeCount.value = historyLength.value = 0;
  hasDrawing.value = false;
  textDraft.value = undefined;
  cancelStroke();
}
watch(() => props.src, cancel, { flush: "sync" });
watch(() => getCanvas?.()?.id, cancel, { flush: "sync" });
onBeforeUnmount(cancel);

function waitImageLoad(image: HTMLImageElement) {
  // complete 为真但 naturalWidth 为 0 表示已处于失败终态，直接返回，不能挂监听等一个永远不来的事件。
  if (image.complete) return Promise.resolve();
  return new Promise<void>(resolve => {
    const timer = setTimeout(done, 10_000);
    function done() {
      clearTimeout(timer);
      image.removeEventListener("load", done);
      image.removeEventListener("error", done);
      resolve();
    }
    image.addEventListener("load", done);
    image.addEventListener("error", done);
  });
}

let starting = false;
async function start(value: "inpaint" | "mark") {
  const image = sourceImage.value;
  // 父级同步调用、不 await；用锁避免连点两次同时走一遍切原图流程。
  if (starting || props.disabled || busy.value || !props.src || !image?.complete || !image.naturalWidth) return;
  starting = true;
  try {
    await startEditor(value, image);
  } finally {
    starting = false;
  }
}

async function startEditor(value: "inpaint" | "mark", image: HTMLImageElement) {
  cancel();
  const token = editToken;
  // 缩略图不能当像素源：先把 <img> 切到原图并等它解码完，再按原图尺寸建画布。
  if (props.previewSrc && props.previewSrc !== props.src) {
    editingSrc.value = props.src;
    await nextTick();
    await waitImageLoad(image);
    // 等待期间被 cancel()、换图或再次进入编辑 → 本次进入作废，避免"画布按原图、显示却是缩略图"。
    if (token !== editToken || editingSrc.value !== props.src) return;
    if (!image.naturalWidth) {
      editingSrc.value = undefined;
      return;
    }
  }
  tool.value = "brush";
  mode.value = value;
  await nextTick();
  if (!paintCanvas.value) return;
  paintCanvas.value.width = image.naturalWidth;
  paintCanvas.value.height = image.naturalHeight;
}

function getPoint(event: PointerEvent): Point {
  const canvas = paintCanvas.value!;
  const bounds = canvas.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(canvas.width, (event.clientX - bounds.left) / bounds.width * canvas.width)),
    y: Math.max(0, Math.min(canvas.height, (event.clientY - bounds.top) / bounds.height * canvas.height)),
  };
}

function drawSegment(stroke: Stroke, point: Point, previous = point) {
  const context = paintCanvas.value?.getContext("2d");
  if (!context) return;
  context.globalCompositeOperation = stroke.tool === "eraser" ? "destination-out" : "source-over";
  context.fillStyle = context.strokeStyle = stroke.color;
  context.lineWidth = stroke.size;
  context.lineCap = context.lineJoin = "round";
  context.beginPath();
  if (point === previous) {
    context.arc(point.x, point.y, stroke.size / 2, 0, Math.PI * 2);
    context.fill();
  } else {
    context.moveTo(previous.x, previous.y);
    context.lineTo(point.x, point.y);
    context.stroke();
  }
}

async function startStroke(event: PointerEvent) {
  const canvas = paintCanvas.value;
  if (!props.toolbarTarget || busy.value || props.disabled || event.button !== 0 || pointerId !== undefined || !canvas) return;
  commitText();
  const stroke: Stroke = { tool: tool.value, color: mode.value === "inpaint" ? "#ff4545" : color.value, size: toolSize.value * canvas.width / canvas.clientWidth, points: [getPoint(event)] };
  if (tool.value === "text") {
    textDraft.value = { ...stroke, text: "" };
    await nextTick();
    textInput.value?.focus();
    return;
  }
  pointerId = event.pointerId;
  canvas.setPointerCapture(event.pointerId);
  draftStroke = stroke;
  if (stroke.tool === "brush" || stroke.tool === "eraser") drawSegment(stroke, stroke.points[0]!);
}

function moveStroke(event: PointerEvent) {
  if (event.pointerId !== pointerId || busy.value) return;
  const stroke = draftStroke!;
  const point = getPoint(event);
  if (stroke.tool === "brush" || stroke.tool === "eraser") {
    drawSegment(stroke, point, stroke.points.at(-1));
    stroke.points.push(point);
  } else {
    stroke.points[1] = point;
    redraw();
    drawStroke(stroke);
  }
}

function finishStroke(event: PointerEvent) {
  if (event.pointerId !== pointerId) return;
  moveStroke(event);
  const stroke = draftStroke!;
  draftStroke = undefined;
  pointerId = undefined;
  if (paintCanvas.value?.hasPointerCapture(event.pointerId)) paintCanvas.value.releasePointerCapture(event.pointerId);
  if ((stroke.tool === "rectangle" || stroke.tool === "circle") && (!stroke.points[1] || stroke.points[0]!.x === stroke.points[1].x || stroke.points[0]!.y === stroke.points[1].y)) return void redraw();
  commitStroke(stroke);
}

function cancelStroke() {
  const captured = pointerId;
  pointerId = undefined;
  draftStroke = undefined;
  if (captured !== undefined && paintCanvas.value?.hasPointerCapture(captured)) paintCanvas.value.releasePointerCapture(captured);
  redraw();
}

function drawStroke(stroke: Stroke) {
  const canvas = paintCanvas.value;
  const context = canvas?.getContext("2d");
  if (!canvas || !context) return;
  if (stroke.tool === "clear") return context.clearRect(0, 0, canvas.width, canvas.height);
  if (stroke.tool === "brush" || stroke.tool === "eraser") return stroke.points.forEach((point, index) => drawSegment(stroke, point, stroke.points[index - 1]));
  const start = stroke.points[0]!;
  context.globalCompositeOperation = "source-over";
  context.fillStyle = context.strokeStyle = stroke.color;
  context.lineWidth = stroke.size;
  context.lineJoin = "miter";
  context.lineCap = "butt";
  if (stroke.tool === "text") {
    context.font = `${stroke.size}px sans-serif`;
    context.textBaseline = "top";
    stroke.text!.split("\n").forEach((line, index) => context.fillText(line, start.x, start.y + index * stroke.size * 1.25));
    return;
  }
  const end = stroke.points[1];
  if (!end) return;
  context.beginPath();
  if (stroke.tool === "rectangle") context.rect(start.x, start.y, end.x - start.x, end.y - start.y);
  else {
    const radius = Math.min(Math.abs(end.x - start.x), Math.abs(end.y - start.y)) / 2;
    context.arc(start.x + Math.sign(end.x - start.x) * radius, start.y + Math.sign(end.y - start.y) * radius, radius, 0, Math.PI * 2);
  }
  context.stroke();
}

function redraw() {
  const canvas = paintCanvas.value;
  canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
  hasDrawing.value = false;
  // ACT: 形状预览和历史切换重放矢量操作；超长标记需要分段快照，普通画笔移动仍只增量绘制。
  for (const stroke of strokes.slice(0, strokeCount.value)) {
    drawStroke(stroke);
    if (stroke.tool === "clear") hasDrawing.value = false;
    else if (stroke.tool !== "eraser") hasDrawing.value = true;
  }
}

function commitStroke(stroke: Stroke) {
  strokes.splice(strokeCount.value, strokes.length - strokeCount.value, stroke);
  strokeCount.value = historyLength.value = strokes.length;
  redraw();
}

function clear() {
  if (!busy.value) commitStroke({ tool: "clear", color: "", size: 0, points: [] });
}

function undo() {
  if (busy.value || !strokeCount.value) return;
  strokeCount.value--;
  redraw();
}

function redo() {
  if (busy.value || strokeCount.value === historyLength.value) return;
  strokeCount.value++;
  redraw();
}

function commitText() {
  const draft = textDraft.value;
  textDraft.value = undefined;
  if (draft?.text.trim() && !busy.value && mode.value === "mark") commitStroke(draft);
}

function handleTextKey(event: KeyboardEvent) {
  if (event.isComposing) return;
  if (event.key === "Escape") {
    event.preventDefault();
    textDraft.value = undefined;
  } else if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    commitText();
  }
}

function createCanvas() {
  const source = sourceImage.value;
  if (!source?.naturalWidth || !paintCanvas.value) throw new Error("图片尚未加载完成");
  // 导出必须来自原图：缩略图只有 1024，拿来导出会静默降级标记/重绘的画质。
  if (props.previewSrc && props.previewSrc !== props.src && editingSrc.value !== props.src) throw new Error("原图尚未加载完成，请稍后重试");
  const canvas = document.createElement("canvas");
  canvas.width = source.naturalWidth;
  canvas.height = source.naturalHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("无法创建绘画画布");
  return { canvas, context };
}

function toFile(canvas: HTMLCanvasElement) {
  return new Promise<File>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(new File([blob], "image.png", { type: "image/png" })) : reject(new Error("图片编码失败")), "image/png"));
}

async function saveMark() {
  if (busy.value) return;
  commitText();
  if (!hasDrawing.value) return;
  if (!nodeTypes?.value?.["remote-imageNode"]) return void ElMessage.error("请先启用图片节点插件");
  const controller = operation = new AbortController();
  busy.value = true;
  const id = crypto.randomUUID();
  let workspace: ReturnType<typeof files.getWorkspaceFiles> | undefined;
  let committed = false;
  try {
    workspace = files.getWorkspaceFiles();
    const { canvas, context } = createCanvas();
    context.drawImage(sourceImage.value!, 0, 0);
    context.drawImage(paintCanvas.value!, 0, 0);
    const file = await toFile(canvas);
    canvas.width = canvas.height = 0;
    controller.signal.throwIfAborted();
    const path = await uploadNodeFile(workspace, id, file);
    controller.signal.throwIfAborted();
    if (findNode(node.id) !== node || !nodeTypes?.value?.["remote-imageNode"]) throw new Error("画布节点已变化，请重新保存");
    const x = node.computedPosition.x + node.dimensions.width + 80;
    let y = node.computedPosition.y;
    for (const other of [...getNodes.value].sort((left, right) => left.computedPosition.y - right.computedPosition.y)) {
      if (other.computedPosition.x < x + node.dimensions.width && other.computedPosition.x + other.dimensions.width > x && other.computedPosition.y < y + node.dimensions.height && other.computedPosition.y + other.dimensions.height > y) y = other.computedPosition.y + other.dimensions.height + 40;
    }
    await batchHistory(async () => {
      controller.signal.throwIfAborted();
      addNodes([{ id, type: "remote-imageNode", position: { x, y }, data: { label: `${node.data.label || "图片"} - 标记`, outputs: { image: { dataType: "IMAGE", value: { url: path, mimeType: "image/png" } } } } }]);
      addEdges([{ id: crypto.randomUUID(), source: node.id, sourceHandle: "image", target: id, targetHandle: "in" }]);
      committed = true;
    });
    await revealNodeInViewport(flow, id, { margin: 48 });
    cancel();
  } catch (error) {
    if (!controller.signal.aborted) showNodeError(error, "标记保存失败");
  } finally {
    if (!committed && workspace) await workspace.remove(`assets/${id}`, true).catch(error => {
      if (error?.response?.data?.data?.code !== "ENOENT") showNodeError(error, "标记临时文件清理失败");
    });
    operation = undefined;
    busy.value = false;
  }
}

async function createInpaint(input: InpaintDraftInput, signal: AbortSignal) {
  if (busy.value || mode.value !== "inpaint") throw new Error("请先进入局部重绘");
  if (!input.prompt.trim()) throw new Error("请输入重绘提示词");
  if (!nodeTypes?.value?.["remote-imageGenerationNode"]) throw new Error("请先启用图片生成节点插件");
  const layer = paintCanvas.value;
  if (!layer || !layer.getContext("2d")?.getImageData(0, 0, layer.width, layer.height).data.some((value, index) => index % 4 === 3 && value)) throw new Error("请先涂抹需要重绘的区域");
  const workspace = files.getWorkspaceFiles();
  const controller = operation = new AbortController();
  const requestSignal = AbortSignal.any([signal, controller.signal]);
  const nodeId = crypto.randomUUID();
  busy.value = true;
  let committed = false;
  let canvas: HTMLCanvasElement | undefined;
  try {
    requestSignal.throwIfAborted();
    const drawing = createCanvas();
    canvas = drawing.canvas;
    const context = drawing.context;
    context.drawImage(sourceImage.value!, 0, 0);
    const original = await uploadNodeFile(workspace, nodeId, await toFile(canvas));
    requestSignal.throwIfAborted();
    context.globalAlpha = 0.55;
    context.drawImage(layer, 0, 0);
    context.globalAlpha = 1;
    const guide = await uploadNodeFile(workspace, nodeId, await toFile(canvas));
    requestSignal.throwIfAborted();
    const mask = await uploadNodeFile(workspace, nodeId, await toFile(layer));
    requestSignal.throwIfAborted();
    // ACT: 编辑素材放入子目录，避免混入只扫描节点目录顶层的生成历史。
    const directory = `assets/${nodeId}/inpaint`;
    await workspace.mkdir(directory);
    const paths = [original, guide, mask].map(path => `${directory}/${path.split("/").at(-1)}`);
    for (const [index, path] of [original, guide, mask].entries()) {
      requestSignal.throwIfAborted();
      await workspace.rename(path, paths[index]!);
    }
    const result = await createVariation({
      label: "局部重绘", nodeId, prompt: buildInpaintPrompt(input.prompt),
      model: typeof node.data.model === "string" ? node.data.model : "",
      size: typeof node.data.size === "string" ? node.data.size : "",
      ratio: typeof node.data.ratio === "string" ? node.data.ratio : "16:9",
      inpaint: { source: node.data.outputs?.image?.value?.url ?? "", original: paths[0]!, guide: paths[1]!, mask: paths[2]!, images: input.images ?? [] },
    }, requestSignal);
    committed = true;
    cancel();
    return result;
  } finally {
    if (canvas) canvas.width = canvas.height = 0;
    if (!committed) await workspace.remove(`assets/${nodeId}`, true).catch(error => {
      if (error?.response?.data?.data?.code !== "ENOENT") showNodeError(error, "重绘临时文件清理失败");
    });
    operation = undefined;
    busy.value = false;
  }
}

defineExpose({ mode, busy, start, cancel, createInpaint });
</script>

<style scoped lang="scss">
.imageEditor {
  position: relative;
  width: 100%;
  display: grid;
  place-items: center;

  img { display: block; width: 100%; max-height: 240px; object-fit: contain; border-radius: var(--el-border-radius-base); }
  .paintCanvas { position: absolute; max-width: 100%; max-height: 100%; height: 100%; touch-action: none; cursor: crosshair; }
  .paintCanvas.inpaint { opacity: 0.55; }
  .textInput { position: absolute; z-index: 1; box-sizing: border-box; padding: 0; border: 1px dashed currentColor; outline: none; resize: none; overflow: hidden; background: rgb(255 255 255 / 85%); font-family: sans-serif; line-height: 1.25; }
}
.paintToolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px;
  border: 1px solid var(--el-border-color-light);
  border-radius: var(--el-border-radius-base);
  background: var(--el-bg-color-overlay);
  color: var(--el-text-color-primary);
  box-shadow: var(--el-box-shadow-light);
  white-space: nowrap;

  .el-button { margin: 0; padding: 0 8px; min-width: 32px; }
  .exitButton { margin-right: 4px; }
  .saveButton { margin-left: 8px; padding: 0 12px; }
  .brushColor { width: 26px; height: 26px; padding: 2px; border: 1px solid var(--el-border-color); border-radius: 5px; background: transparent; cursor: pointer; }
  .brushSize { display: flex; align-items: center; gap: 6px; padding: 0 8px; font-size: 12px; input { width: 70px; accent-color: var(--el-color-primary); } span { min-width: 18px; } }
}
</style>
