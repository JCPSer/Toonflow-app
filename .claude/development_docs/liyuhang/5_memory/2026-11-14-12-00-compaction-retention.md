# 记忆：压缩后保留更多近期上下文

- 时间：2026-11-14 12:00
- 类型：策略参数调整（Agent 上下文压缩）

## STAR

**Situation（背景）**
用户反馈 Agent 每次压缩后只剩约 2 万 token，刚完成的细节丢失。排查确认 `autoCompactStrategy()` 的 `keepRecentTokens` 写死上限 2 万，200k/1M 窗口压缩后都只剩 2 万。

**Task（任务）**
在不动压缩触发线与 microcompact 的前提下，让大窗口模型压缩后保留更多近期原文，且不能引入「压完立刻再压」。

**Action（行动）**
- `keepRecentTokens` 改为 `max(1000, min(MAX_KEEP_RECENT_TOKENS=60000, 窗口/4, budget-2048))`；200k 窗口保留 5 万，1M 保留 6 万，小窗口按 1/4。
- 摘要余量保持 2048（经验值）；默认 80% 阈值下 `keep + reserve + 0.8×reserve < 窗口`，低百分比（约 ≤55%）叠加 overflow 才可能再压一次，已在文档记录。
- 新增 7 个单测：窗口档位、16,385 边界、percent 50/60/80/95 组合、摘要预算、≤16k 关闭、预留上限。
- 子 agent 评审通过（无 P0/P1）；P2 文档不变量、测试覆盖已修，P2 手动压缩小会话 no-op 记为预期。
- 用 `build:desktop` 负载更新 `Resources/app/bun/index.js`，核对 `BrowserWindow` 与编译常量 `60000`，`data/nodes` 未动。

**Result（结果）**
服务端 114 测试通过、tsc 通过；桌面入口已更新，需用户重启应用后生效。

## 关键经验

1. 压缩后保留量只看 `autoCompactStrategy()` 一处；自动与手动压缩共用，改一处两层同时生效。
2. `keepRecentTokens` 的旧上限 2 万对大窗口模型不到 10%，是「压缩太狠」的直接原因；触发线（compactPercent）完全不影响保留量。
3. 保留量与摘要预算（0.8×reserve）共用窗口余量，低百分比阈值下必须核算 `keep + reserve + 0.8×reserve`。
4. 保留量变大后，总 token 较小的会话手动压缩会返回「没有可压缩的内容」，属预期行为。
