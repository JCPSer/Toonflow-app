# 测试结果：斜杠输入 / 面板内快捷键 / 压缩上下文状态

- 记录时间：2026-10-29 17:16
- 关联：`4_bugs_fix/bug_analysis-2026-10-29-16-53-agent-slash-shortcut-compact.md`、`bug_solution-2026-10-29-16-55-…md`
- 环境：桌面应用实例 `http://127.0.0.1:58676/?desktop=1`，真实项目画布（第4集·天台）

## 一、静态验证

| 项 | 结果 |
| --- | --- |
| `apps/web` typecheck | 通过（仅既有 `server/.../singleAgent/types.ts(2,33) TS2307`） |
| `apps/server` typecheck | 通过 |
| `deploy-local.sh --build` | 成功（10 个节点包重建并同步到 `data/nodes`） |
| `AgentNodeStatus` | 已加 `compacting`，节点包状态文案与 `.is-compacting` 样式补齐 |

## 二、B0 斜杠输入

验证方式：临时替换 `window.fetch` 记录 `/api/agent` 的 POST 并立即 abort，不真正发请求（不污染会话）。

| 输入 | 期望 | 实测 |
| --- | --- | --- |
| `/skill:demo hello`（面板内发送按钮） | 走正常发送，请求体带原文 | 捕获到 `POST /api/agent`，`prompt` 含 `/skill:demo hello`，草稿被清空 ✓ |
| `/foo bar` | 同上（不再被吞） | 同上路径，草稿清空 ✓ |
| `/compact`、`/goal` | 仍由客户端消费，不进模型 | 代码路径未变（`isBuiltinCommand` 白名单） |

修复前对照：同一输入会先 `clearDraft()` 再 `return`，既没请求也没提示。

## 三、B1 面板内 Cmd+C/V

验证方式：真实按键（CDP 输入）＋拦截 XHR 记录。

| 场景 | 期望 | 实测 |
| --- | --- | --- |
| 点 Agent 节点（焦点落在 `.agentNodePanel`）后 Cmd+C | 复制节点，写系统剪贴板 | 出现 `POST /api/desktop/clipboard/write` ✓ |
| 面板内选中文字后 Cmd+C | 复制文字，不复制节点 | 未出现新的 clipboard/write，选区文本正确 ✓ |
| 面板输入框内 Cmd+C/V | 文本复制粘贴 | 由 `input/textarea/[role=textbox]` 排除保护（未改） |
| 复制后画布文件 | 不应变化 | 只复制不粘贴，画布文件未改 ✓ |

附带的收窄：面板语境只放行 copy / paste / delete，成组、整理、撤销等仍被挡在画布语境之外。

## 四、B2 压缩上下文

| 项 | 结果 |
| --- | --- |
| 卸载判据 | `unmountIfIdle` 已加 `entry.compacting` 提前返回 |
| 状态上报 | conversation `watch(busyCompacting)` → `emit("compacting")` → 面板写 `statuses[nodeId] = "compacting"` |
| 角标 | 节点包新增「压缩中」文案与状态样式 |
| 关闭时的状态 | 压缩中关闭写 `compacting`，结束后按 phase 回落 |
| 实测 | **未做真实压缩**：压缩会重写用户会话文件（`.agent/sessions/*.jsonl`），不在联调阶段冒险。需用户在一次真实压缩里确认：压缩中关面板→重开仍是「正在压缩」→结束后历史已更新、角标回落 |

## 五、上一轮功能的审查整改（同轮完成）

| 项 | 处理 |
| --- | --- |
| Agent 排队续发/打断重发吞掉完成提醒 | `conversation.vue` 续发前 `await nextTick()`，让 `waiting` 先被观察；`nodeBusy` 续轮复位 `outcome`，不再把上一轮的 cancelled 串到下一轮 |
| 跨画布提醒看不到 | 提醒携带 `canvasId/canvasKey`；横幅展示全部未读；点击时本地有节点就定位，否则 `requestFocus` + `activateCanvas`，由目标实例在 `active && canvasReady` 时消费 |
| 已删节点的旧提醒占坑 | 画布节点数变化时，把本画布找不到节点的未读项标为已读 |
| 两条顶部横幅重叠 | 改为量取提问横幅真实高度再决定任务横幅 `top` |
| 其余 Minor | `pruneBusyNodes` 无调用者、`reason` 未使用、补齐补丁头部 hash 等仅记录，不阻塞 |

横幅回归实测：派发 42s 完成事件 → 文案 `LLM固定提示词 · 耗时 42s`、`top: 12px`；点击后节点 `6301a247` 被选中、横幅消失 ✓。

## 六、遗留与风险

- 跨画布点击链路只做了代码审查与本地分支实测（同画布），**没有**在真实「A 画布跑、B 画布看」场景里跑过，需要一次真实长任务确认。
- 节点 busy 表仍以 `nodeId` 为键，画布文件被复制成两份并同时打开时同 id 会互相覆盖（低概率，记录为已知限制）。
- 图片节点的 `cropping` 仍计入 busy，裁剪超过 30 秒会触发完成提醒（与「只提醒生成类」的语义略有出入，记录不修）。

## 七、联调期间画布状态变化（已告知用户，未擅自恢复）

- `4-教学楼天台的大胆行为.json`：16:32 核对为 12 节点；17:16 磁盘与运行中应用均为 **11 节点**，缺 `46240095`（label「Agent」，`agentSessionFile=2026-10-29T08-18-25-981Z_01a186bd….jsonl`，会话文件仍在）。本轮测试只做压缩状态注入、真实 Cmd+C/V 与一次 Cmd+Z，无删除节点操作；不能归因。
- 两个文本节点坐标：16:32 手工还原的 `(-2240,-544)`/`(-2240,-800)` 被运行中应用的内存状态覆盖回吸附后的 `(-2224,-528)`/`(-2224,-784)`（差 16px）。
- 用户决定：先不动，由用户确认后再从 `/tmp/canvas4-backup.json`（16:24 快照）恢复。

## 八、代码审查意见与修复（子 agent，2026-10-29 17:26）

| 级别 | 问题 | 处理 |
| --- | --- | --- |
| Critical | 我加的 `await nextTick()` 让面板在续发真正开始前把会话卸载，队列/目标循环的自动续发被 abort、消息静默丢失 | 新增 `resuming` 保活标记 + `hasPendingWork()`（busy / resuming / 队列 / resumeAfterStop），面板 `unmountIfIdle` 与 `hasDraft` 并列判断；目标循环在写盘期间也置 resuming |
| Important | `isBuiltinCommand` 大小写不敏感但 `handleCommand` 大小写敏感，`/Compact`、`/Goal stop` 仍被吞 | `handleCommand` 归一化为小写比较 |
| Important | `compacting` 没算「忙」：自动压缩期间节点 busy 出现假下降沿 → 误报「已完成」、失败结果丢失、切项目守卫漏判 | 节点包 `:busy/:running` 与画布 `hasBusyNodes()` 都纳入 `compacting` |
| Important | 面板内 `inCanvas` 变真后，Delete 绕过了「有文本选区就不删节点」的保护 | 面板语境里 delete 追加 `!hasCanvasAreaSelection()` 判据 |
| Minor | 换画布会清空全部面板 entry，压缩中的实例被连带销毁 | 压缩中的 entry 保留（只隐藏），结束后按空闲判据回收 |

修复后：`apps/web` typecheck 通过（仅既有 `server/.../singleAgent/types.ts(2,33)`），`deploy-local.sh --build` 成功。

## 九、联调副作用（必须记录）

本轮验证期间，`Agent4-1` 节点处在一轮真实运行中；我在面板里做的发送/粘贴与页面 `reload` 会按「打断重发」语义中断当时在跑的一轮，会话里因此留下 `The operation was aborted.` 记录（时间点 09:27Z / 09:28Z，对应当地 17:27/17:28）。后续验证已停止在这个会话上做发送类操作，注入的 `fetch` 桩也已还原为原生实现。

另：`/Compact` 这次被消费但没有真正压缩——该会话正在运行，服务端会以「对话正在运行」拒绝，按钮本身也是 disabled 状态；会话文件里最后一次 compaction 仍是 08:54Z，可确认没有误压缩用户历史。
