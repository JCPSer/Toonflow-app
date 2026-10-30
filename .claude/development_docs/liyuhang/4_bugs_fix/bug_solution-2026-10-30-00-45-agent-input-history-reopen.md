# Bug 修复方案：画布 Agent 面板重开后输入历史失效

- 时间：2026-10-30 00:45
- 对应分析：`bug_analysis-2026-10-30-00-40-agent-input-history-reopen.md`

## 1. 方案总览

不重建历史链路（现有 `historyMessages` + `historyQueue` 在正常态下工作良好），只消除"状态残留导致的永久阻塞"：

1. 提及以编辑器标签为真源：新增 `editorMentionIds()`，`draftEmpty()` / `hasDraft()` 改成按标签判断；change 事件里把 `draftMentions` 与标签对齐（回收幽灵项）。
2. 程序化填充窗口（`historyFilling`、`insertingMentions`）不执行回收，避免误删刚插入的提及。
3. 面板收起时复位 `historyQueue`，避免一次卡死的还原任务把后续 ↑/↓ 永久堵死。

改动集中在 `apps/web/src/components/agent/conversation/messageInput.vue`，无服务端与数据格式变更。

## 2. 详细设计（伪代码）

```
editorMentionIds = ref(Set)          // change 事件里从 editor.NODES 收集，响应式

function draftEmpty():
    if insertingMentions or historyFilling: return false      // 填充中途不能判空
    if sender.getText().trim() != "" or draftAttachments.length > 0: return false
    return 没有 draftMentions 中的 id 存在于 editorMentionIds

function hasDraft():
    if insertingMentions or historyFilling: return true       // 正在写入，必须保活
    return text 非空 or 附件非空 or 有提及标签 or editingId != undefined

composable = text 非空 or 附件非空 or editorMentionIds 非空   // 发送/入队按钮同一口径

on CHANGE:
    senderText = ...
    editorMentionIds = 从 editor.NODES 收集 Mention 标签 id
    // 不回收 draftMentions：数组保持超集，发送时按 getTagData 过滤

watch(locked, active):
    handleHistoryKey 的守卫额外加 insertingMentions / historyFilling

    if not active:
        historyIndex = null
        historyEpoch++
        historyQueue = Promise.resolve()
        mentionQuery = skillQuery = undefined

restoreHistory(item):
    epoch = historyEpoch
    if epoch != historyEpoch: return           // 排队期间已收起
    await instance.reset(...)
    if epoch != historyEpoch: return           // 在途期间已收起，不再写回/聚焦
    ...
```

要点：

- **判空与发送口径分离**：判空只看编辑器标签；发送仍用 `getTagData()` 的 `mentionedIds` 过滤 `draftMentions`，多余项不会外发。
- **不回收数组**：删除标签后按 ⌘Z 撤销时，x-sender 只重建 `{id,name}` 标签，数组里的元数据如果被删就补不回来，发送会被"存在无法读取的提及"拦下；保持超集可避免这个问题。
- **两个填充窗口豁免**：中途标签尚未落盘，判空会误判、还原会打断正在插入的提及；`hasDraft` 在该窗口必须返回 true，否则面板会把正在写入的实例卸载。
- **代次**：只用于拦住"收起瞬间在途"的旧还原写回编辑器。

## 3. UI 设计

无 UI 变化。可见行为：清空输入框后 ↑ 立即可用；带草稿关面板仍保留草稿；重开面板后 ↑/↓ 正常。

## 4. 测试计划

1. 正常态：开/关/重开面板，↑ 能翻到会话最早一条（浏览器实测）。
2. 幽灵提及：翻出带 `@` 的消息 → 清空输入 → ↑ 可用（临时日志验证 `mentions` 归 0 或被忽略）。
3. 草稿保留：输入文字后关面板，重开草稿还在；清空后 ↑ 可用。
4. 提及不丢：历史还原的带 `@` 消息直接发送，服务端收到的提及与标签一致。
5. 撤销删除提及：删掉 `@` 标签后 ⌘Z 撤销，标签回来且发送不被"存在无法读取的提及"拦下。
6. 程序化插入期间关面板：点"加入对话"/插入提及的两帧内关闭面板，不丢提及、不报错。
7. 幽灵提及闭环：翻出带 `@` 的消息 → 清空 → 关闭面板 → 重开，↑ 仍可用。
8. 构建通过、typecheck 无新增错误（仅剩既有 `@/agentRuntime` 别名报错）。

## 5. 风险与回退

- 风险：`hasDraft()` 变严格后，只剩幽灵提及的空草稿会被判定为"没草稿"，关闭时卸载实例——这正是期望行为；真实草稿（文字/附件/有效提及/编辑态）仍保留。
- 回退：仅一个前端文件的三处小改，回退即撤销。

## 6. 评审意见

### 第 1 轮（子代理，2026-10-30 00:55）

结论：通过，需补 1 处窄窗口回归与 2 处文档事实。

- M1（已改）：初版 `hasDraft()` 只认标签，`insertMentions` 是"先 push 后 setMention"，标签落盘前的 1–2 帧会被判成无草稿，面板可能卸载正在写入的实例。现在 `insertingMentions || historyFilling` 直接返回 true。
- M2（已改）：分析文档把 `clearDraft` 写成 `resetDraft`，且"手动点删除会更新数组"与代码相反（`removeDraftMention` 只删数组、不看标签），已按代码改写。
- M3（已改）：B3 队列卡死无复现证据，降级为防御性加固；注释也改为"不影响新队列，但仍可能写入编辑器"。
- S2（已改）：初版在 change 里回收 `draftMentions`，会让"删标签 → ⌘Z 撤销"丢失提及元数据，发送被拦。改为不回收、数组保持超集，判空查标签。
- S1/S4/S5（已改）：加 `historyEpoch` 拦住收起瞬间在途的旧还原；`active=false` 时清 `mentionQuery`/`skillQuery`；`composable`/`enqueueDraft` 改成标签口径。
- S6（已改）：测试计划补"删标签后 ⌘Z 撤销""程序化插入期间关面板""带幽灵提及关闭再重开"三个用例。
