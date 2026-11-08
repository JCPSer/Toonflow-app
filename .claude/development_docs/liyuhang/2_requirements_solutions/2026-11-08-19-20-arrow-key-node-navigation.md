# 需求方案：画布方向键选择相邻节点

- 时间：2026-11-08 19:20
- 对应需求：`../1_requirements_matrix/2026-11-08-19-20-arrow-key-node-navigation.md`
- 状态：已实施（待人工验收）

## 1. 背景与约束

- 画布 `apps/web/src/pages/workspace/panels/canvas/index.vue` 的 `updateCanvasKeys` 已统一处理快捷键：窗口捕获阶段监听 keydown/keyup，先算 `editing`（输入类控件）、`inCanvas`（画布语境）、`panelDelete` 等，再匹配快捷键表。
- `<vue-flow>` 显式关闭了键盘能力：`nodes-focusable=false`、`disable-keyboard-a11y=true`、`delete-key-code=null`，因此方向键在内置层面完全空闲，不存在被 Vue Flow 抢键的问题。
- 节点几何信息现成：`GraphNode.position`、`computedPosition`、`dimensions`；视口用 `stream.viewport`（x/y/zoom）与 `flow.dimensions`（容器宽高）。
- 选区操作已有既定写法（节点搜索 `nodeSearch.vue`）：`flow.removeSelectedElements()` + `flow.addSelectedNodes([node])`，并复位 `nodesSelectionActive`。

## 2. 方案

### 2.1 几何部分抽成纯函数

新增 `apps/web/src/pages/workspace/panels/canvas/nodeNavigation.ts`：

```text
NavigationNode = { id, type, position, computedPosition?, dimensions?, hidden?, selected?, selectable? }

nodeRect(node)        → 以 computedPosition 优先，宽高缺省 0
boundingRect(nodes)   → 选区外接框
rectCenter(rect)      → 框中心
pickNodeInDirection(nodes, origin, direction, exclude)
pickNodeNearestPoint(nodes, point, exclude)
```

选点规则：

```text
候选过滤：不是 canvasGroup、非 hidden、非 selectable=false、不在 exclude
方向锥：forward = Δ·方向向量；perp = |Δ × 方向向量|
        要求 forward > 0 且 perp ≤ forward（即 ±45° 内）
评分：score = |Δ| + perp
排序：score ↑ → perp ↑ → |Δ| ↑ → id ↑（结果稳定）
```

`pickNodeNearestPoint` 用"点到节点矩形的最短距离"排序（点在框内为 0），同分再比中心距离与 id。用矩形距离而不是中心距离，是因为大节点中心可能很远，但它在视口里就在眼前。

两个函数都用泛型 `T extends NavigationNode`，返回原对象引用，避免宿主再按 id 反查。

### 2.2 宿主接线

`canvas/index.vue`：

```text
updateCanvasKeys(event)
  ...
  既有守卫计算：editing / inCanvas / panelOpenOnBody / inAgentNodePanel
  ↓
  在既有 keyup、defaultPrevented、isComposing 早退之后插入方向键分支：
    按下 Ctrl/Alt/Meta → 放行（系统手势）
    editing 或 !inCanvas 或 hasModalOverlay() → 放行
    方向 = ArrowUp/Down/Left/Right
    成功导航 → preventDefault；否则不吞按键
  ↓
  既有快捷键匹配与派发（不受影响）

navigateSelection(direction, extend)
  nodes = flow.getNodes
  起点：有选区 → boundingRect(选中).中心
        无选区 → 视口中心（由 viewport 与容器尺寸反算画布坐标）
  目标：有选区 → pickNodeInDirection
        无选区 → pickNodeNearestPoint
  无目标 → 返回 false
  flow.nodesSelectionActive = false
  extend ? 追加 : removeSelectedElements() + addSelectedNodes([target])
  setCenter(目标中心, { zoom: 当前 zoom, duration: 180 })
```

- 已选节点由 `node.selected` 天然进入 exclude，无需额外传参。
- 视口中心换算：`((容器宽/2 - viewport.x) / zoom, (容器高/2 - viewport.y) / zoom)`。

### 2.3 UI

无新增控件、无新增设置项。唯一可见变化：导航后视口以 180ms 动画把目标节点居中。

## 3. 交付物

- 新增：`nodeNavigation.ts`、`nodeNavigation.test.ts`。
- 修改：`canvas/index.vue`（方向键分支 + `navigateSelection`）。
- 构建 web 并同步应用 `views/mainview/`；不涉及节点 UMD，不需要重建节点包。
- 需要重启应用生效。

## 4. 边界与异常

1. 没有可去的节点：不移动、不吞键。
2. 目标节点尚未测量尺寸（宽高 0）：仍可被选中与居中，只是评分按左上角近似。
3. 分组节点：不参与导航；分组内普通节点照常可达。
4. Shift 长按连发：选区持续扩大，动画随新目标重定向。
5. 输入法组合（isComposing）：不触发。
6. 背景画布（非 active）：`updateCanvasKeys` 早已早退，不会响应。
7. 节点右键菜单（teleport 到 body）落在画布外，天然不触发；画布下拉的条目菜单 append 在画布内部，额外用 `.el-popper / role=menu / role=listbox` 守卫让位，避免和 Element Plus 的 roving focus 抢方向键。

## 5. 测试计划

- 单测：方向锥内取最近、45° 边界、锥外忽略、排除已选中/分组/隐藏、无目标返回空、选区外接框起点、视口中心最近（矩形距离与同分规则）、未测量尺寸不崩。
- 类型检查：`apps/web`。
- 构建：`bun run --filter '@toonflow/web' build`。
- 人工：见测试结果文档。

## 6. 实施与验证（2026-11-08 19:30）

### 6.1 落地

- 新增 `nodeNavigation.ts`：`nodeRect` / `boundingRect` / `rectCenter` / `rectDistance` / `pickNodeInDirection` / `pickNodeNearestPoint`，全部纯函数、无副作用。
- 新增 `nodeNavigation.test.ts`：18 条单测。
- `canvas/index.vue`：新增 `navigateSelection()`、`viewportCenterInFlow()`；在 `updateCanvasKeys` 的 `runAction` 之后插入方向键分支。
- 选中替换改用 `removeSelectedNodes(选中节点)`，只清节点、保留连线选中。
- 长按 repeat 时 `setCenter` 的 duration 降为 0，避免动画一直追不上按键。

### 6.2 评审发现与处理

| 级别 | 问题 | 处理 |
| --- | --- | --- |
| P1 | Agent 节点对话面板在 `<vue-flow>` 内部且 `inCanvas` 为真，方向键会改画布选区、抢消息区滚动 | 守卫补充 `inAgentNodePanel` |
| P1 | 用 `textEditing` 替代 `editing` 放行了节点内部按钮（相机/灯光角度、裁剪、3D 场景、音频片段都用方向键） | 新增 `inNodeWidget`（`.vue-flow__node` / `.vue-flow__edge` 内整体让位）；画布工具条仍在节点之外，验收项 9 不受影响 |
| P2 | 画布下拉的条目菜单 append 到画布内部，Element Plus roving focus 与导航争抢方向键 | 新增 `inFloatingMenu`（`.el-popper` / `role=menu` / `role=listbox`） |
| P3 | 未测量（宽高 0）时视口中心会算出视口外的坐标 | `viewportCenterInFlow` 返回 `undefined`，此时不导航 |
| P3 | 裸方向键会顺带清掉连线选中 | 改用 `removeSelectedNodes` |
| P3 | 长按 repeat 时 180ms 动画叠加 | repeat 时 duration 0 |
| P3 | 测试里 exclude 参数实际未被覆盖 | 补一条普通节点 id 的排除用例 |

保留未改：方向键仍可在设置页被录制成其它快捷键并失效（写死方向键的已知副作用，未做录制端拦截）。


## 7. 评审意见

（待用户填写）

- 是否通过：
- 其他要求：
