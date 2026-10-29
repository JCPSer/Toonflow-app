# 需求方案：Agent 交互六项改造

- 记录时间：2026-10-29 11:30
- 关联需求矩阵：`1_requirements_matrix/2026-10-29-11-30-agent-interaction-batch.md`

## 一、R1 模型下拉恢复

**改动**：`conversation.vue` 的 props 改为 `withDefaults(defineProps<...>(), { acceptPending: true, showModelPicker: true, autoFocus: true })`。

**关键约束**：Vue 对 Boolean 类型 prop 缺省强制为 `false`（`resolvePropValue` 中 `isAbsent && !hasDefault → false`）。任何"默认开启"的布尔 prop 都必须显式给默认值，这是本项目后续新增布尔 prop 的硬规则。

## 二、R2 语音开关

- 工具配置：`packages/tools/mediaGeneration` 的 `configSchema` 加 `allowVoiceInput: z.boolean().default(true)`；`build.ts` 的 `configRules` 加一个 `switch` 字段（弹窗由 form-create 渲染，加字段即出现开关）。
- 前端读取：新增 `lib/agentInputSettings.ts`，从 `/api/tools/get` 读 `mediaGeneration.config.allowVoiceInput`，用 `ref` 缓存；保存后由 `pluginConfigDialog` 派发 `toonflow:tool-config-updated` 事件刷新。
- 生效范围：按钮显隐（`voiceButtonVisible`）+ 长按手势（`useVoiceInput` 新增 `enabled` 回调，`armVoiceInput` 首行判断）。只藏按钮不拦长按等于没关。
- 部署：`deploy-local.sh` 新增「安装内置工具（Resources）」，否则本地部署永远用旧工具配置。

## 三、R3 Agent 节点引用 + 文件索引

- 服务端 `createNodeMention` 增加可选 `extraValue()` 钩子；`storedNodeMention` 传入 `agentNodeMention(directory, node)`。
- 新逻辑（`mentionFiles.ts`）：读 `node.data.agentSessionFile` → 读 `.agent/sessions/<file>` 末尾 2 MB → 用 `message` 条目里 assistant 的 text 部分拼出最近回复摘要（截断 800 字）；用正则收集带媒体/文档扩展名的候选路径，逐个 `stat` 校验存在，最多 50 条。
- mention 值：`{ upstream: [...], agent: { sessionFile, summary, files: [{path,size,extension}] } }`。NODE 类型的 value 允许任意有界 JSON，无需改 schema。
- 提示词：`mentionPrompt` 的 NODE 说明补充 `agent` 字段含义，要求模型按路径 `read` 正文，不要猜内容。
- 前端无需改动：`@` 列表本就把无输出节点当作"引用节点本身"。

## 四、R4 草稿保留

- `messageInput` 暴露 `hasDraft()`（正文 / 附件 / 提及 / 正在编辑任一非空）；`conversation` 透传给外层。
- `agentNodePanel.unmountIfIdle()` 先问 `hasDraft()`，有草稿就不卸载 entry —— 面板用 `v-show` 隐藏，实例仍在，草稿自然保留；无草稿时保持原有回收逻辑，避免无限堆实例。
- 生命周期：切节点/关面板保留；切画布、切项目、重启应用时随组件销毁清空（符合"内存保留"）。

## 五、R5 /goal 指令模式

**状态**（新文件 `conversation/goal.ts`）：

```
GoalState = { goal, round, maxRounds(默认10), status: active|paused|done, updatedAt }
存放：<项目>/.agent/goals/<sessionFile>.json   （随项目迁移；无会话文件时只在内存）
标记：[[GOAL:DONE]]，宽松匹配并支持全角括号
```

**指令拦截**：`submitMessage` 在发送前取草稿正文，`/` 开头则由 `handleCommand` 消费并清空草稿，不进模型。

| 指令 | 行为 |
| --- | --- |
| `/compact` | 复用现有 `compactContext()` |
| `/goal <目标>` | 设定目标，轮次归零，`active` |
| `/goal` | 弹窗显示当前目标与状态 |
| `/goal stop` | `paused`，保留目标 |
| `/goal reset [新目标]` | 轮次归零继续；带内容则改目标 |
| `/goal off / none / cancel` | 删除目标文件 |
| `/goal help` | 指令说明 |

**循环**：`sendMessage` 的 `finally` 里，若目标 `active`、本轮未被用户中止、且确实产生了回复：
- 回复命中 DONE 标记 → `status = done`，剥掉标记，提示已达成；
- 否则 `round+1`，用 `goalReviewPrompt` 自动发下一轮（未达上限时）。

**中断恢复**：会话激活（`props.active`）后 1.5s，若目标 `active` 且不在生成中，自动补跑一次；用户点「暂停」置 `goalSuspended`，避免激活时又被拉起。

**UI**：输入框上方目标条：目标文本（超长省略）+ 状态轮次 + 暂停/继续/清除。

## 六、R6 生成中编辑 / 队列 / 打断

- `messageInput`：`locked` 去掉 `busy`（编辑器不再禁用）；发送区改为三态：
  - 空闲：主按钮发送；
  - 生成中：`入队`（带队列数角标）、`立即发送（打断）`、`停止` 三个按钮；
  - 队列区展示待发送条目，可单条「立即发送」或移除。
- `conversation`：新增 `sendQueue`；`sendMessage(source?, queued?)` 支持从队列负载发送（不再依赖输入框草稿）；`finally` 里按优先级处理——打断目标 > 自然结束补发队首 > 目标循环。
- 打断发送的时序风险：服务端可能还没把旧请求摘出"正在运行"，因此新请求遇到 409 时按 300/600/900ms 退避重试（最多 4 次）。
- 用户主动 `stop` 时置 `stoppedByUser`，队列保留但不自动续发。

## 七、改动清单

| 文件 | 改动 |
| --- | --- |
| `apps/web/src/components/agent/conversation.vue` | Boolean prop 默认值；队列；目标状态/指令/循环；409 重试 |
| `apps/web/src/components/agent/conversation/messageInput.vue` | 解锁输入；入队/立即发送/停止三按钮；队列条；语音开关；`hasDraft` |
| `apps/web/src/components/agent/conversation/useVoiceInput.ts` | `enabled` 门禁 |
| `apps/web/src/components/agent/conversation/goal.ts`（新） | 目标状态、标记、回顾提示词 |
| `apps/web/src/lib/agentInputSettings.ts`（新） | 读工具配置里的语音开关 |
| `apps/web/src/components/settings/panels/pluginMarket/pluginConfigDialog.vue` | 保存工具配置后派发刷新事件 |
| `apps/web/src/pages/workspace/panels/canvas/components/agentNodePanel.vue` | 有草稿不卸载 |
| `packages/tools/mediaGeneration/{src/index.ts,build.ts}` | `allowVoiceInput` 字段与开关 |
| `apps/server/src/agent/mentionSources.ts` / `mentionFiles.ts` / `runtime/mentions.ts` | Agent 节点引用内容与提示词 |
| `scripts/deploy-local.sh` | 安装内置工具到 Resources |

## 八、风险与对策

| 风险 | 对策 |
| --- | --- |
| 目标循环失控（模型不输出标记） | 轮次上限默认 10，超过自动暂停；用户可随时暂停/清除 |
| 每次激活对话都自动补跑 | 只一次、1.5s 延迟、`goalSuspended` 与 `busy` 双重门禁 |
| 队列与目标循环互相抢占 | 优先级固定：打断 > 队列 > 目标；`finally` 单点调度 |
| 打断后立刻发送撞 409 | 退避重试 4 次 |
| 会话文件很大时摘要慢 | 只读末尾 2 MB；文件索引上限 50 条且必须 stat 通过 |
| 语音开关与真实能力脱节 | 保存后立即刷新；工具缺失/旧版按"开"处理 |

## 九、评审意见

| 角色 | 意见 | 结论 |
| --- | --- | --- |
| 用户 | （待填写） | |
| 子 agent 初评 | （待填写） | |
