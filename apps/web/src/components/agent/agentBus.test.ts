import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { AgentEvent } from "@toonflow/server/agent/types";
import { ensureAgentBus, resetAgentBusForTest, runOverAgentBus } from "./agentBus";

const encoder = new TextEncoder();
const originalFetch = globalThis.fetch;

function installFetch() {
  let busController: ReadableStreamDefaultController<Uint8Array> | undefined;
  const aborted: string[] = [];
  const runIds: string[] = [];
  const calls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    if (url === "/api/agent/bus") {
      return new Response(new ReadableStream({
        start(controller) { busController = controller; },
      }), { status: 200, headers: { "Content-Type": "application/x-ndjson" } });
    }
    if (url === "/api/agent") {
      const runId = String((init?.headers as Record<string, string> | undefined)?.["x-agent-run-id"] ?? "");
      runIds.push(runId);
      return Response.json({ code: 200, data: { runId } });
    }
    if (url === "/api/agent/abortRun") {
      aborted.push(String(JSON.parse(String(init?.body)).runId));
      return Response.json({ code: 200, data: { result: "aborted" } });
    }
    return new Response(null, { status: 404 });
  }) as typeof fetch;
  return {
    aborted, calls, runIds,
    push(runId: string, event: AgentEvent) { busController?.enqueue(encoder.encode(`${JSON.stringify({ runId, event })}\n`)); },
    closeBusStream() { busController?.close(); },
  };
}

beforeEach(() => { resetAgentBusForTest(); });
afterEach(() => { globalThis.fetch = originalFetch; });

describe("agentBus client", () => {
  it("从总线按 runId 分发事件，done 结束迭代", async () => {
    const env = installFetch();
    expect(await ensureAgentBus("/w")).toBe(true);
    const collected: AgentEvent[] = [];
    const consumed = (async () => {
      for await (const event of runOverAgentBus({ prompt: "x" }, "/w", new AbortController().signal)) collected.push(event);
    })();
    await new Promise(resolve => setTimeout(resolve, 10));
    env.push(env.runIds[0]!, { type: "text", blockId: "b", content: "hi" } as AgentEvent);
    env.push(env.runIds[0]!, { type: "done" });
    await consumed;
    expect(collected.map(event => event.type)).toEqual(["text"]);
    expect(env.calls.filter(url => url === "/api/agent/bus")).toHaveLength(1);
  });

  it("中断时通知服务端取消该 run", async () => {
    const env = installFetch();
    await ensureAgentBus("/w");
    const controller = new AbortController();
    const consumed = (async () => {
      for await (const _event of runOverAgentBus({ prompt: "x" }, "/w", controller.signal)) { /* 等待事件 */ }
    })();
    await new Promise(resolve => setTimeout(resolve, 10));
    controller.abort(new DOMException("aborted", "AbortError"));
    await expect(consumed).rejects.toMatchObject({ name: "AbortError" });
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(env.aborted).toHaveLength(1);
    expect(env.aborted[0]).toMatch(/^[\w-]+$/);
  });

  it("同一条总线上的两个 run 事件互不串台", async () => {
    const env = installFetch();
    await ensureAgentBus("/w");
    const first: AgentEvent[] = [];
    const second: AgentEvent[] = [];
    const consume = (target: AgentEvent[], index: number) => (async () => {
      for await (const event of runOverAgentBus({ prompt: String(index) }, "/w", new AbortController().signal)) target.push(event);
    })();
    const firstRun = consume(first, 0);
    const secondRun = consume(second, 1);
    await new Promise(resolve => setTimeout(resolve, 10));
    env.push(env.runIds[0]!, { type: "text", blockId: "a", content: "A" } as AgentEvent);
    env.push(env.runIds[1]!, { type: "text", blockId: "b", content: "B" } as AgentEvent);
    env.push(env.runIds[0]!, { type: "done" });
    env.push(env.runIds[1]!, { type: "done" });
    await Promise.all([firstRun, secondRun]);
    expect(first.map(event => event.type)).toEqual(["text"]);
    expect(second.map(event => event.type)).toEqual(["text"]);
    expect((first[0] as { content: string }).content).toBe("A");
    expect((second[0] as { content: string }).content).toBe("B");
  });

  it("消费端提前 break 也会取消服务端运行", async () => {
    const env = installFetch();
    await ensureAgentBus("/w");
    const consumed = (async () => {
      for await (const _event of runOverAgentBus({ prompt: "x" }, "/w", new AbortController().signal)) break;
    })();
    await new Promise(resolve => setTimeout(resolve, 10));
    env.push(env.runIds[0]!, { type: "text", blockId: "b", content: "hi" } as AgentEvent);
    await consumed;
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(env.aborted).toContain(env.runIds[0]);
  });

  it("总线断开时在途运行报错并取消", async () => {
    const env = installFetch();
    await ensureAgentBus("/w");
    const consumed = (async () => {
      for await (const _event of runOverAgentBus({ prompt: "x" }, "/w", new AbortController().signal)) { /* 等事件 */ }
    })();
    await new Promise(resolve => setTimeout(resolve, 10));
    env.closeBusStream();
    await expect(consumed).rejects.toThrow("事件通道已断开");
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(env.aborted).toContain(env.runIds[0]);
  });
});
