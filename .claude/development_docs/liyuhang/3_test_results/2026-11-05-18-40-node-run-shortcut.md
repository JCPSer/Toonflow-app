# 测试结果：⌘Enter 运行选中节点

- 时间：2026-11-05 18:40（18:48 部署）
- 对应：`../1_requirements_matrix/2026-11-05-18-40-node-run-shortcut.md`、`../2_requirements_solutions/2026-11-05-18-40-node-run-shortcut.md`

## 1. 自动化

| 项目 | 结果 |
| --- | --- |
| `bun test src/lib/canvasShortcuts.test.ts` | 14 pass / 0 fail（新增 2 条：默认 ⌘Enter 与裸 Enter 不冲突；必须带主修饰键） |
| `bun test src/lib/nodeRun.test.ts` | 3 pass / 0 fail（注册/查询/注销、只清自己那份、未注册返回 undefined） |
| `bun test`（apps/web 全量） | 66 pass / 0 fail |
| typecheck（web） | 仅剩既有 `@/agentRuntime` 报错 |
| typecheck（nodeScaffold） | 通过 |
| typecheck（四个节点包，vue-tsc） | 全部通过 |
| `bun run build:nodes` | 成功；四个节点 UMD 均含 `toonflow.nodeRun` |
| `bun run --filter @toonflow/web build` | 成功 |
| 部署 | 四个 UMD 已同步到 `/Applications/toonflow-data/nodes/` 与仓库 `data/nodes/`（旧包备份在 `build/desktop/nodes-backup-20261105/`）；web 已同步到 `views/mainview/`（18:48）；**未重启应用** |

## 2. 代码评审（子 agent）

- P0 仓库 `data/nodes` 下的 UMD 是旧版：已一并同步到仓库 data 目录（dev 模式用），应用数据目录按 18:48 覆盖。
- P1 三个节点的运行函数返回生成状态对象，`run?: () => void | Promise<void>` 类型不兼容：改为 `() => unknown`，四个节点包 `vue-tsc` 全部通过。
- P1 提示词的「展开编辑」是 teleport 到 body 的 dialog，被 `role=dialog` 排除导致不能用：对 `.promptEditorDialog` 单独放行，其它弹窗不变。
- P2 `watch([() => props.run, nodeId])` 里 nodeId 是普通字符串：改为只 watch `props.run`。
- P2 提及候选弹层忽略 `defaultPrevented`：`promptInput` 的键盘处理增加提前返回。
- P2 注册表未按画布隔离：与现有 nodeBusy 一致的已知边界（单窗口一次只激活一个画布）。
- P2 文本节点未填提示词时静默返回：与点按钮一致，保留。
- P2 测试缺口：`runSelectedNodes` 涉及宿主上下文，暂用人工验收覆盖。

## 3. 待人工验证（需重启应用）

1. 选中图片/视频/音频/文本生成节点按 ⌘Enter：开始生成；节点进入运行态。
2. 焦点在节点提示词输入框内按 ⌘Enter：开始生成，且不会插入换行。
3. 框选多个生成节点按 ⌘Enter：全部并行开始。
4. 选中运行中的节点再按 ⌘Enter：不重启也不停止。
5. 选中便签/素材/Agent 节点按 ⌘Enter：提示「没有可运行的生成任务」。
6. 设置 → 通用 → 画布快捷键：「运行选中节点」显示 ⌘Enter，可改键、可清空，冲突有提示。
7. 打开设置对话框 / 焦点在 Agent 面板输入框时按 ⌘Enter：不触发画布节点。
8. 清空绑定后按 ⌘Enter：不触发。

## 4. 已知边界

1. 只有四类生成节点响应；帧分析的「分析」、Agent 发送等不算「运行」。
2. 节点必须挂载在画布上才会注册（隐藏/未渲染节点无入口）。
3. 上游被禁用、未填提示词、未选模型时，快捷键走节点自身守卫：可能静默返回或提示，和点按钮一致。
4. 快捷键在节点输入框内生效，因此输入框里想换行只能用 Enter/Shift+Enter，⌘Enter 会被用于运行。
