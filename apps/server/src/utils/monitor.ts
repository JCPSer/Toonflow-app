const maxBodyBytes = 256 * 1024;

export type JsonRecord = Record<string, unknown>;

export function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

// ACT: 只允许 http(s) 基础地址，且不带账号密码/查询串，避免把代理变成任意 URL 取数器。
export function parseMonitorBase(value: unknown) {
  if (typeof value !== "string" || !value.trim() || value.length > 2048 || !URL.canParse(value)) return;
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) return;
  return url.href.replace(/\/+$/, "");
}

export async function readMonitorJson(url: string, timeout: number): Promise<JsonRecord> {
  // ACT: 不跟随重定向，避免把本地代理当作开放跳转通道。
  const response = await fetch(url, { signal: AbortSignal.timeout(timeout), headers: { Accept: "application/json" }, redirect: "error" });
  if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}`), { status: response.status });
  if (!response.headers.get("content-type")?.includes("json")) throw new Error("响应不是 JSON");
  if (!response.body) throw new Error("响应为空");
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      // ACT: 边读边限长，内容长度可伪造或缺失，不能先整体读进内存再判断。
      if (size > maxBodyBytes) throw new Error("响应过大");
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  return record(JSON.parse(new TextDecoder().decode(Buffer.concat(chunks))));
}

// ACT: 运行时错误多为英文，转成用户能直接照做的提示，其余原样保留。
export function friendlyMonitorError(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  if (/unable to connect|connection refused|econnrefused/i.test(message)) return "连接不上目标主机，请检查地址与网络";
  if (/timed? ?out|timeout/i.test(message)) return "请求超时，目标未响应";
  if (/redirect/i.test(message)) return "目标返回了重定向，请填写最终地址";
  return message;
}

// ACT: 多标签页会同时轮询同一台机器；1.5 秒内复用同一个请求，避免对外呼放大。
const cache = new Map<string, { expires: number; value: Promise<JsonRecord> }>();

export function cachedStatus(base: string, load: (base: string) => Promise<JsonRecord>) {
  const now = Date.now();
  const entry = cache.get(base);
  if (entry && entry.expires > now) return entry.value;
  const value = load(base);
  cache.set(base, { expires: now + 1500, value });
  value.catch(() => cache.delete(base));
  if (cache.size > 32) cache.delete(cache.keys().next().value!);
  return value;
}

export function invalidateStatus(base: string) {
  cache.delete(base);
}
