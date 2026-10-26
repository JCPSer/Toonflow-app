# Agent 会话回退与复制为新会话（STAR）

## Situation

Agent 对话只有「编辑消息并重发」：它把分支指针移回再重跑，旧内容留在 JSONL 里但界面看不到。用户要两件事——回退（像 Claude Code 的 rewind，直接丢弃中间的对话）和复制为新会话（从某条消息截断另存一份）。

## Task

1. 用户消息悬停工具条加「回退到这里」「复制为新会话」。
2. 回退：物理删除该消息及之后的全部内容，内容回填输入框。
3. 复制：截到该轮结束写成新会话并打开，原会话不变。
4. 子 Agent 会话禁用两者；回退连带删除子会话文件；不留快照。

## Action

- `apps/server/src/agent/runtime/sessions.ts`
  - 抽出 `readSessionEntriesStrict()`（严格逐行解析、拒绝损坏行、id 唯一、parent 必须先出现、32 MB 上限），`deleteAgentMessage` 改为复用。
  - `collectRewindRemovals()`：锚点后代闭包（含 `branch_summary.fromId`）+ 派生记录（toolResult/toolCall、`toonflowUserMessage`/`toonflowAttachments`、label）+ 子会话文件清单。
  - `rewindAgentSession()`：活动会话 409 → 锁文件 → 计算 removed → 过滤 → 丢弃悬空的 compaction/branch_summary → **追加 `custom/toonflowRewind` 标记把叶钉回锚点父级** → 原子重写 → 递归删子会话文件。
  - `forkAgentSession()`：活动会话 409 → 锁文件 → 拒绝子会话 → 取 `branch.slice(0, 下一轮之前)` → 新 header（新 uuid、**不写 parentSession**）+ 复制条目（保留原 id）+ 新 `session_info`（「原名 · 副本」）→ `writeWorkspaceFile(exclusive)`。
- 新路由 `routes/agent/rewind.ts`、`routes/agent/fork.ts`，`bun run routes` 生成挂载。
- 前端 `messageList.vue` 加两个按钮（用户消息、子会话隐藏）；`conversation.vue` 加确认框与请求处理；`messageInput.fillRewind()` 用 Mention 标签还原提及并重置附件；`index.vue` 的 `openForkedConversation()` 刷新列表后再切会话。

## Result

- 服务端集成验证：fork 源文件字节不变、新会话可见；rewind 后文件只剩一轮 + 叶标记、子会话文件被删；损坏文件 400。
- 界面实测：按钮齐全、确认框文案正确、回退后列表与输入框正确、复制后自动切到新会话。
- 两端类型检查通过。

## 返工（澄清 + 代码审查）

- 入口按用户澄清拆分：回退在用户消息（右侧），复制在 agent 回复（左侧），服务端 fork 的锚点同时接受 user 与 assistant，仍以「该轮结束」为截止点。
- 子会话有三处坑：① 删除必须校验 `parentSession` 归属，否则 fork 复制的共享子会话会被源会话回退删掉；② 子 Agent 可能单独开着，操作父会话前要检查子会话是否 active；③ fork 必须深拷贝子会话并改写 `file/parentFile`，否则副本里的上报会写回源会话。
- 丢弃 compaction 后要把保留条目的 `parentId` 重接到最近存活祖先，否则整段历史断链且不报错。
- 32 MB 上限只该约束回退/复制，删除消息是清理超大会话的入口，不能被同一个上限挡住。
- 回退后前端要同步 `name` 与 `subAgents`，否则菜单里还挂着已被删掉的子 Agent 卡片。

## 经验

- **叶指针不落盘**：SDK 以文件最后一行为当前分支末尾；只删兄弟分支会让重开落到废弃分支。物理删除后必须显式写一个空标记把叶钉回去，这比"删到最后一行刚好是锚点父级"可靠得多。
- **`parentSession` 在历史列表里是"子会话"标记**：复制出的会话带上它会永久隐形；复制的 header 必须干净。
- 物理删除要删"锚点整棵子树"而不是"文件尾部"，否则旧分支的孤儿节点会留下；现有结构校验只查 parent 是否出现过，查不出孤儿。
- 压缩记录的 `firstKeptEntryId` 指向被删条目时，SDK 不报错，只是静默返回被截短的上下文——这类"静默降级"必须主动检测。
- 前端切换会话前要先 `await` 历史刷新，`historyLoading` 期间 `selectConversation` 会静默返回，表现为"操作成功但界面没动"。
