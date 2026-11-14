# 测试结果：禁用节点恒在画布下层

- 时间：2026-11-13 01:42
- 对应方案：`2026-11-13-01-42-disabled-node-bottom-layer.md`

## 1. 代码级验证

| 项 | 方法 | 结果 |
| --- | --- | --- |
| 类型检查 | `bun run --filter '@toonflow/web' typecheck` | 仅剩既有 `@/agentRuntime` 报错，本次改动零新增 |
| 构建 | `bun run --filter '@toonflow/web' build` | 成功，产物同步到 `/Applications/toonflow-exec.app/Contents/Resources/app/views/mainview/`（01:42） |
| 层叠规则确认 | 读 `@vue-flow/core` dist：`zIndex = node.zIndex ?? style.zIndex ?? 0`，选中 `+1000`，分组 `max(父,子)+1` | 与方案一致 |
| 层叠上下文安全性 | `.vue-flow__transformationpane`（transform，z-index 2）自成上下文，`.vue-flow__pane`（z-index 1）在其外 | 负 z 节点仍在画布背景之上，不会被吞掉 |
| zIndex 唯一写入点 | 全仓 grep `.zIndex` | 只有新增的 watch 写节点 zIndex，无冲突 |

## 2. 逻辑推演（待用户实机确认）

| 场景 | 期望 |
| --- | --- |
| 禁用后加入的节点 | 沉到更早的启用节点之下 |
| 解除禁用 | 立即回到普通层，删除 zIndex |
| 选中被压下去的禁用节点 | z 变 999，浮到未选中的启用节点（0）之上，可拖动/右键 |
| 同时选中启用节点与禁用节点 | 禁用节点 999 < 启用节点 1000，仍在下 |
| 撤销/重做禁用 | `setNodes` 替换节点对象 → watch 依赖含节点数组 → zIndex 重算 |
| 粘贴禁用节点副本 | `addNodes` 改变数组 → 重算；副本数据里带 disabled 则同样沉底 |
| 分组内禁用节点 | 仍需盖在分组本体之上（Vue Flow `max(父,子)+1`），不被分组底色遮住 |
| 保存并重开画布 | 层级由 data.disabled 重新派生，与保存前一致 |
| 按住未选中的禁用节点直接拖动 | 拖动期间临时抬到 999 可见；松手（或切画布/失活打断）后收回 -1 |
| 保存后的画布 JSON | 不含 `zIndex` 字段（`stripDerivedNodeFields`）；剪贴板同样不带 |

## 2.1 子 agent 审查结论（2026-11-13 02:05）

无 P0。P1「zIndex 仍写进画布文件与剪贴板」已修（保存剥离 + 剪贴板解构补字段）；
P2「未选中直接拖动不浮起」已修（拖动临时抬升 + 停止/打断收回）；
P2「连线判定带抢事件」「三处运行态字段清单重复」记录为已知取舍与后续重构，未在本轮处理；
另修正了文档中关于层叠上下文的表述。

## 3. 待确认

- 实机观感（重叠区域、选中矩形、框选、右键菜单是否仍按预期命中）。
- 子 agent 代码审查结论见下（若有 P0/P1 会在实施中补齐）。

## 4. 用户验收

（待用户填写）
