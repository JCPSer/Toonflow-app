# 记忆：生成任务被「页面长时间未连接」误杀

## Situation

`apps/server/src/modules/mediaGeneration/media/tasks.ts` 里有一条服务端看门狗：`cleanup()` 每 30 秒扫一次，未结算任务若 `touchedAt + 120000 <= now` 就 `stop(task, "生成任务因页面长时间未连接而停止")`。而 `touchedAt` 只在一处刷新——`status()`，也就是前端 `/api/ai/media/tasks/status` 的轮询。

前端轮询在 `packages/nodeScaffold/src/nodeAi.ts` 的 `createMediaTasks()`，用 `setTimeout` 串联，1 秒一次。

问题在于：WKWebView 会把后台页面的 `setTimeout` 压到分钟级甚至暂停（本项目早在 2026-10-26 就实测过 macOS 低电量模式把帧率压到 30fps）。用户只要把窗口切走或应用放后台超过 2 分钟，轮询就停，`touchedAt` 不再刷新，服务端判「页面已断」并 `abort()` 掉已经提交给供应商、费用已产生的任务。

根因是概念混淆：**把「前端定时器是否按时跑」当成了「页面是否还活着」**。两者不等价。

## Task

让生成任务只因为用户主动取消或供应商返回结果而结束，不再被「轮询没到」误杀；切回可见时状态立即对齐。

## Action

- **服务端**：删掉 `cleanup()` 里的超时 `else` 分支、`MediaTask.touchedAt` 字段、`start()` 的初始化与 `status()` 的写入。保留 `settledAt + 300000` 的 5 分钟清理与 1000 任务上限。注释写清取舍：不再用轮询节拍判定存活。
- **前端**：`createMediaTasks()` 增加 `resume()`——有在途任务时先 `clearTimeout` 丢弃排队的定时器，再立刻 `poll()`；模块级注册一次 `visibilitychange`，页面变可见时调用。
- **关键修正**：`resume()` 初版写成 `if (polling || timer !== undefined || ...) return`，在后台节流场景下正好会「因为定时器已排队而不补轮询」，与本意相反。改成先 `clearTimeout` 再 poll 才有效。

## Result

`@toonflow/server` 与 `@toonflow/nodes-scaffold` typecheck 均 0；9 个节点包重新构建；服务端 standalone 构建 23.28 MB；桌面入口 23,561,168 B 并已部署。

验证：源码级断言 7 项（无「长时间未连接」文案、无 `touchedAt`、无 `touchedAt + N` 判断、5 分钟清理在、1000 上限在、取消文案在、404 契约在）全过；`cancel()` 实测返回 499「生成已取消」，未知 taskId 返回 404；`resume()` 调度复刻验证 3 例（无任务不触发、丢弃排队定时器立即 poll、polling 期间不并发）全过；三个产物（节点包、server、desktop 入口）均确认无残留文案。

取舍记录：页面真崩时任务不会再被 120s 中止，会继续跑到供应商超时或返回，结算后 5 分钟清理——上限 1000 也仍在，不会永久泄漏。代价是「用户关窗后供应商仍可能继续计费」，这是原看门狗试图兜住但方式不对的问题，正确做法应是关窗时主动 cancel 在途任务，未纳入本次范围。

待手测：真实后台 3 分钟切回能否拿到结果、切回后进度恢复的即时性、页面崩溃场景的清理行为。
