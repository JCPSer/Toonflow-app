# 复制 Agent 节点后两边对话同步（孪生）

- 时间：2026-10-31 21:20
- 涉及文件：`apps/web/src/pages/workspace/panels/canvas/agentSessionCopy.ts`（新增）、`selectionToolbar.vue`、`nodeClipboard.ts`、`canvas/index.vue`、`agentNodePanel.vue`

## STAR

**Situation**
使用者反馈：复制 Agent 节点后，在一边发消息，另一边也会出现，像孪生会话。当前实现是「复制时把 `agentSessionFile` 换成 `agentSessionCloneFrom`，首次打开再调用克隆接口生成新文件」，理论上不该共享。

**Task**
确认是否存在会共用同一 jsonl 的路径，并在不改变既有设计的前提下彻底消除。

**Action**
1. 走查四条复制/粘贴路径：节点副本、拖拽复制、剪贴板复制、粘贴，以及画布另存/导入；服务端克隆是逐字节复制 + 新 UUID 文件名，无硬链接。
2. 找到三个缺口：节点包 `copy` 事件是 2026-10-29 之后才有的（旧构建直接带走文件）；事件依赖节点组件挂载，异常时返回空补丁；画布层没有二次兜底，且历史脏数据不会自愈。
3. 新增 `detachAgentSession()` 纯函数：对 `remote-agentNode` 强制把 `agentSessionFile` 降级为 `agentSessionCloneFrom`，接入副本创建、剪贴板复制、粘贴三条路径（另存/导入本就有同类逻辑）。
4. `agentNodePanel.loadSession` 打开时检查是否有其他节点绑定同一文件，命中则克隆改绑并提示，自愈旧数据；克隆失败仍按原文件打开。

**Result**
- Web typecheck 仅剩既有无关报错，构建通过（3.91 s），产物含新逻辑。
- 已部署到安装版前端，未重启应用。

## 教训

- 把「复制时不共享资源」的责任放在节点包事件里是脆弱的：节点包可被替换、可加载失败，画布层必须有一道与插件无关的最后防线。
- 已有脏数据不会因为修了写入路径而消失，修复要考虑「打开时自愈」，否则用户仍会看到问题。
- 判断会话是否共享，最直接的证据是两个节点的 `agentSessionFile` 是否同一个文件名；排查时优先把它打出来，比追 UI 状态快。

## 关联

- 分析/方案/测试：`4_bugs_fix/bug_analysis-2026-10-31-21-20-agent-clone-twin.md`、`4_bugs_fix/bug_solution-2026-10-31-21-20-agent-clone-twin.md`、`3_test_results/2026-10-31-21-20-agent-clone-twin.md`。
- 相关历史：`5_memory/2026-10-29-19-19-agent-clone-pointer.md`、`5_memory/2026-10-30-15-30-agent-clone-running.md`。
