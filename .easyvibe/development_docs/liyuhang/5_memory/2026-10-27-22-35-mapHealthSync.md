# MEM-2026-10-27-05 · 架构地图 health 与生成源同步（第 6 轮整改）

- 需求：REQ-2026-10-27-05（矩阵 v5）· 方案：SOL-2026-10-27-05 · 验证：TEST-2026-10-27-05
- 审查输入：`review-task-1793073878481.md`（打回，阻断项 B-1）

## S（Situation）

AgentHost 端口落地后，代码层 A2P=0、含 agent 的 SCC=0、typecheck 与装配探针全绿，但**架构地图仍宣称该 P0 环存在**：`map.json` 全局与 `server-api`/`agent-runtime` 三处 `decay_flags` 含 `circular_dep`、三条 `critical` concern 逐字复述「71/24 处双向 import」、三段 review_note 仍写「未端口化」。同一文件的边表已删 `e7`、`e9` 改 17 处 —— 自相矛盾；`meta` 仍标 `1861cd0` + 08:01 却又手改过 stats，出处失真。两份作者脚本（`_analysis/build_modules.py`、`_tools/build_parts.py`）同样保留旧结论，任何重算都会写回错误。此外 4 个 JSON 丢末尾换行、两个探针输出 `scan2/3.out` 留在工作树、矩阵/方案状态未回填。

## T（Task）

- 地图 health 必须与 edges/代码自洽：关闭 3 处 `circular_dep` 与 3 条 critical 环 concern，保留真实残余（layer_violation / 452 处深引 / web 编译期插件）；
- 生成源同步，保证下一次重算不回退；
- 提交「复检可验证」的确定性读数；
- 不碰业务代码（保持「无需重跑冒烟」前提），顺带闭环 N-1/N-5/N-6/N-7。

## A（Action）

1. **刷新模块事实**：`parts/agent-runtime.json`（35 文件 / 4,612 行、A2P=0、e9 17 处、保留 run()/会话 Map 两项债）、`parts/server-api.json`（250 文件 / 14,774 行、补 agentHost/agentRuntime、e13/e26 既有回边、四类残余债）、`parts/shared-foundation.json`（补 `packages/formats/**`，20 文件 / 1,230 行）、`parts/_arch_health.json`（flags 仅 `layer_violation`，concern 换为 c-arch-4/3/5）。
2. **子图对齐**：`modules/server-api.json` 的 bootstrap 增加 `agentHost.ts`/`agentRuntime.ts`（union=parent 248），health 去掉环断言、只留 `god_facade`。
3. **官方链路重算**：`easyvibe_map2.py init → emit-module ×11 → write-edges ×11 → append-log → finalize --loc 99162 --head-short 794886b`，一次跑通：schema 校验 0 错、growth.log 回放一致、覆盖率 718/718、边 30 条；`meta/provenance/stats` 由脚本按当前树重算（不再手改）。
4. **生成源同步**：`build_parts.py` 的 `MODULES`（11 模块）与 `ARCH_HEALTH`、`EDGES` 全表按 `parts/` 重建；`build_modules.py` 11 个模块条目与 `edges` 全表重建并重跑 `modules_built.json`，两者重算结果 = 当前 parts（逐字段断言）；两脚本补 `# -*- coding: utf-8 -*-`（macOS Python 3.9 在长 CJK 行上会误判源码编码）。
5. **新增守卫**：`_tools/check_health_consistency.py` —— Tarjan 模块环、`circular_dep` 残留、环断言文本、critical 环 concern、dependencies↔边、layer_violation↔direction_violation、`agent-runtime→server-api` 边必须 0。
6. **清尾**：4 个 JSON 末尾换行回补；删除 `scan2.out`/`scan3.out`；矩阵 v5、方案 §0、两个 INDEX 状态回填「已评审通过 → 已实施」；报告写明 60 符号 = 57 成员 + 3 注册表/类型符号的口径。

## R（Result）

- 复检一条命令：`check_health_consistency.py` → `{"agent_scc":0,"circular_dep_flags":0,"cycle_claim_hits":0,"critical_cycle_concerns":0,"deps_mismatch":0,"agent_to_server_edges":0,...,"ok":true}`；`pre_existing_scc=[["server-api","desktop-shell"]]` 单独列出（e13/e26，非本次环）。
- 独立复核：A2P=0、file SCC 2 / agent 0、`e7` 不存在、`e6=28`、`e9=17`；`bun typecheck`（server、formats）exit 0。
- 业务代码零改动（`find -newermt` 0 个文件；工作树 46 + `bun.lock` = 上轮 47）。
- 延后并留痕：N-2（契约 `any`）、N-3（mobileLink 双事实源）、N-4、N-8 —— 需改代码会破坏「本轮只同步地图」的最小整改边界。
