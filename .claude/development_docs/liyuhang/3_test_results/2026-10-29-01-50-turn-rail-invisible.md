# 测试结果：轮次目录条恢复显示

- 记录时间：2026-10-29 01:50
- 关联：`4_bugs_fix/bug_analysis-2026-10-29-01-45-turn-rail-invisible.md`、`bug_solution-2026-10-29-01-45-turn-rail-invisible.md`

## 一、改动

`apps/web/src/components/agent/conversation/messageList.vue`
- `.turnRail` 增加 `flex-direction: column`（横向 flex 下列表宽度塌成 0，短横被 `overflow:hidden` 裁掉）；
- `.turnRailList` 保留 `flex: 0 1 auto`（只管高度）并补 `min-width: 0`；
- 消息列表的空槽从无条件 `padding-right: 34px` 改为 `.hasTurnRail` 条件类（`turns.length > 1` 才加）。

## 二、静态验证

- `apps/web typecheck`：仅既有 `singleAgent/types.ts(2,33)` 一条，无新增。
- 构建产物 `workspace-tjOZ8XMS.css`：`.turnRail{…flex-direction:column…}`、`.messageList.hasTurnRail{padding-right:34px}` 均在。
- `deploy-local.sh --build` 成功并安装。

## 三、待手测

1. 多轮对话：右侧出现一行行短横，悬停向左展开提问列表，点击跳到对应轮次。
2. 单轮对话（或新对话）：右侧没有空白槽，消息区左右对称。
3. 主对话面板与 Agent 节点面板表现一致。
4. 狭窄面板（Agent 节点，约 380px）下目录条仍完整可见、不压住消息操作按钮。

## 四、未覆盖

- 目录条与滚动条叠放的像素级核对（目录条 `pointer-events: none`，不影响滚动与点击）。
