# 测试记录：Agent 派发改为打断式

- 时间：2026-11-17 18:33
- 变更：dispatcher 打断/排队/替换、服务端 abort 接口、error code、面板专用打断入口、sendToAgent 描述

## 自动化

| 项 | 命令 | 结果 |
| --- | --- | --- |
| dispatcher 单测 | `cd apps/web && bun test src/pages/workspace/panels/canvas/agentDispatcher.test.ts` | 10 pass / 0 fail |
| 画布全量单测 | `cd apps/web && bun test src/pages/workspace/panels/canvas` | 78 pass / 0 fail |
| server agent 测试 | `cd apps/server && bun test src/agent` | 39 pass / 0 fail |
| server 类型检查 | `bun run --filter '@toonflow/server' typecheck` | 通过 |
| web 类型检查 | `bun run --filter '@toonflow/web' typecheck` | 仅既有 `@/agentRuntime` 基线错误 |
| 构建 | `bun run build:server`（含 web 构建） | 成功 |
| 部署 | `build/server/index.js` → `Resources/app/bun/index.js`，`build/web` → `views/mainview` | 已同步（备份 `index.js.bak-20261117-183323`），未重启应用 |

## 新增/调整用例
1. 同一发送方新消息打断：调用 `/api/agent/abort`（带 `sessionFile=b.jsonl`），新消息执行，原派发方收到「被同一 Agent 的更新消息打断」note。
2. 不同发送方只排队：C 的任务在跑时 A 的派发不触发 abort；A 连发两条只保留最新，排队箭头只剩一根。
3. 面板运行被派活硬打断：panel bridge `interruptRun` 被调用，面板释放后派发任务开始。
4. 「停止运行中的任务」按新语义调整：同发送方第二条会先接管运行，stop 停的是它；t3 用 C 唤醒。
5. 「停止时清排队箭头」改用 C 作发送方，验证排队箭头清理。

## 手工矩阵（待用户重启验收）

| # | 场景 | 预期 |
| --- | --- | --- |
| 1 | A 派活给 B，B 正在跑 A 上一条任务时 A 再发不同内容 | B 旧任务立刻中断，开始新消息；A 收到旧任务被打断的 note |
| 2 | C 的任务在跑，A 连发两条 | 不打断 C；只执行 A 最新一条，旧排队被替换 |
| 3 | 用户在 B 面板里手动对话运行中，A 派活 | 面板运行被打断并显示「被其他 Agent 打断」，派发任务开始 |
| 4 | 子 Agent 结果回传给正在运行的父 Agent | 不打断，排队等父 Agent 当前一轮结束 |
| 5 | 打断后 B 的会话历史 | 新任务在同一会话继续，不新建会话、不丢历史 |
| 6 | 停止 / 关系箭头 / 并发上限 | 行为与之前一致 |
| 7 | 打断瞬间连续再派两条 | 不丢任务、不重复执行，节点不停在「运行中」 |

## 已知缺口
- 结果回传不打断、abort 超时降级路径没有自动化用例（依赖真实 runtime 时序）。
- 面板关闭时打断原因只存在内存，不落会话。
