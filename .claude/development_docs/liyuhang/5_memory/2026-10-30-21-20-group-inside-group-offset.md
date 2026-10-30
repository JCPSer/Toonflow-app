# 记忆：组内打组后分组框与节点错位

- 时间：2026-10-30 21:20
- 改动范围：1 个文件（`selectionToolbar.vue` `groupNodes()`，约 4 行）

## Situation

画布支持嵌套分组：`node.position` 相对父分组，`node.computedPosition = position + 父 computedPosition`。
用户反馈「在组内打组」后会多出一个空分组、节点跑到别处。

## Task

修复组内打组时子节点位置计算，保证节点屏幕位置不变、新组紧贴包住它。

## Action

`groupNodes()` 里组坐标和子节点坐标口径不一致：

- 组位置 = `snap(绝对 bounds − 32/48 − 父绝对)`（相对）✔
- 子节点位置 = `snap(节点绝对) − 组相对位置` ✘（绝对减相对，多算了一个父组绝对坐标）

改为先算组的**绝对原点**再派生相对位置：

```
grid        = gridSize(flow)
groupOrigin = snapPoint({ bounds.x - 32, bounds.y - 48 }, grid)   // 绝对，只吸附一次
groupPosition = groupOrigin - parentPosition                       // 相对，不再二次吸附
子节点 position = snapPoint(node.computedPosition, grid) - groupOrigin
```

顶层打组时 `parentPosition = {0,0}`，与旧行为等价。
审查附带发现同类吸附口径问题：`ungroupNodes()` 与 `mergeGroups()` 把 `snapPoint` 作用在相对差值上（父组离网时等于没吸），
一并改为「先吸绝对、再减父绝对」；`groupNode.vue` 缩放手柄同类但影响很小，未动。

## Result

隔离实例（真实画布副本 + vite dev + Chrome）复现并验证：

| 用例 | 修前 | 修后 |
| --- | --- | --- |
| 组内选中 1 节点打组 | 节点绝对 (992,0) → (1952,−656)，新组 384×177 空框 | 节点绝对不变，新组 (960,−48) 384×177 包住节点 |
| 组内选中 2 节点打组 | 同上偏移 | 两节点绝对不变，新组 640×177 |
| 顶层选中 2 节点打组 | 正常 | 正常（无回归） |
| 连续撤销两次 | — | 逐级还原，节点不漂移 |

web typecheck 仅剩既有 `@/agentRuntime` 基线错误；web 构建通过；`deploy-local.sh` 已安装（未重启应用）。

## 经验

- Vue Flow 里「绝对坐标 = position + 祖先 computedPosition」这条口径，任何写 `position` 的地方都必须与
  「减去哪个原点」配对：减绝对原点得到绝对结果，减相对位置会让节点整体平移一个父组位移。
- 吸附只做一次，且做在绝对坐标上；先减再吸附会让父组不在网格时把新组永久推离网格。
- 症状「新组是空框 + 节点在别处」不是渲染问题，先比对 `position` / `computedPosition` 两组数字就能定位。
