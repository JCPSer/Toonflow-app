import { describe, expect, test } from "bun:test";
import { findFreeY, findSpawnPosition } from "./spawnBesideNode";

const anchor = { x: 100, y: 200, width: 300, height: 180 };

describe("findSpawnPosition", () => {
  test("空画布放在锚点右侧，顶部对齐", () => {
    expect(findSpawnPosition(anchor, [], { width: 320, height: 300, gapX: 80 })).toEqual({ x: 480, y: 200 });
  });

  test("右侧已有同列节点时向下顺延", () => {
    const occupied = [{ x: 480, y: 200, width: 320, height: 300 }];
    expect(findSpawnPosition(anchor, occupied, { width: 320, height: 300, gapX: 80, gapY: 40 }))
      .toEqual({ x: 480, y: 540 });
  });

  test("多个相交节点时跳过最低底边", () => {
    const occupied = [
      { x: 480, y: 200, width: 320, height: 300 },
      { x: 500, y: 560, width: 200, height: 200 },
    ];
    expect(findSpawnPosition(anchor, occupied, { width: 320, height: 300, gapX: 80, gapY: 40 }))
      .toEqual({ x: 480, y: 800 });
  });

  test("x 区间不相交的节点不影响摆放", () => {
    const occupied = [{ x: 2000, y: 200, width: 300, height: 800 }];
    expect(findSpawnPosition(anchor, occupied, { width: 320, height: 300 })).toEqual({ x: 480, y: 200 });
  });

  test("上方不重叠的节点不会触发下推", () => {
    const occupied = [{ x: 480, y: -400, width: 320, height: 300 }];
    expect(findSpawnPosition(anchor, occupied, { width: 320, height: 300 })).toEqual({ x: 480, y: 200 });
  });

  test("吸附网格时先吸附 x 再判断碰撞", () => {
    // 锚点右边界 401 + 80 = 481，吸附到 480；右侧节点从 480 开始，必须避让。
    const occupied = [{ x: 480, y: 200, width: 320, height: 320 }];
    expect(findSpawnPosition({ ...anchor, x: 101 }, occupied, { width: 320, height: 320, gapX: 80, gapY: 40, grid: 16 }))
      .toEqual({ x: 480, y: 560 });
  });

  test("仅边缘相接不算重叠", () => {
    const occupied = [{ x: 480, y: 500, width: 320, height: 300 }];
    expect(findSpawnPosition(anchor, occupied, { width: 320, height: 300, gapY: 40 })).toEqual({ x: 480, y: 200 });
  });
});

describe("findFreeY", () => {
  test("保持给定的 x，只向下找空位", () => {
    const occupied = [{ x: 400, y: 300, width: 200, height: 200 }];
    expect(findFreeY(400, 300, 320, 300, occupied, { gapY: 40 })).toBe(540);
  });

  test("向下吸附向上取整，避免压回去", () => {
    const occupied = [{ x: 400, y: 300, width: 200, height: 205 }];
    expect(findFreeY(400, 300, 320, 300, occupied, { gapY: 40, grid: 16 })).toBe(560);
  });
});
