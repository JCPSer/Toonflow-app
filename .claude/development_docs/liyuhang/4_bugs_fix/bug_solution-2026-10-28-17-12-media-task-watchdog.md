# bug 修复方案：生成任务被「页面长时间未连接」误杀

- 记录时间：2026-10-28 17:12
- 对应分析：`bug_analysis-2026-10-28-17-03-media-task-watchdog.md`
- 决策：删看门狗（方案 A）+ 页面可见时立即补轮询

## 一、服务端：删除 120s 看门狗

`apps/server/src/modules/mediaGeneration/media/tasks.ts`

```
修正前：
  cleanup():
    for task in tasks:
      if settled:            settledAt + 5min <= now → delete
      else if touchedAt + 120s <= now → stop(task, "生成任务因页面长时间未连接而停止")

修正后：
  cleanup():
    for task in tasks:
      if settled:            settledAt + 5min <= now → delete
      （无 else 分支：未结算的任务不因任何超时被中止）

同时删除：
  - MediaTask.touchedAt 字段
  - start() 里的 touchedAt 初始化
  - status() 里的 task.touchedAt = Date.now()
```

保留不动：`stop()` 函数、`cancel()`、`settledAt` 5 分钟清理、1000 任务上限。

注释写清取舍：
`// ACT: 不再用「前端轮询是否按时到达」判定页面存活——后台节流会误杀已付费的生成；任务只由用户取消或供应商结果结束。`

## 二、前端：可见时立即补轮询

`packages/nodeScaffold/src/nodeAi.ts`，在 `createMediaTasks()` 内部：

```
onVisibilityVisible():
  if (pending.size || cancellations.size) 且 (timer === undefined) 且 !polling:
    立即 poll()

注册一次（模块级，防重复）：
  document.addEventListener("visibilitychange", () => { if (!document.hidden) onVisibilityVisible(); })
```

约束：
- 只在有在途任务时才触发，页面无任务时零开销。
- `polling` 为真时跳过，避免并发两个 poll。
- 已有 `timer` 在排队时也跳过（那个 1 秒的定时器比这次补轮询更"新"也无妨，因为要的是尽快，不是精确）。
- 监听器在模块级只注册一次（`typeof document !== "undefined"` 守卫），与现有 `mediaPriceCache` 的 `window.addEventListener` 写法一致，不随节点卸载移除。

## 三、不改的部分

- 前端 90 秒累积失败容错（`nodeAi.ts:160-163`）保持原值。它基于「请求真的失败」，不是基于定时器节拍，属于合理设计。
- `status` 请求 10 秒超时保持原值。
- 任务取消路径（`cancel()` / `notifyGenerateStop`）不动。

## 四、UI 影响

无。文案层面「生成任务因页面长时间未连接而停止」这条错误在正常路径下不会再出现；用户主动取消仍显示「生成已取消」。

## 五、验证方案

1. `@toonflow/server`、`@toonflow/nodes-scaffold` typecheck。
2. 隔离实例：启动 server，提交一个带 `taskId` 的生成请求，构造一个只被 `generateMedia` 阻塞的场景，等待 > 120 秒，确认任务**不**被中止（旧代码会在 120s 时报 499）。
3. 单元级验证 `cleanup()`：直接调用 `status()` 与时间推进，确认未结算任务不会因超时变成 499。
4. 取消路径回归：`cancel()` 仍立即返回「生成已取消」。
5. 结算后 5 分钟清理仍生效。
6. 构建 server 与全部节点包，部署。

## 六、风险

| 风险 | 处置 |
| --- | --- |
| 页面崩溃后任务占着槽位 | 任务会在 provider 返回或超时后结算，5 分钟后自动清理；1000 上限仍在 |
| 用户关窗后 provider 继续计费 | 属既有取舍，记录在案。需要更强保证时应做「窗口关闭时主动 cancel 所有在途任务」，不在本次范围 |
| `visibilitychange` 监听器泄漏 | 模块级单例注册，与项目既有写法一致；不会随节点卸载重复注册 |

## 七、评审意见

- 子 agent 方案评审：
- 用户评审：已确认方案 A + 可见性补心跳。
