# 变更记录：Agent 面板关闭重开后输入历史失效

时间：2026-10-30 01:05
类型：Bug 修复（前端交互）

## Situation

画布 Agent 节点面板关闭再打开后，输入框 ↑/↓ 完全没反应，翻不出会话历史；消息列表正常、无任何报错。

## Task

让 ↑/↓ 在任意打开/关闭状态下都能翻到会话里的全部用户消息，同时不破坏草稿保留、提及插入与 ⌘Z 撤销。

## Action

- 排查：用真实会话在浏览器客户端逐条验证「开→关→重开→↑」基础链路正常，问题只在某些状态残留后被永久挡住。定位到：
  - 用户删掉输入框里的 `@` 提及标签后，`draftMentions` 不回收 → `draftEmpty()` 恒 false，↑ 静默 return；`hasDraft()` 恒 true → 面板关闭时实例不卸载，重开仍继承坏状态。
  - `historyQueue` 串行链一旦有任务不返回会永久堵住后续还原；收起瞬间在途的还原还可能把旧消息写回新面板。
- 修复（`apps/web/src/components/agent/conversation/messageInput.vue`）：
  - 提及以编辑器里真实存在的标签为真源：新增响应式 `editorMentionIds`（change 事件维护），`draftEmpty`/`hasDraft`/`composable`/`enqueueDraft` 全部改用它；**不回收 `draftMentions`**，数组保持超集，避免「删标签 → ⌘Z」丢元数据后发送被拦。
  - `insertingMentions` / `historyFilling` 期间：`draftEmpty` 返回 false、`hasDraft` 返回 true、`handleHistoryKey` 直接返回，避免把正在写入的提及/实例判空。
  - 面板收起：`historyIndex` 清空、`historyQueue` 复位、`historyEpoch++`、清 `mentionQuery`/`skillQuery`；`restoreHistory` 在开始与 `reset` 后各比对一次代次，拦住收起瞬间在途的旧还原。
- 评审：子代理初审通过，按意见修掉 `hasDraft` 插入窗口回归、取消数组回收、补代次与状态清理。

## Result

- 真实会话实测：清空输入后 ↑ 立即可用；开→关→重开→↑ 能一路翻到会话最早一条；带草稿关闭再重开草稿仍在。
- web 构建通过，typecheck 无新增错误；已部署，刷新应用窗口生效（纯前端）。
- 遗留：仓库无前端测试框架，⌘Z 撤销提及与「插入期间关面板」两个用例为代码路径核对，未做自动化。
