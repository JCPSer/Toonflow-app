# 记忆：分组穿透、分组右键菜单、添加节点悬停展开

## Situation

分组节点是一整块矩形，Vue Flow 给节点层 `pointer-events: all`，组内所有指针事件都被组吃掉：右键只有 WKWebView 原生菜单（返回/重新载入/查看元素），组内连线点不中也无法取消。同时画布右键菜单的「添加节点」需要先点一次才展开节点列表。

## Task

让组内空白恢复成「画布」语义（右键出画布菜单、连线可点），同时保留分组拖动；分组自己的菜单挂到标题栏；「添加节点」改为悬停向右展开。

## Action

- **穿透探测**：在 `.canvas` 的 `@pointerdown.capture` 里先探测——临时把组体 `pointerEvents="none"`，用中心 + 8 个方向共 9 个 `elementFromPoint` 采样（6px 容差）找 `.vue-flow__edge[data-id]`；命中就 `preventDefault + stopPropagation` 并弹断开气泡，没命中就原样放行，组的选择/拖动不受影响。捕获阶段是关键：Vue Flow 的拖拽监听挂在节点元素上，冒泡阶段拦不住。
- **右键透传**：`.canvas` 的 `@contextmenu.capture` 判断目标在 `.vue-flow__node-canvasGroup` 内（排除标题栏/调整角）后，转发到 `nodeMenu.openMenu(event, true)`，与画布空白右键同一条路径。
- **分组菜单**：`groupNode` 标题栏右键用 `el-dropdown trigger="contextmenu" + virtualTriggering`，菜单项「重命名分组 / 删除分组」。删除走新 `provide("deleteNodeSelection")` → `canvasHistory.batch(() => nodeMenu.deleteSelection(nodes))`，子节点一并删、可撤销；自己 `removeNodes` 会留下 `parentNode` 指向已删节点的孤儿。
- **添加节点悬停展开**：把该项包进 `el-popover trigger="hover" placement="right-start"`，内容复用 `nodeMenuItems`，`popperClass="nodeChildMenu"` 复用已有的悬浮桥；`watch(menuLevel)` 与命令执行前收起浮层，避免与内联 nodes 层重复显示。
- 顺带：Agent 节点面板标题栏补「压缩上下文」按钮，转发 `conversation.compactContext()` 并按 `compactState` 置灰。

## Result

`apps/web` typecheck 0 新增；`deploy-local.sh --build` 成功并安装。踩到一次构建失败：同一元素写两个 `@pointerdown.capture` 会被 i18n 插件的 Vue 解析器判为 `Duplicate attribute`（vue-tsc 不报），必须合并成单一处理函数。

待手测：组内拖组、组内点线断开、组内右键画布菜单、标题栏右键分组菜单并删除整组、悬停添加节点展开。

## 复测修正（01:20）

- **悬停浮层不能用 `el-popover` 嵌在 `el-dropdown-menu` 里**：在 EP 的下拉浮层内 hover 不触发。改为 `el-dropdown-item` 的 `mouseenter/mouseleave` + `<Teleport to="body">` 的 `position: fixed` 面板，坐标取菜单项 `getBoundingClientRect()`（右放不下翻左、纵向夹视口），160ms 延时配合浮层自身的 enter/leave 做悬浮桥。
- **浮层 teleport 出去后必须自带 `@pointerdown.stop`/`@mousedown.stop`**：否则 EP 的 click-outside 会把它判成「点外面」，点击节点的同时把整个菜单关掉，节点根本建不出来。
- **组内右键要与空白右键同一路径**：空白走 `onPaneContextMenu(openMenu)` 即 `nodesOnly=false`（完整操作菜单），组内之前传了 `true`（只列节点），所以两边不一样，改传 `false`。
- **Agent 节点耗时**：`nodeSkeleton` 的 `durationBadge` 由 `busy` 驱动，节点包补 `:busy="thinking||running"` 即可，运行中滚秒、结束留总时长。
- 构建坑：同一元素写两个 `@pointerdown.capture`，`vue-tsc` 不报但 i18n 插件的 Vue 解析器报 `Duplicate attribute`，构建直接失败。
