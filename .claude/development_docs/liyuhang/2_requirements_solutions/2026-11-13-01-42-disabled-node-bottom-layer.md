# 需求方案：禁用节点恒在画布下层

- 时间：2026-11-13 01:42
- 对应需求矩阵：`2026-11-13-01-42-disabled-node-bottom-layer.md`
- 状态：已实施并同步

## 1. 现状（Vue Flow 的层叠规则）

```text
节点包裹层  z-index = node.zIndex ?? node.style.zIndex ?? 0
选中时      z-index += 1000            （elevateNodesOnSelect）
分组子节点  z = max(父级 z, 自身 z) + 1 （getXYZPos）
```

项目此前从未使用 `zIndex`，所以所有节点都是 0，同 z 时按 DOM 顺序 → 后加入的节点在上。

## 2. 方案

### 2.1 用负数把禁用节点压到启用节点之下

```text
DISABLED_NODE_Z_INDEX = -1

禁用节点：node.zIndex = -1  → 未选中时 -1，选中时 999
启用节点：保持 undefined    → 未选中时 0， 选中时 1000
```

由此得到完整的层序（越高越靠上）：禁用(-1) < 启用(0) < 选中的禁用(999) < 选中的启用(1000)。
满足 R1、R2：禁用节点恒在启用节点之下，但选中/拖动时仍会浮到未选中的启用节点之上。

### 2.2 派生而非持久化

`zIndex` 由 `data.disabled` 推导，是运行时事实，不是文档内容：

- 加入 `index.vue` 的 `nodeRuntimeFields`：字段变化不触发保存节流与撤销记录。
- 加入 `useCanvasHistory.ts` 的 `nodeRuntimeFields`：不进快照、不随撤销恢复（否则撤销一次位移会把禁用节点顶回去）。

注意：这两处只解决「变更不触发保存/不进快照」，**不影响序列化**——Vue Flow 的 `toObject()` 会原样带上 `zIndex`。
所以落盘（`saveCanvas`）与剪贴板（`nodeClipboard.ts`）两个序列化边界要各自剥掉，见 §2.6。

### 2.3 重算时机

一个 watch 覆盖所有会让层级失效的路径：

```text
watch(
  依赖 = [节点数组, ...每个节点的 data.disabled],
  动作 = 遍历节点：禁用 → zIndex = -1；启用 → 删除 zIndex
)
```

依赖里的「节点数组」本身保证了 `setNodes` 整体替换（加载画布、撤销/重做、粘贴）也会重算，
而不是只在禁用状态变化时生效一次。

### 2.4 分组

不额外干预。分组子节点的 z 由 Vue Flow 的 `max(父, 子) + 1` 保证至少比分组本体高一层，
所以组内禁用节点仍可见可选中；代价是它可能高于组外的启用节点。这是刻意的取舍：
强行压到全局最底会被分组底色/边框盖住。

### 2.5 层叠上下文安全性

DOM 结构是 `.vue-flow__viewport(z 4) > .vue-flow__pane(z 1) > .vue-flow__transformationpane(z 2, transform)`，
转换层带 transform + z-index，自成层叠上下文。负数 z 的节点只会退到该上下文内部的最底层
——即连线 SVG 层之下、转换层背景（透明）之上。真正的画布背景（Background 组件）渲染在
`.vue-flow` 根插槽、viewport 之外且 z-index auto，不会被负 z 的节点穿透盖住。

### 2.6 两个序列化边界

`toObject()` 不剥离 `zIndex`，派生值会随保存写进项目文件、随复制进剪贴板：

```text
saveCanvas：serialized.nodes.map(stripDerivedNodeFields)
nodeClipboard.copyNodesToClipboard：解构列表补 zIndex
```

### 2.7 拖动路径

画布关掉了 `selectNodesOnDrag`，直接按住未选中的禁用节点拖动时 Vue Flow 不会把它选中，
拿不到 +1000 提升 → 拖动全程被盖住。因此：

```text
onNodeDragStart：被拖的禁用节点临时设 z = 999（选中档）
onNodeDragStop / 拖动被打断（切画布、失活）：syncDisabledNodeZ() 收回
```

## 3. 影响面

- 只改画布层：`index.vue`、`useCanvasHistory.ts`。
- 不下发改写点：节点 UMD 包不变，web 产物重建即可。

## 4. 验证计划

- 禁用两个互相重叠的节点中靠后的那个 → 它应沉到下面；解禁立即恢复。
- 选中被压下去的禁用节点 → 应浮起（999），可拖动、可右键。
- 撤销/重做禁用操作 → 层级仍正确。
- 分组内禁用 → 仍在分组之上，不被分组底色遮住。
- 保存后重新打开画布 → 层级仍正确。

## 5. 评审意见

（待用户填写）

## 6. 子 agent 评审结论与修订（2026-11-13 02:05）

| 级别 | 问题 | 修订 |
| --- | --- | --- |
| P1 | `zIndex` 仍写进画布文件与剪贴板：两处 `nodeRuntimeFields` 只管「变更不触发保存/不进快照」，不改变 `toObject()` 的序列化 | `saveCanvas` 统一 `stripDerivedNodeFields`；`nodeClipboard.copyNodesToClipboard` 解构列表补 `zIndex` |
| P2 | 画布 `selectNodesOnDrag=false`，拖动未选中的禁用节点不会浮起，与「选中/拖动时浮起」的取舍不符 | `onNodeDragStart` 临时抬到 999，`onNodeDragStop` 与拖动中断（切画布/失活）收回 |
| P2 | 禁用节点沉到连线层之下，连线约 20px 判定带会抢 hover/click/右键 | 属已确认取舍：连线视觉压在禁用节点上，且线附近点击会走断开连线入口。实机确认后再决定是否改「启用=1/禁用=0」 |
| P2 | 运行态字段清单有三处（画布、历史、剪贴板），本次只同步两处 | 已在剪贴板补齐；三处合并留作后续重构 |
| P2 | 文档对层叠上下文的描述不准确（pane 是祖先不是“之外”） | §2.5 已改写 |

评审同时确认：watch 的触发面覆盖加载 / 撤销 / 粘贴 / 建组解组；无无限循环；`delete node.zIndex` 与 Vue Flow 的 `toRef` 兼容；负 z 不会穿透到画布背景。

- 是否通过：
- 其他要求：
