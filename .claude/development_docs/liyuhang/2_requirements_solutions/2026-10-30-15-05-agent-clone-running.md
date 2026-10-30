# 需求方案：Agent 节点「创建副本」允许在源会话运行中立即克隆

- 时间：2026-10-30 15:05
- 对应需求矩阵：`1_requirements_matrix/2026-10-30-14-59-agent-clone-running.md`
- 涉及文件：`apps/server/src/agent/runtime/sessions.ts`（`cloneAgentSession`）、新增 `apps/server/src/agent/runtime/cloneSnapshot.ts`（纯函数）
- 前端：不改（`agentNodePanel.vue` 的 409 提示保留为兜底）

## 1. 设计概要

克隆接口从「只读磁盘字节」改为**按源会话是否在运行走两条路径**：

```
            cloneAgentSession(cwd, path)
                       │
        ┌──────────────┴───────────────┐
   运行中（activeSessions 命中）        未运行
        │                              │
  内存条目快照                       逐字节读盘（原逻辑）
  [header, ...entries.slice(0, entryOffset)]
  + 补回节点标记
        │                              │
        └──────────────┬───────────────┘
                       ▼
        写新文件 → renameAgentSession 追加 session_info
```

- 「运行中」用 **SDK 内存条目**而不是读盘：内存条目一定是完整条目，不受 `appendFileSync` 并发写影响；未完成的助手回复只在 `streamingMessage`，天然不在条目里。
- 截断点：`active.session.isIdle ? 全量 : active.entryOffset`。`entryOffset` 是「本轮开始时已有条目数」，正好等于「上一条完整回复之后」；`isIdle` 为真表示本轮已经结束、只是 run 还没注销（自动压缩、计时、子 Agent 状态更新在收尾），此时整段保留（R11）。
- 节点标记 `toonflowAgentNode` 在 `entryOffset` 之前写入，天然落在快照内（R4 为断言，不需要补写）。
- 首轮回复中磁盘上没有会话文件，运行中克隆只依赖内存条目，不 `stat`/`readFile` 源文件（R3）。
- 未运行会话保持逐字节拷贝，行为与现在完全一致（R7）。

## 2. 克隆函数改动（sessions.ts）

### 2.1 伪代码

```
cloneAgentSession(cwd, path):
  if 文件名不合法: 400
  known  = getActiveAgentSession(path)            // 供 stat 的 ENOENT 分支判断
  source = stat(path);  ENOENT 且无 known → 404；非普通文件 → 400
  active = getActiveAgentSession(path) ?? (source 存在 ? undefined : known)
  if active:
      entries = active.history.getEntries();  header = active.history.getHeader()
      cut     = active.session.isIdle ? entries.length : active.entryOffset
      snapshot = entries.slice(0, cut)            // 纯函数，夹紧越界
      bytes   = 序列化([header, ...snapshot])      // 切片与序列化同一同步块，中间不得 await
      name    = cloneSessionName(sessionDisplayName(entries) ?? "新对话")   // 用全量条目取名
  else:
      content = readFile(path)                   // 原逻辑不变
      bytes   = 补结尾换行(content)
      name    = cloneSessionName(sessionDisplayName(parseSessionLines(content)) ?? "新对话")
  建文件名 → writeWorkspaceFile(create) → renameAgentSession(追加 session_info)
  失败时 unlink 半成品（原逻辑不变）
```

### 2.2 快照规则（新增纯函数 `cloneSnapshot.ts`）

```
snapshotSessionEntries(entries, cut):
  end = clamp(cut, 0, entries.length)     // NaN → 全量；负数 → 0；小数向下取整
  return entries.slice(0, end)             // 条目原样保留，不重建、不裁剪
```

- 条目必须原样直传：副本还原依赖 `toonflowReasoning`、附件、`toolResult` 等自定义条目，按消息重建会丢东西。
- 名字用**全量条目**算：首轮的用户消息就在截断点之后，用快照算会退化成「新对话」。
- 标记数据（`canvasId`/`nodeId`）沿用源标记：克隆接口拿不到新节点 id（前端只传目录 + 会话文件名），与现有字节拷贝行为一致；仓库里只有「标记是否存在」被消费，字段不参与逻辑。

### 2.3 为什么不用「读盘 + 按行截断」

- 读盘与运行中追加是并发操作，一旦将来写入改成异步，就可能读到半行；内存条目没有这个问题。
- 内存条目就是 SDK 将要写盘的内容，序列化结果与文件一致（`createAgentConversation`、`getAgentSession` 已经在用同样的写法）。

## 3. 前端

不改。克隆成功后 `agentSessionCloneFrom` 被清空、`agentSessionFile` 指向新文件，副本面板按普通会话打开（`running=false`），可以直接继续对话。409 分支保留：用于源会话在克隆瞬间被删/停的竞态。

## 4. 异常与边界

| 场景 | 行为 |
| --- | --- |
| 源会话运行中，本轮已有完整回复 | 副本只含到该回复（R2） |
| 源会话运行中，首轮还没回复完 | 副本为空对话（只有 header + 标记）（R3） |
| 源会话首轮运行中（标记在本轮写入） | 快照补回标记，副本仍被历史列表隐藏（R4） |
| 源会话本轮内重发（resend） | `entryOffset` 仍是本轮开始前，副本拿到重发前那一轮，语义可接受 |
| 源会话运行中追加消息（steer） | 属于同一轮，一并被截断 |
| 源会话刚好在本轮结束后、退出登记前被克隆 | `isIdle` 为真 → 取全量，副本含刚结束的这一轮（R11） |
| 首轮回复中、磁盘上还没有会话文件 | 内存条目照常克隆；`stat` ENOENT 但有 active 时不报 404（R3） |
| 克隆瞬间源会话被删除 | 文件已不存在且无 active → 404（原行为）；文件还在则按内存快照克隆 |
| 副本写入失败 | unlink 半成品，错误原样抛出（原行为，R10） |
| 子 Agent 运行中 | 副本条目引用的子会话文件不复制、不改写（现状，本次不动） |
| 多个副本同时打开 | 各自克隆各自的文件，互不影响 |

## 5. 测试计划

| 用例 | 期望 |
| --- | --- |
| 纯函数：entries = U1,A1,U2(toolCall)…，entryOffset 指向 U2 之前 | 快照 = U1,A1 |
| 纯函数：本轮已结束（cut = 全量） | 快照 = 全部条目 |
| 纯函数：首轮，标记在 cut 之内 | 标记原样保留 |
| 纯函数：cut 大于条目数 / 为负 / NaN / 小数 | 不越界，退化为全量/空/全量/向下取整 |
| 名字：源名字「xxx · 副本」再克隆 | 「xxx · 副本」，不叠加 |
| 服务端类型检查 / 构建 | 通过 |
| 手动：源会话回复中复制节点并打开副本 | 副本显示截至上一条完整回复的对话 |

## 6. 评审意见

### 6.1 子 agent 初审

- 结论：初评不通过 → 整改后通过（需求评审方的整改意见见需求矩阵 §6.1；实现方审查结论为「通过，无阻断项」）
- 意见与整改：
  1. **P2（中）收尾窗口丢整轮**：`entryOffset` 永不推进，回复结束但 run 未注销时会把刚完成的一轮切掉。→ 改 `isIdle ? 全量 : entryOffset`，并补 R11 与用例。
  2. **事实勘误**：标记补回是死代码且前提写反，已删除；R4 改为断言。
  3. **过期快照**：`await stat` 之后重新取一次 active，已注销则走读盘路径。
  4. `stat` 的 ENOENT 分支增加「有 active 时不报 404」，覆盖首轮未落盘。
  5. 快照函数改为纯切片，越界与 NaN 一律夹紧，不抛异常；切片与序列化保证在同一同步块内。
  6. 名字用全量条目计算：首轮的用户消息在截断点之后，用快照算会退化成「新对话」。
- 未采纳：前端 409 分支删除（保留为不可达兜底，避免动前端引入回归）；32 MB 大小校验（克隆原本就不做，两条路径一致）。

### 6.2 用户评审

- 结论：待填写
- 意见：待填写
