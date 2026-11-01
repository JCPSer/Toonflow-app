# Agent 提问横幅跨画布显示

- 时间：2026-11-01 11:10
- 涉及文件：`apps/web/src/stores/agentQuestions.ts`（新增）、`apps/web/src/pages/workspace/panels/canvas/index.vue`

## STAR

**Situation**
画布宿主同时挂载多块画布，后台画布只是 hidden + inert。Agent 提问提醒原本是画布组件内的 `ref`，横幅只渲染在提问节点所在画布；用户切到别的画布看不到提醒，必须切回去才发现。

**Task**
1. 所有画布的顶部横幅都显示全局未回答提问，跨画布条目标出画布名。
2. 在其他画布点击条目：切到来源画布、定位节点并打开 Agent 面板。
3. 回答、关闭面板、删除节点、卸载画布后条目必须同步消失；画布改名后点击仍能定位。

**Action**
1. 新增 `stores/agentQuestions.ts`：`notices` 全局列表 + `pendingFocus`，按 `canvasKey` 整组 `sync`，另提供 `setCanvasId`、`removeCanvas`。
2. `canvas/index.vue` 的 `@questions` 改为 `syncAgentQuestions`，把本画布全量列表写入 store。
3. 横幅 computed 读全局列表：本画布条目按节点表过滤，其他画布条目原样保留；跨画布条目标签为「画布名 · 节点名」，列表 key 加 `canvasKey`。
4. 跨画布点击复用任务提醒的模式：`requestFocus` → `activateCanvas` → 目标实例 `active && canvasReady` 消费一次 → `fitView + open`；失败清理并提示。
5. 监听 `canvasId` 同步路径；卸载时 `removeCanvas`。

**Result**
- web `vue-tsc` 通过（仅既有 `@/agentRuntime` 报错）；`vite build` 成功并同步到应用。
- 主包 `workspace-0nPGm8-0.js` md5 `3eeec1436876e6e700013f3329c87421`，构建与 Resources 一致；未重启。
- 子 Agent 审查通过（无 P1）：补了失效条目清理、pendingFocus 作废、跨项目显式清空、横幅限高滚动；跨画布跳转与任务提醒的重复逻辑暂不抽象。

## 教训

- 组件内状态 + 多实例挂载 = 后台实例的状态用户永远看不到；跨实例可见的状态必须提升到 store。
- 跨实例跳转不要直接拿对方 Vue Flow；沿用「pendingFocus + activateCanvas + active&&ready 消费一次」这套已验证的协作方式。
- 全量列表同步要按实例键整组替换，而不是增量合并，否则回答/删节点后容易留下点不开的幽灵条目。
- 画布文件路径会随改名变化，实例键不会；跨画布定位必须用实例键匹配、用路径切换。

## 关联

- 分析/方案/测试：`4_bugs_fix/bug_analysis-2026-11-01-11-10-agent-question-cross-canvas.md`、`4_bugs_fix/bug_solution-2026-11-01-11-10-agent-question-cross-canvas.md`、`3_test_results/2026-11-01-11-10-agent-question-cross-canvas.md`。
- 前置：`5_memory/2026-11-01-08-10-agent-question-chime.md`（提问提醒横幅）、`5_memory/2026-10-29-15-20-canvas-task-alerts.md`（任务提醒全局 store 模式）。
