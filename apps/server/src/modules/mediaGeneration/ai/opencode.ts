import { uuidv7 } from "@earendil-works/pi-ai";

const OPENCODE_HOST = "opencode.ai";

export function isOpenCodeApi(apiUrl: string): boolean {
  try {
    // ACT: 用户从浏览器复制地址时可能带根域尾点；URL 会保留它，比较前去掉。
    return new URL(apiUrl).hostname.replace(/\.$/, "") === OPENCODE_HOST;
  } catch {
    return false;
  }
}

// ACT: OpenCode Go（Zen API）自 2026-09 起要求每个请求携带会话标识，缺失直接 400 MissingSessionID。
// 会话 ID 与 pi SDK 注入的格式保持一致（uuidv7，无前缀）；调用方有稳定 ID（如节点 runId）时复用，保住路由与缓存亲和。
// 只补标识头，绝不输出 Authorization / x-api-key，避免覆盖适配器用 apiKey 生成的鉴权头。
export function openCodeRequestHeaders(apiUrl: string, sessionId?: string): Record<string, string> | undefined {
  if (!isOpenCodeApi(apiUrl)) return undefined;
  return { "x-opencode-session": sessionId?.trim() || uuidv7(), "x-opencode-client": "pi" };
}
