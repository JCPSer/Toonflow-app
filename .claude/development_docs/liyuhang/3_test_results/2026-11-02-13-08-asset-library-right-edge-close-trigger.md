# 测试结果：素材库面板右边缘悬停关闭入口

- 时间：2026-11-02 13:40
- 对应需求：`1_requirements_matrix/2026-11-02-13-08-asset-library-right-edge-close-trigger.md`
- 对应方案：`2_requirements_solutions/2026-11-02-13-08-asset-library-right-edge-close-trigger.md`
- 结论：类型检查、构建、部署核对、两轮子 Agent 审查通过；**未重启应用**，需用户重启后人工验收

## 1. 类型检查

```
bun run --filter '@toonflow/web' typecheck
→ 仅剩既有错误：../server/src/modules/agentAccess/singleAgent/types.ts(2,33)
  Cannot find module '@/agentRuntime'
```

新增组件、组合式函数与抽取后的左入口均无类型错误。

## 2. 构建

```
bun run --filter '@toonflow/web' build
→ Exited with code 0
```

产物：`build/web/assets/workspace-DNHCwwcd.js`（关闭入口所在 chunk）。

## 3. 部署核对

| 项 | 结果 |
| --- | --- |
| 部署命令 | `rsync -a build/web/ /Applications/toonflow-exec.app/Contents/Resources/app/views/mainview/` |
| `index.html` md5 | `0eccf3ccb23fd74699503d1eb8176712`（构建 = 应用） |
| 应用入口 | `index.html` → `assets/index-B3Jj6Cv6.js` |
| chunk 引用 | `index-B3Jj6Cv6.js` 引用 `workspace-DNHCwwcd.js` |
| 组件产物 | `workspace-DNHCwwcd.js` 内含 `assetPanelCloseTrigger` / `关闭素材库`，md5 `3e5092b2cf11e39f5d3ea5f025617970`（构建 = 应用） |

**未重启应用**，需用户自行重启后生效。

## 4. 静态核对

| 断言 | 证据 |
| --- | --- |
| 关闭入口渲染进面板 `aside` | `floatingAssetLibrary.vue` 默认 slot 第二个根节点，`floatingPanel.vue` 的 `<slot />` 位于 `aside` 内 |
| 面板关闭时不渲染 | `v-if="visible"` |
| 点击关闭走现有链路 | `@close="visible = false"` → store → `slide-from="left"` 退出动画 |
| 热区不挡面板 | 根容器 `pointer-events: none`；热区在 `right: -12px`、按钮在 `right: -44px`，均在面板边框外 |
| 不与缩放热区重叠 | 右侧 e 手柄在边框内 0–5px，关闭入口从边框外开始 |
| 回退判定不受动画影响 | 读 `panel.style.left/width`，不读 `getBoundingClientRect()` |
| 窗口缩放重算 | `resize` → `nextTick(updatePlacement)` |
| 键盘聚焦也重算 | `@focus="reveal"`（先 `updatePlacement` 再 `show`） |
| 左侧入口行为不变 | 改为 `useHoverReveal` 组合式函数，事件/计时逻辑逐条等价；复审用旧构建反编译核对 |
| i18n | 两个入口均用 `translate('打开素材库')` / `translate('关闭素材库')` |
| 触屏 | 两个入口都补 `@media (hover: none) { display: none }` |
| reduced-motion | 关闭入口 `transition: none` |

## 5. 代码审查

| 轮次 | 结论 | 处理 |
| --- | --- | --- |
| 设计评审（13:22） | 修改后通过，无 P1，4 个 P2 | 回退判定改读内联 left/width、resize 走 nextTick、focus 也重算、i18n 统一、N1/验收口径修正 |
| 实现复审（13:33） | 通过，无 P1/P2，6 个 P3 | 回退态只淡入、根容器 `z-index: 3`、补记录外侧热区吞点击、清理方案残留 |

已核实无问题：slot 多根节点不被裁剪；pointerdown 不会启动面板拖动；`window resize` 的 nextTick 时序；`v-if` 卸载与左入口恢复；`flipped` 初始值不影响首帧（所有显示路径先重算）。

## 6. 未覆盖项（需重启后人工确认）

1. 素材库停靠/浮层打开，鼠标贴面板右边缘外侧竖直居中，左箭头按钮滑入；移开后约 0.32s 消失。
2. 点击按钮，素材库向左滑出；左边缘打开入口恢复，可再次打开。
3. 拖动浮层面板、调整停靠宽度，按钮始终贴右边缘居中。
4. 浮层拖到距屏幕右缘 15–52px，按钮翻到面板内侧仍可点击（回退态只淡入）。
5. 面板内容点击、滚轮、右边缘拖拽缩放不被拦截；面板外侧 12px 竖条内的画布点击/滚轮被热区截获（已知降级）。
6. 键盘 Tab 聚焦按钮时显示，Enter 关闭素材库。
