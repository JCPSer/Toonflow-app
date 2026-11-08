import type { GraphNode } from "@vue-flow/core";

type Point = { x: number; y: number };
type DragEventLike = MouseEvent | TouchEvent;

export type DragAxis = "x" | "y";

/** ACT: 位移较大的一轴为主轴；两轴相等时取水平，与 Figma/Sketch 一致。 */
export function dragAxis(pointer: Point, origin: Point): DragAxis {
  return Math.abs(pointer.x - origin.x) >= Math.abs(pointer.y - origin.y) ? "x" : "y";
}

/** ACT: 把主轴之外的坐标写回拖动起点，实现单轴锁定。 */
export function lockPoint(position: Point, start: Point, axis: DragAxis): Point {
  return axis === "x" ? { x: position.x, y: start.y } : { x: start.x, y: position.y };
}

function pointerOf(event: DragEventLike): Point | undefined {
  if ("clientX" in event) return { x: event.clientX, y: event.clientY };
  const touch = event.touches[0] ?? event.changedTouches[0];
  return touch ? { x: touch.clientX, y: touch.clientY } : undefined;
}

function shiftPressed(event: DragEventLike) {
  return "shiftKey" in event && event.shiftKey;
}

/**
 * ACT: Vue Flow 没有内置轴锁。拖动期间每帧按「指针相对按下点的位移」判定主轴，
 * 再把另一轴写回拖动起点的坐标；锚点固定为拖动开始时的位置，中途按下/松开 Shift 只切换是否约束。
 * 不依赖上一帧结果，避免写回被 Vue Flow 下一帧的原始位移覆盖后累积偏移。
 */
export function createAxisLock() {
  let origin: Point | undefined;
  let starts = new Map<string, Point>();

  return {
    /** 画布 pointerdown 时记录本次手势的指针起点；拖动进行中（锚点非空）不接受第二个指针覆盖。 */
    press(event: { clientX: number; clientY: number; button?: number }) {
      if (event.button !== undefined && event.button !== 0) return;
      if (starts.size) return;
      origin = { x: event.clientX, y: event.clientY };
      starts = new Map();
    },
    /** 拖动开始时记录每个被拖动节点的起始坐标（此时 Vue Flow 还没有应用第一段位移）。 */
    start(nodes: readonly GraphNode[]) {
      starts = new Map(nodes.map(node => [node.id, { x: node.position.x, y: node.position.y }]));
    },
    /** 按住 Shift 时锁轴；返回是否真的改写过节点坐标。 */
    apply(event: DragEventLike, nodes: readonly GraphNode[]) {
      if (!origin || !shiftPressed(event)) return false;
      const pointer = pointerOf(event);
      if (!pointer) return false;
      const axis = dragAxis(pointer, origin);
      let changed = false;
      for (const node of nodes) {
        const start = starts.get(node.id);
        if (!start) continue;
        const next = lockPoint(node.position, start, axis);
        if (next.x === node.position.x && next.y === node.position.y) continue;
        node.position = next;
        changed = true;
      }
      return changed;
    },
    /** 拖动结束/下一帧开始前清空锚点与指针起点。 */
    reset() {
      origin = undefined;
      starts = new Map();
    },
  };
}
