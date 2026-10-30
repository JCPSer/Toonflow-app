# 需求方案：Agent 对话工具调用折叠

- 时间：2026-10-30 10:50（11:10 按首轮初审修订）
- 对应需求：`1_requirements_matrix/2026-10-30-10-45-agent-tool-call-fold.md`
- 改动性质：纯前端渲染 + 一个全局设置字段；不动服务端与会话存储

## 1. 方案总览

新增全局设置 `generalSettings.expandToolCalls`（默认 `false`，即折叠）。折叠态下 `messageList.vue` 渲染消息 `parts` 时，把同一消息内连续的多个工具调用聚合成一个 `toolGroupMessage` 行；单个工具保持原卡片；`askUser` 提问出现时单独显示、回答后并入聚合；浏览器操作按轮收进一行，展开才真正挂载画面。

开关打开时走原渲染路径，行为与当前版本完全一致。

## 2. 改动面

| 文件 | 改动 |
| --- | --- |
| `apps/web/src/stores/settings.ts` | `generalSettings` 增加 `expandToolCalls: general.expandToolCalls === true`（默认 false） |
| `apps/web/src/components/settings/panels/general/index.vue` | 在“Agent 上游上下文”同组增加 `el-switch`「展开工具调用」，`updateGeneralSettings({ expandToolCalls })`；文案沿用硬编码中文（由 i18n extract 自动抽取） |
| `apps/web/src/components/agent/toolGroupMessage.vue` | 新增：聚合行（标题 + 状态汇总 + 展开后子工具列表），受控 `expanded`，转发 `@copy`、`directory`、`toolSessionId` |
| `apps/web/src/components/agent/conversation/messageList.vue` | 计算渲染块；持有展开态 Set；浏览器面板包一层可折叠容器（`v-if` 卸载）；用户展开时跳过自动贴底 |
| `apps/web/src/components/agent/toolMessage.vue` | 增加可选 `compact` 摘要（默认关闭，不影响其他对话框）；折叠容器内容加 `v-if` 以卸载 renderer 之外的详情（保持现状语义） |
| `apps/web/src/components/agent/replyStream.ts` | 收到非 running 的工具事件时 `delete part.tool.question`，让提问卡片回答后回到聚合 |

不改：`conversation.vue`、服务端、`sessions.jsonl`、`singleAgentDialog.vue`、`providerAgentDialog.vue`。

## 3. 状态与数据

- 设置：`generalSettings.expandToolCalls: boolean`，随现有 `watch(settings)` 自动保存（服务端 schema 为 `z.record`，实测放行未知字段）。
- 展开态：`messageList` 内的 `ref<Set<string>>`，key 统一为 `${message.id}:${run[0].id}`；展开态放父级，确保父级重渲染触发 `chat-item` 的 `@vue:updated → measureMessage`。
- 浏览器手动收起：`ref<Set<string>>` 记 message.id；默认展开条件为 `item.streaming || tools.some(t => t.status === "running")`，用户收起后不再自动打开。

## 4. UI 设计

### 4.1 聚合行（折叠态）

```
┌────────────────────────────────────────────┐
│ ⚙ 5 个工具调用 · 已完成                  ⌄ │
└────────────────────────────────────────────┘
  展开后：
┌────────────────────────────────────────────┐
│ ⚙ 5 个工具调用 · 已完成                  ⌃ │
│   ├ 读取文件 · 已完成 · 共 3 个文件       │
│   ├ 写入文件 · 已完成 · output.md         │
│   ├ 执行命令 · 失败 · exit 1              │
│   └ …                                     │
└────────────────────────────────────────────┘
```

- 标题：`N 个工具调用 · <汇总>`；汇总优先级：有进行中 → “N 完成 · M 进行中”；再追加“M 失败”（红色）；否则“已完成”；中断同理。
- 头部 `role="button"` + `aria-expanded`。
- 子行复用 `toolMessage` 的 `compact` 模式：工具名 · 状态 · 一行摘要（优先 `tool.args.action` 或工具名，再退回结果首行，截断 80 字）；点开看参数/结果。
- 单个工具不聚合，直接渲染原卡片（避免把工具自带界面藏进折叠容器）。

### 4.2 交互式提问

- 带 `question` 的 part 不参与聚合，单独渲染；表单由工具自带 renderer 渲染在折叠容器外，无需强制展开参数区。
- 回答后：客户端收到同 id 的非 running 工具事件时删除 `part.tool.question`，该 part 下次渲染即可并入聚合；`questionCard` 有 `args` 回退，不会丢文案。

### 4.3 浏览器操作

- 折叠态：每轮底部一行“浏览器操作 N 次 · 状态”，内容区用 `v-if` 挂载（`chat-reasoning` 默认 `v-show`，仅隐藏不卸载）。
- 默认展开：`item.streaming || tools.some(status==="running")`，且该 message.id 未被用户手动收起。
- 卸载只中断观看流、展开会重连，不影响远端浏览器会话。

### 4.4 设置项

```
设置 → 常规配置
  [ ] 展开工具调用     默认关闭；关闭时同一轮工具调用合并为一行，点击展开
```

## 5. 实现要点（伪代码）

```
// messageList.vue
const expandToolCalls = computed(() => generalSettings.value.expandToolCalls === true)
const expanded = ref(new Set<string>())
const userExpanding = false

type RenderBlock =
  | { kind: "part"; part: AgentMessagePart }
  | { kind: "toolGroup"; key: string; tools: AgentToolCall[] }

function renderBlocks(message): RenderBlock[] {
    if (expandToolCalls) return message.parts.map(part => ({ kind: "part", part }))
    const blocks: RenderBlock[] = []
    let run: AgentToolCall[] = []
    const flush = () => {
        if (run.length === 1) blocks.push({ kind: "part", part: { id: run[0].id, type: "tool", tool: run[0] } })
        else if (run.length > 1) blocks.push({ kind: "toolGroup", key: `${message.id}:${run[0].id}`, tools: run })
        run = []
    }
    for (const part of message.parts ?? []) {
        if (part.type === "tool" && isBrowserTool(part.tool)) continue      // 浏览器单独聚合，不断开 run
        if (part.type === "tool" && !part.tool.question) { run.push(part.tool); continue }
        // 不可见的 text/thinking 不断开 run
        if (part.type === "text" && !part.content) continue
        if (part.type === "thinking" && !part.content) continue
        flush()
        blocks.push({ kind: "part", part })
    }
    flush()
    return blocks
}
// 按消息缓存，避免流式渲染时全量重算
const blocksByMessage = computed(() => new Map(displayedMessages.value.map(m => [m.id, renderBlocks(m)])))

function toggleGroup(key) {
    userExpanding = true
    expanded.value.has(key) ? expanded.value.delete(key) : expanded.value.add(key)
    nextTick(() => { userExpanding = false })
}
```

模板 key 写成 `:key="block.kind === 'toolGroup' ? block.key : block.part.id"`（联合类型下不能用 `block.key ?? block.part.id`）。

`measureMessage` 中的自动贴底分支加条件 `!userExpanding`：用户主动展开时只做 `resizeItem`，不 `scrollToEnd`。

`toolGroupMessage.vue`：

```
props: tools, expanded, directory?, toolSessionId?
emits: toggle, copy
header: N 个工具调用 · 汇总（role=button, aria-expanded）
body(v-if=expanded): v-for tool → toolMessage(compact, :directory, :toolSessionId, @copy="emit('copy', $event)")
```

`replyStream.ts`：

```
case "tool": {
    const part = ...
    Object.assign(part.tool, event.tool)
    if (event.tool.status !== "running") delete part.tool.question
}
```

## 6. 边界与风险

| 风险 | 说明 | 处理 |
| --- | --- | --- |
| 展开态在子组件导致测量失效 | `@vue:updated` 只随父级重渲染触发 | 展开态放 `messageList`，子组件受控 |
| 最新行展开自动贴底 | 现有逻辑高度变化即 `scrollToEnd` | `userExpanding` 期间跳过 |
| 浏览器画面未卸载 | `chat-reasoning` 默认 `v-show` | 内容区 `v-if` |
| 运行信号 | `liveMessageId` 结束后不清空 | 用 `streaming || running` |
| 纯工具消息空白 | `displayedMessages` 按 parts 判断 | 聚合不改变 part 存在性，不产生空白 |
| 交互卡片被藏 | renderer 在折叠容器外 | 口径：一律折叠、展开才加载；提问卡片单列 |
| 粒度差异 | 实时一轮一条消息；刷新后按历史条目拆 | 已确认接受，写入验收 |
| 设置类对话框 | 不复用 `messageList`，但复用 `toolMessage` | `compact` 默认关闭，不改默认折叠行为 |
| 性能 | `renderBlocks` 随流式频繁重算 | 按消息缓存；聚合只做数组遍历 |
| 可访问性 | 聚合头是自绘按钮 | `role`/`aria-expanded`/键盘可触发 |

## 7. 测试计划

1. 设置开关：默认关、切换后自动保存、重启保持。
2. 折叠：一轮 5 次工具占 1 行；单工具不包层；文案与状态组合正确。
3. 展开：点开显示子行；子行点开参数/结果；复制按钮可用（`@copy` 透传）。
4. 提问：出现时单独显示表单；回答后并入聚合行；`questionCard` 文案正常。
5. 浏览器：折叠态无画面 DOM；运行中默认展开；手动收起后不自动弹开；展开后画面可用。
6. 开关打开：恢复逐条工具行。
7. 正文：用户消息、助手正文、思考块不变；纯工具消息无空白行、按钮保持。
8. 虚拟列表：连续展开/收起 10 次；展开最新一行时标题不被滚出视口。
9. 存储：开关前后 `.agent/sessions/*.jsonl` 与请求体一致。
10. 构建：web 构建通过，`vue-tsc` 无新增错误。

## 8. 评审意见（待用户填写）

> 请在此处填写评审意见；如无意见，回复“通过”即可。

## 9. 子代理初审记录（2026-10-30 11:00）

结论：方案方向成立，服务端 schema 实测放行；7 处必改、10 条建议已吸收：

- 必改 1：R4 与方案冲突 → 统一“回答后恢复折叠”，并在 `replyStream` 清除残留 `question`。
- 必改 2：展开态放子组件会绕过 `@vue:updated` 测量 → 移到 `messageList`。
- 必改 3：最新行展开触发贴底 → `userExpanding` 跳过。
- 必改 4：`chat-reasoning` 只 `v-show` → `v-if`；运行信号改用 `streaming || running`。
- 必改 5：模板 key 联合类型无法通过 `vue-tsc` → 改三元表达式。
- 必改 6：聚合子行漏 `directory`/`@copy` → 补齐。
- 必改 7：空 text/thinking 会拆断连续工具 → 分段只看可见 part；浏览器 part 透明跳过。
- 建议采纳：单工具不聚合、状态汇总优先级、自定义卡片口径、`compact` 摘要取 args 优先、按消息缓存、`role`/`aria-expanded`、i18n 走 extract。
- 事实纠正采纳：`askUser` 表单不依赖展开；`liveMessageId` 非运行信号；刷新后 message.id 变化会让展开态失效（可接受）。
