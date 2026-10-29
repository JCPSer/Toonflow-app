# 需求方案：Agent 节点自动带入直接上游（含节点自身输出摘要）

- 时间：2026-10-29 18:12（v2，18:45 按初审结论改落点）
- 关联需求矩阵：`1_requirements_matrix/2026-10-29-18-09-agent-upstream-context.md`

## 一、v1 为什么被推翻

v1 打算在服务端 content 组装处另拼一段「画布上游快照」。初审指出三处硬伤：

1. **前提错**：`agentNodePanel.buildMentions` 已经把 Agent 节点 `in` 端口的上游自动做成 NODE 提及，每轮进 prompt。真正缺的是"上游节点自己产出了什么"，不是"上游是谁"。
2. **R8 无保证**：干净原文只在 `attachments.length || mentions.length || /skill:` 时才写 `toonflowUserMessage`（`runtime/index.ts:281`）；纯文本提问会回退到 SDK 里的 message.content，另起注入块必然把 JSON 露在历史里。
3. **文本项缺 path**：`collectUpstream` 只给媒体 `path`，文本项没有路径，模型没法按路径读全文，"150 字摘要 + 路径"落不了地。

v2 改为扩展现有提及链路：既然是同一条通道，就直接把缺的那一层补进去。

## 二、v2 方案

### 2.1 提及载荷增加 `self`

`mentionSources.ts` 的 `createNodeMention` 在 `value` 里新增 `self`：

```
self = 首个 available 输出的摘要
  ├─ 有 textPath（正文落盘）：{ outputId, outputName?, dataType:"STRING", preview:≤150 字, path, mimeType:"text/markdown" }
  ├─ 媒体值（IMAGE/MASK/VIDEO/AUDIO/FILE）：{ …, preview: 文件名, path, mimeType }
  ├─ 内存字符串值：{ …, preview:≤150 字 }          // 例如未落盘的文本快照
  └─ 无可用输出 / 非上述类型：不加 self 字段
```

`preview` 仍走 `upstreamPreview()`（压平空白 + `mentionPreviewLength = 150`），与其他摘要同一个真源。正文读不到时给占位「文本内容（需用工具读取）」，与上游口径一致。

`createNodeMention` 结果形状从 `{ upstream, truncated? }` 变成 `{ upstream, truncated?, self?, agent? }`，仍满足 `agentMentionsSchema` 的 `isBoundedValue`（深度 ≤32、单条 ≤100000 字符）。

### 2.2 提示词说明补一句

`runtime/mentions.ts` 的 `nodeHint` 增加：`self` 是该节点首个可用输出的摘要（文本 150 字并附工作区相对路径，媒体只给路径与 mimeType），`upstream` 是它的直接上游；两者都不是完整内容，需要全文时用 `read` 按路径读或画布工具按 nodeId 读。

### 2.3 开关

- 存储：`settings.general.agentUpstreamContext`。
- 前端 store：`generalSettings.agentUpstreamContext = general.agentUpstreamContext !== false`（缺键按开）。
- 生效点：`agentNodePanel.buildMentions` 首行判断，关掉直接返回空数组 → 本轮不再自动引用上游；手动 @ 不受影响，@ 出来的提及同样带 `self`。
- 界面：设置 → 通用 → 「Agent 上游上下文」开关。

### 2.4 为什么不加去重 / 不做 hash

`self` 与 `upstream` 在同一份 mention 里，本来就不重复；自动提及与手动 @ 同一节点时，`conversation.vue` 按 `mention.id` 去重（id 每次都新建，实际上仍会各带一份，属可接受冗余）。不引入跨轮 hash：v2 没有独立块，历史里每条消息本来就带着自己那份快照，加 hash 反而要改存储结构。

## 三、改动文件

| 文件 | 改动 |
| --- | --- |
| `apps/server/src/agent/mentionSources.ts` | 新增 `nodeSelfOutput()`；`createNodeMention` 的 value 增加 `self` |
| `apps/server/src/agent/runtime/mentions.ts` | `nodeHint` 文案补充 `self` |
| `apps/web/src/pages/workspace/panels/canvas/components/agentNodePanel.vue` | `buildMentions` 读开关，关掉不自动引用 |
| `apps/web/src/stores/settings.ts` | `generalSettings.agentUpstreamContext` |
| `apps/web/src/components/settings/panels/general/index.vue` | 新增开关 section |

服务端与前端都要重启应用生效（服务端代码随桌面入口打包）。

## 四、验收

1. 文本节点 A（300 字）→ Agent 节点 B：发「这段讲什么」，模型能复述前 150 字。
2. 改 A 的正文再发：看到的是新内容（每轮重建提及）。
3. 图片节点连入：提及里是 `path` + `mimeType`，没有二进制。
4. 断掉连线再发：该上游不再出现。
5. 设置里关掉开关：连着的上游不再自动进上下文；重新打开恢复。
6. 用户气泡与历史回放只显示原始提问，不出现 JSON。
7. 画布文件读不到 / 节点已删：消息照常发出，只是少了这条上游。

## 五、评审意见

| 评审人 | 时间 | 结论 | 意见 |
| --- | --- | --- | --- |
| 子 agent 初审（对 v1） | 2026-10-29 18:32 | 修完可通过 | 见需求矩阵评审栏 |
| 用户（落点选择） | 2026-10-29 18:40 | 通过 | 选"改扩展现有提及链路" |
| 子 agent 终审（对 v2） | | | |
