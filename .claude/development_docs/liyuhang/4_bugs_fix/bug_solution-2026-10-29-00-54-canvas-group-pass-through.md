# Bug 方案：分组穿透探测 + 组菜单 + 添加节点悬停展开

- 记录时间：2026-10-29 00:54
- 关联分析：`bug_analysis-2026-10-29-00-54-canvas-group-pass-through.md`

## 一、B2：左键「穿透探测」，命中连线就断开，否则照常拖组

不给组体加 `pointer-events: none`（会失去拖动与 hover），改在画布捕获阶段做一次命中探测：

```
onCanvasPointerDown(event):        // .canvas 上的 @pointerdown.capture，先于 Vue Flow 的拖拽监听
    probeGroupEdgeClick(event)
    updateCanvasSelection(event)   // 原有逻辑

probeGroupEdgeClick(event):
    if event.button != 0: return
    group = target.closest(".vue-flow__node-canvasGroup")，排除标题栏与调整角
    if !group: return
    id = edgeIdUnderGroup(group, event.clientX, event.clientY)
    if !id 或 findEdge(id) 不存在: return
    event.preventDefault(); event.stopPropagation()   // 捕获阶段阻止事件到达节点，避免同时开始拖组
    edgeDisconnect = { id, x, y }                     // 复用已有的断开气泡

edgeIdUnderGroup(group, x, y):
    暂存 group.style.pointerEvents
    group.style.pointerEvents = "none"      // 让组暂时退出命中测试
    用 9 个采样点（中心 + 半径 6px 的 8 个方向）逐个 elementFromPoint
        命中 .vue-flow__edge 就取 data-id 返回
    finally 复原 pointerEvents
```

要点：

- **捕获阶段**才拦得住 Vue Flow 的节点拖拽监听（它挂在节点元素上，冒泡阶段）。
- **9 点采样**给 1–2px 描边一个约 6px 的容差，避免「看着点在线上其实差 2px」。
- 探测只改 `pointerEvents` 一个属性并在 `finally` 复原，不插入/移动 DOM。
- 没有命中连线时事件原样放行 → 组的选择、拖动、框选行为与改动前完全一致。

## 二、B1：组内右键透传到画布菜单，分组菜单挂标题栏

```
forwardGroupContextMenu(event):    // .canvas 上的 @contextmenu.capture
    group = target.closest(".vue-flow__node-canvasGroup")，排除标题栏
    if !group: return
    event.preventDefault(); event.stopPropagation()
    nodeMenu.openMenu(event, true)      // 与画布空白右键完全同一条路径
```

分组的自有菜单（重命名 / 删除分组）改用 `el-dropdown trigger="contextmenu" + virtualTriggering`，锚点取标题栏右键坐标；标题栏 `@contextmenu.stop.prevent` 先于捕获处理器判断（捕获处理器按 `closest(".groupLabel")` 直接跳过）。

「删除分组」走画布删除链路：画布新增 `provide("deleteNodeSelection")`，内部 `canvasHistory.batch(() => nodeMenu.deleteSelection(nodes))`，保证子节点一并删除、`delete` 生命周期触发、可撤销。分组自己 `removeNodes` 会留下 `parentNode` 指向已删节点的孤儿。

## 三、B3：添加节点悬停向右展开

把 actions 层里的「添加节点」项包进 `el-popover trigger="hover" placement="right-start"`：

- 内容直接复用 `nodeMenuItems`（`items = menuItems`、`nodes = filteredNodes`），与文件夹子菜单同一套样式与交互；
- `popperClass="nodeChildMenu"` 复用已有的悬浮桥（`::before` 三角衔接），移入子菜单不会收起；
- `:appendTo="menuContainer"` 与其它子菜单一致，避免被下拉层裁剪；
- `watch(menuLevel)`：点「添加节点」走键盘/点击切到内联 nodes 层时收起浮层，避免两份列表同时显示；
- 任何命令执行前先收起浮层，避免选择节点后浮层残留。

## 四、验证计划

1. web typecheck 0 新增；`deploy-local.sh --build` 成功。
2. 产物核对：`vue-flow__node-canvasGroup` 选择器、`添加节点` 悬停浮层均在 workspace 产物中。
3. 手测：组内左键空白拖组、组内点线弹断开、组内右键出画布菜单、标题栏右键出分组菜单并可从菜单删除整组、画布右键悬停「添加节点」向右展开。

## 五、未覆盖

- 穿透探测对极细或半透明连线仍可能出现「点在旁边没命中」（6px 容差之外）。
- 分组标题栏在分组上方 8px 处，分组贴画布顶部时标题栏可能被裁切（既有布局，未改）。
