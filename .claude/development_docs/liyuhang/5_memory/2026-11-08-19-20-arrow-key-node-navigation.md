# 记忆：画布方向键选择相邻节点

- 时间：2026-11-08 19:20（19:30 部署）
- 类型：功能增强（画布交互 / 键盘导航）

## STAR

**Situation（背景）**
画布只能用鼠标点节点，键盘用户跨节点只能靠 ⌘F 搜节点。方向键在画布上完全空闲：Vue Flow 关闭了 `nodes-focusable` 与 `disable-keyboard-a11y`，`delete-key-code=null`，画布内只有节点搜索框和节点右键菜单会消费方向键。

**Task（任务）**
↑↓←→ 在节点间按空间关系移动选中；Shift 追加；无选中时从视口中心最近的节点起跳；目标节点居中；分组不参与；写死不进设置。

**Action（行动）**
- 新增 `nodeNavigation.ts` 纯几何：`nodeRect` / `boundingRect` / `rectCenter` / `rectDistance` / `pickNodeInDirection` / `pickNodeNearestPoint`。方向锥 ±45°（`perp ≤ forward`），评分 `distance + perp`，同分比 perp → distance → id。
- `nodeNavigation.test.ts` 18 条单测。
- `canvas/index.vue`：`navigateSelection()` + `viewportCenterInFlow()`；方向键分支插在 `runAction` 之后、`editing` 守卫之前。
- 守卫按层拆开：`textEditing`（文本控件）、`inNodeWidget`（`.vue-flow__node/__edge` 内整体让位）、`inFloatingMenu`（`.el-popper/role=menu/listbox`）、`inAgentNodePanel`、`inCanvas`、`hasModalOverlay()`。
- 选区替换用 `removeSelectedNodes(选中节点)`，保留连线选中；repeat 时 `setCenter` duration 0。

**Result（结果）**
canvas 54 单测通过（新增 18）；typecheck 仅剩既有 `@/agentRuntime`；web 构建成功，19:30 同步到应用 `views/mainview/`；未重启应用。

## 关键经验

1. 画布 `editing` 把 `button` 也算编辑中，不能直接复用于方向键——工具条按钮点完焦点会停在按钮上。要按「文本控件 / 节点区域 / 浮层」分层判断，而不是复用单一 `editing`。
2. 节点内部大量控件自己用方向键（相机、灯光、裁剪、3D 场景、音频片段），且监听在 window 捕获阶段，节点里的 `stopPropagation` 拦不住；必须按 `.vue-flow__node` 整体让位。
3. Agent 节点对话面板渲染在 `<vue-flow>` 内部，`inCanvas` 会为真，必须显式排除 `inAgentNodePanel`，否则消息区方向键被吞且画布在背后跳动。
4. 画布下拉的条目菜单 `appendTo` 到画布内部（不是 body），Element Plus 的 roving focus 也用方向键，必须额外排除 `.el-popper / role=menu / listbox`。
5. `removeSelectedElements()` 会连带清掉连线选中；只清节点要用 `removeSelectedNodes(nodes)`。
6. 视口中心换算 `((w/2 - x)/zoom, (h/2 - y)/zoom)` 与 `setCenter` 内部完全互逆；`dimensions` 初值 0，未测量时要直接放弃导航。
