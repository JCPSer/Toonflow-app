# START 记忆：Agent 派发队列可视化与撤销

- 时间：2026-11-17 21:41
- 关联：`1_requirements_matrix/2026-11-17-21-34-agent-queue-visibility.md`、`2_requirements_solutions/2026-11-17-21-40-agent-queue-visibility.md`、`3_test_results/2026-11-17-21-41-agent-queue-visibility.md`

## Situation
Agent 互派任务的队列只存在页面内存，界面仅有一根 `queued` 箭头；排队顺序、原因、条数不可见，同发送方替换与 60 秒去重会静默丢弃消息，用户无法判断「在排队」还是「被吞了」。

## Task
让队列可见、可撤销；不引入后端、不改打断与并发语义、不做插队；关闭画布仍丢弃队列。

## Action
1. `agentDispatcher.ts`：`Task` 增加 `queuedAt`；新增 `queueView`（只读快照：双方标签、摘要 + `messageFull`、`reason`）、`queueNotices`（替换/去重/撤销，上限 3 条、8 秒 TTL、`Map<id,timer>` 淘汰清理）；`syncQueueView()` 覆盖 pump 两处分支、替换、结果入队、stop、cancel、runTask 早退、dispose。
2. 新增 `cancelQueued(taskId)`：仅 `kind === "task"`；释放去重键、移除箭头、写「排队中被用户撤销，尚未开始执行」note（`deliverCancelNote` 返回是否写入成功）、失败补提示、`pump()`。
3. 新增 `components/agentQueuePanel.vue`：左下角 chip + 展开列表；阻塞原因与秒级等待；二次确认撤销（3 秒）；live region 只包提示，等待时长 `aria-hidden`；条目与提示都空才收起。
4. `canvas/index.vue`：解构 ref 接线，`cancelAgentQueued` 在返回 false 时提示「任务已开始执行，无法撤销」。
5. 单测从 10 扩到 17：快照、替换提示、撤销（箭头/调用数/状态/note/去重键）、结果回传不可撤销、并发已满、去重提示只一次、dispose 清空。

## Result
- `bun test agentDispatcher.test.ts`：17 pass；web typecheck 仅 `@/agentRuntime` 基线错误；`build:web` 成功。
- 已用 `rsync -a --delete build/web/` 同步 `Resources/app/views/mainview`（备份 `mainview.bak-20261117-214207`），未重启应用，由用户重载验收。
- 已知边界：`stop(nodeId)` 清队列不通知发送方；撤销不可回滚；浮层与对话面板 z-index 需实机确认。
