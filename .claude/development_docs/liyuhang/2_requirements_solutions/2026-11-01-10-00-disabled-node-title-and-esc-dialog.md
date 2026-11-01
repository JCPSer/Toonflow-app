# 需求方案：已禁用节点隐藏标题开关 + Esc 退出确认框闪现修复

- 时间：2026-11-01 10:00
- 对应需求：`1_requirements_matrix/2026-11-01-10-00-disabled-node-title-and-esc-dialog.md`
- 代码基线：`feat/exec-node`

## 1. 方案总览

### 1.1 禁用节点隐藏标题

不改节点包里的条件渲染，用「全局设置 + 画布根 class + 穿透样式」完成，避免每个节点各写一份：

```
generalSettings.hideDisabledNodeTitles（默认 false，存 settings.general）
  → canvasControls 工具条按钮切换
  → canvas 根 .canvas 绑定 hideDisabledNodeTitles class
  → scoped :deep 规则：
       .hideDisabledNodeTitles .nodeDisabled .titleBar .labelText { display:none }
       .hideDisabledNodeTitles .nodeDisabled .titleBar .disabledBadge { display:none }
```

- `.nodeDisabled` 是 `nodeSkeleton` 根节点已有的 class（`packages/nodeScaffold/src/nodeSkeleton.vue`），不需要节点包感知开关。
- scoped `:deep` 编译成 `.canvas[data-v-x] ...`，远程节点 UMD 渲染在 `.canvas` 子树内，选择器仍命中；节点的 scoped 属性不影响祖先选择器。
- 保留标题栏图标和操作按钮，禁用节点仍可识别类型、可删除。
- 文档内嵌节点用 `documentTarget` 时不渲染标题栏，天然不受影响。

**悬停看原名**：`nodeSkeleton` 的 `.titleBar` 增加 `:title="nodeDisabled ? \`${label}（节点已禁用）\` : undefined"`。名称隐藏后，鼠标停在标题栏（图标、按钮以外的区域）会显示系统 tooltip。该项需要重建全部节点 UMD 并同步到运行期节点目录。

### 1.2 开关的存储

- `stores/settings.ts` 的 `generalSettings` 增加 `hideDisabledNodeTitles: general.hideDisabledNodeTitles === true`，缺键按 `false`。
- 走现有 `updateGeneralSettings`，自动持久化到 settings.json。
- 工具条按钮沿用吸附/地图的样式：激活时 `type="primary"`、`aria-pressed`；tooltip 文案随状态切换。
- 图标用 `IconTypographyOff`（Tabler 已安装）。

### 1.3 Esc 退出确认框闪现

现象链路：

```
window keydown 捕获（updateCanvasKeys）
  → handleCanvasEscape：无选区/浮层 → preventDefault + requestExitProject()
  → 同一个 keydown 继续冒泡到 document
  → ElDialog 的 Escape 监听（useEscapeKeydown，document keydown）命中
  → 刚打开的确认框立即 handleClose()
```

修复：在 `handleCanvasEscape` 调用 `requestExitProject()` 之前 `event.stopPropagation()`，把这次 Esc 截断在 window 捕获阶段：

- 第一次 Esc：只用于打开确认框，document 上的 ElDialog 监听收不到，框保持打开。
- 第二次 Esc：目标在 `.el-overlay` 内或 `hasVisibleOverlay()` 为真，`handleCanvasEscape` 提前 return（不再 stopPropagation），事件继续到 document，由 ElDialog 正常关闭。
- 有选区时第一次 Esc 走清选区分支，本来就不会调用 requestExitProject，也不 stopPropagation，交互不变。
- 其他浮层/输入框/Agent 面板的 Esc 在 `handleCanvasEscape` 更早的分支直接 return，不受影响。

## 2. 代码改动清单

| 文件 | 改动 |
| --- | --- |
| `apps/web/src/stores/settings.ts` | `generalSettings` 增加 `hideDisabledNodeTitles`（默认 false） |
| `apps/web/src/pages/workspace/panels/canvas/components/canvasControls.vue` | 新增工具条按钮与切换函数 |
| `apps/web/src/pages/workspace/panels/canvas/index.vue` | `.canvas` 绑定 class；`:deep` 隐藏标签与徽标；Esc 增加 `stopPropagation` |
| `packages/nodeScaffold/src/nodeSkeleton.vue` | `.titleBar` 增加禁用时的 title 提示 |

不改：节点包各自的标题渲染、禁用遮罩、分组/选中/拖拽逻辑、ElDialog 组件。

## 3. UI / 交互

- 工具条顺序：地图、网格吸附、**隐藏禁用节点标题**、连线、提示音、适应视图、缩放。
- 按钮未激活（默认）：显示禁用节点名称与「已禁用」徽标，与现状一致。
- 按钮激活：名称与徽标消失，标题栏留图标 + 删除按钮；禁用遮罩和端口不变。
- 悬停禁用节点标题栏：系统 tooltip 显示「名称（节点已禁用）」。

## 4. 测试计划

按 `AGENTS.md` 测试边界，不新增测试文件：

| 层级 | 内容 |
| --- | --- |
| 类型检查 | `apps/web`、`packages/nodeScaffold` |
| 构建 | 根 build（含 11 个节点 UMD）+ 桌面入口打包 |
| 静态核对 | class/选择器命中、settings 兼容、Esc 传播顺序、节点 UMD 含新 title |
| 手动 | 重启后：开关切换、正常/禁用节点对比、悬停名称、刷新/切项目保持；Esc 打开/再次关闭、有选区两段式、Agent 面板与输入框 Esc |

## 5. 评审意见

| 评审人 | 结论 | 意见 |
| --- | --- | --- |
| 用户（Grill 问答） | 通过 | 见需求矩阵第 6 节。 |
| 子 Agent 代码审查 | 复核通过 | 初审 1 条 P1（运行期节点包，实测已同步）+ 3 条 P2（按钮左移、无障碍、aria-label）已整改；第二轮复核以 md5/时间戳/标记独立核验通过，Esc 修复实测成立。见 `3_test_results/2026-11-01-10-30-disabled-node-title-and-esc-dialog.md`。 |
