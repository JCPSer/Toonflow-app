# 记忆：历史记录拖到画布（+ 便签正文可拖动）

- 时间：2026-10-30 14:35
- 改动文件：`packages/nodeShared/src/components/mediaHistory.vue`、`apps/web/src/pages/workspace/panels/canvas/canvasDrop.ts`、`packages/nodeScaffold/src/workspaceFiles.ts`、`packages/nodes/noteNode/src/index.vue`

## Situation

图片/视频节点的「历史记录」弹窗只能"设为当前结果"，用户希望把某张历史图直接拖到画布上变成独立节点。弹窗是模态 `el-dialog`，全屏遮罩挡住画布，拖放事件到不了画布 DOM。另外便签节点只有标题栏能拖，正文区域带了 `nodrag`。

## Task

1. 历史预览图/视频可拖到画布，落点新建 `remote-imageNode` / `remote-videoNode`；文件复制成独立副本；拖动时让画布可见。
2. 便签正文也能拖动节点。

## Action

- 拖拽源（mediaHistory.vue）：预览 `img`/`video` 加 `draggable`；`dragstart` 写入自定义类型 `application/toonflow-workspace-file`（`{path, mimeType}`，MIME 用列表已知值），显式 `setDragImage` 先截拖影再让遮罩淡出；`dragOut` 驱动 `el-dialog` 的 `modal-class`（只作用于本弹窗），CSS 只改 `opacity` + `pointer-events`，不销毁拖拽源。恢复点：`dragend`/`drop`/`visibilitychange`/`@closed`/`onBeforeUnmount` 五处兜底；拖拽期间禁用 Esc 关弹窗与点遮罩关闭。
- 落点（canvasDrop.ts）：新增 `workspaceDragType` 分支并纳入 `isCanvasFileDrag`；先校验 `remote-<kind>Node` 已启用再落盘，`ensureNodeDirectory` 建新节点目录，`files.copy` 服务端复制（不经过浏览器内存），随后复用既有 `prepared` 机制交给 `importCanvasFiles` 建节点、预热缩略图、`canvasHistory.batch` 一次撤销。
- 回滚：`prepared` 增加 `ownedDirectory`，失败/取消时删文件并回收本次新建目录；素材库拖拽无该字段，行为不变。
- 脚手架（workspaceFiles.ts）：抽出 `ensureNodeDirectory`，`uploadNodeFile` 复用。
- 便签（noteNode）：`.noteText` 去掉 `nodrag`（Vue Flow 按祖先 `.nodrag` 过滤拖拽），保留 `nopan nowheel`；编辑态 textarea 仍 `nodrag`。

## Result

- 构建、类型检查通过（web 仅剩既有 `@/agentRuntime` 别名错误）。
- Chrome 端到端：拖出后在落点新建节点并显示图片，文件按原名复制到 `assets/<新节点id>/`；拖拽事件链完整，遮罩仅本弹窗加类。
- Playwright WebKit 无法驱动 HTML5 原生拖拽（dragstart 后立刻 dragend），WKWebView 内手势需人工复测；失败时备选：非模态弹窗或 dragstart 直接关弹窗。
- 画布已还原、测试素材目录已清理，应用已重启。

## 补充（v3 修订）

- WKWebView 内 HTML5 拖拽不可用：`draggable="true"` 的预览图完全不出拖影、不派发 `dragstart`。改为 pointer 事件自绘拖拽（6px 阈值 / 自绘 ghost / `elementFromPoint` 命中 `.vue-flow__pane` / 松手派发 `toonflow:workspace-file-drop`）。
- 画布侧新增 `dropWorkspaceFile()` 复用复制与回滚逻辑；插件与画布通过自定义事件解耦，插件不依赖画布内部实现。
- 教训：桌面端 WKWebView 的 HTML5 DnD 不能当作可用能力，涉及拖拽的功能一律优先 pointer 事件实现。
