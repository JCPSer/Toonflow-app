# 需求方案：Agent 输入工具条布局 + Agent 提问横幅

- 记录时间：2026-10-29 13:30
- 关联需求矩阵：`1_requirements_matrix/2026-10-29-13-30-agent-toolbar-voice-question-banner.md`

## 一、R1 工具条拥挤

**根因**：`.senderActions` 是 `display:flex`，模型按钮 `flex:1` 但自身 `min-width:0`、无下限；其余按钮 `flex-shrink:0`。空间不足时模型按钮被压到 0 宽，文字溢出压到后面的图标上，视觉上就是"文字和回形针叠在一起"。

**布局策略（三层防御）**：

1. **放宽容器**：画布 Agent 节点面板 `PANEL_MAX_WIDTH` 380 → 440（默认布局下一行就能放下，实测模型按钮 194px 完整显示）。
2. **允许省略**：`.modelPopover { min-width: 96px }` + `.modelName` 已有 ellipsis，模型名再长也只是出现省略号，不再溢出叠字。
3. **溢出折叠**：`ResizeObserver` 监听 `.senderActions`，用「容器宽 − 内边距 − 非模型子项宽 − gap」算出模型按钮实际能拿到的宽度：
   - `< MODEL_ROOM(132)` → 折叠：语音按钮与上下文环换成「⋯」菜单（菜单内含「语音输入」动作与上下文用量文本）；
   - 折叠态下 `room + 24 ≥ MODEL_ROOM + 12` → 展开（24 = 语音 28 + 环 24 − ⋯ 28）。
   - 12px 滞回带防止临界宽度抖动；`fittingToolbar` 重入锁 + 最多两步迭代防止死循环；窗口尺寸变化、`busy`、模型切换、语言切换都会重新测量。
4. **兜底折行**：`.senderActions` 加 `flex-wrap: wrap`，极端窄（< 300px）时换行而不是溢出。

**占位文案联动**：语音按钮不可见时占位文案改用短句（去掉"长按语音输入"），避免小宽度下占位文字折两行。

> 设计取舍：折叠只做**一级**。最初设计「环 → 语音」两级，实测发现第一级折叠会同时插入 28px 的「⋯」按钮，正好吃掉隐藏上下文环省下的 24px，导致第一次折叠后仍然溢出、直接跳到最紧状态。改为单级折叠 + 滞回后行为稳定。

## 二、R2 语音开关搬到「设置 → 常规」

- 存储：`settings.general.voiceInputEnabled`（默认 true，老配置缺键视为开）；`generalSettings` 增加同名字段，`updateGeneralSettings` 自动落库（服务端 settings.json 自动保存）。
- 读取：`lib/agentInputSettings.ts` 从「读 `/api/tools/get` 的 mediaGeneration.config」改成 `computed(() => generalSettings.value.voiceInputEnabled)`，删掉 `loadAgentInputSettings` 与 `toonflow:tool-config-updated` 监听。
- UI：`settings/panels/general/index.vue` 增加「语音输入按钮」开关（紧随启动动画），说明文案点明"关闭后按钮与长按手势都不可用"。
- 旧位置：`mediaGeneration` 的 `configRules` 删除该 switch（弹窗里不再出现）；`configSchema` **保留** `allowVoiceInput` 字段但不读取——`z.strictObject` 会拒绝未声明键，直接删字段会让已经存过该键的用户配置校验失败。
- 生效：`useVoiceInput` 的 `enabled` 门禁在 `armVoiceInput` 首行拦截，按钮隐藏只是表象。

## 三、R3 提问横幅

**事件链**（自下而上）：

```
askUser 工具 → 服务端 question 事件（含 callId/title/question）
  ↓ conversation.vue：emit('question', {callId,title,question})
  ↓          tool 事件结束或本轮 finally：emit('questionEnd', callId)
agentNodePanel：entry.question 记录未读（面板正开着且画布在前台则不记录）
  ↓ computed questionNotices → emit('questions', list)
canvas/index.vue：agentQuestions ← 列表；activeAgentQuestions 按 findNode 过滤
  ↓ 顶部横幅渲染，点一行 → fitView 到节点 + open(nodeId)
agentNodePanel.open()：entry.question = undefined（打开即已读）
```

**关键点**：

- 已读语义在 `open()` 里一次收口：从横幅点、点节点、点「@」都会走到同一个 `open()`。
- `questionEnd` 由三条路径保证：工具结束（status 非 running）、本轮 `finally` 里取消待答提问、面板/节点销毁后列表随 entries 一起消失。
- 节点删除：`activeAgentQuestions` 用 `flow.findNode` 过滤，即使面板没来得及回收也不会出现指向已删节点的条目。
- 画布层只渲染，不改节点 `data`——提问状态不落盘，避免每秒状态写盘。

**UI**：贴顶居中浮层（`z-index:5`，低于节点面板的 10），标题「N 个 Agent 正在等你回答」+ 每行「节点名 · 提问摘要 ›」，摘要单行省略；`@pointerdown.stop` 防止点横幅时画布框选/关闭面板。

## 四、影响面

| 文件 | 改动 |
| --- | --- |
| `components/agent/conversation/messageInput.vue` | fitToolbar / 折叠模板 / 更多菜单样式 / 占位文案联动 |
| `components/agent/conversation.vue` | 新增 `question` / `questionEnd` 两个 emit 及三处触发点 |
| `components/agent/types.ts` | 新增 `AgentQuestionNotice` 类型 |
| `pages/workspace/panels/canvas/components/agentNodePanel.vue` | 未读提问聚合与上报、打开即已读、面板宽度 440 |
| `pages/workspace/panels/canvas/index.vue` | 横幅渲染与跳转、`.canvas` 增加 `position: relative` |
| `lib/agentInputSettings.ts` / `stores/settings.ts` / `settings/panels/general/index.vue` | 语音开关迁移 |
| `packages/tools/mediaGeneration/{build.ts,src/index.ts}` | 移除开关 UI，schema 保留兼容字段 |
