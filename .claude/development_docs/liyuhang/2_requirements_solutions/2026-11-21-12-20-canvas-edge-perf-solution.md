# 方案：大型画布连线渲染优化

- 时间：2026-11-21 12:20
- 对应需求：`1_requirements_matrix/2026-11-21-12-19-canvas-edge-perf.md`

## 1. 方案总览

只改渲染层，不动数据。三条腿：

1. **视口裁剪（R1）**：画布把「视口框（外扩半屏，画布坐标）」通过 `provide` 交给边组件；边组件判断两端点包围盒是否与框相交，不相交就渲染 `null`。Vue Flow 仍保留每条边的 `<g>` 包装，但不会有 path 子节点，命中测试与光栅化都省掉。
2. **手势降级（R2）**：`viewport` 变化时给画布根节点加 `viewportMoving`，CSS 里摘掉 `.vue-flow__edge-interaction`（每条边的透明宽命中路径）、停掉虚线动画、整层 `pointer-events:none`；180ms 无变化后恢复。
3. **命中带收窄（R3，评审后取消）**：原计划 `interactionWidth` 40 → 28；评审指出 min-zoom 0.2 时屏幕命中带只剩 5.6px，缩小视图下点不中断线，且手势期间命中带本来就整体关闭。最终保持 40。

不采用 Vue Flow 内置 `onlyRenderVisibleElements`：它会连节点一起裁，节点内视频/编辑器状态会丢。

## 2. 关键设计

### 2.1 视口框

```
viewBoxOfViewport(viewport, dimensions, 0.5):
  left = (0 - x) / zoom；top = (0 - y) / zoom
  right = (width - x) / zoom；bottom = (height - y) / zoom
  四周外扩 0.5 倍视口 = 返回 { left-mx, top-my, right+mx, bottom+my }
```

- 外扩 50%：连续平移/缩放时，即将进入视口的边已经渲染好，避免边上「啪」地出现。
- 框按 80ms 节流更新（leading + trailing），平移过程中最多 12.5 次/秒重新判定，判定本身为 O(E) 的两次比较，不构成新热点。
- 拿不到框（尺寸为 0、独立使用、测试环境）时边照旧全量渲染。

### 2.2 边组件裁剪

```
CulledSimpleBezierEdge(props):
  box = inject("canvasEdgeViewBox")
  visible = !box || edgesIntersect(box, props.sourceX/Y, props.targetX/Y)
  return visible ? <SimpleBezierEdge v-bind="props" /> : null
```

- 用 `<template #edge-simplebezier="edgeProps">` 接住默认边类型，不改 `defaultEdgeOptions.type`、不写数据。
- 用两端点包围盒近似曲线范围；simplebezier 的控制点夹在端点之间，加上半屏外扩，不会裁掉可见边。

### 2.3 手势降级

```
watch([viewport.x, viewport.y, viewport.zoom]):
  viewportMoving = true
  clearTimeout(timer)
  timer = setTimeout(() => viewportMoving = false, 180)
```

- 不用 `viewportChangeStart/End`：滚轮缩放走画布自己的 `zoomCanvas`（d3 `scaleBy`），事件没有 `sourceEvent`，Vue Flow 会跳过这两个钩子。
- CSS：`.viewportMoving` 下 `.vue-flow__edge-interaction { display:none }`、`.vue-flow__edges { pointer-events:none }`、`.animated path { animation:none }`。
- 180ms 尾巴：d3 滚轮每一下都发一次变化，立即恢复会让边在连续滚动时反复重绘。

### 2.4 兼容与清理

- 不新增 edges 字段，保存/撤销/剪贴板与改动前一致。
- `throttle.cancel()`、`clearTimeout` 在 `onScopeDispose` 里清理。
- 与已有 `dragPaused` 独立：拖动节点时仍然冻结动画，两条样式可叠加。

## 3. UI 变动

无新增可见控件。平移/缩放时连线视觉不变（只去掉不可见的命中带、暂停虚线流动）；静止后自动恢复。

## 4. 测试计划

- `edgeVisibility.test.ts`：相交/不相交/横穿/贴边/端点顺序；视口换算含缩放与平移、零尺寸返回 undefined、外扩比例可调。
- 回归：web 全量单测、`build:web`。
- 手工：500+ 边画布平移缩放、点击断线、隐藏连线、撤销重做、保存后重开。

## 5. 评审意见（待填写）

| 级别 | 意见 | 处理 |
| --- | --- | --- |
| P1 | `.viewportMoving` 的 pointer-events 应打在 `.vue-flow__edge`（g）上，外层 svg 本来就是 none | 已修 |
| P2 | interactionWidth 28 缩小时命中带太窄 | 回退 40 |
| P2 | sourceEvent 注释与实现不符 | 改注释 |
| P2 | 非有限坐标保护、$attrs 透传、零尺寸保留旧框 | 均已采纳 |
| P2 | 旧边 `type:"default"` 绕过裁剪 | 已核查无此类数据；不补 default 槽，写入限制 |
