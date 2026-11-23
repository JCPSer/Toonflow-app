# 需求方案：Agent 通信改为打断式

- 时间：2026-11-17
- 对应分析：`2026-11-17-agent-dispatch-interrupt-analysis.md`

## 一、服务端：新增「打断活动会话」能力

1. `agent/runtime/sessions.ts` 新增导出：
   - `abortAgentSession(path, timeoutMs = 15000): Promise<boolean>`
   - 取 `getActiveAgentSession(path)`；没有则返回 false；有则 `await active.abort()`。
   - `active.abort()` 返回的 promise 在 run 的 finally 里 resolve（此时会话已注销、文件锁已释放），所以调用方拿到 true 后可以安全复用同一会话发新请求。
   - 超时用 `Promise.race` 兜底，避免请求挂死。
2. 新路由 `apps/server/src/routes/agent/abort.ts`：
   - `POST /api/agent/abort`，入参 `{ directory, sessionFile }`，用 `resolveWorkspaceFile` 校验路径后调用上述函数。
   - 返回 `{ aborted: boolean }`。
3. `router.ts` 注册 `/api/agent/abort`。

伪代码：

```
POST /api/agent/abort:
  {cwd, path} = 校验 directory + .agent/sessions/sessionFile
  aborted = 该 path 是否有活动会话并等待其收尾
  return {aborted}
```

## 二、dispatcher：打断 / 排队 / 替换

### 2.1 入队时按发送方替换
```
enqueueFromEvent(event):
  去重（不变）
  对 queue 里 kind=task 且 to=event.to 且 from=event.from 的项：
    收掉箭头、释放去重键、删除（只保留最新）
  push 新任务（status=queued，箭头灰色）
```

### 2.2 决策
```
running = running.values() 中找到 to=event.to
if running 且 running.from === event.from:
    hardPreempt(running, "被同一 Agent 的更新消息打断")
elif 没有 running 且 panelRunning.has(event.to):
    hardPreemptPanel(event.to)
// 其余情况：排队
pump()
```

### 2.3 硬打断闸门（关键竞态处理）
```
preempting: Map<nodeId, Promise<void>>   // 打断未收尾前，该节点不允许启动新任务
canStart(task): !preempting.has(to) && !runningNodes.has(to) && !panelRunning.has(to)

hardPreempt(task):
  task.interruptReason = 原因
  holdNode(to, async () => {
    task.controller?.abort()                 // 先停本地流，避免继续渲染
    sessionFile = task.toSession ?? 节点绑定的 agentSessionFile
    if (!sessionFile) await waitTaskEnd(task.id, 5s)  // 还没拿到会话文件：等它自己结束
    else await abortSession(sessionFile)     // 服务端打断并等收尾
  })

hardPreemptPanel(nodeId):
  sessionFile = 节点绑定的 agentSessionFile
  if (!sessionFile) return                   // 没有会话可断言，退回排队（由 panelRunning 拦住）
  holdNode(nodeId, async () => {
    await abortSession(sessionFile)
    注入面板事件：error「当前对话已被其他 Agent 的新消息打断」+ done
  })

holdNode(nodeId, work):
  next = (preempting.get(nodeId) ?? resolved).then(work).finally(() => { 删除标记; pump() })
  preempting.set(nodeId, next)
```

- `abortSession` 即 `POST /api/agent/abort`，超时 15s；失败只记录，不阻断后续（新请求还有 409 重试兜底）。
- 结果回传任务（kind=result）不触发 hardPreempt，只排队。

### 2.4 新请求 409 重试
`runTask` 里命中 `/api/agent` 返回 409 时，150ms 后重试，最多 20 次（约 3s）。409 在会话 active 检查处抛出，不会产生半截写盘。

### 2.5 被打断任务的收尾
- `finish()` 已统一处理：abort → status=cancelled → 给父会话写取消 note、箭头闪烁退场。
- `deliverCancelNote` 文案加入 `task.interruptReason`，例如「任务 #x 已被停止（被同一 Agent 的更新消息打断）」。

## 三、工具描述同步
`sendToAgent` 的 description/promptSnippet 更新为：
- 同一 Agent 再次派发会打断它自己上一条；
- 其他 Agent 正在执行时排队，且同一 Agent 的旧排队只保留最新；
- 结果仍异步回传。

## 四、测试计划
- 更新既有用例：原「停止运行中的任务」用例里第二条消息来自同一发送方，现在会先打断第一条，期望随之调整。
- 新增：
  1. 同一发送方新消息打断：`/api/agent/abort` 被调用、旧流中断、新任务执行、旧任务给父会话写被打断 note。
  2. 不同发送方排队：C 的任务在跑，A 的派发不打断；A 连发两条只跑最新。
  3. 面板运行被打断：`notePanelRun(true)` 后派活 → 调 abort、派发任务开始、面板收到 error/done。
  4. 结果回传不打断：结果任务在父节点运行期间排队。
- 服务端：`abortAgentSession` 无活动会话返回 false、有活动会话会等待收尾（可用现有 test 设施评估）。

## 五、风险与回退
- WKWebView/服务端 abort 若行为异常，可在 dispatcher 侧用「仅本地 abort + 409 重试」降级（去掉 abort API 依赖），但会保留 steer 竞态。
- 打断面板运行对用户是侵入性的：用户已明确要求同样硬打断；若体验不可接受，可加节点级开关再放开。

## 评审意见

| 评审人 | 意见 | 结论 |
| --- | --- | --- |
| 子 agent 评审 | P1-1 方案里的「409 重试」不成立：路由已 flushHeaders，忙错误是 200 + NDJSON error，现有面板按 status 判断的重试是死代码。P1-2 靠注入 error/done 复位面板不可行：不会清 busy、会触发队列/目标自动续发、还会覆盖文案/多出气泡。P1-3 panelRunning 释放依赖面板 finally，可能让节点永久卡住。P1-4 abort 返回时 run 还在做 prune，可能撞 EBUSY。P1-5 abort 超时语义需三态；steer 只发生在子 Agent 会话，顶层 canvas 节点是忙错误。P2：去重先于打断、队首语义、holdNode 清理竞态、结果任务守卫、无 sessionFile 的面板窗口、abort 接口契约、工具返回值、测试用例影响范围 | 采纳，见下方「实施修订」 |

## 实施修订（相对 v1）

1. **忙错误改为机器码**：`AgentEvent.error` 增加可选 `code`；runtime 的两个 409 与文件锁 EBUSY 都带 `code: "EBUSY"`；路由 catch 透传 code。`readAgentEvents` 抛出带 code 的错误，dispatcher 据此退避重试（10×150ms），不再按 HTTP status 判断。
2. **abort 契约**：`abortAgentSession` 返回 `none | finished | timeout`；`finished.resolve()` 从「释放锁后立刻」移到 prune / forgetMicrocompact / 附件清理之后，保证调用方拿到 finished 后立刻发新请求不会撞 EBUSY 或 steer。
3. **面板打断走专用入口**：conversation 新增 `interruptRun(reason)`（置 stoppedByUser、记录 externalInterrupt、abort 本地 controller），finally 复用「用户停止」语义不自动续发队列/目标；被外部打断期间服务端收尾的 error/done 在 `receiveEvent` 里只做状态复位、不写气泡，catch 用 externalInterrupt 作为气泡文案。agentNodePanel 暴露 `interruptRun` 转发。dispatcher 先调本地入口再调服务端 abort；3 秒内 panelRunning 未释放则强制放开闸门防止节点永久卡住。
4. **去重语义**：完全相同的消息 60 秒内仍直接丢弃（防派发风暴）；「打断」只针对内容不同的新指令。
5. **队首**：触发打断的新任务插到队首（`moveToFront`），避免面板被打断后先执行别人更早排队的任务。
6. **闸门安全**：`holdNode` 的清理按 `preempting.get(id) === next` 判断，避免连续打断误删；`pump` 加 disposed 守卫，`dispose` 清空 preempting。
7. **结果任务**：`kind === "result"` 不进入打断/替换路径，仍排队。
8. **工具返回值**：`sendToAgent` 状态由固定 `queued` 改为 `dispatched`（调度器才决定排队/打断），description 说明打断规则。
9. **未做**：面板关闭时把打断原因持久化到会话（当前只在面板气泡显示）；abort 超时时给父会话写「无法中断」note（当前退化为重试 + 失败收尾）。
