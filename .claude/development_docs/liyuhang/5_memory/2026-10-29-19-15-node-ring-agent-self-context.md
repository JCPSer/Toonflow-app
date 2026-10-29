# 变更记录：全节点呼吸描边 + Agent 上游自身输出摘要

时间：2026-10-29 19:15
需求：`1_requirements_matrix/2026-10-29-18-09-agent-upstream-context.md`
方案：`2_requirements_solutions/2026-10-29-18-12-agent-upstream-context.md`
测试：`3_test_results/2026-10-29-18-50-node-ring-agent-self-context.md`

## Situation

两件事：

1. 只有 Agent 节点和文本节点在工作时有一圈呼吸描边，图片生成、视频生成、视频导出、音频转写这些同样在跑的节点没有任何进行中反馈。
2. 文本节点连到 Agent 节点后，模型其实已经拿到了"这个上游是谁"（前端自动 NODE 提及），但拿不到"它产出了什么"——`createNodeMention` 只给被引用节点自己的上游摘要，不含它自己的输出正文。

## Task

1. 让所有节点的忙碌状态都有呼吸描边，且快速操作不要闪。
2. 给每个上游节点补上自身输出的 150 字摘要（媒体给路径），每轮刷新、可关闭。

## Action

- 描边：`nodeSkeleton.vue` 把 `running` 类改由本地 `ringActive` 驱动，来源 `props.busy ∪ props.running`，亮灯延迟 400ms、亮后至少保持 600ms。
- 上游：`mentionSources.createNodeMention` 增加 `self` 字段（首个可用输出：文本 150 字 + 工作区路径，媒体 path + mimeType，无输出/空摘要则不加），路径只接受工作区内相对路径；`runtime/mentions.ts` 的提示词说明 `self` 与 `summary` 的含义。
- 生效时机：`conversation.vue` 的 `extraMentions` 改成 `loadExtraMentions()`，在发送这一刻现取；`agentNodePanel` 删除 250ms 去抖缓存，取数前先 `flushCanvasSave()`。
- 开关：`settings.general.agentUpstreamContext`（默认开），关掉后 `buildMentions` 直接返回空，只剩手动 @。
- 补齐 busy 口径：imageGeneration 对齐 imageNode 全量；videoGeneration / audioGeneration / audioNode 补 `uploading`。

## Result

- 单元复验通过：150 字截断、媒体路径、空节点无 self、`../../etc/passwd` 与 `https://` 路径被丢弃、纯空白文本不生成 self、Agent 上游两项各带预览。
- server / nodes-scaffold typecheck 通过，web vite build 通过（web 的 `typecheck` 仍剩既有的 `@/agentRuntime` 别名问题，与本改动无关）。
- `./scripts/deploy-local.sh --build` 完成，10 个节点包已同步；描边与上游摘要都需要重启应用后实测。

## 关键教训

- 判断"某能力是否缺失"前必须把整条链路走一遍：这里上游身份早就自动进上下文了，缺的只是自身输出，差点按错误前提重写一条并行通道。
- 干净历史依赖"有 mentions 才写 toonflowUserMessage"这种隐式耦合，不能当作保证；扩展现有通道比新建通道安全。
- 缓存式构建（打开面板时算一次）在"上游会变"的场景下必然过期，应当把构建点移到使用点。
