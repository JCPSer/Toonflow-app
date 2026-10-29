# 需求方案：项目快速切换 + 跨项目粘贴带文件 + 画布 Esc 退出确认

- 记录时间：2026-10-29 10:30
- 用户：liyuhang
- 需求矩阵：`1_requirements_matrix/2026-10-29-10-30-project-switcher-cross-project-paste-esc-exit.md`

## 一、总体思路

三件事分三层落地，互不侵入：

| 层 | 内容 |
| --- | --- |
| UI 层 | 画布左上角项目名右侧新增 `⌄` 触发器 → 项目下拉；项目下拉选中后调用统一的「切换项目」流程 |
| 状态层 | 新增「项目退出」单例（对话框状态 + 退出动作），供顶栏按钮与画布 Esc 共用；新增「节点运行中」全局登记表，供切换拦截使用 |
| 服务层 | 新增跨目录文件搬运接口，供跨项目粘贴复制素材并改写引用 |

## 二、UI 设计

### 2.1 画布左上角（`canvasMenu.vue`）

```
┌──────────────────────────────────────────────────┐
│ [项目名(可编辑)]  ⌄ │   [画布名  ⌄]              │
└──────────────────────────────────────────────────┘
        ↑ 新增：项目切换触发器（28px，text 按钮，仅图标）
```

点击 `⌄` 展开 320px 宽的浮层（与画布选择器同一套视觉：白卡片、`el-scrollbar`、hover 高亮、右侧勾选）：

```
┌──────────────────────────────┐
│ 🔍 搜索项目                  │
├──────────────────────────────┤
│ 赛博小镇                ✓    │  ← 当前项目
│ /Users/liyuhang/projects/...  │  ← 次要行：目录（截断，title 完整）
│ 短剧拍摄                      │
└──────────────────────────────┘
```

- 排序：`lastOpenedAt` 倒序（与首页一致）。
- 空搜索无结果时显示「没有匹配的项目」。
- 当前项目即使只有一项也在列表里，带 `✓`，点击后仅关闭浮层。
- 打开的浮层关闭：选中、点击外部、Esc（`@keydown.esc`）。

### 2.2 切换中的反馈

- 保存阶段：触发器显示 `loading`（复用 `busy` 状态，避免重复点击）。
- 有节点在跑：`ElMessageBox.confirm`（`type: "warning"`，确认「继续切换」，取消「留在当前项目」）。
- 目标目录不存在：`ElMessageBox.confirm` 提示，确认后走目录选择器重新定位；取消则不动。
- 切换成功：无提示（画面本身已变化）。
- 保存失败：`ElMessage` 报错，保留在当前项目。

## 三、子方案

### S1 项目下拉（R1）

**数据**：`workspaceStore.projectList`（持久化，已有）+ `workspaceStore.project`。
**新增状态**：`projectListVisible`、`projectQuery`。
**计算**：`filteredProjects = projectList 按 lastOpenedAt 倒序，按名称/目录模糊过滤`。

伪代码：

```
点击 ⌄ → projectListVisible = true；焦点落在搜索框
点击某一项 →
    if 该项.directory == 当前项目.directory: projectListVisible = false; return
    projectListVisible = false
    emit("switchProject", 该项)
```

`canvasMenu` 只负责“选择”，不改 store：`emit("switchProject", project)`，由 `canvas/index.vue` 统一处理（见 S2），这样运行判定、保存、错误提示都在画布层完成，`canvasMenu` 保持纯展示。

### S2 切换项目流程（R2）

`canvas/index.vue` 新增 `switchProject(project)`：

```
switchProject(target):
    if target.directory == 当前 project.directory: return
    if hasRunningNodes():                          # 运行判定见下
        if !await confirm("有节点正在运行…是否继续"): return
    switching = true
    try:
        await flushSave()                          # 画布 + 节点状态全部落盘；抛错则中止
        await workspaceStore.openProject(target.directory)   # 内部走 /api/workspaces/check
    catch err:
        if 404（文件夹不存在）:
            if await confirm("项目文件夹不存在，是否重新选择？"):
                dir = await 目录选择器 (workspacePicker.chooseDirectory)
                if dir: await workspaceStore.openProject(dir, target.directory)
        else: ElMessage.error(err.message)
    finally: switching = false
```

**重挂载**：`workspace/index.vue` 已用 `:key="workspaceStore.project?.directory"` 绑定 `canvasPanel`、`documentPanel`；`floatingAgent` 内部 `watch(project.directory)` 会清空会话并重载历史；素材库面板 `floatingAssetLibrary` 需要核对是否按目录重建（评审项，见风险 R1）。

**运行判定**：新增全局登记表。

- 位置：`packages/nodeScaffold/src/nodeSkeleton.vue`。
- 原因：所有节点类型都通过 `:busy` 把“耗时任务进行中”交给骨架卡片，这是唯一一个全节点一致的运行信号。
- 实现：`Symbol.for("toonflow.busyNodes")` 挂在 `window` 上的 `Map<nodeId, number>`（引用计数），`watch(busy)` 增减，`onScopeDispose` 清理。跨 UMD 包共享，做法与既有 `toonflow.agentNodeStatus` 相同。
- 读取：`canvas/index.vue` 暴露 `hasRunningNodes()` = 登记表非空，或 `agentNodeStatuses` 中存在 `thinking` / `running`（双保险）。

### S3 跨项目粘贴带文件（R3）

**服务端**：新增 `POST /api/workspaces/files/transfer`。

```
入参：{ sourceDirectory, targetDirectory, paths: string[] }   # paths 为项目内相对路径
对每个 path：
    src = resolveWorkspaceFile(req, sourceDirectory, path)      # 已存在的普通文件，否则 404
    dstRel = path
    dst = resolveWorkspacePath(targetRoot, dstRel, allowMissingParents = true)
    保护：dst 顶层命中 .toonflow / library / library-assets → 跳过并记为 skipped
    if dst 已存在:
        if size 相同 且 sha256 相同: 记 reused，continue
        else: dstRel = `<base>-<8位短id>.<ext>`（循环直到不存在），dst 重算
    mkdir -p 父目录
    lockWorkspaceFiles([src, dst]) → copyFile(COPYFILE_EXCL) → release
        EBUSY 重试 3 次（200/400/800ms）
返回：{ files: [{ source, target, action: copied|reused }], skipped: [path], missing: [path] }
```

要点：

- 目标根用 `resolveWorkspace(req, targetDirectory)` 解析，源根用同一函数解析，二者都受既有的本机/工作区白名单约束，越不过现有安全边界。
- 内容比对先比大小再比哈希，避免对大视频无谓读全文件。
- 用 `COPYFILE_EXCL` 兜底，任何竞态都不会覆盖目标文件。

**前端**：

1. `lib/workspaceFiles.ts` 新增独立导出 `transferWorkspaceFiles(sourceDirectory, targetDirectory, paths)`（直接带两个目录调用，不依赖当前项目上下文）。
2. `nodeClipboard.ts` 的 `readClipboardNodes`：
   - 保留原检测：收集 `data.outputs[*].value.url` 里“非绝对地址”的路径。
   - 源目录 == 目标目录 → 原样返回（现有行为）。
   - 源目录 != 目标目录 → 调 `transferWorkspaceFiles`，用返回的 `source → target` 映射**改写**节点数据里的 `outputs[*].value.url`；`missing`/`skipped` 保留原路径。
   - 源目录不可访问（目录被删/无权限）→ 抛出可读错误「源项目文件夹不可用，无法复制引用的文件」。
   - 返回值增加 `transferred: number`，由 `canvas/index.vue` 在成功后提示「已复制 N 个文件到当前项目」。
3. 不改 `pasteClipboardNode` 的节点注入逻辑（id 重映射、父节点、边）——复制在读取阶段完成，粘贴仍是纯内存操作。

### S4 Esc 退出确认（R4）

**共享状态**：新增 `apps/web/src/pages/workspace/exitProject.ts`（模块级单例，工作区只有一个）：

```
visible / leaving 两个 ref
requestExit()  → visible = true
cancel()       → visible = false
confirm()      → leaving = true; await router.push("/home"); leaving = false
```

新增 `components/exitProjectDialog.vue`：把 `workspaceMenu.vue` 里现有的对话框原样搬过来（标题「退出项目」、文案、取消/退出按钮），由 `workspace/index.vue` 渲染一次。

`workspaceMenu.vue` 的退出按钮改为 `requestExit()`，删除本地 `exitVisible` 与路由逻辑。

**Esc 接入点**：`canvas/index.vue` 的 `updateCanvasKeys`（window 捕获阶段，已有 `defaultPrevented` 判断）。

```
on keydown && key == "Escape" && !defaultPrevented && !isComposing:
    handleCanvasEscape(event)

handleCanvasEscape(event):
    if !props.active || props.settingsVisible || document.fullscreenElement: return
    if 焦点在可编辑元素（input/textarea/contenteditable/role=textbox）: return
    if 有任何可见弹层（.el-overlay / .el-popper / .el-dropdown / .el-select__popper 未隐藏）: return
    if Agent 节点面板打开（panelOpen）: return        # “激活了节点”
    if 有节点/边选中 或 框选区域 或 画布内文字选区:
        event.preventDefault(); flow.removeSelectedElements(); return   # 第一次 Esc 只清选择
    event.preventDefault()
    requestExit()
```

要点：

- 放在 `editing` 早退之前处理：工具条按钮获得焦点时也要能 Esc 退出。
- Element Plus 的 Esc 关闭弹窗**不会** `preventDefault`，所以不能只靠 `defaultPrevented`；必须显式扫描可见浮层。
- 不改 Vue Flow 的节点/边 a11y Esc（仅元素聚焦时生效，与我们的路径不冲突）。
- 退出确认对话框自身打开时，再按 Esc 由 Element Plus 关闭它，我们的扫描能识别到 overlay 而不再重复弹。

## 四、改动清单

| 文件 | 改动 |
| --- | --- |
| `apps/web/src/pages/workspace/panels/canvas/components/canvasMenu.vue` | 项目名右侧 `⌄` 触发器 + 项目下拉（搜索/勾选/当前项）；`emit("switchProject")`；`busy` 复用为切换中状态 |
| `apps/web/src/pages/workspace/panels/canvas/index.vue` | `switchProject()`（保存 → 拦截 → 切换 → 404 重定位）；`hasRunningNodes()`；Esc 处理；粘贴成功提示 |
| `packages/nodeScaffold/src/nodeSkeleton.vue` | busy 引用计数登记到 `Symbol.for("toonflow.busyNodes")` |
| `apps/web/src/pages/workspace/exitProject.ts`（新） | 退出项目单例状态 + 动作 |
| `apps/web/src/pages/workspace/components/exitProjectDialog.vue`（新） | 退出确认对话框 |
| `apps/web/src/pages/workspace/index.vue` | 渲染 `exitProjectDialog`；画布 `@switchProject` 不需要（内部处理） |
| `apps/web/src/pages/workspace/components/workspaceMenu.vue` | 退出按钮改调 `requestExit()`；删除本地对话框 |
| `apps/web/src/pages/workspace/panels/canvas/nodeClipboard.ts` | 跨项目：搬运文件 + 改写 url + 返回 `transferred` |
| `apps/web/src/lib/workspaceFiles.ts` | 新增 `transferWorkspaceFiles()` |
| `apps/server/src/routes/workspaces/files/transfer.ts`（新） | 跨目录搬运接口 |
| `apps/server/src/router.ts` | 挂载新路由 |

## 五、风险与对策

| 风险 | 对策 |
| --- | --- |
| 切换后某些面板仍指向旧项目（素材库/文档/画布缓存） | 实施前逐一确认 `floatingAssetLibrary`、`documentPanel`、`canvasList` 的目录依赖；必要时加 `:key` 或 `watch(directory)` 重置 |
| busy 登记表出现幽灵条目导致永远拦截 | 节点卸载 `onScopeDispose` 清理；切换前再兜底一次「超过 0 条且节点已不存在」的清理不可靠，改为切换失败提示手动继续（确认框本身可绕过） |
| 跨项目复制时源目录不可读 | 明确报错文案，不静默粘贴失效引用 |
| 粘贴改写漏改导致节点指向旧路径 | 只改 `outputs[*].value.url` 且严格按服务端 return 的映射；未命中映射的原样保留 |
| Esc 与弹层冲突导致误弹退出 | 显式可见浮层扫描 + 焦点/选区/面板三重前置判断 |
| 大文件复制阻塞 UI | 服务端搬运，前端只等一次请求；接口对每个文件独立加锁，失败不整体回滚 |

## 六、评审意见

| 角色 | 意见 | 结论 |
| --- | --- | --- |
| 用户 | （待填写） | |
| 子 agent 初评 | （待填写） | |
