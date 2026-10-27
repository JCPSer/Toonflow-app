# Bug 修复方案：submitProvider 被统一改写成「工具调用已取消」

- 记录时间：2026-10-27 14:05
- 对应分析：`bug_analysis-2026-10-27-13-55-submit-provider-cancelled.md`
- 目标版本：桌面安装包（server + web 打包后同步到 `/Applications/toonflow-exec.app`）

## 一、方案总览

本次分三块，彼此独立、可单独回滚：

| 编号 | 目标 | 改动面 |
| --- | --- | --- |
| S1 | 中止真实原因透传（错误码 + 中文原因） | `singleAgent/index.ts`、`routes/singleAgent/run.ts` |
| S2 | 最小可追查运行日志（run 生命周期、客户端工具派发/回传、中止来源、模型请求超时） | 新增 `lib/agentLog.ts`、`singleAgent/index.ts`、`run.ts`、`agent/runtime/requests.ts` |
| S3 | 客户端工具硬超时，避免无限挂起 | `singleAgent/index.ts` |

S1/S3 直接改善用户与模型的自救能力；S2 用于把 B3（运行信号中止 vs 整轮控制器中止）坐实——用户重启应用复现一次后，日志即可定性，我们再据此做根因修复。

## 二、S1：中止原因透传

### 2.1 现状

- `run.ts` 的 `abort()` 调 `controller.abort()` 不带 reason → reason 退化成通用 `AbortError`。
- `createClientTool` 的 abort 监听器忽略 `signal.reason`，一律 `new Error("工具调用已取消")`。
- `close()` 先 `controller.abort()` 再逐个 `finish("临时对话已关闭")`，abort 监听器先跑，所以「会话已关闭」也被显示成「工具调用已取消」。

### 2.2 设计

1）`run.ts` 的三条断连监听各自带明确 reason（不改中止时机）：

```
abortWith(reason) := 若 controller 未 abort 则 controller.abort(new Error(reason))
res.close      → "对话连接已关闭"
req.aborted    → "请求已中断"
req.socket.closed → "网络连接已断开"
```

（同时保留 `if (res.writableFinished) return` 之类的既有守卫语义，仅在 `run.ts` 侧补 reason。）

2）`run()` 里把外部 signal 的 reason 原样传给 `active.controller.abort(reason)`；reason 缺失时用 `new Error("对话连接已关闭")`。

3）`createClientTool` 的 abort 监听改用统一的中止错误构造函数：

```
abortReasonText(signal) :=
  reason 是 Error → reason.message
  reason 是 string → 去空白后的字符串
  否则 → ""
错误消息 := 有原因 ? "工具调用被中止：<原因>" : "工具调用被中止：对话已关闭或已停止"
错误对象附加 code = "TOOL_ABORTED"（供日志与后续错误码展示）
```

4）`close()` 的收尾顺序改为：先给每条挂起调用 `finish("临时对话已关闭")`，再 `controller.abort()`。这样「会话被关闭」这个最具体的原因不会被 abort 监听器抢走（S1 的顺带修正，语义不变）。

5）`control("stop")` 的 reason 保持 `本次回复已停止`，同样经 `abortReasonText` 透出。

### 2.3 UI 影响

`providerAgentDialog.vue` 的模板只会显示 `tool.result`，因此用户会看到「工具调用被中止：对话连接已关闭」这类可读原因，不需要改前端。模型侧同样收到这段文本，可以据此判断「是不是用户关掉了对话框」还是「网络断了」，不再盲目重试。

## 三、S2：运行日志

### 3.1 位置与格式

- 文件：`<dataDirectory>/logs/agent.log`（桌面版即 `/Applications/data/logs/agent.log`）。
- 每行：`ISO 时间 事件 键值对`，纯追加，单文件超过 2 MB 时轮转到 `agent.log.1`（只保留 1 份）。
- 全部 best-effort：`mkdir/stat/append/rename` 任一失败都吞掉异常，绝不阻塞对话；写入串行化（单 Promise 链）避免并发交错。

### 3.2 记录点

| 事件 | 字段 |
| --- | --- |
| `run.start` | sessionId、runId、provider、model、工具名列表 |
| `clientTool.dispatch` | callId、name、参数字节数 |
| `clientTool.result` | callId、ok/error、耗时、controllerAborted |
| `control` | sessionId、action（pause/resume/stop/close）、runId —— **前端主动中止的唯一入口** |
| `session.close` | sessionId、是否有运行中的 run |
| `run.abort` | reason 文本、耗时、当时 status |
| `run.signal.abort` | 仅当 SDK 运行信号单独中止、整轮控制器未中止时记录（B3 判据） |
| `run.failed` | 耗时、aborted、reason、错误摘要 |
| `model.request.timeout` | phase（response/idle/limit）、seconds、visible |
| `run.end` | sessionId、runId、耗时 |

其中 `run.signal.abort` 是 B3 的判据：
- 出现 `control action=close|stop` + `run.abort` → 前端主动中止（对应 4.3 的来源清单），问题在 UI 为什么会触发 reset/stop；
- 只出现 `run.signal.abort` 而没有 `run.abort` → 运行信号被单独中止（当前代码里只有 `session.abort()/dispose()` 能做到），可据此继续追。

### 3.3 实现要点

- 新增 `apps/server/src/lib/agentLog.ts`：导出 `agentLog(event: string, fields: Record<string, unknown>)`，内部做序列化（`Error` 取 message）、截断（单值 300 字）、串行写入、轮转。
- 调用点只加一行，不改变控制流。

## 四、S3：客户端工具硬超时

在 `createClientTool.execute` 里：

```
注册 abort 监听的同时启动 600 s 计时器
计时器触发 → finish(new Error("客户端工具在 600 秒内没有返回结果，已中止本次调用"))
finish() 里统一 clearTimeout
```

超时值选 600 s：唯一的客户端工具是静态检查（`/api/providers/media/validate`，实测 3 ms），600 s 只用来兜住「回传事件丢失」这一类异常，不会误伤。

## 五、验收

1. 类型检查：`apps/server`、`apps/web` 均通过。
2. 隔离实例复现脚本（`/tmp/ssprobe/probe2.mjs` 同款）验证：
   - 正常路径仍成功（validate → toolResult → 模型续跑 → complete）。
   - 工具执行中途 `control(close)` → 工具结果文案变成「工具调用被中止：临时对话已关闭」，且 `agent.log` 依次出现 `control action=close`、`session.close`、`run.abort reason=临时对话已关闭`。
   - 工具执行中途 `control(stop)` → 文案为「工具调用被中止：本次回复已停止」。
   - 中途断开 HTTP 连接 → **服务端无感知**（Bun 不上报断开），这一条不作为验收项；改由 600 s 硬超时兜底。
   - 不调 `toolResult` 连续等待 → 600 s 后得到超时文案（实现时用 4 s 临时值验证触发与文案，随后恢复 600 s 并让文案由常量派生）。
3. 用户实机：重启应用后复现一次，把 `logs/agent.log` 里对应时段的 `control` / `session.close` / `run.abort` / `run.signal.abort` / `model.request.timeout` 行取出，据此判定 B3 的根因并做第二轮修复。

## 六、错误码与降级语义

- 中止产生的错误对象带 `code = "TOOL_ABORTED"`，但 SDK 的错误工具结果只保留文本，因此**错误码只落日志**，用户与模型看到的是文案里的原因。要透到前端需要 SDK 支持 `details`，属非目标。
- 600 s 硬超时只废弃**这一次工具调用**（结果文本变成超时说明，模型据此决定是否重试），不中止整轮；整轮中止仍只由 `control(stop/close)` 与提问取消驱动。
- 整轮文案「本次回复已停止」本轮不改（会影响既有交互预期），但 `run.abort` 日志会记下真实 reason。

## 七、非目标

- 不猜测性调整模型请求看门狗的超时值，也不改 `agent-loop` 的串行语义。
- 不动 `browser` 插件行为；`askUser` 取消会连带中止整轮（`index.ts:191`）本轮保留，若日志证实触发源在提问链路再单独立项。
- 工具结果文本不走 `translateError`，非中文界面下仍是中文——已知缺陷，本轮不改。
- 前端 toolResult POST 与 run signal 解耦（B6）、断连后 session 清理留待下一轮。

## 八、风险与回滚

| 风险 | 处置 |
| --- | --- |
| 日志写盘失败影响对话 | 全部 try/catch 吞掉；写入队列串行，不 await 在关键路径上 |
| 日志泄漏敏感信息 | 只记录 sessionId/runId/工具名/错误摘要，不记录源码内容、API Key、消息正文 |
| 错误文案变更影响前端展示 | 前端只透传 `tool.result`，无结构依赖；i18n 词典由源码抽取生成，新中文串无词条时 `translate` 回退原文 |
| 工具结果进入模型可见历史 | 文案从「工具调用已取消」变成带原因的句子，会让前缀缓存失效一次，属可接受成本 |
| `close()` 收尾顺序调整 | 只调整 finish 与 abort 的先后，pending 调用结果文案更具体；不影响已完成调用 |
| `run.ts` 的 reason 化 abort 在桌面端不触发 | 保留（Node/Docker 部署仍有效），定位主要依赖 `control` / `session.close` 日志 |

## 九、评审意见

- 子 agent 初审（2026-10-27 14:30，基线 `23c190f`）：必改 6 条全部落到本轮实现——4.2 降级为复现路径并补证据、B3 改为「未知中止源」、4.3 标注 `run.ts` 在 Bun 下不触发与 close 原因分支不可达、B4 升级为永久挂起 + session 泄漏并给硬超时、`index.ts:287` 的整轮吞因并入 B1（本轮只记日志不改文案）、`control()`/`close()` 增加 action 日志。建议改部分（工具结果不走 i18n、B6、断连清理）落进非目标，并补了错误码契约（第六节）。
- 用户评审：（待填）
