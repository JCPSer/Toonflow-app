import type { ViewBox } from "./edgeVisibility";

/**
 * ACT: 节点内容分级渲染（架构级，见 bug_solution-2026-11-22-09-30-canvas-render-arch.md）。
 * 视口外的节点保留 DOM 与运行态，只让 `.contentCard` 走 content-visibility: hidden，
 * 跳过整棵内容子树的样式计算与绘制。判定放在手势结束，不在平移中逐帧做。
 *
 * 这里只做纯几何与集合运算，DOM 读写由调用方负责（先读尺寸、再写类名，避免同步布局）。
 */
export type TierNodeBox = { id: string; x: number; y: number; width: number; height: number };

export type TierPlan = { demote: string[]; restore: string[] };

export function intersectsViewBox(box: TierNodeBox, view: ViewBox) {
  return box.x <= view.x2 && box.x + box.width >= view.x1 && box.y <= view.y2 && box.y + box.height >= view.y1;
}

/**
 * 两级视口框做迟滞：出 `renderBox`（视口外扩大）才降级，进 `restoreBox`（视口外扩小）才恢复，
 * 中间那圈宽度内维持原状态，避免节点在边界附近反复降级/恢复。
 * 必须 `renderBox ⊃ restoreBox`：反过来会出现「恢复当帧又被降级」的抖动。
 *
 * 未测量（宽或高为 0）的节点不降级：拿不到 `contain-intrinsic-size`，
 * 降级会让盒子塌成 0，反而污染 Vue Flow 的节点尺寸与端口坐标。
 */
export function planNodeTiers(
  nodes: readonly TierNodeBox[],
  renderBox: ViewBox,
  restoreBox: ViewBox,
  current: ReadonlySet<string>,
): TierPlan {
  const demote: string[] = [];
  const restore: string[] = [];
  for (const node of nodes) {
    if (node.width <= 0 || node.height <= 0) continue;
    if (current.has(node.id)) {
      if (intersectsViewBox(node, restoreBox)) restore.push(node.id);
      continue;
    }
    if (!intersectsViewBox(node, renderBox)) demote.push(node.id);
  }
  return { demote, restore };
}
