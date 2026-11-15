# 需求方案：Agent 派发关系可视化

- 时间：2026-11-15 23:30
- 对应需求：`2026-11-15-23-30-agent-link-visualization.md`
- 状态：待评审

## 1. 总体设计

```text
dispatcher（已有队列/运行表）
  ├─ enqueueFromEvent → pushLink(dispatch, queued)
  ├─ runTask 开始     → updateLink(running)
  ├─ finish           → updateLink(最终状态)
  │                     dispatch 箭头 220ms 后退场
  │                     pushLink(result, 最终状态) → 1.6s 后退场
  ├─ stop             → 清掉该节点排队箭头
  └─ dispose          → 清空

canvas/index.vue：reactive agentLinks[] → 传给 dispatcher，并渲染叠加层
agentLinkLayer.vue：按节点位置 + viewport(zoom/x/y) 画三次贝塞尔曲线与箭头
```

不创建 Vue Flow 边，所以不会进入画布 JSON、不触发保存、不参与连线校验与撤销。

## 2. 数据与状态

```text
AgentLink = { id, taskId, fromNodeId, toNodeId,
              kind: "dispatch" | "result",
              status: "queued"|"running"|"completed"|"cancelled"|"failed",
              message(≤300), createdAt }
```

颜色：排队灰、运行主题蓝、完成绿、取消黄、失败红。

## 3. 绘制

- 锚点：源节点右（或左）中线 → 目标节点左（或右）中线；目标在左侧时自动换边。
- 曲线：两次贝塞尔，控制点水平偏移 `clamp(|dx|*0.5, 40, 180)`。
- 屏幕坐标 = 节点坐标 × zoom + viewport 偏移。
- 虚线流动：`stroke-dasharray` + `stroke-dashoffset` 动画；结束状态用实线。
- 回传脉冲用更短的 dash 区分方向。
- 悬停：每条线叠一条透明 hit path（`stroke-width:14`），鼠标进入记录 id，按中点渲染 HTML tooltip；容器 `pointer-events:none`，只有 hit path 接收事件。

## 4. 生命周期与定时器

- dispatch 箭头：入队即出现，`finish` 后 220ms 移除（留一帧看终态色）。
- result 脉冲：`finish` 时压入，1.6s 后移除；dispose/切换画布时统一清空。
- 停止：排队中的 dispatch 立即移除；运行中的由 `finish` 走取消色。
- 同一 taskId 的 dispatch 与 result 用 `kind` 区分，删除互不影响。

## 5. 已知限制

- 目标节点被删除时该箭头随任务失败结束；不做悬空重连。
- 画布缩到很小时箭头线宽不缩放（保持可读），可能出现视觉偏粗。
- 同节点对并发多条时箭头会重叠（受并发 4 与同节点串行约束，实际很少）。

## 6. 测试

- dispatcher：入队出现 dispatch 箭头；完成后 dispatch 退场、result 脉冲为 completed；停止清排队箭头；dispose 清空。
- 手工：拖动/缩放画布时箭头跟随；并发两个节点对同时派发；悬停显示摘要；切换画布后无残留。

## 7. 评审意见

（2026-11-16 00:05 子 agent：需调整）已修：

- marker id 用 `useId()` 按实例隔离，避免多画布隐藏实例抢解析。
- 叠加层移入 vue-flow 插槽，z-index 4 低于对话面板 10；命中区改为 `pointer-events:none` + `isPointInStroke` 命中测试，滚轮/拖拽/框选不再被线拦截。
- 排队任务因目标被删除/禁用或画布不可用被丢弃时同步清箭头；`dispose` 增加 disposed 标记与定时器清理，abort 触发的 finish 不再回写。
- 坐标计算抽成纯函数 `computeAgentLinkPath`，跳过缺失 `computedPosition` 的节点、尺寸为 0 时回退默认值。
- tooltip 边缘钳制与顶部翻转；补 `prefers-reduced-motion`。
- 测试新增几何 4 例（缩放/偏移/反向/缺失坐标），共 9 例通过。

未改（记录为限制）：同节点对并发多线仍重叠；回传脉冲为静态短虚线（非流动动画）；tooltip 仅鼠标可及。

- 是否通过：按上述修复通过
- 其他要求：无
