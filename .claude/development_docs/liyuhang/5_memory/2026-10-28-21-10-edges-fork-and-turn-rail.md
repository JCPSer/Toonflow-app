# 记忆：连线恢复、回复条目 id 实时下发、对话轮次目录条

## Situation

1. 用户打开应用后画布连线全没了。上一轮为缓解平移卡顿给 `.vue-flow__edges` 加了 `contain: paint`。
2. 用户报告「用了引用的对话不能分支」，实测是「只有复制为新会话变灰、重启后恢复」。
3. 用户要求长对话能快速跳到很久以前的某一轮，形态参照 Codex 的侧边条。

## Task

恢复连线且保留降频；让实时生成的回复也能立刻分支；新增右侧轮次目录条。

## Action

- **连线**：删除 `contain: paint`。根因是 Vue Flow 的 edges SVG 尺寸等于可视区，但连线坐标是画布坐标系，超出盒子的部分完全依赖官方样式里的 `overflow: visible` 绘制；paint containment 强制裁剪到元素盒子，平移后全部落在盒子外。降频只保留 `steps(20)`（60Hz → 10Hz）。
- **分支按钮**：根因不是引用，而是 `entryId` 缺口——前端只在 `initialSession.messages` 初始化时从 `/api/agent/get` 拿 `entryId`，实时回复由 `replyStream` 构造且从不带 `entryId`，`AgentEvent` 里也没有任何字段携带它。服务端新增 `{ type: "assistantEntry"; id }`，在 `message_end && role === assistant` 的微任务里读刚落盘的条目下发（SDK 是先 `_emit` 再 `appendMessage`，中间无 await，既有 stats 逻辑用的是同一时机）。前端 `createConversationStream.receive` 收到后只给当前流式回复补 id，已有则不覆盖——一轮多条 SDK 助手消息时服务端分组保留首条 id，必须一致，否则 fork 截断点会偏移。
- **轮次目录条**：`messageList.vue` 右侧绝对定位 `<nav>`。索引取 `displayedMessages` 下标（虚拟列表同源），点击 `scrollToIndex(index, align:"start")`；跳转前 `atLatestMessage = false`，`nextTick` 里按 `isAtEnd()` 重算，避免无位移跳转残留。
- **命中区域（评审后重做）**：初版整条 nav 都可命中，评审指出 nav 是滚动容器的兄弟节点——滚轮落在它上面不会传给消息列表，右边缘成死角还压住滚动条；同时盖住右对齐消息按钮。改为 nav 与 list 全 `pointer-events: none`、只有行 `auto`；展开条件用 `:has(.turnRailItem:hover)` 而非 `:hover`/`:focus-within`（后者会让鼠标点击后浮层常驻）；行间不留 gap 防止跨行时 `:has` 闪断；`.messageList` 预留 `padding-right: 34px` 让条子落在空槽。
- **删除无效代码**：`nextTick` 里再调一次 `scrollToIndex` 是空操作（Vue 的 nextTick 早于 scroll 事件与 ResizeObserver，偏移没变），改为只重算 `atLatestMessage`。

## Result

- server tsc 0 错；web 仅剩既有的 `singleAgent/types.ts` 找不到 `@/agentRuntime`。
- 产物：web CSS 无 `contain:paint`、仍有 `steps(20)`；server bundle 与 replyStream chunk 均含 `assistantEntry`；部署后 `index.html → index-DfofRnbP.js → workspace-ntwAhpCw.css` 引用链命中新产物。
- 数据完整性：`1-前情-炒股.json` 37 节点 50 连线，其余画布未变，确认连线消失只是渲染裁剪。
- 审查遗留（未修，已记录）：运行中打开父会话时无事件源，`assistantEntry` 到不了前端且 `remoteRunning` 无事件复位；`getAgentSession` 在首条助手消息未落盘时会造 `entryId = "streaming"` 的合成消息，点分支会被服务端以 400 拒绝；撤掉 `contain:paint` 后 10Hz 失效会落回整个连线层，若平移仍卡需换外层 wrapper 隔离方案。
