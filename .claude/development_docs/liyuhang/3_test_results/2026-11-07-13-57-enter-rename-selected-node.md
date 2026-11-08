# 测试结果：画布单选节点按 Enter 重命名

- 时间：2026-11-07 13:57（14:10 部署）
- 对应：`../1_requirements_matrix/2026-11-07-13-57-enter-rename-selected-node.md`、`../2_requirements_solutions/2026-11-07-13-57-enter-rename-selected-node.md`

## 1. 自动化

| 项目 | 结果 |
| --- | --- |
| `bun test`（apps/web） | 86 pass / 0 fail（新增 3 条注册表用例：注册/查询/注销、只清自己、未注册返回 undefined） |
| typecheck（apps/web） | 仅剩既有 `@/agentRuntime` 报错 |
| typecheck（nodeScaffold） | 通过 |
| `bun run build:nodes` | 成功；11 个仓库节点 UMD 均含 `toonflow.nodeRename` |
| `bun run --filter @toonflow/web build` | 成功 |
| 部署 | 11 个 UMD 已同步到 `/Applications/toonflow-data/nodes/` 与仓库 `data/nodes/`；旧包备份在 `build/desktop/nodes-backup-20261107/`；web 已同步到 `views/mainview/`（14:10）；**未重启应用** |

## 2. 代码评审（子 agent）

- P2 节点提示词「展开编辑」弹窗打开时，焦点可能落在弹窗容器而不是输入框；此时按 Enter 会在弹窗背后进入标题编辑。已给重命名加 `hasModalOverlay()` 门控，与项目/画布下拉一致。
- P2 交付缺口：评审时节点 UMD 尚未同步；已在 14:10 完成同步（应用目录 16 个 UMD 中 11 个仓库节点带注册表，其余为手工安装节点）。
- P3 `groupNode` 的注册不随 `readOnly` 变化：已改成与 nodeSkeleton 相同的 watch 维护。
- 确认无问题：输入框/按钮/contenteditable/Agent 面板/弹窗内不触发；IME 组合与按住重复被正确拦截；单选之外的选区不触发；禁用节点与只读预览不注册；标题 span 自带 Enter 与宿主捕获的重复调用无副作用；改名经现有 `data.label` watcher 进入撤销历史。

## 3. 待人工验证（需重启应用）

1. 点击单个生成节点（焦点不在输入框）按 Enter：标题进入编辑并全选。
2. 修改后 Enter 确认；⌘Z 恢复原名；Esc 取消不改名。
3. 框选多个节点按 Enter：不进入改名。
4. 空选、焦点在画布空白处按 Enter：仍清除未读提醒。
5. 焦点在节点提示词输入框按 Enter：正常换行，不进入改名。
6. 打开「展开编辑提示词」弹窗按 Enter：不进入改名。
7. 单选分组节点按 Enter：分组名进入编辑。
8. 单选禁用节点按 Enter：不进入改名。
9. 双击标题改名仍可用，标题 tooltip 显示「双击或按 Enter 编辑名称」。

## 4. 已知边界

1. 应用数据目录中手工安装的节点包（depthCaptureNode、execNode、imageResizeNode、videoPostNode、webEpisodeEditorProNode 等）未重建，不注册重命名入口，Enter 无操作。
2. 注册表按 nodeId 共享，与 nodeRun 相同；单窗口同时挂载多画布且节点 id 重复时，后挂载者覆盖。
3. 节点被 teleport 到文档视图时标题栏隐藏，`editLabel` 直接返回，不进入编辑态。
