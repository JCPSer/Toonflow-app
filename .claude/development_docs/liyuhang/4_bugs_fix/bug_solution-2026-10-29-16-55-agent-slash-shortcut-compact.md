# Bug 修复方案：斜杠输入被吞 / Agent 面板内快捷键失效 / 压缩上下文状态错乱

- 记录时间：2026-10-29 16:55
- 关联分析：`bug_analysis-2026-10-29-16-53-agent-slash-shortcut-compact.md`

## B0 斜杠输入被吞

### 目标

只把内置指令 `/compact`、`/goal` 交给本地消费；其它以 `/` 开头的文本（含 `/skill:xxx`）走正常发送，交给服务端。

### 设计

1. 新增纯函数判定（放 `conversation.vue` 内部）：

   ```
   isBuiltinCommand(text) = /^\/(compact|goal)(\s|$)/i.test(text.trim())
   ```

   与 `handleCommand` 支持的命令保持同一份清单，避免两处漂移。

2. `submitMessage` 改为：

   ```
   text = draft.prompt.trim()
   if (text 命中 isBuiltinCommand):
       clearDraft()
       handleCommand(text)          // 已确定会被消费，返回值不再决定流程
       return
   // 其它情况（含 /skill:、拼错的命令）继续往下走原来的发送流程
   ```

   - 必须先判定再清草稿：现在的顺序是「先清后判」，命令拼错就会吞输入。
   - 保持 `/compact`、`/goal` 现有的异步交互（`/goal` 有弹窗式确认）不变。
   - 编辑态（`editingId`）分支在前，不受影响。

3. 服务端无需改动：`/skill:` 已由 `runtime/index.ts:281` 处理。

### 验收

- 技能菜单插入 `/skill:xxx ` 后回车：消息发出，模型收到带 `/skill:` 的正文。
- `/compact`、`/goal`：行为与改动前一致。
- 手输 `/compcat`（拼错）：作为普通消息发给模型，不再静默消失。
- 生成中点发送：仍走原来的「打断并立即发」逻辑（`/` 判定不再把它截走）。

## B1 Agent 面板内 Cmd+C/V

### 目标

面板打开、焦点在面板根（`role="dialog"`）上时，节点级复制/粘贴仍可用；文本复制粘贴不受影响。

### 设计

1. 新增判定 `isInsideAgentNodePanel(target)`：`target instanceof Element && !!target.closest(".agentNodePanel")`。
2. 键盘路径 `inCanvas`（`canvas/index.vue:1414-1418`）：
   - 保留 `#agentPanel`（应用级侧栏面板）排除；
   - `[role='dialog']` 的排除改为「是 dialog 且不在 `.agentNodePanel` 内」。
3. 原生剪贴板路径 `canUseCanvasClipboard`（`:1168-1187`）同样处理，**其余排除项全部保留**：
   - `input/textarea/select/button/contenteditable/[role='textbox']/[role='slider']` 照旧排除——面板输入框里的 Cmd+C/V 仍是文本复制粘贴；
   - `copyNode` 里「有文本选中就不复制节点」的条件照旧，选中面板正文后 Cmd+C 复制文本。
4. 不改 Esc 判定（`index.vue:1497` 仍把 dialog 当作非画布）：Esc 在面板内应继续关闭面板。
5. 粘贴：桌面端走 `pasteNodeAtCenter()`；浏览器端仍放行原生 paste。

### 验收

- 点 Agent 节点 → 面板打开并抢焦点 → Cmd+C 复制节点、Cmd+V 在指针处粘贴成功。
- 面板输入框内 Cmd+C/V：文本复制粘贴正常，不产生节点。
- 在面板正文选中一段文字后 Cmd+C：复制文字，不复制节点。
- 点普通节点后快捷键行为不变。
- 面板内 Esc 仍关闭面板。

## B2 压缩上下文状态错乱

### 目标

压缩进行中关面板不销毁实例、不丢状态；重开能看到「正在压缩」；压缩完成后状态与历史自然刷新；节点角标能反映压缩中。

### 设计

1. `conversation.vue`：
   - 新增 computed `busyCompacting = compacting || manualCompacting`，`watch` 它并 `emit("compacting", value)`；
   - 事件声明加 `compacting: [value: boolean]`；
   - 卸载逻辑不变（压缩请求本来就没有 signal，不主动取消）。
2. `agentNodePanel.vue`：
   - 每个 entry 增加 `compacting: boolean`，模板 `@compacting="onCompacting(nodeId, $event)"`；
   - `unmountIfIdle` 判据追加 `|| entry.compacting` 直接返回（不删实例）；
   - `close()` 里 `if (!entry.running) statuses[target] = "idle"` 改为「压缩中写 `compacting`，否则写 idle」；
   - `onCompacting` 同时写 `props.statuses[nodeId] = value ? "compacting" : <phase 派生值>`。
3. 状态类型扩展：
   - `packages/nodeScaffold/src/agentNode.ts` 的 `AgentNodeStatus` 加 `"compacting"`；
   - `packages/nodes/agentNode/src/index.vue` 的状态文案映射加「压缩中」；
   - `index.vue` 的 `agentNodeStatuses` 是 `reactive<Record<string, AgentNodeStatus>>`，无需改结构。
4. UI：
   - 面板内的「正在压缩上下文…」横幅保留（现在是本地 ref，仍是真源）；
   - 面板头部的压缩按钮 `loading` 保持；
   - 节点角标显示「压缩中」（样式沿用现有四态的同一套）。
5. 边界：
   - 压缩中切画布（画布失活）：面板跟着关闭，但实例不销毁，回来重开仍在；
   - 压缩中点「停止」：`/api/agent/compact` 没有 abort 通道，保持「让它跑完」的现状，但要保证完成后状态回落；
   - 压缩失败：横幅消失、按钮恢复、`ElMessage` 报错（现有行为），状态回落。

### 验收

- 压缩中点击画布：面板关闭，`agentNodePanel` 里的 conversation 实例仍在（DOM 隐藏而非销毁）。
- 重开面板：立刻看到「正在压缩上下文…」与按钮 loading；压缩完成后横幅消失、历史已是压缩后的会话。
- 节点卡片角标：压缩中显示「压缩中」，完成后回到「等待输入」或「运行中」。
- 压缩中点画布不再产生新的「工具调用失败」记录（不再 abort 正在跑的轮次）。

## 实施顺序

| 任务 | 内容 | 涉及文件 |
| --- | --- | --- |
| T1 | B0 斜杠判定（可与其他并行） | `components/agent/conversation.vue` |
| T2 | B1 焦点豁免（独立） | `pages/workspace/panels/canvas/index.vue` |
| T3 | B2 压缩状态（conversation + 面板 + 节点包，串行） | `conversation.vue`、`agentNodePanel.vue`、`packages/nodeScaffold/src/agentNode.ts`、`packages/nodes/agentNode/src/index.vue` |

T1 与 T3 都改 `conversation.vue`，需串行：先 T1，再 T3。

## 评审意见（待填写）

| 评审人 | 时间 | 结论 | 意见 |
| --- | --- | --- | --- |
| 用户 | 2026-10-29 16:50 | 通过（四项决策） | 未知 `/` 照常发给模型；压缩中不卸载；新增「压缩中」状态；面板内快捷键按条件生效 |
| 子 agent 审查 | 2026-10-29 17:26 | 修完可发布 | 已修：`nextTick` 导致续发被卸载（改为 `resuming` + `hasPendingWork`）、大小写不一致、`compacting` 未计入忙、面板内 Delete 绕过文本选区保护、换画布销毁压缩实例 |
