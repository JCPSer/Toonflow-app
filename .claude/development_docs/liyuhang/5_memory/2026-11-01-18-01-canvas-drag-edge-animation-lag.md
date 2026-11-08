# 记忆：拖动多连边节点卡顿

- 时间：2026-11-01 18:01
- 类型：Bug 修复

## STAR

**Situation（背景）**
用户拖动一个连着 7 根线的节点时整个过程持续发涩、跟手延迟，松手即恢复。画布用 `@vue-flow/core@1.48.2`，边是内置 `simplebezier`，应用通过 `defaultEdgeOptions.class` 给「端点选中/拖动中」的边追加 `edgeNodeActive / edgeActive / animated`。`animated` 触发虚线流动动画（`stroke-dashoffset`，`steps(20)` 约 10Hz 失效重绘）。

**Task（任务）**
消除拖动期间的卡顿，且不牺牲其它场景的流动动画与连线高亮。

**Action（行动）**
- 先定位：让用户在设置里关掉「连线流动动画」再拖同一节点，卡顿消失 → 确认主因是拖动期间关联边上的虚线动画，而非边组件重渲染或 O(N+E) 每帧扫描（20–50 节点规模下后者可忽略）。
- `canvas/index.vue`：新增 `dragActive = computed(() => flow.nodes.value.some(node => node.dragging))`；模板根节点绑定 `dragPaused: dragActive`；样式新增 `&.dragPaused :deep(.vue-flow__edge.animated path) { animation: none }`。
- 保留 `animated` 类：虚线样式（`stroke-dasharray: 5`）挂在同一个类上，摘类会让拖动中的线变实线再变回，视觉闪烁。只停 `animation`。
- 兜底：`clearStuckDragging()` 在 `[canvasId, props.active]` watch 与 `resetCanvasKeys()`（window blur、设置面板开关）里复位残留 `dragging`——d3-drag 只在 window 等 mouseup，失焦/窗口外松开不会再有 `nodeDragStop`，否则连线会永久停流动。
- 评审 P2 采纳：用 `flow.nodes` 而不是 `getNodes`（后者在 `onlyRenderVisibleElements=true` 时依赖 viewport）。

**Result（结果）**
类型检查仅既有 `@/agentRuntime` 报错；轴锁 + 快捷键回归 24 单测通过；web 已构建并 rsync 到安装目录（`index.html` `73ddd721…`、`workspace-C_q2TV18.js` `15bdf33a…`、`workspace-BC-dFJ3W.css` `eabbe28d…`），未重启应用。

## 关键经验

1. 「卡顿随连边数量增长」不等于重渲染问题：先让用户用设置开关做对照实验，比在代码里猜快得多。
2. `animated` 既是动画开关也携带 `stroke-dasharray` 样式，摘类会顺带改外观；停动画要用 CSS 覆盖而不是删类。
3. Vue Flow 的 `node.dragging` 只能靠 d3 的 mouseup 复位，失焦/切画布会留脏；任何依赖它的功能都要有中断兜底。
4. `flow.getNodes` 在开启可见性裁剪时会依赖 viewport，派生状态应优先用 `flow.nodes`。
5. 纯函数抽离要有意义：定稿是 CSS 规则时，为「可测试」而抽函数只是制造已覆盖的错觉，评审后删掉了。
