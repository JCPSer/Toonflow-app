# 记忆 · 第 10 轮审查闭环：模块依赖元数据归真 + AGENTS 规则对齐 + 地图/子图重算

## S — Situation（背景）

server-api 子模块拆分（7 个 `modules/<id>/index.ts` + `app.ts` 78 行组合根）在行为等价性与结构层面均通过独立审查，但第 3 轮审查判 **fail**，两项阻断：

1. **B-2｜元数据与规范漂移**：`localRuntime` 声明依赖 `assetLibrary`、`mediaGeneration`（实际是反方向边），`platformCore` 多声明 `mediaGeneration`（实际 0 出边）；新增的 `AGENTS.md` 规则写“模块之间只能经入口”，而代码有 53 条跨子模块深引；入口形态写“静态面至少一条值级 / 动态块仅 2 处 / 不写实现”，与 `agentAccess` 纯 `import type`、9 处动态导入、3 个入口含装配胶水的事实矛盾。实施报告把 A-18/A-22 标 PASS，属证据失真。
2. **B-3｜地图未重算**：`map.json` 的 `server-api.files` 仍指向已不存在的 `src/utils/**` 与顶层 `src/remoteConnection.ts`，`health` 仍报“237 文件 / god_module”，子图仍是迁移前 8 子模块快照——以地图为度量口径的“问题消除”根本无法观测。

## T — Task（任务）

只修审查意见内条目：让契约元数据与代码事实一致、让 `AGENTS.md` 规则逐条可核对、重算主地图与子图；不新增业务行为、不碰审查意见外文件；若某项无法消除则结构化登记理由。

## A — Action（动作）

1. **依赖归真（代码 2 行）**：`localRuntime.dependencies → ["platformCore"]`、`platformCore.dependencies → ["localRuntime"]`；并在 `types/module.ts` 写明“`dependencies` = 实测出边、无运行时消费者、改跨模块引用须同步 AGENTS 表与地图”的语义（替代新增自检脚本——仓库规则禁止新增自检命令）。
2. **AGENTS 三条规则重写为可核对口径**：跨模块“优先入口 + 53 条深引（36 文件）按 E10 冻结、不新增 pair/深引文件”；入口“静态面可为纯 `import type`；动态块 9 处逐一列出；装配胶水 ≤35 行（当前最大 33）”；模块表两处 `dependencies` 同步，并新增一条“`dependencies` 是实测出边”的判据说明。
3. **地图重算**：`init → emit-module/write-edges → append-log → finalize`；`server-api.files` 换为 `app/index/core/router/utils + lib/** + modules/** + routes/** + types/** + scripts/**`，`key_entries`/`health`/`review_note` 更新（god_module 关闭，score 54→72），受影响边标签按实测改写（agent→应用 71、应用→agent 24、应用→shared 91、web→server 38+130）；架构级 health 60→68，移除已消除的 `c-arch-2`，新增 `c-arch-4`。`_tools/scan2.py`、`build_parts.py` 的 glob 同步。
4. **子图重算**：`modules/server-api.json` 按代码重新划分为 8 子模块（bootstrap_wiring 9 / asset_library 28 / media_generation 43 / plugin_market 50 / mcp_integration 21 / local_runtime 46 / agent_access 27 / platform_core 22 = 246 文件 / 14,584 行），内部边 33 条由说明符解析生成，逐文件归属无重复/遗漏。
5. **低成本 P 项**：i18n `messageSources.json` 只做路径重写（479 条，旧 `apps/server/src/utils/` 归零，不重跑全量 extract 以免 8,000 行无关差异）；`CONTRIBUTING.md` 的 `utils/` 口径改 `modules/<模块>/<域>/`；`singleAgent/types.ts` 的 `../../../` 改 alias。
6. **验证**：V9 7/7；三宿主 `tsc --noEmit` 全 0；源码启动 475 ms、5 端点 200/403/401/404/404；`bun run routes` 字节幂等（161 `app.use`）；facade 37 键；前缀 21/21 唯一；地图覆盖 706/706。

## R — Result（结果）

- **B-2 / B-3 关闭**：依赖表与实测出边 7/7 一致；AGENTS 的 9 项规则全部可由脚本复算；主地图不再包含旧路径、`server-api` 246 文件 / 8 子模块可观测，`god_module` 关注点消失，新结构债（53 条深引、双向环 71/24）以 `c-server-api-2/4`、`c-arch-1/4` 继续跟踪。
- **行为零变化**：代码侧只改 2 个依赖字面量 + 1 处 alias + 1 段注释；typecheck、启动、端点、路由表、facade 全部与基线一致。
- **未采纳项**：P-2（bootstrap 深引改入口会让 `conf` 提前求值）、P-6（`unassigned` 抛错影响 dev 启动/路由生成）、新增自检脚本（违反仓库“不新增自检命令”规则）——均在 TEST-2026-10-27-03 §6 写明可核对理由。
