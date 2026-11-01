# 测试结果：退出前检查运行中节点

- 时间：2026-11-01 12:55
- 对应需求/方案：`1_requirements_matrix/2026-11-01-12-10-exit-guard-running-nodes.md`、`2_requirements_solutions/2026-11-01-12-10-exit-guard-running-nodes.md`

## 1. 类型检查

- `cd apps/web && bun run typecheck`：通过，仅剩既有报错 `apps/server/src/modules/agentAccess/singleAgent/types.ts(2,33) TS2307 Cannot find module '@/agentRuntime'`。
- `cd apps/desktop && bun run typecheck`：通过，无输出。

## 2. 构建与部署

- `scripts/deploy-local.sh --build`（nodes + web + server + 桌面入口）。
- 桌面入口 `build/desktop/main/index.js` md5 `f999338e9de6d5b27aad5a7abb9e025a`，与 `/Applications/toonflow-exec.app/Contents/Resources/app/bun/index.js` 一致。
- 工作区分块 `workspace-9Mg_vv1C.js` md5 `1bbdd126176df785720de4d50fd6d14f`，构建目录与应用 Resources 一致；`index.html` 引用的 `workspace-C542gZNR.js`（1.3 KB 壳）同样一致。
- 未重启应用。

## 3. 静态核对

### 3.1 计数口径

- `apps/web/src/lib/runningNodes.ts`：`busy` 跨画布按 nodeId 去重（与 `isNodeBusy` 的全局存储语义一致），Agent 状态/提问中按 `canvasKey:nodeId` 复合键计；同一节点既 busy 又被 Agent 状态覆盖时不重复计数。
- `canvas/index.vue` 的 `watchEffect` 依赖 `busyTick`（非响应式 busy Map 的唯一变化信号）、`agentNodeStatuses`、`pendingQuestionIds`、`flow.getNodes`。
- 画布卸载调用 `removeCanvasRunningNodes`；项目切换整体重挂载，key 不会串项目。
- `fallbackCanvasKey` 用 `crypto.randomUUID()`，缺省 runtimeKey 时实例间不会互相覆盖。

### 3.2 退出项目

- `requestExitProject` 打开时取一次计数快照；0 与非 0 两套文案/按钮；有节点时确认按钮为 `danger`。
- `confirm()` 先收起弹窗再 `router.push`，避免与「项目未保存」确认叠加；push 异常有 `ElMessage` 反馈。

### 3.3 关窗闸门

- 前端 `quitGuard.ts`：`kind !== "update"` 才弹确认；先发 `flush-confirming` 再 await；拒绝时发 `flush-cancelled` 且不 flush；计数/确认异常均按放行处理并记日志。
- 主进程 `runGate`：`cancelled` 标志同时拦住内层 `allowClose/updateQuitApproved` 与外层关窗/quit，取消后 `closeGate` 复位（仅当仍是本轮 task）。
- `waitForFlushOutcome`：settle 幂等、句柄身份校验、`confirming` 晚到为 no-op、确认期超时改为 10 分钟。
- `will-navigate` 在途闸门按 done 结算；`pageReady=false` 直接放行；`update` 不受影响。
- `flush-confirming` 仅在有在途闸门时唤起窗口（`unminimize/show/activate`），避免过期回执抢焦点。

## 4. 代码审查

| 轮次 | 结论 | 意见 |
| --- | --- | --- |
| 方案评审（子 Agent） | 需修改 | P1-1 取消后内层 finally 仍置 allowClose；P1-2 kind 未传前端导致 update 无法豁免。P2：闸门句柄重写、重载悬挂、超时口径、窗口最小化、弹窗叠加、notices 口径、分享导入未列范围、runtimeKey 空串。均已落实到方案。 |
| 实现审查（子 Agent） | 需修改（已整改） | 无 P1。P2-1 busy 表无画布维度导致跨画布同 id 重复计数 → 改为 busy 全局去重 + local 复合键；P2-2 fallback key 每实例仍是 `__canvas-1` → 改 UUID；P2-3 事件名用 kebab-case 违反仓库规范 → 改 camelCase。P3：错误日志、`FlushHandle` 类型、确认框 danger 色、push 异常提示、过期 confirming 不抢焦点、注释顺序，均已处理。 |

## 5. 重启后人工验收清单

1. 三块画布各跑一个节点（含后台画布），点「退出项目」：提示「当前有 3 个节点正在运行」，选「留在此页」后仍在工作区、节点继续跑。
2. 无节点运行时退出项目：仍是原来的「是否退出当前项目并返回首页？」，无数量提示。
3. Agent 节点正在提问（未回答）时退出：计入数量；只是在面板里看过、尚未回答也算。
4. Agent 上一轮已结束、停留在 waiting 空闲态：不计入。
5. 有节点运行时按 ⌘Q 或点窗口关闭：弹出「退出 Toonflow」确认；选「留在此页」窗口不关；选「仍然退出」正常退出。
6. 在关窗确认框停留 30 秒以上再选：不会被主进程自动关闭。
7. 切换项目提示的节点数量与退出项目一致。
8. 首页/设置页关窗：与以前一致，无确认框。
