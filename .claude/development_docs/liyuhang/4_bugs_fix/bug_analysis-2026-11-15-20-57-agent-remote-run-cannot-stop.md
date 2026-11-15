# Bug 分析：Agent 运行中无法停止（后台派发/结果续跑）

- 时间：2026-11-15 20:57
- 类型：交互缺陷（可操作性）
- 状态：待评审

## 1. 背景

画布 Agent 支持派活与结果回传后，一个节点的一轮运行可能不是由面板自己发起的：dispatcher 收到「Agent 任务结果」或派发任务后，用 `/api/agent` 直接跑该节点，面板只做事件镜像。此时面板里没有任何本地请求。

## 2. 现象

用户截图：Agent-导演 节点显示「运行中」，面板里正在执行 `runCommand`（`sleep 300; echo waited`），但输入区右下角是发送按钮，没有任何停止入口；点击发送也没有反应（`submitMessage` 因 `remoteRunning` 直接 return）。用户只能等命令跑完，无法中断。

## 3. 根因

1. `messageInput.vue:73` 的 `<template v-if="busy">` 同时包住「加入队列」「打断并发送」「停止」三个按钮；`busy` 只反映面板自己的请求（`sendMessage` 里置真）。后台/dispatcher 运行期间 `busy=false`、`remoteRunning=true`，于是三个按钮都不渲染。
2. 发送按钮的禁用依据是 `messageInput` 自己的 `locked`（`props.disabled/deletingId/restoringAttachment/voiceActive`），不含 `remoteRunning`；`conversation.sendMessage` 的 `locked` 也不含。于是后台运行期间发送按钮可用，且**不是静默返回**：有草稿时会清空草稿、插入一条本地用户消息、发一次注定被服务端以「对话正在运行」拒绝的请求，然后弹错误。空草稿才表现为「点了没反应」。
3. 停止链路的终点被高估：`stopMessage()` 只在 `!controller && nodeBinding` 时调用 `dispatcher.stop(nodeId)`；而上面第 2 条会造出一个本地 `controller`，此时点停止只中断这次注定失败的请求，后台任务不动（B6）。
4. 即便走到 `dispatcher.stop`：它只遍历 `running`，不清理该节点的排队任务，`finish()` 末尾的 `pump()` 会立刻启动下一个任务，节点又变回「运行中」（B4）；`finish()` 还会无条件把「已取消」结果回传给派发方，触发上游续跑（B5）。
5. `stopMessage` 无条件置 `stoppedByUser=true`；远程停止没有本地 `finally` 复位，下一次本地回合的队列续发/目标续跑会被静默吞掉（B7）。
6. `runCommand` 终止只对直接子进程 `child.kill("SIGKILL")`，spawn 未 `detached`，`bash -c "sleep 300; echo waited"` 的 sleep 可能成为孤儿继续运行（B8）。
7. `remoteRunning` 只在 `userMessage/text/thinking/tool` 时置真，`session/accepted` 不置真；`done` 丢失时无对账（B9）。

服务端 abort 链本身存在：`res.once("close")` → `controller.abort()` → `run()` 信号 → `runCommand` 的 abort 回调；问题在于“能不能触发停止”和“停止覆盖多远”，而不是链路缺失。

## 4. Bug 矩阵

| 编号 | 描述 | 优先级 | 难度 | 风险 |
| --- | --- | --- | --- | --- |
| B1 | 后台运行（dispatcher 驱动）时面板不渲染停止按钮，无法中断 | 高 | 低 | 中：`v-if="busy"` 同时包住队列与打断，不能只改一个条件 |
| B2 | 后台运行期间发送按钮可用：有草稿时丢草稿、插入错误用户消息、发注定失败请求 | 高 | 低 | 中：需在入口拦截而不是只改 UI |
| B3 | 停止后复位依赖 dispatcher 注入 `done`；跨实例/跨标签页停止无效且无提示 | 中 | 中 | 中 |
| B4 | 停止不清理同节点排队任务，`pump()` 立刻启动下一个，节点马上又「运行中」 | 高 | 中 | 中 |
| B5 | 停止子任务仍回传「已取消」结果并触发上游自动新一轮；停止父节点不停止子任务 | 高 | 中 | 中 |
| B6 | 后台运行期间一旦产生本地 `controller`（点击发送触发），`stopMessage` 就跳过 `dispatcher.stop` | 中高 | 低 | 中 |
| B7 | 远程停止置 `stoppedByUser=true` 后无本地 `finally` 复位，下一次本地回合队列/目标续跑被吞 | 中 | 低 | 低 |
| B8 | `runCommand` 只杀直接 bash，不杀进程组/孙进程，界面停了命令可能还在跑 | 中高 | 中 | 中（服务端） |
| B9 | `remoteRunning` 在 `session/accepted` 不置真，`done` 丢失后无常驻对账 | 中 | 中 | 中 |
| B10 | 面板关闭/刷新后无停止入口；无服务端按会话取消接口 | 中 | 中 | 中（架构） |
| B11 | 手动压缩不可取消；停止生成不暂停 goal；`resumeAfterStop` 可绕过停止 | 低中 | 中 | 低（可在范围内说明） |

## 5. 目标

最小目标（P1）：后台运行期间面板显示停止按钮；点击能中断该轮，且不会因排队任务立刻重启；后台运行期间发送被明确拦截（不丢草稿、不发失败请求）；停止不污染下一次本地回合。

完整目标（P2）：停止能终止进程组；停止父/子任务的范围有明确语义；面板关闭或其他标签页驱动时也能停（服务端按 sessionFile 取消）；`done` 丢失时状态对账。

## 6. 影响面

- `apps/web/src/components/agent/conversation/messageInput.vue`：运行态工具栏拆分（队列/打断仅 busy，停止 `busy || remoteRunning`）。
- `apps/web/src/components/agent/conversation.vue`：`sendMessage`/`submitMessage` 的 remote 拦截、`stopMessage` 条件与 `stoppedByUser` 生命周期、`remoteRunning` 置真时机。
- `apps/web/src/pages/workspace/panels/canvas/agentDispatcher.ts`：`stop` 清理队列并返回命中、`finish` 在 stopped 时的回传策略。
- 服务端（P2）：`runCommand` 进程组终止、按会话取消入口。
- 已知限制（不在 P1）：跨标签页取消、压缩取消、goal 与停止的语义。

## 7. 评审意见

（2026-11-15 21:02 子 agent 初审：需调整）

- 已修正：`submitMessage` 第 229 行是 `syncPhase` 而非早退；发送按钮禁用由 `messageInput` 自己的 `locked` 决定，`conversation.locked` 改不动它；后台期间发送不是静默返回，而是丢草稿 + 错误消息；`runCommand` 只杀直接子进程。
- 已补充：B4–B11（排队任务重启、结果续跑/父子链、controller 遮蔽、`stoppedByUser` 泄漏、进程组、`remoteRunning` 生命周期、无服务端取消、压缩/goal/续发绕过）。
- 结论：把「最小按钮修复」与「完整停止语义」拆成两档，由用户选择范围后再实施。
