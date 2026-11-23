<template>
  <div ref="wrapEl" class="edgeCanvasWrap" aria-hidden="true">
    <canvas ref="canvasEl" class="edgeCanvasLayer" />
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { GraphEdge, GraphNode } from "@vue-flow/core";
import { edgeIntersectsViewBox, viewBoxOfViewport } from "../edgeVisibility";
import { buildEdgeGeometries, canvasFollowTransform, toCanvasPoint, type EdgeGeometry, type Transform } from "../edgePaths";

/**
 * ACT: 画布连线层（架构级改造，见 bug_solution-2026-11-22-09-30-canvas-render-arch.md）。
 *
 * 「栅格快照 + CSS 跟随」：
 * - 快照记录位图的缩放比例与它覆盖的画布矩形；
 * - 平移/缩放只改 canvas 自己的 transform（纯合成），**不重绘**；
 * - 只有数据变化、区域越界、手势结束、静止后缩放偏离才重绘。
 *
 * 位图像素与 zoom 解耦：矩形在画布坐标系里按当前 zoom 反算，所以像素宽高 ≈
 * 视口 × (1+2×margin) × dpr，最大/最小 zoom 都不会爆内存；超限时用 scale 降采样（k > 1 拉伸回来）。
 *
 * 放在 `.vue-flow` 默认插槽（根层，不在被变换的图层里），因此必须自己跟随视口；
 * 外层 wrap 永不变换，用来做屏幕坐标原点与溢出裁剪。
 * 层序：z-index 1 < 节点所在 viewport 的 4；节点与浮层永远在线之上。
 */
const props = defineProps<{
  edges: GraphEdge[];
  nodes: GraphNode[];
  viewport: Transform;
  dimensions: { width: number; height: number };
  /** 连线显隐（快捷键 L / 工具栏）。 */
  visible: boolean;
  /** 当前画布是否前台；后台画布不绘制。 */
  active: boolean;
  /** 平移/缩放/拖动节点进行中：期间限制重绘频率，避免和手势抢主线程。 */
  moving: boolean;
  /** 被动失效信号：选中态、节点位移、连线增删、样式变化时由父级递增。 */
  revision: number;
  /** 端点状态 → 连线外观。与 SVG 版共用同一份判定。 */
  tone: (source: GraphNode | undefined, target: GraphNode | undefined) => { disabled: boolean; active: boolean; animated: boolean; colored: boolean };
}>();

const SAFE_RATIO = 0.125;
const ZOOM_DRIFT = 0.2;
const MOVING_REDRAW_MS = 160;
const HIT_WIDTH = 40;
const DEFAULT_STROKE = "#b1b1b7";
const DISABLED_ALPHA = 0.35;
const ANIMATION_PERIOD_MS = 2000;
const ANIMATION_STEPS = 20;
/** 超过这个像素面积就不做虚线动画（见 syncAnimation 注释）。 */
const ANIMATION_MAX_AREA = 8_000_000;
const MAX_DPR = 2;

type DrawItem = EdgeGeometry & { active: boolean; disabled: boolean; animated: boolean; colored: boolean };
type Raster = { scale: number; rect: { x: number; y: number; w: number; h: number }; margin: number };

const wrapEl = ref<HTMLElement>();
const canvasEl = ref<HTMLCanvasElement>();
let raster: Raster | undefined;
let drawItems: DrawItem[] = [];
let geometryCache: EdgeGeometry[] = [];
let geometryRevision = -1;
let hitContext: CanvasRenderingContext2D | undefined;
let drawFrame = 0;
let animationTimer: number | undefined;
let dashOffset = 0;
let rootRect: DOMRect | undefined;
let lastRasterAt = 0;
// ACT: 描边次数写进 dataset，诊断浮层据此判断"静止时还有没有在画"。
// 连线改成 Canvas 后，静止时的持续重绘会直接顶起 GPU 进程 CPU，必须有可见读数。
let paintCount = 0;
function countPaint() {
  paintCount += 1;
  const canvas = canvasEl.value;
  if (canvas) canvas.dataset.paintCount = String(paintCount);
}
let deviceDpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);

const pathCache = new Map<string, Path2D>();
function pathFor(d: string) {
  let path = pathCache.get(d);
  if (!path) {
    if (pathCache.size > 4000) pathCache.clear();
    path = new Path2D(d);
    pathCache.set(d, path);
  }
  return path;
}

/** `--canvasEdgeColor` 可能是 `var(--el-color-primary)`，画布取不到变量引用，只能解析成实际色值。 */
function resolveColor(element: HTMLElement | null | undefined) {
  if (!element) return DEFAULT_STROKE;
  const raw = getComputedStyle(element).getPropertyValue("--canvasEdgeColor").trim();
  if (!raw) return DEFAULT_STROKE;
  const reference = /^var\((--[\w-]+)\)$/.exec(raw);
  if (!reference) return raw;
  return getComputedStyle(element).getPropertyValue(reference[1]!).trim() || DEFAULT_STROKE;
}

// ACT: 取色要 getComputedStyle，在 1.3 万元素的页面上每次都会触发样式重算。
// 颜色只跟设置/主题有关，跟着 revision 失效即可。
let cachedActiveColor = "";
let cachedColorRevision = -1;
function activeColor() {
  if (!cachedActiveColor || cachedColorRevision !== props.revision) {
    cachedActiveColor = resolveColor(wrapEl.value);
    cachedColorRevision = props.revision;
  }
  return cachedActiveColor;
}

/** 位图跟随：每个视口变化只写一次 transform，O(1)。 */
function applyTransform() {
  const canvas = canvasEl.value;
  if (!canvas || !raster) return;
  const { k, tx, ty } = canvasFollowTransform(raster, props.viewport);
  canvas.style.transform = `translate(${tx}px, ${ty}px) scale(${k})`;
}

function scheduleRaster() {
  if (drawFrame) return;
  drawFrame = requestAnimationFrame(() => {
    drawFrame = 0;
    rasterize();
  });
}

function clearBitmap(canvas: HTMLCanvasElement) {
  raster = undefined;
  drawItems = [];
  geometryCache = [];
  geometryRevision = -1;
  if (canvas.width) canvas.width = 0;
  if (canvas.height) canvas.height = 0;
  canvas.style.width = "0px";
  canvas.style.height = "0px";
  canvas.style.transform = "none";
}

/**
 * ACT: 位图预算优先保证「清晰度」而不是「覆盖面积」。
 * 位图像素面积 = 视口面积 × (1+2×margin)² × dpr²，与 zoom 无关；
 * 从大外扩往小试，取第一个能装进预算的：装得下就用外扩（平移靠 CSS 跟随，零重绘），
 * 装不下就退到 0 外扩（视口多大位图多大，平移时重绘，但线是 1:1 清晰的）。
 * 实测 2478×1464@2x 视口仅可见区就要 1450 万像素，32% 外扩会到 4000 万，Safari 的
 * canvas 面积上限会直接拒绝分配或被迫降采样——降采样会让 1px 线糊成两倍粗。
 */
const MARGIN_CANDIDATES = [0.35, 0.2, 0.1, 0];
const RASTER_AREA_BUDGET = 15_000_000;

function chooseRaster(dimensions: { width: number; height: number }, zoom: number) {
  const baseArea = Math.max(1, dimensions.width * dimensions.height) * deviceDpr * deviceDpr;
  let margin = 0;
  for (const candidate of MARGIN_CANDIDATES) {
    const growth = (1 + candidate * 2) ** 2;
    if (baseArea * growth <= RASTER_AREA_BUDGET) {
      margin = candidate;
      break;
    }
  }
  const growth = (1 + margin * 2) ** 2;
  let scale = zoom;
  // 极端大窗/高 dpr 时连视口本身都超预算，只能降采样保底。
  if (baseArea * growth > RASTER_AREA_BUDGET) {
    scale = zoom * Math.sqrt(RASTER_AREA_BUDGET / (baseArea * growth));
  }
  return { margin, scale };
}

function rasterize() {
  const canvas = canvasEl.value;
  if (!canvas) return;
  if (!props.active || !props.edges.length) {
    clearBitmap(canvas);
    syncAnimation();
    return;
  }
  const nodeMap = new Map<string, GraphNode>();
  for (const node of props.nodes) nodeMap.set(node.id, node);
  // 先算外观：隐藏连线时只要有活跃边就整层保留（与 SVG 版 .edgesHidden 的例外一致）。
  const toneById = new Map<string, { disabled: boolean; active: boolean; animated: boolean; colored: boolean }>();
  let anyActive = false;
  for (const edge of props.edges) {
    const tone = props.tone(nodeMap.get(edge.source), nodeMap.get(edge.target));
    toneById.set(edge.id, tone);
    if (tone.active) anyActive = true;
  }
  if (!props.visible && !anyActive) {
    clearBitmap(canvas);
    syncAnimation();
    return;
  }
  const { margin, scale } = chooseRaster(props.dimensions, props.viewport.zoom);
  const box = viewBoxOfViewport(props.viewport, props.dimensions, margin);
  if (!box) {
    syncAnimation();
    return;
  }
  const rect = { x: box.x1, y: box.y1, w: box.x2 - box.x1, h: box.y2 - box.y1 };
  const pixelWidth = Math.max(1, Math.round(rect.w * scale * deviceDpr));
  const pixelHeight = Math.max(1, Math.round(rect.h * scale * deviceDpr));

  // ACT: 路径是画布坐标，与视口无关；只有边/节点/样式变化（revision）才需要重建。
  // 外扩为 0 时几乎每帧都要重绘，这里省掉 206 次路径字符串生成。
  if (!geometryCache.length || geometryRevision !== props.revision) {
    geometryCache = buildEdgeGeometries(props.edges, nodeMap, { x1: -Infinity, y1: -Infinity, x2: Infinity, y2: Infinity });
    geometryRevision = props.revision;
  }
  drawItems = [];
  for (const geometry of geometryCache) {
    if (!edgeIntersectsViewBox(geometry.sourceX, geometry.sourceY, geometry.targetX, geometry.targetY, box)) continue;
    drawItems.push({
      ...geometry,
      ...(toneById.get(geometry.id) ?? { disabled: false, active: false, animated: false, colored: false }),
    });
  }

  if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
  if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
  canvas.style.width = `${rect.w * scale}px`;
  canvas.style.height = `${rect.h * scale}px`;
  raster = { scale, rect, margin };
  lastRasterAt = performance.now();
  draw();
  applyTransform();
  syncAnimation();
}

/** 显隐开关：隐藏时只保留「端点被选中/被拖动」的边（与 SVG 版 .edgesHidden 的意图一致）。 */
function isItemVisible(item: DrawItem) {
  return props.visible || item.active;
}

function shouldDraw() {
  return props.active && drawItems.some(isItemVisible);
}

function draw() {
  const canvas = canvasEl.value;
  if (!canvas || !raster) return;
  const context = canvas.getContext("2d");
  if (!context) return;
  const { rect, scale } = raster;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, canvas.width, canvas.height);
  if (!shouldDraw() || !drawItems.length) return;
  const pixelScale = scale * deviceDpr;
  context.setTransform(pixelScale, 0, 0, pixelScale, -rect.x * pixelScale, -rect.y * pixelScale);
  context.lineWidth = 1;
  context.lineCap = "round";
  const strokeActive = activeColor();
  for (const item of drawItems) {
    if (!isItemVisible(item)) continue;
    context.strokeStyle = item.colored ? strokeActive : DEFAULT_STROKE;
    context.globalAlpha = item.disabled ? DISABLED_ALPHA : 1;
    if (item.animated) {
      context.setLineDash([5, 5]);
      context.lineDashOffset = dashOffset;
    } else {
      context.setLineDash([]);
    }
    context.stroke(pathFor(item.d));
  }
  context.globalAlpha = 1;
  context.setLineDash([]);
  countPaint();
}

/**
 * ACT: 虚线的每一步只重画「动画边所在的矩形」，不再整张位图重画。
 * 这张 canvas 在 2478×1464@2x 下是 1450 万像素：整张 clear + 重绘会让 WebKit 每次
 * 上传半张 4K 纹理，10Hz 就能把 WebKit GPU 进程顶到 70%+ CPU（实测温度从 50℃ 升到 70℃）。
 * 这里只按动画边的包围盒局部擦除再重绘，同时重画穿过该区域的静态边，视觉不变。
 */
function drawAnimationFrame() {
  const canvas = canvasEl.value;
  if (!canvas || !raster) return;
  const context = canvas.getContext("2d");
  if (!context) return;
  const animated: DrawItem[] = [];
  for (const item of drawItems) if (item.animated && isItemVisible(item)) animated.push(item);
  if (!animated.length) return;
  const { rect, scale } = raster;
  const pixelScale = scale * deviceDpr;
  const padding = 24;
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const item of animated) {
    x1 = Math.min(x1, item.box.x1);
    y1 = Math.min(y1, item.box.y1);
    x2 = Math.max(x2, item.box.x2);
    y2 = Math.max(y2, item.box.y2);
  }
  const left = Math.max(0, Math.floor((x1 - padding - rect.x) * pixelScale));
  const top = Math.max(0, Math.floor((y1 - padding - rect.y) * pixelScale));
  const right = Math.min(canvas.width, Math.ceil((x2 + padding - rect.x) * pixelScale));
  const bottom = Math.min(canvas.height, Math.ceil((y2 + padding - rect.y) * pixelScale));
  if (right <= left || bottom <= top) return;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(left, top, right - left, bottom - top);
  context.setTransform(pixelScale, 0, 0, pixelScale, -rect.x * pixelScale, -rect.y * pixelScale);
  context.lineWidth = 1;
  context.lineCap = "round";
  const strokeActive = activeColor();
  for (const item of drawItems) {
    if (!isItemVisible(item)) continue;
    if (item.box.x2 < x1 - padding || item.box.x1 > x2 + padding || item.box.y2 < y1 - padding || item.box.y1 > y2 + padding) continue;
    context.strokeStyle = item.colored ? strokeActive : DEFAULT_STROKE;
    context.globalAlpha = item.disabled ? DISABLED_ALPHA : 1;
    if (item.animated) {
      context.setLineDash([5, 5]);
      context.lineDashOffset = dashOffset;
    } else {
      context.setLineDash([]);
    }
    context.stroke(pathFor(item.d));
  }
  context.globalAlpha = 1;
  context.setLineDash([]);
  countPaint();
}

/** 虚线动画与 SVG 版同频：2 秒走 10 个画布单位、分 20 步，即 10Hz。 */
function syncAnimation() {
  const canvas = canvasEl.value;
  // ACT: 位图超过这个面积时，任何一次绘制都可能触发整张纹理重上传，虚线动画的收益
  // 远小于代价（4K 级窗口 + 2 倍像素密度一定会超）。这种情况下保持静态虚线。
  const areaTooLarge = !!canvas && canvas.width * canvas.height > ANIMATION_MAX_AREA;
  const needed = !areaTooLarge && shouldDraw() && !props.moving && drawItems.some(item => item.animated);
  if (!needed) {
    if (animationTimer !== undefined) {
      window.clearInterval(animationTimer);
      animationTimer = undefined;
    }
    if (dashOffset !== 0) {
      dashOffset = 0;
      draw();
    }
    return;
  }
  if (animationTimer !== undefined) return;
  animationTimer = window.setInterval(() => {
    const step = Math.floor((performance.now() % ANIMATION_PERIOD_MS) / (ANIMATION_PERIOD_MS / ANIMATION_STEPS));
    dashOffset = 10 * (1 - step / ANIMATION_STEPS);
    drawAnimationFrame();
  }, ANIMATION_PERIOD_MS / ANIMATION_STEPS);
}

/** 当前视口超出安全区多少（>0 表示越界，需要重绘）。 */
function overflowRatio() {
  if (!raster) return 1;
  const current = viewBoxOfViewport(props.viewport, props.dimensions, 0);
  if (!current) return 1;
  const { rect } = raster;
  const marginX = rect.w * SAFE_RATIO;
  const marginY = rect.h * SAFE_RATIO;
  const width = Math.max(1, current.x2 - current.x1);
  const height = Math.max(1, current.y2 - current.y1);
  return Math.max(
    (rect.x + marginX - current.x1) / width,
    (rect.y + marginY - current.y1) / height,
    (current.x2 - (rect.x + rect.w - marginX)) / width,
    (current.y2 - (rect.y + rect.h - marginY)) / height,
  );
}

function maybeRaster() {
  if (!raster) {
    scheduleRaster();
    return;
  }
  const zoomDrift = Math.abs(props.viewport.zoom / raster.scale - 1);
  const needs = overflowRatio() > 0 || (zoomDrift > ZOOM_DRIFT && !props.moving);
  if (!needs) return;
  // ACT: 只有位图带外扩时才允许手势中限频（越界只会露白一圈）；外扩为 0 时位图边界就是
  // 视口边界，平移每一帧都可能露白，必须每帧重画——实测 206 条边逐帧重绘仍是 60fps。
  if (props.moving && raster.margin > 0.05 && performance.now() - lastRasterAt < MOVING_REDRAW_MS) return;
  scheduleRaster();
}

/** 命中测试：画布坐标下用 40 单位线宽做 isPointInStroke，与 SVG 版 interactionWidth 一致。 */
function hitTest(clientX: number, clientY: number) {
  if (!shouldDraw() || !drawItems.length) return undefined;
  const wrap = wrapEl.value;
  if (!wrap) return undefined;
  if (!rootRect) rootRect = wrap.getBoundingClientRect();
  const point = toCanvasPoint({ x: clientX - rootRect.left, y: clientY - rootRect.top }, props.viewport);
  hitContext ??= document.createElement("canvas").getContext("2d") ?? undefined;
  const context = hitContext;
  if (!context) return undefined;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.lineWidth = HIT_WIDTH;
  // 从后往前找：后画的线视觉上在上层。
  for (let index = drawItems.length - 1; index >= 0; index -= 1) {
    const item = drawItems[index]!;
    if (!isItemVisible(item)) continue;
    if (context.isPointInStroke(pathFor(item.d), point.x, point.y)) return props.edges.find(edge => edge.id === item.id);
  }
  return undefined;
}

function markDirty() {
  scheduleRaster();
}

function invalidateRect() {
  rootRect = undefined;
}

defineExpose({ hitTest, markDirty, invalidateRect });

watch(
  () => [props.viewport.x, props.viewport.y, props.viewport.zoom] as const,
  () => {
    applyTransform();
    maybeRaster();
  },
  { flush: "post" },
);
watch(() => props.edges, () => scheduleRaster(), { flush: "post" });
watch(() => [props.visible, props.active] as const, () => scheduleRaster(), { flush: "post" });
watch(() => props.revision, () => scheduleRaster(), { flush: "post" });
watch(() => props.moving, moving => {
  // ACT: 手势开始要立刻停掉虚线定时器（10Hz 重绘会和手势抢帧），结束再补一次重绘。
  if (moving) syncAnimation();
  else scheduleRaster();
}, { flush: "post" });
watch(() => [props.dimensions.width, props.dimensions.height] as const, () => { invalidateRect(); scheduleRaster(); }, { flush: "post" });

// ACT: 拖到外接屏/改缩放比例时 dpr 会变，位图必须按新比例重建，否则整层变糊。
let dprQuery: MediaQueryList | undefined;
function onDprChange() {
  deviceDpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
  invalidateRect();
  scheduleRaster();
  watchDpr();
}
function watchDpr() {
  dprQuery?.removeEventListener("change", onDprChange);
  dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
  dprQuery.addEventListener("change", onDprChange);
}

onMounted(() => {
  window.addEventListener("resize", invalidateRect, { passive: true });
  watchDpr();
  scheduleRaster();
});

onBeforeUnmount(() => {
  window.removeEventListener("resize", invalidateRect);
  dprQuery?.removeEventListener("change", onDprChange);
  if (drawFrame) cancelAnimationFrame(drawFrame);
  if (animationTimer !== undefined) window.clearInterval(animationTimer);
  pathCache.clear();
});
</script>

<style lang="scss" scoped>
.edgeCanvasWrap {
  position: absolute;
  inset: 0;
  z-index: 1;
  overflow: hidden;
  pointer-events: none;
}

.edgeCanvasLayer {
  position: absolute;
  top: 0;
  left: 0;
  transform-origin: 0 0;
  pointer-events: none;
}
</style>
