# 需求矩阵 · server-api 应用子模块拆分（第 3 版 · 第 2 轮打回后重做）

## 0. 文档元信息

| 项 | 内容 |
| --- | --- |
| 文档编号 | **REQ-2026-10-26-03** |
| 版本 | 第 3 版（替代 REQ-2026-10-26-02） |
| 需求来源 | 架构地图关注点 `c-server-api-1`（`.easyvibe/map/map.json`） |
| 需求标题 | server-api 按素材库 / 媒体生成 / 插件市场 / MCP·工作区拆出应用子模块，`app.ts` 只保留组合根与路由装配 |
| 影响模块 | `server-api`（`apps/server`） |
| 需求类型 | 结构性重构（架构整改），**不改变任何业务行为** |
| 当前状态 | **待评审（第 3 版）**；业务代码零改动，仅新增/更新需求文档与索引 |
| 编写人 | 需求分析 agent（harness 规则 2.1） |
| 编写时间 | 2026-10-26 21:55 |
| 基线 | `git HEAD = d084136`；`.easyvibe/map/map.json` 生成于 `2026-10-26T21:13:59+08:00` |
| 上一版 | `2026-10-26-21-36-serverApiSubmoduleSplit-v2.md`（REQ-2026-10-26-02，**第 2 轮打回**） |
| 验收口径 | 问题消除 + 审查通过；无法消除项按 §8 结构化豁免说明登记；验收按 §6.5 二值判定表执行 |

### 0.1 第 2 轮打回意见逐条处置（本版核心修订）

| # | 打回意见 | 本版处置（可核对） | 落点 |
| --- | --- | --- | --- |
| 1 | **文件审计 237/237 与“每模块 +2 新文件”自相矛盾** | 废止“每模块 +2（入口 + 初始化适配）”的笼统表述；改为 **L1 存量台账 / L2 新增台账 / L3 交付台账** 三本账。`237/237` **只用于 L1 存量归属**；交付态默认 **246**（L2 默认 9 个新文件，L3 = 237 + 9 = 246；Q8/Q9 改选时按决策重算）；初始化适配写入模块入口，不新增文件；路由分组不新增文件。三本账的等式、文件清单、行数上限和“禁止隐藏文件”规则见 §3.2、§3.3、§6.3、R-12。 | §3.2、§3.3、§6.3、R-12 |
| 2 | **R-07D 的“单向”与 E10 冲突** | 删除任何“模块级依赖单向 / DAG”承诺。新增 **边级方向口径**：逐条列出源文件:行、目标文件、type/value、当前计数、反向计数；明确 `platformCore` 不是叶子，`platformCore → localRuntime`（1 value）与 `platformCore → mediaGeneration`（1 value）保留并登记 E10。R-07D **只承诺** `conf → teams/mobileLink` 的 2 条 type 边归零、`platformCore → pluginMarket` 归零；不承诺模块级无环。模块级 SCC 与 file 级 SCC 分开登记（E12 / E11）。 | §2.4、§4 R-07、§4 R-13、E10、E12 |
| 3 | **`dxt ↔ servers` 环未登记正确豁免** | 新增 **R-07E** 与 **E11**：给出 `utils/mcp/dxt.ts:10 → servers`、`utils/mcp/servers.ts:8 → dxt` 两条 value 边；说明其为 **mcpIntegration 模块内** 的 2 文件 SCC；给出“R-07D 后仅剩此 SCC”的模拟结果；按 §8.4 填满结构化豁免模板；同时给出可选的 `bundle.ts` 消除方案与成本（Δ+1、mcp 21→22、final 246→247），由 Q8 决策。 | §4 R-07E、§8.2 E11、§8.4、Q8 |
| 4 | **验收不可判定** | 新增 **A-01～A-24 二值判定表**（§6.5）：每条验收均有命令/产物、期望值、证据位置、通过规则；新增“不可判定项清零规则”（§6.6）：禁止“基本/尽量/合理/约”，所有 diff 给出归一化规则；所有二选一事项进入 Q1～Q10 并给出**默认值**，未记录时按默认值执行。 | §6.5、§6.6、§10 |

> 说明：第 1 轮已复算的 237/14,349/161/187 在本版重新复算并保留；本版新增的 228/13,955（地图详细快照）与 9/394（HEAD 增量）是**对账数据**，不是替代基线，见 §1.2。

### 0.2 本版相对第 2 版的关键变更

| 项 | 第 2 版 | 第 3 版 |
| --- | --- | --- |
| 文件审计 | `237/237` 与“每模块 +2”混用 | L1=237/237；L2=9；L3=246；三本账分离 |
| 新文件 | 上界式“+2/模块” | 默认 7 个模块入口 + `src/types/module.ts` + `src/lib/mentionSources.ts` = **9 个**（Q8/Q9 改选除外） |
| 初始化适配 | 可能新增 adapter 文件 | 写入模块入口 `initialize/mount`，**不新增文件** |
| 路由分组 | 可能新增 7 个适配文件 | 生成式写入 `router.ts`/`core.ts`，**不新增文件**；默认 E4 |
| R-07D | “pluginMarket/localRuntime → platformCore 单向” | 删除单向承诺；边级判定；模块级 SCC 登记 E12 |
| E10 | 6 条“单向弱边” | **7 条**残余弱边，逐条列反向计数；含 v2 漏掉的 `localRuntime → mediaGeneration`（ffmpeg） |
| dxt↔servers | 只在风险 R4 提及，挂 E5/E1 | 独立 R-07E + E11 结构化豁免 + Q8 |
| 地图对账 | 未解释 228 vs 237 | §1.2 逐模块对账：228/13,955 + 9/394 = 237/14,349 |
| 冒烟 | 13 项 + S1–S4 | 13 项 + S1–S8（补齐 5 类插件内置清单消费） |
| 决策点 | Q1–Q7 | Q1–Q10（+ dxt 环、L2 口径、模块级 SCC） |

### 0.3 覆盖度 / 可测性 / 无歧义自检

| 维度 | 本版怎么保证 | 可核对位置 |
| --- | --- | --- |
| **覆盖度** | 4 条打回意见 + c-server-api-1 + P1–P5 + AGENTS 约束 + 地图 228 滞后 + file SCC 全部映射到 R/A/E/Q | §0.1、附录 E |
| **可测性** | 24 条二值验收（A-01～A-24），每条有命令/产物、期望值、证据位置；13 项 + S1–S8 冒烟有 fixture/基线；三本账有审计伪代码 | §6.5、§R-10、§R-12、附录 A |
| **无歧义** | 术语表 §1.5；计数规则 §3.5；diff 归一化 §6.6；Q1–Q10 全部有默认值；E10 有反向计数；E11/E12 有完整模板；不承诺模块级 DAG | §1.5、§3.5、§6.6、§10、§8.2、§8.4 |

---

## 1. 背景

### 1.1 现状量化（HEAD 实测，2026-10-26 21:55 复算）

| 指标 | 实测值 | 核验方式 |
| --- | --- | --- |
| server-api 文件 / 行数 | **237 文件 / 14,349 行** | 附录 A.1 的 glob（含 `src/**` 非 agent 部分与 `scripts/**`） |
| 路由文件 | **161** | `find apps/server/src/routes -name '*.ts' \| wc -l` |
| 注册端点 | **187**（GET 67 / POST 79 / PUT 20 / DELETE 11 / ALL 8 / PATCH 2） | 逐文件提取 `.get/.post/...` |
| `router.ts` | **327 行 / 161 条 `app.use`** | `wc -l`、`grep -c 'app.use'` |
| `app.ts` | **160 行** | `wc -l` |
| `utils.ts` | **75 行 / 37 个出口 / 5 个来自 `@/agent`** | 读文件逐 key 计数 |
| `import u from "@/utils"` | **145 个文件**，其中 **144/161 个路由文件** | `grep -rl 'from "@/utils"'` |
| 深路径 `@/utils/<域>` | **246 处** | `grep -rho 'from "@/utils/[a-zA-Z]*'` |
| server → agent | **23 行** = agentAccess 8 + bootstrap 5 + platformCore 3 + assetLibrary 3 + mcpIntegration 2 + pluginMarket 1 + localRuntime 1 | 排除 `src/agent/` 后 `grep 'from "@/agent'` |
| agent → server | `@/utils` **51 行**；`@/lib\|@/types` **20 行**；全部 `@/` **71 行** | 分别 grep；地图 73 处含 call 口径 |
| `@toonflow/server/*` 外部契约 | **14 个 export / 36 个文件 / 57 处引用** | `apps/server/package.json` + 排除 `apps/server/` 后 grep |
| 地图详细快照 | **228 文件 / 13,955 行** | `.easyvibe/map/modules/server-api.json` 的 `parent.files_snapshot` |
| 地图顶层声明 | **237 文件 / 14,349 行** | `.easyvibe/map/map.json` 模块 health/review_note |
| 子模块内最大文件 | `utils/assets/library.ts` 729 行、`utils/media/provider.ts` 498 行、`utils/plugins/install.ts` 450 行 | `wc -l` |
| 地图健康度 | 模块分 **50**，标记 `god_module` / `circular_dep` / `coupling_high` | `map.json` |

### 1.2 地图详细快照 228 与 HEAD 237 的逐模块对账（本版新增）

地图顶层写 237/14,349，但 `modules/server-api.json` 的 `parent.files_snapshot` 只有 228/13,955。差额是 **9 个 HEAD 已存在、快照未收录的文件（394 行）**，加上 2 处语义归属差异（`documents.ts`、`fileHttp.ts`）。不是两套数字冲突，而是**快照滞后 + 归属口径不同**。

**9 个滞后文件（HEAD 已存在）：**

| # | 文件 | 行数 | 本版归属 |
| --- | --- | --- | --- |
| 1 | `apps/server/src/routes/agent/compact.ts` | 24 | agentAccess |
| 2 | `apps/server/src/routes/agent/fork.ts` | 15 | agentAccess |
| 3 | `apps/server/src/routes/agent/rewind.ts` | 15 | agentAccess |
| 4 | `apps/server/src/routes/ai/generate/stop.ts` | 17 | mediaGeneration |
| 5 | `apps/server/src/routes/sessionState/get.ts` | 12 | agentAccess |
| 6 | `apps/server/src/routes/sessionState/patch.ts` | 17 | agentAccess |
| 7 | `apps/server/src/routes/workspaces/files/thumb.ts` | 37 | localRuntime |
| 8 | `apps/server/src/utils/ai/runs.ts` | 52 | mediaGeneration |
| 9 | `apps/server/src/utils/sessionState/index.ts` | 205 | agentAccess |
| — | **合计** | **394** | — |

**逐模块对账：**

| 模块（地图 id） | 地图快照 文件/行 | 调整 | HEAD 文件/行 | 调整说明 |
| --- | --- | --- | --- | --- |
| bootstrap_wiring | 8 / 710 | 0 | **8 / 710** | 一致 |
| asset_library | 27 / 2,615 | 0 | **27 / 2,615** | 一致 |
| ai_media_providers | 39 / 2,851 | +1 文件 `documents.ts`（74）+1 `ai/runs.ts`（52）+1 `generate/stop.ts`（17） | **42 / 2,994** | 文档解析归媒体生成；新增运行注册表/停止端点 |
| plugin_ecosystem | 49 / 2,283 | 0 | **49 / 2,283** | 一致 |
| mcp_integration | 20 / 1,433 | 0 | **20 / 1,433** | 一致 |
| local_runtime | 46 / 2,272 | −`documents.ts`（74）−`fileHttp.ts`（40）+`workspaces/files/thumb.ts`（37） | **45 / 2,195** | 2 文件语义归位；新增工作区缩略图端点 |
| agent_orchestration | 20 / 905 | +compact 24 +fork 15 +rewind 15 +sessionState get 12 +patch 17 +sessionState util 205 | **26 / 1,193** | 新增会话回退/复制/压缩/会话状态 |
| http_core | 19 / 886 | +`fileHttp.ts`（40） | **20 / 926** | `sendFile` 是 Express 横切工具 |
| **合计** | **228 / 13,955** | **+9 文件 / +394 行** | **237 / 14,349** | **228 + 9 = 237；13,955 + 394 = 14,349** |

> 结论：本矩阵的权威基线是 **HEAD 实测 237/14,349**；地图详细快照是滞后的 228/13,955。R-09 要求地图重算后必须回到 237/14,349（实施后按 L3 的 246 文件 / ≤14,839 行重新切分），并在模块清单中记录上述 9 文件与 2 归属差异。

### 1.3 问题陈述（5 个可独立验证的根因）

- **P1｜边界只存在于目录名，没有模块契约对象。** 21 个 `/api/*` 路由目录、15 个 `utils/*` 子目录在语义上已分域，但没有“模块入口”声明（职责、路由前缀、初始化钩子、对外导出、依赖清单）。地图只能把 237 个文件登记为 1 个模块，评分 50。
- **P2｜组合根承担业务初始化。** `createApp` 内联了 6 类插件目录初始化与内置清单扫描、供应商源码哈希、缩略图缓存预热、供应商模型刷新、MCP/A2A 网关挂载、移动互联运行时初始化；`app.locals.builtinPlugins` 由组合根生产，5 组路由消费。
- **P3｜全局聚合入口锁死编译期依赖闭包。** `utils.ts` 把 34 个 namespace（含 `@/agent`）聚合成单对象，145 个文件直接依赖；即使目录拆开，任一域改动仍牵动同一闭包。
- **P4｜跨域调用隐式且方向混乱。** 典型：素材库 3 处 + 工作区 1 处 import `@/agent/mentionSources`；插件安装内核被 MCP/团队复用；`conf` 与 `teams`/`mobileLink` 构成类型/值混合环；`dxt ↔ servers` 构成模块内运行期环。
- **P5｜路由装配是 161 条扁平挂载。** `router.ts` 327 行、无分组常量；新增/移动任一接口整文件重写，评审 diff 与并行开发冲突成本高。

### 1.4 约束（来自 `AGENTS.md`，直接决定难度与风险）

| 约束 | 出处 | 对本需求的影响 |
| --- | --- | --- |
| **一个接口一个文件**，`routes/**/*.ts` 全量扫描，URL 由文件相对路径决定 | AGENTS「目录结构」「路由与路径规则」 | 目录重组会直接改变 URL；方案 B 保持 `routes/` 位置不动，方案 C 才改 `core.ts` 生成器并逐条保证 URL 不变 |
| **通用工具统一 `import u from "@/utils"`**，导出由 `utils.ts` 管理 | AGENTS「引用与代码风格」 | 合并/拆分聚合入口属于规范变更，需同步改 AGENTS.md |
| **不为简单接口额外搭 controller / service / repository 层** | AGENTS「目录结构」 | 子模块只能是“路由 + 域工具 + 模块入口”，不得引入分层样板 |
| **禁止新增测试/自检代码** | AGENTS「测试与检查边界」 | 回归只能靠 `typecheck` + `build` + 端点清单 diff + 手工 HTTP 冒烟；冒烟脚本不提交为测试文件 |
| `app.ts` 不监听端口、不建 worker；桌面/移动复用 `@toonflow/server/app` | AGENTS「技术栈与职责」 | `createApp` 对外签名与 `@toonflow/server/*` exports 必须保持兼容 |
| 文件/目录小驼峰、双引号、分号、两空格 | AGENTS 通用规范 | 新模块目录使用 `assetLibrary` / `mediaGeneration` 等小驼峰 |

### 1.5 术语与计数口径（消除歧义的第一道闸）

| 术语 | 定义 | 本矩阵中的使用 |
| --- | --- | --- |
| **B0 基线** | `git HEAD = d084136` 时 `apps/server` 的 237 个文件、14,349 行、161 路由文件、187 端点 | 所有“不新增/不变”判据的对照 |
| **L1 存量台账** | B0 的 237 个文件逐一归属到 8 个模块；每文件恰好一次 | `237/237`、`unassigned=0`、`duplicated=0` |
| **L2 新增台账** | 相对 B0 **净新建**的文件；本版固定 9 个 | `new_total=9`；移动/重命名不算新增 |
| **L3 交付台账** | B0 ∪ L2，按模块汇总；每文件恰好一次 | `final_total=246`；`246 = 237 + 9` |
| **业务实现文件** | B0 的 237 个文件（含既有 `index.ts` 与路由文件） | 单模块 ≤50 |
| **契约/装配文件** | L2 的 9 个新文件（模块入口、模块契约类型、共享 mention 类型） | 计入“含契约 ≤55 文件 / ≤3,300 行”，不计入业务 ≤50 |
| **移动** | 同一文件从旧路径到新路径，文件数与行数不变 | 不改变 L1/L2/L3 计数；必须登记 old→new 映射 |
| **新增** | B0 中不存在、实施后存在的文件 | 只允许 L2 的 9 个；其他一律违规 |
| **删除** | B0 中存在、实施后不存在的文件 | 只允许“移动”导致的消失；净删除必须为 0 或登记 |
| **直接边** | `from "@/utils/<域>/..."`、`from "@/lib/..."`、`from "@/types/..."` 等深路径 import；R-04 后 `@/utils/<域>` 归一化为 `@/modules/<域>` | R-07 / E10 / 模块白名单的统计对象；计数按路径归一化后比较 |
| **Facade 边** | `from "@/utils"`（聚合入口 `u`） | 归 bootstrap 组合根，不计入域模块直接边；由 R-06/E12 管理 |
| **type / value 边** | `import type` / `import { type X }` 为 type；其余为 value | 逐条标注，禁止把 type 边当 value 边 |
| **模块级 SCC** | 以 8 个模块为节点、直接边为弧的强连通分量 | 本版明确：**不承诺模块级 DAG**；见 §2.4 |
| **file 级 SCC** | 以 237 个文件为节点、import 为弧的强连通分量 | 用于证明 R-07D 消除跨模块环、E11 保留模块内环 |
| **弱边** | 单向或双向但数量小（通常 1 条 import）的跨模块直接边 | E10 逐条冻结；不得新增 |
| **计数 0** | 指定 grep 命令的输出行数为 0 | 不用“基本没有/几乎没有” |
| **diff 为空** | 按 §6.6 的归一化规则处理后，字符串完全相等 | 时间戳/随机 ID/绝对路径/端口/临时哈希置零；数组顺序不变 |

---

## 2. 目标与非目标

### 2.1 目标

- **G1｜模块切开且预算自洽**：`server-api` 由 1 个 237 文件模块拆为 **8 个模块（1 个组合根 + 7 个应用子模块）**。
  - **L1 存量**：237/237，无孤儿、无重复。
  - **L2 新增**：固定 9 个文件（§3.3），不得有清单外新增。
  - **L3 交付**：246 文件 / ≤14,839 行；`246 = 237 + 9`。
  - **业务实现**：单模块 ≤50 文件；现状 `pluginMarket` 49 为最大值，加 1 个入口后业务仍 49、交付 50。
  - **含契约/装配**：单模块 ≤55 文件 / ≤3,300 行；现状最大 `mediaGeneration` 42+1=43 / 2,994+60=3,054，余量 246 行。
- **G2｜组合根瘦身**：`app.ts` 只保留组合根职责（参数归一、全局中间件顺序、模块装配、静态资源、统一错误处理），**≤80 行**，不再出现任何具体插件类型分支、供应商哈希、具体网关构造、移动运行时初始化。
- **G3｜HTTP 契约不变**：187 个端点的方法与路径 **100% 不变**；`@toonflow/server/*` 的 14 个 exports 与 `createApp` 签名不变；36 个外部引用文件 / 57 处引用可解析。
- **G4｜模块契约可读、依赖边可核对**：每个应用子模块有入口声明（职责、路由前缀、初始化钩子、对外导出、依赖白名单）；模块间**直接边计数**与 §2.4/附录 C 基线一致；不承诺模块级 DAG。
- **G5｜无法消除项结构化豁免**：每条未消除项按 §8 模板登记，写明理由、替代缓解、复核触发条件；E11/E12 为本版新增。

### 2.2 非目标（明确排除，避免范围蔓延）

- **NG1｜不做 AgentHost 端口化，不消除运行期双向依赖；但允许并只允许“非编排类工具/类型依赖下沉”。**
  - **不做**：不新建 AgentHost 端口、不改 `agent-runtime` 的会话运行时、不消除 19 处运行期/配置类依赖（agentAccess 8、platformCore 3、pluginMarket 1、mcpIntegration 2、utils.ts 5）、不消除 `agent → server` 的 51 处 `@/utils` 反向 import。
  - **做**：把 `MentionQuery` 与 `mentionAssetType` 下沉到 `src/lib/mentionSources.ts`，消除 **assetLibrary 3 处 + localRuntime 1 处** 对 `@/agent` 的 import；`agent/mentionSources.ts` 以相对路径 re-export，保持 `@toonflow/server/agent/mentionSources` 路径不变。
  - 这样 R-07 的“`assetLibrary` 对 agent 依赖归零”与 6.1 不再与 NG1 冲突：**归零的是 4 处非编排依赖，不是运行期编排依赖。**
- **NG2**：不抽前端 `contracts` 包、不改 web 的 `/api` 字面量（属 `c-web-console-1`）。
- **NG3**：不把 server 拆成多个 workspace 包（不新增 `packages/app-*`），不做跨包发布。
- **NG4**：不改任何接口行为、响应结构、鉴权语义、数据目录与插件安装语义。
- **NG5**：不做 5 组同构插件路由的去重、不拆 `library.ts` / `provider.ts` 巨型文件（可另立需求）。
- **NG6**：不新增测试文件、不新增第三方依赖、不引入 controller/service/repository 分层。

### 2.3 agent 依赖边界表（NG1 与 R-07 的唯一裁决口径）

| 边 | 现状证据 | 当前计数 | 类型 | 本期处理 | 验收 |
| --- | --- | --- | --- | --- | --- |
| `agentAccess → @/agent` | `utils/singleAgent/index.ts:7-11`、`routes/agent.ts:4,9`、`routes/singleAgent/run.ts:7` | **8 行** | 运行期 | **允许**（模块核心职责） | 允许 `agentAccess` 直接 import `@/agent`；不新增其他文件 |
| `utils.ts → @/agent` | `utils.ts:19-21,33,35` | 5 个出口 | 运行期 | **允许，豁免 E2** | 145 个 `u` 调用面不变；出口加归属注释 |
| `mcpIntegration → @/agent` | `utils/mcp/tools.ts:8-9` | 2 行 | 运行期 | **允许，豁免 E8** | 仅允许 MCP 工具运行 Agent；不扩散 |
| `platformCore → @/agent` | `utils/conf/index.ts:6`（`A2aSettings`，type）、`routes/settings/save.ts:6`、`routes/settings/systemPrompt.ts:3`（prompt 常量/上限，value） | **3 行**（1 type + 2 value） | 混合 | **允许，豁免 E7**；type 边随后续类型下沉可消除，2 处 value 保留 | 不新增第 4 处；模块依赖表标注 |
| `assetLibrary → @/agent` | `utils/assets/index.ts:5`（type）、`library.ts:5`、`thumb.ts:4` | **3 行**（1 type + 2 value） | 混合 | **消除**：下沉 `MentionQuery` + `mentionAssetType` 到 `src/lib/mentionSources.ts` | 归零（R-07 边 A） |
| `localRuntime → @/agent` | `routes/workspaces/files/thumb.ts:10` | **1 行** | 运行期 | **消除**：与 assetLibrary 同源下沉 | 归零（R-07 边 A） |
| `pluginMarket → @/agent` | `routes/agents/a2a/save.ts:8`（`getAgentModelConfiguration`） | **1 行** | 运行期 | **允许，豁免 E9**（A2A 插件配置需校验 Agent 模型） | 仅此 1 处；不新增 |
| `mediaGeneration → @/agent` | 无 | 0 | — | 保持 0 | `grep` 为 0 |

> 结论：server → agent 的 23 行 = **19 行保留（E2/E6/E7/E8/E9）+ 4 行消除（R-07A）**。R-07 与 6.1 只对“消除项”提出归零要求。

### 2.4 模块依赖方向与 SCC 口径（本版新增，直接回应“R-07D 单向 vs E10”）

**先定义测量基准：**

1. **直接边**：只统计深路径 import（`@/utils/<域>`、`@/lib`、`@/types` 等），**排除** `from "@/utils"` 的 facade 边。
2. **Facade 边**：`from "@/utils"` 是 145 个文件对组合根 `u` 的依赖，归 bootstrap；它制造“bootstrap ↔ 所有模块”的枢纽环，但不是域模块之间的业务依赖。E12 登记。
3. 方向按 **源文件 → 目标文件** 记录；同一对模块的双向边分别计数，不得合并成“单向”。

**直接域边基线（20 条；`lines` 为 import 行数，括号为 type/value）：**

| # | 源模块 → 目标模块 | lines | type | value | 反向 lines | 本期分类 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | agentAccess → platformCore | 51 | 1 | 50 | 0 | 强依赖（白名单） |
| 2 | agentAccess → pluginMarket | 1 | 0 | 1 | 0 | **E10** |
| 3 | assetLibrary → localRuntime | 8 | 0 | 8 | 3 | 强依赖（双向白名单） |
| 4 | assetLibrary → mediaGeneration | 1 | 0 | 1 | 0 | **E10** |
| 5 | assetLibrary → platformCore | 24 | 0 | 24 | 0 | 强依赖（R-07A 后 27，1t/26v） |
| 6 | localRuntime → assetLibrary | 3 | 0 | 3 | 8 | 强依赖（双向白名单） |
| 7 | localRuntime → mediaGeneration | 1 | 0 | 1 | 4 | **E10** |
| 8 | localRuntime → platformCore | 75 | 1 | 74 | 2（1t/1v） | 强依赖（R-07A 后 76，1t/75v） |
| 9 | mcpIntegration → localRuntime | 3 | 0 | 3 | 0 | **E10**（3 个 file:line） |
| 10 | mcpIntegration → mediaGeneration | 1 | 0 | 1 | 0 | **E10** |
| 11 | mcpIntegration → platformCore | 35 | 0 | 35 | 0 | 强依赖（白名单） |
| 12 | mcpIntegration → pluginMarket | 3 | 0 | 3 | 0 | **R-07C**（契约化后仍 3，深路径 0） |
| 13 | mediaGeneration → localRuntime | 4 | 0 | 4 | 1 | 强依赖（双向白名单） |
| 14 | mediaGeneration → platformCore | 63 | 0 | 63 | 1 | 强依赖（白名单） |
| 15 | platformCore → localRuntime | 2 | 1 | 1 | 75 | **R-07D 消 type；E10 留 1 value** |
| 16 | platformCore → mediaGeneration | 1 | 0 | 1 | 63 | **E10**（双向，不是单向） |
| 17 | platformCore → pluginMarket | 1 | 1 | 0 | 91 | **R-07D 归零** |
| 18 | pluginMarket → localRuntime | 6 | 0 | 6 | 0 | 强依赖（白名单） |
| 19 | pluginMarket → mediaGeneration | 1 | 0 | 1 | 0 | **R-07B**（契约化后仍 1，深路径 0） |
| 20 | pluginMarket → platformCore | 91 | 1 | 90 | 1 | 强依赖（白名单） |

> 注：`bootstrap → 7 个模块` 与 `7 个模块 → bootstrap` 的 facade 边不计入上表；bootstrap 是组合根，见 E12。上表 20 条是**基线**；R-07 后**计数**发生变化的只有 #5（24→27）、#8（75→76）、#15（2→1）、#17（1→0）与 server→agent 的 4 行；#12/#19 只改 import 路径、计数不变（3/1）。

**模块级 SCC（直接边，不含 bootstrap）：**

| SCC | 成员 | 说明 |
| --- | --- | --- |
| SCC-1（5 个域模块） | `assetLibrary`、`localRuntime`、`mediaGeneration`、`platformCore`、`pluginMarket` | **基线事实，本需求不承诺消除**。环由 #5/#6、#13/#7、#14/#16、#20/#17（R-07D 后 #17=0）等多对双向边构成 |
| SCC-2 | `agentAccess` | 单点；出边到 SCC-1，无回边 |
| SCC-3 | `mcpIntegration` | 单点；出边到 SCC-1/plugin，无回边 |
| 含 bootstrap | 8 个模块全部 | 因为 `utils.ts` facade 被 145 个文件引用，且 `router.ts` 挂载全部路由；E12 |

**file 级 SCC（用于证明 R-07D 的效果）：**

| 时点 | SCC 数量（>1） | 成员 | 结论 |
| --- | --- | --- | --- |
| B0 基线 | 2 | ① 13 文件跨模块 SCC（`conf`、`teams`、`mobileLink`、`plugins/install`、`skills/files`、`media/provider`、`ffmpeg`、`ai/visibility`、`plugins/{tools,nodes,ext}`、`workspace/{index,files}`）；② 2 文件 `mcp/dxt.ts ↔ mcp/servers.ts` | ① 的唯一回边是 `conf → teams`、`conf → mobileLink` 两条 **type** 边；② 模块内运行期环 |
| R-07D 后（模拟） | 1 | 仅 `mcp/dxt.ts ↔ mcp/servers.ts` | 13 文件跨模块 SCC 消失；只剩 E11 |
| R-07E 后（可选） | 0 | — | 需 Q8 决策；Δ+1 文件 |

> **裁决口径**：
> - R-07D 只承诺 **file 级** `conf → teams/mobileLink` 两条 type 边归零，**不承诺模块级无环**；`platformCore → localRuntime` 仍有 1 条 value 边（personalization），`platformCore → mediaGeneration` 仍有 1 条 value 边（settings/save），二者登记 E10。
> - E10 不再写“单向弱边”，改写为“**残余弱边（含反向计数）**”；每条都注明所属模块对是否在 SCC-1 内。
> - E12 登记模块级 SCC-1 与 bootstrap 枢纽环为**基线豁免**；本需求不以“模块级 DAG”为验收条件。


---

## 3. 目标边界（子模块切分）

### 3.1 子模块清单与预算

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
- 行数（L3 上限）：`750 + 2,675 + 3,054 + 2,343 + 1,493 + 2,255 + 1,253 + 1,016 = 14,839 = 14,349 + 490`；实际 L3 行数 = `14,349 + X`，`0 ≤ X ≤ 490`
- 端点：`0 + 20 + 28 + 49 + 13 + 43 + 22 + 12 = 187`
- 路由文件：`0 + 18 + 25 + 39 + 13 + 37 + 22 + 7 = 161`

> 说明：L3 行数中的 +490 是 L2 的**行数上限**（7×60 + 40 + 30），不是实际新增行数；实施时按实际值复核，实际值必须 ≤490，L3 行数必须 ≤14,839。
> 归属规则：L3 对 B0 文件按 §3.2 L1 的 glob 归属；对 L2 文件按 §3.2 L2 的显式 owner 归属。`src/types/module.ts` 虽在 `types/` 下，但 owner 是 **bootstrap**，不得按 `types/**` 归到 platformCore。

### 3.2 三本台账（L1 / L2 / L3）——本版解决“237/237 与 +2 矛盾”的核心

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

**L1 审计输出（必须逐字匹配）：**

```text
existing_total=237
existing_assigned=237
existing_unassigned=0
existing_duplicated=0
existing_orphan=0
```

> `237/237` **只表示 L1**：B0 的 237 个文件逐一归属、无孤儿、无重复。它**不表示**交付态只有 237 个文件。第 2 版的错误是把 L1 的 `237/237` 与“每模块 +2 新文件”并列，导致读者无法判断交付态到底是 237 还是 251；本版用 L2/L3 消除该歧义。

#### L2 新增台账（相对 B0 的净新建，默认 9 个；Q8/Q9 改选时重算）

| # | 新文件 | 归属模块 | 用途 | 行数上限 | 预算类别 |
| --- | --- | --- | --- | --- | --- |
| 1 | `apps/server/src/modules/assetLibrary/index.ts` | assetLibrary | 模块入口；调用既有 `utils/assets/thumb.ts` 的 `sweepThumbnailCache` | 60 | 契约/装配 |
| 2 | `apps/server/src/modules/mediaGeneration/index.ts` | mediaGeneration | 模块入口；调用既有 `utils/ai/initialize.ts` 完成 providers 目录/哈希/模型刷新 | 60 | 契约/装配 |
| 3 | `apps/server/src/modules/pluginMarket/index.ts` | pluginMarket | 模块入口；调用既有 `utils/plugins/initialize.ts` 完成五类插件初始化与 builtin 扫描 | 60 | 契约/装配 |
| 4 | `apps/server/src/modules/mcpIntegration/index.ts` | mcpIntegration | 模块入口；`/mcp` 挂载；调用既有 `utils/mcp/runtime.ts` | 60 | 契约/装配 |
| 5 | `apps/server/src/modules/localRuntime/index.ts` | localRuntime | 模块入口；调用既有 `utils/mobileLink/index.ts` 的 `initializeMobileLinkRuntime` | 60 | 契约/装配 |
| 6 | `apps/server/src/modules/agentAccess/index.ts` | agentAccess | 模块入口；动态 import `@/agent/a2a` 挂载 `/a2a` | 60 | 契约/装配 |
| 7 | `apps/server/src/modules/platformCore/index.ts` | platformCore | 模块入口；中间件/配置契约导出 | 60 | 契约/装配 |
| 8 | `apps/server/src/types/module.ts` | bootstrap | `ServerModule` / `ModuleContext` 统一契约类型（组合契约，不计域边） | 40 | 契约/装配 |
| 9 | `apps/server/src/lib/mentionSources.ts` | platformCore | 下沉 `MentionQuery`、`mentionAssetType` | 30 | 契约/共享 |
| — | **合计** | — | — | **490** | — |

**L2 审计输出（必须逐字匹配）：**

```text
new_total=9
new_unregistered=0
new_line_cap_total=490
```

**L2 硬规则：**

1. **不新增初始化适配文件**：`initialize/mount` 写在 7 个模块入口内；原 `initializePlugins`、`initializeExt`、`initializeProviderModels`、`sweepThumbnailCache`、`initializeMcpRuntime`、`initializeMobileLinkRuntime` 的实现迁入既有文件或入口调用，不新增 adapter。
2. **不新增路由分组文件**：若采纳 R-05，分组代码由 `core.ts` 生成到 `router.ts`；不得新增 21 个域 Router 文件。
3. **不新增模块注册表**：`app.ts` 直接 import 7 个入口并用数组字面量装配；不新增 `modules/index.ts`。
4. **不新增 `mcp/bundle.ts`**：dxt↔servers 默认按 E11 豁免；若 Q8 选择消除，才允许新增 1 个文件（L2→10、mcp 21→22、final 246→247、lines +30），并重算 L3。
5. 任何清单外新增、净删除、未登记移动，均判定 L2 失败；不得把新文件藏进“既有目录所以不算新增”。

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

**L3 审计输出（必须逐字匹配；这是“交付态”的唯一合法总数）：**

```text
final_total=246
final_assigned=246
final_unassigned=0
final_duplicated=0
final_equals_existing_plus_new=246=237+9
```

> **口径裁决**：L1 的 `237/237` 与 L3 的 `246/246` **同时成立且不矛盾**；前者只覆盖 B0，后者覆盖交付态。任何文档、脚本、评审意见不得再用 `237/237` 描述交付态。

### 3.3 归属差异与地图滞后（显式登记，不是漏算）

| 文件 | 行数 | 地图原归属 | 本版归属 | 直接引用点 | 归属理由 |
| --- | --- | --- | --- | --- | --- |
| `src/utils/documents.ts` | 74 | `local_runtime` | **`mediaGeneration`** | `utils/ai/index.ts:14`、`agent/assets.ts:12`、`agent/tools/index.ts:19` | `readDocument` 只依赖 `lib/documentFormats`，是模型读取文档的能力，无工作区/宿主语义 |
| `src/utils/fileHttp.ts` | 40 | `local_runtime` | **`platformCore`** | `routes/assets/thumb.ts:3`、`routes/assets/read.ts:2`、`routes/ext/read.ts:5`、`routes/nodes/files.ts:3`、`routes/workspaces/files/thumb.ts:7`、`routes/workspaces/files/read.ts:3` | `sendFile` 是 Express 响应横切工具，被 6 个路由复用，无本地运行时状态 |
| 上述 9 个滞后文件 | 394 | 快照缺失 | 按 §1.2 | — | HEAD 已存在；地图详细快照滞后，不是新需求引入 |

**地图 id ↔ 代码目录映射（R-09 必须逐项对齐）：**

| 地图 id | 代码模块 | 地图快照 | L3 交付 |
| --- | --- | --- | --- |
| `bootstrap_wiring` | `bootstrap` | 8 / 710 | 9 / 750 |
| `asset_library` | `assetLibrary` | 27 / 2,615 | 28 / 2,675 |
| `ai_media_providers` | `mediaGeneration` | 39 / 2,851 | 43 / 3,054 |
| `plugin_ecosystem` | `pluginMarket` | 49 / 2,283 | 50 / 2,343 |
| `mcp_integration` | `mcpIntegration` | 20 / 1,433 | 21 / 1,493 |
| `local_runtime` | `localRuntime` | 46 / 2,272 | 46 / 2,255 |
| `agent_orchestration` | `agentAccess` | 20 / 905 | 27 / 1,253 |
| `http_core` | `platformCore` | 19 / 886 | 22 / 1,016 |
| **合计** | — | **228 / 13,955** | **246 / ≤14,839** |

### 3.4 路由前缀与端点归属

| 子模块 | 路由前缀 | 端点数 | 路由文件 |
| --- | --- | --- | --- |
| `assetLibrary` | `/api/assets` | 20 | 18 |
| `mediaGeneration` | `/api/ai`（10）、`/api/providers`（9）、`/api/ffmpeg`（9） | 28 | 25 |
| `pluginMarket` | `/api/tools`（9）、`/api/nodes`（10）、`/api/ext`（9）、`/api/skills`（11）、`/api/agents`（9）、`/api/plugins`（1） | 49 | 39 |
| `mcpIntegration` | `/api/mcp`（13）；**非 `/api` 挂载 `/mcp`**（MCP 运行时，不在 187 内） | 13 | 13 |
| `localRuntime` | `/api/workspaces`（17）、`/api/desktop`（15）、`/api/exec`（5）、`/api/mobileLink`（6） | 43 | 37 |
| `agentAccess` | `/api/agent`（13，含顶层 `routes/agent.ts` 1）、`/api/singleAgent`（5）、`/api/browser`（2）、`/api/sessionState`（2）；**非 `/api` 挂载 `/a2a`**（A2A 运行时，不在 187 内） | 22 | 22 |
| `platformCore` | `/api/settings`（9）、`/api/monitor`（3） | 12 | 7 |
| **合计** | **21 个 `/api/*` 前缀 + `/mcp` + `/a2a`** | **187** | **161** |

- `routePrefixes` 并集必须等于上表 21 个 `/api/*` 前缀，且两两无交集；`/mcp` 归 `mcpIntegration`、`/a2a` 归 `agentAccess`，单独声明，不计入 187。
- 端点计数按 route 文件内 `.get/.post/.put/.patch/.delete/.all` 出现次数统计；同一文件多方法会贡献多个端点（如 `routes/settings/get.ts` 2 个 GET、`routes/exec/index.ts` 4 个、`routes/tools/save.ts` 2 个）。
- `/api/agents/a2a/*` 属于 `pluginMarket` 的 `/api/agents` 前缀，**不是** `agentAccess` 的 `/a2a` 运行期挂载；两者不得混淆。

### 3.5 文件预算与计数规则（防止“为了 ≤50 隐藏文件”）

| 规则 | 内容 |
| --- | --- |
| 业务实现计数 | 只计 B0 的 237 个文件；含既有 `index.ts`、既有路由文件；**不含** L2 的 9 个契约文件 |
| 契约/装配计数 | L2 的 9 个文件；计入单模块 ≤55 / ≤3,300，不计入业务 ≤50 |
| 单模块业务上限 | ≤50；`pluginMarket` 49（余量 1），`localRuntime` 45，`mediaGeneration` 42，其余更低 |
| 单模块交付上限 | ≤55；最大 `pluginMarket` 50（余量 5） |
| 单模块行数上限 | ≤3,300；最大 `mediaGeneration` 3,054（余量 246） |
| bootstrap 行数 | ≤900；现状 710，交付 750（+`types/module.ts` 40） |
| 模块入口行数 | 每个 ≤60；7 个合计 ≤420 |
| 契约类型/共享文件 | `types/module.ts` ≤40（bootstrap）；`lib/mentionSources.ts` ≤30（platformCore） |
| 移动 | 文件数/行数不变；必须登记 old→new；不计入 L2 |
| 新增 | 只允许 L2 的 9 个；清单外新增即失败 |
| 删除 | 净删除必须为 0；移动导致的消失需有 old→new 映射 |
| 路由分组 | 不得新增文件；默认 E4 保留 161 条挂载；若 Q2 选 R-05，只在 `router.ts`/`core.ts` 内生成 |
| 初始化适配 | 不得新增文件；写入模块入口 |
| 测试/依赖 | 不得新增测试文件、第三方依赖、controller/service/repository |

> **禁止的计数游戏**：把模块入口藏进既有目录、把初始化适配写成“工具函数”不计入、把路由分组文件算作“生成物”、把新增测试文件排除在文件数外、把移动说成删除再新增。以上任一情况按 L2/L3 失败处理。


---

## 4. 需求矩阵

### 4.1 矩阵总表

| 编号 | 需求项 | 背景（为什么做） | 可验证目标（描述） | 优先级 | 难度 | 风险 | 依赖 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R-01 | 建立 7 个应用子模块入口与统一契约 | P1：无模块声明，地图只能登记 1 个 237 文件模块 | 7 个入口文件存在且导出统一 `ServerModule`；`routePrefixes` 并集=21 个 `/api/*` 无交集；`/mcp`、`/a2a` 各一属主；每入口 ≤60 行 | **P0** | 中（3 人日） | 中 | 无 |
| R-02 | `app.ts` 瘦身为纯组合根 | P2：组合根内联插件初始化、哈希、网关、移动运行时 | `app.ts` ≤80 行；0 处插件初始化/哈希/`createMcpRouter`/`createA2aRouter`/`initializeMobileLinkRuntime`；中间件顺序不变；`createApp` 签名不变 | **P0** | 中（2 人日） | **高** | R-01 |
| R-03 | 初始化归口与顺序固化 | P2：6 类插件初始化与供应商哈希混在 `app.ts`；`builtinPlugins` 由组合根生产 | 初始化函数归口到模块入口；顺序数组与基线逐项一致；`builtinPlugins` 5 键结构与消费不变；providers revision 一致 | **P0** | 中（2 人日） | 中 | R-01 |
| R-04 | 服务目录模块化 | P1/P3：边界要落到目录，地图才能按 glob 切分 | `src/modules/<域>/**` 成形；L1 237/237；L2 9；L3 246；246 处深路径迁移；`@/utils` facade 保留；14 exports 可用 | **P0** | 很高（6-8 人日） | **高** | R-01 |
| R-05 | 路由装配分组（可选） | P5：161 条扁平挂载 | 默认 **E4**：保留 161 条挂载 + 域分组注释；若 Q2 选 C：降为 21 个 `/api/*` 域 Router + `/mcp` + `/a2a`，187 端点 method+path 全等；**不新增文件** | P1（可豁免 E4） | 高（4 人日） | **高** | R-04 |
| R-06 | 聚合入口收敛为分组 facade | P3：37 出口、145 文件引用；5 个 `@/agent` 出口是环的放大器 | `utils.ts` 37 个 key 全保留、按模块分组并加归属注释；145 个 `u` 调用面零修改；5 个 agent 出口登记 E2；≤130 行 | P1（部分豁免 E2） | 高（4 人日） | 高 | R-04、E2 |
| R-07 | 跨域依赖边 A–D（逐条可测） | P4 + 第 2 轮打回：原三条边判据失真、R-07D 单向与 E10 冲突 | A：4 处 mentionSources import 归零；B：plugin→media 契约化、反向 0；C：mcp→plugin 深路径 0；D：2 条 conf type 边归零；**不承诺模块级 DAG** | **P0**（A）/ P2（B/C/D） | 高（4 人日） | 中 | R-04 |
| R-07E | `dxt ↔ servers` 模块内环登记 | 第 2 轮打回：该环未登记正确豁免 | 2 条 value 边、2 文件 SCC、模块内；E11 按 §8.4 填满；或 Q8 选 `bundle.ts` 消除（Δ+1） | P2 | 低（0.5 人日） | 低 | R-04、E11 |
| R-08 | 宿主装配兼容（desktop / mobile / 独立 server） | `createApp` 被三宿主调用；桌面在拿到 app 后注入 `app.locals.desktop` | `createApp` 签名不变；14 exports 可用；36 文件/57 引用可解析；三宿主可启动；`/api/desktop/*` 15 端点仅桌面可用 | **P0** | 低（1 人日） | 中 | R-02 |
| R-09 | 规范、地图与包导出同步 | 拆分后 AGENTS、地图、package exports 必须一致 | AGENTS 更新；地图 8 模块与 L3 计数一致；`package.json` exports 与 tsconfig paths 同步；解释 228→237 与 237→246 | **P0** | 低（1 人日） | 低 | R-01…R-04 |
| R-10 | 回归基线与 13 项逐条冒烟 | 项目禁止新增测试，必须用文档化命令兜底 | 冻结 187 端点/161 挂载/typecheck/14 exports；13 项冒烟逐条方法+路径+fixture+基线；S1–S8 补充；21 前缀首端点 diff | **P0** | 中（2 人日） | 低 | 无（先行） |
| R-11 | 结构化豁免登记 | 无法在本需求内消除的耦合必须可评审 | E1–E12 逐条按 §8 模板登记；E11/E12 填满；每条有编号、理由、替代缓解、复核触发条件、责任人 | **P0** | 低（0.5 人日） | 低 | R-07、R-07E、R-13 |
| R-12 | 三本台账与预算审计（L1/L2/L3） | 第 2 轮打回：237/237 与 +2 自相矛盾 | L1=237/237；L2=9；L3=246；等式全部成立；无清单外新增/净删除/重复归属；预算逐模块通过 | **P0** | 中（1.5 人日） | 低 | R-01…R-04 |
| R-13 | 模块级 SCC 与依赖白名单（E10/E12） | 第 2 轮打回：R-07D 单向与 E10 冲突 | 不承诺 DAG；SCC 成员与附录 C 一致；20 条直接边计数不超 R-07 后预期值；E10 7 条弱边逐条冻结；E12 登记 SCC-1 + bootstrap 枢纽 | P1 | 低（0.5 人日） | 中 | R-04、R-07 |

### 4.2 需求明细

#### R-01 建立子模块入口与统一契约（P0｜难度中｜风险中）

- **背景**：P1。当前无模块级声明，拆分不可评审、不可校验。
- **描述**：在 `apps/server/src/modules/<域>/index.ts` 提供统一形状的模块声明；**不引入 service/controller 层，仅声明 + 装配**。统一类型放在 `src/types/module.ts`：

```ts
export type ModuleContext = {
  app: Express;
  dataDirectory?: string;
  roots: { tools?: string; nodes?: string; ext?: string; providers?: string; skills?: string; agents?: string };
  pluginRevision?: string;
  appVersion: string;
  /** 由 bootstrap 注入的通用目录同步能力；mediaGeneration 用它初始化 providers，避免 media→plugin 直接边 */
  syncPluginDirectory(targetDirectory: string, sourceDirectory: string, fileFilter?: RegExp | readonly string[], revision?: string): Promise<void>;
};

export type ServerModule = {
  id: "assetLibrary" | "mediaGeneration" | "pluginMarket" | "mcpIntegration" | "localRuntime" | "agentAccess" | "platformCore";
  name: string;
  responsibility: string;
  routePrefixes: readonly string[];
  dependencies: readonly string[];
  exports: readonly string[];
  initialize?(context: ModuleContext): Promise<void>;
  mount?(context: ModuleContext): Promise<void>;
  /** 仅 pluginMarket 提供：包装 initializePlugins，供 bootstrap 注入到 ModuleContext */
  syncDirectory?(targetDirectory: string, sourceDirectory: string, fileFilter?: RegExp | readonly string[], revision?: string): Promise<void>;
};
```

> `src/types/module.ts` 归 **bootstrap**（组合契约），不属于 7 个域模块；7 个入口对它的 `import type` 是 **composition type edge**，不计入 §2.4/附录 C 的域边矩阵，也不得被误算成 `x → platformCore` 新边。
> 模块入口允许额外具名导出（如 `pluginMarket.syncDirectory`、`pluginMarket.initializeTools`、`mediaGeneration.initializeProviders`）；`ServerModule` 只约束公共字段，具名钩子由 `app.ts` 直接引用，不引入新的域边。

- **验收**：
  - 7 个入口文件**逐个存在**（§3.1 路径），每个 `export default` 一个 `ServerModule`；每入口 ≤60 行；`pluginMarket` 入口额外导出 `syncDirectory`（包装 `initializePlugins`），供 `app.ts` 注入 `ModuleContext.syncPluginDirectory`；
  - `routePrefixes` 并集 = §3.4 的 21 个 `/api/*` 前缀且两两无交集；`/mcp` 只在 `mcpIntegration`、`/a2a` 只在 `agentAccess` 声明；
  - 每个入口的 `dependencies` 是 §2.4/附录 C 白名单的子集；实际直接边计数不超过基线；`dependencies` **不列 bootstrap**（`types/module` 的 type-only 导入是组合契约，不算域依赖）；
  - `exports` 至少包含被其他模块直接 import 的公开符号（B：`addMediaProvider`；C：`installKernel`/`listTools`/`skills/files` 能力）；
  - 模块清单可直接映射为地图模块定义（id/files/lines/entries/deps）；无 controller/service/repository。
- **风险与缓解**：清单与实际目录脱节 → 退化为“文档式拆分”。缓解：`routePrefixes` 由 `router.ts` 挂载表反向核对；`dependencies` 用附录 C 的 grep 判据核对；入口行数超 60 即失败。

#### R-02 `app.ts` 瘦身为组合根（P0｜难度中｜风险高）

- **背景**：P2。`app.ts` 160 行里初始化、哈希、预热、刷新、MCP/A2A、移动互联与中间件顺序混写。
- **描述**：组合根只保留：
  1. `createApp` 参数归一与 `TOONFLOW_DATA_DIR` 设定；`conf` 动态 import 与 `setLocaleFallback`；
  2. **app 创建前的模块初始化**：§R-03 步骤 1–8（插件目录、providers、缩略图、builtin 扫描）；此段必须在 `app = express()` 之前，保持 B0 顺序；
  3. `app = express()`、`app.locals.appVersion = appVersion`；开发模式 `buildRoute()` + `logger("dev")`（必须在 CORS 之前）；
  4. 全局中间件顺序（**逐项固定**）：
     1) CORS 校验 → 2) `languageRequest` → 3) `/a2a` 2mb → 4) `/api/workspaces/files/write` 与 `/api/assets/save` raw 100mb → 5) `/api/sessionState` 64kb → 6) 全局 json/urlencoded 100mb → 7) `/api/desktop` 门禁；
  5. **中间件之后的模块调用/挂载**：§R-03 步骤 9–15（模型刷新、router、`/mcp`、`/a2a`、静态、错误、移动互联）；
  6. 返回 app。
- **验收**：
  - `wc -l apps/server/src/app.ts` ≤80；
  - `grep -cE 'initializePlugins|autoInstallProviders|createHash|createMcpRouter|createA2aRouter|initializeMobileLinkRuntime' apps/server/src/app.ts` = **0**（`initializePlugins` 的包装名必须叫 `syncDirectory`，不得在 `app.ts` 出现原函数名）；
  - `app.locals.builtinPlugins` 只允许 **1 处赋值**（`= pluginMarket.scanBuiltin(...)`），不允许 5 类 `readdir/pattern` 分支；
  - 开发模式 `buildRoute()` + `logger("dev")` 在 CORS 之前；中间件 7 项的 `grep -n` 行号严格递增，且 `/api/sessionState` 的 64kb 在全局 100mb 之前；
  - `createApp` 参数名、可选性、默认值与 B0 diff 为空；返回值仍为 `Promise<Express>`。
- **风险与缓解**：数据目录时序 + 中间件顺序 + 宿主在 `createApp` 后注入 `app.locals.desktop` → 组合根只做装配，不假设 desktop 已注入；把中间件写成显式有序数组；三宿主各跑一次冒烟（§R-10 #10、S1）。

#### R-03 初始化归口与顺序固化（P0｜难度中｜风险中）

- **背景**：P2；`builtinPlugins` 由 `app.ts` 生产，5 组路由消费（tools / ext / nodes / agents / skills）。
- **描述**：初始化职责归口，**保留 B0 的精确顺序**。下表是相对顺序：**步骤 1–8 在 `app = express()` 之前**；**R-02 的 app 创建/开发分支/7 项中间件插在步骤 8 与 9 之间**；**步骤 9–15 在中间件之后**。

| 序 | 调用 | 归属 | 说明 |
| --- | --- | --- | --- |
| 1 | `pluginMarket.initializeTools(ctx)` | pluginMarket | tools 目录 |
| 2 | `pluginMarket.initializeNodes(ctx)` | pluginMarket | nodes 目录 |
| 3 | `pluginMarket.initializeExt(ctx)` | pluginMarket | ext 目录（`initializeExt`） |
| 4 | `mediaGeneration.initializeProviders(ctx)` | mediaGeneration | providers 目录 + sha256 revision；目录同步走 `ctx.syncPluginDirectory`（由 `app.ts` 注入 `pluginMarket.syncDirectory`），**不直接 import pluginMarket** |
| 5 | `assetLibrary.warmup(ctx)` | assetLibrary | `sweepThumbnailCache()` |
| 6 | `pluginMarket.initializeSkills(ctx)` | pluginMarket | skills 目录 |
| 7 | `pluginMarket.initializeAgents(ctx)` | pluginMarket | agents 目录 |
| 8 | `pluginMarket.scanBuiltin(ctx)` | pluginMarket | 返回 `builtinPlugins` 对象；由 app.ts 在创建 app 后赋值给 `app.locals.builtinPlugins` |
| 9 | `mediaGeneration.refreshModels()` | mediaGeneration | 非阻塞，保留 `.catch(console.warn)` |
| 10 | `router.default(app)` | bootstrap | 161 条挂载（或 Q2 的分组） |
| 11 | `mcpIntegration.mount(ctx)` | mcpIntegration | `/mcp` + `createMcpRouter` |
| 12 | `agentAccess.mount(ctx)` | agentAccess | `/a2a` + `createA2aRouter`；对 `@/agent/a2a` 保持**动态 import**（与 B0 一致），不得改成静态 import |
| 13 | `express.static(webRoot)` | bootstrap | 静态站点 |
| 14 | 错误处理中间件 | bootstrap | `errorFromCause` |
| 15 | `localRuntime.initialize(ctx)` | localRuntime | `initializeMobileLinkRuntime(app)` |

- **验收**：
  - `app.ts` 中 0 处插件目录 `readdir`/pattern 分支、0 处 `createHash`、0 处 `initializePlugins` 直接调用、0 处 `createMcpRouter`/`createA2aRouter` 构造；`syncPluginDirectory` 通过 `pluginMarket.syncDirectory` 注入；
  - `grep -rn 'from "@/utils/plugins' apps/server/src/modules/mediaGeneration` = **0**（providers 同步必须走 `ctx.syncPluginDirectory`，不得新增 media→plugin 边）；
  - `app.locals.builtinPlugins` 的键恰好 `tool|node|ext|skill|agent`，值为 `Set<string>`；#5/#6 与 S5–S8 消费不变；
  - 上面的 15 步在 `app.ts` 中以**显式有序数组/顺序调用**出现，行号递增；`pluginMarket` 的 5 类仍按 tools→nodes→ext→skills→agents，providers 在 ext 之后、skills 之前；
  - providers revision 与 B0 对同一组文件的计算值相同；初始化幂等（重复 `createApp` 不重复安装）；
  - `agentAccess.mount` 内 `@/agent/a2a` 必须保持 `await import(...)`；若改为静态 `from "@/agent/a2a"`，agentAccess→agent 从 8 变 9，A-13 失败；
  - `bun run typecheck` 通过（M0 在实施环境执行）。
- **风险与缓解**：`initializePlugins` 的 marker/revision 语义不能改 → 把原函数原样迁入适配位置，仅移动调用点，不改实现；初始化失败阻断启动 → 保留原错误传播；`builtinPlugins` 结构变化 → 5 组消费路由冒烟。

#### R-04 服务目录模块化（P0｜难度很高｜风险高）

- **背景**：P1 + P3；模块边界要落到目录，地图才能据 glob 切分。
- **描述**：
  - **物理迁移范围**：`src/utils/<域>/**` 迁入 `src/modules/<域>/<域>/**`；5 个顶层工具 `documents.ts`、`fileHttp.ts`、`exec.ts`、`monitor.ts`、`personalization.ts` 与 `remoteConnection.ts` 随域迁入；**`src/lib/**`、`src/types/**`、`src/routes/**` 保持原位**（方案 B），逻辑上归属对应模块，避免改数百处 `@/lib` 引用与 URL 推导。
  - 7 个模块入口新文件（L2 #1–#7）；`utils.ts` 保留兼容 facade（145 个调用文件本轮不改）。
  - 246 处深路径 `@/utils/<域>` 同步迁移；`package.json` exports 同步：`./browser`、`./mcp`、`./mobileLink`、`./desktop`、`./remoteConnection`、`./agent/mentionSources` 等指向新路径或 re-export。
  - **不保留 `src/utils/<域>/**` re-export 垫片**：`package.json` exports 直接指向 `src/modules/<域>/...`；`src/utils.ts` 是唯一保留的 `utils` 文件；若因兼容必须保留垫片，按 L2 新增逐条登记并重算 L3（不得让 `src/utils/**` 非空却不入账）。
  - `agent` 侧的 2 处 `@/utils/documents` 引用（`agent/assets.ts:12`、`agent/tools/index.ts:19`）随迁；其余 `agent → server` 引用按 `u` facade/re-export 保持可用。
- **验收**：
  - L1 输出 `237/237`；L2 输出 `new_total=9`；L3 输出 `final_total=246`（§3.2）；
  - `apps/server/src/modules/` 下 7 个应用子模块目录成形；组合根仍在 `src/app.ts`；
  - `grep -r '@/utils/' apps/server/src` 归零（facade/re-export 白名单除外）；白名单必须逐条列出文件:行；
  - `bun run typecheck` 通过；14 个 `@toonflow/server/*` exports 可 import；36 个外部引用文件不报错；
  - 187 端点 method+path 与 B0 逐条一致；161 路由文件不增不减。
- **风险与缓解**：`import.meta.dirname` 相对定位、`createRequire(import.meta.url)` 解析第三方包、Bun 打包路径 → 迁移后核对 `utils/conf` 相对层深、`plugins/install`、`teams/install` 的 `createRequire`；`build` 产物实际启动验证（§R-10）。

#### R-05 路由装配分组（P1｜难度高｜风险高｜默认豁免 E4）

- **背景**：P5。`router.ts` 161 条扁平挂载，327 行。
- **描述**：
  - **默认（E4）**：不改 `core.ts` 生成器，保留 161 条 `app.use`；在每个域的首条挂载前加分组注释；模块入口声明 `routePrefixes`，禁止跨模块抢路由。
  - **可选（Q2 选 C）**：`core.ts` 由“每个文件一条 `app.use`”改为“每个 URL 前缀生成一个子 Router”；`router.ts` 只保留 21 个 `/api/*` 域级挂载 + `/mcp` + `/a2a`；URL 由“模块声明前缀 + 目录内相对路径”推导，两者逐条等价；**不新增文件**（分组代码生成在 `router.ts` 内）。
- **验收**：
  - E4：`grep -c 'app.use'` = 161；187 端点 method+path diff 为空；每个模块的 `routePrefixes` 与实际挂载前缀一致；
  - C：挂载语句从 161 降为 23；187 端点 method+path diff 为空；`router.ts` 行数不作硬指标；无新增路由文件；
  - 两种情况下 `bun run routes` 生成结果与基线一致（C 情况下挂载粒度变、端点清单不变）。
- **风险与缓解**：路径漂移 = 前端 `/api` 字面量静默 404。缓解：先冻结 187 端点基线；逐条 diff；21 个前缀各取首端点冒烟；若评审认为收益不足，E4 保留。

#### R-06 聚合入口收敛（P1｜难度高｜风险高｜部分豁免 E2）

- **背景**：P3。`utils.ts` 37 个出口、145 文件引用；5 个出口来自 `@/agent`。
- **描述**：`utils.ts` 由“全量聚合”改为“按模块分组的薄 facade”（每模块一段 re-export，仍导出同名 key 以保持 `u.assets` 等调用不变）；`@/agent` 的 5 个出口在 AgentHost 就绪前保留并登记 E2。
- **验收**：
  - `utils.ts` 的 37 个 key 与 B0 完全一致（逐 key diff 为空）；5 个 agent key 保留；
  - 145 个 `from "@/utils"` 文件不改；`u.<domain>` 调用面零修改；
  - 每个 key 上方有归属模块注释；文件 ≤130 行；
  - 移除 1 个模块的改动不再需要动 `utils.ts` 公共结构（以“出口归属注释 + 模块目录”作为可评审产物）。
- **风险与缓解**：facade 保留过度 → 收敛名存实亡。缓解：以“出口归属注释 + 模块目录 + 37 key diff”作为可评审产物，而非仅靠行数。

#### R-07 跨域依赖边 A–D（P0/P2｜难度高｜风险中）

**先更正第 2 版的三处失真（保留第 2 版已修正的部分，并补充本轮）：**

1. `assetLibrary → agent` 不是“3 处纯类型”，而是 **3 处（1 type + 2 value）**；另有 `localRuntime` 的 **1 处 value**。`mentionAssetType` 是运行期函数，不是类型。
2. `pluginMarket ↔ mediaGeneration` 方向写反：实测是 **pluginMarket → mediaGeneration**（`utils/plugins/install.ts:11`），**反向 import 为 0**。
3. `mcpIntegration → pluginMarket` 不止 `install` 一处：实测 **3 个 import 点**（`dxt.ts`、`tools.ts`、`resources.ts`）。
4. **本轮新增更正**：R-07D 不再写“模块依赖方向单向”；`platformCore → localRuntime` 在消除 type 边后仍有 **1 条 value 边**（`personalization.ts:6`），`platformCore → mediaGeneration` 仍有 **1 条 value 边**（`settings/save.ts:8`）；二者是 E10，不是“单向”的例外。

**4 条边、判据与处理**（`file:line` 是**实施前**的现状路径；R-04 迁移后按 `apps/server/src/modules/<域>/<原子目录>` 复核，例如 `utils/mcp/dxt.ts` → `modules/mcpIntegration/mcp/dxt.ts`、`utils/assets/library.ts` → `modules/assetLibrary/assets/library.ts`、`utils/workspace/files.ts` → `modules/localRuntime/workspace/files.ts`。下表 grep 中的 `utils/` 路径在实施后按同一相对子目录替换）：

| 边 | 方向 | 证据（`file:line`） | 现状计数 | 类型 | 本期处理 | 可执行判据 | 反向计数 / SCC |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **A** | `assetLibrary → agent` + `localRuntime → agent` | `utils/assets/index.ts:5`（`MentionQuery`，type）；`utils/assets/library.ts:5`、`utils/assets/thumb.ts:4`（`mentionAssetType`，value）；`routes/workspaces/files/thumb.ts:10`（同函数，value） | **4 处**（3 + 1） | 1 type + 3 value | **消除**：把 `MentionQuery`、`mentionAssetType` 下沉到 `src/lib/mentionSources.ts`；`agent/mentionSources.ts` 以相对路径 `../lib/mentionSources` re-export，保持 `@toonflow/server/agent/mentionSources` 路径不变；更新 4 处 import | `grep -rn 'from "@/agent/mentionSources"' apps/server/src/modules/assetLibrary apps/server/src/modules/localRuntime apps/server/src/routes/assets apps/server/src/routes/workspaces` → **0**；server→agent 23→**19**；asset→platform 24→**27**（1t/26v）；local→platform 75→**76**（1t/75v）；web 4 处 `@toonflow/server/agent/mentionSources` 仍可 import | 反向 0；不在 SCC-1 内新增环 |
| **B** | `pluginMarket → mediaGeneration` | `utils/plugins/install.ts:11` `import { addMediaProvider } from "@/utils/media/provider"` | **1 处** | value | **固化单向契约**：`mediaGeneration` 模块入口公开 `addMediaProvider`（或 `installProvider`）作为供应商安装契约；`pluginMarket` 只从模块公开入口 import | 反向：`grep -rn 'from "@/utils/plugins' apps/server/src/utils/media apps/server/src/routes/ai apps/server/src/routes/providers apps/server/src/routes/ffmpeg` → **0**；正向深路径 `grep 'from "@/utils/media/provider"' apps/server/src/utils/plugins` → **0**；模块 `dependencies` 声明与实际一致 | 反向 0；不产生新环 |
| **C** | `mcpIntegration → pluginMarket` | `utils/mcp/dxt.ts:9`（`decodeText, skillPath, skillZip`）；`utils/mcp/tools.ts:13`（`listTools`）；`utils/mcp/resources.ts:6`（`skills/files` 命名空间） | **3 处** | value | **显式化为安装/工具内核公共契约**（豁免 E1）：`pluginMarket` 公开 `installKernel`（`decodeText`/`skillPath`/`skillZip`）与 `listTools`；`mcpIntegration` 只从模块公开入口 import | `grep -rn 'from "@/utils/plugins/install\|from "@/utils/plugins/tools\|from "@/utils/skills/files' apps/server/src/utils/mcp` → **0**；模块公开入口 import 仍为 3；依赖声明含 `pluginMarket` | 反向 0；不产生新环 |
| **D** | `platformCore ↔ pluginMarket / localRuntime`（teams/mobileLink 类型环） | `utils/conf/index.ts:5` `import type { RemoteTeam } from "@/utils/teams"`；`:8` `import type { MobileLinkConfig } from "@/utils/mobileLink"`；反向值：`utils/teams/index.ts:5`、`utils/teams/install.ts:4`、`utils/teams/files.ts:6`、`utils/mobileLink/index.ts:10` 均 `import conf` | **2 type + 4 value** | 混合环 | **消除 2 条 type 边**：把 `RemoteTeam`、`MobileLinkConfig` 定义在 `conf/index.ts`（配置 schema 的 owner），`teams/index.ts` 与 `mobileLink/index.ts` 以 `export type { ... } from "@/utils/conf"` re-export；反向 4 条 value 保留 | `grep -rn 'from "@/utils/teams\|from "@/utils/mobileLink' apps/server/src/utils/conf` → **0**；反向 `grep -rn 'from "@/utils/conf' apps/server/src/utils/teams apps/server/src/utils/mobileLink` → **4**（不变）；R-07D 后 `platformCore → pluginMarket` = **0**，`platformCore → localRuntime` = **1 value**，`platformCore → mediaGeneration` = **1 value**；**不承诺模块级单向** | 反向 4 value；SCC-1 仍存在，E12 |

- **R-07 总验收**：
  - A 的 4 处 import 归零；B 的反向 import 保持 0；C 的 3 处深路径 import 归零（改为模块公开入口）；D 的 2 条 type 边归零；
  - 模块 `dependencies` 声明与实际 import 一致；剩余跨模块引用均有 E10/E12 或强依赖白名单；
  - **不要求**消除 `agentAccess → @/agent`（8）、`utils.ts → @/agent`（5）、`mcpIntegration → @/agent`（2）、`platformCore → @/agent`（3）、`pluginMarket → @/agent`（1）、`agent → server`（51）的运行期/配置类依赖（NG1/E2/E6/E7/E8/E9）；
  - **不要求**模块级 DAG；`platformCore` 不是叶子，SCC-1 保留（E12）。
- **风险与缓解**：`mentionSources` 下沉可能牵动 web 的 `@toonflow/server/agent/mentionSources` 契约（4 处引用）→ 保留原路径 re-export，不改 web；类型下沉可能改变 `teams`/`mobileLink` 的公开类型 → 保留 re-export；入口行数增加 → 计入 L2 的 ≤60 行/入口与 L3 的 ≤3,300 行。

#### R-07E `dxt ↔ servers` 模块内环（P2｜难度低｜风险低｜E11）

- **背景**：第 2 轮打回指出该环未登记正确豁免。它是 B0 的两个 file 级 SCC 之一，且是 R-07D 后**唯一**残留的 SCC。
- **证据**：

| 方向 | `file:line` | 符号 | 类型 | 计数 |
| --- | --- | --- | --- | --- |
| `dxt.ts → servers.ts` | `apps/server/src/utils/mcp/dxt.ts:10` | `saveImportedMcpServers` | value（运行期） | 1 |
| `servers.ts → dxt.ts` | `apps/server/src/utils/mcp/servers.ts:8` | `removeMcpBundle` | value（运行期） | 1 |

- **SCC 事实**：
  - B0：2 个 file 级 SCC（13 文件跨模块 + 2 文件 `dxt/servers`）；
  - R-07D 后（模拟）：仅 `dxt/servers` 2 文件 SCC；13 文件 SCC 消失；
  - 两文件在 R-04 后同属 `mcpIntegration`，因此是**模块内环**，不影响子模块边界。
- **处理**：
  - **默认（E11）**：保留环，按 §8.4 填满结构化豁免；不新增文件；L2 仍 9、L3 仍 246。
  - **可选（Q8）**：提取 `bundleRoot` / `removeBundleDirectory` / `removeMcpBundle` 到 `src/modules/mcpIntegration/bundle.ts`，`dxt`/`servers` 都 import `bundle`；L2=10、mcp 22、final 247、lines +30；需重算 L3。
- **验收**：
  - 默认：E11 填满；`grep -rn 'from "@/utils/mcp/servers"' apps/server/src/modules/mcpIntegration/mcp/dxt.ts` = 1、`grep -rn 'from "@/utils/mcp/dxt"' apps/server/src/modules/mcpIntegration/mcp/servers.ts` = 1（基线冻结，不得新增第 2 条；B0 对应 `utils/mcp/...`）；file 级 SCC 审计输出 `scc_count=1`、`scc_size=2`、成员恰为这两文件；
  - Q8 选消除：两条 grep 均为 0；file 级 SCC 审计 `scc_count=0`；L2=10、L3=247 的等式成立。
- **风险与缓解**：地图 `circular_dep` 仍可能因模块级 SCC 标记；缓解：在 E11/E12 注明“file 级 SCC 仅 1 个 2 文件、模块内；模块级 SCC 为基线”；若 Q8 消除，需额外审查 `bundleRoot` 的安全路径校验迁移。

#### R-08 宿主装配兼容（P0｜难度低｜风险中）

- **背景**：`createApp` 由独立 server、Electrobun 桌面、Android/OHOS 移动三处调用；桌面在拿到 app 后才设置 `app.locals.desktop` 并启动 MCP runtime；移动端叠加 `/api/connection` 与反向代理。
- **描述**：保持 `createApp` 参数与返回值不变；`@toonflow/server/{app,remoteConnection,desktop,platform,documentFormats,nodeMenu,modelReasoning,mcp,mobileLink,browser,agent/types,singleAgent/types,agent/mentionSources,i18n}` 全部 export 路径可用（必要时 re-export 转发）。
- **验收**：
  - 三宿主可启动；桌面 `app.locals.desktop` 注入路径与门禁行为不变；
  - `/api/desktop/*` 15 个端点仍仅桌面可用；
  - 14 个 exports、36 文件/57 处引用不报错；
  - `createApp` 签名与 B0 diff 为空。
- **风险与缓解**：`@toonflow/server/*` 是 web 的编译期契约 → 先冻结 14 个 export 清单，迁移后逐项 import 冒烟。

#### R-09 规范、地图与包导出同步（P0｜难度低｜风险低）

- **描述**：更新 `AGENTS.md`（目录结构、`utils.ts` 入口规则、模块入口约定）；在实施完成后提供与地图字段同构的模块清单（id / files / lines / entries / deps）；`package.json` exports 与 `tsconfig` paths 同步；地图重算必须解释 228→237、237→246 两段对账。
- **验收**：
  - AGENTS.md 与代码一致（无“文档写 A、代码是 B”）；
  - 地图重算后 `server-api` 为 8 个模块，files/lines 与 L3 表逐项一致（246 文件 / ≤14,839 行）；
  - 地图详细快照不再停留在 228/13,955；若保留历史快照，必须标注“B0-only，不含 9 个滞后文件与 9 个 L2 文件”；
  - 14 个 exports 全部可解析；`package.json` exports 与 `tsconfig` paths 无悬空路径。
- **风险与缓解**：地图 glob、exclude、行数统计、2 文件归属差异 → 在模块清单中显式记录 `documents.ts`、`fileHttp.ts` 的归属更正与 9 个滞后文件；重算后校验 237+9=246。

#### R-10 回归基线与 13 项逐条冒烟（P0｜难度中｜风险低｜先行）

**M0 冻结五份基线：**

1. `git rev-parse HEAD` = `d084136`；
2. 187 条 `method + path` 清单（附录 A.2 命令生成）；
3. `router.ts` 全文 + 161 条挂载清单；
4. `bun run typecheck` / `bun run build` 通过状态（本机无 `bun`，M0 在实施环境复跑并记录）；
5. 14 个 exports / 36 文件 / 57 处引用清单。

**13 项冒烟（逐条实列，覆盖 7 个应用子模块）：**

| # | 子模块 | 方法 + 路径 | 请求要点（固定 fixture） | 基线期望（改动前后 diff 为空） | 验证点 |
| --- | --- | --- | --- | --- | --- |
| 1 | assetLibrary | `GET /api/assets/list` | `library=global&directory=<fixture>&limit=20&sort=name` | `200`；`data.items` 数组 / `data.nextCursor` 与基线一致 | 前缀挂载、分页、库根解析 |
| 2 | assetLibrary | `PUT /api/assets/save` | `library=global&directory=<fixture>&path=smoke.txt&overwrite=true`；body 原始字节 `ok` | `200`；`data.path`、`data.revision` 与基线一致 | raw 100mb 解析器、路径越界防护 |
| 3 | mediaGeneration | `POST /api/ai/media/generate` | `{directory:<fixture>, mediaType:"image", ...固定模型/提示词}`；无供应商时记录同一 4xx | 有供应商：`200` + JSON body（去心跳空行）与基线一致；无供应商：与基线相同 4xx | JSON 流式响应、供应商/模型解析、计费入口 |
| 4 | mediaGeneration | `POST /api/ai/generate/stop` | `{runId:"<固定 uuid>"}`；同源请求 | `200`；`data.stopped` 与基线一致（未命中为 `false`） | 运行注册表、stop 墓碑、`aiRuns` |
| 5 | pluginMarket | `GET /api/tools/get` | 无 body；同源请求 | `200`；`data.tools` 数组、`data.canManage` 布尔 | `builtinPlugins.tool` 消费、工具清单 |
| 6 | pluginMarket | `PUT /api/tools/save` | 从 #5 取一个内置工具名；`{name:"<builtin>", config:{}}`；本机/桌面请求 | `200`；`data` 为校验后配置；非本机为 `403`（与基线一致） | 工具配置校验、`conf` 写入、本机门禁 |
| 7 | mcpIntegration | `GET /api/mcp/status` | 同源请求 | `200`；`data.enabled`、`data.connections`、`data.endpoint` 与基线一致 | MCP 运行时、控制通道、app 请求校验 |
| 8 | localRuntime | `GET /api/workspaces/files/list` | `directory=<fixture>&path=` | `200`；`data.entries` 数组、`data.empty` 布尔 | 工作区根解析、隐藏项过滤 |
| 9 | localRuntime | `PUT /api/workspaces/files/write` | `directory=<fixture>&path=smoke.txt&expectedRevision=<fixture 当前 sha256>`；body 原始字节 `ok` | `200`；`data.revision` 为新内容 sha256（与基线一致）；不带 `expectedRevision` 时 `data` 为空 | raw 100mb 解析器、锁、revision、路径防护 |
| 10 | localRuntime | `POST /api/desktop/update/check` | 无 body；桌面宿主启动 | 桌面：`200` + update 结构；独立 server：与基线相同 4xx | `app.locals.desktop` 注入、桌面门禁 |
| 11 | localRuntime | `POST /api/exec` | `{requestId:"<uuid>", directory:<fixture>, command:"echo smoke", cwd:"", timeoutMs:5000}` | `200` SSE；事件类型序列 `[start, stdout, exit]` 与基线一致 | SSE、并发限制、命令执行边界 |
| 12 | platformCore | `GET /api/settings/get` | 同源请求 | `200`；`data` 设置对象与基线一致 | `conf`、i18n、app 请求校验 |
| 13 | agentAccess | `GET /api/sessionState/get` | 同源请求 | `200`；`data.state` 与基线一致 | `/api/sessionState` 64kb 中间件顺序、会话状态读写 |

**补充冒烟（S1–S8，不计入 13）：**

| # | 方法 + 路径 | 目的 |
| --- | --- | --- |
| S1 | `GET /api/plugins/export?type=tool&name=<builtin>` | 插件导出 ZIP、本机门禁、`fflate` |
| S2 | `GET /api/mcp/servers/list` | MCP 服务器配置读取 |
| S3 | `POST /api/singleAgent/run` | Agent 流式运行（固定 provider/model；事件序列对比） |
| S4 | `GET /api/monitor/status` | 监控端点、系统指标 |
| S5 | `GET /api/nodes/get` | `builtinPlugins.node` 消费、节点清单 |
| S6 | `GET /api/ext/list` | `builtinPlugins.ext` 消费、扩展清单 |
| S7 | `GET /api/skills/list` | `builtinPlugins.skill` 消费、技能清单 |
| S8 | `GET /api/agents/get` | `builtinPlugins.agent` 消费、Agent 清单 |

- **验收**：
  - 13 项逐条记录 `status`、`content-type`、归一化 body（时间戳/随机 ID/绝对路径/端口/临时哈希置零）或 SSE 事件类型序列；改动前后 diff 为空；
  - S1–S8 记录结果；21 个 `/api/*` 前缀各取 1 个首端点做 status diff（不计入 13 项）；首端点定义：该前缀下按路由文件路径字典序、再按文件内 method 出现顺序的第一个端点；M0 生成 21 条清单并归档；
  - `bun run typecheck`、`bun run build` 通过；`build/server` 产物可启动。
- **风险与缓解**：环境无供应商/无桌面宿主导致响应不同 → 以“改动前后一致”为判据，不以固定 200 为唯一判据；所有 fixture 与响应快照归档在 M0 文档；不新增测试文件。

#### R-11 结构化豁免登记（P0｜难度低｜风险低）

- **描述**：凡本需求内不消除的问题，逐条按 §8 模板登记，写明“尝试过什么、为什么不拆、替代缓解、何时复核”。
- **验收**：
  - E1–E12 逐条有编号、关联需求、理由、替代缓解、复核触发条件、责任人、有效期；
  - E11/E12 必须使用 §8.4 的完整模板，不得只写一行；
  - 评审可在豁免栏直接勾选同意/驳回；被驳回的豁免必须转为对应 R 的验收项或重新评审。
- **风险与缓解**：豁免表流于形式 → 每条豁免必须有可执行 grep 判据或计数上限；无判据的豁免视为无效。

#### R-12 三本台账与预算审计（P0｜难度中｜风险低）

- **背景**：第 2 轮打回的核心。L1/L2/L3 的边界、公式、输出必须可复现。
- **描述**：按 §3.2 执行三本账；审计脚本必须从 **git HEAD B0** 与 **最终工作树** 两个快照生成，不使用地图详细快照作为分母。
- **审计算法（必须按序）：**
  1. 从 `git ls-tree -r --name-only d084136 -- apps/server` 取 B0 全量，按 §1.1 的 B0 glob 过滤出 237 个 `.ts`；
  2. 建立显式 `MOVED: old -> new` 映射（覆盖 R-04 迁移的 `src/utils/<域>/**`、5 个顶层工具与 `remoteConnection.ts`）；`src/lib/**`、`src/types/**`、`src/routes/**` 不移动；
  3. `EXPECTED = apply(MOVED, B0) ∪ L2`；最终工作树用 FINAL glob 取全量：`src/app.ts`、`src/index.ts`、`src/core.ts`、`src/router.ts`、`src/utils.ts`、`scripts/**`、`src/lib/**`、`src/routes/**`、`src/types/**`、`src/modules/**`，**排除** `src/agent/**`；`src/utils/**` 必须为空（否则残留即未登记/未移动）；
  4. `new = FINAL - apply(MOVED, B0)`；`deleted = B0 - MOVED keys`；`moved = MOVED`；`actual_expected_diff = FINAL Δ EXPECTED` 必须为空；
  5. 用 §3.2 的归属规则把每个 FINAL 路径分配给唯一模块（MOVED 后的 B0 文件按 MOVED 目标模块；未移动的 B0 文件按 L1 glob；L2 文件按 L2 owner）；输出 `unassigned`、`duplicated`；
  6. 计算 L1/L2/L3 的文件数、行数、端点数、路由文件数；
  7. 按 §3.5 的预算逐模块判定。
- **验收输出（逐字匹配）：**

```text
L1: existing_total=237 existing_assigned=237 existing_unassigned=0 existing_duplicated=0 existing_orphan=0
L2: new_total=9 new_unregistered=0 new_line_cap_total=490
L3: final_total=246 final_assigned=246 final_unassigned=0 final_duplicated=0
L3: files 9+28+43+50+21+46+27+22=246; lines 14349+X (0<=X<=490); endpoints 0+20+28+49+13+43+22+12=187; routes 0+18+25+39+13+37+22+7=161
L3: endpoints 0+20+28+49+13+43+22+12=187; routes 0+18+25+39+13+37+22+7=161
```

- **验收规则**：
  - `new_total` 必须等于 9；`new_unregistered` 必须为 0；任何清单外新增/净删除/重复归属 → 失败；
  - `final_total` 必须等于 246；若 Q8 选消除 dxt 环，则 247，且 L2=10、mcp=22、lines +30；
  - 预算逐模块：业务 ≤50、交付 ≤55、行数 ≤3,300、bootstrap ≤900、入口 ≤60；全部通过；
  - 地图重算后必须与 L3 一致；不得用 228 快照证明交付态。
- **风险与缓解**：把移动误报为新增/删除 → 用显式 old→new 映射；把新文件藏进既有目录 → 用 `final - B0` 的路径集合判定；行数统计口径不一致 → 统一 `wc -l` 的 UTF-8 行数，忽略生成物？本需求不生成新代码文件，除 L2 外无生成物。

#### R-13 模块级 SCC 与依赖白名单（P1｜难度低｜风险中）

- **背景**：第 2 轮打回指出 R-07D 的“单向”与 E10 冲突。根因是把“模块级 DAG”当成隐含目标。
- **描述**：
  - 明确 **不承诺模块级 DAG**；SCC-1（assetLibrary、localRuntime、mediaGeneration、platformCore、pluginMarket）是基线事实，登记 E12；
  - 7 个入口对 `src/types/module.ts` 的 `import type` 归 bootstrap 组合契约，不计入域边；`mediaGeneration` 的 providers 目录同步走 `ctx.syncPluginDirectory`，不新增 media→plugin 边；
  - 每个模块入口的 `dependencies` 只允许附录 C 的直接边白名单；
  - E10 的 7 条残余弱边逐条冻结计数，不得新增；
  - bootstrap 的 facade 枢纽环登记 E12，不纳入域模块白名单。
- **验收**：
  - 模块级 SCC 审计输出：`scc1={assetLibrary,localRuntime,mediaGeneration,platformCore,pluginMarket}`、`scc2={agentAccess}`、`scc3={mcpIntegration}`；不得出现新的 5 模块外环；
  - 20 条直接边的 `lines/type/value` 与附录 C 的 R-07 后预期值一致（R-07A 允许 asset→platform +3、local→platform +1；其余变化项按 §R-07）；
  - E10 7 条弱边每条 `current ≤ 附录 C 的 R-07 后预期值`，且无新的 source→target 对；
  - E12 按 §8 模板填满；评审明确接受“模块级 SCC 不作为本期消除目标”。
- **风险与缓解**：把 SCC-1 误判为“拆分失败” → 在评审意见栏明确 c-server-api-1 的验收是“237 文件 god module 消除 + 子模块边界/预算”，不是“模块级无环”；模块级环由 c-server-api-2/AgentHost 与 E10/E12 另行处理。


---

## 5. 方案选项与推荐

| 方案 | 内容 | 改动面 | URL 风险 | 能否消除 237 文件 god module | 预估人日 | 结论 |
| --- | --- | --- | --- | --- | --- | --- |
| **A｜仅清单化** | 只新增 7 个模块入口声明与依赖清单，`utils/`、`routes/` 目录不动；`app.ts` 瘦身 | 小（~15 文件） | 无 | **否**（地图仍只有 1 个 237 文件模块） | 4-5 | 可作过渡，不满足验收 |
| **B｜服务模块化 + 路由保留** | 方案 A + `utils/<域>` 迁入 `src/modules/<域>`；`routes/` 位置与 `core.ts` 不变，URL 零风险 | 中（~237 文件路径 + 246 处引用） | 无 | **可以**（子模块 = `modules/**` + 逻辑归属的 `routes/<域>/**`） | 9-11 | **推荐第一期（默认）** |
| **C｜全量目录化** | 方案 B + 路由文件也迁入模块目录 + `core.ts` 按域生成子 Router；`utils.ts` 收敛 | 大（全部 237 文件 + 生成器） | **高**（路径由目录推导） | **可以** | 16-20 | **第二期（Q2 决策；默认不做）** |

**推荐路径**：`R-10 基线` → `R-01/02/03/08` → `R-04` → `R-07/07E` → Q2 决策（默认 E4）→ `R-06/09/11/12/13` → 13 项 + S1–S8 冒烟 → M6 审查。
理由：先把组合根与初始化从 `app.ts` 剥离（低风险、立竿见影），再做目录迁移；路由目录与生成器的改动（R-05）风险最高、收益相对最小，默认作为独立决策点（E4），不阻塞本期。

---

## 6. 验收标准

### 6.1 硬性结构指标

- [ ] 地图/清单中 `server-api` 拆为 **8 个模块（1 组合根 + 7 应用子模块）**；默认 L1 `237/237`、L2 `9`、L3 `246`，三者同时成立（Q8/Q9 改选时按 §10 记录重算）。
- [ ] **业务实现文件 ≤50 / 模块**；**含契约/装配文件 ≤55 文件 / ≤3,300 行 / 模块**；`pluginMarket` 49 业务 + 1 契约 = 50；`mediaGeneration` 42+1=43 / 3,054 行。
- [ ] `app.ts` **≤80 行**，且 0 处具体插件类型、供应商哈希、`initializePlugins`、`createMcpRouter`/`createA2aRouter` 构造、`initializeMobileLinkRuntime`（R-02）。
- [ ] `bootstrap` 子模块合计 **≤900 行**（现状 710，交付 750）。
- [ ] 每个子模块有入口文件，声明职责 / 路由前缀 / 初始化 / 导出 / 依赖（R-01）；每入口 ≤60 行。
- [ ] 模块间直接边符合 §2.4/附录 C：A 4 处归零；B 反向 0；C 深路径 0；D 2 条 type 边归零；E10 7 条弱边不新增；E11 模块内环登记；E12 模块级 SCC 登记。
- [ ] **不存在“为了满足 ≤50 而隐藏文件”的计数游戏**：入口/契约/共享文件均计入 L2 与 ≤55 硬上限；业务计数规则在 R-12 台账中写明。
- [ ] **不以“模块级 DAG”作为验收条件**；SCC-1 是基线事实，E12 登记。

### 6.2 契约与回归

- [ ] **187 个端点的方法与路径 100% 不变**（逐条 diff 基线）。
- [ ] 161 个路由文件不增不减；`bun run routes` 生成结果与基线一致（若 Q2 选 C：挂载粒度变、端点清单不变）。
- [ ] `bun run typecheck`、`bun run build` 通过；`build/server` 产物可启动。
- [ ] `@toonflow/server/*` 14 个 export 全部可用（36 个文件 / 57 处引用不报错）。
- [ ] 三宿主启动冒烟：独立 server（`dev` 与 `build/server` 两种路径）、桌面（`app.locals.desktop` 门禁 + update 流转）、移动（`/api/connection` 代理）。
- [ ] **13 项冒烟逐条通过**（§R-10 表 1–13）；S1–S8 记录结果；21 个 `/api/*` 前缀各 1 个首端点 status diff 为空。

### 6.3 台账与预算

- [ ] L1 输出 `237/237`；L2 输出 `9`；L3 输出 `246`；三本账等式全部成立（§3.2）。
- [ ] 无清单外新增、无净删除、无重复归属；移动有 old→new 映射；路由分组/初始化适配无新增文件。
- [ ] 每模块业务 ≤50、交付 ≤55、行数 ≤3,300；bootstrap ≤900；入口 ≤60；L2 行数 ≤490。
- [ ] 地图重算后 8 模块的 files/lines 与 L3 一致；地图详细快照不再用 228 作为交付分母。
- [ ] 228/13,955（快照）+ 9/394（滞后文件）= 237/14,349（B0）；237 + 9 = 246（L3）；两段对账均记录。

### 6.4 规范与交付物

- [ ] `AGENTS.md` 已同步（目录结构、`utils.ts` 规则、模块入口约定）。
- [ ] 无新增 controller/service/repository 分层；无新增测试文件；无新增第三方依赖。
- [ ] E1–E12 豁免登记完整（编号、理由、替代缓解、复核触发条件、责任人、判据）；E11/E12 使用完整模板。
- [ ] 模块清单已提交，可供架构侧重新生成地图；14 exports / 36 文件 / 57 引用清单已归档。
- [ ] 13 项 + S1–S8 的 fixture、响应快照、diff 结果已归档；归一化规则已写明。

### 6.5 验收判定表（A-01～A-24，二值）

> 规则：每项只有 **PASS / FAIL**；缺证据 = FAIL；N/A 仅在 Q 决策明确记录且该项不适用时成立。评审人逐项勾选，不接受“基本通过”。若 Q8/Q9 改变 L2/L3，A-02/A-03/A-04/A-05/A-17/A-22 的期望值按 §11 记录替换，并在 M6 附重算表；未记录则按默认值 9/246。

| 编号 | 验收项 | 命令 / 产物 | 期望值 | 证据位置 | 判定 |
| --- | --- | --- | --- | --- | --- |
| A-01 | L1 存量归属 | R-12 审计脚本 | `existing_total=237`、`assigned=237`、`unassigned=0`、`duplicated=0` | M2 审计日志 | ☐ PASS ☐ FAIL |
| A-02 | L2 新增台账 | R-12 审计脚本 | 默认 `new_total=9`、`new_unregistered=0`、9 个路径逐字匹配 §3.2；Q9 复用则按 §11 记录值 | M2/M6 审计日志 | ☐ PASS ☐ FAIL |
| A-03 | L3 交付台账 | R-12 审计脚本 | 默认 `final_total=246`；文件/端点/路由等式成立；行数 `14,349+X` 且 `0≤X≤490`；Q8/Q9 改选按 §11 记录值 | M6 审计日志 | ☐ PASS ☐ FAIL |
| A-04 | 业务 ≤50/模块 | L3 表 | 8 模块业务计数均 ≤50；`pluginMarket=49` | §3.2 表 | ☐ PASS ☐ FAIL |
| A-05 | 交付 ≤55/≤3,300/≤900 | L3 表 | 8 模块均 ≤55、≤3,300；bootstrap ≤900（交付 750）；最大 `mediaGeneration 3,054` | §3.2 表 | ☐ PASS ☐ FAIL |
| A-06 | 7 个模块入口与契约 | `ls` + 读文件 | 7 个路径存在；每个 `export default ServerModule`；每入口 ≤60 行；字段齐全 | `src/modules/**/index.ts` | ☐ PASS ☐ FAIL |
| A-07 | 路由前缀所有权 | 入口 `routePrefixes` + `router.ts` | 并集=21 个 `/api/*`、无交集；`/mcp` 只属 mcpIntegration、`/a2a` 只属 agentAccess | §3.4 + 入口文件 | ☐ PASS ☐ FAIL |
| A-08 | `app.ts` ≤80 与禁用符号 | `wc -l` + `grep -cE` | ≤80；禁用符号计数=0；`builtinPlugins` 仅 1 处赋值 | `app.ts` | ☐ PASS ☐ FAIL |
| A-09 | 中间件顺序 | `grep -n` | 7 项顺序递增；`/api/sessionState` 64kb 在全局 100mb 前 | `app.ts` | ☐ PASS ☐ FAIL |
| A-10 | 初始化 15 步顺序 + builtinPlugins | 读 `app.ts` + 5 组冒烟 | 顺序与 §R-03 表一致；5 键 Set；#5/#6、S5–S8 通过 | `app.ts` + 冒烟日志 | ☐ PASS ☐ FAIL |
| A-11 | 187 端点 / 161 路由文件 | 附录 A.2 | method+path diff 为空；路由文件 161 | M0/M6 清单 | ☐ PASS ☐ FAIL |
| A-12 | 14 exports / 36 文件 / 57 引用 | 附录 A.5 | 逐项 import 成功；计数一致 | M0/M6 清单 | ☐ PASS ☐ FAIL |
| A-13 | R-07A mentionSources 归零 | 附录 A.7 grep | 4 处 import=0；server→agent 23→19；asset→platform 27、local→platform 76 | M3 grep 日志 | ☐ PASS ☐ FAIL |
| A-14 | R-07B plugin→media 契约 | 附录 A.7 grep | 反向=0；`from "@/utils/media/provider"` 在 plugins=0；公开入口 import=1 | M3 grep 日志 | ☐ PASS ☐ FAIL |
| A-15 | R-07C mcp→plugin 深路径 | 附录 A.7 grep | 3 条深路径=0；公开入口 import=3；依赖声明含 pluginMarket | M3 grep 日志 | ☐ PASS ☐ FAIL |
| A-16 | R-07D conf type 边归零 | 附录 A.7 grep | `conf→teams/mobileLink`=0；反向 4；platform→plugin=0；platform→local=1；platform→media=1 | M3 grep 日志 | ☐ PASS ☐ FAIL |
| A-17 | R-07E dxt/servers | 附录 A.6 SCC + E11 | 默认：E11 填满；file SCC `count=1,size=2`，成员恰为两文件；Q8 消除：两 grep=0、SCC=0、L2=10/L3=247；按 §11 记录 | M3 审计 + §11 | ☐ PASS ☐ FAIL |
| A-18 | 模块 SCC / 白名单 / E10 | 附录 A.6 + 入口 deps | SCC 成员与附录 C 一致；20 条边计数不超 R-07 后预期值；E10 7 条不新增 | M3/M5 审计 | ☐ PASS ☐ FAIL |
| A-19 | typecheck / build / 产物启动 | `bun run typecheck`、`bun run build`、启动 `build/server` + `GET /api/settings/get` | typecheck、build 成功；产物启动 10s 内无未捕获异常；`/api/settings/get` 与基线一致 | M0/M6 日志 | ☐ PASS ☐ FAIL |
| A-20 | 13 项 + S1–S8 + 21 前缀 | R-10 表 | 13 项 diff 为空；S1–S8 有记录；21 前缀 status diff 为空 | 冒烟归档 | ☐ PASS ☐ FAIL |
| A-21 | 三宿主启动 | 独立：dev 与 `build/server`；桌面：宿主启动；移动：宿主启动 | 三宿主 10s 内无未捕获异常且端口监听；独立 `GET /api/settings/get`、桌面 `POST /api/desktop/update/check`、移动 `/api/connection` 代理均与基线一致；桌面 `/api/desktop/*` 15 端点门禁不变 | M1/M6 日志 | ☐ PASS ☐ FAIL |
| A-22 | AGENTS / 地图 / exports 同步 | 读文件 + 地图重算 | AGENTS 与代码一致；地图 8 模块 = L3 246 文件 / ≤14,839 行；exports 无悬空 | M5 清单 | ☐ PASS ☐ FAIL |
| A-23 | 豁免表完整 | E1–E12 | 每条有编号/理由/缓解/触发/责任人/判据；E11/E12 完整模板 | §8 + §11 | ☐ PASS ☐ FAIL |
| A-24 | 无新增测试/依赖/分层；无隐藏文件 | `git status` + L2/L3 | 0 测试文件、0 新依赖、0 controller/service/repository；L2 外无新增；路由分组/初始化适配无新文件 | M6 diff | ☐ PASS ☐ FAIL |

### 6.6 不可判定项清零规则（第 2 轮打回的直接修复）

1. **禁止模糊词**：验收条目不得出现“基本/尽量/合理/约/较多/较少/必要时”；所有数字必须是精确值或明确上限。
2. **每条验收必须有命令或产物**：只有“评审认为可以”不算验收；A-01～A-24 每项都给出命令/产物与证据位置。
3. **diff 归一化规则**（R-10 冒烟）：
   - JSON：保持数组顺序；对象 key 排序后比较；时间戳、UUID、随机 ID、绝对路径、端口、临时哈希替换为 `<TS>`/`<UUID>`/`<PATH>`/`<PORT>`/`<HASH>`；
   - SSE：比较事件类型序列 + 归一化 `data`；不比较心跳空行；
   - HTTP：`status`、`content-type` 精确比较；响应头中 `date`/`etag` 忽略；
   - 文件：UTF-8 行数；忽略行尾空格差异。
4. **环境差异**：无供应商/无桌面宿主时，以“改动前后一致”的 4xx/错误体为基线，不以固定 200 为唯一判据；基线快照必须在 M0 归档。
5. **二选一事项**：Q1–Q10 每项有默认值；未在 §11 记录时按默认值执行；记录后按记录值执行。禁止“看情况”。
6. **豁免与验收的边界**：被豁免的项不再要求“消除”，但仍要求 §8 模板完整 + 替代缓解可执行；豁免被驳回则转为验收项。
7. **判定责任**：每个 A 项由评审人勾选 PASS/FAIL；FAIL 必须写明缺失证据；无证据的 PASS 视为无效。
8. **交付态口径**：只认 L3 的 246（或 Q8 的 247）；不得用 L1 的 237 或地图 228 作为交付态。

---

## 7. 风险登记表

| 编号 | 风险 | 概率 | 影响 | 缓解措施 |
| --- | --- | --- | --- | --- |
| R1 | 路由 URL 漂移（前端 `/api` 字面量静默 404） | 中 | 极高 | 冻结 187 端点基线；默认 E4 不改路由；若 Q2 选 C，逐条 diff + 21 前缀冒烟 |
| R2 | 启动顺序回归（`TOONFLOW_DATA_DIR` 先于 `conf`；`/api/sessionState` 64kb 先于全局 100mb；插件 5 类顺序） | 中 | 高 | §R-03 的 15 步显式顺序；中间件 7 项显式顺序；A-09/A-10 |
| R3 | 宿主耦合（桌面在 `createApp` 后注入 `app.locals.desktop`；移动代理） | 中 | 高 | 组合根只装配，不假设 desktop 已注入；`createApp` 签名不变；三宿主冒烟 A-21 |
| R4 | 循环依赖扩散（`conf → teams/mobileLink` 类型边、`dxt ↔ servers` 运行期环） | 中 | 中 | R-07D 消除 2 条 type 边；dxt/servers 按 E11 冻结；file SCC 审计 A-17；禁止新增边 |
| R5 | 路径敏感代码失效（`import.meta.dirname`、`createRequire(import.meta.url)`、Bun 打包） | 中 | 高 | 迁移后核对 `utils/conf` 相对层深、`plugins/install`、`teams/install` 的 `createRequire`；`build` 产物启动 A-19 |
| R6 | 改动面过大导致评审不可控（145 facade + 246 深路径） | 高 | 中 | 保持 `u` 外观；按模块分 PR；机械迁移与语义调整分开提交；L1/L2/L3 台账 A-01～A-05 |
| R7 | 与并行需求冲突（AgentHost、contracts 包、插件去重） | 中 | 中 | 明确 NG1/NG2/NG5；`utils.ts` 与 `@/agent` 出口只登记不动，留待 AgentHost 立项 |
| R8 | 无自动化测试兜底（规范禁止新增测试） | 高 | 高 | “端点清单 + `router.ts` diff + typecheck/build + 13 项冒烟 + S1–S8 + 21 前缀”六件套；交付说明如实写“未做自动化功能测试” |
| R9 | “文档式拆分”：模块入口只是摆设，实际依赖仍混乱 | 中 | 高 | `routePrefixes` 并集/交集、入口 `dependencies` 与实际 import 对账；A-06/A-07/A-18 |
| R10 | 文件预算/审计再次自相矛盾（把 L1 当 L3、隐藏新增） | 中 | 中 | L1/L2/L3 分离；`final - B0` 判新增；L2 外新增即失败；A-01～A-05 |
| R11 | 地图重新生成口径不一致（228 vs 237、2 文件归属、9 滞后文件） | 中 | 中 | §1.2 逐模块对账；R-09 要求地图 8 模块 = L3；A-22 |
| R12 | 本机无 `bun`，无法复跑 typecheck/build | 高 | 低 | M0 在实施环境复跑并记录；本矩阵明确“未重跑”，不伪造 |
| R13 | 决策点未记录导致验收二义 | 中 | 中 | Q1–Q10 有默认值；未记录按默认；A-24/§6.6 |
| R14 | 模块级 SCC 未消除被误判为失败 | 中 | 中 | 明确不承诺 DAG；E12；A-18 只查不新增，不要求消除 |
| R15 | `mentionSources` 下沉破坏 web 契约 | 低 | 中 | `agent/mentionSources.ts` 保留原路径 re-export；web 4 处 import 冒烟；A-13 |

---

## 8. 豁免判定与结构化豁免模板

### 8.1 豁免判定标准（满足任一即可申请）

1. **物理不可拆**：受 `AGENTS.md` 或工具链强约束（如“一个接口一个文件”、`routes/**` 扫描）。
2. **成本大于收益**：拆分带来的回归风险显著高于可量化的结构收益，且已有替代缓解。
3. **依赖未就绪**：需要另一个模块/需求先行（如 AgentHost 未落地则 `@/agent` 出口无法移除）。
4. **语义同源**：两项职责共享同一安全边界或同一生命周期，强行拆分反而增加出错面。

### 8.2 已识别的候选豁免（E1–E12，供评审勾选）

| 编号 | 关联需求 | 问题 | 建议结论 | 替代缓解 / 判据 |
| --- | --- | --- | --- | --- |
| E1 | R-07C | `utils/plugins/install.ts`（450 行）是 teams / mcp(dxt) / workspace 共用的安装内核；`listTools` 与 `skills/files` 同属插件市场公共能力 | 允许保留为 `pluginMarket` 公开“安装/工具内核”，不强行下沉 | 模块入口公开 `installKernel`/`listTools`；MCP 只走公开入口；A-15 深路径 0 |
| E2 | R-06 / NG1 | `utils.ts` 中 5 个 `@/agent` 出口（agent / canvas / question / a2aSettings / mentionFiles） | 本期保留 | 待 AgentHost 端口化立项后统一移除；出口加归属注释；A-12 |
| E3 | R-07 | `/api/exec`（进程执行）与工作区同属 `localRuntime` | 允许合并 | 二者共用 `isLocalWorkspaceRequest` 同一安全边界；A-11 |
| E4 | R-05 | 默认不改造 `core.ts` 生成器：`router.ts` 保留 161 条扁平挂载 | 本期默认豁免；Q2 可改 C | 按域分组注释 + 模块前缀清单对账；A-07/A-11 |
| E5 | R-07D | `conf` 对 `teams`/`mobileLink` 的 2 条 `import type` 类型边（若类型下沉成本高） | **本版默认不用 E5**：R-07D 直接把类型定义放 `conf`，0 新文件；仅当评审否决该方案时启用 E5 | 类型下沉到 `src/types/` 属独立需求；期内禁止新增反向依赖；A-16 |
| E6 | NG1 | `agent → server` 51 处 `@/utils` + 20 处 `@/lib\|@/types`；`server → agent` 19 处运行期/配置类依赖 | 本期不消除 | 需 AgentHost 端口化；本需求只消除 4 处 mentionSources；A-13；**路径归一化**：R-04 后 `@/utils/<域>` 变为 `@/modules/<域>`，E6 的 51 按 `@/utils\|@/modules` 合并计数仍为 51，不得用迁移后的 `@/utils` 单项 grep 对比 |
| E7 | §2.3 | `platformCore` 的 3 处 `@/agent` 依赖：`utils/conf/index.ts:6`（`A2aSettings` type）、`routes/settings/save.ts:6`、`routes/settings/systemPrompt.ts:3`（value） | 本期保留；type 边可随 E5 类型下沉，2 处 value 保留 | 不新增第 4 处；入口 `dependencies` 标注 type/value；A-16 |
| E8 | §2.3 | `utils/mcp/tools.ts:8-9` 对 `@/agent/tools`、`@/agent` 的运行期依赖 | 本期保留 | MCP 工具执行 Agent 是其职责；入口声明依赖，禁止扩散；A-18 |
| E9 | §2.3 | `routes/agents/a2a/save.ts:8` 对 `@/agent/runtime/model` 的 `getAgentModelConfiguration` 依赖（pluginMarket） | 本期保留 | A2A 插件保存需校验 Agent 模型；仅此 1 处，禁止扩散；A-18 |
| E10 | §2.4 / R-13 | **7 条残余弱边**（v2 的 6 条 + v2 漏掉的 `localRuntime→mediaGeneration`）：见下表 | 本期保留 | 入口 `dependencies` 声明；禁止新增 source→target 对；计数 ≤ R-07 后预期值；A-18 |
| E11 | R-07E | `dxt ↔ servers` 2 文件、2 条 value 边、模块内运行期环 | 本期保留（默认）；Q8 可消除 | §8.4 完整模板；file SCC 审计仅此 1 个 size=2；A-17 |
| E12 | R-13 | 模块级 SCC-1（asset/local/media/platform/plugin）+ bootstrap facade 枢纽环 | 本期保留；**不承诺模块级 DAG** | §8.4 完整模板；20 条直接边不超 R-07 后预期值；A-18 |

**E10 的 7 条残余弱边（逐条冻结）：**

| # | 源 → 目标 | 证据（`file:line`） | lines | 反向 lines（R-07 后） | 模块对在 SCC-1？ |
| --- | --- | --- | --- | --- | --- |
| 1 | mcpIntegration → mediaGeneration | `utils/mcp/operations.ts:4` → `@/utils/media/provider` | 1 | 0 | 否（mcp 单点） |
| 2 | mcpIntegration → localRuntime | `utils/mcp/control.ts:5` → `@/utils/mobileLink`；`utils/mcp/dxt.ts:11`、`utils/mcp/tools.ts:14` → `@/utils/workspace/files` | 3 | 0 | 否（mcp 单点） |
| 3 | assetLibrary → mediaGeneration | `utils/assets/thumb.ts:6` → `@/utils/ffmpeg` | 1 | 0 | 是 |
| 4 | localRuntime → mediaGeneration | `routes/workspaces/files/thumb.ts:11` → `@/utils/ffmpeg` | 1 | 4 | 是（双向） |
| 5 | platformCore → localRuntime | `utils/personalization.ts:6` → `@/utils/workspace/files`（R-07D 后仅剩此 value） | 1 | **76** | 是（双向） |
| 6 | platformCore → mediaGeneration | `routes/settings/save.ts:8` → `@/utils/ai` | 1 | 63 | 是（双向） |
| 7 | agentAccess → pluginMarket | `utils/singleAgent/index.ts:12` → `@/utils/plugins/tools` | 1 | 0 | 否（agent 单点） |

> v2 的 E10 只列 6 条且把 `platform → local/media` 写成“单向”；本版改为 7 条、逐条给出反向计数，并明确 #4/#5/#6 的模块对在 SCC-1 内，因此**不是单向**。表中反向计数是 **R-07 后**的预期值；#5 的 75→76 是 R-07A 的 1 条 mentionSources 迁移（local→platform），不是新增依赖。

### 8.3 豁免说明模板（每条必填）

```text
豁免编号：EX-<模块>-<序号>
关联需求：R-xx
问题描述：<一句话说明未消除的结构问题，含行数/文件数>
尝试过的方案：<方案 A 结果、方案 B 结果>
豁免理由：<对应 §8.1 的哪一条，附量化依据>
影响范围：<文件数/端点数/宿主>
替代缓解：<可执行的约束或校验手段，写明如何评审>
可执行判据：<grep 命令 / 计数上限 / SCC 输出>
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
  B. 提取 bundleRoot/removeBundleDirectory/removeMcpBundle 到 modules/mcpIntegration/bundle.ts：可消除，但新增 1 文件、迁移安全路径校验、L2=10、L3=247、lines +30。
豁免理由：§8.1 第 2 条（成本大于收益）与第 4 条（语义同源）。该环在模块内部，不影响 237 文件 god module 的拆分与子模块边界；消除不改变模块级 SCC（E12 仍在），却增加安全路径校验的迁移风险。
影响范围：2 文件、0 端点、0 个 @toonflow/server export、1 个模块（mcpIntegration）。
替代缓解：
  1) 两条 import 冻结为基线，禁止新增第 3 条；dxt/servers 不得再互相 import 其他符号；
  2) 每次 M2/M3/M6 运行 file 级 SCC 审计：scc_count=1、scc_size=2、成员恰为 dxt.ts/servers.ts；
  3) 地图若标记 circular_dep，在 E11 注明“模块内 2 文件环”，不视为拆分失败。
可执行判据：
  grep -rn 'from "@/utils/mcp/servers"' apps/server/src/modules/mcpIntegration/mcp/dxt.ts  → 1
  grep -rn 'from "@/utils/mcp/dxt"' apps/server/src/modules/mcpIntegration/mcp/servers.ts  → 1
  file SCC 审计：scc_count=1, scc_size=2
复核触发条件：MCP bundle 逻辑重构、mcpIntegration 再拆分、单文件 > 800 行、新增第 3 类 MCP bundle 来源。
有效期：本次发布 / 至下个架构评审周期。
责任人：待指派（实施负责人）。
评审结论：□ 同意  □ 驳回（理由：____）
```

#### E12：模块级 SCC 与 bootstrap 枢纽环

```text
豁免编号：EX-scc-01
关联需求：R-13
问题描述：直接边口径下，assetLibrary/localRuntime/mediaGeneration/platformCore/pluginMarket 形成 5 模块 SCC-1；含 bootstrap facade 时 8 模块全在一个 SCC。R-07D 只消除 2 条 type 边，不消除 SCC-1。
尝试过的方案：
  A. 只做边级消除（本版默认）：R-07D 消 conf→teams/mobileLink；E10 冻结 7 条弱边；不承诺 DAG。
  B. 消除 SCC-1：需把 personalization、settings 刷新、asset/media/local 的多条双向边全部端口化，等同 AgentHost/contracts 级重构，超出本需求。
豁免理由：§8.1 第 2 条（成本大于收益）与第 3 条（依赖未就绪）。c-server-api-1 的验收是“237 文件 god module 消除 + 子模块边界/预算”，不是“模块级无环”；模块级环由 c-server-api-2/AgentHost 与 E10 另行处理。
影响范围：5 个域模块 + bootstrap；0 端点；不改变 HTTP 契约。
替代缓解：
  1) 每个模块入口声明 dependencies 白名单；实际直接边计数 ≤ 附录 C 基线；
  2) E10 7 条弱边逐条冻结，禁止新增 source→target 对；
  3) 不把“模块级 DAG”写入任何验收项；A-18 只查“不新增/不超 R-07 后预期值”。
可执行判据：模块级 SCC 审计输出 scc1=5 成员、scc2={agentAccess}、scc3={mcpIntegration}；20 条直接边计数 ≤ R-07 后预期值。
复核触发条件：AgentHost 端口化立项、contracts 包落地、E10 任一边被要求消除。
有效期：本次发布 / 至下个架构评审周期。
责任人：待指派（实施负责人）。
评审结论：□ 同意  □ 驳回（理由：____）
```


---

## 9. 实施顺序与里程碑（评审通过后执行）

| 阶段 | 内容 | 出口条件（可判定） |
| --- | --- | --- |
| **M0** | 冻结基线：HEAD、187 端点、161 挂载、typecheck/build、14 exports、13 项 + S1–S8 fixture、归一化规则 | 5 份基线归档；A-11/A-12/A-19 的 M0 记录可查 |
| **M1** | R-01 + R-02 + R-03 + R-08：7 个入口、`app.ts` 瘦身、初始化归口、宿主兼容 | A-06～A-10、A-21 通过；`app.ts` ≤80；typecheck 通过；三宿主可启动 |
| **M2** | R-04：`utils/<域>` 迁入 `src/modules/<域>`；`documents.ts`/`fileHttp.ts` 随迁；`u` facade 保持 | A-01/A-02/A-03 通过；L1=237、L2=9、L3=246；246 深路径迁移；187 端点 diff 为空 |
| **M3** | R-07 + R-07E：A 消除、B/C 契约化、D 2 条 type 边归零；E11 登记（或 Q8 消除） | A-13～A-17 通过；file SCC 默认仅 dxt/servers（或 0） |
| **M4** | Q2/R-05 决策：默认 E4；若 C，改造 `core.ts` | Q2 记录；E4：161 挂载；C：23 挂载 + 187 端点 diff 为空；无新增路由文件 |
| **M5** | R-06 + R-09 + R-11 + R-12 + R-13 + 13 项/S1–S8 冒烟 | A-18/A-20/A-22/A-23 通过；37 key；地图 246 文件 / ≤14,839 行；E10/E12 完整 |
| **M6** | 交付审查：A-01～A-24 逐项勾选；地图重新切分申请 | 全部 PASS；§11 评审签署；无清单外文件/依赖/测试 |

**回滚规则：**

- M2/M3 任一阶段 187 端点 diff 非空 → 立即回滚该阶段，不得进入 M4；
- L3 超预算（业务 >50 / 交付 >55 / 行数 >3,300）→ 回滚 L2 或缩小入口实现，不得删业务文件凑数；
- M3 file SCC 出现 E11 之外的新环 → 回滚 R-07 变更，按 E11/E12 重新评审；
- M5 冒烟 diff 非空且无法归一化解释 → 回滚最近一个语义变更。

---

## 10. 待评审决策点（Q1–Q10，均有默认值）

> 规则：评审在 §11 记录结论；**未记录时按默认值执行**，不得以“看情况”替代。

| 编号 | 决策点 | 选项 | 默认值 | 影响 |
| --- | --- | --- | --- | --- |
| Q1 | 拆分深度 | A 仅清单化 / **B 服务模块化 + 路由保留** / C 全量目录化 | **B** | B：URL 零风险；C：R-05 高风险 |
| Q2 | 是否改造 `core.ts` 路由生成器 | **E4 保留 161 挂载** / C 改为 23 个域 Router | **E4** | C 需 M4 独立评审；不改则 E4 |
| Q3 | `utils.ts` 存废 | **保留 37 key 分组 facade** / 改 145 个调用点 | **保留** | 改调用点会扩大 145 文件改动面 |
| Q4 | NG1 边界 | **只消除 4 处 mentionSources，19 处运行期保留** / 要求整体 AgentHost | **前者** | 后者属独立需求 |
| Q5 | R-07 B/C 的“公开契约”判定 | **公开入口 + 禁止深路径即算处理** / 要求物理下沉 | **前者** | 后者可能突破文件预算 |
| Q6 | 文件预算 | **业务 ≤50 / 交付 ≤55 / ≤3,300 行** / 单层 ≤52 | **双层** | 单层会迫使削业务文件或隐藏契约 |
| Q7 | 13 项冒烟判据 | **改动前后 diff 为空（归一化）** / 固定 200 | **diff 为空** | 适配无供应商/无桌面环境 |
| Q8 | dxt↔servers | **E11 保留（0 新文件，L2=9/L3=246）** / 提取 `bundle.ts` 消除（L2=10/L3=247） | **E11** | 消除需 +1 文件、安全路径迁移审查 |
| Q9 | L2 口径 | **固定 9 个新文件** / 允许复用既有 `index.ts` 作为入口（Δ 减少） | **固定 9** | 复用会让入口路径不统一；若选复用，L3 重算 |
| Q10 | 模块级 SCC | **接受 E12（不承诺 DAG）** / 要求本期消除 SCC-1 | **接受 E12** | 后者等同 AgentHost/contracts 级重构，超出本需求 |

---

## 11. 评审意见栏

> 待评审人填写。可逐条对 R-01～R-13、Q1～Q10、E1～E12、A-01～A-24 给出结论。

| 评审人 | 日期 | 结论（通过 / 有条件通过 / 驳回） | 意见 |
| --- | --- | --- | --- |
|  |  |  |  |
|  |  |  |  |
|  |  |  |  |

**Q1–Q10 决策记录（未填按默认值执行）：**

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

**自由意见区**

```text
（留空，待评审填写）
```

---

## 附录 A：本次核验所用只读命令（可复现）

> 所有命令在仓库根目录执行；只读，不修改任何业务文件。本机当前 PATH 无 `bun`，A.9 在实施环境执行。

### A.1 模块文件/行数（HEAD = 237 / 14,349）

> B0 用下方 glob；实施后 FINAL 用 `apps/server/src/modules/**` 替代 `apps/server/src/utils/**`，并排除 `src/agent/**`；`src/utils/**` 必须为空。

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

### A.2 路由与端点基线

```bash
find apps/server/src/routes -name '*.ts' | wc -l                       # 161
grep -rhoE '\.(get|post|put|patch|delete|all)\(' apps/server/src/routes | sort | uniq -c
# 合计 187：GET 67 / POST 79 / PUT 20 / DELETE 11 / ALL 8 / PATCH 2
grep -c 'app.use' apps/server/src/router.ts                            # 161
```

### A.3 聚合入口与深路径

```bash
grep -rl 'from "@/utils"' apps/server/src --include='*.ts' | wc -l     # 145
grep -rl 'from "@/utils"' apps/server/src/routes --include='*.ts' | wc -l  # 144
grep -rho 'from "@/utils/[a-zA-Z]*' apps/server/src --include='*.ts' | wc -l  # 246
```

### A.4 环的两端（import 行口径）

> B0 口径；R-04 后 `@/utils/<域>` 变为 `@/modules/<域>`，agent→server 的 51 按 `@/utils\|@/modules` 合并计数，不得用单项 grep 直接对比。

```bash
grep -rn 'from "@/agent' apps/server/src --include='*.ts' | grep -v '^apps/server/src/agent/' | wc -l  # 23
grep -rn 'from "@/utils' apps/server/src/agent --include='*.ts' | wc -l   # 51
grep -rn 'from "@/lib\|from "@/types' apps/server/src/agent --include='*.ts' | wc -l  # 20
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

### A.6 直接边矩阵与模块级/文件级 SCC（只读）

```bash
python3 - <<'PY'
import glob, os, re, sys
from collections import defaultdict, Counter
root='apps/server/src'
globs = ["apps/server/src/app.ts","apps/server/src/index.ts","apps/server/src/core.ts",
         "apps/server/src/router.ts","apps/server/src/utils.ts","apps/server/src/remoteConnection.ts",
         "apps/server/src/lib/**","apps/server/src/routes/**","apps/server/src/types/**",
         "apps/server/src/utils/**","apps/server/scripts/**"]
files=sorted(set(p for g in globs for p in glob.glob(g, recursive=True)
                 if os.path.isfile(p) and p.endswith('.ts')))
def mod(p):
    rel=p[len(root)+1:] if p.startswith(root+'/') else p
    if rel in ('app.ts','index.ts','core.ts','router.ts','utils.ts') or rel.startswith('scripts/'): return 'bootstrap'
    if rel.startswith('utils/assets/') or rel.startswith('routes/assets/'): return 'assetLibrary'
    if rel.startswith(('utils/ai/','utils/media/','utils/ffmpeg/','routes/ai/','routes/providers/','routes/ffmpeg/')) or rel=='utils/documents.ts': return 'mediaGeneration'
    if rel.startswith(('utils/plugins/','utils/skills/','utils/teams/','routes/tools/','routes/nodes/','routes/ext/','routes/skills/','routes/agents/','routes/plugins/')): return 'pluginMarket'
    if rel.startswith(('utils/mcp/','routes/mcp/')): return 'mcpIntegration'
    if rel.startswith(('utils/workspace/','utils/desktop/','utils/mobileLink/','routes/workspaces/','routes/desktop/','routes/exec/','routes/mobileLink/')) or rel in ('utils/exec.ts','remoteConnection.ts'): return 'localRuntime'
    if rel.startswith(('utils/singleAgent/','utils/sessionState/','utils/browser/','routes/agent/','routes/singleAgent/','routes/browser/','routes/sessionState/')) or rel=='routes/agent.ts': return 'agentAccess'
    if rel.startswith(('lib/','utils/conf/','routes/settings/','routes/monitor/','types/')) or rel in ('utils/monitor.ts','utils/personalization.ts','utils/fileHttp.ts'): return 'platformCore'
    return 'bootstrap'
fs=set(files)
def resolve(spec):
    if not spec.startswith('@/'): return None
    base=root+'/'+spec[2:]
    for cand in (base+'.ts', base+'/index.ts'):
        if cand in fs: return cand
    return None
imp_re=re.compile(r'^\s*import\s+(type\s+)?([^;]*?)\s+from\s+["\']([^"\']+)["\']', re.M)
edges=defaultdict(lambda:[0,0,0])
for p in files:
    txt=open(p,encoding='utf-8',errors='ignore').read()
    for m in imp_re.finditer(txt):
        spec=m.group(3)
        if spec=='@/utils': continue  # facade
        t=resolve(spec)
        if not t: continue
        a,b=mod(p),mod(t)
        if a==b or a=='bootstrap' or b=='bootstrap': continue
        e=edges[(a,b)]; e[0]+=1; e[1]+= 1 if m.group(1) else 0; e[2]+= 0 if m.group(1) else 1
print('DIRECT EDGES')
for (a,b),v in sorted(edges.items()): print(f'{a}->{b}: lines={v[0]} type={v[1]} value={v[2]}')
# module SCC
g=defaultdict(set)
for a,b in edges: g[a].add(b)
nodes=sorted({x for e in edges for x in e})
idx={};low={};on=set();st=[];out=[];c=[0]
sys.setrecursionlimit(10000)
def f(v):
    idx[v]=low[v]=c[0];c[0]+=1;st.append(v);on.add(v)
    for w in g[v]:
        if w not in idx: f(w);low[v]=min(low[v],low[w])
        elif w in on: low[v]=min(low[v],idx[w])
    if low[v]==idx[v]:
        comp=[]
        while True:
            w=st.pop();on.discard(w);comp.append(w)
            if w==v:break
        out.append(comp)
for n in nodes:
    if n not in idx:f(n)
print('MODULE SCC', [sorted(x) for x in out])
# file SCC (all imports, excluding none)
g2=defaultdict(set)
for p in files:
    txt=open(p,encoding='utf-8',errors='ignore').read()
    for m in imp_re.finditer(txt):
        t=resolve(m.group(3))
        if t: g2[p].add(t)
idx={};low={};on=set();st=[];out2=[];c=[0]
def f2(v):
    idx[v]=low[v]=c[0];c[0]+=1;st.append(v);on.add(v)
    for w in g2[v]:
        if w not in idx: f2(w);low[v]=min(low[v],low[w])
        elif w in on: low[v]=min(low[v],idx[w])
    if low[v]==idx[v]:
        comp=[]
        while True:
            w=st.pop();on.discard(w);comp.append(w)
            if w==v:break
        out2.append(comp)
for v in files:
    if v not in idx:f2(v)
print('FILE SCC >1', [sorted(c) for c in out2 if len(c)>1])
PY
```

**R-07D 模拟**：把脚本中 `if p.endswith('utils/conf/index.ts') and (spec.startswith('@/utils/teams') or spec.startswith('@/utils/mobileLink')): continue` 加入后重跑，期望 `FILE SCC >1` 只剩 `['utils/mcp/dxt.ts','utils/mcp/servers.ts']`。

### A.7 R-07 判据

> 下列命令使用 B0 路径；实施后把 `apps/server/src/utils/<域>` 替换为 `apps/server/src/modules/<模块>/<域>`（例如 `utils/mcp` → `modules/mcpIntegration/mcp`，`utils/assets` → `modules/assetLibrary/assets`）。

```bash
# A：4 处归零
grep -rn 'from "@/agent/mentionSources"' \
  apps/server/src/modules/assetLibrary apps/server/src/modules/localRuntime \
  apps/server/src/routes/assets apps/server/src/routes/workspaces
# 期望 0（实施前基线 4 行：assets/index.ts:5、assets/library.ts:5、assets/thumb.ts:4、workspaces/files/thumb.ts:10）

# B：反向 0 + 深路径 0
grep -rn 'from "@/utils/plugins' apps/server/src/utils/media apps/server/src/routes/ai apps/server/src/routes/providers apps/server/src/routes/ffmpeg   # 0
grep -rn 'from "@/utils/media/provider"' apps/server/src/utils/plugins   # 0（改为模块公开入口）

# C：3 条深路径 0
grep -rn 'from "@/utils/plugins/install\|from "@/utils/plugins/tools\|from "@/utils/skills/files' apps/server/src/utils/mcp   # 0

# D：conf 的 2 条 type 边 0；反向 4
grep -rn 'from "@/utils/teams\|from "@/utils/mobileLink' apps/server/src/utils/conf   # 0
grep -rn 'from "@/utils/conf' apps/server/src/utils/teams apps/server/src/utils/mobileLink   # 4
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
# build/server 产物启动验证
```

### A.10 L1/L2/L3 审计伪代码（R-12）

```text
B0 = git ls-tree -r --name-only d084136 -- apps/server | filter(.ts, §A.1 B0 glob)
MOVED = explicit old->new map (utils/<域>/** -> modules/<域>/<域>/**; 5 top-level tools + remoteConnection)
EXPECTED = apply(MOVED, B0) ∪ L2
FINAL = find apps/server -name '*.ts' | filter(.ts, FINAL glob: modules/** + lib/** + routes/** + types/** + bootstrap files + scripts/**; exclude agent/**; utils/** must be empty)
assert FINAL == EXPECTED
NEW = FINAL - apply(MOVED, B0)
DELETED = B0 - MOVED.keys
L1 = assign(B0) -> {total:237, assigned:237, unassigned:0, duplicated:0}
L2 = NEW -> {total:9, unregistered:0, paths:§3.2}
L3 = assign(EXPECTED) -> {total:246, unassigned:0, duplicated:0}
assert L3.total == L1.total + L2.total
assert per_module_business <= 50
assert per_module_final <= 55 and per_module_lines <= 3300
```

---

## 附录 B：与第 2 版的关键差异

| 项 | 第 2 版 | 第 3 版 |
| --- | --- | --- |
| 文件审计 | `237/237` 与“每模块 +2”并列 | L1=237/237、L2=9、L3=246；三本账分离；`237/237` 只用于 L1 |
| 新文件 | 上界式 +2/模块 | 固定 9 个（7 入口 + `types/module.ts` + `lib/mentionSources.ts`） |
| 初始化适配 | 可能新增 adapter | 写入入口；0 新增 |
| 路由分组 | 可能新增 7 个适配 | 生成式；默认 E4；0 新增 |
| R-07D | “单向” | 删除单向承诺；边级；platform→local/media 各 1 value 保留；E10 |
| E10 | 6 条单向弱边 | 7 条残余弱边，逐条反向计数；含 local→media ffmpeg |
| dxt↔servers | 只在 R4 提，挂 E5/E1 | R-07E + E11 完整模板 + Q8 + file SCC 审计 |
| 模块级 SCC | 隐含 DAG | 明确 SCC-1 + E12；不作为验收条件 |
| 地图 228 | 未解释 | 228/13,955 + 9/394 = 237/14,349；逐模块对账 |
| 冒烟 | 13 + S1–S4 | 13 + S1–S8；21 前缀首端点 |
| 验收 | 混有主观项 | A-01～A-24 二值表 + §6.6 清零规则 |
| 决策点 | Q1–Q7 | Q1–Q10；全部有默认值 |

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

### C.2 模块 SCC

| SCC | 成员 | 本期处理 |
| --- | --- | --- |
| SCC-1 | assetLibrary、localRuntime、mediaGeneration、platformCore、pluginMarket | E12；不承诺消除 |
| SCC-2 | agentAccess | 无入边/单点；依赖白名单 |
| SCC-3 | mcpIntegration | 无入边/单点；依赖白名单 |
| 含 bootstrap | 8 模块 | E12；facade 枢纽环 |

### C.3 file SCC

| 时点 | 数量 | 成员 | 说明 |
| --- | --- | --- | --- |
| B0 | 2 | 13 文件跨模块 SCC；2 文件 dxt/servers | 13 文件 SCC 的回边是 conf→teams/mobileLink 两条 type |
| R-07D 后 | 1 | dxt/servers | E11 |
| R-07E 后（Q8） | 0 | — | 可选；L2=10/L3=247 |

---

## 附录 D：L2 新文件台账（9 个）

| # | 路径 | 模块 | 用途 | 行数上限 | 类别 |
| --- | --- | --- | --- | --- | --- |
| 1 | `apps/server/src/modules/assetLibrary/index.ts` | assetLibrary | 入口契约 + `warmup` | 60 | 契约 |
| 2 | `apps/server/src/modules/mediaGeneration/index.ts` | mediaGeneration | 入口契约 + providers 初始化/刷新 | 60 | 契约 |
| 3 | `apps/server/src/modules/pluginMarket/index.ts` | pluginMarket | 入口契约 + 五类插件初始化/扫描 | 60 | 契约 |
| 4 | `apps/server/src/modules/mcpIntegration/index.ts` | mcpIntegration | 入口契约 + `/mcp` 挂载 | 60 | 契约 |
| 5 | `apps/server/src/modules/localRuntime/index.ts` | localRuntime | 入口契约 + 移动互联初始化 | 60 | 契约 |
| 6 | `apps/server/src/modules/agentAccess/index.ts` | agentAccess | 入口契约 + `/a2a` 挂载 | 60 | 契约 |
| 7 | `apps/server/src/modules/platformCore/index.ts` | platformCore | 入口契约 + 中间件/配置导出 | 60 | 契约 |
| 8 | `apps/server/src/types/module.ts` | bootstrap | `ServerModule` / `ModuleContext`（组合契约，不计域边） | 40 | 契约 |
| 9 | `apps/server/src/lib/mentionSources.ts` | platformCore | `MentionQuery` + `mentionAssetType` | 30 | 共享 |
| — | **合计** | — | — | **490** | — |

---

## 附录 E：覆盖度追溯（来源 → 问题 → 需求 → 验收）

| 来源 | 问题 | 需求 | 验收 | 证据 |
| --- | --- | --- | --- | --- |
| `c-server-api-1` | 237 文件 / 14,349 行 / 161 路由 / 187 端点 god module | R-01～R-06、R-12、R-13 | A-01～A-11、A-18 | L3 表、地图 8 模块 |
| 第 2 轮打回 #1 | 237/237 与 +2 矛盾 | R-12 | A-01～A-05 | L1/L2/L3 输出 |
| 第 2 轮打回 #2 | R-07D 单向与 E10 冲突 | R-07、R-13 | A-13～A-18 | 边矩阵、SCC、E10/E12 |
| 第 2 轮打回 #3 | dxt↔servers 未登记正确豁免 | R-07E | A-17 | E11 完整模板、file SCC |
| 第 2 轮打回 #4 | 验收不可判定 | §6.5、§6.6、Q1–Q10 | A-01～A-24 | 二值判定表、默认值 |
| P1 | 无模块契约 | R-01、R-04 | A-06、A-07 | 7 入口、routePrefixes |
| P2 | 组合根承担业务初始化 | R-02、R-03 | A-08～A-10 | 15 步顺序、app.ts ≤80 |
| P3 | utils.ts 聚合锁死闭包 | R-06 | A-12 | 37 key diff |
| P4 | 跨域依赖隐式/方向混乱 | R-07、R-07E、R-13 | A-13～A-18 | 20 条边矩阵、E10/E11/E12 |
| P5 | 161 条扁平挂载 | R-05 | A-11、A-24 | E4 默认或 Q2 C |
| AGENTS 约束 | 一接口一文件/统一 `u`/禁测试/无分层 | R-04、R-05、R-10、R-12 | A-11、A-19、A-24 | 约束表、冒烟 |
| 地图 228 滞后 | 快照与 HEAD 不一致 | §1.2、R-09 | A-22 | 228+9=237、237+9=246 |
| `c-server-api-2` | server↔agent 双向 73/28、utils.ts 5 出口 | NG1、E2/E6 | 不在本期消除 | §2.3 |
| `c-server-api-3` | index.ts 读 electrobun.config 版本 | 不在本需求范围 | — | 需独立需求；本矩阵不搭车 |

---

## 附录 F：文档自检清单（提交前）

- [x] 背景、目标、描述、优先级、难度、风险六要素齐全（§4.1）。
- [x] 每条需求有可执行验收（§4.2、§6.5）。
- [x] 无“基本/尽量/合理/约”等模糊词（§6.6 规则 1）。
- [x] 237/237 只用于 L1；L2=9；L3=246（§3.2）。
- [x] R-07D 无“单向/DAG”承诺；E10 有反向计数（§2.4、§8.2）。
- [x] dxt↔servers 有独立 E11 完整模板（§8.4）。
- [x] 模块级 SCC 有 E12；不作为验收条件（§2.4、§8.4、Q10）。
- [x] 地图 228 与 HEAD 237 已逐模块对账（§1.2）。
- [x] 评审意见栏留空（§11）。
- [x] 未修改任何业务代码；仅新增本文档与索引。

