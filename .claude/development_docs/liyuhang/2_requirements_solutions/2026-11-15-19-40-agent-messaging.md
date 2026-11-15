# 需求方案：画布 Agent 节点之间真正通信与派活

- 时间：2026-11-15 19:40
- 对应需求：`2026-11-15-19-40-agent-messaging.md`
- 状态：待评审

## 1. 总体架构

```text
┌──────────── Web 画布（始终在线） ────────────┐
│ canvasHost：每个画布实例                      │
│  ├─ canvas RPC 客户端（SSE 订阅 /canvas/bridge）│
│  ├─ agent 事件订阅（SSE /agent/events）        │
│  └─ agentNodePanel（打开时显示某个节点的会话）  │
└───────────────▲──────────────────────────────┘
                │ SSE（服务端→浏览器）
┌───────────────┴──────────────────────────────┐
│ 服务端                                        │
│  canvasRpc：按 canvasId 持久通道，调用画布工具  │
│  agentBus：按 canvasId 广播运行事件与节点状态   │
│  agentDispatch：任务队列 / 并发 / 跳数 / 去重   │
│  sendToAgent 工具（仅画布内 Agent 会话可见）    │
│  agent.run（复用现有运行时，headless）          │
└──────────────────────────────────────────────┘
```

关键点：后台运行的 Agent 不依赖某个面板的 HTTP 流；画布工具走持久 RPC，事件走持久订阅，所以面板关掉也不影响派发与回传。

## 2. 消息流

```text
A 运行中调用 sendToAgent(nodeId=B, message=M)
  → 校验：同画布、B≠A、B 是 Agent 节点、未禁用、深度 < 8、非重复
  → 读取 B 的会话文件/模型（缺失时按 node.data.agentModel → A 的模型）
  → 任务入 B 队列（B 忙则排队）
  → 立即返回 { taskId, status: "queued" }

B 队列轮到任务：
  → agent.run({ sessionFile: B, prompt: 带来源的任务文本, canvas: 远程 RPC 上下文 })
  → agentBus 广播 nodeStatus: running、agentTask、text/tool/question 事件
  → B 面板若打开：直接消费事件；未打开：只更新节点状态与全局提问

B 结束（completed/failed/cancelled）：
  → 读取 B 最后一条 assistant 文本与状态
  → 结果写入 A 会话（customType=toonflowAgentResult，带 from/to/taskId/depth）
  → A 空闲：自动启动新一轮（把结果作为本轮输入）；A 运行中：followUp 排队
  → agentBus 广播 A 的 nodeStatus: running
```

## 3. 服务端模块

### 3.1 canvasRpc（持久画布 RPC）

```text
Map<canvasId, Set<send>>
subscribe(canvasId, send) → unsubscribe
call(canvasId, cwd, request, signal):
    if 无订阅者 → 抛“画布未打开”
    callId = uuid
    pendingCalls[callId] = { cwd, canvasId, finish }
    send({type:"call", callId, name, args})
    120s 超时 / signal 取消
finishCanvasCall(callId, response)   // 复用现有回传
```

Web：`canvasBridgeClient.ts` 在画布实例创建时订阅 SSE，收到 call 后调用现有 `getCanvasContext().call()`，结果 POST `/api/canvas/bridge/result`。画布关闭时断开，服务端立即失败所有挂起调用。

### 3.2 agentBus（持久事件总线）

```text
publish({canvasId, nodeId, sessionFile, initiator, event})
subscribe(canvasId, send) → unsubscribe
```

`agent.run` 增加 `publish` 通道：所有 `send` 事件旁路广播，并附带 `initiator`（`panel` / `agent`）。前端用 `initiator` 去重：自己发起的流只更新状态，不再重复渲染。

### 3.3 agentDispatch（队列与回传）

```text
状态：
  queues: Map<sessionFile, Task[]>
  running: Map<canvasId, number>      // 上限 4
  activeTasks: Map<taskId, {controller, sessionFile, parentTaskId, depth}>
  dedupe: Map<`${from}->${to}:${hash(message)}`, timestamp>  // 60s
  depthBySession: Map<sessionFile, number>

dispatch(from, to, message, depth):
    校验与解析（画布 getCanvasNodes 读取 data.agentSessionFile/agentModel/label/disabled）
    taskId = uuid
    入队；pump(canvasId)

pump(canvasId):
    while running < 4 && 队列有任务:
        取出一个 → 启动 async 执行（不 await）

execute(task):
    bridge = createRemoteCanvasContext(cwd, canvas, controller.signal)
    questions = createQuestionContext(cwd, send→bus, controller.abort)
    try:
        await run({ sessionFile: task.toFile, prompt: wrapTask(task), canvas: bridge.context,
                    question: questions.context, nodeBinding: { canvasId, nodeId: to },
                    provider/model/thinkingLevel: 解析结果, signal })
        status = completed
    catch e:
        status = cancelled | failed（区分用户取消 / 循环保护 / 普通错误）
    result = 读取会话最后 assistant 文本（截断到 8000 字符）
    deliverResult(task.fromFile, task, status, result)
    广播状态
    清理、pump 下一个
```

### 3.4 sendToAgent 工具

```text
name: sendToAgent
description: 把任务派给同一画布上的另一个 Agent 节点；立即返回，对方完成后结果会回到本会话
parameters: { nodeId: string, message: string (1..8000) }
execute:
    从运行上下文取当前 sessionFile/nodeId/canvasId/depth
    dispatch(...) → { taskId, targetLabel, status }
```

工具只在有画布上下文时注册。目标发现复用现有 `findCanvasNodes({ types: ["remote-agentNode"] })`。

### 3.5 结果回传

```text
deliverResult(fromFile, task, status, result):
    文本 = `【Agent 任务结果】来自「B」#taskId 状态：completed\n\n${result}`
    若 fromFile 正在运行:
        active.session.sendCustomMessage({customType:"toonflowAgentResult", content, display:true, details},
                                         {deliverAs:"followUp"})
    否则:
        入 A 的队列（同一 dispatch 队列，但不增加跳数）→ 自动 run 新一轮
```

## 4. 前端改动

1. **canvasBridgeClient**：每个画布实例订阅 RPC；执行失败原样回传错误。
2. **agentBusClient**：画布实例订阅事件；维护 `agentNodeStatuses`；把当前打开节点的 `agent` 发起事件转发给 conversation 的 `applyExternalEvent`；提问事件写入全局提问 store。
3. **agentNodePanel / conversation**：
   - 暴露 `applyExternalEvent(event)`，复用现有 `applyEvent` 与流式合并；
   - 新增 `agentTask` 事件渲染：B 的会话顶部出现「来自 Agent A 的任务」卡片；
   - A 的 `agentResult` 消息用自定义样式显示来源与状态；
   - 停止按钮对后台运行改为调用 `/api/agent/cancel`（按 sessionFile 取消）。
4. **模型落盘**：面板选择模型/思考等级时写入 `node.data.agentModel`，供派发时回退。
5. **状态**：A 派发后显示「等待 B」；B 显示「运行中」；失败/取消显示错误态。

## 5. 防护

- 深度：工具执行上下文带 `depth`，≥8 拒绝并回传错误；结果回传不增加深度。
- 去重：同 from→to + 相同 message 60 秒内只接受一次。
- 并发：每画布后台任务 4 个，超出排队；用户手动发送优先于队列（走现有 HTTP 路径）。
- 级联取消：任务记录 `parentTaskId`；取消父任务时递归取消派生任务，并回传 cancelled。
- 画布关闭：RPC 立即失败，任务以 failed 回传，不无限挂起。
- 文件锁：复用 `lockWorkspaceFiles`；目标会话被占用时排队而非并发写。

## 6. 分阶段实施

| 阶段 | 内容 |
| --- | --- |
| P1 | canvasRpc + agentBus + dispatch 队列 + sendToAgent + 结果回传 + 节点状态 |
| P2 | 面板实时消费 bus 事件、任务/结果卡片、停止后台任务、全局提问 |
| P3 | 模型落盘、审计展示、级联取消、去重与限额完善、i18n |

每阶段可独立构建、测试、部署；P1 完成后链路即可真实派活，P2 补齐可见性。

## 7. 测试策略

- 单测：队列顺序、并发上限、跳数拒绝、去重窗口、结果状态映射、级联取消。
- 集成：本地起 server，mock canvas RPC 订阅者与 run，验证 A→B→结果回 A 的完整链路。
- 手工：两个 Agent 节点互相派活、长任务排队、用户中途停止 B、B 提问后回答、画布关闭时失败回传。
- 回归：现有单 Agent 会话、子 Agent、压缩、画布工具不受影响。

## 8. 评审意见

（待填写）

- 是否通过：
- 其他要求：

## 9. 架构修订（可行性评审后）

评审确认 `agent.run` 可以无 HTTP 请求调用，但服务端 headless 路线要同时补会话准入、所有权、取消、绑定、画布通道五件事，首版 14–16 个文件、1800–2800 行，且页面关闭后画布工具仍不可用。用户确认「页面关闭/刷新即中断」，因此改为**画布宿主内的 dispatcher**：

```text
A 运行中调用 sendToAgent(nodeId=B, message=M)
  → 服务端工具只做身份/深度/自派发校验
  → 通过 A 自己的事件流发出 agentDispatch 事件（taskId、from/to、message、depth、A 的模型）
  → 立即返回 accepted

画布宿主 dispatcher（A 的事件流消费者）：
  → 校验 B 存在、未禁用、是 Agent 节点
  → 按 B 会话文件排队；每画布并发 4
  → 用现有 /api/agent 流跑 B（B 的 sessionFile、nodeBinding、dispatchDepth=depth+1）
  → 消费 canvasCall / question / session / text / tool / done，画布工具用本实例 getCanvasContext()
  → 节点状态、会话文件写回、面板实时镜像
  → 完成后结果回传 A：A 空闲则发新一轮（dispatchDepth 不变），A 运行中则排队到结束后

取消：dispatcher 持有 AbortController；面板停止按钮对后台任务调用 dispatcher.stop(nodeId)
页面关闭/刷新：fetch 中断，dispatcher 标记 cancelled，不保证回传
```

### 9.1 接口约定

```ts
// AgentEvent 新增
{ type: "agentDispatch"; taskId: string; fromNodeId: string; toNodeId: string;
  message: string; depth: number;
  model: { providerId: string; modelId: string; thinkingLevel?: string } }

// run 选项新增
dispatchDepth?: number   // 0..8，由调用方（面板=0，dispatcher=父任务深度+1）传入

// /api/agent 请求新增
dispatchDepth?: number
```

工具注册条件：顶层会话、有 `canvas`、有 `nodeBinding`、非子 Agent；子 Agent / A2A 不继承该工具。

### 9.2 评审问题的落地

| 评审问题 | 处理 |
| --- | --- |
| 画布调用双通道/广播重复执行 | 不新增服务端画布 RPC；B 的画布调用只走 dispatcher 自己的 NDJSON 流，一次执行一次回传 |
| headless 会话绑定丢失 | 会话文件由 dispatcher 在 `session` 事件里写回 node.data；新建 B 会话由 dispatcher 携带模型创建 |
| followUp 丢消息 | 不使用 followUp；结果作为新任务入队，等 A 当前流结束再发 |
| 无准入/取消 | dispatcher 自己维护队列与 AbortController；不与用户 HTTP 流争用（用户运行中则排队） |
| 模型解析 | dispatcher 优先读目标会话（/api/agent/get 的 providerId/modelId），回退 node.data.agentModel，最后用派发事件里 A 的模型 |
| 跳数/去重归属 | 任务对象带 rootTaskId/depth；dedupe 键含 rootTaskId；结果不增加 depth |
| 提问覆盖 | question store 增加 dispatcher 来源的 add/remove，面板 sync 只替换 panel 来源 |
| 页面关闭 | 明确不支持；中断后任务标记 cancelled，不回传 |

### 9.3 P1 切片

1. 服务端：`agentDispatch` 事件、`sendToAgent` 工具、`dispatchDepth` 透传（4 个文件）。
2. Web：`agentDispatcher.ts`（队列/并发/去重/深度/画布调用/结果回传）、canvas 实例注册与面板镜像（3–4 个文件）。
3. 面板：外部事件注入、停止后台任务、节点状态单一写入。
4. 测试：dispatcher 队列/深度/去重/结果状态单测；服务端工具校验单测。

### 9.4 已知限制

- 刷新/关闭页面会中断在途任务，不回传。
- 多标签页/多窗口同时打开同一画布，只有发起派发的实例拥有任务；其他实例只读状态。
- 画布改名后，dispatcher 键与 nodeBinding 会失效，在途任务失败回传；改名后重新派发即可。

## 10. 实施状态（P1）

已实现：sendToAgent 工具与 agentDispatch 事件、画布 dispatcher（队列/并发/去重/深度/画布调用/会话写回/结果回传/取消/提问）、面板外部事件镜像与停止、提问 store 分流。

未实现（记录在测试文档）：node.data.agentModel 落盘、跨链去重、多标签页所有权、改名迁移、重启恢复、审计卡片。
