# Bug 方案：修复轮次目录条不可见 + 空槽按需预留

- 记录时间：2026-10-29 01:45
- 关联分析：`bug_analysis-2026-10-29-01-45-turn-rail-invisible.md`

## 一、B1：目录条容器改纵向 flex

```
.turnRail:
    display: flex
    flex-direction: column      // 新增：让唯一子项在交叉轴上被 stretch 到 26px 宽
    width: 26px
    max-height: calc(100% - 104px)
    top: 50% + translateY(-50%) // 高度仍按内容、整体垂直居中

.turnRailList:
    flex: 0 1 auto              // 只用来收缩高度
    min-width: 0                // 新增：防御性，避免再次按内容塌成 0 宽
```

- 高度语义不变：内容少 → 整条较短并居中；内容超上限 → nav 被 `max-height` 限制，列表 `overflow` 接管（展开态可滚动）。
- 宽度语义恢复：短横（绝对居中、12×3）重新可见。

## 二、B2：空槽按需预留

- `.messageList` 增加条件 class：`turns.length > 1` 时为 `.hasTurnRail`；
- `padding-right: 34px` 从无条件改为 `.messageList.hasTurnRail` 专属；
- 轮次不足 2 条时不再有空白槽，消息区右侧对称。

## 三、验证计划

1. `apps/web` typecheck 0 新增。
2. `deploy-local.sh --build` 成功；产物 CSS 中 `.turnRail` 含 `flex-direction:column`，`.messageList.hasTurnRail` 含 34px 内边距。
3. 手测：单轮对话无目录条且无空槽；多轮对话目录条短横可见、悬停展开可滚动、点击跳转正常；两个面板一致。

## 四、未覆盖

- 目录条与右侧滚动条在窄面板下的叠放未做像素级核对（目录条 `pointer-events: none`，不影响滚动）。
