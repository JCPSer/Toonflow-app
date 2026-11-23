# START 记忆：Agent 对话面板层叠与打开贴底

- 时间：2026-11-16 16:24
- 关联：`bug_analysis-2026-11-16-16-16-agent-panel-zorder-and-scroll.md`、`bug_solution-2026-11-16-16-16-agent-panel-zorder-and-scroll.md`

## Situation
用户报告两件事：对话面板下方有图片节点/其他节点时面板会被盖住（打开瞬间、不定时）；每次打开 Agent 面板不一定停在最新消息。代码侧确认面板挂在 `<vue-flow>` 默认插槽里，而 `.vue-flow` 是 `z-index:0` 的层叠上下文，节点所在的 transformationpane 被 transform/will-change 提升为合成层；同时 `messageList.vue` 在激活时会恢复 `messageScrollOffset`，且贴底依赖 `scrollToEnd()` 的估算落点。

## Task
在不改动节点行为与派发链路的前提下，让面板在画布内恒定压住节点，并让每次打开都稳定停在最后一条消息。

## Action
1. `canvas/index.vue`：`<agentNodePanel>` 移出 `<vue-flow>`，成为 `.canvas` 的直接子节点；`.canvas` 增加 `isolation: isolate` 显式建立层叠上下文（此前层级边界依赖外层 `container` 查询的隐式 containment）。
2. `messageList.vue`：
   - 把 `jumpToken` 升级为共享 `scrollEpoch`，新增 `pinning` 标志；`onChange` 在任一程序化滚动期间不写 `atLatestMessage`。
   - 新增 `scrollToLatest()`：每帧 `scrollToEnd()`，以「最后一条消息完整可见 + isAtEnd 连续两帧」收敛，最多 20 轮；容器高度为 0 时等待。
   - 取消入口补齐：wheel/touch（`cancelJump`）、PageUp/PageDown/Home/End/方向键/空格（`onListKeydown`，忽略输入框冒泡）、失活、卸载。
   - 激活时始终 `scrollToLatest()`，删除 `messageScrollOffset` 与其恢复分支。

## Result
- 画布单测 75 pass；web typecheck 仅既有基线错误；web 构建成功并同步到桌面端 Resources（原目录备份）。
- 评审提出的 P1（取消互斥、translateZ 风险）与 P2（隔离边界、裸写 scrollTop、收敛条件）均已修正；WKWebView 层叠与滚动落点需用户重启后按手工矩阵验收。
