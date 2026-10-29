# 记忆：项目快速切换 + 跨项目粘贴带文件 + 画布 Esc 退出确认

- 记录时间：2026-10-29 10:30
- 关联：`1_requirements_matrix/2026-10-29-10-30-…`、`2_requirements_solutions/2026-10-29-10-30-…`、`3_test_results/2026-10-29-10-30-…`

## S 情境

工作区只有「退出项目」一个出口，换项目必须回首页；跨项目粘贴节点被硬性拦截（「此节点引用工作区文件，不能跨项目粘贴」）；画布没有 Esc 出口。

## T 任务

1. 画布左上角项目名旁提供项目切换下拉。
2. 跨项目粘贴时把节点引用的文件一并复制，粘贴成功，不覆盖目标项目已有文件。
3. 画布无选中时按 Esc 弹退出项目确认，有选区时先清选择。

## A 行动

**项目切换**：`canvasMenu` 在项目名右侧加 `⌄`（项目名输入框仍是改名入口），下拉列出 `projectList`（按最近打开倒序、可搜索、当前项勾选、第二行显示目录）。`canvasMenu` 只 `emit("switchProject")`，保存与拦截都在画布层（`canvas/index.vue`）：先 `flushCanvasSave()`，再 `openProject()`，404 时弹确认并复用首页的 `workspacePicker` 重新定位目录。切换中 `switching` 传到触发器做 loading。

**运行判定**：运行态原本只存在于各节点包内部，唯一全节点一致的信号是 `nodeSkeleton` 的 `busy`。新增 `packages/nodeScaffold/src/nodeBusy.ts`，用 `Symbol.for("toonflow.busyNodes")` 在 `globalThis` 上建 `Map<nodeId, 计数>`（引用计数 + 卸载清理 + 切换前 `pruneBusyNodes` 剪枝）。跨 bundle 共享的做法与既有 `agentNodeStatus` 一致：节点包是独立 UMD，普通 Symbol 在宿主与节点包之间不相等。

**跨项目粘贴**：新增 `POST /api/workspaces/files/transfer`。逐文件解析源（`resolveWorkspaceFile`）与目标（`resolveWorkspacePath` + `allowMissingParents`）；目标已存在时先比大小再比 sha256，相同记 `reused`、不同改名 `<base>-<8位id><ext>`；`library`/`library-assets`/`.toonflow` 顶层直接跳过；`copyFile(COPYFILE_EXCL)` 兜底不覆盖，加锁 + 3 次退避重试应对节点并发写。前端 `readClipboardNodes` 在跨项目分支调用它，用返回的 `source→target` 映射改写 `outputs[*].value.url`，并在粘贴后提示复制数量；原「不能跨项目粘贴」硬拦截删除。

**Esc**：把 `workspaceMenu` 的退出对话框与路由逻辑抽成 `pages/workspace/exitProject.ts`（模块级单例）+ `components/exitProjectDialog.vue`，由 `workspace/index.vue` 渲染一次；顶栏按钮与画布 Esc 共用。Esc 接在 `updateCanvasKeys`（window 捕获）里，先于 `editing` 早退处理，条件：面板 active、非全屏、焦点不在输入框、不在 `#agentPanel`/`#assetLibraryPanel`/对话框内、Agent 节点面板未打开、**没有可见的 `.el-overlay`/`.el-popper` 等浮层**；有选中/框选/画布内文字选区时只 `removeSelectedElements()`，否则 `requestExitProject()`。

## R 结果

- `apps/web` / `apps/server` / `nodeScaffold` typecheck 通过（web 仅既有 singleAgent 报错）。
- `./scripts/deploy-local.sh --build` 成功，10 个节点包重建并同步到 `/Applications/toonflow-data/nodes`。
- transfer 接口在独立服务进程上实测 7 个场景全部符合预期（复用 / 改名 / 新复制 / 缺失 / 管理目录跳过 / 穿越拒绝 / 空列表 400）。

## 关键坑

- Element Plus 用 Esc 关弹窗时**不会** `preventDefault`，所以判断「Esc 已被别人消化」不能靠 `defaultPrevented`，必须自己扫可见浮层，否则下拉打开时按 Esc 会同时弹退出确认。
- `nodeSkeleton` 的 `busy` 是唯一全节点一致的运行信号（`status:'generating'` 只在节点包内部返回，宿主拿不到）。
- 跨目录复制不能复用现有 `/copy`：那条接口把目标强制解析到源目录之下。

## 评审修正（同日第二轮）

- **切换前必须做页面级保存**：`workspace/index.vue` 的目录 watcher 会 `documentPanelCache.cancelSave()`，只 flush 画布会丢掉文档防抖窗口内的编辑；改为 `provide("flushWorkspaceSave", flushSave)`（文档 + 画布），`switchProject` 优先用它。
- **运行判定不能有副作用**：`hasBusyNodes()` 里剪枝会把后台画布正在跑的任务当幽灵删掉，改为纯查询。
- **Esc 要认识自定义浮层**：`agentPortMenu`、`edgeDisconnect` 不是 el-popper，扫不到，得显式判断；画布内文字选区要在清选分支里 `removeAllRanges()`，否则第二次 Esc 仍落回清选分支。
- **搬运接口的边界**：管理目录判断要先把 `./library/x` 规范化；目标端也要 `protectWorkspaceLibraryPath`；只锁 target 不锁 source（源可能正被节点写入）；单文件失败入 `failed` 继续处理，不再整批抛错。
- **搬运时机**：插件可用性校验必须在搬运之前，否则粘贴注定失败却已在目标项目留下孤儿素材；`readClipboardNodes` 增加 `validate` 回调。
- **busy 覆盖补齐**：`imageNode`（上传/打光/多角度/全景/宫格/重绘）、`frameAnalysisNode`（+uploading）、`videoNode`（+uploading）。
