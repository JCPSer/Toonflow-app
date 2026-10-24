# Bug 修复方案：Agent 面板工具后「假死」

对应分析：`bug_analysis-2026-10-25-01-53-agent-panel-stall.md`（B1–B5，已按子 agent 评审修正 B3 与取证结论）

## 一、目标与总体思路

把「上游不吐字」从「无限静默，只能手动停止」改为「2–3 分钟内识别 → 可见地自动重试 → 仍失败就报错并解锁输入框」。

```
工具执行完 ──> 发起下一轮 LLM 请求（长会话请求体可达数十 MB）
                 │
                 ├─ 180s 内拿到首个流事件 ──> 正常
                 ├─ 180s 无首个事件 ──> abort（响应超时）
                 │        └─> 未流出可见内容 → 自动重试 1/2（UI 提示）
                 └─ 流中 120s 无新事件 ──> abort
                          ├─ 未流出可见内容 → 自动重试
                          └─ 已流出内容 → 终止并报错，保留已生成内容
```

## 二、详细设计

### 2.1 空闲看门狗（服务端，B1/B3）

位置：`apps/server/src/agent/runtime/requests.ts`，新增 `createRequestGuard()` 并在 `streamFunction` 内按 attempt 使用。

- **只分两段计时**：「请求开始 → 首个流事件」`requestTimeoutMs`（默认 180s，覆盖 OAuth 取鉴权、上传、建连、预填、首字）；「事件间隔」`idleTimeoutMs`（默认 120s，每收到一个事件重置）。
- **不动既有 `timeoutMs`**：它只兜「响应头之前」，改大反而丢掉这层保护；流中停滞由本看门狗接管。
- 额外 `requestHardLimitMs`（默认 30 分钟）：持续吐字但永不结束也会被掐断。
- **只 abort 本次 attempt 的 controller**（`AbortSignal.any([init.signal, attempt.signal])`），不动 `options.signal`，保证与用户「停止」语义区分；停止走原路径，`stopReason=aborted`，不会触发重试。
- 计时覆盖 `getAuth`：第一次 guard 在取鉴权前创建，鉴权 signal 与它合并。
- `stream.result()` 也用同一个 guard 做 race，防止「流被悄悄掐断但 result 永不落地」。

### 2.2 错误分类与重试边界（B2）

- 超时 → 自造 `AssistantMessage{stopReason:"error", errorMessage}`：
  - 未流出可见内容（可重试）：`模型服务 180 秒无响应，已触发自动重试 [timeout]`（英文关键词用于命中 pi-ai 的 `timeout` 正则）
  - 已流出可见内容（不可重试）：`等待模型响应超时（120 秒无新内容），已保留已生成内容`（纯中文，不命中任何重试关键词）
  - 硬上限：`本次回复超过 N 秒上限，已中断并保留已生成内容`
- 重试预算统一在 `createAgentResources` 的默认 settings 里配置：`retry: { enabled: true, maxRetries: 2, baseDelayMs: 2000 }`，避免与 SDK 默认 3 次叠加。
- 已知副作用（评审指出）：SDK 重试前已把 error assistant 落盘，只从内存 state 移出；因为「已流出内容不重试」，重放只会发生在内容为空时，不会重复渲染正文。

### 2.3 重试事件的透出

- `AgentEvent` 增加 `{ type: "retry"; attempt; maxAttempts; delayMs; errorMessage }`。
- `runtime/index.ts` 的 `session.subscribe` 转发 `auto_retry_start`。
- 前端 `conversation.vue` 渲染提示条：`连接异常（模型服务 180 秒无响应…），2 秒后自动重试（1/2）`，收到后续文本/工具事件即消失。

### 2.4 等待可见性（B4）

- `conversation.vue` 本地静默计时：`busy` 且 10 秒无事件时显示「等待模型响应… Ns」，每秒刷新，不发额外协议事件。
- `remoteRunning` 复位：`replyStream.ts` 处理 `error` 行时直接抛错、不会走到 `receiveEvent`，因此在 `sendMessage` 的 `finally` 里补 `if (ownsStream) remoteRunning.value = false`（评审确认这是必然残留，不是偶发）。

### 2.5 未做（明确边界）

- 工具层强制中断（`askUser`、MCP 30 分钟、`transcribeAudio`）：只影响「工具不返回」场景，本期不做；工具卡片计时也一并留到后续。
- 字节级空闲检测（TransformStream）：事件级判定下，上游只发 SSE 注释/ping 超过 120 秒会被判超时，属可接受取舍。

### 2.6 配置项

读取 `conf.get("settings", {}).agent`，缺省用默认值，不改配置文件结构：

| 配置 | 默认 | 说明 |
| --- | --- | --- |
| `agent.requestTimeoutMs` | 180000 | 请求开始 → 首个流事件（含鉴权、上传、预填） |
| `agent.idleTimeoutMs` | 120000 | 流中事件间隔 |
| `agent.requestHardLimitMs` | 1800000 | 单次请求硬上限，0 = 关闭 |

### 2.7 修改文件

| 文件 | 变更 |
| --- | --- |
| `apps/server/src/agent/runtime/requests.ts` | `createRequestGuard`、attempt 级 AbortController、超时文案分档、`stream.result()` race |
| `apps/server/src/agent/runtime/resources.ts` | `createAgentSettings()`：retry 2 次、退避 2s |
| `apps/server/src/agent/runtime/index.ts` | 转发 `auto_retry_start` |
| `apps/server/src/agent/runtime/types.ts` | `AgentEvent` 增加 `retry` |
| `apps/web/src/components/agent/conversation.vue` | 重试提示条、等待计时、`remoteRunning` 兜底复位 |

## 三、边界与异常

| 场景 | 行为 |
| --- | --- |
| 首字本来就慢（150s） | 不触发（阈值 180s）；面板显示等待计时 |
| 首字 181s | abort → 无可见内容 → 自动重试，UI 出现提示条 |
| 流中 120s 无新事件 | abort → 有内容则终止保留、无内容则重试 |
| 已流出部分文本后断流 | 不重试，提示「已保留已生成内容」，输入框解锁 |
| 用户主动停止 | 走原 abort 路径，`stopReason=aborted`，不触发重试 |
| 长回答 >5 分钟 | 不受影响（既有 `timeoutMs` 只在响应头前生效，30 分钟硬上限兜底） |
| 上下文压缩请求卡住 | 压缩走同一 `streamFunction`，同样受看门狗保护 |
| 超长会话（多轮工具、上下文很大） | 每轮重发整段上下文，停滞概率随会话增长、预填变慢属正常；看门狗只掐「完全无字节」，重试会重发整段请求（含图片） |
| 工具自身不返回 | 不在本期范围，仅显示等待计时 |

## 四、测试（详见 `3_test_results/2026-10-25-02-15-agent-panel-stall.md`）

| # | 用例 | 结果 |
| --- | --- | --- |
| 1 | 假上游第 1 次请求永不响应 | 3s 触发（测试配置）→ `retry` 事件 → 2s 后第二次请求成功 → `done`，总耗时 5.26s |
| 2 | 假上游先吐 1 段文本再挂起 | 3s 触发 → 报错「已保留已生成内容」，只发生 1 次上游调用（未重试） |
| 3 | 假上游持续慢速吐字 | 硬上限 5s 触发 → 报错并保留内容，未走重试 |
| 4 | 真实模型常规对话 | 由用户重打包后验证 |
| 5 | 用户主动停止 | 代码路径未改动，`stopReason=aborted` 不重试 |

## 五、评审意见

| 评审人 | 意见 | 结论 |
| --- | --- | --- |
| 子 agent | ① 插入点应为 `requests.ts` 事件循环 + 每请求 AbortController；② 不要 abort 全局 signal；③ 动 `timeoutMs` 无意义（只到响应头）；④ 已流出内容必须用「文案正则」避开重试；⑤ 前端 `remoteRunning` 必然残留，需在 finally 复位；⑥ 并发 413 的 `restart` 与看门狗要独立计数 | 已全部落地；看门狗与 413 的 `restart` 各自独立（看门狗在 attempt 内，`restart` 仍在原循环），未叠加 |
| 用户 | 阈值选择 | 采纳「保守档」：首字 180s / 流中 120s；自动重试 2 次且界面可见；不关闭既有总超时 |
