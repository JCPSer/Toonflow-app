import type { AgentEvent } from "@toonflow/server/agent/types";
import { trackStream } from "@/lib/netProbe";
import { ensureAgentBus, runOverAgentBus } from "./agentBus";
import { readAgentEvents } from "./replyStream";

type AgentRunOptions = {
  directory: string;
  signal: AbortSignal;
  headers?: Record<string, string>;
  /** 会话忙（EBUSY）时的重试次数；默认交给调用方处理。 */
  busyRetries?: number;
  busyDelayMs?: number;
};

/**
 * ACT: Agent 运行的统一入口。
 * 优先走窗口级事件总线（所有运行共用一条长连接）；服务端不支持或连接失败时回退到原来的 NDJSON 直连。
 * 两条路径产生相同的事件序列，调用方无需区分。
 */
export async function* streamAgentRun(payload: Record<string, unknown>, options: AgentRunOptions): AsyncGenerator<AgentEvent> {
  const retries = options.busyRetries ?? 0;
  const delay = options.busyDelayMs ?? 150;
  for (let attempt = 0; ; attempt++) {
    try {
      if (await ensureAgentBus(options.directory, options.headers)) {
        yield* runOverAgentBus(payload, options.directory, options.signal, options.headers);
        return;
      }
      const response = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-toonflow-workspace": "1", ...options.headers },
        body: JSON.stringify(payload),
        signal: options.signal,
      });
      // ACT: 直连模式下这整轮占一条同源连接，登记到探针便于复现连接池问题。
      const release = trackStream("/api/agent");
      try {
        yield* readAgentEvents(response, options.signal);
      } finally {
        release();
      }
      return;
    } catch (error) {
      const busy = (error as { code?: string } | null)?.code === "EBUSY";
      if (!busy || attempt >= retries || options.signal.aborted) throw error;
      options.signal.throwIfAborted();
      // ACT: 指数退避且可被停止打断；固定间隔在连续打断时更容易再次撞上 EBUSY。
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => { clearTimeout(timer); reject(options.signal.reason); };
        const timer = setTimeout(() => { options.signal.removeEventListener("abort", onAbort); resolve(); }, delay * 2 ** attempt);
        options.signal.addEventListener("abort", onAbort, { once: true });
      });
    }
  }
}
