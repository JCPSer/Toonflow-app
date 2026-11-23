import type { Response } from "express";
import type { AgentEvent } from "@/agent/runtime/types";

/**
 * ACT: Agent 事件总线。
 * WebKit 对同一 host 只开 6 条 HTTP/1.1 连接，而一个运行中的 Agent 会整轮占用一条 NDJSON 流；
 * 6 个 Agent 同时跑就把连接池占满，面板加载与画布保存全部排队（表现为「会话加载中」「画布保存失败」）。
 * 这里让同一个窗口的所有 Agent 事件复用一条长连接：行格式为 { runId, event }，
 * 启动运行仍走普通 POST（短请求），因此不会再挤占 UI 需要的连接。
 */
type Bus = {
  response: Response;
  heartbeat: ReturnType<typeof setInterval>;
  /** 每条运行对应的取消控制器；连接断开时统一 abort，避免留下孤儿任务。 */
  runs: Map<string, AbortController>;
  lastActiveAt: number;
};

const MAX_BUSES = 16;
const buses = new Map<string, Bus>();

export function isBusId(value: string) {
  return /^[\w-]{8,64}$/.test(value);
}

export function hasBus(id: string) {
  return buses.has(id);
}

function writeRaw(response: Response, text: string) {
  // ACT: 不能因为 writableNeedDrain 丢事件——done/error 丢了客户端会永久等待。
  // Node 会把写入排进缓冲区；本地单用户场景的背压风险低于丢事件。
  if (response.destroyed || response.writableEnded) return;
  response.write(text);
}

/** 打开（或替换）一条总线；重复连接说明页面重载过，旧运行的连接已无意义。 */
export function openBus(id: string, response: Response) {
  closeBus(id);
  if (buses.size >= MAX_BUSES) {
    // ACT: 半开连接或 HMR 遗留会攒满上限；淘汰最久未活动的一条，而不是让新窗口永久回退直连。
    const oldest = [...buses.entries()].sort((a, b) => a[1].lastActiveAt - b[1].lastActiveAt)[0];
    if (oldest) closeBus(oldest[0]);
  }
  response.status(200).set({
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "X-Accel-Buffering": "no",
  });
  response.flushHeaders();
  // ACT: 空行心跳与旧的 /api/agent 流一致，客户端读循环会跳过空行，同时让代理不判定空闲。
  const heartbeat = setInterval(() => writeRaw(response, "\n"), 20_000);
  heartbeat.unref?.();
  const bus: Bus = { response, heartbeat, runs: new Map(), lastActiveAt: Date.now() };
  buses.set(id, bus);
  // ACT: 替换总线时旧连接的 close 会在后续 tick 才触发；必须按对象身份判断，
  // 否则旧 close 会把刚建立的新总线删掉（并 abort 新连接上的运行）。
  const dispose = () => { if (buses.get(id) === bus) closeBus(id); };
  response.once("close", dispose);
  response.on("error", dispose);
}

export function publishBus(id: string, runId: string, event: AgentEvent) {
  const bus = buses.get(id);
  if (!bus) return;
  bus.lastActiveAt = Date.now();
  writeRaw(bus.response, `${JSON.stringify({ runId, event })}\n`);
}

export function registerBusRun(id: string, runId: string, controller: AbortController) {
  const bus = buses.get(id);
  if (!bus) return false;
  if (bus.runs.has(runId)) return false;
  bus.runs.set(runId, controller);
  bus.lastActiveAt = Date.now();
  return true;
}

export function unregisterBusRun(id: string, runId: string) {
  buses.get(id)?.runs.delete(runId);
}

export function abortBusRun(id: string, runId: string) {
  const controller = buses.get(id)?.runs.get(runId);
  if (!controller) return false;
  controller.abort();
  return true;
}

/** 不带 busId 的兜底：按 runId 在所有总线上查找（客户端可能换过连接）。 */
export function abortRunEverywhere(runId: string) {
  for (const bus of buses.values()) {
    const controller = bus.runs.get(runId);
    if (controller) { controller.abort(); return true; }
  }
  return false;
}

function closeBus(id: string) {
  const bus = buses.get(id);
  if (!bus) return;
  buses.delete(id);
  clearInterval(bus.heartbeat);
  for (const controller of bus.runs.values()) controller.abort();
  bus.runs.clear();
  if (!bus.response.writableEnded) bus.response.end();
}
