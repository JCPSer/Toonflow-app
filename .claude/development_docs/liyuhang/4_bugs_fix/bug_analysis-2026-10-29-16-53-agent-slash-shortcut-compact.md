# Bug 分析：斜杠输入被吞 / Agent 面板内快捷键失效 / 压缩上下文状态错乱

- 记录时间：2026-10-29 16:53
- 提出人：liyuhang
- 关联：`2_requirements_solutions/2026-10-29-15-13-canvas-notify-group-select-batch-assets.md`（上一轮改动，本轮不涉及）

## 一、Bug 矩阵

### B0 斜杠命令吞掉技能输入（P0）

- 背景：技能（skill）在 Agent 里以 `/skill:<name> ` 的形式触发，技能菜单点击后就是把这段文本插进草稿。上一轮给 `submitMessage` 加的「指令模式」没有区分「内置指令」与「普通以 / 开头的文本」。
- 现象：点技能菜单插入 `/skill:xxx`，回车没有任何反应，消息也没发出去。
- 根因（已核实）：`apps/web/src/components/agent/conversation.vue:493-501`
  - 第 497 行判断 `commandText.startsWith("/")`，命中就让 `handleCommand` 处理并**无条件 return**；
  - 第 498 行先 `clearDraft()`，草稿已经没了；
  - `handleCommand`（396-446）只认 `/compact` 与 `/goal`，其余返回 `false`，而返回值被丢弃；
  - 结果：草稿被清空、也没有落到 `sendMessage`，消息静默消失。
  - 服务端其实支持 `/skill:`（`apps/server/src/agent/runtime/index.ts:281`），是前端多拦了一层。
- 影响面：主对话面板与画布 Agent 节点面板共用同一个 conversation 组件，两处都中。
- 优先级：P0（技能入口不可用）
- 难度：低
- 风险：低。注意 `/goal` 在发送前有异步交互，清草稿的时机要在「确认被消费」之后，避免命令失败也吞输入。

### B1 Agent 面板聚焦时 Cmd/Ctrl+C、V 失效（P1）

- 背景：右键菜单的「复制到剪贴板」是直接函数调用，不经过画布的焦点判定；快捷键要过两层判定。
- 现象：点击 Agent 节点（面板自动打开并抢焦点）后按 Cmd+C 无反应，Cmd+V 也无法粘贴；点普通节点则正常。
- 根因（已核实）：
  - Agent 节点面板根元素是 `role="dialog"` 且带 `tabindex="-1"`（`agentNodePanel.vue:8`），`open()` 会把焦点显式移到它上面（`agentNodePanel.vue:282`）；
  - 键盘路径：`canvas/index.vue:1414-1418` 的 `inCanvas` 里 `!target.closest("[role='dialog'], #agentPanel")` 命中，`inCanvas=false`，`copy/paste` 在 1439 行被直接 return；
  - 原生剪贴板路径：`canvas/index.vue:1172` 的 `canUseCanvasClipboard` 同样排除 `[role='dialog']`，`copyNode/pasteNode` 直接返回；
  - 两条路同时失效，浏览器/桌面壳的默认复制粘贴对节点也无意义。
- 影响面：所有带 Agent 节点的画布；面板内输入框里的文本复制粘贴目前是正常的（被 `input/textarea` 排除保护）。
- 优先级：P1
- 难度：低
- 风险：中。豁免 `[role='dialog']` 时必须保留「输入框/可编辑区/有文本选中」的排除，否则会把节点复制抢掉文本复制。

### B2 压缩上下文中关面板导致状态错乱（P1）

- 背景：手动压缩是一次普通 HTTP 请求（`POST /api/agent/compact`），不是工具调用，也不产生 `tool` 事件；前端用组件内局部 ref 表示「正在压缩」。
- 现象（用户描述）：点「压缩上下文」后点画布 → 面板自动关闭；再点回来显示失败文案、状态也不是正在压缩；但压缩实际在正常跑，最终也能压缩完成。
- 根因（已核实，四层叠加）：
  1. 关闭面板后 `agentNodePanel.vue:295-304` 的 `unmountIfIdle` 只看 `entry.running`（由 phase 派生，只覆盖 thinking/running，`:325-331`）和是否有草稿；压缩不改 phase，于是下一 tick 就把 conversation 实例整个删掉。
  2. 实例卸载时 `conversation.vue:918-920` 只 `controller.abort()`（对话轮 NDJSON），**压缩请求没有 signal，不受影响**，继续在服务端跑。
  3. 压缩的 UI 状态（`compacting` / `manualCompacting` / `entry.compact`）都在被销毁的实例里，响应回来只写进已销毁的 ref；重开是全新实例，只通过 `/api/agent/get` 拿一次快照，不会知道压缩的存在，历史也可能停在压缩前的快照。
  4. `close()` 在 `!entry.running` 时把节点状态强制写成 `idle`（`agentNodePanel.vue:314`），压缩中正好命中，于是节点角标显示「待开始」。
- 关于「工具调用失败」：手动压缩不会产生工具调用。重开后看到的失败文案只可能来自
  - 落盘的 `toolResult.isError === true`（缺 result 时是「已中断」，不是失败）——最典型来源是面板卸载把**正在跑的一轮对话** abort，SDK 把在跑工具写成 `Operation aborted`；
  - 或工具卡重新挂载时 `/api/tools/renderers` 请求失败，显示「工具界面加载失败，请停止后重试：…」。
- 附加缺口：节点状态只有四态 `idle | waiting | thinking | running`（`packages/nodeScaffold/src/agentNode.ts:4`），没有「压缩中」，压缩也从不上报状态。
- 优先级：P1
- 难度：中
- 风险：中。改动跨 conversation / 面板 / 节点包三处；新增状态要同步节点卡的展示映射，否则角标会显示空字符串。

## 二、用户已确认的修复方向（2026-10-29 16:50）

| 决策点 | 结论 |
| --- | --- |
| 未知 `/` 输入 | 只消费 `/compact`、`/goal`；其余（含 `/skill:`）原样发给模型 |
| 压缩中关面板 | 不卸载实例，只隐藏 |
| 节点角标 | 新增「压缩中」状态，内存态，不落节点配置 |
| 面板内 Cmd+C/V | 非输入框、无可编辑焦点、无文本选中时按节点复制粘贴处理 |

## 三、范围外（记录但不修）

- 会话恢复缺口：面板重开后不会再订阅该会话的事件流，`running: true` 的会话重开后只能看快照、且压缩/发送长期被禁用。要修需要服务端提供会话事件订阅，属于独立需求。
- 「工具界面加载失败：timeout exceeded」属于上一轮记录的连接池/服务端慢问题（B1 探针在观测），本轮不动。

## 四、评审意见（待填写）

| 评审人 | 时间 | 结论 | 意见 |
| --- | --- | --- | --- |
| 子 agent 初审 |  |  |  |
| 用户 |  |  |  |
