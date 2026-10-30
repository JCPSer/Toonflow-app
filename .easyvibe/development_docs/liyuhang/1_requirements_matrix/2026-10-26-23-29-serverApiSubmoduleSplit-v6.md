# 需求矩阵 · server-api 应用子模块拆分（第 6 版 · 第 5 轮打回后重做）

## 0. 文档元信息

| 项 | 内容 |
| --- | --- |
| 文档编号 | **REQ-2026-10-26-06** |
| 版本 | 第 6 版（替代 REQ-2026-10-26-05） |
| 需求来源 | 架构地图模块级关注点 `c-server-api-1`（`.easyvibe/map/map.json`，`server-api.health.score = 50`，`decay_flags = [god_module, circular_dep, coupling_high]`）；全局关注点 `c-arch-1`（server↔agent 环）、`c-arch-2`（同一问题的全局视角） |
| 需求标题 | server-api 按素材库 / 媒体生成 / 插件市场 / MCP·工作区拆出应用子模块，`app.ts` 只保留组合根与路由装配 |
| 影响模块 | `server-api`（`apps/server`） |
| 需求类型 | 结构性重构（架构整改），**不改变任何业务行为** |
| 当前状态 | **待评审（第 6 版）**；本轮仅新增/更新需求文档与索引，业务代码零改动（`git status --porcelain apps/server` 为空） |
| 编写人 | 需求分析 agent（harness 规则 2.1） |
| 编写时间 | 2026-10-26 23:29 |
| 基线 | `git HEAD = d084136`；`.easyvibe/map/map.json` 生成于 `2026-10-26T21:13:59+08:00` |
| 上一版 | `2026-10-26-22-55-serverApiSubmoduleSplit-v5.md`（REQ-2026-10-26-05，**第 5 轮打回**） |
| 验收口径 | 问题消除 + 审查通过；无法消除项按 §8 结构化豁免登记；验收按 §6.5 二值判定表 + §6.7 判据规则 + §6.9 数值台账执行 |

### 0.1 第 5 轮打回意见逐条处置（本版核心修订）

| # | 打回意见（原文要点） | 根因 | 本版处置（可核对） | 落点 |
| --- | --- | --- | --- | --- |
| 1 | **f2/f4/f5 缺可执行命令（f2 悬空引用）** | ① `f2` 只写“默认数据目录 = `<repo>/data`，显式目录生效（见 A.7.7 的 g 组与 §R-02 静态导入边界）”—— **g 组里没有任何数据目录判据**，属于悬空引用；② `f4`/`f5` 只写“运行时探针”四个字，没有命令、没有输入、没有期望输出 → 三条子项都无法判 PASS/FAIL | 重写 **§A.7.6** 为完整可执行探针：`f1a–f1d`（预热调用点，含 B0/F 两相）、**`f2a`（静态锚点解析）/`f2b`（显式目录运行时 + 仓库 `data/` 不被写）/`f2c`（跨模块相对路径清单）**、`f3a/f3b`、**`f4`（缓存布局损坏注入 → `createApp` 仍 resolve 且 `unhandledRejection=0`）**、**`f5`（同进程连续两次 `createApp` → 安装目录清单相等、marker 仍为 `rev1`）**；每条给出命令、期望输出与**本轮真实运行结果**（§0.5 E5–E8）。探针脚本经 heredoc 落到 `/tmp` 执行，**不落库**（§6.7 规则 5） | §A.7.6、§A.7.7、A-25、A-26、§0.5 |
| 2 | **`l2_relative` 被 4 处引用却未定义** | v5 把它当作“已知子项”写在正文，但 §A.13 脚本里没有该检查、A-28 的期望列也没有它 → 4 处引用（§1.6.2 例外、§6.7 规则 4、R18 缓解、§A.3 ③ 注）全部指向一个**不存在的检查** | 新增 **§A.13.2 `l2_relative` 定义**（子项 `lr1–lr5`，逐项命令/期望/非空转验证）+ 独立验收项 **A-29**；上述 4 处引用连同 §3.3 L2 硬规则 5 **全部改指 `§A.13.2` / `A-29`**（**4 处字面引用 + 1 处等价正文规则**；`l2_relative_defined=1`、`l2_relative_occurrences>=5` 由 §A.13 脚本机械核对） | §A.13.2、A-29、§1.6.2、§6.7、§3.3、R18、§A.3 |
| 3 | **A-25/26 的 F 相证据误指 M1** | M1 的定义是“**在 B0 上**跑一遍 A-25/A-26 的语义探针，记录改动前结果”，而 A-25/A-26 的 `Phase=F`；证据列写 M1 等于**用 B0 证据判 F 相**，且 M1 的输出按定义不可能包含 F 相文件 | 里程碑拆分为 **M1（B0 基线探针）** 与 **M7（交付态语义探针）**：A-25/A-26 的“证据位置”改为 **M7**；M1 只保留“基线对照”职责并在里程碑表写明“不得作为 F 相证据”；新增 **§1.6.6 语义探针相位规则** 与 **§A.12 规则 4**（`phase_evidence_mismatch=0` 可机械判定） | §1.6.6、§9、A-25、A-26、§A.12、§6.10 |

### 0.2 本轮自查发现（非打回意见，但直接影响可测性，一并纠正）

| # | 位置 | v5 写法 | 实测 / 纠正 | 复现命令 |
| --- | --- | --- | --- | --- |
| S1 | §A.7.6 | `file_count f1b 1 'warmup\(' apps/server/src/app.ts`（“唯一调用点”） | B0 的调用点是 **`sweepThumbnailCache`**，`warmup` 是本需求**计划新增**的入口方法名 → B0 实测 `warmup(` = **0**，该期望**不可达**。改为三行：`f1b`（B0，`sweepThumbnailCache\(` = **1**）、`f1c`（F，入口 = **1**）、`f1d`（F，`app.ts` = **0**） | `grep -cE 'warmup\(' apps/server/src/app.ts` → `0`；`grep -cE 'sweepThumbnailCache\(' apps/server/src/app.ts` → `1` |
| S2 | §A.7.6 `f2` / 新增 R-15 | 只要求“默认数据目录 = `<repo>/data`”，未说明**迁移后如何仍然成立** | **发现真实的行为漂移风险**：`conf/index.ts:11` 的默认锚点是 `resolve(import.meta.dirname, "../../../../../data")`（5 级）→ `<repo>/data`（本轮实测 `f2a=1`）。R-04 把 `utils/conf` 迁到 `modules/platformCore/conf`（**深 1 级**）后，同样 5 级只到 `apps/data` → **默认数据目录静默改变**。处置：新增 **R-15**（锚点深度补偿或稳定锚点），`f2a` 在 F 相仍须 =1；台账 **L24** | `python3` 静态解析（§A.7.6 `f2a`）；B0 实测 `anchor_match=1` |
| S3 | §A.7.6 `f4` | “只读注入下 `createApp` 仍 resolve” | **该注入方式无效**：把数据目录设为只读会让 `conf` 在**模块初始化期**写 `settings.json` 失败（`EACCES`）→ `createApp` 合法 reject，与“步骤 5 吞错”无关。本轮实测 `ERR=EACCES ... settings.json.tmp-*`。改为**缓存布局损坏注入**（`<data>/cache/thumbs` 建成普通文件）：`createApp` resolve、`unhandledRejection=0`（本轮实测通过） | §A.7.6 `f4` 的两条命令（`chmod 0555` 版保留为“已知不适用”注记） |
| S4 | §A.7.6 `f3a` | “入口 0 处 `console.*`” | B0 `app.ts` 有 **2 处** `console.*`（`:131` 步骤 9 的 `console.warn`、`:152` 错误处理的 `console.error`），F 相入口要求 0 —— 两相**不可比**。明确 `f3a` 只判 F（G-POS ②：以“入口文件存在且 `console.` = 0”为可达性），可比的对照是 `f3b`（`thumb.ts` 的 warn：B0 = F = **1**） | `grep -nE 'console\.' apps/server/src/app.ts` |
| S5 | §3.3 L2 硬规则 5 / §A.3 ③ | 只说“入口用相对路径”，未约束**入口不得 import 其它模块** | 入口一旦出现 `from "@/modules/<other>"`，§A.3 ③ 的 `103` 段会被破坏（新增行），且 A-29 无从判定。处置：`l2_relative.lr4`（入口 `cross_alias=0`）把它变成可判定量；`A.3 ③` 命令同时修正为 `--include='*.ts'`（原写法依赖 shell `globstar`，在 macOS 默认 `bash` 下会漏扫） | `§A.13.2`、`§A.3 ③` |
| S6 | §6.9 台账 / A-27/A-28 期望 | `ledger_rows=23`、`criteria_total=28` | 本轮新增 A-29 与 L24–L32 → **`criteria_total=29`、`ledger_rows=32`**；§A.12/§A.13 脚本与 §6.10 表同步更新（本轮已实跑通过） | §A.12、§A.13、§6.10 |

### 0.3 与第 5 版的关键差异

| 项 | 第 5 版 | 第 6 版 |
| --- | --- | --- |
| 语义探针（f/g 组） | `f2` 悬空引用；`f4/f5` 无命令；`f1b` 期望不可达 | §A.7.6/§A.7.7 全部可执行，**本轮真跑并贴出输出**；`f1` 拆 `f1a–f1d`、`f2` 拆 `f2a–f2c`、`f4` 改注入方式、`f5` 有可观测断言 |
| 探针相位 | M1（B0）被当作 A-25/A-26 的证据 | **M1（B0 基线）/ M7（F 相）** 分离；`phase_evidence_mismatch=0` 机械可判 |
| `l2_relative` | 4 处字面引用（+1 处等价正文规则），0 处定义 | **§A.13.2 定义 + 5 个子项 + A-29**；`l2_relative_defined=1`、`l2_relative_occurrences>=5` 由脚本核对 |
| 默认数据目录 | 只写“应等于 `<repo>/data`” | 发现**迁移深度漂移** → 新增 **R-15** + `f2a/f2b` 判据 + L24 |
| 迁移相对路径 | 未登记 | 新增 **`f2c`**（跨模块相对 import = 2）+ R-04 的“深度补偿 1 处”+ L26 |
| 验收项 | A-01～A-28 | **A-01～A-29**（+A-29 说明符形态） |
| 台账 | L01–L23 | **L01–L32** |
| 决策点 | Q1–Q11 | **Q1–Q12**（Q12：默认数据目录锚点实现方式） |
| 里程碑 | M0–M6 | **M0–M7**（M7 = F 相语义探针） |

### 0.4 覆盖度 / 可测性 / 无歧义自检

| 维度 | 本版怎么保证 | 可核对位置 |
| --- | --- | --- |
| **覆盖度** | 第 5 轮 3 条打回 + 自查 6 处 → §0.1/§0.2 逐条落到 R/A/§/Q；来源侧 `c-server-api-1`、`c-arch-1`、`c-arch-2`、AGENTS 约束、地图 228 滞后、file SCC、20 条边、21 前缀、迁移锚点/相对路径 → 全部映射 | §0.1、§0.2、附录 E |
| **可测性** | 29 条二值验收（A-01～A-29），每条含 **Phase / 命令或产物 / 期望 / 证据位置**；f/g 组探针可执行且已在本轮跑出结果；所有期望 >0 的判据均有 B0 可达性证明；§6.9 台账 32 行把每个数字绑定到命令/推导 | §6.5、§6.9、§6.7、§A.7、§A.13.2 |
| **无歧义** | 术语表 §1.5；探针相位规则 §1.6.6；SPEC 映射 §1.6.2；计数口径 §1.6.5；21 前缀 §3.6；阻塞性/错误语义两列（R-03、§6.8）；`l2_relative` 五子项 §A.13.2；Q1–Q12 全有默认值；E10/E11/E12 完整模板 | §1.5、§1.6、§3.6、§6.8、§A.13.2、§8.4、§10 |

### 0.5 本轮实测证据（B0 = `d084136`，2026-10-26 23:00–23:35 执行）

> 目的：证明 ① 基线数字在当前 HEAD 可复现；② 本轮**新增/改写的判据都可执行**（尤其是被打回的 f2/f4/f5）；③ 自查发现的漂移/不可达问题真实存在。

| # | 命令（摘要） | 实测输出 | 对应断言 |
| --- | --- | --- | --- |
| E1 | §A.1 审计脚本 | `237 14349` | L01、L02 |
| E2 | `find apps/server/src/routes -name '*.ts' \| wc -l` | `161` | L03 |
| E3 | §A.2 锚定式提取 | `POST 79 / GET 51 / PUT 20 / DELETE 10 / PATCH 2 / ALL 0 = 162` | L04 |
| E4 | `grep -rl 'from "@/utils"' apps/server/src --include='*.ts' \| wc -l` | `145` | L08 |
| E5 | §A.7.6 `f1a/f1b`（B0） | `f1a=0 f1b=1`；`grep -cE 'warmup\(' app.ts` → `0`（证明 v5 的 `f1b=1` 不可达，§0.2 S1） | L27 |
| E6 | §A.7.6 `f2a`（B0） | `anchor_rel=../../../../../data anchor_match=1` | L24 |
| E7 | §A.7.6 `f2b`（B0） | `CONF_PATH=<tmp>/data/settings.json`；仓库 `data/settings.json` md5 `2070ab2a…` **前后一致** → `f2b=1` | L28 |
| E8 | §A.7.6 `f4/f5`（B0） | `f4_resolved=1 f4_unhandled=0`；`f5_resolved=1 f5_tools_equal=1 f5_marker=rev1`；`builtin_keys=tool,node,ext,skill,agent` | L29、L30 |
| E9 | §A.7.7 `g` 组（B0 锚点） | `g1=0 g2=1 g3=1 g4=1 g4b=11 g4b0=4 g6a=1 g6b=1`；行号 `92 < 95 < 108` | L31、L32 |
| E10 | §A.7.6 `f2c`（B0） | `relative_escape=2`（`src/index.ts:3`、`utils/singleAgent/types.ts:2`） | L26 |
| E11 | `grep -rn 'from "\.\{1,2\}/' apps/server/src/utils --include='*.ts' \| wc -l` | `21`（assets 15 / teams 4 / singleAgent 2；`utils/mcp` = **0**） | L25（A-29 的形态基线） |
| E12 | §A.12 / §A.13（更新后，对本文档执行） | `criteria_total=29 criteria_phase_tagged=29 stale_specifier_in_PHF=0 phase_evidence_mismatch=0 doc_audit=PASS`；`ledger_rows=32 l2_relative_occurrences>=5 l2_relative_defined=1 probe_mismatch=0 ledger_probe=PASS` | A-27、A-28、A-29 |

> 结论：第 5 轮 3 条打回**全部有可执行命令与真实输出**；自查 S1–S4 是**判据不可执行/不可达**的同类问题，本轮一并消除（而不是留到下一轮）。

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
| `conf` 默认数据目录锚点 | `resolve(import.meta.dirname, "../../../../../data")`（5 级）→ **`<repo>/data`**（`anchor_match=1`） | §A.7.6 `f2a`、L24 |
| 跨模块相对路径 import（非 agent） | **2 处**：`src/index.ts:3 → ../../../electrobun.config`（不移动）、`utils/singleAgent/types.ts:2 → ../../agent/runtime/types`（迁移需 +1 级） | §A.7.6 `f2c`、L26 |
| `utils/**` 内相对 import | **21 处**（`assets` 15 / `teams` 4 / `singleAgent` 2），`utils/mcp` = **0** | L25（A-29 的形态基线） |
| 语义探针 | `f1a/f1b`、`f2a/f2b`、`f4/f5`、`g1–g6` 全部可执行（本轮实跑，§0.5 E5–E9） | §A.7.6、§A.7.7 |

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
| **语义探针相位** | **M1** = 在 **B0** 上跑的基线输出；**M7** = 在**交付态**跑的 F 相输出 | F 相判据（A-25/A-26）**只认 M7**，见 §1.6.6 |
| **`l2_relative`** | A-29 的 5 个子项 `lr1–lr5`，校验 9 个 L2 文件的说明符形态 | 定义与命令见 §A.13.2 |
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
> **例外（L2 新文件）**：7 个模块入口对**自家域内**文件必须使用相对路径（`./assets/thumb`、`./plugins/install`）；**入口内不得出现任何 `@/modules/...`**（跨模块依赖只能经 `ModuleContext` 注入或由 `app.ts` 装配）。判据：**§A.13.2 的 `l2_relative`（A-29 子项 `lr1–lr5`）** + A-15 的 `c9`。

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

#### 1.6.6 语义探针的相位化（M1 只作基线，M7 才是 F 相证据）

> 本节是第 5 轮打回 #3 的结构修复。被判定为“F 相”的语义判据（A-25、A-26）**不得**引用在 B0 上产生的输出。

| 里程碑 | 执行的树 | 覆盖判据 | 输出用途 | 禁止用途 |
| --- | --- | --- | --- | --- |
| **M1（B0 基线探针）** | `d084136` 快照 | §A.7.6 的 `f*`、§A.7.7 的 `g*`（B0 可表达的部分） | 冻结“改动前”的调用点/计数，供 F 相逐项对照 | **不得**作为 A-25/A-26 的 PASS 证据 |
| **M7（F 相语义探针）** | 交付态工作树 | 同上的 `f*`/`g*`（F 路径经 §1.6.2 归一化） | 判定 A-25/A-26 | — |

**规则**

1. 每条语义判据必须同时给出 `phase` 与**执行里程碑**；`phase=F` 的判据只能引用 M7 输出。
2. B0 与 F 的探针命令**形态一致**（同一脚本/同一 `file_count` 模板），只允许**路径**按 §1.6.2 不同。
3. 若某子项只在 F 相存在（如入口文件里的语句），B0 侧必须给出**同类语句的锚点计数**作为可达性证明（G-POS ②），或说明“该子项为结构性新增”（如 `g4b` 的 `import(` = 4 用 B0 `app.ts` 的 4 条 MCP 动态 import 作锚）。
4. 机械判定：§A.12 规则 4 扫 §6.5 表，`Phase=F` 且证据列含 `M1` → `phase_evidence_mismatch += 1` → FAIL。

### 1.7 本轮未改动代码的说明

- 本轮仅新增本文件并更新 `INDEX-2026-10.md`（v5 及更早版本保留为历史，不删除、不改写）。
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
- **G7｜数值不悬空（第 5 版）**：文档中出现的每个数字，要么有 B0 复现命令，要么有到 B0 的推导链，并登记在 §6.9 台账；`scope_files` 一律只观测不断言（§1.6.4）。
- **G8｜语义判据可执行且相位正确（本版新增）**：`f1–f5`、`g1–g6` 每一条都有可执行的命令/探针与期望输出；`phase=F` 的语义判据只引用 **M7** 输出（§1.6.6）；说明符形态由 **A-29（`§A.13.2`）** 机械判定。

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
> 补充（本轮登记）：`utils/singleAgent/types.ts:2` 还有 **1 处相对路径 type 依赖** `"../../agent/runtime/types"`，不在上表（上表只统计 `from "@/agent` 的 alias 行）。**它必须保持相对形式并做深度补偿**（迁入 `modules/agentAccess/` 后 +1 级），**不得改成 alias**——否则 A-13 的 `a3` = 19 会变 20。判据 `f2c`（§A.7.6）。

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
| **R-01** | 建立 7 个应用子模块入口与统一模块契约 `ServerModule`，每个入口声明职责 / 路由前缀 / 初始化钩子 / 对外导出 / 依赖白名单 | P1；现状无任何模块入口，地图只能把 237 文件登记为 1 模块 | 7 个入口存在、各 ≤60 行、`export default ServerModule`；`routePrefixes` 并集 = **§3.6 的 21 项**且两两无交集；`dependencies` 为附录 C 白名单子集 | P0 | 中 | 中 | A-06、A-07、A-18、A-29 |
| **R-02** | `app.ts` 瘦身为组合根：参数归一、中间件 7 项定序、模块装配、静态与错误处理 | P2；`app.ts` 160 行内含 6 类插件初始化、`createHash`、预热、刷新、MCP/A2A 构造、移动互联 | `app.ts` ≤80 行；禁用符号计数=0；7 项中间件行号递增且 `/api/sessionState` 64kb 在全局 100mb 前；`createApp` 签名 diff 为空 | P0 | 中 | 高 | A-08、A-09、A-21 |
| **R-03** | 初始化 15 步归口到模块入口，并把每一步的「阻塞性 / 错误语义 / B0 锚点」固化为可判定表格 | P2；15 步顺序与失败语义混写在 `app.ts:59-158`；第 3 轮打回 #3 指出步骤 5 非阻塞吞错未记录 | 15 步逐行与 R-03 表 7 列一致（含步骤 5 `void` + 静默吞错、步骤 9 `void` + warn、步骤 4/8 ENOENT 容错、步骤 8 锚点在 `express()` 之后）；`app.locals.builtinPlugins` 5 键 `Set<string>`；初始化幂等 | P0 | 中 | **高** | A-10、A-25、A-26 |
| **R-04** | 服务目录模块化：`src/utils/<域>/**` → `src/modules/<模块>/<域>/**`，**只替换说明符前缀、不改导入形态** | P1 + P3；15 个 `utils/*` 子域、246 处深路径（含 agent 侧 50 处） | 7 个模块目录成形；`src/utils/**` 为空（`utils.ts` 除外）；**246 处深路径全部迁移（F=252，见 §A.3）**；`@/utils/` 深路径归零（`scope_min=263`）；14 exports 可用 | P0 | 很高 | 高 | A-01～A-03、A-12、A-19、A-29 |
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
| **R-14** | **判据工程：两相 + 归一化 + 四守卫 + 数值台账 + 文档自审** | 第 3 轮打回 #1/#2、第 4 轮打回 #1/#2/#3 | 每条判据有 phase；`stale_specifier_in_PHF=0`、`vacuous_zero=0`、`reachability_miss=0`、**`scope_assertions=0`**、`unreachable=0`；§A.12/§A.13 脚本可机械复现 | **P0** | 中 | 中 | A-27、A-28、A-29、§6.7、§6.9、§A.7、§A.12、§A.13、§A.13.2 |
| **R-15** | **默认数据目录锚点不变**：`conf` 的默认数据目录在迁移后仍解析为 `<repo>/data`（深度补偿或稳定锚点），并登记迁移中 2 处相对路径的深度变化 | **本轮自查 S2**（第 5 轮 f2 悬空引用的根因之一）；B0 锚点 `conf/index.ts:11` 为 5 级相对路径，R-04 迁移后目录深 1 级 → 默认目录静默漂移到 `apps/data` | `f2a=1`（两相）；`f2b=1`（显式目录生效 + 仓库 `data/` 不被写）；`f2c=2`（跨模块相对 import 数量不变）；`conf` 默认锚点解析结果逐字等于 `<repo>/data` | **P0** | 低 | 中 | A-25（`f2a/f2b`）、A-19、§A.7.6 |

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
5. **7 个入口对自家域内文件使用相对路径**（§1.6.2 例外条款），且**入口内不得出现任何 `@/modules/...`**（跨模块只能经 `ModuleContext` 或 `app.ts` 装配）——判据 `§A.13.2` 的 `lr2/lr3/lr4`（A-29）；
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
  - [F] **静态导入边界**：`app.ts` 的静态 import 图**不得**传递求值 `conf` 或 `assets/thumb`（B0 用动态 import 正是为了让 `TOONFLOW_DATA_DIR` 先于 `conf` 生效）。判据：`f2a`（静态锚点解析 = `<repo>/data`）+ `f2b`（显式临时目录下 `conf.path` 落在 `<tmp>/data/settings.json`，且仓库 `data/settings.json` md5 前后一致），命令与期望见 §A.7.6。
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
  - [F] `createApp` 幂等：同一进程内连续调用 2 次不重复安装、不抛错（A-25 `f5`；判据 = 两次调用后 `<tmp>/data/tools` 的文件清单**逐字相等**、`initialized` 内容仍为 `rev1`，命令见 §A.7.6）。
- **风险与缓解**：同步/异步语义被“统一化” → §6.8 列 4 条禁止重构 + A-25/A-26 逐行核对；步骤 5 的静默吞错最容易被改成 `await` 或打印日志（R17）。

### R-04 服务目录模块化（P0｜难度很高｜风险高）

- **背景**：P1 + P3。15 个 `utils/*` 子域、246 处深路径（含 `src/agent/**` 的 50 处）、145 个 facade 引用。
- **目标**：`src/utils/**` 只留 `src/utils.ts`（facade）；7 个模块目录成形；246 处深路径**一处不漏**迁移；`@/utils/` 深路径归零。
- **描述**：
  - 按 **§1.6.2 SPEC** 逐目录迁移（只替换前缀，不改形态；`@/utils/mcp/servers` → `@/modules/mcpIntegration/mcp/servers`）；
  - **包含 `src/agent/**` 的 50 处说明符更新**（agent 文件本身不移动，但它引用的 server 路径必须跟迁；NG1 只要求“不消除依赖”，不豁免“路径更新”）；
  - `src/core.ts` 的路由生成、`apps/server/package.json` 的 exports（5 个 target）、`tsconfig` paths 同步（R-09）；
  - 不移动 `src/routes/**`（URL 不变）、不移动 `src/lib/**`/`src/types/**`。
  - **相对路径描述符的深度补偿（本轮新增）**：`src/utils/singleAgent/types.ts:2` 的 `"../../agent/runtime/types"` 随 `singleAgent` 迁入 `modules/agentAccess/singleAgent/` 后**必须补 1 级**（`"../../../agent/runtime/types"`）；`src/index.ts:3` 的 `"../../../electrobun.config"` 不移动、不变。**两者都不得改成 alias**（否则 A-13 的 `a3` 由 19 变 20、A.11 多一条未登记边）。判据：`f2c`（`relative_escape=2`，两相相同）+ `bun run typecheck`。
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
  7. **文档自审**：§A.12 扫说明符/phase/**证据相位**；§A.13 扫数值台账、`scope_assertions` 与 `l2_relative` 是否已定义。
- **验收**：
  - [B0+F] A-27 逐项通过：`criteria_total=29`、`criteria_phase_tagged=29`、`stale_specifier_in_PHF=0`、`vacuous_zero=0`、`reachability_miss=0`、**`phase_evidence_mismatch=0`**、`doc_audit=PASS`；
  - [B0+F] A-28 逐项通过：`ledger_rows=32`、`unreachable=0`、`scope_assertions=0`、`l2_relative_defined=1`、`l2_relative_occurrences>=5`、`ledger_probe=PASS`；
  - [B0+F] A-14/A-15/A-17 的三组命令在两相都能执行（B0 得出基线值，F 得出判定值），无一为空搜索；
  - [F] §A.12 与 §A.13 脚本对本文档输出 `doc_audit=PASS`（评审可复跑）。
- **风险与缓解**：实施者“顺手”把说明符改成相对路径 → `e5`（形态冻结）+ A-27 联合模式判 FAIL；取舍：允许在 §A.7 之外用临时命令排查，但**作为验收证据的命令必须是本文档给出的命令**。

---

### R-15 默认数据目录锚点不变 + 相对路径深度补偿（P0｜难度低｜风险中）

- **背景**（本轮自查 S2，属第 5 轮“f2 悬空”的根因之一）：`conf/index.ts:11` 用**相对深度**锚定默认数据目录：
  ```ts
  const dataDirectory = process.env.TOONFLOW_DATA_DIR ?? resolve(import.meta.dirname, "../../../../../data");
  ```
  B0 的 `apps/server/src/utils/conf` 向上 5 级 = `<repo>/data`（本轮实测 `f2a=1`）。R-04 把该目录迁到 `apps/server/src/modules/platformCore/conf`（**深 1 级**）后，同样 5 级只到 **`apps/data`**。三宿主都显式传 `dataDirectory`（`apps/desktop/src/index.ts:243`、`apps/mobile/src/server.ts:111`、`apps/server/src/index.ts:12`），所以**线上不会立刻暴露**；但直接 `createApp()`（缺省数据目录）会静默改写到错误位置 —— 属于 NG4（数据目录语义不变）的破坏。
- **目标**：默认数据目录在迁移后**仍解析为 `<repo>/data`**；跨模块相对路径数量与深度变化被显式登记。
- **描述**：
  1. 迁移时把该锚点补偿 1 级（`"../../../../../../data"`），或改由 `createApp` 计算后经 `ModuleContext.dataDirectory` 注入（Q12 决定，默认“深度补偿”，改动最小、可判据最简）；
  2. `singleAgent/types.ts` 的 `"../../agent/runtime/types"` 同步补偿 1 级；
  3. **两处都不得改写为 alias**（会改变 A-13/A.11 的计数口径）。
- **验收**：
  - [B0+F] `f2a=1`：静态解析 `conf` 的默认锚点，结果逐字等于 `<repo>/data`（命令见 §A.7.6，B0 本轮实测 1）；
  - [B0+F] `f2b=1`：显式 `TOONFLOW_DATA_DIR=<tmp>/data` 时 `conf.path = <tmp>/data/settings.json`，且仓库 `data/settings.json` md5 前后一致；
  - [B0+F] `f2c=2`：跨模块相对 import 计数不变（`src/index.ts` + `singleAgent/types.ts`）；
  - [F] `bun run typecheck` 通过（深度写错会在这里暴露）。
- **风险与缓解**：只补偿深度但漏改 `singleAgent/types.ts` → typecheck 失败（可自动发现）；把相对路径改成 alias → A-13 计数变化（R19 登记）；两者都有机械判据兜底。

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

### 6.5 验收判定表（A-01～A-29，二值；含 Phase 列）

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
| A-25 | R-03 步骤 5 缩略图预热语义保真（含 R-15 数据目录锚点） | **F** | §A.7.6 `f1a–f1d`、`f2a–f2c`、`f3a/f3b`、`f4`、`f5` | `f1a=0`、`f1b=0`（`app.ts` 已无预热调用）、`f1c=1`（入口唯一调用点）、`f1d=1`（`void import("./assets/thumb")`）；`f2a=1`（默认锚点 = `<repo>/data`）、`f2b=1`（显式目录生效 + 仓库 `data/` 未被写）、`f2c=2`；`f3a=0`（入口无 `console.*`）、`f3b=1`（`thumb.ts` warn 保留）；`f4`：`f4_resolved=1 f4_unhandled=0`；`f5`：`f5_resolved=1 f5_tools_equal=1 f5_marker=rev1` | **M7 日志** | ☐ PASS ☐ FAIL |
| A-26 | 15 步阻塞性/错误语义矩阵 | **F** | §A.7.7 `g1–g6`（含 B0 锚点 `g4b0`）+ 读 §R-03 表 | `g1=0`、`g2=1`、`g3=1`（空 catch 逐字保留）、`g4=1`（warn 型）、`g4b=4`（入口 4 个动态 import；B0 锚 `g4b0=4`）、`g6a=g6b=1`；`g5` 行号满足 `express() < builtinPlugins < development`；每步与 §R-03 表第 5/6 列逐项一致；步骤 5 = `void`+静默、步骤 9 = `void`+warn **未合并**；步骤 1–4、6–8、10–12、15 为 `await`+抛出；步骤 4/8 的 ENOENT 容错保留 | **M7 日志** | ☐ PASS ☐ FAIL |
| A-27 | 判据自审（分期/守卫/证据相位/文档层） | **B0+F** | §A.12 | `criteria_total=29`、`criteria_phase_tagged=29`、`stale_specifier_in_PHF=0`、`unlabeled_utils_command=0`、**`phase_evidence_mismatch=0`**、`doc_audit=PASS` | M3/M6 日志 | ☐ PASS ☐ FAIL |
| **A-28** | **数值台账自审（可达性 / scope 断言 / 形态定义 / 运行时守卫）** | **B0+F** | §A.13 + §A.7.9 | `ledger_rows=32`、`unreachable=0`、`scope_assertions=0`、`l2_relative_defined=1`、`l2_relative_occurrences>=5`、`ledger_probe=PASS`（B0 探针逐项命中登记值）、`missing_path_guard=0`、`vacuous_zero=0`、`reachability_miss=0` | M3/M6 日志 | ☐ PASS ☐ FAIL |
| **A-29** | **L2 说明符形态（`l2_relative`）** | **F** | §A.13.2 `lr1–lr5` | `lr1_exist=1`（9 个 L2 文件全存在）、`lr2_entry_relative_ok=7`（5 个入口各有 ≥1 处 `./` 相对 import、2 个允许 0；逐入口下限见 §A.13.2）、`lr3_self_alias=0`、`lr4_cross_alias=0`（入口不 import 其它模块）、`lr5_other_alias=0`；汇总行 `l2_relative=PASS` | **M7 日志** | ☐ PASS ☐ FAIL |

> A-25 / A-26 / A-29 的命令**在交付态执行**（`Phase=F`），证据**只能引用 M7 输出**；**M1（B0）只作“改动前”对照基线，不得作为这三项的 PASS 证据**（§1.6.6，由 §A.12 规则 4 机械判定）。
> A-25 的 `f2a–f2c` 是本版新增（第 5 轮打回 #1：`f2` 原为悬空引用）；A-29 是本版新增（第 5 轮打回 #2：`l2_relative` 原为未定义引用）。
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
9. **证据相位**：`Phase=F` 的判据只能引用 **M7** 输出；证据列出现 `M1` 按 A-27 判 FAIL（`phase_evidence_mismatch>0`，§1.6.6）。
10. **可执行性**：语义判据不得只写“运行时探针/见某节” —— 必须给出**命令、输入、期望输出**三者；缺一按 A-27 判 FAIL（本版对 `f2/f4/f5` 的修复即为此条）。

### 6.7 判据规则（第 3/4 轮打回的正式口径）

1. **两相**：每条判据标注 `B0` / `F` / `B0+F`；同一判据的 B0 与 F 命令必须**形态一致**（联合模式或同构替换），只允许 SPEC 映射不同（§1.6.2）。
2. **说明符**：PH-F 禁用裸 `@/utils/…` 作为唯一 pattern；计数判据用纯 `@/modules/…`；归零判据用联合模式。
3. **守卫**：G-EXIST（路径缺失即 FAIL）、G-MATCH（0 命中必须 `scope_files ≥ scope_min`）、G-POS（期望 >0 必须有 B0 试跑或符号存在证明）、**G-SCOPE**（`scope_files` 不得作为断言）。
4. **形态冻结**：`@/modules/...` alias；L2 入口对自家域内文件用相对路径、且**入口不 import 其它模块**；前者由 `e5` 守护，后者由 **A-29（§A.13.2 的 `l2_relative`：`lr1–lr5`）** 守护。
5. **脚本不落库**：判据脚本一律以 heredoc 执行，输出粘贴进 M3/M6；仓库内不新增任何 `*.test.ts` / `scripts/verify*` 文件。
6. **文档自审**：§A.12（phase/说明符/空搜索/**证据相位**）+ §A.13（数值台账/scope 断言/规模探针/**`l2_relative` 是否已定义**）+ §A.13.2（形态判据）。
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
| 8 | 时序：`TOONFLOW_DATA_DIR` 先于 `conf` | `app.ts:59` 设置 env，`:60` 才 import `conf` | 禁止任何静态 import 传递求值 `conf`/`assets/thumb`（A-25 `f2a`/`f2b`） |
| 9 | 默认数据目录锚点 | `conf/index.ts:11` 5 级相对路径 → `<repo>/data` | 迁移时**必须**补偿深度或改稳定锚点；禁止以“宿主总会传 `dataDirectory`”为由不改（R-15、A-25 `f2a`） |
| 10 | 跨模块相对路径 | `utils/singleAgent/types.ts:2` 相对 import `@/agent` 类型 | 禁止改成 alias（会改 A-13/A.11 计数）；只允许补深度（A-25 `f2c`） |

### 6.9 数值可达性台账（L01–L32；A-28 的判定对象）

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
| L24 | `conf` 默认数据目录锚点 | `../../../../../data`（5 级）→ `<repo>/data`；`anchor_match=1` | B0+F | §A.7.6 `f2a`（本轮实测 `anchor_match=1`） | 直接实测；F 需补偿为 6 级（R-15），补偿后仍须 =1 |
| L25 | `utils/**` 内相对 import | 21（assets 15 / teams 4 / singleAgent 2）；`utils/mcp` = 0 | B0 | `grep -rn 'from "\.\{1,2\}/' apps/server/src/utils --include='*.ts' \| wc -l` | 直接实测；作为 A-29 的形态基线（入口允许相对、跨模块相对仅 2 处） |
| L26 | 跨模块相对 import（非 agent） | 2（`src/index.ts:3`、`utils/singleAgent/types.ts:2`） | B0+F | §A.7.6 `f2c`（本轮实测 2） | 直接实测；F 同值（深度补偿不改变条数） |
| L27 | 预热调用点计数 | B0：`f1a=0 f1b=1`；F：`f1a=0 f1b=0 f1c=1 f1d=1` | B0+F | §A.7.6（本轮实测 B0 两值） | B0 直接实测；F 由 R-02/R-03 的结构（调用移入入口）推导 |
| L28 | 显式数据目录探针 | `f2b=1`（`conf.path` 落 `<tmp>/data/settings.json`，仓库 `data/settings.json` md5 不变） | B0+F | §A.7.6 `f2b`（本轮实测通过） | 直接实测 |
| L29 | 预热异常容错探针 | `f4_resolved=1 f4_unhandled=0` | B0+F | §A.7.6 `f4`（缓存布局损坏注入，本轮实测） | 直接实测 |
| L30 | `createApp` 幂等探针 | `f5_resolved=1 f5_tools_equal=1 f5_marker=rev1` | B0+F | §A.7.6 `f5`（本轮实测） | 直接实测 |
| L31 | 15 步锚点计数（B0） | `g1=0 g2=1 g3=1 g4=1 g4b=11 g4b0=4 g6a=1 g6b=1` | B0 | §A.7.7（本轮实测） | 直接实测；F 的对应项为 `g2/g3/g4/g4b/g6a/g6b`（入口内计数，见 A-26） |
| L32 | 步骤 8 锚点行号 | `express()=92 < builtinPlugins=95 < development=108` | B0 | §A.7.7 `g5`（本轮实测） | 直接实测；F 保留同序（A-09/A-10） |

> **A-28 的判定**：`ledger_rows=32`；`unreachable=0`（每行要么 B0 实测、要么有推导/上限说明）；`scope_assertions=0`（§6.5 的“期望值”列不出现 `scope_files`）；`l2_relative_defined=1`、`l2_relative_occurrences>=5`（§0.1#2）；`ledger_probe=PASS`（§A.13 的探针对 L01–L20、L24 逐项复算，`mismatch=0`）。

### 6.10 文档自审（可机械复现，纳入 M3/M6 证据）

| 脚本 | 覆盖 | PASS 条件 | 非空转验证 |
| --- | --- | --- | --- |
| §A.12 | ① A 行缺 Phase；② PH-F 块出现裸 `@/utils/` 说明符；③ 未标注块出现 B0 说明符；④ `Phase=F` 的 A 行证据引用 `M1` | `criteria_total=29`、`criteria_phase_tagged=29`、`stale_specifier_in_PHF=0`、`unlabeled_utils_command=0`、**`phase_evidence_mismatch=0`**、`doc_audit=PASS` | 对 v5 文档跑 → `criteria_total=28` → FAIL；把 A-25 的证据列改回 `M1` → `phase_evidence_mismatch=1` → FAIL |
| §A.13 | ① 台账行数；② 每行相位/来源非空；③ `scope_files` 是否被写进 §6.5 期望列；④ B0 探针复算；⑤ `l2_relative` 是否已定义且被引用 | `ledger_rows=32`、`scope_assertions=0`、`probe_mismatch=0`、`l2_relative_defined=1`、`l2_relative_occurrences>=5`、`ledger_probe=PASS` | 注入一笔“期望 `scope_files=60`” → `scope_assertions=1` → FAIL；把 L20 的 21 改成 22 → `probe_mismatch=1` → FAIL；删掉 §A.13.2 → `l2_relative_defined=0` → FAIL |
| §A.13.2 | `l2_relative` 的 5 个子项（`lr1–lr5`）覆盖 9 个 L2 文件的说明符形态（A-29） | `l2_relative=PASS`（`lr1_exist=1 lr2_entry_relative_ok=7 lr3_self_alias=0 lr4_cross_alias=0 lr5_other_alias=0`） | 删掉某入口的一条相对 import → `lr2=6` → FAIL；把入口的 `./assets/thumb` 改成 `@/modules/assetLibrary/assets/thumb` → `lr3=1` → FAIL |

---

## 7. 风险登记表

| ID | 风险 | 概率 | 影响 | 缓解 | 关联验收 |
| --- | --- | --- | --- | --- | --- |
| R1 | 迁移遗漏说明符，运行期 404/编译失败 | 中 | 高 | `bun run typecheck`（严格失败即暴露）+ §A.3 的 `@/utils/` 归零判据 + 246→252 计数 | A-19、R-04 |
| R2 | URL 随目录变化导致前端 404 | 低 | 高 | 方案 B 不动 `routes/**`；162 端点清单 diff；§3.6 的 21 前缀首端点 | A-11、A-20 |
| R3 | `createApp` 时序被破坏（`conf` 提前求值） | 中 | 高 | 保持 `conf`/`thumb` 动态 import；A-25 `f2a`（静态锚点）+ `f2b`（显式目录/仓库不写）探针 | A-25、R-02 |
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
| R18 | 说明符形态漂移（alias → 相对路径） | 中 | 中 | `e5` 形态冻结 + **A-29（§A.13.2 `l2_relative`：入口自家域内必须相对、入口不得 import 其它模块）** | A-17、A-29 |
| R19 | **默认数据目录锚点随迁移漂移**（本轮发现，S2） | 中 | 高 | R-15 + `f2a`（两相）+ `f2b` + `typecheck` | A-25、R-15 |
| R20 | **语义判据再次引用错误相位**（M1 充当 F 证据） | 中 | 中 | §1.6.6 + §A.12 规则 4（`phase_evidence_mismatch=0`） | A-27、§6.10 |
| R21 | 入口以 alias import 其它模块（破坏 §A.3 ③ 的 103 段与 A-29） | 中 | 中 | `lr4_cross_alias=0` + `§A.3` ③ 计数比对 | A-29、A-27 |

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
| **M1 基线语义探针（B0）** | 在 **B0 快照**上跑 §A.7.6 的 `f*` 与 §A.7.7 的 `g*`（B0 可表达的部分），记录“改动前”输出 | 输出归档为 M7 的对照基线；**明确不得作为 A-25/A-26/A-29 的 PASS 证据**（§1.6.6） |
| **M2 目录迁移** | R-04：`utils/<域>` 迁入 `src/modules/<模块>`；`documents.ts`/`fileHttp.ts`/`remoteConnection.ts` 随迁；说明符前缀替换（含 `src/agent/**` 的 50 处） | A-01/A-02/A-03 通过；`@/utils/` 深路径 = 0；`typecheck` 通过 |
| **M3 模块契约** | R-01/R-02/R-03/R-07：7 个入口 + `types/module.ts` + `lib/mentionSources.ts`；`app.ts` 瘦身；15 步归口；A–D 边处理 | A-06/A-08/A-09/A-10/A-13～A-17 通过；§A.7 证据归档 |
| **M4 装配与回归** | R-05/R-06：`utils.ts` 分组注释、`router.ts` 分组注释；13 项 + S1–S8 + 21 前缀冒烟 | A-11/A-20 通过 |
| **M5 规范与地图** | R-09：`AGENTS.md`、模块清单、`package.json` exports、地图重算 | A-12/A-22 通过 |
| **M6 终验与证据** | 全量 A-01～A-29 + §A.12/§A.13 自审 + 三宿主冒烟；豁免表填满 | 结构/契约/回归/台账各组 PASS；**语义保真组（A-25/A-26/A-29）按定义转由 M7 判定**，其余「全部 PASS 或 §11 有明确裁决」 |
| **M7 交付态语义探针（F 相）** | 在交付态跑 §A.7.6 的 `f1a–f5`、§A.7.7 的 `g1–g6`、§A.13.2 的 `lr1–lr5` | A-25/A-26/A-29 的全部子项输出齐备并与期望逐项一致；**这三项的证据列必须指向 M7**；M7 完成即视为 M6 的语义保真组闭环（执行顺序：M6 结构项 → M7 语义项） |

---

## 10. 待评审决策点（Q1–Q12，均有默认值）

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
| Q11 | 说明符形态与计数口径 | **冻结 alias（`@/modules/...`）；L2 入口自家域内用相对路径且不得 import 其它模块；计数区分“import 行”（A.11）与“from 行”（A.3）** | **同左** | 形态漂移会让边矩阵、A-29 与白名单判据全部失效 |
| Q12 | 默认数据目录锚点修法 | **A 深度补偿（`../../../../../../data`）** / B 由 `createApp` 计算并经 `ModuleContext` 注入 / C 抽 `lib/repoRoot` 常量 | **A** | 改动最小、判据最简（`f2a` 一条即可判定）；B/C 属另立需求 |

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

### 11.3 决策点裁决（Q1–Q12）

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
| Q12 | A（深度补偿） |  |

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
| 语义保真 | A-25、A-26、A-29 | ☐ PASS ☐ FAIL |
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
grep -rho 'from "@/modules/[a-zA-Z]*' apps/server/src/modules --include='*.ts' | wc -l  # 103（入口贡献 0，见 A-29 lr4）
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

> **判据归属**：①② 属 **PH-B0**；③④⑤ 属 **PH-F**。③ 的 `103` 段必须用“`src/modules/**` 总数减去 7 个入口文件内的 `from "@/modules/...` 行数”计算；因 7 个入口对自家域内文件使用相对路径、且**入口不得 import 其它模块**（§1.6.2 例外），其实测值应为 **0**，故可直接用 `src/modules/**` 统计。该前提由 **A-29（§A.13.2 的 `lr3`/`lr4`）** 守护；`lr4` 一旦 >0，本行的 `103` 与 A-29 会同时 FAIL。

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

#### A.7.6 R-03 步骤 5（缩略图预热）+ R-15（数据目录锚点）语义保真（A-25）

> 第 5 轮打回 #1 的处置：本节给出 **`f1–f5` 的全部命令**。v5 的问题有三处：`f2` 只写“见 A.7.7 的 g 组”（g 组里没有数据目录判据，属悬空引用）、`f4`/`f5` 只有“运行时探针”五个字、`f1b` 的期望 `warmup\(` 在 B0 为 0（不可达，§0.2 S1）。
> 全部探针脚本写到 `/tmp` 执行，**不落库**（§6.7 规则 5）；两相都从**仓库根**执行，`f4/f5` 需 `cd apps/server`（与 §A.9 一致）。若 `bun` 不在 `PATH`，用 `BUN=/abs/path/to/bun` 覆盖（本轮实测环境即如此）。

**① 探针助手（本节专用；`phase` 由参数给出，不写死）**

```bash
probe_count() { # probe_count <label> <phase> <expect> <ERE> <file>
  local label=$1 phase=$2 expect=$3 ere=$4 f=$5 s=0 n=0 verdict=FAIL
  if [ -f "$f" ]; then s=1; n=$(grep -cE -- "$ere" "$f" | tr -d ' '); fi
  [ "$s" -eq 1 ] && [ "$n" -eq "$expect" ] && verdict=PASS
  printf 'check=%-4s phase=%s expect=%-2s scope_files=%s hits=%-2s verdict=%s\n' \
    "$label" "$phase" "$expect" "$s" "$n" "$verdict"
}
```

**② f2a：静态解析 `conf` 的默认数据目录锚点（无副作用，两相通用）**

```bash
cat > /tmp/probe_anchor.py <<'PY'
import os, re, sys
conf = os.environ["CONF_FILE"]
if not os.path.isfile(conf):
    print(f"f2a_missing={conf}")
    print(f"check=f2a phase={os.environ.get('PHASE','F')} expect=1 scope_files=0 hits=0 verdict=FAIL")
    raise SystemExit(0)
src = open(conf, encoding="utf-8").read()
m = re.search(r'resolve\(\s*import\.meta\.dirname\s*,\s*"([^"]+)"\s*\)', src)
rel = m.group(1) if m else ""
resolved = os.path.realpath(os.path.normpath(os.path.join(os.path.dirname(conf), rel))) if rel else ""
repo_data = os.path.realpath("data")
hit = 1 if resolved == repo_data else 0
print(f"f2a_anchor_rel={rel or '<none>'} f2a_anchor={resolved or '<none>'} f2a_repo_data={repo_data}")
print(f"check=f2a phase={os.environ.get('PHASE','F')} expect=1 scope_files=1 hits={hit} verdict={'PASS' if hit else 'FAIL'}")
PY

# PH-B0
CONF_FILE=apps/server/src/utils/conf/index.ts PHASE=B0 python3 /tmp/probe_anchor.py
# 实测（本轮）：f2a_anchor_rel=../../../../../data f2a_anchor=<repo>/data f2a_repo_data=<repo>/data
#               check=f2a phase=B0 expect=1 scope_files=1 hits=1 verdict=PASS

# PH-F（迁移后路径；R-15 要求补偿为 6 级或改稳定锚点，否则本行会 FAIL）
CONF_FILE=apps/server/src/modules/platformCore/conf/index.ts PHASE=F python3 /tmp/probe_anchor.py
# 期望：check=f2a phase=F expect=1 scope_files=1 hits=1 verdict=PASS
```

**③ f2b：显式数据目录生效 + 仓库 `data/` 不被写（运行时，两相通用）**

```bash
cat > /tmp/probe_datadir.sh <<'SH'
#!/usr/bin/env bash
# usage: probe_datadir.sh <apps/server 相对路径，如 src/utils/conf/index.ts>
set -u
conf="${1:?usage: probe_datadir.sh <src/.../conf/index.ts>}"
md5of() { md5 -q "$1" 2>/dev/null || md5sum "$1" | cut -d' ' -f1; }
before=$(md5of data/settings.json)
tmp=$(mktemp -d)
out=$(cd apps/server && TOONFLOW_DATA_DIR="$tmp/data" PROBE_CONF="./$conf" \
  "${BUN:-bun}" -e 'const m = await import(process.env.PROBE_CONF!); console.log(m.default.path);' 2>/dev/null | tail -1)
after=$(md5of data/settings.json)
case "$out" in *"$tmp"*) hit=1 ;; *) hit=0 ;; esac
[ "$before" = "$after" ] && same=1 || same=0
echo "f2b_explicit_dir=$hit f2b_repo_data_unchanged=$same conf_path=$out"
[ "$hit" -eq 1 ] && [ "$same" -eq 1 ] \
  && echo "check=f2b phase=${PHASE:-F} expect=1 scope_files=1 hits=1 verdict=PASS" \
  || echo "check=f2b phase=${PHASE:-F} expect=1 scope_files=1 hits=0 verdict=FAIL"
SH

# PH-B0
PHASE=B0 bash /tmp/probe_datadir.sh src/utils/conf/index.ts
# 实测（本轮）：f2b_explicit_dir=1 f2b_repo_data_unchanged=1 conf_path=<tmp>/data/settings.json
#               check=f2b phase=B0 expect=1 scope_files=1 hits=1 verdict=PASS

# PH-F
PHASE=F bash /tmp/probe_datadir.sh src/modules/platformCore/conf/index.ts
# 期望：同上；仓库 data/settings.json 的 md5 在两相必须相同（不得被探针写入）
```

**④ f4/f5：预热异常容错 + `createApp` 幂等（运行时，两相通用；须在 `apps/server` 下执行）**

```bash
cat > /tmp/probe_semantics.ts <<'TS'
// f4：缓存布局损坏注入（<data>/cache/thumbs 建成普通文件）→ createApp 仍 resolve 且无 unhandledRejection
// f5：同进程连续两次 createApp → 安装目录清单逐字相等、marker 仍为 rev1
const tmp = process.env.PROBE_TMP!;
const entry = process.env.APP_ENTRY ?? "./src/app.ts";
const empty = `${tmp}/empty`, toolsSrc = `${tmp}/tools-src`;
await Bun.$`mkdir -p ${empty} ${toolsSrc} ${tmp}/data/cache`.quiet();
await Bun.write(`${toolsSrc}/demo.tool.js`, `console.log("demo");\n`);
await Bun.write(`${tmp}/data/cache/thumbs`, "not-a-directory\n");
if (!(await Bun.file(`${process.cwd()}/${entry}`).exists())) {
  console.log(`f4_missing=${entry}`);
  console.log(`check=f4/f5 phase=${process.env.PHASE ?? "F"} verdict=FAIL`);
  process.exit(0);
}
let unhandled = 0;
process.on("unhandledRejection", () => { unhandled++; });
const { createApp } = await import(`${process.cwd()}/${entry}`);
const opts = {
  webRoot: `${tmp}/web`, dataDirectory: `${tmp}/data`, toolsRoot: toolsSrc, nodesRoot: empty,
  extRoot: empty, providersRoot: `${tmp}/prov`, skillsRoot: empty, agentsRoot: empty, pluginRevision: "rev1",
};
const run = () => Promise.race([
  createApp(opts as never),
  new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 60000)),
]);
const list = async (dir: string) => (await Array.fromAsync(new Bun.Glob("*").scan({ cwd: dir }))).sort();
try {
  await run();
  const first = await list(`${tmp}/data/tools`);
  await run();
  const second = await list(`${tmp}/data/tools`);
  await new Promise(resolve => setTimeout(resolve, 1500));
  const equal = JSON.stringify(first) === JSON.stringify(second) ? 1 : 0;
  const marker = (await Bun.file(`${tmp}/data/tools/initialized`).text().catch(() => "")).trim();
  console.log(`f4_resolved=1 f4_unhandled=${unhandled}`);
  console.log(`f5_resolved=1 f5_tools_equal=${equal} f5_marker=${marker || "<none>"}`);
  console.log(`check=f4/f5 phase=${process.env.PHASE ?? "F"} verdict=${unhandled === 0 && equal === 1 && marker === "rev1" ? "PASS" : "FAIL"}`);
} catch (error) {
  console.log(`f4_resolved=0 f4_error=${(error as Error).message} f4_unhandled=${unhandled}`);
  console.log(`check=f4/f5 phase=${process.env.PHASE ?? "F"} verdict=FAIL`);
}
process.exit(0);
TS

# PH-B0（M1 基线）
(cd apps/server && PHASE=B0 PROBE_TMP=$(mktemp -d) "${BUN:-bun}" /tmp/probe_semantics.ts)
# 实测（本轮）：f4_resolved=1 f4_unhandled=0 / f5_resolved=1 f5_tools_equal=1 f5_marker=rev1
#               check=f4/f5 phase=B0 verdict=PASS
#               （同时可读 app.locals.builtinPlugins：tool,node,ext,skill,agent 共 5 键，支撑 A-10）
# PH-F（M7 判定）
(cd apps/server && PHASE=F PROBE_TMP=$(mktemp -d) "${BUN:-bun}" /tmp/probe_semantics.ts)
# 期望：同上（入口化后 createApp 仍幂等、预热失败仍被吞掉）
```

> **已知不适用的注入方式（§0.2 S3）**：把 `<data>` 设为只读（`chmod 0555`）会让 `conf` 在**模块初始化期**写 `settings.json` 失败（`EACCES`）→ `createApp` **合法 reject**，与步骤 5 的吞错语义无关。本轮实测：`ERR=EACCES: open '<tmp>/data/settings.json.tmp-<uuid>'`。因此 `f4` 采用**缓存布局损坏注入**，并且断言里**不含**“必须在某状态下成功”的模糊条件。

**⑤ f1/f2c/f3 的静态判据（两相分别执行；需先执行 ① 的 `probe_count` 定义）**

```bash
# PH-B0（M1 基线；不得作为 A-25 的 PASS 证据）
probe_count f1a B0 0 'await[^;]*sweepThumbnailCache' apps/server/src/app.ts
probe_count f1b B0 1 'sweepThumbnailCache\('          apps/server/src/app.ts
probe_count f3b B0 1 '缩略图清扫失败'                 apps/server/src/utils/assets/thumb.ts
PHASE=B0 bash -c 'grep -rn "from \"\.\./" apps/server/src --include="*.ts" | grep -v "^apps/server/src/agent/" | wc -l'   # f2c：2
# 实测（本轮）：f1a hits=0 PASS；f1b hits=1 PASS；f3b hits=1 PASS；f2c=2
```

```bash
# PH-F（M7 判定）
probe_count f1a F 0 'await[^;]*sweepThumbnailCache' apps/server/src/app.ts
probe_count f1b F 0 'sweepThumbnailCache\('          apps/server/src/app.ts
probe_count f1c F 1 'sweepThumbnailCache\('          apps/server/src/modules/assetLibrary/index.ts
probe_count f1d F 1 'void .*import\("\./assets/thumb"\)|void import\(' apps/server/src/modules/assetLibrary/index.ts
probe_count f3a F 0 'console\.'                      apps/server/src/modules/assetLibrary/index.ts
probe_count f3b F 1 '缩略图清扫失败'                  apps/server/src/modules/assetLibrary/assets/thumb.ts
grep -rn 'from "\.\./' apps/server/src --include='*.ts' | grep -v '^apps/server/src/agent/' | wc -l   # f2c：2
# 期望：f1a=0、f1b=0（app.ts 已无预热调用）、f1c=1（入口唯一调用点）、f1d=1（void 动态 import 到自家域）,
#       f3a=0、f3b=1、f2c=2
```

> **G-POS 说明**：`f1c/f1d/f3a` 是 F 相才存在的子项（入口文件），可达性由“入口文件存在（G-EXIST）+ 同一断言在 B0 的同类形态（`f1b`/`f3b`）已达”共同证明；`f2a/f2b/f2c/f4/f5` 两相都能跑，B0 已实测通过（§0.5 E6–E8）。

#### A.7.7 初始化 15 步阻塞性 / 错误语义（A-26）

> 判据分两层：① 结构层（`g` 组计数与行号，本节能机械判定）；② 语义层（与 §R-03 表第 5/6 列逐行比对，由评审在 M7 证据上勾选）。B0 侧只跑“可表达”的锚点，F 侧跑入口级判据。

```bash
# PH-B0（M1 基线；锚点计数）
probe_count g1  B0 0 'await[^;]*warmup|await[^;]*sweepThumbnailCache' apps/server/src/app.ts
probe_count g2  B0 1 'void .*import\("\./assets/thumb"\)|void import\(' apps/server/src/app.ts
probe_count g3  B0 1 'catch\(\(\) => \{\}\)'                            apps/server/src/app.ts
probe_count g4  B0 1 'initializeProviderModels\(\)\.catch'              apps/server/src/app.ts
probe_count g4b B0 11 'import\('                                        apps/server/src/app.ts
probe_count g4b0 B0 4 'import\("@toonflow/mcp"\)|import\("@/utils/mcp/(tools|control|resources)"\)' apps/server/src/app.ts
probe_count g6a B0 1 'Buffer\.alloc\(0\)'                               apps/server/src/app.ts
probe_count g6b B0 1 'createHash\("sha256"\)'                          apps/server/src/app.ts
grep -nE 'const app = express\(\)|app\.locals\.builtinPlugins|getRuntimePlatform\(\)\.development' apps/server/src/app.ts
# 实测（本轮）：g1=0 g2=1 g3=1 g4=1 g4b=11 g4b0=4 g6a=1 g6b=1；行号 92 < 95 < 108（= g5 的 B0 锚）
```

```bash
# PH-F（M7 判定）
probe_count g1  F 0 'await[^;]*warmup|await[^;]*sweepThumbnailCache'      apps/server/src/modules/assetLibrary/index.ts
probe_count g2  F 1 'void .*import\("\./assets/thumb"\)|void import\('    apps/server/src/modules/assetLibrary/index.ts
probe_count g3  F 1 'catch\(\(\) => \{\}\)'                               apps/server/src/modules/assetLibrary/index.ts
probe_count g4  F 1 'initializeProviderModels\(\)\.catch'                 apps/server/src/modules/mediaGeneration/index.ts
probe_count g4b F 4 'import\('                                           apps/server/src/modules/mcpIntegration/index.ts
probe_count g6a F 1 'Buffer\.alloc\(0\)'                                  apps/server/src/modules/mediaGeneration/index.ts
probe_count g6b F 1 'createHash\("sha256"\)'                             apps/server/src/modules/mediaGeneration/index.ts
grep -nE 'const app = express\(\)|app\.locals\.builtinPlugins|getRuntimePlatform\(\)\.development' apps/server/src/app.ts   # g5：三行行号严格递增
# 期望：g1=0；g2=1；g3=1（空 catch 逐字保留，禁止改成吞所有 errno）；
#       g4=1（warn 型，且与 g3 不共用 helper）；g4b=4（4 个 MCP 动态 import，B0 锚 g4b0=4）；
#       g6a=g6b=1（ENOENT 容错 + sha256 哈希，与 B0 同值）；g5：express() < builtinPlugins < development
```

#### A.7.8 判据对照表（label → phase → expect → 守卫）

| label | phase | expect | scope_min | 证据 / 可达性 |
| --- | --- | --- | --- | --- |
| f1a | B0+F | 0 | 1（文件） | B0/F 均为 0：B0 无此调用形态、F 调用移入入口 |
| f1b | B0 | 1 | 1（文件） | B0 `app.ts:88` 的 `sweepThumbnailCache(` |
| f1c / f1d | F | 1 / 1 | 1（文件） | 入口唯一调用点 + `void import("./assets/thumb")` |
| f2a | B0+F | 1 | 1（文件） | 锚点解析 = `<repo>/data`（B0 实测；F 由 R-15 保证） |
| f2b | B0+F | 1 | 1（文件） | 显式目录生效 + 仓库 `data/` md5 不变（B0 实测） |
| f2c | B0+F | 2 | 1（文件） | `src/index.ts:3`、`utils/singleAgent/types.ts:2` |
| f3a / f3b | F / B0+F | 0 / 1 | 1（文件） | 入口无 `console.*`；`thumb.ts` warn 保留（B0=F=1） |
| f4 | B0+F | `f4_resolved=1`、`f4_unhandled=0` | — | 注入探针（B0 实测 PASS） |
| f5 | B0+F | `f5_tools_equal=1`、`f5_marker=rev1` | — | 幂等探针（B0 实测 PASS） |
| g1–g6 | F | 见 §A.7.7 | 1（文件） | 15 步结构层；语义层见 §R-03 表 + §6.8 |
| g4b0 | B0 | 4 | 1（文件） | `g4b` 的可达性锚（B0 的 4 条 MCP 动态 import） |
| g5 | B0+F | 行号 `92 < 95 < 108` | 1（文件） | 步骤 8 的锚点顺序 |
| lr1–lr5 | F | 见 §A.13.2 | 9（文件） | A-29；形态判据 |


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

> 用途：机械发现四类回归 —— ① A 行缺 Phase 标注；② PH-F 块使用迁移前说明符；③ 未标注块使用 B0 说明符；④ **`Phase=F` 的 A 行把证据指向 M1**（第 5 轮打回 #3：A-25/A-26 曾用 M1 = B0 基线充当 F 相证据）。
> 例外：**zero-guard 行**（同一行含 `zero-guard` 注释）允许在 PH-F 块内出现 B0 说明符 —— 这类行只用于“证明旧说明符已归零”（§A.3 ⑤）。

```bash
python3 - <<'PY'
import re, sys
DOC = ".easyvibe/development_docs/liyuhang/1_requirements_matrix/2026-10-26-23-29-serverApiSubmoduleSplit-v6.md"
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
    if ln.startswith("`" * 3):   # 避免字面三反引号提前闭合代码块
        in_fence = not in_fence; phase = None; continue
    if "PH-B0" in ln: phase = "B0"
    elif "PH-F" in ln: phase = "F"
    if not in_fence: continue
    if "zero-guard" in ln: continue
    if phase == "F" and SPEC_B0 in ln: stale.append(ln.strip()[:90])
    if phase is None and SPEC_B0 in ln: unlabeled.append(ln.strip()[:90])

# 规则 4（本版新增）：Phase=F 的 A 行，证据列不得出现 M1（B0 基线）
mismatch = []
for ln in lines:
    norm = ln.replace("*", "")
    if not re.match(r'^\|\s*A-\d\d\s*\|', norm): continue
    cells = [c.strip() for c in norm.strip().strip("|").split("|")]
    if len(cells) >= 6 and cells[2] == "F" and re.search(r'\bM1\b', cells[5]):
        mismatch.append((cells[0], cells[5][:40]))

print(f"criteria_total={rows}")
print(f"criteria_phase_tagged={rows - len(untagged)}")
print(f"stale_specifier_in_PHF={len(stale)}")
print(f"unlabeled_utils_command={len(unlabeled)}")
print(f"phase_evidence_mismatch={len(mismatch)}")
for x in untagged: print("  untagged:", x)
for x in stale: print("  stale:", x)
for x in unlabeled: print("  unlabeled:", x)
for x in mismatch: print("  phase_mismatch:", x)
ok = rows == 29 and not untagged and not stale and not unlabeled and not mismatch
print("doc_audit=" + ("PASS" if ok else "FAIL"))
sys.exit(0 if ok else 1)
PY
# 本文档实测（2026-10-26 23:29，见 §0.5 E12）：criteria_total=29 criteria_phase_tagged=29
#   stale_specifier_in_PHF=0 unlabeled_utils_command=0 phase_evidence_mismatch=0 doc_audit=PASS
# 非空转验证：对 v5 文档 → criteria_total=28 ≠ 29 → FAIL；
#             把 A-25 的证据列改回 “M1 日志” → phase_evidence_mismatch=1 → FAIL。
```

### A.13 数值台账自审脚本（A-28 文档层；无需实施完成即可运行）

> 用途：① 台账行数；② 每行“相位/来源”必须非空；③ §6.5 的“期望值”列不得出现 `scope_files`（G-SCOPE）；④ 对可在当前 HEAD 复算的行做 B0 探针；⑤ **`l2_relative` 必须已定义且被引用**（第 5 轮打回 #2）。

```bash
python3 - <<'PY'
import re, sys, os, json, subprocess
DOC = ".easyvibe/development_docs/liyuhang/1_requirements_matrix/2026-10-26-23-29-serverApiSubmoduleSplit-v6.md"
text = open(DOC, encoding="utf-8").read()
lines = text.splitlines()

# ①～③ 文档层
ledger, bad_rows = 0, []
for ln in lines:
    if not re.match(r'^\|\s*(L\d\d)\s*\|', ln): continue
    ledger += 1
    cells = [c.strip() for c in ln.strip().strip("|").split("|")]
    if len(cells) < 6 or not cells[3] or not cells[4]: bad_rows.append(ln[:80])

crit_rows, scope_assertions = 0, []
for ln in lines:
    if re.match(r'^\|\s*A-\d\d\s*\|', ln.replace("*", "")):
        crit_rows += 1
        cells = [c.strip() for c in ln.strip().strip("|").split("|")]
        if len(cells) >= 5 and "scope_files" in cells[4]: scope_assertions.append(ln[:80])

# ⑤ l2_relative 定义与引用
l2_refs = text.count("l2_relative")
l2_defined = 1 if "#### A.13.2 `l2_relative` 定义与脚本" in text else 0

# ④ B0 探针（只复算可在当前 HEAD 直接测得的项）
def sh(cmd):
    return subprocess.run(cmd, shell=True, capture_output=True, text=True).stdout.strip()
py = lambda code: sh(f"python3 -c {json.dumps(code)}")
def anchor_match():
    conf = "apps/server/src/utils/conf/index.ts"
    src = open(conf, encoding="utf-8").read()
    m = re.search(r'resolve\(\s*import\.meta\.dirname\s*,\s*"([^"]+)"\s*\)', src)
    if not m: return 0
    p = os.path.realpath(os.path.normpath(os.path.join(os.path.dirname(conf), m.group(1))))
    return 1 if p == os.path.realpath("data") else 0
probe = {
 "L01_files": int(py("import glob,os;g=['apps/server/src/app.ts','apps/server/src/index.ts','apps/server/src/core.ts','apps/server/src/router.ts','apps/server/src/utils.ts','apps/server/src/remoteConnection.ts','apps/server/src/lib/**','apps/server/src/routes/**','apps/server/src/types/**','apps/server/src/utils/**','apps/server/scripts/**'];f=[p for x in g for p in glob.glob(x,recursive=True) if os.path.isfile(p) and p.endswith('.ts')];print(len(f))")),
 "L03_routes": int(sh("find apps/server/src/routes -name '*.ts' | wc -l")),
 "L04_endpoints": int(sh("grep -rhoE '(Router\\(\\)|router|app)\\.(get|post|put|patch|delete|all)\\(' apps/server/src/routes | wc -l")),
 "L05_use": int(sh("grep -c 'app.use' apps/server/src/router.ts")),
 "L06_app_lines": int(sh("wc -l < apps/server/src/app.ts")),
 "L07_utils_lines": int(sh("wc -l < apps/server/src/utils.ts")),
 "L08_facade": int(sh("grep -rl 'from \"@/utils\"' apps/server/src --include='*.ts' | wc -l")),
 "L10_deep": int(sh("grep -rho 'from \"@/utils/[a-zA-Z]*' apps/server/src --include='*.ts' | wc -l")),
 "L26_relative_escape": int(sh("grep -rn 'from \"\\.\\./' apps/server/src --include='*.ts' | grep -v '^apps/server/src/agent/' | wc -l")),
 "L12_server2agent": int(sh("grep -rn 'from \"@/agent' apps/server/src --include='*.ts' | grep -v '^apps/server/src/agent/' | wc -l")),
 "L13_agent2server": int(sh("grep -rn 'from \"@/utils' apps/server/src/agent --include='*.ts' | wc -l")) + int(sh("grep -rn 'from \"@/lib\\|from \"@/types' apps/server/src/agent --include='*.ts' | wc -l")),
 "L14_src_ts": int(sh("find apps/server/src -name '*.ts' | wc -l")),
 "L19_exports": len(json.load(open("apps/server/package.json")).get("exports", {})),
 "L24_anchor": anchor_match(),
}
expect = {"L01_files":237,"L03_routes":161,"L04_endpoints":162,"L05_use":161,"L06_app_lines":160,"L07_utils_lines":75,
          "L08_facade":145,"L10_deep":246,"L26_relative_escape":2,"L12_server2agent":23,"L13_agent2server":71,
          "L14_src_ts":263,"L19_exports":14,"L24_anchor":1}
mismatch = {k:(v,expect[k]) for k,v in probe.items() if v != expect[k]}
print(f"ledger_rows={ledger}")
print(f"bad_ledger_rows={len(bad_rows)}")
print(f"criteria_rows={crit_rows}")
print(f"scope_assertions={len(scope_assertions)}")
print(f"l2_relative_occurrences={l2_refs}")
print(f"l2_relative_defined={l2_defined}")
print(f"probe={probe}")
print(f"probe_mismatch={len(mismatch)} {mismatch}")
ok = (ledger == 32 and not bad_rows and not scope_assertions and l2_defined == 1
      and l2_refs >= 5 and not mismatch)
print("ledger_probe=" + ("PASS" if ok else "FAIL"))
sys.exit(0 if ok else 1)
PY
# 期望（本文档实测，§0.5 E12）：ledger_rows=32 bad_ledger_rows=0 criteria_rows=29 scope_assertions=0
#   l2_relative_occurrences>=5 l2_relative_defined=1 probe_mismatch=0 ledger_probe=PASS
# 非空转验证：把 §6.5 某行的期望改成含 scope_files → scope_assertions=1 → FAIL；
#             把台账 L20 的 21 改成 22 → probe_mismatch=1 → FAIL；
#             删掉 §A.13.2 → l2_relative_defined=0 → FAIL。
```


#### A.13.2 `l2_relative` 定义与脚本（A-29 的唯一来源）

> 第 5 轮打回 #2 的处置：`l2_relative` 有 **4 处字面引用**（§1.6.2 例外、§6.7 规则 4、R18 缓解、§A.3 ③ 注），另有 **1 处等价正文规则**（§3.3 L2 硬规则 5 只写了“入口用相对路径”，未写子项名），但**从未定义**（§A.13 脚本里没有该检查、A-28 的期望列也没有它）。本节给出定义、子项、脚本、期望与非空转验证，**上述 5 处一律指回本节**。

**子项定义（5 项，逐项可判）**

| 子项 | 断言 | 期望 | 反例（必须 FAIL） |
| --- | --- | --- | --- |
| `lr1` | 9 个 L2 文件全部存在（G-EXIST：7 个入口 + `types/module.ts` + `lib/mentionSources.ts`） | `1` | 少任一入口 → `0` |
| `lr2` | 逐入口下限：`assetLibrary / mediaGeneration / pluginMarket / mcpIntegration / localRuntime` 各 **≥1 处**对自家域内的相对 import（`from "./…"`）；`agentAccess / platformCore` 允许 0（前者只依赖 `@/agent`，后者只依赖 `@/lib`） | `7`（7 个入口全部达下限） | 某入口把 `./assets/thumb` 改成 alias → `6` |
| `lr3` | 7 个入口的**自引用 alias**（`from "@/modules/<自身>"`）计数 | `0` | 入口 import `@/modules/assetLibrary/assets/thumb` → `>0` |
| `lr4` | 7 个入口的**跨模块 alias**（`from "@/modules/<其他>"`）计数 | `0` | 入口 import `@/modules/pluginMarket` → `>0` |
| `lr5` | 2 个非 `modules/**` 的 L2 文件对 `@/modules/**` 的 import 计数 | `0` | `types/module.ts` 运行期 import 模块 → `>0` |

**为什么 `lr2` 用“逐入口下限”而不是“全部等于 1”**：`agentAccess` 入口只做 `await import("@/agent/a2a")`（`@/agent` 不算 `@/modules`），`platformCore` 入口只导出 `@/lib/**` 的中间件契约 —— 若要求它们也必须有 `./` 相对 import，判据将**不可达**（这正是第 4/5 轮反复出现的失效模式）。下限表让期望值 `7` 在“5 个必须、2 个允许 0”的结构下**必然可达**。

**为什么 `lr4` 必须为 0**：§A.3 ③ 的 `103` 段统计“`src/modules/**` 内 `from "@/modules/` 的行数”，其值等于 B0 的 `utils` 段 `103`（同额迁移）。入口是**新增**文件，一旦出现 `@/modules/...`，103 会被顶高，A.29 的 103 判据与 A-29 同时失真。因此“入口不得 import 其它模块”是形态约束，不是风格偏好。

```bash
cat > /tmp/probe_l2_relative.py <<'PY'
import os, sys, re
ENTRIES = {
  "assetLibrary":    "apps/server/src/modules/assetLibrary/index.ts",
  "mediaGeneration": "apps/server/src/modules/mediaGeneration/index.ts",
  "pluginMarket":    "apps/server/src/modules/pluginMarket/index.ts",
  "mcpIntegration":  "apps/server/src/modules/mcpIntegration/index.ts",
  "localRuntime":    "apps/server/src/modules/localRuntime/index.ts",
  "agentAccess":     "apps/server/src/modules/agentAccess/index.ts",
  "platformCore":    "apps/server/src/modules/platformCore/index.ts",
}
# 逐入口相对 import 下限（可达性；见上表说明）
MIN_REL = {"assetLibrary": 1, "mediaGeneration": 1, "pluginMarket": 1, "mcpIntegration": 1,
           "localRuntime": 1, "agentAccess": 0, "platformCore": 0}
OTHER = ["apps/server/src/types/module.ts", "apps/server/src/lib/mentionSources.ts"]
REL = re.compile(r'from\s+"(\.{1,2}/[^"]*)"')
ALIAS = re.compile(r'from\s+"@/modules/([A-Za-z]+)')

paths = [*ENTRIES.values(), *OTHER]
missing = [p for p in paths if not os.path.isfile(p)]
rows, lr2 = [], 0
for mid, p in ENTRIES.items():
    txt = open(p, encoding="utf-8").read() if os.path.isfile(p) else ""
    rel = len(REL.findall(txt))
    aliases = ALIAS.findall(txt)
    self_alias = sum(1 for a in aliases if a == mid)
    cross_alias = sum(1 for a in aliases if a != mid)
    ok = rel >= MIN_REL[mid]
    lr2 += 1 if ok else 0
    rows.append((mid, rel, MIN_REL[mid], self_alias, cross_alias, ok))
lr5 = sum(len(ALIAS.findall(open(p, encoding="utf-8").read())) for p in OTHER if os.path.isfile(p))
lr1 = 0 if missing else 1
lr3 = sum(r[3] for r in rows)
lr4 = sum(r[4] for r in rows)
for mid, rel, mn, sa, ca, ok in rows:
    print(f"  entry={mid:<15} relative={rel} min={mn} self_alias={sa} cross_alias={ca} ok={int(ok)}")
print(f"  missing={len(missing)} {missing}")
print(f"l2_relative: lr1_exist={lr1} lr2_entry_relative_ok={lr2} lr3_self_alias={lr3} lr4_cross_alias={lr4} lr5_other_alias={lr5}")
ok = (lr1, lr2, lr3, lr4, lr5) == (1, 7, 0, 0, 0)
print("l2_relative=" + ("PASS" if ok else "FAIL"))
sys.exit(0 if ok else 1)
PY

python3 /tmp/probe_l2_relative.py
# PH-F 期望：lr1_exist=1 lr2_entry_relative_ok=7 lr3_self_alias=0 lr4_cross_alias=0 lr5_other_alias=0
#             l2_relative=PASS
# 非空转验证（评审可自证）：
#   ① 删掉某入口的一条相对 import（使该入口 relative=0 且 MIN_REL=1）→ lr2=6 → FAIL；
#   ② 把某入口的 ./assets/thumb 改成 @/modules/assetLibrary/assets/thumb → lr3=1 → FAIL；
#   ③ 在某入口加 import ... from "@/modules/pluginMarket" → lr4=1 → FAIL。
```

> **可达性（G-POS）**：本判据只存在于 F 相（入口是 L2 新文件）。可达性由两条保证：① `lr1` 先做存在性守卫，缺文件直接 FAIL（不会“空转通过”）；② `lr2` 是**正向计数**（必须 ≥1 的入口确实要有相对 import），不是零命中判据 —— 若实施者把入口写成纯 alias，`lr2` 会掉到 4 以下，判 FAIL。

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

## 附录 B：与第 5 版的关键差异（逐条）

| # | 位置 | 第 5 版 | 第 6 版 | 类型 |
| --- | --- | --- | --- | --- |
| 1 | §A.7.6 | `f2` 悬空引用（指向 g 组，g 组无该判据） | `f2a`（静态锚点）/ `f2b`（显式目录运行时）/ `f2c`（跨模块相对路径）三条可执行判据 + 脚本 | **打回 #1 修正** |
| 2 | §A.7.6 | `f4`/`f5` 只写“运行时探针” | 完整 bun 探针脚本（`/tmp/probe_semantics.ts`），输出 `f4_resolved/f4_unhandled/f5_tools_equal/f5_marker` 四字段 | **打回 #1 修正** |
| 3 | §A.7.6 | `f1b 1 'warmup\(' app.ts`（B0 = 0，不可达） | `f1b`（B0，`sweepThumbnailCache\(` = 1）+ `f1c`（F，入口 = 1）+ `f1d`（F，入口 `void import` = 1） | 自查 S1 |
| 4 | §A.7.6 | “只读注入下 `createApp` 仍 resolve” | 只读注入实测会让 `conf` 初始化 `EACCES`（合法 reject）→ 改为**缓存布局损坏注入** | 自查 S3 |
| 5 | §A.13.2（新增） | `l2_relative` 被引用 5 处、定义 0 处 | 5 个子项 `lr1–lr5` + 脚本 + 非空转验证；A-29 独立验收 | **打回 #2 修正** |
| 6 | §1.6.6（新增） | 无相位规则；A-25/A-26 用 M1 充当 F 证据 | M1（B0 基线）/ M7（F 相）分离；§A.12 规则 4 机械判定 | **打回 #3 修正** |
| 7 | §3.1 / §4 / §6.5 | 无数据目录锚点需求 | **R-15**（锚点深度补偿 + 相对路径深度补偿）+ `f2a/f2b/f2c` + A-25 | 自查 S2 |
| 8 | §A.3 ③ | `apps/server/src/modules/**`（依赖 shell `globstar`，会漏扫） | `--include='*.ts'`；并可引用 `lr4=0` 作为前提 | 自查 S5 |
| 9 | §6.9 | L01–L23 | **L01–L32**（新增 L24–L32 覆盖探针与形态） | 自查 S6 |
| 10 | A-27 / A-28 | 28 项 / 23 行台账 | **29 项**（+A-29）/ **32 行**台账 | 自查 S6 |
| 11 | §6.6 | 8 条清零规则 | **10 条**（+证据相位、+可执行性） | 打回 #1/#3 的制度化 |
| 12 | §9 | M0–M6；M1 兼作 F 证据 | **M0–M7**；M1 只作基线、M7 出 F 证据 | 打回 #3 |
| 13 | §10 | Q1–Q11 | **Q1–Q12**（+锚点修法） | R-15 |
| 14 | §A.7.8 | 判据对照表含 `f2` 悬空行 | 逐 label 给出 phase / expect / scope_min / 证据 | 打回 #1 |
| 15 | §0.5 | 14 组命令（不含 f/g 探针） | 12 组含 **f/g 探针的真实输出**（E5–E11） | 打回 #1 |

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
| **第 5 轮打回 #1**（f2/f4/f5 缺可执行命令） | 判据不可执行 / 悬空引用 | R-14、R-03 | A-25、A-26、A-27 | §0.1#1、§A.7.6、§6.6 规则 10 |
| **第 5 轮打回 #2**（`l2_relative` 未定义） | 5 处引用 0 处定义 | R-01、R-04、R-14 | A-29、A-28 | §0.1#2、§A.13.2、§6.10 |
| **第 5 轮打回 #3**（A-25/26 证据误指 M1） | 相位混淆（B0 证据判 F） | R-14 | A-27、A-25、A-26 | §0.1#3、§1.6.6、§9 M1/M7、§A.12 规则 4 |
| 自查 S1（`f1b=1` 不可达） | 期望值与 B0 事实不符 | R-14 | A-25、A-27 | §0.2 S1、§A.7.6、L27 |
| 自查 S2（默认目录锚点漂移） | 迁移深度未登记 | **R-15** | A-25（f2a/f2b/f2c） | §0.2 S2、§4 R-15、L24/L26 |
| 自查 S3（只读注入不成立） | 探针设计错误 | R-14 | A-25 | §0.2 S3、§A.7.6 注 |
| 自查 S5（`modules/**` globstar） | 命令口径依赖 shell | R-14 | A-27 | §0.2 S5、§A.3 ③ |

---

## 附录 F：本版结论摘要（给评审的一页纸）

1. **打回 #1（f2/f4/f5 缺可执行命令）**：不是“补几句说明”，而是给出**能跑的探针**：`f2a` 静态解析锚点（本轮实测 `anchor_match=1`）、`f2b` 显式目录运行时（实测 `conf.path` 落在临时目录且仓库 `data/settings.json` md5 不变）、`f4`/`f5` 的 bun 探针（实测 `f4_unhandled=0`、`f5_tools_equal=1 f5_marker=rev1`）。诊断过程中还发现两件事：`f1b` 的期望在 B0 不可达（S1），以及“只读数据目录”这种注入方式根本不能表达“步骤 5 吞错”（S3）——两者都已改判据而不是改叙述。
2. **打回 #2（`l2_relative` 未定义）**：新增 §A.13.2，5 个子项各自可判，并刻意把 `lr2` 定义为**逐入口下限**（5 个入口 ≥1 处相对 import、2 个允许 0），避免又一次写出“不可达期望”；A-29 独立成像，5 处引用全部指回定义。
3. **打回 #3（A-25/26 证据误指 M1）**：M1 定义是“B0 上的探针”，而这两项是 `Phase=F`。本版把它们拆成 **M1（基线）/ M7（判定）**，并把“`Phase=F` 的证据不得含 M1”做成 §A.12 的规则 4（`phase_evidence_mismatch`），下一次同类错误会被脚本直接判 FAIL。
4. **顺带修掉一个真实缺陷（S2）**：`conf` 的默认数据目录用 5 级相对路径锚定 `<repo>/data`，R-04 迁移会把它移深 1 级 → 默认目录静默漂移到 `apps/data`。三宿主都显式传 `dataDirectory`，所以线上不爆，但这属于 NG4 的破坏。已立 **R-15** 并给出 `f2a/f2b/f2c` 三条判据与 L24/L26 台账。
5. **验收方式不变**：问题消除 + 审查通过；无法消除项（E1–E12）按 §8 模板结构化豁免，逐条给理由、替代缓解与复核触发条件。
6. **本轮产物**：仅新增本文件 + 更新 `INDEX-2026-10.md`；`apps/server` 零改动（`git status --porcelain apps/server` 为空）。
