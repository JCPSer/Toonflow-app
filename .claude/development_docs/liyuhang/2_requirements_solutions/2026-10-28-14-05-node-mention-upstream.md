# 需求方案：节点引用附带直接上游信息

- 记录时间：2026-10-28 14:05
- 对应需求：`1_requirements_matrix/2026-10-28-13-54-node-mention-upstream.md`
- 决策：只带直接上游（一层）；每个上游带短预览（文本前 200 字压平空白 / 媒体文件名）；实时与离线两条链路都生效

## 一、现状

- `createNodeMention(node, canvasId)` 只产出 `{ label, source: {canvasId, nodeId, nodeName}, dataType: "NODE", value: null }`（`mentionSources.ts:129-133`）。
- 实时链路 `canvasHost.mentionSource.selectNode` 只有 `findMentionNode`，拿不到边；`canvas/index.vue:504` 只暴露了 `getMentionNodes`。
- 离线链路 `mentionFiles.readCanvas` 只保留 `canvas.nodes`（`:42-44`），`edges` 被丢弃，但**边本来就在同一个画布 JSON 里**，不需要额外 IO。
- `mentions.ts:74` 的 `nodeHint` 仍写着「不含内容」，需要同步口径。

## 二、数据结构

节点引用的 `value` 从 `null` 换成：

```
{
  upstream: [                       // 最多 20 条，超出则 truncated: true
    {
      targetHandle: string,         // 目标节点上的输入端口 id
      targetHandleName?: string,    // 端口中文名（来自 data.handles 的 label），缺失时省略
      nodeId: string,
      nodeName: string,
      nodeType?: string,
      outputId: string,
      outputName?: string,
      dataType: string,             // 来源端口声明类型
      preview: string,              // 文本前 200 字压平空白；媒体取文件名；空输出写 "暂无输出"
      // ACT: 图片/视频/音频/文件不给内容也不给缩略图，只给定位信息，让模型自己用工具读。
      path?: string,                // media.url（工作区相对路径）
      mimeType?: string
    }
  ],
  truncated?: boolean
}
```

约束（评审确认）：`agentMentionsSchema` 的 `value` 是 `z.unknown()` + `isBoundedValue`，对象可过；但 `isBoundedValue` **会拒绝值为 `undefined` 的字段**，所以可选字段一律「有值才写」，不写 `key: undefined`。NODE 引用仍不得带 `outputId`。

## 三、实现

### 3.1 服务端解析上游（`mentionSources.ts`）

```
type MentionEdge = { source: string; sourceHandle: string; target: string; targetHandle: string }

collectUpstream(node, edges, nodesById, limit = 20):
  incoming = edges.filter(e => e.target === node.id).slice(0, limit + 1)
  items = incoming.slice(0, limit).map(edge =>
    source = nodesById.get(edge.source)
    output = source ? mentionNodeOutputs(source).find(o => o.id === edge.sourceHandle) : undefined
    targetHandle = 目标节点 handles 中 id === edge.targetHandle 的项
    {
      targetHandle: edge.targetHandle,
      ...(targetHandle?.label ? { targetHandleName: String(targetHandle.label).slice(0,160) } : {}),
      nodeId: edge.source,
      nodeName: source ? mentionNodeName(source) : edge.source,
      ...(source?.type ? { nodeType: source.type } : {}),
      outputId: edge.sourceHandle,
      ...(output ? { outputName: output.name, dataType: output.dataType, preview: shortPreview(output) } : { dataType: "", preview: "暂无输出" }),
    })
  return { upstream: items, ...(incoming.length > limit ? { truncated: true } : {}) }

shortPreview(output):
  output.preview 已由 mentionNodeOutputs 生成（文本 160 字/媒体名/占位）
  这里统一：把空白压成单空格，去首尾，截 200 字
  // mentionNodeOutputs 的 160 字截断保留（列表 UI 在用），上游预览按 200 字重新生成不够就复用其 preview

mediaRefs(output):
  // 媒体上游只带定位信息；文本类型不带 path/mimeType，避免冗余。
  if dataType ∈ {IMAGE, MASK, VIDEO, AUDIO, FILE} 且 value 是 { url, mimeType }:
    return { path: url（截 4096）, mimeType（截 128） }
  return {}
```

- `createNodeMention(node, canvasId, context?)` 增加可选 `{ edges, nodesById }`；缺省时 `upstream: []`，保持向后兼容（旧调用点不会崩）。
- 预览取 `mentionNodeOutputs(source)` 的 `preview` 字段（已有逻辑：文本取正文片段、媒体取文件名、无输出「暂无输出」），在此之上压平空白并截 200 字。

### 3.2 离线链路（`mentionFiles.ts`）

- `StoredCanvas` 增加 `edges: MentionEdge[]`；`readCanvas` 解析时校验 `Array.isArray(canvas.edges)`，非法则视为无连线（不报错，画布可能是手写文件）。
- `storedNodeMention` 传入 `{ edges: canvas.edges, nodesById: canvas.byId }`。
- 文本预览走已有的 `mentionNodeOutputs`，不额外读文件（预览是节点 data 里的片段，不是磁盘正文）。

### 3.3 实时链路（前端）

- `canvas/index.vue` 的 `defineExpose` 增加 `getMentionEdges: () => flow.getEdges.value`。
- `canvasHost.vue` 的 `mentionSource` 增加 `edges(canvasId): MentionEdge[]`（从 `mentionInstance` 的 panel 取），并让 `selectNode` 收集：
  ```
  nodes = panel.getMentionNodes()
  nodesById = new Map(nodes.map(n => [n.id, n]))
  createNodeMention(node, canvasId, { edges: panel.getMentionEdges(), nodesById })
  ```
- `MentionCanvasSource` 类型补 `selectNode` 已存在，无需新接口；`mentionSources.ts` 只改 `createNodeMention` 的签名。
- 前端 `apps/web/src/components/agent/mentionContent.vue` 的说明文案「只包含节点身份」同步改为「节点身份 + 直接上游摘要（正文仍需工具读取）」。

### 3.4 提示词（`mentions.ts`）

`nodeHint` 改为：

> 标为 NODE 的引用是画布节点本身，附带直接上游端口与来源摘要（预览最多 200 字，不是完整内容）；需要完整输出、参数或更远链路时，用画布工具按 nodeId 读取。

## 四、兼容性

| 场景 | 表现 |
| --- | --- |
| 旧会话里已保存的 NODE 引用（`value: null`） | 仍可通过 schema；重发时上游信息不会自动补（历史快照不变） |
| 没有入边的节点 | `upstream: []`，不写 `truncated` |
| 画布 JSON 缺 `edges` 字段 | 视为无连线，不报错 |
| 来源节点已被删除 | 仍列出边，`nodeName` 退回 nodeId，`preview: "暂无输出"` |
| 入边超过 20 条 | 只带前 20 条 + `truncated: true` |

## 五、测试方案

1. `@toonflow/server`、`@toonflow/web` 类型检查。
2. 构造夹具画布（3 节点 2 边）验证 `collectUpstream`：端口名、来源名、预览截断、20 条截断、来源缺失。
3. 隔离实例调 `/api/agent/mentionSource?operation=selectNode`，确认返回的 mention 含 `upstream`。
4. 实时链路手测：画布打开时引用节点，检查插入到输入框的 mention 内容。
5. 旧 `value: null` 引用仍能通过 `agentMentionsSchema`（用现有校验函数跑一遍）。

## 六、风险

| 风险 | 处置 |
| --- | --- |
| `isBoundedValue` 拒绝 `undefined` 字段 | 所有可选字段用条件展开，不写 `undefined` |
| 上游多导致上下文膨胀 | 只取一层、最多 20 条、预览 200 字；实测总量远低于 100000 |
| 离线画布 edges 结构不规范 | 校验 `Array.isArray` 后降级为空数组 |
| 实时链路取边时机（拖动中） | 取当前 `flow.getEdges.value` 快照，拖拽中引用也只会拿到当前已连的边 |

## 七、评审意见

- 子 agent 方案评审：可行，全部需求点可落地。
- 子 agent 代码审查（实现后）：指出离线链路 textNode 正文只在 `textPath`（`outputs` 被 `toJSON` 清空），原方案「不额外读文件」不成立，必须给 `collectUpstream` 增加 `readText`；另建议统一两条链路的边过滤口径、还原被重排的 `router.ts`、更新过时注释。均已采纳落地。
- 用户评审：
