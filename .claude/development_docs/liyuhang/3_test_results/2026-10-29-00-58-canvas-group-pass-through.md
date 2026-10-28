# 测试结果：分组穿透 / 组菜单 / 添加节点悬停展开

- 记录时间：2026-10-29 00:58
- 关联：`4_bugs_fix/bug_analysis-2026-10-29-00-54-canvas-group-pass-through.md`、`bug_solution-2026-10-29-00-54-canvas-group-pass-through.md`
- 附带：本轮同批还补了 Agent 节点面板的「压缩上下文」按钮

## 一、本轮改动

| 位置 | 改动 |
| --- | --- |
| `canvas/index.vue` | `.canvas` 增加 `@pointerdown.capture="onCanvasPointerDown"`（探测 + 原有选区逻辑）与 `@contextmenu.capture="forwardGroupContextMenu"`；新增 `edgeIdUnderGroup` 九点探测；`provide("deleteNodeSelection")` 转发画布删除链路 |
| `canvas/components/groupNode.vue` | 标题栏 `cursor: move` + 右键菜单（重命名分组 / 删除分组）；删除走 `deleteNodeSelection`（含子节点、可撤销） |
| `canvas/components/nodeMenu.vue` | 「添加节点」改为 `el-popover trigger="hover" placement="right-start"`，内容复用 `nodeMenuItems`；切换内联层或执行命令时收起浮层 |
| `canvas/components/agentNodePanel.vue` | 面板标题栏加「压缩上下文」按钮（转发 `conversation.compactContext()`，按 `compactState` 置灰） |

## 二、静态验证

| 项 | 结果 |
| --- | --- |
| `apps/web typecheck` | 仅既有 `singleAgent/types.ts(2,33)` 一条，无新增 |
| 首次构建 | 失败：`Duplicate attribute`（`@pointerdown.capture` 同一元素写了两次，i18n 插件的 Vue 解析器不接受）→ 合并为 `onCanvasPointerDown` 后通过 |
| `deploy-local.sh --build` | 成功，前端与入口已安装 |

## 三、产物核对

- `build/web/assets/workspace-BPkBM2fk.js` 含 `vue-flow__node-canvasGroup`（穿透探测用的选择器）与「添加节点」浮层逻辑；样式 `workspace-BCfJQVD9.css`。

## 四、待手测

1. 组内空白左键拖动：分组跟随移动；拖到线上再按下时应弹「断开连接」而不是拖组。
2. 组内点连线（含线旁边 6px 内）：弹出断开气泡，连线可取消。
3. 组内右键：出画布菜单（添加节点/撤销/重做/粘贴），不再是系统菜单。
4. 分组标题栏右键：重命名分组、删除分组；删除后子节点一并删除，撤销可恢复。
5. 画布右键悬停「添加节点」：若即向右展开节点列表；点选节点后浮层与菜单一起关闭；点「添加节点」本身切到内联列表时浮层收起。
6. Agent 节点面板：有会话时标题栏出现压缩按钮，运行中置灰，点击后提示「上下文已压缩」。

## 五、未覆盖

- 6px 探测容差之外的「擦边点击」仍不会命中连线。
- 分组贴画布顶部时标题栏位置（既有布局）未调整。
- 悬停浮层在极小窗口下的翻转位置依赖 Element Plus `fallbackPlacements`，未做极端尺寸手测。
