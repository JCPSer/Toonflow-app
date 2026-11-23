import { Position, getSimpleBezierPath } from "@vue-flow/core";
import { edgeIntersectsViewBox, type ViewBox } from "./edgeVisibility";

/**
 * ACT: 连线从「每条边一个 SVG 根」改成单张 Canvas 位图（架构级改造，见
 * bug_solution-2026-11-22-09-30-canvas-render-arch.md）。这里只放纯几何与坐标换算，不碰 DOM，
 * 方便单测；绘制与缓存由 edgeCanvasLayer.vue 负责。
 *
 * 几何必须与 @vue-flow/core 完全一致，否则线条会与节点端口错位：
 * - 端点取 handleBounds 里对应 handle 的锚点，算法与库内 getHandlePosition 相同；
 * - 曲线用库导出的 getSimpleBezierPath，保证曲率一致。
 */

export type Point = { x: number; y: number };
export type Box = { width: number; height: number };
export type Transform = { x: number; y: number; zoom: number };

export type HandleLike = {
  id?: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  position?: Position;
};

export type NodeGeometryLike = {
  id: string;
  position: Point;
  computedPosition?: Point;
  dimensions?: Box;
  handleBounds?: { source?: HandleLike[] | null; target?: HandleLike[] | null } | null;
};

/**
 * 与库内 getHandlePosition 同构：handle 缺省时按节点盒 + 兜底方位算。
 * 库内实现（edge wrapper 调 getHandlePosition）的兜底是 source=Bottom / target=Top。
 */
export function handleAnchor(node: NodeGeometryLike, handle: HandleLike | null | undefined, fallback: Position = Position.Left): Point {
  const origin = node.computedPosition ?? node.position;
  const dimensions = node.dimensions ?? { width: 0, height: 0 };
  const x = (handle?.x ?? 0) + origin.x;
  const y = (handle?.y ?? 0) + origin.y;
  const width = handle?.width ?? dimensions.width;
  const height = handle?.height ?? dimensions.height;
  switch (handle?.position ?? fallback) {
    case Position.Top:
      return { x: x + width / 2, y };
    case Position.Right:
      return { x: x + width, y: y + height / 2 };
    case Position.Bottom:
      return { x: x + width / 2, y: y + height };
    default:
      return { x, y: y + height / 2 };
  }
}

export function pickHandle(handles: HandleLike[] | null | undefined, handleId?: string | null) {
  if (!handles?.length) return undefined;
  return handleId ? handles.find(handle => handle.id === handleId) : handles[0];
}

export type EdgeGeometry = {
  id: string;
  d: string;
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  box: ViewBox;
};

export type EdgeInput = { id: string; source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null };

/**
 * 生成一批边的路径数据。`keepBox` 之外的边直接丢弃（画布坐标判定，与 SVG 版 culling 同一套近似）。
 */
export function buildEdgeGeometries(
  edges: readonly EdgeInput[],
  nodes: ReadonlyMap<string, NodeGeometryLike>,
  keepBox: ViewBox,
): EdgeGeometry[] {
  const result: EdgeGeometry[] = [];
  for (const edge of edges) {
    const sourceNode = nodes.get(edge.source);
    const targetNode = nodes.get(edge.target);
    if (!sourceNode || !targetNode) continue;
    const sourceHandle = pickHandle(sourceNode.handleBounds?.source, edge.sourceHandle);
    const targetHandle = pickHandle(targetNode.handleBounds?.target, edge.targetHandle);
    const sourcePosition = sourceHandle?.position ?? Position.Bottom;
    const targetPosition = targetHandle?.position ?? Position.Top;
    const source = handleAnchor(sourceNode, sourceHandle, sourcePosition);
    const target = handleAnchor(targetNode, targetHandle, targetPosition);
    if (!edgeIntersectsViewBox(source.x, source.y, target.x, target.y, keepBox)) continue;
    const [d] = getSimpleBezierPath({
      sourceX: source.x,
      sourceY: source.y,
      sourcePosition,
      targetX: target.x,
      targetY: target.y,
      targetPosition,
    });
    // simplebezier 的控制点在端点包围盒内，包围盒是曲线的精确覆盖。
    result.push({
      id: edge.id,
      d,
      sourceX: source.x,
      sourceY: source.y,
      targetX: target.x,
      targetY: target.y,
      box: {
        x1: Math.min(source.x, target.x),
        y1: Math.min(source.y, target.y),
        x2: Math.max(source.x, target.x),
        y2: Math.max(source.y, target.y),
      },
    });
  }
  return result;
}

/**
 * 位图跟随视口。
 *
 * 位图起点位于画布坐标 `rect.x / rect.y`，位图每画布单位占 `raster.scale` 个 CSS 像素。
 * 当前视口下，位图像素 p（栅格时的屏幕像素）对应屏幕：
 *   p * k + rect.x * V.zoom + V.x
 * 所以元素定位 `left:0; top:0`、`transform-origin: 0 0` 时只需
 *   translate(tx, ty) scale(k)
 * 平移时 k=1 → 纯合成；缩放时整体拉伸 → 仍是纯合成，手势结束再重绘恢复清晰度。
 */
export function canvasFollowTransform(
  raster: { scale: number; rect: { x: number; y: number } },
  viewport: Transform,
) {
  // `scale` 是位图的「CSS 像素 / 画布单位」，正常情况下等于生成时的 zoom；
  // 像素面积超限时会低于 zoom（位图降采样），此时 k > 1 由浏览器拉伸回来。
  const k = viewport.zoom / raster.scale;
  return {
    k,
    tx: raster.rect.x * viewport.zoom + viewport.x,
    ty: raster.rect.y * viewport.zoom + viewport.y,
  };
}

/** 屏幕坐标 → 画布坐标。 */
export function toCanvasPoint(client: Point, viewport: Transform): Point {
  return { x: (client.x - viewport.x) / viewport.zoom, y: (client.y - viewport.y) / viewport.zoom };
}
