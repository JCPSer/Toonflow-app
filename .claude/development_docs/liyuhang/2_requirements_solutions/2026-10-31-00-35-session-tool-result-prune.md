# 需求方案：按轮次淘汰会话文件里的旧工具结果

- 时间：2026-10-31 00:35
- 对应需求矩阵：`2026-10-31-00-30-session-tool-result-prune.md`

## 1. 方案总览

把 `microCompactMessages()` 里的「单条工具结果该不该淘汰」抽成纯函数，请求侧和磁盘侧共用；
在 run 结束、会话已 `dispose()` 但仍持有文件锁的时刻，按同一套判定重写会话文件。

```
共享纯函数 toolResultPrune.ts
  PRUNE_KEEP_TURNS = 3          // 保留最近 3 个用户轮
  PRUNE_MIN_CHARS = 400         // 太短的结论性输出保留
  KEEP_POINTER_TEXT = /\[输出过大|\.agent\/artifacts\/|图片已移出本次模型上下文|\[工具结果已裁剪/
  pruneToolResultMessage(message) → { message, pruned }
      role !== toolResult / isError / 无 toolName / 已是指针 → 原样
      文本总字符 < 400 → 原样
      否则：所有文本块合并成一行「[工具结果已裁剪：<工具名>，约 N 字符；……]」，非文本块保持原位
```

两处调用：

1. `microCompactMessages()`（请求副本，行为不变，只是改为调用共享函数）
2. `pruneSessionFile()`（磁盘，新增）

## 2. 磁盘侧执行点与流程

```
run 结束的 finally：
    branchIds = history.getBranch().map(id)   // dispose 前取，按当前分支算边界
    session.dispose()
    unregister()
    release()                                  // 先还掉锁，缩短竞态窗口
    finished.resolve()
    if (这一轮最后一个请求真的被 microcompact 裁过 && 抢得到文件锁)：
        await pruneAgentSessionFile(path, branchIds)   // 抢不到就跳过，下次 run 再补
```

```
pruneAgentSessionFile(path, branchIds):
    文件不存在或 > 64MB → 跳过
    entries = 逐行解析；有坏行 / 非对象行 → 整次跳过（不规范化用户手改的文件）
    prunable = 按 branchIds 顺序数出的「最近 3 个用户轮之外」的条目 id 集合
    for entry of entries: 命中的 toolResult → 共享纯函数判定并替换
    无变化 → 不重写；有变化 → writeWorkspaceFile（临时文件 + rename，原子）
    失败 → console.warn，不影响本轮结果
```

要点：
- **启用条件必须与请求侧一致**：请求侧在 `autoCompact` 关闭或上下文不超窗口一半时根本不裁，
  磁盘侧若无条件淘汰，就会删掉模型下一轮还看得见的内容。实现上用 `wasMicrocompacted(path)`
  记录「本轮最后一个请求是否真被裁过」。
- **边界按当前分支算**：回退/重发留下的旧分支条目会让「按整个文件数用户轮」的边界后移，误伤当前分支。
- **淘汰放在 `release()` 之后、自己重新抢锁**：否则 `unregister()` 与 `release()` 之间多出的 await
  会让用户下一条消息撞上 409，也可能与删除会话发生「删了又被写回」的竞态。
- **不做 artifacts 备份**：备份等于把字节挪个位置，不省盘；指针文案与 microcompact 完全一致。
- 重写会让该文件失去与既有副本的 COW 共享（变成自己的完整副本），这是可接受的：淘汰正是在减少它的绝对体积。

## 3. 验证

| 用例 | 期望 |
| --- | --- |
| 单测：4 轮以上、旧工具结果 ≥400 字符 | 旧条目变成指针，最近 3 轮原样 |
| 单测：错误结果 / 短结果 / 已是指针 | 原样保留 |
| 单测：不足 4 个用户轮 | 不重写 |
| 单测：无任何可淘汰条目 | 不重写（文件 mtime 不变） |
| 集成：真实会话副本跑一轮 prune | 体积下降、逐行 JSON 合法、分支链（id/parentId）不变、能正常打开与继续对话 |
| 回归：请求侧 microcompact | 行为与改前一致 |

## 4. 风险与回退

- 淘汰后回退（rewind）到被淘汰的位置，看不到原文——与模型行为一致，需要时重新调用工具。
- 重写失败不会损坏原文件（`writeAtomic` 临时文件 + rename）。
- 回退方式：删掉 `index.ts` 里的一处调用即可完全停用。

## 5. 方案评审（用户填写）

- 结论：待评审
- 意见：

## 6. 子 agent 初审

- 结论：通过（0 P0 阻断项前需修 1 个 P0 + 2 个 P1），全部采纳并已修
- 逐条处置：

| # | 审查意见 | 处置 |
| --- | --- | --- |
| P0-1 | 磁盘侧缺少请求侧的启用条件（`autoCompact` + 上下文超窗口一半），会把模型仍看得见的内容淘汰掉 | 采纳：`requests.ts` 新增 `wasMicrocompacted(path)`，只有本轮最后一个请求真被裁过才允许淘汰；否则下一轮再补 |
| P1-2 | 多分支会话按整个文件数用户轮，旧分支会把边界推后，误伤当前分支 | 采纳：run 结束时在 `dispose()` 前取 `history.getBranch()` 的 id 顺序，`pruneSessionEntries` 只按当前分支算边界，非分支条目不动 |
| P1-3 | `unregister()` 与 `release()` 之间新增 await，放大为 409 / 「删了又被写回」的竞态窗口 | 采纳：改为 `release()` 之后、自己重新 `lockWorkspaceFiles` 抢锁，抢不到就跳过；并给 `removeAgentSession()` 补上文件锁，消除「删了又被 rename 写回」的复活竞态 |
| P2-4 | 非对象条目 / 缺 content 数组会让整次淘汰永久失效 | 采纳：解析时校验对象形状，`pruneToolResultMessage` 判 `Array.isArray(content)` |
| P2-5 | 重写会丢掉坏行 | 采纳：只要存在坏行就整次跳过重写 |
| P2-6 | 大文件全量读写被放在请求收尾路径 | 采纳：>64MB 跳过；并已挪到 `release()` 之后 |
| P2-7 | 测试没入库、文档命名与实现不一致 | 采纳：新增 `toolResultPrune.test.ts`（`bun test`，9 例 20 断言），文档命名已改 |
| P2-8 | `writeAtomic` 默认 0600，会改文件权限；且与 cow-file-copy 叠加时总体可能上升 | 记录：权限沿用现有 `writeAtomic` 行为（会话文件本来就是 0600）；COW 叠加影响在测试文档「已知限制」中写明 |
| P2-9 | 其它入口（compact/rewind/fork/rename）不触发淘汰 | 不处理：下一次 run 会补上 |
