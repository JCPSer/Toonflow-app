# 记忆：Agent 节点「创建副本」运行中克隆

- 时间：2026-10-30 15:30
- 改动文件：`apps/server/src/agent/runtime/sessions.ts`、新增 `apps/server/src/agent/runtime/cloneSnapshot.ts`

## Situation

Agent 节点「创建副本」只在副本面板首次打开时才真正克隆会话；`cloneAgentSession` 遇到源会话正在运行直接返回 409，前端提示「源会话正在运行，请等这一轮结束后再打开这个副本」。用户的实际体验是：源 Agent 还在回复时副本根本进不去。

## Task

让源会话运行中也能立即克隆，副本内容停在上一条完整回复（不含进行中这一轮），并且必须保留节点标记、不破坏其它「先停再操作」的保护。

## Action

- `cloneAgentSession` 改为双路径：未运行仍逐字节拷贝（行为不变）；运行中改用 `activeSessions` 里的内存条目快照，不再读盘。
- 截断点：`active.session.isIdle ? 全量 : active.entryOffset`。`entryOffset` 是本轮开始时已有条目数，进行中这一轮整段排除；`isIdle` 为真表示回复已结束、run 还在收尾，整段保留（否则会丢掉用户已看到的最后一轮）。
- 新增纯函数 `snapshotSessionEntries`（`cloneSnapshot.ts`）：只做夹紧与前缀切片，条目原样直传。
- 名字用全量条目算（首轮的用户消息在截断点之后）；`await stat` 之后重新取一次 active（避免收尾期间拿到过期快照）；`stat` 的 ENOENT 在有 active 时不报 404（首轮磁盘无文件）。
- 未改动：fork / 删除 / 回退 / 压缩仍要求先停；前端 409 提示保留为兜底（已不可达）。

## Result

- 服务端 typecheck、build 通过；`deploy-local.sh --build` 已安装（未重启应用，等用户重启生效）。
- 纯函数单测 5 组通过；函数级端到端（真实 `cloneAgentSession` + 真实 workspace 模块 + 注册的假会话）通过：进行中只含完成轮次、刚结束含整轮、首轮无磁盘文件也能克隆、名字为「xxx · 副本」、源文件行数不变；注销后克隆仍逐字节包含全部条目。
- 未覆盖：真实模型运行中的应用内手测。

## 经验

- 会话文件是「内存条目 → 追加写」的，内存条目天然完整；需要「最近状态」时优先用内存快照，而不是和写盘抢读。但新会话在首条助手消息之前根本不落盘。
- `entryOffset` 是「本轮开始前」的天然分界线，但它**永不推进**：回复结束到 run 注销之间必须用 `session.isIdle` 区分，否则会丢掉刚完成的整轮。
- 条目与 SDK 共享引用，切片与序列化必须在同一个同步块内完成。
