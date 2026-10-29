# 变更记录：斜杠输入 / 面板内快捷键 / 压缩上下文状态（含审查整改）

时间：2026-10-29
分析：`4_bugs_fix/bug_analysis-2026-10-29-16-53-agent-slash-shortcut-compact.md`
方案：`4_bugs_fix/bug_solution-2026-10-29-16-55-agent-slash-shortcut-compact.md`
测试：`3_test_results/2026-10-29-17-16-agent-slash-shortcut-compact.md`

## Situation

Agent 里点技能菜单插入 `/skill:xxx` 后回车毫无反应；点 Agent 节点（面板抢焦点）后 Cmd+C/V 复制不了节点，只有右键菜单能用；点了「压缩上下文」再点画布，面板自动关闭，重开后看不到「正在压缩」，状态还显示成空闲，但压缩其实在后台跑完。

## Task

1. 让 `/skill:` 这类非内置指令照常发给模型。
2. 面板聚焦时节点级 Cmd+C/V 可用，同时不破坏文本复制。
3. 压缩期间关面板不丢状态；节点角标能显示「压缩中」。

## Action

- 斜杠：`submitMessage` 增加 `isBuiltinCommand`（`/^\/(compact|goal)(\s|$)/i`），只有内置指令才先判再清草稿；`handleCommand` 内部把命令名归一化为小写，与判定同源。
- 快捷键：画布两处 `[role='dialog']` 排除改为「在 `.agentNodePanel` 内则豁免」，`#agentPanel` 与输入类选择器照旧排除；面板语境只放行 copy/paste/delete，delete 追加「有文本选区不删」。
- 压缩：conversation 上报 `compacting`，面板 entry 记录并在压缩中拒绝卸载；`AgentNodeStatus` 新增 `compacting`，节点包文案「压缩中」并计入 `busy/running`；换画布时压缩中的 entry 保留。
- 审查整改：`resuming` 保活标记 + `hasPendingWork()` 防止「续发窗口被卸载」；`nodeBusy` 续轮复位 outcome；提醒带 `canvasId/canvasKey` 支持跨画布定位；删节点清理旧未读；横幅按提问横幅真实高度错位。

## Result

- `/skill:demo hello` 经请求拦截验证会走 `POST /api/agent`；`/foo bar` 同样不再被吞。
- 面板聚焦下真实 Cmd+C 产生 `POST /api/desktop/clipboard/write`；选中文本时不会复制节点。
- 压缩链路只能静态验证（压缩会改写用户会话文件），已做类型检查与构建；实测由用户执行。
- 联调期间中断过一次正在运行的 Agent 轮次（页面 reload 与面板内发送触发打断语义），已在测试记录中如实登记；`/Compact` 因会话运行被服务端拒绝，未误压缩历史。
