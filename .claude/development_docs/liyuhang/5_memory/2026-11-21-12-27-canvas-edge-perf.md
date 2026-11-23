# 记忆：500+ 连线画布平移/缩放优化（STAR）

- 时间：2026-11-21 12:27

## Situation

用户反馈 500 条以上连线的画布平移/缩放明显掉帧。节点必须常驻（`only-render-visible-elements=false`，节点内含视频/编辑器状态），不能用 Vue Flow 的整体裁剪。

## Task

在不改画布数据、不裁剪节点的前提下，降低平移/缩放时每条边带来的路径生成、命中测试和光栅化成本。

## Action

- 新增 `edgeVisibility.ts`：`viewBoxOfViewport`（视口→画布坐标，外扩 50%）与 `edgeIntersectsViewBox`（端点包围盒相交）。
- 新增 `components/culledEdge.vue`：`inject("canvasEdgeViewBox")`，视口外返回 `null`，否则渲染 `SimpleBezierEdge`；拿不到框时全量渲染。
- `canvas/index.vue`：`throttle 80ms` 更新视口框并 provide；`<template #edge-simplebezier>` 接住默认边类型；`viewportMoving` 由 `watch(viewport)` 派生（不用 `viewportChangeStart/End`，滚轮缩放走 d3.scaleBy 没 sourceEvent），180ms 尾巴恢复。
- CSS `.viewportMoving`：隐藏 `.vue-flow__edge-interaction`、`.vue-flow__edges { pointer-events:none }`、暂停虚线动画。
- `defaultEdgeOptions.interactionWidth` 维持 40（评审后回退了 28 的改动）。

## Result

- `edgeVisibility.test.ts` 9 例、web 156 例通过；`build:web` 成功。
- 视图已同步 `Resources/app/views/mainview`（备份 `mainview.bak-20261121-122631`），待用户重启验收。
- 评审无 P0；P1「pointer-events 打错层」已修（要打 `.vue-flow__edge` 的 g，不是外层 svg），interactionWidth 40→28 已回退（min-zoom 下命中带太窄），另采纳非有限坐标保护、$attrs 透传、零尺寸保留旧框。整改后视图备份 `mainview.bak-20261121-122840`。

## 教训

Vue Flow 的边裁剪只能靠自定义边组件/插槽实现，`onlyRenderVisibleElements` 会连节点一起裁；手势降级要自己 watch viewport，d3 程序化 `scaleBy` 不触发 sourceEvent 钩子。
