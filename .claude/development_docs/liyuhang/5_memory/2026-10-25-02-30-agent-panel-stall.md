# Agent 面板工具后假死：空闲看门狗 + 可见重试（STAR）

## Situation

画布右侧 Agent 面板「工具结果都出来了，之后就不动了，只能手动停止再重发」。会话日志佐证：`aborted` 的 assistant 有 6–8 次紧跟 `toolResult`（18:42、20:04、20:06、20:07、20:10、20:11 等）。根因不在前端：`replyStream.ts` 只在 `done`/`error`/流关闭时退出；服务端 `routes/agent.ts` 每 20 秒写空行心跳，掩盖了「连接活着但一个字节都没有」。应用层 `agent/runtime/requests.ts` 对 LLM 请求没有任何空闲超时；SDK 的 `timeoutMs`（300s）只覆盖「响应头之前」（`openai/client.js` 收到响应头即 `clearTimeout`），流中停滞会无限等。

## Task

1. 「连上不吐字」在 2–3 分钟内被识别，而不是等用户手动停止。
2. 识别后自动重试（2 次、指数退避），并在面板上可见。
3. 重试耗尽或已流出内容时，给出可读错误并解锁输入框，保留已生成内容。
4. 不影响长回答（不砍 >5 分钟的流）、不影响用户「停止」语义。

## Action

- `agent/runtime/requests.ts` 新增 `createRequestGuard()`：两段计时——请求开始→首个流事件 `requestTimeoutMs`（180s，覆盖 getAuth/上传/建连/预填）、事件间隔 `idleTimeoutMs`（120s）；另加 `requestHardLimitMs`（30 分钟）。每个 attempt 独立 `AbortController`，以 `AbortSignal.any([init.signal, attempt.signal])` 传入自定义 fetch，绝不 abort 全局 signal；`stream.result()` 同样用 guard race，防「流被悄悄掐断但 result 不落地」。
- 超时文案分档：未流出内容 → `模型服务 180 秒无响应，已触发自动重试 [timeout]`（命中 pi-ai 的 `timeout` 正则才会被重试）；已流出内容 → 纯中文终态文案（不命中任何重试关键词，避免整轮重放重复输出）。
- `resources.ts` 默认 settings 改为 `retry: { enabled: true, maxRetries: 2, baseDelayMs: 2000 }`，压掉 SDK 默认 3 次。
- `types.ts` 增加 `retry` 事件，`runtime/index.ts` 转发 `auto_retry_start`。
- `conversation.vue`：重试提示条、等待计时（10 秒后显示「等待模型响应… Ns」），并在 `finally` 补 `if (ownsStream) remoteRunning.value = false`——评审确认 `replyStream.ts` 处理 error 行直接抛错、不会走 `receiveEvent`，`remoteRunning` 必然残留。

## Result

- 假上游实测：首次请求挂起 → 3s（测试值）触发 → `retry` 事件 → 2s 后成功，整轮 5.26s；先吐字再挂起 → 只调 1 次上游、报错保留内容；慢速吐字 + 5s 硬上限 → 按时中断并保留内容。
- server/web 类型检查与构建通过；已重打包 `/Applications/toonflow-exec.app`（备份 `/tmp/toonflow-exec-old11.app`）并重新签名。
- 边界：浏览器端提示条未点验（自研编辑器无法程序化输入）；每轮重发整段上下文，长会话重试代价较大；只发 SSE ping 超过 120s 会被判超时。
