# 方案设计 · server-api 应用子模块拆分（第 4 版 · 第 8 轮打回后重做）

## 0. 文档元信息

| 项 | 内容 |
| --- | --- |
| 文档编号 | **SOL-2026-10-27-04** |
| 对应需求 | `REQ-2026-10-26-06`（`1_requirements_matrix/2026-10-26-23-29-serverApiSubmoduleSplit-v6.md`，第 6 版） |
| 上一版方案 | `SOL-2026-10-27-03`（`2026-10-27-02-52-serverApiSubmoduleSplit-v3.md`）——**第 8 轮评审打回** |
| 需求标题 | server-api 按素材库 / 媒体生成 / 插件市场 / MCP·工作区拆出应用子模块，`app.ts` 只保留组合根与路由装配 |
| 影响模块 | `server-api`（`apps/server`） |
| 方案类型 | 结构性重构（架构整改），**零业务行为变更、零 UI 变动** |
| 编写人 | 方案设计 agent（harness 规则 2.2 执行者） |
| 编写时间 | 2026-10-27 03:09 |
| 代码基线 | 矩阵 B0 = `d084136`；本轮只读复核 HEAD = **`1861cd0`**（`apps/server` 工作树干净） |
| 本轮写回 | 仅新增本文档与 `INDEX-2026-10.md`；**未修改任何源码/测试/脚本**（探针与模拟树一律在 `/tmp`） |
| 评审入口 | §10 评审意见栏（留空待填）；§8 豁免与裁决 |

> **引用约定**：`矩阵 §x`、`§A.x`、`§R-xx`、`A-xx`、`Lxx`、`Qxx`、`Exx` 一律指**需求矩阵**（REQ-2026-10-26-06）；**不带前缀的 `§x`** 指本文档自己的章节。
> **阅读顺序**：§1 打回处置（3 分钟）→ **§2 数值对账（本轮核心）** → §3 R-07D 与 d4 口径 → §4 总体架构 → §5 逐条 R → §8 豁免与裁决 → §10 评审栏。

---

## 1. 第 8 轮打回处置总览

### 1.1 两条打回 → 定性 → 处置 → 落点

| # | 第 8 轮打回意见 | 定性 | 本版处置（可核对） | 落点 |
| --- | --- | --- | --- | --- |
| 1 | **platformCore 来源漏 `lib/**` 等 9 文件，致 20/246 等式断裂** | **方案缺陷（台账“来源”列不完整）**：v3 §4.5 的 platformCore 行写了“20 文件”，但只列出**被移动的 4 个文件**（`utils/conf/**` + 3 个顶层工具）；**不移动但仍归属 platformCore 的 16 个文件**（`lib/**` 8 + `types/**` 1 + `routes/{settings,monitor}/**` 7）没有出现在该行。即使把 7 个不移动的路由补上也只有 4 + 7 = 11，仍差 `lib/**` 8 + `types/**` 1 = 9 个文件才到 20，于是“20”与“246”看起来断裂。矩阵 L1 glob 本身包含 `lib/**`、`types/**`，正确构成是 **4 移动 + 16 不移动 = 20**，L3 = **22**。 | ① 新增 **§2.2 platformCore 完整构成表**（逐类给出文件/行数/是否移动）；② 新增 **附录 C 全模块“移动 / 不移动”来源台账**（59 + 178 = 237 文件；9,240 + 5,109 = 14,349 行）；③ 新增探针 `n1`（compose）/`n2`（equations），机械复算 `20 = 4 + 16`、`22 = 20 + 2`、`246 = 237 + 9`；④ §4.5 的映射表加“移动/不移动”两列，禁止只列移动项。 | §2.2、§4.5、§5 R-12、附录 C、附录 B `n1/n2` |
| 2 | **A.3③ 252 在默认方案下仅 245，且未登记豁免** | **判据口径与方案取舍未登记**：v3 把“245”写在 D-01 的备注里，既没有给出逐段推导，也没有把它登记为结构化豁免；同时 v3 的 R-07D 采用“单行混合 import”会**再少 2 行**（103 → 101），使问题比 245 更深。 | ① **重新逐段推导** A.3③（§2.3）：F 相静态 `from "@/modules/` = **245 = 50 + 62 + 103 + 30 + 0**；`app.ts` 的 7 个入口装配是**动态 `import()`**（其中 5 个为硬约束、2 个为形态统一，见 §2.3.3），因此按矩阵原文的“静态 grep”只有 245；② 归一化口径 **252 = 245 + 7**（静态 from 行 + `app.ts` 入口动态 import 行），与矩阵 252 **逐字相等**；③ 新增 **E13 结构化豁免**（§8.2）与 **`k1–k5` 可执行判据**（§2.3.4 / 附录 B）；④ 修正 R-07D（§3）：用 **2 条 `export type … from "@/modules/platformCore/conf"`** 补回模块段 103，避免 103 → 101；⑤ 由此带来的 `d4` 口径差（raw 6 / import-only 4）新增 **D-09 + E14**。 | §2.3、§3、§8.2、§8.3、附录 B `k1–k5`、`d4v/d4t` |

> **关键点**：两条打回都**没有要求改需求矩阵的期望值**。本版保留矩阵全部期望（A.3② 246、A.3③ 252、20 条域边、SCC 2→1、`d4=4` 的**语义**），改的是：① 台账来源列的完整性；② 计数口径的显式化；③ 不可消除项的豁免登记。

### 1.2 结论速览（7 条）

1. **platformCore 的 20/246 已闭合**：`20 = 4（移动）+ 16（不移动：lib 8 + types 1 + routes 7）`；`22 = 20 + 1 入口 + 1 lib/mentionSources`；`246 = 9 + 28 + 43 + 50 + 21 + 46 + 27 + 22 = 237 + 9`。附录 C 给出 8 个模块的逐类来源与文件/行数，`59 + 178 = 237`、`9,240 + 5,109 = 14,349` 两条等式同时成立。
2. **A.3③ 的 252 用“归一化口径”闭合**：F 相静态 = `50 + 62 + 103 + 30 + 0 = 245`；`app.ts` 装配 7 个入口 = **7 行动态 `import("@/modules/<id>")`**；`245 + 7 = 252`。**E13** 登记“静态 grep 只能到 245”的豁免，并给出 `k1–k5` 五个可执行子项。
3. **R-07D 恢复模块段 103**：`conf` 删除 2 条 type import（−2），`teams/index.ts` 与 `mobileLink/index.ts` 各加 1 条 type re-export（+2），净额 **103**；同时 **file 级 SCC 由 2 个降为 1 个**（`dxt ↔ servers`，E11）。
4. **`d4` 按矩阵 §1.6.5 的计数口径执行**：`d4v`（只数 `import` 行）= **4**；`d4t`（type re-export 行）= **2**；原文 raw grep = **6**。默认采用 `d4v`，原文值作为观测登记；若评审坚持 raw=4，则 E14 兜底。
5. **行为零变化**：`conf` 仍在 `TOONFLOW_DATA_DIR` 之后求值（`app.ts` 不静态 import 入口）；162 端点 / 161 路由文件 / 21 前缀 / 14 exports 键名逐字不变；15 步的阻塞性与错误语义逐项保真。
6. **/tmp 模拟迁移已把关键判据跑通**（§1.3 V11–V15）：246 文件、静态 245、动态 7、模块段 103、`a2=0`、`b3/b4=0`、`b5=1`、`c4..c6=0`、`c7=3`、`d3=0`、`d4v=4`、`e3/e4=1`、`e5=0`、`l2_relative=PASS`、SCC=1。**这是“方案可行”的直接证据，不是纸面推导。**
7. **零代码改动**：本版只新增方案文档并更新索引；探针脚本与模拟树全部在 `/tmp`，仓库内无新增测试/脚本/依赖（A-24）。

### 1.3 本轮只读复核与模拟验证（HEAD = `1861cd0`，2026-10-27 02:56–03:07）

| # | 复核项 | 命令（摘要） | 实测 | 与矩阵对照 |
| --- | --- | --- | --- | --- |
| V1 | B0 文件 / 行数 | `git archive d084136 apps/server` 后跑矩阵 §A.1 glob | **237 / 14,349** | 与矩阵 B0 逐字一致 |
| V2 | HEAD 文件 / 行数 | 同一 glob | **237 / 14,352** | +3 行（`agentAccess` 1,193→1,196，canvas「节点引用」提交）；F-01 |
| V3 | 路由 / 端点 / 前缀 | 矩阵 §A.2、§A.14 | **161 / 162 / 21**（79 post / 51 get / 20 put / 10 delete / 2 patch） | 一致 |
| V4 | 深路径 / facade | 矩阵 §A.3 | **246 / 145**；分段 50 / 62 / 103 / 30 / 1 | 一致 |
| V5 | `app.ts` / `utils.ts` / `router.ts` | `wc -l`、`grep -c 'app.use'` | **160 / 75 / 327（161 条）** | 一致 |
| V6 | 外部契约 | 矩阵 §A.5 | **14 exports / 36 文件 / 57 引用** | 一致 |
| V7 | 域间边 / file SCC | 矩阵 §A.11、§A.6（B0 快照） | **20 条边；SCC=2（size 15 + size 2）** | 一致 |
| V8 | 相对路径 | 矩阵 `f2c`、`utils/**` 相对 import | **2**（`src/index.ts:3`、`singleAgent/types.ts:2`）；`utils/**` 内 **21** | 一致 |
| V9 | `src/**` `.ts` | `find apps/server/src -name '*.ts'` | **263** | 一致 |
| V10 | 默认数据目录锚点 | 读 `conf/index.ts` | 5 级 → `<repo>/data`；**行号为 13（矩阵写 11，属文档行号笔误，不影响判据）**；F-15 | 值一致 |
| V11 | **模拟 F 树规模** | `/tmp/sim_f`：矩阵 SPEC 迁移 + R-07 + 7 入口 + 2 契约 | **246 文件 / 14,408 行**（最小骨架；上限 14,842） | 文件数精确；行数在预算内 |
| V12 | **A.3③ 分段（模拟 F）** | 矩阵 §A.3③ 命令（`--include='*.ts'`） | **50 / 62 / 103 / 30 / 0 = 245**；`app.ts` 入口动态 **7**；归一化 **252** | 解决打回 #2 |
| V13 | **模块段 103 的构成** | 逐目标计数 + R-07D 前后对比 | B0 `utils` 103 − 2（conf 两条 type import）+ 2（teams/mobileLink 的 type re-export）= **103** | 解决 103 来源 |
| V14 | **域边（模拟 F）** | 矩阵 §A.11 脚本 | `asset→platform 27`、`local→platform 76`、`platform→plugin 0`、`platform→local 1`、`platform→media 1`、`plugin→media 1`、`mcp→plugin 3`；域间边 **20** | 与矩阵 R-07 后预期逐项一致 |
| V15 | **SCC（模拟 F）** | 矩阵 §A.6 脚本 | **SCC=1、size=2**（`modules/mcpIntegration/mcp/{dxt,servers}.ts`） | R-07D 后唯一残留，E11 |
| V16 | **A-29（模拟 F）** | 矩阵 §A.13.2 脚本 | `lr1=1 lr2=7 lr3=0 lr4=0 lr5=0`，`l2_relative=PASS` | A-29 结构性成立 |
| V17 | **边 A–E 探针（模拟 F）** | 矩阵 §A.7 的 grep | `a2=0`（scope 42）、`b3=0`、`b4=0`、`b5=1`、`c4..c6=0`、`c7=3`、`c8a=7`、`c8b=4`、`d3=0`、`d4v=4`（raw 6）、`e3=e4=1`、`e5a=e5b=0` | 逐项达标（d4 口径见 §3） |
| V18 | **其他计数（模拟 F）** | `grep` / `find` | `src/**` **272**、`src/utils/**` **0**、`server→agent 19`、`agent→server 51+20=71`、`f2c=2`、facade **145** | 与矩阵预期一致 |

> **模拟树说明**：`/tmp/sim_f` 是**只读副本的文本级迁移**，不进入仓库、不参与提交；入口骨架与契约文件是最小形态（6–15 行），用于验证“路径迁移后的计数与边关系”，不是实现代码。正式实现的入口上限仍是 60 行（A-06）、L2 行数上限仍是 490。

### 1.4 可行性结论与风险边界

| 结论 | 依据 |
| --- | --- |
| **结构可行** | 模拟树已给出 246 文件、A.3 归一化 252、20 条边、SCC=1、A-29 PASS；不是仅靠文档推导 |
| **行为可保真** | 7 个入口的静态面不触达 `@/agent`（v3 `s6`），`conf` 仍由 `app.ts` 在 `TOONFLOW_DATA_DIR` 之后动态求值；15 步调用时刻不变 |
| **契约可保真** | `routes/**` 不移动 → 162 端点/21 前缀不变；`package.json` 14 个键名不变；`createApp` 签名不变 |
| **唯一不可消除项** | `app.ts` 的 5 个入口装配必须是动态 `import()`（静态化会让 `conf` 早于 `TOONFLOW_DATA_DIR` 求值；另 2 个为形态统一）→ A.3③ 静态 grep 只能 245；已登记 **E13**，并用归一化 252 闭合 |
| **测量口径差** | R-07D 的 2 条 type re-export 会被 `d4` 的 raw grep 计入（6）；按矩阵 §1.6.5 的 `import` 行口径为 4；已登记 **D-09 + E14** |
| **可回滚** | M2–M4 每步独立 commit；迁移用 `git mv` 保留历史；入口静态面若被否决只改 3 个入口各 1 行（D-06） |

---

## 2. 数值对账（本轮核心）

### 2.1 基线（B0 vs HEAD）

| 指标 | B0 `d084136` | HEAD `1861cd0` | 备注 |
| --- | --- | --- | --- |
| server-api 文件 | **237** | **237** | 无增删 |
| server-api 行数 | **14,349** | **14,352** | +3 行（`agentAccess`），F-01 |
| 路由文件 | **161** | **161** | `routes/**` 不移动 |
| 注册端点 | **162**（79/51/20/10/2） | **162** | 锚定式计数 |
| `/api/*` 前缀 | **21** | **21** | §3.6 清单 |
| 深路径（B0 口径） | **246** = 50+62+103+30+1 | **246** | §A.3② |
| facade 文件 | **145** | **145** | §A.3① |
| `app.ts` / `utils.ts` / `router.ts` | 160 / 75 / 327 | 160 / 75 / 327 | 161 条 `app.use` |
| 外部契约 | 14 exports / 36 文件 / 57 引用 | 同 | `package.json` |
| 域间直接边 | **20** | **20** | §A.11 |
| file 级 SCC | **2**（15 + 2） | **2** | §A.6 |
| 跨模块相对 import | **2** | **2** | `f2c` |
| `utils/**` 内相对 import | **21** | **21** | A-29 形态基线 |
| `src/**` `.ts` | **263** | **263** | L14 |

> HEAD 的 +3 行走 F-01 登记：M0 以实施开始时的 HEAD 重新冻结；**结构性判据（237/9/246、161/162/21、246、145、20 条边、SCC）逐项不变**；行数上限按 `14,839 + Δ` 计算（Δ = HEAD − B0 = 3，故 **14,842**）。

### 2.2 platformCore 的 20/22 完整构成（打回 #1 的修复）

#### 2.2.1 逐类构成（B0 实测）

| 类别 | 路径 | 文件 | 行数 | 本期处理 |
| --- | --- | --- | --- | --- |
| 共享库 | `src/lib/**` | **8** | **382** | **不移动**（仍属 platformCore） |
| 平台类型 | `src/types/desktop.ts` | **1** | **58** | **不移动** |
| 配置持久化 | `src/utils/conf/index.ts` | **1** | **69** | 移动 → `modules/platformCore/conf/index.ts` |
| 横切工具 | `utils/{monitor,personalization,fileHttp}.ts` | **3** | **178** | 移动 → `modules/platformCore/{monitor,personalization,fileHttp}.ts` |
| 设置/监控路由 | `src/routes/{settings,monitor}/**` | **7** | **239** | **不移动**（URL 由文件路径生成） |
| **L1 合计** | — | **20** | **926** | `8 + 1 + 1 + 3 + 7 = 20`；`382 + 58 + 69 + 178 + 239 = 926` |
| L2 新增 | `modules/platformCore/index.ts`（入口） | +1 | ≤60 | L2 #7 |
| L2 新增 | `src/lib/mentionSources.ts`（R-07A 下沉） | +1 | ≤30 | L2 #9 |
| **L3 合计** | — | **22** | **≤1,016** | `20 + 1 + 1 = 22`；`926 + 60 + 30 = 1,016` |

> **打回 #1 的根因**：v3 §4.5 只列了“移动”的 4 个文件，却把该行写成“20 文件”；即便补上 7 个路由也只有 11，仍差 9（`lib/**` 8 + `types/**` 1），于是“20”与“246”看起来断裂。**本版的规则：任何模块的“来源”必须同时列“移动”和“不移动”两类，且 `移动 + 不移动 = L1`。**

#### 2.2.2 全模块“移动 / 不移动”台账（B0 实测）

| 模块 | 移动（文件/行） | 不移动（文件/行） | L1（文件/行） | L2 | L3（文件/≤行） |
| --- | --- | --- | --- | --- | --- |
| bootstrap | 0 / 0 | 8 / 710（5 根文件 + 3 scripts） | **8 / 710** | 1（`types/module.ts`） | **9 / ≤750** |
| assetLibrary | 9 / 2,120（`utils/assets/**`） | 18 / 495（`routes/assets/**`） | **27 / 2,615** | 1（入口） | **28 / ≤2,675** |
| mediaGeneration | 17 / 2,441（`ai 8 + media 7 + ffmpeg 1 + documents 1`） | 25 / 553（`routes/{ai,providers,ffmpeg}`） | **42 / 2,994** | 1（入口） | **43 / ≤3,054** |
| pluginMarket | 10 / 1,345（`plugins 6 + skills 1 + teams 3`） | 39 / 938（`routes/{tools,nodes,ext,skills,agents,plugins}`） | **49 / 2,283** | 1（入口） | **50 / ≤2,343** |
| mcpIntegration | 7 / 1,273（`utils/mcp/**`） | 13 / 160（`routes/mcp/**`） | **20 / 1,433** | 1（入口） | **21 / ≤1,493** |
| localRuntime | 8 / 1,198（`workspace 4 + desktop 1 + mobileLink 1 + exec 1 + remoteConnection 1`） | 37 / 997（`routes/{workspaces,desktop,exec,mobileLink}`） | **45 / 2,195** | 1（入口） | **46 / ≤2,255** |
| agentAccess | 4 / 616（`singleAgent 2 + sessionState 1 + browser 1`） | 22 / 577（`routes/agent.ts + routes/{agent,singleAgent,browser,sessionState}`） | **26 / 1,193** | 1（入口） | **27 / ≤1,253** |
| platformCore | 4 / 247（`conf 1 + 3 工具`） | 16 / 679（`lib 8 + types 1 + routes 7`） | **20 / 926** | 2（入口 + mentionSources） | **22 / ≤1,016** |
| **合计** | **59 / 9,240** | **178 / 5,109** | **237 / 14,349** | **9 / ≤490** | **246 / ≤14,839** |

**四条等式（逐项可复算）：**

```text
files(L1):   8 + 27 + 42 + 49 + 20 + 45 + 26 + 20 = 237
files(L3):   9 + 28 + 43 + 50 + 21 + 46 + 27 + 22 = 246 = 237 + 9
moved:       59 + 178 = 237；9,240 + 5,109 = 14,349
lines(L3):   750 + 2,675 + 3,054 + 2,343 + 1,493 + 2,255 + 1,253 + 1,016 = 14,839 = 14,349 + 490
```

> **170 行“未移动”的 9 个文件不是漏项**：`lib/**` 8 个（382 行）+ `types/desktop.ts` 1 个（58 行）= 440 行；`routes/{settings,monitor}/**` 7 个（239 行）。它们分别以“不移动但归属 platformCore”进入 L1/L3；`lib/mentionSources.ts` 是唯一新增到 `lib/**` 的文件（L2 #9）。

### 2.3 A.3③ 的 252：逐段推导与归一化（打回 #2 的修复）

#### 2.3.1 B0 与 F 的分段

| 段 | B0：`from "@/utils/…"` | F 静态：`from "@/modules/…"` | F 动态：`app.ts` 的 `import("@/modules/<id>")` | 说明 |
| --- | --- | --- | --- | --- |
| `src/agent/**` | **50** | **50** | 0 | 文件不移动，50 处说明符随迁 |
| `src/routes/**` | **62** | **62** | 0 | `routes/**` 不移动，说明符随迁 |
| `src/modules/**`（B0 为 `src/utils/**`） | **103** | **103** | 0 | 见 §2.3.2（−2 +2） |
| `src/utils.ts` | **30** | **30** | 0 | facade 内部 30 条前缀替换 |
| `src/app.ts` | **1** | **0** | **7** | 1 条静态 `initializePlugins` 移入入口；7 个入口用动态装配 |
| **合计** | **246** | **245** | **7** | **245 + 7 = 252** |

```text
# PH-B0（B0 基线段，仅作对照）
B0: 50 + 62 + 103 + 30 + 1 = 246
# PH-F（F 相静态段；命令见矩阵 §A.3③）
F-static: 50 + 62 + 103 + 30 + 0 = 245
F-dynamic(app.ts entry assembly): 7
F-normalized: 245 + 7 = 252        ← 与矩阵 §A.3③ 的 252 逐字相等
```

#### 2.3.2 模块段 103 的来源（R-07D 的 −2 / +2）

| 步骤 | 操作 | 对 `from "@/modules/…"` 行数的影响 |
| --- | --- | --- |
| B0 起点 | `src/utils/**` 内 `from "@/utils/<域>…"` = **103** | 103 |
| R-07D（−2） | `conf/index.ts` 删除 2 条 type import（`teams`、`mobileLink`），类型定义迁入 `conf` | −2 → **101** |
| R-07D（+2） | `teams/index.ts`、`mobileLink/index.ts` 各新增 1 条 `export type { … } from "@/modules/platformCore/conf"`（保持公开类型面） | +2 → **103** |
| R-07A | 4 处改为 `@/lib/mentionSources`（**不计入**本段：该段只数 `@/modules/`） | 0 |
| R-07B | 1 条 `@/utils/media/provider` → `@/modules/mediaGeneration`（1:1） | 0 |
| R-07C | 3 条 `@/utils/plugins\|skills/...` → `@/modules/pluginMarket`（1:1） | 0 |
| 7 个入口 | 静态面只用 `./…`；入口不出现 `@/modules/**`（`lr3=lr4=0`） | 0 |
| **F 终值** | — | **103** |

> 模拟树实测（V13）：R-07D 前后 103 → 101 → 103；`d3=0`；`d4v=4`；SCC 由 2 降到 1。**R-07D 的 2 条 re-export 不是为了“凑 103”，而是为了保持 `RemoteTeam` / `MobileLinkConfig` 的公开类型面**（`@toonflow/server/mobileLink` 虽然当前只被 `apps/desktop/src/connection.ts` 用于函数，但类型导出属于既有公开面，不应删除）。

#### 2.3.3 为什么 7 个入口统一走动态 `import()`（其中 5 个是硬约束）

| 事实 | 证据 | 后果 |
| --- | --- | --- |
| 5 个入口的静态面会传递求值 `conf` | v3 `s6`：`assets/roots → conf`、`media/provider → conf`、`plugins/install → conf`、`mcp/control → conf`、`mobileLink → conf`；静态图 agent 边 = 0 | 若 `app.ts` **静态** import 这 5 个入口，`conf` 会在 `app.ts` 模块求值时执行 |
| `createApp` 的第 1 件事是设置 `TOONFLOW_DATA_DIR` | B0 `app.ts:59`（形参归一后、`await import(conf)` 之前） | 静态 import 会让 `conf` 早于 `TOONFLOW_DATA_DIR`，读到**默认数据目录**（`<repo>/data`）而不是宿主传入的目录 |
| 三宿主都显式传 `dataDirectory` | 桌面/移动/独立 server | 会把“显式目录”静默降级为“仓库默认目录”，违反 NG4 与 A-25 `f2a/f2b` |
| 矩阵 R-02 也要求“静态 import 图不得传递求值 `conf`” | 矩阵 §R-02 静态导入边界 | 动态装配是**需求要求**，不是方案偏好 |

> 结论：`app.ts` 的 7 行统一写成 `import("@/modules/<id>")`；其中 **5 个是硬约束**（静态化会让 `conf` 提前求值），另 2 个（`agentAccess` / `platformCore`）为**形态统一**。矩阵 §A.3③ 的 `7` 在**归一化口径**（静态 + 动态）下保留，静态 grep 只能到 245。**E13** 就是为这个“拼写差”登记的豁免。

> **补充（为什么不是“2 静态 + 5 动态”）**：`agentAccess` 与 `platformCore` 两个入口的静态图不含 `conf`，理论上可以静态 import；但本方案统一用 7 个动态 `import()`（`Promise.all` 并发装配、入口集合单一形态）。否则 A.3③ 的静态段会变成 **247（= 245 + 2）**、动态段 **5**；归一化仍是 252，但会多出一种“2 静态 + 5 动态”的分裂形态，让 `k1/k2` 的判据分叉。统一动态后，`k1=245`、`k2=7`、`k4=252` 三者关系最简。

#### 2.3.4 `k1–k5`：252 的可执行判据（替代“只看一个数”）

| 子项 | 断言 | 期望 | 命令（F 相；完整脚本见附录 B） |
| --- | --- | --- | --- |
| `k1` | 静态 `from "@/modules/` 行数 | **245** | 矩阵 §A.3③ 的 `grep -rho 'from "@/modules/[a-zA-Z]*' … --include='*.ts' \| wc -l` |
| `k2` | `app.ts` 的 7 个入口动态 import 行数（只匹配 7 个模块 id，**排除** `conf`） | **7** | `grep -cE 'import\("@/modules/(assetLibrary\|mediaGeneration\|pluginMarket\|mcpIntegration\|localRuntime\|agentAccess\|platformCore)(/index)?"' apps/server/src/app.ts` |
| `k3` | 分段等式 | `50/62/103/30/0` 与 `k1=245` 同时成立 | 逐段 grep（附录 B） |
| `k4` | 归一化总和 | `k1 + k2 = 252` | 两值相加，逐字等于矩阵 §A.3③ |
| `k5` | 非空转 | 把任一入口动态 import 改成静态 → `k2=6` → **FAIL**；把任一静态行改成 `@/utils` → `k1<245` 或 zero-guard >0 → **FAIL** | 评审可在 `/tmp` 副本上自证 |

> `k2` 的排除项：`app.ts` 另有 1 条 `await import("@/modules/platformCore/conf")`（B0 就是动态 `@/utils/conf`），它**不属于入口装配**，也不在矩阵 7 的计数对象内；`k2` 的正则要求模块名后紧跟引号或 `/index`，因此不会误计 `conf` 子路径。

### 2.4 其他关键数字的独立复核（摘要）

| 数字 | 值 | 相位 | 来源 |
| --- | --- | --- | --- |
| A.3② 深路径 | 246 | B0 | §A.3②；分段 50/62/103/30/1 |
| A.3③ 静态 | 245 | F | §2.3；模拟实测 |
| A.3③ 归一化 | 252 | F | 245 + 7；E13 |
| A.3④ facade | 145 | B0+F | §A.3①④；模拟实测 145 |
| 模块段 | 103 | F | §2.3.2；模拟实测 |
| `d4v` / `d4t` / raw | 4 / 2 / 6 | F | §3；模拟实测 |
| 域间边 | 20 | B0+F | §A.11；模拟实测 20 |
| `asset→platform` | 27（1t/26v） | F | R-07A；模拟实测 |
| `local→platform` | 76（1t/75v） | F | R-07A；模拟实测 |
| `platform→plugin` | 0 | F | R-07D；模拟实测 |
| SCC | 2 → 1 | B0→F | §A.6；模拟实测 |
| `src/**` `.ts` | 263 → 272 | B0→F | L14；模拟实测 272 |
| `server→agent` | 23 → 19 | B0→F | R-07A；模拟实测 19 |
| `agent→server` | 71 | B0+F | 51 + 20；模拟实测 |
| `f2c` | 2 | B0+F | 模拟实测 2 |
| `utils/**` 内相对 import | 21 | B0 | 形态基线 |

> 完整的“方案级数值台账”见 **附录 D（N01–N30）**；每条都有命令、期望与相位，禁止悬空数字。

---

## 3. R-07D 的实现与 `d4` 口径（本版新增裁决）

### 3.1 三种实现对比

| 方案 | 做法 | A.3 模块段 | `d4`（raw / import-only） | SCC | 结论 |
| --- | --- | --- | --- | --- | --- |
| **A（默认）** | 类型定义迁入 `conf`；`teams/index.ts`、`mobileLink/index.ts` 各加 1 条 `export type … from "@/modules/platformCore/conf"` | **103** | **6 / 4** | 15 文件环消失 | **采纳**：A.3 252 归一化成立；类型公开面保留 |
| B（v3 的 D-02） | 类型定义迁入 `conf`；teams/mobileLink 只改单行混合 import，不 re-export | **101** | **4 / 4** | 15 文件环消失 | 不采纳：A.3 静态降到 243、归一化 250；需再登记一条 −2 豁免 |
| C | 两处保留本地类型定义，`conf` 复制一份结构类型 | 101 | 4 / 4 | 环消失 | 不采纳：类型双写会漂移，且仍少 2 行 |

> **为什么 A 的 `d4` raw 是 6**：`teams/index.ts` 的 `import conf, { type RemoteTeam }` 仍算 1 条 import；新增的 `export type { RemoteTeam } from …` 是第 2 条含 `from` 的行；`mobileLink/index.ts` 同理。`d4` 的矩阵原文命令是 `grep -hE 'from "@/(utils/conf|modules/platformCore/conf)'`，不区分 `import` 与 `export … from`，因此 raw=6。
> **为什么 import-only 是 4**：矩阵 §1.6.5 明确规定“**模块边计数只数 `^\s*import … from`，re-export 不构成新边**”。`d4` 的意图是“反向 4 条 **value** 边不变”；2 条 type re-export 不是 value 边。因此本版默认用 `d4v`（import-only）判定 = 4，并把 raw=6 作为观测值登记（D-09）。若评审坚持 raw=4，则用 **E14** 结构化豁免（理由：2 条 type re-export 属公开类型面，不是 value 依赖）。

### 3.2 逐文件改动（伪代码，不是实现代码）

```text
conf/index.ts
  − import type { RemoteTeam } from "@/modules/pluginMarket/teams"
  − import type { MobileLinkConfig } from "@/modules/localRuntime/mobileLink"
  + type RemoteTeam = { … }                 // 配置 schema 的 owner
  + type MobileLinkConfig = { … }
  + export type { RemoteTeam, MobileLinkConfig }

teams/index.ts
  ~ import conf, { type RemoteTeam } from "@/modules/platformCore/conf"   // 1 条 import（d4v 计 1）
  + export type { RemoteTeam } from "@/modules/platformCore/conf"        // 1 条 type re-export（d4t 计 1）
  − export type RemoteTeam = { … }                                      // 本地定义删除

mobileLink/index.ts
  ~ import conf, { type MobileLinkConfig } from "@/modules/platformCore/conf"
  + export type { MobileLinkConfig } from "@/modules/platformCore/conf"
  − export type MobileLinkConfig = { … }
```

> 若 TypeScript 对“同名 import + re-export”给出重复导出告警，等价写法是：保留 `import conf`，用局部别名 `type MobileLinkConfigValue = import("@/modules/platformCore/conf").MobileLinkConfig` 承接签名，再保留 re-export 行；两种写法的 `d4v/d4t/A.3` 计数完全相同，由 `typecheck` 二选一。

### 3.3 `d4` 判据（本版口径）

| label | 相位 | 断言 | 期望 | 命令 |
| --- | --- | --- | --- | --- |
| `d1` | B0 | conf 侧 type 边 | **2** | 矩阵 §A.7.4（`scope_min=1`） |
| `d2` | B0 | 反向 value 边 | **4** | 矩阵 §A.7.4（`scope_min=4`） |
| `d3` | F | conf 侧（联合模式） | **0** | 矩阵 §A.7.4（`scope_min=1`） |
| `d4v` | F | 反向 **import** 行（value/混合） | **4** | `grep -hE '^\s*import .*from "@/(utils/conf\|modules/platformCore/conf)' … \| wc -l` |
| `d4t` | F | 反向 **type re-export** 行（R-07D 的新增） | **2** | `grep -hE '^export type \{.*\} from "@/modules/platformCore/conf"' … \| wc -l` |
| `d4` raw | F | 矩阵原文命令（观测） | **6** | `grep -hE 'from "@/(utils/conf\|modules/platformCore/conf)' … \| wc -l` |
| `d5` | F | §A.11 输出 | `platform→plugin 0`、`→local 1 value`、`→media 1 value` | 矩阵 §A.7.4 |

> 判定规则：**A-16 以 `d4v=4 ∧ d4t=2 ∧ d3=0 ∧ d5 三条` 为 PASS**；`d4` raw=6 只作为观测值写进证据行（`d4_raw=6`），不单独判 FAIL。若评审在 §10 勾选“坚持矩阵原文”，则改判 `d4_raw=4` 为期望，并启用 E14。

### 3.4 风险与回滚

| 风险 | 概率 | 影响 | 缓解 |
| --- | --- | --- | --- |
| 类型定义迁 `conf` 造成循环重新出现 | 低 | 高 | SCC 探针（§A.6）：期望 `scc_count=1`；模拟实测通过 |
| 同名 import + re-export 编译告警 | 低 | 中 | 等价局部别名写法（§3.2 注）；`typecheck` 兜底 |
| `d4` 口径被评审驳回 | 中 | 中 | E14 兜底；raw=6 已如实登记，不隐藏 |
| re-export 行被误改成相对路径 | 低 | 中 | `d4t` / `lr4` / A.3③ 三条同时会变，容易发现 |

---

## 4. 总体架构设计

### 4.1 目标目录结构（交付态）

```text
apps/server/src/
├─ app.ts                         # 组合根（≤80 行）：参数归一 → 动态装配 7 入口 → 步骤 1–15
├─ index.ts core.ts router.ts utils.ts   # bootstrap，原地不动
├─ types/module.ts                # 【L2】ServerModule / ModuleContext / PluginType / PluginRoots（仅类型，≤40 行）
├─ lib/mentionSources.ts          # 【L2】MentionQuery + mentionAssetType（R-07A 下沉，≤30 行）
├─ lib/**                         # 既有 8 文件，不移动（仍属 platformCore）
├─ types/desktop.ts               # 既有 1 文件，不移动
├─ modules/
│  ├─ assetLibrary/     index.ts + assets/**                              (9 域 + 入口)
│  ├─ mediaGeneration/  index.ts + ai/** media/** ffmpeg/** documents.ts  (17 域 + 入口)
│  ├─ pluginMarket/     index.ts + plugins/** skills/** teams/**          (10 域 + 入口)
│  ├─ mcpIntegration/   index.ts + mcp/**                                 (7 域 + 入口)
│  ├─ localRuntime/     index.ts + workspace/** desktop/** mobileLink/** exec.ts remoteConnection.ts (8 域 + 入口)
│  ├─ agentAccess/      index.ts + singleAgent/** sessionState/** browser/** (4 域 + 入口)
│  └─ platformCore/     index.ts + conf/** monitor.ts personalization.ts fileHttp.ts (4 域 + 入口)
├─ routes/                        # 161 个路由文件，不移动（URL 由路径生成）
├─ agent/                         # 不属本模块；其 50 处 server 说明符跟迁
└─ utils/                         # 交付态为空（src/utils.ts 不在该目录）
```

**结构等式（交付态）**：`bootstrap 9 + 28 + 43 + 50 + 21 + 46 + 27 + 22 = 246 = 237（L1）+ 9（L2）`。

### 4.2 `createApp` 装配流程（交付态，伪代码流程图）

```text
宿主（src/index.ts | desktop | mobile）调用 createApp({...})   ← 签名逐字不变（9 个形参）
   ▼
[0] 参数归一：dataDirectory && (process.env.TOONFLOW_DATA_DIR = resolve(dataDirectory))
   │            ← 必须早于任何“会求值 conf”的模块（入口静态面也在 [1] 才求值）
   ▼
[1] const [A, M, P, C, L, G, K] = await Promise.all(7 个 import("@/modules/<id>"))
   │            ← D-01：app.ts 不静态 import 入口（入口静态面传递求值 conf，见 §2.3.3）
   ▼
[2] ctx = { appVersion, dataDirectory,
            pluginRoots: { tool, node, ext, skill, provider, agent },   ← 唯一翻译点（六类插件词表）
            pluginRevision, syncPluginDirectory: P.syncDirectory }
   ▼
[3] await K.prepare()                          ← 动态 import ./conf + setLocaleFallback
   ▼
[4] 步骤 1–7（顺序固定，全部 await；步骤 5 例外 = void）
   │  1 P.initializeTools  2 P.initializeNodes  3 P.initializeExt  4 M.initializeProviders
   │  5 A.warmup（void，内部空 catch）  6 P.initializeSkills  7 P.initializeAgents
   ▼
[5] const app = express(); app.locals.appVersion = appVersion
   ▼
[6] 步骤 8：app.locals.builtinPlugins = await P.scanBuiltin(ctx)      ← 全仓唯一 1 处赋值
   ▼
[7] dev 分支：await buildRoute(); app.use(logger("dev"))              ← 必须在中间件之前
   ▼
[8] 7 项中间件（行号严格递增）
   │  K.corsGuard → languageRequest → /a2a 2mb → raw 100mb → /api/sessionState 64kb
   │  → 全局 json/urlencoded 100mb → app.use("/api/desktop", desktopRequest)
   ▼
[9]  await M.refreshModels()          （内部：await import("./ai/initialize") 后 void 刷新 + warn）
[10] await import("@/router"); router.default(app)
[11] await C.mount(app, ctx)          （/mcp；入口内 4 条动态 import，各占 1 行）
[12] await G.mount(app, ctx)          （/a2a；入口内 await import("@/agent/a2a")）
[13] app.use(express.static(webRoot))
[14] app.use(errorHandler)
[15] await L.initializeRuntime(app, ctx)   （入口静态 import ./mobileLink，调用在此）
   ▼
return app
```

### 4.3 模块契约（`src/types/module.ts`，伪代码 ≤40 行）

```text
PluginType        = "tool" | "node" | "ext" | "skill" | "provider" | "agent"   // = install.ts 的 patterns 六类
BuiltinPluginType = "tool" | "node" | "ext" | "skill" | "agent"                // = builtinPlugins 的 5 键

PluginRoots   = { [K in PluginType]?: string }        // 键名 = PluginType（零映射；第 6 轮打回 #2 的修法）
ModuleContext = { appVersion, dataDirectory?, pluginRoots, pluginRevision?,
                  syncPluginDirectory?(target, source, fileFilter?, revision?): Promise<void> }
ServerModule  = { id: <7 个字面量联合>, routePrefixes: readonly string[], gateways?: readonly string[],
                  dependencies: readonly string[],       // 附录 C.4 白名单子集（不含 bootstrap）
                  exports: readonly string[],            // = app.ts 的调用面（D-04）
                  initialize?(ctx), warmup?(ctx),        // warmup 仅 assetLibrary：同步、fire-and-forget
                  mount?(app, ctx), syncDirectory?(...) }
```

### 4.4 7 个入口一览（静态面 / 动态块 / 路由前缀）

| # | 入口 | `routePrefixes` | `gateways` | 静态面（值级） | 动态块（冻结） | `exports`（app.ts 调用面） |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `assetLibrary` | `/api/assets` | — | `./assets/roots`（`internalAssetDirectories`） | `void import("./assets/thumb")` | `warmup` |
| 2 | `mediaGeneration` | `/api/ai` `/api/ffmpeg` `/api/providers` | — | `./media/provider`（`addMediaProvider`） | `await import("./ai/initialize")` | `initializeProviders`、`refreshModels` |
| 3 | `pluginMarket` | `/api/tools` `/api/nodes` `/api/ext` `/api/skills` `/api/agents` `/api/plugins` | — | 4 条（`./plugins/install`、`./plugins/tools`、`./skills/files`、`./plugins/initialize`） | 无 | 7 个（含 `scanBuiltin`） |
| 4 | `mcpIntegration` | `/api/mcp` | `/mcp` | `./mcp/control`（`getMcpSettings`） | 4 条（`@toonflow/mcp` + `./mcp/{tools,control,resources}`） | `mount` |
| 5 | `localRuntime` | `/api/workspaces` `/api/desktop` `/api/exec` `/api/mobileLink` | — | `./mobileLink`（`initializeMobileLinkRuntime`，钩子直接用） | 无 | `initializeRuntime` |
| 6 | `agentAccess` | `/api/agent` `/api/browser` `/api/sessionState` `/api/singleAgent` | `/a2a` | 无（MIN_REL=0） | `await import("@/agent/a2a")` | `mount` |
| 7 | `platformCore` | `/api/settings` `/api/monitor` | — | 无（MIN_REL=0） | `await import("./conf")` | `prepare`、`corsGuard` |

> `routePrefixes` 并集必须**逐字等于**矩阵 §3.6 的 21 项且两两无交集；`/mcp`、`/a2a` 只出现在 `gateways`（塞进 `routePrefixes` 会让并集变 23 项，A-07 直接 FAIL）。

### 4.5 迁移映射（含“移动 / 不移动”，打回 #1 的修复点）

| 模块 | 移动（old → new） | 不移动（仍属本模块） | L1 文件 | L3 文件 |
| --- | --- | --- | --- | --- |
| assetLibrary | `utils/assets/**` → `modules/assetLibrary/assets/**`（9） | `routes/assets/**`（18） | 27 | 28 |
| mediaGeneration | `utils/ai/**`（8）、`utils/media/**`（7）、`utils/ffmpeg/**`（1）、`utils/documents.ts`（1） → `modules/mediaGeneration/…`（17） | `routes/{ai,providers,ffmpeg}/**`（25） | 42 | 43 |
| pluginMarket | `utils/plugins/**`（6）、`utils/skills/**`（1）、`utils/teams/**`（3） → `modules/pluginMarket/…`（10） | `routes/{tools,nodes,ext,skills,agents,plugins}/**`（39） | 49 | 50 |
| mcpIntegration | `utils/mcp/**`（7） → `modules/mcpIntegration/mcp/**` | `routes/mcp/**`（13） | 20 | 21 |
| localRuntime | `utils/workspace/**`（4）、`utils/desktop/**`（1）、`utils/mobileLink/**`（1）、`utils/exec.ts`（1）、`src/remoteConnection.ts`（1） → `modules/localRuntime/…`（8） | `routes/{workspaces,desktop,exec,mobileLink}/**`（37） | 45 | 46 |
| agentAccess | `utils/singleAgent/**`（2）、`utils/sessionState/**`（1）、`utils/browser/**`（1） → `modules/agentAccess/…`（4） | `routes/agent.ts` + `routes/{agent,singleAgent,browser,sessionState}/**`（22） | 26 | 27 |
| platformCore | `utils/conf/**`（1）、`utils/{monitor,personalization,fileHttp}.ts`（3） → `modules/platformCore/…`（4） | **`lib/**`（8）+ `types/desktop.ts`（1）+ `routes/{settings,monitor}/**`（7）= 16** | **20** | **22** |
| bootstrap | — | 5 个根文件 + `scripts/**`（3） | 8 | 9 |
| **合计** | **59** | **178** | **237** | **246** |

> 迁移只做**前缀替换**，不改导入形态；`src/agent/**` 的 50 处说明符同步替换（文件不移动）；两处相对路径深度补偿见 §5 R-04 / R-15。

### 4.6 L2 新增台账（9 个，固定）

| # | 文件 | 归属 | 用途 | 行数上限 |
| --- | --- | --- | --- | --- |
| 1 | `src/modules/assetLibrary/index.ts` | assetLibrary | 入口 + `warmup`（同步 void + 空 catch） | 60 |
| 2 | `src/modules/mediaGeneration/index.ts` | mediaGeneration | 入口 + providers 初始化/模型刷新 + 公开 `addMediaProvider` | 60 |
| 3 | `src/modules/pluginMarket/index.ts` | pluginMarket | 入口 + 五类初始化/扫描 + 安装/工具内核公开面 | 60 |
| 4 | `src/modules/mcpIntegration/index.ts` | mcpIntegration | 入口 + `/mcp` 挂载 | 60 |
| 5 | `src/modules/localRuntime/index.ts` | localRuntime | 入口 + 移动互联初始化 | 60 |
| 6 | `src/modules/agentAccess/index.ts` | agentAccess | 入口 + `/a2a` 挂载（保持动态 import） | 60 |
| 7 | `src/modules/platformCore/index.ts` | platformCore | 入口 + 中间件/配置契约导出 | 60 |
| 8 | `src/types/module.ts` | bootstrap | `ServerModule` / `ModuleContext` | 40 |
| 9 | `src/lib/mentionSources.ts` | platformCore | `MentionQuery` + `mentionAssetType` | 30 |
| — | **合计** | — | — | **490** |

```text
new_total=9
new_unregistered=0
new_line_cap_total=490
```

---

## 5. 子需求详细方案（R-01～R-15 + R-07E）

> 每条固定四段：**背景 → 目标 → 描述 → 详细方案设计**；末尾给「验收对应 / 风险与回滚」。伪代码只表达结构与顺序，不贴真实实现。

### R-01 模块契约对象与 7 个应用子模块入口（P0｜难度中｜风险中）

- **背景**：现状只有目录名。237 个文件在地图里是 1 个模块（`god_module`，score 50），跨域调用无法从结构上判定归属；入口文件不存在，`app.ts` 直接内联各域调用。
- **目标**：7 个入口各存在、≤60 行、字段齐全；每个入口**同时具备静态面与钩子**（v3 第 7 轮打回的修复点，本版保持）。
- **描述**：契约见 §4.3；入口组织规则为 **S1–S5**（静态面必选、静态面优先真用、静态面不触达 `@/agent`、动态块成员冻结、说明符相位冻结）；入口按「静态面 → 动态块 → 契约对象」三段排列。
- **详细方案设计**：
  ```text
  入口文件三段式（任何入口不得例外）：
    ① 静态面   import/export … from "./<自家域>/…"     ← 5 个入口至少 1 条值级（S1/S2）
    ② 动态块   import("./…") 或 await import("./…")    ← 仅 f1d / g4b 冻结的 2 处（S4）
    ③ 契约对象 const module: ServerModule = { id, routePrefixes, gateways?, dependencies, exports, 钩子 }
    export default module
  ```
  - `dependencies` = 该模块对其它模块的**直接深路径边**（20 条边子集，含 E10 的 7 条弱边），`@/agent` 边不计入（NG1/E6）；
  - 入口**不承载业务实现**：实现体下沉既有域文件（不新增文件，L2 固定 9 个）；
  - `exports` 只列 `app.ts` 的调用面（D-04），否则 `b5s`/`c7s` 会被顶高。
- **验收对应**：A-06、A-07、A-18、A-29（`lr1–lr5`）；补充 `s1a/s1b/s1c`（v3 §2.5 的证据沿用）与 V16。
- **风险与回滚**：入口与目录脱节 → `routePrefixes` 反向对账（§A.14）+ `dependencies` 与实际边对账；入口超 60 行 → 实现体下沉；静态面缺行 → `lr2<7` 立即 FAIL。

### R-02 `app.ts` 瘦身为组合根（P0｜难度中｜风险高）

- **背景**：`app.ts` 160 行混写参数归一、6 类插件初始化、供应商哈希、缩略图预热、模型刷新、MCP/A2A 构造、静态与错误处理、移动互联。
- **目标**：≤80 行；禁用符号 0；7 项中间件顺序可判；`createApp` 签名/返回值逐字不变；**静态 import 图不得传递求值 `conf`**。
- **描述**：只保留 5 件事——参数归一、动态装配 7 入口、步骤 1–8、7 项中间件、步骤 9–15（§4.2）。
- **详细方案设计**：
  ```text
  app.ts 内**禁用的符号**（矩阵 A-08 的逐字正则，计数必须 = 0）：
    initializePlugins | autoInstallProviders | createHash | createMcpRouter | createA2aRouter
    | initializeMobileLinkRuntime | initializeProviderModels
    （`initializePlugins` 的包装名必须叫 `syncDirectory`，否则该正则命中）
  另有两类由其它判据覆盖、本方案同样禁止在 app.ts 出现：
    sweepThumbnailCache（f1b 期望 0）、scanBuiltin 的实现体（A-10：5 键扫描整体归口到步骤 8 的入口调用）
  app.ts 内**必须**只有 1 处 `app.locals.builtinPlugins = ...`（步骤 8），且同文件 0 处 `readdir`/`pattern` 分支
  ```
  - `pluginRoots` 的 6 个赋值是**唯一**把 `createApp` 形参翻译成插件类型词表的点（`{ tool, node, ext, skill, provider, agent }`）；
  - `app.ts` 对 7 个入口使用**动态 `import()`**（D-01）：入口静态面会传递求值 `conf`（§2.3.3），静态化会让 `conf` 早于 `TOONFLOW_DATA_DIR`；
  - 因此 A.3③ 的 `app.ts` 静态段 = **0**，入口装配动态段 = **7**；归一化 252 与 **E13** 见 §2.3。
- **验收对应**：A-08、A-09、A-25（`f2a/f2b`）、A-26（`g5` 行号递增）、`k2/k4`。
- **风险与回滚**：数据目录时序 → 步骤 [0] 先于 [1]；中间件顺序 → 显式有序块 + `grep -n`；若评审要求静态装配（D-01-B），需同时改矩阵 A.3③ 并接受 `f2a/f2b` 风险，本版不推荐。**打包器风险**：桌面/移动打包若把 7 个动态 `import()` 内联为静态，需在三宿主冒烟（A-21）中额外验证 `TOONFLOW_DATA_DIR` 时序与 `conf.path` 落在宿主目录。

### R-03 初始化 15 步归口与「顺序 + 阻塞性 + 错误语义」（P0｜难度中｜风险高）

- **背景**：15 步的顺序/阻塞性/吞错语义各不相同，5 组路由消费 `builtinPlugins`。
- **目标**：15 步全部归口；每步的锚点、阻塞性、错误语义逐项可核对（A-26）。
- **描述**：顺序表见矩阵 §R-03；本版对 3 处受影响步骤给出确切形态（步骤 4/5/9/15）。
- **详细方案设计**：
  ```text
  步骤 4 initializeProviders(ctx)（mediaGeneration 入口）：
     guard: ctx.dataDirectory && ctx.pluginRoots.provider        ← 键名 "provider"（六类词表）
     source = resolve(ctx.pluginRoots.provider, "media")
     revision = ctx.pluginRevision ?? sha256(4 个内置文件；ENOENT → 空 Buffer，其它 errno 抛出)
     await ctx.syncPluginDirectory(resolve(dataDirectory,"providers"), source, [4 个文件名], revision)

  步骤 5 warmup（assetLibrary 入口；**同步签名 + void + 空 catch**）：
     void import("./assets/thumb").then(({ sweepThumbnailCache }) => sweepThumbnailCache()).catch(() => {})

  步骤 8 scanBuiltin(ctx)（pluginMarket 入口）：
     5 键 = BUILTIN_TYPES；roots 按同一词表索引；readdir ENOENT→[]、其它 errno 抛出

  步骤 9 refreshModels（mediaGeneration 入口）：
     await import("./ai/initialize")（导入失败 → createApp reject）
     void initializeProviderModels().catch(error => console.warn("启动时刷新供应商模型失败：", error))

  步骤 15 initializeRuntime（localRuntime 入口）：
     静态 import ./mobileLink（求值在步骤 [1]）+ 此处调用 initializeMobileLinkRuntime(app)
  ```
  - 步骤 5 与步骤 9 **禁止**合并成同一个 helper（R17）：一个是静默吞错、一个是 warn，`g3`/`g4` 分别计数；
  - 步骤 3（`initializeExt`）与步骤 12（`@/agent/a2a`）必须保持动态 import（A-26 禁止项 7）。
- **验收对应**：A-10（5 键 `Set` + 顺序 + 锚点）、A-25（`f1a–f1d`）、A-26（`g1–g6`）、`s3`（非空性）。
- **风险与回滚**：把静默吞错改成带日志、或 `void` 改 `await` → `g1/g3` 立即 FAIL；`scanBuiltin` 键名漂移 → `s2` + `typecheck` 双杀。

### R-04 服务目录模块化（P0｜难度很高｜风险高）

- **背景**：15 个 `utils/*` 子域、246 处深路径、145 处 facade 引用；大文件集中在少数域（`assets/library.ts` 729 行、`media/provider.ts` 498 行、`plugins/install.ts` 450 行）。
- **目标**：`src/utils/**` 只留 `src/utils.ts`（facade）；7 个模块目录成形；246 处深路径一处不漏；`@/utils/` 深路径归零；**platformCore 的 20 个来源文件逐一登记**（打回 #1）。
- **描述**：按 SPEC 逐目录迁移，**只替换前缀不改形态**；含 `src/agent/**` 的 50 处说明符更新；`src/routes/**`、`src/lib/**`、`src/types/**` 原地不动。
- **详细方案设计**：
  ```text
  for (old, new) in SPEC 映射: git mv <old> <new>            // 保留文件历史
  for 每个 .ts 文件: 前缀替换                              // 迁移前 "@/utils/<域>" → 迁移后 "@/modules/<模块>/<域>"
                     （只改前缀；`import type` / `export * as` / namespace 别名一律不动）
  两处相对路径深度补偿（**不得**改 alias，否则 f2c 与边计数失真）：
     utils/singleAgent/types.ts:2   "../../agent/runtime/types" → "../../../agent/runtime/types"
     src/index.ts:3                 "../../../electrobun.config"  不变（文件不移动）
  三道闸：typecheck → 端点 method+path diff → A.3 深路径分段计数（50/62/103/30/0）
  ```
  - **platformCore 的来源必须按 §2.2.1 分“移动 4 / 不移动 16”登记**；`lib/**`（8）与 `types/**`（1）虽然不移动，但仍是 platformCore 的 L1 文件，必须计入 20；
  - 新增 `lib/mentionSources.ts`（L2 #9）后，platformCore L3 = 22。
- **验收对应**：A-01/A-02/A-03（台账）、A-13（`f2c=2`）、矩阵 §A.3 ①②③⑤、A-29（`lr5`）、`n1/n2`。
- **风险与回滚**：漏改一处 → `typecheck` 失败；误改形态 → `f2c` 变 3；入口里写 `@/utils` 或 `@/modules` → `s5`/`lr3`/`lr4` 立即 FAIL；**来源漏项 → `n1` 直接 FAIL**（本版新增，针对打回 #1）。

### R-05 路由装配分组（P1｜难度高｜默认豁免 E4）

- **背景**：`router.ts` 327 行 / 161 条扁平 `app.use`，由 `core.ts` 在 dev 下按 `routes/**` 目录重写。
- **目标**：按模块分组可读；**URL 与端点数量不变**（162 / 161 / 21 前缀）。
- **描述**：保留 161 条挂载（E4），只在生成器里加分组注释与空行，不新增路由分组文件。
- **详细方案设计**：`core.ts` 的生成器按「模块 → 前缀」输出注释块；注释行**不得**含 `app.use` 字面量（否则 A-11 的挂载计数会变）；`router.ts` 每次 dev 启动重写，故手写注释会被覆盖 → 所有分组信息必须来自生成器。
- **验收对应**：A-11、A-07、`router.ts` 全文 diff（M0 冻结）。
- **风险与回滚**：分组导致挂载顺序变化 → 全文 diff 比对；顺序被打乱 → 直接回滚 R-05（其余 R 不受影响）。

### R-06 聚合入口 `utils.ts` 收敛为薄 facade（P1｜部分豁免 E2）

- **背景**：`utils.ts` 75 行 / 37 出口 / 5 个来自 `@/agent`，是 bootstrap 枢纽环（E12）。
- **目标**：调用面冻结（145 个文件不变）；内部路径跟迁；`@/agent` 5 个出口保留（E2）。
- **描述**：只改 30 条深层 import 的目标前缀，不改 `export * as` 结构；`mediaProvider` namespace 保留（4 处消费）。
- **详细方案设计**：
  ```text
  utils.ts：`import * as mediaProvider from "@/modules/mediaGeneration/media/provider"`（**域文件**，不是入口）
  → 保持 `u.mediaProvider.addMediaProvider` 调用面不变；
  → 不引入 facade → 入口 → 域 的多余层级（否则 145 计数与求值面都会变）。
  ```
- **验收对应**：A.3 ④（145）、A-12（14 exports）、E2/E12。
- **风险与回滚**：facade 少一个出口 → 145 个文件的 `u.xxx` 崩；`typecheck` + 145 计数双保险。

### R-07 跨域依赖边 A–D（P0｜难度高｜风险中）

- **背景**：4 类隐式跨域调用：素材库/工作区 → `@/agent`（A）、插件安装内核被 MCP 复用（B/C）、`conf` 的 type 环（D）。
- **目标**：A 的 4 处归零；B/C 深路径归零改公开入口；D 的 2 条 type 边归零且反向 4 条 value 不变；A.3 模块段保持 103（R-07D 的 +2 见 §3）。
- **描述**：四条边各自给出「目标形态 + 唯一消费点 + 禁止项」，并以矩阵 `a/b/c/d` 组的 label 逐项对齐；不做任何行为改写，只改说明符与公开面。
- **详细方案设计**：
  ```text
  (A) mentionSources 下沉
      新建 src/lib/mentionSources.ts（≤30 行）：MentionQuery（type）+ mentionAssetType（纯路径判定）
      agent/mentionSources.ts → 仅 re-export（保持 @/agent 外部契约）
      4 处调用点改指 @/lib/mentionSources：assetLibrary/assets/{index,library,thumb}.ts、routes/workspaces/files/thumb.ts
      → A.3 计 0（@/lib 不在该段）；A.11 的 asset→platform +3、local→platform +1

  (B) pluginMarket → mediaGeneration
      公开面：mediaGeneration/index.ts  `export { addMediaProvider } from "./media/provider"`（b5s=1）
      消费点：pluginMarket/plugins/install.ts 整行 `import { addMediaProvider } from "@/modules/mediaGeneration";`
      禁止：pluginMarket 入口出现该符号；install.ts 该行与其它符号合并（b5 要求整行逐字）

  (C) mcpIntegration → pluginMarket
      pluginMarket/index.ts：c9 三条 re-export（逐字）
      mcp/{dxt,tools,resources}.ts：改指 @/modules/pluginMarket（resources 用 `{ skillFiles as skillFile }` 保 7 处调用面）

  (D) conf ↔ teams/mobileLink 的 type 环（本版默认 A 实现，见 §3）
      conf/index.ts：删 2 条 type import，在本文件定义 RemoteTeam / MobileLinkConfig 并导出
      teams/index.ts、mobileLink/index.ts：
        import conf, { type X } from "@/modules/platformCore/conf"     ← 保留 1 条 import（d4v=4 的来源）
        export type { X } from "@/modules/platformCore/conf"          ← 新增 1 条 type re-export（A.3 +2、d4t=2）
      → A.3 模块段 103；SCC 2→1；d4v=4 / d4 raw=6（D-09）
  ```
- **验收对应**：A-13（`a1=4→a2=0`、`a3` 三段）、A-14（`b1..b5s`）、A-15（`c1..c9`）、A-16（`d1..d5` + `d4v/d4t`）。
- **风险与回滚**：`agent/mentionSources` 外部契约 → 保留原路径 re-export + 桌面冒烟；B 边公开面放回 pluginMarket → `b5s=0` 立即 FAIL；C 边 namespace 别名写错 → `c8a` 由 7 变 0；D 边改用 v3 的 B 方案 → 模块段 101、归一化 250（需追加豁免，故默认不选）。

### R-07E `dxt ↔ servers` 模块内环（P2｜难度低｜默认豁免 E11）

- **背景**：B0 的 2 个 file 级 SCC 之一（`size=2`），R-07D 后唯一残留。
- **目标**：冻结 2 条边（两相各 1）；目录内相对 import = 0；`scc_count=1,size=2`。
- **描述**：两函数互为兜底清理，拆开只会增加无业务含义的抽象。
- **详细方案设计**：迁移后 `modules/mcpIntegration/mcp/{dxt,servers}.ts` 互引**保持 alias**；**禁止**改成 `./servers`/`./dxt`（会让 `e5a/e5b` 由 0 变 1）。
- **验收对应**：A-17（`e1..e6`）、E11 模板（矩阵 §8.4 沿用）；模拟实测 `e3=e4=1`、`e5a=e5b=0`、SCC=1。
- **风险与回滚**：把“冻结”当“未完成” → E11 勾选栏写明「已裁决 = 保留」。

### R-08 宿主装配兼容（P0｜难度低｜风险中）

- **背景**：三宿主（独立 server / Electrobun 桌面 / 移动端）复用 `@toonflow/server/app`；桌面拿到 app 后注入 `app.locals.desktop`。
- **目标**：`createApp` 签名与 14 个 export 键名逐字不变；三宿主行为不变。
- **描述**：`package.json` 的 5 个 target 按 SPEC 更新（`./mcp`、`./mobileLink`、`./browser`、`./singleAgent/types`、`./remoteConnection`），**键名不动**。
- **详细方案设计**：`pluginRoots` 的翻译在 `createApp` 内部完成，宿主无感；桌面 15 个 `/api/desktop/*` 端点门禁仍在中间件区同一位置；入口静态面不改变 `app.locals.desktop` 的注入时刻（宿主在 `createApp` resolve 后注入）。
- **验收对应**：A-12、A-21（三宿主启动 + 桌面 15 端点门禁）。
- **风险与回滚**：exports target 改错 → 5 个入口 404/编译失败；A-12 + 三宿主冒烟兜底。

### R-09 规范、地图与包导出同步（P0｜难度低｜风险低）

- **背景**：`AGENTS.md` 目前只描述 1 个 `server-api` 模块；地图按目录 glob 统计。
- **目标**：AGENTS 与新结构一致；地图重算 = L3 `246 / ≤14,842`（HEAD 口径）；exports 无悬空。
- **描述**：AGENTS 增「模块入口」小节（静态面/动态块/契约对象三段式）、模块清单（8 个 id）、变更记录（归属更正 + 9 个滞后文件 + platformCore 的 4+16 构成），并保持 `tsconfig.paths` 不变。
- **详细方案设计**：模块清单逐模块列出 `id / 职责 / routePrefixes / gateways / L1 文件 / L2 / L3 / dependencies`；地图重算时把 `lib/**` 与 `types/**` 计入 platformCore；变更记录显式写 `20 = 4 + 16` 与 `22 = 20 + 2`。
- **验收对应**：A-22。
- **风险与回滚**：地图 glob/行数口径差异 → 模块清单显式记录口径（沿用矩阵 §1.2 的做法）。

### R-10 回归基线与 13 项冒烟（P0｜先行）

- **背景**：结构重构必须证明“行为零变化”，否则评审无法判定。
- **目标**：M0 冻结 5 份基线（HEAD、162 条 method+path、`router.ts` 全文、typecheck/build 状态、14 exports/36 文件/57 引用）；13 项 + S1–S8 逐条可比。
- **描述**：S7（`GET /api/skills/list`）、S8（`GET /api/agents/get`）是功能探针（读 `builtinPlugins.skill/.agent`）。
- **详细方案设计**：冒烟判据 = 归一化后 diff 为空；S7/S8 额外记录「内置项数量」列（B0 基线值 → F 必须相等），把 `s3` 的非空性做成可读证据。
- **验收对应**：A-20（13 项 + S1–S8 + 21 前缀）、A-11。
- **风险与回滚**：fixture 不稳定 → 固定目录 + 固定 uuid；响应含时间戳 → 归一化白名单。

### R-11 结构化豁免登记（P0｜难度低｜风险低）

- **背景**：部分问题（bootstrap 枢纽环、`dxt↔servers`、`utils.ts` 5 个 agent 出口、**A.3③ 的静态/动态拼写差**、**d4 的 raw/import-only 口径差**）无法在本需求内消除。
- **目标**：E1–E14 逐条填表（编号/理由/缓解/触发条件/责任人/判据），E11/E12/E13/E14 给完整模板。
- **描述**：沿用矩阵 §8.2 的 E1–E12 候选清单与 §8.4 的 E11/E12 完整模板；**本版新增 E13/E14**（§8.2/§8.3），均为“已发现、已量化、有替代判据”的结构化豁免，不是“留待以后”。
- **详细方案设计**：每条豁免必须有 ① 事实（file:line + 计数 + 复现命令）；② 未消除理由（契约/范围/风险）；③ 可执行的替代缓解；④ 复核触发条件；⑤ 责任人；⑥ 有效期；⑦ 评审裁决。无判据的豁免无效。
- **验收对应**：A-23。
- **风险与回滚**：豁免流于形式 → 评审在 §10.4 逐条勾选；被驳回的豁免转为对应 A 项。

### R-12 三本台账与预算审计（P0｜难度中｜风险低）

- **背景**：237 文件需要逐文件归属（L1）、9 个新文件登记（L2）、交付态汇总（L3）；第 8 轮打回指出 platformCore 来源列不完整。
- **目标**：L1 237 / L2 9 / L3 246、≤14,839（B0）/ ≤14,842（HEAD）；业务 ≤50/模块；交付 ≤55 文件、≤3,300 行/模块；`app.ts` ≤80；入口 ≤60。
- **描述**：三本台账（L1/L2/L3）+ 5 类预算 + A-24 的边界检查（零测试/零依赖/零分层）。
- **详细方案设计**：
  ```text
  审计脚本口径与矩阵 §A.10 一致；本版新增两条断言（针对打回 #1）：
    n1: 逐模块输出 moved_files + unmoved_files = L1_files，且 moved_lines + unmoved_lines = L1_lines
    n2: 逐模块输出 L1 + L2 = L3，且 8 模块求和 = 246；platformCore 的 moved/unmoved = 4/16
  预算：bootstrap ≤750；assetLibrary ≤2,675；mediaGeneration ≤3,054；pluginMarket ≤2,343；
        mcpIntegration ≤1,493；localRuntime ≤2,255；agentAccess ≤1,253；platformCore ≤1,016
  上限：单模块业务 ≤50（pluginMarket 49 为最大值）；交付 ≤55 文件 / ≤3,300 行
  ```
  - 本版**不增加文件**（`scanBuiltin` 实现留在既有 `plugins/initialize.ts`；`addMediaProvider` 公开在既有入口）；入口静态面只是 import 行，不改变行数预算（模拟入口 6–15 行）。
- **验收对应**：A-01～A-05、A-24、`n1/n2`。
- **风险与回滚**：把“不移动”误当“不属于本模块” → `n1` 直接 FAIL（本轮打回 #1 的制度化）；把移动误报为新增 → 显式 old→new 映射。

### R-13 模块级 SCC 与依赖白名单（P1｜难度低｜风险中）

- **背景**：模块级 20 条直接边 + bootstrap 枢纽环；`dependencies` 若无约束会与实现脱节。
- **目标**：`dependencies` ⊆ 白名单；SCC-1（5 域模块）与含 bootstrap 枢纽环按 E12 接受；file 级 SCC 收敛为 `dxt↔servers`。
- **描述**：机械判定「`dependencies` ⊆ 白名单」「实际边 − 声明边 = ∅」「模块级 SCC 成员与矩阵 §2.4 一致」。
- **详细方案设计**：
  ```text
  dependencies = 该模块对其它模块的**直接深路径边**（20 条边子集，含 E10 的 7 条弱边，否则“声明 ≠ 实际”）
  入口新增的**相对** import（./…）不计入跨模块边（v3 §2.6）
  bootstrap 侧观察项（本版登记，F-11）：
    B0 bootstrap→pluginMarket = 7 行（含 app.ts 的 initializePlugins 静态行）
    F   bootstrap→pluginMarket = 6 行（该静态行移入 pluginMarket 入口；入口是动态装配，不计 import 行）
    → 20 条“域间边”不变；A-18 的 20 条断言不受影响；该差值作为观测登记，不作为 FAIL
  ```
- **验收对应**：A-18、矩阵 §A.6、§A.11；模拟实测 20 条边与 §2.4 的 R-07 后预期一致。
- **风险与回滚**：把 SCC-1 误判为“拆分失败” → 评审栏写明验收是“237 文件 god module 消除 + 边界/预算”，不是“模块级无环”。

### R-14 判据工程（两相 / 守卫 / 台账 / 相位扫描 / 归一化计数）（P0｜难度中｜风险中）

- **背景**：前 7 轮打回中，5 次是“判据不可执行/不可达/引用悬空”，2 次是“方案踩空判据”。第 8 轮的两条打回分别属于“台账来源列不完整”与“数值差未登记豁免”。
- **目标**：每条判据有 phase；无悬空引用；方案级探针 `s1–s9`、`n1/n2`、`k1–k5`、`d4v/d4t` 全部可执行且非空转。
- **描述**：在 v3 的 `s1–s6` 基础上新增：
  - `n1/n2`：platformCore 来源完整性与 20/22/246 等式（打回 #1）；
  - `k1–k5`：A.3③ 的 245 + 7 = 252 归一化（打回 #2）；
  - `d4v/d4t`：R-07D 的 value 边与 type re-export 分离计数；
  - `s7`：A.3 模块段 103 的 −2/+2 对账（R-07D 前后）；
  - `s8`：`app.ts` 静态图不含 `@/modules/**`（只允许动态 import）；
  - `s9`：`src/modules/**` 内 `from "@/modules/` 行数减去 7 个入口 = 103（与 `lr4=0` 联动）。
- **详细方案设计**：
  ```text
  s1a  lr2 复现（v2 骨架 → 4 / FAIL）        s1b  lr2 修复（本版骨架 → 7 / PASS）
  s1c  lr2 非空转（本版骨架删 1 条 → 6 / FAIL）
  s2   pluginRoots 键集合 = 6、近义词 0
  s3   builtinPlugins 非空 + 与 B0 逐字相等（M1 基线 / M7 判定）
  s4   入口内全部 `from "…"` 的目标文件存在
  s5   全文说明符相位扫描（F 相块 violations=0）
  s6   入口静态面静态图 agent 边 = 0
  s7   A.3 模块段 103（B0 103 − 2 + 2）
  s8   app.ts 静态 `from "@/modules/` = 0（静态图不含入口）
  s9   modules 段 103 − 入口贡献 0 = 103
  n1   moved/unmoved 完整性（platformCore 4/16）
  n2   20/22/246 等式
  k1–k5  A.3③ 245 + 7 = 252
  d4v/d4t  R-07D 口径
  ```
- **验收对应**：A-27、A-28、A-29；§2.3、§3.3、附录 B。
- **风险与回滚**：探针写成“零命中即通过”的空转判据 → 每个 `s/n/k/d` 都带 scope 与 B0 可达性证明（附录 B）；`k1–k5` 的期望都是正向计数或等式，不是空搜索。

### R-15 默认数据目录锚点不变 + 相对路径深度补偿（P0｜难度低｜风险中）

- **背景**：`conf/index.ts` 的默认锚点 `resolve(import.meta.dirname, "../../../../../data")`（5 级）→ `<repo>/data`；迁到 `modules/platformCore/conf` 后深 1 级会落到 `apps/data`。矩阵写“`:11`”，实际为 **`:13`**（F-15，行号笔误，不影响判据）。
- **目标**：`f2a` 在 F 相仍 = 1；`f2b` 显式目录生效且仓库 `data/` 不被写；`f2c=2`。
- **描述**：两种实现（Q12）：**A 深度补偿**（5 → 6 级）/ B 稳定锚点（向上查找 `package.json`）。
- **详细方案设计**（默认 A）：
  ```text
  补偿：resolve(import.meta.dirname, "../../../../../../data")（5 → 6 级）
        路径深度：conf → platformCore → modules → src → server → apps → repo，再 /data = <repo>/data
  校验：f2a 静态解析 = <repo>/data；f2b 显式 TOONFLOW_DATA_DIR 生效；仓库 data/settings.json md5 前后一致
  本轮补充约束：入口静态面（v3 §2.6）不改变 conf 的求值前提——步骤 [0] 设 env、步骤 [1] 才 import 入口
  ```
- **验收对应**：A-25（`f2a/f2b/f2c`）、L24/L26。
- **风险与回滚**：补偿级数算错 → `f2a` 立即 FAIL（探针只读、零副作用）；锚点改法不统一 → 只允许 A/B 二选一。

---

## 6. UI 影响评估与界面回归说明

### 6.1 结论：**本需求没有任何 UI 变动**

| 维度 | 是否有变动 | 依据 |
| --- | --- | --- |
| 端点集合 | 无 | 162 条 method+path 逐条 diff（A-11）；`routes/**` 原地不动 |
| 路由与 URL | 无 | URL 由 `core.ts` 的 `fileNameToRoutePath` 从文件路径生成，路由文件不移动 |
| 响应结构 | 无 | 不改任何 handler 与 `lib/responseFormat` |
| 静态资源 | 无 | `express.static(webRoot)` 位置与参数不变（步骤 [13]） |
| 前端调用面 | 无 | 145 个文件继续 `import u from "@/utils"`；`utils.ts` 只换内部前缀（R-06） |
| 初始化语义 | 无 | 15 步的**调用**顺序/阻塞性/错误语义不变（A-26）；仅 3 个模块的**求值时刻**前移（v3 §2.6） |

> **UI 设计说明（按任务要求显式给出）**：本需求为服务端结构性重构，**不新增/不修改任何界面、组件、样式、交互与文案**。因此“UI 设计”部分的交付物是**无 UI 变更声明 + 界面回归清单**（§6.2），而不是设计稿。若评审要求 UI 侧证据，只执行 §6.4 的检查动作，无需设计工作。

### 6.2 界面回归检查清单（模块 → 界面位置 → 交互点）

| # | 模块 | 界面位置 | 交互点 | 期望 |
| --- | --- | --- | --- | --- |
| U1 | assetLibrary | 素材库面板（列表/预览/收藏/回收站） | 打开目录、缩略图出现 | 与基线一致；`GET /api/assets/thumb` 200 |
| U2 | assetLibrary | 素材库 → 右键菜单 | 重命名/移动/删除/还原 | 状态码与提示文案一致 |
| U3 | mediaGeneration | 媒体生成面板 | 选择供应商/模型 → 生成 | `GET /api/providers/*` 列表数一致；生成任务可提交 |
| U4 | pluginMarket | 插件市场（工具/节点/扩展/技能/团队） | 安装/启用/卸载 | 列表内置徽标（`builtinPlugins`）**仍在**（S7/S8） |
| U5 | mcpIntegration | 设置 → MCP | 启停、连接、工具列表 | 状态与工具数与基线一致 |
| U6 | localRuntime | 工作区/桌面更新/移动互联 | 打开项目、检查更新、配对设备 | 桌面 15 端点门禁不变；`/api/connection` 代理一致 |
| U7 | agentAccess | Agent 对话 / 会话状态 | 发送消息、切换会话、@ 素材 | 会话恢复与提及（mentionSources）一致 |

### 6.3 「现象 → 断点」对照（UI 异常时的定位顺序）

| 现象 | 第一断点 | 第二断点 | 第三断点 |
| --- | --- | --- | --- |
| 页面 404 / 接口全挂 | `router.ts` 是否 161 条（A-11） | `routePrefixes` 并集是否 21 项（A-07） | `app.ts` 装配顺序（§4.2） |
| 素材缩略图空白 | `assetLibrary.warmup`（`f1c/f1d`） | `assets/thumb` 缓存目录（`conf.path`） | 数据目录锚点（`f2a`） |
| 插件列表“内置”徽标消失 | `scanBuiltin` 5 键（A-10） | `pluginRoots` 键名（`s2`） | 非空性（`s3`） |
| MCP 面板连不上 | `mcpIntegration.mount` 的 4 条动态 import（`g4b=4`） | `/mcp` 网关归属（A-07） | `getMcpSettings`（静态面） |
| 移动端配对失败 | 步骤 15 调用（A-26） | `localRuntime` 静态面 `./mobileLink`（§4.4 #5） | `conf` 的 `MobileLinkConfig` 类型 re-export（§3.2） |
| 媒体生成返回 500 | `refreshModels` 的 `void` 语义（`g4`） | `initializeProviders` 哈希/同步（步骤 4） | 供应商目录根（`pluginRoots.provider`） |

### 6.4 UI 侧验收动作（只需执行，不需设计）

三宿主各启动一次（A-21），按 §6.2 的 U1–U7 各走 1 遍；判据是「响应归一化后 diff 为空」，不要求人工判读视觉效果。

---

## 7. 实施计划与里程碑（评审通过后执行）

| 里程碑 | 内容 | 出口条件（全部可判） |
| --- | --- | --- |
| **M0 基线冻结** | 5 份基线：HEAD、162 端点清单、`router.ts` 全文、typecheck/build、14 exports/36 文件/57 引用 | 5 份基线落盘；`apps/server` 工作树干净；`n1` 记录 B0 的 59/178 |
| **M1 B0 语义探针** | 矩阵 `f4/f5`、`g1–g6`、`s3` 的 **B0 基线**输出 | 结果归档；**明确标注“不得作为 A-25/A-26 的 PASS 证据”**（矩阵 §1.6.6） |
| **M2 骨架落地** | 7 个入口（含**静态面**）+ `types/module.ts` + `lib/mentionSources.ts` | `s1b`（`lr2=7`）、`s4`（入口说明符目标存在）、`s2`、`typecheck` 通过 |
| **M3 迁移与边契约化** | R-04 迁移、R-07 A–D（含 R-07D 的 +2 re-export）、R-07E 冻结 | `typecheck`；`s7`（103）、`s9`（103）、`n1/n2`（20/22/246）；`a2/b3/b4/b5/c4..c9/d3/d4v/d4t` 达标 |
| **M4 组合根瘦身** | R-02/R-03：`app.ts` ≤80、15 步归口、中间件顺序 | A-08、A-09、`g5` 行号递增、`s8`（静态 0） |
| **M5 规范与豁免** | R-09（AGENTS/地图/exports）、R-11（E1–E14） | A-22、A-23 |
| **M6 台账与文档自审** | R-12 三本台账、A-27/A-28 自审、`k1–k5` | `ledger_rows=32`、`doc_audit=PASS`、`stale_specifier_in_PHF=0`、`k4=252` |
| **M7 F 相语义探针** | A-25 / A-26 / A-29 的**交付态**证据 | `f1a–f1d`、`f2a–f2c`、`f3a/f3b`、`f4/f5`、`g1–g6`、`lr1–lr5`、`k1–k5`、`n1/n2`、`s5/s6/s7/s8/s9` 全部达标 |

**变更面（文件级）**：9 个 L2 新文件 + 59 个移动文件 + 其余仅改说明符的文件 + `app.ts` + `utils.ts` + `core.ts`（分组注释）+ `package.json`（5 个 target）+ `AGENTS.md`。**零测试文件、零新依赖、零 controller/service/repository**（A-24）。

**回滚策略**：M2–M4 每步都是独立可回滚的 commit；迁移用 `git mv`（保留历史），回滚 = `git revert`；入口静态面若被评审否决（D-06），只改 3 个入口的 1 行。

---

## 8. 豁免与裁决

### 8.1 候选豁免 E1–E14（逐条勾选）

| ID | 关联 | 内容 | 理由 | 替代缓解 | 判据 |
| --- | --- | --- | --- | --- | --- |
| E1 | R-07C | 插件安装/工具内核以“公开入口”而非独立包提供 | 抽包违反 NG3 | 入口显式导出三组符号 | A-15 `c7/c9` |
| E2 | R-06 | `utils.ts` 保留 5 个 `@/agent` 出口 | 145 个调用面不改 | 出口加注释；不扩散 | A-12 |
| E3 | R-04 | `/api/exec` 与工作区同属 localRuntime | 共享工作区根/越界防护 | 入口 `dependencies` 显式声明 | A-04、A-18 |
| E4 | R-05 | `router.ts` 保留 161 条扁平挂载 | 生成器改动风险高 | 分组注释 + 前缀所有权对账 | A-07、A-11 |
| E5 | R-07D | `conf` 仍有 2 条指向 localRuntime/pluginMarket 的**值**依赖 | 配置 schema 与业务读取同源 | 反向 value 边保留并计数（d4v=4） | A-16 `d5` |
| E6 | NG1 | 19 处运行期 agent 依赖保留 | 会话运行时属另一模块 | 边界表逐条登记；不新增第 20 处 | A-13 `a3` |
| E7 | R-07D | `platformCore → @/agent` 3 处 | 平台配置语义 | 不新增第 4 处 | 矩阵 §2.3 |
| E8 | R-07C | MCP 工具运行 Agent | MCP 端点本质是 Agent 工具面 | 仅此 2 行 | 矩阵 §2.3 |
| E9 | R-07 | `pluginMarket → @/agent` 1 处 | A2A 模型校验 | 仅此 1 行 | 矩阵 §2.3 |
| E10 | R-07/R-13 | 7 条残余弱边 | 读配置/取枚举级弱边 | 边矩阵冻结；不新增 source→target 对 | A-18 |
| E11 | R-07E | `dxt ↔ servers` 模块内 2 文件环 | 互为兜底清理 | 两相判据 + SCC 探针 | A-17 |
| E12 | R-13 | 模块级 SCC-1 + bootstrap 枢纽环 | 既有架构事实 | 不承诺 DAG；边计数上限 | A-18 |
| **E13** | **R-04/R-14** | **A.3③ 静态 grep = 245（矩阵 252），差 7 行** | **`app.ts` 的 7 个入口装配必须动态 `import()`；静态化会让 `conf` 早于 `TOONFLOW_DATA_DIR` 求值，违反 NG4 与 A-25 `f2a/f2b`** | **归一化口径 `k1+k2=245+7=252`；`k1–k5` 五个子项；zero-guard=0；typecheck** | **§8.2 模板 + 附录 B `k1–k5`** |
| **E14** | **R-07D** | **`d4` raw grep = 6（矩阵期望 4），多出 2 条 type re-export** | **2 条 `export type … from` 用于保留 `RemoteTeam`/`MobileLinkConfig` 的公开类型面；按矩阵 §1.6.5 的 `import` 行口径，value 边仍为 4** | **`d4v=4`（import-only）+ `d4t=2`（type re-export）+ `d3=0`；A.11 的 `platform→plugin 0` 等三条不变** | **§8.3 模板 + 附录 B `d4v/d4t`** |

### 8.2 E13 完整模板（A.3③ 的静态/动态拼写差）

```text
[E13] A.3③ 静态 grep 只能到 245（矩阵期望 252），差 7 行
- 关联需求 / 验收项：R-04 / A-03、A-27（§A.3③、L11）
- 事实与证据：
    B0: 50(agent) + 62(routes) + 103(utils) + 30(utils.ts) + 1(app.ts) = 246
    F : 50(agent) + 62(routes) + 103(modules) + 30(utils.ts) + 0(app.ts 静态) = 245
        app.ts 的 7 个入口装配为 import("@/modules/<id>")，不计入“静态 from” grep
        245 + 7 = 252（与矩阵 §A.3③ 的 252 逐字相等）
    模拟树实测（/tmp/sim_f）：50/62/103/30/0 = 245；k2=7；k4=252
- 未消除的理由：风险/契约。app.ts 若静态 import 入口，5 个入口的静态面会传递求值 conf
    （v3 s6：roots/provider/install/control/mobileLink → conf），而 createApp 的第 1 步才设置
    TOONFLOW_DATA_DIR；静态化会让三宿主传入的 dataDirectory 静默失效，破坏 NG4 与 A-25 f2a/f2b。
    矩阵 R-02 本身也要求“静态 import 图不得传递求值 conf”。因此这 5 个入口的装配必须动态；另 2 个为形态统一，7 行统一写成动态 import。
- 替代缓解（可执行）：
    ① k1=245（静态分段）；② k2=7（app.ts 的 7 个入口动态 import）；
    ③ k3 分段 50/62/103/30/0；④ k4=252（归一化）；⑤ k5 非空转（删/改任一入口 import → FAIL）；
    ⑥ zero-guard：F 相 `@/utils/` 深路径 = 0（zero-guard）；⑦ typecheck + 三宿主冒烟。
- 复核触发条件：app.ts 获得安全的静态装配方式（conf 惰性求值/稳定锚点重构）；
    或矩阵 §A.3③ 把期望改为“静态 245 + 动态 7”；或 AgentHost 端口化需求启动。
- 责任人：server-api 模块 owner
- 有效期：本需求交付版本
- 评审裁决：☐ 同意 ☐ 驳回（驳回则需改矩阵 A.3③ 或接受 f2a/f2b 风险）
```

### 8.3 E14 完整模板（`d4` 的 raw / import-only 口径差）

```text
[E14] d4 raw grep = 6（矩阵期望 4），多出 2 条 type re-export
- 关联需求 / 验收项：R-07D / A-16（d4）
- 事实与证据：
    B0 d2 = 4（teams/index 1 + teams/install 1 + teams/files 1 + mobileLink/index 1）
    F  d4v = 4（同样 4 条 import 行）；d4t = 2（teams/index 与 mobileLink/index 各 1 条
       `export type { … } from "@/modules/platformCore/conf"`）；raw = 6
    模拟树实测（/tmp/sim_f）：d3=0、d4v=4、d4t=2、raw=6；A.11 的 platform→plugin 0、
       platform→local 1 value、platform→media 1 value 不变
- 未消除的理由：契约。2 条 re-export 是 R-07D 的公开类型面（RemoteTeam/MobileLinkConfig），
    不是 value 依赖；矩阵 §1.6.5 明确“模块边计数只数 import 行，re-export 不构成新边”。
    raw grep 把 `export … from` 也计入，属测量口径与判定意图不一致。
- 替代缓解（可执行）：
    ① d4v=4（`^\s*import .* from …`）；② d4t=2（`^export type \{.*\} from …`）；
    ③ d3=0；④ d5 三条（A.11）；⑤ SCC=1（A.6）。
- 复核触发条件：评审坚持 raw=4；或 R-07D 改为不新增 re-export（则 A.3 模块段 103→101，
    需追加一条 −2 豁免）；或类型公开面迁到独立包。
- 责任人：server-api 模块 owner
- 有效期：本需求交付版本
- 评审裁决：☐ 同意（按 import-only 判） ☐ 驳回（按 raw=4 判，需追加 −2 豁免）
```

### 8.4 待评审裁决点（D-01～D-10，均有默认值）

| ID | 议题 | 默认 | 备选 | 依据 / 影响 |
| --- | --- | --- | --- | --- |
| D-01 | `app.ts` 装配形态 | **A：7 个动态 `import()`** | B：静态 import 7 入口 | F-02 / §2.3.3：静态化让 `conf` 早于 `TOONFLOW_DATA_DIR` → `f2a/f2b` FAIL；A.3③ 静态段 0→7 |
| D-02 | R-07D 类型归属实现 | **A：类型迁 `conf` + 2 条 type re-export（103）** | B：v3 单行混合 import（101）；C：类型双写 | §3.1：A 保住 252 归一化与 SCC=1 |
| D-03 | `PluginRoots` 键名口径 | **A：六类插件词表 `{tool,node,ext,skill,provider,agent}`（零映射）** | B：宿主参数词表 + 映射表 | 第 6 轮打回 #2（`skills` vs `skill` 静默空集） |
| D-04 | `ServerModule.exports` 语义 | **A：= `app.ts` 调用面** | B：= 入口公开的全部符号 | 方案 B 会把 `b5s` 顶到 2、`c7s` 顶到 4 |
| D-05 | 步骤 9 两段语义的归口 | **A：入口 `refreshModels()` 内两段，`app.ts` 只 `await` 一次** | B：拆成两个钩子 | A-08 禁用符号；`g4` 要求 warn 型 |
| D-06 | 入口静态面的取值形态 | **A：值级 re-export（§4.4）** | B：全部改 `export type { … } from "./…"`（`lr2` 仍 =7） | A 让 3 个模块求值前移（可证等价）；B 零求值漂移但“运行期零信息” |
| D-07 | “入口骨架缺静态 `from`”的口径 | **A：指入口文件（§4.4）** | B：指 `app.ts` 应静态 import 7 入口 | B 会与 F-02 冲突并触发 E13 的另一种形态 |
| **D-08** | **A.3③ 的计数口径** | **A：静态 245 + app.ts 动态 7 = 252（E13）** | B：要求字面静态 252 | B 需静态装配 → 与 D-01-A / R-02 冲突 |
| **D-09** | **`d4` 的计数口径** | **A：import-only = 4（+ `d4t=2`）（§3.3）** | B：原文 raw = 6（E14） | A 与矩阵 §1.6.5 的“import 行”口径一致；B 需接受 raw≠4 |
| **D-10** | **platformCore 来源呈现** | **A：moved 4 + unmoved 16 = 20（§2.2）** | B：拆成两行（移动/不移动）并列 | A 已给出两条等式；B 只是排版差异，不影响数值 |

> 勾选规则：未在 §10 记录的 D 项按默认值执行；未勾选的豁免视为**不同意豁免**，对应验收项生效。

---

## 9. 交付物与验收对照

### 9.1 交付物（本次方案设计阶段）

| 交付物 | 路径 | 状态 |
| --- | --- | --- |
| 本方案 | `.easyvibe/development_docs/liyuhang/2_requirements_solutions/2026-10-27-03-09-serverApiSubmoduleSplit-v4.md` | 新增 |
| 索引 | `.easyvibe/development_docs/liyuhang/2_requirements_solutions/INDEX-2026-10.md` | 更新 |
| 源码/测试/脚本 | — | **零改动**（探针只在 `/tmp`） |

### 9.2 需求 → 方案 → 验收 对照

| 子需求 | 方案章节 | 验收项 | 本轮是否受影响 |
| --- | --- | --- | --- |
| R-01 入口与契约 | §4.3、§4.4、§5 R-01、附录 A | A-06、A-07、A-29 | 否（v3 修复保持） |
| R-02 组合根瘦身 | §4.2、§5 R-02 | A-08、A-09 | **是（E13 的 7 行动态装配）** |
| R-03 15 步归口 | §5 R-03 | A-10、A-25、A-26 | 否 |
| R-04 目录模块化 | §4.5、§5 R-04、§2.2 | A-01～A-03、A-13 | **是（platformCore 4+16；A.3 245+7）** |
| R-05 路由分组 | §5 R-05 | A-11、A-07 | 否 |
| R-06 facade | §5 R-06 | A.3 ④、A-12 | 否 |
| R-07 边 A–D | §3、§5 R-07 | A-13～A-16 | **是（R-07D 的 +2 re-export / d4 口径）** |
| R-07E dxt 环 | §5 R-07E | A-17 | 否 |
| R-08 宿主兼容 | §5 R-08 | A-12、A-21 | 否 |
| R-09 规范/地图 | §5 R-09 | A-22 | 是（platformCore 构成写入清单） |
| R-10 回归基线 | §5 R-10 | A-20、A-11 | 否 |
| R-11 豁免 | §5 R-11、§8 | A-23 | **是（新增 E13/E14）** |
| R-12 台账预算 | §5 R-12、§2.2、附录 C | A-01～A-05、A-24 | **是（n1/n2）** |
| R-13 SCC/白名单 | §5 R-13 | A-18 | 否（新增 bootstrap 7→6 观测） |
| R-14 判据工程 | §5 R-14、附录 B | A-27、A-28、A-29 | **是（k1–k5、d4v/d4t、n1/n2、s7–s9）** |
| R-15 数据目录锚点 | §5 R-15 | A-25（`f2a/f2b/f2c`） | 否（行号 11→13 更正） |

### 9.3 覆盖度与可读性自检

| 维度 | 结论 |
| --- | --- |
| 子需求覆盖 | 16/16（R-01～R-15 + R-07E）均有「背景 / 目标 / 描述 / 详细方案设计」 |
| 打回覆盖 | 第 8 轮 2 条 → §1.1 定性 → §2（数值对账）/ §3（R-07D）/ §8（E13/E14）逐条修复，每条都带「复现 / 修复 / 非空转」三层证据 |
| 可判定性 | 每条修复都绑定**矩阵原脚本**或**本轮新增可执行探针**（`n1/n2`、`k1–k5`、`d4v/d4t`、`s7–s9`） |
| UI | 零 UI 变动；§6 给出 7 行界面回归清单 + 6 行「现象 → 断点」 |
| 产物边界 | 仅新增方案文档 + 更新索引；源码/测试/脚本零改动 |

---

## 10. 评审意见栏（待填写）

### 10.1 总体结论

- ☐ 通过（进入实施）
- ☐ 打回（请填写 10.2）
- ☐ 有条件通过（请填写条件与对应 D 项）

评审人：＿＿＿＿＿＿ 评审时间：＿＿＿＿＿＿ 备注：＿＿＿＿＿＿

### 10.2 打回意见（逐条，评审填写）

| # | 章节 / 位置 | 意见 | 严重程度（阻断 / 一般） |
| --- | --- | --- | --- |
| 1 |  |  |  |
| 2 |  |  |  |
| 3 |  |  |  |

### 10.3 第 8 轮打回处置确认（评审勾选）

| # | 打回意见 | 本版处置 | 证据 | 确认 |
| --- | --- | --- | --- | --- |
| 1 | platformCore 来源漏 `lib/**` 等 9 文件，20/246 等式断裂 | §2.2 完整构成（4 移动 + 16 不移动 = 20；L3 22）；附录 C 全模块台账；§4.5 映射表加“不移动”列 | `n1`（59/178、9,240/5,109）、`n2`（20/22/246） | ☐ 认可 ☐ 不认可 |
| 2 | A.3③ 252 在默认方案下仅 245 且未登记豁免 | §2.3 逐段推导 245 + 7 = 252；**E13 结构化豁免**；`k1–k5`；R-07D 补回模块段 103 | V12/V13、`k1–k5`、§8.2 | ☐ 认可 ☐ 不认可 |

### 10.4 裁决点确认（D-01～D-10）

| D | 默认 | 裁决（采纳默认 / 选备选 / 其他） | 备注 |
| --- | --- | --- | --- |
| D-01 | A：`app.ts` 动态装配 |  |  |
| D-02 | A：类型迁 conf + 2 条 re-export |  |  |
| D-03 | A：六类插件词表 |  |  |
| D-04 | A：`exports` = app.ts 调用面 |  |  |
| D-05 | A：步骤 9 两段同归入口 |  |  |
| D-06 | A：值级静态面 |  | 若选 B，改 2 个入口各 1 行 |
| D-07 | A：静态 `from` 指入口 |  |  |
| **D-08** | **A：245 + 7 = 252（E13）** |  | 若选 B，需改矩阵 A.3③ 并接受 `f2a/f2b` 风险 |
| **D-09** | **A：`d4v=4`（import-only）** |  | 若选 B，`d4 raw=6`，启用 E14 |
| **D-10** | **A：moved 4 + unmoved 16 = 20** |  |  |

### 10.5 豁免裁决（E1–E14）

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
| **E13** A.3③ 静态 245（252 归一化） |  |  |
| **E14** `d4` raw 6 / import-only 4 |  |  |

### 10.6 实施许可

- ☐ 许可实施（按 M0 → M7）
- ☐ 先补材料再议（请写明缺什么）：＿＿＿＿＿＿

---

## 附录 A：7 个入口骨架（伪代码；实现体一律省略）

> 说明：**只保留与判据相关的行**（静态面、动态块、契约对象、关键错误语义），实现体用 `/* … */` 省略。骨架行数目标 15–25 行（≤60，A-06）。
> 每个骨架的 ① 段（静态面）都含**至少 1 条值级 `from "./…"`**（`lr2`）；⑤ 段（动态块）只在 `f1d`/`g4b` 冻结的两处出现。

### A.1 `assetLibrary/index.ts`

```text
import type { ServerModule, ModuleContext } from "@/types/module";      // 外部（bootstrap 类型）
import { internalAssetDirectories } from "./assets/roots";             // ← ① 静态面（值级，lr2）

export { internalAssetDirectories };                                    // 模块边界常量（路径安全清单）

export function warmup(context: ModuleContext) {                        // 步骤 5：同步签名、fire-and-forget
  void import("./assets/thumb").then(({ sweepThumbnailCache }) => sweepThumbnailCache()).catch(() => {});
}                                                                       // f1c=1 f1d=1 g2=1 g3=1 f3a=0

const module: ServerModule = {
  id: "assetLibrary",
  routePrefixes: ["/api/assets"],
  dependencies: ["localRuntime", "mediaGeneration", "platformCore"],
  exports: ["warmup"],
  warmup,
};
export default module;
```

### A.2 `mediaGeneration/index.ts`

```text
import type { ServerModule, ModuleContext } from "@/types/module";
export { addMediaProvider } from "./media/provider";                    // ← ① 静态面（b5s=1；R-07B 契约）

export async function initializeProviders(context: ModuleContext) {     // 步骤 4
  /* guard(ctx.dataDirectory && ctx.pluginRoots.provider)
     source = resolve(ctx.pluginRoots.provider, "media")
     revision = ctx.pluginRevision ?? sha256(4 文件；ENOENT→空 Buffer，其它 errno 抛出)      // g6a/g6b
     await ctx.syncPluginDirectory(resolve(ctx.dataDirectory,"providers"), source, [...], revision) */
}

export async function refreshModels() {                                  // 步骤 9（D-05）
  const { default: initializeProviderModels } = await import("./ai/initialize");   // 导入失败 → reject
  void initializeProviderModels().catch(error => console.warn("启动时刷新供应商模型失败：", error));  // g4=1
}

const module: ServerModule = {
  id: "mediaGeneration",
  routePrefixes: ["/api/ai", "/api/ffmpeg", "/api/providers"],
  dependencies: ["localRuntime", "platformCore"],
  exports: ["initializeProviders", "refreshModels"],
  initialize: initializeProviders,
};
export default module;
```

### A.3 `pluginMarket/index.ts`

```text
import type { ServerModule, ModuleContext } from "@/types/module";
export { decodeText, skillPath, skillZip } from "./plugins/install";    // ← ① 静态面（c9 逐字）
export { listTools } from "./plugins/tools";                            //    c9 逐字
export * as skillFiles from "./skills/files";                           //    c9 逐字
export { default as syncDirectory } from "./plugins/initialize";        //    app.ts 调用面（A-08）

export async function initializeTools(context: ModuleContext) { /* 委托既有 initializePlugins */ }
export async function initializeNodes(context: ModuleContext) { /* 同构 */ }
export async function initializeExt(context: ModuleContext)   { /* 同构（initializeExt） */ }
export async function initializeSkills(context: ModuleContext){ /* 同构 */ }
export async function initializeAgents(context: ModuleContext){ /* 同构 */ }
export async function scanBuiltin(context: ModuleContext)     { /* 5 键 Set（BUILTIN_TYPES，零映射） */ }

const module: ServerModule = {
  id: "pluginMarket",
  routePrefixes: ["/api/tools", "/api/nodes", "/api/ext", "/api/skills", "/api/agents", "/api/plugins"],
  dependencies: ["localRuntime", "mediaGeneration", "platformCore"],
  exports: ["syncDirectory", "initializeTools", "initializeNodes", "initializeExt",
            "initializeSkills", "initializeAgents", "scanBuiltin"],
};
export default module;
```

### A.4 `mcpIntegration/index.ts`

```text
import type { Application } from "express";
import type { ServerModule, ModuleContext } from "@/types/module";
import { getMcpSettings } from "./mcp/control";                         // ← ① 静态面（值级，lr2）
                                                                        //    control 是 MCP 域内唯一不依赖 @/agent 的模块（s6）
export { getMcpSettings };                                              // MCP 连接设置契约

export async function mount(app: Application, context: ModuleContext) {
  const [{ createMcpRouter }, { getMcpTools }, { authorizeMcp }, { skillResources }] = await Promise.all([
    import("@toonflow/mcp"),                                            // ← ⑤ 外部包
    import("./mcp/tools"),                                              // ← ⑤ 自家域
    import("./mcp/control"),
    import("./mcp/resources"),
  ]);                                                                   // g4b=4（4 行，file_count 按行计）
  app.use("/mcp", createMcpRouter({ getTools: getMcpTools, authorize: authorizeMcp,
    resources: skillResources, /* runInRequest / translate / translateError 同 B0 */ }));
}

const module: ServerModule = {
  id: "mcpIntegration",
  routePrefixes: ["/api/mcp"],
  gateways: ["/mcp"],
  dependencies: ["localRuntime", "mediaGeneration", "platformCore", "pluginMarket"],
  exports: ["mount"],
  mount,
};
export default module;
```

### A.5 `localRuntime/index.ts`

```text
import type { Application } from "express";
import type { ServerModule, ModuleContext } from "@/types/module";
import { initializeMobileLinkRuntime } from "./mobileLink";             // ← ① 静态面（值级；钩子直接使用）

export async function initializeRuntime(app: Application, context: ModuleContext) {   // 步骤 15
  initializeMobileLinkRuntime(app);                                     // 调用时刻与 B0 相同（求值时刻前移）
}

const module: ServerModule = {
  id: "localRuntime",
  routePrefixes: ["/api/workspaces", "/api/desktop", "/api/exec", "/api/mobileLink"],
  dependencies: ["assetLibrary", "mediaGeneration", "platformCore"],
  exports: ["initializeRuntime"],
};
export default module;
```

### A.6 `agentAccess/index.ts`（`MIN_REL=0`）

```text
import type { Application } from "express";
import type { ServerModule, ModuleContext } from "@/types/module";

export async function mount(app: Application, context: ModuleContext) {
  const { createA2aRouter } = await import("@/agent/a2a");              // ← ⑤ 外部模块（agent），必须动态
  app.use("/a2a", createA2aRouter());
}

const module: ServerModule = {
  id: "agentAccess",
  routePrefixes: ["/api/agent", "/api/browser", "/api/sessionState", "/api/singleAgent"],
  gateways: ["/a2a"],
  dependencies: ["platformCore", "pluginMarket"],
  exports: ["mount"],
  mount,
};
export default module;
```

### A.7 `platformCore/index.ts`（`MIN_REL=0`）

```text
import type { Request, Response, NextFunction } from "express";
import type { ServerModule, ModuleContext } from "@/types/module";

export async function prepare(context: ModuleContext) {                 // 步骤 [3]
  const { default: conf } = await import("./conf");                     // ← ⑤ 必须动态（f2a/f2b 时序）
  /* setLocaleFallback(() => normalizeLocale(conf.get("settings",{}).ui?.language) ?? detectLocale(...)) */
}

export function corsGuard(request: Request, response: Response, next: NextFunction) {
  /* corsOriginAllowed 下沉到此（B0 的 app.ts 私有函数），语义逐字保留 */
}

const module: ServerModule = {
  id: "platformCore",
  routePrefixes: ["/api/settings", "/api/monitor"],
  dependencies: ["localRuntime", "mediaGeneration"],
  exports: ["prepare", "corsGuard"],
};
export default module;
```

### A.8 2 个非入口 L2 文件（只列契约，不含实现）

```text
src/types/module.ts        仅类型（PluginType / BuiltinPluginType / PluginRoots / ModuleContext / ServerModule）
                           → 运行期 import = 0（lr5=0）；≤40 行
src/lib/mentionSources.ts  MentionQuery（type）+ mentionAssetType（纯路径判定）；≤30 行；不 import @/modules
```

---

## 附录 B：本轮探针与实测（全部在 `/tmp` 执行，不落库）

### B.1 基线复核（V1–V10）

```bash
# PH-B0（B0 基线；从 d084136 归档解压后执行）
python3 - <<'PY'
import glob, os
globs=["apps/server/src/app.ts","apps/server/src/index.ts","apps/server/src/core.ts","apps/server/src/router.ts",
       "apps/server/src/utils.ts","apps/server/src/remoteConnection.ts","apps/server/src/lib/**",
       "apps/server/src/routes/**","apps/server/src/types/**","apps/server/src/utils/**","apps/server/scripts/**"]
files=sorted(p for g in globs for p in glob.glob(g,recursive=True) if os.path.isfile(p) and p.endswith(".ts"))
print(len(files), sum(sum(1 for _ in open(p,encoding="utf-8",errors="ignore")) for p in files))
PY
# 实测：237 14349
find apps/server/src/routes -name '*.ts' | wc -l                                  # 161
grep -rhoE '(Router\(\)|router|app)\.(get|post|put|patch|delete|all)\(' apps/server/src/routes | wc -l  # 162
grep -rho 'from "@/utils/[a-zA-Z]*' apps/server/src --include='*.ts' | wc -l      # 246（B0 深路径）
grep -rl 'from "@/utils"' apps/server/src --include='*.ts' | wc -l                # 145
```

### B.2 `n1/n2`：platformCore 来源完整性与 20/22/246 等式（打回 #1）

```bash
# 用途：逐模块输出 moved / unmoved / L1 / L3，断言 platformCore = 4 + 16、L3 = 20 + 2
python3 - <<'PY'
import glob, os
S="apps/server/src/"
def count(gs):
    fs=sorted(p for g in gs for p in glob.glob(g,recursive=True) if os.path.isfile(p) and p.endswith(".ts"))
    return len(fs), sum(sum(1 for _ in open(p,encoding="utf-8",errors="ignore")) for p in fs)
groups={
 "assetLibrary":(["utils/assets/**"],["routes/assets/**"]),
 "mediaGeneration":(["utils/ai/**","utils/media/**","utils/ffmpeg/**","utils/documents.ts"],["routes/ai/**","routes/providers/**","routes/ffmpeg/**"]),
 "pluginMarket":(["utils/plugins/**","utils/skills/**","utils/teams/**"],["routes/tools/**","routes/nodes/**","routes/ext/**","routes/skills/**","routes/agents/**","routes/plugins/**"]),
 "mcpIntegration":(["utils/mcp/**"],["routes/mcp/**"]),
 "localRuntime":(["utils/workspace/**","utils/desktop/**","utils/mobileLink/**","utils/exec.ts","remoteConnection.ts"],["routes/workspaces/**","routes/desktop/**","routes/exec/**","routes/mobileLink/**"]),
 "agentAccess":(["utils/singleAgent/**","utils/sessionState/**","utils/browser/**"],["routes/agent.ts","routes/agent/**","routes/singleAgent/**","routes/browser/**","routes/sessionState/**"]),
 "platformCore":(["utils/conf/**","utils/monitor.ts","utils/personalization.ts","utils/fileHttp.ts"],["lib/**","types/**","routes/settings/**","routes/monitor/**"]),
 "bootstrap":([],["app.ts","index.ts","core.ts","router.ts","utils.ts","../scripts/**"]),
}
for m,(mv,un) in groups.items():
    a=count([S+g for g in mv]); b=count([S+g for g in un])
    print(f"{m:16s} moved={a[0]:2d}/{a[1]:5d}  unmoved={b[0]:2d}/{b[1]:5d}  L1={a[0]+b[0]:2d}/{a[1]+b[1]:5d}")
PY
# 实测（B0）：platformCore moved=4/247 unmoved=16/679 L1=20/926
# 断言：4 + 16 = 20；20 + 1 入口 + 1 mentionSources = 22；8 模块 L3 求和 = 246
```

### B.3 `k1–k5`：A.3③ 的 245 + 7 = 252（打回 #2）

```bash
# PH-F（F 相；在交付态执行）
# k1：静态 from "@/modules/ 行数
grep -rho 'from "@/modules/[a-zA-Z]*' apps/server/src --include='*.ts' | wc -l                 # 245
grep -rho 'from "@/modules/[a-zA-Z]*' apps/server/src/agent  --include='*.ts' | wc -l          # 50
grep -rho 'from "@/modules/[a-zA-Z]*' apps/server/src/routes --include='*.ts' | wc -l          # 62
grep -rho 'from "@/modules/[a-zA-Z]*' apps/server/src/modules --include='*.ts' | wc -l         # 103
grep -o  'from "@/modules/[a-zA-Z]*' apps/server/src/utils.ts | wc -l                           # 30
grep -o  'from "@/modules/[a-zA-Z]*' apps/server/src/app.ts   | wc -l                           # 0

# k2：app.ts 的 7 个入口动态 import（排除 conf 子路径）
grep -cE 'import\("@/modules/(assetLibrary|mediaGeneration|pluginMarket|mcpIntegration|localRuntime|agentAccess|platformCore)(/index)?"' apps/server/src/app.ts   # 7

# k3/k4：分段求和与归一化
# 50 + 62 + 103 + 30 + 0 = 245；245 + 7 = 252

# k5：非空转（评审可在 /tmp 副本上改一行验证）
# 把任一 import("@/modules/<id>") 改成静态 → k2=6 → FAIL
# 把任一静态行改成 "@/utils/..." → k1<245 或 zero-guard>0 → FAIL

# zero-guard（F 相；矩阵 §A.3⑤）
grep -rn 'from "@/' apps/server/src --include='*.ts' | grep '/utils/' | wc -l                     # 0  (zero-guard)
find apps/server/src -name '*.ts' | wc -l                                                      # 272
```

> 模拟树实测（V12）：`k1=245`、`k2=7`、`k4=252`；分段 50/62/103/30/0。矩阵 §A.3③ 的 252 在归一化口径下**逐字相等**；静态 grep 的 245 由 E13 登记。

### B.4 `d4v/d4t`：R-07D 的口径（打回 #2 的连带项）

```bash
# PH-F
D=apps/server/src
# d4v：反向 import 行（value/混合）
grep -hE '^[[:space:]]*import .*from "@/(utils/conf|modules/platformCore/conf)' \
  $D/modules/pluginMarket/teams/*.ts $D/modules/localRuntime/mobileLink/*.ts | wc -l            # 4
# d4t：type re-export 行（R-07D 新增）
grep -hE '^export type \{.*\} from "@/modules/platformCore/conf"' \
  $D/modules/pluginMarket/teams/*.ts $D/modules/localRuntime/mobileLink/*.ts | wc -l            # 2
# d4 raw：矩阵原文命令（观测值）
grep -hE 'from "@/(utils/conf|modules/platformCore/conf)' \
  $D/modules/pluginMarket/teams/*.ts $D/modules/localRuntime/mobileLink/*.ts | wc -l            # 6
# d3：conf 侧（联合模式）
grep -hE 'from "@/(utils/teams|modules/pluginMarket/teams|utils/mobileLink|modules/localRuntime/mobileLink)' \
  $D/modules/platformCore/conf/*.ts | wc -l                                                     # 0
```

### B.5 模拟树证据（V11–V18 的原始输出摘要）

```text
# /tmp/sim_f（矩阵 SPEC 迁移 + R-07 + 7 入口 + 2 契约；不进入仓库）
files=246 lines=14408
A.3③ segments: agent=50 routes=62 modules=103 utils.ts=30 app.ts=0  → static=245
app.ts entry dynamic imports = 7                                    → normalized=252
facade=145  utils_dir_files=0  src_ts=272  server→agent=19  agent→server=51+20=71  f2c=2
a2=0 (scope=42)  b3=0  b4=0  b5=1  c4=c5=c6=0  c7=3  c8a=7  c8b=4
d3=0  d4v=4  d4t=2  d4_raw=6  e3=e4=1  e5a=e5b=0
l2_relative: lr1_exist=1 lr2_entry_relative_ok=7 lr3_self_alias=0 lr4_cross_alias=0 lr5_other_alias=0 → PASS
SCC: files=246 scc_count=1  size 2 [modules/mcpIntegration/mcp/dxt.ts, modules/mcpIntegration/mcp/servers.ts]
edges: asset→platform 27 / local→platform 76 / platform→plugin 0 / platform→local 1 / platform→media 1 /
       plugin→media 1 / mcp→plugin 3；域间边=20
```

> 模拟树只验证“迁移后的计数与边关系”，不验证 `typecheck`/`build`（这两项在 M0/M6 的真实工作树上执行）。

### B.6 说明符相位扫描（`s5`）

```bash
# 规则：F 相块内出现 `from "@/utils` 或 `import("@/utils` 计违规；B0/历史块豁免
python3 /tmp/probe_doc_specifiers.py <本文档>
# 期望：f_phase_violations=0
```

> 本文档的所有 `@/utils/` 只出现在 **PH-B0** 标注块与“v3 原文/历史”对照块；F 相块一律使用 `@/modules/…` 或 `./…`。

---

## 附录 C：逐模块来源台账（B0 实测；moved + unmoved = L1）

### C.1 platformCore（打回 #1 的重点）

| 类型 | 文件 | 文件数 | 行数 |
| --- | --- | --- | --- |
| 移动 | `utils/conf/index.ts` | 1 | 69 |
| 移动 | `utils/monitor.ts`、`utils/personalization.ts`、`utils/fileHttp.ts` | 3 | 178 |
| 不移动 | `lib/desktop.ts`、`lib/documentFormats.ts`、`lib/i18n.ts`、`lib/middleware.ts`、`lib/modelReasoning.ts`、`lib/nodeMenu.ts`、`lib/platform.ts`、`lib/responseFormat.ts` | 8 | 382 |
| 不移动 | `types/desktop.ts` | 1 | 58 |
| 不移动 | `routes/monitor/{free,status}.ts`、`routes/settings/{get,save,systemPrompt}.ts`、`routes/settings/personalization/{get,save}.ts` | 7 | 239 |
| **L1 合计** | — | **20** | **926** |
| L2 | `modules/platformCore/index.ts`（入口）、`lib/mentionSources.ts` | +2 | ≤90 |
| **L3 合计** | — | **22** | **≤1,016** |

### C.2 其他模块的“不移动”清单（证明没有漏项）

| 模块 | 不移动来源 | 文件 |
| --- | --- | --- |
| bootstrap | `app.ts`、`index.ts`、`core.ts`、`router.ts`、`utils.ts`、`scripts/{build,buildStandalone,copyDocumentPackages}.ts` | 8 |
| assetLibrary | `routes/assets/**` | 18 |
| mediaGeneration | `routes/ai/**`（10）、`routes/providers/**`（9）、`routes/ffmpeg/**`（6） | 25 |
| pluginMarket | `routes/tools/**`（7）、`routes/nodes/**`（6）、`routes/ext/**`（6）、`routes/skills/**`（10）、`routes/agents/**`（9）、`routes/plugins/**`（1） | 39 |
| mcpIntegration | `routes/mcp/**` | 13 |
| localRuntime | `routes/workspaces/**`（14）、`routes/desktop/**`（15）、`routes/exec/**`（2）、`routes/mobileLink/**`（6） | 37 |
| agentAccess | `routes/agent.ts`（1）、`routes/agent/**`（12）、`routes/singleAgent/**`（5）、`routes/browser/**`（2）、`routes/sessionState/**`（2） | 22 |
| **合计** | — | **178** |

> `59（移动）+ 178（不移动）= 237`；`9,240（移动行）+ 5,109（不移动行）= 14,349`。这两条等式是 `n1` 的判定对象。

---

## 附录 D：方案级数值台账（N01–N36）

> 规则：每个数字必须有相位、来源/命令、可达性或推导；`scope_files` 只观测不断言。

| ID | 断言 | 值 | 相位 | 来源 / 复现 | 可达性或推导 |
| --- | --- | --- | --- | --- | --- |
| N01 | B0 文件数 | 237 | B0 | 矩阵 §A.1（归档实测） | 直接实测 |
| N02 | B0 行数 | 14,349 | B0 | 矩阵 §A.1 | 直接实测 |
| N03 | HEAD 行数 | 14,352 | HEAD | 同一 glob | +3（`agentAccess`）；F-01 |
| N04 | L1 等式 | 237 | B0 | 8+27+42+49+20+45+26+20 | 逐模块实测 |
| N05 | platformCore L1 | 20 = 4 + 16 | B0 | 附录 C.1 | 移动 4 + 不移动 16 |
| N06 | platformCore L3 | 22 = 20 + 2 | F | 附录 C.1 | 入口 + `lib/mentionSources` |
| N07 | L3 总数 | 246 = 237 + 9 | F | §2.2.2 | 9+28+43+50+21+46+27+22 |
| N08 | L3 行数上限 | 14,839（B0）/ 14,842（HEAD） | F | §2.2.2 | 14,349 + 490；HEAD +3 |
| N09 | 移动 / 不移动文件 | 59 / 178 | B0 | 附录 C | 59 + 178 = 237 |
| N10 | 移动 / 不移动行 | 9,240 / 5,109 | B0 | 附录 C | 9,240 + 5,109 = 14,349 |
| N11 | A.3② 深路径 | 246 | B0 | 矩阵 §A.3② | 50+62+103+30+1 |
| N12 | A.3③ 静态 | 245 | F | §2.3 / 附录 B.3 | 50+62+103+30+0 |
| N13 | app.ts 入口动态 | 7 | F | 附录 B.3 `k2` | 7 个模块 id |
| N14 | A.3③ 归一化 | 252 | F | §2.3 | 245 + 7；E13 |
| N15 | 模块段 | 103 | F | §2.3.2 | 103 − 2 + 2 |
| N16 | app.ts 静态段 | 0 | F | 附录 B.3 | 入口动态装配（D-01） |
| N17 | `d4v` / `d4t` / raw | 4 / 2 / 6 | F | §3.3 / 附录 B.4 | import 行 / type re-export / 原文命令 |
| N18 | `d3` | 0 | F | 附录 B.4 | conf 侧归零 |
| N19 | `asset→platform` | 27（1t/26v） | F | 模拟 §A.11 | 24 + 3（mentionSources） |
| N20 | `local→platform` | 76（1t/75v） | F | 模拟 §A.11 | 75 + 1 |
| N21 | `platform→plugin` | 0 | F | 模拟 §A.11 | R-07D 归零 |
| N22 | `plugin→media` | 1 | F | 模拟 §A.11 | R-07B 契约化后仍 1 |
| N23 | `mcp→plugin` | 3 | F | 模拟 §A.11 | R-07C 契约化后仍 3 |
| N24 | 域间边 | 20 | B0+F | 矩阵 §A.11 / 模拟 | 20 条 source→target |
| N25 | file SCC | 2 → 1 | B0→F | 矩阵 §A.6 / 模拟 | 15+2 → 2（E11） |
| N26 | facade 文件 | 145 | B0+F | 矩阵 §A.3①④ | 144 + 1；模拟 145 |
| N27 | `src/**` `.ts` | 263 → 272 | B0→F | 矩阵 L14 | 263 + 9 |
| N28 | server→agent / agent→server | 23→19 / 71 | B0→F | 矩阵 §A.4 | 23 − 4；51 + 20 |
| N29 | `f2c` / `utils/**` 相对 | 2 / 21 | B0+F | 矩阵 §A.7.6 / L25 | 模拟 2；21 为形态基线 |
| N30 | 模拟树规模 | 246 / 14,408 | F | 附录 B.5 | 上限 14,842；行数在预算内 |
| N31 | 端点 / 路由 / 前缀 | 162 / 161 / 21 | B0+F | 矩阵 §A.2/§A.14 | 路由不动 |
| N32 | exports / 文件 / 引用 | 14 / 36 / 57 | B0+F | 矩阵 §A.5 | 键名不变 |
| N33 | `l2_relative` | 1 / 7 / 0 / 0 / 0 | F | 矩阵 §A.13.2 / 模拟 | A-29 PASS |
| N34 | bootstrap→pluginMarket | 7 → 6 | B0→F | 模拟 §A.11 | 静态 `initializePlugins` 移入入口（F-11，观测） |
| N35 | 锚点级数 / `f2a` | 5 → 6 / 1 | B0→F | §5 R-15 | 6 级 → `<repo>/data` |
| N36 | 入口行数 / L2 行数 | ≤60 / ≤490 | F | §4.6 | 上限型 |

---

## 附录 E：与 v3 的差异索引

| 位置 | v3 | v4（本版） | 原因 |
| --- | --- | --- | --- |
| platformCore 来源 | 只列 4 个移动文件，写“20” | **4 移动 + 16 不移动 = 20**；L3 22；附录 C 全量台账 | 打回 #1 |
| A.3③ | 245 只写在 D-01 备注；无逐段推导；无豁免 | **245（静态）+ 7（动态）= 252 归一化**；E13 + `k1–k5` | 打回 #2 |
| R-07D | 单行混合 import（模块段 101） | **类型迁 conf + 2 条 type re-export（模块段 103）**；`d4v/d4t` | 打回 #2 的 103 来源 |
| `d4` | 只写“4” | **`d4v=4` / `d4t=2` / raw=6**；D-09 + E14 | 口径与意图对齐 |
| 判据探针 | `s1–s6` | **+`s7/s8/s9`、`n1/n2`、`k1–k5`、`d4v/d4t`** | R-14 |
| 决策点 | D-01～D-07 | **D-01～D-10**（+D-08 计数口径、+D-09 d4、+D-10 来源呈现） | 本轮新增 |
| 豁免 | E1–E12 | **E1–E14**（+E13 A.3③、+E14 d4） | 打回 #2 |
| 行数上限 | “14,839+Δ” | **14,839（B0）/ 14,842（HEAD）** | F-01 |
| 锚点行号 | 矩阵写 `:11` | 实测 **`:13`**（F-15） | 文档笔误 |
| bootstrap→plugin | 未登记 | **7 → 6 观测**（F-11） | 静态行移入入口 |
| 未变 | R-07B 公开面、`PluginRoots` 词表、`exports` 语义、入口三段式、`app.ts` 动态装配 | **全部保持** | v3 第 7 轮已认定修正 |

---

## 附录 F：本版一页纸结论（给评审）

1. **打回 #1 是台账列不完整**：platformCore 不是 11，也不是“只列移动项”；正确构成是 **4 移动 + 16 不移动 = 20**（`lib/**` 8 + `types/**` 1 + `routes` 7 必须出现）。L3 22、总数 246、两条等式（59+178、9,240+5,109）已给出。
2. **打回 #2 是数值差未登记**：A.3③ 静态确实只能到 **245**（`50+62+103+30+0`），因为 `app.ts` 的 7 个入口**统一**用动态 `import()`（其中 5 个硬约束：静态化会让 `conf` 早于 `TOONFLOW_DATA_DIR`；另 2 个形态统一）。归一化 **245 + 7 = 252**，并登记 **E13**；不是“把 245 藏起来”。
3. **R-07D 的 103 来源已补全**：`conf` 删 2 条 type import（−2），teams/mobileLink 各加 1 条 type re-export（+2），模块段回到 **103**；SCC 由 2 降到 1（E11）。
4. **d4 的口径差已显式化**：`d4v=4`（import 行，符合矩阵 §1.6.5）、`d4t=2`（type re-export）、raw=6；默认按 `d4v` 判，raw 作为观测登记；若评审坚持 raw=4，用 **E14** 兜底。
5. **可行性有实测**：`/tmp/sim_f` 已把 246 文件、245+7、103、`a2=0`、`b3/b4=0`、`b5=1`、`c4..c6=0`、`d3=0`、`d4v=4`、SCC=1、`l2_relative=PASS` 跑出来；不是纸面推导。
6. **本次产物**：仅新增本文件 + 更新 `INDEX-2026-10.md`；`apps/server` 零改动（`git status --porcelain apps/server` 为空）。
