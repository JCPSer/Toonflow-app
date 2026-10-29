# 记忆：Backspace 误退项目、Agent 面板抢焦点、面板内删节点

## Situation

Electrobun + WKWebView 桌面端里，焦点不在可编辑区域时按 Backspace 会触发 WebView 自带的「后退」，直接把工作区退掉、正在跑的节点进度丢失（与之前修过的鼠标侧键历史导航同源）。同时，画布 Agent 节点面板一打开就把焦点塞进输入框（`x-sender` 的 `autoFocus: props.active`），用户想按 Backspace 删掉这个节点时只会删掉输入框里的字；而 `updateCanvasKeys` 里的 `panelOpenOnBody` 又把"面板打开时删除"整体拦掉了。

## Task

1) 全应用禁掉 Backspace 触发的原生历史后退；2) Agent 节点面板打开不再自动聚焦输入框；3) 面板打开且焦点在面板/body 时，Backspace 仍能删除选中节点。

## Action

- `App.vue`：window `keydown` **冒泡**阶段守护——Backspace 且 `!defaultPrevented`、非组合输入、target 不在 `input/textarea/select/[contenteditable]/[role=textbox]` 时 `preventDefault()`。
  **为什么是冒泡**：画布快捷键在 window **捕获**阶段且检查 `event.defaultPrevented`；守护者若也在捕获阶段抢先 preventDefault，画布删除会被废掉。冒泡阶段能准确读到"这一键已有人消费"。
- `autoFocus` 逐层开关：`messageInput` 新 prop → `autoFocus: props.autoFocus !== false && props.active`；`conversation` 透传；`agentNodePanel` 传 `false`。未传参一律当 true，主对话面板行为不变。
- `canvas/index.vue` `updateCanvasKeys`：新增 `inAgentNodePanel`（target 在 `.agentNodePanel` 内）与既有 `panelOpenOnBody`；`panelDelete = !editing && !getSelection() && (inAgentNodePanel || panelOpenOnBody)`；放行条件改为 `inCanvas || (panelDelete && action === "delete")`——**只放行删除**，分组/添加节点等仍被 `inCanvas` 拦住。

## Result

typecheck 无新增；`deploy-local.sh --build` 成功；产物含 `autoFocus:r.autoFocus!==!1&&r.active`、`closest('.agentNodePanel')`、App 的 Backspace 守护。

坑：Backspace 同时被画布删除、素材库"返回上一级"、各类输入框使用，拦截范围必须靠 `defaultPrevented + 可编辑判定` 收窄；`@keydown.stop` 的浮层（右键"添加节点"）会让事件到不了 window，是已知未覆盖点。
