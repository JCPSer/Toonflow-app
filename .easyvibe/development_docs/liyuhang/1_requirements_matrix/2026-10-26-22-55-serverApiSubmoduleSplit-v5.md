# 需求矩阵 · server-api 应用子模块拆分（第 5 版 · 第 4 轮打回后重做）

## 0. 文档元信息

| 项 | 内容 |
| --- | --- |
| 文档编号 | **REQ-2026-10-26-05** |
| 版本 | 第 5 版（替代 REQ-2026-10-26-04） |
| 需求来源 | 架构地图模块级关注点 `c-server-api-1`（`.easyvibe/map/map.json`，`server-api.health.score = 50`，`decay_flags = [god_module, circular_dep, coupling_high]`）；全局关注点 `c-arch-1`（server↔agent 环）、`c-arch-2`（同一问题的全局视角） |
| 需求标题 | server-api 按素材库 / 媒体生成 / 插件市场 / MCP·工作区拆出应用子模块，`app.ts` 只保留组合根与路由装配 |
| 影响模块 | `server-api`（`apps/server`） |
| 需求类型 | 结构性重构（架构整改），**不改变任何业务行为** |
| 当前状态 | **待评审（第 5 版）**；本轮仅新增/更新需求文档与索引，业务代码零改动（`git status --porcelain apps/server` 为空） |
| 编写人 | 需求分析 agent（harness 规则 2.1） |
| 编写时间 | 2026-10-26 22:55 |
| 基线 | `git HEAD = d084136`；`.easyvibe/map/map.json` 生成于 `2026-10-26T21:13:59+08:00` |
| 上一版 | `2026-10-26-22-25-serverApiSubmoduleSplit-v4.md`（REQ-2026-10-26-04，**第 4 轮打回**） |
| 验收口径 | 问题消除 + 审查通过；无法消除项按 §8 结构化豁免登记；验收按 §6.5 二值判定表 + §6.7 判据规则 + §6.9 数值台账执行 |

### 0.1 第 4 轮打回意见逐条处置（本版核心修订）

| # | 打回意见（原文要点） | 根因 | 本版处置（可核对） | 落点 |
| --- | --- | --- | --- | --- |
| 1 | **a2 的 `scope_files` 期望 60 与 §R-07 的 41 矛盾，且实际为 42（不可达）** | ① 同一个物理范围（`modules/assetLibrary` + `routes/assets` + `routes/workspaces`）在两处写了两个数：R-07 写 B0 的 41、A-13 写 60（笔误）；② **更根本的问题**：把 `scope_files`（文件数）当成了判据的**断言对象**，而它是随 L2 新增文件变化的观测值 —— 只要入口文件落进扫描目录，B0 的 41 必然变成 42 | ① 数字改正：**a1（B0）= 41 / a2（F）= 42**（`9 + 1 + 18 + 14 = 42`，`+1` 是 L2 的 `modules/assetLibrary/index.ts`），R-07、A-13、§A.7.1、§A.7.8 四处统一；② **结构性修复**：新增 **§1.6.4 `scope_files` 观测化** —— `scope_files` 只输出、不参与 PASS/FAIL；判据改为断言 `hits` + `scope_files ≥ scope_min`（防空转、防丢文件），`scope_min` 取 B0 实测值；③ 新增 **§6.9 数值可达性台账**（L01–L23）与 **A-28 台账自审**，把“文档里出现的每个数字”绑定到相位、命令与推导，`scope_assertions=0` 成为可判定量 | §1.6.4、§6.9、R-07、A-13、A-28、§A.7.1、§A.7.8 |
| 2 | **§A.3 的 145 判据不可达** | A.3 的 PH-F 行写的是联合模式 `from "@/(utils\|modules)`（注释却要求“facade 调用面应保持 145”）。该联合模式在 B0 实测为 **226**、在 F 会更大（`@/modules/...` 深路径全部命中），**与 145 无关** → 期望值不可达；同时深路径一行的 `246` 在 F 也不成立（迁移 + `app.ts` 装配 7 个入口 → **252**） | 把 A.3 拆成**四个各自可达**的判据：① facade：`from "@/utils"`（精确收尾引号），**B0 = F = 145**（R-06 冻结调用面），并给出分解 `145 = 144（非 agent）+ 1（agent/mentionFiles.ts:3）`；② 深路径 B0：`@/utils/<域>` = **246**，给出六段分解 `50 + 62 + 103 + 30 + 1`；③ 深路径 F：`@/modules/<模块>/<域>` = **252**，给出逐段推导（`app.ts` −1 静态 `initializePlugins` +7 入口装配）；④ `@/utils/` 深路径归零（带 `scope_min=263`）。**联合模式只用于“期望 0”的边判据**（A-14/A-15/A-17），不再用于计数判据 | §A.3、§1.6.5、A-27、L08–L11 |
| 3 | **A-07 引用的 21 前缀清单缺失** | A-07 写“并集 = 21 个 `/api/*`”，引用指向 **§3.4（归属差异表）**，而 §3.4 里没有前缀清单；R-01、R-10/A-20 同样只写“21 个” | 新增 **§3.6 21 个 `/api/*` 前缀清单**：逐前缀给出 **归属模块 / 路由文件数 / 端点数 / 首端点**，并附**生成脚本 §A.14**（机械从 `routes/**` 推出，不靠手写维护）；A-07 的判据改为“入口 `routePrefixes` 并集 == §A.14 输出集合（21 项）且两两无交集”；§3.4 的引用全部改指 §3.6；另区分 `/api/mcp`（mcpIntegration 的路由前缀）与 `/mcp`（MCP 网关挂载点，非 `/api` 前缀） | §3.6、§A.14、R-01、R-05、R-10、A-07、A-20 |

### 0.2 本轮自查发现（非打回意见，但直接影响可测性，一并纠正）

| # | 位置 | v4 写法 | 实测 / 纠正 | 复现命令 |
| --- | --- | --- | --- | --- |
| S1 | R-04 验收第 3 条 | `grep -rn 'from "@/utils/' apps/server/src … = 0`；括号内写 **`scope_files ≥ 500`（全量 `src/**`）** | `apps/server/src/**/*.ts` 实测 **263** 个（不是 500+）。`≥500` 是**恒假守卫**，会把这条真正重要的判据永久钉成 FAIL。改为 **`scope_min = 263`（B0）/ `= 272`（F：263 + L2 的 9 个新文件，且无删除）**，并纳入 §6.9 台账 L14 | `find apps/server/src -name '*.ts' \| wc -l` → `263`（= 234 非 agent + 29 agent）；`find apps/server/src/agent -name '*.ts' \| wc -l` → `29` |
| S2 | §1.1 / §1.2 | 只登记了“地图详细快照 228 / 13,955 与 HEAD 237 / 14,349 的差”，未登记**地图 health 的 28 / 73 计数器与本版可执行口径 23 / 71 的差异** | 地图 `c-arch-1` 与 `c-server-api-2` 写 “agent→server 73 处、server→agent 28 处”；本版可执行口径为 **agent→server 71 行（`@/utils` 51 + `@/lib\|@/types` 20）**、**server→agent 23 行（静态 `from "@/agent` 且排除 `src/agent/`）**。差异 2 / 5 属地图口径（其聚合方式不可复现）；**验收一律以 §A.4 可复现口径为准**，地图数字只作问题来源引用。已写入 §1.2 对账表 | `grep -rn 'from "@/utils' apps/server/src/agent --include='*.ts' \| wc -l` → 51；`grep -rn 'from "@/lib\|from "@/types' apps/server/src/agent --include='*.ts' \| wc -l` → 20；`grep -rn 'from "@/agent' apps/server/src --include='*.ts' \| grep -v '^apps/server/src/agent/' \| wc -l` → 23 |
| S3 | §A.7.8 判据对照表 | `a2 → scope 60` | 与 §0.1#1 同源残留；改为 `scope 42（scope_min 41）` | 见 §A.7.1 |
| S4 | §1.1 / §A.2 / §3.2 / §3.6 / A-11 | 注册端点 **187**（GET 67 / POST 79 / PUT 20 / DELETE 11 / ALL 8 / PATCH 2），沿用自地图 `health` 与第 1–4 版 | **实测 162**（POST 79 / GET 51 / PUT 20 / DELETE 10 / PATCH 2 / **ALL 0**）。差值 25 全部是**误报**：`Promise.all(` 8 处、非路由的 `.get(`（如 `conf.get`、`params.get`）16 处、非路由的 `.delete(` 1 处被朴素 grep 计成端点；**现网没有任何 `Router().all(` 注册**。本版把 A.2 改为**锚定式**提取（前缀 `Router().` / `router.` / `app.`），162 已写入 §1.1、§3.2、§3.6、§6.9（L04/L20）、A-11、A-20；187 仅作为“地图/旧口径”出现在 §1.2(c) | 见 §A.2 的两条命令（锚定式提取 + 逐文件交叉校验） |

### 0.3 与第 4 版的关键差异

| 项 | 第 4 版 | 第 5 版 |
| --- | --- | --- |
| `scope_files` 的地位 | 被当作判据断言（多处写死 41/60/32/7/1/4），与 L2 新增冲突 | **观测值**：只输出 + `scope_min` 下界守卫；文档给出**预测值**与**推导**，不作为 PASS/FAIL 条件（§1.6.4） |
| A.3 计数判据 | PH-F 用联合模式却要求 145（不可达） | 拆为 facade 145（两相）+ 深路径 246（B0）/ 252（F，逐段推导）+ `@/utils/` 归零（`scope_min=263`） |
| 21 前缀清单 | 不存在（A-07 悬空引用 §3.4） | **§3.6 清单 + §A.14 生成脚本**，A-07/A-20 判据可机械执行 |
| 数值治理 | 只有 A-27 文档自审（扫说明符/phase） | +**§6.9 数值台账 L01–L23** + **A-28 台账自审**（`unreachable=0`、`scope_assertions=0`） |
| 深路径计数口径 | 未声明 `import` 与 `export … from` 的差别 | §1.6.5 明确：**计数判据（A.3）计 `import`+`export … from`；边计数（A.11）只计 `import`**，两者不可混用 |
| 验收项 | A-01～A-27 | **A-01～A-28**（+A-28 数值台账自审） |
| 决策点 | Q1–Q11 | Q1–Q11（Q11 扩展为“说明符形态 + 计数口径”双冻结） |
| 本轮实测证据 | 无独立章节 | **§0.5**（在 B0 上真实执行 14 组命令并贴出输出摘要） |

### 0.4 覆盖度 / 可测性 / 无歧义自检

| 维度 | 本版怎么保证 | 可核对位置 |
| --- | --- | --- |
| **覆盖度** | 第 4 轮 3 条打回 + 自查 3 处 → §0.1/§0.2 逐条落到 R/A/§/Q；来源侧 `c-server-api-1`、`c-arch-1`、`c-arch-2`、AGENTS 约束、地图 228 滞后、file SCC、20 条边、21 前缀 → 全部映射 | §0.1、§0.2、附录 E |
| **可测性** | 28 条二值验收（A-01～A-28），每条含 **Phase / 命令或产物 / 期望 / 证据位置**；`scope_files` 改为观测值 + `scope_min`；所有期望 >0 的判据均有 B0 可达性证明；§6.9 台账把每个数字绑定到命令/推导 | §6.5、§6.9、§6.7、附录 A |
| **无歧义** | 术语表 §1.5；SPEC 映射 §1.6.2（逐目录 old→new）；计数口径 §1.6.5；21 前缀 §3.6；阻塞性/错误语义两列（R-03、§6.8）；Q1–Q11 全有默认值；E10 有反向计数；E11/E12 完整模板 | §1.5、§1.6、§3.6、§6.8、§8.4、§10 |

### 0.5 本轮实测证据（B0 = `d084136`，2026-10-26 22:40–22:52 执行）

> 目的：证明“文档里的每个基线数字都是在当前 HEAD 上跑出来的”，并且证明本轮修正后的期望值**可达**。输出为摘要，完整日志在 M0（实施前由评审复跑）。

| # | 命令（摘要） | 实测输出 | 对应断言 |
| --- | --- | --- | --- |
| E1 | §A.1 审计脚本 | `237 14349` | L01、L02 |
| E2 | `find apps/server/src/routes -name '*.ts' \| wc -l` | `161` | L03 |
| E3 | §A.2 锚定式提取（`Router()\.` / `router\.` / `app\.` 前缀） | `POST 79 / GET 51 / PUT 20 / DELETE 10 / PATCH 2 / ALL 0 = 162`（朴素 grep 会得 187，含 `Promise.all(`/`conf.get(` 误报，见 §0.2 S4） | L04 |
| E4 | `grep -c 'app.use' router.ts`、`wc -l router.ts app.ts utils.ts` | `161`、`327`、`160`、`75` | L05、L06、L07 |
| E5 | `grep -rl 'from "@/utils"' apps/server/src --include='*.ts' \| wc -l` | `145`（`routes/` 内 144） | L08 |
| E6 | 同上，限定 `apps/server/src/agent` | `1`（`agent/mentionFiles.ts:3`）→ `145 = 144 + 1` | L08 |
| E7 | `grep -rho 'from "@/utils/[a-zA-Z]*' … \| wc -l`，按目录分段 | `246 = agent 50 + routes 62 + utils 103 + utils.ts 30 + app.ts 1` | L10 |
| E8 | `find apps/server/src -name '*.ts' \| wc -l` | `263`（= 234 非 agent + 29 `src/agent`；`apps/server/scripts` 的 3 个不在 `src/` 内） | L14 |
| E9 | §A.7.1 `edge_check a1` | `check=a1 phase=B0 expect=4 scope_files=41 hits=4 verdict=PASS` | L15 |
| E10 | §A.7.2–A.7.5 `edge_check b1/b2/c1/c2/c3/d1/d2/e1/e2` | `b1 6/1 PASS`、`b2 32/0 PASS`、`c1..c3 7/1 PASS`、`d1 1/2 PASS`、`d2 4/4 PASS`、`e1/e2 1/1 PASS` | L16 |
| E11 | §A.6 SCC 脚本 | `files= 237 scc_count= 2`（size 15 / size 2，成员与 §2.4 一致） | L17 |
| E12 | §A.11 边复算脚本 | `unowned_files= 0`；20 条域间边与 §2.4 逐行一致；`agentAccess→agent 8`、`bootstrap→agent 5`、`assetLibrary→agent 3`、`platformCore→agent 3`、`mcpIntegration→agent 2`、`localRuntime→agent 1`、`pluginMarket→agent 1`（合计 23） | L12、L18 |
| E13 | `package.json` exports + 仓库 grep | `14 exports / 36 文件 / 57 引用` | L19 |
| E14 | §A.14 前缀脚本 | `21` 个前缀，文件/端点合计 `161 / 162` | L20 |

> 结论：**v4 的 3 处被打回问题 + 本版自查 3 处，全部有实测或推导支撑**；本版新增/改正的期望值（145、246、252、41/42、263/272、21 项清单）均已在上表或 §6.9 给出复现路径。

---

## 1. 背景

### 1.1 现状量化（HEAD = d084136，2026-10-26 22:52 复算）

| 指标 | 实测值 | 核验方式 |
| --- | --- | --- |
| server-api 文件 / 行数 | **237 文件 / 14,349 行** | 附录 A.1 glob（含 `apps/server/scripts/**`，排除 `src/agent/**`） |
| `apps/server/src/**` 全部 `.ts` | **263**（= 234 非 agent + 29 `src/agent`） | `find apps/server/src -name '*.ts'` |
| 路由文件 | **161** | `find apps/server/src/routes -name '*.ts' \| wc -l` |
| 注册端点 | **162**（POST 79 / GET 51 / PUT 20 / DELETE 10 / PATCH 2 / ALL 0；161 个路由文件中 `assets/usage.ts` 注册 2 个，其余各 1 个） | 附录 A.2（**锚定式**提取，见 §0.2 S4） |
| `/api/*` 前缀 | **21**（另有 `/mcp`、`/a2a` 两个非 `/api` 挂载点） | §3.6、附录 A.14 |
| `router.ts` | **327 行 / 161 条 `app.use`** | `wc -l`、`grep -c 'app.use'` |
| `app.ts` | **160 行**（初始化、哈希、预热、刷新、MCP/A2A、静态、错误、移动互联混写） | `wc -l` |
| `utils.ts` | **75 行 / 37 个出口 / 5 个来自 `@/agent`** | 读文件逐 key 计数 |
| `import u from "@/utils"` | **145 个文件 = 144（非 agent）+ 1（`src/agent/mentionFiles.ts:3`）**；其中 **144/161 个路由文件** | 附录 A.3 |
| 深路径 `from "@/utils/<域>/…"` | **246 处 = agent 50 + routes 62 + utils 103 + `utils.ts` 30 + `app.ts` 1** | 附录 A.3 |
| server → agent（静态 `from "@/"`） | **23 行** = agentAccess 8 + bootstrap(`utils.ts`) 5 + platformCore 3 + assetLibrary 3 + mcpIntegration 2 + pluginMarket 1 + localRuntime 1 | 附录 A.4 |
| agent → server | `@/utils` **51 行**；`@/lib\|@/types` **20 行**（合计 **71**） | 附录 A.4 |
| `@toonflow/server/*` 外部契约 | **14 export / 36 文件 / 57 处引用**；其中 **5 个 export 的 target 落在 `src/utils/**` 或 `src/remoteConnection.ts`**（`./mcp`、`./mobileLink`、`./browser`、`./singleAgent/types`、`./remoteConnection`），键名必须逐字保持 | 附录 A.5 + `apps/server/package.json` |
| 地图详细快照 | **228 文件 / 13,955 行**（滞后） | `modules/server-api.json` 的 `parent.files_snapshot` |
| 地图顶层声明 | **237 文件 / 14,349 行**；`health.score = 50` | `map.json` |
| file 级 SCC（B0） | **2 个**：`size=15`（跨模块，见 §2.4）、`size=2`（`utils/mcp/dxt.ts ↔ utils/mcp/servers.ts`） | 附录 A.6（实测 `files=237 scc_count=2`） |
| 模块级直接边（B0） | **20 条域间边**（§2.4；另有 7 条 bootstrap→模块边 35 行、7 条模块→bootstrap facade 边 144 行） | 附录 A.11 |
| 子模块内最大文件 | `utils/assets/library.ts` 729 行、`utils/media/provider.ts` 498 行、`utils/plugins/install.ts` 450 行 | `wc -l` |

> 注：`apps/server/src/**` 的 263 与“237”不是同一口径——237 是 §A.1 的模块 glob（含 `scripts/**`，排除 `src/agent/**`）；263 = 234（`src/**` 非 agent）+ 29（`src/agent`）。R-04 的 `scope_min` 使用 263/272（全量 `src/**`，含 agent），因此不与 237 冲突。

### 1.2 三处对账（地图快照 vs HEAD；地图计数器 vs 可执行口径；端点口径）

**(a) 地图详细快照 228 / 13,955 与 HEAD 237 / 14,349**：差额是 **9 个 HEAD 已存在、快照未收录的文件（394 行）**，另有 2 处语义归属差异（`utils/documents.ts` → mediaGeneration、`utils/fileHttp.ts` → platformCore）。

| # | 滞后文件 | 行数 | 本版归属 |
| --- | --- | --- | --- |
| 1 | `src/routes/agent/compact.ts` | 24 | agentAccess |
| 2 | `src/routes/agent/fork.ts` | 15 | agentAccess |
| 3 | `src/routes/agent/rewind.ts` | 15 | agentAccess |
| 4 | `src/routes/ai/generate/stop.ts` | 17 | mediaGeneration |
| 5 | `src/routes/sessionState/get.ts` | 12 | agentAccess |
| 6 | `src/routes/sessionState/patch.ts` | 17 | agentAccess |
| 7 | `src/routes/workspaces/files/thumb.ts` | 37 | localRuntime |
| 8 | `src/utils/ai/runs.ts` | 52 | mediaGeneration |
| 9 | `src/utils/sessionState/index.ts` | 205 | agentAccess |
| — | **合计** | **394** | — |

对账等式：`228 + 9 = 237`；`13,955 + 394 = 14,349`。交付态另算：`237 + 9（L2）= 246`（§3.3）。

**(b) 地图 health 的 28 / 73 与本版口径 23 / 71（本版新增登记）**：

| 计数 | 地图（`c-arch-1`、`c-server-api-2`） | 本版可执行口径 | 复现命令 | 处理 |
| --- | --- | --- | --- | --- |
| server → agent | 28 处 | **23 行**（静态 `from "@/agent…"`，排除 `src/agent/`） | 附录 A.4 第 1 条 | 验收用 23；**不改写地图**，在 §A.22 重算时由评审决定是否回写 |
| agent → server | 73 处 | **71 行**（`@/utils` 51 + `@/lib\|@/types` 20） | 附录 A.4 第 2/3 条 | 同上 |

> 说明：两套数字不可混用。本版所有验收（A-12、A-13、A-18）只使用可执行口径；地图数字仅用于“问题来源”与“整改前后对比”的叙述。

**(c) 注册端点 187（地图/旧口径）与实测 162（本版新增登记，见 §0.2 S4）**：

| 计数 | 地图 / 旧口径 | 本版实测（锚定式） | 差异构成 | 复现 |
| --- | --- | --- | --- | --- |
| 注册端点 | 187（GET 67 / POST 79 / PUT 20 / DELETE 11 / ALL 8 / PATCH 2） | **162**（POST 79 / GET 51 / PUT 20 / DELETE 10 / PATCH 2 / ALL 0） | 25 = `Promise.all(` 8 + 非路由 `.get(` 16 + 非路由 `.delete(` 1 | §A.2 |
| 路由文件 | 161 | **161** | 无 | §A.2 |

> 影响面：R-10 的 M0 冻结清单、A-11/A-20 的 diff 判据、§3.6 的逐前缀计数、§6.9 的 L04/L20 全部改为 162。**行为不变性要求不受影响**（端点集合仍然逐条 diff，只是分母从误报的 187 修正为真实的 162）。


### 1.3 问题陈述（5 个可独立验证的根因）

- **P1｜边界只存在于目录名，没有模块契约对象。** 21 个 `/api/*` 路由目录（§3.6）、15 个 `utils/*` 子域在语义上已分域，但没有“模块入口”声明（职责、路由前缀、初始化钩子、对外导出、依赖清单），地图只能把 237 个文件登记为 1 个模块。
- **P2｜组合根承担业务初始化。** `createApp` 内联 6 类插件目录初始化与内置清单扫描、供应商源码哈希、缩略图预热、模型刷新、MCP/A2A 网关挂载、移动互联运行时初始化；`app.locals.builtinPlugins` 由组合根生产，5 组路由消费。
- **P3｜全局聚合入口锁死编译期依赖闭包。** `utils.ts` 把 37 个 namespace（含 5 个 `@/agent`）聚合成单对象，145 个文件直接依赖。
- **P4｜跨域调用隐式且方向混乱。** 素材库 3 处 + 工作区 1 处 import `@/agent/mentionSources`；插件安装内核被 MCP/团队复用；`conf` 与 `teams`/`mobileLink` 构成类型/值混合环；`dxt ↔ servers` 构成模块内运行期环。
- **P5｜路由装配是 161 条扁平挂载。** `router.ts` 327 行、无分组常量；移动任一接口整文件重写，评审 diff 与并行开发冲突成本高。

### 1.4 约束（来自 `AGENTS.md`，直接决定难度与风险）

| 约束 | 出处 | 对本需求的影响 |
| --- | --- | --- |
| **一个接口一个文件**，`routes/**/*.ts` 全量扫描，URL 由文件相对路径决定（`src/core.ts` 的 `fileNameToRoutePath`） | AGENTS「目录结构」「路由与路径规则」 | 目录重组会直接改变 URL；方案 B 保持 `routes/` 位置不动 |
| **通用工具统一 `import u from "@/utils"`** | AGENTS「引用与代码风格」 | `utils.ts` 只能做薄 facade（R-06），145 个调用面本轮不改 |
| **不为简单接口额外搭 controller / service / repository** | AGENTS「目录结构」 | 子模块只能是“路由 + 域工具 + 模块入口”，不得引入分层样板 |
| **禁止新增测试/自检代码** | AGENTS「测试与检查边界」 | 回归靠 `typecheck` + `build` + 端点清单 diff + 手工 HTTP 冒烟；**判据脚本不提交到仓库**，只在证据日志中以 heredoc 执行（§6.7.5） |
| `app.ts` 不监听端口、不建 worker；桌面/移动复用 `@toonflow/server/app` | AGENTS「技术栈与职责」 | `createApp` 签名与 `@toonflow/server/*` exports 必须保持兼容 |
| 文件/目录小驼峰、双引号、分号、两空格 | AGENTS 通用规范 | 新模块目录使用 `assetLibrary` / `mediaGeneration` 等小驼峰 |
| 导入使用 `@/` alias（`apps/server/tsconfig.json` 的 `paths: {"@/*": ["./src/*"]}`，对 `modules/**` 自动生效） | 现状实测 | R-04 迁移**只替换说明符前缀**，不改导入形态（Q11） |

### 1.5 术语与计数口径（消除歧义的第一道闸）

| 术语 | 定义 | 本矩阵中的使用 |
| --- | --- | --- |
| **B0 基线** | `git HEAD = d084136` 时 `apps/server` 的 237 文件 / 14,349 行 / 161 路由文件 / 162 端点 | 所有“不新增/不变”判据的对照 |
| **PH-B0（基线相）** | 在 `d084136` 快照上执行的判据；说明符一律为迁移前形态 `@/utils/<域>`；用途：冻结基线、证明期望可达 | §1.6.1、附录 A.7 |
| **PH-F（交付相）** | 在实施后工作树上执行的判据；说明符为 `@/modules/<模块>/<域>`；用途：判定“归零/计数”是否达成 | §1.6.1、附录 A.7 |
| **联合模式（union pattern）** | 同时匹配两相说明符的正则（grep `-E`，`|` 不需要转义），例：`from "@/(utils/plugins\|modules/pluginMarket/plugins)` | **只用于“期望 0”的边判据**（§1.6.4） |
| **L1 存量台账** | B0 的 237 个文件逐一归属到 8 个模块；每文件恰好一次 | `237/237`、`unassigned=0`、`duplicated=0` |
| **L2 新增台账** | 相对 B0 **净新建**的文件；本版固定 9 个 | `new_total=9`；移动/重命名不算新增 |
| **L3 交付台账** | B0 ∪ L2，按模块汇总；每文件恰好一次 | `final_total=246`；`246 = 237 + 9` |
| **业务实现文件** | B0 的 237 个文件（含既有 `index.ts` 与路由文件） | 单模块 ≤50 |
| **契约/装配文件** | L2 的 9 个新文件 | 计入“含契约 ≤55 文件 / ≤3,300 行”，不计入业务 ≤50 |
| **移动** | 同一文件从旧路径到新路径，文件数与行数不变 | 不改变 L1/L2/L3 计数；必须登记 old→new 映射 |
| **直接边** | 深路径 import（`@/utils/<域>`、`@/lib`、`@/types`），**排除** `from "@/utils"` facade 边与 `@/agent` | R-07 / E10 / 白名单的统计对象 |
| **Facade 边** | `from "@/utils"`（聚合入口 `u`） | 归 bootstrap；E12 管理 |
| **type / value 边** | `import type { X }` 或 `import { type X }` 为 type；其余为 value | 逐条标注，禁止混淆 |
| **阻塞性** | `await`（阻断后续初始化）/ `void`（不阻断）/ 同步注册 | R-03 第 5 列；A-26 校对 |
| **错误语义** | `抛出`（createApp reject）/ `静默吞错`（空 catch，不打印）/ `warn`（打印警告后 resolve）/ `容错`（特定 errno 转默认值） | R-03 第 6 列、§6.8；A-25/A-26 校对 |
| **`scope_files`（观测值）** | `edge_check` 在有界目录内数到的 `.ts` 文件数；**只输出，不作断言** | §1.6.4 |
| **`scope_min`（守卫下界）** | 该判据扫描范围的 B0 实测文件数；`scope_files < scope_min` → FAIL | §1.6.4、§A.7.0 |
| **计数 0** | 指定命令在 `scope_files ≥ scope_min ≥ 1` 的前提下输出行数为 0 | 不得在空搜索上报 0（§6.7） |
| **diff 为空** | 按 §6.6 归一化后字符串完全相等 | 冒烟判据 |

### 1.6 判据工程：分期、归一化、守卫与“数值不得悬空”

> 本节是第 3/4 轮打回（假通过、不可达、scope 断言化）的**唯一口径来源**。

#### 1.6.1 两相定义

| 相 | 执行环境 | 说明符形态 | 允许的判据类型 | 禁止 |
| --- | --- | --- | --- | --- |
| **PH-B0** | `git show d084136` 快照（或用 `git stash`/独立 worktree 检出） | `@/utils/<域>/...` | ① 冻结基线；② 期望 >0 的**可达性试跑**；③ 迁移前计数复核 | 用 PH-B0 结果判定“已消除” |
| **PH-F** | 实施后工作树（最终交付态） | `@/modules/<模块>/<域>/...` | ① 归零判定；② 计数上限判定；③ SCC / 台账审计 | 在 PH-F 使用**裸 B0 说明符**作为唯一 pattern（会被 §A.12 判 FAIL） |

#### 1.6.2 SPEC 映射（R-04 迁移的说明符与路径 old→new，判据必须逐项使用）

| B0 路径 / 说明符 | PH-F 路径 / 说明符 | 归属模块 |
| --- | --- | --- |
| `src/utils/assets/**` / `@/utils/assets` | `src/modules/assetLibrary/assets/**` / `@/modules/assetLibrary/assets` | assetLibrary |
| `src/utils/ai/**` / `@/utils/ai` | `src/modules/mediaGeneration/ai/**` / `@/modules/mediaGeneration/ai` | mediaGeneration |
| `src/utils/media/**` / `@/utils/media` | `src/modules/mediaGeneration/media/**` / `@/modules/mediaGeneration/media` | mediaGeneration |
| `src/utils/ffmpeg/**` / `@/utils/ffmpeg` | `src/modules/mediaGeneration/ffmpeg/**` / `@/modules/mediaGeneration/ffmpeg` | mediaGeneration |
| `src/utils/documents.ts` / `@/utils/documents` | `src/modules/mediaGeneration/documents.ts` / `@/modules/mediaGeneration/documents` | mediaGeneration |
| `src/utils/plugins/**` / `@/utils/plugins` | `src/modules/pluginMarket/plugins/**` / `@/modules/pluginMarket/plugins` | pluginMarket |
| `src/utils/skills/**` / `@/utils/skills` | `src/modules/pluginMarket/skills/**` / `@/modules/pluginMarket/skills` | pluginMarket |
| `src/utils/teams/**` / `@/utils/teams` | `src/modules/pluginMarket/teams/**` / `@/modules/pluginMarket/teams` | pluginMarket |
| `src/utils/mcp/**` / `@/utils/mcp` | `src/modules/mcpIntegration/mcp/**` / `@/modules/mcpIntegration/mcp` | mcpIntegration |
| `src/utils/workspace/**` / `@/utils/workspace` | `src/modules/localRuntime/workspace/**` / `@/modules/localRuntime/workspace` | localRuntime |
| `src/utils/desktop/**` / `@/utils/desktop` | `src/modules/localRuntime/desktop/**` / `@/modules/localRuntime/desktop` | localRuntime |
| `src/utils/mobileLink/**` / `@/utils/mobileLink` | `src/modules/localRuntime/mobileLink/**` / `@/modules/localRuntime/mobileLink` | localRuntime |
| `src/utils/exec.ts` / `@/utils/exec` | `src/modules/localRuntime/exec.ts` / `@/modules/localRuntime/exec` | localRuntime |
| `src/remoteConnection.ts` / `@/remoteConnection` | `src/modules/localRuntime/remoteConnection.ts` / `@/modules/localRuntime/remoteConnection` | localRuntime |
| `src/utils/singleAgent/**` / `@/utils/singleAgent` | `src/modules/agentAccess/singleAgent/**` / `@/modules/agentAccess/singleAgent` | agentAccess |
| `src/utils/sessionState/**` / `@/utils/sessionState` | `src/modules/agentAccess/sessionState/**` / `@/modules/agentAccess/sessionState` | agentAccess |
| `src/utils/browser/**` / `@/utils/browser` | `src/modules/agentAccess/browser/**` / `@/modules/agentAccess/browser` | agentAccess |
| `src/utils/conf/**` / `@/utils/conf` | `src/modules/platformCore/conf/**` / `@/modules/platformCore/conf` | platformCore |
| `src/utils/monitor.ts`、`personalization.ts`、`fileHttp.ts` | `src/modules/platformCore/{monitor,personalization,fileHttp}.ts` | platformCore |
| `src/lib/**`、`src/types/**`、`src/routes/**`、`src/app.ts` 等 bootstrap 文件 | **不移动**（同路径） | platformCore / bootstrap / 各域 |
| `@/agent/**` | **不移动**（不属于 server-api）；但其 `@/utils/<域>` 说明符**必须按本表迁移**（50 行，见 §1.1） | agent |

> **说明符形态冻结（Q11 默认）**：迁移**只做前缀替换**，`@/utils/mcp/servers` → `@/modules/mcpIntegration/mcp/servers`，**禁止改成相对路径** `./servers`。理由：① 现状 `utils/mcp` 目录内相对 import 实测为 **0**；② 边矩阵（A–D、E11）与依赖白名单全部以 alias 说明符为判据。判据：A-17 的 `e5` 子项。
> **例外（L2 新文件）**：7 个模块入口对**自家域内**文件必须使用相对路径（`./assets/thumb`、`./plugins/install`），跨模块才用 alias。判据：A-28 的 `l2_relative` 子项 + A-15 的 `c9`。

#### 1.6.3 三条守卫（0 命中判据不得空转，>0 期望不得不可达）

| 守卫 | 规则 | 违反时的判定 | 适用 |
| --- | --- | --- | --- |
| **G-EXIST** | 命令涉及的目标路径必须先用 `[ -e <path> ]` 检查；任一不存在 → **FAIL（path_missing）** | 路径缺失 = 判据未执行 = FAIL | 全部 grep 判据 |
| **G-MATCH** | 期望 0 时，必须同时输出 `scope_files`，且 `scope_files ≥ scope_min ≥ 1` → 否则 **FAIL（vacuous_zero）** | 空搜索 = FAIL | 期望 0 的判据 |
| **G-POS** | 期望 N>0 时必须给出可达性证明：① **B0 可复现的判据** → 附 PH-B0 同形态试跑；② **只在交付态存在的判据**（指向新入口/新符号）→ 证明“目标符号在目标文件中存在”（`b5s`/`c7s`） | ① 无 B0 试跑 = FAIL；② 无可达性证明 = FAIL（reachability_miss） | 全部期望 >0 的判据 |
| **G-SCOPE（本版新增）** | `scope_files` **不得**出现在判据的“期望”里；它只输出。文档若把某个文件数写成判定条件 → 视为 `scope_assertion`，A-28 判 FAIL | 把观测值当断言 = FAIL | 全部判据与 §6.9 台账 |

**统一证据行格式（M3/M6 证据日志必须逐字采用）：**

```text
check=<label> phase=<B0|F> expect=<n> scope_files=<n> scope_min=<n> hits=<n> verdict=<PASS|FAIL>
```

#### 1.6.4 `scope_files` 观测化（本轮结构修复，直接消解打回 #1）

**规则**

1. 有界目录扫描的判据一律写成：`expect=<hits>` + `scope_min=<B0 实测文件数>`；`edge_check` 的 PASS 条件是 `G-EXIST ∧ hits==expect ∧ scope_files ≥ scope_min`。
2. 文档可以给出 **`scope_pred`（预测值）** 与推导（例如 a2 的 42 = 9 + 1 + 18 + 14），但 `scope_pred` **不参与判定**。这样 L2 入口文件落进扫描目录（41→42）**不会**让判据失效，而“丢文件”（42→40）仍会被 `scope_min` 抓住。
3. 每个 `scope_min` 必须登记在 §6.9 台账（`L15`/`L16`），并有 B0 复现命令。
4. `scope_min` 只允许取 B0 实测值；若某判据的扫描范围在 B0 不存在（如指向新入口），则 `scope_min=0` 且**必须**改为“符号存在性”检查（G-POS ②）。

**为什么这是结构修复**：`scope_files` 与 `hits` 混为一谈时，任何“扫描目录里多了一个新文件”都会让期望值失效（本轮打回 #1 正是如此）。观测化之后，“文件数变化”与“判据有效性”彻底解耦。

#### 1.6.5 计数对象（`import` vs `export … from`）

| 判据 | 计数对象 | 原因 |
| --- | --- | --- |
| **A.3 深路径计数（246 / 252）** | `from "…"` 出现行数，**含 `import` 与 `export … from`** | 衡量“说明符迁移是否彻底” |
| **A.11 模块边计数（20 条）** | 仅 `^\s*import … from` | 衡量“编译期依赖边”，re-export 不构成新边 |
| **A.4 环的两端（23 / 19 / 51 / 20）** | 仅 `import`（`grep 'from "@/agent'` 天然只命中 import；facade/deep 用同一 `from` 口径） | 与地图/评审沟通口径统一为“import 行” |
| **A.6 file SCC** | 解析式（`import`/`export … from` 都建边） | 环判定必须包含 re-export |

> 正因为 A.3 与 A.11 口径不同，R-07D 的“2 条 type 边消除 + 2 行 re-export 新增”在 A.3 里净额为 0（246→246 的域内部分不变），在 A.11 里表现为 `platformCore→pluginMarket 1→0`。两处结论不冲突（§2.4 与 §A.3 分别标注）。

### 1.7 本轮未改动代码的说明

- 本轮仅新增本文件并更新 `INDEX-2026-10.md`。
- 校验：`git status --porcelain apps/server` 输出为空（M6 前由评审复跑）。
- 说明：仓库内 `apps/web/src/components/settings/panels/mediaModel/providerAgentDialog.vue`、`packages/tools/browser/{browserPanel.vue,host.ts}` 的既有改动来自**另一条并行工作的 bugfix 线**（`.claude/development_docs/liyuhang/4_bugs_fix/bug_*browser-frame-flood-freeze.md`），不属于本需求，也不是本轮产物。

---

## 2. 目标与非目标

### 2.1 目标

- **G1｜模块切开且预算自洽**：`server-api` 由 1 个 237 文件模块拆为 **8 个模块（1 组合根 + 7 应用子模块）**。
  - **L1 存量**：237/237，无孤儿、无重复。
  - **L2 新增**：固定 9 个文件（§3.3），不得有清单外新增。
  - **L3 交付**：246 文件 / ≤14,839 行；`246 = 237 + 9`。
  - **业务实现**：单模块 ≤50 文件；**含契约/装配**：单模块 ≤55 文件 / ≤3,300 行；bootstrap ≤900 行。
- **G2｜组合根瘦身**：`app.ts` 只保留组合根职责（参数归一、全局中间件顺序、模块装配、静态资源、统一错误处理），**≤80 行**，不再出现任何具体插件类型分支、供应商哈希、具体网关构造、移动运行时初始化。
- **G3｜HTTP 契约不变**：162 个端点的方法与路径 **100% 不变**；`@toonflow/server/*` 的 14 个 exports **键名逐字不变**（5 个 target 路径随 SPEC 更新）；`createApp` 签名不变；36 个文件 / 57 处引用可解析。
- **G4｜模块契约可读、依赖边可核对**：每个应用子模块有入口声明（职责、路由前缀、初始化钩子、对外导出、依赖白名单）；入口 `routePrefixes` 并集 = §3.6 的 21 项且两两无交集；模块间直接边计数与 §2.4 基线一致；不承诺模块级 DAG。
- **G5｜无法消除项结构化豁免**：每条未消除项按 §8 模板登记，写明理由、替代缓解、复核触发条件。
- **G6｜判据可执行且不可假通过**：每条验收判据都有 `phase` 标注、路径存在守卫、搜索范围下界；0 命中不得由空搜索得出；期望 >0 必须有可达性证明；文档级自审（§A.12）可机械发现“PH-F 行使用迁移前说明符”的回归。
- **G7｜数值不悬空（本版新增）**：文档中出现的每个数字，要么有 B0 复现命令，要么有到 B0 的推导链，并登记在 §6.9 台账；`scope_files` 一律只观测不断言（§1.6.4）。

### 2.2 非目标（明确排除，避免范围蔓延）

- **NG1｜不做 AgentHost 端口化，不消除运行期双向依赖；但允许并只允许“非编排类工具/类型依赖下沉”。**
  - **不做**：不新建 AgentHost 端口、不改 agent 会话运行时、不消除 19 处运行期/配置类依赖（agentAccess 8、platformCore 3、pluginMarket 1、mcpIntegration 2、`utils.ts` 5）、不消除 `agent → server` 的 71 处反向 import。
  - **做**：把 `MentionQuery` 与 `mentionAssetType` 下沉到 `src/lib/mentionSources.ts`，消除 **assetLibrary 3 处 + localRuntime 1 处** 对 `@/agent` 的 import；`agent/mentionSources.ts` 以相对路径 re-export，保持 `@toonflow/server/agent/mentionSources` 路径不变。
- **NG2**：不抽前端 `contracts` 包、不改 web 的 `/api` 字面量（属 `c-web-console-1`/`c-arch-3`）。
- **NG3**：不把 server 拆成多个 workspace 包（不新增 `packages/app-*`），不做跨包发布。
- **NG4**：不改任何接口行为、响应结构、鉴权语义、数据目录与插件安装语义（含 R-03 的阻塞性/错误语义，见 §6.8）。
- **NG5**：不做 5 组同构插件路由的去重、不拆 `library.ts` / `provider.ts` 巨型文件（另立需求）。
- **NG6**：不新增测试文件、不新增第三方依赖、不引入 controller/service/repository 分层；**判据脚本不落库**（§6.7.5）。

### 2.3 agent 依赖边界表（NG1 与 R-07 的唯一裁决口径）

| 边 | 现状证据 | 计数 | 类型 | 本期处理 | 验收 |
| --- | --- | --- | --- | --- | --- |
| `agentAccess → @/agent` | `utils/singleAgent/index.ts:7-11`、`routes/agent.ts:4,9`、`routes/singleAgent/run.ts:7` | 8 行 | 运行期 | **允许**（核心职责） | 允许 agentAccess 直接 import；不扩散 |
| `utils.ts → @/agent` | `utils.ts` 中 5 个 agent 出口（`:19,20,21,33,35`） | 5 出口 | 运行期 | **允许，E2** | 145 个 `u` 调用面不变 |
| `mcpIntegration → @/agent` | `utils/mcp/tools.ts:8-9` | 2 行 | 运行期 | **允许，E8** | 仅 MCP 工具运行 Agent |
| `platformCore → @/agent` | `utils/conf/index.ts:6`（type）、`routes/settings/save.ts:6`、`routes/settings/systemPrompt.ts:3`（value） | 3 行（1t/2v） | 混合 | **允许，E7** | 不新增第 4 处 |
| `assetLibrary → @/agent` | `utils/assets/index.ts:5`（type）、`library.ts:5`、`thumb.ts:4` | 3 行（1t/2v） | 混合 | **消除**（下沉 `lib/mentionSources.ts`） | A-13 `a2=0` |
| `localRuntime → @/agent` | `routes/workspaces/files/thumb.ts:10` | 1 行 | 运行期 | **消除**（同源下沉） | A-13 `a2=0` |
| `pluginMarket → @/agent` | `routes/agents/a2a/save.ts:8` | 1 行 | 运行期 | **允许，E9** | 仅此 1 处 |
| `mediaGeneration → @/agent` | 无 | 0 | — | 保持 0 | A-11 输出 `mediaGeneration→agent` 行不存在 |

> 结论：server → agent 的 23 行 = **19 行保留（E2/E6/E7/E8/E9）+ 4 行消除（R-07A）**。

### 2.4 模块依赖方向与 SCC 口径

**测量基准：**

1. **直接边**只统计 `import … from` 的深路径说明符（`@/utils/<域>`、`@/lib`、`@/types`），排除 `from "@/utils"` facade 边与 `@/agent`（A.11）。
2. **Facade 边**（145 个文件的 `from "@/utils"`；其中 144 行来自非 agent 模块）归 bootstrap，制造 bootstrap 枢纽环，E12 登记。
3. 方向按**源文件 → 目标文件**记录；同一对模块的双向边分别计数，不合并成“单向”。
4. 计数对象 = `import` 行（A.11）；与 A.3 的 `from` 行计数口径不同（§1.6.5）。

**直接域边基线（20 条；`lines` 为 import 行数，实测见 §0.5 E12）：**

| # | 源 → 目标 | lines | type | value | 反向 lines | 本期分类 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | agentAccess → platformCore | 51 | 1 | 50 | 0 | 强依赖（白名单） |
| 2 | agentAccess → pluginMarket | 1 | 0 | 1 | 0 | **E10** |
| 3 | assetLibrary → localRuntime | 8 | 0 | 8 | 3 | 强依赖（双向白名单） |
| 4 | assetLibrary → mediaGeneration | 1 | 0 | 1 | 0 | **E10** |
| 5 | assetLibrary → platformCore | 24 | 0 | 24 | 0 | 强依赖；R-07A 后 **27**（1t/26v） |
| 6 | localRuntime → assetLibrary | 3 | 0 | 3 | 8 | 强依赖（双向白名单） |
| 7 | localRuntime → mediaGeneration | 1 | 0 | 1 | 4 | **E10** |
| 8 | localRuntime → platformCore | 75 | 1 | 74 | 2 | 强依赖；R-07A 后 **76**（1t/75v） |
| 9 | mcpIntegration → localRuntime | 3 | 0 | 3 | 0 | **E10** |
| 10 | mcpIntegration → mediaGeneration | 1 | 0 | 1 | 0 | **E10** |
| 11 | mcpIntegration → platformCore | 35 | 0 | 35 | 0 | 强依赖（白名单） |
| 12 | mcpIntegration → pluginMarket | 3 | 0 | 3 | 0 | **R-07C**（契约化后仍 3，深路径 0） |
| 13 | mediaGeneration → localRuntime | 4 | 0 | 4 | 1 | 强依赖（双向白名单） |
| 14 | mediaGeneration → platformCore | 63 | 0 | 63 | 1 | 强依赖（白名单） |
| 15 | platformCore → localRuntime | 2 | 1 | 1 | 75 | **R-07D 消 type**；E10 留 1 value |
| 16 | platformCore → mediaGeneration | 1 | 0 | 1 | 63 | **E10**（双向） |
| 17 | platformCore → pluginMarket | 1 | 1 | 0 | 91 | **R-07D 归零**（即 `conf/index.ts:5 → @/utils/teams`） |
| 18 | pluginMarket → localRuntime | 6 | 0 | 6 | 0 | 强依赖（白名单） |
| 19 | pluginMarket → mediaGeneration | 1 | 0 | 1 | 0 | **R-07B**（契约化后仍 1，深路径 0） |
| 20 | pluginMarket → platformCore | 91 | 1 | 90 | 1 | 强依赖（白名单） |

> 独立复算见附录 A.11（脚本输出与本表逐行一致，`unowned_files=0`）。第 17 条的 `1 type` 与第 15 条的 `1 type` 是**同一对文件**的两条边（`conf → teams`、`conf → mobileLink`），R-07D 一次性消除。
> 另有未列入本表的 **7 条 bootstrap → 模块边**（35 行：agentAccess 2、assetLibrary 1、localRuntime 7、mcpIntegration 4、mediaGeneration 8、platformCore 6、pluginMarket 7）与 **7 条模块 → bootstrap facade 边**（144 行）；A-18 的 SCC/白名单审计覆盖这两组，但不计入“20 条域间边”。

**模块级 SCC（直接边，不含 bootstrap）**

| SCC | 成员 | 本期处理 |
| --- | --- | --- |
| SCC-1（5 个域模块） | `assetLibrary`、`localRuntime`、`mediaGeneration`、`platformCore`、`pluginMarket` | **基线事实，不承诺消除**；E12 |
| SCC-2 | `agentAccess` | 单点；无回边 |
| SCC-3 | `mcpIntegration` | 单点；无回边 |
| 含 bootstrap | 8 个模块 | facade 枢纽环；E12 |

**file 级 SCC（15 文件口径，本轮实测复现）**

| 时点 | 数量（size>1） | 成员 | 结论 |
| --- | --- | --- | --- |
| B0 | 2 | ① **15 文件**：`utils/conf/index.ts`、`utils/teams/{index,files,install}.ts`、`utils/mobileLink/index.ts`、`utils/plugins/{install,tools,nodes,ext}.ts`、`utils/skills/files.ts`、`utils/media/provider.ts`、`utils/ffmpeg/index.ts`、`utils/ai/visibility.ts`、`utils/workspace/{index,files}.ts`；② **2 文件**：`utils/mcp/dxt.ts ↔ utils/mcp/servers.ts` | ① 进入该 SCC 的唯一回边是 `conf → teams`、`conf → mobileLink` 两条 **type** 边 |
| R-07D 后（模拟，已实测） | 1 | 仅 `dxt ↔ servers` | 15 文件 SCC 消失；只剩 E11 |
| R-07E 后（Q8 可选） | 0 | — | Δ+1 文件；L2=10 / L3=247 |

> 复现：附录 A.6 脚本（实测 `files= 237 scc_count= 2`，size 15 与 size 2）；加 `--sim` 后输出 `scc_count=1`。

---

## 3. 需求矩阵

### 3.1 需求矩阵总表（背景 / 描述 / 目标 / 优先级 / 难度 / 风险）

| 编号 | 需求（描述） | 背景（来源 + 现状证据） | 目标（可判定产出） | 优先级 | 难度 | 风险 | 关联验收 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **R-01** | 建立 7 个应用子模块入口与统一模块契约 `ServerModule`，每个入口声明职责 / 路由前缀 / 初始化钩子 / 对外导出 / 依赖白名单 | P1；现状无任何模块入口，地图只能把 237 文件登记为 1 模块 | 7 个入口存在、各 ≤60 行、`export default ServerModule`；`routePrefixes` 并集 = **§3.6 的 21 项**且两两无交集；`dependencies` 为附录 C 白名单子集 | P0 | 中 | 中 | A-06、A-07、A-18 |
| **R-02** | `app.ts` 瘦身为组合根：参数归一、中间件 7 项定序、模块装配、静态与错误处理 | P2；`app.ts` 160 行内含 6 类插件初始化、`createHash`、预热、刷新、MCP/A2A 构造、移动互联 | `app.ts` ≤80 行；禁用符号计数=0；7 项中间件行号递增且 `/api/sessionState` 64kb 在全局 100mb 前；`createApp` 签名 diff 为空 | P0 | 中 | 高 | A-08、A-09、A-21 |
| **R-03** | 初始化 15 步归口到模块入口，并把每一步的「阻塞性 / 错误语义 / B0 锚点」固化为可判定表格 | P2；15 步顺序与失败语义混写在 `app.ts:59-158`；第 3 轮打回 #3 指出步骤 5 非阻塞吞错未记录 | 15 步逐行与 R-03 表 7 列一致（含步骤 5 `void` + 静默吞错、步骤 9 `void` + warn、步骤 4/8 ENOENT 容错、步骤 8 锚点在 `express()` 之后）；`app.locals.builtinPlugins` 5 键 `Set<string>`；初始化幂等 | P0 | 中 | **高** | A-10、A-25、A-26 |
| **R-04** | 服务目录模块化：`src/utils/<域>/**` → `src/modules/<模块>/<域>/**`，**只替换说明符前缀、不改导入形态** | P1 + P3；15 个 `utils/*` 子域、246 处深路径（含 agent 侧 50 处） | 7 个模块目录成形；`src/utils/**` 为空（`utils.ts` 除外）；**246 处深路径全部迁移（F=252，见 §A.3）**；`@/utils/` 深路径归零（`scope_min=263`）；14 exports 可用 | P0 | 很高 | 高 | A-01～A-03、A-12、A-19 |
| **R-05** | 路由装配分组（默认 E4：保留 161 条挂载 + 分组注释 + 模块前缀所有权） | P5；`router.ts` 327 行 161 条扁平挂载 | E4：`grep -c 'app.use'`=161、162 端点 diff 为空、模块 `routePrefixes` 与 §3.6 逐项一致；无新增路由文件 | P1 | 高 | 高 | A-07、A-11、A-24 |
| **R-06** | `utils.ts` 改为按模块分组的薄 facade，37 个 key 与 B0 逐 key 一致 | P3；37 出口 / 145 文件引用 / 5 个 agent 出口 | 37 key diff 为空；**145 个调用文件零修改（facade 计数 B0=F=145）**；每个 key 有归属注释；文件 ≤130 行 | P1 | 高 | 高 | A-12、A-22 |
| **R-07** | 跨域依赖边 A–D 的消除与契约化（A 消除 4 处 mentionSources；B/C 显式化公开入口；D 消除 2 条 type 边） | P4；`assets → @/agent/mentionSources` 3 处、`workspaces/files/thumb.ts` 1 处；`plugins/install.ts:11 → media/provider`；`utils/mcp` 3 条深路径；`conf → teams/mobileLink` 2 条 type 边 | A：4 处归零、server→agent 23→19、asset→platform 24→27、local→platform 75→76；B/C：F 相深路径 0、公开入口 import 1/3；D：conf 侧 0、反向 4 不变、platform→plugin 0 | P0 | 高 | 中 | A-13～A-16 |
| **R-07E** | `dxt ↔ servers` 模块内环按 E11 冻结（默认）或按 Q8 消除 | P4；B0 的 2 文件 SCC，R-07D 后唯一残留 | 默认：两文件相互 import 各 1（PH-B0 与 PH-F 分别 1，联合模式在两相均为 1）、SCC `count=1,size=2`；Q8：两命令=0、SCC=0、L2=10/L3=247 | P2 | 低 | 低 | A-17、E11 |
| **R-08** | 宿主装配兼容：`createApp` 签名与 14 个 `@toonflow/server/*` exports 不变（键名逐字不变） | 独立 server / Electrobun 桌面 / Android·OHOS 移动三处调用；桌面在拿到 app 后注入 `app.locals.desktop` | 三宿主可启动；桌面 `/api/desktop/*` 15 端点门禁不变；14 exports / 36 文件 / 57 引用不报错 | P0 | 低 | 中 | A-12、A-21 |
| **R-09** | 规范、地图与包导出同步（`AGENTS.md`、模块清单与地图字段同构、`package.json` exports、`tsconfig` paths） | P1；地图详细快照滞后 228/13,955；5 个 export target 落在 `utils/**`/`remoteConnection.ts` | `AGENTS.md` 与代码一致；地图重算 8 模块 = L3 246 文件 / ≤14,839 行；exports 键集合 diff 为空、无悬空 target | P0 | 低 | 低 | A-22 |
| **R-10** | 回归基线与 13 项逐条冒烟 + S1–S8 补充 + 21 前缀首端点 | P2/P4/P5；行为不可变要求 | M0 冻结 5 份基线；13 项 diff 为空；S1–S8 有记录；**§3.6 的 21 个前缀**各 1 个首端点 status diff 为空 | P0 | 中 | 低 | A-11、A-19、A-20 |
| **R-11** | 无法消除项按 §8 模板登记（E1–E12） | 验收口径要求 | 每条有编号/理由/缓解/触发/责任人/判据；E11/E12 用 §8.4 完整模板；E11 判据两相化 | P0 | 低 | 低 | A-23 |
| **R-12** | 三本账与预算审计（L1 / L2 / L3 + 等式 + 逐模块预算） | 第 2 轮打回 #1；交付态口径歧义 | 输出逐字匹配 §3.3；`new_unregistered=0`；预算全通过 | P0 | 中 | 低 | A-01～A-05 |
| **R-13** | 模块级 SCC 与依赖白名单（不承诺 DAG；E10 7 条弱边冻结） | 第 2 轮打回 #2；`platformCore` 不是叶子 | SCC 审计输出与 §2.4 一致；20 条边计数不超 R-07 后预期；E10 不新增 source→target 对 | P1 | 低 | 中 | A-18 |
| **R-14** | **判据工程：两相 + 归一化 + 四守卫 + 数值台账 + 文档自审** | 第 3 轮打回 #1/#2、第 4 轮打回 #1/#2/#3 | 每条判据有 phase；`stale_specifier_in_PHF=0`、`vacuous_zero=0`、`reachability_miss=0`、**`scope_assertions=0`**、`unreachable=0`；§A.12/§A.13 脚本可机械复现 | **P0** | 中 | 中 | A-27、A-28、§6.7、§6.9、§A.7、§A.12、§A.13 |

> 优先级判定：R-03 / R-07 / R-14 为 **P0**（行为保真 + 判据可信）；R-05 / R-06 为 P1（可延后但影响 G4 可读性）。

### 3.2 子模块清单与预算

| # | 子模块（代码目录 / 地图 id） | 职责 | 存量文件 / 行数 | 端点 / 路由文件 | L2 新增 | L3 交付文件 / 行数上限 | 业务 / 契约 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | `bootstrap` / `bootstrap_wiring` | 组合根、路由表生成、全局聚合出口、模块契约类型 | 8 / 710 | 0 / 0 | 1 契约 | **9 / 750** | 8 业务 / 1 契约 |
| 1 | `assetLibrary` / `asset_library` | 素材库根解析、索引分页、增删改移、回收站、缩略图、用量与变更事件 | 27 / 2,615 | 19 / 18 | 1 入口 | **28 / 2,675** | 27 业务 / 1 契约 |
| 2 | `mediaGeneration` / `ai_media_providers` | LLM 模型与供应商配置、文本生成、媒体模型与生成任务、计费、ffmpeg、文档转 Markdown | 42 / 2,994 | 25 / 25 | 1 入口 | **43 / 3,054** | 42 业务 / 1 契约 |
| 3 | `pluginMarket` / `plugin_ecosystem` | tool/node/ext/skill/agent 五类插件与团队的安装、读取、保存、启停、卸载、排序、导出 | 49 / 2,283 | 39 / 39 | 1 入口 | **50 / 2,343** | 49 业务 / 1 契约 |
| 4 | `mcpIntegration` / `mcp_integration` | MCP 服务器配置、DXT/JSON 导入、对外 MCP 端点、控制通道、技能资源 | 20 / 1,433 | 13 / 13 | 1 入口 | **21 / 1,493** | 20 业务 / 1 契约 |
| 5 | `localRuntime` / `local_runtime` | 工作区文件 CRUD 与越界防护、命令执行、桌面宿主桥、设备配对与远端代理 | 45 / 2,195 | 37 / 37 | 1 入口 | **46 / 2,255** | 45 业务 / 1 契约 |
| 6 | `agentAccess` / `agent_orchestration` | Agent 流式会话、单 Agent 运行与工具回调、浏览器输入输出、会话状态桥接、A2A | 26 / 1,193 | 22 / 22 | 1 入口 | **27 / 1,253** | 26 业务 / 1 契约 |
| 7 | `platformCore` / `http_core` | i18n、字段校验、统一响应/错误、平台能力判定、conf 持久化、文件发送、设置与监控接口 | 20 / 926 | 7 / 7 | 1 入口 + 1 契约 | **22 / 1,016** | 20 业务 / 2 契约 |
| — | **合计** | — | **237 / 14,349** | **162 / 161** | **9** | **246 / ≤14,839** | **237 业务 / 9 契约** |

**对账等式（必须逐项成立）：**

- 文件（L1）：`8 + 27 + 42 + 49 + 20 + 45 + 26 + 20 = 237`
- 文件（L3）：`9 + 28 + 43 + 50 + 21 + 46 + 27 + 22 = 246 = 237 + 9`
- 行数（L3 上限）：`750 + 2,675 + 3,054 + 2,343 + 1,493 + 2,255 + 1,253 + 1,016 = 14,839 = 14,349 + 490`
- 端点：`0 + 19 + 25 + 39 + 13 + 37 + 22 + 7 = 162`（与 §3.6 逐前缀实测合计一致）
- 路由文件：`0 + 18 + 25 + 39 + 13 + 37 + 22 + 7 = 161`（与 §3.6 一致）

> L3 行数的 +490 是 L2 的**行数上限**（7×60 + 40 + 30），不是实际新增行数；实施后实际值必须 ≤490。

### 3.3 三本台账（L1 / L2 / L3）

#### L1 存量归属台账（只回答“B0 的 237 个文件有没有漏/重”）

| 模块 | 存量文件 | 存量行数 | 归属 glob（摘要） |
| --- | --- | --- | --- |
| bootstrap | 8 | 710 | `app.ts`、`index.ts`、`core.ts`、`router.ts`、`utils.ts`、`scripts/**` |
| assetLibrary | 27 | 2,615 | `utils/assets/**`、`routes/assets/**` |
| mediaGeneration | 42 | 2,994 | `utils/ai/**`、`utils/media/**`、`utils/ffmpeg/**`、`utils/documents.ts`、`routes/ai/**`、`routes/providers/**`、`routes/ffmpeg/**` |
| pluginMarket | 49 | 2,283 | `utils/plugins/**`、`utils/skills/**`、`utils/teams/**`、`routes/{tools,nodes,ext,skills,agents,plugins}/**` |
| mcpIntegration | 20 | 1,433 | `utils/mcp/**`、`routes/mcp/**` |
| localRuntime | 45 | 2,195 | `utils/workspace/**`、`utils/desktop/**`、`utils/mobileLink/**`、`utils/exec.ts`、`remoteConnection.ts`、`routes/{workspaces,desktop,exec,mobileLink}/**` |
| agentAccess | 26 | 1,193 | `utils/singleAgent/**`、`utils/sessionState/**`、`utils/browser/**`、`routes/agent.ts`、`routes/{agent,singleAgent,browser,sessionState}/**` |
| platformCore | 20 | 926 | `lib/**`、`utils/conf/**`、`utils/monitor.ts`、`utils/personalization.ts`、`utils/fileHttp.ts`、`types/**`、`routes/{settings,monitor}/**` |
| **合计** | **237** | **14,349** | — |

```text
existing_total=237
existing_assigned=237
existing_unassigned=0
existing_duplicated=0
existing_orphan=0
```

> `237/237` **只表示 L1**（B0 的 237 个文件逐一归属、无孤儿、无重复），**不表示**交付态只有 237 个文件。
> 归属脚本实测：`{agentAccess:26, assetLibrary:27, bootstrap:8, localRuntime:45, mcpIntegration:20, mediaGeneration:42, platformCore:20, pluginMarket:49}` = 237（§0.5 E12 同一脚本的 owner 分派）。

#### L2 新增台账（相对 B0 的净新建，默认 9 个；Q8/Q9 改选时重算）

| # | 新文件 | 归属模块 | 用途 | 行数上限 | 类别 |
| --- | --- | --- | --- | --- | --- |
| 1 | `src/modules/assetLibrary/index.ts` | assetLibrary | 入口契约 + `warmup`（见 R-03 步骤 5 语义约束） | 60 | 契约/装配 |
| 2 | `src/modules/mediaGeneration/index.ts` | mediaGeneration | 入口契约 + providers 初始化/模型刷新 + 公开 `addMediaProvider` | 60 | 契约/装配 |
| 3 | `src/modules/pluginMarket/index.ts` | pluginMarket | 入口契约 + 五类插件初始化/扫描 + 安装/工具内核公开面 | 60 | 契约/装配 |
| 4 | `src/modules/mcpIntegration/index.ts` | mcpIntegration | 入口契约 + `/mcp` 挂载 | 60 | 契约/装配 |
| 5 | `src/modules/localRuntime/index.ts` | localRuntime | 入口契约 + 移动互联初始化 | 60 | 契约/装配 |
| 6 | `src/modules/agentAccess/index.ts` | agentAccess | 入口契约 + `/a2a` 挂载（保持动态 import） | 60 | 契约/装配 |
| 7 | `src/modules/platformCore/index.ts` | platformCore | 入口契约 + 中间件/配置契约导出 | 60 | 契约/装配 |
| 8 | `src/types/module.ts` | bootstrap | `ServerModule` / `ModuleContext`（组合契约，不计域边） | 40 | 契约/装配 |
| 9 | `src/lib/mentionSources.ts` | platformCore | `MentionQuery` + `mentionAssetType` | 30 | 契约/共享 |
| — | **合计** | — | — | **490** | — |

```text
new_total=9
new_unregistered=0
new_line_cap_total=490
```

**L2 硬规则：**

1. 不新增初始化适配文件：`initialize / mount / warmup` 写在 7 个模块入口内；
2. 不新增路由分组文件（R-05 的分组代码写在 `router.ts`/`core.ts` 内）；
3. 不新增模块注册表：`app.ts` 直接 import 7 个入口并用数组字面量装配；
4. 不新增 `mcp/bundle.ts`（默认 E11）；Q8 选消除时才允许 +1（L2=10 / L3=247 / 行数 +30）；
5. **7 个入口对自家域内文件使用相对路径**（§1.6.2 例外条款），跨模块才用 `@/modules/...`；
6. 任何清单外新增、净删除、未登记移动，均判 L2 失败。

#### L3 交付台账（B0 ∪ L2）

| 模块 | 交付文件 | 交付行数上限 | 业务文件 | 契约文件 | 单模块 ≤55 | 单模块 ≤3,300 行 |
| --- | --- | --- | --- | --- | --- | --- |
| bootstrap | 9 | 750 | 8 | 1 | ✅ | ✅（另 ≤900） |
| assetLibrary | 28 | 2,675 | 27 | 1 | ✅ | ✅ |
| mediaGeneration | 43 | 3,054 | 42 | 1 | ✅ | ✅（余量 246） |
| pluginMarket | 50 | 2,343 | 49 | 1 | ✅ | ✅ |
| mcpIntegration | 21 | 1,493 | 20 | 1 | ✅ | ✅ |
| localRuntime | 46 | 2,255 | 45 | 1 | ✅ | ✅ |
| agentAccess | 27 | 1,253 | 26 | 1 | ✅ | ✅ |
| platformCore | 22 | 1,016 | 20 | 2 | ✅ | ✅ |
| **合计** | **246** | **14,839** | **237** | **9** | — | — |

```text
final_total=246
final_assigned=246
final_unassigned=0
final_duplicated=0
final_equals_existing_plus_new=246=237+9
```

### 3.4 归属差异与地图滞后（显式登记，不是漏算）

| 文件 | 行数 | 地图原归属 | 本版归属 | 直接引用点 | 归属理由 |
| --- | --- | --- | --- | --- | --- |
| `src/utils/documents.ts` | 74 | `local_runtime` | **`mediaGeneration`** | `utils/ai/index.ts:14`、`agent/assets.ts:12`、`agent/tools/index.ts:19` | `readDocument` 只依赖 `lib/documentFormats`，是模型读取文档能力，无工作区/宿主语义 |
| `src/utils/fileHttp.ts` | 40 | `local_runtime` | **`platformCore`** | `routes/assets/thumb.ts:3`、`routes/assets/read.ts:2`、`routes/ext/read.ts:5`、`routes/nodes/files.ts:3`、`routes/workspaces/files/thumb.ts:7`、`routes/workspaces/files/read.ts:3` | `sendFile` 是 Express 响应横切工具，被 6 个路由复用 |
| 9 个滞后文件 | 394 | 快照缺失 | 按 §1.2 | — | HEAD 已存在；地图详细快照滞后 |

> 说明：v4 曾把“21 个前缀”挂在 §3.4 下，导致 A-07 引用悬空（第 4 轮打回 #3）。本版前缀清单独立成 **§3.6**。

### 3.5 计数与预算规则

1. **行数**：UTF-8 行数（`wc -l` 等价），不忽略任何行；不生成物。
2. **业务文件**：只计 B0 的 237 个文件；**契约文件**：只计 L2 的 9 个。
3. **边计数**：以 import **行**为单位（一行 `import` 计 1），`import type` 记 type，其余记 value；同一行多符号仍计 1（附录 A.11）。
4. **grep 计数**：一律 `--include='*.ts'`；期望 0 必须附 `scope_files` 且 `≥ scope_min`；期望 >0 必须有 B0 可达性证明（§1.6.3）。
5. **深路径计数对象**：`from "…"` 出现行数（含 `import` 与 `export … from`），见 §1.6.5。
6. **`scope_files` 只观测**：不得写入“期望”；预测值仅作说明（§1.6.4）。

### 3.6 21 个 `/api/*` 前缀清单（A-07 / A-20 / R-10 的权威来源）

> 生成方式：附录 A.14 脚本从 `apps/server/src/routes/**/*.ts` 的**第一段路径**去重得出（`routes/agent.ts` 与 `routes/agent/**` 归并为 `agent`）。文件数、端点数、首端点均由脚本机械输出，M0 归档后与本节逐字比对。
> 首端点定义：该前缀下**按路由文件相对路径字典序**排序，取第一个含 `.get/.post/.put/.patch/.delete/.all` 的文件内**第一个**注册项；URL = `/api` + `fileNameToRoutePath(文件相对路径)` + 该注册项的路径字面量。

| # | `/api/*` 前缀 | 归属模块 | 路由文件 | 端点 | 首端点（脚本输出） |
| --- | --- | --- | --- | --- | --- |
| 1 | `/api/agent` | agentAccess | 13 | 13 | `POST /api/agent` |
| 2 | `/api/agents` | pluginMarket | 9 | 9 | `GET /api/agents/a2a/get` |
| 3 | `/api/ai` | mediaGeneration | 10 | 10 | `POST /api/ai/generate` |
| 4 | `/api/assets` | assetLibrary | 18 | 19 | `GET /api/assets/events` |
| 5 | `/api/browser` | agentAccess | 2 | 2 | `POST /api/browser/input` |
| 6 | `/api/desktop` | localRuntime | 15 | 15 | `POST /api/desktop/clipboard/read` |
| 7 | `/api/exec` | localRuntime | 2 | 2 | `POST /api/exec/cancel` |
| 8 | `/api/ext` | pluginMarket | 6 | 6 | `POST /api/ext/install` |
| 9 | `/api/ffmpeg` | mediaGeneration | 6 | 6 | `POST /api/ffmpeg/cancel` |
| 10 | `/api/mcp` | mcpIntegration | 13 | 13 | `GET /api/mcp/control/events` |
| 11 | `/api/mobileLink` | localRuntime | 6 | 6 | `PUT /api/mobileLink/config` |
| 12 | `/api/monitor` | platformCore | 2 | 2 | `POST /api/monitor/free` |
| 13 | `/api/nodes` | pluginMarket | 6 | 6 | `GET /api/nodes/files` |
| 14 | `/api/plugins` | pluginMarket | 1 | 1 | `GET /api/plugins/export` |
| 15 | `/api/providers` | mediaGeneration | 9 | 9 | `POST /api/providers/debug/inspect` |
| 16 | `/api/sessionState` | agentAccess | 2 | 2 | `GET /api/sessionState/get` |
| 17 | `/api/settings` | platformCore | 5 | 5 | `GET /api/settings/get` |
| 18 | `/api/singleAgent` | agentAccess | 5 | 5 | `POST /api/singleAgent/answer` |
| 19 | `/api/skills` | pluginMarket | 10 | 10 | `POST /api/skills/create` |
| 20 | `/api/tools` | pluginMarket | 7 | 7 | `GET /api/tools/client` |
| 21 | `/api/workspaces` | localRuntime | 14 | 14 | `GET /api/workspaces/check` |
| — | **合计** | — | **161** | **162** | — |

**按模块汇总（与 §3.2 交叉校验）：**

| 模块 | 前缀数 | 前缀 | 路由文件 | 端点 |
| --- | --- | --- | --- | --- |
| assetLibrary | 1 | assets | 18 | 19 |
| mediaGeneration | 3 | ai, ffmpeg, providers | 25 | 25 |
| pluginMarket | 6 | agents, ext, nodes, plugins, skills, tools | 39 | 39 |
| mcpIntegration | 1 | mcp（另挂 `/mcp` 网关，非 `/api` 前缀） | 13 | 13 |
| localRuntime | 4 | desktop, exec, mobileLink, workspaces | 37 | 37 |
| agentAccess | 4 | agent, browser, sessionState, singleAgent（另挂 `/a2a`，非 `/api` 前缀） | 22 | 22 |
| platformCore | 2 | monitor, settings | 7 | 7 |
| **合计** | **21** | — | **161** | **162** |

> 注意：`/api/mcp`（13 个路由文件）与 `/mcp`（`createMcpRouter` 网关，`app.ts:140`）是**两个不同挂载点**；`/a2a`（`app.ts:121` 的 json 中间件与 `:146` 的 `createA2aRouter`）同理。A-07 的判据是“**21 个 `/api/*` 前缀**两两无交集，且 `/mcp` 只属 mcpIntegration、`/a2a` 只属 agentAccess”，三者互不混淆。

---

## 4. 需求详述

> 每条需求固定结构：**背景 → 目标 → 描述 → 验收（含 phase）→ 风险与缓解**。凡涉及 grep/计数的验收，均在附录 A 给出可执行命令与守卫。

### R-01 模块契约对象与 7 个应用子模块入口（P0｜难度中｜风险中）

- **背景**：P1。`server-api` 有 21 个 `/api/*` 路由前缀（§3.6）、15 个 `utils/*` 子域，但没有任何“模块入口”声明；地图只能登记为 1 个模块（评分 50，`god_module`）。
- **目标**：7 个模块各有一个 ≤60 行的入口，声明职责、路由前缀、初始化钩子、对外导出、依赖白名单；入口本身不承载业务实现。
- **描述**：
  - 统一契约类型放在 `src/types/module.ts`（L2 #8，属 bootstrap，属**组合契约**，不计域边）：

```ts
export interface ModuleContext {
  dataDirectory?: string;
  appVersion: string;
  /** pluginMarket 提供：目录同步/版本比对内核，供 mediaGeneration 走上下文而非直接 import */
  syncPluginDirectory?(targetDirectory: string, sourceDirectory: string, fileFilter?: RegExp | readonly string[], revision?: string): Promise<void>;
}

export interface ServerModule {
  id: "assetLibrary" | "mediaGeneration" | "pluginMarket" | "mcpIntegration" | "localRuntime" | "agentAccess" | "platformCore";
  routePrefixes: readonly string[];
  dependencies: readonly string[];
  exports: readonly string[];
  initialize?(context: ModuleContext): Promise<void>;
  warmup?(context: ModuleContext): void;      // 仅 assetLibrary：**非 async、fire-and-forget**（R-03 步骤 5）
  mount?(app: import("express").Express, context: ModuleContext): Promise<void>;
  /** 仅 pluginMarket 提供：包装 initializePlugins，供 bootstrap 注入 ModuleContext */
  syncDirectory?(targetDirectory: string, sourceDirectory: string, fileFilter?: RegExp | readonly string[], revision?: string): Promise<void>;
}
```

  - 入口允许额外具名导出（`pluginMarket.syncDirectory`、`pluginMarket.initializeTools`、`mediaGeneration.initializeProviders`、`mediaGeneration.addMediaProvider`、`assetLibrary.warmup`）；`ServerModule` 只约束公共字段。
  - 入口对自家域内文件用相对路径；跨模块/对外符号才用 alias（§1.6.2 例外条款）。
- **验收**：
  - [F] 7 个入口逐个存在（§3.3 L2 #1–#7），每个 `export default` 一个 `ServerModule`，每个 ≤60 行；
  - [F] `routePrefixes` 并集 = **§3.6 的 21 项**（逐字相等，含前导 `/api`）且两两无交集；`/mcp` 只属 mcpIntegration，`/a2a` 只属 agentAccess（§A.14 脚本输出与入口声明逐项 diff 为空）；
  - [F] `dependencies` 是附录 C 白名单子集，且不列 bootstrap（`types/module` 的 type-only 导入是组合契约）；
  - [B0+F] `assetLibrary` 入口的 `warmup` 必须是**同步签名返回 void**（`grep -nE 'warmup\??\(context' src/modules/assetLibrary/index.ts` 命中的行**不得**含 `async` 或 `Promise`）——与 R-03 步骤 5 一致。
- **风险与缓解**：入口与实际目录脱节 → 退化为“文档式拆分”。缓解：`routePrefixes` 由 §A.14 脚本输出反向核对；`dependencies` 用附录 A.7 判据核对；入口行数 >60 即失败。

### R-02 `app.ts` 瘦身为组合根（P0｜难度中｜风险高）

- **背景**：P2。`app.ts` 160 行里初始化、哈希、预热、刷新、MCP/A2A、移动互联与中间件顺序混写。
- **目标**：`app.ts` ≤80 行，只保留组合根职责；`createApp` 对外签名与返回值不变。
- **描述**（按 B0 行号锚定）：
  1. `createApp` 参数归一与 `TOONFLOW_DATA_DIR` 设定（B0:59）；`conf` **动态 import** 后 `setLocaleFallback`（B0:60-62）；
  2. **`express()` 之前的模块初始化**：R-03 步骤 **1–7**（B0:63-91）；
  3. `const app = express()`（B0:92）+ `app.locals.appVersion = appVersion`（B0:93）；
  4. **`express()` 之后的模块初始化**：R-03 步骤 **8**（builtin 扫描，B0:95-106）→ `app.locals.builtinPlugins` **唯一 1 处赋值**；
  5. 开发模式 `buildRoute()` + `logger("dev")`（B0:108-111，必须在 CORS 之前）；
  6. 全局中间件 7 项固定顺序（B0:112-127）：CORS 校验 → `languageRequest` → `/a2a` 2mb → `["/api/workspaces/files/write","/api/assets/save"]` raw 100mb → `/api/sessionState` 64kb → 全局 json/urlencoded 100mb → `/api/desktop` 门禁；
  7. **中间件之后的模块调用/挂载**：R-03 步骤 **9–15**（B0:129-158）；
  8. 返回 app。
- **验收**：
  - [F] `wc -l apps/server/src/app.ts` **≤80**；
  - [F] `grep -cE 'initializePlugins|autoInstallProviders|createHash|createMcpRouter|createA2aRouter|initializeMobileLinkRuntime|initializeProviderModels' apps/server/src/app.ts` = **0**（`initializePlugins` 的包装名必须叫 `syncDirectory`）；
  - [F] `grep -c 'app.locals.builtinPlugins =' apps/server/src/app.ts` = **1**，且同文件 0 处 `readdir`/`pattern` 分支；
  - [F] 7 项中间件 `grep -n` 行号严格递增；`/api/sessionState` 的 64kb 行号 < 全局 `express.json` 行号；
  - [B0+F] `createApp` 参数名、可选性、默认值与返回值 `Promise<Express>` diff 为空（对比 `git show d084136:apps/server/src/app.ts`）；
  - [F] **静态导入边界**：`app.ts` 的静态 import 图**不得**传递求值 `conf` 或 `assets/thumb`（B0 用动态 import 正是为了让 `TOONFLOW_DATA_DIR` 先于 `conf` 生效）。判据：在全新临时数据目录下启动，`<tmp>/settings.json` 被创建、仓库内 `data/settings.json` mtime 不变（A-25 的 `f2` 子项）。
- **风险与缓解**：数据目录时序 + 中间件顺序 + 宿主在 `createApp` 后注入 `app.locals.desktop` → 组合根只做装配；中间件写成显式有序数组；三宿主各跑一次冒烟（A-21）。

### R-03 初始化归口与「顺序 + 阻塞性 + 错误语义」固化（P0｜难度中｜风险高）

- **背景**：P2；`app.locals.builtinPlugins` 由 `app.ts` 生产，5 组路由消费。第 3 轮打回 #3：v3 只记了顺序，**没记步骤 5 的非阻塞与静默吞错语义**。
- **目标**：15 步全部归口到模块入口；**每一步的锚点（B0 行号）、阻塞性、错误语义逐项固化**，实施后逐行可核对。
- **描述**：下表是权威顺序表。锚点规则：**步骤 1–7 在 `const app = express()`（B0:92）之前**；**步骤 8 在 `app.locals.appVersion`（B0:93）之后、开发分支（B0:108）之前**；**步骤 9–15 在 7 项中间件（B0:112-127）之后**；`/mcp`（步骤 11）、`/a2a`（步骤 12）、静态（13）、错误处理（14）、移动互联（15）的相对顺序不得调整。

| 序 | 调用 | 归属 | B0 app.ts 行 | 阻塞性 | 错误语义（必须保真） | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `pluginMarket.initializeTools(ctx)` | pluginMarket | 63-64 | `await` | **抛出** → createApp reject | tools 目录；`/^[a-z][a-zA-Z0-9]*\.tool\.js$/` |
| 2 | `pluginMarket.initializeNodes(ctx)` | pluginMarket | 65 | `await` | **抛出** | nodes 目录；`/^[a-z][a-zA-Z0-9]*\.umd\.js$/` |
| 3 | `pluginMarket.initializeExt(ctx)` | pluginMarket | 66-69 | `await`（内部动态 import `initializeExt`） | **抛出** | ext 目录；动态 import 保持 |
| 4 | `mediaGeneration.initializeProviders(ctx)` | mediaGeneration | 70-86 | `await` | **抛出 + 局部容错**：`readFile` 的 `ENOENT` → `Buffer.alloc(0)`（缺内置供应商不算失败），**其他 errno 抛出**；同步走 `ctx.syncPluginDirectory`（不得 import pluginMarket） | 目录 `providers/media`；哈希算法 `sha256`，逐文件 `hash.update(name).update("\0").update(source).update("\0")`，顺序 = `autoInstallProviders` 数组顺序 `["tfRouter.ts","apiMart.ts","metaso.ts","compshare.ts"]`；`pluginRevision` 传入时跳过哈希 |
| 5 | **`assetLibrary.warmup(ctx)`（缩略图预热）** | assetLibrary | **87-88** | **`void`（不 await，不阻断后续步骤）** | **静默吞错**：B0 为 `void import("@/utils/assets/thumb").then(({sweepThumbnailCache}) => sweepThumbnailCache()).catch(() => {})`；**空 catch，无日志、无 rethrow、无 unhandledRejection**。动态 **import** 失败与同步抛出都走该空 catch；清扫**体内部**失败由 `thumb.ts` 自身 `.catch(error => console.warn("缩略图清扫失败", error))` 记录 warn 后 **resolve（永不 reject）**；重复调用返回同一个 `sweeping` promise（并发去重） | **必须保持动态 import**：`thumb.ts` 在模块作用域用 `conf.path` 计算缓存目录，静态引入会把 `conf` 求值提前到 `TOONFLOW_DATA_DIR` 设置之前（§R-02 静态导入边界）。调用位置：步骤 4 之后、步骤 6 之前 |
| 6 | `pluginMarket.initializeSkills(ctx)` | pluginMarket | 90 | `await` | **抛出** | skills 目录；首次安装补齐，保留用户修改 |
| 7 | `pluginMarket.initializeAgents(ctx)` | pluginMarket | 91 | `await` | **抛出** | agents 目录；同上 |
| 8 | `pluginMarket.scanBuiltin(ctx)` → `app.locals.builtinPlugins` | pluginMarket | 92、95-106 | `await`（`Promise.all`） | **抛出 + 局部容错**：`readdir` 的 `ENOENT` → `[]`，其他 errno 抛出 | **在 `express()` 之后**；键恰为 `tool/node/ext/skill/agent`，值为 `Set<string>`；pattern：tool=`/^[a-z][a-zA-Z0-9]*\.tool\.js$/`、ext=`/^ext-[a-z][a-zA-Z0-9]*\.umd\.js$/`、其他=`/^[a-z][a-zA-Z0-9]*\.umd\.js$/`；skill/agent 取目录名，其余取文件名去后缀 |
| 9 | `mediaGeneration.refreshModels()` | mediaGeneration | 129-131 | **`void`（不 await）** | **warn**：`void initializeProviderModels().catch(error => console.warn("启动时刷新供应商模型失败：", error))`——打印 warn 后 resolve，**不静默、不抛出** | 与步骤 5 **语义不同，禁止合并成同一个 helper**（风险 R17） |
| 10 | `router.default(app)` | bootstrap | 132-133 | `await`（动态 import） | **抛出** | 161 条挂载（或 Q2 分组） |
| 11 | `mcpIntegration.mount(ctx)` | mcpIntegration | 134-144 | `await`（4 个动态 import 并发：`@toonflow/mcp`、`mcp/tools`、`mcp/control`、`mcp/resources`） | **抛出** | `/mcp` + `createMcpRouter({getTools, authorize, resources, runInRequest, translate, translateError})`；SSE 本地化包装保持 |
| 12 | `agentAccess.mount(ctx)` | agentAccess | 145-146 | `await`（动态 import `@/agent/a2a`） | **抛出** | `/a2a`；**必须保持 `await import("@/agent/a2a")`**，改静态会让 agentAccess→agent 由 8 变 9 |
| 13 | `express.static(webRoot)` | bootstrap | 147 | 同步注册 | — | 静态站点 |
| 14 | 错误处理中间件 | bootstrap | 150-155 | 同步注册 | **拦截上游错误**；`response.headersSent` 时 `next(err)`；否则 `console.error(err)` + `errorFromCause(err)` | 必须位于步骤 13 之后、15 之前 |
| 15 | `localRuntime.initialize(ctx)` | localRuntime | 157-158 | `await`（动态 import）→ 同步调用 | **抛出** | `initializeMobileLinkRuntime(app)` |

- **验收**：
  - [F] `app.ts` 中 0 处插件目录 `readdir`/pattern 分支、0 处 `createHash`、0 处 `initializePlugins` 直接调用、0 处 `createMcpRouter`/`createA2aRouter` 构造；`syncPluginDirectory` 由 `pluginMarket.syncDirectory` 注入；
  - [F] `grep -rn 'from "@/modules/pluginMarket' apps/server/src/modules/mediaGeneration` = **0**（providers 同步必须走 `ctx.syncPluginDirectory`；`scope_min=42`，B0 同范围为 `utils/media+ai+ffmpeg+documents.ts`）；
  - [B0+F] 15 步顺序与上表一致（A-10）；阻塞性/错误语义逐行一致（A-26）；
  - [F] `app.locals.builtinPlugins` 键集合 = `{tool,node,ext,skill,agent}`，每值为 `Set`；5 组消费冒烟（S5–S8）通过；
  - [F] `createApp` 幂等：同一进程内连续调用 2 次不重复安装、不抛错（A-25 `f5`）。
- **风险与缓解**：同步/异步语义被“统一化” → §6.8 列 4 条禁止重构 + A-25/A-26 逐行核对；步骤 5 的静默吞错最容易被改成 `await` 或打印日志（R17）。

### R-04 服务目录模块化（P0｜难度很高｜风险高）

- **背景**：P1 + P3。15 个 `utils/*` 子域、246 处深路径（含 `src/agent/**` 的 50 处）、145 个 facade 引用。
- **目标**：`src/utils/**` 只留 `src/utils.ts`（facade）；7 个模块目录成形；246 处深路径**一处不漏**迁移；`@/utils/` 深路径归零。
- **描述**：
  - 按 **§1.6.2 SPEC** 逐目录迁移（只替换前缀，不改形态；`@/utils/mcp/servers` → `@/modules/mcpIntegration/mcp/servers`）；
  - **包含 `src/agent/**` 的 50 处说明符更新**（agent 文件本身不移动，但它引用的 server 路径必须跟迁；NG1 只要求“不消除依赖”，不豁免“路径更新”）；
  - `src/core.ts` 的路由生成、`apps/server/package.json` 的 exports（5 个 target）、`tsconfig` paths 同步（R-09）；
  - 不移动 `src/routes/**`（URL 不变）、不移动 `src/lib/**`/`src/types/**`。
- **验收**：
  - [B0+F] L1 `237/237`、L2 `new_total=9`、L3 `final_total=246`（§3.3 / A-01～A-03）；
  - [F] `find apps/server/src/utils -name '*.ts' \| wc -l` = **0**（`src/utils.ts` 不在此目录内）；
  - [F] `grep -rn 'from "@/utils/' apps/server/src --include='*.ts'` = **0**（白名单逐条列出文件:行；**`scope_min=263`（B0）/ `scope_pred=272`（F）**，见 §1.6.4 与 §6.9 L14）；
  - [B0+F] 深路径计数：B0 `@/utils/<域>` = **246**；F `@/modules/<模块>/<域>` = **252**（§A.3 的逐段推导；`246 = 50+62+103+30+1`，`252 = 50+62+103+30+7`）；
  - [F] 7 个模块目录存在且只含 SPEC 规定的域子目录/文件（A-02 的 `new_unregistered=0` 同时约束）。
- **风险与缓解**：路径漂移 = 前端 `/api` 字面量静默 404。缓解：M0 冻结 162 端点基线；逐条 diff；§3.6 的 21 前缀首端点冒烟。另一风险：`src/agent` 的 50 处被漏改 → `typecheck` 直接失败（TypeScript 会报 module not found），属**可自动发现**的失败，成本低。

### R-05 路由装配分组（P1｜难度高｜风险高｜默认豁免 E4）

- **背景**：P5。`router.ts` 327 行、161 条扁平挂载、无分组常量；`core.ts` 按 `routes/**` 自动生成。
- **目标**：默认 E4 —— 保留 161 条挂载与生成机制，仅加分组注释与“模块前缀所有权”声明；**不改 URL、不新增路由文件**。
- **描述**：
  - `router.ts` 由 `bun run routes`（`src/core.ts`）生成，**生成逻辑不变**；
  - 在 `router.ts` 顶部加 7 段分组注释（每段列出该模块拥有的前缀，来自 §3.6）；
  - 可选（Q2 选 C）：`core.ts` 由“每文件一条 `app.use`”改为“每 URL 前缀一个子 Router”；`router.ts` 只保留 21 个 `/api/*` + `/mcp` + `/a2a`；逐条等价；不新增文件。
- **验收**：
  - [F] `grep -c 'app.use' apps/server/src/router.ts` = **161**（Q2 选 C 时为 23，需在 §11 记录）；
  - [B0+F] 162 端点 `method + path` diff 为空（A-11）；
  - [F] 7 段分组注释存在，且每段前缀集合与 §3.6 / 入口 `routePrefixes` 一致（A-07）；
  - [F] 无新增路由文件（L2 的 9 个里不含 `routes/**`）。
- **风险与缓解**：分组注释与代码漂移 → 由 A-07 的脚本比对（入口声明 ↔ §3.6 ↔ 实际 `app.use`）；`core.ts` 改造（Q2-C）风险高，默认不做。

### R-06 聚合入口收敛（P1｜难度高｜风险高｜部分豁免 E2）

- **背景**：P3。`utils.ts` 37 出口 / 145 文件引用；5 个出口来自 `@/agent`。
- **目标**：37 个 key 与 B0 逐 key 一致；调用面零修改；每个 key 有归属模块注释；文件 ≤130 行。
- **描述**：`utils.ts` 由“全量聚合”改为“按模块分组的薄 facade”（每模块一段 re-export，仍导出同名 key，保持 `u.assets` 等调用不变）；5 个 `@/agent` 出口保留（E2）；内部说明符按 SPEC 迁移（30 行 `@/utils/...` → `@/modules/...`，见 §A.3 的 `30` 分解）。
- **验收**：
  - [B0+F] 37 个 key 逐 key diff 为空（`git show d084136:apps/server/src/utils.ts` vs FINAL）；5 个 agent key 保留；
  - [B0+F] facade 文件数 **B0 = F = 145**（§A.3 第 1 条；`145 = 144 + 1`），即“145 个调用文件零修改”；
  - [F] 每个 key 上方有归属模块注释；`wc -l apps/server/src/utils.ts` ≤130。
- **风险与缓解**：facade 保留过度 → 收敛名存实亡。缓解：以“出口归属注释 + 模块目录 + 37 key diff”作为可评审产物，而非仅靠行数。

### R-07 跨域依赖边 A–D（P0｜难度高｜风险中）

- **背景**：P4（第 2/3/4 轮打回已三轮修订）。**第 4 轮打回 #1 的直接对象是本节的 A 边 scope 数字**：R-07 写 41、A-13 写 60、实际 42。本版把 scope 改为**观测值 + `scope_min`**，并把 A/B/C/D 的每条判据的 phase 与命令固定到 §A.7。
- **目标**：A 的 4 处 mentionSources 归零；B/C 深路径归零并改为模块公开入口；D 的 2 条 type 边归零且反向 4 条 value 不变；四条边的计数变化只允许 §2.4 登记的形态（#5 24→27、#8 75→76、#12 3→3、#15 2→1、#17 1→0、#19 1→1）。
- **描述与判据**：

| 边 | 方向 | B0 证据（`file:line`） | B0 计数 | 类型 | 本版处理 | 判据（phase + label，命令见 §A.7） | 反向 / SCC |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **A** | `assetLibrary → agent` + `localRuntime → agent` | `utils/assets/index.ts:5`（`MentionQuery`，type）；`utils/assets/library.ts:5`、`utils/assets/thumb.ts:4`（`mentionAssetType`，value）；`routes/workspaces/files/thumb.ts:10`（同函数，value） | **4**（1t + 3v） | 混合 | **消除**：`MentionQuery`、`mentionAssetType` 下沉 `src/lib/mentionSources.ts`；`agent/mentionSources.ts` 以相对路径 `../lib/mentionSources` re-export，`@toonflow/server/agent/mentionSources` 路径不变；更新 4 处 import | **PH-B0 `a1` = 4**（`scope_min=41`，实测 `scope_files=41`）；**PH-F `a2` = 0**（`scope_min=41`，**`scope_pred=42`**：`9 assets + 1 入口 + 18 routes/assets + 14 routes/workspaces`）；**PH-F `a3`**：server→agent 23→**19**、asset→platform 24→**27**（1t/26v）、local→platform 75→**76**（1t/75v），由 §A.11 脚本输出 | 反向 0；不新增环 |
| **B** | `pluginMarket → mediaGeneration` | `utils/plugins/install.ts:11` `import { addMediaProvider } from "@/utils/media/provider"` | **1**（value） | value | **固化单向契约**：`mediaGeneration` 入口公开 `addMediaProvider`；`pluginMarket` 只从 `@/modules/mediaGeneration` 取 | **PH-B0 `b1` = 1**（`scope_min=6`）；**PH-B0 `b2`（反向）= 0**（`scope_min=32`）；**PH-F `b3`（反向，联合模式）= 0**（`scope_min=32`：`modules/mediaGeneration/media` 7 + `routes/{ai,providers,ffmpeg}` 25）；**PH-F `b4`（前向深路径，联合模式）= 0**（`scope_min=6`）；**PH-F `b5`（公开入口）= 1** 且整行必须是 `import { addMediaProvider } from "@/modules/mediaGeneration";` | 反向 0 |
| **C** | `mcpIntegration → pluginMarket` | `utils/mcp/dxt.ts:9`（`decodeText, skillPath, skillZip`）；`utils/mcp/tools.ts:13`（`listTools`）；`utils/mcp/resources.ts:6`（`import * as skillFile`） | **3**（value） | value | **显式化为安装/工具内核公共契约**（E1）：`pluginMarket` 入口 `export { decodeText, skillPath, skillZip } from "./plugins/install"`、`export { listTools } from "./plugins/tools"`、`export * as skillFiles from "./skills/files"`；`mcpIntegration` 只从 `@/modules/pluginMarket` import（namespace 以 `import { skillFiles as skillFile }` 保持调用面不变） | **PH-B0 `c1/c2/c3` = 1/1/1**（`scope_min=7`）；**PH-F `c4/c5/c6`（联合模式深路径）= 0/0/0**（`scope_min=7`）；**PH-F `c7`（公开入口）= 3**；**`c8` 调用面不变**：`skillFile.` = **7**、`decodeText\|skillPath\|skillZip` 行 = **4**；**`c9` 入口三组 re-export 语句逐字存在** | 反向 0 |
| **D** | `platformCore ↔ pluginMarket / localRuntime`（teams/mobileLink 类型环） | `utils/conf/index.ts:5`（`RemoteTeam` ← `@/utils/teams`，type，即 §2.4 #17）；`:8`（`MobileLinkConfig` ← `@/utils/mobileLink`，type，即 #15）；反向 value：`utils/teams/index.ts:5`、`utils/teams/install.ts:4`、`utils/teams/files.ts:6`、`utils/mobileLink/index.ts:10` | **2 type + 4 value** | 混合 | **消除 2 条 type 边**：`RemoteTeam`、`MobileLinkConfig` 定义在 `conf/index.ts`（配置 schema 的 owner），`teams/index.ts`、`mobileLink/index.ts` 以 `export type { ... } from "@/modules/platformCore/conf"` re-export；反向 4 条 value 保留 | **PH-B0 `d1` = 2、`d2`（反向）= 4**；**PH-F `d3`（conf 侧，联合模式）= 0**（`scope_min=1`）；**PH-F `d4`（反向，联合模式）= 4**（`scope_min=4`）；**PH-F `d5`（§A.11）= `platformCore→pluginMarket 0`、`platformCore→localRuntime 1 value（personalization）`、`platformCore→mediaGeneration 1 value（settings/save）`** | 反向 4 value；SCC-1 仍在，E12 |

- **R-07 总验收**：
  - [B0+F] A：`a1=4` → `a2=0`，`a3` 的三个计数按预期变化；
  - [B0+F] B：`b1=1`、`b2=0`（B0）→ `b3=0`、`b4=0`、`b5=1`（F）；
  - [B0+F] C：`c1..c3=1`（B0）→ `c4..c6=0`、`c7=3`、`c8` 调用面不变（F）；
  - [B0+F] D：`d1=2`、`d2=4`（B0）→ `d3=0`、`d4=4`、`d5` 三条值（F）；
  - [F] **不要求**消除 `agentAccess → @/agent`（8）、`utils.ts → @/agent`（5）、`mcpIntegration → @/agent`（2）、`platformCore → @/agent`（3）、`pluginMarket → @/agent`（1）、`agent → server`（71）（NG1/E2/E6/E7/E8/E9）；
  - [F] **不要求**模块级 DAG；SCC-1 保留（E12）。
- **风险与缓解**：`mentionSources` 下沉牵动 desktop 的 `@toonflow/server/agent/mentionSources` 契约 → 保留原路径 re-export 并冒烟；类型下沉改变 `teams`/`mobileLink` 的公开类型 → 保留 re-export；**判据假通过/不可达（R16）** → 全部改用 §1.6 两相 + 四守卫；入口行数增加 → 计入 L2 ≤60 行/入口与 L3 ≤3,300 行。

### R-07E `dxt ↔ servers` 模块内环（P2｜难度低｜风险低｜E11）

- **背景**：第 2 轮打回要求登记正确豁免；第 3 轮打回指出旧判据 `=1` 不可达。B0 的 2 个 file 级 SCC 之一，R-07D 后**唯一**残留。
- **目标**：默认按 E11 冻结两条边（两相均为 1，可执行且可达）；Q8 选消除时两相均为 0、SCC 归零。
- **证据**：

| 方向 | `file:line` | 符号 | 类型 | B0 计数 |
| --- | --- | --- | --- | --- |
| `dxt → servers` | `utils/mcp/dxt.ts:10` | `removeBundleDirectory` 等 | value | 1 |
| `servers → dxt` | `utils/mcp/servers.ts:8` | `removeMcpBundle` | value | 1 |

- **验收**：
  - [B0+F] `e1=e2=1`（B0，`scope_min=1`，实测 PASS）→ `e3=e4=1`（F，联合模式，`scope_min=1`）；
  - [F] `e5a=e5b=0`：两文件内 0 处相对 import（形态冻结）；
  - [F] `e6`：`scc_count=1`、`size=2`、成员恰为 `modules/mcpIntegration/mcp/{dxt,servers}.ts`；
  - [Q8] 若选消除：`e1..e4=0`、`e6 scc_count=0`、L2=10 / L3=247。
- **风险与缓解**：把“冻结”当“未完成” → §8.4 E11 模板 + 评审勾选；消除方案引入安全路径校验，风险高于收益（默认不选）。

### R-08 宿主装配兼容（P0｜难度低｜风险中）

- **背景**：三宿主（独立 server / Electrobun 桌面 / Android·OHOS 移动）复用 `@toonflow/server/app`；桌面在拿到 app 后注入 `app.locals.desktop`。
- **目标**：`createApp` 签名与 14 个 exports **键名逐字不变**；三宿主行为不变。
- **验收**：
  - [F] `package.json` 的 `exports` 键集合与 B0 **逐字 diff 为空**（14 个）；target 允许按 SPEC 更新（`./mcp`、`./mobileLink`、`./browser`、`./singleAgent/types`、`./remoteConnection` 共 5 个），且每个新 target 文件存在；
  - [B0+F] 36 个引用文件 / 57 处引用可解析（A-12）；
  - [B0+F] 三宿主启动冒烟（A-21）：独立 server（dev + `build/server`）、桌面（Electrobun）、移动端；`GET /api/settings/get`、`POST /api/desktop/update/check` 与基线一致；
  - [F] 桌面 `/api/desktop/*` **15 个端点**的门禁行为不变（`app.use("/api/desktop", desktopRequest)` 仍在中间件区，行号顺序不变）。
- **风险与缓解**：exports target 改错 → `@toonflow/server/remoteConnection` 等 5 个入口 404/编译失败（`apps/desktop/src/connection.ts` 直接依赖 `./remoteConnection`）；由 A-12 + 三宿主冒烟兜底。

### R-09 规范、地图与包导出同步（P0｜难度低｜风险低）

- **验收**：
  - [F] `AGENTS.md` 的目录结构与新模块一致（新增 `src/modules/**` 与入口约定）；
  - [F] 模块清单提交（8 个模块 id、职责、前缀、文件/行数、依赖），可直接被地图工具消费；地图重算后 = L3 `246 文件 / ≤14,839 行`（A-22）；
  - [F] `apps/server/package.json` exports 无悬空 target；`apps/server/tsconfig.json` 的 `paths` 仍为 `@/* → ./src/*`（无需新增条目）；
  - [F] 变更记录里显式登记 §1.2 的 2 处归属更正与 9 个滞后文件，重算校验 `237 + 9 = 246`。
- **风险与缓解**：地图 glob/exclude/行数口径差异 → 在模块清单中显式记录；A-22 用同一脚本重算。

### R-10 回归基线与 13 项逐条冒烟（P0｜难度中｜风险低｜先行）

**M0 冻结五份基线：** ① `git rev-parse HEAD` = `d084136`；② 162 条 `method + path` 清单；③ `router.ts` 全文 + 161 条挂载清单；④ `typecheck`/`build` 通过状态（M0 在实施环境复跑并记录）；⑤ 14 exports / 36 文件 / 57 处引用清单。

**13 项冒烟（逐条实列，覆盖 7 个应用子模块）：**

| # | 子模块 | 方法 + 路径 | 请求要点（固定 fixture） | 基线期望（改动前后 diff 为空） | 验证点 |
| --- | --- | --- | --- | --- | --- |
| 1 | assetLibrary | `GET /api/assets/list` | `library=global&directory=<fixture>&limit=20&sort=name` | `200`；`data.items` 数组 / `data.nextCursor` 与基线一致 | 前缀挂载、分页、库根解析 |
| 2 | assetLibrary | `PUT /api/assets/save` | `library=global&directory=<fixture>&path=smoke.txt&overwrite=true`；body 原始字节 `ok` | `200`；`data.path`、`data.revision` 与基线一致 | raw 100mb 解析器、越界防护 |
| 3 | mediaGeneration | `POST /api/ai/media/generate` | `{directory:<fixture>, mediaType:"image", ...固定模型/提示词}`；无供应商时记录同一 4xx | 有供应商：`200` + JSON body（去心跳空行）与基线一致；无供应商：与基线相同 4xx | JSON 流式响应、供应商/模型解析、计费入口 |
| 4 | mediaGeneration | `POST /api/ai/generate/stop` | `{runId:"<固定 uuid>"}`；同源请求 | `200`；`data.stopped` 与基线一致（未命中为 `false`） | 运行注册表、stop 墓碑、`aiRuns` |
| 5 | pluginMarket | `GET /api/tools/get` | 无 body；同源请求 | `200`；`data.tools` 数组、`data.canManage` 布尔 | `builtinPlugins.tool` 消费、工具清单 |
| 6 | pluginMarket | `PUT /api/tools/save` | 从 #5 取一个内置工具名；`{name:"<builtin>", config:{}}`；本机/桌面请求 | `200`；`data` 为校验后配置；非本机为 `403`（与基线一致） | 工具配置校验、`conf` 写入、本机门禁 |
| 7 | mcpIntegration | `GET /api/mcp/status` | 同源请求 | `200`；`data.enabled`、`data.connections`、`data.endpoint` 与基线一致 | MCP 运行时、控制通道、app 请求校验 |
| 8 | localRuntime | `GET /api/workspaces/files/list` | `directory=<fixture>&path=` | `200`；`data.entries` 数组、`data.empty` 布尔 | 工作区根解析、隐藏项过滤 |
| 9 | localRuntime | `PUT /api/workspaces/files/write` | `directory=<fixture>&path=smoke.txt&expectedRevision=<当前 sha256>`；body 原始字节 `ok` | `200`；`data.revision` 为新内容 sha256（与基线一致）；不带 `expectedRevision` 时 `data` 为空 | raw 100mb 解析器、锁、revision、路径防护 |
| 10 | localRuntime | `POST /api/desktop/update/check` | 无 body；桌面宿主启动 | 桌面：`200` + update 结构；独立 server：与基线相同 4xx | `app.locals.desktop` 注入、桌面门禁 |
| 11 | localRuntime | `POST /api/exec` | `{requestId:"<uuid>", directory:<fixture>, command:"echo smoke", cwd:"", timeoutMs:5000}` | `200` SSE；事件类型序列 `[start, stdout, exit]` 与基线一致 | SSE、并发限制、命令执行边界 |
| 12 | platformCore | `GET /api/settings/get` | 同源请求 | `200`；`data` 设置对象与基线一致 | `conf`、i18n、app 请求校验 |
| 13 | agentAccess | `GET /api/sessionState/get` | 同源请求 | `200`；`data.state` 与基线一致 | `/api/sessionState` 64kb 中间件顺序、会话状态读写 |

**补充冒烟（S1–S8，不计入 13）：**

| # | 方法 + 路径 | 目的 |
| --- | --- | --- |
| S1 | `GET /api/plugins/export?type=tool&name=<builtin>` | 插件导出 ZIP、本机门禁、`fflate` |
| S2 | `GET /api/mcp/servers/list` | MCP 服务器配置读取（R-07E 相关文件） |
| S3 | `POST /api/singleAgent/run` | Agent 流式运行（固定 provider/model；事件序列对比） |
| S4 | `GET /api/monitor/status` | 监控端点、系统指标 |
| S5 | `GET /api/nodes/get` | `builtinPlugins.node` 消费、节点清单 |
| S6 | `GET /api/ext/list` | `builtinPlugins.ext` 消费、扩展清单 |
| S7 | `GET /api/skills/list` | `builtinPlugins.skill` 消费、技能清单 |
| S8 | `GET /api/agents/get` | `builtinPlugins.agent` 消费、Agent 清单 |

- **验收**：
  - [F] 13 项逐条记录 `status`、`content-type`、归一化 body（时间戳/UUID/绝对路径/端口/临时哈希置零）或 SSE 事件类型序列；改动前后 diff 为空；
  - [F] S1–S8 有记录；**§3.6 的 21 个前缀**各取 1 个首端点（清单见 §3.6，M0 用 §A.14 脚本复算并归档）做 status diff 为空；
  - [F] `bun run typecheck`、`bun run build` 通过；`build/server` 产物可启动。
- **风险与缓解**：环境无供应商/无桌面宿主 → 以“改动前后一致”为判据；所有 fixture 与响应快照归档在 M0 文档；不新增测试文件。

### R-11 结构化豁免登记（P0｜难度低｜风险低）

- **验收**：
  - [F] E1–E12 逐条有编号、关联需求、理由、替代缓解、复核触发条件、责任人、有效期；
  - [F] E11/E12 必须使用 §8.4 完整模板；**E11 的判据必须是两相 + 联合模式**；
  - [F] 评审可在豁免栏勾选同意/驳回；被驳回的豁免转为对应 R 的验收项或重新评审。
- **风险与缓解**：豁免流于形式 → 每条豁免必须有可执行判据或计数上限；无判据的豁免无效。

### R-12 三本台账与预算审计（P0｜难度中｜风险低）

- **描述**：按 §3.3 执行三本账；审计脚本必须从 **git HEAD B0** 与 **最终工作树** 两个快照生成，不使用地图详细快照作为分母。
- **审计算法（必须按序）**：
  1. `git ls-tree -r --name-only d084136 -- apps/server` 取 B0 全量，按 §A.1 glob 过滤出 237 个 `.ts`；
  2. 建立显式 `MOVED: old -> new` 映射（覆盖 §1.6.2 的 15 个域目录、5 个顶层工具、`remoteConnection.ts`）；`src/lib/**`、`src/types/**`、`src/routes/**` 不移动；
  3. `EXPECTED = apply(MOVED, B0) ∪ L2`；FINAL glob = `src/app.ts`、`src/index.ts`、`src/core.ts`、`src/router.ts`、`src/utils.ts`、`scripts/**`、`src/lib/**`、`src/routes/**`、`src/types/**`、`src/modules/**`，**排除** `src/agent/**`；`src/utils/**` 必须为空；
  4. `new = FINAL - apply(MOVED, B0)`；`deleted = B0 - MOVED keys`；`actual_expected_diff = FINAL Δ EXPECTED` 必须为空；
  5. 把每个 FINAL 路径分配给唯一模块（MOVED 后按目标模块；未移动按 L1 glob；L2 按 owner）；输出 `unassigned`、`duplicated`；
  6. 计算 L1/L2/L3 的文件数、行数、端点数、路由文件数；
  7. 按 §3.5 逐模块判定预算。
- **验收输出（逐字匹配）**：

```text
L1: existing_total=237 existing_assigned=237 existing_unassigned=0 existing_duplicated=0 existing_orphan=0
L2: new_total=9 new_unregistered=0 new_line_cap_total=490
L3: final_total=246 final_assigned=246 final_unassigned=0 final_duplicated=0
L3: files 9+28+43+50+21+46+27+22=246; lines 14349+X (0<=X<=490)
L3: endpoints 0+19+25+39+13+37+22+7=162; routes 0+18+25+39+13+37+22+7=161
```

- **风险与缓解**：把移动误报为新增/删除 → 显式 old→new 映射；把新文件藏进既有目录 → 用 `final - B0` 路径集合判定；行数口径不一致 → 统一 UTF-8 行数。

### R-13 模块级 SCC 与依赖白名单（P1｜难度低｜风险中）

- **描述**：明确不承诺模块级 DAG；SCC-1（assetLibrary、localRuntime、mediaGeneration、platformCore、pluginMarket）是基线事实，登记 E12；7 个入口对 `types/module.ts` 的 `import type` 为组合契约，不计域边；`mediaGeneration` 的 providers 同步走 `ctx.syncPluginDirectory`；每个入口 `dependencies` 只允许附录 C 白名单；E10 7 条残余弱边逐条冻结。
- **验收**：
  - [F] 模块级 SCC 审计：`scc1={assetLibrary,localRuntime,mediaGeneration,platformCore,pluginMarket}`、`scc2={agentAccess}`、`scc3={mcpIntegration}`；不得出现新的 5 模块外环；
  - [F] 20 条直接边计数与 §2.4 的 R-07 后预期值一致（附录 A.11 脚本输出）；允许变化仅 #5（+3）、#8（+1）、#15（2→1）、#17（1→0）；#12/#19 计数不变；
  - [F] E10 7 条弱边每条 `current ≤ R-07 后预期值`，且无新的 source→target 对；
  - [F] E12 按 §8.4 模板填满。
- **风险与缓解**：把 SCC-1 误判为“拆分失败” → 在评审意见栏明确验收是“237 文件 god module 消除 + 子模块边界/预算”，不是“模块级无环”。

### R-14 判据工程：两相、归一化、守卫与自审（P0｜难度中｜风险中）

- **背景**：第 3 轮打回 #1/#2（假通过、不可达）与第 4 轮打回 #1/#2（scope 断言化、计数不可达）。根因有三层：① 判据的**坐标系**（B0/F）未声明；② 把**观测值**（`scope_files`）当成**断言**；③ 文档里的**数字**没有回收机制。
- **目标**：所有验收判据都具备 ① 明确 phase；② 说明符按 SPEC 归一化；③ 四守卫（G-EXIST / G-MATCH / G-POS / G-SCOPE）；④ 可机械自审（§A.12 + §A.13），使同类失效模式**无法再次进入文档**。
- **描述**：
  1. **分期标注**：§6.5 判定表新增 `Phase` 列；每条判据取值为 `B0` / `F` / `B0+F`；
  2. **说明符归一化**：PH-F 的 pattern 必须是**联合模式**（含 `modules/`）或纯 FINAL 说明符（`@/modules/`）；PH-B0 才允许裸 `@/utils/` 说明符；
  3. **守卫**：0 命中必须给 `scope_files` 且 `≥ scope_min`；路径不存在 → FAIL；期望 >0 必须附 PH-B0 可达性试跑；**`scope_files` 不得作为断言**（G-SCOPE）；
  4. **形态冻结**：跨模块说明符统一用 `@/modules/...`，禁止相对路径（Q11）；L2 入口对自家域内文件用相对路径（§1.6.2 例外）；
  5. **数值台账**：每个数字登记到 §6.9，附 B0 命令或推导链；
  6. **脚本不落库**：判据以 heredoc 执行（AGENTS 禁止新增测试/自检文件），输出粘贴进 M3/M6 证据日志；
  7. **文档自审**：§A.12 扫说明符/phase；§A.13 扫数值台账与 `scope_assertions`。
- **验收**：
  - [B0+F] A-27 逐项通过：`criteria_total=28`、`criteria_phase_tagged=28`、`stale_specifier_in_PHF=0`、`vacuous_zero=0`、`reachability_miss=0`、`doc_audit=PASS`；
  - [B0+F] A-28 逐项通过：`ledger_rows=23`、`unreachable=0`、`scope_assertions=0`、`ledger_probe=PASS`；
  - [B0+F] A-14/A-15/A-17 的三组命令在两相都能执行（B0 得出基线值，F 得出判定值），无一为空搜索；
  - [F] §A.12 与 §A.13 脚本对本文档输出 `doc_audit=PASS`（评审可复跑）。
- **风险与缓解**：实施者“顺手”把说明符改成相对路径 → `e5`（形态冻结）+ A-27 联合模式判 FAIL；取舍：允许在 §A.7 之外用临时命令排查，但**作为验收证据的命令必须是本文档给出的命令**。

---

## 5. 方案选项与推荐

| 方案 | 内容 | 优点 | 缺点/风险 | 结论 |
| --- | --- | --- | --- | --- |
| **A** | 只在 `app.ts` 内部抽 helper，目录不动 | 改动最小 | 不解决 P1/P3/P4；地图仍是 1 模块；不满足验收 | 否 |
| **B（推荐）** | 建 `src/modules/<7 模块>/**`，`utils/<域>` 整体迁入；`routes/**` 不动；7 个入口 + 1 个契约 + 1 个共享下沉 | 边界清晰、URL 不变、L2 仅 9 文件、行为可保真 | 迁移面大（246 处说明符 + 145 facade 内部指向）；模块级 SCC 保留 | **是（默认）** |
| **C** | 在 B 基础上把 `routes/**` 也搬进模块目录 | 目录更“整” | **URL 会变**（`core.ts` 按路径生成），破坏 G3；冒烟全废 | 否（仅作 Q1 备选） |
| **D** | 拆成多个 workspace 包（`packages/app-*`） | 隔离最强 | 违反 NG3；构建/发布/桌面打包全改；风险远超收益 | 否 |

> 结论：**B + 默认决策 Q1–Q11**（§10）。C/D 只作为评审可选的“更彻底方案”，本版不推荐。

---

## 6. 验收标准

> 判定权在评审：每条 A 项只有 PASS/FAIL；缺证据 = FAIL；`N/A` 仅在 §11 明确记录且该项不适用时成立（§6.6）。

### 6.1 硬性结构指标

- [ ] 8 个模块（`bootstrap` + 7 应用子模块）目录与入口存在；`bootstrap` 只含组合根/装配/契约，不含业务实现。
- [ ] **业务实现文件 ≤50 / 模块**；**含契约/装配文件 ≤55 文件 / ≤3,300 行 / 模块**；`pluginMarket` 49 业务 + 1 契约 = 50；`mediaGeneration` 42+1 = 43 / 3,054 行；`bootstrap` ≤900 行（现状 710，交付 750）。
- [ ] `app.ts` **≤80 行**，且 0 处具体插件类型、供应商哈希、`initializePlugins`、`createMcpRouter`/`createA2aRouter` 构造、`initializeMobileLinkRuntime`、`initializeProviderModels`（R-02）。
- [ ] 每个子模块有入口文件，声明职责 / 路由前缀 / 初始化 / 导出 / 依赖（R-01）；每入口 ≤60 行。
- [ ] `src/utils/**` 为空；`src/utils.ts` 保留为 facade（37 key，≤130 行）。
- [ ] `routePrefixes` 并集 = **§3.6 的 21 项**且两两无交集；`/mcp` ∈ mcpIntegration，`/a2a` ∈ agentAccess。

### 6.2 契约与回归

- [ ] 162 个端点 `method + path` diff 为空；161 个路由文件（B0 与 FINAL 均为 161）。
- [ ] `@toonflow/server/*` 14 个 exports **键名** diff 为空；target 无悬空；36 文件 / 57 处引用可解析。
- [ ] `createApp` 签名与返回值 diff 为空；三宿主启动冒烟通过（A-21）。
- [ ] 13 项冒烟逐条通过（R-10 表 1–13）；S1–S8 记录结果；**§3.6 的 21 个前缀**各 1 个首端点 status diff 为空。
- [ ] `bun run typecheck`、`bun run build` 通过；`build/server` 产物可启动。

### 6.3 台账与预算

- [ ] L1 `237/237`、unassigned=0、duplicated=0；L2 `new_total=9`、`new_unregistered=0`；L3 `final_total=246 = 237 + 9`。
- [ ] `228/13,955 + 9/394 = 237/14,349`（B0）；`237 + 9 = 246`（L3）；两段对账均记录。
- [ ] 移动/重命名按 §1.6.2 的 old→new 映射登记；无净删除、无清单外新增。
- [ ] 行数上限：交付 ≤14,839（= 14,349 + 490 的 L2 上限）。

### 6.4 规范与交付物

- [ ] `AGENTS.md` 与代码一致（新增 `src/modules/**` 与入口约定）。
- [ ] 模块清单已提交，可供架构侧重新生成地图；14 exports / 36 文件 / 57 引用清单已归档。
- [ ] 13 项 + S1–S8 的 fixture、响应快照、diff 结果已归档；归一化规则已写明。
- [ ] E1–E12 豁免登记完整（编号、理由、替代缓解、复核触发条件、责任人、判据）；E11/E12 使用完整模板且**判据两相化**。

### 6.5 验收判定表（A-01～A-28，二值；含 Phase 列）

> 规则：每项只有 **PASS / FAIL**；缺证据 = FAIL；N/A 仅在 Q 决策明确记录且该项不适用时成立。
> **Phase 列**：`B0` = 在 `d084136` 快照执行；`F` = 在交付态执行；`B0+F` = 两相都要有证据（B0 用于基线/可达性，F 用于判定）。
> 判据守卫见 §6.7；命令见附录 A；每个数字的来源见 §6.9。

| 编号 | 验收项 | Phase | 命令 / 产物 | 期望值 | 证据位置 | 判定 |
| --- | --- | --- | --- | --- | --- | --- |
| A-01 | L1 存量归属 | B0+F | §A.10 审计脚本 | `existing_total=237`、`assigned=237`、`unassigned=0`、`duplicated=0` | M2 审计日志 | ☐ PASS ☐ FAIL |
| A-02 | L2 新增台账 | B0+F | §A.10 | `new_total=9`、`new_unregistered=0`、9 个路径逐字匹配 §3.3 | M2/M6 日志 | ☐ PASS ☐ FAIL |
| A-03 | L3 交付台账 | F | §A.10 | `final_total=246`；文件/端点/路由等式成立；行数 `14,349+X (0≤X≤490)` | M6 日志 | ☐ PASS ☐ FAIL |
| A-04 | 业务 ≤50/模块 | F | §3.3 L3 表 | 8 模块业务计数均 ≤50；`pluginMarket=49` | §3.3 | ☐ PASS ☐ FAIL |
| A-05 | 交付 ≤55/≤3,300/≤900 | F | §3.3 L3 表 | 8 模块均 ≤55、≤3,300；bootstrap ≤900（交付 750） | §3.3 | ☐ PASS ☐ FAIL |
| A-06 | 7 个模块入口与契约 | F | `ls` + 读文件 | 7 个路径存在；每个 `export default ServerModule`；≤60 行；字段齐全 | `src/modules/**/index.ts` | ☐ PASS ☐ FAIL |
| A-07 | 路由前缀所有权 | F | 入口 `routePrefixes` + §A.14 输出 + `router.ts` | 并集与 §3.6 的 21 项逐字相等、两两无交集；`/mcp` 只属 mcpIntegration、`/a2a` 只属 agentAccess | §3.6 + §A.14 + 入口文件 | ☐ PASS ☐ FAIL |
| A-08 | `app.ts` ≤80 与禁用符号 | F | `wc -l` + `grep -cE` | ≤80；禁用符号计数 = 0；`builtinPlugins` 仅 1 处赋值 | `app.ts` | ☐ PASS ☐ FAIL |
| A-09 | 中间件顺序 | F | `grep -n` | 7 项行号递增；`/api/sessionState` 64kb 在全局 100mb 前 | `app.ts` | ☐ PASS ☐ FAIL |
| A-10 | 初始化 15 步顺序 + 步骤 8 锚点 + builtinPlugins | B0+F | 读 `app.ts` + 5 组冒烟 | 顺序与 §R-03 表一致；步骤 1–7 在 `express()` 前、步骤 8 在 `app.locals.appVersion` 后；5 键 `Set`；S5–S8 通过 | `app.ts` + 冒烟日志 | ☐ PASS ☐ FAIL |
| A-11 | 162 端点 / 161 路由文件 | B0+F | §A.2 | method+path diff 为空；路由文件 161 | M0/M6 清单 | ☐ PASS ☐ FAIL |
| A-12 | 14 exports / 36 文件 / 57 引用 | B0+F | §A.5 | 键名逐字 diff 为空；逐项 import 成功；计数一致 | M0/M6 清单 | ☐ PASS ☐ FAIL |
| A-13 | R-07A mentionSources 归零 | **B0+F** | §A.7 `a1/a2/a3` | `a1=4`（B0，scope 41）→ `a2=0`（F，`scope_min=41`，`scope_pred=42`）；server→agent 23→**19**；asset→platform **27**；local→platform **76** | M3 grep 日志 | ☐ PASS ☐ FAIL |
| A-14 | R-07B plugin→media 契约 | **B0+F** | §A.7 `b1/b2（B0）、b3/b4/b5/b5s（F）` | B0：`b1=1`、`b2=0`；F：`b3=0`（`scope_min=32`，**联合模式**）、`b4=0`、`b5=1` 且整行为 `import { addMediaProvider } from "@/modules/mediaGeneration";` | M3 grep 日志 | ☐ PASS ☐ FAIL |
| A-15 | R-07C mcp→plugin 深路径 | **B0+F** | §A.7 `c1..c3（B0）、c4..c9 + c7s/c8a/c8b（F）` | B0：`c1=c2=c3=1`；F：`c4=c5=c6=0`（`scope_min=7`，**联合模式**）、`c7=3`、`c8`（`skillFile.`=7、dxt 符号行=4）、`c9` 三组 re-export 逐字存在 | M3 grep 日志 | ☐ PASS ☐ FAIL |
| A-16 | R-07D conf type 边归零 | **B0+F** | §A.7 `d1..d5` | B0：`d1=2`、`d2=4`；F：`d3=0`（`scope_min=1`）、`d4=4`（`scope_min=4`）、`d5`：platform→plugin **0**、→local **1 value**、→media **1 value** | M3 grep 日志 + §A.11 | ☐ PASS ☐ FAIL |
| A-17 | R-07E dxt/servers | **B0+F** | §A.7 `e1..e6` + §A.6 | 默认：`e1=e2=1`（B0）、`e3=e4=1`（F，**联合模式**，可达性由 e1/e2 证明）、`e5=0`（形态冻结）、`e6`：`scc_count=1,size=2`；Q8：`e1..e4=0`、`scc_count=0`、L2=10/L3=247 | M3 审计 + §11 | ☐ PASS ☐ FAIL |
| A-18 | 模块 SCC / 白名单 / E10 | F | §A.6 + §A.11 | SCC 成员与 §2.4 一致；20 条边计数 = R-07 后预期值；E10 7 条不新增 | M3/M5 审计 | ☐ PASS ☐ FAIL |
| A-19 | typecheck / build / 产物启动 | F | `bun run typecheck`、`bun run build`、启动 `build/server` + `GET /api/settings/get` | 成功；产物启动 10s 内无未捕获异常；响应与基线一致 | M0/M6 日志 | ☐ PASS ☐ FAIL |
| A-20 | 13 项 + S1–S8 + 21 前缀 | B0+F | R-10 表 + §3.6 + §A.14 | 13 项 diff 为空；S1–S8 有记录；**21 前缀（§3.6 清单）** status diff 为空 | 冒烟归档 | ☐ PASS ☐ FAIL |
| A-21 | 三宿主启动 | B0+F | 独立：dev 与 `build/server`；桌面；移动 | 三宿主 10s 内无未捕获异常且端口监听；`GET /api/settings/get`、`POST /api/desktop/update/check`、`/api/connection` 代理与基线一致；桌面 15 端点门禁不变 | M1/M6 日志 | ☐ PASS ☐ FAIL |
| A-22 | AGENTS / 地图 / exports 同步 | F | 读文件 + 地图重算 | AGENTS 与代码一致；地图 8 模块 = L3 246 文件 / ≤14,839 行；exports 无悬空 | M5 清单 | ☐ PASS ☐ FAIL |
| A-23 | 豁免表完整 | F | §8 E1–E12 | 每条有编号/理由/缓解/触发/责任人/判据；E11/E12 完整模板且判据两相化 | §8 + §11 | ☐ PASS ☐ FAIL |
| A-24 | 无新增测试/依赖/分层；无隐藏文件 | F | `git status` + L2/L3 | 0 测试文件、0 新依赖、0 controller/service/repository、0 判据脚本落库；L2 外无新增 | M6 diff | ☐ PASS ☐ FAIL |
| A-25 | R-03 步骤 5 缩略图预热语义保真 | **F** | §A.7 `f1..f5` | `f1`：调用点无 `await`；`f2`：默认数据目录 = `<repo>/data`、显式目录生效且仓库 `data/` 不被写入；`f3`：入口 0 处 `console.*`、`thumb.ts` 内部 warn 保留 1 处；`f4`：只读注入下 `createApp` 仍 resolve、无 `unhandledRejection`；`f5`：重复 `createApp` 不重复安装 | M1 日志 | ☐ PASS ☐ FAIL |
| A-26 | 15 步阻塞性/错误语义矩阵 | **F** | §A.7 `g1..g6` + 读 `app.ts` | 每步与 §R-03 表第 5/6 列逐项一致；步骤 5 = `void`+静默、步骤 9 = `void`+warn，**二者未合并**；步骤 1–4、6–8、10–12、15 为 `await`+抛出；步骤 4/8 的 ENOENT 容错保留 | M1 日志 | ☐ PASS ☐ FAIL |
| A-27 | 判据自审（分期/守卫/文档层） | **B0+F** | §A.12 | `criteria_total=28`、`criteria_phase_tagged=28`、`stale_specifier_in_PHF=0`、`doc_audit=PASS` | M3/M6 日志 | ☐ PASS ☐ FAIL |
| **A-28** | **数值台账自审（可达性 / scope 断言 / 运行时守卫）** | **B0+F** | §A.13 + §A.7.9 | `ledger_rows=23`、`unreachable=0`、`scope_assertions=0`、`ledger_probe=PASS`（B0 探针逐项命中登记值）、`missing_path_guard=0`、`vacuous_zero=0`、`reachability_miss=0` | M3/M6 日志 | ☐ PASS ☐ FAIL |

> A-25 / A-26 的**命令在交付态执行**（`Phase=F`）；其**语义基准**是 §R-03 表的「B0 行号 / 阻塞性 / 错误语义」三列与 §6.8 清单，不要求在交付态重跑 B0 命令。
> A-28 的 `missing_path_guard` / `vacuous_zero` / `reachability_miss` 由 §A.7.0 的 `edge_check` 在运行时输出（`missing=…`、`scope_files < scope_min`、缺 B0 试跑），与 §A.13 的文档层审计合并构成完整证据。

### 6.6 不可判定项清零规则

1. **禁止模糊词**：验收条目不得出现“基本/尽量/合理/约/较多/较少/必要时”；所有数字必须是精确值或明确上限。
2. **每条验收必须有命令或产物**：只有“评审认为可以”不算验收。
3. **diff 归一化规则**（R-10 冒烟）：JSON 保持数组顺序、对象 key 排序后比较；时间戳/UUID/随机 ID/绝对路径/端口/临时哈希 → `<TS>`/`<UUID>`/`<PATH>`/`<PORT>`/`<HASH>`；SSE 比较事件类型序列 + 归一化 `data`，不比较心跳空行；HTTP 比较 `status`、`content-type`，忽略 `date`/`etag`；文件比较 UTF-8 行数并忽略行尾空格差异。
4. **环境差异**：无供应商/无桌面宿主时，以“改动前后一致”的 4xx/错误体为基线，不以固定 200 为唯一判据；基线快照必须在 M0 归档。
5. **二选一事项**：Q1–Q11 每项有默认值；未在 §11 记录时按默认值执行；记录后按记录值执行。禁止“看情况”。
6. **豁免与验收的边界**：被豁免的项不再要求“消除”，但仍要求 §8 模板完整 + 替代缓解可执行；豁免被驳回则转为验收项。
7. **判定责任**：每个 A 项由评审人勾选 PASS/FAIL；FAIL 必须写明缺失证据；无证据的 PASS 视为无效。
8. **数值约束**：任何 A 项的“期望值”里不得出现只观测的量（`scope_files`）；一旦出现按 A-28 判 FAIL（§1.6.4）。

### 6.7 判据规则（第 3/4 轮打回的正式口径）

1. **两相**：每条判据标注 `B0` / `F` / `B0+F`；同一判据的 B0 与 F 命令必须**形态一致**（联合模式或同构替换），只允许 SPEC 映射不同（§1.6.2）。
2. **说明符**：PH-F 禁用裸 `@/utils/…` 作为唯一 pattern；计数判据用纯 `@/modules/…`；归零判据用联合模式。
3. **守卫**：G-EXIST（路径缺失即 FAIL）、G-MATCH（0 命中必须 `scope_files ≥ scope_min`）、G-POS（期望 >0 必须有 B0 试跑或符号存在证明）、**G-SCOPE**（`scope_files` 不得作为断言）。
4. **形态冻结**：`@/modules/...` alias；L2 入口对自家域内文件用相对路径；两者都由 `e5` 与 A-28 `l2_relative` 守护。
5. **脚本不落库**：判据脚本一律以 heredoc 执行，输出粘贴进 M3/M6；仓库内不新增任何 `*.test.ts` / `scripts/verify*` 文件。
6. **文档自审**：§A.12（phase/说明符/空搜索）+ §A.13（数值台账/scope 断言/规模探针）。
7. **证据格式**：`check=<label> phase=<B0|F> expect=<n> scope_files=<n> scope_min=<n> hits=<n> verdict=<PASS|FAIL>`。

### 6.8 B0 语义保真清单（初始化 15 步的可判定摘要）

| # | 语义 | B0 事实 | 禁止的重构 |
| --- | --- | --- | --- |
| 1 | 步骤 5 非阻塞 | `void import(...).then(...).catch(() => {})` | 禁止改成 `await`、禁止改为 `void fn()`（会丢失 import 失败的保护） |
| 2 | 步骤 5 静默吞错 | 空 catch，不打印、不 rethrow | 禁止在入口加 `console.warn`/`logger`；禁止 `Promise.all` 合并 |
| 3 | 步骤 5 内部 warn | 由 `thumb.ts` 自身的 `.catch(error => console.warn("缩略图清扫失败", error))` 记录并 resolve | 禁止把该 warn 上移到入口；禁止删除 |
| 4 | 步骤 9 warn | `void initializeProviderModels().catch(error => console.warn("启动时刷新供应商模型失败：", error))` | 禁止与步骤 5 合并成同一 helper（R17） |
| 5 | 步骤 4 ENOENT 容错 | `readFile` 的 `ENOENT → Buffer.alloc(0)`，其他 errno 抛出 | 禁止把容错扩大成 `catch { return Buffer.alloc(0) }` |
| 6 | 步骤 8 ENOENT 容错 | `readdir` 的 `ENOENT → []`，其他 errno 抛出 | 禁止吞掉所有 errno |
| 7 | 步骤 3/12 动态 import | `initializeExt` 与 `@/agent/a2a` 必须保持动态 | 禁止改静态（会让 agentAccess→agent 由 8 变 9，且提前求值） |
| 8 | 时序：`TOONFLOW_DATA_DIR` 先于 `conf` | `app.ts:59` 设置 env，`:60` 才 import `conf` | 禁止任何静态 import 传递求值 `conf`/`assets/thumb`（A-25 `f2`） |

### 6.9 数值可达性台账（L01–L23；A-28 的判定对象）

> 规则：文档中出现的**每个数字**必须在此登记一行；`B0` 列必须是可复现命令的实测值，`F/推导` 列必须给出到 B0 的推导链或“上限”说明。`scope_files` 一律不写入“期望”（§1.6.4）。

| ID | 断言 | 值 | 相位 | 来源 / 复现 | 可达性或推导 |
| --- | --- | --- | --- | --- | --- |
| L01 | server-api 文件数 | 237 | B0 | §A.1 脚本（实测 `237 14349`） | 直接实测 |
| L02 | server-api 行数 | 14,349 | B0 | §A.1 脚本 | 直接实测 |
| L03 | 路由文件 | 161 | B0 | §A.2 | 直接实测 |
| L04 | 注册端点 | **162**（51/79/20/10/0/2） | B0 | §A.2（锚定式） | 直接实测；与 §3.6 逐前缀合计一致；朴素 grep 的 187 是误报（§0.2 S4、§1.2(c)） |
| L05 | `router.ts` 行 / 挂载 | 327 / 161 | B0 | `wc -l`、`grep -c 'app.use'` | 直接实测 |
| L06 | `app.ts` 行 | 160 | B0 | `wc -l` | 直接实测 |
| L07 | `utils.ts` 行 / key | 75 / 37 | B0 | `wc -l` + 逐 key 计数 | 直接实测 |
| L08 | facade 文件数 | 145 = 144 + 1 | B0 | §A.3 第 1 条 | 直接实测（144 非 agent + `agent/mentionFiles.ts:3`） |
| L09 | facade 文件数（交付） | 145 | F | §A.3 第 1 条（同一条命令） | R-06 冻结调用面 → 与 B0 相等 |
| L10 | 深路径数 | 246 = 50 + 62 + 103 + 30 + 1 | B0 | §A.3 第 2 条 + 分段统计 | 直接实测（agent 50 / routes 62 / utils 103 / `utils.ts` 30 / `app.ts` 1） |
| L11 | 深路径数（交付） | **252** = 50 + 62 + 103 + 30 + 7 | F | §A.3 第 3 条 + 分段统计 | 每段同额迁移；`app.ts`：−1（`initializePlugins` 静态行移入入口）+7（装配 7 个入口）= 7；R-07B/C 各 1/3 为 1:1 替换；R-07D 的 −2 与 +2 re-export 相抵 |
| L12 | server → agent | 23（B0）/ 19（F） | B0+F | §A.4 第 1 条（§A.7 `a3`） | 23 − 4（R-07A）= 19 |
| L13 | agent → server | 71 = 51 + 20 | B0 | §A.4 第 2/3 条 | 直接实测（地图 28/73 口径不同，见 §1.2(b)） |
| L14 | `src/**` 的 `.ts` 文件数 | 263（B0）/ 272（F） | B0+F | `find apps/server/src -name '*.ts' \| wc -l` | 263 + 9（L2 全在 `src/` 下）= 272；无删除 |
| L15 | A 边扫描范围 | `scope_min=41`（B0）/ `scope_pred=42`（F） | B0+F | §A.7.1 | B0 实测 41；F = 9 + 1（L2 入口）+ 18 + 14 = 42，`scope_min` 仍取 41（只要求不丢文件） |
| L16 | B/C/D 边扫描范围 | 6 / 32 / 7 / 1 / 4 | B0 | §A.7.2–A.7.4（实测 PASS） | 直接实测；F 同值（域目录不增减，`b3` 的 32 = 7 + 25 见 §A.7.2） |
| L17 | file 级 SCC | 2 个（15 + 2） | B0 | §A.6（实测 `files= 237 scc_count= 2`） | 直接实测；`--sim` 后 `scc_count=1` |
| L18 | 域间直接边 | 20 条 | B0 | §A.11（实测逐行一致） | 直接实测 |
| L19 | 外部契约 | 14 exports / 36 文件 / 57 引用 | B0 | §A.5 | 直接实测 |
| L20 | `/api/*` 前缀 | 21（161 文件 / **162** 端点） | B0 | §A.14 + §3.6 | 直接实测（§3.6 逐行给出归属与计数；断言 `prefixes=21 ∧ files=161 ∧ endpoints=162`） |
| L21 | 结构上限 | `app.ts ≤80`、入口 ≤60、业务 ≤50、含契约 ≤55 / ≤3,300、bootstrap ≤900 | F | §3.2 / §3.3 | 上限型（只需 ≤），由 §A.10 输出实际值判定 |
| L22 | 三本账 | 237 / 9 / 246 | B0+F | §A.10 | `246 = 237 + 9`；L1 实测 237，L2 固定 9 |
| L23 | 交付行数上限 | 14,839 = 14,349 + 490 | F | §3.2 | 上限型；490 = 7×60 + 40 + 30（L2 行数上限） |

> **A-28 的判定**：`ledger_rows=23`；`unreachable=0`（每行要么 B0 实测、要么有推导/上限说明）；`scope_assertions=0`（§6.5 的“期望值”列不出现 `scope_files`）；`ledger_probe=PASS`（§A.13 的探针对 L01–L20 逐项复算，`mismatch=0`）。

### 6.10 文档自审（可机械复现，纳入 M3/M6 证据）

| 脚本 | 覆盖 | PASS 条件 | 非空转验证 |
| --- | --- | --- | --- |
| §A.12 | ① A 行缺 Phase；② PH-F 块出现裸 `@/utils/` 说明符；③ 未标注块出现 B0 说明符 | `criteria_total=28`、`criteria_phase_tagged=28`、`stale_specifier_in_PHF=0`、`unlabeled_utils_command=0`、`doc_audit=PASS` | 对 v3 文档跑 → `criteria_phase_tagged=0` → FAIL；对 v4 文档跑 → `criteria_total=27` → FAIL（本版口径为 28） |
| §A.13 | ① 台账行数；② 台账每行的相位/来源非空；③ `scope_files` 是否被写进 §6.5 的期望列；④ B0 探针复算 | `ledger_rows=23`、`scope_assertions=0`、`probe_mismatch=0`、`ledger_probe=PASS` | 注入一笔“期望 `scope_files=60`” → `scope_assertions=1` → FAIL；把 L20 的 21 改成 22 → `probe_mismatch=1` → FAIL |

---

## 7. 风险登记表

| ID | 风险 | 概率 | 影响 | 缓解 | 关联验收 |
| --- | --- | --- | --- | --- | --- |
| R1 | 迁移遗漏说明符，运行期 404/编译失败 | 中 | 高 | `bun run typecheck`（严格失败即暴露）+ §A.3 的 `@/utils/` 归零判据 + 246→252 计数 | A-19、R-04 |
| R2 | URL 随目录变化导致前端 404 | 低 | 高 | 方案 B 不动 `routes/**`；162 端点清单 diff；§3.6 的 21 前缀首端点 | A-11、A-20 |
| R3 | `createApp` 时序被破坏（`conf` 提前求值） | 中 | 高 | 保持 `conf`/`thumb` 动态 import；A-25 `f2` 的临时目录探针 | A-25、R-02 |
| R4 | 初始化错误语义被“统一化” | 中 | 高 | §6.8 的 8 条禁止 + A-25/A-26 逐行核对 | A-25、A-26 |
| R5 | `app.locals.builtinPlugins` 语义漂移 | 低 | 中 | 键/类型/pattern 三元组逐项断言；S5–S8 冒烟 | A-10、A-20 |
| R6 | `utils.ts` 37 key 被改 | 低 | 高 | 逐 key diff；145 个调用面不改；facade 计数 145 | A-12、A-22 |
| R7 | exports target 改错导致桌面/移动构建失败 | 低 | 高 | 键名逐字不变 + 5 个 target 存在性检查；三宿主冒烟 | A-12、A-21 |
| R8 | 文档式拆分（入口是摆设） | 中 | 高 | `routePrefixes` 与 §A.14 输出对账；`dependencies` 与实际 import 对账；A-18 | A-06、A-07、A-18 |
| R9 | **判据假通过/不可达**（第 3/4 轮打回的同类问题再次出现） | 中 | 高 | 两相 + 四守卫 + §A.12/§A.13 自审 + §6.9 台账 | A-27、A-28 |
| R10 | 把 `scope_files` 又写成断言 | 中 | 中 | G-SCOPE + A-28 `scope_assertions=0` | A-28 |
| R11 | 模块级 SCC 被当成“未完成” | 高 | 低 | §8.4 E12 + 评审意见栏写明验收是“god module 消除 + 预算” | A-18 |
| R12 | 冒烟环境无供应商/无桌面宿主 | 高 | 低 | 以“改动前后一致”为判据；M0 归档基线 | A-20、A-21 |
| R13 | 移动/新增混淆导致台账失真 | 中 | 中 | 显式 old→new 映射；`final − B0` 判定 | A-01～A-03 |
| R14 | `src/agent` 的 50 处说明符漏改 | 中 | 高 | typecheck 必然失败（可自动发现）；§A.3 的 agent 段计数 50 | A-19、R-04 |
| R15 | 入口文件膨胀（>60 行） | 中 | 中 | 逐入口行数上限；初始化逻辑放域文件，入口只做编排 | A-06 |
| R16 | 判据脚本被提交进仓库（违反 AGENTS） | 低 | 中 | §6.7.5；A-24 检查 `git status` 无新增脚本 | A-24 |
| R17 | 步骤 5 与步骤 9 的吞错语义被合并成同一 helper | 中 | 高 | §6.8 第 4 条明确禁止；A-26 逐行核对 | A-26 |
| R18 | 说明符形态漂移（alias → 相对路径） | 中 | 中 | `e5` 形态冻结 + A-28 `l2_relative`（入口自家域内允许相对，其他禁止） | A-17、A-28 |

---

## 8. 豁免判定与结构化豁免模板

### 8.1 豁免判定标准（满足任一即可申请）

1. 消除该问题需要**改变对外契约**（HTTP/包导出/宿主行为）；
2. 消除该问题需要**超出本需求范围**的改动（跨模块/跨包/改 agent 运行时）；
3. 消除该问题引入的**风险或复杂度高于收益**，且已有可执行的替代缓解。

### 8.2 已识别的候选豁免（E1–E12，供评审勾选）

| ID | 关联需求 | 内容 | 理由 | 替代缓解 | 复核触发 | 判据 |
| --- | --- | --- | --- | --- | --- | --- |
| E1 | R-07C | 插件安装/工具内核被 MCP、团队复用，仍以“公开入口”而非独立包提供 | 抽包违反 NG3；内核语义与安装流程强绑定 | `pluginMarket` 入口显式导出三组符号，调用面不变 | 出现第 4 个消费者时重评 | A-15 `c7/c9` |
| E2 | R-06 | `utils.ts` 保留 5 个 `@/agent` 出口 | 145 个调用面不改；移除需改 agent 装配（NG1） | 出口加“agent 能力”注释；不扩散 | AgentHost 端口化需求启动时 | A-12 |
| E3 | R-04 | `/api/exec` 与工作区同属 localRuntime，不再细分 | 命令执行与工作区根/越界防护共享上下文 | 入口 `dependencies` 与目录注释显式声明 | 引入独立沙箱时 | A-04、A-18 |
| E4 | R-05 | `router.ts` 保留 161 条扁平挂载（不改为分组 Router） | `core.ts` 自动生成机制改动风险高、收益低 | 分组注释 + §3.6 前缀所有权对账 | 需要按模块懒加载时 | A-07、A-11 |
| E5 | R-07D | `conf` 仍有 2 条指向 localRuntime/pluginMarket 的**值**依赖（`personalization`、`settings/save`） | 配置 schema 与业务读取同源，改造成本高于收益 | 反向 value 边保留并计数（d4=4） | 配置层独立成包时 | A-16 `d5` |
| E6 | NG1 | 19 处运行期 agent 依赖保留 | 会话运行时属另一模块，改端口化超出范围 | 边界表逐条登记；不新增第 20 处 | AgentHost 需求 | A-13 `a3`、§2.3 |
| E7 | R-07D | `platformCore → @/agent` 3 处（conf type、settings 2 处） | 默认系统提示词与 A2A 配置属平台配置语义 | 不新增第 4 处 | settings 模块拆分时 | §2.3 |
| E8 | R-07C | MCP 工具运行 Agent（`mcp/tools.ts:8-9`） | MCP 端点本质就是 Agent 工具面 | 仅此 2 行；不扩散 | MCP 独立进程化时 | §2.3 |
| E9 | R-07 | `pluginMarket → @/agent` 1 处（A2A 模型校验） | 校验需要 agent 模型配置解析 | 仅此 1 行 | a2a 配置下沉时 | §2.3 |
| E10 | R-07/R-13 | 7 条残余弱边（`agentAccess→pluginMarket` 1、`assetLibrary→mediaGeneration` 1、`localRuntime→mediaGeneration` 1、`mcpIntegration→localRuntime` 3、`mcpIntegration→mediaGeneration` 1、`platformCore→localRuntime` 1 value、`platformCore→mediaGeneration` 1） | 均为“读一项配置/取一个枚举”级别的弱边，契约化收益低于改动风险 | 边缘矩阵逐条冻结 + 反向计数约束；不新增 source→target 对 | 任一条增长 2 倍以上 | A-18 |
| E11 | R-07E | `dxt ↔ servers` 模块内 2 文件环 | 两函数互为兜底（bundle 目录清理），拆分会引入新的中间抽象 | §8.4 完整模板；`e1–e6` 两相判据 | Q8 改选“消除”时 | A-17 |
| E12 | R-13 | 模块级 SCC-1（5 个域模块）+ bootstrap 枢纽环 | 双向弱依赖是既有架构事实，消除需重排配置/工作区/插件/媒体四层 | §8.4 完整模板；`d5` 与 A-18 约束 | 出现新的跨模块环时 | A-18 |

> 勾选规则：评审在 §11 的“豁免裁决”栏逐条勾选；未勾选视为**不同意豁免**，对应验收项生效。

### 8.3 豁免说明模板（每条必填）

```text
[E<n>] <豁免标题>
- 关联需求 / 验收项：R-xx / A-xx
- 事实与证据：<file:line + 计数 + 复现命令>
- 未消除的理由：<契约/范围/风险三类之一 + 具体说明>
- 替代缓解（必须可执行）：<机制 + 判据>
- 复核触发条件：<指标阈值 / 事件 / 时间点>
- 责任人：<角色>
- 有效期：<版本 / 日期>
- 评审裁决：☐ 同意 ☐ 驳回（驳回则转为验收项）
```

### 8.4 E11 / E12 填表（可直接勾选）

#### E11：`dxt ↔ servers` 模块内环

```text
[E11] utils/mcp/dxt.ts ↔ utils/mcp/servers.ts 两文件运行期环
- 关联需求 / 验收项：R-07E / A-17
- 事实与证据：dxt.ts:10 → servers.ts；servers.ts:8 → dxt.ts；B0 计数各 1；
              file 级 SCC 实测 scc_count=2（其中 size=2 即本环，§A.6 输出）
- 未消除的理由：范围+风险。两函数（removeBundleDirectory / removeMcpBundle）互为兜底清理，
              拆出第三方模块会新增一层无业务含义的抽象，且需重排删除顺序（安全路径校验）。
- 替代缓解：① 冻结两条边（PH-B0 与 PH-F 各 1，联合模式）；② 禁止新增第三条互引；
           ③ 形态冻结（禁改相对路径，e5a/e5b=0）；④ Q8 提供可选消除路径（bundle.ts）。
- 复核触发条件：两文件任一方新增第 2 条互引；或 mcp 目录文件数 > 12；或 Q8 被采纳。
- 责任人：server-api 模块 owner
- 有效期：本需求交付版本
- 评审裁决：☐ 同意 ☐ 驳回
```

#### E12：模块级 SCC 与 bootstrap 枢纽环

```text
[E12] 模块级 SCC：{assetLibrary, localRuntime, mediaGeneration, platformCore, pluginMarket} + bootstrap 枢纽
- 关联需求 / 验收项：R-13 / A-18
- 事实与证据：20 条域间边的双向组合（§2.4 #3/#6、#7/#13、#15/#8、#17/#20 等）；
              facade 边 145 文件 → bootstrap，构成枢纽环；SCC 成员见 §2.4
- 未消除的理由：范围。消除需重排“配置(platformCore)→工作区/插件/媒体”的四层依赖，
              涉及 agent 运行时与插件安装内核，超出本需求（NG1/NG3）。
- 替代缓解：① 不承诺模块级 DAG，只承诺“20 条边计数不超 R-07 后预期值”；
           ② E10 的 7 条弱边冻结，不新增 source→target 对；
           ③ 入口 dependencies 白名单 + A-18 审计；
           ④ file 级 SCC 从 2 个降为“R-07D 后 1 个（E11）”。
- 复核触发条件：出现 SCC-1 之外的 5 模块环；或某条边计数超过预期值 20%；
              或 AgentHost 端口化需求启动。
- 责任人：架构 owner
- 有效期：本需求交付版本
- 评审裁决：☐ 同意 ☐ 驳回
```

---

## 9. 实施顺序与里程碑（评审通过后执行）

| 里程碑 | 内容 | 出口条件 |
| --- | --- | --- |
| **M0 基线冻结** | 5 份基线（HEAD / 162 端点 / `router.ts` 161 挂载 / typecheck+build 状态 / 14 exports 清单）+ §3.6 的 21 前缀首端点清单 + 13 项冒烟 fixture | 全部归档；`git status --porcelain apps/server` 为空 |
| **M1 语义探针** | 在 B0 上跑一遍 A-25/A-26 的语义探针，记录“改动前”的 `f1–f5`、`g1–g6` 结果 | 探针输出归档（后续与 F 对比） |
| **M2 目录迁移** | R-04：`utils/<域>` 迁入 `src/modules/<模块>`；`documents.ts`/`fileHttp.ts`/`remoteConnection.ts` 随迁；说明符前缀替换（含 `src/agent/**` 的 50 处） | A-01/A-02/A-03 通过；`@/utils/` 深路径 = 0；`typecheck` 通过 |
| **M3 模块契约** | R-01/R-02/R-03/R-07：7 个入口 + `types/module.ts` + `lib/mentionSources.ts`；`app.ts` 瘦身；15 步归口；A–D 边处理 | A-06/A-08/A-09/A-10/A-13～A-17 通过；§A.7 证据归档 |
| **M4 装配与回归** | R-05/R-06：`utils.ts` 分组注释、`router.ts` 分组注释；13 项 + S1–S8 + 21 前缀冒烟 | A-11/A-20 通过 |
| **M5 规范与地图** | R-09：`AGENTS.md`、模块清单、`package.json` exports、地图重算 | A-12/A-22 通过 |
| **M6 终验与证据** | 全量 A-01～A-28 + §A.12/§A.13 自审 + 三宿主冒烟；豁免表填满 | 全部 PASS 或 §11 有明确裁决；证据包归档 |

---

## 10. 待评审决策点（Q1–Q11，均有默认值）

| # | 决策 | 选项 | 默认 | 理由 |
| --- | --- | --- | --- | --- |
| Q1 | 拆分深度 | A 仅瘦身 / **B 应用子模块 + routes 不动** / C 连 routes 一起搬 / D 拆 workspace 包 | **B** | 唯一同时满足 G1–G3 的方案；C 破坏 URL，D 违反 NG3 |
| Q2 | 路由生成器 | **E4 保留每文件一条 `app.use`** / E4+C 前缀子 Router | **E4** | `core.ts` 自动生成机制改动风险高；C 留作后续 |
| Q3 | `utils.ts` 存废 | **保留 37 key 分组 facade** / 改 145 个调用点 | **保留** | 改调用点扩大 145 文件改动面 |
| Q4 | NG1 边界 | **4 消除 / 19 保留** / 全消除 | **4 消除 / 19 保留** | 全消除需 AgentHost 端口化（另立需求） |
| Q5 | B/C 公开契约 | **接受“入口 re-export”作为契约** / 抽独立 `plugin-kernel` 包 | **入口 re-export** | 抽包违反 NG3 |
| Q6 | 文件预算 | **业务 ≤50 / 交付 ≤55 / ≤3,300 行 / bootstrap ≤900** | **同左** | 现状最大值 49 业务；留 1 文件余量 |
| Q7 | 冒烟判据 | **diff 为空** / 仅 status 一致 | **diff 为空**（含归一化） | 行为不可变是硬要求 |
| Q8 | `dxt ↔ servers` | **E11 保留环** / 提取 `bundle.ts` 消除 | **E11** | 消除需 +1 文件与安全路径迁移审查，收益低 |
| Q9 | L2 口径 | **固定 9（Q8 选消除则 10）** / 允许按需 | **固定 9** | 台账必须可审计 |
| Q10 | 模块级 SCC | **接受 E12（不承诺 DAG）** | **接受** | 消除需重排四层依赖（超范围） |
| Q11 | 说明符形态与计数口径 | **冻结 alias（`@/modules/...`）；L2 入口自家域内用相对路径；计数区分“import 行”（A.11）与“from 行”（A.3）** | **同左** | 形态漂移会让边矩阵与白名单判据全部失效 |

---

## 11. 评审意见栏

> 使用方式：评审逐条填写；未填写的 Q 项按 §10 默认值执行；未勾选的豁免视为驳回。

### 11.1 总体结论

| 项 | 填写 |
| --- | --- |
| 评审结论 | ☐ 通过（进入实施） ☐ 打回（见 11.2） |
| 评审人 / 日期 |  |
| 一句话意见 |  |

### 11.2 打回意见（逐条，评审填写）

| # | 意见（可引用章节号） | 严重度 | 期望处置 | 需求方回应 |
| --- | --- | --- | --- | --- |
| 1 |  |  |  |  |
| 2 |  |  |  |  |
| 3 |  |  |  |  |

### 11.3 决策点裁决（Q1–Q11）

| Q | 默认值 | 评审裁决（采纳默认 / 改选，改选请写明） |
| --- | --- | --- |
| Q1 | B |  |
| Q2 | E4 |  |
| Q3 | 保留 facade |  |
| Q4 | 4 消除 / 19 保留 |  |
| Q5 | 入口 re-export |  |
| Q6 | 业务 ≤50 / 交付 ≤55 / ≤3,300 / bootstrap ≤900 |  |
| Q7 | diff 为空 |  |
| Q8 | E11 |  |
| Q9 | 固定 9 |  |
| Q10 | 接受 E12 |  |
| Q11 | alias 冻结 + 计数口径分离 |  |

### 11.4 豁免裁决（E1–E12）

| 豁免 | 结论（同意 / 驳回 → 转验收项） | 说明 |
| --- | --- | --- |
| E1 插件安装/工具内核 |  |  |
| E2 `utils.ts` 5 个 agent 出口 |  |  |
| E3 `/api/exec` 归属 localRuntime |  |  |
| E4 161 条扁平挂载 |  |  |
| E5 `conf` 的 2 条值依赖 |  |  |
| E6 19 处运行期 agent 依赖 |  |  |
| E7 `platformCore → @/agent` 3 处 |  |  |
| E8 MCP 运行 Agent |  |  |
| E9 `pluginMarket` 的 A2A 校验 |  |  |
| E10 7 条残余弱边 |  |  |
| E11 `dxt ↔ servers` |  |  |
| E12 模块级 SCC |  |  |

### 11.5 验收勾选（汇总）

| 分组 | 条目 | 结论 |
| --- | --- | --- |
| 结构指标 | A-04～A-09 | ☐ PASS ☐ FAIL |
| 契约回归 | A-10～A-12、A-19～A-21 | ☐ PASS ☐ FAIL |
| 台账与预算 | A-01～A-03 | ☐ PASS ☐ FAIL |
| 边与豁免 | A-13～A-18、A-23 | ☐ PASS ☐ FAIL |
| 语义保真 | A-25、A-26 | ☐ PASS ☐ FAIL |
| 交付卫生 | A-24、A-27、A-28 | ☐ PASS ☐ FAIL |

---

## 附录 A：本次核验所用只读命令（可复现）

> 所有命令均在仓库根目录执行（`cd <repo>`）；`apps/server` 的别名为 `@/* → ./src/*`（`apps/server/tsconfig.json`）。
> 判据脚本**不落库**（AGENTS 约束），以 heredoc 直接执行，输出粘贴进 M3/M6 证据日志。

### A.1 模块文件/行数（HEAD = 237 / 14,349）

> B0 用下方 glob；FINAL 用 `apps/server/src/modules/**` 替代 `apps/server/src/utils/**`，并排除 `src/agent/**`；`src/utils/**` 必须为空。

```bash
python3 - <<'PY'
import glob, os
globs = ["apps/server/src/app.ts","apps/server/src/index.ts","apps/server/src/core.ts",
         "apps/server/src/router.ts","apps/server/src/utils.ts","apps/server/src/remoteConnection.ts",
         "apps/server/src/lib/**","apps/server/src/routes/**","apps/server/src/types/**",
         "apps/server/src/utils/**","apps/server/scripts/**"]
files = sorted(p for g in globs for p in glob.glob(g, recursive=True)
               if os.path.isfile(p) and p.endswith(".ts"))
print(len(files), sum(sum(1 for _ in open(p, encoding="utf-8", errors="ignore")) for p in files))
PY
# 期望：237 14349（实测，§0.5 E1）
```

### A.2 路由与端点基线（PH-B0 + PH-F 均适用，`routes/` 不移动）

```bash
find apps/server/src/routes -name '*.ts' | wc -l                       # 161
grep -c 'app.use' apps/server/src/router.ts                            # 161

# 端点提取必须锚定在路由对象上：现网只有三种注册写法 Router().<m>( / router.<m>( / app.<m>(
# 朴素写法把 Promise.all(、conf.get(、Map.delete( 也算成端点（会得到 187），因此必须锚定
grep -rhoE '(Router\(\)|router|app)\.(get|post|put|patch|delete|all)\(' apps/server/src/routes \
  | sed -E 's/.*\.//' | sort | uniq -c
# 期望：79 post / 51 get / 20 put / 10 delete / 2 patch / 0 all → 合计 162

# 交叉校验：161 个路由文件中仅 assets/usage.ts 注册 2 个端点，其余各 1 个
python3 - <<'PY'
import os, re, collections
pat = re.compile(r'(?:Router\(\)|router|app)\.(get|post|put|patch|delete|all)\(')
root = "apps/server/src/routes"
files = [os.path.join(dp, f) for dp, _, fs in os.walk(root) for f in fs if f.endswith(".ts")]
cnt = collections.Counter(); total = 0; zero = []; multi = []
for p in files:
    hits = pat.findall(open(p, encoding="utf-8", errors="ignore").read())
    total += len(hits); cnt.update(hits)
    if not hits: zero.append(p)
    if len(hits) > 1: multi.append((os.path.relpath(p, root), hits))
print("files", len(files), "endpoints", total, dict(cnt))
print("zero", zero, "multi", multi)
assert len(files) == 161 and total == 162 and not zero
PY
# 期望：files 161 endpoints 162 {'post': 79, 'get': 51, 'put': 20, 'delete': 10, 'patch': 2}；zero []；multi [('assets/usage.ts', ['get','post'])]
```

### A.3 聚合入口与深路径（**本版重写：四条各自可达的判据**）

> 为什么要改写：v4 的 PH-F 行用联合模式 `from "@/(utils|modules)` 却要求 145 —— 该模式在 B0 实测 **226**，与 145 无关（永不可达）；深路径的 246 在 F 也不成立（迁移后为 **252**）。本版把它拆成四条互不干扰的判据，每条都有实测或推导。

```bash
# ① PH-B0 facade：145 个文件 import 聚合入口（精确收尾引号，不含任何深路径）
grep -rl 'from "@/utils"' apps/server/src --include='*.ts' | wc -l      # 145
grep -rl 'from "@/utils"' apps/server/src/routes --include='*.ts' | wc -l  # 144
grep -rl 'from "@/utils"' apps/server/src/agent --include='*.ts' | wc -l   # 1
# 对账：144（非 agent）+ 1（agent/mentionFiles.ts:3）= 145

# ② PH-B0 深路径计数：246，逐段必须同时成立
grep -rho 'from "@/utils/[a-zA-Z]*' apps/server/src --include='*.ts' | wc -l   # 246
grep -rho 'from "@/utils/[a-zA-Z]*' apps/server/src/agent  --include='*.ts' | wc -l  # 50
grep -rho 'from "@/utils/[a-zA-Z]*' apps/server/src/routes --include='*.ts' | wc -l  # 62
grep -rho 'from "@/utils/[a-zA-Z]*' apps/server/src/utils  --include='*.ts' | wc -l  # 103
grep -o  'from "@/utils/[a-zA-Z]*' apps/server/src/utils.ts | wc -l                  # 30
grep -o  'from "@/utils/[a-zA-Z]*' apps/server/src/app.ts   | wc -l                  # 1
# 50 + 62 + 103 + 30 + 1 = 246（实测，§0.5 E7）

# ③ PH-F 深路径计数：252，逐段必须同时成立（与 ② 同额迁移 + app.ts 装配）
grep -rho 'from "@/modules/[a-zA-Z]*' apps/server/src --include='*.ts' | wc -l  # 252
grep -rho 'from "@/modules/[a-zA-Z]*' apps/server/src/agent  --include='*.ts' | wc -l  # 50
grep -rho 'from "@/modules/[a-zA-Z]*' apps/server/src/routes --include='*.ts' | wc -l  # 62
grep -rho 'from "@/modules/[a-zA-Z]*' apps/server/src/modules/** --include='*.ts' | wc -l  # 103（扣除 7 个入口后）
grep -o  'from "@/modules/[a-zA-Z]*' apps/server/src/utils.ts | wc -l                  # 30
grep -o  'from "@/modules/[a-zA-Z]*' apps/server/src/app.ts   | wc -l                  # 7
# 50 + 62 + 103 + 30 + 7 = 252
# 推导：app.ts 由 1 变 7（−1 静态 initializePlugins 移入 pluginMarket 入口，+7 装配 7 个入口）；
#       其余四段同额（R-07B/C 各 1/3 为 1:1 替换；R-07D 的 −2 与 +2 re-export 相抵，见 §1.6.5）

# ④ PH-F facade 计数：仍为 145（R-06 冻结调用面；命令与 ① 完全相同）
grep -rl 'from "@/utils"' apps/server/src --include='*.ts' | wc -l      # 145

# ⑤ PH-F 归零守卫：深路径说明符必须为 0（本行是 zero-guard，允许出现迁移前说明符）
grep -rn 'from "@/utils/' apps/server/src --include='*.ts' | wc -l      # expect 0 (zero-guard)
find apps/server/src -name '*.ts' | wc -l                               # scope_min=263 / scope_pred=272
```

> **判据归属**：①② 属 **PH-B0**；③④⑤ 属 **PH-F**。③ 的 `103` 段必须用“`src/modules/**` 总数减去 7 个入口文件内的 `from "@/modules/...` 行数”计算；因 7 个入口对自家域内文件使用相对路径（§1.6.2 例外），其实测值应为 **0**，故可直接用 `src/modules/**` 统计（A-28 `l2_relative` 守护该前提）。

### A.4 环的两端（两相）

```bash
# PH-B0
grep -rn 'from "@/agent' apps/server/src --include='*.ts' | grep -v '^apps/server/src/agent/' | wc -l   # 23
grep -rn 'from "@/utils' apps/server/src/agent --include='*.ts' | wc -l                                 # 51
grep -rn 'from "@/lib\|from "@/types' apps/server/src/agent --include='*.ts' | wc -l                    # 20
# 51 + 20 = 71（与地图 73 的差异见 §1.2(b)）

# PH-F（server→agent 期望 19；agent→server 仍 51 + 20，路径按 SPEC 归一化）
grep -rn 'from "@/agent' apps/server/src --include='*.ts' | grep -v '^apps/server/src/agent/' | wc -l   # 19
grep -rnE 'from "@/(utils|modules)' apps/server/src/agent --include='*.ts' | wc -l                      # 51
grep -rn 'from "@/lib\|from "@/types' apps/server/src/agent --include='*.ts' | wc -l                    # 20
```

### A.5 外部契约

```bash
python3 - <<'PY'
import json
p=json.load(open('apps/server/package.json'))
print(len(p.get('exports',{})), sorted(p.get('exports',{})))
PY
# 14 exports；键名必须与 B0 逐字一致
# target 允许按 SPEC 更新的 5 个键：./mcp、./mobileLink、./browser、./singleAgent/types、./remoteConnection
grep -rl '@toonflow/server/' --include='*.ts' --include='*.vue' apps packages compat 2>/dev/null | grep -v node_modules | wc -l  # 36
grep -rho '@toonflow/server/[a-zA-Z0-9/_-]*' --include='*.ts' --include='*.vue' apps packages compat 2>/dev/null | grep -v node_modules | wc -l  # 57
```

### A.6 file 级 SCC 审计（两相；解析式，不依赖说明符形态）

> 用途：A-17 的 `e6`、A-18 的环判定。别名 `@/*` → `apps/server/src/*`。`--sim` 模拟 R-07D（跳过 `conf → teams/mobileLink`）。

```bash
python3 - <<'PY'
import os, re, sys, glob, collections
SIM = "--sim" in sys.argv
ROOT = "apps/server/src"
globs = ["apps/server/src/app.ts","apps/server/src/index.ts","apps/server/src/core.ts","apps/server/src/router.ts",
         "apps/server/src/utils.ts","apps/server/src/remoteConnection.ts","apps/server/src/lib/**",
         "apps/server/src/routes/**","apps/server/src/types/**","apps/server/src/utils/**","apps/server/scripts/**"]
# PH-F 时把 utils/** glob 换成 modules/**（agent/** 始终排除）
if os.path.isdir("apps/server/src/modules"):
    globs = [g.replace("apps/server/src/utils/**", "apps/server/src/modules/**") for g in globs]
files = sorted(p for g in globs for p in glob.glob(g, recursive=True) if os.path.isfile(p) and p.endswith(".ts"))
FILESET = set(os.path.normpath(f) for f in files)
def resolve(spec, src):
    if spec.startswith("@/"): base = os.path.join(ROOT, spec[2:])
    elif spec.startswith("."): base = os.path.normpath(os.path.join(os.path.dirname(src), spec))
    else: return None
    for cand in (base + ".ts", os.path.normpath(os.path.join(base, "index.ts")), base):
        if cand in FILESET: return cand
    return None
edges = {f: set() for f in FILESET}
for f in sorted(FILESET):
    for line in open(f, encoding="utf-8", errors="ignore"):
        m = re.search(r'from\s+"([^"]+)"', line)
        if not m: continue
        spec = m.group(1)
        if spec == "@/utils": continue                     # facade 边不计 file SCC
        if SIM and f.endswith(("conf/index.ts",)) and spec.startswith(("@/utils/teams", "@/modules/pluginMarket/teams", "@/utils/mobileLink", "@/modules/localRuntime/mobileLink")):
            continue
        t = resolve(spec, f)
        if t and t != f: edges[f].add(t)
nodes = sorted(FILESET); adj = {n: list(edges[n]) for n in nodes}
radj = collections.defaultdict(list)
for n in nodes:
    for t in adj[n]: radj[t].append(n)
seen = set(); order = []
for n in nodes:
    if n in seen: continue
    stack = [(n, 0)]
    while stack:
        v, i = stack.pop()
        if i == 0:
            if v in seen: continue
            seen.add(v)
        if i < len(adj[v]):
            stack.append((v, i + 1)); t = adj[v][i]
            if t not in seen: stack.append((t, 0))
        else: order.append(v)
seen = set(); comps = []
for n in reversed(order):
    if n in seen: continue
    comp = []; stack = [n]; seen.add(n)
    while stack:
        v = stack.pop(); comp.append(v)
        for t in radj[v]:
            if t not in seen: seen.add(t); stack.append(t)
    comps.append(sorted(comp))
big = [c for c in comps if len(c) > 1]
print("files=", len(nodes), "scc_count=", len(big))
for c in big: print("  size", len(c), [os.path.relpath(x, "apps/server/src") for x in c])
PY
# PH-B0 期望：files= 237 scc_count= 2（size 15 + size 2）—— 实测通过（§0.5 E11）
# PH-B0 --sim 期望：scc_count=1（size 2）
# PH-F 期望：scc_count=1（size 2，成员 modules/mcpIntegration/mcp/{dxt,servers}.ts）；Q8 消除时 scc_count=0
```

### A.7 R-07 / R-03 判据（两相 + 四守卫）

#### A.7.0 判据工具（不落库；bash heredoc 执行，输出粘贴进 M3/M6 证据日志）

```bash
edge_check() { # edge_check <label> <phase> <expect> <scope_min> <ERE> <path>...
  local label=$1 phase=$2 expect=$3 smin=$4 ere=$5; shift 5
  local miss=0 s=0 n=0 verdict=FAIL
  for p in "$@"; do [ -e "$p" ] || { miss=1; echo "  missing=$p"; }; done
  if [ "$miss" -eq 0 ]; then
    s=$(find "$@" -name '*.ts' | wc -l | tr -d ' ')
    n=$(find "$@" -name '*.ts' -print0 | xargs -0 -I{} grep -hE -- "$ere" {} 2>/dev/null | wc -l | tr -d ' ')
  fi
  if [ "$miss" -eq 0 ] && [ "$n" -eq "$expect" ] && [ "$s" -ge "$smin" ] && [ "$s" -ge 1 ]; then verdict=PASS; fi
  printf 'check=%-4s phase=%-2s expect=%-3s scope_files=%-4s scope_min=%-3s hits=%-3s verdict=%s\n' \
    "$label" "$phase" "$expect" "$s" "$smin" "$n" "$verdict"
}

edge_lines() { local ere=$1; shift; find "$@" -name '*.ts' -print0 | xargs -0 -I{} grep -nHE -- "$ere" {} 2>/dev/null; }

file_count() { # file_count <label> <expect> <ERE> <file>
  local label=$1 expect=$2 ere=$3 f=$4 s=0 n=0 verdict=FAIL
  if [ -f "$f" ]; then s=1; n=$(grep -cE -- "$ere" "$f" | tr -d ' '); fi
  [ "$s" -eq 1 ] && [ "$n" -eq "$expect" ] && verdict=PASS
  printf 'check=%-5s phase=F  expect=%-3s scope_files=%-4s scope_min=%-3s hits=%-3s verdict=%s\n' \
    "$label" "$expect" "$s" "1" "$n" "$verdict"
}
```

> 守卫语义：路径缺失 → `missing=…` 且 FAIL（**G-EXIST**）；`scope_files < scope_min` 或 =0 → FAIL（**G-MATCH**）；`expect > 0` 必须同时给出 PH-B0 同 label 试跑或符号存在证明（**G-POS**）；`scope_files` **不得**作为 expect 参数出现（**G-SCOPE**，类型层面即不可能——它只是 `smin` 的下界）。

#### A.7.1 边 A（R-07A）：mentionSources 归零

```bash
# PH-B0
edge_lines 'from "@/agent/mentionSources"' apps/server/src/utils/assets apps/server/src/routes/assets apps/server/src/routes/workspaces
edge_check a1 B0 4 41 'from "@/agent/mentionSources"' apps/server/src/utils/assets apps/server/src/routes/assets apps/server/src/routes/workspaces
# 实测：check=a1 phase=B0 expect=4 scope_files=41 scope_min=41 hits=4 verdict=PASS

# PH-F
edge_check a2 F 0 41 'from "@/agent/mentionSources"' apps/server/src/modules/assetLibrary apps/server/src/routes/assets apps/server/src/routes/workspaces
# 期望：scope_files=42（scope_pred；= 9 assets + 1 入口 + 18 + 14）、scope_min=41、hits=0 → PASS
# 说明：L2 入口 modules/assetLibrary/index.ts 落入扫描范围，故 41→42；scope_min 仍为 41，判据不因此失效（§1.6.4）
```

> 第 4 轮打回 #1 的处置：R-07 表、A-13、本节、§A.7.9 **四处数字统一为 `scope_min=41` / `scope_pred=42`**；`scope_files` 不再出现在任何“期望值”里。

```bash
# PH-F：a3 计数迁移（server→agent 19；asset→platform 27；local→platform 76）
grep -rn 'from "@/agent' apps/server/src --include='*.ts' | grep -v '^apps/server/src/agent/' | wc -l   # 19
# assetLibrary→platformCore 与 localRuntime→platformCore 的计数由附录 A.11 脚本输出核对：
#   期望 assetLibrary -> platformCore lines=27 type=1 value=26
#        localRuntime -> platformCore lines=76 type=1 value=75
```

#### A.7.2 边 B（R-07B）：`pluginMarket → mediaGeneration` 契约化

```bash
# PH-B0
edge_check b1 B0 1 6 'from "@/(utils/media|modules/mediaGeneration/media)/provider"' apps/server/src/utils/plugins
edge_check b2 B0 0 32 'from "@/(utils/plugins|modules/pluginMarket/plugins)' apps/server/src/utils/media apps/server/src/routes/ai apps/server/src/routes/providers apps/server/src/routes/ffmpeg
# 实测：b1 scope_files=6 hits=1 PASS；b2 scope_files=32 hits=0 PASS
```

```bash
# PH-F（联合模式；35 与 32 见下注）
edge_check b3 F 0 32 'from "@/(utils/plugins|modules/pluginMarket/plugins)' apps/server/src/modules/mediaGeneration/media apps/server/src/routes/ai apps/server/src/routes/providers apps/server/src/routes/ffmpeg
edge_check b4 F 0 6 'from "@/(utils/media|modules/mediaGeneration/media)/provider"' apps/server/src/modules/pluginMarket/plugins
edge_lines 'from "@/modules/mediaGeneration"' apps/server/src/modules/pluginMarket/plugins
edge_check b5 F 1 6 'from "@/modules/mediaGeneration"' apps/server/src/modules/pluginMarket/plugins
file_count b5s 1 'addMediaProvider' apps/server/src/modules/mediaGeneration/index.ts
# 期望：b3 scope_files=32（mediaGeneration/media 7 + routes/{ai,providers,ffmpeg} 25）、hits=0；
#       b4 scope_files=6、hits=0；b5 hits=1 且整行为 import { addMediaProvider } from "@/modules/mediaGeneration";
#       b5s hits=1（G-POS ②：入口公开该符号）
```

#### A.7.3 边 C（R-07C）：`mcpIntegration → pluginMarket` 公开入口化

```bash
# PH-B0
edge_check c1 B0 1 7 'from "@/(utils/plugins|modules/pluginMarket/plugins)/install"' apps/server/src/utils/mcp
edge_check c2 B0 1 7 'from "@/(utils/plugins|modules/pluginMarket/plugins)/tools"'   apps/server/src/utils/mcp
edge_check c3 B0 1 7 'from "@/(utils/skills|modules/pluginMarket/skills)/files"'     apps/server/src/utils/mcp
# 实测：c1=c2=c3 scope_files=7 hits=1 PASS
```

```bash
# PH-F
edge_check c4 F 0 7 'from "@/(utils/plugins|modules/pluginMarket/plugins)/install"' apps/server/src/modules/mcpIntegration/mcp
edge_check c5 F 0 7 'from "@/(utils/plugins|modules/pluginMarket/plugins)/tools"'   apps/server/src/modules/mcpIntegration/mcp
edge_check c6 F 0 7 'from "@/(utils/skills|modules/pluginMarket/skills)/files"'     apps/server/src/modules/mcpIntegration/mcp
edge_lines 'from "@/modules/pluginMarket"' apps/server/src/modules/mcpIntegration/mcp
edge_check c7 F 3 7 'from "@/modules/pluginMarket"' apps/server/src/modules/mcpIntegration/mcp
file_count c7s 3 '(decodeText|listTools|skillFiles)' apps/server/src/modules/pluginMarket/index.ts
file_count c8a 7 'skillFile\.' apps/server/src/modules/mcpIntegration/mcp/resources.ts
file_count c8b 4 'decodeText|skillPath|skillZip' apps/server/src/modules/mcpIntegration/mcp/dxt.ts
edge_lines 'export \* as skillFiles from "\./skills/files"' apps/server/src/modules/pluginMarket/index.ts
edge_lines 'export \{ decodeText, skillPath, skillZip \} from "\./plugins/install"' apps/server/src/modules/pluginMarket/index.ts
edge_lines 'export \{ listTools \} from "\./plugins/tools"' apps/server/src/modules/pluginMarket/index.ts
# 期望：c4=c5=c6 scope_files=7 hits=0；c7 hits=3；c7s hits=3；c8a=7；c8b=4（B0 同值，见 §R-07 表）；
#       c9 三条 edge_lines 各输出 1 行（逐字存在，相对路径）
```

#### A.7.4 边 D（R-07D）：`conf` 的 2 条 type 边归零

```bash
# PH-B0
edge_check d1 B0 2 1 'from "@/(utils/teams|modules/pluginMarket/teams|utils/mobileLink|modules/localRuntime/mobileLink)' apps/server/src/utils/conf
edge_check d2 B0 4 4 'from "@/(utils/conf|modules/platformCore/conf)' apps/server/src/utils/teams apps/server/src/utils/mobileLink
# 实测：d1 scope_files=1 hits=2；d2 scope_files=4 hits=4
```

```bash
# PH-F
edge_check d3 F 0 1 'from "@/(utils/teams|modules/pluginMarket/teams|utils/mobileLink|modules/localRuntime/mobileLink)' apps/server/src/modules/platformCore/conf
edge_check d4 F 4 4 'from "@/(utils/conf|modules/platformCore/conf)' apps/server/src/modules/pluginMarket/teams apps/server/src/modules/localRuntime/mobileLink
# 期望：d3 scope_files=1 hits=0；d4 scope_files=4 hits=4
# d5（§A.11 输出）：platformCore→pluginMarket 0；platformCore→localRuntime 1 value；platformCore→mediaGeneration 1 value
```

#### A.7.5 边 E11（R-07E）：`dxt ↔ servers`

```bash
# PH-B0
edge_check e1 B0 1 1 'from "@/(utils/mcp|modules/mcpIntegration/mcp)/servers"' apps/server/src/utils/mcp/dxt.ts
edge_check e2 B0 1 1 'from "@/(utils/mcp|modules/mcpIntegration/mcp)/dxt"'     apps/server/src/utils/mcp/servers.ts
# 实测：e1=e2 scope_files=1 hits=1 PASS
```

```bash
# PH-F（联合模式；alias 形态冻结，见 e5）
edge_check e3 F 1 1 'from "@/(utils/mcp|modules/mcpIntegration/mcp)/servers"' apps/server/src/modules/mcpIntegration/mcp/dxt.ts
edge_check e4 F 1 1 'from "@/(utils/mcp|modules/mcpIntegration/mcp)/dxt"'     apps/server/src/modules/mcpIntegration/mcp/servers.ts
file_count e5a 0 'from "\.{1,2}/' apps/server/src/modules/mcpIntegration/mcp/dxt.ts
file_count e5b 0 'from "\.{1,2}/' apps/server/src/modules/mcpIntegration/mcp/servers.ts
# 期望：e3=e4 hits=1；e5a=e5b hits=0（B0 同值：utils/mcp 目录内相对 import = 0）
# e6：file 级 SCC，见附录 A.6（期望 scc_count=1、size=2）
```

#### A.7.6 R-03 步骤 5（缩略图预热）语义保真（A-25）

```bash
# PH-F
file_count f1a 0 'await[^;]*warmup' apps/server/src/app.ts
file_count f1b 1 'warmup\('           apps/server/src/app.ts
# 期望：f1a=0（不 await）、f1b=1（唯一调用点）
# f2：默认数据目录 = <repo>/data，显式目录生效（见 A.7.7 的 g 组与 §R-02 静态导入边界）
# f3a：入口 0 处 console.*；f3b：thumb.ts 内保留 1 处 console.warn("缩略图清扫失败"
file_count f3a 0 'console\.' apps/server/src/modules/assetLibrary/index.ts
file_count f3b 1 '缩略图清扫失败' apps/server/src/modules/assetLibrary/assets/thumb.ts
# f4：只读注入下 createApp 仍 resolve、无 unhandledRejection（运行时探针）
# f5：连续两次 createApp 不重复安装（运行时探针）
```

#### A.7.7 初始化 15 步阻塞性 / 错误语义（A-26）

```bash
# PH-F
file_count g1 0 'await[^;]*warmup' apps/server/src/modules/assetLibrary/index.ts
file_count g2 1 'void .*import\("\./assets/thumb"\)|void import\(' apps/server/src/modules/assetLibrary/index.ts
file_count g3 1 'catch\(\(\) => \{\}\)' apps/server/src/modules/assetLibrary/index.ts
file_count g4 1 'initializeProviderModels\(\)\.catch' apps/server/src/modules/mediaGeneration/index.ts
file_count g4b 4 'import\(' apps/server/src/modules/mcpIntegration/index.ts
edge_lines 'const app = express\(\)|app\.locals\.builtinPlugins|getRuntimePlatform\(\)\.development' apps/server/src/app.ts
file_count g6a 1 'Buffer\.alloc\(0\)' apps/server/src/modules/mediaGeneration/index.ts
file_count g6b 1 'createHash\("sha256"\)' apps/server/src/modules/mediaGeneration/index.ts
# 期望：g1=0；g2=1；g3=1（空 catch 逐字保留）；g4=1（warn 型）；g4b=4（4 个动态 import）；
#       g5 行号顺序：express() < builtinPlugins < development；g6a=g6b=1
```

#### A.7.8 判据对照表（label → phase → expect → scope_min → scope_pred）

| label | phase | expect | scope_min | scope_pred（F，仅说明） | 证据 |
| --- | --- | --- | --- | --- | --- |
| a1 | B0 | 4 | 41 | — | `assets/index.ts:5`、`assets/library.ts:5`、`assets/thumb.ts:4`、`workspaces/files/thumb.ts:10` |
| a2 | F | 0 | 41 | **42** | A-13（第 4 轮打回 #1 的修正点） |
| b1 | B0 | 1 | 6 | — | `plugins/install.ts:11` |
| b2 | B0 | 0 | 32 | — | 反向基线 |
| b3 | F | 0 | 32 | 32 | mediaGeneration/media 7 + routes 25 |
| b4 | F | 0 | 6 | 6 | 前向深路径归零 |
| b5 | F | 1 | 6 | 6 | 必须为 `import { addMediaProvider } from "@/modules/mediaGeneration";` |
| b5s | F | 1 | 1（文件） | — | G-POS ②：入口公开符号 |
| c1–c3 | B0 | 1/1/1 | 7 | — | `dxt.ts:9`、`tools.ts:13`、`resources.ts:6` |
| c4–c6 | F | 0/0/0 | 7 | 7 | 深路径归零 |
| c7 | F | 3 | 7 | 7 | 公开入口 3 行 |
| c7s | F | 3 | 1（文件） | — | 入口三组符号 |
| c8a/c8b | F | 7 / 4 | 1（文件） | — | 调用面不变 |
| c9 | F | 3 行逐字存在 | 1（文件） | — | 入口 re-export（相对路径） |
| d1 | B0 | 2 | 1 | — | `conf/index.ts:5`、`:8` |
| d2 | B0 | 4 | 4 | — | 反向 value |
| d3 | F | 0 | 1 | 1 | conf 侧归零 |
| d4 | F | 4 | 4 | 4 | 反向 value 不变 |
| d5 | F | 0 / 1 / 1 | §A.11 | — | platformCore→pluginMarket / →localRuntime / →mediaGeneration |
| e1/e2 | B0 | 1 / 1 | 1 | — | `dxt.ts:10`、`servers.ts:8` |
| e3/e4 | F | 1 / 1 | 1 | 1 | 两相均为 1（可达性由 e1/e2 证明） |
| e5a/e5b | F | 0 / 0 | 1（文件） | — | 形态冻结 |
| e6 | F | `scc_count=1,size=2` | §A.6 | — | file SCC |
| f1a/f1b | F | 0 / 1 | 1（文件） | — | 步骤 5 非阻塞 |
| f3a/f3b | F | 0 / 1 | 1（文件） | — | 静默吞错（入口无日志、内部 warn 保留） |
| f4/f5 | F | 运行时探针 | — | — | resolve / 幂等 |
| g1–g6 | F | 见 A.7.7 | 1（文件）/ §A.11 | — | 15 步语义矩阵 |

#### A.7.9 运行时守卫证据要求（A-28 的运行时部分）

| 守卫 | 触发条件 | 证据行字段 | 期望 |
| --- | --- | --- | --- |
| G-EXIST | 任一扫描路径不存在 | `missing=<path>` + `verdict=FAIL` | 0 次 |
| G-MATCH | `scope_files = 0` 或 `< scope_min` | `scope_files` 与 `scope_min` 并列输出 | 0 次 |
| G-POS | `expect > 0` 且无 B0 试跑/符号证明 | 对照表 §A.7.8 的 B0 行或 `b5s/c7s` | 0 次 |
| G-SCOPE | 任何判据把 `scope_files` 当作 expect | 由参数顺序（`smin` 单列）结构性排除 | 0 次 |

```text
# 汇总行（M3/M6 证据包首行）
guards: missing_path_guard=0 vacuous_zero=0 reachability_miss=0 scope_assertions=0
```

### A.8 地图 228 与 HEAD 237 对账

```bash
python3 - <<'PY'
import json
d=json.load(open('.easyvibe/map/modules/server-api.json'))
files=d['parent']['files_snapshot']
print('map snapshot:', len(files), sum(sum(1 for _ in open(p,encoding='utf-8',errors='ignore')) for p in files))
# 期望：228 13955
PY
for f in \
  apps/server/src/routes/agent/compact.ts apps/server/src/routes/agent/fork.ts \
  apps/server/src/routes/agent/rewind.ts apps/server/src/routes/ai/generate/stop.ts \
  apps/server/src/routes/sessionState/get.ts apps/server/src/routes/sessionState/patch.ts \
  apps/server/src/routes/workspaces/files/thumb.ts apps/server/src/utils/ai/runs.ts \
  apps/server/src/utils/sessionState/index.ts; do printf "%-60s %s\n" "$f" "$(wc -l < $f)"; done
# 9 文件合计 394 行；228+9=237，13955+394=14349
```

### A.9 基线质量（M0 在实施环境执行）

```bash
cd apps/server && bun run typecheck
cd apps/server && bun run build
# build/server 产物启动验证（A-19）
```

### A.10 L1/L2/L3 审计伪代码（R-12）

```text
B0     = git ls-tree -r --name-only d084136 -- apps/server | filter(.ts, §A.1 B0 glob)
MOVED  = explicit old->new map (§1.6.2: 15 域目录 + 5 顶层工具 + remoteConnection.ts)
EXPECTED = apply(MOVED, B0) ∪ L2
FINAL  = find apps/server -name '*.ts' | filter(FINAL glob: modules/** + lib/** + routes/** + types/** + bootstrap 文件 + scripts/**; exclude agent/**; utils/** 必须为空)
assert FINAL == EXPECTED
NEW    = FINAL - apply(MOVED, B0)
DELETED= B0 - MOVED.keys
L1 = assign(B0)     -> {total:237, assigned:237, unassigned:0, duplicated:0}
L2 = NEW            -> {total:9,  unregistered:0, paths:§3.3}
L3 = assign(EXPECTED)-> {total:246, assigned:246, unassigned:0, duplicated:0}
assert L3.total == L1.total + L2.total
assert per_module_business <= 50 and per_module_final <= 55 and per_module_lines <= 3300 and bootstrap <= 900 and entry <= 60
```

### A.11 模块级直接边复算脚本（§2.4 / A-18 / d5 的权威来源）

> 用途：把 import 行按“模块归属 + type/value”聚合，输出 20 条域间边（另有 7 条 bootstrap→模块、7 条模块→bootstrap facade 行）。**两相通用**（只依赖当前工作树的路径与 §3.3 L1 glob；PH-F 时 `src/utils/**` 已不存在，脚本会自动落到 `src/modules/**` 的说明符解析）。
> 实测（B0）：与 §2.4 表逐行一致；`unowned_files=0`；agent 边 8/5/3/3/2/1/1（合计 23）。

```bash
python3 - <<'PY'
import os, re, glob, collections
P = "apps/server/"
def owner(p):
    r = p[len(P):]
    if r in ("src/app.ts","src/index.ts","src/core.ts","src/router.ts","src/utils.ts") or r.startswith("scripts/"): return "bootstrap"
    if r.startswith(("src/utils/assets/","src/routes/assets/")): return "assetLibrary"
    if r.startswith(("src/utils/ai/","src/utils/media/","src/utils/ffmpeg/","src/routes/ai/","src/routes/providers/","src/routes/ffmpeg/")) or r=="src/utils/documents.ts": return "mediaGeneration"
    if r.startswith(("src/utils/plugins/","src/utils/skills/","src/utils/teams/","src/routes/tools/","src/routes/nodes/","src/routes/ext/","src/routes/skills/","src/routes/agents/","src/routes/plugins/")): return "pluginMarket"
    if r.startswith(("src/utils/mcp/","src/routes/mcp/")): return "mcpIntegration"
    if r.startswith(("src/utils/workspace/","src/utils/desktop/","src/utils/mobileLink/","src/routes/workspaces/","src/routes/desktop/","src/routes/exec/","src/routes/mobileLink/")) or r in ("src/utils/exec.ts","src/remoteConnection.ts"): return "localRuntime"
    if r.startswith(("src/utils/singleAgent/","src/utils/sessionState/","src/utils/browser/","src/routes/agent/","src/routes/singleAgent/","src/routes/browser/","src/routes/sessionState/")) or r=="src/routes/agent.ts": return "agentAccess"
    if r.startswith(("src/lib/","src/utils/conf/","src/routes/settings/","src/routes/monitor/")) or r in ("src/utils/monitor.ts","src/utils/personalization.ts","src/utils/fileHttp.ts") or r.startswith("src/types/"): return "platformCore"
    if r.startswith("src/agent/"): return "agent"
    return None
globs=["apps/server/src/app.ts","apps/server/src/index.ts","apps/server/src/core.ts","apps/server/src/router.ts",
       "apps/server/src/utils.ts","apps/server/src/remoteConnection.ts","apps/server/src/lib/**","apps/server/src/routes/**",
       "apps/server/src/types/**","apps/server/src/utils/**","apps/server/scripts/**"]
files=sorted(p for g in globs for p in glob.glob(g,recursive=True) if os.path.isfile(p) and p.endswith(".ts"))
fileset=set(os.path.normpath(f) for f in files)
cnt=collections.defaultdict(collections.Counter); unowned=[]
ire=re.compile(r'^\s*import\s+(type\s+)?(.*?)\s+from\s+"([^"]+)"')
for f in files:
    o=owner(f)
    if o is None: unowned.append(f); continue
    for line in open(f,encoding="utf-8",errors="ignore"):
        m=ire.match(line)
        if not m: continue
        istype = bool(m.group(1)) or m.group(2).startswith("type ")
        spec=m.group(3)
        if spec=="@/utils": tgt="bootstrap"
        elif spec.startswith("@/agent"): tgt="agent"
        elif spec.startswith(("@/utils/","@/modules/","@/lib","@/types")):
            g="src/"+spec[2:]; tgt=None
            for cand in (g+".ts", g+"/index.ts"):
                if os.path.normpath("apps/server/"+cand) in fileset: tgt=owner("apps/server/"+cand); break
            if tgt is None: print("UNRESOLVED", f, spec); continue
        else: continue
        if tgt==o: continue
        cnt[(o,tgt)]["lines"]+=1; cnt[(o,tgt)]["type" if istype else "value"]+=1
print("unowned_files=", len(unowned))
for (s,t),c in sorted(cnt.items()):
    print(f"{s:15s} -> {t:15s} lines={c['lines']:3d} type={c['type']:2d} value={c['value']:3d}")
PY
```

### A.12 判据自审脚本（A-27 文档层；无需实施完成即可运行）

> 用途：机械发现三类回归 —— ① A 行缺 Phase 标注；② PH-F 块使用迁移前说明符；③ 未标注块使用 B0 说明符。
> 例外：**zero-guard 行**（同一行含 `zero-guard` 注释）允许在 PH-F 块内出现 B0 说明符 —— 这类行只用于“证明旧说明符已归零”（§A.3 ⑤）。

```bash
python3 - <<'PY'
import re, sys
DOC = ".easyvibe/development_docs/liyuhang/1_requirements_matrix/2026-10-26-22-55-serverApiSubmoduleSplit-v5.md"
lines = open(DOC, encoding="utf-8").read().splitlines()

# 规则 1：A 行必须有 Phase 标注（| B0 | / | F | / | B0+F |）
rows, untagged = 0, []
for ln in lines:
    norm = ln.replace("*", "")
    if re.match(r'^\|\s*A-\d\d\s*\|', norm):
        rows += 1
        if not any(p in norm for p in ("| B0 |", "| F |", "| B0+F |")):
            untagged.append(ln[:70])

# 规则 2/3：命令块内的说明符必须与 phase 一致（zero-guard 豁免）
SPEC_B0 = 'from "@' + '/utils/'
phase, stale, unlabeled, in_fence = None, [], [], False
for ln in lines:
    if ln.startswith("```"):
        in_fence = not in_fence; phase = None; continue
    if "PH-B0" in ln: phase = "B0"
    elif "PH-F" in ln: phase = "F"
    if not in_fence: continue
    if "zero-guard" in ln: continue
    if phase == "F" and SPEC_B0 in ln: stale.append(ln.strip()[:90])
    if phase is None and SPEC_B0 in ln: unlabeled.append(ln.strip()[:90])

print(f"criteria_total={rows}")
print(f"criteria_phase_tagged={rows - len(untagged)}")
print(f"stale_specifier_in_PHF={len(stale)}")
print(f"unlabeled_utils_command={len(unlabeled)}")
for x in untagged: print("  untagged:", x)
for x in stale: print("  stale:", x)
for x in unlabeled: print("  unlabeled:", x)
ok = rows == 28 and not untagged and not stale and not unlabeled
print("doc_audit=" + ("PASS" if ok else "FAIL"))
sys.exit(0 if ok else 1)
PY
# 本文档实测（2026-10-26 23:00）：criteria_total=28 criteria_phase_tagged=28
#   stale_specifier_in_PHF=0 unlabeled_utils_command=0 doc_audit=PASS
# 非空转验证：对 v3 文档 → criteria_total=24 / tagged=0 → FAIL；对 v4 文档 → rows=27 ≠ 28 → FAIL
```

### A.13 数值台账自审脚本（A-28 文档层；无需实施完成即可运行）

> 用途：① 台账行数；② 每行“相位/来源”必须非空；③ §6.5 的“期望值”列不得出现 `scope_files`（G-SCOPE）；④ 对 L01–L20 的 B0 探针复算，任何不一致即 `probe_mismatch>0`。

```bash
python3 - <<'PY'
import re, sys, glob, os, json, subprocess
DOC = ".easyvibe/development_docs/liyuhang/1_requirements_matrix/2026-10-26-22-55-serverApiSubmoduleSplit-v5.md"
lines = open(DOC, encoding="utf-8").read().splitlines()

# ①～③ 文档层
ledger, bad_rows = 0, []
for ln in lines:
    m = re.match(r'^\|\s*(L\d\d)\s*\|', ln)
    if not m: continue
    ledger += 1
    cells = [c.strip() for c in ln.strip().strip("|").split("|")]
    if len(cells) < 6 or not cells[3] or not cells[4]: bad_rows.append(ln[:80])

crit_rows, scope_assertions = 0, []
for ln in lines:
    if re.match(r'^\|\s*A-\d\d\s*\|', ln.replace("*", "")):
        crit_rows += 1
        cells = [c.strip() for c in ln.strip().strip("|").split("|")]
        if len(cells) >= 5 and "scope_files" in cells[4]: scope_assertions.append(ln[:80])

# ④ B0 探针（只复算可在当前 HEAD 直接测得的项）
def sh(cmd):
    return subprocess.run(cmd, shell=True, capture_output=True, text=True).stdout.strip()
py = lambda code: sh(f"python3 -c {json.dumps(code)}")
probe = {
 "L01_files": int(py("import glob,os;g=['apps/server/src/app.ts','apps/server/src/index.ts','apps/server/src/core.ts','apps/server/src/router.ts','apps/server/src/utils.ts','apps/server/src/remoteConnection.ts','apps/server/src/lib/**','apps/server/src/routes/**','apps/server/src/types/**','apps/server/src/utils/**','apps/server/scripts/**'];f=[p for x in g for p in glob.glob(x,recursive=True) if os.path.isfile(p) and p.endswith('.ts')];print(len(f))")),
 "L03_routes": int(sh("find apps/server/src/routes -name '*.ts' | wc -l")),
 "L04_endpoints": int(sh("grep -rhoE '(Router\\(\\)|router|app)\\.(get|post|put|patch|delete|all)\\(' apps/server/src/routes | wc -l")),
 "L05_use": int(sh("grep -c 'app.use' apps/server/src/router.ts")),
 "L06_app_lines": int(sh("wc -l < apps/server/src/app.ts")),
 "L07_utils_lines": int(sh("wc -l < apps/server/src/utils.ts")),
 "L08_facade": int(sh("grep -rl 'from \"@/utils\"' apps/server/src --include='*.ts' | wc -l")),
 "L10_deep": int(sh("grep -rho 'from \"@/utils/[a-zA-Z]*' apps/server/src --include='*.ts' | wc -l")),
 "L12_server2agent": int(sh("grep -rn 'from \"@/agent' apps/server/src --include='*.ts' | grep -v '^apps/server/src/agent/' | wc -l")),
 "L13_agent2server": int(sh("grep -rn 'from \"@/utils' apps/server/src/agent --include='*.ts' | wc -l")) + int(sh("grep -rn 'from \"@/lib\\|from \"@/types' apps/server/src/agent --include='*.ts' | wc -l")),
 "L14_src_ts": int(sh("find apps/server/src -name '*.ts' | wc -l")),
 "L19_exports": len(json.load(open("apps/server/package.json")).get("exports", {})),
}
expect = {"L01_files":237,"L03_routes":161,"L04_endpoints":162,"L05_use":161,"L06_app_lines":160,"L07_utils_lines":75,
          "L08_facade":145,"L10_deep":246,"L12_server2agent":23,"L13_agent2server":71,
          "L14_src_ts":263,"L19_exports":14}
mismatch = {k:(v,expect[k]) for k,v in probe.items() if v != expect[k]}
print(f"ledger_rows={ledger}")
print(f"bad_ledger_rows={len(bad_rows)}")
print(f"criteria_rows={crit_rows}")
print(f"scope_assertions={len(scope_assertions)}")
print(f"probe={probe}")
print(f"probe_mismatch={len(mismatch)} {mismatch}")
ok = ledger == 23 and not bad_rows and not scope_assertions and not mismatch
print("ledger_probe=" + ("PASS" if ok else "FAIL"))
sys.exit(0 if ok else 1)
PY
# 期望：ledger_rows=23 bad_ledger_rows=0 criteria_rows=28 scope_assertions=0 probe_mismatch=0 ledger_probe=PASS
# 非空转验证：把 §6.5 某行的期望改成含 scope_files → scope_assertions=1 → FAIL；
#             把台账 L20 的 21 改成 22 → probe_mismatch=1 → FAIL
```

### A.14 21 个 `/api/*` 前缀清单生成脚本（§3.6 / A-07 / A-20 的权威来源）

> 用途：机械生成 §3.6 的表（前缀 / 路由文件数 / 端点数 / 归属模块 / 首端点），并与 7 个入口的 `routePrefixes` 做集合比对。
> 语义：URL 由 `src/core.ts` 的 `fileNameToRoutePath` 决定（`routes/<seg>/...` → `/api/<seg>/...`；`index` 段被消去）；`routes/agent.ts` 与 `routes/agent/**` 同属 `agent`。

```bash
python3 - <<'PY'
import os, re, json
root = "apps/server/src/routes"
OWNER = {"assets":"assetLibrary","ai":"mediaGeneration","providers":"mediaGeneration","ffmpeg":"mediaGeneration",
         "agents":"pluginMarket","ext":"pluginMarket","nodes":"pluginMarket","plugins":"pluginMarket",
         "skills":"pluginMarket","tools":"pluginMarket","mcp":"mcpIntegration",
         "desktop":"localRuntime","exec":"localRuntime","mobileLink":"localRuntime","workspaces":"localRuntime",
         "agent":"agentAccess","browser":"agentAccess","sessionState":"agentAccess","singleAgent":"agentAccess",
         "monitor":"platformCore","settings":"platformCore"}
EP = re.compile(r'(?:Router\(\)|router|app)\.(get|post|put|patch|delete|all)\(')
LIT = re.compile(r'([\"' + "'" + '`])([^\"' + "'" + '`]*)\\1')
def route_path(rel):
    p = re.sub(r"\.ts$", "", rel.replace(os.sep, "/"))
    p = re.sub(r"\[([^\]]+)\]", lambda m: "*" if m.group(1).startswith("...") else ":" + m.group(1), p)
    if p == "index": return "/"
    p = re.sub(r"/index$", "", p)
    return "/" + re.sub(r"/+", "/", p).strip("/")
files = sorted(os.path.relpath(os.path.join(dp, f), root)
               for dp, _, fs in os.walk(root) for f in fs if f.endswith(".ts"))
segs = {}
for rel in files:
    seg = rel.split(os.sep)[0]
    if seg.endswith(".ts"): seg = seg[:-3]
    segs.setdefault(seg, []).append(rel)
rows, eps_total, files_total = [], 0, 0
for seg in sorted(segs):
    eps = 0; first = None
    for rel in sorted(segs[seg]):
        txt = open(os.path.join(root, rel), encoding="utf-8", errors="ignore").read()
        for m in EP.finditer(txt):
            eps += 1
            if first is None:
                q = LIT.search(txt[m.end():m.end() + 80])
                base = "/api" + route_path(rel)
                lit = q.group(2) if q else ""
                first = f"{m.group(1).upper()} {base if lit in ('', '/') else base.rstrip('/') + lit}"
    rows.append({"prefix": "/api/" + seg, "owner": OWNER[seg], "files": len(segs[seg]),
                 "endpoints": eps, "first": first})
    eps_total += eps; files_total += len(segs[seg])
print(json.dumps(rows, ensure_ascii=False, indent=1))
print(f"prefixes={len(rows)} route_files={files_total} endpoints={eps_total}")
assert len(rows) == 21 and files_total == 161 and eps_total == 162
assert len({r["prefix"] for r in rows}) == 21
print("prefix_manifest=PASS")
PY
# 实测（§0.5 E14）：prefixes=21 route_files=161 endpoints=162 prefix_manifest=PASS
# A-07 的比对口径：入口 routePrefixes 的并集（去重）== 本脚本输出的 21 个 prefix（集合相等），且两两交集为空
```

---

## 附录 B：与第 4 版的关键差异（逐条）

| # | 位置 | 第 4 版 | 第 5 版 | 类型 |
| --- | --- | --- | --- | --- |
| 1 | R-07 表 / A-13 / §A.7.1 / §A.7.8 | a2 `scope=60`（R-07 写 41） | `scope_min=41`、`scope_pred=42`，四处一致 | **打回 #1 修正** |
| 2 | §1.6.4（新增） | 无；`scope_files` 被当断言 | `scope_files` 观测化 + `scope_min` 下界 + G-SCOPE 守卫 | **打回 #1 结构修复** |
| 3 | §A.3 | PH-F 联合模式要求 145（B0 实测 226）；深路径 246 只在 B0 成立 | 拆为四条：facade 145（两相）、深路径 246（B0）/ 252（F，逐段）、`@/utils/` 归零（`scope_min=263`） | **打回 #2 修正** |
| 4 | §3.6（新增） | 不存在；A-07 悬空引用 §3.4 | 21 前缀清单（归属/文件/端点/首端点）+ §A.14 生成脚本 | **打回 #3 修正** |
| 5 | §1.6.5（新增） | 未区分计数口径 | A.3 计 `from` 行（含 `export … from`）；A.11 只计 `import` 行；A.6 建边含 re-export | 新增 |
| 6 | R-04 验收第 3 条 | `scope_files ≥ 500`（恒假） | `scope_min=263` / `scope_pred=272` | 自查 S1 |
| 7 | §1.2(b)（新增） | 未登记地图 28/73 与可执行口径 23/71 的差异 | 差异登记 + 口径声明（验收只认可复现口径） | 自查 S2 |
| 8 | §6.9（新增） | 无数值台账 | L01–L23 + 探针 | 新增 |
| 9 | A-28（新增） | 无 | 数值台账自审（`unreachable=0`、`scope_assertions=0`、`ledger_probe=PASS`） | 新增 |
| 10 | §A.13（新增） | 无 | 台账自审脚本（含 B0 探针） | 新增 |
| 11 | §A.7.0 | `edge_check <label> <phase> <expect> <ERE>` | `edge_check <label> <phase> <expect> <scope_min> <ERE>`（scope 在类型上无法成为断言） | 结构修复 |
| 12 | §0.5（新增） | 无 | 本轮 14 组实测证据 | 新增 |
| 13 | §A.12 | 规则 2 会误伤 zero-guard 行 | 增加 zero-guard 豁免（同块内仅该行允许） | 修正 |
| 14 | A-27 期望 | `criteria_total=27` | `criteria_total=28`（+A-28） | 计数更新 |
| 15 | §6.5 A-12 | “14 exports” | “14 exports，**键名**逐字不变，5 个 target 随 SPEC 更新” | 精确化 |
| 16 | §R-07E / A-17 | 已两相化 | 保持（本轮实测 e1/e2 PASS） | 不变 |

---

## 附录 C：直接边矩阵、模块 SCC、file SCC、依赖白名单

### C.1 直接域边基线（20 条；与 §2.4 一致）

见 §2.4 表；权威复算脚本为 §A.11。要点：

- 基线合计出入：20 条域间边（不含 bootstrap 两侧）。
- R-07 后允许变化的仅 4 处：#5 `24→27`（+3，`@/lib/mentionSources`：2 value + 1 type）、#8 `75→76`（+1 value）、#15 `2→1`（消 1 type）、#17 `1→0`（消 1 type）。
- #12（3）与 #19（1）**只契约化、不减计数**（深路径归零但入口 import 计数不变）。

### C.2 模块 SCC

| SCC | 成员 | 处理 |
| --- | --- | --- |
| SCC-1 | assetLibrary、localRuntime、mediaGeneration、platformCore、pluginMarket | 基线事实（E12）；只约束“不出现新环 / 边计数不超预期” |
| SCC-2 | agentAccess | 单点 |
| SCC-3 | mcpIntegration | 单点 |
| 含 bootstrap | 全部 8 个 | facade 枢纽环（E12）；`utils.ts` 保留（Q3） |

### C.3 file SCC（B0 实测：2 个）

| SCC | size | 成员 | 触发边 |
| --- | --- | --- | --- |
| ① | 15 | `utils/conf/index.ts`、`utils/teams/{index,files,install}.ts`、`utils/mobileLink/index.ts`、`utils/plugins/{install,tools,nodes,ext}.ts`、`utils/skills/files.ts`、`utils/media/provider.ts`、`utils/ffmpeg/index.ts`、`utils/ai/visibility.ts`、`utils/workspace/{index,files}.ts` | `conf → teams`（type）、`conf → mobileLink`（type） |
| ② | 2 | `utils/mcp/dxt.ts`、`utils/mcp/servers.ts` | 互相 import（E11） |

> R-07D 后 ① 消失（`--sim` 实测 `scc_count=1`）；② 由 E11 冻结。

### C.4 依赖白名单（入口 `dependencies` 的取值域）

| 模块 | 允许依赖（域边白名单） |
| --- | --- |
| assetLibrary | platformCore、localRuntime、mediaGeneration（E10） |
| mediaGeneration | platformCore、localRuntime |
| pluginMarket | platformCore、localRuntime、mediaGeneration（R-07B 契约） |
| mcpIntegration | platformCore、localRuntime（E10）、mediaGeneration（E10）、pluginMarket（R-07C 契约） |
| localRuntime | platformCore、assetLibrary、mediaGeneration（E10） |
| agentAccess | platformCore、pluginMarket（E10） |
| platformCore | localRuntime（1 value，E10）、mediaGeneration（1 value，E10） |
| bootstrap | 全部 7 个入口（**组合契约，不算域边**） |

> `dependencies` 必须是本表子集；E10 条目允许存在但不得新增第 2 条。

---

## 附录 D：L2 新文件台账（9 个）

见 §3.3 L2 表；补充约束：

| # | 文件 | 必须包含 | 禁止包含 |
| --- | --- | --- | --- |
| 1 | `modules/assetLibrary/index.ts` | `export default` 一个 `ServerModule`；`warmup`（同步 void、动态 import `./assets/thumb`、空 catch） | 任何 `console.*`、`await warmup`、静态 import `conf`/`thumb` |
| 2 | `modules/mediaGeneration/index.ts` | `initializeProviders`（哈希 + ENOENT 容错）、`refreshModels`（`void` + warn）、`addMediaProvider` re-export | import `pluginMarket`（必须走 ctx）、`await` refresh |
| 3 | `modules/pluginMarket/index.ts` | 五类初始化 + `scanBuiltin` + `syncDirectory` + 三组 re-export（`decodeText/skillPath/skillZip`、`listTools`、`skillFiles`） | 业务实现搬家（只做编排） |
| 4 | `modules/mcpIntegration/index.ts` | `mount`（4 个动态 import + `/mcp`） | 静态 import `@toonflow/mcp`（会拉高冷启动成本） |
| 5 | `modules/localRuntime/index.ts` | `initialize`（动态 import `./mobileLink` → `initializeMobileLinkRuntime(app)`） | 静态 import `mobileLink` |
| 6 | `modules/agentAccess/index.ts` | `mount`（`await import("@/agent/a2a")`） | 静态 import `@/agent/a2a`（会使 agentAccess→agent 由 8 变 9） |
| 7 | `modules/platformCore/index.ts` | 中间件与配置契约导出（`languageRequest`、`desktopRequest`、`errorFromCause` 等，保持 `app.ts` 装配面） | 直接注册中间件（顺序必须由 `app.ts` 决定） |
| 8 | `types/module.ts` | `ServerModule` / `ModuleContext` | 任何运行期 import（只允许 `import type`） |
| 9 | `lib/mentionSources.ts` | `MentionQuery`、`mentionAssetType` | 任何 `@/agent` import（这是消除环的关键） |

---

## 附录 E：覆盖度追溯（来源 → 问题 → 需求 → 验收 → 证据）

| 来源 | 问题 | 需求 | 验收 | 证据 |
| --- | --- | --- | --- | --- |
| `c-server-api-1`（P1：无模块契约） | 237 文件 1 模块 | R-01、R-04 | A-06、A-07 | §3.2、§3.6、§A.14 |
| `c-server-api-1`（P2：组合根承担业务） | `app.ts` 160 行 | R-02、R-03 | A-08、A-09、A-10、A-25、A-26 | §R-03 表、§6.8、§A.7.6/A.7.7 |
| `c-server-api-1`（P3：聚合入口锁死闭包） | 37 key / 145 文件 | R-06 | A-12、A-22 | §A.3（facade 145） |
| `c-server-api-1` / `c-arch-1`（P4：跨域隐式、方向混乱） | A–D 四条边 + SCC | R-07、R-07E、R-13 | A-13～A-18 | §2.3、§2.4、§A.7、§A.6、§A.11 |
| `c-server-api-1`（P5：扁平挂载） | 161 条 `app.use` | R-05 | A-07、A-11 | §3.6、§R-05 |
| `c-arch-1` / `c-arch-2`（全局视角） | server↔agent 双向依赖 | NG1 + §2.3 边界表 | A-13 `a3` | §1.2(b)、§2.3 |
| AGENTS「一个接口一个文件」 | URL 由路径决定 | 方案 B（`routes/**` 不动） | A-11、A-20 | §5、§R-05 |
| AGENTS「统一 `import u from "@/utils"`」 | facade 不能删 | R-06（Q3） | A-12 | §R-06 |
| AGENTS「禁止新增测试/自检代码」 | 判据不能落库 | R-14（§6.7.5） | A-24 | §6.7、§A.7.0 |
| AGENTS「桌面/移动复用 `@toonflow/server/app`」 | 宿主兼容 | R-08、R-09 | A-12、A-21 | §A.5、§R-08 |
| 地图详细快照滞后 228/13,955 | 台账口径 | R-12 | A-01～A-03 | §1.2(a)、§A.8 |
| 地图 health 28/73 口径差异 | 数字不可混用 | §1.2(b) | A-13 `a3` | §1.2(b) |
| 地图 health 187 端点（误报） | 端点计数失真 | R-10、R-12 | A-11、A-20 | §0.2 S4、§1.2(c)、§A.2 |
| file SCC 2 个（15 + 2） | 环治理 | R-07、R-07E | A-17、A-18 | §2.4、§A.6 |
| **第 4 轮打回 #1**（a2 scope 60/41/42） | 数值矛盾 + scope 断言化 | §1.6.4、R-07、R-14 | A-13、A-28 | §0.1#1、§6.9 L15 |
| **第 4 轮打回 #2**（A.3 145 不可达） | 联合模式与计数混用 | §A.3、§1.6.5、R-14 | A-27、A-28 | §0.1#2、§6.9 L08–L11 |
| **第 4 轮打回 #3**（21 前缀清单缺失） | A-07 悬空引用 | §3.6、R-01、R-05、R-10 | A-07、A-20 | §0.1#3、§A.14 |
| 自查 S1（`≥500` 恒假守卫） | 守卫不可达 | R-04 | A-27、A-28 | §0.2 S1、§6.9 L14 |
| 自查 S2（地图 28/73） | 口径歧义 | §1.2(b) | A-13 | §0.2 S2 |
| 自查 S3（§A.7.8 a2=60 残留） | 打回 #1 同源 | R-07 | A-13 | §0.2 S3、§A.7.8 |

---

## 附录 F：本版结论摘要（给评审的一页纸）

1. **打回 #1（scope 数）**：不是“把 60 改成 42”这么简单——本版把 `scope_files` 从**断言**降为**观测**，判据只断言 `hits` 与 `scope_files ≥ scope_min`。这样 L2 入口落进扫描目录（41→42）不会再让判据失效，而“丢文件”仍会被抓住（§1.6.4、A-28）。
2. **打回 #2（145 不可达）**：v4 的联合模式在 B0 实测 226，与 145 无关。本版把 A.3 拆成“facade 145（两相相同）+ 深路径 246（B0）/ 252（F，逐段推导）+ 旧说明符归零（zero-guard）”，每条都可执行（§A.3、§6.9 L08–L11）。
3. **打回 #3（21 前缀）**：新增 §3.6 清单（前缀 / 归属 / 文件 / 端点 / 首端点）+ §A.14 生成脚本（实测 `prefixes=21 route_files=161 endpoints=162`），A-07/A-20 不再是悬空引用。
4. **额外自查**：修正 `≥500` 恒假守卫（→ 263/272）、登记地图 28/73 与可执行口径 23/71 的差异、清理 `a2=60` 残留。
5. **验收方式不变**：问题消除 + 审查通过；无法消除项（E1–E12）按 §8 模板结构化豁免，逐条给理由、替代缓解与复核触发条件。
6. **本轮额外自查（端点口径）**：地图与 v1–v4 的“187 端点”是朴素 grep 的误报（含 `Promise.all(`、`conf.get(`、`Map.delete(`）。真实注册端点为 **162**（161 文件，仅 `assets/usage.ts` 有 2 个）。A.2 已改为锚定式提取并加逐文件交叉校验；187 只保留在 §1.2(c) 的对账里。
