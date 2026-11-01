# 测试结果：Agent 提问横幅跨画布显示

- 时间：2026-11-01 11:10
- 对应分析/方案：`4_bugs_fix/bug_analysis-2026-11-01-11-10-agent-question-cross-canvas.md`、`bug_solution-2026-11-01-11-10-agent-question-cross-canvas.md`

## 1. 类型检查

`cd apps/web && bun run typecheck`：通过，仅剩既有报错 `apps/server/src/modules/agentAccess/singleAgent/types.ts(2,33) TS2307 Cannot find module '@/agentRuntime'`。

## 2. 构建与部署

- `bun run --cwd apps/web build` 成功（4.72s）。
- `scripts/deploy-local.sh` 同步到 `/Applications/toonflow-exec.app/Contents/Resources/app/views/mainview/`。
- 主包 `workspace-0nPGm8-0.js` md5 `3eeec1436876e6e700013f3329c87421`、样式 `workspace-Ctx6uR0w.css` md5 `c68037bf9322b067b11833e5cf9ca17c`，构建与 Resources 一致。
- 产物内含跨画布文案「其他画布」3 处。未重启应用。

## 3. 静态核对

- 横幅数据源改为 `useAgentQuestionsStore().notices`，不再有组件内 `agentQuestions` ref。
- `sync` 按 `canvasKey` 整组替换，其他画布条目保留。
- 跨画布点击：`requestFocus` → `activateCanvas` → 目标实例 `active && canvasReady` 消费一次；失败时清理并提示。
- 画布卸载调用 `removeCanvas`；画布改名监听 `canvasId` 调 `setCanvasId`。
- 单画布条目仍按本画布节点表过滤删除/禁用节点。

## 4. 代码审查

| 轮次 | 结论 | 意见 |
| --- | --- | --- |
| 子 Agent（code-reviewer） | 通过 | 无 P1，4 条 P2：①跨画布禁用/删除节点会留下点不开的幽灵条目 → 增加源画布 `watchEffect` 清理 + 跳转失败兜底移除与提示；②pendingFocus 无过期，用户中途切别的画布会被旧请求误触发 → 其他画布成为 active 时作废旧请求；③跨项目清理依赖隐式卸载 → store 内 watch 项目目录显式清空，`removeCanvas` 同步清 pendingFocus；④跨画布跳转与任务提醒逻辑重复 → 已知重复，暂不抽象，避免改动已验证的任务提醒链路；⑤提问横幅条目无上限、画布名 120px 被截断 → 列表 `max-height:168px` 内部滚动、节点名上限放宽到 200px 并加 `title`。 |

## 5. 重启后人工验收清单

1. 画布 A 的 Agent 提问后切到画布 B：B 顶部立即出现横幅，显示「画布名 · 节点名」。
2. 在 B 点该条目：自动切到 A、定位节点并打开 Agent 面板；条目消失。
3. 在 A 回答后，B 的横幅同步消失。
4. 关闭画布 A：B 上属于 A 的条目消失。
5. 画布 A 改名后，从 B 点击仍能切到 A 并打开面板。
6. 单画布提问/回答/关闭面板，行为与改动前一致。
7. 节点被删除或禁用后，本画布不再显示对应条目。
