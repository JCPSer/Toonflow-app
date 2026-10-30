# Bug 方案：组内打组后新分组框与节点错位

- 时间：2026-10-30 21:05
- 对应分析：`bug_analysis-2026-10-30-21-00-group-inside-group-offset.md`
- 改动范围：1 个文件、`groupNodes()` 内 4 行

## 1. 目标

1. 组内打组后，被选中的节点在屏幕上**位置不变**，新分组框紧贴包住它（B1）。
2. 新分组的绝对坐标落在网格上，即使父分组本身不在网格上（B2）。
3. 不改变顶层打组、合并分组、解组的既有行为。

## 2. 方案

### 2.1 统一口径（核心）

`groupNodes()` 内部把「组原点」显式拆成绝对/相对两份，子节点一律用绝对：

```
parentPosition = 父分组 computedPosition（无父组时 {0,0}）
groupOrigin    = snapPoint({ bounds.x - 32, bounds.y - 48 }, grid)   // 绝对，先吸附
groupPosition  = subtractPoint(groupOrigin, parentPosition)          // 相对，不再二次吸附
group.position = groupPosition
group.parentNode = parentNode

子节点 .position = subtractPoint(snapPoint(node.computedPosition, grid), groupOrigin)
```

要点：
- 吸附只做一次，且做在**绝对**坐标上；组自身的 `position` 由绝对减去父绝对得到，保证「组在网格上」在视觉上也成立。
- 子节点减去的是 `groupOrigin`（绝对），不再减相对坐标 `groupPosition`。
- 顶层打组（无父组）：`parentPosition = {0,0}`，`groupPosition === groupOrigin`，与现状等价。

### 2.2 顺带修掉同类吸附口径（B2）

同一文件里还有两处把 `snapPoint` 作用在**相对差值**上，父组本身离网时相当于没吸附：

- `ungroupNodes()`：改成「先吸附绝对坐标，再减父组绝对位置」；
- `mergeGroups()`：`mergedOrigin` 已是吸附过的绝对坐标，组位置直接「绝对 − 父绝对」，不再二次吸附。

`groupNode.vue` 缩放手柄的同类写法影响更小（只影响用户手拖出来的尺寸），本次不动。

### 2.3 不做的事

- 不改 `groupNodes()` 之外的坐标含义：`mergeGroups()` / `ungroupNodes()` 的子节点坐标本来就是「绝对 − 绝对」，只动吸附位置。
- 不额外给外层分组做贴合：外层分组的直接子节点从「节点」变成「新组」，位置和占用面积都不变，
  没有需要收缩的内容；如果贴上去反而会因新组未测量而缩成最小尺寸。
- 不给已被这个 bug 写坏的画布做数据修复：用户重新拖一次即可，避免在打开画布时静默改写坐标。

## 3. 验证

| 用例 | 期望 |
| --- | --- |
| 组内选中 1 个节点打组 | 新组框住该节点，节点 `computedPosition` 与打组前完全一致 |
| 组内选中 2 个以上节点打组 | 同上，组尺寸 = 内容 + 32/48 内边距 |
| 顶层（无父组）打组 | 与修复前一致 |
| 跨父组选区打组（parentNode 为空） | 与修复前一致，组落在绝对坐标 − 32/48 |
| 组内打组后撤销 / 重做 | 回到打组前，节点不漂移 |
| 父组本身不在网格上的旧画布 | 新组绝对坐标吸附到网格，节点相对位置不出格 |

隔离实例复现路径：真实画布副本放在临时项目里，选中 `视频_1-1-1`（外层组 d39b31b7 绝对 960,−656）→ 打组。

## 4. 评审意见（用户填写）

- 结论：待评审
- 意见：

## 5. 子 agent 初审

- 结论：通过，方案无须改（首轮回执晚到；逐条意见见分析文档 §7）
- 审查附带的 P2（`mergeGroups` / `ungroupNodes` 吸相对差值）已并入 §2.2 一并实施
- 验证：§3 用例表单节点 / 多节点 / 顶层 / 撤销 4 项全部通过（隔离实例）
- 实施结果：`bun run --filter '@toonflow/web' typecheck` 仅剩既有 `@/agentRuntime` 基线错误；web 构建通过；`scripts/deploy-local.sh` 已安装（未重启应用）
