# Bug 方案：Agent 运行中无法停止（后台派发/结果续跑）

- 时间：2026-11-15 21:20（22:05 按方案评审修订）
- 对应分析：`bug_analysis-2026-11-15-20-57-agent-remote-run-cannot-stop.md`
- 状态：评审后修订，待实施

## 1. 目标（用户已确认）

- 后台运行（dispatcher 派发 / 结果续跑）期间，面板必须能停止；停止后命令真正结束，节点不会被同节点排队任务或结果回传立刻拉起。
- 停止被派发的子任务后：取消结果**作为一条消息写进父会话**（父能看到），但**父不自动开新一轮**，停在等待输入。
- 范围：P1 全部 + 该回传语义；服务端按会话取消、父子链级联、done 对账留在 P2。

## 2. 设计

### 2.1 节点级「已停止」标记（dispatcher）

```text
pausedNodes: Set<nodeId>

stop(nodeId) -> boolean
    hit = false
    清掉 queue 中 toNodeId === nodeId 的项（task 与 result 都清），hit = true
    清理 dedupe 中涉及该节点的键
    running 中 toNodeId === nodeId 的任务 → stopped = true、abort，hit = true
    hit 时 pausedNodes.add(nodeId)
    return hit

pump()
    跳过 toNodeId ∈ pausedNodes 的任务

enqueueFromEvent / enqueueResultTo
    目标 ∈ pausedNodes → 丢弃（不跑），只记日志

notePanelRun(nodeId, true)      // 用户在当前面板手动发送 = 继续
    pausedNodes.delete(nodeId)
    pump()
```

`finish()`：

```text
cancelled = stopped || aborted
若 task.fromSession:
    cancelled → deliverCancelNote(父节点, 父会话, 任务)   // 只写消息，不跑
    否则      → enqueueResultTo(...)                      // 原逻辑
```

`deliverCancelNote`：POST `/api/agent/note` 把「任务 #id 已被用户取消」写进父会话，再向父面板注入 `note` 事件；父节点状态置 idle/waiting。

### 2.2 服务端：note 路由与会话追加

- `sessions.ts` 新增 `appendAgentNote(cwd, file, content)`：`updateAgentSession` 内 `history.appendMessage({role:"user", content})`，返回新条目 id；若会话活跃则顺带 `active.send({type:"note", id, content})`。
- 新路由 `/api/agent/note`：`{ directory, sessionFile, content(1..8000) }`，`u.agent.appendAgentNote`，返回 `{ id }`。
- `AgentEvent` 增加 `{ type: "note"; id: string; content: string }`（服务端与 dispatcher 都可发）。

### 2.3 服务端：runCommand 进程组终止

复用 `routes/exec/index.ts` 的做法：

```text
Bun.spawn([...], { detached: true })
stop():
    win32 → taskkill /pid <pid> /T /F，失败再 child.kill
    其他  → process.kill(-pid, "SIGKILL")，失败再 child.kill
timeout 与 abort 共用 stop()
```

### 2.4 前端：工具栏与入口

`messageInput.vue`：

```text
<template v-if="busy"> 队列 + 打断并立即发送          // 仅本地运行
停止按钮 v-if="busy || remoteRunning"（文案：remoteRunning && !busy ? "停止运行" : "停止生成"）
发送按钮 v-else
队列预览的「立即发送 / 移除」disabled 增加 remoteRunning
```

`conversation.vue`：

```text
submitMessage 顺序：
  1) editingId 重发 → sendMessage（内部拦截）
  2) 内置指令（/goal stop|off、/compact 等）→ 原逻辑（保证后台运行时仍能 /goal stop）
  3) remoteRunning → 有草稿提示、不清空、不插入本地消息；无草稿返回
  4) busy → 打断并发送（原逻辑）
  5) sendMessage()

sendMessage 开头（清草稿、插用户消息之前）：
  remoteRunning → queued 场景把草稿放回队列首；否则提示并返回

sendQueuedNow：先判断 remoteRunning，再 splice（避免丢消息）

stopMessage：
  const hit = nodeBinding ? dispatcher?.stop(nodeId) : false
  if (controller) { stoppedByUser = true; controller.abort() }
  if (!controller && !hit && remoteRunning) → 提示「任务可能在其他窗口运行」并复位 remoteRunning/phase
  （dispatcher.stop 不再以 !controller 为前提）

receiveEvent：session / accepted 计入运行中；note 不改变运行态
applyEvent：case "note" → 追加一条非流式用户消息（entryId = id）
```

注入的 dispatcher 类型签名同步改为 `stop(nodeId): boolean`。

## 3. 状态表

| 状态 | 节点卡片 | 输入区右侧 | 停止点击效果 |
| --- | --- | --- | --- |
| 空闲 | 待开始/等待输入 | 发送 | — |
| 面板自己运行 | 运行中 | 队列 + 打断 + 停止 | 中断本轮，队列保留不自动续发 |
| 后台驱动 | 运行中 | 停止（“停止运行”） | abort 任务、清该节点排队、标记 paused，节点回等待输入 |
| 后台运行中打字 | 运行中 | 停止；点发送提示且保留草稿 | 同上 |
| 停止后 | 等待输入 | 发送 | 用户发送即解除 paused |
| 停止子任务后 | 子：等待输入；父：等待输入 | — | 父会话出现一条“已取消”消息，不开新一轮 |

## 4. P2（不做）

- 服务端按 sessionFile 取消（其他标签页/面板关闭）。
- 父/子链级联停止。
- `done` 丢失对账、压缩取消、goal 与停止边界。

## 5. 测试

纯逻辑单测（现有 `.ts` 基础设施，不引入组件测试依赖）：

- dispatcher：`stop` 命中运行中返回 true；清排队后 pump 不启动；paused 节点在随后 finish 其它任务时不被唤醒；父会话收到 note 而不是新一轮；`hit=false` 场景。
- dispatcher：dedupe 在 stop 后被清理。
- 服务端：`appendAgentNote` 写入后 `getAgentSession` 能读到该条用户消息。

手工矩阵：

- 截图场景：派活结果续跑 + `sleep 300` → 点停止，节点回等待输入，`ps` 无 sleep 残留。
- 仅收到 `session`、还没出 token 时停止。
- 停止 B 后，A 会话出现取消消息且不自动运行。
- 本地 busy + dispatcher 有排队任务时停止，排队任务不启动。
- Enter 有草稿、待发送队列「立即发送」、关闭再打开面板、全局面板回归。

## 6. 评审意见

（2026-11-15 21:58 子 agent：需调整）

- 必改点已并入：pausedNodes 粘住节点、stop 无条件调用并消费返回值、runCommand 进程组并入 P1、sendMessage 下沉拦截、submit 分支顺序、sendQueuedNow 先判后 splice、队列按钮禁用、dedupe 清理、accepted 死代码说明、测试降为纯逻辑 + 手工。
- 回传语义：用户已选「回传 cancelled、父不自动续跑」，落为 note 消息（不跑父），与评审建议的「不向父回传」等价。
