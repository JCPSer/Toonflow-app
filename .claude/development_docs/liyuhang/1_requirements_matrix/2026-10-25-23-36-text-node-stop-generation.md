# 需求矩阵：文本节点生成中可打断

## 一、需求背景

文本节点点「生成」后，发送按钮变成转圈 loading 且禁用，整段生成期间用户无法停止。长文生成常常几十秒到数分钟，写错提示词只能等它跑完、白烧 token。用户要求：生成中把转圈变成可点击的停止按钮，真正中断上游模型输出，已生成的部分保留可继续编辑。

用户答复（2026-10-25 23:5x）：
1. 打断深度 = **真中断上游**
2. 停止后已生成内容 = **保留并可编辑**
3. 交互 = **转圈变成停止按钮**（并支持 Esc）
4. 覆盖范围 = **只补文本节点**，Agent 对话已有停止，行为保持对齐

## 二、现状盘点（调研结论）

| 项 | 现状 | 出处 |
| --- | --- | --- |
| 文本节点按钮 | `:loading="generating"`，生成中禁用，无停止入口 | `packages/nodes/textNode/src/index.vue:38` |
| 生成调用 | `ai.generate({...})` **没有传 signal**；组件卸载时 `useNodeAi` 内部 controller 才 abort | `packages/nodes/textNode/src/index.vue:225-251`、`packages/nodeScaffold/src/nodeAi.ts:275-278` |
| 传输协议 | `POST /api/ai/generate`，SSE（text / reasoning / done / error） | `apps/server/src/routes/ai/generate.ts` |
| 服务端中止 | 仅监听 `res.close` / `req.aborted` / `socket.close` → `controller.abort()` 传到 pi-ai provider | `apps/server/src/routes/ai/generate.ts:56-63,75` |
| 可靠性隐患 | 代码注释明确：Bun 的静默 SSE 可能不通知关闭，**不保证立即停止上游** | 同上 `:61` |
| 服务端 runId 注册表 | 文本生成**没有**；媒体生成有 `mediaTasks`，临时 Agent 有 `/api/singleAgent/control`（stop 带 runId） | `apps/server/src/utils/media/tasks.ts`、`routes/singleAgent/control.ts` |
| 可参照的节点范式 | 图片/视频/音频节点：生成中按钮换成 `IconPlayerStop`，点击 `controller.abort()` | `packages/nodes/imageGenerationNode/src/index.vue:91-95,175-176` |
| Agent 能否触发生成 | 不能。textNode 只注册了 `setText`，没有生成工具 | `packages/nodes/textNode/src/index.vue:256-267` |

## 三、需求矩阵

| 编号 | 需求 | 优先级 | 难度 | 风险 | 验收标准 |
| --- | --- | --- | --- | --- | --- |
| R1 | 生成中发送按钮变为「停止」按钮（方块图标），点击立即停止 | P0 | 低 | 低 | 点击后 1s 内停止追加文字，按钮恢复为发送态，可再次生成 |
| R2 | 停止后已生成的部分文本保留在节点里，并可继续编辑/保存 | P0 | 低 | 中：finally 里的 saveText 时序 | 停止后节点正文等于停止那一刻的文本；失焦重开节点内容不丢 |
| R3 | 停止时真正中断上游模型请求，而不是只让前端不显示 | P0 | 中 | 中：SSE 闭环不可靠，供应商侧是否停止计费无法保证 | 见 3.1 的可观测定义 |
| R4 | Esc 键在生成中可停止 | P1 | 低 | 低：与画布其它 Esc 冲突 | 节点处于激活状态时按 Esc 停止；未生成时 Esc 行为不变 |
| R5 | 停止后状态清理：`generating=false`、不弹错误提示 | P0 | 低 | 低 | 停止不出现红色错误 toast；按钮可立即再次点击 |
| R6 | 不干扰 Agent 对话的既有停止行为 | P1 | 低 | 低 | Agent 面板停止行为与现在一致 |

### 3.1 R3 的可观测定义（按评审修改）

「真中断」在本仓库里能保证的边界是**取消对 provider 的 HTTP 请求**，不是供应商侧撤销任务或退款。验收按下面四条判定：

1. 前端点停止后，本地 SSE 在 200ms 内不再产生新的 text 事件；
2. `POST /api/ai/generate/stop` 返回成功，服务端在 1s 内 abort 对应 run；
3. 服务端日志出现 stop 命中与 stream 因 abort 结束的记录（新增日志）；
4. 用本地 mock provider 观测：stop 之后该请求的连接被关闭且不再收到新 chunk。

### 3.2 评审补充的验收项

| 编号 | 验收 |
| --- | --- |
| R7 | 生成中取消选中、多选、拖拽节点后，停止入口仍可用（底栏在生成期间保持可见） |
| R8 | 幂等与竞态：stop 早于 generate 注册 → 该 runId 下次注册时立即 abort；连续快速点停止只产生一次有效 abort、无重复请求、无红色提示；停止后立刻重新生成使用新 runId，旧 stop 迟到不影响新生成 |
| R9 | 保存失败（409 ESTALE／文件被删）时：部分文本仍在内存、有可感知错误、内容可复制，不会静默丢失 |
| R10 | 多文本节点同时生成时，停 A 不影响 B；两个标签页各自独立 |
| R11 | 生成正常结束或已停止后再调 stop：幂等成功，不弹错 |
| R12 | 首个 token 到达前停止：保留生成前的旧正文，不报错（「停止那一刻的文本」以此为准） |
| R13 | stop 接口缺少 `x-toonflow-workspace` 或跨源：403 |
| R14 | 停止按钮 title/aria-label 随状态切换，键盘（Enter/Space）可停止 |

## 四、方案取向（待评审确认）

**核心矛盾**：前端 abort 只能断开连接，服务端是否收到断连取决于运行时（代码里已有"Bun 静默 SSE 可能不通知"的注释）。要实现"真中断上游"，建议双保险：

- 前端：`AbortController` → `ai.generate({ signal })`，立刻停止渲染；
- 服务端：给每次生成分配 `runId`，登记到任务表（照 `mediaTasks` 模式），新增 `POST /api/ai/generate/stop`；前端停止时同时发这个请求，服务端按 runId `controller.abort()`，不依赖 socket 关闭事件。

备选：只做前端 abort + 依赖连接关闭（改动更小，但达不到"真中断"的确定性）。

## 五、边界（本期不做）

- 不做 Agent 面板的停止改造（已具备）。
- 不做 ComfyUI 队列中断（现状没有取消能力，且与文本节点无关）。
- 不做"重新生成"按钮、不做部分结果自动转成某节点的输入。
- 不做服务端持久化的生成历史/审计。
- 不给 textNode 增加 Agent 可调用的 `generateText` 工具（若将来要加，signal 透传需一并设计，本期不做）。

## 六、评审意见

### 6.1 初审（子 agent，2026-10-26 00:05）：需修改后通过

| 级别 | 问题 | 处理 |
| --- | --- | --- |
| 阻断 | R3「日志出现上游 abort」不可验证，且把「真中断」夸大成供应商侧停止 | 已改为 3.1 的四条可观测定义，并明确不保证计费停止 |
| 重要 | runId 注册表的生命周期、并发键、内存泄漏、stop 早到的竞态 | 采纳：值用 Set<controller>；外层 finally detach；60s 墓碑；10min TTL；容量上限；不持 res 引用 |
| 重要 | `router.ts` 是生成物，漏跑会 404 | 采纳：新增 routes/ai/generate/stop.ts 后 `bun run routes` |
| 重要 | stop 接口没有来源校验 | 采纳：`assertAppRequest`（同源 + x-toonflow-workspace） |
| 重要 | Esc 挂在节点根收不到底栏按键，window 捕获又会抢事件 | 采纳：直接挂 promptCard 的 keydown + 焦点归属 + defaultPrevented 判定 |
| 重要 | 生成中取消选中/多选会让停止按钮消失 | 采纳为 R7：底栏 `selected \|\| generating` |
| 重要 | Element Plus `:loading` 会 disable，停止按钮点不动 | 采纳：不用 loading，改图标切换 + 分支 disabled |
| 重要 | 只按 `AbortError` 抑制 toast 不可靠 | 采纳：`stopRequested` 标志 + 先 abort 再 fire-and-forget stop |
| 重要 | 保存失败路径与升级后的生成不会覆盖部分文本 | 采纳为 R9；`result.text` 仅在未 abort 时写入 |

### 6.2 用户评审

| 评审人 | 结论 | 意见 |
| --- | --- | --- |
|  |  |  |
