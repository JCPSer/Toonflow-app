# 退出前检查运行中节点

- 时间：2026-11-01 12:10
- 涉及文件：`apps/web/src/lib/runningNodes.ts`、`apps/web/src/lib/quitGuard.ts`、`apps/web/src/pages/workspace/exitProject.ts`、`apps/web/src/pages/workspace/components/exitProjectDialog.vue`、`apps/web/src/pages/workspace/index.vue`、`apps/web/src/pages/workspace/panels/canvas/index.vue`、`apps/web/src/pages/workspace/panels/canvas/components/agentNodePanel.vue`、`apps/desktop/src/index.ts`

## STAR

**Situation**
三条离开当前项目的路径对「节点正在跑」处理不一致：切换项目有确认；退出项目只有保存确认；关窗/⌘Q 只等 flush（最长 4 秒）就放行，用户无法取消。批量生成或 Agent 长任务途中误操作会静默中断任务。

**Task**
退出项目与关窗/⌘Q 前若存在运行中节点，弹确认并允许取消；判定覆盖所有画布实例与 Agent「正在提问」；只读数量、两按钮、不设开关。

**Action**
1. 新增 `lib/runningNodes.ts`：各画布实例上报「全局 busy 命中的节点」与「实例本地状态」，busy 跨画布按 nodeId 去重、local 用 `canvasKey:nodeId`。
2. `canvas/index.vue` 用 `watchEffect`（依赖 `busyTick` + Agent 状态表 + 提问列表）上报，卸载时清理；`switchProject` 改用同一口径并带数量。
3. `agentNodePanel.vue` 新增 `pending` 字段与 `pendingQuestions` 事件：「已读」不再等价于「已回答」。
4. `exitProject.ts` 打开时取计数快照，弹窗切文案与按钮色；确认时先收起再导航，避免与「项目未保存」叠层。
5. `quitGuard.ts` 接收主进程传入的 `kind`，非 update 且有节点时先发 `flush-confirming` 再弹确认；取消发 `flush-cancelled` 且不落盘。
6. 主进程 `waitForFlushOutcome` 支持 done/cancelled、确认期把超时放宽到 10 分钟；`runGate` 用 `cancelled` 标志同时拦住 allowClose 和关窗/quit，并复位 `closeGate`；`will-navigate` 结算在途闸门。

**Result**
- web/desktop `vue-tsc`、`tsc` 通过（仅既有 `@/agentRuntime` 报错）。
- 桌面入口 md5 `f999338e9de6d5b27aad5a7abb9e025a`、工作区分块 `workspace-9Mg_vv1C.js` md5 `1bbdd126176df785720de4d50fd6d14f`，构建与安装一致；未重启。
- 两轮子 Agent 评审：方案阶段拦下「取消后仍关窗」「update 无法豁免」；实现阶段修复跨画布 busy 重复计数、fallback key 重复、事件名规范。

## 教训

- 关闭闸门是「异步 veto + 回执」结构：取消分支必须同时拦住内层 finally 的放行位和外层的关窗调用，只改一处等于没改。
- 同一个「有没有在跑」的判定，数据源可能没有画布维度（`busyNodes` 只有 nodeId），去重键必须按数据源分别选，不能一刀切用复合键。
- 「已读」和「已回答」是两个语义：前者是 UI 状态，后者才是业务状态；混用会让“用户正在看着”的场景漏判。
- 复用现有关闭闸门时，超时是硬约束：用户在确认框上停留的时间必须先把 4 秒超时换掉，否则确认框还没点就被关窗。

## 关联

- 需求/方案/测试：`1_requirements_matrix/2026-11-01-12-10-exit-guard-running-nodes.md`、`2_requirements_solutions/2026-11-01-12-10-exit-guard-running-nodes.md`、`3_test_results/2026-11-01-12-10-exit-guard-running-nodes.md`。
- 前置：`5_memory/2026-11-01-11-10-agent-question-cross-canvas.md`（提问横幅的跨画布 store）。
