import type { AgentEvent } from "@toonflow/server/agent/types";
import { trackStream } from "@/lib/netProbe";

/**
 * ACT: 一个窗口复用一条 Agent 事件长连接。
 * WebKit 同源只开 6 条 HTTP/1.1 连接；6 个 Agent 各占一条 NDJSON 流时，面板加载与画布保存会排队。
 * 这里把多条运行多路复用到一条流上：行格式 { runId, event }，按 runId 分发给各自的订阅者。
 */
const busId = typeof crypto !== "undefined" && crypto.randomUUID
  ? crypto.randomUUID()
  : `bus-${Date.now()}-${Math.random().toString(16).slice(2)}`;

type Entry = {
  events: AgentEvent[];
  finished: boolean;
  error?: Error;
  wake?: () => void;
};

const entries = new Map<string, Entry>();
let connection: Promise<void> | undefined;
/** 连接代次：断线后仍挂在旧连接上的 run 用它判断自己已经过期。 */
let generation = 0;
/** 服务端不支持总线（旧版本）时永久回退到直连流，避免每次运行都探测一次。 */
let supported = true;

function newRunId() {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

function wake(entry: Entry) {
  entry.wake?.();
  entry.wake = undefined;
}

/** ACT: 已收到 done 的 run 不能因为断线被改判失败；未完成的才标记错误并取消。 */
function failAll(error: Error) {
  for (const entry of entries.values()) {
    if (entry.finished) continue;
    entry.error = error;
    wake(entry);
  }
  for (const [runId, entry] of entries) {
    if (!entry.finished) abortRemoteRun(runId);
  }
}

/** ACT: 总线断开后服务端未必立刻感知；主动取消仍在跑的 run，避免留下孤儿任务继续烧模型。 */
function abortRemoteRun(runId: string) {
  void fetch("/api/agent/abortRun", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-toonflow-workspace": "1" },
    body: JSON.stringify({ runId }),
  }).catch(() => {});
}

function dispatch(runId: string, event: AgentEvent) {
  const entry = entries.get(runId);
  if (!entry) return;
  if (event.type === "done") entry.finished = true;
  else entry.events.push(event);
  wake(entry);
}

async function connect(directory: string, headers: Record<string, string> | undefined, gen: number) {
  const response = await fetch("/api/agent/bus", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json", "x-toonflow-workspace": "1", "x-agent-bus-id": busId },
    body: JSON.stringify({ directory }),
  });
  if (response.status === 404 || response.status === 405) {
    supported = false;
    throw new Error("事件通道不可用");
  }
  const contentType = response.headers.get("content-type") ?? "";
  // ACT: 异常代理/回退页可能返回 200 HTML；不校验类型会把它当总线，之后每次运行都失败且不回退。
  if (!response.ok || !response.body || !contentType.includes("ndjson")) {
    if (response.ok) supported = false;
    throw new Error("事件通道连接失败");
  }
  const release = trackStream("/api/agent/bus");
  void (async () => {
    const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
    let pending = "";
    let ended = false;
    try {
      while (true) {
        const { value, done } = await reader.read();
        pending += value ?? "";
        const lines = pending.split("\n");
        pending = lines.pop() ?? "";
        if (done) lines.push(pending);
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const payload = JSON.parse(line) as { runId?: string; event?: AgentEvent };
            if (payload.runId && payload.event) dispatch(payload.runId, payload.event);
          } catch { /* 忽略坏行，避免一条脏数据打断整条总线 */ }
        }
        if (done) break;
      }
      ended = true;
    } catch {
      ended = true;
    } finally {
      release();
      await reader.cancel().catch(() => {});
      reader.releaseLock();
      if (ended && generation === gen) {
        connection = undefined;
        failAll(new Error("事件通道已断开，请重试"));
      }
    }
  })();
}

/** 建立/复用总线；旧服务端返回 404 时返回 false，让调用方走原有直连流。 */
export async function ensureAgentBus(directory: string, headers?: Record<string, string>) {
  if (!supported) return false;
  if (!connection) {
    const gen = ++generation;
    connection = connect(directory, headers, gen).catch(error => {
      if (generation === gen) connection = undefined;
      throw error;
    });
  }
  try {
    await connection;
    return true;
  } catch {
    // ACT: 网络抖动只影响本次运行，回退直连流；只有 404/405 或非流式响应才永久关闭总线探测。
    return false;
  }
}

/** 仅供单测：丢弃连接状态，避免上一个用例的流被下一个用例复用。 */
export function resetAgentBusForTest() {
  failAll(new Error("事件通道已重置"));
  entries.clear();
  connection = undefined;
  supported = true;
  generation++;
}

export async function* runOverAgentBus(
  payload: Record<string, unknown>,
  directory: string,
  signal: AbortSignal,
  headers: Record<string, string> = {},
): AsyncGenerator<AgentEvent> {
  // ACT: runId 由客户端先生成并登记，再启动运行——服务端第一批事件（session/stats）
  // 可能在启动响应返回前就到达，先注册才不会丢；启动响应丢失时也仍能按 runId 取消。
  const runId = newRunId();
  const entry: Entry = { events: [], finished: false };
  entries.set(runId, entry);
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await fetch("/api/agent", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json", "x-toonflow-workspace": "1", "x-agent-bus-id": busId, "x-agent-run-id": runId },
        body: JSON.stringify(payload),
        signal,
      });
      const body = await response.json().catch(() => null) as { code?: number; reason?: string; message?: string; data?: { runId?: string } } | null;
      if (response.status === 409 && body?.reason === "bus_closed" && attempt === 0) {
        // 服务端总线已注销但客户端还没收到断线：重连一次再启动同一个 runId。
        connection = undefined;
        if (await ensureAgentBus(directory, headers)) continue;
      }
      if (!response.ok || body?.code !== 200) {
        throw Object.assign(new Error(body?.message || `请求失败（${response.status}）`), { status: response.status });
      }
      break;
    }

    while (true) {
      if (signal.aborted) throw signal.reason;
      if (entry.error) throw entry.error;
      const event = entry.events.shift();
      if (event) {
        if (event.type === "error") throw Object.assign(new Error(event.message), event.code ? { code: event.code } : {});
        yield event;
        continue;
      }
      if (entry.finished) return;
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => { entry.wake = undefined; reject(signal.reason); };
        entry.wake = () => { signal.removeEventListener("abort", onAbort); resolve(); };
        signal.addEventListener("abort", onAbort, { once: true });
      });
    }
  } finally {
    entries.delete(runId);
    // ACT: 无条件取消：消费端 break/抛错不会经过 catch，只有这样才能保证服务端不留下孤儿运行。
    // 已正常结束的 run 在服务端已注销，abortRun 会返回 none，无副作用。
    abortRemoteRun(runId);
  }
}
