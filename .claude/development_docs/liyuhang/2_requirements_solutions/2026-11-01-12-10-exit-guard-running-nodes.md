# 需求方案：退出前检查运行中节点

- 时间：2026-11-01 12:10（评审后修订：12:40）
- 分支：`feat/exec-node`
- 对应需求：`1_requirements_matrix/2026-11-01-12-10-exit-guard-running-nodes.md`

## 1. 方案概述

新增一个轻量的「运行中节点」汇总层（模块级注册表，不引入新 store），各画布实例上报本画布的运行中节点；退出项目弹窗与关闭闸门在动作前读取汇总数量：

- 数量为 0：行为完全不变。
- 数量 > 0：换成带警告的确认文案，两个按钮「留在此页 / 仍然退出」。
- 关闭窗口/⌘Q：复用现有 flush 闸门，主进程把 `kind` 传给前端，新增 `flush-confirming` / `flush-cancelled` 两种回执；取消时本轮关闭/退出作废，窗口保持打开。

不改节点包、不改后端。

## 2. 数据来源与口径

```
运行中节点集合 = ∪ 各画布实例上报的 key（key = `${canvasKey}:${nodeId}`）
```

每个画布实例上报三部分：

| 来源 | 判定 | 说明 |
| --- | --- | --- |
| busy / running | `isNodeBusy(node.id)` | 读 `nodeBusy.ts` 的 `globalThis` 注册表，覆盖所有节点包的耗时任务 |
| Agent 思考 | `agentNodeStatuses[id]` ∈ thinking / running / compacting | 每实例一份，必须逐实例上报 |
| Agent 在提问 | 面板记录中的「提问中且尚未回答」节点 | 与「是否已读」无关；用户在面板里看着提问时也要算 |

- `waiting` 空闲态（回合已结束）**不计入**。它和「正在提问」都会让 Agent 节点停在 waiting，唯一的区分是提问调用尚未结束。
- 跨实例用 `canvasKey:nodeId` 复合键去重。
- 不复用 `pruneBusyNodes`：它没有画布维度，按单实例调用会误删后台画布的登记。

## 3. 详细设计

### 3.1 汇总层 `apps/web/src/lib/runningNodes.ts`（新增）

```
registry: Map<canvasKey, Set<nodeId>>

syncCanvasRunningNodes(canvasKey, ids):   整组替换该画布的集合
removeCanvasRunningNodes(canvasKey):      画布卸载时删除
countRunningNodes(): number
    keys = new Set()
    for [canvasKey, set] of registry: for id of set: keys.add(`${canvasKey}:${id}`)
    return keys.size
```

- 纯读取，不依赖响应式；调用方只在「弹窗前」读一次。
- 提问态由画布上报（见 3.2），不再单独从 `agentQuestions.notices` 取——`notices` 是「未读」，与「未回答」不是同一口径。

### 3.2 画布实例上报 `canvas/index.vue`

```
const canvasKey = computed(() => props.runtimeKey ?? fallbackKey)   // fallbackKey 每实例生成一次

publish():
    void busyTick.value                                 // 全局 busy 变化要重算
    ids = flow.getNodes.value.filter(n => isNodeBusy(n.id)).map(n => n.id)
    ids ∪= agentNodeStatuses 中 thinking/running/compacting 的 key
    ids ∪= pendingQuestionIds.value                      // 面板上报的「提问中」节点
    syncCanvasRunningNodes(canvasKey, ids)

watchEffect(publish)
onBeforeUnmount: removeCanvasRunningNodes(canvasKey)
```

- 用 `watchEffect` 而不是 `watch(flow.getNodes)`：节点数组是 push/splice，引用不变。
- 后台画布只是 hidden + inert，实例仍挂载，上报天然覆盖所有画布；项目切换整体重挂载，卸载即清空，不串项目。

### 3.3 Agent 面板补充「提问中」状态 `canvas/components/agentNodePanel.vue`

现状 `onQuestion` 在面板可见且画布在前台时直接把 `entry.question` 置空（视为已读），「未回答」信息就丢了。新增独立字段：

```
entry.pending: { callId } | undefined
onQuestion  : entry.pending = payload        // 无论是否可见都记
onQuestionEnd: 若 callId 匹配则清空
computed pendingQuestionIds = entries 中 pending 存在且节点仍在的 nodeId[]
watch(pendingQuestionIds) -> emit("pendingQuestions", ids)
defineExpose 不需要新增，走事件
```

画布层 `@pendingQuestions="ids => pendingQuestionIds = ids"`，供 3.2 汇总。

### 3.4 退出项目 `pages/workspace/exitProject.ts` + `components/exitProjectDialog.vue`

```
requestExitProject():
    runningCount = countRunningNodes()
    visible = true

confirm():
    visible = false          // 先收起，避免保存失败确认叠在下面
    await router.push("/home")

弹窗文案：
    runningCount === 0 → 「是否退出当前项目并返回首页？」 按钮：取消 / 退出项目
    runningCount > 0  → 「当前有 N 个节点正在运行，退出项目会中断它们的任务。是否仍要退出？」
                          按钮：留在此页 / 仍然退出
```

- 只保留一层弹窗；顶栏按钮与画布 Esc 共用同一入口。
- 路由离开守卫（保存失败确认）保持原样，但因先收起退出框，同一时刻只会看到一个弹窗。

### 3.5 切换项目 `canvas/index.vue switchProject`

```
count = countRunningNodes()
if count > 0:
    ElMessageBox.confirm(`当前有 ${count} 个节点正在运行，切换项目会中断它们的任务。是否继续切换？`)
```

替换现有 `hasBusyNodes()`，口径与退出项目统一。

### 3.6 关闭闸门前端 `lib/quitGuard.ts`

```
type QuitKind = "close" | "quit" | "update"
setQuitConfirm(handler?: (count: number) => Promise<boolean>)

window.__toonflowFlush = async (kind: QuitKind = "close") => {
    if (kind !== "update" && confirm 已注册):
        count = countRunningNodes()
        if (count > 0):
            sendToHost({ type: "flush-confirming" })   // 主进程延长超时并前置窗口
            approved = await confirm(count)            // 抛错按 true 处理
            if (!approved):
                sendToHost({ type: "flush-cancelled" })
                return                                  // 不 flush、不发 flush-done
    try { await flush?.() } catch { 记录日志 } finally { sendToHost({ type: "flush-done" }) }
}
```

- `kind` 由主进程注入（`__toonflowFlush("update")`）。`update` 不弹确认：更新是用户主动发起，且更新器有自己的退出审批；若弹了，取消会让 `applyUpdate` 继续走审批并二次弹窗。
- 取消时不执行 flush：窗口不关，落盘没有意义。

### 3.7 工作区注册确认 `pages/workspace/index.vue`

```
onMounted:
    setQuitFlush(existing)
    setQuitConfirm(count => ElMessageBox.confirm(
        `当前有 ${count} 个节点正在运行，退出会中断它们的任务。`,
        "退出 Toonflow",
        { confirmButtonText: "仍然退出", cancelButtonText: "留在此页", type: "warning", closeOnClickModal: false }
    ).then(() => true, () => false))

onBeforeUnmount:
    setQuitFlush(undefined); setQuitConfirm(undefined)
```

### 3.8 主进程 `apps/desktop/src/index.ts`

闸门等待改成可表达三种结果的句柄：

```
waitForFlushOutcome(): Promise<"done" | "cancelled">
    let timer = arm(FLUSH_TIMEOUT_MS=4000)             // 超时按 done 处理
    handle = {
        confirm():  清掉 timer，timer = arm(CONFIRM_TIMEOUT_MS=10min)   // 用户可能要犹豫很久
        done():     settle("done")
        cancel():   settle("cancelled")
    }
    结算后清空 handle；无活动闸门时收到任何回执都是 no-op
```

`runGate(kind)`：

```
let cancelled = false
task = (async () => {
    try {
        if (await flushFrontendState(kind) === "cancelled") { cancelled = true; return }
        flushWindowState()
    } finally {
        if (!cancelled) { kind === "update" ? updateQuitApproved = true : allowClose = true }
    }
})()
closeGate = task
task.catch(...).finally(() => {
    if (cancelled) { if (closeGate === task) closeGate = null; return }   // 不关窗，允许下次重走
    if (kind !== "close" && kind !== "quit") return
    setTimeout(() => kind === "quit" ? Utils.quit() : mainWindow.close(), 0)
})
```

host-message 处理新增：

```
flush-confirming → handle?.confirm(); 窗口最小化/隐藏时先 unminimize/show/activate
flush-cancelled  → handle?.cancel()
flush-done       → handle?.done()
```

其它：

- `will-navigate`（页面重载）时若有在途闸门，按 `done` 立即结算，避免白等 10 分钟。
- `pageReady === false` 时直接返回 done（页面未就绪，不可能有运行中节点），不弹确认。
- 启动画面 / `!activeWindow` 分支（`before-quit` 早退、splash 取消直接 quit）不涉及工作区，不弹确认。

## 4. 时序

```
用户 ⌘Q
  main: before-quit → 同步 veto → runGate("quit")
  main → webview: window.__toonflowFlush("quit")
  web: count = 2 → 发送 flush-confirming → 弹 ElMessageBox
  main: 收到 confirming → 窗口前置 → 超时改 10 分钟
用户点「留在此页」
  web: 发送 flush-cancelled
  main: cancelled → 不置 allowClose → 清 closeGate → 窗口保留
用户点「仍然退出」
  web: flush 落盘 → 发送 flush-done
  main: done → flushWindowState → allowClose=true → Utils.quit()
```

## 5. 边界

- 首页/设置页没有工作区：未注册 confirm，不弹。
- 弹窗停留期间节点状态变化：文案按打开瞬间的快照，不动态刷新。
- 渲染进程失联（崩溃/无回执）：`flush-confirming` 后 10 分钟兜底放行；若在确认前失联，仍走原 4s 超时放行。10 分钟只是防死锁兜底，正常操作不会触发。
- 页面重载/导航：在途闸门立即按 done 结算。
- 关闭闸门单飞：同一轮内重复 ⌘Q/点关闭复用同一 Promise，不会弹第二个确认。
- 退出项目弹窗与关闭确认可能同时存在（在退出弹窗上按 ⌘Q）：两个都出现，先取消关窗即可回到退出项目弹窗。
- 画布标签关闭 / 画布文件删除：卸载实例本身会 abort 任务，属画布级操作，不在本次范围。
- 分享包导入后切换项目、MCP 打开其它项目：不做确认——前者是导入完成后的明确后续动作，后者是程序化调用，弹模态框会阻塞调用方。
- 更新重启（kind=update）：不弹确认，保持原语义。取消更新走更新器自己的审批流程。

## 6. 影响文件

新增：

- `apps/web/src/lib/runningNodes.ts`

修改：

- `apps/web/src/pages/workspace/exitProject.ts`
- `apps/web/src/pages/workspace/components/exitProjectDialog.vue`
- `apps/web/src/pages/workspace/index.vue`
- `apps/web/src/pages/workspace/panels/canvas/index.vue`
- `apps/web/src/pages/workspace/panels/canvas/components/agentNodePanel.vue`
- `apps/web/src/lib/quitGuard.ts`
- `apps/desktop/src/index.ts`

不动：

- `packages/nodeScaffold/src/nodeBusy.ts`（避免改动节点包与 UMD 产物；其中 `pruneBusyNodes` 为死代码，本次不清理）
- 后端任务接口

## 7. 测试设计

1. `cd apps/web && bun run typecheck`；`bun run --cwd apps/web build`；桌面端构建。
2. 静态核对：计数口径（含提问中）、复合键去重、卸载清理、取消不 flush、取消后不置 allowClose 且复位 closeGate、update 不弹、confirming 延长超时。
3. 纯逻辑可测点：`runningNodes.ts` 的并集/去重/清理做成纯函数，可用 `bun:test` 覆盖；主进程闸门状态机因依赖原生对象，本次以静态核对 + 人工验收为主。
4. 人工验收（需用户重启后）：见需求矩阵第 6 节。

## 8. 评审意见

| 评审人 | 结论 | 意见 |
| --- | --- | --- |
| 用户（选择题确认） | 通过 | 见需求矩阵。 |
| 子 Agent 审查（实现） | 需修改（已整改） | 无 P1。P2：busy 全局表无画布维度导致跨画布同 id 重复计数（改为 busy 按 nodeId 去重 + local 复合键）、fallbackCanvasKey 每实例相同（改 UUID）、事件名 kebab-case（改 camelCase）。P3 若干已顺手处理。 |
| 子 Agent 审查（初版） | 需修改 | P1-1 取消后内层 finally 仍置 allowClose、外层 finally 仍关窗；P1-2 kind 未传前端导致 update 无法豁免、取消会二次弹窗。P2：闸门句柄需重写、重载期间闸门悬挂、超时口径矛盾、窗口最小化时确认框不可见、退出框与保存失败框叠加、`notices` 是「未读」而非「未回答」、分享包导入切换未列范围、runtimeKey 兜底为空串。已按评审整改：3.2/3.3/3.4/3.6/3.8 改写，kind 注入，取消标志双处判断，复合键去重，pending 提问独立字段。 |
