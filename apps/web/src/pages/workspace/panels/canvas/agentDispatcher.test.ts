import { describe, expect, it } from "bun:test";
import { createAgentDispatcher } from "./agentDispatcher";
import type { AgentLink } from "./agentLinks";

const encoder = new TextEncoder();

function ndjson(events: object[]) {
  return new Response(new ReadableStream({
    start(controller) {
      for (const event of events) controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      controller.close();
    },
  }), { status: 200, headers: { "Content-Type": "application/x-ndjson" } });
}

function setup(options: { hang?: boolean } = {}) {
  const statuses: Record<string, string> = {};
  const updates: { nodeId: string; data: Record<string, unknown> }[] = [];
  const nodes = new Map<string, { id: string; type: string; data: Record<string, unknown> }>([
    ["A", { id: "A", type: "remote-agentNode", data: { label: "导演", agentSessionFile: "a.jsonl" } }],
    ["B", { id: "B", type: "remote-agentNode", data: { label: "编剧", agentRoleId: "role-1" } }],
  ]);
  const calls: { url: string; body?: Record<string, unknown> }[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
    calls.push({ url, body });
    if (url.startsWith("/api/agent/get") || url.startsWith("http") && url.includes("/api/agent/get")) {
      const sessionFile = decodeURIComponent(new URL(url, "http://local").searchParams.get("sessionFile") ?? "");
      return Response.json({ data: { providerId: "p", modelId: "m", messages: sessionFile === "b.jsonl" ? [{ role: "assistant", content: "B 的结果" }] : [] } });
    }
    if (url === "/api/agent/canvasResult") return Response.json({ code: 200 });
    if (url === "/api/agent") {
      const prompt = String(body?.prompt ?? "");
      if (prompt.startsWith("【Agent 任务结果】")) return ndjson([{ type: "text", blockId: "1:0", delta: "收到" }, { type: "done" }]);
      if (options.hang) {
        // ACT: 模拟「运行中」——先发 session，之后挂起；收到 abort 时让流报错，验证停止真的中断了请求。
        return new Response(new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(`${JSON.stringify({ type: "session", file: "b.jsonl" })}\n`));
            init?.signal?.addEventListener("abort", () => controller.error(new Error("aborted")), { once: true });
          },
        }), { status: 200, headers: { "Content-Type": "application/x-ndjson" } });
      }
      return ndjson([
        { type: "session", file: "b.jsonl" },
        { type: "text", blockId: "1:0", delta: "写好了" },
        { type: "done" },
      ]);
    }
    if (url === "/api/agent/note") return Response.json({ data: { id: "note-1" } });
    return Response.json({});
  }) as typeof fetch;
  return { statuses, updates, nodes, calls, restore: () => { globalThis.fetch = originalFetch; } };
}

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe("agentDispatcher", () => {
  it("派发到 B、回传结果给 A，并写回 B 的会话文件", async () => {
    const env = setup();
    try {
      const dispatcher = createAgentDispatcher({
        canvasId: () => "c.json",
        directory: () => "/w",
        findNode: nodeId => env.nodes.get(nodeId),
        updateNodeData: (nodeId, data) => { env.updates.push({ nodeId, data }); },
        getCanvasContext: () => ({ id: "c.json", tools: [], call: async () => null }),
        statuses: env.statuses,
      });
      dispatcher.enqueueFromEvent({
        type: "agentDispatch", taskId: "t1", fromNodeId: "A", toNodeId: "B",
        fromSession: "a.jsonl", message: "写一段", depth: 0,
        model: { providerId: "p", modelId: "m" },
      });
      await wait(50);
      expect(env.updates.some(item => item.nodeId === "B" && item.data.agentSessionFile === "b.jsonl")).toBe(true);
      // 派发请求要带上目标节点选中的角色，服务端据此解析提示词。
      const dispatchCall = env.calls.find(call => call.url === "/api/agent" && String(call.body?.prompt).startsWith("【来自"));
      expect(dispatchCall!.body?.roleId).toBe("role-1");
      const resultCall = env.calls.find(call => call.url === "/api/agent" && String(call.body?.prompt).startsWith("【Agent 任务结果】"));
      expect(resultCall).toBeTruthy();
      expect(String(resultCall!.body?.prompt)).toContain("B 的结果");
      expect(resultCall!.body?.sessionFile).toBe("a.jsonl");
      dispatcher.dispose();
    } finally {
      env.restore();
    }
  });

  it("60 秒内同一对节点相同消息去重", async () => {
    const env = setup();
    try {
      const dispatcher = createAgentDispatcher({
        canvasId: () => "c.json", directory: () => "/w",
        findNode: nodeId => env.nodes.get(nodeId),
        updateNodeData: () => {},
        getCanvasContext: () => ({ id: "c.json", tools: [], call: async () => null }),
        statuses: env.statuses,
      });
      const event = {
        type: "agentDispatch" as const, taskId: "t1", fromNodeId: "A", toNodeId: "B",
        fromSession: "a.jsonl", message: "写一段", depth: 0,
        model: { providerId: "p", modelId: "m" },
      };
      dispatcher.enqueueFromEvent(event);
      dispatcher.enqueueFromEvent({ ...event, taskId: "t2" });
      await wait(30);
      const runs = env.calls.filter(call => call.url === "/api/agent" && String(call.body?.prompt).startsWith("【来自"));
      expect(runs).toHaveLength(1);
      dispatcher.dispose();
    } finally {
      env.restore();
    }
  });

  it("停止运行中的任务：中断请求、清排队、给父会话写取消通知而不是开新一轮", async () => {
    const env = setup({ hang: true });
    try {
      const dispatcher = createAgentDispatcher({
        canvasId: () => "c.json", directory: () => "/w",
        findNode: nodeId => env.nodes.get(nodeId),
        updateNodeData: () => {},
        getCanvasContext: () => ({ id: "c.json", tools: [], call: async () => null }),
        statuses: env.statuses,
      });
      dispatcher.enqueueFromEvent({
        type: "agentDispatch", taskId: "t1", fromNodeId: "A", toNodeId: "B",
        fromSession: "a.jsonl", message: "写一段", depth: 0,
        model: { providerId: "p", modelId: "m" },
      });
      dispatcher.enqueueFromEvent({
        type: "agentDispatch", taskId: "t2", fromNodeId: "A", toNodeId: "B",
        fromSession: "a.jsonl", message: "再写一段", depth: 0,
        model: { providerId: "p", modelId: "m" },
      });
      await wait(30);
      const hit = dispatcher.stop("B");
      expect(hit).toBe(true);
      await wait(80);
      // 排队任务不再启动：只有第一次派发打了 /api/agent。
      const runs = env.calls.filter(call => call.url === "/api/agent" && String(call.body?.prompt).startsWith("【来自"));
      expect(runs).toHaveLength(1);
      // 取消不自动续跑父 Agent：不出现「Agent 任务结果」新一轮，而是写一条 note。
      expect(env.calls.some(call => call.url === "/api/agent" && String(call.body?.prompt).startsWith("【Agent 任务结果】"))).toBe(false);
      expect(env.calls.some(call => call.url === "/api/agent/note" && String(call.body?.content).includes("已被停止"))).toBe(true);
      expect(env.statuses.B).toBe("idle");
      // 停止后新派活被忽略；用户手动发送（notePanelRun true）后恢复。
      dispatcher.enqueueFromEvent({
        type: "agentDispatch", taskId: "t3", fromNodeId: "A", toNodeId: "B",
        fromSession: "a.jsonl", message: "恢复后", depth: 0,
        model: { providerId: "p", modelId: "m" },
      });
      await wait(30);
      expect(env.calls.filter(call => call.url === "/api/agent" && String(call.body?.prompt).startsWith("【来自"))).toHaveLength(1);
      dispatcher.notePanelRun("B", true);
      dispatcher.notePanelRun("B", false);
      dispatcher.enqueueFromEvent({
        type: "agentDispatch", taskId: "t4", fromNodeId: "A", toNodeId: "B",
        fromSession: "a.jsonl", message: "继续写", depth: 0,
        model: { providerId: "p", modelId: "m" },
      });
      await wait(30);
      expect(env.calls.filter(call => call.url === "/api/agent" && String(call.body?.prompt).startsWith("【来自"))).toHaveLength(2);
      dispatcher.dispose();
    } finally {
      env.restore();
    }
  });

  it("关系箭头：派发期间存在，完成后换成回传脉冲", async () => {
    const env = setup();
    const links: AgentLink[] = [];
    try {
      const dispatcher = createAgentDispatcher({
        canvasId: () => "c.json", directory: () => "/w",
        findNode: nodeId => env.nodes.get(nodeId),
        updateNodeData: () => {},
        getCanvasContext: () => ({ id: "c.json", tools: [], call: async () => null }),
        statuses: env.statuses,
        links,
      });
      dispatcher.enqueueFromEvent({
        type: "agentDispatch", taskId: "t1", fromNodeId: "A", toNodeId: "B",
        fromSession: "a.jsonl", message: "写一段", depth: 0,
        model: { providerId: "p", modelId: "m" },
      });
      expect(links).toHaveLength(1);
      expect(links[0]).toMatchObject({ fromNodeId: "A", toNodeId: "B", kind: "dispatch" });
      expect(["queued", "running"]).toContain(links[0]!.status);
      await wait(60);
      await wait(260);
      // 派发箭头退场，换成 B→A 的结果回传脉冲。
      expect(links.some(link => link.kind === "dispatch")).toBe(false);
      const result = links.find(link => link.kind === "result");
      expect(result).toMatchObject({ fromNodeId: "B", toNodeId: "A", status: "completed" });
      dispatcher.dispose();
      expect(links).toHaveLength(0);
    } finally {
      env.restore();
    }
  });

  it("关系箭头：停止时清掉排队中的箭头", async () => {
    const env = setup({ hang: true });
    const links: AgentLink[] = [];
    try {
      const dispatcher = createAgentDispatcher({
        canvasId: () => "c.json", directory: () => "/w",
        findNode: nodeId => env.nodes.get(nodeId),
        updateNodeData: () => {},
        getCanvasContext: () => ({ id: "c.json", tools: [], call: async () => null }),
        statuses: env.statuses,
        links,
      });
      dispatcher.enqueueFromEvent({
        type: "agentDispatch", taskId: "t1", fromNodeId: "A", toNodeId: "B",
        fromSession: "a.jsonl", message: "写一段", depth: 0,
        model: { providerId: "p", modelId: "m" },
      });
      dispatcher.enqueueFromEvent({
        type: "agentDispatch", taskId: "t2", fromNodeId: "A", toNodeId: "B",
        fromSession: "a.jsonl", message: "排队那条", depth: 0,
        model: { providerId: "p", modelId: "m" },
      });
      await wait(30);
      expect(links.filter(link => link.status === "queued")).toHaveLength(1);
      dispatcher.stop("B");
      expect(links.filter(link => link.status === "queued")).toHaveLength(0);
      dispatcher.dispose();
    } finally {
      env.restore();
    }
  });

});
