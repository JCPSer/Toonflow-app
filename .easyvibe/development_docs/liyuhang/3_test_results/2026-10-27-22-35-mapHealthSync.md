# 实施与测试结果 · 第 6 轮整改：同步架构地图 health 与生成源

> 报告编号 **TEST-2026-10-27-05**。输入：独立审查报告 `review-task-1793073878481.md`（**打回**，阻断项 B-1）、需求矩阵 REQ-2026-10-27-05、方案 SOL-2026-10-27-05、上一轮实施报告 TEST-2026-10-27-04。
> 本轮**只改地图与文档，零业务代码改动**（证据见 §6），因此不重跑 16 项业务冒烟，按审查意见重跑 §1 结构探针与 `tsc`。

## 0. 元信息

| 项 | 内容 |
| --- | --- |
| 实施时间 | 2026-10-27 22:18–22:38 |
| 基线 | 代码工作树与 TEST-2026-10-27-04 完全一致（`git HEAD = 794886b`，未提交改动 46 个受跟踪文件） |
| 改动面 | `.easyvibe/map/**`（map.json、parts、modules 子图、growth.log、两份生成源脚本、新增守卫脚本）；文档：本报告 + 两个 INDEX + 矩阵/方案状态回填 + 记忆 + 操作归档。`AGENTS.md` 与业务代码本轮未改 |
| 结论 | **B-1 关闭**：地图 health 与 edges/代码实测自洽（`agent_scc=0`、`circular_dep_flags=0`、`cycle_claim_hits=0`、`critical_cycle_concerns=0`），且重算链路（parts → growth.log → finalize）一次跑通并写出 schema 校验通过的 map.json |
| 未改动 | `apps/**`、`packages/**`、`compat/**`（`find -newermt` 实测 0 个文件；`git status` 数量与上轮相同） |

## 1. 整改清单（逐条对应审查意见）

| 编号 | 审查意见 | 本轮处置 | 完成判据（可复算） |
| --- | --- | --- | --- |
| **B-1（阻断）** | 地图与生成脚本仍断言 P0 环存在（3 条 critical concern、3 处 `circular_dep`、3 段 review_note ①），与已删除的 `e7` 自相矛盾；`meta` 出处失真 | ① 地图数据：`parts/{agent-runtime,server-api,shared-foundation}.json`、`parts/_arch_health.json`、`modules/server-api.json` 的 health 全部改写为「已闭环 + 残余项」；② 生成源：`_tools/build_parts.py`（`MODULES` 11 模块全量、`ARCH_HEALTH`、`EDGES` 全表）与 `_analysis/build_modules.py`（11 个模块条目 + edges 全表）同步为「重算=当前 parts」；③ 用**官方重算链路**（init → emit-module ×11 → write-edges ×11 → append-log → finalize）重建 `map.json`，`meta.generated_at/provenance.head_short/loc/stats` 由脚本按当前树重算 | §2 的 P22–P24；§3 复算；`grep -c circular_dep map.json = 0` |
| N-1 | 4 个 JSON 丢末尾换行 | `map.json`、`modules/server-api.json`、`parts/agent-runtime.edges.json`、`parts/server-api.edges.json` 末尾 `\n` 已回（写盘函数统一 `f.write("\n")`） | P26（`tail -c 1` 全部为 `\n`） |
| N-5 | `_analysis/scan2.out`、`scan3.out` 探针输出留在工作树 | 删除（tracked 的 `scan.out` 保留）；重算时 `init` 按 CLI 既有规则把旧 `growth.log` 滚到 `growth.log.<stamp>.bak`（与仓库内 7 个同类备份同构，不入交付清单） | P27（`ls _analysis/*.out` 仅 `init.out`、`scan.out`） |
| N-6 | 「契约 60 符号」与运行时 57 成员口径不一 | 在 §5 写明口径：**60 = 14 组 57 个成员 + `AgentHost` 类型 + `configureAgentHost` + `getAgentHost`**；地图文案改用「14 组契约」，避免与运行时口径混淆 | §5 逐组点数 |
| N-7 | 矩阵/方案状态未回填 | 矩阵 v5「当前状态」、方案 §0「需求状态」、两个 INDEX 的对应行改为「已评审通过 → 已实施 + 第 6 轮地图同步」 | P28（`grep -c 待评审` 命中 0，见 §7） |
| N-2 | Host 契约以 `any` 承载返回值 | **本轮不改**（见 §8 决策） | — |
| N-3 | mobileLink 判定存在双事实源 | **本轮不改**（见 §8 决策） | — |
| N-4 | `getAgentHost()` 调用风格不统一 | **本轮不改**（纯可读性） | — |
| N-8 | `createAgentHost(_context)` 形参未用 | **本轮不改**（不引入代码 diff，保持审查「无需重跑冒烟」前提） | — |

## 2. 探针结果（本轮新增 + 复用）

| 探针 | 判据 | 命令/方法 | 期望 | 实测 | 判定 |
| --- | --- | --- | --- | --- | --- |
| **P22** | 地图 health ↔ edges 自洽（新增守卫） | `python3 .easyvibe/map/_tools/check_health_consistency.py` | `ok=true` 且 `agent_scc=0 / circular_dep_flags=0 / cycle_claim_hits=0 / critical_cycle_concerns=0 / deps_mismatch=0 / agent_to_server_edges=0` | 逐字命中（`ok: true`，exit 0），另：`module_scc_total=1`，`pre_existing_scc=[["server-api","desktop-shell"]]`（既有 e13/e26 回边，与 Agent 环无关） | PASS |
| **P23** | 重算可复现 | `init → emit-module ×11 → write-edges ×11 → append-log → finalize --loc 99162 --head-short 794886b` | exit 0，且 finalize 的 schema 校验 + growth.log 回放校验 + 覆盖率门禁全通过 | `appended layers=5 modules=11 edges=30`；`map.json written: modules=11 edges=30 coverage=100.00% (718/718)` | PASS |
| **P24** | 幂等重算 | 重跑同一链路（第二、三次） | 每次 exit 0，覆盖率与边数不变 | 三次均 `718/718`、`edges=30`；`growth.log` 备份按 init 规则滚动（`*.bak`） | PASS |
| **P25** | 地图无残留活断言 | `grep -rn "circular_dep\|双向 import\|双向引用\|71 处\|73 处" map.json modules/ parts/ build_parts.py build_modules.py modules_built.json` | 仅「已清零/已关闭」类历史陈述，无存在性断言 | 命中均为 `原 71 处反向依赖已清零`（closure 陈述）；`circular_dep` 在 map.json 中 **0** 次 | PASS |
| **P26** | N-1 末尾换行 | `tail -c 1 <file>` | `\n` | 4/4 为 `\n` | PASS |
| **P27** | N-5 探针输出清理 | `ls .easyvibe/map/_analysis/*.out` | 仅 `init.out`、`scan.out` | 命中 | PASS |
| **P28** | N-7 状态回填 | `grep` 矩阵 v5 / 方案 / 两个 INDEX | 状态项 0 处待评审（矩阵 v5 仅剩 §9「待评审决策点 Q1–Q13」章节标题，属设计评审问题清单，非状态项） | 4 个文件全部回填 | PASS |
| P1 / P2 | A2P=0（`@/` 与相对路径） | `grep -rnE 'from "@/(modules\|lib\|utils\|routes\|types\|agentRuntime\|agentHost)' apps/server/src/agent --include='*.ts' \| wc -l` | 0 | **0** | PASS |
| P6 | file 级 SCC（含 agent） | 自写 Tarjan 扫 `apps/server/src/**/*.ts`（278 文件，解析 `@/` 与相对路径） | `scc_total=2 / agent_scc=0` | `scc_total 2`（`pluginMarket/{teams/files,teams/install,plugins/install}`、`mcpIntegration/mcp/{dxt,servers}`，均既有）`agent_scc 0` | PASS |
| P6b | `e7` 不存在 | 解析 `map.json.edges` | 无 `e7` | 30 条边，无 `e7`；`e6=28 处 file/i18n/formats import`、`e9=17 处 agent 会话与 teams 契约 import` | PASS |
| P12 | 地图覆盖率 | finalize 自算 | `718/718` | `718/718`，`coverage_ratio=1.0` | PASS |
| P29 | schema 校验 | `easyvibe_map2.py finalize` 内建 `schema_errors()` | 0 错误 | 0 错误（否则 finalize 拒绝写盘） | PASS |
| P30 | 类型 | `bun run --cwd apps/server typecheck` / `packages/formats typecheck` | exit 0 | 0 / 0 | PASS |
| **P31** | 生成源=当前地图（静态重算等价） | `import build_parts` 后逐字段比较 `MODULES` vs `parts`、`EDGES` vs `map.edges`、`ARCH_HEALTH` vs `map.health`；`build_modules.py` 重跑后比较 `modules_built.json` vs `parts` | 全部相等 | 6 字段 × 11 模块、30 边、arch 全等；`modules_built.json` 的 `health`/`files` 11/11 相等 | PASS |

## 3. 地图 health 改动前后（逐条）

| 位置 | 改前 | 改后 |
| --- | --- | --- |
| `map.health.decay_flags` | `["circular_dep","layer_violation"]` | `["layer_violation"]`（`e13` 仍 `direction_violation=true`，flag 有边证据支撑） |
| `map.health.concerns` | `c-arch-1`(**critical**，逐字为需求原文)、`c-arch-4`、`c-arch-3` | `c-arch-4`、`c-arch-3`、`c-arch-5`（新：`e13` 读宿主壳配置 → layer_violation，high）；`c-arch-1` 关闭并在 review_note 记明依据 |
| `map.health.review_note` | 「① 应用层与 agent-runtime 双向引用（71/24）…环仍落在最热链路」 | 「AgentHost 端口切断…A2P=0、含 agent 的 SCC=0、`e7` 删除、环消失」+ 复检口径（残余 1 个既有 SCC = `server-api ↔ desktop-shell`，非本次环） |
| `server-api.health` | `["circular_dep","coupling_high"]`；`c-server-api-2`(**critical**「71 处 import…环仍在」) | `["coupling_high"]`；`c-server-api-2` 改 high，只保留真实问题（38 键 facade）；`review_note` 补 e13/e26 既有回边与四类残余债 |
| `agent-runtime.health` | `["circular_dep"]`；`c-agent-runtime-1`(**critical**「与 server-api 双向 import 73/28」) | `[]`；删除该 concern，保留 `c-agent-runtime-2/3`（run() 职责、进程级会话 Map）；`review_note` 改写为 A2P=0 + 端口注入事实 |
| `shared-foundation.files / review_note` | 4 个 glob / 15 文件 1,077 行 | 增 `packages/formats/**`；20 文件 1,230 行（formats 5 文件 153 行） |
| `modules/server-api.json`（子图 bootstrap_wiring） | 9 文件 691 行；`["god_facade","circular_dep"]`；critical「utils.ts 聚合 @/agent…放大环」 | 11 文件 837 行（补 `agentHost.ts`/`agentRuntime.ts`，使子图 union = parent snapshot 248）；`["god_facade"]`；concern 降 high 且去掉环断言 |
| `parts/agent-runtime.edges.json`、`parts/server-api.edges.json` | 本身上轮已改，但 growth.log 仍含 `e7` | 由 `write-edges` 重写，`growth.log` 重建为与 parts 一致（旧日志按 init 规则备份 `growth.log.20261027-*.bak`） |
| `meta.generated_at / provenance / loc / stats` | `2026-10-27T08:01:50` / `1861cd0` / 98243 / 706 文件 31 边 | `2026-10-27T22:34:05+08:00` / `794886b` / 99162 / 718 文件 30 边（由 finalize 与当前树重算，不再手改） |

> 子图口径说明：`modules/server-api.json` 的 `parent.files_snapshot` 与 8 个子模块 `files` 的并集仍**严格相等（248）**；主地图 `server-api.files` 是 glob 口径（250 = 248 + HEAD 提交 `794886b` 新增的 `routes/assets/{copyToWorkspace,reveal}.ts`）。这 2 个文件属该提交带来的既有快照漂移，不在 B-1 范围，本轮只在报告中登记，未改动子图文件清单（避免把无关提交的改动卷入本次整改）。

## 4. 生成源同步（保证「下一次重算不回退」）

| 文件 | 同步内容 |
| --- | --- |
| `.easyvibe/map/_tools/build_parts.py` | **`MODULES` 全量按 `parts/` 重建（11 个模块 × 6 个字段逐字相等）**、`ARCH_HEALTH` 与 `parts/_arch_health.json` 相等、`EDGES` 全表与 `map.json.edges` 相等（30 条，`e7` 移除、`e6` 改指 `shared-foundation`+28 处、`e9` 17 处）——脚本重算即等于当前 parts，不引入其他模块回退 |
| `.easyvibe/map/_analysis/build_modules.py` | **11 个 `modules.append` 条目全量按 `parts/` 重建**、`edges` 全表重建；重新执行后 `_analysis/modules_built.json` = 11 模块 / 30 边，且每个模块的 `health`/`files` 与 `parts/` 相等（脚本实测断言） |
| 新增 `.easyvibe/map/_tools/check_health_consistency.py` | 确定性守卫：Tarjan 模块环、`circular_dep` 残留、环断言文本、critical 环 concern、`dependencies` 与边一致、`layer_violation` 与 `direction_violation` 互证、`agent-runtime→server-api` 边必须为 0。复检一条命令即可读数 |

> 说明：`gen_parts.py`（2026-10-24）、`build_parts2.py`（2026-10-26）、`growth.log.*.bak`、`map.json.*.bak` 属历史作者脚本与历史日志，**不改写**（它们描述的是各自时点的树，改写会伪造历史）；当前重算链路 = `parts/` + `growth.log` + `finalize`（P23/P24 已验证自洽）；两份脚本只用于重建 `parts/`，其产出与当前 `parts/` 逐字段等价（P31）。

## 5. 口径说明（N-6）

`agent/host.ts` 的 `AgentHost` 类型 = 14 组、**57 个成员**：workspace 9、settings 3、assets 11、models 8、personalization 4、teams 4、tools 3、skills 2、mcp 4、documents 1、media 3、browser 1、i18n 3、platform 1（合计 57，逐组点数）。
上一轮报告的「60 个 Host 符号」= 57 个运行时成员 + `AgentHost` 类型 + `configureAgentHost` + `getAgentHost`。运行时探针只能看到 57（成员），不会看到 3 个注册表/类型符号 —— 两者不矛盾，本轮地图文案统一写「14 组契约」，不再引用 60。

## 6. 未改动业务代码的实测证据

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 代码目录近期修改 | `find apps packages compat -type f -not -path '*/node_modules/*' -newermt <45 分钟前>` | **0 个文件** |
| 工作树改动量 | `git status --porcelain apps packages compat \| wc -l` | **46**，加根目录 `bun.lock`（`M`）正好等于 TEST-04 记录的 **47 个受跟踪改动**；集合未新增 |
| 类型 | `bun run --cwd apps/server typecheck`、`bun run --cwd packages/formats typecheck` | exit 0 / 0 |

## 7. 结论

- 审查阻断项 **B-1 关闭**：地图 health、模块子图、两份生成源、`growth.log` 与重构后的代码事实一致；`map.json` 由官方链路重算而非手改，schema/覆盖率/回放三重校验通过。
- N-1、N-5、N-6、N-7 关闭；N-2/N-3/N-4/N-8 按下述决策延后。
- 复检入口：`python3 .easyvibe/map/_tools/check_health_consistency.py`（一条命令输出 14 项读数，`ok: true`）。

## 8. 延后项决策（留痕）

| 编号 | 决策 | 理由 |
| --- | --- | --- |
| N-2（Host 契约 `any`） | 延后 | 审查定为非阻断；改类型会触碰 14 组契约与 20 条装配，需重跑全部运行期探针与 16 项冒烟，与「本轮只同步地图」的最小整改口径冲突。建议单独立项（有 `agentHost.ts` 的返回类型断言兜底，当前 typecheck 通过） |
| N-3（mobileLink 双事实源） | 延后 | 同上：属运行期语义收敛，需覆盖 MCP/A2A 两条判定路径的冒烟；本轮不改代码可保证行为零变化 |
| N-4（`getAgentHost()` 风格） | 延后 | 纯可读性，无功能影响 |
| N-8（`_context` 形参） | 延后 | 注释/形参二选一都会产生代码 diff，本轮刻意保持代码零改动 |
