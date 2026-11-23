<template>
  <div v-if="paths.length" class="agentLinkLayer" :class="{ paused, flowOff: !animateFlow }" aria-hidden="true">
    <svg class="agentLinkSvg">
      <defs>
        <marker v-for="status in STATUSES" :id="markerId(status)" :key="status" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" :fill="COLORS[status]" />
        </marker>
      </defs>
      <g v-for="link in paths" :key="link.id">
        <!-- ACT: 命中区只用来做 isPointInStroke 命中测试，不接收指针事件，避免挡住画布拖拽/滚轮。 -->
        <path :ref="element => setPathElement(link.id, element)" :d="link.d" class="agentLinkHit" />
        <path
          :d="link.d"
          class="agentLinkLine"
          :class="[`is-${link.status}`, `is-${link.kind}`]"
          :stroke="COLORS[link.status]"
          :marker-end="`url(#${markerId(link.status)})`" />
      </g>
    </svg>
    <div v-if="hovered" class="agentLinkTip" :style="tipStyle">
      <span class="agentLinkTipTitle">{{ hovered.fromLabel }} → {{ hovered.toLabel }}</span>
      <span class="agentLinkTipStatus">{{ STATUS_LABELS[hovered.status] }} · {{ hovered.kind === "result" ? "结果回传" : "任务派发" }}</span>
      <span v-if="hovered.message" class="agentLinkTipMessage">{{ hovered.message }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId, watch } from "vue";
import { computeAgentLinkPath, type AgentLink, type AgentLinkStatus } from "../agentLinks";

/** Vue Flow 运行时节点带 computedPosition/dimensions，但公开类型里没有，用结构类型收敛。 */
type NodeLike = {
  id: string;
  position: { x: number; y: number };
  computedPosition?: { x: number; y: number };
  dimensions?: { width: number; height: number };
  width?: unknown;
  height?: unknown;
  data?: Record<string, unknown>;
};

/**
 * ACT: 画布关系层。Agent 节点没有输出端口，用叠加层按节点位置画临时箭头，
 * 不写进 Vue Flow 的边集合，因此不影响连线校验、删除和画布保存。
 */
const props = defineProps<{
  links: AgentLink[];
  nodes: NodeLike[];
  viewport: { x: number; y: number; zoom: number };
  /** 画布根元素：用于在不拦截事件的前提下做悬停命中测试。 */
  pointerSource?: HTMLElement;
  /** 平移/缩放/拖动节点/画布在后台：暂停流动动画，避免和手势抢重绘。 */
  paused?: boolean;
  /** 跟随「节点连线动画」设置：关掉后关系线也保持静态虚线。 */
  animate?: boolean;
}>();

/**
 * ACT: 流动虚线用的是 stroke-dashoffset 动画，浏览器每一帧都要重绘整段 path 的包围盒；
 * 一条关系线横跨几千像素时，这就是每帧一次大面积重绘（实测会把 WKWebView 的 GPU 进程顶到高位）。
 * 两道降级：动画从每帧改成 10Hz 离散跳变（视觉仍是流动虚线），
 * 关系线超过 16 条时直接不流动，避免任务风暴时画面被动画拖死。
 */
const FLOW_ANIMATED_LIMIT = 16;
const animateFlow = computed(() => props.animate !== false && props.links.length <= FLOW_ANIMATED_LIMIT);

const STATUSES: AgentLinkStatus[] = ["queued", "running", "completed", "cancelled", "failed"];
const COLORS: Record<AgentLinkStatus, string> = {
  queued: "#909399",
  running: "var(--el-color-primary)",
  completed: "var(--el-color-success)",
  cancelled: "var(--el-color-warning)",
  failed: "var(--el-color-danger)",
};
const STATUS_LABELS: Record<AgentLinkStatus, string> = {
  queued: "排队中",
  running: "运行中",
  completed: "已完成",
  cancelled: "已取消",
  failed: "失败",
};
const hoverId = ref("");
// ACT: 多画布宿主会让隐藏画布保持挂载；marker id 必须按实例隔离，否则 url(#id) 会解析到隐藏实例。
const uid = useId();
const markerId = (status: AgentLinkStatus) => `agentLinkArrow-${uid}-${status}`;
const pathElements = new Map<string, SVGPathElement>();
function setPathElement(id: string, element: unknown) {
  if (element instanceof SVGPathElement) pathElements.set(id, element);
  else pathElements.delete(id);
}

// ACT: 关系线悬停要对每条线做 isPointInStroke，指针每秒几十上百次事件时没必要逐次算。
// 合并到一帧一次，并缓存画布 rect（画布位置只在窗口尺寸变化时变）。
let hoverFrame = 0;
let pointerAt: { x: number; y: number } | undefined;
let sourceRect: DOMRect | undefined;
function onPointerMove(event: PointerEvent) {
  const source = props.pointerSource;
  if (!source || !paths.value.length) {
    hoverId.value = "";
    return;
  }
  pointerAt = { x: event.clientX, y: event.clientY };
  if (hoverFrame) return;
  hoverFrame = requestAnimationFrame(() => {
    hoverFrame = 0;
    const point = pointerAt;
    if (!point) return;
    if (!sourceRect) sourceRect = source.getBoundingClientRect();
    const x = point.x - sourceRect.left;
    const y = point.y - sourceRect.top;
    for (const link of paths.value) {
      const path = pathElements.get(link.id);
      if (path && path.isPointInStroke(new DOMPoint(x, y))) {
        hoverId.value = link.id;
        return;
      }
    }
    hoverId.value = "";
  });
}
function onPointerLeave() {
  hoverId.value = "";
  pointerAt = undefined;
  if (hoverFrame) { cancelAnimationFrame(hoverFrame); hoverFrame = 0; }
}
function onWindowResize() { sourceRect = undefined; }
function detach() {
  const source = props.pointerSource;
  if (!source) return;
  source.removeEventListener("pointermove", onPointerMove);
  source.removeEventListener("pointerleave", onPointerLeave);
  sourceRect = undefined;
}
window.addEventListener("resize", onWindowResize, { passive: true });
watch(() => props.pointerSource, source => {
  detach();
  source?.addEventListener("pointermove", onPointerMove, { passive: true });
  source?.addEventListener("pointerleave", onPointerLeave, { passive: true });
}, { immediate: true });
onBeforeUnmount(() => {
  detach();
  window.removeEventListener("resize", onWindowResize);
  if (hoverFrame) { cancelAnimationFrame(hoverFrame); hoverFrame = 0; }
});

const nodeMap = computed(() => new Map(props.nodes.map(node => [node.id, node])));

type PathInfo = AgentLink & {
  d: string; tipX: number; tipY: number;
  fromLabel: string; toLabel: string;
};


const paths = computed<PathInfo[]>(() => props.links.flatMap(link => {
  const from = nodeMap.value.get(link.fromNodeId);
  const to = nodeMap.value.get(link.toNodeId);
  if (!from || !to || link.fromNodeId === link.toNodeId) return [];
  const geometry = computeAgentLinkPath(from, to, props.viewport);
  if (!geometry) return [];
  return [{
    ...link, ...geometry,
    fromLabel: typeof from.data?.label === "string" ? from.data.label : link.fromNodeId,
    toLabel: typeof to.data?.label === "string" ? to.data.label : link.toNodeId,
  }];
}));

const hovered = computed(() => paths.value.find(link => link.id === hoverId.value));
// ACT: 靠边时把气泡钳进画布，靠近顶部时翻到线下方，避免被 overflow 裁掉。
const tipStyle = computed(() => {
  const link = hovered.value;
  if (!link) return {};
  const width = props.pointerSource?.clientWidth ?? 0;
  const left = Math.min(Math.max(link.tipX, 130), Math.max(130, width - 130));
  const above = link.tipY > 80;
  return {
    left: `${left}px`,
    top: `${above ? link.tipY : link.tipY + 24}px`,
    transform: above ? "translate(-50%, -100%)" : "translate(-50%, 0)",
  };
});
</script>

<style lang="scss" scoped>
.agentLinkLayer {
  position: absolute;
  inset: 0;
  z-index: 4;
  overflow: hidden;
  pointer-events: none;
}

.agentLinkSvg {
  width: 100%;
  height: 100%;
  overflow: visible;
}

.agentLinkHit {
  fill: none;
  stroke: transparent;
  stroke-width: 14;
  pointer-events: none;
}

.agentLinkLine {
  fill: none;
  stroke-width: 1.6;
  stroke-dasharray: 5 4;
  // ACT: steps(11) 把连续插值变成 10Hz 跳变，重绘频率降到 1/6，视觉上仍是流动虚线。
  animation: agentLinkFlow 1.1s steps(11) infinite;

  &.is-completed,
  &.is-cancelled,
  &.is-failed {
    stroke-dasharray: none;
    animation: none;
  }

  &.is-result {
    stroke-dasharray: 2 5;
  }
}

@media (prefers-reduced-motion: reduce) {
  .agentLinkLine {
    animation: none !important;
  }
}

.agentLinkLayer.paused .agentLinkLine,
.agentLinkLayer.flowOff .agentLinkLine {
  animation-play-state: paused;
}

.agentLinkLayer.flowOff .agentLinkLine {
  animation: none;
}

@keyframes agentLinkFlow {
  from { stroke-dashoffset: 18; }
  to { stroke-dashoffset: 0; }
}

.agentLinkTip {
  position: absolute;
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-width: 260px;
  padding: 6px 8px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 6px;
  background: var(--el-bg-color-overlay);
  box-shadow: var(--el-box-shadow-light);
  color: var(--el-text-color-regular);
  font-size: 12px;
  line-height: 1.5;
  transform: translate(-50%, -100%);
  pointer-events: none;

  .agentLinkTipTitle {
    color: var(--el-text-color-primary);
    font-weight: 500;
  }

  .agentLinkTipStatus {
    color: var(--el-text-color-secondary);
  }

  .agentLinkTipMessage {
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
    word-break: break-word;
  }
}
</style>
