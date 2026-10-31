import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ACT: 先隔离数据目录，避免加载服务端模块时读写真实 settings。
const dataDirectory = mkdtempSync(join(tmpdir(), "toonflow-opencode-"));
process.env.TOONFLOW_DATA_DIR = dataDirectory;

const { fetchProviderModels } = await import("@/modules/mediaGeneration/ai/models");
const { streamAi } = await import("@/modules/mediaGeneration/ai/index");

const originalFetch = globalThis.fetch;
const calls: { url: string; headers: Headers }[] = [];
const sse = [
  'data: {"id":"x","object":"chat.completion.chunk","created":1,"model":"m","choices":[{"index":0,"delta":{"role":"assistant","content":"hi"},"finish_reason":null}]}',
  "",
  'data: {"id":"x","object":"chat.completion.chunk","created":1,"model":"m","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}',
  "",
  "data: [DONE]",
  "",
].join("\n");

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const request = input instanceof Request ? input : undefined;
  const url = request?.url ?? String(input);
  calls.push({ url, headers: new Headers(init?.headers ?? request?.headers) });
  if (new URL(url).pathname.endsWith("/models")) {
    return new Response(JSON.stringify({ data: [{ id: "claude-sonnet-5" }] }), { status: 200, headers: { "content-type": "application/json" } });
  }
  return new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } });
}) as typeof fetch;

function lastCall() {
  const call = calls.at(-1);
  assert.ok(call, "没有捕获到请求");
  return call;
}

function assertAuthNeverOverridden(headers: Headers, expected: string) {
  assert.equal(headers.get("authorization"), expected, "Authorization 被覆盖");
}

try {
  // 1. 模型列表（OpenAI 协议）：带 OpenCode 会话头，鉴权不变。
  calls.length = 0;
  const models = await fetchProviderModels({ apiUrl: "https://opencode.ai/zen/go/v1", protocol: "openai-completions", apiKey: "sk-test" });
  assert.deepEqual(models.map(model => model.id), ["claude-sonnet-5"]);
  let headers = lastCall().headers;
  assert.match(headers.get("x-opencode-session") ?? "", /^[0-9a-f-]{36}$/);
  assert.equal(headers.get("x-opencode-client"), "pi");
  assertAuthNeverOverridden(headers, "Bearer sk-test");
  console.log("PASS 模型列表（openai-completions）携带会话头且 Authorization 不变");

  // 2. 模型列表（Anthropic 协议）：会话头与 x-api-key / anthropic-version 共存。
  calls.length = 0;
  await fetchProviderModels({ apiUrl: "https://opencode.ai/zen/go/v1", protocol: "anthropic-messages", apiKey: "sk-test" });
  headers = lastCall().headers;
  assert.equal(headers.get("x-api-key"), "sk-test");
  assert.equal(headers.get("anthropic-version"), "2023-06-01");
  assert.equal(headers.get("x-opencode-client"), "pi");
  assert.equal(headers.get("authorization"), null, "Anthropic 协议不应出现 Authorization");
  console.log("PASS 模型列表（anthropic-messages）与 x-api-key 共存");

  // 3. 非 OpenCode 供应商：不发这两个头。
  calls.length = 0;
  await fetchProviderModels({ apiUrl: "https://api.deepseek.com/v1", protocol: "openai-completions", apiKey: "sk-test" });
  headers = lastCall().headers;
  assert.equal(headers.get("x-opencode-session"), null);
  assert.equal(headers.get("x-opencode-client"), null);
  console.log("PASS 其他供应商不发 OpenCode 头");

  // 4. 节点生成（OpenAI 协议）：显式 sessionId 原样复用。
  const configured = (apiUrl: string) => ({
    provider: { apiUrl, apiKey: "sk-test", protocol: "openai-completions", models: [] },
    model: { id: "m", label: "M", contextWindow: 128000, maxOutputTokens: 4096, reasoningLevels: [] },
    baseUrl: apiUrl,
  }) as unknown as Parameters<typeof streamAi>[0];
  const context = { messages: [{ role: "user", content: "hi", timestamp: Date.now() }] } as never;

  calls.length = 0;
  for await (const _event of streamAi(configured("https://opencode.ai/zen/go/v1"), context, AbortSignal.timeout(5000), [], { sessionId: "run-123" })) { /* 消费到结束 */ }
  headers = calls[0]!.headers;
  assert.equal(headers.get("x-opencode-session"), "run-123");
  assert.equal(headers.get("x-opencode-client"), "pi");
  assertAuthNeverOverridden(headers, "Bearer sk-test");
  console.log("PASS 节点生成复用传入的 sessionId");

  // 5. 节点生成未传 sessionId：随机兜底，每次不同。
  calls.length = 0;
  for await (const _event of streamAi(configured("https://opencode.ai/zen/go/v1"), context, AbortSignal.timeout(5000))) { /* 消费到结束 */ }
  for await (const _event of streamAi(configured("https://opencode.ai/zen/go/v1"), context, AbortSignal.timeout(5000))) { /* 消费到结束 */ }
  const sessions = new Set(calls.map(call => call.headers.get("x-opencode-session")));
  assert.equal(sessions.size, 2);
  console.log("PASS 节点生成缺省会话 ID 每次随机");

  // 6. 节点生成（其他供应商）：不发这两个头。
  calls.length = 0;
  for await (const _event of streamAi(configured("https://api.deepseek.com/v1"), context, AbortSignal.timeout(5000))) { /* 消费到结束 */ }
  assert.equal(calls[0]!.headers.get("x-opencode-session"), null);
  console.log("PASS 其他供应商节点生成不发 OpenCode 头");

  console.log("\n全部通过");
} finally {
  globalThis.fetch = originalFetch;
  rmSync(dataDirectory, { recursive: true, force: true });
}
