# 需求方案：放宽压缩后的上下文保留量

- 时间：2026-11-14 11:50
- 对应需求：`2026-11-14-11-50-compaction-retention.md`
- 状态：已实施

## 1. 现状链路

```text
请求 → microCompactMessages（>窗口50%，最近3轮外的工具结果换指针）
     → SDK shouldCompact（>窗口-reserve）
     → prepareCompaction：从最新往前累计 token，切在 keepRecentTokens 处
     → 切点前全文由模型生成结构化摘要，写入 compaction 条目
     → 下一轮上下文 = 系统提示 + 工具定义 + 摘要 + 切点后原文
```

保留量唯一来源是 `autoCompactStrategy()`；自动压缩（SDK settings）与手动压缩（`compactAgentSession` 构造的临时 session）都读它，所以只改这一处即可同时生效。

## 2. 方案

```text
常量 MAX_KEEP_RECENT_TOKENS = 60000

autoCompactStrategy(window, maxOutput, percent):
    window 非法           → 关闭，keep 20000（不使用）
    window ≤ 16384        → 关闭
    reserve = clamp(max(window*(1-percent), maxOutput, 4096), ≤ window/2)
    budget  = window - reserve
    keep    = max(1000, min(MAX_KEEP_RECENT_TOKENS, window/4, budget-2048))
```

关键点：

- `window/4` 替代 `window/8`，大窗口保留更多；`60000` 上限防止 1M 窗口压完后仍占满半场。
- 仍取 `min(..., budget-2048)`：保留量永远给预留量与摘要余量让路，不会压完立刻再压。
- 不改触发线、不改 microcompact、不改 SDK 摘要模板。

## 3. 影响面

| 窗口 | 旧保留 | 新保留 |
| --- | --- | --- |
| 20k | 2.5k | 5k |
| 64k | 8k | 16k |
| 128k | 16k | 32k |
| 200k | 20k | 50k |
| 400k | 20k | 60k |
| 1M | 20k | 60k |

压缩触发点不变（默认 80%），压完后可用余量更大，但仍在窗口内。

## 4. 测试

新增 `apps/server/src/agent/runtime/preferences.test.ts`：窗口档位、上限、保留+预留<窗口的组合校验、≤16k 关闭、预留上限。

## 5. 评审意见

（待填写）

- 是否通过：
- 其他要求：

## 6. 评审结论（子 agent）

- 通过，无 P0/P1。
- P2-1（文档不变量过强）：已改为如实描述「2048 是摘要余量经验值，默认 80% 下 0.8×reserve 也装得下」。
- P2-2（测试覆盖）：已补 percent 50/60/80/95 × 8 档窗口 × 3 档输出，以及默认 80% 下 keep+reserve+0.8×reserve<窗口。
- P2-3（手动压缩小会话 no-op）：确认符合预期，记录在测试结果。
