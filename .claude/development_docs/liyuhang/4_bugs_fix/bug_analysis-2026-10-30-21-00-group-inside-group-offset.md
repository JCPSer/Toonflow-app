# Bug 分析：组内打组后新分组框与节点错位

- 时间：2026-10-30 21:00
- 报告人：用户（截图 + 口述「我在组内打组，会变成这样」）
- 复现路径（用户确认）：选中外层分组内的一个节点 → 点「打组」（浮动工具栏 / Cmd+G / 右键，均走同一函数）
- 期望（用户确认）：节点进新组、屏幕上位置不变；外层分组自适应

## 1. 背景

画布支持嵌套分组：`node.parentNode` 指向父分组，Vue Flow 的 `node.position` 是**相对父节点**的偏移，
`node.computedPosition = position + 父节点 computedPosition`（绝对坐标）。
`groupNodes()`（`apps/web/src/pages/workspace/panels/canvas/components/selectionToolbar.vue:160`）
负责把选中的根节点收进一个新分组。

## 2. 现象

在外层分组内选中节点打组后：

1. 出现一个新的「分组」框，**框里是空的**（框的位置＝节点原来的位置）；
2. 被选中的节点**跳到别处**（偏移量恰好等于外层分组的绝对坐标）；
3. 外层分组尺寸不变，看起来就像「凭空多了一个空分组」。

## 3. 根因（已在隔离实例复现）

`groupNodes()` 里组坐标和子节点坐标用了两套口径：

```
parentPosition = 父分组的 computedPosition          // 绝对
position       = bounds(绝对) - 32/48
groupPosition  = snap(position - parentPosition)      // 相对（正确）
...
子节点 position = snap(node.computedPosition) - groupPosition   // ❌ 绝对 − 相对
```

子节点位置必须相对**新分组的绝对原点**（`parentPosition + groupPosition`）计算，
现在只减了相对坐标 `groupPosition`，于是每个子节点都多加了父分组的绝对坐标。

隔离实例实测（真实画布副本，外层组绝对 (960,−656)，节点绝对 (992,0)）：

| | 分组（新） | 节点 |
| --- | --- | --- |
| 打组前 | — | pos(32,656) parent=旧组，绝对 (992,0) |
| 打组后（当前实现） | 绝对 (960,−48)，384×177，**空** | pos(992,−608)，绝对 **(1952,−656)**，多偏 +960 |
| 期望 | 同上 | 相对新组 (32,48)，绝对 (992,0) 不变 |

对照：`mergeGroups()` 的子节点坐标、`ungroupNodes()` 的落点坐标、`finishGroupDrag()` 的换组坐标都是
「绝对 − 绝对」，不存在「节点整体平移一个父组」的问题；它们只是把 `snapPoint` 作用在**相对差值**上，
父组本身离网时会漂 ≤8px（同类但量级小得多，见 B2）。

只有 `groupNodes()` 是真正的绝对/相对混算，所以只有「组内打组」会飞出屏幕，顶层打组正常。

## 4. Bug 矩阵

| 编号 | 描述 | 优先级 | 难度 | 风险 |
| --- | --- | --- | --- | --- |
| B1 | 组内打组：子节点位置多减/漏减父组绝对坐标，节点飞出、新组显示为空 | P0 | 低 | 低（只改一处坐标口径） |
| B2 | 同一个函数里组坐标按「相对坐标」吸附网格，父组若本身不在网格上，新组的绝对坐标会跟着漂移；同类位置还有 `mergeGroups:237`、`ungroupNodes:213`（吸附作用在相对差值上，父组离网时漂 ≤8px）与 `groupNode.vue:203`（缩放时吸相对 position，影响更小） | P2 | 低 | 低（改为按绝对坐标吸附） |
| B3 | 外层分组打组后是否需要即时贴合（用户期望「外层自适应」） | P2 | 低 | 中（与删除后贴合同一路径，可能引起尺寸抖动） |

## 5. 影响面

- 只影响「选中节点已有父分组」时的 `groupNodes()`；顶层打组、合并分组、解组不受影响。
- 受影响数据已持久化：`parentNode` / `position` 都写进画布 JSON；用户需要手动把节点拖回去（本次不做数据修复脚本）。
- 相关但不属于本 bug：`refitGroupsAfterRemoval` 会把「子节点被新组接管」当成一次删除，外层分组可能因此贴合；
  实测本次未触发（新组未测量前会跳过贴合），不影响定位。

## 6. 评审意见（用户填写）

- 结论：待评审
- 意见：

## 7. 子 agent 初审

- 结论：通过（首轮回执晚到，已按审查意见回填本文档）
- 逐条意见与处置：

| # | 审查意见 | 处置 |
| --- | --- | --- |
| 1 | 根因成立：`getRectOfNodes` 用 `computedPosition`（vue-flow-core 1.48.2:3716），偏差量恰为父组绝对坐标，无第二成因 | 采纳，与 §3 实测一致 |
| 2 | 修改口径与 `finishGroupDrag`（selectionNodes.ts:181）同构，父组离网 / 跨父组 / 组为 root 三种边界均正确；可接受副作用：节点吸附 ≤8px、组框可能超出外层内边距 ≤8px | 采纳，副作用记入方案 §2.1 |
| 3 | 外层无需贴合：`setNodes` 经 `createGraphNodes` 重建数组，`index.vue` 的引用守卫不成立 → 不触发 `refitGroupsAfterRemoval`；即便触发，未测量的新组也会被 `fitGroupBounds` 跳过 | 采纳，方案 §2.2 保留「不额外贴合」 |
| 4 | 文档称 `mergeGroups` / `ungroupNodes` 完全正确不准确：二者把 `snapPoint` 作用在相对差值上，父组离网时漂 ≤8px；`groupNode.vue:203` 同类（影响更小） | 采纳，已改写 §3 并扩写 B2；前两处随本次一并修掉，`groupNode.vue` 缩放手柄暂不动 |
