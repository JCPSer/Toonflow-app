# 测试记录：Agent 热点缓存与画布写入统一

- 时间：2026-11-18 16:01
- 关联：`1_requirements_matrix/2026-11-18-15-56-agent-hotpath-cache.md`、`2_requirements_solutions/2026-11-18-15-58-agent-hotpath-cache.md`

## 代码改动

| 项 | 文件 |
| --- | --- |
| 通用 LRU+TTL 缓存 | `apps/server/src/agent/runtime/lruCache.ts`（新） |
| 历史面板投影缓存（6 条 / 8MB / 运行中绕过 / size+mtime） | `apps/server/src/agent/runtime/sessions.ts` |
| 会话列表 5 秒缓存 + 增删改重命名失效 | `apps/server/src/agent/runtime/sessions.ts` |
| 节点标记按 size+mtime 缓存（512 条） | `apps/server/src/agent/runtime/sessions.ts` |
| stats/context 共用一次 branch | `apps/server/src/agent/runtime/index.ts`、`sessions.ts` |
| 画布写入统一 6×120ms | `canvasFiles.ts`、`canvas/index.vue`、`canvasMenu.vue` |

## 自动化结果

| 命令 | 结果 |
| --- | --- |
| `apps/server: bun run typecheck` | 通过 |
| `apps/server: bun test` | 178 pass / 0 fail，834 expect，20 文件 |
| `apps/web: bun run typecheck` | 仅既有基线错误 `@/agentRuntime` |
| `apps/web: bun test`（全量） | 142 pass / 0 fail，16 文件 |

新增 `lruCache.test.ts` 5 例：容量淘汰、同键覆盖、TTL 过期不续期、delete/clear、容量下限。`contextStats.test.ts` 新增 branch 显式传入等价用例（含 `getAgentStats`），共 8 例。

## 评审修复对照

| 编号 | 问题 | 修复 | 验证 |
| --- | --- | --- | --- |
| P1-1 | stat 期间开始运行，实时投影被写入缓存且可能永久命中 | 缓存前复检 `getActiveAgentSession`；注册/注销时自增 live epoch 并删除对应投影 | typecheck + 单测 |
| P1-2 | 缓存值依赖设置/运行态，只按文件校验会永久陈旧 | 缓存记录带设置指纹（provider 窗口覆盖 + compactPercent）与 live epoch，命中前比对 | typecheck + 单测 |
| P2-1 | 超过 8MB 未删除旧条目 | 超限或运行中一律 `delete(key)` | 代码审查 |
| P2-2 | buildAgentSession 重复取 branch | 复用已取的 branch | 单测等价 |
| P2-3 | run 新建会话未失效列表缓存 | 新建会话确定路径后调用 `invalidateAgentSessionList` | 代码审查 |
| P2-4/5 | home 默认画布、`copy` 未享重试 | `copy` 增加 `retry` 参数；常量上提到 `@/lib/workspaceFiles`，五处画布写入统一 | typecheck |
| P2-6 | 集成缓存测试缺失 | 补 `getAgentStats` branch 断言；`getAgentSession` 需注入 AgentHost，记为手工验证 | 单测 |
| P2-7 | 投影缓存无 TTL | 10 分钟兜底 TTL | 单测 |

## 手动验证建议

1. 打开一个 5MB 以上的历史会话，关闭再打开，第二次应明显更快（投影缓存命中）。
2. 连续切换历史列表，观察服务端日志不再每次全量读取（列表缓存 5 秒）。
3. Agent 正在写画布时复制/新建画布，应等待后成功而不是立即报错。
4. 运行中的 Agent 面板内容仍逐字刷新（运行中绕过缓存）。

## 评审

子 agent 评审已完成：1 个 P1 竞态 + 1 个 P1 陈旧设置 + 7 个 P2，全部修复（见上表）。

## 部署

待构建后同批同步 `views/mainview` 与内层 `app/bun/index.js`，重启由用户执行。
