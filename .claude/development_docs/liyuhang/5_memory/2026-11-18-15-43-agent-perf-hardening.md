# 记忆：多 Agent 卡顿优化的关键结论

- 时间：2026-11-18 15:43

## 结论

1. `getAgentContext` 已不调用 `buildSessionContext()`：在 branch 条目上直接估算，压缩后按「摘要 + firstKeptEntryId 保留条目 + 压缩后条目」；有 usage 时只补算尾部条目。
2. 删除消息（tombstone）后不要丢弃 usage 改用条目估算：usage 含 system prompt/工具定义等静态前缀，条目估算不含，会把占用从数十万骤降到个位，误导压缩判断。下一条回复会自然校正。
3. `estimateEntryTokens` 必须对 `content == null` 做归一化（会话文件不校验），否则 750ms 定时器里的估算抛未捕获异常。
4. final stats 不能带实时 timing：收尾时本轮 `toonflowTiming` 已落盘，再传一遍会重复计，tokensPerSecond 偏低（75 → 66.67）。
5. `getAgentSession` 的 `buildSessionContext()` 已删除，模型/思考档位改为分支推导（与 SDK `getSessionContextSettings` 同口径）。
6. 画布保存重试定为 6 次 × 120ms（最坏约 4s）；`writeJson` 第 4 参是 retry，`write` 第 5 参是 retry，类型统一为 `Pick<BusyRetryOptions, "attempts" | "baseDelayMs">`。
7. 截断按 UTF-16 字符计（中文约 1 字 = 1），并在高代理位回退一位避免切 emoji。

## 后续热点（未做）

`SessionManager.list` 历史列表、回退估算 entry 级缓存、非运行会话投影缓存、画布其它写入路径统一重试。
