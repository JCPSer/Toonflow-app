# Bug 修复方案：Agent 事件总线多路复用

- 时间：2026-11-18 15:14
- 关联分析：`bug_analysis-2026-11-18-15-10-agent-connection-exhaustion.md`
- 用户选择：WebSocket 多路复用方向（实现上采用同一意图的单连接 NDJSON 总线，原因见「取舍」）

## 方案总览

```
改动前：每个 Agent 运行 = 一条 /api/agent NDJSON 长连接（6 个并行 = 6 条，占满 WebKit 上限）

改动后：
  POST /api/agent/bus      一条 NDJSON 总线（每窗口一条），行格式 { runId, event }
  POST /api/agent          带 x-agent-bus-id 时只返回 { runId }，事件发布到总线
  POST /api/agent/abortRun 客户端中断时按 runId 取消本次运行
  旧客户端/旧服务端          仍走原直连 NDJSON，不改协议
```

## 服务端设计

### 总线注册表（`agent/bus.ts`）

- `openBus(id, res)`：设置 NDJSON 头、20 秒空行心跳、`close` 时清理；重复 id 视为页面重载，先关闭旧通道并 abort 其运行；最多 16 条通道。
- `publishBus(id, runId, event)`：写 `{ runId, event }` 行；通道不存在时静默丢弃（客户端已断开）。
- `registerBusRun` / `unregisterBusRun` / `abortBusRun` / `abortRunEverywhere`：按 runId 管理 AbortController，连接关闭时统一 abort。
- `isBusId`：`^[\w-]{8,64}$`，防止脏键与超长。

### 路由

- `POST /api/agent/bus`：校验 busId 与工作区归属，打开总线；响应不结束。
- `POST /api/agent`：模型/目录同步校验后，若带 `x-agent-bus-id`：
  1. 校验通道存在（否则 409）；
  2. 生成 runId、注册 AbortController，立即 `res.json(success({ runId }))`；
  3. 异步 `u.agent.run(...)`，事件经原 `send`（翻译、会话跟踪、桥接、提问）发布到总线；
  4. 成功补发 `done`，异常补发 `error`（保留 `code`），finally 释放画布桥、提问上下文、run 注册。
- `POST /api/agent/abortRun`：按 runId abort，返回 `aborted` / `none`。
- 原有直连流分支保持不变；`router.ts` 把 bus/abortRun 挂在主路由之前。

### 与现有能力的衔接

- 画布调用：`send` 仍发布 `canvasCall`，客户端执行后照旧 POST `/api/agent/canvasResult`（短请求）。
- 提问：`question` 事件与 `answer` 接口不变。
- 从属 Agent：`subAgentEvent` 仍包在父事件里，客户端处理逻辑不变。

## 客户端设计

### 总线（`agentBus.ts`）

- 每窗口生成一个 busId，懒建立一条 `POST /api/agent/bus` 流；按行解析 `{ runId, event }` 分发到 `Map<runId, Entry>`。
- `Entry`：事件队列、`finished`、`error`、`wake`；生成器等待时用 `wake` 唤醒，abort 时 reject。
- 连接断开：所有在途 Entry 标记「事件通道已断开」，并主动 `abortRun`，下次运行自动重连。
- 404/405：标记不支持，永久回退直连；网络失败：本次回退，下次仍尝试总线。

### 统一入口（`agentRun.ts`）

- `streamAgentRun(payload, { directory, signal, headers, busyRetries, busyDelayMs })`：
  1. 总线可用 → 启动短请求拿 runId，消费总线事件；
  2. 否则 → 原 POST `/api/agent` + `readAgentEvents`（保留 `trackStream` 统计）；
  3. EBUSY（HTTP 409 或流内 code）按调用方配置重试。
- `readAgentEvents` 的 HTTP 错误补上 `status` 与 `code`，便于区分忙与其它失败。

### 调用点

- `conversation.vue`：删除自有 fetch/409 重试/直连流读取，改用统一入口，`busyRetries: 3`、`busyDelayMs: 300`；保留原有的停止、问题清理、子会话结束处理。
- `agentDispatcher.ts`：`postDispatchRequest` 改用统一入口，外层 EBUSY 重试（10×150ms）不变。
- `singleAgentDialog` 走 `/api/singleAgent/run`，不在本次范围。

## 测试

- 服务端 `bus.test.ts`：标识校验、按 runId 发布、未注册忽略、关闭 abort、重复连接替换。
- 客户端 `agentBus.test.ts`：事件分发与 done 结束、中断触发 abortRun。
- 既有 dispatcher 测试显式 mock 总线 404，验证回退路径仍通过。
- `netProbe` 增加 `window` 缺失保护，纯逻辑测试可加载。

## 取舍与风险

- **用 NDJSON 单连接而非 WebSocket**：两者解决同一个连接池问题；NDJSON 复用现有 Express/代理/鉴权与事件格式，少一个依赖与一套握手/重连语义，且远程连接代理已验证可流式转发。若后续需要双向实时控制，再升级为 WebSocket。
- 总线断开会影响该窗口全部运行：这是单连接复用的固有代价，用「立即 abort + 自动重连」控制影响面；直连回退仍可单独使用。
- `abortRun` 只凭 runId：同机同源页面可互相取消；本地单用户应用接受该风险，未额外做会话归属校验。
- 服务端与 web 必须同批部署：新 web + 旧 server 会走 404 回退；旧 web + 新 server 完全不受影响。

## 实施修订（评审后）

1. **P0 重复连接误杀**：`openBus` 的 close/error 监听改为按对象身份判断，旧连接的 close 不会再删除新总线；补回归用例（替换后触发旧 close，新总线仍可发布）。
2. **P1-1 孤儿运行**：客户端生成器 `finally` 无条件 `abortRun`；消费端 break/抛错也会取消。
3. **P1-2 断线取消**：总线断开时对未完成的 Entry 主动 `abortRun`，并跳过已 `done` 的 Entry。
4. **P1-3 早期事件丢失**：runId 改由客户端生成并在启动前登记订阅，服务端校验 UUID 且同通道内拒绝重复；启动响应丢失时仍能按 runId 取消。
5. **P1-4 背压丢帧**：总线的 `writeRaw` 不再因 `writableNeedDrain` 丢弃事件，交给 Node 缓冲（丢 done/question 会让客户端永久等待）。
6. **P1-5 409 恢复**：服务端 bus 缺失返回 `reason: "bus_closed"`；客户端重置连接并重连一次后重试；重复 runId 返回 `duplicate_run` 不重试。
7. **P2**：连接校验 `content-type` 含 ndjson；总线登记 `trackStream`；`Accept-Language` 传到总线与启动请求；`MAX_BUSES` 满时淘汰最久未活动通道；`failAll` 跳过已完成；EBUSY 退避改为指数且可被停止打断；启动请求带 signal。
8. **未做**：abortRun 未加 directory 归属校验（runId 为 UUID、同源限制已挡住跨页面滥用）；总线事件的 Entry 队列无上限（本地单用户，慢 UI 场景暂不合并增量）。

## 评审意见

| 评审人 | 意见 | 结论 |
| --- | --- | --- |
| 子 agent 评审 | 可行但需修改：P0 重复连接误杀；P1 消费端抛错/断线不 abort、早期事件丢失、背压丢帧、409 不重连；P2 若干 | 全部处理，见实施修订 |
| 用户评审 | 通过（选择题选择 WebSocket 多路复用方向） | 通过 |
