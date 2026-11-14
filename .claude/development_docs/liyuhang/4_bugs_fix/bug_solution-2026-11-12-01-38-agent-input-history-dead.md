# Bug 方案：Agent 输入框按 ↑ 翻历史无反应

- 时间：2026-11-12 01:38
- 对应分析：`bug_analysis-2026-11-12-01-38-agent-input-history-dead.md`
- 状态：已实施，已同步 web（未重启）

## 1. 方案

`apps/web/src/components/agent/conversation/messageInput.vue`

### 1.1 还原步骤加超时

```text
settleHistoryStep(promise)
  → Promise.race([promise, 1.5s 定时器])
  resetHistory():
    await settleHistoryStep(instance.reset(...))
    await settleHistoryStep(nextTick 包装的 Promise)
```

`HISTORY_STEP_TIMEOUT_MS = 1500`。超时只让队列继续走，不写半成品内容。

### 1.2 historyFilling watchdog

```text
historyFillingActive():
  未置位 → false
  超过 HISTORY_FILL_TIMEOUT_MS(3000ms) → 复位 historyFilling，返回 false
  否则 → true
```

- `draftEmpty()`、`hasDraft()`、`handleHistoryKey` 的守卫、change 回调里的 `historyFilling` 判断统一改走 `historyFillingActive()`。
- 这样即使队列还挂着，下一次 ↑ 也能进入，不会永久锁死。

### 1.3 不改的部分

- 历史索引推进、去重、附件/提及还原、⌘↑/⌘↓ 放行、运行中不翻历史的规则全部不变。

## 2. 验证

- 实测（浏览器客户端直连应用端口，`蕾姆Rem` 真实会话，非 desktop 模式）：
  - 清空输入按 ↑ → 翻出上一条用户消息（含 @ 提及）；
  - 带提及还原后清空 → 关闭面板 → 重开 → ↑ 仍能翻出。
- `apps/web` typecheck：仅剩既有 `@/agentRuntime` 报错。
- `bun run --filter '@toonflow/web' build` 成功；已 rsync 到应用 `views/mainview/`（01:38）。
- 需重启应用生效；重启同时会清掉当前实例的卡死状态。

## 3. 遗留

若重启后仍复现，需要在 `handleHistoryKey` 加临时插桩（打印守卫状态）再定位；本次没有在用户实例上加日志，避免污染运行中的应用。

## 4. 评审意见

（待用户填写）

- 是否通过：
- 其他要求：
