# 变更记录：分组内节点删除后自动贴合

时间：2026-10-29 22:55
类型：Bug 修复（画布分组几何）

## Situation

分组里的节点删掉后，分组矩形不跟着收缩，框里留一大片空白；用户记得"以前会自动变"。

## Task

在任意删除入口下都能让分组贴合剩余内容；删空时保留一个最小尺寸的空组；撤销、加载旧画布、拖拽换组、粘贴等既有行为不能被打乱。

## Action

- 排查：`fitGroupBounds` 只在 `finishGroupDrag`（拖动松手）和 `arrangeSelection`（整理选中）两处被调用；删除链路（`deleteSelection`、节点卡片删除、MCP `deleteNodes`、`remoteNode`、插件内部删除）从未调用它——不是回归，是从来就没做过。顺带纠正一个误区：Vue Flow 的 `removeSelectedElements` 是取消选中，不是删除。
- 方案：不做逐处补调用（入口散在画布与节点包两侧，必漏），改为画布层单一观测点。用 `flow.getNodes.value` 的**数组引用**区分「整体替换」（`setNodes`：加载画布、建组/合组、撤销恢复 → 只同步基线）与「原地增删」（`removeNodes` → 做差分），避免用 `canvasReady` 当守卫（插件列表刷新会把它置 false，那个窗口里的删除会被静默漏掉）。
- `selectionNodes.ts`：新增 `captureGroupChildren` / `refitGroupsAfterRemoval`（受影响组 = 少了直接子节点的组 + 全部祖先，防环）、`setGroupSize`（按 `style` 实际宽高判等，无变化不写样式）；`fitGroupBounds` 增加空组分支（160×96）并返回实际贴合组数。
- `useCanvasHistory.ts`：暴露 `isApplying()`，撤销/重做期间跳过贴合，恢复快照原样尺寸。
- `index.vue`：`watch([节点数组引用, 成员关系串], { flush: "post" })`，移除组对象按 id 从当前数组重取（`fitGroupBounds` 用对象身份判断）。
- 测试：新增 `apps/web/scripts/check-group-refit.ts`（8 个夹具用例），并用临时画布在浏览器客户端做了真实删除/撤销/解组验证。

## Result

- 8/8 夹具用例通过；web 构建通过；typecheck 无新增错误；已部署，刷新即可生效（只改前端）。
- 实测：删 1 个子节点 1024×512 → 644×417；删空 → 160×96；撤销一步完整还原；解组触发外层 960×480 → 892×264；打开尺寸偏大的旧画布保持原样。
- 已知边界：受影响组里若有子节点尚未测量尺寸（后台画布），本次贴合会跳过，等下一次结构变化再收紧。
