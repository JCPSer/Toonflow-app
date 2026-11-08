# 需求方案：空画布按 Enter 清除未读提醒

- 时间：2026-11-01 16:40
- 对应需求：`1_requirements_matrix/2026-11-01-16-40-enter-clear-task-alerts.md`
- 状态：待评审

## 1. 方案总览

把「清除未读提醒」加成画布快捷键表里的一项（默认 `Enter`），复用画布现有的键盘守卫 `updateCanvasKeys`：

```
按键 → 命中 clearAlerts 快捷键
     → 画布聚焦（inCanvas）且未在输入框/按钮/可编辑区
     → 没有选中节点/连线、画布内没有选文字
     → 有未读提醒？有：preventDefault + taskAlertsStore.clear()
                     没有：什么都不做，不拦截
```

不新增 UI、不改横幅按钮、不碰 Agent 提问与系统通知。

## 2. 涉及文件

| 文件 | 变更 |
| --- | --- |
| `apps/web/src/lib/canvasShortcuts.ts` | `defaultCanvasShortcuts` 新增 `clearAlerts: "Enter"`；`canvasShortcutFields` 新增 `{ id: "clearAlerts", label: "清除未读提醒", allowNone: true }`；新增 `shortcutConflicts`（`None` 哨兵不参与冲突比较） |
| `apps/web/src/pages/workspace/panels/canvas/index.vue` | `updateCanvasKeys` 的动作列表加入 `clearAlerts`，在通用 `preventDefault` 之前处理：焦点在画布空白处 + 空选 + 有未读才清除 |
| `apps/web/src/components/settings/panels/general/canvasShortcuts.vue` | 冲突校验改用 `shortcutConflicts`，让「无需按键」可以正常保存（否则会与默认同样为 None 的「框选节点」误报冲突） |
| `apps/web/src/stores/settings.ts` | 配置合并的冲突回退同样改用 `shortcutConflicts`，`None` 不再阻挡其它字段的默认值 |
| `apps/web/src/lib/canvasShortcuts.test.ts` | 补充新动作的默认键、规范化、允许 None、Enter 匹配、`None` 冲突哨兵用例 |

## 3. 详细设计

### 3.1 快捷键定义

```
defaultCanvasShortcuts.clearAlerts = "Enter"
canvasShortcutFields += { id: "clearAlerts", label: "清除未读提醒", allowNone: true }
```

- `shortcutMatches` 按 `event.code` 匹配，`Enter` 已是合法的按键代号（`keyLabels` 已有）。
- `allowNone: true` 允许用户设为「None」关闭；不改 `hold`（不是按住类手势）。
- 设置页由 `canvasShortcutFields` 数据驱动，新增项自动出现；但原冲突校验把字面量 `None` 当按键比较，而「框选节点」默认也是 `None`，会把「无需按键」误判为冲突。本次抽 `shortcutConflicts`：普通按键动作的 `None` 只表示「关闭」，不参与冲突；两个按住类手势（框选/平移）都为 `None` 仍视为抢同一鼠标手势、保留冲突。设置页保存与配置合并共用。
- 配置合并：`generalSettings` 读取时对缺失的新键回落到默认值；如果用户已把同 gesture（普通按键类）的其它动作绑成 Enter，新默认值会因冲突回退为空（不生效），不会出现两个动作抢同一个键。

### 3.2 触发与守卫

`updateCanvasKeys` 已有守卫（直接复用，不重复实现）：

| 守卫 | 来源 | 作用 |
| --- | --- | --- |
| 非激活画布 / 设置面板 | 函数开头 `props.active`、`props.settingsVisible` | 不处理 |
| 输入框、按钮、可编辑区、滑杆 | `editing` | Enter 不触发（覆盖节点输入框、节点搜索、Agent 端口菜单按钮） |
| 焦点在节点内可聚焦元素 | `event.target === document.body / documentElement` | 分组名 `span[tabindex=0]` 等自有 Enter 行为（重命名）不触发清提醒 |
| 输入法组合 | `event.isComposing` | 不触发 |
| 已被其它处理器消费 | `event.defaultPrevented` | 不触发 |
| 焦点不在画布 | `inCanvas`（body / 画布子树，排除 `#agentPanel`、对话框、面板打开时的 body） | 不触发 |
| Agent 面板内 | `inAgentNodePanel` 白名单只放行复制/剪切/粘贴/删除 | 不触发 |

新增判定（按顺序）：

```
1. 焦点目标不是 body/documentElement → 不处理
2. 有选中节点 或 有选中连线 或 画布内有选中的文字 → 不处理
3. taskAlertsStore.unread 为空 → 不处理（不 preventDefault）
4. event.preventDefault()
5. event.repeat 为 true → 忽略（按住 Enter 的重复事件不重复清）
6. taskAlertsStore.clear()
```

说明：

- 放在通用 `event.preventDefault()` 与 `canvasId/project` 检查之前，保证「没有未读就不消费事件」。
- `hasCanvasAreaSelection()` 复用现有实现，只把锚点在 `.canvas / .agentNodePanel` 的选区算作「在画布里选文字」。
- 清除调用现有 `clear()`，与横幅「全部忽略」`@clear` 完全同一条路径，跨画布全部未读一起清空。
- 节点搜索框（input）、Agent 端口菜单（焦点在菜单按钮）都会命中 `editing` 守卫；不需要额外判断。

### 3.3 与现有行为的边界

- 有节点/连线选中时按 Enter：不清除（用户明确要求空选状态）。
- 横幅「全部忽略」按钮保持原样；按钮聚焦时 Enter 触发按钮自身，不进入画布处理。
- Agent 提问横幅不清（它是「等你回答」的状态，不是通知）。
- 不新增 toast/音效/光标反馈，横幅消失即反馈。
- 小键盘 Enter（`NumpadEnter`）默认不命中（快捷键按 `event.code` 匹配）；用户可在设置里改成 `Enter / NumpadEnter`。
- 极端情况下浮层打开但焦点被丢回 body（点击浮层非聚焦空白处）仍按画布空选处理；概率低，本次不额外拦截。
- 设置入口路径：设置 → 常规配置 → 画布快捷键。

## 4. 测试方案

1. 单测 `canvasShortcuts.test.ts`：
   - 新动作默认值为 `Enter`；
   - `normalizeShortcut("Enter")` 合法；
   - `isShortcutAllowed` 允许「None」关闭；
   - `shortcutMatches` 对 Enter 键盘事件命中。
2. 类型检查：`apps/web` 的 `vue-tsc`（允许既有 `@/agentRuntime` 报错）。
3. 构建 web 产物并同步到安装目录，核对 md5；不重启应用。
4. 静态核对：动作列表、守卫顺序、`clear()` 路径、设置页数据驱动渲染、旧配置合并回退。
5. 人工验收（重启后）：按需求矩阵第 6 节逐条操作，重点验证输入框/节点搜索/端口菜单里按 Enter 不清除、无未读时 Enter 不被拦截、改键与 None 生效。

## 5. 风险与对策

| 风险 | 对策 |
| --- | --- |
| Enter 误触清掉没看的提醒 | 只在画布空选 + 有未读时生效；可改键、可设 None 关闭 |
| 与输入框/菜单的 Enter 冲突 | 复用 `editing`、`inCanvas`、`inAgentNodePanel` 三层守卫 |
| 老配置没有新键 | 合并逻辑缺键回落默认，并对已保存键位做冲突回退 |
| 与其它动作改绑到同一个键 | 设置页保存时冲突校验；读取配置时冲突回退为空 |
| 按住 Enter 连发 | `event.repeat` 忽略，清一次即可 |

## 6. 评审意见

子 Agent 初评（2026-11-01 17:15）：

| 级别 | 意见 | 处理 |
| --- | --- | --- |
| P1 | 设置页冲突校验把 `None` 当按键，「框选节点」默认也是 `None`，新快捷键无法设为「None」关闭 | 已修：新增 `shortcutConflicts`（普通按键的 None 不冲突，按住类手势之间仍冲突）；设置页与配置合并共用；补单测 |
| P2 | 分组名 `span[tabindex=0]` 的 Enter（重命名）会被窗口捕获阶段顺带清提醒 | 已修：clearAlerts 只接受焦点在 body/documentElement |
| P3 | 小键盘 Enter 默认不命中 | 保留并写入边界 |
| P3 | 浮层打开、焦点回 body 时仍会清除 | 保留并写入边界 |
| P3 | 设置入口路径文档写错 | 已改为「设置 → 常规配置 → 画布快捷键」 |

## 7. 版本记录

| 版本 | 时间 | 说明 |
| --- | --- | --- |
| v1 | 2026-11-01 16:40 | 初稿 |
