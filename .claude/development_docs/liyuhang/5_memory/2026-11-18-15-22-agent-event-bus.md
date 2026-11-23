# START 记忆：Agent 事件总线多路复用

- 时间：2026-11-18 15:22
- 关联：`4_bugs_fix/bug_analysis-2026-11-18-15-10-agent-connection-exhaustion.md`、`bug_solution-2026-11-18-15-14-agent-connection-exhaustion.md`、`3_test_results/2026-11-18-15-22-agent-event-bus.md`

## Situation
6 个 Agent 并行时，每个运行独占一条 `/api/agent` NDJSON 长连接，正好占满 WebKit 同源 6 条 HTTP/1.1 上限；面板读取与画布保存排队卡死，分别表现为「正在读取对话…」和「画布保存失败」。

## Task
同一窗口所有 Agent 运行复用一条连接；保留事件语义、停止/断线取消、旧服务端回退。

## Action
1. 服务端新增 `agent/bus.ts`（每窗口一条 NDJSON 总线，`{runId,event}` 行，心跳、连接关闭 abort 全部运行、按对象身份防旧 close 误杀、上限 16 条按最后活动淘汰）与 `routes/agent/bus.ts`、`routes/agent/abortRun.ts`。
2. `/api/agent` 带 `x-agent-bus-id` 时返回 `{runId}` 并异步运行，事件走总线；支持客户端 `x-agent-run-id` 预登记（UUID、防重复），错误保留 code。
3. 客户端 `agentBus.ts`：懒建立单连接、按 runId 分发、客户端预生成 runId、断线失败并 abortRun、409 bus_closed 重连一次、校验 content-type、登记 trackStream。
4. `agentRun.ts` 统一入口：总线优先、失败回退直连；EBUSY 指数退避且可中断；conversation 与 dispatcher 改用它，dispatcher 保留 10×150ms 重试。
5. `netProbe` 增加非浏览器环境保护。

## Result
- 服务端 165 pass、客户端总线 5 例、dispatcher 19 例通过；typecheck 通过（web 仅既有基线错误）；web/desktop 构建成功。
- 入口与视图已同批部署（入口 17,860,054 B，备份 `20261118-152205`），未重启，由用户退出重开。
- 已知：总线断开会中止该窗口全部运行；Entry 事件队列无上限；abortRun 未加目录归属校验。
