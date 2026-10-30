# 需求方案：图片/视频历史记录拖到画布

- 时间：2026-10-30 14:10
- 对应需求矩阵：`1_requirements_matrix/2026-10-30-14-07-history-drag-out.md`
- 涉及文件：`packages/nodeShared/src/components/mediaHistory.vue`、`apps/web/src/pages/workspace/panels/canvas/canvasDrop.ts`、`packages/nodeScaffold/src/workspaceFiles.ts`

## 1. 设计概要

复用画布已有的「拖放导入」通道，不新增服务端接口：

```
历史弹窗预览图 ──dragstart──▶ 写自定义拖拽类型（工作区相对路径）
      │                              │
      └─ 遮罩+弹窗淡出（120ms）        ▼
                              画布 @dragover 接受（类型白名单）
                                     │
                              @drop → dropCanvasFiles
                                     │
                    ① 解析路径 → ② 服务端复制到新节点目录
                                     │
                          ③ 交给既有 importCanvasFiles 建节点
```

关键点：**拖拽不经过浏览器内存**（复制在服务端做），落点建节点完全复用现有逻辑（`prepared` 机制已经支持「服务端已落盘的文件 + 指定节点 id」）。

## 2. 拖拽源（mediaHistory.vue）

### 2.1 交互

- 右侧预览区的 `<img>` / `<video>` 加 `draggable`。
- `dragstart`：
  1. 取当前选中项 `selected.url`（工作区相对路径）与 `selected.mimeType`。
  2. `dataTransfer.effectAllowed = "copy"`；`setData("application/toonflow-workspace-file", JSON.stringify({ path, mimeType }))`——MIME 由列表携带，不靠扩展名猜（历史列表支持 tif/ogv，画布的扩展名表没有）。
  3. **显式 `setDragImage(预览元素, 按下点在元素内的偏移)`**——先截图，再淡出，避免拖影变空白。
  4. `dragOut = true`（组件内状态，驱动 `modal-class`）。
- 恢复：`window` 上一次性监听 `dragend` / `drop`（`{ once:true, capture:true }`）、`document` 的 `visibilitychange`、`el-dialog @closed`、组件 `onBeforeUnmount`——四处兜底，防止遮罩永久不可见。
- 拖拽期间 `:close-on-press-escape="false"`、`:close-on-click-modal="false"`，Esc 只取消拖拽、不关弹窗。
- 没有选中项、或预览未就绪（`previewUrl` 为空）时不设置拖拽数据。

### 2.2 淡出样式

```scss
:global(.mediaHistoryDragOverlay) {   /* 通过 el-dialog 的 modal-class 动态挂到本弹窗遮罩 */
  opacity: 0 !important;
  pointer-events: none !important;
  transition: opacity 120ms ease;
}
```

- 只改 `opacity` 与 `pointer-events`，**不隐藏 DOM**：拖拽源仍在文档里，WebKit 不会中途取消拖拽。
- 用 `modal-class` 而不是全局 `.el-overlay`：消息框、其它弹窗的遮罩不受影响（`mobileConnect.vue` 已有先例）。
- 拖拽幽灵用第 3 步显式指定的元素，不受淡出影响。

### 2.3 UI 效果

| 阶段 | 画面 |
| --- | --- |
| 按下并开始拖 | 弹窗与遮罩 120ms 淡出，画布露出，鼠标带着预览图的拖影 |
| 拖到画布上方 | 画布沿用现有 `dragFilesOver` 高亮（无需新增视觉） |
| 松开 | 落点建节点；`dragend` 后弹窗 120ms 淡入恢复，仍显示原来的选中项 |
| Esc 取消 / 拖到画布外松开 | 不建节点；弹窗恢复原状 |

## 3. 落点（canvasDrop.ts）

### 3.1 类型白名单

- 新增常量 `workspaceDragType = "application/toonflow-workspace-file"`。
- `isCanvasFileDrag` 增加该类型（`dragover` 才能 `preventDefault` 放行）。
- 该类型与 `application/toonflow-asset` 互不干扰：素材库拖拽走的还是老分支。

### 3.2 处理流程（伪代码）

```
dropCanvasFiles(event):
  rawWorkspace = transfer.getData(workspaceDragType)
  if rawWorkspace:
      { path, mimeType } = JSON.parse(rawWorkspace)   // mimeType 缺失时回退扩展名表
      kind = image / video（其它 → 抛「暂不支持拖到画布」）
      name = path 的文件名
      节点类型 remote-<kind>Node 未启用 → 先报错，不落盘
      id = uuid()
      directory = ensureNodeDirectory(files, id)     // mkdir assets + assets/<id>，EEXIST 忽略
      target = directory + "/" + name
      try:
          await files.copy(path, target)             // 服务端 COPYFILE_EXCL
      catch / 期间被取消:
          await files.remove(directory, recursive).catch(空)
          throw
      droppedFiles = [ new File([], name, {type: mimeType}) ]
      prepared = [ { id, path: target, ownedDirectory: directory } ]
  else if rawAsset: 沿用现状
  await importCanvasFiles(droppedFiles, position, ctx, prepared)
```

后续完全交给 `importCanvasFiles`：

- `kind` 由 mimeType 推出 → 节点类型 `remote-imageNode` / `remote-videoNode`；
- 建节点失败/被取消 → `rollback()`：删文件 + 删本次新建的 `ownedDirectory`（素材库拖拽没有该字段，行为不变）；
- 视频落盘后 `warmThumb`；
- 外层 `canvasHistory.batch` 保证一次撤销。

### 3.3 为什么不是「新节点引用原文件」

原文件属于源节点的 `assets/<源id>/`，源节点删除、历史记录删除都会删物理文件；引用会导致新节点变空图。复制一份（12–17MB/张）是可接受的代价。

## 4. 脚手架改动（workspaceFiles.ts）

把 `uploadNodeFile` 里「建 `assets` 与 `assets/<id>` 两级目录」的逻辑抽成导出函数：

```
export async function ensureNodeDirectory(files, nodeId) -> "assets/<id>"
  for path in ["assets", "assets/<id>"]: files.mkdir(path)，EEXIST 忽略
```

`uploadNodeFile` 改为调用它；`canvasDrop.ts` 直接复用，避免复制一份目录约定。

## 5. 异常与边界

| 场景 | 行为 |
| --- | --- |
| 画布未激活 / 设置面板打开 | `dropFiles` 守卫直接返回，不建节点；`dragend` 恢复弹窗 |
| 拖到侧栏、对话面板松开 | 无 `drop` 监听，`dragend` 恢复弹窗，无副作用 |
| 复制失败（磁盘满、权限、源文件已被删） | 删除刚建的节点目录并提示错误 |
| `remote-imageNode` 未启用 | `importCanvasFiles` 报错并回滚复制出的文件 |
| 拖动期间切换画布 | 画布控制器 `signal` 已中止；复制结果按 `prepared` 回滚（沿用现有 `signal.aborted` 分支） |
| 同名文件重复拖 | 每次新节点 id → 新目录，无冲突 |
| 弹窗关闭（`destroyOnClose`）时仍在拖 | 组件卸载清理 body 类，遮罩恢复 |

## 6. 测试计划

| 用例 | 期望 |
| --- | --- |
| 拖一张历史图片到画布空白处 | 120ms 内弹窗淡出；松开后落点出现图片节点，卡片显示该图；弹窗恢复 |
| 拖动中按 Esc | 不建节点，弹窗恢复，画布无变化 |
| 拖到右侧对话面板 | 不建节点，无报错 |
| Cmd+Z | 新节点一步撤销 |
| 拖历史视频 | 生成视频节点，可播放 |
| 删除源节点后打开新节点 | 图片仍在 |
| 拖动 12–17MB 图片时的帧 | 无主线程长任务（复制在服务端） |

## 7. 评审意见

### 7.1 子 agent 初审

- 结论：不通过（整改后按此实现）
- 主要整改：`modal-class` 替代全局遮罩选择器；恢复时机补齐（dragend/drop/visibilitychange/closed/unmount）；拖拽期间禁用 Esc 关弹窗；MIME 由载荷携带；先校验节点类型再落盘；`prepared` 增加 `ownedDirectory` 用于整目录回滚；`<video>` 显式 `draggable`。

### 7.2 用户评审

- 结论：待填写
- 意见：待填写

## 8. v3 修订：HTML5 拖拽改为指针拖拽（用户实测后）

WKWebView 内 HTML5 拖拽的 `dragstart` 根本不派发（用户实测「图片纹丝不动、无拖影」），方案 2.1/3.1 的 DnD 路线作废：

- 拖拽源：`draggable="false"` + `pointerdown`；移动超过 6px 进入拖拽态（保证视频控制条正常点击）；自绘 ghost；`elementFromPoint(...).closest(".vue-flow__pane")` 判定落点；松手派发 `toonflow:workspace-file-drop`（载荷 `{ path, mimeType, clientX, clientY }`）；Esc / pointercancel / 超时 / 关闭 / 卸载收尾；图片 `setPointerCapture`，视频不捕获。
- 落点：`canvasDrop.ts` 导出 `dropWorkspaceFile(source, position, context)`，校验节点类型 → `ensureNodeDirectory` → 服务端 `files.copy` → `importCanvasFiles`（带 `ownedDirectory` 回滚）；`canvas/index.vue` 监听事件并做激活/设置面板/落点校验后 `canvasHistory.batch`。
- 遮罩：仍用 `modal-class` 在拖拽期间透明 + 不接收鼠标；由于不再是原生拖拽，隐藏拖拽源不会取消拖拽。
