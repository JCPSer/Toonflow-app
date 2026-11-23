import { describe, expect, it } from "bun:test";
import type { Response } from "express";
import {
  abortBusRun, abortRunEverywhere, hasBus, isBusId, openBus, publishBus, registerBusRun, unregisterBusRun,
} from "./bus";

function fakeResponse() {
  const chunks: string[] = [];
  const handlers: Record<string, (() => void) | undefined> = {};
  const response = {
    destroyed: false,
    writableEnded: false,
    writableNeedDrain: false,
    statusCode: 0,
    chunks,
    status(code: number) { this.statusCode = code; return this; },
    set() { return this; },
    flushHeaders() {},
    write(text: string) { chunks.push(text); return true; },
    end() { this.writableEnded = true; },
    once(event: string, callback: () => void) { handlers[event] = callback; return this; },
    on(event: string, callback: () => void) { handlers[event] = callback; return this; },
    close() { handlers.close?.(); },
  };
  return response as unknown as Response & { chunks: string[]; close(): void };
}

describe("agent bus", () => {
  it("校验通道标识", () => {
    expect(isBusId("8c1f2d3e-4a5b-6c7d")).toBe(true);
    expect(isBusId("short")).toBe(false);
    expect(isBusId("bad id with space")).toBe(false);
  });

  it("按 runId 发布事件，未注册的运行被忽略", () => {
    const response = fakeResponse();
    const id = "bus-test-publish";
    openBus(id, response);
    expect(hasBus(id)).toBe(true);
    publishBus(id, "run-1", { type: "done" });
    publishBus("missing-bus", "run-1", { type: "done" });
    const lines = response.chunks.filter(chunk => chunk.trim());
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toEqual({ runId: "run-1", event: { type: "done" } });
    response.close();
    expect(hasBus(id)).toBe(false);
  });

  it("连接关闭时中止该通道上的所有运行", () => {
    const response = fakeResponse();
    const id = "bus-test-abort";
    openBus(id, response);
    const controller = new AbortController();
    registerBusRun(id, "run-x", controller);
    expect(abortBusRun(id, "run-y")).toBe(false);
    expect(abortBusRun(id, "run-x")).toBe(true);
    expect(controller.signal.aborted).toBe(true);

    const second = new AbortController();
    registerBusRun(id, "run-z", second);
    unregisterBusRun(id, "run-z");
    expect(abortRunEverywhere("run-z")).toBe(false);

    const third = new AbortController();
    registerBusRun(id, "run-w", third);
    response.close();
    expect(third.signal.aborted).toBe(true);
  });

  it("重复连接会替换旧通道并中止旧运行", () => {
    const first = fakeResponse();
    const second = fakeResponse();
    openBus("bus-test-replace", first);
    const controller = new AbortController();
    registerBusRun("bus-test-replace", "run-old", controller);
    openBus("bus-test-replace", second);
    expect(controller.signal.aborted).toBe(true);
    expect(first.writableEnded).toBe(true);
    // 旧连接的 close 在替换后才到达，不能把新总线一起关掉。
    first.close();
    expect(hasBus("bus-test-replace")).toBe(true);
    publishBus("bus-test-replace", "run-new", { type: "done" });
    expect(second.chunks.filter(chunk => chunk.trim())).toHaveLength(1);
    second.close();
    expect(hasBus("bus-test-replace")).toBe(false);
  });
});
