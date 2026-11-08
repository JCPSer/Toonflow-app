import type { XYPosition } from "@vue-flow/core";
import { snapOffset, snapValue } from "./snapNodes";

export type SpawnRect = { x: number; y: number; width: number; height: number };

export type SpawnOptions = {
  /** 新节点自身尺寸；挂载前只能估算。 */
  width?: number;
  height?: number;
  gapX?: number;
  gapY?: number;
  /** 网格大小；省略或非正数时不吸附。 */
  grid?: number;
};

const defaultSpawnWidth = 360;
const defaultSpawnHeight = 320;
const defaultGapX = 80;
const defaultGapY = 40;

function overlaps(a: SpawnRect, b: SpawnRect) {
  // 半开区间：仅边缘相接不算重叠。
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/**
 * 在固定 x 列上从 startY 开始找不与其他矩形重叠的位置，遇到冲突只向下移动。
 * 每次跳过相交节点里最低的底边；gapY 要大于半个网格，吸附后不会重新压回去。
 */
export function findFreeY(x: number, startY: number, width: number, height: number,
  occupied: readonly SpawnRect[], options: Pick<SpawnOptions, "gapY" | "grid"> = {}) {
  const gapY = options.gapY ?? defaultGapY;
  const grid = options.grid && options.grid > 0 ? options.grid : undefined;
  let y = grid ? snapValue(startY, grid) : startY;
  for (let guard = 0; guard < 10_000; guard++) {
    const candidate = { x, y, width, height };
    let bottom: number | undefined;
    for (const rect of occupied) {
      if (!overlaps(candidate, rect)) continue;
      bottom = bottom === undefined ? rect.y + rect.height : Math.max(bottom, rect.y + rect.height);
    }
    if (bottom === undefined) return y;
    const next = bottom + gapY;
    y = grid ? snapOffset(next, grid) : next;
  }
  throw new Error("节点附近没有可用的摆放位置");
}

/**
 * 就近摆放：锚点右侧一列、顶部对齐，向下避让已有节点。
 * x 先吸附再参与碰撞判定，避免吸附半格后重新压到右侧节点。
 */
export function findSpawnPosition(anchor: SpawnRect, occupied: readonly SpawnRect[], options: SpawnOptions = {}): XYPosition {
  const width = options.width ?? defaultSpawnWidth;
  const height = options.height ?? defaultSpawnHeight;
  const gapX = options.gapX ?? defaultGapX;
  const grid = options.grid && options.grid > 0 ? options.grid : undefined;
  const x = grid ? snapValue(anchor.x + anchor.width + gapX, grid) : anchor.x + anchor.width + gapX;
  const y = findFreeY(x, anchor.y, width, height, occupied, { gapY: options.gapY, grid });
  return { x, y };
}
