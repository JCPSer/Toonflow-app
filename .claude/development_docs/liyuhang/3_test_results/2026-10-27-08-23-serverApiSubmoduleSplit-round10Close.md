# 测试与自检报告 · server-api 子模块拆分 · 第 10 轮审查闭环

## 0. 文档元信息

| 项 | 内容 |
| --- | --- |
| 文档编号 | **TEST-2026-10-27-03** |
| 对应需求/方案 | `REQ-2026-10-26-06`（矩阵 v6） · `SOL-2026-10-27-04`（方案 v4） |
| 触发原因 | 独立审查 `review-task-1793021002827` 第 3 轮：**fail**，2 项阻断（B-2 元数据/规范漂移、B-3 地图未重算且 A-22 标 PASS） |
| 代码基线 | `HEAD = 1861cd0`；本轮改动=审查意见内条目，**零业务行为变更** |
| 环境 | macOS arm64；`/opt/homebrew/bin` 下 bun 1.3.11 / node v25.5.0（默认 PATH 未包含，验证时显式加入） |
| 结论 | **B-2、B-3 全部闭环**；回归判据（类型、启动、路由、facade、前缀、行为等价）全部复现通过 |

---

## 1. 审查意见 → 处置对照

| 审查项 | 处置 | 落点 |
| --- | --- | --- |
| B-2 事实1：2/7 入口 `dependencies` 与实测出边不符 | 改代码声明：`localRuntime.dependencies = ["platformCore"]`、`platformCore.dependencies = ["localRuntime"]` | `apps/server/src/modules/localRuntime/index.ts`、`.../platformCore/index.ts` |
| B-2 事实2：`AGENTS.md` “只能经入口”与 53 条深引矛盾 | 改为“优先入口 + 53 条深引（36 文件）冻结、不新增 source→target 对/深引文件” | `AGENTS.md`「目录结构」段 |
| B-2 事实3：入口形态描述与代码不符（无值级静态面 / 动态块 2 处 / 不写实现） | 改为可核对口径：静态面允许纯 `import type`；动态块 **9 处冻结**并逐一列出；装配胶水 **≤35 行**（当前最大 33 行） | `AGENTS.md`「模块入口与契约」段 |
| B-2 建议3：加一致性校验（前缀并集=21、`dependencies ⊇` 实测出边） | **不新增自检命令**（`AGENTS.md` 第 258 行明确禁止新增 package scripts 自检命令/CI 入口）；改为在契约字段写清语义 + 在 AGENTS 写明复核口径，本轮以 V9 复算作证 | `apps/server/src/types/module.ts`、`AGENTS.md` |
| B-3：地图未重算，A-22 标 PASS 无证据 | 走分支①：**重算主地图**（`server-api.files` 换为 `src/modules/**`）**并重算子图**为 8 子模块 / 246 文件；A-22 证据已补（见 §4），实施报告 A-18/A-22 行同步修订 | `.easyvibe/map/**`、`3_test_results/2026-10-27-05-10-...md` |
| P-3 i18n 生成物路径失真 | 只做路径重写（不改文案、不重跑全量 extract，避免 8,000 行无关生成差异） | `packages/i18n/src/messageSources.json` |
| P-4 协作文档滞后 | `CONTRIBUTING.md` 的 `utils/` 口径改为 `modules/<模块>/<域>/` | `CONTRIBUTING.md` |
| P-5 单处 `../../../` 穿透 | 改为 alias | `modules/agentAccess/singleAgent/types.ts` |
| P-1/P-2/P-6/P-7 | 处理与不处理理由见 §6 | — |

---

## 2. V9 复算：7/7 入口 `dependencies` = 实测出边

扫描口径：`apps/server/src/modules/<id>/**/*.ts` 内所有 `from "@/modules/<target>…"` 与动态 `import()`，解析到目标文件后按目标模块归属去重（与审查 V9 同口径）。

| 入口 | 声明（修正后） | 实测出边 | 一致 |
| --- | --- | --- | --- |
| `assetLibrary` | localRuntime, mediaGeneration, platformCore | 同左 | ✅ |
| `mediaGeneration` | localRuntime, platformCore | 同左 | ✅ |
| `pluginMarket` | localRuntime, mediaGeneration, platformCore | 同左 | ✅ |
| `mcpIntegration` | localRuntime, mediaGeneration, platformCore, pluginMarket | 同左 | ✅ |
| `localRuntime` | **platformCore** | platformCore（4 处） | ✅（修正前多声明 assetLibrary、mediaGeneration，实为反方向边） |
| `agentAccess` | platformCore, pluginMarket | 同左 | ✅ |
| `platformCore` | **localRuntime** | localRuntime（1 处） | ✅（修正前多声明 mediaGeneration，实测 0 出边） |

`dependencies` 字段**无运行时消费者**（`grep` 仅命中 7 个入口的字面量与 `types/module.ts` 声明），改动不影响行为。

---

## 3. B-2 规范与代码的逐条对账（`AGENTS.md` 新版）

| 规范文字（新版） | 实测 | 命令/口径 |
| --- | --- | --- |
| 跨模块 57 条 import：4 条经入口，53 条深引、涉及 36 个域文件 | 57 / 4 / 53 / 36 | 正则扫描 7 个模块全部 `.ts` 的 `@/modules/<id>` 说明符 |
| 经入口的 4 条：`mcpIntegration→pluginMarket` 3 + `pluginMarket→mediaGeneration` 1 | 一致 | 同上（说明符 `@/modules/<id>` 无子路径） |
| 入口动态块 9 处（5 个入口各 1 + `mcpIntegration.mount` 的 4 条 `Promise.all`） | 9 | 扫描 `modules/*/index.ts` 的 `import(` |
| 装配胶水 ≤35 行（当前最大 33 行 `pluginMarket`） | 33 | 去掉 import/注释/契约对象后的函数体行数：入口 18/18/16/31/43/46/57 行中分别为 5/4/4/14/24/32/33 |
| 入口 ≤60 行 | 16–57 行 | `wc -l` |
| `routePrefixes` 并集 21 且两两不相交；`/mcp`、`/a2a` 只在 `gateways` | 21/21 唯一，0 重复；网关恰为 2 项 | 入口契约解析 + 路由首段比对（21 段全覆盖） |
| `localRuntime` 只出边 `platformCore`、`platformCore` 只出边 `localRuntime` | 一致 | 见 §2 |
| 地图已重算（246 文件 / 8 子模块） | 一致 | 见 §4 |

---

## 4. B-3 地图与子图重算（V12 证据）

执行链：`easyvibe_map2.py init` → 按 `parts/` 逐模块 `emit-module` + `write-edges` → `append-log` → `finalize`，再以独立脚本生成子图。

| 判据 | 审查要求 | 本轮结果 |
| --- | --- | --- |
| `server-api.files` | 不含 `apps/server/src/utils/**`、不含顶层 `src/remoteConnection.ts`，含 `src/modules/**` | `app.ts / index.ts / core.ts / router.ts / utils.ts / lib/** / modules/** / routes/** / types/** / scripts/**` ✅ |
| `key_entries` | 不再指向已迁移路径 | `app.ts#createApp`、`core.ts#generateRouter`、`modules/localRuntime/remoteConnection.ts#createRemoteConnection`、`modules/platformCore/index.ts#corsGuard`、`modules/assetLibrary/index.ts#warmup`、`routes/assets/list.ts` ✅ |
| `health` | 不再报“237 文件 / god_module” | score 54→**72**，`decay_flags = [circular_dep, coupling_high]`（`god_module` 关闭），review_note 改写为 246 文件 / 14,584 行 + 7 子模块 ✅ |
| 覆盖 | 246 文件全覆盖 | `coverage = 100.00% (706/706)`；`server-api` 归属 246 文件 / 14,584 行（bootstrap 9 + 域 66 + lib 9 + types/desktop 1 + routes 161） ✅ |
| 子图 | 8 子模块 / 246 文件 | `sub_modules=8`、`files_snapshot=246`、内部边 33 条（strong 15 / medium 6 / weak 12），逐文件归属无重复、无遗漏 ✅ |
| 地图元数据 | 与实际一致 | `generated_at=2026-10-27T08:01:50+08:00`、`loc=98,243`（706 文件）、`provenance.head_short=1861cd0` ✅ |
| 架构级 health | 独立评估，非模块均分 | score 60→**68**，`decay_flags=[circular_dep, layer_violation]`；concerns `c-arch-1`（双向环，保留）、`c-arch-4`（53 条深引无守卫，新增）、`c-arch-3`（web 静态引入插件，保留），`c-arch-2`（god module）已消除并移除 ✅ |

子图 8 子模块与文件数：`bootstrap_wiring` 9 / 691 行、`asset_library` 28 / 2,633、`media_generation` 43 / 3,037、`plugin_market` 50 / 2,339、`mcp_integration` 21 / 1,464、`local_runtime` 46 / 2,205、`agent_access` 27 / 1,214、`platform_core` 22 / 1,001（合计 246 / 14,584）。

> 地图工具链同步：`_tools/scan2.py`、`_tools/build_parts.py` 的 `server-api` glob 一并改为 `src/modules/**`，避免下次全量重算回退到旧归属。

---

## 5. 回归判据（行为等价）

| # | 判据 | 命令 | 结果 |
| --- | --- | --- | --- |
| R1 | 三宿主类型检查 | `bun x tsc --noEmit`（apps/server、apps/desktop、apps/mobile） | 三者 **exit 0 / 0 行输出** |
| R2 | 源码启动 | `TOONFLOW_DATA_DIR=$(mktemp -d) TOONFLOW_SERVER_PORT=3399 bun src/index.ts` | `[服务启动成功]`，475 ms |
| R3 | 端点冒烟 | `GET /api/tools/get` / `GET /api/settings/get` / `GET /mcp` / `POST /a2a` / `GET /api/nonexistent` | **200 / 403 / 401 / 404 / 404**（与审查 V2 基线逐条一致） |
| R4 | 路由生成器幂等 | `bun run routes` 后与运行前 `src/router.ts` 比对 | 字节一致；161 条 `app.use`，21 条模块分组注释 |
| R5 | 聚合出口 | 解析 `utils.ts` 默认导出键 | **37 键**，与基线一致 |
| R6 | 前缀契约 | 解析 7 个入口 `routePrefixes` + 路由首段 | 21 项、无重复、21/21 覆盖；网关仅 `/mcp`、`/a2a` |
| R7 | 相对穿透 | 扫描 `apps/server/src/**/*.ts` 的 `../` 说明符 | 仅 4 处既有：`index.ts→electrobun.config`（E13 已知）、`agent/mentionSources.ts→../lib/*` 2 处、`agent/runtime/types.ts→../../lib/*`（均属 agent→server 既有边），本轮改动未新增 |
| R8 | i18n 生成物 | `json.load` + 路径计数 | 合法 JSON；`apps/server/src/utils/` **0 条**（479 条路径全部重写为 `src/modules/...`） |

---

## 6. 非阻断建议（P 级）处理说明

| # | 处理 | 理由（可核对） |
| --- | --- | --- |
| P-1 死公开面 | **不删代码，登记证据反驳一半** | `listTools` 确有跨模块消费者：`modules/mcpIntegration/mcp/tools.ts:13` 从入口 `@/modules/pluginMarket` 导入并在 157 行调用；`internalAssetDirectories`、`getMcpSettings` 确无外部消费者，但删除会让入口静态面变空，且 `listTools` 的 re-export 求值时刻变化会牵动 `Bun.plugin({name:"toolHost"})` 时序（行为等价风险），故保留并留痕 |
| P-2 bootstrap 深引 entry 未导出符号 | **不改** | `src/index.ts` 的 2 条是**动态** `await import()`（不进入静态求值图），若改由入口静态 re-export 反而会把 `mcp/runtime`、`mobileLink` 拉进入口静态面，改变 `conf` 求值时机（A.3 约束）；风险大于收益 |
| P-6 `segmentOwner` 第二事实来源 / `unassigned` 静默 | **不改** | 改成运行期抛错会影响 `NODE_ENV=dev` 启动与 `bun run routes`；当前 21/21 覆盖已由 R6 校验，偏差可在评审时发现。后续如需守卫，应作为独立需求（并遵守“不新增自检命令”约束） |
| P-7 工作区卫生 | **部分** | 本轮新增的 `.bak` 均为地图 `init` 的合法归档产物（工具规定动作）；`_analysis/**`、`task_*.json` 为过程文件，未纳入任何提交范围，提交时按审查意见剔除 |
| 矩阵 INDEX 状态 | **已修** | `1_requirements_matrix/INDEX-2026-10.md` 的 `REQ-2026-10-26-06` 状态与统计同步为“已实施、第 10 轮闭环待重审” |

---

## 7. 豁免与残余风险

- E1–E15 维持原登记，不新增豁免项（B-3 已按“重算”而非“豁免”关闭）。
- 残余结构债已写入地图：`c-server-api-2`（server↔agent 双向环 71/24）、`c-server-api-4`（53 条深引无守卫）、`c-arch-1`/`c-arch-4`，作为下一轮整改输入。
- 本环境未运行 `bun run build` 与 OHOS 打包（第 2 轮 B-1 的字面路径守卫已由 `compat/ohos/nodeBuildPlugin.ts` 的 `existsSync` 兜底覆盖，本轮未改该文件）。

---

## 8. 复核命令（可直接复跑）

```zsh
export PATH=/opt/homebrew/bin:$PATH
# V9：7/7 入口依赖 vs 实测出边
python3 /tmp/v9.py | tail -12
# V12：地图归属
python3 - <<'PY'
import json; m=json.load(open('.easyvibe/map/map.json'))
sa=[x for x in m['modules'] if x['id']=='server-api'][0]
print(sa['files']); print(m['meta']['stats'])
PY
# 回归
(cd apps/server && bun x tsc --noEmit)
(cd apps/server && bun run routes && git diff --stat src/router.ts)
```
