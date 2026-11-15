/** ACT: Agent 之间的临时关系线。只存在于任务期间，不写入画布 JSON。 */
export type AgentLinkStatus = "queued" | "running" | "completed" | "cancelled" | "failed";
export type AgentLinkKind = "dispatch" | "result";

export type AgentLink = {
  id: string;
  taskId: string;
  fromNodeId: string;
  toNodeId: string;
  kind: AgentLinkKind;
  status: AgentLinkStatus;
  /** 悬停摘要用的任务文本（截断）。 */
  message: string;
  createdAt: number;
};

export type LinkNodeRect = {
  position: { x: number; y: number };
  computedPosition?: { x: number; y: number };
  dimensions?: { width: number; height: number };
  width?: unknown;
  height?: unknown;
};

function anchor(node: LinkNodeRect, side: "left" | "right") {
  // ACT: group 内节点只有 computedPosition 是绝对坐标；缺失时由调用方跳过，不退回父组相对坐标。
  const position = node.computedPosition!;
  const rawWidth = node.dimensions?.width ?? node.width;
  const rawHeight = node.dimensions?.height ?? node.height;
  const width = typeof rawWidth === "number" && rawWidth > 0 ? rawWidth : 300;
  const height = typeof rawHeight === "number" && rawHeight > 0 ? rawHeight : 120;
  return { x: position.x + (side === "right" ? width : 0), y: position.y + height / 2 };
}

/** ACT: 纯几何计算，便于单测覆盖缩放/偏移/左右方向。屏幕坐标 = 节点坐标 × zoom + viewport。 */
export function computeAgentLinkPath(from: LinkNodeRect, to: LinkNodeRect, viewport: { x: number; y: number; zoom: number }) {
  if (!from.computedPosition || !to.computedPosition) return undefined;
  const fromCenter = anchor(from, "right");
  const toCenter = anchor(to, "left");
  const targetIsRight = toCenter.x >= fromCenter.x;
  const start = anchor(from, targetIsRight ? "right" : "left");
  const end = anchor(to, targetIsRight ? "left" : "right");
  const sx = start.x * viewport.zoom + viewport.x;
  const sy = start.y * viewport.zoom + viewport.y;
  const ex = end.x * viewport.zoom + viewport.x;
  const ey = end.y * viewport.zoom + viewport.y;
  const span = Math.max(40, Math.min(180, Math.abs(ex - sx) * 0.5));
  const bend = targetIsRight ? span : -span;
  return {
    d: `M ${sx} ${sy} C ${sx + bend} ${sy}, ${ex - bend} ${ey}, ${ex} ${ey}`,
    tipX: (sx + ex) / 2,
    tipY: (sy + ey) / 2 - 12,
  };
}
