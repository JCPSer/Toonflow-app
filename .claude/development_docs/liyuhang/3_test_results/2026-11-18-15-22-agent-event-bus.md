# 测试记录：Agent 事件总线多路复用（连接池耗尽修复）

- 时间：2026-11-18 15:22
- 变更：服务端 `agent/bus.ts`、`routes/agent/bus.ts`、`routes/agent/abortRun.ts`、`routes/agent.ts`、`router.ts`；客户端 `agentBus.ts`、`agentRun.ts`、`conversation.vue`、`agentDispatcher.ts`、`replyStream.ts`、`netProbe.ts`

## 自动化

| 项 | 命令 | 结果 |
| --- | --- | --- |
| 服务端总线 | `bun test src/agent/bus.test.ts` | 4 pass（含替换后旧 close 不误杀新通道） |
| 服务端全量 | `cd apps/server && bun test` | 165 pass / 0 fail |
| 服务端类型检查 | `bun run --filter '@toonflow/server' typecheck` | 通过 |
| 客户端总线 | `bun test src/components/agent/agentBus.test.ts` | 5 pass（分发/done、并发互不串台、中断 abort、消费端 break abort、断线失败并取消） |
| 画布 dispatcher | `bun test .../agentDispatcher.test.ts` | 19 pass（总线 mock 404 验证直连回退） |
| Web 类型检查 | `bun run --filter '@toonflow/web' typecheck` | 仅既有 `@/agentRuntime` 基线错误 |
| 构建 | `build:web`、`build:desktop` | 成功 |
| 部署 | 入口 `app/bun/index.js` + `views/mainview` | 完成，备份后缀 `20261118-152205`；入口 17,860,054 B、含 `BrowserWindow`；视图入口 `assets/index-Alv5w5Fd.js` |

## 关键断言

- 同一窗口只建立一条 `/api/agent/bus`；多个 run 的事件按 runId 分发，互不串台。
- runId 由客户端生成并在启动前登记，事件早于启动响应也不会丢。
- 正常 done、消费端 break、AbortController 中断、总线断开四种退出路径都会清理 Entry，并（未完成时）调用 `/api/agent/abortRun`。
- 服务端重复连接替换后，旧连接的 close 不会关闭新总线；关闭总线会 abort 该通道所有运行。
- 旧服务端（404）时自动回退直连 NDJSON；EBUSY 双路径重试保持兼容。

## 手工验收矩阵（待用户重启）

| # | 场景 | 预期 |
| --- | --- | --- |
| 1 | 画布同时运行 6 个 Agent | 面板能正常打开、显示实时内容；画布保存不再报错 |
| 2 | DevTools Network | 只有一条 `/api/agent/bus` 长连接；`/api/agent` 为短请求 |
| 3 | 停止某个 Agent / 关闭面板 | 该 run 结束，服务端无遗留运行 |
| 4 | 刷新页面或切换项目 | 旧总线断开，所有运行中止；下次发送自动重连 |
| 5 | 远程连接模式 | 总线经代理可用；异常时回退直连，功能不退化 |
| 6 | 网络抖动 | 当前批次失败并提示通道断开；再次发送自动恢复 |

## 已知风险

- 单连接复用：总线断开会影响该窗口全部运行（已立即 abort + 自动重连）。
- 总线 Entry 的事件队列无上限；本地单用户、慢 UI 极端情况下内存随文本增量增长（暂未合并增量）。
- `abortRun` 仅凭 runId，同机同源页面可互相取消（本地单用户接受）。
