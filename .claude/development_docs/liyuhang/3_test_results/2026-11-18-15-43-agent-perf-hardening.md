# 测试记录：多 Agent 剩余卡顿点优化

- 时间：2026-11-18 15:43
- 关联：`1_requirements_matrix/2026-11-18-15-35-agent-perf-hardening.md`、`2_requirements_solutions/2026-11-18-15-38-agent-perf-hardening.md`

## 代码改动

| 项 | 文件 |
| --- | --- |
| 条目级上下文估算（含压缩保留条目、null content 归一化、删除后沿用 usage） | `apps/server/src/agent/runtime/sessions.ts` |
| stats 750ms 节流 + final flush 不重复计 timing | `apps/server/src/agent/runtime/index.ts` |
| 面板历史 32KB/64KB 截断 + 代理对保护 | `apps/server/src/agent/runtime/sessions.ts` |
| 面板模型/思考档位改分支推导，去掉 buildSessionContext | `apps/server/src/agent/runtime/sessions.ts` |
| 写入重试类型复用 BusyRetryOptions；画布保存 6×120ms | `apps/web/src/lib/workspaceFiles.ts`、`apps/web/src/pages/workspace/panels/canvas/index.vue` |

## 自动化结果

| 命令 | 结果 |
| --- | --- |
| `apps/server: bun run typecheck` | 通过 |
| `apps/server: bun test` | 172 pass / 0 fail，818 expect，19 文件 |
| `apps/web: bun run typecheck` | 仅既有基线错误 `@/agentRuntime`（`apps/server/src/modules/agentAccess/singleAgent/types.ts:2`） |
| `apps/web: bun test agentDispatcher agentBus` | 24 pass / 0 fail |

`contextStats.test.ts` 7 例：空会话阈值、压缩后摘要+保留条目、usage+尾部、删除后沿用 usage、null content、firstKeptEntryId 缺失、无窗口返回 undefined。

## 评审修复对照

| 编号 | 问题 | 修复 | 验证 |
| --- | --- | --- | --- |
| P1-1 | final stats 把本轮 timing 计两次 | `flush(live)`，final 走 `getAgentStats(history)` | typecheck + 全量测试 |
| P1-2 | 删除后丢弃 usage 改用缺静态前缀的估算 | 删除后继续使用最后一次 usage + 尾部估算 | 「删除消息后仍沿用最后一次 usage」用例 |
| P1-3 | null content 导致定时器未捕获异常 | message/custom_message 归一化空 content | 「content 为 null」用例 |
| P1-4 | 口径覆盖不足 | 新增 4 例（usage+尾部/删除/null/缺保留条目） | 7 例全过 |
| P2-2 | 面板仍全量 buildSessionContext | 分支推导 model/thinkingLevel | 历史面板相关单测全过 |
| P2-3 | 截断可能切代理对 | 高代理位回退一位 | typecheck |
| P2-4 | retry 内联类型、最坏 15s | `Pick<BusyRetryOptions…>`，6 次约 4s | typecheck |

## 未纳入本次（记录为后续）

- `SessionManager.list` 历史列表元数据缓存（子 agent 评审列为最大热点）。
- 回退估算的 entry 级 token 缓存（WeakMap）。
- `getAgentSession` 非运行会话投影缓存。
- 工具结果「查看完整内容」入口。
- `canvasFiles.ts` 复制画布、`canvasMenu.vue` 新建画布的写入重试统一。
- branch_summary 计入估算（当前无生成路径）。

## 部署

- `build:web` + `build:desktop`，同批同步 `Resources/app/views/mainview` 与内层 `app/bun/index.js`，重启由用户自行执行。
