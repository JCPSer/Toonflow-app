/**
 * ACT: 大画布（几百条连线）里，视口外的边依然会生成完整 path、参与命中测试和重绘。
 * 这里只做纯几何判定，把「这条边是否可能出现在视口内」交给边组件决定是否渲染。
 * 用两端点的包围盒近似曲线范围：simplebezier 的控制点落在端点包围盒内（横向取 midY、纵向取 midX），
 * 曲线完全落在凸包内，包围盒是精确覆盖。换成默认 BezierEdge（curvature 偏移可超出端点框）时
 * 这个近似不成立，必须先扩展判定，不能直接复用。
 */
export type ViewBox = { x1: number; y1: number; x2: number; y2: number };

export function edgeIntersectsViewBox(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
  box: ViewBox,
) {
  const left = Math.min(sourceX, targetX);
  const right = Math.max(sourceX, targetX);
  const top = Math.min(sourceY, targetY);
  const bottom = Math.max(sourceY, targetY);
  return right >= box.x1 && left <= box.x2 && bottom >= box.y1 && top <= box.y2;
}

/**
 * 视口对应的画布坐标范围，四周各外扩半个视口。
 * ACT: 外扩是为了在平移/缩放过程中提前渲染即将进入视口的边，避免边突然出现；
 * 边只在外扩框变化时重新判定（调用方按 80ms 节流），不会跟着每一帧重算。
 */
export function viewBoxOfViewport(
  viewport: { x: number; y: number; zoom: number },
  dimensions: { width: number; height: number },
  marginRatio = 0.5,
): ViewBox | undefined {
  const { x, y, zoom } = viewport;
  const { width, height } = dimensions;
  if (!width || !height || !zoom) return undefined;
  // ACT: 写成 0 - x 而不是 -x：x=0 时 -x 是 -0，外扩后会把 -0 带进边界，比较与快照都不干净。
  const left = (0 - x) / zoom;
  const top = (0 - y) / zoom;
  const right = (width - x) / zoom;
  const bottom = (height - y) / zoom;
  const marginX = (right - left) * marginRatio;
  const marginY = (bottom - top) * marginRatio;
  return { x1: left - marginX, y1: top - marginY, x2: right + marginX, y2: bottom + marginY };
}
