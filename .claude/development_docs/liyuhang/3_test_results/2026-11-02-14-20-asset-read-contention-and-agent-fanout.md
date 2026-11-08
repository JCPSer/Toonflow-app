# 测试结果：素材读取竞争与子 Agent 扇出

- 时间：2026-11-02 14:20（代码 14:30 完成部署同步）
- 对应方案：`2_.../` 不适用，本次走 bugfix 流程：`4_bugs_fix/bug_solution-2026-11-02-14-20-asset-read-contention-and-agent-fanout.md`

## 1. 改动文件

| 文件 | 改动 |
| --- | --- |
| `apps/server/src/modules/assetLibrary/assets/library.ts` | `readAssetEntry` 同路径在途读取合并；共享读不绑定调用方 signal |
| `apps/server/src/lib/abortable.ts` | 新增：共享任务的按调用方取消等待 |
| `apps/server/src/lib/concurrency.ts` | 新增：固定并发执行器，单任务失败不影响其余任务 |
| `apps/server/src/agent/tools/subAgent.ts` | 子任务并发上限 8，进度回调异常隔离，工具描述同步 |
| `packages/toolScaffold/src/client.ts` | renderers 请求 5s 超时 + 300ms 退避 + 一次重试 |
| 测试 | `abortable.test.ts`、`concurrency.test.ts`、`library.read.test.ts` |

## 2. 自动化测试

| 项目 | 命令 | 结果 |
| --- | --- | --- |
| Server 全量单测 | `cd apps/server && bun test` | 103 pass / 0 fail（9 个文件） |
| Server 类型检查 | `bun run --filter '@toonflow/server' typecheck` | 0 |
| toolScaffold 类型检查 | `cd packages/toolScaffold && bun run typecheck` | 0 |
| Web 类型检查 | `bun run --filter '@toonflow/web' typecheck` | 仅既有 `server/src/modules/agentAccess/singleAgent/types.ts(2,33) Cannot find module '@/agentRuntime'`，与本次无关 |
| Web 构建 | `bun run --filter '@toonflow/web' build` | 0 |
| 桌面主进程构建 | `bun apps/desktop/node_modules/electrobun/bin/electrobun.cjs build --env=stable` | 0 |

新增用例覆盖：
- 并发读取同一素材都成功、revision 一致、各自带回自己的 path。
- 一个调用方取消不影响另一个调用方。
- `awaitAbortable`：已取消立即拒绝、任务继续完成、成功/失败透传。
- `runWithConcurrency`：并发峰值 ≤ 上限、每个任务执行一次、空列表、非法上限、单任务失败不漏任务、多失败合并为 AggregateError。

## 3. 部署与校验（应用未重启）

| 产物 | 源 md5 | 应用内 md5 |
| --- | --- | --- |
| `app/bun/index.js` | `f7173acd71881f5d328649851111be82` | `f7173acd71881f5d328649851111be82` |
| `views/mainview/index.html` | `4e68fa70fe560aaca3cf72a7f510314e` | `4e68fa70fe560aaca3cf72a7f510314e` |

- 入口 `index-LTSxZ0uU.js` 引用新分块 `replyStream-CcHFBdky.js`；该分块包含 `timeout:5e3`、`isCancel` 与一次重试逻辑。
- 应用内 `app/bun/index.js` 含 `并发上限必须是正整数` 与 `单次最多同时执行 8 个任务` 文案，确认服务端改动已进入产物。
- 部署前旧 bundle 备份在作业临时目录 `index.js.before`。
- **未重启应用**，当前运行中的进程仍是旧代码；需用户自行重启后生效。

## 4. 静态/人工核对

| 项 | 结果 |
| --- | --- |
| 同路径并发读取不再走第二次 `lockWorkspaceFiles` | 通过（Map 命中直接复用） |
| 查 Map → 建 Promise → 写 Map 之间无 await | 通过（同一同步段完成） |
| 共享 Promise 成功/失败都挂处理器并清理 | 通过 |
| 写入冲突语义不变 | 通过：读取仍持有 `lockWorkspaceFiles`，写方仍 409 |
| `revision` 仍为整文件 SHA-256 | 通过 |
| 子 Agent 结果按原索引回填、usage 汇总不变 | 通过 |
| 排队任务在执行前检查取消 | 通过 |
| 重试只针对无响应/5xx | 通过 |

## 5. 残余风险与未覆盖项

1. 嵌套 `subAgent` 仍是 8×8…，本次不做全局闸门；极端嵌套仍可能抬高上游并发。
2. 工具界面脚本 `<script>` 加载仍无超时；`timeout exceeded` 的真实来源（脚本 404、连接池、主进程繁忙）尚未单独复现。
3. 最后一个等待者取消后，共享读取仍会读完并短暂持锁；受 100 MB 上限约束。
4. 运行时行为（多 Agent 同时读同一素材）需重启后在应用内实测，本次仅单测与静态核对。

## 6. 代码审查

子 Agent 审查结论：无 P0/P1 阻塞。已处理项：

| 意见 | 处理 |
| --- | --- |
| 清理派生 Promise 的 rejection | `then(cleanup, cleanup)` |
| 取消测试未真正覆盖共享等待 | 抽出 `awaitAbortable` 并单独单测 |
| 共享读不传 signal 的权衡需记录 | 已加注释 |
| worker 抛错会漏掉本道剩余任务 | 改为收集错误、跑完全部任务后再抛 |
| 重试总预算过长 | 5s + 300ms + 5s |
