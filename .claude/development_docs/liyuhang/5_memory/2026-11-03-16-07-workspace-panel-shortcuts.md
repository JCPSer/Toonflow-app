# 记忆：项目/画布下拉与素材库面板快捷键（Q/W/E）

- 时间：2026-11-03 16:07
- 类型：功能增强（web 端快捷键）

## STAR

**Situation（背景）**
项目下拉、画布下拉、素材库面板只能鼠标点；逐帧核对与切画布高频操作时来回移指针成本高。用户希望像工具键 V/H 一样用单键唤起，初拟 Q/W/E。

**Task（任务）**
在现有 `canvasShortcuts` 体系上加三个可配置单键，同时不误触输入框/弹窗，不抢系统组合键。

**Action（行动）**
- `canvasShortcuts.ts`：默认值加 `projectPicker: KeyQ`、`canvasPicker: KeyW`、`assetLibrary: KeyE`，字段表加三项；冲突检测、录制、恢复默认全部复用。
- `canvasMenu.vue`：新增 `toggleProjectPicker` / `toggleCanvasPicker`，互斥显示；项目加载中/切换中不开；**不抢焦点**（评审 P0：抢进搜索框后按键变成输入字符，「再按关闭」失效）。
- `canvas/index.vue`：动作白名单加两项并派发到 `canvasMenuRef`；这两个键只让位给文本类控件（按钮上的焦点照常可用），模态遮罩 `.el-overlay` 打开时不生效、下拉浮层不算。
- `workspace/index.vue`：素材库挂在**工作区级** keydown（文档视图也能用），复用 `openAssetLibrary()` 的焦点交接；门禁与画布一致，弹窗/编辑控件里不触发。
- 测试：`canvasShortcuts.test.ts` 加 2 个用例（默认值/可改键、与现有默认键不冲突）；web 全量 45 通过；类型检查只剩既有 `@/agentRuntime` 报错。

**Result（结果）**
web 已构建并同步到 `/Applications/toonflow-exec.app/.../views/mainview/`，**未重启应用**，需重启后人工验收（见测试文档第 3 节）。

## 追加（19:16）：⌘, 打开设置

- 新增 `apps/web/src/components/settings/useSettingsShortcut.ts`：`primaryModifier + Comma`，首页与工作区各自挂一次，开关式。
- 门禁：别家 `.el-overlay` 占着时不抢；设置自己开着且出现第二个浮层（内部确认框）时让给确认框。
- 写死不可改（macOS 惯例，避免改掉后找不到设置入口）；`primaryModifier` 从 `canvasShortcuts` 导出复用。

## 关键经验

1. 「打开后自动聚焦搜索框」和「再按同键关闭」不可兼得：焦点一旦进输入框，同键就是打字。要开关就**别抢焦点**，要搜索就让用户点一下。
2. 裸字母键的误触防护要按「文本类控件」而不是「所有控件」划线：按钮上的焦点很常见（刚点过触发按钮），一刀切会让快捷键时灵时不灵。
3. 模态与浮层要分开判断：`.el-overlay` 挡快捷键，`.el-popper` 不能挡——否则下拉打开后就再也按不回去了。
4. 普通动作的「关闭」语义是**清空绑定**，不是 `None`（`None` 属于按住类手势的「无需按键」）。
