# 测试结果：空画布按 Enter 清除未读提醒

- 时间：2026-11-01 17:00
- 对应方案：`2_requirements_solutions/2026-11-01-16-40-enter-clear-task-alerts.md`
- 结论：单测、类型检查、构建部署与静态链路核对通过；**未重启应用**，需用户重启后人工验收

## 1. 单元测试

命令：`bun test apps/web/src/lib/canvasShortcuts.test.ts`

```
9 pass / 0 fail / 20 expect() calls
```

新增用例：

- 默认值为 `Enter`，设置项允许设为 `None` 关闭，`normalizeShortcut("Enter")` 合法；
- `isShortcutAllowed` 对 `Enter` 与 `None` 都放行；
- `shortcutMatches` 命中主键盘 Enter，小键盘 `NumpadEnter` 默认不命中（可在设置里自行加绑）；
- `shortcutConflicts`：普通按键动作设为 `None` 只表示关闭、不参与冲突；两个按住类手势都为 `None`（框选/平移抢同一鼠标手势）仍算冲突；同一真实按键仍算冲突，混合绑定只比较真实按键。

连同轴锁测试一起跑：`bun test apps/web/src/lib/canvasShortcuts.test.ts apps/web/src/pages/workspace/panels/canvas/axisLock.test.ts` → `24 pass / 46 expect`。

## 2. 类型检查

| 包 | 命令 | 结果 |
| --- | --- | --- |
| `apps/web` | `bun run --filter '@toonflow/web' typecheck` | 仅既有报错 `apps/server/src/modules/agentAccess/singleAgent/types.ts(2,33) TS2307 Cannot find module '@/agentRuntime'` |

## 3. 构建与部署核对

| 产物 | md5（构建 = 安装目录） | 说明 |
| --- | --- | --- |
| `index.html` | `64ccbada4e7f52e00d38a6fd1e76d55f` | 引用 `assets/index-Bde6u6rN.js` |
| `assets/index-Bde6u6rN.js` | `648c40af74c6a489cee5ed6d8323f260` | 入口 |
| `assets/workspace-LhVoHfGE.js` | `0d479f7d57e9c90d730795804dc99ae4` | 画布快捷键处理 |
| `assets/settings-9slxBao-.js` | `d852e40157e35a27de989fa596d752bb` | 设置页快捷键表与冲突校验 |

部署方式同前：`rsync -a build/web/ <安装目录>/`（不带 `--delete`）。安装目录：`/Applications/toonflow-exec.app/Contents/Resources/app/views/mainview/`。**未重启应用。**

## 4. 静态链路核对

| 断言 | 证据 |
| --- | --- |
| 新动作进入统一键盘处理 | `updateCanvasKeys` 的动作列表加入 `clearAlerts`，`shortcutMatches(event, shortcuts.clearAlerts)` 命中 Enter |
| 有未读才消费按键 | `clearAlerts` 分支在通用 `event.preventDefault()` 之前判断 `taskAlertsStore.unread.length`，为空直接 return |
| 只认画布空白处 | 分支先判断 `event.target` 必须是 `body/documentElement`；节点内 `span[tabindex=0]`（分组名重命名）等自有 Enter 行为不会顺带清提醒 |
| 空选判定 | 有选中节点、选中连线或 `.canvas` 内有选字（`hasCanvasAreaSelection`）时 return |
| 「无需按键」可保存 | `shortcutConflicts`：普通按键动作的 `None` 视为「关闭」不参与比较（不再与默认同为 `None` 的「框选节点」误报冲突）；两个按住类手势都为 `None` 仍判冲突，保留原有的框选/平移互斥保护 |
| 输入框/菜单 Enter 不冲突 | `updateCanvasKeys` 的 `editing` 守卫覆盖 input/textarea/button/contenteditable/role=slider；节点搜索框是 input，Agent 端口菜单打开后焦点在菜单按钮上 |
| Agent 面板/设置页/对话框不触发 | `inCanvas`、`inAgentNodePanel` 白名单（只放行复制/剪切/粘贴/删除）与 `props.settingsVisible` 提前 return |
| 与横幅按钮同路径 | 分支调用 `taskAlertsStore.clear()`，与横幅 `@clear="taskAlertsStore.clear()"` 完全一致，跨画布全部未读 |
| 按住 Enter 连发 | `event.repeat` 时只拦不重复清 |
| 设置页无需改 UI | `canvasShortcutFields` 数据驱动渲染；`allowNone: true` 让 keyInput 支持「None」 |
| 老配置兼容 | `generalSettings` 读取时缺键回落 `defaultCanvasShortcuts`；同 gesture 已保存键位冲突时回退为空 |

## 5. 代码审查

实现前由子 Agent 对方案与代码落点做评审（含设置页冲突校验、画布键盘守卫、现有 Enter 监听），结果见下节。

## 5.1 实现复审整改

子 Agent 初评结论与整改：

| 级别 | 问题 | 处理 |
| --- | --- | --- |
| P1 | 设置页冲突校验把 `None` 当按键，「框选节点」默认也是 `None`，导致「清除未读提醒」设不成「无需按键」 | 已修：新增 `shortcutConflicts`，普通按键动作的 `None` 视为关闭不参与冲突，按住类手势之间仍保留冲突；设置页与 `generalSettings` 合并共用；补 3 条单测 |
| P2 | 分组名 `span[tabindex=0]` 的 Enter（重命名）会被窗口捕获阶段顺带清提醒 | 已修：clearAlerts 只接受焦点在 `body/documentElement` |
| P3 | 小键盘 Enter 默认不触发 | 保留，写入已知限制 |
| P3 | 浮层打开、焦点回 body 时仍会清除 | 概率低，保留并写入已知限制 |
| P3 | 设置入口路径文档写错 | 已改为「设置 → 常规配置 → 画布快捷键」 |

## 6. 已知限制

- 小键盘 Enter（`NumpadEnter`）默认不触发，需要在设置里把「清除未读提醒」改成 `Enter / NumpadEnter` 或单独绑定。
- Agent 节点面板打开且焦点落到 body 时，按画布快捷键的既有规则不认领（与删除/撤销等一致），Enter 不会清除。
- 浮层（素材库/popper）打开但焦点被丢回 body 的极端场景仍会清除；概率低，本次不额外拦截。
- 清除后不可恢复：提醒只存在内存里，没有历史记录。

## 7. 未覆盖项（需重启后人工确认）

按需求矩阵第 6 节验收标准逐条操作：

1. 有未读提醒时在画布空白处按 Enter，横幅消失且全部未读清空。
2. 选中节点/连线或在节点里选字时按 Enter，不清除。
3. 输入框、节点搜索、Agent 端口菜单、Agent 面板、设置页里按 Enter 不清除。
4. 没有未读时按 Enter，无变化且不被拦截。
5. 设置页可改键、可设 None；改键后新键生效，None 后 Enter 失效。
