# 需求矩阵 · server-api 应用子模块拆分（第 4 版 · 第 3 轮打回后重做）

## 0. 文档元信息

| 项 | 内容 |
| --- | --- |
| 文档编号 | **REQ-2026-10-26-04** |
| 版本 | 第 4 版（替代 REQ-2026-10-26-03） |
| 需求来源 | 架构地图关注点 `c-server-api-1`（`.easyvibe/map/map.json`，模块健康度 50 / `god_module` + `circular_dep` + `coupling_high`） |
| 需求标题 | server-api 按素材库 / 媒体生成 / 插件市场 / MCP·工作区拆出应用子模块，`app.ts` 只保留组合根与路由装配 |
| 影响模块 | `server-api`（`apps/server`） |
| 需求类型 | 结构性重构（架构整改），**不改变任何业务行为** |
| 当前状态 | **待评审（第 4 版）**；本轮仅新增/更新需求文档与索引，业务代码零改动（`git status --porcelain apps/server` 为空） |
| 编写人 | 需求分析 agent（harness 规则 2.1） |
| 编写时间 | 2026-10-26 22:25 |
| 基线 | `git HEAD = d084136`；`.easyvibe/map/map.json` 生成于 `2026-10-26T21:13:59+08:00` |
| 上一版 | `2026-10-26-21-55-serverApiSubmoduleSplit-v3.md`（REQ-2026-10-26-03，**第 3 轮打回**） |
| 验收口径 | 问题消除 + 审查通过；无法消除项按 §8 结构化豁免登记；验收按 §6.5 二值判定表 + §6.7 判据分期规则执行 |

### 0.1 第 3 轮打回意见逐条处置（本版核心修订）

| # | 打回意见（原文要点） | 根因 | 本版处置（可核对） | 落点 |
| --- | --- | --- | --- | --- |
| 1 | **A-17 期望 1 不可达**：grep 目标路径已迁移，但 pattern 仍用迁移前说明符 `from "@/utils/mcp/servers"`；R-04 后实际说明符变为 `@/modules/mcpIntegration/mcp/servers`，命令永远得 0，`=1` 永远不成立 | 判据把「B0 说明符」与「FINAL 路径」混在同一行命令里，且没有分期声明 | 引入 **判据分期（PH-B0 / PH-F）** + **说明符归一化映射 SPEC** + **说明符形态冻结规则**；A-17 拆成 B0 基线与 F 判定两组命令，F 组用**联合模式**（同时匹配两相说明符），期望 `1` 在两相都可达（§1.6、§4 R-07E、附录 A.7） | §1.6、R-07E、A-17、§A.7、Q11 |
| 2 | **A-14 / A-15 会假通过**：目录参数写的是 FINAL 路径，但 pattern 仍是 `@/utils/...`；FINAL 树里该说明符根本不存在 → `grep = 0` 恰好等于期望 `0`，**空搜索被判 PASS** | 期望 0 的判据缺少「路径存在守卫」与「搜索范围守卫」 | 新增三条守卫：**G-EXIST**（路径不存在 → FAIL，不得 PASS）、**G-MATCH**（0 命中必须附带 `scope_files ≥ 1`）、**G-POS**（期望 >0 必须先有 B0 试跑证明可达）；A-14/A-15 全部改为联合模式 + 三守卫（附录 A.7.0 给出可直接执行的 `edge_check` / `edge_lines` / `file_count` 三个工具函数） | §1.6、§6.7、A-14/A-15、§A.7 |
| 3 | **R-03 步骤 5 漏记 B0 非阻塞吞错语义**：`assetLibrary.warmup`（缩略图预热）在 B0 是 `void ... .catch(() => {})`，非阻塞且**静默吞错**；v3 只写了「`sweepThumbnailCache()`」，未记录阻塞性与错误语义，实施者极易改成 `await` 或改为打印错误 | R-03 的 15 步表只有「序 / 调用 / 归属 / 说明」四列，没有「阻塞性」与「错误语义」两个可判定维度 | R-03 表扩为 **7 列**：`序 / 调用 / 归属 / B0 app.ts 行号 / 阻塞性 / 错误语义 / 说明`；步骤 5 明确为「**void、不 await、导入失败与同步抛出被空 catch 静默吞掉（不打印）**；清扫体自身失败由 `thumb.ts` 内部 `.catch(console.warn("缩略图清扫失败"))` 记录后 resolve」；新增 A-25（步骤 5 语义保真，含故障注入）与 A-26（15 步阻塞性/错误语义矩阵逐行核对）；新增 §6.8「B0 语义保真清单」；新增风险 R17「吞错语义被统一化」 | R-03、A-10、A-25、A-26、§6.8、R17 |

### 0.2 自查发现并纠正的两处基线记录错误（本版新增，附复现命令）

> 这两处不是第 3 轮打回意见，是本版在复算时自查发现的**上一版文档事实性错误**。二者都影响可测性，故一并纠正并在 §0.2 留痕。

| # | 位置 | v3 写法 | 实测 / 纠正 | 复现命令 |
| --- | --- | --- | --- | --- |
| S1 | §2.4 file 级 SCC、附录 C.3 | 「**13 文件**跨模块 SCC」，成员用目录简写列出 | 实际是 **15 个文件**：`utils/conf/index.ts`、`utils/teams/{index,files,install}.ts`、`utils/mobileLink/index.ts`、`utils/plugins/{install,tools,nodes,ext}.ts`、`utils/skills/files.ts`、`utils/media/provider.ts`、`utils/ffmpeg/index.ts`、`utils/ai/visibility.ts`、`utils/workspace/{index,files}.ts`。v3 用“目录名简写”列出成员：`teams` 记为 1 项而实际 3 个文件（+2），其余每项恰对应 1 个文件，故 `13 + 2 = 15`；**成员集合本身没错，只是计数标签错** | 附录 A.6 脚本；实测输出 `scc_gt1=2`，成员 `size=15` 与 `size=2` |
| S2 | R-02 第 2 条 | 「§R-03 步骤 **1–8** 在 `app = express()` 之前」 | 实测 B0：步骤 1–7 在 `express()`（`app.ts:92`）之前；**步骤 8（builtin 扫描）在 `app.ts:95-106`，即 `express()` 与 `app.locals.appVersion`（`:93`）之后**。而且 `app.locals.builtinPlugins = ...` 语义上必须在 `app` 创建之后，v3 的要求**无法实现**。本版改为「步骤 1–7 在 `express()` 前；步骤 8 在 `app.locals.appVersion` 之后、开发分支（`:108`）之前」 | `sed -n '92,108p' apps/server/src/app.ts` |

> 附带结论：模块级 20 条直接边经独立脚本重算，与 v3 完全一致（详见附录 A.11 输出），故 §2.4 基线不动。

### 0.3 与第 3 版的关键差异

| 项 | 第 3 版 | 第 4 版 |
| --- | --- | --- |
| 判据分期 | 无；B0 说明符与 FINAL 路径混用 | **PH-B0 / PH-F 两相**声明；每条判据标注 phase |
| 说明符 | 迁移前后混用，导致假通过/不可达 | **SPEC 归一化映射表** + 联合模式 + **形态冻结**（alias 保持，禁改相对路径，Q11） |
| 0 命中判据 | 直接判 PASS | **G-EXIST + G-MATCH + G-POS** 三守卫；`scope_files=0` 判 FAIL |
| R-03 | 15 步只有 4 列 | **7 列**（含 B0 行号 / 阻塞性 / 错误语义）；步骤 5 静默吞错显式化；步骤 8 锚点纠正 |
| 验收项 | A-01～A-24 | **A-01～A-27**（+A-25 步骤 5 语义、+A-26 阻塞/错误矩阵、+A-27 判据自审） |
| 风险 | R1–R15 | +R16 判据假通过、+R17 吞错语义被统一化、+R18 说明符形态漂移 |
| 决策点 | Q1–Q10 | **Q1–Q11**（+Q11：边判据的说明符形态，默认 alias 冻结） |
| file SCC | 「13 文件」 | **15 文件**（§0.2 S1，附复现脚本） |
| 文档自审 | 无 | §A.12 判据自审脚本（扫本文档：PH-F 行不得含裸 `@/utils` 说明符） |

### 0.4 覆盖度 / 可测性 / 无歧义自检

| 维度 | 本版怎么保证 | 可核对位置 |
| --- | --- | --- |
| **覆盖度** | 第 3 轮 3 条打回 + 自查 2 处 → 逐条落到 R/A/§/Q；另有 c-server-api-1 + P1–P5 + AGENTS 约束 + 地图 228 滞后 + file SCC + 20 条边 → 全部映射 | §0.1、§0.2、附录 E |
| **可测性** | 27 条二值验收（A-01～A-27），每条含 **Phase / 命令或产物 / 期望 / 证据位置**；0 命中判据强制带守卫与 `scope_files`；期望 >0 判据强制带 B0 可达性试跑；13 项 + S1–S8 冒烟有 fixture 与归一化规则 | §6.5、§6.7、附录 A |
| **无歧义** | 术语表 §1.5；SPEC 映射 §1.6.2（逐目录 old→new）；阻塞性/错误语义两列（R-03、§6.8）；Q1–Q11 全有默认值；E10 有反向计数；E11/E12 完整模板 | §1.5、§1.6、§4 R-03、§6.8、§8.4、§10 |

---

## 1. 背景

### 1.1 现状量化（HEAD = d084136，2026-10-26 22:25 复算）

| 指标 | 实测值 | 核验方式 |
| --- | --- | --- |
| server-api 文件 / 行数 | **237 文件 / 14,349 行** | 附录 A.1 glob（含 `src/**` 非 agent 部分与 `scripts/**`） |
| 路由文件 | **161** | `find apps/server/src/routes -name '*.ts' \| wc -l` |
| 注册端点 | **187**（GET 67 / POST 79 / PUT 20 / DELETE 11 / ALL 8 / PATCH 2） | 逐文件提取 `.get/.post/.put/.patch/.delete/.all` |
| `router.ts` | **327 行 / 161 条 `app.use`** | `wc -l`、`grep -c 'app.use'` |
| `app.ts` | **160 行**（初始化、哈希、预热、刷新、MCP/A2A、静态、错误、移动互联混写） | `wc -l` |
| `utils.ts` | **75 行 / 37 个出口 / 5 个来自 `@/agent`** | 读文件逐 key 计数 |
| `import u from "@/utils"` | **145 个文件**，其中 **144/161 个路由文件** | `grep -rl 'from "@/utils"'` |
| 深路径 `@/utils/<域>` | **246 处** | `grep -rho 'from "@/utils/[a-zA-Z]*'` |
| server → agent | **23 行** = agentAccess 8 + bootstrap 5 + platformCore 3 + assetLibrary 3 + mcpIntegration 2 + pluginMarket 1 + localRuntime 1 | 排除 `src/agent/` 后 grep `from "@/agent` |
| agent → server | `@/utils` **51 行**；`@/lib\|@/types` **20 行** | 附录 A.4 |
| `@toonflow/server/*` 外部契约 | **14 export / 36 文件 / 57 处引用** | `apps/server/package.json` + 仓库 grep |
| 地图详细快照 | **228 文件 / 13,955 行**（滞后） | `modules/server-api.json` 的 `parent.files_snapshot` |
| 地图顶层声明 | **237 文件 / 14,349 行** | `map.json` 的 `health.review_note` |
| file 级 SCC（B0） | **2 个**：`size=15`（跨模块，见 §0.2 S1）、`size=2`（`utils/mcp/dxt.ts ↔ utils/mcp/servers.ts`） | 附录 A.6 脚本 |
| 模块级直接边（B0） | **20 条**（§2.4，附录 A.11 独立复算一致） | 附录 A.11 |
| 子模块内最大文件 | `utils/assets/library.ts` 729 行、`utils/media/provider.ts` 498 行、`utils/plugins/install.ts` 450 行 | `wc -l` |

### 1.2 地图详细快照 228 与 HEAD 237 的对账（沿用 v3，结论不变）

差额是 **9 个 HEAD 已存在、快照未收录的文件（394 行）**，加上 2 处语义归属差异（`utils/documents.ts` → mediaGeneration、`utils/fileHttp.ts` → platformCore）。

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

### 1.3 问题陈述（5 个可独立验证的根因）

- **P1｜边界只存在于目录名，没有模块契约对象。** 21 个 `/api/*` 路由目录、15 个 `utils/*` 子域在语义上已分域，但没有“模块入口”声明（职责、路由前缀、初始化钩子、对外导出、依赖清单），地图只能把 237 个文件登记为 1 个模块。
- **P2｜组合根承担业务初始化。** `createApp` 内联 6 类插件目录初始化与内置清单扫描、供应商源码哈希、缩略图预热、模型刷新、MCP/A2A 网关挂载、移动互联运行时初始化；`app.locals.builtinPlugins` 由组合根生产，5 组路由消费。
- **P3｜全局聚合入口锁死编译期依赖闭包。** `utils.ts` 把 37 个 namespace（含 5 个 `@/agent`）聚合成单对象，145 个文件直接依赖。
- **P4｜跨域调用隐式且方向混乱。** 素材库 3 处 + 工作区 1 处 import `@/agent/mentionSources`；插件安装内核被 MCP/团队复用；`conf` 与 `teams`/`mobileLink` 构成类型/值混合环；`dxt ↔ servers` 构成模块内运行期环。
- **P5｜路由装配是 161 条扁平挂载。** `router.ts` 327 行、无分组常量；移动任一接口整文件重写，评审 diff 与并行开发冲突成本高。

### 1.4 约束（来自 `AGENTS.md`，直接决定难度与风险）

| 约束 | 出处 | 对本需求的影响 |
| --- | --- | --- |
| **一个接口一个文件**，`routes/**/*.ts` 全量扫描，URL 由文件相对路径决定 | AGENTS「目录结构」「路由与路径规则」 | 目录重组会直接改变 URL；方案 B 保持 `routes/` 位置不动 |
| **通用工具统一 `import u from "@/utils"`** | AGENTS「引用与代码风格」 | `utils.ts` 只能做薄 facade（R-06），145 个调用面本轮不改 |
| **不为简单接口额外搭 controller / service / repository** | AGENTS「目录结构」 | 子模块只能是“路由 + 域工具 + 模块入口”，不得引入分层样板 |
| **禁止新增测试/自检代码** | AGENTS「测试与检查边界」 | 回归靠 `typecheck` + `build` + 端点清单 diff + 手工 HTTP 冒烟；**判据脚本不提交到仓库**，只在证据日志中以 heredoc 执行（§6.7.5） |
| `app.ts` 不监听端口、不建 worker；桌面/移动复用 `@toonflow/server/app` | AGENTS「技术栈与职责」 | `createApp` 签名与 `@toonflow/server/*` exports 必须保持兼容 |
| 文件/目录小驼峰、双引号、分号、两空格 | AGENTS 通用规范 | 新模块目录使用 `assetLibrary` / `mediaGeneration` 等小驼峰 |
| 导入使用 `@/` alias（现状 `utils/mcp` 目录内相对 import = 0） | 现状实测 | R-04 迁移**只替换说明符前缀**，不改导入形态（Q11） |

### 1.5 术语与计数口径（消除歧义的第一道闸）

| 术语 | 定义 | 本矩阵中的使用 |
| --- | --- | --- |
| **B0 基线** | `git HEAD = d084136` 时 `apps/server` 的 237 文件 / 14,349 行 / 161 路由文件 / 187 端点 | 所有“不新增/不变”判据的对照 |
| **PH-B0（基线相）** | 在 `d084136` 快照上执行的判据；说明符一律为迁移前形态 `@/utils/<域>`；用途：冻结基线、证明期望可达 | §1.6.1、附录 A.7 |
| **PH-F（交付相）** | 在实施后工作树上执行的判据；说明符为 `@/modules/<模块>/<域>`；用途：判定“归零/计数”是否达成 | §1.6.1、附录 A.7 |
| **联合模式（union pattern）** | 同时匹配两相说明符的正则（grep `-E`，`|` 不需要转义），例：`from "@/(utils/plugins|modules/pluginMarket/plugins)` | 使“冻结计数”型判据在两相都可执行 |
| **L1 存量台账** | B0 的 237 个文件逐一归属到 8 个模块；每文件恰好一次 | `237/237`、`unassigned=0`、`duplicated=0` |
| **L2 新增台账** | 相对 B0 **净新建**的文件；本版固定 9 个 | `new_total=9`；移动/重命名不算新增 |
| **L3 交付台账** | B0 ∪ L2，按模块汇总；每文件恰好一次 | `final_total=246`；`246 = 237 + 9` |
| **业务实现文件** | B0 的 237 个文件（含既有 `index.ts` 与路由文件） | 单模块 ≤50 |
| **契约/装配文件** | L2 的 9 个新文件 | 计入“含契约 ≤55 文件 / ≤3,300 行”，不计入业务 ≤50 |
| **移动** | 同一文件从旧路径到新路径，文件数与行数不变 | 不改变 L1/L2/L3 计数；必须登记 old→new 映射 |
| **新增 / 删除** | B0 不存在、交付后存在 / B0 存在、交付后不存在 | 新增只允许 L2 的 9 个；净删除必须为 0 |
| **直接边** | 深路径 import（`@/utils/<域>`、`@/lib`、`@/types`），**排除** `from "@/utils"` facade 边与 `@/agent` | R-07 / E10 / 白名单的统计对象 |
| **Facade 边** | `from "@/utils"`（聚合入口 `u`） | 归 bootstrap；E12 管理 |
| **type / value 边** | `import type { X }` 或 `import { type X }` 为 type；其余为 value | 逐条标注，禁止混淆 |
| **阻塞性** | `await`（阻断后续初始化）/ `void`（不阻断）/ 同步注册 | R-03 第 5 列；A-26 校对 |
| **错误语义** | `抛出`（createApp reject）/ `静默吞错`（空 catch，不打印）/ `warn`（打印警告后 resolve）/ `容错`（特定 errno 转默认值） | R-03 第 6 列、§6.8；A-25/A-26 校对 |
| **计数 0** | 指定命令在 `scope_files ≥ 1` 的前提下输出行数为 0 | 不得在空搜索上报 0（§6.7） |
| **diff 为空** | 按 §6.6 归一化后字符串完全相等 | 冒烟判据 |

### 1.6 【本版新增】测量分期、说明符归一化与三条守卫

> 本节是第 3 轮打回 #1/#2 的直接修复，也是 A-14/A-15/A-17 可测性的唯一口径来源。

#### 1.6.1 两相定义

| 相 | 执行环境 | 说明符形态 | 允许的判据类型 | 禁止 |
| --- | --- | --- | --- | --- |
| **PH-B0** | `git show d084136` 快照（或用 `git stash`/独立 worktree 检出） | `@/utils/<域>/...` | ① 冻结基线；② 期望 >0 的**可达性试跑**；③ 迁移前计数复核 | 用 PH-B0 结果判定“已消除” |
| **PH-F** | 实施后工作树（最终交付态） | `@/modules/<模块>/<域>/...` | ① 归零判定；② 计数上限判定；③ SCC / 台账审计 | 在 PH-F 使用**裸 B0 说明符**作为唯一 pattern（会被 §A.12 判 FAIL） |

> 说明：v3 的 A-14/A-15 把「FINAL 路径」和「B0 说明符」写进同一条命令；A-17 把「FINAL 路径」和「B0 说明符 + 期望 1」写进同一条命令。前者在 PH-F 变成**空搜索**（`0 = 0` → 假通过），后者在 PH-F **永远得 0**（`0 ≠ 1` → 不可达）。本版用两相 + 联合模式 + 守卫彻底消除这两个失效模式。

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
| `src/utils/exec.ts` | `src/modules/localRuntime/exec.ts` | localRuntime |
| `src/remoteConnection.ts` | `src/modules/localRuntime/remoteConnection.ts` | localRuntime |
| `src/utils/singleAgent/**` / `@/utils/singleAgent` | `src/modules/agentAccess/singleAgent/**` / `@/modules/agentAccess/singleAgent` | agentAccess |
| `src/utils/sessionState/**` / `@/utils/sessionState` | `src/modules/agentAccess/sessionState/**` / `@/modules/agentAccess/sessionState` | agentAccess |
| `src/utils/browser/**` / `@/utils/browser` | `src/modules/agentAccess/browser/**` / `@/modules/agentAccess/browser` | agentAccess |
| `src/utils/conf/**` / `@/utils/conf` | `src/modules/platformCore/conf/**` / `@/modules/platformCore/conf` | platformCore |
| `src/utils/monitor.ts`、`personalization.ts`、`fileHttp.ts` | `src/modules/platformCore/{monitor,personalization,fileHttp}.ts` | platformCore |
| `src/lib/**`、`src/types/**`、`src/routes/**` | **不移动**（同路径） | platformCore / bootstrap / 各域 |
| `@/agent/**` | **不移动**（不属于 server-api） | agent |

> 说明符形态冻结（Q11 默认）：迁移**只做前缀替换**，`@/utils/mcp/servers` → `@/modules/mcpIntegration/mcp/servers`，**禁止改成相对路径** `./servers`。理由：① 现状 `utils/mcp` 目录内相对 import 实测为 **0**，改成相对路径属于无收益的风格变更；② 边矩阵（A–D、E11）与依赖白名单全部以 alias 说明符为判据，改形态会让判据失效。判据：A-17 的 e5 子项。

#### 1.6.3 三条守卫（0 命中判据不得空转，>0 期望不得不可达）

| 守卫 | 规则 | 违反时的判定 | 适用 |
| --- | --- | --- | --- |
| **G-EXIST** | 命令涉及的目标路径必须先用 `[ -e <path> ]` 检查；任一不存在 → **FAIL（path_missing）**，不得把 0 命中当作通过 | 路径缺失 = 判据未执行 = FAIL | 全部 grep 判据 |
| **G-MATCH** | 期望 0 时，必须同时输出 `scope_files`（目标范围内 `.ts` 文件数）；`scope_files = 0` → **FAIL（vacuous_zero）** | 空搜索 = FAIL | 期望 0 的判据 |
| **G-POS** | 期望 N>0 时必须给出可达性证明，分两种：① **B0 可复现的判据**（A-13 a1、A-14 b1、A-15 c1–c3、A-16 d1/d2、A-17 e1/e2、A-17 e3/e4）→ 必须附 PH-B0 同形态试跑；② **只在交付态存在的判据**（A-14 b5、A-15 c7 指向新模块入口）→ 无 B0 对应，必须改为证明「目标符号在目标文件中存在」（`b5s` / `c7s` 子项） | ① 无 B0 试跑 = FAIL；② 无可达性证明 = FAIL（reachability_miss） | 全部期望 >0 的判据 |

**统一证据行格式（M3/M6 证据日志必须逐字采用）：**

```text
check=<label> phase=<B0|F> expect=<n> scope_files=<n> hits=<n> verdict=<PASS|FAIL>
```

### 1.7 本轮未改动代码的说明

- 本轮仅新增本文件并更新 `INDEX-2026-10.md`。
- 校验：`git status --porcelain apps/server` 输出为空（M6 前由评审复跑）。
- 说明：仓库内 `apps/web/src/components/settings/panels/mediaModel/providerAgentDialog.vue`、`packages/tools/browser/{browserPanel.vue,host.ts}` 的既有改动来自**另一条并行工作的 bugfix 线**（见 `.claude/development_docs/liyuhang/4_bugs_fix/bug_*browser-frame-flood-freeze.md`），不属于本需求，也不是本轮产物。

---

## 2. 目标与非目标

### 2.1 目标

- **G1｜模块切开且预算自洽**：`server-api` 由 1 个 237 文件模块拆为 **8 个模块（1 组合根 + 7 应用子模块）**。
  - **L1 存量**：237/237，无孤儿、无重复。
  - **L2 新增**：固定 9 个文件（§3.3），不得有清单外新增。
  - **L3 交付**：246 文件 / ≤14,839 行；`246 = 237 + 9`。
  - **业务实现**：单模块 ≤50 文件；**含契约/装配**：单模块 ≤55 文件 / ≤3,300 行。
- **G2｜组合根瘦身**：`app.ts` 只保留组合根职责（参数归一、全局中间件顺序、模块装配、静态资源、统一错误处理），**≤80 行**，不再出现任何具体插件类型分支、供应商哈希、具体网关构造、移动运行时初始化。
- **G3｜HTTP 契约不变**：187 个端点的方法与路径 **100% 不变**；`@toonflow/server/*` 的 14 个 exports 与 `createApp` 签名不变；36 个文件 / 57 处引用可解析。
- **G4｜模块契约可读、依赖边可核对**：每个应用子模块有入口声明（职责、路由前缀、初始化钩子、对外导出、依赖白名单）；模块间直接边计数与 §2.4/附录 C 基线一致；不承诺模块级 DAG。
- **G5｜无法消除项结构化豁免**：每条未消除项按 §8 模板登记，写明理由、替代缓解、复核触发条件。
- **G6｜判据可执行且不可假通过（本版新增）**：每条验收判据都有 `phase` 标注、路径存在守卫与搜索范围计数；0 命中不得由空搜索得出；期望 >0 必须有可达性证明；文档级自审（§A.12）可机械发现“PH-F 行使用迁移前说明符”的回归。

### 2.2 非目标（明确排除，避免范围蔓延）

- **NG1｜不做 AgentHost 端口化，不消除运行期双向依赖；但允许并只允许“非编排类工具/类型依赖下沉”。**
  - **不做**：不新建 AgentHost 端口、不改 agent 会话运行时、不消除 19 处运行期/配置类依赖（agentAccess 8、platformCore 3、pluginMarket 1、mcpIntegration 2、utils.ts 5）、不消除 `agent → server` 的 51 处 `@/utils` 反向 import。
  - **做**：把 `MentionQuery` 与 `mentionAssetType` 下沉到 `src/lib/mentionSources.ts`，消除 **assetLibrary 3 处 + localRuntime 1 处** 对 `@/agent` 的 import；`agent/mentionSources.ts` 以相对路径 re-export，保持 `@toonflow/server/agent/mentionSources` 路径不变。
- **NG2**：不抽前端 `contracts` 包、不改 web 的 `/api` 字面量（属 `c-web-console-1`）。
- **NG3**：不把 server 拆成多个 workspace 包（不新增 `packages/app-*`），不做跨包发布。
- **NG4**：不改任何接口行为、响应结构、鉴权语义、数据目录与插件安装语义（含 R-03 的阻塞性/错误语义，见 §6.8）。
- **NG5**：不做 5 组同构插件路由的去重、不拆 `library.ts` / `provider.ts` 巨型文件（另立需求）。
- **NG6**：不新增测试文件、不新增第三方依赖、不引入 controller/service/repository 分层；**判据脚本不落库**（§6.7.5）。

### 2.3 agent 依赖边界表（NG1 与 R-07 的唯一裁决口径）

| 边 | 现状证据 | 计数 | 类型 | 本期处理 | 验收 |
| --- | --- | --- | --- | --- | --- |
| `agentAccess → @/agent` | `utils/singleAgent/index.ts:7-11`、`routes/agent.ts:4,9`、`routes/singleAgent/run.ts:7` | 8 行 | 运行期 | **允许**（核心职责） | 允许 agentAccess 直接 import；不扩散 |
| `utils.ts → @/agent` | `utils.ts` 中 5 个 agent 出口 | 5 出口 | 运行期 | **允许，E2** | 145 个 `u` 调用面不变 |
| `mcpIntegration → @/agent` | `utils/mcp/tools.ts:8-9` | 2 行 | 运行期 | **允许，E8** | 仅 MCP 工具运行 Agent |
| `platformCore → @/agent` | `utils/conf/index.ts:6`（type）、`routes/settings/save.ts:6`、`routes/settings/systemPrompt.ts:3`（value） | 3 行（1t/2v） | 混合 | **允许，E7** | 不新增第 4 处 |
| `assetLibrary → @/agent` | `utils/assets/index.ts:5`（type）、`library.ts:5`、`thumb.ts:4` | 3 行（1t/2v） | 混合 | **消除**（下沉 `lib/mentionSources.ts`） | A-13 归零 |
| `localRuntime → @/agent` | `routes/workspaces/files/thumb.ts:10` | 1 行 | 运行期 | **消除**（同源下沉） | A-13 归零 |
| `pluginMarket → @/agent` | `routes/agents/a2a/save.ts:8` | 1 行 | 运行期 | **允许，E9** | 仅此 1 处 |
| `mediaGeneration → @/agent` | 无 | 0 | — | 保持 0 | grep = 0 |

> 结论：server → agent 的 23 行 = **19 行保留（E2/E6/E7/E8/E9）+ 4 行消除（R-07A）**。

### 2.4 模块依赖方向与 SCC 口径

**测量基准：**

1. **直接边**只统计深路径 import（`@/utils/<域>`、`@/lib`、`@/types`），排除 `from "@/utils"` facade 边与 `@/agent`。
2. **Facade 边**（145 个文件的 `from "@/utils"`）归 bootstrap，制造 bootstrap 枢纽环，E12 登记。
3. 方向按**源文件 → 目标文件**记录；同一对模块的双向边分别计数，不合并成“单向”。

**直接域边基线（20 条；`lines` 为 import 行数）：**

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

> 独立复算见附录 A.11（脚本输出与本表逐行一致）。第 17 条的 `1 type` 与第 15 条的 `1 type` 是**同一对文件**的两条边（`conf → teams`、`conf → mobileLink`），R-07D 一次性消除。

**模块级 SCC（直接边，不含 bootstrap）**

| SCC | 成员 | 本期处理 |
| --- | --- | --- |
| SCC-1（5 个域模块） | `assetLibrary`、`localRuntime`、`mediaGeneration`、`platformCore`、`pluginMarket` | **基线事实，不承诺消除**；E12 |
| SCC-2 | `agentAccess` | 单点；无回边 |
| SCC-3 | `mcpIntegration` | 单点；无回边 |
| 含 bootstrap | 8 个模块 | facade 枢纽环；E12 |

**file 级 SCC（本版按 15 文件更正，见 §0.2 S1）**

| 时点 | 数量（size>1） | 成员 | 结论 |
| --- | --- | --- | --- |
| B0 | 2 | ① **15 文件**：`utils/conf/index.ts`、`utils/teams/{index,files,install}.ts`、`utils/mobileLink/index.ts`、`utils/plugins/{install,tools,nodes,ext}.ts`、`utils/skills/files.ts`、`utils/media/provider.ts`、`utils/ffmpeg/index.ts`、`utils/ai/visibility.ts`、`utils/workspace/{index,files}.ts`；② **2 文件**：`utils/mcp/dxt.ts ↔ utils/mcp/servers.ts` | ① 进入该 SCC 的唯一回边是 `conf → teams`、`conf → mobileLink` 两条 **type** 边 |
| R-07D 后（模拟，已实测） | 1 | 仅 `dxt ↔ servers` | 15 文件 SCC 消失；只剩 E11 |
| R-07E 后（Q8 可选） | 0 | — | Δ+1 文件；L2=10 / L3=247 |

> 模拟复现：附录 A.6 脚本加 `--sim`（跳过 `conf → teams/mobileLink` 两条说明符）后输出 `scc_gt1=1`。

---

## 3. 需求矩阵

### 3.1 需求矩阵总表（背景 / 描述 / 目标 / 优先级 / 难度 / 风险）

| 编号 | 需求（描述） | 背景（来源 + 现状证据） | 目标（可判定产出） | 优先级 | 难度 | 风险 | 关联验收 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **R-01** | 建立 7 个应用子模块入口与统一模块契约 `ServerModule`，每个入口声明职责 / 路由前缀 / 初始化钩子 / 对外导出 / 依赖白名单 | P1；现状无任何模块入口，地图只能把 237 文件登记为 1 模块 | 7 个入口存在、各 ≤60 行、`export default ServerModule`；`routePrefixes` 并集=21 个 `/api/*` 且两两无交集；`dependencies` 为附录 C 白名单子集 | P0 | 中 | 中 | A-06、A-07、A-18 |
| **R-02** | `app.ts` 瘦身为组合根：参数归一、中间件 7 项定序、模块装配、静态与错误处理 | P2；`app.ts` 160 行内含 6 类插件初始化、`createHash`、预热、刷新、MCP/A2A 构造、移动互联 | `app.ts` ≤80 行；禁用符号计数=0；7 项中间件行号递增且 `/api/sessionState` 64kb 在全局 100mb 前；`createApp` 签名 diff 为空 | P0 | 中 | 高 | A-08、A-09、A-21 |
| **R-03** | 初始化 15 步归口到模块入口，**并把每一步的「阻塞性 / 错误语义 / B0 锚点」固化为可判定表格** | P2；15 步顺序与失败语义混写在 `app.ts:59-158`；第 3 轮打回 #3 指出步骤 5 非阻塞吞错未记录 | 15 步逐行与 R-03 表 7 列一致（含步骤 5 `void` + 静默吞错、步骤 9 `void` + warn、步骤 4 ENOENT 容错、步骤 8 锚点在 `express()` 之后）；`app.locals.builtinPlugins` 5 键 `Set<string>`；初始化幂等 | P0 | 中 | **高** | A-10、A-25、A-26 |
| **R-04** | 服务目录模块化：`src/utils/<域>/**` → `src/modules/<模块>/<域>/**`，**只替换说明符前缀、不改导入形态** | P1 + P3；15 个 `utils/*` 子域、246 处深路径 | 7 个模块目录成形；`src/utils/**` 为空（`utils.ts` 除外）；246 处深路径迁移；`@/utils/` 归零（白名单外）；14 exports 可用 | P0 | 很高 | 高 | A-01～A-03、A-12、A-19 |
| **R-05** | 路由装配分组（默认 E4：保留 161 条挂载 + 分组注释 + 模块前缀所有权） | P5；`router.ts` 327 行 161 条扁平挂载 | E4：`grep -c 'app.use'`=161、187 端点 diff 为空、模块 `routePrefixes` 与实际挂载一致；无新增路由文件 | P1 | 高 | 高 | A-07、A-11、A-24 |
| **R-06** | `utils.ts` 改为按模块分组的薄 facade，37 个 key 与 B0 逐 key 一致 | P3；37 出口 / 145 文件引用 / 5 个 agent 出口 | 37 key diff 为空；145 个调用文件零修改；每个 key 有归属注释；文件 ≤130 行 | P1 | 高 | 高 | A-12、A-22 |
| **R-07** | 跨域依赖边 A–D 的消除与契约化（A 消除 4 处 mentionSources；B/C 显式化公开入口；D 消除 2 条 type 边） | P4；`assets → @/agent/mentionSources` 3 处、`workspaces/files/thumb.ts` 1 处；`plugins/install.ts:11 → media/provider`；`utils/mcp` 3 条深路径；`conf → teams/mobileLink` 2 条 type 边 | A：4 处归零、server→agent 23→19、asset→platform 24→27、local→platform 75→76；B/C：F 相深路径 0、公开入口 import 1/3；D：conf 侧 0、反向 4 不变、platform→plugin 0 | P0 | 高 | 中 | A-13～A-16 |
| **R-07E** | `dxt ↔ servers` 模块内环按 E11 冻结（默认）或按 Q8 消除 | P4；B0 的 2 文件 SCC，R-07D 后唯一残留 | 默认：两文件相互 import 各 1（**PH-B0 与 PH-F 分别 1**，联合模式在两相均为 1）、SCC `count=1,size=2`；Q8：两命令=0、SCC=0、L2=10/L3=247 | P2 | 低 | 低 | A-17、E11 |
| **R-08** | 宿主装配兼容：`createApp` 签名与 14 个 `@toonflow/server/*` exports 不变 | 独立 server / Electrobun 桌面 / Android·OHOS 移动三处调用；桌面在拿到 app 后注入 `app.locals.desktop` | 三宿主可启动；桌面 `/api/desktop/*` 15 端点门禁不变；14 exports / 36 文件 / 57 引用不报错 | P0 | 低 | 中 | A-12、A-21 |
| **R-09** | 规范、地图与包导出同步（`AGENTS.md`、模块清单与地图字段同构、`package.json` exports、`tsconfig` paths） | P1；地图详细快照滞后 228/13,955 | `AGENTS.md` 与代码一致；地图重算 8 模块 = L3 246 文件 / ≤14,839 行；exports 无悬空 | P0 | 低 | 低 | A-22 |
| **R-10** | 回归基线与 13 项逐条冒烟 + S1–S8 补充 + 21 前缀首端点 | P2/P4/P5；行为不可变要求 | M0 冻结 5 份基线；13 项 diff 为空；S1–S8 有记录；21 前缀 status diff 为空 | P0 | 中 | 低 | A-11、A-19、A-20 |
| **R-11** | 无法消除项按 §8 模板登记（E1–E12） | 验收口径要求 | 每条有编号/理由/缓解/触发/责任人/判据；E11/E12 用 §8.4 完整模板；**E11 判据两相化** | P0 | 低 | 低 | A-23 |
| **R-12** | 三本账与预算审计（L1 / L2 / L3 + 等式 + 逐模块预算） | 第 2 轮打回 #1；交付态口径歧义 | 输出逐字匹配 §3.3；`new_unregistered=0`；预算全通过 | P0 | 中 | 低 | A-01～A-05 |
| **R-13** | 模块级 SCC 与依赖白名单（不承诺 DAG；E10 7 条弱边冻结） | 第 2 轮打回 #2；`platformCore` 不是叶子 | SCC 审计输出与 §2.4 一致；20 条边计数不超 R-07 后预期；E10 不新增 source→target 对 | P1 | 低 | 中 | A-18 |
| **R-14** | **判据工程：两相命令 + 说明符归一化 + 三守卫 + 文档自审** | 第 3 轮打回 #1/#2；v3 的 A-14/A-15 假通过、A-17 不可达 | 每条判据有 phase；`stale_specifier_in_PHF=0`、`missing_path_guard=0`、`vacuous_zero=0`、`reachability_miss=0`；§A.12 自审脚本可机械复现 | **P0** | 中 | 中 | A-27、§6.7、§A.7、§A.12 |

> 优先级判定：R-03 / R-07 / R-14 为 **P0**（行为保真 + 判据可信）；R-05 / R-06 为 P1（可延后但影响 G4 可读性）。

### 3.2 子模块清单与预算

| # | 子模块（代码目录 / 地图 id） | 职责 | 存量文件 / 行数 | 端点 / 路由文件 | L2 新增 | L3 交付文件 / 行数上限 | 业务 / 契约 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | `bootstrap` / `bootstrap_wiring` | 组合根、路由表生成、全局聚合出口、模块契约类型 | 8 / 710 | 0 / 0 | 1 契约 | **9 / 750** | 8 业务 / 1 契约 |
| 1 | `assetLibrary` / `asset_library` | 素材库根解析、索引分页、增删改移、回收站、缩略图、用量与变更事件 | 27 / 2,615 | 20 / 18 | 1 入口 | **28 / 2,675** | 27 业务 / 1 契约 |
| 2 | `mediaGeneration` / `ai_media_providers` | LLM 模型与供应商配置、文本生成、媒体模型与生成任务、计费、ffmpeg、文档转 Markdown | 42 / 2,994 | 28 / 25 | 1 入口 | **43 / 3,054** | 42 业务 / 1 契约 |
| 3 | `pluginMarket` / `plugin_ecosystem` | tool/node/ext/skill/agent 五类插件与团队的安装、读取、保存、启停、卸载、排序、导出 | 49 / 2,283 | 49 / 39 | 1 入口 | **50 / 2,343** | 49 业务 / 1 契约 |
| 4 | `mcpIntegration` / `mcp_integration` | MCP 服务器配置、DXT/JSON 导入、对外 MCP 端点、控制通道、技能资源 | 20 / 1,433 | 13 / 13 | 1 入口 | **21 / 1,493** | 20 业务 / 1 契约 |
| 5 | `localRuntime` / `local_runtime` | 工作区文件 CRUD 与越界防护、命令执行、桌面宿主桥、设备配对与远端代理 | 45 / 2,195 | 43 / 37 | 1 入口 | **46 / 2,255** | 45 业务 / 1 契约 |
| 6 | `agentAccess` / `agent_orchestration` | Agent 流式会话、单 Agent 运行与工具回调、浏览器输入输出、会话状态桥接、A2A | 26 / 1,193 | 22 / 22 | 1 入口 | **27 / 1,253** | 26 业务 / 1 契约 |
| 7 | `platformCore` / `http_core` | i18n、字段校验、统一响应/错误、平台能力判定、conf 持久化、文件发送、设置与监控接口 | 20 / 926 | 12 / 7 | 1 入口 + 1 契约 | **22 / 1,016** | 20 业务 / 2 契约 |
| — | **合计** | — | **237 / 14,349** | **187 / 161** | **9** | **246 / ≤14,839** | **237 业务 / 9 契约** |

**对账等式（必须逐项成立）：**

- 文件（L1）：`8 + 27 + 42 + 49 + 20 + 45 + 26 + 20 = 237`
- 文件（L3）：`9 + 28 + 43 + 50 + 21 + 46 + 27 + 22 = 246 = 237 + 9`
- 行数（L3 上限）：`750 + 2,675 + 3,054 + 2,343 + 1,493 + 2,255 + 1,253 + 1,016 = 14,839 = 14,349 + 490`
- 端点：`0 + 20 + 28 + 49 + 13 + 43 + 22 + 12 = 187`
- 路由文件：`0 + 18 + 25 + 39 + 13 + 37 + 22 + 7 = 161`

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
| platformCore | 20 | 926 | `lib/**`、`utils/conf/**`、`utils/monitor.ts`、`utils/personalization.ts`、`utils/fileHttp.ts`、`types/desktop.ts`、`routes/{settings,monitor}/**` |
| **合计** | **237** | **14,349** | — |

```text
existing_total=237
existing_assigned=237
existing_unassigned=0
existing_duplicated=0
existing_orphan=0
```

> `237/237` **只表示 L1**（B0 的 237 个文件逐一归属、无孤儿、无重复），**不表示**交付态只有 237 个文件。

#### L2 新增台账（相对 B0 的净新建，默认 9 个；Q8/Q9 改选时重算）

| # | 新文件 | 归属模块 | 用途 | 行数上限 | 类别 |
| --- | --- | --- | --- | --- | --- |
| 1 | `src/modules/assetLibrary/index.ts` | assetLibrary | 入口契约 + `warmup`（见 R-03 步骤 5 语义约束） | 60 | 契约/装配 |
| 2 | `src/modules/mediaGeneration/index.ts` | mediaGeneration | 入口契约 + providers 初始化/模型刷新 | 60 | 契约/装配 |
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
5. 任何清单外新增、净删除、未登记移动，均判 L2 失败。

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

### 3.5 计数与预算规则

1. **行数**：UTF-8 行数（`wc -l` 等价），不忽略任何行；不生成物。
2. **业务文件**：只计 B0 的 237 个文件；**契约文件**：只计 L2 的 9 个。
3. **边计数**：以 import **行**为单位（一行 `import` 计 1），`import type` 记 type，其余记 value；同一行多符号仍计 1。
4. **grep 计数**：一律 `--include='*.ts'`；期望 0 必须附 `scope_files`；期望 >0 必须有 B0 可达性证明（§1.6.3）。
5. **预算**：业务 ≤50 / 交付 ≤55 / 行数 ≤3,300 / bootstrap ≤900 / 入口 ≤60 / L2 合计 ≤490。
6. **交付态口径**：只认 L3 的 246（或 Q8 的 247）；不得用 L1 的 237 或地图 228 描述交付态。

---

## 4. 需求详述

> 每条需求固定结构：**背景 → 目标 → 描述 → 验收（含 phase）→ 风险与缓解**。凡涉及 grep/计数的验收，均在附录 A 给出可执行命令与守卫。

### R-01 模块契约对象与 7 个应用子模块入口（P0｜难度中｜风险中）

- **背景**：P1。`server-api` 有 21 个 `/api/*` 路由目录、15 个 `utils/*` 子域，但没有任何“模块入口”声明；地图只能登记为 1 个模块（评分 50，`god_module`）。
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

  - 入口允许额外具名导出（`pluginMarket.syncDirectory`、`pluginMarket.initializeTools`、`mediaGeneration.initializeProviders`、`assetLibrary.warmup`）；`ServerModule` 只约束公共字段。
- **验收**：
  - [F] 7 个入口逐个存在（§3.3 L2 #1–#7），每个 `export default` 一个 `ServerModule`，每个 ≤60 行；
  - [F] `routePrefixes` 并集 = §3.4 的 21 个 `/api/*` 前缀且两两无交集；`/mcp` 只属 mcpIntegration，`/a2a` 只属 agentAccess；
  - [F] `dependencies` 是附录 C 白名单子集，且不列 bootstrap（`types/module` 的 type-only 导入是组合契约）；
  - [B0+F] `assetLibrary` 入口的 `warmup` 必须是**同步签名返回 void**（`grep -nE 'warmup\??\(context' src/modules/assetLibrary/index.ts` 命中的行**不得**含 `async` 或 `Promise`）——与 R-03 步骤 5 一致。
- **风险与缓解**：入口与实际目录脱节 → 退化为“文档式拆分”。缓解：`routePrefixes` 由 `router.ts` 挂载表反向核对；`dependencies` 用附录 A.7 判据核对；入口行数 >60 即失败。

### R-02 `app.ts` 瘦身为组合根（P0｜难度中｜风险高）

- **背景**：P2。`app.ts` 160 行里初始化、哈希、预热、刷新、MCP/A2A、移动互联与中间件顺序混写。
- **目标**：`app.ts` ≤80 行，只保留组合根职责；`createApp` 对外签名与返回值不变。
- **描述**（按 B0 行号锚定，**本版纠正 v3 的步骤 8 锚点错误，见 §0.2 S2**）：
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
  - [F] **静态导入边界**：`app.ts` 的静态 import 图**不得**传递求值 `conf` 或 `assets/thumb`（B0 用动态 import 正是为了让 `TOONFLOW_DATA_DIR` 先于 `conf` 生效）。判据：在全新临时数据目录下启动，`<tmp>/settings.json` 被创建、仓库内 `data/settings.json` mtime 不变（A-25 的 f2 子项）。
- **风险与缓解**：数据目录时序 + 中间件顺序 + 宿主在 `createApp` 后注入 `app.locals.desktop` → 组合根只做装配；中间件写成显式有序数组；三宿主各跑一次冒烟（A-21）。

### R-03 初始化归口与「顺序 + 阻塞性 + 错误语义」固化（P0｜难度中｜风险高）

- **背景**：P2；`app.locals.builtinPlugins` 由 `app.ts` 生产，5 组路由消费。第 3 轮打回 #3：v3 只记了顺序，**没记步骤 5 的非阻塞与静默吞错语义**；本版自查又发现步骤 8 的锚点在 v3 中写错（§0.2 S2）。
- **目标**：15 步全部归口到模块入口；**每一步的锚点（B0 行号）、阻塞性、错误语义逐项固化**，实施后逐行可核对。
- **描述**：下表是权威顺序表。锚点规则：**步骤 1–7 在 `const app = express()`（B0:92）之前**；**步骤 8 在 `app.locals.appVersion`（B0:93）之后、开发分支（B0:108）之前**；**步骤 9–15 在 7 项中间件（B0:112-127）之后**；`/mcp`（步骤 11）、`/a2a`（步骤 12）、静态（13）、错误处理（14）、移动互联（15）的相对顺序不得调整。

| 序 | 调用 | 归属 | B0 app.ts 行 | 阻塞性 | 错误语义（必须保真） | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `pluginMarket.initializeTools(ctx)` | pluginMarket | 63-64 | `await` | **抛出** → createApp reject | tools 目录；`/^[a-z][a-zA-Z0-9]*\.tool\.js$/` |
| 2 | `pluginMarket.initializeNodes(ctx)` | pluginMarket | 65 | `await` | **抛出** | nodes 目录；`/^[a-z][a-zA-Z0-9]*\.umd\.js$/` |
| 3 | `pluginMarket.initializeExt(ctx)` | pluginMarket | 66-69 | `await`（内部动态 import `initializeExt`） | **抛出** | ext 目录；动态 import 保持 |
| 4 | `mediaGeneration.initializeProviders(ctx)` | mediaGeneration | 70-86 | `await` | **抛出 + 局部容错**：`readFile` 的 `ENOENT` → `Buffer.alloc(0)`（缺内置供应商不算失败），**其他 errno 抛出**；同步走 `ctx.syncPluginDirectory`（不得 import pluginMarket） | 目录 `providers/media`；哈希算法 `sha256`，逐文件 `hash.update(name).update("\0").update(source).update("\0")`，顺序 = `autoInstallProviders` 数组顺序 `["tfRouter.ts","apiMart.ts","metaso.ts","compshare.ts"]`；`pluginRevision` 传入时跳过哈希 |
| 5 | **`assetLibrary.warmup(ctx)`（缩略图预热）** | assetLibrary | **87-88** | **`void`（不 await，不阻断后续步骤）** | **静默吞错**：B0 为 `void import("@/utils/assets/thumb").then(({sweepThumbnailCache}) => sweepThumbnailCache()).catch(() => {})`；**空 catch，无日志、无 rethrow、无 unhandledRejection**。动态 **import** 失败与同步抛出都走该空 catch；清扫**体内部**失败由 `thumb.ts` 自身 `.catch(error => console.warn("缩略图清扫失败", error))` 记录 warn 后 **resolve（永不 reject）**；重复调用返回同一个 `sweeping` promise（并发去重） | **必须保持动态 import**：`thumb.ts:10` 在模块作用域用 `conf.path` 计算缓存目录，静态引入会把 `conf` 求值提前到 `TOONFLOW_DATA_DIR` 设置之前（§R-02 静态导入边界）。调用位置：步骤 4 之后、步骤 6 之前 |
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
  - [F] `grep -rn 'from "@/modules/pluginMarket' apps/server/src/modules/mediaGeneration` = **0**（providers 同步必须走 `ctx.syncPluginDirectory`；scope_files ≥ 43 时该 0 才有效）；
  - [F] 15 步在 `app.ts` 中以显式顺序调用出现，行号递增；`pluginMarket` 的 5 类仍按 tools→nodes→ext→skills→agents；providers 在 ext 之后、skills 之前；
  - [F] `app.locals.builtinPlugins` 键恰为 5 个、值为 `Set<string>`；#5/#6 与 S5–S8 消费不变；
  - [F] 步骤 5 语义保真见 **A-25**（对照本表第 5 行的 B0 语义）；15 步阻塞性/错误语义逐行核对见 **A-26**；
  - [B0+F] providers revision 与 B0 对同一组文件的计算值相同；初始化幂等（同一进程内重复 `createApp` 不重复安装）；
  - [F] `bun run typecheck` 通过（M0/M6 在实施环境执行）。
- **风险与缓解**：把步骤 5 写成 `await` → 启动变慢且缩略图失败会阻断启动（A-25 判 FAIL）；把步骤 5 的吞错“统一”成 step 9 的 warn → 启动日志出现新噪声（A-26 判 FAIL）；步骤 8 挪到 `express()` 之前 → `app.locals` 未就绪，**语法上都写不出来**；`builtinPlugins` 结构变化 → 5 组消费路由冒烟。

### R-04 服务目录模块化（P0｜难度很高｜风险高）

- **背景**：P1 + P3；模块边界要落到目录，地图才能据 glob 切分。
- **目标**：`src/utils/<域>/**` 全部迁入 `src/modules/<模块>/<域>/**`；**说明符只换前缀、不改形态**（Q11）；`src/lib/**`、`src/types/**`、`src/routes/**` 不动。
- **描述**：
  - 迁移范围与 SPEC 映射见 §1.6.2（15 个域目录 + 5 个顶层工具 + `remoteConnection.ts`）。
  - 7 个模块入口为 L2 新增；`utils.ts` 保留兼容 facade（145 个调用文件本轮不改），但其内部 import 需同步改为 `@/modules/...`。
  - 246 处深路径同步迁移；`package.json` exports 与 `tsconfig` paths 同步（`./browser`、`./mcp`、`./mobileLink`、`./desktop`、`./remoteConnection`、`./agent/mentionSources` 等指向新路径或 re-export）。
  - **不保留** `src/utils/<域>/**` re-export 垫片；`src/utils.ts` 是唯一保留的 `utils` 文件；若必须保留垫片，按 L2 逐条登记并重算 L3。
  - `agent` 侧 2 处 `@/utils/documents` 引用（`agent/assets.ts:12`、`agent/tools/index.ts:19`）随迁；其余 `agent → server` 引用按 facade/re-export 保持可用。
- **验收**：
  - [B0+F] L1 `237/237`、L2 `new_total=9`、L3 `final_total=246`（§3.3 / A-01～A-03）；
  - [F] `src/modules/` 下 7 个目录成形；`src/utils/` **目录不存在**（`utils.ts` 是文件 `src/utils.ts`，不在该目录内）：`test -d apps/server/src/utils` 必须为假；
  - [F] `grep -rn 'from "@/utils/' apps/server/src --include='*.ts'` = **0**（白名单逐条列出文件:行）；scope_files ≥ 500（全量 `src/**`）；
  - [F] **说明符形态**：迁移后的跨模块说明符必须为 `@/modules/...`；`grep -rnE 'from "\.{1,2}/(modules|agent)' apps/server/src/modules --include='*.ts'` = **0**（禁止用相对路径跨模块跳转，Q11）；
  - [F] `bun run typecheck` 通过；14 个 `@toonflow/server/*` exports 可 import；36 个外部引用文件不报错；
  - [F] 187 端点 method+path 与 B0 逐条一致；161 路由文件不增不减。
- **风险与缓解**：`import.meta.dirname` 相对层深变化。全仓 `import.meta.dirname` 仅 3 处（`src/index.ts:10`、`src/core.ts:16`、`src/utils/conf/index.ts:13`），只有第 3 处随迁移变化：B0 为 `resolve(import.meta.dirname, "../../../../../data")`（`src/utils/conf` 上溯 5 级到仓库根）；迁移到 `src/modules/platformCore/conf` 后必须改为**上溯 6 级** `"../../../../../../data"`，否则默认数据目录会落到 `apps/data`。判据：不带 `TOONFLOW_DATA_DIR` 启动一次，解析出的目录必须等于 `<repo>/data`（A-25 的 f2 子项）；`createRequire(import.meta.url)` 的第三方包解析随层深变化 → build 产物启动验证（A-19）。

### R-05 路由装配分组（P1｜难度高｜风险高｜默认豁免 E4）

- **背景**：P5。`router.ts` 161 条扁平挂载、327 行。
- **目标**：默认 E4——不改 `core.ts` 生成器，保留 161 条挂载，靠分组注释 + 模块 `routePrefixes` 声明所有权建立可读边界。
- **描述**：
  - **默认（E4）**：保留 161 条 `app.use`；每个域首条挂载前加分组注释；模块入口声明 `routePrefixes`，禁止跨模块抢路由。
  - **可选（Q2 选 C）**：`core.ts` 由“每文件一条 `app.use`”改为“每 URL 前缀一个子 Router”；`router.ts` 只保留 21 个 `/api/*` + `/mcp` + `/a2a`；URL 由“模块声明前缀 + 目录内相对路径”推导，逐条等价；不新增文件。
- **验收**：
  - [F] E4：`grep -c 'app.use' apps/server/src/router.ts` = **161**；187 端点 diff 为空；模块 `routePrefixes` 与实际前缀一致；
  - [F] C：挂载语句 161 → 23；187 端点 diff 为空；无新增路由文件；
  - [B0+F] `bun run routes` 生成结果与基线一致。
- **风险与缓解**：路径漂移 = 前端 `/api` 字面量静默 404。缓解：M0 冻结 187 端点基线；逐条 diff；21 前缀首端点冒烟。

### R-06 聚合入口收敛（P1｜难度高｜风险高｜部分豁免 E2）

- **背景**：P3。`utils.ts` 37 出口 / 145 文件引用；5 个出口来自 `@/agent`。
- **目标**：37 个 key 与 B0 逐 key 一致；调用面零修改；每个 key 有归属模块注释；文件 ≤130 行。
- **描述**：`utils.ts` 由“全量聚合”改为“按模块分组的薄 facade”（每模块一段 re-export，仍导出同名 key，保持 `u.assets` 等调用不变）；5 个 `@/agent` 出口保留（E2）；内部说明符按 SPEC 迁移。
- **验收**：
  - [B0+F] 37 个 key 逐 key diff 为空（`git show d084136:apps/server/src/utils.ts` vs FINAL）；5 个 agent key 保留；
  - [F] 145 个 `from "@/utils"` 文件不改；`u.<domain>` 调用面零修改；
  - [F] 每个 key 上方有归属模块注释；`wc -l apps/server/src/utils.ts` ≤130。
- **风险与缓解**：facade 保留过度 → 收敛名存实亡。缓解：以“出口归属注释 + 模块目录 + 37 key diff”作为可评审产物，而非仅靠行数。

### R-07 跨域依赖边 A–D（P0｜难度高｜风险中）

- **背景**：P4（第 2/3 轮打回已两轮修订）。四条边实测如下；**第 3 轮打回 #1/#2 反馈的正是本节的判据写法**：v3 的 B/C 用了迁移前说明符 + 迁移后路径，A-17 期望 1 不可达。本版把每条边的判据拆成 **PH-B0（可达性/基线）** 与 **PH-F（判定）**，PH-F 一律使用联合模式，并在附录 A.7 给出可直接执行的带守卫命令。
- **目标**：A 的 4 处 mentionSources 归零；B/C 深路径归零并改为模块公开入口；D 的 2 条 type 边归零且反向 4 条 value 不变；四条边的计数变化只允许 §2.4 登记的形态（#5 24→27、#8 75→76、#12 3→3、#15 2→1、#17 1→0、#19 1→1）。
- **描述与判据**：

| 边 | 方向 | B0 证据（`file:line`） | B0 计数 | 类型 | 本版处理 | 判据（phase + 命令标签，命令见 §A.7） | 反向 / SCC |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **A** | `assetLibrary → agent` + `localRuntime → agent` | `utils/assets/index.ts:5`（`MentionQuery`，type）；`utils/assets/library.ts:5`、`utils/assets/thumb.ts:4`（`mentionAssetType`，value）；`routes/workspaces/files/thumb.ts:10`（同函数，value） | **4**（1t + 3v） | 混合 | **消除**：`MentionQuery`、`mentionAssetType` 下沉 `src/lib/mentionSources.ts`；`agent/mentionSources.ts` 以相对路径 `../lib/mentionSources` re-export，`@toonflow/server/agent/mentionSources` 路径不变；更新 4 处 import | **PH-B0 `a1` = 4**（可达性证明）；**PH-F `a2` = 0**（scope = `modules/assetLibrary` + `routes/assets` + `routes/workspaces`，41 文件）；**PH-F `a3`**：server→agent 23→**19**、asset→platform 24→**27**（1t/26v）、local→platform 75→**76**（1t/75v），由 §A.11 脚本输出 | 反向 0；不新增环 |
| **B** | `pluginMarket → mediaGeneration` | `utils/plugins/install.ts:11` `import { addMediaProvider } from "@/utils/media/provider"` | **1**（value） | value | **固化单向契约**：`mediaGeneration` 入口公开 `addMediaProvider`；`pluginMarket` 只从 `@/modules/mediaGeneration` 取 | **PH-B0 `b1` = 1**；**PH-B0 `b2`（反向）= 0**；**PH-F `b3`（反向，联合模式）= 0**（scope = `modules/mediaGeneration/media` + `routes/{ai,providers,ffmpeg}`，32 文件）；**PH-F `b4`（前向深路径，联合模式）= 0**；**PH-F `b5`（公开入口）= 1** 且整行必须是 `import { addMediaProvider } from "@/modules/mediaGeneration";` | 反向 0 |
| **C** | `mcpIntegration → pluginMarket` | `utils/mcp/dxt.ts:9`（`decodeText, skillPath, skillZip`）；`utils/mcp/tools.ts:13`（`listTools`）；`utils/mcp/resources.ts:6`（`import * as skillFile`，`@/utils/skills/files`） | **3**（value） | value | **显式化为安装/工具内核公共契约**（E1）：`pluginMarket` 入口 `export { decodeText, skillPath, skillZip } from "./plugins/install"`、`export { listTools } from "./plugins/tools"`、`export * as skillFiles from "./skills/files"`；`mcpIntegration` 只从 `@/modules/pluginMarket` import（namespace 以 `import { skillFiles as skillFile }` 保持调用面不变） | **PH-B0 `c1/c2/c3` = 1/1/1**；**PH-F `c4/c5/c6`（联合模式深路径）= 0/0/0**（scope = `modules/mcpIntegration/mcp`，7 文件）；**PH-F `c7`（公开入口）= 3**；**`c8` 调用面不变**：`grep -c 'skillFile\.' resources.ts` = **7**、`grep -c 'decodeText\|skillPath\|skillZip' dxt.ts` = **4**；**`c9` 入口三组 re-export 语句逐字存在** | 反向 0 |
| **D** | `platformCore ↔ pluginMarket / localRuntime`（teams/mobileLink 类型环） | `utils/conf/index.ts:5`（`RemoteTeam` ← `@/utils/teams`，type，即 §2.4 #17）；`:8`（`MobileLinkConfig` ← `@/utils/mobileLink`，type，即 #15）；反向 value：`utils/teams/index.ts:5`、`utils/teams/install.ts:4`、`utils/teams/files.ts:6`、`utils/mobileLink/index.ts:10` | **2 type + 4 value** | 混合 | **消除 2 条 type 边**：`RemoteTeam`、`MobileLinkConfig` 定义在 `conf/index.ts`（配置 schema 的 owner），`teams/index.ts`、`mobileLink/index.ts` 以 `export type { ... } from "@/modules/platformCore/conf"` re-export；反向 4 条 value 保留 | **PH-B0 `d1` = 2、`d2`（反向）= 4**；**PH-F `d3`（conf 侧，联合模式）= 0**（scope = `modules/platformCore/conf`，1 文件）；**PH-F `d4`（反向，联合模式）= 4**（scope = `modules/pluginMarket/teams` + `modules/localRuntime/mobileLink`，4 文件）；**PH-F `d5`（§A.11）= `platformCore→pluginMarket 0`、`platformCore→localRuntime 1 value（personalization）`、`platformCore→mediaGeneration 1 value（settings/save）`** | 反向 4 value；SCC-1 仍在，E12 |

- **R-07 总验收**：
  - [B0+F] A：`a1=4` → `a2=0`，`a3` 的三个计数按预期变化；
  - [B0+F] B：`b1=1`、`b2=0`（B0）→ `b3=0`、`b4=0`、`b5=1`（F）；
  - [B0+F] C：`c1..c3=1`（B0）→ `c4..c6=0`、`c7=3`、`c8` 调用面不变（F）；
  - [B0+F] D：`d1=2`、`d2=4`（B0）→ `d3=0`、`d4=4`、`d5` 三条值（F）；
  - [F] **不要求**消除 `agentAccess → @/agent`（8）、`utils.ts → @/agent`（5）、`mcpIntegration → @/agent`（2）、`platformCore → @/agent`（3）、`pluginMarket → @/agent`（1）、`agent → server`（51）（NG1/E2/E6/E7/E8/E9）；
  - [F] **不要求**模块级 DAG；SCC-1 保留（E12）。
- **风险与缓解**：`mentionSources` 下沉牵动 web 的 `@toonflow/server/agent/mentionSources` 契约（4 处引用）→ 保留原路径 re-export 并冒烟；类型下沉改变 `teams`/`mobileLink` 的公开类型 → 保留 re-export；**判据假通过（R16）** → 全部改用 §1.6 两相 + 三守卫；入口行数增加 → 计入 L2 ≤60 行/入口与 L3 ≤3,300 行。

### R-07E `dxt ↔ servers` 模块内环（P2｜难度低｜风险低｜E11）

- **背景**：第 2 轮打回要求登记正确豁免；第 3 轮打回指出本条的判据 `=1` **不可达**（用了迁移前说明符 + 迁移后路径）。B0 的 2 个 file 级 SCC 之一，R-07D 后**唯一**残留。
- **目标**：默认按 E11 冻结两条边（两相均为 1，可执行且可达）；Q8 选消除时两相均为 0、SCC 归零。
- **证据**：

| 方向 | `file:line` | 符号 | 类型 | B0 计数 |
| --- | --- | --- | --- | --- |
| `dxt.ts → servers.ts` | `apps/server/src/utils/mcp/dxt.ts:10` | `saveImportedMcpServers` | value | 1 |
| `servers.ts → dxt.ts` | `apps/server/src/utils/mcp/servers.ts:8` | `removeMcpBundle` | value | 1 |

- **SCC 事实**（本版实测，附录 A.6）：B0 `scc_gt1=2`（15 文件 + 2 文件）；R-07D 模拟后 `scc_gt1=1`（仅此 2 文件）；两文件 R-04 后同属 `mcpIntegration`，故为**模块内环**。
- **判据（关键修订）**：

| 标签 | phase | 命令要点（完整命令见 §A.7） | 期望 | 说明 |
| --- | --- | --- | --- | --- |
| **e1** | **PH-B0** | `dxt.ts` 中 `from "\(@/utils/mcp/servers\|@/modules/mcpIntegration/mcp/servers\)"` | **1** | 联合模式，两相等价；v3 用裸 `@/utils/mcp/servers` 在 PH-F 必为 0 |
| **e2** | **PH-B0** | `servers.ts` 中 `from "\(@/utils/mcp/dxt\|@/modules/mcpIntegration/mcp/dxt\)"` | **1** | 同上 |
| **e3** | **PH-F** | 同 e1，路径 `src/modules/mcpIntegration/mcp/dxt.ts` | **1** | 可达性由 e1 证明（G-POS） |
| **e4** | **PH-F** | 同 e2，路径 `.../servers.ts` | **1** | 可达性由 e2 证明 |
| **e5** | **PH-F** | `grep -cE 'from "\.{1,2}/'` 两文件 | **0** | 说明符形态冻结（Q11）：不得把两条边改成相对路径，否则 e3/e4 判据失效 |
| **e6** | **PH-F** | 附录 A.6 SCC 审计 | `scc_count=1`、`scc_size=2`、成员恰为这两文件 | 主判据（解析式，不依赖说明符形态） |

- **处理**：
  - **默认（E11）**：保留环，按 §8.4 填满豁免；不新增文件；L2 = 9、L3 = 246。
  - **可选（Q8）**：提取 `bundleRoot`/`removeBundleDirectory`/`removeMcpBundle` 到 `src/modules/mcpIntegration/bundle.ts`，`dxt`/`servers` 均 import `bundle`；L2 = 10、mcp 21→22、L3 = 247、行数 +30。此时 **e1–e4 期望改为 0**、`e6` 期望 `scc_count=0`。
- **风险与缓解**：地图仍可能因模块级 SCC 标记 `circular_dep` → 在 E11/E12 注明“file 级 SCC 仅 1 个 2 文件、模块内”；若 Q8 消除，需额外审查 `bundleRoot` 的安全路径校验迁移。

### R-08 宿主装配兼容（P0｜难度低｜风险中）

- **背景**：`createApp` 由独立 server、Electrobun 桌面、Android/OHOS 移动三处调用；桌面在拿到 app 后才设置 `app.locals.desktop` 并启动 MCP runtime；移动端叠加 `/api/connection` 与反向代理。
- **目标**：`createApp` 参数与返回值不变；14 个 `@toonflow/server/*` export 全部可用。
- **验收**：
  - [F] 三宿主可启动；桌面 `app.locals.desktop` 注入路径与门禁行为不变；
  - [F] `/api/desktop/*` 15 个端点仍仅桌面可用；
  - [F] 14 exports / 36 文件 / 57 处引用不报错；
  - [B0+F] `createApp` 签名与 B0 diff 为空。
- **风险与缓解**：`@toonflow/server/*` 是 web 的编译期契约 → M0 冻结 14 个 export 清单，迁移后逐项 import 冒烟。

### R-09 规范、地图与包导出同步（P0｜难度低｜风险低）

- **目标**：`AGENTS.md`、地图模块清单、`package.json` exports、`tsconfig` paths 与代码一致。
- **验收**：
  - [F] `AGENTS.md` 与代码一致（目录结构、`utils.ts` 入口规则、模块入口约定）；
  - [F] 地图重算后 `server-api` 为 8 模块，files/lines 与 L3 表逐项一致（246 文件 / ≤14,839 行）；
  - [F] 地图详细快照不再停留在 228/13,955；若保留历史快照，必须标注“B0-only，不含 9 个滞后文件与 9 个 L2 文件”；
  - [F] 14 exports 全部可解析；`package.json` exports 与 `tsconfig` paths 无悬空。
- **风险与缓解**：地图 glob/exclude/行数口径差异 → 在模块清单中显式记录 2 处归属更正与 9 个滞后文件，重算后校验 `237+9=246`。

### R-10 回归基线与 13 项逐条冒烟（P0｜难度中｜风险低｜先行）

**M0 冻结五份基线：** ① `git rev-parse HEAD` = `d084136`；② 187 条 `method + path` 清单；③ `router.ts` 全文 + 161 条挂载清单；④ `typecheck`/`build` 通过状态（M0 在实施环境复跑并记录）；⑤ 14 exports / 36 文件 / 57 处引用清单。

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
  - [F] S1–S8 有记录；21 个 `/api/*` 前缀各取 1 个首端点做 status diff（首端点定义：该前缀下按路由文件路径字典序、再按文件内 method 出现顺序的第一个端点；M0 生成 21 条清单并归档）；
  - [F] `bun run typecheck`、`bun run build` 通过；`build/server` 产物可启动。
- **风险与缓解**：环境无供应商/无桌面宿主 → 以“改动前后一致”为判据；所有 fixture 与响应快照归档在 M0 文档；不新增测试文件。

### R-11 结构化豁免登记（P0｜难度低｜风险低）

- **验收**：
  - [F] E1–E12 逐条有编号、关联需求、理由、替代缓解、复核触发条件、责任人、有效期；
  - [F] E11/E12 必须使用 §8.4 完整模板；**E11 的判据必须是两相 + 联合模式**（v3 的单相 `=1` 已作废）；
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
L3: endpoints 0+20+28+49+13+43+22+12=187; routes 0+18+25+39+13+37+22+7=161
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

### R-14 判据工程：两相、归一化、守卫与自审（P0｜难度中｜风险中｜本版新增）

- **背景**：第 3 轮打回 #1/#2。根因不是“算错数”，而是**判据的坐标系没有声明**：v3 在一条命令里混用 B0 说明符与 FINAL 路径，导致两类失效——**假通过**（A-14/A-15：空搜索得 0）与**不可达**（A-17：期望 1 永远拿不到）。
- **目标**：所有验收判据都具备 ① 明确 phase；② 说明符按 SPEC 归一化；③ 三条守卫（G-EXIST / G-MATCH / G-POS）；④ 可机械自审（§A.12），使同类失效模式**无法再次进入文档**。
- **描述**：
  1. **分期标注**：§6.5 判定表新增 `Phase` 列；每条判据取值为 `B0` / `F` / `B0+F`；
  2. **说明符归一化**：PH-F 的 pattern 必须是**联合模式**（含 `modules/`）或纯 FINAL 说明符（`@/modules/`）；PH-B0 才允许裸 `@/utils/` 说明符；
  3. **守卫**：0 命中必须给 `scope_files` 且 >0；路径不存在 → FAIL；期望 >0 必须附 PH-B0 可达性试跑；
  4. **形态冻结**：跨模块说明符统一用 `@/modules/...`，禁止相对路径（Q11）；
  5. **脚本不落库**：判据以 heredoc 执行（AGENTS 禁止新增测试/自检文件），执行输出粘贴进 M3/M6 证据日志；
  6. **文档自审**：§A.12 脚本扫描本文档 §4/§6.5，凡 `PH-F` 行出现裸 `@/utils/` 说明符、或 0 命中判据缺 `scope_files`，一律输出 FAIL。
- **验收**：
  - [F] A-27 逐项通过：`criteria_total=27`、`criteria_phase_tagged=27`、`stale_specifier_in_PHF=0`、`missing_path_guard=0`、`vacuous_zero=0`、`reachability_miss=0`；
  - [F] §A.12 自审脚本对本文档输出 `doc_audit=PASS`；
  - [B0+F] A-14/A-15/A-17 的三组命令在两相都能执行（B0 得出基线值，F 得出判定值），无一为空搜索。
- **风险与缓解**：实施者“顺手”把说明符改成相对路径 → e5（形态冻结）+ A-27 联合模式判 FAIL；取舍：允许在 §A.7 之外用临时命令排查，但**作为验收证据的命令必须是本文档给出的命令**。

---

## 5. 方案选项与推荐

| 方案 | 内容 | 改动面 | URL 风险 | 能否消除 237 文件 god module | 预估人日 | 结论 |
| --- | --- | --- | --- | --- | --- | --- |
| **A｜仅清单化** | 只新增 7 个模块入口声明与依赖清单，`utils/`、`routes/` 不动；`app.ts` 瘦身 | 小（~15 文件） | 无 | **否**（地图仍只有 1 个 237 文件模块） | 4-5 | 可作过渡，不满足验收 |
| **B｜服务模块化 + 路由保留** | 方案 A + `utils/<域>` 迁入 `src/modules/<域>`；`routes/` 与 `core.ts` 不变，URL 零风险 | 中（237 文件路径 + 246 处引用） | 无 | **可以** | 9-11 | **推荐第一期（默认）** |
| **C｜全量目录化** | 方案 B + 路由文件迁入模块目录 + `core.ts` 按域生成子 Router + `utils.ts` 收敛 | 大（全部 237 文件 + 生成器） | **高** | **可以** | 16-20 | 第二期（Q2；默认不做） |

**推荐路径**：`R-10 基线` → `R-01/02/03/08` → `R-04` → `R-07/07E` → Q2 决策（默认 E4）→ `R-06/09/11/12/13/14` → 13 项 + S1–S8 冒烟 → M6 审查。
理由：先把组合根与初始化从 `app.ts` 剥离（低风险、立竿见影），再做目录迁移；路由生成器（R-05）风险最高、收益相对最小，默认作独立决策点（E4），不阻塞本期。**R-14 与 R-10 并列先行**：判据不可信时，后续一切结论都不可信（本轮打回的教训）。

---

## 6. 验收标准

### 6.1 硬性结构指标

- [ ] 地图/清单中 `server-api` 拆为 **8 个模块（1 组合根 + 7 应用子模块）**；默认 L1 `237/237`、L2 `9`、L3 `246` 同时成立（Q8/Q9 改选时按 §10 记录重算）。
- [ ] **业务实现文件 ≤50 / 模块**；**含契约/装配文件 ≤55 文件 / ≤3,300 行 / 模块**；`pluginMarket` 49 业务 + 1 契约 = 50；`mediaGeneration` 42+1 = 43 / 3,054 行。
- [ ] `app.ts` **≤80 行**，且 0 处具体插件类型、供应商哈希、`initializePlugins`、`createMcpRouter`/`createA2aRouter` 构造、`initializeMobileLinkRuntime`、`initializeProviderModels`（R-02）。
- [ ] `bootstrap` 子模块合计 **≤900 行**（现状 710，交付 750）。
- [ ] 每个子模块有入口文件，声明职责 / 路由前缀 / 初始化 / 导出 / 依赖（R-01）；每入口 ≤60 行。
- [ ] 模块间直接边符合 §2.4/附录 C：A 4 处归零；B 反向 0 且公开入口 1；C 深路径 0 且公开入口 3；D 2 条 type 边归零；E10 7 条弱边不新增；E11 模块内环登记；E12 模块级 SCC 登记。
- [ ] 不存在“为了满足 ≤50 而隐藏文件”的计数游戏：入口/契约/共享文件均计入 L2 与 ≤55 硬上限。
- [ ] 不以“模块级 DAG”作为验收条件；SCC-1 是基线事实，E12 登记。

### 6.2 契约与回归

- [ ] **187 个端点的方法与路径 100% 不变**（逐条 diff 基线）。
- [ ] 161 个路由文件不增不减；`bun run routes` 生成结果与基线一致（若 Q2 选 C：挂载粒度变、端点清单不变）。
- [ ] `bun run typecheck`、`bun run build` 通过；`build/server` 产物可启动。
- [ ] `@toonflow/server/*` 14 个 export 全部可用（36 个文件 / 57 处引用不报错）。
- [ ] 三宿主启动冒烟：独立 server（`dev` 与 `build/server`）、桌面（`app.locals.desktop` 门禁 + update 流转）、移动（`/api/connection` 代理）。
- [ ] 13 项冒烟逐条通过（R-10 表 1–13）；S1–S8 记录结果；21 个 `/api/*` 前缀各 1 个首端点 status diff 为空。

### 6.3 台账与预算

- [ ] L1 `237/237`；L2 `9`；L3 `246`；三本账等式全部成立（§3.3）。
- [ ] 无清单外新增、无净删除、无重复归属；移动有 old→new 映射；路由分组/初始化适配无新增文件。
- [ ] 每模块业务 ≤50、交付 ≤55、行数 ≤3,300；bootstrap ≤900；入口 ≤60；L2 行数 ≤490。
- [ ] 地图重算后 8 模块的 files/lines 与 L3 一致；地图详细快照不再用 228 作为交付分母。
- [ ] `228/13,955 + 9/394 = 237/14,349`（B0）；`237 + 9 = 246`（L3）；两段对账均记录。

### 6.4 规范与交付物

- [ ] `AGENTS.md` 已同步（目录结构、`utils.ts` 规则、模块入口约定）。
- [ ] 无新增 controller/service/repository 分层；无新增测试文件；无新增第三方依赖；**判据脚本未提交到仓库**。
- [ ] E1–E12 豁免登记完整（编号、理由、替代缓解、复核触发条件、责任人、判据）；E11/E12 使用完整模板且**判据两相化**。
- [ ] 模块清单已提交，可供架构侧重新生成地图；14 exports / 36 文件 / 57 引用清单已归档。
- [ ] 13 项 + S1–S8 的 fixture、响应快照、diff 结果已归档；归一化规则已写明。

### 6.5 验收判定表（A-01～A-27，二值；含 Phase 列）

> 规则：每项只有 **PASS / FAIL**；缺证据 = FAIL；N/A 仅在 Q 决策明确记录且该项不适用时成立。
> **Phase 列**：`B0` = 在 `d084136` 快照执行；`F` = 在交付态执行；`B0+F` = 两相都要有证据（B0 用于基线/可达性，F 用于判定）。
> 判据守卫见 §6.7；命令见附录 A。

| 编号 | 验收项 | Phase | 命令 / 产物 | 期望值 | 证据位置 | 判定 |
| --- | --- | --- | --- | --- | --- | --- |
| A-01 | L1 存量归属 | B0+F | §A.10 审计脚本 | `existing_total=237`、`assigned=237`、`unassigned=0`、`duplicated=0` | M2 审计日志 | ☐ PASS ☐ FAIL |
| A-02 | L2 新增台账 | B0+F | §A.10 | `new_total=9`、`new_unregistered=0`、9 个路径逐字匹配 §3.3 | M2/M6 日志 | ☐ PASS ☐ FAIL |
| A-03 | L3 交付台账 | F | §A.10 | `final_total=246`；文件/端点/路由等式成立；行数 `14,349+X (0≤X≤490)` | M6 日志 | ☐ PASS ☐ FAIL |
| A-04 | 业务 ≤50/模块 | F | §3.3 L3 表 | 8 模块业务计数均 ≤50；`pluginMarket=49` | §3.3 | ☐ PASS ☐ FAIL |
| A-05 | 交付 ≤55/≤3,300/≤900 | F | §3.3 L3 表 | 8 模块均 ≤55、≤3,300；bootstrap ≤900（交付 750） | §3.3 | ☐ PASS ☐ FAIL |
| A-06 | 7 个模块入口与契约 | F | `ls` + 读文件 | 7 个路径存在；每个 `export default ServerModule`；≤60 行；字段齐全 | `src/modules/**/index.ts` | ☐ PASS ☐ FAIL |
| A-07 | 路由前缀所有权 | F | 入口 `routePrefixes` + `router.ts` | 并集 = 21 个 `/api/*`、无交集；`/mcp` 只属 mcpIntegration、`/a2a` 只属 agentAccess | §3.4 + 入口文件 | ☐ PASS ☐ FAIL |
| A-08 | `app.ts` ≤80 与禁用符号 | F | `wc -l` + `grep -cE` | ≤80；禁用符号计数 = 0；`builtinPlugins` 仅 1 处赋值 | `app.ts` | ☐ PASS ☐ FAIL |
| A-09 | 中间件顺序 | F | `grep -n` | 7 项行号递增；`/api/sessionState` 64kb 在全局 100mb 前 | `app.ts` | ☐ PASS ☐ FAIL |
| A-10 | 初始化 15 步顺序 + **步骤 8 锚点** + builtinPlugins | B0+F | 读 `app.ts` + 5 组冒烟 | 顺序与 §R-03 表一致；**步骤 1–7 在 `express()` 前、步骤 8 在 `app.locals.appVersion` 后**；5 键 `Set`；S5–S8 通过 | `app.ts` + 冒烟日志 | ☐ PASS ☐ FAIL |
| A-11 | 187 端点 / 161 路由文件 | B0+F | §A.2 | method+path diff 为空；路由文件 161 | M0/M6 清单 | ☐ PASS ☐ FAIL |
| A-12 | 14 exports / 36 文件 / 57 引用 | F | §A.5 | 逐项 import 成功；计数一致 | M0/M6 清单 | ☐ PASS ☐ FAIL |
| A-13 | R-07A mentionSources 归零 | **B0+F** | §A.7 `a1/a2/a3` | `a1=4`（B0，scope=41）→ `a2=0`（F，scope=60）；server→agent 23→**19**；asset→platform **27**；local→platform **76** | M3 grep 日志 | ☐ PASS ☐ FAIL |
| A-14 | R-07B plugin→media 契约 | **B0+F** | §A.7 `b1/b2（B0）、b3/b4/b5/b5s（F）` | B0：`b1=1`、`b2=0`；F：`b3=0`（scope=32，**联合模式**）、`b4=0`、`b5=1` 且整行为 `import { addMediaProvider } from "@/modules/mediaGeneration";` | M3 grep 日志 | ☐ PASS ☐ FAIL |
| A-15 | R-07C mcp→plugin 深路径 | **B0+F** | §A.7 `c1..c3（B0）、c4..c9 + c7s/c8a/c8b（F）` | B0：`c1=c2=c3=1`；F：`c4=c5=c6=0`（scope=7，**联合模式**）、`c7=3`、`c8`（`skillFile.`=7、dxt 符号行=4）、`c9` 三组 re-export 逐字存在 | M3 grep 日志 | ☐ PASS ☐ FAIL |
| A-16 | R-07D conf type 边归零 | **B0+F** | §A.7 `d1..d5` | B0：`d1=2`、`d2=4`；F：`d3=0`（scope=1）、`d4=4`（scope=4）、`d5`：platform→plugin **0**、→local **1 value**、→media **1 value** | M3 grep 日志 + §A.11 | ☐ PASS ☐ FAIL |
| A-17 | R-07E dxt/servers | **B0+F** | §A.7 `e1..e6` + §A.6 | 默认：`e1=e2=1`（B0）、`e3=e4=1`（F，**联合模式**，可达性由 e1/e2 证明）、`e5=0`（形态冻结）、`e6`：`scc_count=1,size=2`；Q8：`e1..e4=0`、`scc_count=0`、L2=10/L3=247 | M3 审计 + §11 | ☐ PASS ☐ FAIL |
| A-18 | 模块 SCC / 白名单 / E10 | F | §A.6 + §A.11 | SCC 成员与 §2.4 一致；20 条边计数 = R-07 后预期值；E10 7 条不新增 | M3/M5 审计 | ☐ PASS ☐ FAIL |
| A-19 | typecheck / build / 产物启动 | F | `bun run typecheck`、`bun run build`、启动 `build/server` + `GET /api/settings/get` | 成功；产物启动 10s 内无未捕获异常；响应与基线一致 | M0/M6 日志 | ☐ PASS ☐ FAIL |
| A-20 | 13 项 + S1–S8 + 21 前缀 | B0+F | R-10 表 | 13 项 diff 为空；S1–S8 有记录；21 前缀 status diff 为空 | 冒烟归档 | ☐ PASS ☐ FAIL |
| A-21 | 三宿主启动 | B0+F | 独立：dev 与 `build/server`；桌面；移动 | 三宿主 10s 内无未捕获异常且端口监听；`GET /api/settings/get`、`POST /api/desktop/update/check`、`/api/connection` 代理与基线一致；桌面 15 端点门禁不变 | M1/M6 日志 | ☐ PASS ☐ FAIL |
| A-22 | AGENTS / 地图 / exports 同步 | F | 读文件 + 地图重算 | AGENTS 与代码一致；地图 8 模块 = L3 246 文件 / ≤14,839 行；exports 无悬空 | M5 清单 | ☐ PASS ☐ FAIL |
| A-23 | 豁免表完整 | F | §8 E1–E12 | 每条有编号/理由/缓解/触发/责任人/判据；E11/E12 完整模板且判据两相化 | §8 + §11 | ☐ PASS ☐ FAIL |
| A-24 | 无新增测试/依赖/分层；无隐藏文件 | F | `git status` + L2/L3 | 0 测试文件、0 新依赖、0 controller/service/repository、0 判据脚本落库；L2 外无新增 | M6 diff | ☐ PASS ☐ FAIL |
| **A-25** | **R-03 步骤 5 缩略图预热语义保真** | **F** | §A.7 `f1..f5` | `f1`：调用点无 `await`；`f2`：默认数据目录 = `<repo>/data`、显式目录生效且仓库 `data/` 不被写入；`f3`：入口 0 处 `console.*`、`thumb.ts` 内部 warn 保留 1 处；`f4`：只读注入下 `createApp` 仍 resolve、无 `unhandledRejection`；`f5`：重复 `createApp` 不重复安装 | M1 日志 | ☐ PASS ☐ FAIL |
| **A-26** | **15 步阻塞性/错误语义矩阵** | **F** | §A.7 `g1..g6` + 读 `app.ts` | 每步与 §R-03 表第 5/6 列逐项一致；步骤 5 = `void`+静默、步骤 9 = `void`+warn，**二者未合并**；步骤 1–4、6–8、10–12、15 为 `await`+抛出；步骤 4/8 的 ENOENT 容错保留 | M1 日志 | ☐ PASS ☐ FAIL |
| **A-27** | **判据自审（分期/守卫/可达性）** | **B0+F** | §A.12 | `criteria_total=27`、`criteria_phase_tagged=27`、`stale_specifier_in_PHF=0`、`missing_path_guard=0`、`vacuous_zero=0`、`reachability_miss=0`、`doc_audit=PASS` | M3/M6 日志 | ☐ PASS ☐ FAIL |

> A-25 / A-26 的**命令在交付态执行**（`Phase=F`）；其**语义基准**是 §R-03 表的「B0 行号 / 阻塞性 / 错误语义」三列与 §6.8 清单，不要求在交付态重跑 B0 命令。

### 6.6 不可判定项清零规则

1. **禁止模糊词**：验收条目不得出现“基本/尽量/合理/约/较多/较少/必要时”；所有数字必须是精确值或明确上限。
2. **每条验收必须有命令或产物**：只有“评审认为可以”不算验收。
3. **diff 归一化规则**（R-10 冒烟）：JSON 保持数组顺序、对象 key 排序后比较；时间戳/UUID/随机 ID/绝对路径/端口/临时哈希 → `<TS>`/`<UUID>`/`<PATH>`/`<PORT>`/`<HASH>`；SSE 比较事件类型序列 + 归一化 `data`，不比较心跳空行；HTTP 比较 `status`、`content-type`，忽略 `date`/`etag`；文件比较 UTF-8 行数并忽略行尾空格差异。
4. **环境差异**：无供应商/无桌面宿主时，以“改动前后一致”的 4xx/错误体为基线，不以固定 200 为唯一判据；基线快照必须在 M0 归档。
5. **二选一事项**：Q1–Q11 每项有默认值；未在 §11 记录时按默认值执行；记录后按记录值执行。禁止“看情况”。
6. **豁免与验收的边界**：被豁免的项不再要求“消除”，但仍要求 §8 模板完整 + 替代缓解可执行；豁免被驳回则转为验收项。
7. **判定责任**：每个 A 项由评审人勾选 PASS/FAIL；FAIL 必须写明缺失证据；无证据的 PASS 视为无效。
8. **交付态口径**：只认 L3 的 246（或 Q8 的 247）；不得用 L1 的 237 或地图 228 作为交付态。

### 6.7 判据分期、守卫与可达性规则（第 3 轮打回 #1/#2 的直接修复）

1. **分期强制**：任何 grep/计数判据都必须标注 `PH-B0` 或 `PH-F`；§6.5 的 `Phase` 列与附录 A 的命令必须一致；未标注的判据视为无效（A-27 判 FAIL）。
2. **说明符归一化**：
   - PH-B0 允许裸 `@/utils/<域>`；
   - **PH-F 禁止裸 `@/utils/` 说明符**：必须使用联合模式（`from "@/(utils/<域>|modules/<模块>/<域>)`）或纯 FINAL 说明符（`@/modules/...`）；
   - 违例示例（v3 A-14/A-15/A-17 的原写法）：
     - ✗ `grep -rn 'from "@/utils/plugins' apps/server/src/utils/media ...`（PH-F 路径 + B0 说明符 → 空搜索假通过）
     - ✗ `grep -rn 'from "@/utils/mcp/servers"' apps/server/src/modules/mcpIntegration/mcp/dxt.ts` 期望 1（PH-F 路径 + B0 说明符 → 永远 0，不可达）
     - ✓ `grep -rnE 'from "@/(utils/mcp|modules/mcpIntegration/mcp)/servers"' <FINAL 路径>` 期望 1（联合模式，两相均可执行，可达性由 e1 证明）
3. **三守卫**（§1.6.3）：G-EXIST / G-MATCH / G-POS；证据行必须包含 `phase / expect / scope_files / hits / verdict`。
4. **形态冻结**：跨模块说明符统一 `@/modules/...`；A-17 的 `e5` 与 A-27 共同看守。
5. **脚本不落库**：判据脚本以 heredoc 在 M3/M6 现场执行，输出粘贴进证据日志；仓库内不得出现新的 audit/test 文件（A-24）。
6. **文档级自审**：`§A.12` 脚本对本文档执行静态检查，输出 `doc_audit=PASS/FAIL`；FAIL 时不得提交评审。

### 6.8 B0 语义保真清单（初始化 15 步的可判定摘要）

> 本清单是 A-26 的对照表；类别定义见 §1.5「阻塞性 / 错误语义」。

| 语义类别 | 步骤 | 判据要点 |
| --- | --- | --- |
| **`await` + 抛出** | 1、2、3、6、7、10、11、12、15 | 调用点必须是 `await`；失败必须让 `createApp` reject（不得 try/catch 吞掉） |
| **`await` + 抛出 + 局部 ENOENT 容错** | 4（providers 源码读取）、8（builtin `readdir`） | ENOENT → 空值（`Buffer.alloc(0)` / `[]`）；其他 errno 必须抛出 |
| **`void` + 静默吞错（无日志）** | **5（缩略图预热）** | `void`、不 await、空 catch、入口不新增 `console.*`；内部 warn 仍在 `thumb.ts` |
| **`void` + warn（有日志）** | **9（模型刷新）** | `void`、`.catch(error => console.warn("启动时刷新供应商模型失败：", error))`；**不得与步骤 5 合并** |
| **同步注册（无失败路径）** | 13（静态）、14（错误处理） | 行号顺序：13 < 14；14 之后才是 15 |

**四条禁止的“顺手重构”**（每条都有对应 FAIL 判据）：

1. 把步骤 5 改成 `await`（A-25 f1）；
2. 把步骤 5 的空 catch 改成 `console.warn`/`console.error`（A-25 f3、A-26）；
3. 把步骤 5 与步骤 9 抽成同一个 helper（A-26 要求两者语义不同且可区分）；
4. 把 `conf` / `assets/thumb` 的**动态 import 改成静态导入**（A-25 f2 的默认数据目录判据）。

---

## 7. 风险登记表

| # | 风险 | 概率 | 影响 | 缓解 | 判据 |
| --- | --- | --- | --- | --- | --- |
| R1 | 187 端点中任一 URL 漂移（前端 `/api` 字面量静默 404） | 中 | 高 | M0 冻结端点基线；方案 B 不动 `routes/`；逐条 diff | A-11、A-20 |
| R2 | 启动顺序回归（`TOONFLOW_DATA_DIR` 先于 `conf`；`/api/sessionState` 64kb 先于全局 100mb；插件 5 类顺序） | 中 | 高 | §R-03 的 15 步显式顺序 + 7 项中间件顺序；动态 import 边界 | A-09、A-10、A-25 |
| R3 | 初始化**失败语义**被无意改变（catch/await 被“美化”） | **高** | 高 | §R-03 的「阻塞性 / 错误语义」两列 + §6.8 四条禁止重构；故障注入 | A-25、A-26 |
| R4 | 循环依赖扩散（`conf → teams/mobileLink` type 边、`dxt ↔ servers` 运行期环） | 中 | 中 | R-07D 消除 2 条 type 边；E11 冻结；file SCC 审计;禁止新增边 | A-16、A-17、A-18 |
| R5 | `import.meta.dirname` / `createRequire` 层深变化导致资源解析失败 | 中 | 中 | 迁移后校正 `conf/index.ts:13` 的上溯层数（5→6）；build 产物启动 | A-19、A-25 f2 |
| R6 | 桌面/移动宿主的 `app.locals.desktop` 注入时序被改 | 低 | 高 | 组合根只装配；三宿主冒烟 | A-21 |
| R7 | `@toonflow/server/*` 外部契约断裂（web 编译失败） | 低 | 高 | M0 冻结 14 exports；逐项 import 冒烟 | A-12 |
| R8 | 迁移把 `utils.ts` 的 37 个 key 改掉 | 低 | 高 | 逐 key diff；145 个调用面不改 | A-12、A-22 |
| R9 | “文档式拆分”：入口只是摆设，实际依赖仍混乱 | 中 | 高 | `routePrefixes` 并集/交集；入口 `dependencies` 与实际 import 对账 | A-06、A-07、A-18 |
| R10 | 文件预算/审计再次自相矛盾（把 L1 当 L3、隐藏新增） | 中 | 中 | L1/L2/L3 分离；`final - B0` 判新增 | A-01～A-05 |
| R11 | 冒烟环境差异导致“假失败” | 中 | 低 | 归一化 + “改动前后一致”判据；M0 归档基线 | A-20 |
| R12 | `mentionSources` 下沉破坏 web 契约 | 低 | 中 | 保留原路径 re-export；web 4 处 import 冒烟 | A-13 |
| R13 | 初始化幂等被破坏（重复 `createApp` 重复安装） | 低 | 中 | 保留原 marker/revision 语义；重复调用测试 | A-25 f5 |
| R14 | 模块级 SCC 未消除被误判为失败 | 中 | 中 | 明确不承诺 DAG；E12 | A-18 |
| R15 | `pluginMarket` 入口 re-export 引入命名冲突（`list`/`move`/`directory` 等同名符号） | 中 | 中 | 仅 `skills/files` 用 `export * as skillFiles` 命名空间；其余全部**具名** re-export；typecheck 必须通过 | A-15 c9、A-19 |
| **R16** | **判据假通过（0 命中来自空搜索）或期望不可达（迁移后说明符不存在）** | **高（已发生 2 轮）** | **高** | 两相分期 + 联合模式 + 三守卫 + 文档自审 | **A-27、§6.7** |
| **R17** | **吞错语义被“统一化”**（步骤 5 静默 ↔ 步骤 9 warn 互相污染） | 中 | 高 | §6.8 四条禁止重构；A-25 f3、A-26 | A-25、A-26 |
| **R18** | **说明符形态漂移**（跨模块 import 改成相对路径，使边矩阵判据失效） | 中 | 中 | Q11 形态冻结；`e5` 判据；联合模式覆盖 | A-17 e5、A-27 |

---

## 8. 豁免判定与结构化豁免模板

### 8.1 豁免判定标准（满足任一即可申请）

1. **物理不可拆**：受 `AGENTS.md` 或工具链强约束。
2. **成本大于收益**：拆分回归风险显著高于可量化结构收益，且有替代缓解。
3. **依赖未就绪**：需要另一模块/需求先行（如 AgentHost 未落地则 `@/agent` 出口无法移除）。
4. **语义同源**：两项职责共享同一安全边界或同一生命周期。

### 8.2 已识别的候选豁免（E1–E12，供评审勾选）

| 编号 | 关联需求 | 问题 | 建议结论 | 替代缓解 / 判据 |
| --- | --- | --- | --- | --- |
| E1 | R-07C | `utils/plugins/install.ts`（450 行）是 teams / mcp(dxt) / workspace 共用的安装内核；`listTools` 与 `skills/files` 同属插件市场公共能力 | 允许保留为 `pluginMarket` 公开“安装/工具内核”，不物理下沉 | 入口具名公开 `decodeText`/`skillPath`/`skillZip`/`listTools` + `export * as skillFiles`；MCP 只走公开入口；A-15 c4–c9 |
| E2 | R-06 / NG1 | `utils.ts` 中 5 个 `@/agent` 出口 | 本期保留 | AgentHost 端口化后统一移除；出口加归属注释；A-12 |
| E3 | R-07 | `/api/exec` 与工作区同属 `localRuntime` | 允许合并 | 二者共用 `isLocalWorkspaceRequest` 安全边界；A-11 |
| E4 | R-05 | 默认不改造 `core.ts`：保留 161 条扁平挂载 | 本期默认豁免；Q2 可改 C | 分组注释 + 模块前缀清单对账；A-07、A-11 |
| E5 | R-07D | `conf` 对 `teams`/`mobileLink` 的 2 条 `import type` | **本版默认不用 E5**：类型定义放 `conf`，0 新文件；仅当评审否决该方案时启用 | 类型下沉到 `src/types/` 属独立需求；A-16 |
| E6 | NG1 | `agent → server` 51 处 `@/utils` + 20 处 `@/lib\|@/types`；`server → agent` 19 处运行期依赖 | 本期不消除 | 需 AgentHost 端口化；**路径归一化**：R-04 后 `@/utils/<域>` → `@/modules/<模块>/<域>`，E6 的 51 按 `@/(utils\|modules)` 合并计数仍为 51（§1.6.3 G-POS） |
| E7 | §2.3 | `platformCore` 的 3 处 `@/agent` 依赖 | 本期保留 | 不新增第 4 处；入口 `dependencies` 标注 type/value；A-18 |
| E8 | §2.3 | `utils/mcp/tools.ts:8-9` 对 `@/agent/tools`、`@/agent` 的运行期依赖 | 本期保留 | MCP 工具执行 Agent 是其职责；禁止扩散；A-18 |
| E9 | §2.3 | `routes/agents/a2a/save.ts:8` 对 `@/agent/runtime/model` 的依赖 | 本期保留 | A2A 插件保存需校验模型；仅此 1 处；A-18 |
| E10 | §2.4 / R-13 | **7 条残余弱边** | 本期保留 | 入口 `dependencies` 声明；禁止新增 source→target 对；计数 ≤ R-07 后预期值；A-18 |
| E11 | R-07E | `dxt ↔ servers` 2 文件、2 条 value 边、模块内运行期环 | 本期保留（默认）；Q8 可消除 | §8.4 完整模板（**判据两相化**）；A-17 |
| E12 | R-13 | 模块级 SCC-1 + bootstrap facade 枢纽环 | 本期保留；不承诺模块级 DAG | §8.4 完整模板；A-18 |

**E10 的 7 条残余弱边（逐条冻结）：**

| # | 源 → 目标 | 证据（`file:line`，B0 路径） | lines | 反向 lines（R-07 后） | 模块对在 SCC-1？ |
| --- | --- | --- | --- | --- | --- |
| 1 | mcpIntegration → mediaGeneration | `utils/mcp/operations.ts:4` → `@/utils/media/provider` | 1 | 0 | 否 |
| 2 | mcpIntegration → localRuntime | `utils/mcp/control.ts:5` → `@/utils/mobileLink`；`utils/mcp/dxt.ts:11`、`utils/mcp/tools.ts:14` → `@/utils/workspace/files` | 3 | 0 | 否 |
| 3 | assetLibrary → mediaGeneration | `utils/assets/thumb.ts:6` → `@/utils/ffmpeg` | 1 | 0 | 是 |
| 4 | localRuntime → mediaGeneration | `routes/workspaces/files/thumb.ts:11` → `@/utils/ffmpeg` | 1 | 4 | 是（双向） |
| 5 | platformCore → localRuntime | `utils/personalization.ts:6` → `@/utils/workspace/files`（R-07D 后仅剩此 value） | 1 | **76** | 是（双向） |
| 6 | platformCore → mediaGeneration | `routes/settings/save.ts:8` → `@/utils/ai` | 1 | 63 | 是（双向） |
| 7 | agentAccess → pluginMarket | `utils/singleAgent/index.ts:12` → `@/utils/plugins/tools` | 1 | 0 | 否 |

> 表中 `file:line` 为 B0 路径；**PH-F 复核时必须按 §1.6.2 SPEC 映射替换路径**，说明符用联合模式（例：`from "@/(utils/plugins|modules/pluginMarket/plugins)/tools"`）。

### 8.3 豁免说明模板（每条必填）

```text
豁免编号：EX-<模块>-<序号>
关联需求：R-xx
问题描述：<一句话说明未消除的结构问题，含行数/文件数>
尝试过的方案：<方案 A 结果、方案 B 结果>
豁免理由：<对应 §8.1 的哪一条，附量化依据>
影响范围：<文件数/端点数/宿主>
替代缓解：<可执行的约束或校验手段，写明如何评审>
可执行判据：<grep 命令（含 phase）+ 计数上限 + SCC 输出>
复核触发条件：<例如 "AgentHost 落地后"、"单文件 > 800 行时"、"新增第 3 类插件类型时">
有效期：<本次发布 / 至下个架构评审周期>
责任人：
评审结论：□ 同意  □ 驳回（理由：____）
```

### 8.4 E11 / E12 填表（可直接勾选）

#### E11：`dxt ↔ servers` 模块内环

```text
豁免编号：EX-mcp-01
关联需求：R-07E
问题描述：utils/mcp/dxt.ts 与 utils/mcp/servers.ts 互相 import，2 文件、2 条 value 边，构成 2 文件 SCC；R-04 后同属 mcpIntegration。
尝试过的方案：
  A. 保留 + 登记（本版默认）：0 新文件，L2=9、L3=246。
  B. 提取 bundleRoot/removeBundleDirectory/removeMcpBundle 到 modules/mcpIntegration/bundle.ts：
     可消除，但新增 1 文件、迁移安全路径校验，L2=10、L3=247、lines +30。
豁免理由：§8.1 第 2 条（成本大于收益）与第 4 条（语义同源）。该环在模块内部，不影响 237 文件
  god module 的拆分与子模块边界；消除不改变模块级 SCC（E12 仍在），却增加安全路径校验的迁移风险。
影响范围：2 文件、0 端点、0 个 @toonflow/server export、1 个模块（mcpIntegration）。
替代缓解：
  1) 两条 import 冻结为基线，禁止新增第 3 条，禁止改为相对路径（Q11 形态冻结）；
  2) 每次 M2/M3/M6 运行 file 级 SCC 审计：scc_count=1、scc_size=2、成员恰为 dxt.ts/servers.ts；
  3) 地图若标记 circular_dep，按本条注明“模块内 2 文件环”，不视为拆分失败。
可执行判据（两相，必须成对出现；命令见 §A.7）：
  PH-B0  e1: dxt.ts    中 from "@/(utils/mcp|modules/mcpIntegration/mcp)/servers"   → 1
  PH-B0  e2: servers.ts 中 from "@/(utils/mcp|modules/mcpIntegration/mcp)/dxt"      → 1
  PH-F   e3: 同上（FINAL 路径 src/modules/mcpIntegration/mcp/dxt.ts）              → 1
  PH-F   e4: 同上（FINAL 路径 src/modules/mcpIntegration/mcp/servers.ts）          → 1
  PH-F   e5: 两文件 grep -cE 'from "\.{1,2}/'                                      → 0
  PH-F   e6: file 级 SCC 审计 scc_count=1, scc_size=2                              → PASS
  Q8 消除时：e1–e4 期望 0、e6 期望 scc_count=0、L2=10/L3=247。
复核触发条件：MCP bundle 逻辑重构、mcpIntegration 再拆分、单文件 > 800 行、新增第 3 类 MCP bundle 来源。
有效期：本次发布 / 至下个架构评审周期。
责任人：待指派（实施负责人）。
评审结论：□ 同意  □ 驳回（理由：____）
```

#### E12：模块级 SCC 与 bootstrap 枢纽环

```text
豁免编号：EX-scc-01
关联需求：R-13
问题描述：直接边口径下，assetLibrary/localRuntime/mediaGeneration/platformCore/pluginMarket 形成 5 模块
  SCC-1；含 bootstrap facade 时 8 模块全在一个 SCC。R-07D 只消除 2 条 type 边，不消除 SCC-1。
尝试过的方案：
  A. 只做边级消除（本版默认）：R-07D 消 conf→teams/mobileLink；E10 冻结 7 条弱边；不承诺 DAG。
  B. 消除 SCC-1：需把 personalization、settings 刷新、asset/media/local 的多条双向边全部端口化，
     等同 AgentHost/contracts 级重构，超出本需求。
豁免理由：§8.1 第 2 条（成本大于收益）与第 3 条（依赖未就绪）。c-server-api-1 的验收是
  “237 文件 god module 消除 + 子模块边界/预算”，不是“模块级无环”。
影响范围：5 个域模块 + bootstrap；0 端点；不改变 HTTP 契约。
替代缓解：
  1) 每个模块入口声明 dependencies 白名单；实际直接边计数 ≤ 附录 C 的 R-07 后预期值；
  2) E10 7 条弱边逐条冻结，禁止新增 source→target 对；
  3) 不把“模块级 DAG”写入任何验收项；A-18 只查“不新增/不超 R-07 后预期值”。
可执行判据（PH-F）：
  §A.6 SCC 审计输出 scc1={assetLibrary,localRuntime,mediaGeneration,platformCore,pluginMarket}、
  scc2={agentAccess}、scc3={mcpIntegration}；§A.11 输出 20 条边计数 = §2.4 的 R-07 后预期值。
复核触发条件：AgentHost 端口化立项、contracts 包落地、E10 任一边被要求消除。
有效期：本次发布 / 至下个架构评审周期。
责任人：待指派（实施负责人）。
评审结论：□ 同意  □ 驳回（理由：____）
```

---

## 9. 实施顺序与里程碑（评审通过后执行）

| 阶段 | 内容 | 出口条件（可判定） |
| --- | --- | --- |
| **M0** | 冻结基线：HEAD、187 端点、161 挂载、typecheck/build、14 exports、13 项 + S1–S8 fixture、归一化规则、**判据两相命令的 B0 试跑结果**（a1/b1/b2/c1–c3/d1/d2/e1/e2，用于 G-POS 可达性）与 **步骤 5 的 B0 原始语句快照**（`app.ts:88` 一行，供 A-25 对照） | 5 份基线 + 1 份 B0 判据试跑归档（供 A-27 的 G-POS 使用） |
| **M1** | R-01 + R-02 + R-03 + R-08：7 个入口、`app.ts` 瘦身、初始化归口（含步骤 5 语义）、宿主兼容 | A-06～A-10、**A-25、A-26**、A-21 通过；`app.ts` ≤80；typecheck 通过；三宿主可启动 |
| **M2** | R-04：`utils/<域>` 迁入 `src/modules/<模块>`；`documents.ts`/`fileHttp.ts` 随迁；`u` facade 保持；**说明符前缀替换、形态不变** | A-01/A-02/A-03 通过；L1=237、L2=9、L3=246；246 深路径迁移；187 端点 diff 为空；`conf` 层深已校正 |
| **M3** | R-07 + R-07E + **R-14**：A 消除、B/C 契约化、D 2 条 type 边归零；E11 登记（或 Q8 消除）；判据按两相执行 | A-13～A-17 **两相证据齐全**（B0 + F）；**A-27 `doc_audit=PASS`**；file SCC 默认仅 dxt/servers（或 0） |
| **M4** | Q2/R-05 决策：默认 E4；若 C，改造 `core.ts` | Q2 记录；E4：161 挂载；C：23 挂载 + 187 端点 diff 为空；无新增路由文件 |
| **M5** | R-06 + R-09 + R-11 + R-12 + R-13 + 13 项/S1–S8 冒烟 | A-18/A-20/A-22/A-23 通过；37 key；地图 246 文件 / ≤14,839 行；E10/E12 完整 |
| **M6** | 交付审查：A-01～A-27 逐项勾选（含 Phase 证据）；地图重新切分申请 | 全部 PASS；§11 评审签署；无清单外文件/依赖/测试/判据脚本 |

**回滚规则：**

- M2/M3 任一阶段 187 端点 diff 非空 → 立即回滚该阶段；
- L3 超预算（业务 >50 / 交付 >55 / 行数 >3,300）→ 回滚 L2 或缩小入口实现，不得删业务文件凑数；
- M3 出现 E11 之外的新 file 级环 → 回滚 R-07 变更并重新评审；
- **任一 A 项在 PH-F 出现 `vacuous_zero` / `path_missing` / `reachability_miss` → 该阶段判据无效，必须修判据后重跑**（不得以“看起来没问题”放行）；
- M5 冒烟 diff 非空且无法归一化解释 → 回滚最近一个语义变更。

---

## 10. 待评审决策点（Q1–Q11，均有默认值）

> 规则：评审在 §11 记录结论；**未记录时按默认值执行**，不得以“看情况”替代。

| 编号 | 决策点 | 选项 | 默认值 | 影响 |
| --- | --- | --- | --- | --- |
| Q1 | 拆分深度 | A 仅清单化 / **B 服务模块化 + 路由保留** / C 全量目录化 | **B** | B：URL 零风险；C：R-05 高风险 |
| Q2 | 是否改造 `core.ts` 路由生成器 | **E4 保留 161 挂载** / C 改为 23 个域 Router | **E4** | C 需 M4 独立评审 |
| Q3 | `utils.ts` 存废 | **保留 37 key 分组 facade** / 改 145 个调用点 | **保留** | 改调用点扩大 145 文件改动面 |
| Q4 | NG1 边界 | **只消除 4 处 mentionSources，19 处运行期保留** / 要求整体 AgentHost | **前者** | 后者属独立需求 |
| Q5 | R-07 B/C 的“公开契约”判定 | **公开入口 + 禁止深路径即算处理** / 要求物理下沉 | **前者** | 后者可能突破文件预算 |
| Q6 | 文件预算 | **业务 ≤50 / 交付 ≤55 / ≤3,300 行** / 单层 ≤52 | **双层** | 单层会迫使削业务文件或隐藏契约 |
| Q7 | 13 项冒烟判据 | **改动前后 diff 为空（归一化）** / 固定 200 | **diff 为空** | 适配无供应商/无桌面环境 |
| Q8 | dxt↔servers | **E11 保留（0 新文件，L2=9/L3=246）** / 提取 `bundle.ts` 消除（L2=10/L3=247） | **E11** | 消除需 +1 文件与安全路径迁移审查 |
| Q9 | L2 口径 | **固定 9 个新文件** / 允许复用既有 `index.ts` 作为入口 | **固定 9** | 复用会让入口路径不统一 |
| Q10 | 模块级 SCC | **接受 E12（不承诺 DAG）** / 要求本期消除 SCC-1 | **接受 E12** | 后者等同 AgentHost 级重构 |
| **Q11** | **边判据的说明符形态** | **冻结为 `@/modules/...` alias（只换前缀，禁改相对路径）** / 允许迁移时顺手改为相对路径 | **冻结 alias** | 允许相对路径会使 A-13～A-17 的 grep 判据失效，需改判据为纯解析式（成本更高） |

---

## 11. 评审意见栏

> 待评审人填写。可逐条对 R-01～R-14（含 R-07E）、Q1～Q11、E1～E12、A-01～A-27 给出结论。
> 第 4 版特别请评审确认：**§0.1 的三条打回处置是否到位**、**§0.2 的两处自查纠正是否成立**、**§6.7 的分期与守卫规则是否足够**。

| 评审人 | 日期 | 结论（通过 / 有条件通过 / 驳回） | 意见 |
| --- | --- | --- | --- |
|  |  |  |  |
|  |  |  |  |
|  |  |  |  |

**Q1–Q11 决策记录（未填按默认值执行）：**

| 编号 | 评审选择 | 备注 |
| --- | --- | --- |
| Q1 |  |  |
| Q2 |  |  |
| Q3 |  |  |
| Q4 |  |  |
| Q5 |  |  |
| Q6 |  |  |
| Q7 |  |  |
| Q8 |  |  |
| Q9 |  |  |
| Q10 |  |  |
| Q11 |  |  |

**E1–E12 勾选：**

| 编号 | 同意 | 驳回 | 驳回理由 |
| --- | --- | --- | --- |
| E1 | ☐ | ☐ |  |
| E2 | ☐ | ☐ |  |
| E3 | ☐ | ☐ |  |
| E4 | ☐ | ☐ |  |
| E5 | ☐ | ☐ |  |
| E6 | ☐ | ☐ |  |
| E7 | ☐ | ☐ |  |
| E8 | ☐ | ☐ |  |
| E9 | ☐ | ☐ |  |
| E10 | ☐ | ☐ |  |
| E11 | ☐ | ☐ |  |
| E12 | ☐ | ☐ |  |

**§0.1 打回处置确认：**

| # | 打回意见 | 是否认可以本版处置关闭 | 意见 |
| --- | --- | --- | --- |
| 1 | A-14/15/17 的 grep 说明符与期望可达性 | ☐ 认可 ☐ 不认可 |  |
| 2 | R-03 步骤 5 非阻塞吞错语义 | ☐ 认可 ☐ 不认可 |  |
| 3 | （自查）§0.2 两处基线纠正 | ☐ 认可 ☐ 不认可 |  |

**自由意见区**

```text
（留空，待评审填写）
```

---

## 附录 A：本次核验所用只读命令（可复现）

> 所有命令在仓库根目录执行；只读，不修改业务文件。本机 PATH 无 `bun`，涉及 `bun` 的判据在实施环境（M0/M1/M6）执行并归档输出。
> **本文档的命令一律按 §1.6 分期**：涉及 `@/utils/` 说明符的命令只用于 `PH-B0`，涉及判定的用 `PH-F` 且使用联合模式。

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
# 期望：237 14349
```

### A.2 路由与端点基线（PH-B0 + PH-F 均适用，`routes/` 不移动）

```bash
find apps/server/src/routes -name '*.ts' | wc -l                       # 161
grep -rhoE '\.(get|post|put|patch|delete|all)\(' apps/server/src/routes | sort | uniq -c
# 合计 187：GET 67 / POST 79 / PUT 20 / DELETE 11 / ALL 8 / PATCH 2
grep -c 'app.use' apps/server/src/router.ts                            # 161
```

### A.3 聚合入口与深路径

```bash
# PH-B0
grep -rl 'from "@/utils"' apps/server/src --include='*.ts' | wc -l              # 145
grep -rl 'from "@/utils"' apps/server/src/routes --include='*.ts' | wc -l       # 144
grep -rho 'from "@/utils/[a-zA-Z]*' apps/server/src --include='*.ts' | wc -l    # 246

# PH-F（联合模式；`@/utils` 的 facade 调用面应保持 145）
grep -rlE 'from "@/(utils|modules)' apps/server/src --include='*.ts' | wc -l
grep -rhoE 'from "@/modules/[a-zA-Z]*' apps/server/src --include='*.ts' | wc -l # 246
```

### A.4 环的两端（两相）

```bash
# PH-B0
grep -rn 'from "@/agent' apps/server/src --include='*.ts' | grep -v '^apps/server/src/agent/' | wc -l   # 23
grep -rn 'from "@/utils' apps/server/src/agent --include='*.ts' | wc -l                                 # 51
grep -rn 'from "@/lib\|from "@/types' apps/server/src/agent --include='*.ts' | wc -l                    # 20

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
# 14 exports
grep -rl '@toonflow/server/' --include='*.ts' --include='*.vue' apps packages compat 2>/dev/null | grep -v node_modules | wc -l  # 36
grep -rho '@toonflow/server/[a-zA-Z0-9/_-]*' --include='*.ts' --include='*.vue' apps packages compat 2>/dev/null | grep -v node_modules | wc -l  # 57
```

### A.6 file 级 SCC 审计（两相；解析式，不依赖说明符形态）

> 用途：A-17 的 `e6`、A-18 的环判定。别名 `@/*` → `apps/server/src/*`（`apps/server/tsconfig.json`）。`--sim` 模拟 R-07D（跳过 `conf → teams/mobileLink`）。

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
# PH-B0 期望：files=237 scc_count=2（size 15 + size 2）
# PH-B0 --sim 期望：scc_count=1（size 2）
# PH-F 期望：scc_count=1（size 2，成员 modules/mcpIntegration/mcp/{dxt,servers}.ts）；Q8 消除时 scc_count=0
```

### A.7 R-07 / R-03 判据（两相 + 三守卫；本附录是第 3 轮打回 #1/#2 的正式修复）

#### A.7.0 判据工具（不落库；在 bash heredoc 中执行，输出粘贴进 M3/M6 证据日志）

```bash
edge_check() { # edge_check <label> <phase> <expect> <ERE> <path>...
  local label=$1 phase=$2 expect=$3 ere=$4; shift 4
  local miss=0 s=0 n=0 verdict=FAIL
  for p in "$@"; do [ -e "$p" ] || { miss=1; echo "  missing=$p"; }; done
  if [ "$miss" -eq 0 ]; then
    s=$(find "$@" -name '*.ts' | wc -l | tr -d ' ')
    n=$(find "$@" -name '*.ts' -print0 | xargs -0 -I{} grep -hE -- "$ere" {} 2>/dev/null | wc -l | tr -d ' ')
  fi
  if [ "$miss" -eq 0 ] && [ "$s" -ge 1 ] && [ "$n" -eq "$expect" ]; then verdict=PASS; fi
  printf 'check=%-4s phase=%-2s expect=%-3s scope_files=%-4s hits=%-3s verdict=%s\n' "$label" "$phase" "$expect" "$s" "$n" "$verdict"
}

edge_lines() { local ere=$1; shift; find "$@" -name '*.ts' -print0 | xargs -0 -I{} grep -nHE -- "$ere" {} 2>/dev/null; }

file_count() { # file_count <label> <expect> <ERE> <file>
  local label=$1 expect=$2 ere=$3 f=$4 s=0 n=0 verdict=FAIL
  if [ -f "$f" ]; then s=1; n=$(grep -cE -- "$ere" "$f" | tr -d ' '); fi
  [ "$s" -eq 1 ] && [ "$n" -eq "$expect" ] && verdict=PASS
  printf 'check=%-4s phase=F  expect=%-3s scope_files=%-4s hits=%-3s verdict=%s\n' "$label" "$expect" "$s" "$n" "$verdict"
}
```

> 守卫语义：`edge_check` 在路径缺失时输出 `missing=...` 且 `verdict=FAIL`（**G-EXIST**）；`scope_files` 为 0 时一律 FAIL（**G-MATCH**）；`expect > 0` 的调用必须同时给出 PH-B0 的同 label 试跑（**G-POS**，见 A.7.8 对照表）。

#### A.7.1 边 A（R-07A）：mentionSources 归零

```bash
# a1 PH-B0：基线 4 行（可达性证明，G-POS）
edge_lines 'from "@/agent/mentionSources"' \
  apps/server/src/utils/assets apps/server/src/routes/assets apps/server/src/routes/workspaces
edge_check a1 B0 4 'from "@/agent/mentionSources"' \
  apps/server/src/utils/assets apps/server/src/routes/assets apps/server/src/routes/workspaces
# 期望 a1: expect=4 scope_files=41 hits=4 verdict=PASS

# a2 PH-F：判定为 0（scope 必须 ≥1，否则 vacuous_zero）
edge_check a2 F 0 'from "@/agent/mentionSources"' \
  apps/server/src/modules/assetLibrary apps/server/src/routes/assets apps/server/src/routes/workspaces
# 期望 a2: scope_files=60 hits=0 verdict=PASS

# a3 PH-F：计数迁移（server→agent 19；asset→platform 27；local→platform 76）
bash -c 'grep -rn "from \"@/agent" apps/server/src --include="*.ts" | grep -v "^apps/server/src/agent/" | wc -l'   # 19
# assetLibrary->platformCore 与 localRuntime->platformCore 的计数由附录 A.11 脚本输出核对：
#   期望 assetLibrary -> platformCore lines=27 type=1 value=26
#        localRuntime -> platformCore lines=76 type=1 value=75
```

#### A.7.2 边 B（R-07B）：`pluginMarket → mediaGeneration` 契约化

```bash
# b1 PH-B0：前向唯一 1 处（plugins/install.ts:11）
edge_check b1 B0 1 'from "@/(utils/media|modules/mediaGeneration/media)/provider"' apps/server/src/utils/plugins
# 期望 b1: scope_files=6 hits=1

# b2 PH-B0：反向基线 0（scope=32）
edge_check b2 B0 0 'from "@/(utils/plugins|modules/pluginMarket/plugins)' \
  apps/server/src/utils/media apps/server/src/routes/ai apps/server/src/routes/providers apps/server/src/routes/ffmpeg
# 期望 b2: scope_files=32 hits=0

# b3 PH-F：反向仍为 0（路径已迁移；联合模式覆盖两相说明符）
edge_check b3 F 0 'from "@/(utils/plugins|modules/pluginMarket/plugins)' \
  apps/server/src/modules/mediaGeneration/media apps/server/src/routes/ai apps/server/src/routes/providers apps/server/src/routes/ffmpeg
# 期望 b3: scope_files=32 hits=0

# b4 PH-F：前向深路径归零（旧的 media/provider 深路径不得残留）
edge_check b4 F 0 'from "@/(utils/media|modules/mediaGeneration/media)/provider"' apps/server/src/modules/pluginMarket/plugins
# 期望 b4: scope_files=6 hits=0

# b5 PH-F：公开入口 1 处（整行必须完全一致）
edge_lines 'from "@/modules/mediaGeneration"' apps/server/src/modules/pluginMarket/plugins
edge_check b5 F 1 'from "@/modules/mediaGeneration"' apps/server/src/modules/pluginMarket/plugins
# 期望 b5: scope_files=6 hits=1；且 edge_lines 输出的行必须是
#   import { addMediaProvider } from "@/modules/mediaGeneration";

# b5s PH-F：G-POS ②「符号存在」——mediaGeneration 入口必须公开 addMediaProvider
file_count b5s 1 'addMediaProvider' apps/server/src/modules/mediaGeneration/index.ts
# 期望 b5s: hits=1（`export { addMediaProvider } from "./media/provider";` 或等价具名 re-export）
```

#### A.7.3 边 C（R-07C）：`mcpIntegration → pluginMarket` 公开入口化

```bash
# c1–c3 PH-B0：三条深路径各 1（dxt.ts:9 / tools.ts:13 / resources.ts:6）
edge_check c1 B0 1 'from "@/(utils/plugins|modules/pluginMarket/plugins)/install"' apps/server/src/utils/mcp
edge_check c2 B0 1 'from "@/(utils/plugins|modules/pluginMarket/plugins)/tools"'   apps/server/src/utils/mcp
edge_check c3 B0 1 'from "@/(utils/skills|modules/pluginMarket/skills)/files"'     apps/server/src/utils/mcp
# 期望 c1=c2=c3: scope_files=7 hits=1

# c4–c6 PH-F：三条深路径归零
edge_check c4 F 0 'from "@/(utils/plugins|modules/pluginMarket/plugins)/install"' apps/server/src/modules/mcpIntegration/mcp
edge_check c5 F 0 'from "@/(utils/plugins|modules/pluginMarket/plugins)/tools"'   apps/server/src/modules/mcpIntegration/mcp
edge_check c6 F 0 'from "@/(utils/skills|modules/pluginMarket/skills)/files"'     apps/server/src/modules/mcpIntegration/mcp
# 期望 c4=c5=c6: scope_files=7 hits=0

# c7 PH-F：公开入口 3 处
edge_lines 'from "@/modules/pluginMarket"' apps/server/src/modules/mcpIntegration/mcp
edge_check c7 F 3 'from "@/modules/pluginMarket"' apps/server/src/modules/mcpIntegration/mcp
# 期望 c7: scope_files=7 hits=3

# c7s PH-F：G-POS ②「符号存在」——pluginMarket 入口必须公开三组符号
file_count c7s 3 '(decodeText|listTools|skillFiles)' apps/server/src/modules/pluginMarket/index.ts
# 期望 c7s: hits=3（三行：install 组 / tools 组 / skills namespace 组）

# c8 PH-F：调用面不变（resources 7 处 skillFile.；dxt 4 行含 decodeText/skillPath/skillZip）
file_count c8a 7 'skillFile\.' apps/server/src/modules/mcpIntegration/mcp/resources.ts
file_count c8b 4 'decodeText|skillPath|skillZip' apps/server/src/modules/mcpIntegration/mcp/dxt.ts
# 期望 c8a: hits=7；c8b: hits=4（B0 同值，见 §R-07 表）

# c9 PH-F：入口三组 re-export（逐字存在）
edge_lines 'export \* as skillFiles from "\./skills/files"' apps/server/src/modules/pluginMarket/index.ts
edge_lines 'export \{ decodeText, skillPath, skillZip \} from "\./plugins/install"' apps/server/src/modules/pluginMarket/index.ts
edge_lines 'export \{ listTools \} from "\./plugins/tools"' apps/server/src/modules/pluginMarket/index.ts
```

#### A.7.4 边 D（R-07D）：`conf` 的 2 条 type 边归零

```bash
# d1 PH-B0：conf 侧 2 条（:5 teams / :8 mobileLink）
edge_check d1 B0 2 'from "@/(utils/teams|modules/pluginMarket/teams|utils/mobileLink|modules/localRuntime/mobileLink)' apps/server/src/utils/conf
# 期望 d1: scope_files=1 hits=2

# d2 PH-B0 / d4 PH-F：反向 4 条不变
edge_check d2 B0 4 'from "@/(utils/conf|modules/platformCore/conf)' apps/server/src/utils/teams apps/server/src/utils/mobileLink
edge_check d4 F  4 'from "@/(utils/conf|modules/platformCore/conf)' apps/server/src/modules/pluginMarket/teams apps/server/src/modules/localRuntime/mobileLink
# 期望 d2: scope_files=4 hits=4；d4: scope_files=4 hits=4

# d3 PH-F：conf 侧归零
edge_check d3 F 0 'from "@/(utils/teams|modules/pluginMarket/teams|utils/mobileLink|modules/localRuntime/mobileLink)' apps/server/src/modules/platformCore/conf
# 期望 d3: scope_files=1 hits=0

# d5 PH-F：模块级三条值（附录 A.11 输出）
#   platformCore -> pluginMarket      lines=0
#   platformCore -> localRuntime      lines=1 type=0 value=1   （personalization.ts）
#   platformCore -> mediaGeneration   lines=1 type=0 value=1   （routes/settings/save.ts）
```

#### A.7.5 边 E11（R-07E）：`dxt ↔ servers`（**本条的旧判据已作废**）

```bash
# e1/e2 PH-B0：基线各 1（可达性证明；旧写法只匹配 @/utils/... 在 PH-F 必为 0）
edge_check e1 B0 1 'from "@/(utils/mcp|modules/mcpIntegration/mcp)/servers"' apps/server/src/utils/mcp/dxt.ts
edge_check e2 B0 1 'from "@/(utils/mcp|modules/mcpIntegration/mcp)/dxt"'     apps/server/src/utils/mcp/servers.ts
# 期望 e1=e2: scope_files=1 hits=1

# e3/e4 PH-F：迁移后各 1（联合模式；alias 形态冻结，见 e5）
edge_check e3 F 1 'from "@/(utils/mcp|modules/mcpIntegration/mcp)/servers"' apps/server/src/modules/mcpIntegration/mcp/dxt.ts
edge_check e4 F 1 'from "@/(utils/mcp|modules/mcpIntegration/mcp)/dxt"'     apps/server/src/modules/mcpIntegration/mcp/servers.ts
# 期望 e3=e4: scope_files=1 hits=1

# e5 PH-F：说明符形态冻结（禁止改成相对路径）
file_count e5a 0 'from "\.{1,2}/' apps/server/src/modules/mcpIntegration/mcp/dxt.ts
file_count e5b 0 'from "\.{1,2}/' apps/server/src/modules/mcpIntegration/mcp/servers.ts
# 期望 e5a=e5b: hits=0（B0 同值：utils/mcp 目录内相对 import = 0）

# e6 PH-F：file 级 SCC（解析式，主判据）
# 见附录 A.6；期望 scc_count=1、size=2、成员恰为 dxt.ts/servers.ts
```

> **对照第 3 轮打回 #1**：v3 的写法是 `grep -rn 'from "@/utils/mcp/servers"' apps/server/src/modules/mcpIntegration/mcp/dxt.ts → 1`。该命令在 PH-F 的命中恒为 0（说明符已变），因此 `=1` **不可达**。本版用 `e1`（B0，证明可达）+ `e3`（F，联合模式）成对替换，并在 A-27 用文档自审脚本看守回归。

#### A.7.6 R-03 步骤 5（缩略图预热）语义保真（A-25）

```bash
# f1 PH-F：调用点必须非阻塞（0 处 await warmup；1 处 warmup 调用）
file_count f1a 0 'await[^;]*warmup' apps/server/src/app.ts
file_count f1b 1 'warmup\('           apps/server/src/app.ts
# 期望 f1a: hits=0；f1b: hits=1

# f2 PH-F：默认数据目录 = <repo>/data（conf 层深 5→6 已校正）；显式目录生效
cd apps/server && bun -e 'const m = await import("./src/modules/platformCore/conf/index.ts"); console.log(process.env.TOONFLOW_DATA_DIR)' && cd ../..
# 期望输出：<repo>/data（不带 TOONFLOW_DATA_DIR 时）
TOONFLOW_DATA_DIR=/tmp/tf-f2 bash -c 'cd apps/server && bun -e "await import(\"./src/modules/platformCore/conf/index.ts\")"' ; ls /tmp/tf-f2/settings.json
# 注：若实施环境的 `bun -e` 不支持 ESM 顶层 await，等价的判定方式是“不带 TOONFLOW_DATA_DIR 启动任一宿主，`conf.path` 所在目录必须是 <repo>/data”，**判据不变**。
# 期望：/tmp/tf-f2/settings.json 存在，且 <repo>/data/settings.json 的 mtime 未变

# f3 PH-F：入口不新增日志；thumb 内部 warn 保留
file_count f3a 0 'console\.(warn|error|log)' apps/server/src/modules/assetLibrary/index.ts
file_count f3b 1 '缩略图清扫失败'           apps/server/src/modules/assetLibrary/assets/thumb.ts
# 期望 f3a: hits=0；f3b: hits=1

# f4 PH-F：故障注入（只读数据目录）——createApp 仍 resolve，无未捕获异常
d=$(mktemp -d); chmod -R a-w "$d"
TOONFLOW_DATA_DIR="$d" bash -c 'cd apps/server && bun -e "
process.on(\"unhandledRejection\", e => { console.error(\"UNHANDLED\", e); process.exit(9); });
const { createApp } = await import(\"./src/app.ts\");
await createApp({ webRoot: \"$PWD/public\", dataDirectory: process.env.TOONFLOW_DATA_DIR });
console.log(\"createApp-resolved\");"'
# 期望：输出 createApp-resolved，进程退出码 0，无 UNHANDLED

# f5 PH-F：幂等（重复 createApp 不重复安装）
# 取 <data>/providers/initialized 的 mtime 与内容，连续两次 createApp 后保持不变
# 期望：mtime 不变、内容不变
```

#### A.7.7 初始化 15 步阻塞性 / 错误语义（A-26）

```bash
# g1：步骤 9 为 void + warn（1 处）
file_count g1 1 'void [^;]*refreshModels|void mediaGeneration\.refreshModels' apps/server/src/app.ts
edge_lines 'refreshModels' apps/server/src/app.ts      # 该行必须含 console.warn

# g2：步骤 5 的调用行不得出现 console.*
edge_lines 'warmup' apps/server/src/app.ts             # 输出行中不得含 console.

# g3：步骤 1–8 中除 warmup 外必须 await（7 处）
file_count g3 7 'await (pluginMarket|mediaGeneration)\.' apps/server/src/app.ts

# g4：步骤 11/12 的动态 import 形态保留
file_count g4a 1 'await import\("@/agent/a2a"\)' apps/server/src/modules/agentAccess/index.ts
printf 'check=g4b phase=F  expect=4  hits=%s\n' "$(grep -o 'import(' apps/server/src/modules/mcpIntegration/index.ts | wc -l | tr -d ' ')"
# g4b 期望 hits=4（`@toonflow/mcp`、`mcp/tools`、`mcp/control`、`mcp/resources` 四个动态 import，可写在同一 Promise.all 行内）

# g5：步骤 8 的锚点（builtinPlugins 赋值在 express() 之后、开发分支之前）
edge_lines 'const app = express\(\)|app\.locals\.builtinPlugins|getRuntimePlatform\(\)\.development' apps/server/src/app.ts
# 期望行号顺序：express() < builtinPlugins < development

# g6：步骤 4 的 ENOENT 容错与供应商哈希保留（B0 在 app.ts:77-85，迁移后归 mediaGeneration 入口）
file_count g6a 1 'Buffer\.alloc\(0\)' apps/server/src/modules/mediaGeneration/index.ts
file_count g6b 1 'createHash\("sha256"\)' apps/server/src/modules/mediaGeneration/index.ts
```

#### A.7.8 判据对照表（label → phase → 期望 → 证据）

| label | phase | 期望 | 说明 / 证据 |
| --- | --- | --- | --- |
| a1 | B0 | 4 | `assets/index.ts:5`、`assets/library.ts:5`、`assets/thumb.ts:4`、`workspaces/files/thumb.ts:10` |
| a2 | F | 0 | scope 60；A-13 |
| a3 | F | 19 / 27 / 76 | A-13；由 A.11 脚本核对 |
| b1 | B0 | 1 | `plugins/install.ts:11` |
| b2 | B0 | 0 | scope 32 |
| b3 | F | 0 | A-14（**原 v3 假通过点**） |
| b4 | F | 0 | A-14 |
| b5 | F | 1 | 必须为 `import { addMediaProvider } from "@/modules/mediaGeneration";` |
| c1–c3 | B0 | 1/1/1 | `dxt.ts:9`、`tools.ts:13`、`resources.ts:6` |
| c4–c6 | F | 0/0/0 | A-15（**原 v3 假通过点**） |
| c7 | F | 3 | 公开入口 3 行 |
| b5s / c7s | F | 1 / 3 | G-POS ②：入口符号存在性（新入口无 B0 对应） |
| c8a/c8b | F | 7 / 4 | 调用面不变 |
| c9 | F | 3 行逐字存在 | 入口 re-export |
| d1 | B0 | 2 | `conf/index.ts:5`、`:8` |
| d2 | B0 | 4 | 反向 value |
| d3 | F | 0 | A-16 |
| d4 | F | 4 | 反向 value 不变 |
| d5 | F | 0 / 1 / 1 | A.11 输出 |
| e1/e2 | B0 | 1 / 1 | `dxt.ts:10`、`servers.ts:8` |
| e3/e4 | F | 1 / 1 | A-17（**原 v3 不可达点**） |
| e5a/e5b | F | 0 / 0 | 形态冻结 |
| e6 | F | `scc_count=1,size=2` | A.6 |
| f1a/f1b | F | 0 / 1 | 步骤 5 非阻塞 |
| f2 | F | `<repo>/data` | 层深校正 + 动态 import 边界 |
| f3a/f3b | F | 0 / 1 | 静默吞错（入口无日志、内部 warn 保留） |
| f4 | F | 输出 `createApp-resolved` | 故障注入不阻断 |
| f5 | F | mtime/内容不变 | 幂等 |
| g1–g6 | F | 见 A.7.7 | 15 步语义矩阵（B0 语义基准见 §R-03 表与 §6.8，不在交付态重跑） |

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
# build/server 产物启动验证
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

> 用途：把 import 行按“模块归属 + type/value”聚合，输出 20 条直接边。**两相通用**（只依赖当前工作树的路径与 §3.3 L1 glob；PH-F 时 `src/utils/**` 已不存在，脚本会自动落到 `src/modules/**` 的说明符解析）。
> 实测（B0）：与 §2.4 表逐行一致；`unowned_files=0`；agent 边 8/3/5/1/2/3/1（合计 23）。

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

### A.12 判据自审脚本（A-27；文档级，无需实施完成即可运行）

> 用途：机械发现三类回归——① 验收行缺 Phase 标注；② PH-F 命令块使用迁移前说明符；③ 命令块使用 B0 说明符却未标注 PH-B0（即第 3 轮打回 #1/#2 的两类失效）。

```bash
python3 - <<'PY'
import re, sys
DOC = ".easyvibe/development_docs/liyuhang/1_requirements_matrix/2026-10-26-22-25-serverApiSubmoduleSplit-v4.md"
lines = open(DOC, encoding="utf-8").read().splitlines()

# 规则 1：A 行必须有 Phase 标注（| B0 | / | F | / | B0+F |）
rows, untagged = 0, []
for ln in lines:
    norm = ln.replace("*", "")
    if re.match(r'^\|\s*A-\d\d\s*\|', norm):
        rows += 1
        if not any(p in norm for p in ("| B0 |", "| F |", "| B0+F |")):
            untagged.append(ln[:70])

# 规则 2/3：命令块内的说明符必须与 phase 一致
#（B0 说明符字面量做拼接，避免脚本自身文本被规则命中）
SPEC_B0 = 'from "@' + '/utils/'
phase, stale, unlabeled, in_fence = None, [], [], False
for ln in lines:
    if ln.startswith("```"):
        in_fence = not in_fence
        phase = None
        continue
    if "PH-B0" in ln: phase = "B0"
    elif "PH-F" in ln: phase = "F"
    if not in_fence: continue
    if phase == "F" and SPEC_B0 in ln: stale.append(ln.strip()[:90])
    if phase is None and SPEC_B0 in ln: unlabeled.append(ln.strip()[:90])

print(f"criteria_total={rows}")
print(f"criteria_phase_tagged={rows - len(untagged)}")
print(f"stale_specifier_in_PHF={len(stale)}")
print(f"unlabeled_utils_command={len(unlabeled)}")
for x in untagged: print("  untagged:", x)
for x in stale: print("  stale:", x)
for x in unlabeled: print("  unlabeled:", x)
ok = rows == 27 and not untagged and not stale and not unlabeled
print("doc_audit=" + ("PASS" if ok else "FAIL"))
sys.exit(0 if ok else 1)
PY
# 本文档实测（2026-10-26 22:30）：criteria_total=27 criteria_phase_tagged=27
#   stale_specifier_in_PHF=0 unlabeled_utils_command=0 doc_audit=PASS
# 非空转验证 1（把 DOC 换成第 3 版文档执行同一脚本）：criteria_total=24 criteria_phase_tagged=0 → doc_audit=FAIL
# 非空转验证 2（在本文档副本中注入 v3 的两类写法，注入样本用「B0 说明符 + FINAL 路径」描述）：
#   样本 1：B0 说明符 @/utils/plugins + FINAL 路径 modules/mediaGeneration/media，放在 PH-F 块内 → stale_specifier_in_PHF=1
#   样本 2：B0 说明符 @/utils/mcp/servers + FINAL 路径 modules/mcpIntegration/mcp/dxt.ts，放在未标注块内 → unlabeled_utils_command=1
#   两者同时导致 doc_audit=FAIL，说明规则 2/3 分别覆盖“假通过”与“不可达”两类失效。
```

> 说明：本脚本覆盖“文档层”的三类失效；`missing_path_guard` / `vacuous_zero` / `reachability_miss` 由 §A.7.0 的 `edge_check` 在运行时输出（`missing=...`、`scope_files=0`、缺 B0 试跑），二者合并构成 A-27 的完整证据。

---

## 附录 B：与第 3 版的关键差异

| 项 | 第 3 版 | 第 4 版 |
| --- | --- | --- |
| 判据分期 | 无；B0 说明符与 FINAL 路径混用（A-14/A-15 假通过、A-17 不可达） | PH-B0 / PH-F 两相；每条判据标注 phase（A-27 机械校验） |
| 说明符 | 迁移前后混用 | SPEC 映射表（§1.6.2）+ 联合模式 + 形态冻结（Q11） |
| 0 命中判据 | 直接判 PASS | `edge_check` 强制 `scope_files ≥ 1`，路径缺失即 FAIL |
| >0 期望 | 无可达性证明 | 必须成对给出 PH-B0 同 label 试跑（A.7.8 对照表） |
| R-03 | 15 步 4 列（序/调用/归属/说明） | **7 列**（+B0 行号 / 阻塞性 / 错误语义）；步骤 5 静默吞错显式化 |
| 步骤 8 锚点 | “1–8 都在 `express()` 之前”（与代码不符、不可实现） | 1–7 在 `express()` 前；8 在 `app.locals.appVersion` 之后（§0.2 S2） |
| file SCC | “13 文件” | **15 文件**（§0.2 S1）+ 可复现脚本 |
| 验收项 | A-01～A-24 | A-01～A-27（+A-25 步骤 5、+A-26 15 步语义、+A-27 判据自审） |
| 风险 | R1–R15 | +R16 判据假通过、+R17 吞错语义被统一化、+R18 说明符形态漂移 |
| 决策点 | Q1–Q10 | Q1–Q11（+Q11 说明符形态冻结） |
| 文档自审 | 无 | §A.12 脚本 + 实测/非空转结果 |

---

## 附录 C：直接边矩阵、模块 SCC、file SCC

### C.1 直接域边基线（20 条；与 §2.4 一致）

| # | 源 → 目标 | lines | type | value | 反向 lines | 本期分类 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | agentAccess → platformCore | 51 | 1 | 50 | 0 | 强依赖 |
| 2 | agentAccess → pluginMarket | 1 | 0 | 1 | 0 | E10 |
| 3 | assetLibrary → localRuntime | 8 | 0 | 8 | 3 | 强依赖 |
| 4 | assetLibrary → mediaGeneration | 1 | 0 | 1 | 0 | E10 |
| 5 | assetLibrary → platformCore | 24 | 0 | 24 | 0 | 强依赖；R-07A 后 27（1t/26v） |
| 6 | localRuntime → assetLibrary | 3 | 0 | 3 | 8 | 强依赖 |
| 7 | localRuntime → mediaGeneration | 1 | 0 | 1 | 4 | E10 |
| 8 | localRuntime → platformCore | 75 | 1 | 74 | 2 | 强依赖；R-07A 后 76（1t/75v） |
| 9 | mcpIntegration → localRuntime | 3 | 0 | 3 | 0 | E10 |
| 10 | mcpIntegration → mediaGeneration | 1 | 0 | 1 | 0 | E10 |
| 11 | mcpIntegration → platformCore | 35 | 0 | 35 | 0 | 强依赖 |
| 12 | mcpIntegration → pluginMarket | 3 | 0 | 3 | 0 | R-07C |
| 13 | mediaGeneration → localRuntime | 4 | 0 | 4 | 1 | 强依赖 |
| 14 | mediaGeneration → platformCore | 63 | 0 | 63 | 1 | 强依赖 |
| 15 | platformCore → localRuntime | 2 | 1 | 1 | 75 | R-07D 消 type；E10 留 1 value |
| 16 | platformCore → mediaGeneration | 1 | 0 | 1 | 63 | E10（双向） |
| 17 | platformCore → pluginMarket | 1 | 1 | 0 | 91 | R-07D 归零 |
| 18 | pluginMarket → localRuntime | 6 | 0 | 6 | 0 | 强依赖 |
| 19 | pluginMarket → mediaGeneration | 1 | 0 | 1 | 0 | R-07B |
| 20 | pluginMarket → platformCore | 91 | 1 | 90 | 1 | 强依赖 |

> 复现：附录 A.11 脚本（B0 实测输出与本表逐行一致；`unowned_files=0`）。

### C.2 模块 SCC

| SCC | 成员 | 本期处理 |
| --- | --- | --- |
| SCC-1 | assetLibrary、localRuntime、mediaGeneration、platformCore、pluginMarket | E12；不承诺消除 |
| SCC-2 | agentAccess | 无入边/单点；依赖白名单 |
| SCC-3 | mcpIntegration | 无入边/单点；依赖白名单 |
| 含 bootstrap | 8 个模块 | E12；facade 枢纽环 |

### C.3 file SCC（本版按 15 文件更正）

| 时点 | 数量 | 成员 | 说明 |
| --- | --- | --- | --- |
| B0 | 2 | 15 文件跨模块 SCC（§2.4 逐文件列出）；2 文件 `dxt ↔ servers` | 15 文件 SCC 的回边是 `conf → teams`、`conf → mobileLink` 两条 type 边 |
| R-07D 后（`--sim` 实测） | 1 | `dxt ↔ servers` | E11 |
| R-07E 后（Q8） | 0 | — | 可选；L2=10 / L3=247 |

---

## 附录 D：L2 新文件台账（9 个）

| # | 路径 | 模块 | 用途 | 行数上限 | 类别 |
| --- | --- | --- | --- | --- | --- |
| 1 | `apps/server/src/modules/assetLibrary/index.ts` | assetLibrary | 入口契约 + `warmup`（非阻塞、静默吞错） | 60 | 契约 |
| 2 | `apps/server/src/modules/mediaGeneration/index.ts` | mediaGeneration | 入口契约 + providers 初始化/模型刷新 | 60 | 契约 |
| 3 | `apps/server/src/modules/pluginMarket/index.ts` | pluginMarket | 入口契约 + 五类插件初始化/扫描 + 安装/工具内核公开面 | 60 | 契约 |
| 4 | `apps/server/src/modules/mcpIntegration/index.ts` | mcpIntegration | 入口契约 + `/mcp` 挂载 | 60 | 契约 |
| 5 | `apps/server/src/modules/localRuntime/index.ts` | localRuntime | 入口契约 + 移动互联初始化 | 60 | 契约 |
| 6 | `apps/server/src/modules/agentAccess/index.ts` | agentAccess | 入口契约 + `/a2a` 挂载（动态 import） | 60 | 契约 |
| 7 | `apps/server/src/modules/platformCore/index.ts` | platformCore | 入口契约 + 中间件/配置导出 | 60 | 契约 |
| 8 | `apps/server/src/types/module.ts` | bootstrap | `ServerModule` / `ModuleContext`（组合契约，不计域边） | 40 | 契约 |
| 9 | `apps/server/src/lib/mentionSources.ts` | platformCore | `MentionQuery` + `mentionAssetType` | 30 | 共享 |
| — | **合计** | — | — | **490** | — |

---

## 附录 E：覆盖度追溯（来源 → 问题 → 需求 → 验收 → 证据）

| 来源 | 问题 | 需求 | 验收 | 证据 |
| --- | --- | --- | --- | --- |
| `c-server-api-1` | 237 文件 / 14,349 行 / 161 路由 / 187 端点 god module | R-01～R-06、R-12、R-13 | A-01～A-11、A-18 | L3 表、地图 8 模块 |
| 第 2 轮打回 #1 | 237/237 与 +2 矛盾 | R-12 | A-01～A-05 | L1/L2/L3 输出 |
| 第 2 轮打回 #2 | R-07D 单向与 E10 冲突 | R-07、R-13 | A-13～A-18 | 边矩阵、SCC、E10/E12 |
| 第 2 轮打回 #3 | dxt↔servers 未登记正确豁免 | R-07E | A-17 | E11 完整模板、file SCC |
| 第 2 轮打回 #4 | 验收不可判定 | §6.5、§6.6、Q1–Q10 | A-01～A-24 | 二值判定表、默认值 |
| **第 3 轮打回 #1** | **A-17 grep 用迁移前说明符，期望 1 不可达** | **R-14 + R-07E** | **A-17（e1–e6）、A-27** | §1.6、§A.7.5、§A.7.8 |
| **第 3 轮打回 #2** | **A-14/A-15 grep 用迁移前说明符，会假通过** | **R-14** | **A-14（b1–b5）、A-15（c1–c9）、A-27** | §1.6.3 三守卫、§A.7.2/A.7.3 |
| **第 3 轮打回 #3** | **R-03 步骤 5 漏记非阻塞吞错语义** | **R-03 + R-14** | **A-25（f1–f5）、A-26（g1–g6）** | §4 R-03 七列表、§6.8 |
| **自查 S1** | **file SCC 计数 13 → 15** | **R-13** | **A-18** | §0.2、§A.6 |
| **自查 S2** | **步骤 8 锚点写错（不可实现）** | **R-02 + R-03** | **A-10** | §0.2、§4 R-02 |
| P1 | 无模块契约 | R-01、R-04 | A-06、A-07 | 7 入口、routePrefixes |
| P2 | 组合根承担业务初始化 | R-02、R-03 | A-08～A-10 | 15 步顺序、app.ts ≤80 |
| P3 | utils.ts 聚合锁死闭包 | R-06 | A-12 | 37 key diff |
| P4 | 跨域依赖隐式/方向混乱 | R-07、R-07E、R-13 | A-13～A-18 | 20 条边矩阵、E10/E11/E12 |
| P5 | 161 条扁平挂载 | R-05 | A-11、A-24 | E4 默认或 Q2 C |
