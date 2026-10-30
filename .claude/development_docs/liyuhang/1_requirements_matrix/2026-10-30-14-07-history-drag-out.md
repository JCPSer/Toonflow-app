# 需求矩阵：图片/视频历史记录拖到画布

- 时间：2026-10-30 14:07
- 提出人：liyuhang
- 模块：`packages/nodeShared/src/components/mediaHistory.vue`（拖拽源）、`apps/web/src/pages/workspace/panels/canvas/canvasDrop.ts`（落点）、`packages/nodeScaffold/src/workspaceFiles.ts`（节点目录工具）
- 代码基线：当前工作区（未提交）

## 1. 需求背景

图片节点（以及视频节点）的「历史记录」弹窗只能把历史文件「设为当前结果」，用户想把其中某一张图直接拖到画布上，变成一个独立节点，用于对比、二次生成、拼接等。

仓库现状（已核实）：

- 画布已有完整的拖放导入通道：`canvasDrop.ts` 的 `dropCanvasFiles` 接受素材库拖拽（`application/toonflow-asset`）和系统文件（`Files`），落点调用 `importCanvasFiles` 建 `remote-imageNode` / `remote-videoNode` / `remote-audioNode` / `remote-textNode`。
- 历史条目来自 `files.list("assets/<id>")`，`url` 即工作区相对路径（如 `assets/xxx/1.png`）；列表还会合并节点当前的输出（可能是**其他节点目录**的文件），所以源文件不一定属于本节点。
- 服务端已有 `/api/workspaces/files/copy`（`{directory, path, target}`，`COPYFILE_EXCL`，不自动建父目录）与 `/api/workspaces/files/mkdir`。
- 历史弹窗是 **模态** `el-dialog`（`appendToBody` + 全屏 `.el-overlay`），遮罩会挡住画布，拖放事件根本到不了画布 DOM。

## 2. 需求目标

在历史记录弹窗里，把当前预览的图片/视频拖到画布上松开，就在落点新建一个独立的图片/视频节点，文件语义为「复制成新节点自己的文件」。

非目标：不改动「设为当前结果」「删除」等既有功能；不改列表行的交互；不为历史列表加缩略图；不把节点自动连到任何上游；不进入项目素材库；不改服务端已有路由语义。

## 3. 需求矩阵

| 编号 | 需求描述 | 优先级 | 难度 | 风险 | 验收标准 |
| --- | --- | --- | --- | --- | --- |
| R1 | 历史弹窗右侧预览的图片可以拖出；拖动开始后画布可见（遮罩与弹窗淡出、不接收鼠标），松开或取消后弹窗恢复原状 | P0 | 中 | 中（遮罩隐藏时机、WKWebView 拖拽是否被打断） | 拖动中能看到画布；Esc 取消拖拽后弹窗原样回来（拖拽期间禁用弹窗的 Esc 关闭） |
| R2 | 拖到**画布空白区**（`.vue-flow__pane`）松开，在落点新建一个独立的图片节点（`remote-imageNode`），卡片显示该图 | P0 | 低 | 低 | 新节点出现在落点附近，图片正常显示，可拖可删；拖到节点上不落点 |
| R3 | 文件语义为复制：服务端把 `assets/<源节点>/x.png` 复制到 `assets/<新节点>/x.png`，删除源节点或源历史记录不影响新节点 | P0 | 低 | 低 | 删除源节点后被拖出的节点仍正常显示；磁盘多出一份同名文件 |
| R4 | 视频历史同样支持拖出，落点建 `remote-videoNode` | P1 | 低 | 低 | 视频拖出后节点可播放 |
| R5 | 拖拽不经过浏览器内存（服务端直接复制），大文件不卡主线程 | P1 | 低 | 低 | 拖 12–17MB 图片时界面不冻结 |
| R6 | 失败可回滚：复制失败、节点类型未启用、画布被切走时，不留下孤儿目录/文件 | P0 | 低 | 低 | 对应异常下 `assets/<新节点id>/` 不存在（目录为本节点新建，回收整目录） |
| R7 | 拖放创建可被一次撤销（Ctrl/Cmd+Z）撤销 | P1 | 低 | 低 | 撤销后新节点消失 |
| R8 | 不支持拖到画布以外（例如拖到对话面板）时不产生任何副作用，弹窗正常恢复 | P1 | 低 | 低 | 拖到侧栏松开，无报错、无新节点 |
| R9 | 防御：列表按 `mediaType` 过滤，理论上只会有图片/视频；载荷 MIME 非图片/视频时拒绝落点并提示 | P2 | 低 | 低 | 伪造的拖拽载荷不会建节点 |

## 4. 已确认决策（本次问答）

| 议题 | 结论 |
| --- | --- |
| 模态遮罩如何让出画布 | 拖动开始时遮罩与弹窗淡出（`opacity:0` + `pointer-events:none`），拖拽源元素保留在 DOM，`dragend` 后恢复 |
| 文件语义 | 复制成独立文件（`/api/workspaces/files/copy`，服务端复制，不过浏览器内存） |
| 支持范围 | 图片 + 视频 |
| 拖拽源 | 右侧预览区当前选中的那一张（列表行不加缩略图，也不做行拖拽） |

## 5. 边界与风险

- WebKit 在拖拽过程中隐藏拖拽源：本轮用 `setDragImage` 显式指定拖影后再隐藏，源元素不销毁，避免拖拽被取消。
- `.el-overlay` 是通用类：淡出规则只在拖拽期间生效（body 类），且需在组件卸载时清理，避免遮罩永久不可见。
- 画布 `drop` 只在画布面板处于激活且未打开设置面板时生效；否则不创建节点、不报错。
- 复制目标目录不存在：`copyWorkspaceFile` 对文件直接 `copyFile`，不会建父目录，必须先 `mkdir assets` 与 `mkdir assets/<新节点id>`（复用节点脚手架逻辑）。
- 同名文件：目标目录是全新的，天然无冲突。

## 6. 评审意见

### 6.1 子 agent 初审

- 结论：不通过（7 条必须修改已整改）
- 意见与整改：
  1. R6 回滚粒度不足 → `importCanvasFiles` 失败只删文件，`assets/<id>/` 会残留；改为「先校验节点类型再落盘」+ 本次新建目录随失败整目录回收。
  2. §5 未给拖拽类型方案，不能复用素材库类型（asset 载荷一律走库根并随机改名）→ 方案新增独立 MIME `application/toonflow-workspace-file`，同步加入 `isCanvasFileDrag`。
  3. R1 风险被低估（WKWebView 拖拽期间不重绘、事件落点）→ 显式 `setDragImage` 先截图再淡出；实测验证作为验收项。
  4. 不用全局 `.el-overlay` → 改用 `el-dialog` 的 `modal-class`（仓库 `mobileConnect.vue` 已有先例），只作用于本弹窗。
  5. 恢复时机不足 → `dragend`/`drop`/`visibilitychange` + 弹窗 `closed` + 卸载，四处兜底。
  6. Esc 会直接关掉弹窗（`closeOnPressEscape` 默认 true）→ 拖拽期间 `:close-on-press-escape="false"`、`:close-on-click-modal="false"`。
  7. 漏场景：源文件在另一节点目录、拖动中源文件被删、`<video>` 默认不可拖 → 已在 R1/R3/R4/§5 补齐，`video` 显式 `draggable`。
- 事实核对修正：R2「任意位置」实为 `.vue-flow__pane`；R9 历史列表不会出现非媒体条目（改为防御项）；R3 同名文件仅在 `/files/copy` 路径成立；「历史文件都在本节点目录」不成立（`props.current` 可指向别处）。

### 6.2 用户评审

- 结论：待填写
- 意见：待填写
