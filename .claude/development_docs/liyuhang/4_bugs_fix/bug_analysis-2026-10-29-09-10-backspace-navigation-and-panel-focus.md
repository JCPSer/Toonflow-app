# Bug 分析：Backspace 误退项目 + Agent 面板抢焦点导致无法删除节点

- 记录时间：2026-10-29 09:10
- 来源：用户口述
  - 「agent 节点点击后，光标直接就是待输入状态，导致我想删除这个 agent 节点时会变得很困难」
  - 「点一下 agent 面板再点击 backspace 按键后，甚至有时会误触退出项目，如果我有在跑的节点，会直接丢失运行进度」
  - 「这个 backspace 退出项目的快捷键是哪里的？要删除」

## 一、Bug 背景

画布上的 Agent 节点被点击后会展开一个跟随节点的对话面板（`canvas/components/agentNodePanel.vue`）。该面板在 `open()` 里主动 `focus()` 面板根节点以接住键盘焦点；面板内的 `conversation → messageInput` 又把 `autoFocus` 直接绑成 `active`，`x-sender` 编辑器在构造时就 `focusLast()`。结果是点一下节点，光标直接进输入框。

同时，这个桌面壳是 Electrobun + WKWebView，WebView 自带「Backspace = 后退」的原生行为（与之前修过的鼠标侧键触发历史导航同源，见 `workspace/index.vue` 的 `preventSideButtonNavigation`）。

## 二、现象与复现

| 编号 | 现象 | 复现路径 |
| --- | --- | --- |
| B1 | 点开 Agent 节点后面板输入框立刻获得焦点，"待输入"状态 | 单击画布上的 Agent 节点 |
| B2 | 想删这个 Agent 节点，按 Backspace 只删了输入框里的字 / 或什么都不删 | B1 之后按 Backspace |
| B3 | 焦点不在输入框时按 Backspace 会退出当前项目，正在跑的节点进度直接丢失 | 点一下 Agent 面板（非输入区域，焦点落到面板或 body）后按 Backspace |
| B4 | 面板打开时，即使节点被选中也无法用键盘删除 | 面板开着，选中节点，按 Backspace：`updateCanvasKeys` 里 `panelOpenOnBody` 会把这个场景整体挡掉 |

## 三、根因

| 编号 | 根因 | 位置 |
| --- | --- | --- |
| B1 | `autoFocus: props.active` 直接透传给 `x-sender`，面板激活即聚焦编辑器 | `components/agent/conversation/messageInput.vue:540` |
| B3 | 不是应用里的快捷键，而是 WKWebView 原生「Backspace 后退」。应用只在鼠标侧键上做了拦截，键盘路径没管；焦点在非可编辑区域时，Backspace 的默认行为就是 history back | 应用侧无拦截点；`workspace/index.vue:158-166` 只处理 `button === 3/4` |
| B4 | `panelOpenOnBody` 为了"避免误删正在使用的节点"把面板打开时的 Delete/Backspace 整体拦掉，同时面板根节点拿走了焦点，`inCanvas` 判断也不成立 | `canvas/index.vue` 的 `updateCanvasKeys` |

## 四、优先级 / 难度 / 风险

| 项 | 评估 |
| --- | --- |
| 优先级 | P0（B3 会丢运行进度；B1/B4 让日常删除节点不可用） |
| 难度 | 低：三处小改，均无数据结构变更 |
| 风险 | 中：Backspace 同时被画布删除、素材库返回上一级、各类输入框使用，拦截范围一旦过大就会互相打架；`autoFocus` 改动会影响主对话面板（必须默认保持原行为） |

## 五、不做什么

- 不改桌面壳层（原生 WKWebView 偏好属于私有 API，且改动需要重打包外壳；应用层拦截足够）。
- 不动主对话面板（`floatingAgent`）的自动聚焦行为。

## 六、评审意见

| 评审人 | 结论 | 意见 |
| --- | --- | --- |
| 用户（2026-10-29 09:15） | 通过 | 三项决策：全应用禁掉 Backspace 后退；Agent 节点面板不自动聚焦；面板开着时 Backspace 仍可删除选中节点。 |
| 代码评审子代理 | 待填 | 待填 |
