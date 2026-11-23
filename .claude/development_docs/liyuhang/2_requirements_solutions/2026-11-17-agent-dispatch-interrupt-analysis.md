# Bug/需求分析：Agent 通信改为打断式

- 时间：2026-11-17
- 范围：`apps/web/src/pages/workspace/panels/canvas/agentDispatcher.ts`、`apps/server/src/routes/agent/*`、`apps/server/src/agent/runtime/sessions.ts`、`apps/server/src/agent/tools/sendToAgent.ts`
- 现象：A 给正在跑任务的 B 派活时，消息只能进队列等 B 当前一轮彻底结束；B 可能还要跑很久的画布节点，导致指令严重滞后。

## 需求矩阵（已由用户确认）

| # | 场景 | 期望 | 优先级 |
| --- | --- | --- | --- |
| R1 | B 正在执行的正是**同一发送方 A** 的上一条任务 | 硬打断当前运行，立即执行新消息 | P0 |
| R2 | B 正在执行**其他 Agent** 的任务 | 不打断，新消息排队；同发送方（A）旧排队消息只保留最新一条，其他 Agent 的排队不动 | P0 |
| R3 | 被打断任务的**原派发方** | 收到「被停止/被打断」通知，不自动续跑（与现有 stop 语义一致） | P0 |
| R4 | B 正在跑**用户面板里手动发起**的对话 | 同样硬打断 | P1 |
| R5 | 任务**结果回传**（kind=result） | 不参与硬打断，仍按排队处理（结果是数据不是新指令，打断会白丢一轮工作） | P1（按约束推导） |

## 现状与根因
- `agentDispatcher.pump/canStart` 用 `runningNodes` + `panelRunning` 保证「一个节点同时只跑一个任务」，任何新任务只能排队。
- `stop(nodeId)` 只能由用户手动触发，没有「同一发送方新消息覆盖旧任务」的通道。
- 服务端已有 `ActiveAgentSession.abort()`（单 Agent 运行收尾、释放文件锁），但只被「带提问时的新消息」使用，没有对外 API。
- 服务端 `/api/agent` 在会话仍 active 且 streaming 时会走 `streamingBehavior: "steer"`。如果打断后不等待旧 run 真正收尾就发新请求，新消息会被 steer 进正在退场的旧 run，表现为消息丢失。

## 关键风险
1. **打断与重启之间的竞态**：必须等旧 run 收尾（会话注销、文件锁释放）后再发新请求，否则 409 或 steer 丢失。
2. **客户端 vs 服务端中断源**：dispatcher 自己持有的任务可以 abort 本地 fetch；用户面板发起的运行在另一个请求里，dispatcher 必须走服务端 API 才能打断。
3. **打断面板运行的显示**：面板 stream 被服务端掐断后可能停在半截回复，需要补一条错误/完成事件让 UI 复位。
4. **同发送方判定**：任务要记录 `fromNodeId`；结果回传任务的 fromNodeId=toNodeId，不能套用「同发送方打断」。
5. **排队替换**：只替换 `kind=task` 且 from/to 都相同的排队项，并同步收掉它的关系箭头与去重键。

## 验收要点
1. A 给 B 派活 → 运行中 A 再发一条 → 旧任务中断、B 立刻开始新消息、A 收到旧任务「被打断」通知。
2. C 派的任务在跑、A 再派 → 不打断，排队；A 连发多条只保留最新；C 的排队不受影响。
3. 用户在 B 面板里发消息运行中，A 派活 → B 面板运行被打断，派发任务开始；面板显示被打断提示。
4. 子 Agent 结果回传不打断父 Agent 当前运行。
5. 停止、去重、箭头、并发上限等既有行为不变。

## 评审意见（子 agent）
（见方案文档）
