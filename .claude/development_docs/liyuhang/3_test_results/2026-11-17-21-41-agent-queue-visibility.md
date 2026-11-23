# 测试记录：Agent 派发队列可视化与撤销

- 时间：2026-11-17 21:41
- 变更：`agentDispatcher.ts`（队列快照/提示/撤销）、新增 `agentQueuePanel.vue`、`canvas/index.vue` 接线、`agentDispatcher.test.ts`

## 自动化

| 项 | 命令 | 结果 |
| --- | --- | --- |
| dispatcher 单测 | `cd apps/web && bun test src/pages/workspace/panels/canvas/agentDispatcher.test.ts` | 17 pass / 0 fail |
| web 类型检查 | `bun run --filter '@toonflow/web' typecheck` | 仅既有 `@/agentRuntime` 基线错误 |
| web 构建 | `bun run --filter '@toonflow/web' build` | 成功 |
| 部署 | `rsync -a --delete build/web/ → Resources/app/views/mainview` | 完成，备份 `mainview.bak-20261117-214207`；未重启应用 |

## 覆盖场景（单测）

1. 快照：条目顺序、收发双方标签、消息摘要、阻塞原因「目标正在执行其他任务」；停止后快照清空。
2. 同一发送方替换：快照只留最新，出现「旧排队消息已被同一 Agent 的新消息替换」提示。
3. 撤销：移出快照、排队箭头移除、`/api/agent` 调用数不变（不新开一轮）、节点状态不变、note 文案「在排队中被用户撤销 / 尚未开始执行」、同内容立刻重发可入队（去重键已释放）。
4. 结果回传条目 `cancelQueued` 返回 false、仍留在队列。
5. 并发占满 4 个槽位后第 5 条显示「并发已满」。
6. 60 秒内重复消息只提示一次。
7. dispose 后 `queueView`、`queueNotices` 清空。

## 手工验收矩阵（待用户重载后确认）

| # | 场景 | 预期 |
| --- | --- | --- |
| 1 | 目标 Agent 忙时派两条 | 左下角 chip 显示「排队 2」，展开可见条目、原因、秒级等待时长 |
| 2 | 同一发送方再发一条 | 旧条目消失，「旧排队消息已被替换」提示出现，chip 数不变 |
| 3 | 60 秒内重发相同内容 | 只出现一次「重复消息已忽略」提示，不重复入队 |
| 4 | 撤销一条 | 二次确认后条目消失、箭头消失、原派发方会话出现撤销 note；chip 不因队列清空而立刻收起提示 |
| 5 | 撤销后立刻重发同样内容 | 能正常入队（不被 60 秒去重吞掉） |
| 6 | 撤销时任务已出队开始 | 提示「任务已开始执行，无法撤销」，队列刷新 |
| 7 | 队列与对话面板同时打开 | 面板在左下角，不被对话面板遮挡（若遮挡记为待调位置） |
| 8 | 关闭/切换画布 | 队列与提示全部消失，不残留 |

## 已知风险

- `stop(nodeId)` 清队列不写 note（既有语义，未改）。
- 只有提示、没有排队时 chip 显示「队列提示」+ 圆点，8 秒后自动消失。
- 截图/读屏未实测；`aria-live` 已收窄到提示列表，等待时长不再进入播报区域。
