# Bug 修复方案：拖动多连边节点时画布卡顿

- 时间：2026-11-01 18:01（18:30 按评审改为 CSS 冻结动画）
- 对应分析：`bug_analysis-2026-11-01-18-01-canvas-drag-edge-animation-lag.md`
- 状态：已评审通过并实施

## 1. 目标

拖动期间冻结连线的虚线流动动画（几何本身每帧在变，动画叠加导致 SVG 持续重绘）；松手立即恢复；保留虚线样式与高亮；不引入需要手动复位、可能卡死的开关状态。

## 2. 方案概览

```
拖动态判定（派生，不落状态）
   dragActive = 画布内存在 node.dragging === true
        │
        ▼
画布根节点挂 .dragPaused
        │
        ▼
CSS：.canvas.dragPaused .vue-flow__edge.animated path { animation: none }
   - 虚线样式来自 Vue Flow 的 animated 类（stroke-dasharray: 5），保留
   - 只停 animation：不再有 10Hz 失效重绘
```

## 3. 关键设计

### 3.1 用派生状态 + 中断兜底（B3）

- 不新增 `isDragging` ref 去在 `nodeDragStart/Stop` 里手动置位复位；改为 `computed(() => flow.nodes.value.some(node => node.dragging))`（用 `flow.nodes` 而非 `getNodes`，后者在 `onlyRenderVisibleElements=true` 时会依赖 viewport）。
- 该 computed 只依赖每个节点的 `dragging` 字段，位置变化不会让它重算，只有拖动开始/结束各重算一次 O(N)。
- **派生状态不能天然自愈**：d3-drag 只在 window 上等 `mouseup`，拖动期间失焦、窗口外松开、切画布都不会再有 `nodeDragStop`，`dragging` 会永久为 true。因此补 `clearStuckDragging()`，在画布切换/失活 watch 与 `resetCanvasKeys()`（window blur、设置面板开关）里把残留的 `dragging` 复位。

### 3.2 熄灭动画而不是摘掉 `animated` 类

- 初版实现是拖动时不加 `animated`。评审指出：`stroke-dasharray: 5` 也挂在 `.animated` 上，摘类会让拖动中的线从虚线变实线，松手再变回，视觉上会闪。
- 改为保留 `animated`，只在根节点加 `.dragPaused` 并 `animation: none`：虚线还在，只是不流动；且边的类名不再依赖拖动态，起手/松手不需要重渲染全部边。

### 3.3 用「画布内是否有节点在拖」而不是「本边端点是否在拖」（B2）

- 分组拖动时，子节点被父节点的 `computedPosition` 带着走，自身 `dragging` 仍为 false；只看端点会漏判。
- 全局拖动态让分组拖动、多选拖动、拖动复制统一停流动。

### 3.4 只停流动，不停高亮（B4）

- `edgeNodeActive`（端口强化）与 `edgeActive`（连线变色）照旧。
- 口径：**任意拖动进行中，全画布统一暂停流动**；没有拖动时，选中节点的连边照常流动。不按「端点到拖动节点的祖先链」做更细隔离。

## 4. 改动清单

| 文件 | 改动 |
| --- | --- |
| `apps/web/src/pages/workspace/panels/canvas/index.vue` | 模板根节点绑定 `dragPaused: dragActive`；新增 `dragActive` computed（`flow.nodes`）与 `clearStuckDragging()`；切换画布/失活/失焦时复位残留 dragging；样式新增 `.dragPaused` 冻结规则 |

纯函数抽离与单测在定稿前被移除：定稿逻辑是 CSS 规则，抽函数测不到真实行为，留着只会制造“已验证”的错觉。

## 5. 风险与兼容

| 风险 | 说明 | 处理 |
| --- | --- | --- |
| 拖动起步瞬间仍会流动 | `dragging` 要越过 8px 拖动阈值并产生第一段位移才写入 | 极短窗口，可忽略 |
| 拖动中关闭设置/失焦清标 | 若指针仍按住继续拖，下一次移动会重新置 true，可能出现一帧闪动 | 交互上几乎不可能，接受 |
| CSS 覆盖失效 | 依赖比 Vue Flow 默认 `.vue-flow__edge.animated path` 更高的选择器 | 根类名 + 属性选择器特异性更高，构建产物已核对 |
| 自愈只恢复动画 | `clearStuckDragging` 只清 `node.dragging`，不清 d3 内部手势 | 既有 Vue Flow 行为，非本次引入；动画能恢复即可 |
| 拖动期间全画布暂停流动 | 其它已选中节点的连边也暂停 | 已与用户确认口径 |

## 6. 评审意见

方案评审（2026-11-01 18:09，子 Agent）：修改后通过。

| 级别 | 意见 | 处理 |
| --- | --- | --- |
| P1 | 「派生状态天然自愈」不成立：拖动期间失焦/切画布不会再有 nodeDragStop，`dragging` 会永久为 true | 已补 `clearStuckDragging()`（§3.1） |
| P2 | 全局拖动态会让「已选中但没被拖的节点」的连边也暂停流动 | 已改口径（§3.4） |
| P2 | `flow.getNodes` 在可见性裁剪开启时会依赖 viewport 每帧重算 | 已改用 `flow.nodes` |
| P2 | 拖动复制开始时有一小段异步窗口没有 dragging | 接受：期间画布无位移 |
| P2 | 拖动复制中断可能残留副本 dragging | 由失焦/切画布兜底 |
| P2 | 「第一帧仍带动画」表述不准 | 已改为「越过 8px 阈值前」 |

实现复审（2026-11-01 18:26，子 Agent）：通过，无 P0/P1。

| 级别 | 意见 | 处理 |
| --- | --- | --- |
| P2 | 摘掉 `animated` 会让拖动中的线从虚线变实线 | 已改：保留类名，根节点 `.dragPaused` + CSS `animation: none` |
| P2 | 文档改动清单遗漏 `clearStuckDragging` | 已补（§3.1、§4） |
| P2 | 拖动态「仅起止各重算一次」在拖动复制时不严格成立 | 已写入 §3.1/§5 口径 |
| P2 | 自愈只是动画恢复，不含 d3 内部手势 | 已写入 §5 |
