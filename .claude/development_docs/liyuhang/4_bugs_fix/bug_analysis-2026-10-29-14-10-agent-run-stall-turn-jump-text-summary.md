# Bug 分析：Agent 执行期全线超时 / 轮次跳转落点偏移 / 文本节点摘要丢失

- 记录时间：2026-10-29 14:10（v2，已按子 agent 初审修订）
- 需求方：liyuhang
- 关联方案：`bug_solution-2026-10-29-14-10-agent-run-stall-turn-jump-text-summary.md`
- 取证：子 agent 3 路走查 + 初审 1 路 + 主 agent 复核；运行数据（`/Applications/toonflow-data`、工程 `.agent/sessions`）

## 修订记录

- v2（初审后）：B1 候选根因重排，C2/C5 判定不成立、C1 与症状不符、C3 量级无据，**C4（浏览器同源 6 连接耗尽）成为唯一自洽解释**；删除"前端静默降级到 mock"这条错误结论（`assetLibrary/api.ts:20-30` 的 `mockEnabled` 需 DEV + 显式 flag，生产不可达）；纠正 axios `timeout exceeded` 裸串的真实来源分支；B2 补充"库自带 scroll reconcile"事实，取消"根因已定位"的定性。

---

## 一、Bug 矩阵

| 编号 | Bug | 优先级 | 难度 | 风险 | 结论状态 |
| --- | --- | --- | --- | --- | --- |
| B1 | Agent 节点执行期间，所有 HTTP 接口一起超时 | P0 | 高 | 高 | **机制已锁定方向，量级待实测** |
| B2 | 对话面板右侧轮次目录点击后位置不对 | P1 | 中 | 低 | 现象确凿，根因待实测确认 |
| B3 | 文本节点连到 Agent 后，正文摘要没有带给模型 | P1 | 低 | 低 | 根因已定位 |

---

## B1 Agent 执行期间全线超时

### 背景

画布上有多个 Agent 节点（其中若干由「分支复制」产生）。用户反馈：只要这类节点在执行，图片历史一直转圈、工具界面报「工具界面加载失败，请停止后重试：timeout exceeded」、ComfyUI 状态栏显示离线；多节点并行时「互相打架」。

### 已确证的事实

1. 报错源头是前端：`apps/web/src/components/agent/toolMessage.vue:3` 渲染 `rendererError`；置位点三处 —— `:50`（占位文案）、`:53`（`loadToolComponent()` 抛错）、`:59`（`onErrorCaptured`）。
2. `loadToolComponent` 第一步是 `axios.get("/api/tools/renderers")`（`packages/toolScaffold/src/client.ts:21`），**没有设置 timeout**；web 源码中也没有全局 `axios.defaults.timeout`。
3. axios 产物里的裸串分支是 `` `timeout ${config.timeout ? "of Nms " : ""}exceeded` `` —— **裸串对应 `config.timeout` 为 0/未配置**的分支。因此「timeout exceeded」不能直接等同于「服务端 30s 不响应」；它更可能来自请求在浏览器侧滞留后由 XHR/连接层触发的超时，或来自工具组件自身（`:59` 捕获）的抛错。**这一点必须实测确认，不能当结论用。**
4. 服务端**没有**任何把 `/api/agent/*` 串起来的全局锁/队列；也没有 worker/子进程隔离（Agent 与 HTTP 同进程同 Bun 事件循环，`apps/server/src/routes/agent.ts:54` → `agent/runtime/index.ts:45`）。
5. 三个症状接口自身都是毫秒级：图片列表、`/api/tools/renderers`、ComfyUI 状态（`apps/server/src/routes/monitor/status.ts:86-120`，1.5s/2s 超时 + 1.5s 缓存）。

### 候选根因判定（v2）

| # | 机制 | 判定 | 依据 |
| --- | --- | --- | --- |
| C1 | 会话文件整轮被 `lockWorkspaceFiles` 占用导致阻塞 | **不成立（对症状）** | `apps/server/src/modules/localRuntime/workspace/files.ts:86-93` 重叠即同步 throw 409，不会挂起；且只覆盖该会话 jsonl，只在 fork/rewind/delete/rename 命中（`sessions.ts:250/417/501/558`），读会话不走锁 |
| C2 | `@toonflow/file` 读写许可让读等 30s | **不成立（对症状）** | SDK 用裸 `node:fs` 同步读写（`session-manager.js:3-7`），完全绕开 `access.ts`；该许可只在单次 action 内持有，整轮不存在长持有写者 |
| C3 | 同步重活阻塞事件循环 | **机制存在、量级无据** | 同步点均在消息边界：`appendFileSync`、`message_end` 的 `getAgentStats/getAgentContext`；实测 2MB 会话整读解析 ≈4.8ms、19.7MB JSON parse ≈17ms |
| C4 | 浏览器同源 HTTP/1.1 6 连接上限被长连接/轮询占满 | **成立，唯一自洽** | Agent NDJSON 整轮占 1 条（`routes/agent.ts:35-41`）；另有素材变更流 `/api/assets/events`、余额 EventSource、ffmpeg EventSource、缩略图串、ComfyUI 3s 轮询（单次占 1 条 1.5–3.5s）。**排队的请求在浏览器侧，服务端根本收不到** → 所有接口"一起超时" |
| C5 | 日志/SSE 写流背压 | **不成立** | 对照实验：4s 持续 NDJSON + 50ms/帧，并发 `/ping` 始终 0.8–1.1ms |

### 为什么"分支复制的节点"更容易触发

分支节点会额外产生克隆会话与并行的 run；同时面板为每个画布实例各持一份素材库订阅（`canvasHost.vue` 的 `instances`）。**长连接条数随节点/画布实例数线性增长**，先撞 6 条上限的那台客户端就表现为"全线卡"。这一点需实测确认（见方案第 0 步）。

### 目标

1. Agent 执行期间，其它接口（工具界面、图片列表、ComfyUI 状态、设置读写）保持可用，不再出现"所有接口一起超时"。
2. 同源并发长连接在任意时刻有明确上限，且不随节点数线性增长。
3. 出现异常能自证：页面内可读到"当前同源在飞请求数/长连接数"，服务端留慢请求记录。

### 风险

- 若实测不是 C4 而是未发现的机制，方案第 0 步会把它暴露出来，避免改错层。
- 若坐实 C4，修法会触及前端连接管理（多个 EventSource 的合并/懒连接），回归面涉及素材库实时刷新、余额、ffmpeg 三条链路。

---

## B2 轮次目录跳转落点偏移

### 已确证

- 目录条：`messageList.vue:84-92`；索引取 `displayedMessages` 下标（`:143-144`、`:182-186`），与虚拟器 `count`/`getItemKey` 同源，**不存在下标错位**。
- 跳转：`jumpToTurn`（`:188-197`）调 `scrollToIndex(index, { align: "start" })`。
- 虚拟器：`estimateSize: 240`（`:159`）、`anchorTo: "end"`（`:162`）、`paddingStart: 12`（`:161`）、`overscan: 3`、`useCachedMeasurements: !props.active`（`:166`）。

### v2 修正：根因待实测

初审指出：`virtual-core@3.17.11` 的 `scrollToIndex` 内部会 `scheduleScrollReconcile()` 逐帧纠偏（上限 5s），所以"估算误差线性累积"只解释首帧，不足以解释最终落点。因此**不能再写"根因已定位"**。

需要实测的是：点击第 N 轮后 (a) 目标行是否被渲染、(b) 落定位置与容器顶部的偏差、(c) 该偏差在 1 帧/5 帧/1 秒后是否收敛、(d) 是否被 `followOnAppend`/实时行测量反复拉走。

### 目标

- 点击第 N 轮 → 该轮提问行顶对齐滚动容器顶部，落定误差 ≤ 2px，且 1 秒内不再漂移。
- 不破坏「贴底 / 回到最新消息」既有逻辑。

---

## B3 文本节点摘要丢失

### 已确证

- 上游摘要**仍然工作**：`mentionSources.ts:151` `previewLength = 200`，`upstreamPreview()` 压平空白截断，进 `createNodeMention` 的 `value.upstream`。实测用户最近 4 个会话 jsonl，`文本内容（需用工具读取）` 占位出现 0 次，且提示词里确实是 200 字预览。
- 真正缺摘要的是**输出引用**：`createCanvasMention`（`mentionSources.ts:121-132`）对文本输出只返回 `{ path, mimeType: "text/markdown" }`，正文一个字都不带。
- 展示侧同样缺：`mentionContent.vue:11` 对 `dataType === "NODE"` 只显示一句说明，不渲染 `value.upstream`；文本输出引用（`{path,mimeType}`）走不到 `:13` 的正文分支。
- 仓库中不存在 150 字预览常量（源码/build/git 均无）。

### 用户决策（已确认）

摘要 = **正文前 150 字**，不含引用标记、路径、label 等元信息。

### 目标

1. 文本输出作为引用进入上下文时，携带正文前 150 字摘要，同时保留 `path` 指针供按需读全文。
2. 上游摘要长度与引用摘要统一（当前上游为 200；按用户决策统一到 150），提示词文案同步改。
3. 引用气泡能显示这段摘要，不再只给一句说明。
4. 正文超限（`mentionFiles.ts:19-23` 的 400000 字节 / 100000 字符）、读失败、空正文时，引用仍可用，仅摘要为空。

### 风险

低。改动在 `mentionSources.ts`、`mentionFiles.ts`、`runtime/mentions.ts`、`mentionContent.vue`。

---

## 二、范围之外

- ComfyUI 出图链路自身的重试与队列。
- 工具层强制中断（`askUser` / MCP / 转写）的超时治理。
- 上一轮代码审查中与本次无关的既有问题（`conversation.vue` 斜杠命令吞草稿等），另行处理。

---

## 三、评审意见（用户填写）

> 评审人：
> 结论：通过 / 驳回
> 意见：

---

## 四、评审意见（子 agent 初审）

> 评审人：analysis-reviewer（code-reviewer）
> 结论：**需修订**（已按意见修订为 v2）
> 主要意见：① B1 的 C2/C5 不成立、C1 与症状不符、C3 量级无据，C4 才是唯一自洽解释；② `timeout exceeded` 裸串对应 `config.timeout` 未配置分支，不能直接推出"服务不响应"；③ 「生产环境失败即切 mock」是错误结论，已删除；④ B2 的"根因已定位"不成立，库自带 scroll reconcile，需实测；⑤ B3 行号小偏已修正。
