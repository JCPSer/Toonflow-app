# 测试结果：停止后无法被其他 Agent 唤醒

- 时间：2026-11-16 01:20
- 对应分析：`bug_analysis-2026-11-16-01-20-agent-paused-cannot-wake.md`

## 1. 改动

- `agentDispatcher.ts`：移除 `pausedNodes` 门槛，停止只清当前排队任务与在跑任务。
- `agentDispatcher.test.ts`：停止用例改为断言「停止后新的派发能重新启动目标节点」。

## 2. 测试

```text
bun test（apps/web, agentDispatcher）：5 pass / 0 fail
apps/web vue-tsc：仅既有 @/agentRuntime 基线错误
bun run --filter web build：成功；web 资产已同步
```

## 3. 待人工验收

- 停止 A 后，B 派任务给 A：A 重新开始运行并回复。
- 停止 A 时排队中的任务仍然不会自动跑（停止瞬间的清队列行为保留）。
