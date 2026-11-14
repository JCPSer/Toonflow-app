# 记忆：长时间运行 + 锁屏/后台后提示音彻底静默（四条常驻恢复通道）

- 时间：2026-11-12 22:10
- 类型：Bug 修复（提示音 / AudioContext 生存期）

## STAR

**Situation（背景）**
用户反馈：应用启动后提示音正常，长时间运行中一旦锁屏或把应用切到后台，之后再也不响；重启才恢复。上一轮（11-10）已经给"一次性解锁"打了补丁，但没有解决长生命周期下的复发性。

**Task（任务）**
让提示音在整个会话生命周期里都能被系统中断后自行恢复，同时保留诊断手段。

**Action（行动）**
- 定位根因：`installChimeUnlock()` 在首次 `resume()` 成功后 `detach()`，之后系统中断音频会话就再没有手势通道；`playChime` 里的 `resume()` 不在手势上下文里，失败也没人管；没有任何唤醒/自检/重建路径。
- `chime.ts` 重写为四条常驻恢复通道：手势监听（永不摘除，running 时只读一次 state）、唤醒（visibilitychange→可见 / window focus / pageshow，退避 0/300/1500/5000ms）、60s 健康自检、播放前兜底。
- 恢复失败时 `rebuildContext()`：close 旧实例 + 新建（5s 冷却）；唤醒/自检路径传 `rebuild:false`（无手势新建也起不来）。
- `resumeChime` 用 `resumeTask` 在途去重，异常统一吞成 `false`，避免 fire-and-forget 变成未处理拒绝。
- 新增 `window.__toonflowChime`（state / stats / resume / play）与中断、重建的 console 日志。
- `playChime` 非 running 时不重建，只在当前上下文排音（suspended 时 currentTime 不推进，恢复瞬间播出）。

**Result（结果）**
typecheck 仅剩既有 `@/agentRuntime`；web 构建成功并 rsync 到应用 `views/mainview/`（22:20）；未重启，需用户重启后验证。

## 关键经验

1. 「用户手势解锁音频」不是一次性动作，而是**每次系统中断后都要重新获得的能力**。任何 `detach()` 掉的手势监听，在长生命周期应用里都是定时炸弹。
2. 桌面 WebView 里 AudioContext 会因锁屏/切后台/换输出设备而"坏死"，`resume()` 可能永远返回非 running；只有新建实例能救，但新建本身也需要手势——所以重建只能在手势路径做。
3. 无手势的恢复（唤醒、定时）要退避重试，且必须传"不重建"，否则会反复造实例把可能自愈的旧实例换掉。
4. `isRunning` 用 plain boolean 而不是类型谓词：谓词会把负分支收窄成 `never`，后续对 `state` 的比较直接被判恒假。
5. 复现窗口长的问题（长跑 + 锁屏）不要只靠猜，留一个 `window.__toonflowChime` 类的状态钩子，下次直接看 stats。
6. 评审补充（已修）：`resume()` 可能永不 settle，**任何在途 Promise 去重都必须带超时**，否则一个 pending 任务会把所有恢复通道和重建一起锁死——这等于把原 bug 换层皮。同理，去重要带上能力标记（能不能重建），「不重建」的在途任务不能吞掉「允许重建」的请求。
7. `playChime` 必须异常安全：上下文 closed 时 `createOscillator` 会抛 `InvalidStateError`，一旦抛出会连带吞掉调用方后续动作（这里就是桌面通知与设置页的失败提示）。
