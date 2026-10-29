# 测试结果：项目快速切换 + 跨项目粘贴带文件 + 画布 Esc 退出确认

- 记录时间：2026-10-29 10:30
- 关联：`1_requirements_matrix/2026-10-29-10-30-project-switcher-cross-project-paste-esc-exit.md`、`2_requirements_solutions/2026-10-29-10-30-project-switcher-cross-project-paste-esc-exit.md`

## 一、改动清单

| 位置 | 改动 |
| --- | --- |
| `apps/server/src/routes/workspaces/files/transfer.ts`（新） | `POST /api/workspaces/files/transfer`：跨目录逐文件搬运，同路径同内容复用、不同内容改名 `-<8位id>`、管理目录跳过、缺失文件回报 |
| `apps/server/src/router.ts` | `route166` → `/api/workspaces/files/transfer` |
| `apps/web/src/lib/workspaceFiles.ts` | 新增 `transferWorkspaceFiles(source, target, paths)` |
| `apps/web/src/pages/workspace/panels/canvas/nodeClipboard.ts` | 跨项目时搬运文件并改写 `outputs[*].value.url`，返回 `transfers` 统计；移除"不能跨项目粘贴"硬拦截 |
| `apps/web/src/pages/workspace/panels/canvas/index.vue` | `switchProject()`（运行判断 → 保存 → 换目录 → 404 重定位）、`hasBusyNodes()`、`handleCanvasEscape()`、粘贴后提示复制数量 |
| `apps/web/src/pages/workspace/panels/canvas/components/canvasMenu.vue` | 项目名右侧 `⌄` 触发器 + 项目下拉（搜索 / 目录副标题 / 当前项勾选 / 切换中 loading） |
| `apps/web/src/pages/workspace/exitProject.ts`（新） | 退出确认单例（`visible`/`leaving`/`confirm`） |
| `apps/web/src/pages/workspace/components/exitProjectDialog.vue`（新） | 退出确认对话框（从 workspaceMenu 迁出） |
| `apps/web/src/pages/workspace/components/workspaceMenu.vue` | 退出按钮改调 `requestExitProject()`，删除本地对话框与路由逻辑 |
| `apps/web/src/pages/workspace/index.vue` | 渲染 `exitProjectDialog` |
| `packages/nodeScaffold/src/nodeBusy.ts`（新） | `Symbol.for("toonflow.busyNodes")` 全局运行登记表（引用计数 + 卸载清理 + 剪枝） |
| `packages/nodeScaffold/src/nodeSkeleton.vue` | `busy` 变化时登记/注销 |
| `packages/nodeScaffold/package.json` | 导出 `./nodeBusy` |

## 二、静态验证

| 项 | 结果 |
| --- | --- |
| `apps/web typecheck` | 仅既有 `server/src/modules/agentAccess/singleAgent/types.ts(2,33)` 报错 |
| `apps/server typecheck` | 通过 |
| `packages/nodeScaffold typecheck` | 通过 |
| `./scripts/deploy-local.sh --build` | 成功；节点包 10 个全部重建并同步到 `/Applications/toonflow-data/nodes` |

产物核对：

| 项 | 证据 |
| --- | --- |
| 项目下拉 | `build/web/assets/workspace-CvsZ76wy.js` 含 `切换项目`、`没有匹配的项目` |
| busy 登记表 | 同一 workspace chunk 含 `toonflow.busyNodes`；`build/nodes/textNode.umd.js`、`agentNode.umd.js` 各 1 处 |
| 搬运接口 | `build/desktop/main/index.js` 含 `files/transfer` |

## 三、接口实测（真实服务进程）

启动独立服务 `TOONFLOW_DATA_DIR=/tmp/tf-data TOONFLOW_SERVER_PORT=3111 bun src/index.ts`，在两个测试项目 `workspaces/a`、`workspaces/b` 上跑真实请求（curl 带 `x-toonflow-workspace: 1` + 同源头）。

准备数据：两项目各有 `assets/n1/same.png`（内容相同）、`diff.png`（内容不同），源项目另有 `fresh.png`。

| 场景 | 请求 | 实际结果 | 判定 |
| --- | --- | --- | --- |
| 同内容同名 | `same.png` | `action: "reused"`，目标文件未改动 | 通过 |
| 不同内容同名 | `diff.png` | 复制为 `diff-10e5749d.png`，`action: "copied"`；目标原 `diff.png` 仍是 `BBBB`（未被覆盖） | 通过 |
| 目标不存在 | `fresh.png` | 按原路径复制，`cmp` 与源文件逐字节一致 | 通过 |
| 源文件缺失 | `gone.png` | 进 `missing`，不报错、不影响其他文件 | 通过 |
| 应用管理目录 | `library/index.json`、`.toonflow/ui.json` | 进 `skipped`，目标未创建 `library/` | 通过 |
| 路径穿越 | `../../../etc/passwd` | 进 `missing`，未读取 | 通过 |
| 空列表 | `paths: []` | 400 参数错误 | 通过 |

清理：测试服务已停止，`/tmp/tf-*` 已删除。

## 四、待手测清单（需重启应用）

1. 画布左上角项目名右侧出现 `⌄`；点开是全项目列表，当前项目带勾、第二行显示目录；搜索可过滤。
2. 选另一个项目 → 当前画布先保存再切换；画布内容、Agent 会话、素材库都变成新项目；切换时 `⌄` 显示 loading。
3. 有节点在跑（例如图片生成、Agent 节点思考中）时切换 → 弹「有节点正在运行…是否继续切换」；取消后仍在原项目、任务继续。
4. 目标项目文件夹被删除后切换 → 弹「文件夹不存在，是否重新选择」，选到新目录后进入。
5. A 项目复制一名为「生成图片」的节点（输出有图），切到 B 项目粘贴 → 成功，图片正常显示，提示「已复制 N 个引用文件到当前项目」；B 项目原有同名文件未被改动。
6. 同项目内复制粘贴行为不变（不触发搬运、不提示）。
7. 画布空白处按 Esc → 弹「退出项目」确认；取消留在画布；点「退出项目」回首页。
8. 画布选中节点后按 Esc → 只清空选中，不弹确认；再按一次才弹。
9. 焦点在项目名输入框 / 画布下拉 / Agent 面板 / 素材库里按 Esc → 不弹退出确认。
10. Esc 与 Element Plus 弹窗共存：打开任一对话框时按 Esc 只关对话框。

## 五、代码审查与自查修正

| 发现 | 处理 |
| --- | --- |
| 素材库目录被 `skipped` 时用户没有任何提示，粘贴后会指向源项目路径 | 把 `missing + skipped` 合并成 `unavailable`，粘贴后提示「N 个引用文件无法复制（源文件缺失或位于素材库），引用保留原路径」 |
| 退出确认状态是模块级单例，工作区销毁后可能残留 | `exitProjectDialog` 卸载时 `cancel()` 复位 |
| Esc 在 Agent 面板 / 素材库 / 对话框内按下会误弹退出确认 | `handleCanvasEscape` 增加 `#agentPanel`、`#assetLibraryPanel`、`[role='dialog']`、`.el-overlay` 排除，并在 `hasVisibleOverlay()` 里扫可见浮层 |
| 切换项目时保存失败会让 `switchingProject` 卡住 | `finally` 复位；保存失败只提示不换目录 |
| `userSelectionRect` 未清会不会让 Esc 永远只清选择 | 该值在 `pointerup` 必被置空，不会长期残留；仅在拖动中二次 Esc 时重复清一次 |
| 切换后素材库是否串项目 | `useAssetLibrary` 有 `watch(directoryPath, resetForDirectory)`，store 也按目录分桶，无需额外处理 |
| 跨 UMD 的 busy 登记表 | 与既有 `toonflow.agentNodeStatus` 同构（`Symbol.for` + `globalThis`），节点包重建后 `textNode.umd.js` 内可见同一 key |

## 六、第二轮评审修正（2026-10-29 10:58）

子 agent 评审返回后按「高→中→低」逐条修正：

| 评审意见 | 处理 | 复核 |
| --- | --- | --- |
| 【高】`transfer.ts` 只按原始路径首段判断管理目录，`./library/x.png` 能绕过 | 新增 `topSegment()` 规范化后再比对，并在复制前对目标调 `protectWorkspaceLibraryPath` | 实测 `./library/x.png` 进 `skipped`，目标未生成 `library/` |
| 【高】切项目只 flush 画布，文档面板 watcher 会 `cancelSave()` 丢掉防抖窗口内的编辑 | 工作区页 `provide("flushWorkspaceSave", flushSave)`（文档 + 画布），`switchProject` 优先用它 | 类型检查通过；待手测「改文档后立刻切项目」 |
| 【高】`hasBusyNodes` 里做 `pruneBusyNodes` 会把后台画布上正在跑的任务当幽灵删掉 | 判断函数改为纯查询，不再剪枝 | 代码已无 prune 调用 |
| 【中】Esc 只扫 Element Plus 浮层，`agentPortMenu` / `edgeDisconnect` 两个自定义浮层不受保护 | 显式判断这两个状态后直接退出 | 代码核查 |
| 【中】搬运在插件校验之前发生，粘贴含未安装插件的节点会留下孤儿文件；任一文件失败整批抛错 | `readClipboardNodes` 增加 `validate` 回调，在校验后才搬运；服务端改为逐文件收集 `failed` 继续处理 | 实测：一条目标路径父级是文件 → 该条进 `failed`，其余三条照常复用/改名/复制 |
| 【中】锁住了只读 source，源文件正被写入时整批 409 | 只锁 target | 代码核查 |
| 【低】画布残留文本选区时 Esc 既不开退出也清不掉 | 清选分支补 `window.getSelection().removeAllRanges()` | 代码核查 |
| 【低】`projectPicker` ref 未使用；切换中画布列表/改名仍可操作 | 删除未用 ref；`switching` 期间禁用项目名输入与画布切换 | 代码核查 |
| 【其它】`imageNode` 未暴露 busy、`frameAnalysisNode` 漏 uploading、`videoNode` 漏 uploading | 三者补齐 `busy` 表达式 | 节点包已重建并同步（3 个 updated） |

第二轮接口实测（服务进程 3111）：

| 场景 | 结果 |
| --- | --- |
| `./library/x.png` | `skipped`，未写入目标 |
| `assets/n1/blocked/a.png`（目标父级是文件） | `failed`（ENOTDIR），其余文件不受影响 |
| `diff.png` | 复制为 `diff-9e80e78b.png`，目标原文件未变 |
| `same.png` | `reused` |
| `fresh.png` | 正常复制 |

构建部署完成（`deploy-local.sh --build`，节点包 3 个更新）。
