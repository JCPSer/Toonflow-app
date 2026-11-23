# 需求方案：Agent 派发队列可视化与撤销

- 时间：2026-11-17 21:40
- 关联需求矩阵：`1_requirements_matrix/2026-11-17-21-34-agent-queue-visibility.md`
- 用户选择：可见 + 撤销（不做插队 / 立即发送）

## 背景与目标

队列在 `createAgentDispatcher` 内部，是页面内存中的 `queue: Task[]`，生命周期等于画布组件挂载期。当前对外只暴露 `links`（关系箭头）与 `statuses`。本方案把队列以**只读快照**形式暴露给画布宿主，并新增一个撤销动作与限时提示，不改动调度、打断、并发逻辑。

## 设计总览

```
dispatcher（唯一事实来源）            画布宿主                    UI
queue: Task[]  --syncQueueView-->  queueView: Ref<QueuedTaskView[]>  --> agentQueuePanel
queueNotices: Ref<QueueNotice[]>   queueNotices                      （徽标 + 展开列表）
cancelQueued(taskId) <-------------- @cancel --------------------------
```

快照而不是共享引用，原因：`Task` 内含 `AbortController`、`controller.signal` 等不可渲染字段，且任务对象是内部可变状态；让 UI 直接持有会让「渲染」与「调度」互相污染。快照在每次队列变更点重建，代价可忽略（队列上限实际为单位数）。

## 数据结构

```
QueuedTaskView {
  taskId, kind: "task" | "result",
  fromNodeId, fromLabel, toNodeId, toLabel,
  message（截断 160 字，完整文本放 title）,
  queuedAt, reason
}
QueueNotice { id, text, at }
```

`reason` 在生成快照时按当前调度状态判定，优先级：
1. `preempting` 命中目标 → 「等待上一轮收尾」
2. `running` 中存在目标 → 「目标正在执行其他任务」
3. `panelRunning` 命中目标 → 「目标面板正在运行」
4. `running.size >= MAX_RUNNING` → 「并发已满」
5. 其余 → 「等待调度」

## 方案细节

### 1. dispatcher 变更（`agentDispatcher.ts`）

- `Task` 增加 `queuedAt`；`enqueueFromEvent` / `enqueueResultTo` 入队时写入 `Date.now()`。
- 新增 `queueView = ref<QueuedTaskView[]>([])`、`queueNotices = ref<QueueNotice[]>([])`、`syncQueueView()`。
- `syncQueueView()` 调用点：`pump()` 末尾、`enqueueFromEvent` 替换段之后（替换即时可见）、`enqueueResultTo`、`moveToFront`、`finish`（经 `pump`）、`stop`、`cancelQueued`、`dispose`。原则：**任何 splice/push 都要落到快照**。
- 提示：
  - 替换：在同发送方清旧队列时收集被替换条目的收件人标签，`notifyQueue("「A → B」的旧排队消息已被同一 Agent 的新消息替换")`。
  - 去重：命中 60 秒窗口时，若该键的 `seen` 时间戳尚未提示过（用 `dedupeNoticeAt: Map<string, number>` 记录），提示一次「60 秒内重复的相同消息已忽略」。
  - 提示列表上限 3 条，8 秒后自动移除；定时器纳入 `flashTimers` 同类清理集合（新建 `noticeTimers`，`dispose` 时清空）。
- 新增 `cancelQueued(taskId): boolean`：
  1. 只在 `kind === "task"` 且仍在队列中时生效；
  2. `queue.splice`、释放 `dedupeKey`、`removeLink(taskId, "dispatch")`；
  3. `task.interruptReason = "排队中被用户撤销"`，`void deliverCancelNote(task, { queued: true })`；
  4. `notifyQueue` 确认、`syncQueueView()`、`pump()`。
- `deliverCancelNote(task, options?: { queued?: boolean })`：queued 时文案为「在排队中被用户撤销，尚未开始执行」，仍走 `/api/agent/note`，不触发父会话运行；其余保持原逻辑。
- 返回值增加 `queueView`、`queueNotices`、`cancelQueued`；`queue` 本身不出暴露。

### 2. 新增组件 `components/agentQueuePanel.vue`

UI（左下角，展开态向上生长）：

```
┌ 排队中的派发 · 3 ───────────── 收起 ┐
│ ⚠ 「导演 → 编剧」的旧消息已被替换     │  ← 限时提示
│ 导演 → 编剧      目标正在执行其他任务 · 12s   [撤销] │
│   把第三场改成夜戏……                    │
│ 审核 → 分镜      并发已满 · 48s        [撤销] │
│   检查分镜一致性……                      │
└──────────────────────────────────────┘
                         （收起时）[ 排队 3 ]
```

- props：`items: QueuedTaskView[]`、`notices: QueueNotice[]`；emit：`cancel(taskId)`。
- 只有 `items.length || notices.length` 时渲染；为空自动隐藏，展开态自动收起。
- 撤销二次确认：第一次点变成「确认撤销」，3 秒未点恢复，避免误触；`kind === "result"` 不显示撤销。
- 等待时长：组件内 `now = ref(Date.now())`，`setInterval(1000)` 仅在展开且有条目时运行，`onBeforeUnmount` 清理。
- 无障碍：容器 `role="status"`、`aria-live="polite"`，按钮 `aria-label`；`pointerdown/wheel/click` 阻断冒泡，避免触发画布平移与快捷键。
- 样式沿用 `taskAlertBanner` 的 token（`--el-bg-color-overlay`、`--el-border-color-light`、12px 字号），`z-index: 5`，`left: 12px; bottom: 12px`（右下角已有画布控件与小地图）。

### 3. 画布接线（`canvas/index.vue`）

- 解构 dispatcher：`const { queueView: agentQueueItems, queueNotices: agentQueueNotices, cancelQueued } = agentDispatcher;`（解构出来的 ref 在模板中自动解包）。
- 在 `.canvas` 内、`taskAlertBanner` 之后挂载 `<agentQueuePanel v-if="active" :items="agentQueueItems" :notices="agentQueueNotices" @cancel="cancelQueued" />`。

### 4. 测试（`agentDispatcher.test.ts`）

复用 `setup({ hang: true })` 的挂起流：
1. 忙节点上排两条 → `queueView` 两条、顺序正确、`reason` 正确、含标签与摘要；出队后快照清空。
2. 同发送方替换 → 快照只剩最新、`queueNotices` 出现替换提示。
3. 撤销 → 快照移除、`/api/agent/note` 收到「排队中被用户撤销」、`/api/agent/abort` 未被调用、同内容立即可再次入队（去重键已释放）。
4. 结果回传条目不可撤销（`cancelQueued` 返回 false）。

### 5. 文档与部署

- 更新 `3_test_results`、`5_memory`、`operation-2026-11.md` 与各 INDEX。
- 仅 web 产物变化：`build:server`（含 web）后同步 `Resources/app/views/mainview`；**不动** `app/bun/index.js`、`nodes`、`tools`、`data`、`version.json`；不重启应用，由用户自行重启。

## 风险与取舍

- 快照不同步 → 幽灵条目。用「所有变更点统一 sync」+ 单测覆盖顺序/替换/撤销/出队。
- 撤销与 `pump` 竞态：JS 单线程，`cancelQueued` 同步完成 splice 后 `pump`，不会出现「撤了又被启动」。
- 提示噪音：上限 3 条、8 秒 TTL、去重提示每个键只发一次。
- 队列不可持久化：UI 不承诺刷新后保留，文案不暗示持久。
- 不显示「正在跑」的任务：本轮只解决排队可见性，运行态仍由节点状态与箭头表达，避免与面板状态源冲突。

## 评审意见

| 评审人 | 意见 | 结论 |
| --- | --- | --- |
| 子 agent 评审 | **P1-1** 队列清空即自动收起，会把「已撤销」提示藏进未读圆点；**P1-2** 整块 `aria-live` 含每秒变化的等待时长，读屏器会每秒播报；**P1-3** 测试不足（结果回传不可撤销未覆盖、箭头未断言、`/api/agent` 断言是弱断言）。**P2**：被挤出提示的定时器未清理；`messageFull` 未实现；撤销不复位 statuses 需用测试锁定；note 失败静默；`cancelQueued` false 无反馈；`stop` 清队列不通知；dispose 后 late event 可再入队；组件细节（展开不重置时钟、同长度替换不重置确认态、结果条路由文案、只有提示时 chip 文案、与对话面板 z-index 需实测）。 | 采纳 P1 全部与 P2 中 1/2/3/4/5/7/8；P2-6（stop 通知）记为已知边界不改 |
| 用户评审 | 通过（范围：可见 + 撤销，不做插队） | 通过 |

## 实施修订（评审后）

1. **收起条件**改为「条目与提示都为空」；只有提示时标题显示「派发队列提示」，不再渲染「排队中的派发 · 0」，chip 文案在无排队时显示「队列提示」。
2. **无障碍**：面板去掉 `role="status"`；live region 只包提示列表；等待时长行加 `aria-hidden`；chip 的 `aria-label` 随展开态变化。
3. **测试**扩到 17 条：快照字段/顺序/原因、替换提示、撤销（箭头移除、`/api/agent` 调用数不变、statuses 不变、note 文案、去重键释放）、结果回传不可撤销、并发已满原因、重复消息只提示一次、dispose 清空。
4. **提示定时器**改为 `Map<id, timer>`，提示被挤出上限时同步清理。
5. **快照增加 `messageFull`**，列表摘要 160 字、悬停显示全文。
6. **note 失败可见**：`deliverCancelNote` 返回是否写入成功，撤销后补一条「未能通知原 Agent」提示；`cancelQueued` 返回 false 时画布层 `ElMessage.info("任务已开始执行，无法撤销")`。
7. **dispose 守卫**：`enqueueFromEvent`、`cancelQueued`、`notifyQueue` 在 disposed 后早退。
8. **组件细节**：展开时重置计时基准；确认态按 taskId 是否存在判断；结果条目只渲染「结果回传 · 节点」，不再显示箭头路由。

## 已知边界

- `stop(nodeId)` 仍会静默清掉该节点上其他 Agent 的排队任务、不写 note：这是既有「停止节点」语义，本轮不改，避免停止按钮产生额外会话噪音。
- 队列只在页面内存，关闭/刷新/切换画布即丢弃；UI 不承诺持久。
- 撤销不入队历史，不可撤销「撤销」；靠原消息仍在发送方会话里重新派发。
- 浮层 z-index 5，与对话面板（z-index 10）重叠时会被盖住：左下角默认不冲突，需实机确认一次。
