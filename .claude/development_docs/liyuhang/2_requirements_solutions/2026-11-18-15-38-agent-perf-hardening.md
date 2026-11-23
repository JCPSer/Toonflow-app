# 需求方案：多 Agent 场景的剩余卡顿点优化

- 时间：2026-11-18 15:38
- 关联需求矩阵：`1_requirements_matrix/2026-11-18-15-35-agent-perf-hardening.md`

## 1. 增量上下文统计

现状：`getAgentContext` 每次 stats 都 `history.buildSessionContext()`，把整条分支物化成 messages；大会话（数 MB、几十万 token）在多 Agent 流式时周期性占用主线程。

改为：

```
branch = history.getBranch()
compactionIndex = 最后一条 compaction
recent = compaction 之后的条目
usage = getLastAssistantUsage(recent)            // SDK 直接读条目
usageIndex = recent 中 usage 对象所属的 assistant 条目
deletedAfterReply = usage 条目之后是否有删除标记
tokens = usage 有效且未被删
  ? usageTokens + sum(estimateEntryTokens(recent[usageIndex+1..]))
  : summaryTokens(compaction.summary) + sum(estimateEntryTokens(recent))
```

`estimateEntryTokens`：message 用 SDK `estimateTokens`；`custom_message`（子 Agent 上报）按文本长度 /4；其它条目 0。只读条目、不做全量物化。

新增可选参数 `compactPercentSetting`：仅供单测在没有 AgentHost 时验证阈值计算，生产调用仍从 preferences 读取。

## 2. stats 节流

`runtime/index.ts` 的 `emitStats(final=false)`：

- 距上次发送 <750ms 时挂一个定时器合并，到点再算一次；
- `final=true`（运行收尾）清除定时器并立即发送；
- 定时器放在 run 作用域，外层 finally 清理，避免 run 结束后再 `send`；
- 消息结束仍用 `queueMicrotask` 读取刚落盘的条目，节流只影响发送频率，不影响数据新鲜度。

## 3. 面板历史截断

`getAgentSession` 只截断返回给前端的副本：

- 工具结果 32KB、思考块 64KB，超出追加「内容过长，已截断 …」说明；
- 同时截断 `active.tools` 里的实时工具结果；
- 会话文件、模型上下文、contextUsage 计算均不读取该副本，不受影响。

## 4. 画布保存重试

`workspaceFiles.write/writeJson` 增加可选 `retry: { attempts, baseDelayMs }`；画布保存传 `{ attempts: 6, baseDelayMs: 120 }`，最长约 4 秒退避窗口（评审后由 8 次下调，避免串行保存长时间阻塞）。其它调用点不传，保持原有 4×60ms。

## 测试

- `contextStats.test.ts`：空会话 0 tokens、512k 窗口 + 393k 输出上限的有效压缩阈值 50%、无窗口返回 undefined。
- 服务端全量、web dispatcher/agentBus、typecheck、构建。

## 风险

| 风险 | 应对 |
| --- | --- |
| 新统计口径与 SDK 物化消息不一致 | 保留 compaction 摘要与尾部条目估算；用测试锁定阈值；后续如出现偏差可回退到旧函数 |
| 节流导致进度条略滞后 | 750ms 上限；收尾强制刷新 |
| 截断让用户看不到完整工具输出 | 截断文案提示去会话文件/工具日志；模型上下文不受影响 |
| 保存重试过长占用 `saving` 队列 | 保存链本来就是串行；已下调为 6 次（约 4 秒上限） |

## 评审意见

| 评审人 | 意见 | 结论 |
| --- | --- | --- |
| 子 agent 评审 | P1-1 final flush 重复计 timing → tokensPerSecond 回归；P1-2 删除回退从死代码变成任何删除都触发且缺静态前缀；P1-3 estimateEntryTokens 遇 null content 抛未捕获异常；P1-4 测试覆盖不足；P2-2 面板仍 buildSessionContext；P2-3 截断代理对；P2-4 retry 类型与 15s 阻塞 | P1 全部修复：final 用 flush(false)、删除后沿用 usage、null content 归一化、补 5 例测试；P2-2 面板改为分支推导、P2-3 代理对保护、P2-4 复用 BusyRetryOptions 子集并降为 6 次，其余记录为后续项 |
| 用户评审 | 待填 | |
