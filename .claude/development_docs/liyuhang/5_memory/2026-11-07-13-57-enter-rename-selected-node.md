# 记忆：画布单选节点按 Enter 重命名

- 时间：2026-11-07 13:57（14:10 部署）
- 类型：功能增强（画布快捷键 / 跨 UMD 契约）

## STAR

**Situation（背景）**
画布上点击节点只会选中，焦点不会进入任何输入框；按 Enter 没有反馈，改名只能双击标题或右键菜单，手要移到节点标题上。

**Task（任务）**
选中单个节点后按 Enter 直接进入标题编辑，对齐 Finder；多选不响应，Enter 与「清除未读提醒」上下文互斥，改名可撤销。

**Action（行动）**
- `packages/nodeScaffold/src/nodeRename.ts`（新）：`Symbol.for("toonflow.nodeRename")` 注册表，沿用 nodeRun 的「只注销自己」语义。
- `nodeSkeleton.vue`：按 `readOnly` 维护注册；`editLabel` 增加文档视图守卫；标题 tooltip 改为「双击或按 Enter 编辑名称」。
- `groupNode.vue`：分组节点注册同样的入口，同样随 `readOnly` 维护。
- `canvas/index.vue`：裸 Enter + 单选 + 未禁用 + 有入口 → `renameNode`；复用 editing/inCanvas/Agent 面板守卫；新增 `hasModalOverlay()` 门控。
- 撤销复用现有 `[data.label, data.disabled]` watcher，无需新接口。
- 单测 3 条注册表语义；全量重建 11 个节点 UMD 与 web 并同步。

**Result（结果）**
web 86 单测通过，typecheck 仅剩既有 `@/agentRuntime` 报错；11 个 UMD 均含 `toonflow.nodeRename`，已同步应用与 `data/nodes`（旧包备份在 `build/desktop/nodes-backup-20261107/`）；web 已同步；**未重启**。

## 关键经验

1. Enter 已被「清除未读提醒」占用，但两者上下文互斥（空选 vs 有选区）；扩展裸键前先确认原消费者的精确条件，而不是直接改键。
2. 节点内部行为要跨 UMD 暴露时，继续用 `Symbol.for` 注册表；这是 nodeBusy、nodeRun 之后的第三例，模式已经稳定。
3. 只读预览绝不能注册重命名入口，否则会覆盖画布实例；注册要跟随 `readOnly` 变化增删。
4. 弹窗打开时焦点可能落在弹窗容器而不是输入框，`editing` 判定拦不住；重命名这类「会展开隐藏输入框」的动作必须加可见浮层门控。
5. 节点被 teleport 到文档视图时标题栏是隐藏的；`editLabel` 不守卫会留下无法聚焦的编辑态。
6. 所有仓库节点 UMD 都内联 nodeSkeleton，改骨架必须全量重建；手工安装的节点包不会同步更新，只能接受 Enter 无操作。
