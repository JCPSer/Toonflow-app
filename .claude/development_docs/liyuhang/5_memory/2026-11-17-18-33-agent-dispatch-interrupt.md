# START 记忆：Agent 通信改为打断式

- 时间：2026-11-17 18:33
- 关联：`2_requirements_solutions/2026-11-17-agent-dispatch-interrupt-analysis.md`、`-solution.md`

## Situation
画布 Agent 之间派活只走队列：目标节点正在跑（还在跑它自己的画布节点）时，新消息要等整轮结束，指令严重滞后。用户确认打断规则：同一发送方的新消息硬打断；其他 Agent 的任务在跑时排队，但同发送方旧排队只留最新；被打断的原派发方收到通知；用户在面板里的运行也允许被硬打断。

## Task
在 dispatcher + 服务端补齐硬打断能力，且不破坏去重、停止、关系箭头、并发上限，也不能在打断与重启之间把消息 steer 进正在退场的旧 run。

## Action
1. 服务端：`abortAgentSession(path)` 返回 `none|finished|timeout`，`finished.resolve()` 移到 prune/附件清理之后；新增 `POST /api/agent/abort`；`AgentEvent.error` 增加 `code`，runtime 的忙与文件锁错误透传 `EBUSY`。
2. dispatcher：Task 增加 `interruptReason`；入队时按「同 from→to 只留最新」替换排队；同一发送方在跑则 `preemptTask`（abort 本地流 + 服务端 abort + 闸门），面板在跑则 `preemptPanel`（本地 interruptRun + 服务端 abort + 3s 强制放闸）；`preempting` 闸门阻止打断未收尾时启动新任务；新任务插队首；去重仍只拦完全相同消息。
3. 面板：conversation 暴露 `interruptRun(reason)`，复用了 stoppedByUser 语义（不自动续发队列/目标），外部打断期间收尾 error/done 只做状态复位；agentNodePanel 转发。
4. 工具：`sendToAgent` 描述更新、返回 status 改为 dispatched。

## Result
- dispatcher 10 例、server agent 39 例全过；server typecheck 通过；web 仅既有基线错误。
- 已构建并同步到桌面端（web + bun/index.js），未重启应用。
- 待用户重启验收打断/排队/面板打断三条主链路；abort 超时与结果回传不打断暂无自动化覆盖。
