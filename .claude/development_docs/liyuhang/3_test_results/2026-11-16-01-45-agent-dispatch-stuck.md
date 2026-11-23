# 测试结果：Agent 派发卡住

- 时间：2026-11-16 01:45
- 对应分析：`bug_analysis-2026-11-16-01-45-agent-dispatch-stuck.md`

## 1. 改动

- `agentDispatcher.ts`：`runTask` try/catch/finally 保证 `finish`；模型/结果读取超时；`pump` 兜底释放；去重键随任务结束释放。

## 2. 测试

```text
bun test（apps/web, agentDispatcher）：7 pass / 0 fail
新增：完成后可再次派发同一条；上下文抛错后节点释放且排队任务继续
apps/web vue-tsc：仅既有 @/agentRuntime 基线错误
bun run --filter web build：成功；web 资产已同步
```

## 3. 待人工验收

- 停止或失败一次派发后，其他 Agent 再派活能正常开始，不再停在「已入队」。
- 同一内容在上一条完成后再次派发，目标会重新运行（60 秒内重复仍会被拦截，但只在上一轮还没结束时）。
- 观察节点不再长期停留在「理解中/运行中」且队列不动。
