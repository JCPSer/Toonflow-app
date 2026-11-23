<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";

/**
 * ACT: 画布卡顿只能靠真机数据判断是 JS、重绘还是 DOM 规模。浮层用 rAF 间隔直接量帧耗时，
 * 并每 500ms 数一次画布内的节点/连线元素。显示值每 500ms 刷新一次，避免浮层自己制造 60fps 渲染。
 * 只在开发者选项打开时挂载，默认不影响任何用户。
 */
const props = defineProps<{
  nodes: number;
  edges: number;
  moving: boolean;
  rootEl?: HTMLElement;
}>();

const fps = ref("–");
const avgMs = ref("–");
const maxMs = ref("–");
const slowFrames = ref(0);
const pathCount = ref(0);
const edgeElements = ref(0);
const edgeRoots = ref(0);
const domCount = ref(0);
// ACT: 连线 Canvas 的累计描边次数。静止时它应该停住；一直涨说明有东西在持续重绘。
const paintTotal = ref(0);
const paintRate = ref(0);
let lastPaintTotal = 0;
let lastPaintAt = 0;
const willChange = ref("–");
// ACT: 层显隐与主线程延迟两个读数，用来区分「画面重绘」和「JS 主线程忙」：
// 节点/连线层确实 display:none 时画面近乎空；setTimeout(0) 的延迟就是主线程排队时长。
const nodesDisplay = ref("–");
const edgesDisplay = ref("–");
const timerLag = ref("–");
// ACT: 主线程延迟改成每帧采样一次 0ms 定时器。以前每 500ms 只采一次，容易落在空闲帧上，
// 读数永远接近 0，失去区分「主线程忙」与「出帧/合成受限」的能力。
const lagSamples: number[] = [];
let lagPending = false;
// ACT: 纯合成基准：绕开 Vue，直接以 rAF 改 transformationpane 的 transform 3 秒。
// 如果这个也到不了 60fps，说明瓶颈在图层合成/光栅；如果能到，瓶颈在主线程或内容失效。
const benchState = ref<"idle" | "running" | "done">("idle");
const benchResult = ref("");
let benchRaf = 0;
// ACT: 两个 A/B 开关：平移期间整层不画连线 / 不画节点。用来判断瓶颈在连线光栅化还是节点重绘，
// 只在诊断浮层里生效，不进入正式交互。
const hideEdgesWhileMoving = ref(false);
const hideNodesWhileMoving = ref(false);
const hideMapWhileMoving = ref(false);
const hideBackgroundWhileMoving = ref(false);

// ACT: 不走画布根元素的 class——那个 class 属性由画布的 :class 绑定管理，父组件每次重渲染都会
// 整体覆盖，勾选的 A/B 类会被静默冲掉。直接写目标元素的 inline display，Vue 不会碰它。
const HIDE_TARGETS = {
  edges: ".vue-flow__edges:not(.vue-flow__connectionline)",
  nodes: ".vue-flow__nodes",
  map: ".canvasMiniMap",
  background: ".vue-flow__background",
} as const;

function setDisplay(selector: string, hidden: boolean) {
  const root = props.rootEl;
  if (!root) return;
  for (const element of root.querySelectorAll<HTMLElement>(selector)) element.style.display = hidden ? "none" : "";
}

function applyHideFlags() {
  const moving = props.moving;
  setDisplay(HIDE_TARGETS.edges, moving && hideEdgesWhileMoving.value);
  setDisplay(HIDE_TARGETS.nodes, moving && hideNodesWhileMoving.value);
  setDisplay(HIDE_TARGETS.map, moving && hideMapWhileMoving.value);
  setDisplay(HIDE_TARGETS.background, moving && hideBackgroundWhileMoving.value);
}

watch(
  () => [props.moving, hideEdgesWhileMoving.value, hideNodesWhileMoving.value, hideMapWhileMoving.value, hideBackgroundWhileMoving.value, props.rootEl] as const,
  applyHideFlags,
  { immediate: true },
);

// ACT: 基准跑在 3 秒动画里，中途关掉开关或切走画布时必须把 transform 还原，否则图层会停在偏移位。
let benchPane: HTMLElement | undefined;
let benchOriginal = "";

onBeforeUnmount(() => {
  if (benchRaf) cancelAnimationFrame(benchRaf);
  benchRaf = 0;
  if (benchPane) benchPane.style.transform = benchOriginal;
  benchPane = undefined;
  for (const selector of Object.values(HIDE_TARGETS)) setDisplay(selector, false);
});

const deltas: number[] = [];
let lastFrame = 0;
let lastSample = 0;
let raf = 0;

function tick(now: number) {
  if (lastFrame) {
    const delta = now - lastFrame;
    // ACT: 切后台/系统挂起会产出几秒的假间隔，不参与统计。
    if (delta < 1000) {
      deltas.push(delta);
      if (deltas.length > 240) deltas.shift();
    }
  }
  lastFrame = now;
  sampleLag();
  if (!lastSample || now - lastSample >= 500) {
    lastSample = now;
    sample();
  }
  raf = requestAnimationFrame(tick);
}

/** 每帧投一个 0ms 定时器：它在主线程空出后才执行，延迟就是这一帧主线程被占用的时长。 */
function sampleLag() {
  if (lagPending) return;
  lagPending = true;
  const started = performance.now();
  window.setTimeout(() => {
    lagPending = false;
    lagSamples.push(performance.now() - started);
    if (lagSamples.length > 240) lagSamples.shift();
  }, 0);
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

function parsePaneTransform(value: string) {
  const matched = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)\s*scale\(([\d.]+)\)/.exec(value);
  return matched ? { x: Number(matched[1]), y: Number(matched[2]), zoom: Number(matched[3]) } : undefined;
}

function runCompositingBenchmark() {
  if (benchState.value === "running") return;
  const pane = props.rootEl?.querySelector<HTMLElement>(".vue-flow__transformationpane");
  if (!pane) {
    benchResult.value = "找不到画布图层";
    return;
  }
  const base = parsePaneTransform(pane.style.transform) ?? { x: 0, y: 0, zoom: 1 };
  const original = pane.style.transform;
  benchPane = pane;
  benchOriginal = original;
  const frames: number[] = [];
  const started = performance.now();
  let last = 0;
  benchState.value = "running";
  benchResult.value = "测试中…";
  const step = (now: number) => {
    if (last) frames.push(now - last);
    last = now;
    const elapsed = now - started;
    // ACT: 往复平移 120px，等价于一次真实拖拽的位移量级，但不经过 Vue 与内容失效。
    const offset = 120 * Math.sin(elapsed / 260);
    pane.style.transform = `translate(${base.x + offset}px,${base.y}px) scale(${base.zoom})`;
    if (elapsed < 3000) {
      benchRaf = requestAnimationFrame(step);
      return;
    }
    benchRaf = 0;
    pane.style.transform = original;
    benchPane = undefined;
    benchState.value = "done";
    const average = frames.reduce((sum, value) => sum + value, 0) / Math.max(frames.length, 1);
    benchResult.value = `合成 ${frames.length} 帧 · 平均 ${average.toFixed(1)}ms · 最长 ${(Math.max(...frames) || 0).toFixed(0)}ms`;
  };
  benchRaf = requestAnimationFrame(step);
}

function sample() {
  if (!deltas.length) return;
  const total = deltas.reduce((sum, value) => sum + value, 0);
  const average = total / deltas.length;
  fps.value = (1000 / average).toFixed(1);
  avgMs.value = average.toFixed(1);
  maxMs.value = Math.max(...deltas).toFixed(0);
  slowFrames.value = deltas.filter(value => value > 50).length;
  const root = props.rootEl;
  if (root) {
    pathCount.value = root.querySelectorAll(".vue-flow__edge-path").length;
    edgeElements.value = root.querySelectorAll(".vue-flow__edge").length;
    const pane = root.querySelector(".vue-flow__transformationpane");
    willChange.value = pane ? getComputedStyle(pane).willChange : "–";
    const nodesLayer = root.querySelector(".vue-flow__nodes");
    const edgesLayer = root.querySelector(".vue-flow__edges");
    nodesDisplay.value = nodesLayer ? getComputedStyle(nodesLayer).display : "–";
    edgesDisplay.value = edgesLayer ? getComputedStyle(edgesLayer).display : "–";
    // ACT: 每帧 0ms 定时器延迟的中位数；持续 > 5ms 说明卡在主线程，接近 0 说明卡在出帧/光栅。
    timerLag.value = median(lagSamples).toFixed(1);
    edgeRoots.value = root.querySelectorAll(".vue-flow__edges").length;
    domCount.value = root.querySelectorAll("*").length;
    const edgeCanvas = root.querySelector<HTMLCanvasElement>("canvas.edgeCanvasLayer");
    const total = edgeCanvas ? Number(edgeCanvas.dataset.paintCount || 0) : 0;
    const now = performance.now();
    paintTotal.value = total;
    if (lastPaintAt && total >= lastPaintTotal && now > lastPaintAt) {
      paintRate.value = Math.round(((total - lastPaintTotal) * 1000) / (now - lastPaintAt));
    }
    lastPaintTotal = total;
    lastPaintAt = now;
  }
}

onMounted(() => {
  raf = requestAnimationFrame(tick);
});

onBeforeUnmount(() => {
  cancelAnimationFrame(raf);
  deltas.length = 0;
});
</script>

<template>
  <div class="canvasPerfHud" aria-hidden="true">
    <span>FPS {{ fps }}</span>
    <span>平均 {{ avgMs }}ms</span>
    <span>最长 {{ maxMs }}ms</span>
    <span>慢帧 {{ slowFrames }}/240</span>
    <span>节点 {{ nodes }}</span>
    <span>边 {{ edges }}</span>
    <span>边元素 {{ edgeElements }}</span>
    <span>path {{ pathCount }}</span>
    <span>边根 {{ edgeRoots }}</span>
    <span>描边 {{ paintTotal }}·{{ paintRate }}/s</span>
    <span>DOM {{ domCount }}</span>
    <span>will-change {{ willChange }}</span>
    <span>层N {{ nodesDisplay }} / E {{ edgesDisplay }}</span>
    <span>主线程 {{ timerLag }}ms</span>
    <span v-if="moving">移动中</span>
    <button type="button" class="perfButton" :disabled="benchState === 'running'" @click="runCompositingBenchmark">合成基准</button>
    <span v-if="benchResult">{{ benchResult }}</span>
    <label class="perfToggle"><input v-model="hideEdgesWhileMoving" type="checkbox" />移动时隐藏连线</label>
    <label class="perfToggle"><input v-model="hideNodesWhileMoving" type="checkbox" />移动时隐藏节点</label>
    <label class="perfToggle"><input v-model="hideMapWhileMoving" type="checkbox" />移动时隐藏地图</label>
    <label class="perfToggle"><input v-model="hideBackgroundWhileMoving" type="checkbox" />移动时隐藏背景</label>
  </div>
</template>

<style scoped lang="scss">
.canvasPerfHud {
  position: absolute;
  top: 8px;
  left: 8px;
  z-index: 20;
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  max-width: 520px;
  padding: 4px 8px;
  border-radius: 6px;
  background: rgb(0 0 0 / 55%);
  color: #b6f09c;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  line-height: 1.5;
  pointer-events: none;
  user-select: none;

  .perfButton {
    padding: 0 6px;
    border: 1px solid rgb(182 240 156 / 45%);
    border-radius: 4px;
    background: transparent;
    color: inherit;
    font: inherit;
    line-height: 1.4;
    pointer-events: auto;
    cursor: pointer;
  }

  .perfToggle {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    pointer-events: auto;
    cursor: pointer;

    input {
      width: 11px;
      height: 11px;
      margin: 0;
    }
  }
}
</style>
