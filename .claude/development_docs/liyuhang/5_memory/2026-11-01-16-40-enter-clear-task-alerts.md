# 记忆：空画布按 Enter 清除未读提醒

- 时间：2026-11-01 16:40
- 类型：功能新增

## STAR

**Situation（背景）**
节点完成/失败会在画布顶部弹出未读横幅（`taskAlertsStore.unread`，跨画布汇总），右上角有「全部忽略」按钮。用户希望不回鼠标找按钮，在画布空白处按 Enter 直接清掉这批提醒。画布当前没有绑定 Enter；输入框、节点搜索框、Agent 端口菜单各自使用 Enter。

**Task（任务）**
新增画布快捷键「清除未读提醒」：默认 Enter、可改键、可设 None 关闭；只在画布聚焦且没有选中节点/连线/文字时生效；有未读才消费按键；清除范围与「全部忽略」一致（跨画布全部未读）；不影响 Agent 提问横幅、系统通知、toast。

**Action（行动）**
- `canvasShortcuts.ts`：`defaultCanvasShortcuts` 新增 `clearAlerts: "Enter"`；`canvasShortcutFields` 新增 `{ id: "clearAlerts", label: "清除未读提醒", allowNone: true }`，设置页数据驱动自动出现；新增 `shortcutConflicts`（普通按键的 None 只表示关闭不冲突，按住类手势之间都为 None 仍冲突）。
- `canvas/index.vue`：`updateCanvasKeys` 动作列表加入 `clearAlerts`；在通用 `preventDefault` 之前新增分支——焦点必须是 body/documentElement、无选中节点/连线/画布内选字、未读非空才 `preventDefault` 并（忽略 repeat）调用 `taskAlertsStore.clear()`。
- 复用现有守卫：`active/settingsVisible`、`editing`（输入框/按钮/可编辑区）、`isComposing`、`defaultPrevented`、`inCanvas`、Agent 面板白名单。
- `canvasShortcuts.vue` 与 `stores/settings.ts` 的冲突校验改用 `shortcutConflicts`，否则「无需按键」会与默认同为 `None` 的「框选节点」误报冲突。
- `canvasShortcuts.test.ts` 补 7 组用例（默认键、None 放行、Enter 匹配、小键盘不误命中、None 关闭不冲突、按住类 None 冲突、混合绑定比较）。

**Result（结果）**
快捷键测试 9 pass / 20 expect（与轴锁一起 24 pass / 46 expect）；web 类型检查仅既有 `@/agentRuntime` 报错；web 已构建并 rsync 到安装目录（`index.html` `64ccbada…`、入口 `index-Bde6u6rN.js` `648c40af…`、画布分块 `workspace-LhVoHfGE.js` `0d479f7d…`、设置分块 `settings-9slxBao-.js` `d852e401…`），未重启应用。

初评 P1（None 保存不了）与 P2（分组名 span 的 Enter 会顺带清提醒）均已修复并补测试。

## 关键经验

1. 画布快捷键表是数据驱动的：新增动作只需加默认键与 `canvasShortcutFields` 一项，设置页与冲突校验自动生效；老配置缺键会回落默认值。
2. 「没有未读就不拦截 Enter」要求分支必须放在通用 `event.preventDefault()` 之前，否则每按一次 Enter 都会被吃掉。
3. `editing` 守卫已经覆盖 input/textarea/button/contenteditable，节点搜索框与 Agent 端口菜单的 Enter 不会误触；不需要为每个菜单单独判断。
4. 清除走 `taskAlertsStore.clear()`，与横幅「全部忽略」同一条路径，避免两套清除口径。
