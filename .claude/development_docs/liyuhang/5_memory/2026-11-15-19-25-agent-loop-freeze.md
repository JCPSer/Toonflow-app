# 记忆：Agent 思考死循环导致界面卡死

- 时间：2026-11-15 19:25
- 类型：Bug 修复（流式性能 + 模型循环）

## STAR

**Situation（背景）**
用户截图显示 Agent 面板刷出大量「写。」后整个界面无响应。会话取证：单条 thinking 86,010 字符、20,513 次「写。」；前端每 50 ms 全文 Markdown 解析，86KB 一次约 127ms，主线程被占满。

**Task（任务）**
在模型陷入重复输出时尽早止损，并保证正常长文流式下界面始终可操作。

**Action（行动）**
- 新增 `OutputLoopGuard`：4KB 窗口内 4-gram ≤16、任一 8-gram ≥64 次、或 ≥20 行 90% 相同，连续两次检查命中才中止；单块 15 万字符硬上限。
- 主 Agent 与临时对话（singleAgent）两个流式入口都接入；命中后停止转发、`session.abort()`、用 reason code 走 i18n 报错；`text_end`/`message_end` 不再重发全文。
- 前端 `replyStream` 自适应刷新（50/100/250ms，按 pending 总量），thinking 超过 32KB 只自动折叠一次；singleAgentDialog 折叠时不再挂载 Markdown。
- 子 agent 评审 2 P1 + 5 P2 全部修复；服务端 127 测试与 tsc 通过。

**Result（结果）**
同类循环约 4KB 即被中止；长思考不再拖死主线程；正常长文不误判。

## 关键经验

1. 流式 Markdown 的成本是 O(全文) × 刷新频率；固定 50ms 在 80KB 以上必然打满主线程。刷新间隔要随内容长度增长。
2. 「按钮置灰」不等于止损：主线程饱和时连停止按钮都点不到，止血必须在服务端尽早 abort。
3. 重复检测不能只看短 n-gram：24 字长句、5 行 stanza 的 4-gram 种类都超过简单阈值，需要 8-gram 频次与连续两窗确认。
4. 自动折叠必须显式记住「只折一次」，否则每次 flush 都会覆盖用户手动展开。
