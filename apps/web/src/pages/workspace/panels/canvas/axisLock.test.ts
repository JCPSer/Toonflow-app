import { describe, expect, test } from "bun:test";
import type { GraphNode } from "@vue-flow/core";
import { createAxisLock, dragAxis, lockPoint } from "./axisLock";

function node(id: string, x: number, y: number) {
  return { id, position: { x, y } } as unknown as GraphNode;
}

function pointer(clientX: number, clientY: number, shiftKey = true) {
  return { clientX, clientY, shiftKey } as MouseEvent;
}

describe("dragAxis", () => {
  test("位移较大的一轴为主轴", () => {
    expect(dragAxis({ x: 130, y: 110 }, { x: 100, y: 100 })).toBe("x");
    expect(dragAxis({ x: 110, y: 130 }, { x: 100, y: 100 })).toBe("y");
  });

  test("两轴相等取水平，负方向按绝对位移比较", () => {
    expect(dragAxis({ x: 120, y: 120 }, { x: 100, y: 100 })).toBe("x");
    expect(dragAxis({ x: 60, y: 100 }, { x: 100, y: 100 })).toBe("x");
    expect(dragAxis({ x: 100, y: 60 }, { x: 100, y: 100 })).toBe("y");
  });

  test("没有位移时取水平，不会在两根轴之间抖动", () => {
    expect(dragAxis({ x: 100, y: 100 }, { x: 100, y: 100 })).toBe("x");
  });
});

describe("lockPoint", () => {
  test("水平锁定时纵坐标保持起点", () => {
    expect(lockPoint({ x: 180, y: 140 }, { x: 100, y: 100 }, "x")).toEqual({ x: 180, y: 100 });
  });

  test("垂直锁定时横坐标保持起点", () => {
    expect(lockPoint({ x: 180, y: 140 }, { x: 100, y: 100 }, "y")).toEqual({ x: 100, y: 140 });
  });
});

describe("createAxisLock", () => {
  test("没有按下点时不锁轴", () => {
    const lock = createAxisLock();
    const target = node("a", 0, 0);
    lock.start([target]);
    expect(lock.apply(pointer(120, 100), [target])).toBe(false);
    expect(target.position).toEqual({ x: 0, y: 0 });
  });

  test("按住 Shift 时只保留主轴位移，另一轴回到起点", () => {
    const lock = createAxisLock();
    const target = node("a", 0, 0);
    lock.press({ clientX: 100, clientY: 100 });
    lock.start([target]);
    target.position = { x: 40, y: 12 };
    expect(lock.apply(pointer(130, 112), [target])).toBe(true);
    expect(target.position).toEqual({ x: 40, y: 0 });
  });

  test("松开 Shift 不写回，保持自由拖动", () => {
    const lock = createAxisLock();
    const target = node("a", 0, 0);
    lock.press({ clientX: 100, clientY: 100 });
    lock.start([target]);
    target.position = { x: 40, y: 12 };
    expect(lock.apply(pointer(130, 112, false), [target])).toBe(false);
    expect(target.position).toEqual({ x: 40, y: 12 });
  });

  test("越过对角线后主轴切换，另一轴弹回起点", () => {
    const lock = createAxisLock();
    const target = node("a", 0, 0);
    lock.press({ clientX: 100, clientY: 100 });
    lock.start([target]);
    target.position = { x: 60, y: 4 };
    lock.apply(pointer(160, 104), [target]);
    expect(target.position).toEqual({ x: 60, y: 0 });
    target.position = { x: 64, y: 50 };
    lock.apply(pointer(110, 160), [target]);
    expect(target.position).toEqual({ x: 0, y: 50 });
  });

  test("多个节点各自保留自己的起点坐标", () => {
    const lock = createAxisLock();
    const first = node("a", 10, 20);
    const second = node("b", -30, 8);
    lock.press({ clientX: 100, clientY: 100 });
    lock.start([first, second]);
    first.position = { x: 50, y: 36 };
    second.position = { x: 10, y: 24 };
    lock.apply(pointer(140, 116), [first, second]);
    expect(first.position).toEqual({ x: 50, y: 20 });
    expect(second.position).toEqual({ x: 10, y: 8 });
  });

  test("右键按下不会覆盖已在拖动中的起点", () => {
    const lock = createAxisLock();
    const target = node("a", 0, 0);
    lock.press({ clientX: 100, clientY: 100, button: 0 });
    lock.start([target]);
    lock.press({ clientX: 500, clientY: 500, button: 2 });
    target.position = { x: 40, y: 12 };
    lock.apply(pointer(130, 112), [target]);
    expect(target.position).toEqual({ x: 40, y: 0 });
  });

  test("拖动中第二个左键按下（多指针）不会清空锚点", () => {
    const lock = createAxisLock();
    const target = node("a", 0, 0);
    lock.press({ clientX: 100, clientY: 100, button: 0 });
    lock.start([target]);
    lock.press({ clientX: 500, clientY: 500, button: 0 });
    target.position = { x: 40, y: 12 };
    lock.apply(pointer(130, 112), [target]);
    expect(target.position).toEqual({ x: 40, y: 0 });
  });

  test("不在本次锚点里的节点保持原样", () => {
    const lock = createAxisLock();
    const target = node("a", 0, 0);
    const extra = node("b", 5, 5);
    lock.press({ clientX: 100, clientY: 100 });
    lock.start([target]);
    target.position = { x: 40, y: 12 };
    extra.position = { x: 9, y: 30 };
    expect(lock.apply(pointer(130, 112), [target, extra])).toBe(true);
    expect(extra.position).toEqual({ x: 9, y: 30 });
  });

  test("触摸事件按 touches[0] 取指针位置", () => {
    const lock = createAxisLock();
    const target = node("a", 0, 0);
    lock.press({ clientX: 100, clientY: 100 });
    lock.start([target]);
    target.position = { x: 40, y: 12 };
    const event = { touches: [{ clientX: 130, clientY: 112 }], changedTouches: [], shiftKey: true } as unknown as TouchEvent;
    expect(lock.apply(event, [target])).toBe(true);
    expect(target.position).toEqual({ x: 40, y: 0 });
  });

  test("reset 后锚点与指针起点都失效", () => {
    const lock = createAxisLock();
    const target = node("a", 0, 0);
    lock.press({ clientX: 100, clientY: 100 });
    lock.start([target]);
    lock.reset();
    target.position = { x: 40, y: 12 };
    expect(lock.apply(pointer(140, 112), [target])).toBe(false);
    expect(target.position).toEqual({ x: 40, y: 12 });
  });
});
