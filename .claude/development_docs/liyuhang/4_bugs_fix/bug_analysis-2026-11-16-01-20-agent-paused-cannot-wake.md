# Bug 分析：手动停止 Agent 后，别的 Agent 再也唤不醒它

- 时间：2026-11-16 01:20
- 类型：交互缺陷（停止语义过度）
- 改动评估：极小（删除一段状态门槛），按规范记录操作

## 1. 现象

用户在节点 A 的面板点「停止」后，其他 Agent 再通过 `sendToAgent` 派任务给 A：任务被静默丢弃，节点一直停在等待输入，像「再也唤不醒」。

## 2. 根因

上一版为了实现「停止后不要被排队任务/回传立刻拉起」，在 dispatcher 里加了 `pausedNodes`：

- `stop()` 命中后把节点加入 `pausedNodes`；
- `enqueueFromEvent` / `enqueueResultTo` 遇到 paused 直接 return；
- 只有用户在该面板手动发送（`notePanelRun(nodeId, true)`）才解除。

结果是「停止某个任务」被扩大成「拒绝之后所有派活」，与用户预期不符：停止应只作用于停止这一刻的在跑任务与排队任务。

## 3. 修复

- 删除 `pausedNodes` 及其三处门槛（入队、结果投递、canStart）与解除逻辑。
- `stop()` 保留原有效行为：清该节点排队任务、清去重记录、abort 在跑任务。
- 新增回归断言：停止后新的派发必须能重新启动目标节点。

## 4. 测试

- `bun test agentDispatcher.test.ts`：5 pass / 0 fail（停止用例改为「停止后新派发可唤醒」）。

## 5. 评审意见

（极小改动，未开子 agent 评审；用户已用现象确认问题。）
