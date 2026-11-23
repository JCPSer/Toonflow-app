# Bug 分析：使用「标记」后图片生成节点一直处于运行/生成中

- 时间：2026-11-19 17:12
- 优先级：P1（节点无法回到空闲，Agent 等待不结束）
- 难度：中

## 现象

在图片节点或图片生成节点上使用「标记」并保存后，节点卡片一直显示运行/生成中，无法结束；Agent 侧表现为一直等待。

## 分析

1. 节点卡片的运行态来自 `nodeSkeleton` 的 `busy`，图片生成节点 `busy` 包含 `editor.busy`。
2. `editor.busy` 只在 `imageEditor.saveMark` 期间为 true，并在 `finally` 里复位。卡住说明 `saveMark` 的某个 `await` 永远不返回，`finally` 没执行到。
3. `saveMark` 的等待点依次是：`uploadNodeFile`（网络）、`batchHistory`（本地）、`revealNodeInViewport`（视口动画）、失败清理 `workspace.remove`（网络）。
4. `revealNodeInViewport` 内部 `await flow.setCenter(..., { duration: 240 })`。Vue Flow 的 `setCenter` 由 d3 transition 驱动，Promise 只在 transition 的 `end` 事件里 resolve；动画被新的视口变化或节点尺寸更新打断时触发的是 `interrupt`，Promise 永远不会 resolve。
5. 标记保存会 `addNodes` + `addEdges`，紧接着 `updateNodeInternals` 与视口动画；新节点尺寸在动画期间落定，容易打断 transition。视口聚焦只是视觉提示，却把节点运行态一起卡死。
6. 次要问题：`finally` 里先 `await` 失败清理再复位 `busy`，清理若挂起同样会让节点一直忙。

## 修复目标

1. 视口聚焦最多等待「动画时长 + 600ms」，超时直接返回，不阻塞任何业务流程。
2. `saveMark` 先复位 `busy`/`operation`，再做失败清理，清理挂起不影响节点回到空闲。

## 风险

- 动画被打断时不再等待自然结束，只是少一次平滑聚焦，无功能影响。
- 超时后不再保证视口一定已聚焦；这是可接受的降级（用户仍能看到新节点）。

## 评审意见

| 评审人 | 意见 | 结论 |
| --- | --- | --- |
| 子 agent 评审 | 待填 | |
| 用户评审 | 待填 | |
