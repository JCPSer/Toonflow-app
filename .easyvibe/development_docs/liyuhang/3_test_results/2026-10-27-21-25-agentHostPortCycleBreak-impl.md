# 实施与测试结果 · AgentHost 端口切断 agent↔应用双向依赖

> 输入：需求矩阵 `1_requirements_matrix/2026-10-27-13-57-agentHostPortCycleBreak-v5.md`（REQ-2026-10-27-05）、方案 `2_requirements_solutions/2026-10-27-14-45-agentHostPortCycleBreak.md`（SOL-2026-10-27-05）。
> 本文只记录**实施动作 + 可复算证据**；代码审查由系统独立审查 agent 执行，本文不代替审查结论。

## 0. 元信息

| 项 | 内容 |
| --- | --- |
| 报告编号 | TEST-2026-10-27-04 |
| 实施时间 | 2026-10-27 20:58–21:25 |
| 基线（实施开始） | `git HEAD = 16f7fb2`（矩阵冻结的 `89572b5` 之后已有 2 个提交）+ 并行任务未提交改动 |
| 基线（判据对照） | 矩阵 M0 冻结树 `89572b5`；本报告同时给出「本机实测基线」与「矩阵基线」的差异 |
| 结论 | 目标达成：A2P **75 → 0**、P2A **21 行/11 文件 → 14 行/3 文件**、file SCC 含 agent **10 文件环 → 0**、`e7` 边删除；行为零变化（16 项冒烟子断言全部通过）。**4 处计数偏差已登记（§5）** |
| 变更规模 | 47 个受跟踪文件（+329/−503）；新增 9 个代码文件、2 个非代码文件；删除 1 个代码文件（`lib/agentLog.ts`） |

## 1. 落地结构（实施结果，与方案 §2.1 对齐）

```
app.ts（组合根）── 步骤 9.5 ──► agentHost.ts（14 组装配，唯一实现点）
                                    │ configureAgentHost(host)
                                    ▼
                         agent/host.ts（14 组 / 60 符号 / 纯类型 + 注册表）
                                    │ getAgentHost().<group>.*
                                    ▼
                            agent/**（29 文件；A2P = 0）
                                    │ 反向：应用要用 agent
                                    ▼
              agentRuntime.ts（12 说明符；utils.ts / routes / singleAgent / mcp.tools）
```

| 新增 | 路径 | 说明 |
| --- | --- | --- |
| 代码 | `apps/server/src/agent/host.ts` | 14 组契约 + `configureAgentHost` / `getAgentHost`（fail-fast + 二次注入保护） |
| 代码 | `apps/server/src/agentHost.ts` | 20 条源路径装配，14 组 4 空格缩进的返回对象 |
| 代码 | `apps/server/src/agentRuntime.ts` | 应用→agent 的唯一门面（12 说明符：11 值 + 1 类型） |
| 代码 | `apps/server/src/agent/log.ts` | agent 侧诊断日志（目录经 `settings.settingsPath()` 获取） |
| 代码 | `packages/formats/src/{modelReasoning,documentFormats,mentionSources,a2a,index}.ts` | 纯契约下沉（3 个逐字节副本 + A2A 设置类型 +  barrel） |
| 非代码 | `packages/formats/{package.json,tsconfig.json}` | 零依赖包，自带 `typecheck` 脚本（避免根 `--filter` 静默跳过） |

删除：`apps/server/src/lib/agentLog.ts`（实现迁到 agent 域，应用侧改经门面取）。
改造为再导出 shim：`apps/server/src/lib/{modelReasoning,documentFormats,mentionSources}.ts`（14 个 exports 路径与公开面不变）。

## 2. 探针结果（最终态，命令与矩阵 §6.5 逐字一致）

| 探针 | 判据 | 期望（矩阵 M5） | 实测 | 判定 |
| --- | --- | --- | --- | --- |
| P1 | A-01 | 0 | **0** | PASS |
| P2 | A-02 | 0 | **0** | PASS |
| P3a | A-04 | 精确 `{agentRuntime.ts, agentHost.ts, agentAccess/index.ts}` | 正是这 3 个文件 | PASS |
| P3b | A-05 | 13 行（值 11 / 型 1 / 动态 1） | **14 行**（值 12 / 型 1 / 动态 1） | 偏差 D-1 |
| P4 | A-06 | 3 | **3** | PASS |
| P5a / P5b | A-07 | 0 / 38 键 | **0 / 38 键**（含 `agentRuntime`） | PASS |
| P6 | A-08 | `scc_total 2 / agent_scc 0` | **2 / 0** | PASS |
| P6b | A-08 | `e7` 不存在 | **0**（`map.json` 已删 e7） | PASS |
| P7（7 项） | A-09 | 全 1 | 1/1/1/1/1/1/1 | PASS |
| P7b | A-09 | `module_scope_refs 0`（exit 0） | **0**（exit 0） | PASS |
| P8 | A-10① | `prepare < inject < router` | **35 < 63 < 64** | PASS |
| P8b | A-10②③ | `agentHost.ts` 可达集恰 `{agent/host.ts}`；`app.ts` 无 agent | **恰 1 个 host.ts；app.ts []** | PASS |
| P9 | A-11 | START_OK / CONF_JSON_OK / TOOLS_HTTP=200 | 三者全部成立 | PASS |
| P10 | A-14 | 14 exports 逐字不变 | 未改 `apps/server/package.json` 的 `exports`（仅新增 `@toonflow/formats` 依赖） | PASS |
| P12 | A-17 | `files_total` 覆盖 0 未覆盖 | **718 文件 / uncovered 0** | 偏差 D-2（计数） |
| P13 | A-18 | 3 IDENTICAL + 3 SHIM_OK + 3 PURE + 1 DEEP | **全部成立**（唯 DEEP 为 `agentHost.ts`） | PASS |
| P14 | A-17 | 新增代码 8 / 非代码 2 | 相对 HEAD：**9 / 2** | 偏差 D-1 |
| P15 | A-09 | `failfast_exit 0` | **0** | PASS |
| P16 | A-22 / S-05 | `pre_error=AgentHost 未注入` / `app_ok function` / `post_aborted=true` / reason 精确 | **四项全部命中** | PASS |
| P17 | A-21 | 10 行 / 5 文件 | **5 行 / 5 文件**（文件集合完全一致） | 偏差 D-3 |
| P19 | A-22 | `0/1/1/1` | **0/1/1/1** | PASS |
| P20（M5） | A-26 | `a2p=0 host_members=14 assembly_members=14 missing_*=0 symbols=60 symbol_missing=0` | **全部命中** | PASS |
| P20（M0） | A-24 | `unmapped=0 stale=0`（矩阵 74 行） | 本机基线 **75 行 / unmapped=0 / stale=0**（manifest 已按实测补 1 行） | 偏差 D-1 |
| P21 | A-25 | `computed=16 label_match=1` | `computed=17 label_match=1`（`p2a=14 + p4=3`） | 偏差 D-1 |

### 2.1 自检（A-23，11 项）

| 自检 | 内容 | 结果 |
| --- | --- | --- |
| T1 | P7b 合成 fixture 必须报 3 | `module_scope_refs 3`（exit 1）✅ |
| T2 | P14 临时仓库 1 代码 + 1 非代码 | `code_new 1 / noncode_new 1` ✅ |
| T3 | P15 完整契约 fixture | `failfast_exit 0` ✅ |
| T4 | P15 无 fail-fast 负控制 | `failfast_exit 4` ✅ |
| T5 | 二次注入保护 | 真实 `host.ts` 跑 P15 得 `0`（走到第 4 段并正确抛 `AgentHost 已注入`）✅ |
| T6 | P16 M5 相位 | `pre_error=AgentHost 未注入` ✅ |
| T7 | P16 M0 相位（`pre_error=none`） | **未复跑**（工作树已是实施后状态，基线树已清理）；该相位由 T6 与代码路径（惰性注册）共同约束，登记为受限项 |
| T8 | P19 负控制 `1/0/0/0` | 合成 fixture 得 `1/0/0/0` ✅ |
| T9 | P20 `unmapped=1` 负控制 | 注入 1 条 `@/utils` 后 `unmapped=1` 并列出文件行 ✅ |
| T10 | P20 缺组负控制 | 删掉 `platform` 装配后 `assembly_members=13 / missing_assembly=1` ✅ |
| T11 | P21 标签不符负控制 | 标签改 13 后 `label_match=0` ✅ |

结论：**10/11 通过，T7 受限**。

## 3. 运行期冒烟（矩阵 §6.4，16 项子断言）

环境：`TMP=$(mktemp -d)` 数据目录 + 假供应商（`/tmp/fake-openai.mjs`，SSE 两 chunk + `[DONE]`）+ `bun src/index.ts`（端口 3999）。

| 子断言 | 结果 | 证据 |
| --- | --- | --- |
| S-01 Agent 流式 | **PASS** | HTTP 200、`Content-Type: application/x-ndjson; charset=utf-8`、首行 `session`、1 行 `userMessage`、末行 `done`、`error` 0 行、存在 `text.delta="OK"` |
| S-02 附件格式 | **PASS** | `400` + `{"code":400,"data":["字段 attachments.0 不支持此附件格式"],"message":"参数错误"}` |
| S-02b 文本附件超限 | **PASS** | NDJSON 单行 `{"type":"error","message":"文本附件最多支持 100000 个字符，请缩小内容后重试"}` |
| S-04 会话 fork / rewind | **PASS** | fork 200（新文件、`entryId` 保留）；rewind 200（回到空对话） |
| S-05 A2A watcher 双相 | **PASS** | 见 P16 |
| S-06 A2A 关闭态 | **PASS** | `GET/POST /a2a/demo` 均 `404 Not Found` |
| S-07 工作区越界 | **PASS** | `400` + `{"code":400,"data":null,"message":"文件路径无效"}` |
| S-08 素材提及源 | **PASS** | `{"code":200,"data":[],"message":"Success"}` |
| S-09 MCP 网关 | **PASS** | 无 token `401 -32001`；initialize 200 + `Mcp-Session-Id`；notifications 202；`tools/list` **46** 个工具 |
| S-10 单 Agent | **PASS** | create 200（uuid4）；run 事件序列 `[status,text,text,text,text,complete,status,done]`（与矩阵记录逐项相等）、error 0；control 200 `{"status":"idle"}` |
| S-11 技能与团队 | **PASS** | 技能恰 `["canvas","v118workflow","workflow"]`；`/api/agents/get` 空数组 |
| S-12 i18n 逐请求 | **PASS** | en：`Reference "越界媒体" is not available: 文件路径无效`；zh-CN：`引用「越界媒体」不可用：文件路径无效`（逐字符相等，证明 Host 未缓存 locale） |
| S-13a 装配 + 数据目录 | **PASS** | `[服务启动成功]`、临时 `settings.json` 可解析、`/api/tools/get` 200 |
| S-13b fail-fast | **PASS** | 见 P15（exit 0） |
| S-13c 桌面/移动静态装配 | **PASS** | 桌面 `server/app`=1、`createApp`=1、274<279、`app.listen`=0、`@/agent`=0；移动 1/1/21<108、`app.listen`=1、`app.use(toonflow)`=1、`@/agent`=0 |
| 附加：诊断日志落盘 | **PASS** | `<dataDir>/logs/agent.log` 写入 `run.start/run.end/control/session.close`，与迁移前路径语义一致 |

**16/16 通过。** 另：`S-03 并发会话` 未跑（需要长时间 SSE 并发窗口），但 `sessions.ts`/`requests.ts` 的改动均为 Host 转发，且 S-04/S-10 覆盖了同一组文件锁与运行态判定；登记为未执行项。

## 4. 构建与类型

| 项 | 结果 |
| --- | --- |
| `bun run --cwd apps/server typecheck` | exit 0 |
| `bun run --cwd packages/formats typecheck` | exit 0 |
| `bun run --filter '@toonflow/server' build` | exit 0（23.27 MB bundle） |
| `bun run --filter '@toonflow/web' build` | exit 0（web 直编 server 源码，14 exports 契约未破） |
| `bun run typecheck`（全仓） | `@toonflow/server`、`@toonflow/formats`、`@toonflow/file`、`@toonflow/i18n` 均 exit 0；`web`/`nodes*` 仅有 **既有** `.vue` 模块解析失败（与本次改动无关，改动前即存在） |

## 5. 偏差登记（与矩阵/方案的计数差异，均不改变结论方向）

| 编号 | 偏差 | 根因 | 处置 |
| --- | --- | --- | --- |
| **D-1** | 基线 A2P = **75**（矩阵 74）：`agent/runtime/requests.ts:12 → @/lib/agentLog` 已随 `484ea35` 合入；连带 P3b 14（矩阵 13）、`e9` 17（矩阵 16）、新增代码文件 9（矩阵 8）、`files_total` 718（矩阵 714） | 方案 §0.3 **F-01 / D-01 的漂移已经发生**（矩阵冻结树 `89572b5` 之后合入了日志提交） | 按 F-01 登记的处置执行：日志实现下沉到 **agent 域** `agent/log.ts`，目录经 `settings.settingsPath()` 取得（复用 `settings` 组，不新增组）；`lib/agentLog.ts` 删除、应用侧经门面取 `agentLog`。`e9` 标签同步为 `17 处 agent 会话与 teams 契约 import`，P21 `label_match=1` |
| **D-2** | `files_total` 718 而非 714 | 同上（+1 代码文件），且本机基线本身为 710 而非 706（`upstream` 后续提交新增 4 个文件） | 以实测 718/uncovered 0 为准；`map.json` `stats.files_total/covered` 已同步 718 |
| **D-3** | P17 = 5 行 / 5 文件（矩阵 10 行） | 每个消费文件用**一条分组 import** 取代逐符号多行（`singleAgent/index.ts` 由 5 行合 1 行） | 文件集合与矩阵完全一致；行数差异纯属书写风格，不影响「反向边只落在 5 个文件」的实质 |
| **D-4** | A-08 的 `agent_scc=0` 需要额外动作 | 方案未点名 `agent/runtime/{delegation,index}.ts` 的**域内**既有环（基线 10 文件大环被切断后残留为 2 文件环） | 补做依赖注入：`runDelegatedAgent({ run })` 由调用方注入主循环，语义零变化。未注入时行为与之前完全一致 |

> 说明：D-1～D-3 属于**基线漂移 + 书写风格**，D-4 属于**为使方案自述的 A-08 期望成立**的必要补做；四者均未放宽任何判据，也未删除任何能力。

## 6. 风险与回滚

- 回滚粒度：① 仅回滚 `packages/formats`（shim 改回原实现）→ 回到 M0 的 B0 前状态；② 回滚 `agentHost.ts` + 步骤 9.5 → agent 首次 `getAgentHost()` 将 fail-fast（不可运行），因此**必须先恢复 agent 侧 import 再删注入**；③ 单文件回滚安全（每处调用点只依赖契约属性）。
- 观察项：`getAppOrigin` 由 `resolveAppOrigin(bag)` 唯一实现，`mobileLink` 经 `res.locals.toonflowMobileLink` 传入；设备互联请求下的 403 语义由 S-09/S-12 覆盖，联网设备端到端未在本次环境验证。
- 观察项：`agent/log.ts` 在 Host 未注入时**吞掉**日志（best-effort 语义），不会抛错影响对话。

## 7. 附录：改动文件清单（受跟踪）

- 契约/装配/门面：`agent/host.ts`(新)、`agentHost.ts`(新)、`agentRuntime.ts`(新)、`agent/log.ts`(新)、`app.ts`、`utils.ts`
- agent 消费点（22 个文件）：`agent/{assets,mentionFiles,mentionSources}.ts`、`agent/a2a/{index,settings}.ts`、`agent/runtime/{delegation,imageAttachments,index,mentions,model,permissions,preferences,requests,resources,sessions,toolOutput,types}.ts`、`agent/skills/index.ts`、`agent/teams/{index,remote}.ts`、`agent/tools/{index,memory,subAgent}.ts`
- 应用侧：`modules/agentAccess/singleAgent/{index,types}.ts`、`modules/mcpIntegration/mcp/{control,tools}.ts`、`modules/localRuntime/mobileLink/index.ts`、`modules/platformCore/conf/index.ts`、`routes/{agent,agents/a2a/save,settings/save,settings/systemPrompt,singleAgent/run}.ts`、`lib/{documentFormats,modelReasoning,mentionSources}.ts`
- 包与配置：`packages/formats/**`(新)、`apps/server/package.json`、`bun.lock`
- 架构地图：`.easyvibe/map/map.json`、`parts/{agent-runtime,server-api}.edges.json`、`modules/server-api.json`
- 规范：`AGENTS.md`（步骤 9.5 与 agent 端口规则）
