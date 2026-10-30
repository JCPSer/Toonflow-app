# 记忆：按轮次淘汰会话文件里的旧工具结果

- 时间：2026-10-31 01:15
- 改动范围：4 个文件（新增 1 个纯函数模块）

## Situation

`microCompactMessages()` 早就在请求侧把「最近 3 个用户轮之外、≥400 字符」的旧工具结果压成一行指针，
但注释写明只改本次请求的副本；会话文件里仍留着原文。实测用户工程最大会话 7.48MB 中工具结果占 3.96MB。

## Task

把这些「模型本来就不看」的内容在磁盘上同步淘汰，且不改变模型可见内容。

## Action

新增 `agent/runtime/toolResultPrune.ts`（纯函数，请求侧与磁盘侧共用）：

```
PRUNE_KEEP_TURNS = 3, PRUNE_MIN_CHARS = 400
KEEP_POINTER_TEXT = /\[输出过大|\.agent\/artifacts\/|图片已移出本次模型上下文|\[工具结果已裁剪/
pruneToolResultMessage(message) → { message, pruned }     // 单条判定
pruneBoundary(roles) → 边界下标                            // 最后 3 个用户轮之外
pruneSessionEntries(entries) → { entries, pruned }        // 条目级，保留 id/parentId
```

- `requests.ts` 的 `microCompactMessages()` 改为调用共享函数（行为不变，口径不再两处漂移）。
- `sessions.ts` 新增 `pruneAgentSessionFile(path, branchIds)`：读盘（>64MB 或有坏行跳过）→ 淘汰 → 有变化才整文件重写。
- `index.ts` run 结束的 finally：`unregister()` → `release()` → 自己重新抢锁后调用，抢不到就跳过。
- 启用条件与请求侧对齐：`requests.ts` 记录 `wasMicrocompacted(path)`，只有本轮最后一个请求真被 microcompact 裁过才淘汰。
- 边界按 `history.getBranch()` 的条目顺序算，回退/重发留下的旧分支不参与计数、也不被修改。

## Result

| 指标 | 数据 |
| --- | --- |
| 单测 | 临时脚本 18/18 + 入库测试 `bun test` 9 例 20 断言全过（边界、幂等、最近 3 轮原样、id/parentId 不变、按分支算边界） |
| 真实会话副本 | 6.06MB → 5.04MB（**−17%**），淘汰 402 条 |
| 此前估计 | −50%（**错**）——只按「工具结果总字节」估的，没扣掉 <400 字符的短结果（1635 条仅 252KB） |

## 经验

- 估算收益要按「真正可淘汰的子集」算，不要按「该类别总字节」算：短结果数量多但总字节少，恰好都不在可淘汰范围内。
- 同一套判定写成共享纯函数再让两处调用，比「两处各写一份、口径靠人盯」稳；这次磁盘侧和请求侧共用 `pruneToolResultMessage`，才有「模型零变化」的前提。
- 落盘时机选在 run 结束、`dispose()` 之后、释放文件锁之前：既没有并发追加，也不会和 SDK 内存状态打架。
