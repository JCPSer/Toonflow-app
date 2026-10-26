# 记忆：空节点可引用为「节点引用」+ 工具栏图标文字

## Situation

画布节点在没有可用输出时（刚添加的图片节点、空文本节点、有端口但内容为空的节点）无法加入 Agent 对话上下文：节点工具栏的 `@` 按钮置灰、title 显示「暂无输出」，对话框 `@` 菜单里该节点行也点不动。此外工具栏 `@` 与图片节点「缩放」两个按钮只有图形没有文字，用户把 `IconResize` 误认成「图像裁剪」。

根因是引用模型只表达「某个节点的某个输出值」：`AgentMention.source` 的 canvas 分支强制要求 `outputId`/`outputName`，输出为空时没有任何一条路径能生成引用，于是工具栏、`@` 菜单、服务端 schema 各自独立把空节点挡掉。

## Task

不改动「有可用输出节点」的任何既有行为，让任何节点都能被引用为「节点本身」，且引用只携带身份（用户明确选择「只给身份」，不要 data 快照）。

## Action

- 数据模型：`runtime/types.ts` 的 canvas 分支 `outputId`/`outputName` 改为可选；无 `outputId` 即节点引用，`dataType = "NODE"`、`value = null`。`runtime/mentions.ts` 的 schema 放行可选字段，`superRefine` 增加「输出 id 与名称要么都有要么都没有」和「NODE ↔ 无 outputId」两条一致性校验；`mentionPrompt` 在存在 NODE 引用时追加一句说明，避免模型当成空引用。
- 创建链路：`mentionSources.ts` 新增 `createNodeMention`（label 固定为节点名），`MentionCanvasSource` 增加 `selectNode`；路由新增 `operation: "selectNode"` 独立分支（不复用 `selectCanvas`，因为 `outputId === undefined` 在 `storedMentionOutput` 里表示「列出输出」）；`mentionFiles.ts` 新增 `storedNodeMention` 供离线画布使用；`canvasHost.vue` 实现实时 `selectNode`。
- 入口：`nodeSkeleton.vue` 的 `@` 按钮去掉 `!hasAgentContextOutput` 的禁用与早退（两处闸门），无可用输出时改插节点引用；`canvas/index.vue` 的 `insertNodeAgentMention` 支持省略 `outputId`。
- `@` 菜单：节点行外层由 `<button>` 改为 `<div role="option">`，行尾新增「节点」按钮作为「引用节点本身」的入口；新增 `MentionRow.interactive` 与 `available` 分离，节点行恒可交互；`chooseRow` 的「无可用输出」分支提到最前，覆盖「有端口但全空」；键盘跳过与默认高亮改用 `interactive`；「暂无输出」改为走 translate 的「无输出」。
- 渲染：`mentionContent.vue` 的 `sourceLabel` 兼容无 `outputName`，预览弹窗新增 NODE 分支；`messageInput.vue` 的去重键补 `outputId ?? ""`，避免与输出引用撞车。
- 文案：`nodeSkeleton.vue` 的 `@` 按钮加「加入对话」，`imageNode/index.vue` 的缩放按钮加「缩放」。

## Result

四包类型检查全部 0；用 bun 直接跑服务端模块验证了 7 个 schema/prompt 用例（节点引用通过、半截字段拒绝、NODE 与输出引用互斥、hint 命中、token 校验生效）；`bun run build` + `build:nodes` + 桌面入口打包通过，已同步到 `/Applications/toonflow-exec.app` 与 `/tmp/tf-lib/data/nodes`。界面点验与 dev server 重启待用户执行。
