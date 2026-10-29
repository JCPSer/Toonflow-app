# 变更记录：删除 scheduleMentions 后遗留引用导致画布交互失效

时间：2026-10-29 20:20
类型：自引入回归（极小改动，未走完整 bug 流程，按规则记录）

## Situation

重启应用后画布交互异常：节点里的输入框点不出来，整块画布像被冻住。

## Task

定位并修复；同时补上让这类错误不再漏过的检查。

## Action

- 控制台报 `ReferenceError: scheduleMentions is not defined`。
- 根因：上一轮把自动提及改成"发送时现取"时，删掉了 `scheduleMentions` 函数与它在 `open()` 里的调用，**漏删了注册它的 `watch([edgeIdsKey, nodeIdsKey], scheduleMentions)`**。这个 watch 在 `agentNodePanel` 的 setup 里执行，抛错使整个面板组件树挂掉，画布里节点的交互随之失效。
- 修复：删除该 watch 与随之失效的 `edgeIdsKey` 计算属性（`getEdges` 仍在 `buildMentions` 使用，保留）。
- 验证：重新构建部署后，控制台无该错误；25 个节点正常渲染；点击文本节点，`contenteditable` 编辑器在节点内正常打开。

## Result

- 修复只涉及前端，**刷新即可**，不需要重启应用。
- 教训：Vite 打包与 `vite build` 都不会报"引用了不存在的标识符"，这类错误只有 `vue-tsc` 或运行时才会暴露；而 web 的 typecheck 目前因既有的 `@/agentRuntime` 别名问题一直失败，所以本轮改动没被类型检查覆盖。删除/重命名符号后必须回搜该符号，或临时用 `rg` 做一次全量自检。
