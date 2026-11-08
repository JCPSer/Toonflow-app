# 记忆：素材读取竞争与子 Agent 无上限扇出

- 时间：2026-11-02 14:20
- 类型：稳定性修复

## STAR

**Situation（背景）**
用户追问「一个 Agent 频繁读素材库，其他节点会不会受影响、会不会请求失败」。排查发现三条会被传导的路径：同素材并发读直接 409、subAgent 一次调用无上限并行扇出、工具界面列表请求无超时无重试。另有事件循环与上游配额是系统级共享资源，本次不做全局闸门。

**Task（任务）**
在不改变文件锁、revision 与素材库 UI 语义的前提下，消除确定性的读取冲突，并给并发与前端容错加护栏。

**Action（行动）**
- `readAssetEntry`：模块级 `Map<绝对路径, Promise>` 合并进行中的读取；查 Map 到写 Map 之间不插入 await；共享读不绑定调用方 signal，各调用方通过 `awaitAbortable` 保留自己的取消；`path` 由各调用方用相对路径拼回。
- 新增 `lib/abortable.ts`：已取消时返回 rejected Promise，任务成功/失败透传，监听器用 `{ once: true }` 并主动移除。
- 新增 `lib/concurrency.ts`：固定并发执行器，单个任务失败不影响其余任务，全部结束后再抛首个错误或 AggregateError。
- `subAgent`：并发上限 8；index 在 await 前取号；进度回调异常自吞；工具描述同步为「单次最多同时执行 8 个任务」。
- `toolScaffold/client.ts`：renderers 请求 5s 超时 + 300ms 退避 + 一次重试；只重试无响应/5xx/超时，4xx、主动取消、非法 URL 直抛。

**Result（结果）**
Server 全量 103 个单测通过；server/toolScaffold 类型检查通过，web 仅既有 `@/agentRuntime` 报错；web 与桌面主进程均构建成功；`app/bun/index.js` md5 `f7173acd…`、`views/mainview/index.html` md5 `4e68fa70…` 已同步到应用。**未重启应用**。

## 关键经验

1. 「素材库被占用」不是一把全局锁；真正跨节点共享的是单进程事件循环、内存、浏览器同源连接与上游配额。
2. 同路径并发读 409 来自 `busyFiles` 的即时失败语义；用「在途 Promise 合并」比放宽锁更安全。
3. 共享任务与单调用方取消必须解耦：共享任务不接 signal，调用方用 abortable 等待，否则一个人点停止会打断其他人的读取。
4. 并发执行器的 worker 抛错不能静默跳过剩余任务；要么保证 worker 不抛，要么跑完再汇总错误。
5. 重试要有总预算：5s + 300ms + 5s，避免把快速失败拖成几十秒。
