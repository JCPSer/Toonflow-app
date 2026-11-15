# 测试结果：画布 Agent 节点派活（P1）

- 时间：2026-11-15 19:33
- 对应方案：`2026-11-15-19-40-agent-messaging.md`（§9 画布 dispatcher 架构）
- 状态：P1 核心链路已实现，待真实模型联调

## 1. 实现清单

服务端：

| 文件 | 内容 |
| --- | --- |
| `agent/runtime/types.ts` | 新增 `agentDispatch` 事件（taskId/from/to/fromSession/message/depth/model） |
| `agent/tools/sendToAgent.ts` | 工具：自派发拒绝、8 跳上限、下发派发事件、立即返回 taskId |
| `agent/tools/index.ts` | 仅在顶层画布会话注入 sendToAgent；子 Agent/A2A 不继承 |
| `agent/runtime/index.ts` | `dispatchDepth` 透传、dispatch context 组装 |
| `routes/agent.ts` | 接收 `dispatchDepth`（0–8） |

Web：

| 文件 | 内容 |
| --- | --- |
| `canvas/agentDispatcher.ts` | 队列、并发 4、60 秒去重、8 跳、画布调用、会话写回、结果回传、状态、取消 |
| `canvas/index.vue` | 创建/provide 调度器、提问写入全局 store、打开面板回放提问 |
| `agent/conversation.vue` | 转发 agentDispatch、面板运行占位、停止后台任务 |
| `agentNodePanel.vue` | `applyExternalEvent` 镜像后台事件，容错 |
| `stores/agentQuestions.ts` | dispatcher 来源提问 add/remove，面板 sync 不再覆盖 |

## 2. 单元测试

`apps/server/src/agent/tools/sendToAgent.test.ts`（4 例）：

- 正常下发 agentDispatch 并返回 taskId；
- 自派发拒绝；
- 超过 8 跳拒绝；
- 空消息拒绝。

`apps/web/src/pages/workspace/panels/canvas/agentDispatcher.test.ts`（2 例）：

- A 派发给 B：B 会话文件写回节点、完成后结果以「Agent 任务结果」回到 A 的会话；
- 同一对节点 60 秒内相同消息只启动一次。

```text
bun test（apps/server）：131 pass / 0 fail / 709 expect
bun test agentDispatcher.test.ts：2 pass / 0 fail
apps/server tsc：通过
apps/web vue-tsc：仅既有 @/agentRuntime 基线错误
```

## 3. 行为说明

- 服务端只下发意图，不执行目标；目标校验、排队、并发、画布调用、结果回传都在画布 dispatcher。
- 目标 B 忙（面板自己的请求）时排队；dispatcher 自己的任务并发上限 4。
- 结果回传：以「【Agent 任务结果】来自 …」作为 A 的新输入自动开新一轮；A 仍在前一轮时排队。
- B 提问：写入全局横幅并镜像到已挂载面板；打开面板时补回放工具块与提问卡片。
- 停止：面板停止按钮在没有本地请求时取消 dispatcher 任务；取消结果回传 `cancelled`。
- 刷新/关闭页面：AbortController 中断，任务标记 cancelled，不回传（已确认的取舍）。

## 4. 已知限制（P2/P3）

- 节点模型选择尚未落盘到 `node.data.agentModel`；新 B 会话回退到派发方 A 的模型。
- 去重键未包含根任务链；不同链的相同消息在 60 秒内会被当成重复。
- 多标签页同时打开同一画布时，只有发起派发的实例拥有任务，其他实例只读。
- 画布改名后在途任务失败；重新派发即可。
- 未做重启恢复与审计卡片。

## 5. 待人工验证

- 两个 Agent 节点 A/B：A 派活给 B，B 面板实时出现任务并运行，完成后 A 自动继续。
- B 运行中用户点停止，A 收到 cancelled。
- B 提问时横幅出现，点击后能看到提问卡片并回答。
- 页面刷新后任务中断，节点状态回到 idle。

## 6. 构建与部署

- `bun run --filter '@toonflow/web' --filter '@toonflow/server' build` 成功；
- `bun run build:server` 成功（入口 23.36 MB）；
- `bun run build:desktop` 成功；
- 已备份并同步 `Resources/app/bun/index.js`（含 sendToAgent，确认 BrowserWindow 仍为 2）与 `Resources/app/views/mainview`（含 dispatcher）；
- `version.json` 与 `data/nodes` 未动；未重启应用。

## 7. 联调前静态确认

- 画布 Agent 面板的 conversation 携带 `node-binding`，服务端才会注入 sendToAgent；
- 右侧全局 Agent 面板无 nodeBinding，不会出现该工具；
- 子 Agent / A2A 的 createAgentTools 不传 dispatch context，工具不继承。

## 8. 联调问题：结果只有 completed、没有文本

现象：A 收到的「Agent 任务结果」只有状态和「（对方没有返回文本结果）」，但目标会话里实际有 assistant 文本（「你好」）。

根因：dispatcher 用 `/api/agent/get` 读取目标会话时没有带 `x-toonflow-workspace: 1`，被工作区校验 403，`readLastAssistantText` 把失败吞成空字符串。

取证：浏览器内同源 fetch 实测——带请求头 200 且返回 messages，不带请求头 403「服务器部署只能使用服务器工作区」。

修复：
- `readLastAssistantText`、`readSessionModel` 的 GET 补 `x-toonflow-workspace: 1`；
- 结果提取改为「最后一条用户任务之后、最近一条非空 assistant 文本」，避免一轮以工具调用收尾时取到空文本；
- 模型解析补 `node.data.agentModel` 回退层。

复测：dispatcher 2 例通过、web typecheck 仅基线错误；web 产物已重新构建并同步到应用 `views/mainview`。
