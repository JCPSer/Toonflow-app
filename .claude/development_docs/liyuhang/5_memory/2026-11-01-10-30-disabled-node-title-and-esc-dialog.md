# 禁用节点隐藏标题开关 + Esc 退出确认框闪现修复

- 时间：2026-11-01 10:30
- 涉及文件：`apps/web/src/stores/settings.ts`、`apps/web/src/pages/workspace/panels/canvas/components/canvasControls.vue`、`apps/web/src/pages/workspace/panels/canvas/index.vue`、`packages/nodeScaffold/src/nodeSkeleton.vue`

## STAR

**Situation**
禁用节点仍显示名称和「已禁用」徽标，禁用节点多时干扰视图；画布里按 Esc 时，退出项目确认框闪一下就消失（ElDialog 的 Escape 监听在 document，同一个 keydown 把刚打开的框关掉）。

**Task**
1. 左下角画布工具条新增全局开关：开启后禁用节点只隐藏名称和「已禁用」徽标，保留图标/删除按钮，悬停仍能看到原名。
2. Esc 第一次只打开确认框并保持，确认框打开后再按 Esc 关闭。

**Action**
1. `generalSettings` 增加 `hideDisabledNodeTitles`（缺省 false）；canvasControls 工具条增加 `IconTypographyOff` 按钮，沿用 primary/aria-pressed 模式。
2. `.canvas` 绑定 `hideDisabledNodeTitles` class，scoped `:deep` 命中 `.nodeDisabled .titleBar .labelText/.disabledBadge`；用 clip（1px + clip-path + pointer-events:none）而不是 display:none，保留无障碍文本。
3. `nodeSkeleton` 的 `.titleBar` 增加禁用态 `title="${label}（节点已禁用）"`；`.nodeActions` 补 `margin-left:auto`，名称移出 flex 流后按钮仍贴右。
4. `handleCanvasEscape` 在 `requestExitProject()` 前 `event.stopPropagation()`；第二次 Esc 因目标在 `.el-overlay`/`hasVisibleOverlay()` 提前 return，事件继续到 document，ElDialog 正常关闭。

**Result**
- web / nodeScaffold typecheck 通过（web 仅既有 `@/agentRuntime` 报错）。
- 首次 `--build` 因 nodeSkeleton 纯 CSS 里误用 `//` 注释失败，改 `/* */` 后通过；11 个内置节点 UMD 重建并同步到 Resources 与运行期目录，三处 md5 一致。
- web 产物 `workspace-BkDDJ3tK.js` / `workspace-B2as2zOC.css` 与 Resources md5 一致；未重启应用。
- 子 Agent 审查：初审 1 P1（误判运行期未同步）+ 3 P2，整改后复核独立核验通过；第三方 5 个旧节点无 `.nodeDisabled`，属既有边界。

## 教训

- 在 keydown 里打开 ElDialog，同一次 keydown 会在微任务检查点后继续冒泡到 document 的 Escape 监听，把框关掉；在 window 捕获阶段 `stopPropagation` 是最小修复。
- scoped `:deep` 的祖先选择器可以命中远程 UMD 组件内部，不需要给每个节点包传开关；但节点包自身的 class（`.nodeDisabled`）必须存在。
- 视觉隐藏优先用标准 visually-hidden（clip）而不是 `display:none`，否则名称/状态一起从无障碍树消失。
- `visibility:hidden`/`display:none` 会让 flex 里的 `flex:1` 撑杆消失，右侧操作按钮要 `margin-left:auto` 才不左移。
- `<style scoped>` 纯 CSS 里不能写 `//` 注释，PostCSS 会直接报 Unknown word；nodeScaffold 的样式块是纯 CSS。
- 仓库 `data/nodes` 是 dev 目录，不是安装应用的运行期目录；验证已安装应用要看 `<APP_DIR>/toonflow-data/nodes` 或 Resources。

## 关联

- 需求/方案/测试：`1_requirements_matrix/2026-11-01-10-00-disabled-node-title-and-esc-dialog.md`、`2_requirements_solutions/2026-11-01-10-00-disabled-node-title-and-esc-dialog.md`、`3_test_results/2026-11-01-10-30-disabled-node-title-and-esc-dialog.md`。
- 前置：`5_memory/2026-10-30-20-12-node-disable.md`（节点禁用）、`5_memory/2026-10-29-09-20-backspace-navigation-and-panel-focus.md`（Esc/Backspace 拦截）。
