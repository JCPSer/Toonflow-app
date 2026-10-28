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

## 六、复测后修正（2026-10-29 01:20）

用户复测反馈两点，均已处理：

1. **空白区域悬停「添加节点」仍不展开**。上一版把浮层写成 `el-popover trigger="hover"` 并嵌在 `el-dropdown-menu` 内，在 EP 的下拉浮层里不会触发 hover。
   改为**不依赖 EP 浮层**：`el-dropdown-item` 上直接监听 `mouseenter/mouseleave`，浮层用 `<Teleport to="body">` + `position: fixed` 按菜单项矩形定位（右侧放不下自动翻左、纵向夹在视口内），展开/收起由 160ms 延时 + 浮层自身的进入/离开事件控制。
   浮层上补 `@pointerdown.stop` / `@mousedown.stop`：它已不在下拉浮层内，不加会被 EP 的 click-outside 判成「点外面」，导致点击节点的瞬间整个菜单被关掉。
2. **组内与空白右键菜单不一致**。上一版组内转发用了 `openMenu(event, true)`（nodesOnly，节点列表专用），而空白走 `onPaneContextMenu(openMenu)` 即 `nodesOnly=false`（完整操作菜单）。组内改为 `openMenu(event, false)`，两条路径统一。
3. **Agent 节点没有耗时显示**。补 `:busy`（思考/运行中为真），复用 `nodeSkeleton` 的 `durationBadge`：运行中滚秒，结束后留在角标上显示总耗时。

另外补一个构建经验：同一元素写两个同名修饰符事件（如两个 `@pointerdown.capture`）`vue-tsc` 不报错，但 i18n 插件解析 Vue 时判 `Duplicate attribute` 使构建失败，必须合并成单一处理函数。

`apps/web` typecheck 0 新增；`deploy-local.sh --build` 成功，产物含 `addNodeFlyout`（JS/CSS）与 agentNode 的 `busy`。
