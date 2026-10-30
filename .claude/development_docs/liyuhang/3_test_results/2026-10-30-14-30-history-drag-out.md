# 测试结果：历史记录拖到画布

- 时间：2026-10-30 14:30
- 对应方案：`2_requirements_solutions/2026-10-30-14-10-history-drag-out.md`
- 构建：`./scripts/deploy-local.sh --build` 通过（11 个节点包同步）；应用已重启

## 1. 构建与类型检查

| 项 | 结果 |
| --- | --- |
| `bun run --filter '@toonflow/node-shared' typecheck` | 通过 |
| `bun run --filter '@toonflow/nodes-scaffold' typecheck` | 通过 |
| `bun run --filter '@toonflow/web' typecheck` | 仅剩既有 `@/agentRuntime` 别名错误，无新增 |
| 部署产物 | `toonflow-data/nodes/imageGenerationNode.umd.js`、`videoGenerationNode.umd.js` 含 `mediaHistoryDragOverlay` 与 `application/toonflow-workspace-file` |

## 2. 端到端（Chrome for Testing，1512×900，真实画布 `蕾姆Rem/3-教室里的大胆行为`）

| 用例 | 期望 | 实测 |
| --- | --- | --- |
| 选中图片节点 → 打开「历史记录」 | 弹窗显示当前结果预览 | 通过 |
| 从预览图拖到画布空白区松开 | 落点新建图片节点并显示该图 | 通过：节点数 36→37，落点出现卡片并显示图片（截图 `_perf/dragout-chromium.png`） |
| 文件语义 | 服务端复制、保留原文件名 | 通过：新目录 `assets/<新节点id>/image3fd7cb18-….png`，文件名与原文件一致（非浏览器重新上传的随机名） |
| 拖拽期间弹窗遮罩 | 只本弹窗遮罩加 `mediaHistoryDragOverlay` | 通过：拖拽中该 overlay 类生效（页面同时存在其它节点遗留的 overlay，仅本弹窗被加类） |
| 拖拽事件链 | dragstart → dragover（画布放行）→ drop | 通过：`dragstart 1 / dragover 15 / drop 1 / dragend 1` |
| 弹窗恢复 | 松手后弹窗保持打开、选中项不变 | 通过 |

## 3. 自动化限制（必须人工补测）

Playwright 的 WebKit（2370）在本机**无法驱动 HTML5 原生拖拽**：手动 `mouse.down→move→up` 时 `dragstart` 触发后立刻 `dragend`（拖拽被浏览器取消），因此托管环境里无法自动验证 WKWebView 内的真实手势。Chromium 内核（Chrome for Testing）同一脚本可通过，说明事件链与落点逻辑正确。

**待人工实测（应用内 WKWebView）**：
1. 拖动预览图时弹窗是否淡出、画布是否露出；
2. 松开后是否在落点新建图片节点；
3. 拖动中按 Esc 是否只取消拖拽、弹窗恢复；
4. 视频节点的历史记录同样可拖出。

若 WKWebView 下拖拽被取消或 drop 不触发，备用方案：把历史弹窗改为非模态浮窗（方案文档 §2 的备选），或 dragstart 时直接关闭弹窗。

## 4. 清理

- 测试期间在 `3-教室里的大胆行为.json` 中新建的 2 个节点已通过还原画布文件移除（备份 `_perf/dragout-bak/`）。
- 测试产生的两个素材目录（`assets/16a73dfc…`、`assets/dbe04ce5…`）已删除，画布 JSON 中无残留引用。
- 应用已重启，端口 `56424`。

## 5. 代码审查（子 agent）

| 问题 | 严重度 | 修法 | 复验 |
| --- | --- | --- | --- |
| 拖到窗口外松手时 `dragend` 可能丢失，`dragOut` 永久为 true → 遮罩透明且不可点、Esc 被禁用，弹窗再也关不掉 | 必须 | 补 30s 超时兜底；`watch(visible)` 关闭时无条件 `endDragOut()`（`@closed` 要等动画、卡死时不会触发） | `node-shared` typecheck 通过，构建部署完成 |
| 建目录后才检查取消，画布已切走仍会复制十几 MB | 建议 | `signal.throwIfAborted()` 提前到 `copy` 之前，并把取消检查移进回收目录的 try 内（避免留下空目录） | 代码路径核对 |
| 回滚失败静默吞掉，孤儿目录无人知晓 | 建议 | `console.warn` 记录路径与错误 | 代码路径核对 |
| 可拖出仅靠 `title` 提示 | 建议 | 预览图/视频 `cursor: grab`（按下 `grabbing`） | 构建通过 |
| `<video draggable>`、便签正文拖动滚动条等 WKWebView 行为 | 待实测 | 见 §3 人工复测项 | 待人工 |

未采纳：为视频历史加「在画布上创建副本」按钮（超出本次需求）；ogv/tif 白名单（WKWebView 不支持 Ogg，但落点仍能得到节点文件，属既有格式限制）。

## 6. 第二轮：HTML5 拖拽在 WKWebView 内不启动 → 改为指针拖拽

用户实测：「按住预览图完全没有反应，图片纹丝不动，也没有拖影」——即 `dragstart` 根本没有派发（应用内 WKWebView）。查证：WKWebView 的 HTML5 DnD 长期不可靠，业界通行做法是改用 pointer 事件自绘拖拽 + `elementFromPoint` 判定落点（参见 koala73/worldmonitor PR #313 等）。

改造：
- `mediaHistory.vue`：预览图/视频改为 `draggable="false"` + `@pointerdown`，移动超过 6px 才进入拖拽态（不影响视频控制条点击）；自绘 ghost（`position:fixed` + `pointer-events:none`）；指针移动时用 `elementFromPoint` 判断是否在 `.vue-flow__pane` 上（命中时 ghost 描边）；松手在画布上则派发 `toonflow:workspace-file-drop` 自定义事件；Esc / pointercancel / 30s 超时 / 弹窗关闭 / 组件卸载都会收尾；图片元素在拖拽开始时 `setPointerCapture`（视频不捕获，保留控制条）。
- `canvasDrop.ts`：删除 HTML5 自定义类型分支，抽出导出函数 `dropWorkspaceFile(source, position, context)`（校验节点类型 → 建目录 → 服务端复制 → 复用 `importCanvasFiles`，失败回收目录）。
- `canvas/index.vue`：监听 `workspaceFileDropEvent`，校验画布激活/未开设置面板、`elementFromPoint` 命中 `.vue-flow__pane`，再 `canvasHistory.batch` 创建。

复测（Chrome for Testing，真实画布 `3-教室里的大胆行为`，54 节点）：

| 项 | 结果 |
| --- | --- |
| 拖拽期间遮罩让位 | 通过：本弹窗 overlay 加 `mediaHistoryDragOverlay` |
| 松手落点建节点 | 通过：节点数 54 → 55 |
| 松手后遮罩恢复 | 通过：`mediaHistoryDragOverlay` 已移除，无残留 ghost |
| 测试数据清理 | 画布 JSON 已还原为测试前版本，测试目录 `assets/3b62cd0b…` 已删除 |

未验证：WKWebView 内的真实手势（Playwright WebKit 无法驱动原生指针拖拽链路，仍需人工复测）；撤销（测试时焦点在弹窗里，Ctrl+Z 未生效，应在画布上按）。
