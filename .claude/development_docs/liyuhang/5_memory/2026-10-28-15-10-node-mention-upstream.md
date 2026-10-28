# 记忆：节点引用附带直接上游信息

## Situation

Agent 对话里「节点引用」（`dataType=NODE`）此前 `value` 恒为 `null`，只有画布与节点身份。用户看到一个处理节点时最natural的追问是「它输入来自哪些节点」，而模型必须先调 `getCanvasEdges({direction:"incoming"})` 才知道，多一次工具往返；上下文里也看不出节点处于链路中间还是末端。

补上游时撞到两个真实形态问题。其一，`textNode` 在 `loadText()` 里成功落盘后调 `Object.defineProperty(outputs.value, "toJSON", { value: () => ({}) })`，把 `outputs.text.value` 从画布 JSON 里抹掉，正文只留在 `data.textPath`（`assets/<nodeId>/content.md`）——所以离线读画布时 `mentionOutputValue` 返回 `{dataType:"STRING", textPath}` 而没有 `value`，预览只能落到「文本内容」这个 UI 占位。其二，画布 JSON 的 `edges` 里 handle 可能是 `null`，也可能指向已被删除的节点。

## Task

节点引用附一层直接上游：目标端口 id/名称、来源节点 id/名称/类型、来源输出 id/名称、dataType、短预览（文本 200 字压平空白 / 媒体文件名）；媒体只给 `path` + `mimeType`，不给内容也不给缩略图；最多 20 条并标 `truncated`；实时画布与离线画布两条链路都要生效；不递归。

## Action

- `mentionSources.ts` 新增 `MentionEdge` / `MentionNodeUpstream` / `collectUpstream()` / `mediaReference()` / `upstreamPreview()`；`createNodeMention(node, canvasId, context?)` 的 `value` 从 `null` 换成 `{ upstream, truncated? }`。
- **关键修复（审查查出）**：`collectUpstream` 增加可选 `readText`，当 `selected.value` 不是字符串但 `selected.textPath` 存在时读正文再截 200 字；读不到时预览写「文本内容（需用工具读取）」而不是裸的「文本内容」，避免模型把占位当摘要用。相应 `createNodeMention` 改成 async，`MentionCanvasSource.selectNode` 返回类型放宽为 `Promise<AgentMention> | undefined`。
- **`readCanvas` 侧**：`StoredCanvas` 增加 `edges`，从同一份画布 JSON 解析（`Array.isArray` 校验后过滤非法项，无额外 IO，`mtime:size` 缓存仍成立）；`storedNodeMention` 传入 `{ edges, nodesById, readText: path => readMentionText(directory, path) }`。
- **实时侧**：`canvas/index.vue` 暴露 `getMentionEdges: () => flow.getEdges.value`；`canvasHost.mentionSource.selectNode` 过滤掉 handle 为空的边后传入，并同样挂 `readText`（读工作区文件，因为上游 textNode 可能未挂载/未载入内存）。
- **统一口径**：`collectUpstream` 内部再滤一层 `!!sourceHandle && !!targetHandle` 与 `nodesById.has(edge.source)`，悬空边和空端口边两条链路都不产生「暂无输出」噪声。
- `mentions.ts` 的 `nodeHint` 与 `mentionContent.vue` 浮层文案同步为「身份 + 直接上游摘要，正文仍需工具读取」；两处过时注释一并改。

## Result

`@toonflow/server` typecheck 0；`@toonflow/web` typecheck 只剩仓库既有 `apps/server/src/modules/agentAccess/singleAgent/types.ts(2,3): Cannot find module '@/agentRuntime'`（stash 验证与本次无关）；web 构建成功，桌面入口重建并 `deploy-local.sh` 部署。

用「真实形态」夹具（textNode 的 `outputs` 为 `{}`、正文只在 `textPath`）直接跑 `createNodeMention` 验证：带 `readText` 时文本上游预览为压平后的真实正文；不带 `readText` 时为「文本内容（需用工具读取）」；`readText` 抛错不崩、同样降级；悬空边与 null handle 边被滤掉；25 条入边 → 20 条 + `truncated: true`（3855 字节）；无入边 `{upstream: []}`；旧 `value: null` 引用与新旧混发均通过 `agentMentionsSchema`。

顺带把被工具重排的 `apps/server/src/router.ts`（524 行纯编号重排）还原，本功能不再带这份无关 diff。待手测：真实界面里 @ 一个中间节点看浮层与提示词、上游来源节点删除后的降级、模型是否真的先用摘要而非直接调 `getCanvasEdges`。
