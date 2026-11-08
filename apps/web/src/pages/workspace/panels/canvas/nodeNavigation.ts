export type NavDirection = "up" | "down" | "left" | "right";

export type NavPoint = { x: number; y: number };
export type NavRect = { x: number; y: number; width: number; height: number };

/** 只声明导航用得到的字段，宿主直接传 GraphNode 即可（结构兼容）。 */
export type NavigationNode = {
  id: string;
  type?: string | null;
  position: NavPoint;
  computedPosition?: NavPoint;
  dimensions?: { width: number; height: number };
  hidden?: boolean;
  selected?: boolean;
  selectable?: boolean;
};

const directionVectors: Record<NavDirection, NavPoint> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

const emptyExcluded: ReadonlySet<string> = new Set();

// ACT: 只认已测量的计算坐标；resize 前的节点宽高为 0，直接按左上角参与评分即可，不能跳过。
export function nodeRect(node: NavigationNode): NavRect {
  const position = node.computedPosition ?? node.position;
  return {
    x: position.x,
    y: position.y,
    width: node.dimensions?.width ?? 0,
    height: node.dimensions?.height ?? 0,
  };
}

export function boundingRect(nodes: readonly NavigationNode[]): NavRect | undefined {
  if (!nodes.length) return undefined;
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const node of nodes) {
    const rect = nodeRect(node);
    left = Math.min(left, rect.x);
    top = Math.min(top, rect.y);
    right = Math.max(right, rect.x + rect.width);
    bottom = Math.max(bottom, rect.y + rect.height);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function rectCenter(rect: NavRect): NavPoint {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/** 点到矩形的最短距离；点落在矩形内为 0。 */
export function rectDistance(rect: NavRect, point: NavPoint): number {
  const dx = Math.max(rect.x - point.x, 0, point.x - (rect.x + rect.width));
  const dy = Math.max(rect.y - point.y, 0, point.y - (rect.y + rect.height));
  return Math.hypot(dx, dy);
}

function isCandidate(node: NavigationNode, excluded: ReadonlySet<string>) {
  // ACT: 分组是大块背景，参与导航会频繁选中整块；已选中的节点也要排除，否则反复按同一个方向键会在原地打转。
  return !excluded.has(node.id)
    && node.type !== "canvasGroup"
    && node.hidden !== true
    && node.selectable !== false
    && node.selected !== true;
}

function compareKeys(left: (number | string)[], right: (number | string)[]) {
  for (let index = 0; index < Math.min(left.length, right.length); index++) {
    const a = left[index]!;
    const b = right[index]!;
    if (a === b) continue;
    return a < b ? -1 : 1;
  }
  return 0;
}

/**
 * 方向锥（±45°）内取下一个节点。
 * 评分 = 中心距离 + 横向偏移：先保证「大致在正前方」，再保证「离得近」；
 * 同分依次比较横向偏移、距离、id，保证同一画布上结果稳定可复现。
 */
export function pickNodeInDirection<T extends NavigationNode>(
  nodes: readonly T[],
  origin: NavPoint,
  direction: NavDirection,
  excluded: ReadonlySet<string> = emptyExcluded,
): T | undefined {
  const vector = directionVectors[direction];
  let best: T | undefined;
  let bestKey: (number | string)[] | undefined;
  for (const node of nodes) {
    if (!isCandidate(node, excluded)) continue;
    const center = rectCenter(nodeRect(node));
    const dx = center.x - origin.x;
    const dy = center.y - origin.y;
    const forward = dx * vector.x + dy * vector.y;
    if (forward <= 0) continue;
    const perpendicular = Math.abs(dx * vector.y - dy * vector.x);
    // ACT: 严格 ±45°。边界允许相等，斜向排布（正好 45°）的节点仍可达。
    if (perpendicular > forward) continue;
    const distance = Math.hypot(dx, dy);
    const key: (number | string)[] = [distance + perpendicular, perpendicular, distance, node.id];
    if (!bestKey || compareKeys(key, bestKey) < 0) {
      best = node;
      bestKey = key;
    }
  }
  return best;
}

/** 最近节点：按到矩形的最短距离，没有选中时用来确定起点。 */
export function pickNodeNearestPoint<T extends NavigationNode>(
  nodes: readonly T[],
  point: NavPoint,
  excluded: ReadonlySet<string> = emptyExcluded,
): T | undefined {
  let best: T | undefined;
  let bestKey: (number | string)[] | undefined;
  for (const node of nodes) {
    if (!isCandidate(node, excluded)) continue;
    const rect = nodeRect(node);
    const gap = rectDistance(rect, point);
    const center = rectCenter(rect);
    const key: (number | string)[] = [gap, Math.hypot(center.x - point.x, center.y - point.y), node.id];
    if (!bestKey || compareKeys(key, bestKey) < 0) {
      best = node;
      bestKey = key;
    }
  }
  return best;
}
