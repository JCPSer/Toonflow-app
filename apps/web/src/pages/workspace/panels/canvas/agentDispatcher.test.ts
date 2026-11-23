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

function setup(options: { hang?: boolean; hangText?: string } = {}) {
  const statuses: Record<string, string> = {};
  const updates: { nodeId: string; data: Record<string, unknown> }[] = [];
  const nodes = new Map<string, { id: string; type: string; data: Record<string, unknown> }>([
    ["A", { id: "A", type: "remote-agentNode", data: { label: "导演", agentSessionFile: "a.jsonl" } }],
    ["B", { id: "B", type: "remote-agentNode", data: { label: "编剧", agentRoleId: "role-1" } }],
    ["C", { id: "C", type: "remote-agentNode", data: { label: "审核", agentSessionFile: "c.jsonl" } }],
    ["D", { id: "D", type: "remote-agentNode", data: { label: "分镜" } }],
    ["E", { id: "E", type: "remote-agentNode", data: { label: "配音" } }],
    ["F", { id: "F", type: "remote-agentNode", data: { label: "后期" } }],
  ]);
  const calls: { url: string; body?: Record<string, unknown> }[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
    calls.push({ url, body });
    // ACT: 测试环境不模拟事件总线，显式 404 让共用入口回退到直连流。
    if (url === "/api/agent/bus") return new Response(null, { status: 404 });
    if (url.startsWith("/api/agent/get") || url.startsWith("http") && url.includes("/api/agent/get")) {
      const sessionFile = decodeURIComponent(new URL(url, "http://local").searchParams.get("sessionFile") ?? "");
      return Response.json({ data: { providerId: "p", modelId: "m", messages: sessionFile === "b.jsonl" ? [{ role: "assistant", content: "B 的结果" }] : [] } });
    }
    if (url === "/api/agent/canvasResult") return Response.json({ code: 200 });
    if (url === "/api/agent") {
      const prompt = String(body?.prompt ?? "");
      if (prompt.startsWith("【Agent 任务结果】")) return ndjson([{ type: "text", blockId: "1:0", delta: "收到" }, { type: "done" }]);
      if (options.hang && (!options.hangText || prompt.includes(options.hangText))) {
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
    if (url === "/api/agent/abort") return Response.json({ data: { result: "finished" } });
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
      // ACT: 同一发送方的新消息会打断 t1 并接管运行，这里停的是 t2。
      dispatcher.enqueueFromEvent({
        type: "agentDispatch", taskId: "t2", fromNodeId: "A", toNodeId: "B",
        fromSession: "a.jsonl", message: "再写一段", depth: 0,
        model: { providerId: "p", modelId: "m" },
      });
      await wait(120);
      const hit = dispatcher.stop("B");
      expect(hit).toBe(true);
      await wait(80);
      // 取消不自动续跑父 Agent：不出现「Agent 任务结果」新一轮，而是写一条 note。
      expect(env.calls.some(call => call.url === "/api/agent" && String(call.body?.prompt).startsWith("【Agent 任务结果】"))).toBe(false);
      expect(env.calls.some(call => call.url === "/api/agent/note" && String(call.body?.content).includes("已被停止"))).toBe(true);
      expect(env.statuses.B).toBe("idle");
      // 停止只管「这一刻」的任务：别的 Agent 之后派过来的新任务必须能重新唤醒它。
      dispatcher.enqueueFromEvent({
        type: "agentDispatch", taskId: "t3", fromNodeId: "C", toNodeId: "B",
        fromSession: "c.jsonl", message: "恢复后", depth: 0,
        model: { providerId: "p", modelId: "m" },
      });
      await wait(60);
      const runs = env.calls.filter(call => call.url === "/api/agent" && String(call.body?.prompt).startsWith("【来自"));
      expect(runs.map(call => String(call.body?.prompt))).toContainEqual(expect.stringContaining("恢复后"));
      dispatcher.dispose();
    } finally {
      env.restore();
    }
  });

  it("同一发送方的新消息打断正在运行的任务，并通知原派发方", async () => {
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
        fromSession: "a.jsonl", message: "第一版", depth: 0,
        model: { providerId: "p", modelId: "m" },
      });
      await wait(40);
      dispatcher.enqueueFromEvent({
        type: "agentDispatch", taskId: "t2", fromNodeId: "A", toNodeId: "B",
        fromSession: "a.jsonl", message: "改成第二版", depth: 0,
        model: { providerId: "p", modelId: "m" },
      });
      await wait(160);
      // 打断走服务端 API，带着目标会话文件，等服务端收尾后才放行新任务。
      const abortCall = env.calls.find(call => call.url === "/api/agent/abort");
      expect(abortCall?.body?.sessionFile).toBe("b.jsonl");
      const runs = env.calls.filter(call => call.url === "/api/agent" && String(call.body?.prompt).startsWith("【来自"));
      expect(runs.map(call => String(call.body?.prompt))).toContainEqual(expect.stringContaining("改成第二版"));
      // 被打断的原派发方收到取消 note，且原因写明是被更新消息打断。
      expect(env.calls.some(call => call.url === "/api/agent/note"
        && String(call.body?.content).includes("被同一 Agent 的更新消息打断"))).toBe(true);
      dispatcher.dispose();
    } finally {
      env.restore();
    }
  });

  it("不同发送方只排队；同一发送方的旧排队被最新一条替换", async () => {
    const env = setup({ hang: true });
    const links: AgentLink[] = [];
    try {
      const dispatcher = createAgentDispatcher({
        canvasId: () => "c.json", directory: () => "/w",
        findNode: nodeId => env.nodes.get(nodeId),
        updateNodeData: () => {},
        getCanvasContext: () => ({ id: "c.json", tools: [], call: async () => null }),
        statuses: env.statuses, links,
      });
      dispatcher.enqueueFromEvent({
        type: "agentDispatch", taskId: "t1", fromNodeId: "C", toNodeId: "B",
        fromSession: "c.jsonl", message: "审核任务", depth: 0,
        model: { providerId: "p", modelId: "m" },
      });
      await wait(30);
      dispatcher.enqueueFromEvent({
        type: "agentDispatch", taskId: "t2", fromNodeId: "A", toNodeId: "B",
        fromSession: "a.jsonl", message: "甲一", depth: 0,
        model: { providerId: "p", modelId: "m" },
      });
      dispatcher.enqueueFromEvent({
        type: "agentDispatch", taskId: "t3", fromNodeId: "A", toNodeId: "B",
        fromSession: "a.jsonl", message: "甲二", depth: 0,
        model: { providerId: "p", modelId: "m" },
      });
      await wait(60);
      // 不同发送方不打断：没有 abort 调用，C 的任务仍在跑。
      expect(env.calls.some(call => call.url === "/api/agent/abort")).toBe(false);
      // 同发送方排队只留最新：队列里只剩“甲二”，且只有一根排队箭头。
      const queued = links.filter(link => link.status === "queued");
      expect(queued).toHaveLength(1);
      expect(queued[0]!.message).toContain("甲二");
      dispatcher.stop("B");
      await wait(40);
      const runs = env.calls.filter(call => call.url === "/api/agent" && String(call.body?.prompt).startsWith("【来自"));
      expect(runs).toHaveLength(1);
      dispatcher.dispose();
    } finally {
      env.restore();
    }
  });

  it("用户在面板里的运行会被派活硬打断", async () => {
    const env = setup();
    let dispatcher: ReturnType<typeof createAgentDispatcher> | undefined;
    try {
      const interrupts: { nodeId: string; reason: string }[] = [];
      dispatcher = createAgentDispatcher({
        canvasId: () => "c.json", directory: () => "/w",
        findNode: nodeId => env.nodes.get(nodeId),
        updateNodeData: () => {},
        getCanvasContext: () => ({ id: "c.json", tools: [], call: async () => null }),
        statuses: env.statuses,
        panel: () => ({
          interruptRun: (nodeId, reason) => {
            interrupts.push({ nodeId, reason });
            setTimeout(() => dispatcher?.notePanelRun(nodeId, false), 10);
            return true;
          },
        }),
      });
      dispatcher.notePanelRun("B", true);
      dispatcher.enqueueFromEvent({
        type: "agentDispatch", taskId: "t1", fromNodeId: "A", toNodeId: "B",
        fromSession: "a.jsonl", message: "替换用户正在跑的", depth: 0,
        model: { providerId: "p", modelId: "m" },
      });
      await wait(120);
      expect(interrupts).toHaveLength(1);
      expect(interrupts[0]!.nodeId).toBe("B");
      const runs = env.calls.filter(call => call.url === "/api/agent" && String(call.body?.prompt).startsWith("【来自"));
      expect(runs).toHaveLength(1);
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
      // ACT: 换一个发送方，才不会被「同发送方打断」语义提前拉起。
      dispatcher.enqueueFromEvent({
        type: "agentDispatch", taskId: "t2", fromNodeId: "C", toNodeId: "B",
        fromSession: "c.jsonl", message: "排队那条", depth: 0,
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


  it("同样的派发在上一轮完成后可以再次入队", async () => {
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
      await wait(80);
      dispatcher.enqueueFromEvent({ ...event, taskId: "t2" });
      await wait(80);
      const runs = env.calls.filter(call => call.url === "/api/agent" && String(call.body?.prompt).startsWith("【来自"));
      expect(runs).toHaveLength(2);
      dispatcher.dispose();
    } finally {
      env.restore();
    }
  });

  it("取画布上下文抛错时释放节点，后续排队任务仍能执行", async () => {
    const env = setup();
    let first = true;
    try {
      const dispatcher = createAgentDispatcher({
        canvasId: () => "c.json", directory: () => "/w",
        findNode: nodeId => env.nodes.get(nodeId),
        updateNodeData: () => {},
        getCanvasContext: () => {
          if (first) { first = false; throw new Error("画布上下文不可用"); }
          return { id: "c.json", tools: [], call: async () => null };
        },
        statuses: env.statuses,
      });
      dispatcher.enqueueFromEvent({
        type: "agentDispatch", taskId: "t1", fromNodeId: "A", toNodeId: "B",
        fromSession: "a.jsonl", message: "第一条", depth: 0,
        model: { providerId: "p", modelId: "m" },
      });
      dispatcher.enqueueFromEvent({
        type: "agentDispatch", taskId: "t2", fromNodeId: "A", toNodeId: "B",
        fromSession: "a.jsonl", message: "第二条", depth: 0,
        model: { providerId: "p", modelId: "m" },
      });
      await wait(120);
      const runs = env.calls.filter(call => call.url === "/api/agent" && String(call.body?.prompt).startsWith("【来自"));
      expect(runs.map(call => String(call.body?.prompt))).toEqual([expect.stringContaining("第二条")]);
      expect(env.statuses.B).toBe("idle");
      dispatcher.dispose();
    } finally {
      env.restore();
    }
  });

  it("队列快照：条目顺序、双方标签、阻塞原因", async () => {
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
        type: "agentDispatch", taskId: "t-busy", fromNodeId: "C", toNodeId: "B",
        fromSession: "c.jsonl", message: "审核任务", depth: 0,
        model: { providerId: "p", modelId: "m" },
      });
      await wait(30);
      dispatcher.enqueueFromEvent({
        type: "agentDispatch", taskId: "t-queue", fromNodeId: "A", toNodeId: "B",
        fromSession: "a.jsonl", message: "排队一", depth: 0,
        model: { providerId: "p", modelId: "m" },
      });
      await wait(10);
      expect(dispatcher.queueView.value).toHaveLength(1);
      expect(dispatcher.queueView.value[0]).toMatchObject({
        taskId: "t-queue", kind: "task",
        fromLabel: "导演", toLabel: "编剧",
        message: "排队一", reason: "目标正在执行其他任务",
      });
      dispatcher.stop("B");
      await wait(20);
      expect(dispatcher.queueView.value).toHaveLength(0);
      dispatcher.dispose();
    } finally {
      env.restore();
    }
  });

  it("同一发送方替换排队消息时给出提示，快照只留最新", async () => {
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
        type: "agentDispatch", taskId: "t-busy", fromNodeId: "C", toNodeId: "B",
        fromSession: "c.jsonl", message: "审核任务", depth: 0,
        model: { providerId: "p", modelId: "m" },
      });
      await wait(30);
      dispatcher.enqueueFromEvent({
        type: "agentDispatch", taskId: "t-old", fromNodeId: "A", toNodeId: "B",
        fromSession: "a.jsonl", message: "甲一", depth: 0,
        model: { providerId: "p", modelId: "m" },
      });
      dispatcher.enqueueFromEvent({
        type: "agentDispatch", taskId: "t-new", fromNodeId: "A", toNodeId: "B",
        fromSession: "a.jsonl", message: "甲二", depth: 0,
        model: { providerId: "p", modelId: "m" },
      });
      await wait(10);
      expect(dispatcher.queueView.value.map(item => item.taskId)).toEqual(["t-new"]);
      expect(dispatcher.queueNotices.value.some(notice => notice.text.includes("已被同一 Agent 的新消息替换"))).toBe(true);
      dispatcher.stop("B");
      await wait(20);
      dispatcher.dispose();
    } finally {
      env.restore();
    }
  });

  it("撤销排队任务：移出队列、不打断在跑的任务、通知原派发方、释放去重键", async () => {
    const env = setup({ hang: true });
    const links: AgentLink[] = [];
    try {
      const dispatcher = createAgentDispatcher({
        canvasId: () => "c.json", directory: () => "/w",
        findNode: nodeId => env.nodes.get(nodeId),
        updateNodeData: () => {},
        getCanvasContext: () => ({ id: "c.json", tools: [], call: async () => null }),
        statuses: env.statuses, links,
      });
      dispatcher.enqueueFromEvent({
        type: "agentDispatch", taskId: "t-busy", fromNodeId: "C", toNodeId: "B",
        fromSession: "c.jsonl", message: "审核任务", depth: 0,
        model: { providerId: "p", modelId: "m" },
      });
      await wait(30);
      dispatcher.enqueueFromEvent({
        type: "agentDispatch", taskId: "t-cancel", fromNodeId: "A", toNodeId: "B",
        fromSession: "a.jsonl", message: "可撤销", depth: 0,
        model: { providerId: "p", modelId: "m" },
      });
      await wait(10);
      expect(dispatcher.queueView.value).toHaveLength(1);
      expect(links.some(link => link.taskId === "t-cancel" && link.status === "queued")).toBe(true);
      const runsBefore = env.calls.filter(call => call.url === "/api/agent" && String(call.body?.prompt).startsWith("【来自")).length;
      const statusBefore = env.statuses.B;
      expect(dispatcher.cancelQueued("t-missing")).toBe(false);
      expect(dispatcher.cancelQueued("t-cancel")).toBe(true);
      await wait(30);
      expect(dispatcher.queueView.value).toHaveLength(0);
      // 撤销只是撤掉排队：不打断在跑的任务、不新开一轮、不改节点真实状态。
      expect(env.calls.some(call => call.url === "/api/agent/abort")).toBe(false);
      const runsAfter = env.calls.filter(call => call.url === "/api/agent" && String(call.body?.prompt).startsWith("【来自")).length;
      expect(runsAfter).toBe(runsBefore);
      expect(env.statuses.B).toBe(statusBefore);
      expect(links.some(link => link.taskId === "t-cancel")).toBe(false);
      const note = env.calls.find(call => call.url === "/api/agent/note");
      expect(String(note?.body?.content)).toContain("在排队中被用户撤销");
      expect(String(note?.body?.content)).toContain("尚未开始执行");
      // 去重键必须一起释放，否则同内容立刻重发会被 60 秒去重吞掉。
      dispatcher.enqueueFromEvent({
        type: "agentDispatch", taskId: "t-again", fromNodeId: "A", toNodeId: "B",
        fromSession: "a.jsonl", message: "可撤销", depth: 0,
        model: { providerId: "p", modelId: "m" },
      });
      await wait(10);
      expect(dispatcher.queueView.value.map(item => item.taskId)).toEqual(["t-again"]);
      dispatcher.stop("B");
      await wait(20);
      dispatcher.dispose();
    } finally {
      env.restore();
    }
  });

  it("结果回传条目不可撤销", async () => {
    const env = setup({ hang: true, hangText: "审核任务" });
    try {
      const dispatcher = createAgentDispatcher({
        canvasId: () => "c.json", directory: () => "/w",
        findNode: nodeId => env.nodes.get(nodeId),
        updateNodeData: () => {},
        getCanvasContext: () => ({ id: "c.json", tools: [], call: async () => null }),
        statuses: env.statuses,
      });
      // A 被 C 的审核任务占住；A 派给 B 的任务很快完成，结果只能排回 A。
      dispatcher.enqueueFromEvent({
        type: "agentDispatch", taskId: "t-hold", fromNodeId: "C", toNodeId: "A",
        fromSession: "c.jsonl", message: "审核任务", depth: 0,
        model: { providerId: "p", modelId: "m" },
      });
      await wait(30);
      dispatcher.enqueueFromEvent({
        type: "agentDispatch", taskId: "t-work", fromNodeId: "A", toNodeId: "B",
        fromSession: "a.jsonl", message: "写一段", depth: 0,
        model: { providerId: "p", modelId: "m" },
      });
      await wait(80);
      const result = dispatcher.queueView.value.find(item => item.kind === "result");
      expect(result).toBeTruthy();
      expect(dispatcher.cancelQueued(result!.taskId)).toBe(false);
      expect(dispatcher.queueView.value.some(item => item.taskId === result!.taskId)).toBe(true);
      dispatcher.dispose();
    } finally {
      env.restore();
    }
  });

  it("并发已满时排队任务显示对应原因", async () => {
    const env = setup({ hang: true });
    try {
      const dispatcher = createAgentDispatcher({
        canvasId: () => "c.json", directory: () => "/w",
        findNode: nodeId => env.nodes.get(nodeId),
        updateNodeData: () => {},
        getCanvasContext: () => ({ id: "c.json", tools: [], call: async () => null }),
        statuses: env.statuses,
      });
      for (const [index, toNodeId] of ["B", "C", "D", "E"].entries()) {
        dispatcher.enqueueFromEvent({
          type: "agentDispatch", taskId: `t-${index}`, fromNodeId: "A", toNodeId,
          fromSession: "a.jsonl", message: `占位 ${index}`, depth: 0,
          model: { providerId: "p", modelId: "m" },
        });
      }
      await wait(40);
      dispatcher.enqueueFromEvent({
        type: "agentDispatch", taskId: "t-wait", fromNodeId: "A", toNodeId: "F",
        fromSession: "a.jsonl", message: "第五条", depth: 0,
        model: { providerId: "p", modelId: "m" },
      });
      await wait(20);
      const waiting = dispatcher.queueView.value.find(item => item.taskId === "t-wait");
      expect(waiting?.reason).toBe("并发已满");
      dispatcher.dispose();
    } finally {
      env.restore();
    }
  });

  it("60 秒内重复消息只提示一次", async () => {
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
        type: "agentDispatch", taskId: "t-busy", fromNodeId: "C", toNodeId: "B",
        fromSession: "c.jsonl", message: "审核任务", depth: 0,
        model: { providerId: "p", modelId: "m" },
      });
      await wait(30);
      for (const taskId of ["t-dup-1", "t-dup-2", "t-dup-3"]) {
        dispatcher.enqueueFromEvent({
          type: "agentDispatch", taskId, fromNodeId: "A", toNodeId: "B",
          fromSession: "a.jsonl", message: "重复内容", depth: 0,
          model: { providerId: "p", modelId: "m" },
        });
      }
      await wait(10);
      const notices = dispatcher.queueNotices.value.filter(notice => notice.text.includes("重复的相同消息已忽略"));
      expect(notices).toHaveLength(1);
      dispatcher.dispose();
    } finally {
      env.restore();
    }
  });

  it("任务链上限以服务端事件为准：超过上限丢弃，上限内正常执行", async () => {
    const env = setup();
    const links: AgentLink[] = [];
    try {
      const dispatcher = createAgentDispatcher({
        canvasId: () => "c.json", directory: () => "/w",
        findNode: nodeId => env.nodes.get(nodeId),
        updateNodeData: () => {},
        getCanvasContext: () => ({ id: "c.json", tools: [], call: async () => null }),
        statuses: env.statuses, links,
        maxDepth: () => 8,
      });
      // 事件携带的服务端上限优先于本地设置：服务端按 2 受理过，画布不能按本地 8 放行。
      dispatcher.enqueueFromEvent({
        type: "agentDispatch", taskId: "t-too-deep", fromNodeId: "A", toNodeId: "B",
        fromSession: "a.jsonl", message: "太深了", depth: 2, maxDepth: 2,
        model: { providerId: "p", modelId: "m" },
      });
      await wait(20);
      expect(env.calls.some(call => call.url === "/api/agent")).toBe(false);
      expect(links.some(link => link.taskId === "t-too-deep")).toBe(false);

      dispatcher.enqueueFromEvent({
        type: "agentDispatch", taskId: "t-ok", fromNodeId: "A", toNodeId: "B",
        fromSession: "a.jsonl", message: "可以派", depth: 1, maxDepth: 2,
        model: { providerId: "p", modelId: "m" },
      });
      await wait(40);
      expect(env.calls.some(call => call.url === "/api/agent" && String(call.body?.prompt).includes("可以派"))).toBe(true);
      dispatcher.dispose();
    } finally {
      env.restore();
    }
  });

  it("不限制档的 1000 上限不会被画布压回 32", async () => {
    const env = setup();
    const links: AgentLink[] = [];
    try {
      const dispatcher = createAgentDispatcher({
        canvasId: () => "c.json", directory: () => "/w",
        findNode: nodeId => env.nodes.get(nodeId),
        updateNodeData: () => {},
        getCanvasContext: () => ({ id: "c.json", tools: [], call: async () => null }),
        statuses: env.statuses, links,
      });
      dispatcher.enqueueFromEvent({
        type: "agentDispatch", taskId: "t-deep", fromNodeId: "A", toNodeId: "B",
        fromSession: "a.jsonl", message: "深层派发", depth: 50, maxDepth: 1000,
        model: { providerId: "p", modelId: "m" },
      });
      await wait(40);
      expect(links.some(link => link.taskId === "t-deep")).toBe(true);
      expect(env.calls.some(call => call.url === "/api/agent" && String(call.body?.prompt).includes("深层派发"))).toBe(true);
      dispatcher.dispose();
    } finally {
      env.restore();
    }
  });

  it("dispose 后清空队列快照与提示", async () => {
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
        type: "agentDispatch", taskId: "t-busy", fromNodeId: "C", toNodeId: "B",
        fromSession: "c.jsonl", message: "审核任务", depth: 0,
        model: { providerId: "p", modelId: "m" },
      });
      await wait(30);
      dispatcher.enqueueFromEvent({
        type: "agentDispatch", taskId: "t-old", fromNodeId: "A", toNodeId: "B",
        fromSession: "a.jsonl", message: "甲一", depth: 0,
        model: { providerId: "p", modelId: "m" },
      });
      dispatcher.enqueueFromEvent({
        type: "agentDispatch", taskId: "t-new", fromNodeId: "A", toNodeId: "B",
        fromSession: "a.jsonl", message: "甲二", depth: 0,
        model: { providerId: "p", modelId: "m" },
      });
      await wait(10);
      expect(dispatcher.queueView.value.length).toBeGreaterThan(0);
      expect(dispatcher.queueNotices.value.length).toBeGreaterThan(0);
      dispatcher.dispose();
      expect(dispatcher.queueView.value).toHaveLength(0);
      expect(dispatcher.queueNotices.value).toHaveLength(0);
    } finally {
      env.restore();
    }
  });

});

