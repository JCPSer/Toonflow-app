# 需求方案：项目/画布下拉与素材库面板快捷键

- 时间：2026-11-03 16:07
- 对应需求：`2026-11-03-16-07-workspace-panel-shortcuts.md`
- 用户选型：Q/W 仅画布、E 全工作区；**开关优先、不抢焦点**（评审指出抢焦点后无法再按同键收起）；进设置页可改键

## 1. 目标

三个入口各有一个可配置单键：按一次打开（焦点到位），再按一次关闭；不与输入、弹窗、系统组合键抢事件。

## 2. 设计

### 2.1 快捷键定义（`apps/web/src/lib/canvasShortcuts.ts`）

```
defaultCanvasShortcuts += {
  projectPicker: "KeyQ",   // 项目下拉
  canvasPicker:  "KeyW",   // 画布下拉
  assetLibrary:  "KeyE",   // 素材库面板
}
canvasShortcutFields += 同名三项（label：项目下拉 / 画布下拉 / 素材库面板）
```

- 三个键都是普通动作（非按住类、非鼠标手势），`normalizeShortcut` / `isShortcutAllowed` 现有规则直接放行。
- 冲突检测、录制、恢复默认、按键标签全部复用现有实现，设置页只多三行。
- 默认值不与现有默认键冲突：现有字母键只有 `KeyV`（移动）与 `KeyH`（抓手），其余均带修饰键。

### 2.2 项目/画布下拉（`canvasMenu.vue`）

```
toggleProjectPicker():
    已开 → 关闭
    未开 → 先关画布下拉，再开项目下拉

toggleCanvasPicker(): 对称

不开新焦点：打开后焦点仍在画布，才能再按同键收起或互斥切换
    （若把焦点抢进搜索框，按键就变成输入字符，「再按关闭」必然失效）
```

- 打开时若另一个下拉开着，先关另一个。
- 项目加载中（`projectLoadingVisible`）或正在切换项目时不开。
- 沿用按钮的 disabled 条件：没有项目/正在切换时项目下拉不可开；没有画布目录时画布下拉不可开（此时按键静默无效）。
- `defineExpose` 增加 `toggleProjectPicker` / `toggleCanvasPicker`。

### 2.3 画布侧派发（`canvas/index.vue`）

- 动作白名单增加 `projectPicker`、`canvasPicker`，命中后调用 `canvasMenuRef` 的对应方法。
- 复用现有门禁：`inCanvas`（焦点在画布内或 body）、`settingsVisible`、`event.repeat`、`defaultPrevented`、`isComposing`、带修饰键的严格匹配。
- 这两个键只让位给**文本类**控件（input/textarea/select/contenteditable/role=textbox/slider），按钮上的焦点照常可用（点完触发按钮马上按 Q 也能开）；模态遮罩（`.el-overlay`）打开时不生效，下拉浮层不算。

### 2.4 素材库（`workspace/index.vue`）

```
window keydown（挂载时注册、卸载时移除）:
    shortcutMatches(event, canvasShortcuts.assetLibrary) 否 → 忽略
    defaultPrevented / isComposing / 设置页打开 / 项目加载中 → 忽略
    焦点在 input/textarea/select/button/contenteditable/role=textbox/role=slider/role=dialog 内 → 忽略
    preventDefault；event.repeat 时只吞键不动作
    已开 → visible = false（走 store，现有 closing 逻辑与 sessionState 持久化照旧）
    未开 → 复用 openAssetLibrary()（打开 + 焦点交给面板内容）
```

- 放在工作区而不是画布：素材库在文档视图也可见可用；`canvas/index.vue` 的处理器只在 `active` 时工作，文档视图拿不到。
- 画布视图里两个监听器同时存在，但 E 只出现在工作区监听器里，互不重复。

### 2.5 UI 变化

- 设置 → 通用 → 「画布快捷键」列表末尾新增三行：项目下拉 / 画布下拉 / 素材库面板，默认键帽显示 Q / W / E。
- 不新增按钮、不改布局；画布顶部两个下拉的触发按钮保持原样（快捷键只是另一入口）。

### 2.6 边界

1. 焦点在下拉搜索框内按 Q/W/E 是输入字符，不触发（`editing` 门禁）。
2. 下拉打开时按另一个键：按 R1/R2 的互斥规则切换；按 E 打开素材库时下拉保持原状（素材库是浮层，不抢焦点到画布）。
3. 文档视图按 Q/W 无效（下拉不在该视图）。
4. 用户把三个键都设成同一个：现有冲突检测会提示，行为按派发顺序取第一个命中（与现有重复绑定一致）。

### 2.7 设置面板 ⌘,（追加）

```
useSettingsShortcut(isOpen, setOpen)   // 新增组合式函数
    window keydown:
        shortcutMatches(event, `${primaryModifier}+Comma`) 否 → 忽略
        defaultPrevented / isComposing / repeat → 忽略
        再看当前可见 .el-overlay 数量：
            设置未开且有浮层 → 不抢（别家弹窗占着）
            设置已开且有 >1 个浮层 → 不抢（设置内的确认框优先）
        preventDefault；setOpen(!isOpen)
```

- 首页与工作区各自持有 `settingsVisible`，两处都挂这个组合式函数；`primaryModifier` 从 `canvasShortcuts` 导出复用（Mac=Meta，其余=Ctrl）。
- 写死不可改：不进入 `canvasShortcutFields`，设置页列表不变。

## 3. 影响面

| 文件 | 改动 |
| --- | --- |
| `apps/web/src/lib/canvasShortcuts.ts` | 默认值 + 字段表各 3 项 |
| `apps/web/src/pages/workspace/panels/canvas/components/canvasMenu.vue` | 两个 toggle、两个输入框 ref、watch 聚焦、expose |
| `apps/web/src/pages/workspace/panels/canvas/index.vue` | 动作白名单 + 两行派发 |
| `apps/web/src/pages/workspace/index.vue` | 工作区级 keydown + 素材库开关 + 设置快捷键 |
| `apps/web/src/pages/home/index.vue` | 设置快捷键 |
| `apps/web/src/components/settings/useSettingsShortcut.ts`（新增） | ⌘, 组合式函数 |

不需要改节点包与服务端；web 构建后同步 `build/web` 到应用 `views/mainview`。

## 4. 验证

1. 单测：`canvasShortcuts.test.ts` 增加默认值与 normalize 用例（新增键不破坏现有断言）。
2. `vue-tsc --noEmit`（web 包）通过。
3. web 构建并同步；应用内人工验收五条验收标准（需重启或刷新 web 资源）。

## 5. 评审意见

（待用户填写）
