# Bug 方案：Backspace 误退项目 + Agent 面板抢焦点

- 记录时间：2026-10-29 09:12
- 关联分析：`bug_analysis-2026-10-29-09-10-backspace-navigation-and-panel-focus.md`

## 一、B3：全应用禁掉 Backspace 触发的原生历史后退

在 `App.vue`（路由根、比任何页面晚挂载）注册 **document 捕获阶段**监听：

```
onKeydown(event):
    if event.key ≠ "Backspace"            → return
    if event.defaultPrevented              → return     // 已有消费者（画布删除、素材库返回上一级…）先处理过
    if event.isComposing                   → return     // 输入法组合中
    if composedPath 里命中可编辑节点        → return     // isContentEditable / INPUT / TEXTAREA / SELECT / role=textbox
    event.preventDefault()
```

为什么是 document **捕获**而不是 window 捕获或 window 冒泡：

- 不能挂 window 捕获：画布快捷键同样注册在 window 捕获且检查 `event.defaultPrevented`，同阶段下先注册者先跑，守护者一旦抢先 `preventDefault()`，画布删除就废了。
- 不能挂 window 冒泡：任何祖先上的 `keydown.stop` 都能让事件到不了 window 冒泡。实测有 6 处这样的浮层（`.agentPortMenu`、`nodeMenuItems`、`selectionToolbar`、`canvasMenu` 的目录列表、`keyInput` 录制按钮等），其中最危险的是"添加节点"菜单——鼠标划过菜单项就会 `focus()` 按钮，此时按 Backspace 仍会退出项目。
- document 捕获在事件顺序上是 window 捕获**之后**（画布已跑完并置位 `defaultPrevented`）、目标阶段**之前**（所有 `stopPropagation` 都还没发生），两头都占。

可编辑判定用 `event.composedPath()` 而不是 `target.closest()`：`closest` 在 Shadow DOM 边界处断开，未来一旦引入 shadow 封装的编辑器，`target` 会被重定向成宿主元素，输入框里的 Backspace 会被误拦。

为何不改桌面壳：`_backspaceKeyNavigationEnabled` 属于 WKWebView 私有偏好，既需要重打包外壳，也无法覆盖网页内的场景。

## 二、B1：Agent 节点面板不再抢焦点

`autoFocus` 逐层加开关，默认保持原行为：

```
messageInput props:  + autoFocus?: boolean
x-sender 构造参数:    autoFocus: props.autoFocus !== false && props.active
conversation props:  + autoFocus?: boolean
conversation 模板:    <messageInput :autoFocus="autoFocus !== false" …>
agentNodePanel:       <conversation :auto-focus="false" …>
```

未传参时一律 `undefined → 视为 true`，主对话面板行为不变。

## 三、B4：面板开着也能用键盘删节点

`canvas/index.vue` 的 `updateCanvasKeys` 重构焦点语境判定：

```
panelOpen            = 面板存在且打开
inAgentNodePanel     = panelOpen 且 target 在 .agentNodePanel 内
panelOpenOnBody      = panelOpen 且 target 是 body/documentElement
inCanvas             = 原判定（面板在 body 焦点时仍视为不在画布，避免误触分组等快捷键）
panelDelete          = !editing && 没有选中文本 && (inAgentNodePanel || panelOpenOnBody)
...
action = 匹配到的画布快捷键
if (!inCanvas && !(panelDelete && action === "delete")) return    // 其余快捷键维持改动前的放行范围
```

要点：

- **只放行删除**。分组、添加节点、搜索等仍被 `inCanvas` 拦住，避免"在面板里读消息时手滑按到 G 就把选中节点建了组"。
- **有文本选中时不删**：用户在面板里划选了一段消息再按 Backspace，走浏览器默认（无副作用），不会突然删掉节点。
- **焦点在输入框时不删**：`editing` 判定包含 `contenteditable` / `textarea` 等，输入框里的 Backspace 仍然是删字。
- 删除链路不变：仍走 `canvasHistory.batch(menu.deleteSelection(nodes))`，可撤销；节点消失后 `agentNodePanel` 的 `watch(nodeIdsKey)` 会自动关闭面板；删除时的会话清理（`pendingAgentSessionCleanup`）逻辑不受影响。

## 四、验证计划

1. `apps/web` typecheck 无新增；`deploy-local.sh --build` 成功。
2. 产物核对：`autoFocus:r.autoFocus!==!1&&r.active`、`closest('.agentNodePanel')`、App 里的 Backspace 守护逻辑均在构建产物中。
3. 手测：见测试结果文档的待手测清单。

## 五、风险与未覆盖

- 组件用 `@keydown.stop` 自行吞掉事件时（如节点右键菜单 `nodeMenuItems`），事件到不了 window 冒泡，守护者不参与；这类浮层里按 Backspace 仍可能触发原生后退。当前这些浮层都带可编辑控件或只在极短时间存在，暂不额外处理。
- `target` 在 Shadow DOM 内部时 `closest` 不穿透，可编辑判定可能漏判；本应用未使用 Shadow DOM 封装输入控件。
- 原生后退被禁后，用户只能通过界面按钮返回首页（原本也没有文档化的"Backspace 返回"）。

## 六、评审意见

| 评审人 | 结论 | 意见 |
| --- | --- | --- |
| 用户（2026-10-29 09:15） | 通过 | 三项决策已确认。 |
| 代码评审子代理 | 待填 | 待填 |

## 七、复测后修正（2026-10-29 09:40，评审子代理提出）

1. **兜底监听从 window 冒泡改到 document 捕获**。原实现漏掉 6 处 `@keydown.stop` 的浮层，其中"添加节点"菜单（`nodeMenuItems.vue` 里鼠标悬停就 `focus()` 按钮）按 Backspace 仍会退出项目，属于可稳定复现的漏网。改到 document 捕获后：位置在 window 捕获（画布删除）之后、目标阶段（各处 stop）之前，两头都不漏。
2. **可编辑判定改用 `event.composedPath()`**。`target.closest()` 会在 Shadow DOM 边界断开，将来引入 shadow 封装的编辑器时会把输入框误判成不可编辑、把输入框里的 Backspace 拦掉。
3. **`x-sender.enable()` 仍会抢焦点**。`enable()` 内部无条件 `focus()`，而 `messageInput` 在 `locked` 由真变假（一轮跑完）时会调它，导致节点面板跑完一轮焦点又跳回输入框。处理：enable 之前先记 `senderElement.contains(document.activeElement)`，若原本不在输入框且 `autoFocus === false`，enable 之后把焦点 blur 回去；用户自己在打字时不动他。
4. **`getSelection()` 判据收敛**。原来只要全文档存在非空选区就不删节点，文档编辑器里遗留的选区会让删除静默失效。改为 `hasCanvasAreaSelection()`：选区非折叠且 anchor 位于 `.canvas` 或 `.agentNodePanel` 内才算"在选区"。
5. **`panelOpenOnBody` 排除其它浮层**。素材库等浮层打开时不再认领 body 焦点，避免在别处按 Backspace 把画布节点删掉。

未改（记录在案）：`onSession`/`onStatus` 对已删节点的保护、409 重试次数上限、iframe 内的 Backspace（父窗口收不到 keydown，只能靠壳层修）。
