# 测试结果：Agent 交互六项改造

- 记录时间：2026-10-29 11:30
- 关联：`1_requirements_matrix/2026-10-29-11-30-agent-interaction-batch.md`、`2_requirements_solutions/2026-10-29-11-30-agent-interaction-batch.md`

## 一、静态验证

| 项 | 结果 |
| --- | --- |
| `apps/web typecheck` | 仅既有 `server/.../singleAgent/types.ts(2,33)` |
| `apps/server typecheck` | 通过 |
| `deploy-local.sh --build` | 成功（含新增「安装内置工具（Resources）」步骤） |

## 二、运行中实测（真实应用，Chrome 直连本地服务 127.0.0.1:50844）

| 项 | 修复前 | 修复后 |
| --- | --- | --- |
| `.senderActions` 首个节点 | 注释占位（模型区未渲染） | 正常渲染 |
| `.modelPopover` / `.modelButton` 数量 | 0 / 0 | 2 / 2 |
| 模型按钮文本 | — | `deepseek-v4.1-flash · 默认` |
| `.voiceButton` 数量 | 2（不可关闭） | 2（受开关控制） |

说明：两个面板（浮动 Agent、画布 Agent 节点）各一份，修复前两边都缺，与用户描述一致。

## 三、产物核对

| 项 | 证据 |
| --- | --- |
| 队列与打断 UI | `views/mainview/assets/workspace-*.js` 含 `queueButton`、`待发送` |
| 目标循环 | 同一 chunk 含 `GOAL:DONE`、`目标循环已暂停` |
| 工具开关 | `build/tools/mediaGeneration.tool.js` 与 `Resources/app/tools/mediaGeneration.tool.js` 均含 2 处 `allowVoiceInput`（schema + 开关标题） |
| 部署补齐 | `deploy-local.sh` 输出新增「安装内置工具（Resources）」 |

## 四、待手测清单（需重启应用）

1. 右侧浮动 Agent 面板与画布 Agent 节点面板都能看到模型下拉，切换后本轮回合生效。
2. 设置 → 媒体生成控制 → 关闭「显示语音输入按钮」→ 输入框麦克风消失；长按输入框也不再进入语音（需重启一次让内置工具同步到数据目录）。
3. `@` 输入 → 选一个 Agent 节点 → 引用气泡出现；发送后模型能看到 summary 与 files 索引。
4. 画布 Agent 节点：输入一半关面板，再点开内容仍在；删除节点后实例被回收。
5. `/compact` 触发压缩；`/goal 写一个三分钟短片大纲` → 目标条出现，每轮结束自动回顾，达成后提示并停止；`/goal stop` 暂停、`/goal reset` 归零、`/goal off` 清除。
6. 生成中继续打字 → 点箭头入队（角标 +1）→ 本轮结束后自动发出；点 ⚡ 立即发送 → 当前轮被中断并立刻发出；点停止 → 队列保留不续发。

## 五、指令补全实测（运行中）

在输入框输入 `/g` 后：

- `.commandHints` 出现 5 条：`/compact`、`/goal `、`/goal stop`、`/goal reset`、`/goal off`，点击可回填；
- 技能菜单被抑制（`/go` 不会再显示无关技能）。

## 六、目标持久化的两个边界（已处理）

1. **新会话还没有会话文件**：此时 `/goal` 只存在内存；第一次回复生成文件名后被 `loadGoal` 覆盖成空。改为记录 `goalOwner`——内存目标在会话文件出现时主动落盘。
2. **重新打开旧会话**：`goalOwner !== sessionFile` 时从磁盘读；文件不存在则清空，避免上一个会话的目标串到新会话。

## 七、待手测补充

- `/goal 目标` 设定后应立即触发第 1 轮（不再需要手动发一条"开始"）。
- 目标条上的「暂停 / 继续 / 清除」与 `/goal stop|reset|off` 等价。

## 八、子 agent 探索结论的落地修正

| 探索结论 | 处理 |
| --- | --- |
| 面板是 `v-for entries + v-show`，草稿全在 messageInput 组件内，卸载即丢 | 与实现一致：有草稿不卸载；但 `unmountIfIdle` 早退会让 `statuses[nodeId]` 停在运行态 → 在 `close()` 里补 `statuses[target] = "idle"`（运行中除外） |
| 节点删除时 `nodeIdsKey` 只 `close()` + 清 statuses，不会删 entry；有草稿的实例继续存活会泄漏 | 在同一 watcher 里显式 `delete entries/panelElements/conversationElements`（仅对已不存在的节点） |
| 切画布时节点集合整体变化，带草稿的 entry 会跨画布串会话 | `props.canvasId` 变化时整体清空 entries 与两个 Map |
| `configRules` 来自构建期元数据，`configSchema` 是 strictObject，两处都要加 | 已同时加 `allowVoiceInput`，并补 `deploy-local.sh` 安装内置工具 |
| 只隐藏按钮不够，长按由容器 `pointerdown.capture` 触发 | 已用 `useVoiceInput({ enabled })` 在 `armVoiceInput` 首行拦截 |
| 非本机请求 `/api/tools/get` 返回空 config | 语音开关在手机/远程端按"开"处理（默认值），桌面端生效 |
| 主会话不支持 steer（只有子 Agent 会话可 steer），停止靠前端 abort | 打断发送仍走 abort + 409 退避重试；队列续发发生在本轮 `done` 之后，不依赖 steer |
| Agent 节点本来就在 `@` 列表里（无输出 → 降级为引用节点本身） | 前端无需改动，只在服务端补全 `agent` 内容 |
