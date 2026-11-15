# Bug 修复方案：Agent 思考死循环导致界面卡死

- 时间：2026-11-15 19:02
- 对应分析：`bug_analysis-2026-11-15-19-02-agent-thinking-loop-freeze.md`
- 状态：已实施

## 1. 总体思路

```text
服务端：流式增量 → 循环检测器（按 block 累计）
        命中 → 中止本轮 + 抛错「模型输出陷入循环，已自动停止」
前端：  流式刷新按内容长度降频（50 → 100 → 250 ms）
        思考块超过 32 KB 自动折叠（折叠后不再解析 Markdown）
```

两层防护：服务端止血（不再产生超大内容），前端保证正常长文也不会把主线程打满。

## 2. 服务端循环检测

新增 `apps/server/src/agent/runtime/outputLoopGuard.ts`：

```text
常量：
  WINDOW = 4096 字符        // 只看最近 4 KB
  MIN_CHARS = 4096          // 不足一窗不判定
  MAX_UNIQUE_GRAMS = 16     // 最近窗口内不同 4-gram ≤ 16 视为循环
  MAX_BLOCK_CHARS = 150000  // 单块硬上限，防止 maxTokens 很大的模型刷屏

state: Map<blockId, { tail: string; total: number; checkedAt: number }>

push(blockId, delta):
    tail = (tail + delta).slice(-WINDOW)
    total += delta.length
    if total > MAX_BLOCK_CHARS: 返回“输出超过 15 万字符，疑似陷入循环”
    if tail.length < MIN_CHARS: 返回 undefined
    if total - checkedAt < 2048: 返回 undefined   // 每 2 KB 检查一次
    checkedAt = total
    grams = tail 中所有长度为 4 的子串集合
    if grams.size <= MAX_UNIQUE_GRAMS: 返回“模型输出陷入循环，已自动停止”
    lines = tail 按行去空
    if lines ≥ 20 且同一行占比 ≥ 90%: 同上（覆盖整段同一句话、4-gram 够多的情况）
```

阈值取舍：正常中英文正文 4 KB 内几乎不可能只有 ≤16 种 4-gram；重复的「写。」「Write.」这类短句只有个位数种，能稳定命中。

接入 `apps/server/src/agent/runtime/index.ts`：

```text
message_update 的 thinking_delta / text_delta：
    reason = guard.push(blockId, delta)
    if reason:
        loopError ??= reason
        session.abort()

prompt 返回后：if (loopError) throw new Error(loopError)
catch：if (loopError) 用 loopError 覆盖原始 AbortError
```

错误经现有 NDJSON `error` 事件回到前端，消息条显示该提示并结束流；已收到内容保留。

## 3. 前端流式降频

`apps/web/src/components/agent/replyStream.ts`：

```text
把 lodash throttle(50ms) 换成自调度：
    pending 最大内容长度 ≤16K → 50ms
    ≤64K → 100ms
    >64K → 250ms
    结束时 flush() 立即补齐
```

目标：内容越大，重解析次数越少；50 ms 只用于正常短回复，保持打字感。

## 4. 前端超长思考自动折叠

`receive`/`flush` 时：

```text
if part.type == "thinking" 且 content.length > 32768 且当前展开:
    part.collapsed = true
```

折叠后 `messageMarkdown` 不再渲染（`v-if`），解析与 DOM 成本归零；用户仍可手动展开查看。

## 5. 验证

- 单测：`outputLoopGuard.test.ts` 覆盖重复「写。」、重复英文短句、正常长文不误判、150 KB 上限、多次 block 互不影响。
- `bun test`（server 全量）、`vue-tsc`（web/server）、web build。
- 手工：构造重复流式文本观察界面仍可点击；真实会话中循环时收到自动停止提示。

## 6. 评审意见

（待填写）

- 是否通过：
- 其他要求：

## 9. 评审结论（子 agent）

- 首轮不通过：2 个 P1（临时对话入口未接入、命中后仍重发全文）+ 5 个 P2。
- 已全部处理：singleAgent 接入 guard；命中后抑制全文；8-gram 重复 + 连续两窗命中；折叠只做一次；延迟按 pending 总量；文案改 reason code + i18n；singleAgentDialog 折叠真正生效。
- 复测：服务端 127 测试通过、tsc 通过；前端模拟无增量丢失。
