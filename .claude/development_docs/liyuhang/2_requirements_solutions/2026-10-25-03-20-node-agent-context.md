# 需求方案：节点快捷加入 Agent 上下文

对应矩阵：`1_requirements_matrix/2026-10-25-03-20-node-agent-context.md`

## 一、链路设计

```
节点工具栏按钮（nodeSkeleton）
   │ 点击（stop 冒泡，不触发节点选中/拖动）
   ▼
画布提供的注入函数 useNodeAgentContext()(nodeId, anchorElement)
   │ 读取该节点实时输出（Vue Flow 节点 data + 当前 outputs）
   ├─ 有值输出 = 0 → 提示「暂无输出」，按钮本就禁用
   ├─ 有值输出 = 1 → 直接解析 mention
   └─ 有值输出 > 1 → 在按钮旁弹端口菜单，选一项再解析
   ▼
mention 解析：复用 useMentionSources().selectCanvas({canvasId,nodeId,outputId})
   │ 返回 AgentMention（source.kind = "canvas"）
   ▼
agentComposer store（新）
   │ queue: AgentMention[]
   ▼
messageInput.vue 监听队列 → insertMentions([mention]) → 聚焦光标到末尾
   │ 若 agent 面板未打开 → 先 showAgentPanel() 再插入
   ▼
用户补充文字后发送，与手动 @ 完全一致
```

## 二、改动点

| 文件 | 变更 |
| --- | --- |
| `packages/nodeScaffold/src/nodeSkeleton.vue` | 工具栏新增图标按钮（`IconAt`/`IconMessagePlus`），点击 emit/inject 调用画布注入的处理函数；无输出时禁用 |
| `apps/web/src/pages/workspace/panels/canvas/index.vue` | `provide("nodeAgentContext", handler)`：取节点输出、单/多端口分流、弹菜单、调用 selectCanvas、写入 composer store、必要时打开 agent 面板 |
| `apps/web/src/pages/workspace/components/floatingAgent.vue` 或 `workspace/index.vue` | 暴露 `showAgentPanel()`（已有 visible model，补一个 provide） |
| `apps/web/src/stores/agentComposer.ts`（新） | `{ queue, push(mention), take() }`，纯内存，不持久化 |
| `apps/web/src/components/agent/conversation/messageInput.vue` | 监听 composer 队列，复用现有 `insertMentions`；去重与 20 条上限沿用 |
| `apps/web/src/components/agent/mentionText.ts` | 如需，补充输出名展示（复用现有） |

复用而不重写：mention 解析、插入、去重、上限、缩略图渲染全部沿用现有实现。

## 三、端口菜单

- 触发：有值输出 > 1。
- 形态：`el-popover`/`el-dropdown` 挂在按钮上，宽 240；每项显示输出名、类型徽标、图片/视频缩略图；键盘 ↑↓ + Enter，Esc 关闭。
- 只列出「有值」的输出（`value.url` 或文本非空）；为空输出置灰并注明「暂无内容」。

## 四、边界

| 场景 | 行为 |
| --- | --- |
| 节点无输出 | 按钮禁用，title「暂无输出」 |
| 同一输出重复点击 | 已在草稿中则不重复插入，toast「已在上下文中」 |
| 草稿已达 20 条提及 | 沿用现有警告，不插入 |
| agent 面板关闭 | 自动打开后插入 |
| 非画布页（文档页） | 按钮不存在（节点不渲染） |
| 多选节点 | 只处理被点击的那个节点 |

## 五、测试

| # | 用例 | 期望 |
| --- | --- | --- |
| 1 | 单输出图片节点点击 | 输入框出现 `@节点名`，面板自动打开 |
| 2 | 多输出节点点击 | 弹出端口菜单，选 mask 后插入对应提及 |
| 3 | 无输出节点 | 按钮禁用 |
| 4 | 连续点击两次 | 第二次提示已存在，不重复 |
| 5 | 插入后补充文字发送 | agent 能读到该节点输出（与手动 @ 等价） |
| 6 | 点击按钮后节点未被拖动/选中状态未变 | 通过 |

## 六、评审意见

| 评审人 | 意见 | 结论 |
| --- | --- | --- |
| 子 agent（待填） | | |
| 用户 | 三个交互选择已确认 | 已采纳 |
