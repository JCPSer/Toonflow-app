import { appendFile, mkdir, rename, stat } from "@toonflow/file";
import { dirname, join } from "node:path";
import { getAgentHost } from "@/agent/host";

// ACT: Agent 客户端工具链路此前没有任何可追查记录，中止来源只能事后靠日志定性。
// 日志必须 best-effort：任何写入失败都吞掉，绝不能影响对话本身。
// 日志目录经 AgentHost 的 settings.settingsPath() 取得，agent 因此不再依赖应用层的 conf。
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_FIELD = 300;
let queue: Promise<void> = Promise.resolve();

function summarize(value: unknown) {
  if (value instanceof Error) return value.message.slice(0, MAX_FIELD);
  if (typeof value === "string") return value.replace(/\s+/g, " ").slice(0, MAX_FIELD);
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  if (value === null) return "null";
  if (value === undefined) return "";
  try { return JSON.stringify(value).slice(0, MAX_FIELD); } catch { return "[unserializable]"; }
}

export function agentLog(event: string, fields: Record<string, unknown> = {}) {
  const pairs: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    const text = summarize(value);
    if (text) pairs.push(`${key}=${text}`);
  }
  const line = `${new Date().toISOString()} ${event}${pairs.length ? ` ${pairs.join(" ")}` : ""}\n`;
  queue = queue.then(() => write(line)).catch(() => {});
}

async function write(line: string) {
  try {
    const directory = join(dirname(getAgentHost().settings.settingsPath()), "logs");
    const file = join(directory, "agent.log");
    await mkdir(directory, { recursive: true });
    const info = await stat(file).catch(() => undefined);
    // 只保留一份轮转文件，桌面端不需要长期归档。
    if (info && info.size > MAX_BYTES) await rename(file, `${file}.1`).catch(() => {});
    await appendFile(file, line);
  } catch { /* 诊断日志失败不得影响对话 */ }
}
