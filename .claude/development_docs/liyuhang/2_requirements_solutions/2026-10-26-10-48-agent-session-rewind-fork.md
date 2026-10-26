# 方案：Agent 会话回退（rewind）与复制为新会话（fork）

## 总体

两个独立能力，共用一套「定位截断点 + 严格解析会话文件」的服务端工具：

- **rewind**：物理删除选中用户消息及其后的全部内容，UI 回到该点，内容回填输入框。
- **fork**：把当前分支截到该用户消息所在轮的结尾，写成新会话文件并打开，原会话不动。

## 一、服务端

### 1.1 公共工具（`apps/server/src/agent/runtime/sessions.ts`）

```
loadStrictEntries(path)            // 严格逐行 JSON 解析 + 结构校验（沿用 deleteAgentMessage 现有逻辑）
assertSessionIdle(path)            // 有活动会话且正在流式/等待回答 → 抛 409「对话正在运行」
collectRemovedEntries(history, targets)
                                   // 复用删除消息里的派生记录收集：toolResult、附件/提及、计时、标签、compaction/branch_summary
```

`loadStrictEntries` 与 `deleteAgentMessage` 里的解析保持一致：拒绝损坏行（不能沿用 SDK 会跳过坏行的读取器），并校验 `id` 唯一、`parentId` 必须已出现。

### 1.2 rewind

```
rewindAgentSession(cwd, path, entryId):
  lock(path)
  assertSessionIdle(path)                       // 运行中禁止
  entries = loadStrictEntries(path)
  history = SessionManager.inMemory(cwd, undefined, entries)
  branch  = history.getBranch()
  target  = branch.find(e => e.id === entryId && e.type === "message" && e.message.role === "user")
  if (!target) → 400「消息不在当前对话中，请重新打开对话」

  removed = 后代闭包(target)                     // 全文件范围：parentId ∈ removed，或 branch_summary.fromId ∈ removed
  removed ∪= 派生记录(target 及被删 assistant 产生的内容)   // 见 1.1

  // 物理删除：写回过滤后的条目
  writeWorkspaceFile(path, entries.filter(e => !removed.has(e.id)))
  return getAgentSession(cwd, path)
```

不变式：`removed` 是后代闭包，被删条目的 parent 一定在保留集合里，所以剩下的每条 `parentId` 仍然有效，不会出现悬空引用。

**不回滚的东西**（有意为之）：附件文件（`assets/chat/*`、`.agent/attachments/<hash>`）内容寻址、可能被其他会话共用，不删。

### 1.3 fork

```
forkAgentSession(cwd, path, entryId):
  lock(path)
  entries = loadStrictEntries(path); history = inMemory
  branch = history.getBranch()
  start = branch.findIndex(user 消息且 id === entryId)   // 找不到 → 400
  end   = branch.findIndex(i > start && 是 user 消息)     // 该轮的边界
  copied = branch.slice(0, end < 0 ? undefined : end)     // 只复制当前分支，丢弃孤儿分支
  header = { type:"session", version: 原头的 version, id: 新 sessionId, timestamp: now, cwd, parentSession: path }
  newPath = `<sessionDir>/<fileTimestamp>_<newId>.jsonl`
  write([header, ...copied])                              // 保留原 entry 的 id/parentId，第一条 parentId 为 null
  appendSessionInfo(原名称 + " · 副本")
  return getAgentSession(cwd, newPath)
```

- header 用新 id，`parentSession` 指向源文件，便于追溯来源。
- 只复制当前分支，不复制被截断的后面内容和历史孤儿分支——新会话文件因此更小，也不会出现"看不见的旧版本"。
- 会话名默认「原名 · 副本」，列表里可直接重命名。

### 1.4 路由

新增 `apps/server/src/routes/agent/rewind.ts`、`apps/server/src/routes/agent/fork.ts`（各 `Router().post("/")`），入参 `{ directory, sessionFile, entryId }`，返回 `getAgentSession` 结果（fork 额外返回新 `file` 与 `name`）。执行 `bun run routes` 重新生成 `router.ts`。

## 二、前端

### 2.1 入口（`components/agent/conversation/messageList.vue`）

两个入口分属两侧（用户 2026-10-26 澄清）：

```
用户消息（右侧）：[复制] [回退到这里 ↺] [编辑] [删除]
agent 回复（左侧）：[复制] [复制为新会话 ⑂] [删除]
```

- `回退到这里`：`IconArrowBackUp`，`title` 写明「丢弃这条之后的所有对话」
- `复制为新会话`：`IconGitFork`
- 禁用条件：`locked || remoteRunning || !item.entryId`；子 Agent 会话隐藏两个入口

### 2.2 回退流程（`components/agent/conversation.vue`）

```
rewindMessage(item):
  if locked || remoteRunning || !item.entryId → return
  ElMessageBox.confirm("回退到这条消息之前？它之后的对话会被永久删除。", 危险确认)
  POST /api/agent/rewind { directory, sessionFile, entryId: item.entryId }
  用返回的 messages 整体替换本地 messages，刷新 stats / contextUsage
  input.fillPrompt(item 原文, item.attachments)      // 提及随正文文本一起回填
  清空 editingId / 草稿残留
```

失败提示走现有 `ElMessage.error` + axios 错误消息提取。

### 2.3 复制流程

```
forkMessage(item):
  POST /api/agent/fork { directory, sessionFile, entryId }
  emit("session", 新 file)        // 父组件 index.vue 已有 @session 处理，切到新会话
  ElMessage.success("已复制为新会话")
```

## 三、代码审查后的返工（已落地）

| 问题 | 处理 |
| --- | --- |
| 回退可能删掉仍被保留条目引用、或属于其他会话的子会话文件 | 删除前要求子会话 header 的 `parentSession` 等于本会话文件名；被保留条目仍引用的文件从删除队列剔除；文件名必须匹配 `^[\w-]+\.jsonl$` 且不是自身 |
| 子 Agent 单独在跑时父会话仍可回退（会删掉正在写的子会话） | 新增 `assertNoActiveSubAgents`，rewind/fork 共用；删除阶段再兜底跳过 active 文件 |
| fork 浅复制子 Agent 条目，上报会写回源会话、回退副本还可能删源文件 | 新增 `cloneSubAgentFiles` 递归深拷贝子会话（新 header、新 parentSession），并重写副本条目里的 `file`/`parentFile` |
| fork 名称退化成「新对话 · 副本」，且后缀会叠加 | 名称取 `getAgentSession().name`，先剥掉已有「· 副本」再拼，截 72 字 |
| rewind 未拒绝子 Agent 会话 | 与 fork 一致，读取 history 后立即 400 |
| 回退后菜单里的子 Agent 与名称仍是旧值 | rewind 返回会话，前端 emit `rewound` 更新 `name/subAgents/历史条目` |
| 子会话删除失败会让已落盘的回退报成失败 | 删除改为写后 best-effort（`console.warn`），写前完成归属校验 |
| 丢弃 compaction 可能导致保留条目 parentId 悬空 | 计算 drop 集合后，把保留条目的 parentId 重接到最近存活祖先，叶标记同法 |
| 32 MB 上限误伤「删除消息」 | `readSessionEntriesStrict` 加 `enforceSize` 开关，只有 rewind/fork 启用 |
| 墓碑用户被当成回退锚点 | 锚点只接受真实 `message.role === "user"`；轮边界仍认墓碑 |
| 按钮在无 entryId 时可点、请求期间可继续发消息、fork 可双击 | 禁用条件补 `!item.entryId`；`sessionAction` 纳入 `locked` |
| fork 后切会话的竞态 | `loadHistory()` 返回是否刷新成功，失败时提示从历史打开；fallback 使用 fork 返回的名字 |

## 四、评审后补充的关键实现点

1. **叶指针**：SDK 以文件最后一行为当前分支末尾，重写后必须显式追加 `custom/toonflowRewind`（`parentId = 锚点.parentId`）把叶钉回上一轮末尾；否则编辑重发留下的兄弟分支会抢走叶。
2. **复制 header 不写 `parentSession`**：`listAgentSessions` 按该字段过滤子会话，写了新会话在列表里永久隐形；溯源改用会话名与文件时间戳。
3. **只复制当前分支**：`branch.slice(0, 轮尾)`，不复制兄弟分支/孤儿，避免新会话重开落到废弃分支。
4. **轮尾边界**：下一条 user（含 `toonflowDeletedUser`）之前；没有下一轮取分支末尾。空轮（只有用户消息）也必须写文件。
5. **压缩/label 悬空**：重写后丢弃 `firstKeptEntryId` / `fromId` 已不在文件里的 compaction 与 branch_summary（否则 SDK 静默丢上下文）。
6. **子会话连带删除**：被删条目里的 `toonflowSubAgent.file` 与 `subAgentReport.details.file` 递归删除对应 `.jsonl`，防环（visited 集合）。
7. **严格解析 + 32 MB 上限**：拒绝损坏行、id 重复、parent 不存在；超过上限返回 413。
8. **并发**：两个接口都先判活动会话（409），再加文件锁；fork 也加锁，避免读到写入中途的快照。

## 五、边界与并发

| 场景 | 处理 |
| --- | --- |
| 会话正在生成 / 子 Agent 运行 | 服务端 `assertSessionIdle` 抛 409；前端按钮已置灰 |
| 有待回答的提问（question） | 同上按活动会话判定，禁止回退 |
| 同项目另一个会话在跑 | 只锁本文件，互不影响 |
| 用户消息已被墓碑删除（应不会出现，因为墓碑是"删除回答"） | 定位失败按 400 处理，提示重开对话 |
| 会话文件损坏 | `loadStrictEntries` 直接 400，不写坏文件 |
| 压缩记录在截断点之前 | 保留，重建上下文时照常生效 |
| 截断点在压缩记录之后 | compaction 条目被删，下轮请求按剩余内容重建 |
| 子 Agent 上报卡片被删 | 父会话不再显示该卡片；子会话文件保留、可从历史列表打开 |
| 超大文件 | 一次性读入内存（与现有删除消息一致）；如后续有性能问题再做流式过滤 |

## 五、验收要点

1. 回退到第 2 条用户消息 → 消息列表只剩第 1 轮；输入框回填第 2 条原文；继续发送能正常跑。
2. 回退后重开对话：内容与回退后一致（文件已重写）；文件里不再有被删 entry。
3. 回退到第一条 → 会话回到空对话状态，仍可继续聊。
4. 复制第 N 轮 → 新会话出现「原名 · 副本」，内容为该轮及以前；原会话完全不变。
5. 生成中/子 Agent 运行中：两个按钮置灰，直接调接口返回 409。
6. 回退或复制之后，统计（tokens/上下文占用）与新内容一致。

## 评审意见

（待用户填写）
