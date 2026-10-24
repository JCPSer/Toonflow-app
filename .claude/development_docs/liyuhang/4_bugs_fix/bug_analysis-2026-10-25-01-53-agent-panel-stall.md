# Bug 分析：Agent 面板在工具执行后「假死」，必须手动中断才能继续

- 时间：2026-10-25 01:53
- 报告人：用户（打包 app `/Applications/toonflow-exec.app`，macOS arm64）
- 影响面：画布右侧 Agent 对话面板（`/api/agent` NDJSON 流），所有模型、所有会话

## 一、现象

用户原话：「右侧的 agent 交互面板总是时不时会卡住，比如有时操作工具完成后就一直不动了，需要用户手动打断再重新输入文本才能继续往下走。」

澄清后的补充信息（AskUserQuestion）：

| 维度 | 回答 |
| --- | --- |
| 卡住时面板状态 | 工具调用卡片与工具结果**都已显示**，但 agent 不再继续，也没有结束标记 |
| 触发工具 | 与工具类型无关，各种情况都遇到过 |
| 运行环境 | 打包后的 app（非 dev） |
| 模型 | 自建 OpenAI 兼容端点（TF-router / OpenCode-DP / MiniMax） |

关键点：**前端的工具结果渲染是正常的**，卡住发生在「工具结束之后、下一条 assistant 消息到达之前」。

## 二、链路事实（代码核对）

1. 前端 `conversation.vue:251` 用 `fetch("/api/agent", {method:"POST"})` 拿 NDJSON 流，`replyStream.ts:12-30` 逐行解析；只有收到 `{type:"done"}`、`{type:"error"}`、流关闭或本地 abort 才会退出循环，`busy`（`conversation.vue:75/319-332`）才会复位。
2. 服务端 `routes/agent.ts:46-48` 每 20 秒写一个空行心跳（仅保活，不做超时）；`done` 只有在 `u.agent.run()` 返回后才发送（`agent.ts:53-55`）。
3. `agent/runtime/index.ts:415` 一次 turn 的全部推进都在 `await session.prompt(...)` 里，LLM→工具→回灌→再请求的循环位于 SDK `pi-agent-core/dist/agent-loop.js:122-159`。
4. 应用层对 LLM 请求的包装在 `agent/runtime/requests.ts:43-303`，**没有任何空闲超时或请求超时**，`for await (const event of stream)`（`:262`）会一直等下去。
5. SDK 的自动重试默认开启（`settings-manager.js:581-597`：`enabled=true`、`maxRetries=3`、`baseDelayMs=2000`），但应用层**没有转发 `auto_retry_start` / `auto_retry_end` 事件**（`runtime/index.ts:297-383` 只处理 message/tool/compaction/stats），所以重试期间前端完全静默。
6. SDK 的 `timeoutMs`（默认 300 秒，`http-dispatcher.js:3`、`sdk.js:187-190`）以 openai 客户端 `timeout` 形式下发（`pi-ai/dist/api/openai-completions.js:208-212`），但**只覆盖「响应头之前」**：openai/anthropic SDK 在 `fetch()` resolve（收到响应头）时 `clearTimeout`（`openai/client.js:489-511`、`@anthropic-ai/sdk/client.mjs:634-700`）。**响应头之后的流中停滞没有任何本机超时**。另：`configureHttpDispatcher`（undici 的 `bodyTimeout`）只被 pi 自己的 CLI 入口调用（`pi-coding-agent/dist/main.js:456/686`），ToonFlow 从未调用。

## 三、会话日志取证

数据源：真实项目 `<工作区>/.agent/sessions/*.jsonl`（SDK 在每条 `message_end` 落盘；本次核对的是 `/Volumes/WD_BLACK_MAC/[0]【AI Art】/2026/黒木茜/ToonFlow项目-黑木/.agent/sessions/`）。

- 2026-10-23 会话（684 条）：`aborted` 的 assistant 消息 15 条，其中 **6 条紧跟在 `toolResult` 之后**（18:42:01、20:04:54、20:06:11、20:07:51、20:10:04、20:11:42），与用户描述的「工具结果出来后卡住 → 手动打断」完全一致。
- 同会话 19:58:21 出现 `stopReason=error`，`errorMessage="The operation timed out."`；该消息的时间戳是 19:54:06（约 255 秒），且此前已流出 thinking 与部分 toolCall，说明这是**上游在流中报错**，不是本机 300 秒超时。紧随其后（19:58:45）出现一条 `stopReason=aborted` 的空 assistant，正是 SDK 自动重试被用户打断的那一次。
- 2026-10-24 会话（226 条）：`aborted` 5 条，其中 3 条紧跟 `toolResult`（15:11:47、17:18:52、17:39:16）。
- `toolResult → 下一条 assistant` 的正常耗时分布：平均 14–23 秒，最大 78–104 秒。也就是说**慢和死的观感重叠**，用户往往在 50–70 秒后就打断。

## 四、Bug 矩阵

| 编号 | 描述 | 证据 | 优先级 | 难度 | 风险 |
| --- | --- | --- | --- | --- | --- |
| B1 | 工具结果回灌后的下一次 LLM 请求若上游无响应，应用层没有空闲超时，只能等 SDK 的 300 秒总超时才失败 | `requests.ts:262`、`sdk.js:187-190` | P0 | 中 | 若阈值过低会误杀慢首字（实测首个 token 可能 60s+） |
| B2 | SDK 自动重试 3 次、每次都要等满 300 秒，且应用层不转发重试事件 → 最坏十几分钟静默，UI 只有一个转圈 | `agent-session.js:2286-2320`、`runtime/index.ts:297-383` | P0 | 低 | 需要把 `auto_retry_*` 映射成前端可展示的事件 |
| B3 | 「响应头之前」有 300 秒兜底，「响应头之后」完全没有任何本机超时；两者都不看是否有字节流入，因此长流不会被砍，但「连上不吐字」会无限等 | `openai-completions.js:208-212`、`openai/client.js:489-511` | P0 | 中 | 新增空闲判定即可，**不需要**动既有 `timeoutMs` |
| B4 | 前端 `remoteRunning` 只在 `done`/`error` 时复位，网络异常/看门狗触发后如果走的是异常分支，面板可能残留「运行中」状态 | `conversation.vue:108-114` | P2 | 低 | 需与 B1 的错误路径一起验证 |
| B5 | 工具自身不响应 abort（`askUser` 无超时、MCP 单次 30 分钟、画布 `transcribeAudio` 不设计时器），并行批次会整体等待 | `bridge/question.ts:7-8`、`utils/mcp/servers.ts:208`、`bridge/canvas.ts:38` | P2 | 高 | 强制中断会破坏长任务语义；本期只做「可见的等待计时」，不做强制掐断 |

**判定**：B1 + B2 是本 bug 的直接成因；B3 是同一处设计的副作用；B4/B5 是放大与残留问题。

## 五、目标（本期）

1. 「连上但不吐字」在 **90 秒**内被识别为异常，而不是等 5 分钟。
2. 识别后**自动重试**（默认 2 次，指数退避），并在面板上**明确显示**「连接异常，正在重试（1/2）」，用户能判断是活是死。
3. 重试耗尽后给出可读错误并**解锁输入框**，且不丢已经流出的内容。
4. 长时间正常生成（>5 分钟）**不再**被总超时误杀。
5. 等待期间面板显示已等待秒数，超过阈值时提示可能卡住。

## 六、明确不做

- 不引入 SSE 断线重连 / Last-Event-ID（当前是单次 POST 流，重连等于重发，语义不同）。
- 不对媒体生成、MCP、画布这类长任务工具设置强制中断（B5 只做展示）。
- 不改动上下文压缩策略。

## 七、关键风险

| 风险 | 说明 | 处置 |
| --- | --- | --- |
| 误杀慢首字 | 上游上下文大、首 token 可能 60s+ | 首字阈值与流中阈值分开配置，默认首字 120s、流中 60s |
| 重试重复计费 | 自动重试会重复发起请求 | 只在**尚未输出任何可见内容**时重试；已流出内容则直接报错 |
| 与 SDK 既有重试叠加 | SDK 自身也会重试 | 统一在一处配置，避免 2×3 次放大 |
| 打包产物验证 | 用户在用打包 app | 修复后在 `/tmp` 测试工作区跑 E2E，再重打包 |

## 八、评审意见

| 评审人 | 意见 | 结论 |
| --- | --- | --- |
| 子 agent（2026-10-25 02:0x） | ① `timeoutMs` 只覆盖响应头之前，B3 原描述错误；② `The operation timed out.` 来自上游流中错误（约 255s），非本机 300s；③ 自造 `stopReason:"error"` 仍会触发 SDK 重试（日志 19:58:21→19:58:45 佐证）；④ 插入点应为 `requests.ts`，且必须 abort 本次 attempt 而非全局 signal；⑤ 前端 `remoteRunning` 在 error 路径**必然**残留（`replyStream.ts:25` 直接 throw 不走 `receiveEvent`）；⑥ 90s 阈值会误杀 2–3 次正常请求（p95=52s，max=100.8s）；⑦ SDK 重试前已把 error assistant 落盘，重试需用「可见内容门禁」避免整轮重放 | 已全部采纳，B3 与取证描述已按实修正 |
| 用户 | | |
