# 记忆：Agent 输入框 ↑ 翻历史失效（还原挂起护栏）

- 时间：2026-11-12 01:38
- 类型：Bug 加固（Agent 输入框）

## STAR

**Situation（背景）**
用户反馈 Agent 输入框按 ↑ 没有反应（输入框已清空、Agent 空闲）。历史代码自 2026-10-30 修复后未改动，部署产物包含逻辑，会话里用户消息充足。

**Task（任务）**
确认是代码回归还是实例状态卡死；让还原挂起不再造成永久失效。

**Action（行动）**
- 用浏览器客户端直连应用端口（`/index.html?web=1` 避开 desktop 模式的项目隐藏）打开真实项目 `蕾姆Rem`，实测 ↑ 能翻出带 @ 提及的历史，关面板重开仍可用 → 功能正常，问题在实例状态。
- `messageInput.vue`：`restoreHistory` 的 `reset()`、`nextTick()` 各加 1.5s 超时（`settleHistoryStep`），避免历史队列链在永不结算的 Promise 上。
- 新增 `historyFillingActive()`：`historyFilling` 超过 3s 视为卡死并复位；`draftEmpty`/`hasDraft`/`handleHistoryKey`/change 回调统一改走它。
- 测试时修复副作用：浏览器客户端把 `toonflow.projectList.project` 改成了 `蕾姆Rem`，已用 `/api/settings/get`+`/api/settings/save` 精确还原为 `ToonFlow项目-黑木` 与原 lastOpenedAt。

**Result（结果）**
typecheck 仅剩既有 `@/agentRuntime`；web 构建成功并同步应用（01:38）；未重启。

## 关键经验

1. 同一个构建，干净客户端能复现的功能问题，要先怀疑「长生命周期实例的局部状态」，别急着改逻辑。
2. 异步还原/填充类操作一定要有超时；`historyFilling` 这类布尔锁一旦悬挂，会同时锁死判空、hasDraft 和按键入口，还会被 hasDraft 保留实例，跨面板关闭也无法自愈。
3. 浏览器客户端直连应用端口（去掉 `?desktop=1` 改用 `/index.html?web=1`）可以绕过桌面端的项目隐藏，直接复现真实项目里的输入框行为；断线前记得还原被改写的持久化状态。
