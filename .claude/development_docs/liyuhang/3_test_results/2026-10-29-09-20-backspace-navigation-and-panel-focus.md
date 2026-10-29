# 测试结果：Backspace 误退项目 + Agent 面板抢焦点

- 记录时间：2026-10-29 09:20
- 关联：`4_bugs_fix/bug_analysis-2026-10-29-09-10-backspace-navigation-and-panel-focus.md`、`bug_solution-2026-10-29-09-10-backspace-navigation-and-panel-focus.md`

## 一、本轮改动

| 位置 | 改动 |
| --- | --- |
| `apps/web/src/App.vue` | 新增 window `keydown`（冒泡）守护：Backspace 在非可编辑区域、且无人消费（`defaultPrevented`）时 `preventDefault()`，阻断 WKWebView 原生「后退」 |
| `apps/web/src/components/agent/conversation/messageInput.vue` | 新增 `autoFocus` prop；`x-sender` 构造参数改为 `autoFocus !== false && active` |
| `apps/web/src/components/agent/conversation.vue` | 新增 `autoFocus` prop 并透传（默认 true） |
| `apps/web/src/pages/workspace/panels/canvas/components/agentNodePanel.vue` | `:auto-focus="false"` |
| `apps/web/src/pages/workspace/panels/canvas/index.vue` | `updateCanvasKeys` 增加面板语境判定：面板打开且焦点在面板内/body 时只放行 `delete` 动作；有文本选中时不删 |

## 二、静态验证

| 项 | 结果 |
| --- | --- |
| `apps/web typecheck` | 仅既有 `server/.../singleAgent/types.ts(2,33)`，无新增 |
| `deploy-local.sh --build` | 成功，桌面入口与前端已安装 |

产物核对：

| 改动 | 产物证据 |
| --- | --- |
| 全局 Backspace 守护 | `index-CFwfhW9n.js`：`function n(e){if(e.key!==\`Backspace\`\|\|e.defaultPrevented\|\|e.isComposing)return; …t.closest(…` |
| 面板删除放行 | `workspace-C0lX7nhE.js`：`.value?.isOpen?.(),s=o&&t instanceof Element&&!!t.closest(\`.agentNodePanel\`),c=o&&(t===document.body\|\|t===document.documentElement)` |
| autoFocus 透传 | `workspace-C0lX7nhE.js`：`autoFocus:r.autoFocus!==!1&&r.active` |

## 三、行为依据

- 画布快捷键在 window **捕获**阶段注册并检查 `event.defaultPrevented`；守护者放**冒泡**阶段，因此不会被抢先 `preventDefault` 而废掉画布删除。
- 素材库（`panels/assetLibrary/index.vue`）在自身元素上 `preventDefault + stopPropagation`；它拦住的键到不了 window，未拦住的才交给守护者，双击行为不变。
- `x-sender` 的默认 `autoFocus: true` 只在构造与 `chat.options.autoFocus` 为真时 `focusLast()`，传 `false` 后不会在 reset/setText 路径重新抢焦点。
- 删除走既有 `canvasHistory.batch(menu.deleteSelection(nodes))`；节点消失后 `agentNodePanel` 的 `watch(nodeIdsKey)` 会关闭面板。

## 四、待手测清单

1. 打开 Agent 节点面板：光标不再自动进输入框；点输入框才进入输入状态。
2. 打开面板后直接按 Backspace：删掉该 Agent 节点，面板自动关闭，⌘Z 可撤销恢复。
3. 焦点不在任何输入框时（如点画布空白、点面板标题栏）按 Backspace：**不再退出项目**。
4. 面板里划选一段消息后按 Backspace：不删节点。
5. 输入框内按 Backspace：正常删字，不删节点、不退出。
6. 主对话面板（右侧浮动 Agent）：打开仍自动聚焦输入框（行为未变）。
7. 素材库面板：Backspace 仍能"返回上一级/退出回收站"。
8. 画布：选中节点按 Backspace 仍删除；分组（G）、添加节点等快捷键不受影响。
9. 删除正在运行的 Agent 节点：节点与面板正常消失，会话清理（409 重试）不报错。

## 五、未覆盖

- 组件用 `@keydown.stop` 吞事件的浮层（如右键"添加节点"面板）里按 Backspace 仍可能触发原生后退，未单独处理。
- 移动端/触屏无 Backspace，不涉及。
