# Bug 分析：长时间运行 + 锁屏/切后台后提示音彻底不响

- 时间：2026-11-12 22:10
- 模块：`apps/web/src/lib/chime.ts`
- 状态：待评审

## 1. 现象

- 应用启动后提示音正常；长时间运行过程中一旦**锁屏**或**把应用切到后台**，之后再回来就再也不响。
- 与节点完成/失败、Agent 提问无关（三类音共用同一个 AudioContext）。
- 重启应用后恢复，说明不是持久化配置问题。

## 2. 背景（代码现状）

`chime.ts` 当前实现：

- `installChimeUnlock()` 在 `main.ts` 启动时挂 `pointerdown / keydown / touchstart`（capture + passive），**一旦 `resume()` 成功就 `detach()` 解绑**。
- `playChime()` 里只做 `void audio.resume().catch(...)`，不判断结果，也没有重建路径。
- 只有一个全局 `AudioContext`，创建一次后不再更换。

## 3. 根因判断

锁屏 / 切后台会让 WKWebView 的音频会话被系统中断，`AudioContext.state` 从 `running` 变成 `suspended`（WebKit 上报为 `interrupted`）。此后：

1. 唯一的恢复通道是用户手势监听，但它在**首次成功时就被摘除了**——这正是「开始有、后来没有」的形态。
2. `playChime()` 里的 `resume()` 不在手势上下文里，WebKit 直接拒绝，静默失败且无人重试。
3. 没有任何唤醒（`visibilitychange` / `focus` / `pageshow`）后的恢复逻辑，也没有健康自检。
4. 上下文本身也可能「坏死」（输出设备变更、长时间中断），此时 `resume()` 永远返回非 running，只有新建 AudioContext 才能恢复。

结论：**一次性的解锁监听 + 无重建路径** 是本次问题的直接原因，与音量/开关/事件链无关。

## 4. Bug 矩阵

| # | 描述 | 优先级 | 难度 | 风险 |
| --- | --- | --- | --- | --- |
| B1 | `installChimeUnlock` 成功后 `detach()`，长生命周期里再无手势恢复通道 | P0 | 低 | 低（监听只做状态判断） |
| B2 | `playChime` 内 `resume()` 结果被丢弃，失败无补救 | P1 | 低 | 低 |
| B3 | 中断后无任何唤醒恢复（回前台/解锁/focus） | P1 | 低 | 中（需要退避重试，避免唤醒风暴） |
| B4 | 上下文坏死时没有重建手段（换输出设备、长时间中断） | P1 | 中 | 中（重建时机不对会白丢一个能用的上下文） |
| B5 | 没有任何可观测状态，复现后只能靠猜 | P2 | 低 | 低 |

## 5. 非目标

- 不改提示音开关/音量/音型，不改 `taskAlerts` 的 30 秒门槛与 1 秒合并。
- 不改桌面端原生层（Electrobun / WKWebView 配置），不引入音频文件。
- 不改「运行中节点不提醒」等既有语义。

## 6. 评审意见

（待用户填写）

- 是否通过：
- 其他要求：
