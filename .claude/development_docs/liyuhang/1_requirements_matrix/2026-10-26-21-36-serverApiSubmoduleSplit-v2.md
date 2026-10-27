# 需求矩阵 · server-api 应用子模块拆分（第 2 版 · 打回后重做）

## 0. 文档元信息

| 项 | 内容 |
| --- | --- |
| 文档编号 | **REQ-2026-10-26-02** |
| 版本 | 第 2 版（替代 REQ-2026-10-26-01） |
| 需求来源 | 架构地图关注点 `c-server-api-1`（`.easyvibe/map/map.json`）、`c-server-api-2`、`c-server-api-3` |
| 需求标题 | server-api 按素材库 / 媒体生成 / 插件市场 / MCP·工作区拆出应用子模块，`app.ts` 只保留组合根与路由装配 |
| 影响模块 | `server-api`（`apps/server`） |
| 需求类型 | 结构性重构（架构整改），**不改变任何业务行为** |
| 当前状态 | **待评审（第 2 版）**；仓库业务代码零改动，仅新增/更新需求文档与索引 |
| 编写人 | 需求分析 agent（harness 规则 2.1） |
| 编写时间 | 2026-10-26 21:36 |
| 基线 | `git HEAD = d084136`；`.easyvibe/map/map.json` 生成于 `2026-10-26T21:13:59+08:00` |
| 上一版 | `2026-10-26-21-27-serverApiSubmoduleSplit.md`（REQ-2026-10-26-01，**第 1 轮打回**） |
| 验收口径 | 问题消除 + 审查通过；无法消除项按 §8 结构化豁免说明登记 |

### 0.1 第 1 轮打回意见逐条处置（本版核心修订）

| # | 打回意见 | 本版处置 | 落点 |
| --- | --- | --- | --- |
| 1 | **NG1 与 R-07 / 6.1 冲突**：NG1 写“不切断 server ↔ agent 双向 import”，R-07 与 6.1 又要求 `assetLibrary` 对 agent 依赖归零 | 收窄 NG1：**不做的是一次性 AgentHost 端口化与运行期双向依赖消除**；**做的是** 4 处 `mentionSources` 非编排工具/类型依赖下沉。新增 §2.3“agent 依赖边界表”，逐条列出允许/消除/豁免 | §2.2 NG1、§2.3、§4 R-07、§6.1 |
| 2 | **R-07 三条边判据失真** | 重做 §4 R-07：改为 4 条边、逐条给出 `file:line` 证据、方向、当前计数、类型（type/value）、处理方式与可执行 grep 判据；明确更正上一版三处错误（方向写反、只算类型、只提 install 漏 tools/skills） | §4 R-07 |
| 3 | **冒烟 13 项实列 9 项** | 逐条列出 **13 个方法 + 路径 + fixture + 基线期望**，覆盖 7 个应用子模块；另列 4 项补充冒烟（不计入 13） | §4 R-10、§6.2 |
| 4 | **R-04 漏 2 文件** | 显式纳入 `utils/documents.ts`（74 行）与 `utils/fileHttp.ts`（40 行），给出归属、引用点与全量 237 文件对账等式 | §3.1、§4 R-04 |
| 5 | **≤50 文件指标被自身需求突破** | 原指标自负：`pluginMarket` 现状 49 文件，R-01 模块入口 + R-03 初始化适配即突破 50。改为**双层预算**：业务实现 ≤50 文件，含契约/装配硬上限 ≤55 文件 / ≤3,300 行；并列出最坏情况 `49+2=51` | §2.1 G1、§6.1 |

> 说明：第 1 轮“数据核实无误”的部分（237 文件 / 14,349 行 / 161 路由文件 / 187 端点）在本版重新复算并保留；本版新增的所有数字均可在附录 A 复现。

---

## 1. 背景

### 1.1 现状量化（本版复算）

| 指标 | 实测值 | 核验方式 |
| --- | --- | --- |
| server-api 文件 / 行数 | **237 文件 / 14,349 行** | 模块 glob 展开后逐文件统计，与地图数字一致 |
| 路由文件 | **161**（21 个一级目录 + `routes/agent.ts` 顶层文件） | `find apps/server/src/routes -name '*.ts' \| wc -l` |
| 注册端点 | **187**（GET 67 / POST 79 / PUT 20 / DELETE 11 / ALL 8 / PATCH 2） | 逐文件提取 `.get/.post/...` |
| `router.ts` 挂载条目 | **161 条**，与 `routes/` 目录一一对应 | 复算 `core.ts` 路径规则后逐条比对 |
| 全局聚合入口 `utils.ts` | **37 个出口**（34 个 namespace + `conf` + 2 个函数），其中 **5 个来自 `@/agent`** | 读 `utils.ts` |
| `import u from "@/utils"` 的引用 | **145 个文件**，其中 **144/161 个路由文件** | `grep -rl 'from "@/utils"'` |
| 深路径 `@/utils/<域>` 引用 | **246 处** | `grep -rho 'from "@/utils/[a-zA-Z]*'` |
| server → agent 静态 import | **23 行**（地图边口径 28 处，含 call；本矩阵用 import 行口径） | 排除 `src/agent/` 后 `grep 'from "@/agent'` |
| agent → server 静态 import | **51 行**（地图边口径 73 处，含 call） | `grep 'from "@/utils' apps/server/src/agent` |
| `app.ts` | **160 行**，含 6 类插件目录初始化、供应商源码哈希、缩略图缓存预热、供应商模型刷新、MCP/A2A 挂载、静态站点、错误处理、移动互联初始化 | 读 `src/app.ts` |
| 子模块内最大文件 | `utils/assets/library.ts` 729 行、`utils/media/provider.ts` 498 行、`utils/plugins/install.ts` 450 行 | `wc -l` |
| `@toonflow/server/*` 外部引用 | **36 个文件 / 57 处引用 / 14 个 export** | 排除 `apps/server/` 后 grep |
| 地图健康度 | 模块分 **50**，标记 `god_module` / `circular_dep` / `coupling_high` | `map.json` |
| 基线质量 | 上一轮记录 `bun run typecheck` 通过；**本机当前 PATH 无 `bun`，本版未重跑**，M0 必须复跑 | 见 §4 R-10 |

### 1.2 问题陈述（5 个可独立验证的根因）

- **P1｜边界只存在于目录名，没有模块契约对象。** 现有 21 个 `/api/*` 路由目录、15 个 `utils/*` 子目录在语义上已分域，但没有“模块入口”声明（职责、路由前缀、初始化钩子、对外导出、依赖清单）。地图只能把 237 个文件登记为 1 个模块，评分 50。
- **P2｜组合根承担业务初始化。** `createApp` 内联了 6 类插件目录初始化与内置清单扫描、供应商源码哈希、缩略图缓存预热、供应商模型刷新、MCP/A2A 网关挂载、移动互联运行时初始化；`app.locals.builtinPlugins` 由组合根生产，5 组路由消费。
- **P3｜全局聚合入口锁死编译期依赖闭包。** `utils.ts` 把 34 个 namespace（含 `@/agent`）聚合成单对象，145 个文件直接依赖；即使目录拆开，任一域改动仍牵动同一闭包。
- **P4｜跨域调用隐式且方向混乱。** 典型：素材库 3 处 + 工作区 1 处 import `@/agent/mentionSources`；插件安装内核被 MCP/团队复用；`conf` 与 `teams`/`mobileLink` 构成类型/值混合环。
- **P5｜路由装配是 161 条扁平挂载。** `router.ts` 327 行、无分组常量；新增/移动任一接口整文件重写，评审 diff 与并行开发冲突成本高。

### 1.3 约束（来自 `AGENTS.md`，直接决定难度与风险）

| 约束 | 出处 | 对本需求的影响 |
| --- | --- | --- |
| **一个接口一个文件**，`routes/**/*.ts` 全量扫描，URL 由文件相对路径决定 | AGENTS「目录结构」「路由与路径规则」 | 目录重组会直接改变 URL；要么保持 `routes/` 位置不动，要么改造 `core.ts` 生成器并保证 URL 逐条不变 |
| **通用工具统一 `import u from "@/utils"`**，导出由 `utils.ts` 管理 | AGENTS「引用与代码风格」 | 合并/拆分聚合入口属于规范变更，需同步改 AGENTS.md |
| **不为简单接口额外搭 controller / service / repository 层** | AGENTS「目录结构」 | 子模块只能是“路由 + 域工具 + 模块入口”，不得引入分层样板 |
| **禁止新增测试/自检代码** | AGENTS「测试与检查边界」 | 回归只能靠 `typecheck` + `build` + 端点清单 diff + 手工 HTTP 冒烟 |
| `app.ts` 不监听端口、不建 worker；桌面/移动复用 `@toonflow/server/app` | AGENTS「技术栈与职责」 | `createApp` 对外签名与 `@toonflow/server/*` exports 必须保持兼容 |
| 文件/目录小驼峰、双引号、分号、两空格 | AGENTS 通用规范 | 新模块目录命名使用 `assetLibrary` / `mediaGeneration` 等小驼峰 |

---

## 2. 目标与非目标

### 2.1 目标

- **G1｜模块切开且指标自洽**：`server-api` 由 1 个 237 文件模块拆为 **8 个模块（1 个组合根 + 7 个应用子模块）**。
  - **业务实现文件**（不含模块入口、初始化适配、路由分组适配等契约/装配文件）：单模块 **≤ 50 文件**。
  - **含契约/装配文件的硬上限**：单模块 **≤ 55 文件 / ≤ 3,300 行**。
  - 现状最大：`pluginMarket` 49 文件 / 2,283 行；规划最坏 `49 + 模块入口 1 + 初始化适配 1 = 51` 文件，仍 ≤55；业务实现 49 ≤50。
  - `mediaGeneration` 42 文件 / 2,994 行；`localRuntime` 45 文件 / 2,195 行；均在预算内。
- **G2｜组合根瘦身**：`app.ts` 只保留组合根职责（参数归一、全局中间件顺序、模块装配、静态资源、统一错误处理），**≤ 80 行**，不再出现任何具体插件类型、供应商哈希、具体网关的业务分支。
- **G3｜HTTP 契约不变**：187 个端点的方法与路径 **100% 不变**；`@toonflow/server/*` 的 14 个 exports 与 `createApp` 签名不变；36 个外部引用文件 / 57 处引用可解析。
- **G4｜模块契约可读、依赖方向可核对**：每个应用子模块有入口声明（职责、路由前缀、初始化钩子、对外导出、依赖白名单）；模块间依赖按 §2.3 与 §4 R-07 的白名单核对。
- **G5｜无法消除项结构化豁免**：每条未消除项按 §8 模板登记，写明理由、替代缓解、复核触发条件。

### 2.2 非目标（明确排除，避免范围蔓延）

- **NG1（本版修订，解决与 R-07/6.1 的冲突）｜不做 AgentHost 端口化，不消除运行期双向依赖；但允许并只允许“非编排类工具/类型依赖下沉”。**
  - **不做**：不新建 AgentHost 端口、不改 `agent-runtime` 的会话运行时、不消除 19 处运行期/配置类依赖（`agentAccess` 8、`platformCore` 3、`pluginMarket` 1、`mcpIntegration` 2、`utils.ts` 5）、不消除 `agent → server` 的 51 处反向 import。
  - **做**：把 `mentionSources` 的纯类型与纯函数（`MentionQuery`、`mentionAssetType`）下沉到中立模块，消除 **assetLibrary 3 处 + localRuntime 1 处** 对 `@/agent` 的 import；消除后仍保留 `@toonflow/server/agent/mentionSources` 路径的 re-export。
  - 这样 R-07 的“`assetLibrary` 对 agent 依赖归零”与 6.1 不再与 NG1 冲突：**归零的是 4 处非编排依赖，不是运行期编排依赖。**
- **NG2**：不抽前端 `contracts` 包、不改 web 的 `/api` 字面量（属 `c-web-console-1`）。
- **NG3**：不把 server 拆成多个 workspace 包（不新增 `packages/app-*`），不做跨包发布。
- **NG4**：不改任何接口行为、响应结构、鉴权语义、数据目录与插件安装语义。
- **NG5**：不做 5 组同构插件路由的去重、不拆 `library.ts` / `provider.ts` 巨型文件（可另立需求）。
- **NG6**：不新增测试文件、不新增第三方依赖、不引入 controller/service/repository 分层。

### 2.3 agent 依赖边界表（本版新增，NG1 与 R-07 的唯一裁决口径）

| 边 | 现状证据 | 当前计数 | 类型 | 本期处理 | 验收 |
| --- | --- | --- | --- | --- | --- |
| `agentAccess → @/agent` | `utils/singleAgent/index.ts:7-11`、`routes/agent.ts:4,9`、`routes/singleAgent/run.ts:7` | **8 行** | 运行期 | **允许**（模块核心职责） | 允许 `agentAccess` 直接 import `@/agent`；不新增其他文件 |
| `utils.ts → @/agent` | `utils.ts:19-21,33,35` | 5 个出口 | 运行期 | **允许，豁免 E2** | 145 个 `u` 调用面不变；出口加归属注释 |
| `mcpIntegration → @/agent` | `utils/mcp/tools.ts:8-9` | 2 行 | 运行期 | **允许，豁免 E8** | 仅允许 MCP 工具运行 Agent；不扩散 |
| `platformCore → @/agent` | `utils/conf/index.ts:6`（`A2aSettings`，type）、`routes/settings/save.ts:6`、`routes/settings/systemPrompt.ts:3`（prompt 常量/上限，value） | **3 行**（1 type + 2 value） | 混合 | **允许，豁免 E7**；其中 type 边随后续类型下沉可消除，2 处 value 保留 | 不新增第 4 处；模块依赖表标注 |
| `assetLibrary → @/agent` | `utils/assets/index.ts:5`（type）、`library.ts:5`、`thumb.ts:4` | **3 行**（1 type + 2 value） | 混合 | **消除**：下沉 `MentionQuery` + `mentionAssetType` | 归零（R-07 边 A） |
| `localRuntime → @/agent` | `routes/workspaces/files/thumb.ts:10` | **1 行** | 运行期 | **消除**：与 assetLibrary 同源下沉 | 归零（R-07 边 A） |
| `pluginMarket → @/agent` | `routes/agents/a2a/save.ts:8`（`getAgentModelConfiguration`） | **1 行** | 运行期 | **允许，豁免 E9**（A2A 插件配置需校验 Agent 模型） | 仅此 1 处；不新增 |
| `mediaGeneration → @/agent` | 无 | 0 | — | 保持 0 | `grep` 为 0 |

> 结论：NG1 不再表述为“完全不碰 server ↔ agent 依赖”，而是“**不消除 19 处运行期/配置类依赖；消除 4 处 mentionSources 非编排依赖；其余按 E2/E7/E8/E9 豁免**”。23 行 = 19 保留 + 4 消除，恰好覆盖 §1.1 的 server → agent 23 行。R-07 与 6.1 只对“消除项”提出归零要求。

---

## 3. 目标边界（子模块切分）

### 3.1 子模块清单与预算

| # | 子模块（小驼峰目录） | 职责 | 文件 / 行数（现状） | 端点数 | 路由文件 | 文件预算（含契约） | 主要依赖白名单 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | `bootstrap`（`app.ts` / `index.ts` / `core.ts` / `router.ts` / `utils.ts` / `scripts`） | 组合根、路由表生成、全局聚合出口 | 8 / 710 | 0 | 0 | ≤ 12 文件 / ≤ 900 行 | → 全部子模块 |
| 1 | `assetLibrary`（素材库） | 素材库根解析、索引分页、增删改移、回收站、缩略图、用量与变更事件 | 27 / 2,615 | 20 | 18 | 27+2=29 ≤55 | platformCore、localRuntime、mediaGeneration（ffmpeg 缩略图） |
| 2 | `mediaGeneration`（媒体生成 + 模型/供应商 + ffmpeg + 文档解析） | LLM 模型与供应商配置、文本生成、媒体模型与生成任务、计费、ffmpeg、文档转 Markdown | **42 / 2,994** | 28 | 25 | 42+2=44 ≤55 | platformCore、localRuntime（workspace 文件） |
| 3 | `pluginMarket`（插件市场） | tool/node/ext/skill/agent 五类插件与团队的安装、读取、保存、启停、卸载、排序、导出 | **49 / 2,283** | 49 | 39 | **49+2=51 ≤55**；业务 49 ≤50 | platformCore、mediaGeneration、localRuntime |
| 4 | `mcpIntegration`（MCP） | MCP 服务器配置、DXT/JSON 导入、对外 MCP 端点、控制通道、技能资源 | 20 / 1,433 | 13 | 13 | 20+2=22 ≤55 | platformCore、pluginMarket、localRuntime、mediaGeneration（operations 校验） |
| 5 | `localRuntime`（工作区 / 本机能力 / 宿主接入） | 工作区文件 CRUD 与越界防护、命令执行、桌面宿主桥、设备配对与远端代理 | **45 / 2,195** | 43 | 37 | 45+2=47 ≤55 | platformCore、bootstrap |
| 6 | `agentAccess`（Agent 会话编排） | Agent 流式会话、单 Agent 运行与工具回调、浏览器输入输出、会话状态桥接、A2A | 26 / 1,193 | 22 | 22 | 26+2=28 ≤55 | platformCore、pluginMarket（singleAgent 工具装载）；**允许依赖 agent-runtime** |
| 7 | `platformCore`（HTTP 横切与配置） | i18n、字段校验、统一响应/错误、平台能力判定、conf 持久化、文件发送、设置与监控接口 | **20 / 926** | 12 | 7 | 20+2=22 ≤55 | **非纯叶子**：localRuntime（personalization 值 + mobileLink 类型）、mediaGeneration（settings save 刷新）、pluginMarket（conf 类型，E5/E10） |
| — | **合计** | | **237 / 14,349** | **187** | **161** | 最大 51 ≤55 | |

**对账等式（必须逐项成立）：**

- 文件：`8 + 27 + 42 + 49 + 20 + 45 + 26 + 20 = 237`
- 行数：`710 + 2,615 + 2,994 + 2,283 + 1,433 + 2,195 + 1,193 + 926 = 14,349`
- 端点：`0 + 20 + 28 + 49 + 13 + 43 + 22 + 12 = 187`
- 路由文件：`0 + 18 + 25 + 39 + 13 + 37 + 22 + 7 = 161`

> **弱边说明**：除 R-07 的 4 条边外，仍存在若干单向弱依赖，本版按模块依赖白名单保留并登记 E10：`utils/mcp/operations.ts:4` → `media/provider`、`utils/mcp/control.ts:5` → `mobileLink`、`utils/assets/thumb.ts:6` → `ffmpeg`、`utils/personalization.ts:6` → `workspace/files`、`routes/settings/save.ts:8` → `utils/ai`、`utils/singleAgent/index.ts:12` → `plugins/tools`。这些边不构成环，本期只要求“声明 + 不新增反向”，不强行消除。

> **与地图快照的 2 处归属差异（本版显式更正，不是漏算）**：
> 1. `apps/server/src/utils/documents.ts`（74 行）地图归 `local_runtime` → 本矩阵归 **`mediaGeneration`**（`readDocument` 仅依赖 `lib/documentFormats`，被 `utils/ai/index.ts`、`agent/assets.ts`、`agent/tools/index.ts` 使用，属模型/文档解析能力）。
> 2. `apps/server/src/utils/fileHttp.ts`（40 行）地图归 `local_runtime` → 本矩阵归 **`platformCore`**（`sendFile` 是 Express 响应横切工具，被 6 个路由直接引用）。
> 调整后仍精确等于 237 / 14,349；地图重算时以本表为准。

### 3.2 路由前缀与端点归属（21 个 `/api/*` + 2 个非 `/api` 挂载）

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
- 端点计数按 route 文件内 `.get/.post/.put/.patch/.delete/.all` 出现次数统计；同一文件多方法会贡献多个端点（如 `routes/settings/save.ts` 4 个、`routes/exec/index.ts` 4 个）。

---

## 4. 需求矩阵

### 4.1 矩阵总表

| 编号 | 需求项 | 背景（为什么做） | 可验证目标（描述） | 优先级 | 难度 | 风险 | 依赖 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R-01 | 建立 7 个应用子模块与组合根清单，每个模块提供入口契约 | P1：无模块声明，地图只能登记 1 个 237 文件模块 | 7 个应用子模块各有入口（职责/前缀/初始化/导出/依赖）；`routePrefixes` 并集 = 21 个 `/api/*` 且无交集；组合根由 `app.ts` 承担 | **P0** | 中（3 人日） | 中 | 无 |
| R-02 | `app.ts` 瘦身为纯组合根 | P2：组合根内联 6 类初始化、哈希、网关、移动运行时 | `app.ts` ≤80 行；不含插件类型分支、供应商哈希、`initializePlugins`、`createMcpRouter`/`createA2aRouter` 构造、`initializeMobileLinkRuntime`；中间件顺序不变 | **P0** | 中（2 人日） | **高** | R-01 |
| R-03 | 初始化归口：插件 → `pluginMarket`，供应商 → `mediaGeneration` | P2：6 类插件目录初始化与供应商哈希混在 `app.ts`；职责错配 | `pluginMarket.initialize()` 返回 `builtinPlugins`（5 类 Set）；`mediaGeneration.initialize()` 处理 providers 哈希与模型刷新；`assetLibrary.warmup()` 处理缩略图缓存；`app.ts` 只调用 | **P0** | 中（2 人日） | 中 | R-01 |
| R-04 | 服务目录模块化：`utils/<域>` 与 2 个顶层工具迁入 `src/modules/<域>` | P1/P3：边界要落到目录，地图才能按 glob 切分 | 7 个应用子模块目录成形；**237 文件逐一归属、无孤儿**；`utils/documents.ts`、`utils/fileHttp.ts` 显式纳入；`@/utils` 保留兼容 facade；246 处深路径迁移 | **P0** | 很高（6-8 人日） | **高** | R-01 |
| R-05 | 路由装配分组：`core.ts` 按域生成子 Router | P5：161 条扁平挂载 | 161 条挂载降为 21 个 `/api/*` 域级 Router + `/mcp` + `/a2a`；187 端点 method+path 全等；`router.ts` 行数不作硬指标 | P1（可豁免 E4） | 高（4 人日） | **高** | R-04 |
| R-06 | 聚合入口收敛：`utils.ts` 拆为模块级出口 + 薄 facade | P3：37 出口、145 文件引用；5 个 `@/agent` 出口是环的放大器 | 每个出口可追溯到唯一模块；`u.<domain>` 调用面零修改；`@/agent` 5 出口保留并登记 E2 | P1（部分豁免） | 高（4 人日） | 高 | R-04、E2 |
| R-07 | 跨域依赖边界与契约（4 条边，逐条可测） | P4 + 第 1 轮打回：原三条边判据失真 | 见 §4.2 R-07：A 消除 4 处 mentionSources；B 固化 plugin→media 单向契约（反向 0）；C 显式化 mcp→plugin 公共契约；D 消除 2 处 conf→teams/mobileLink 类型边或豁免 E5 | **P0**（A）/ P2（B/C/D） | 高（4 人日） | 中 | R-04 |
| R-08 | 宿主装配兼容（desktop / mobile / 独立 server） | `createApp` 被三宿主调用；桌面在拿到 app 后注入 `app.locals.desktop` | `createApp` 签名不变；14 个 exports 可用；36 文件/57 引用可解析；三宿主可启动；`/api/desktop/*` 15 端点仅桌面可用 | **P0** | 低（1 人日） | 中 | R-02 |
| R-09 | 规范与地图同步 | 拆分后 AGENTS 与地图口径必须一致 | 更新 AGENTS.md 目录/引用规则；提交与地图同构的模块清单（id/files/lines/entries/deps）；`package.json` exports 与 tsconfig paths 同步 | **P0** | 低（1 人日） | 低 | R-01…R-04 |
| R-10 | 回归基线 + 13 项逐条冒烟 | 项目禁止新增测试，必须用文档化命令兜底；第 1 轮 13 项只列 9 项 | 冻结 187 端点清单、161 挂载、typecheck、14 exports；**13 项冒烟逐条有方法/路径/fixture/基线**（§4.2 R-10） | **P0** | 中（2 人日） | 低 | 无（先行） |
| R-11 | 结构化豁免登记 | 无法在本需求内消除的耦合必须可评审 | 每条未消除项按 §8 模板落表：编号、理由、替代缓解、复核触发条件、责任人 | **P0** | 低（0.5 人日） | 低 | R-05、R-06、R-07 |

### 4.2 需求明细

#### R-01 建立子模块清单与模块入口契约（P0｜难度中｜风险中）

- **背景**：P1。当前无模块级声明，拆分不可评审、不可校验。
- **描述**：在 `apps/server/src/modules/<域>/index.ts`（或迁移后的既有 `index.ts`）提供统一形状的模块声明，**不引入 service/controller 层，仅声明 + 装配**：
  - `id` / `name` / `responsibility`（供地图与文档引用）；
  - `routePrefixes`（本模块占用的 `/api/*` 前缀；`/mcp`、`/a2a` 单独声明）；
  - `initialize(context)`（可选，替代组合根里的内联初始化）；
  - `exports`（允许被其他模块使用的公开能力，其余视为内部）；
  - `dependencies`（允许依赖的模块白名单）。
- **验收**：
  - 7 个应用子模块目录齐全（组合根留在 `src/app.ts`）；
  - `routePrefixes` 并集 = §3.2 的 21 个 `/api/*` 前缀且无交集；`/mcp`、`/a2a` 各恰好一个属主；
  - 模块清单可直接映射为地图模块定义（id/files/lines/entries/deps）。
- **风险与缓解**：清单与实际目录脱节 → 退化为“文档式拆分”。缓解：`routePrefixes` 由 `router.ts` 挂载表反向核对；`dependencies` 用 §4 R-07 的 grep 判据核对。

#### R-02 `app.ts` 瘦身为组合根（P0｜难度中｜风险高）

- **背景**：P2。`app.ts` 160 行里初始化、哈希、预热、刷新、MCP/A2A、移动互联与中间件顺序混写。
- **描述**：组合根只保留：
  1. `createApp` 参数归一与 `TOONFLOW_DATA_DIR` 设定；
  2. 全局中间件顺序（CORS 校验 → `languageRequest` → `/a2a` 2mb → `/api/workspaces/files/write` 与 `/api/assets/save` raw 100mb → `/api/sessionState` 64kb → 全局 json/urlencoded 100mb → `/api/desktop` 门禁）；
  3. 遍历模块执行 `initialize` 与路由挂载；
  4. 静态资源、统一错误处理、返回 app。
- **验收**：
  - `app.ts` ≤80 行；
  - 文件内 0 处 `initializePlugins`、`autoInstallProviders`、`createHash`（供应商哈希）、`builtinPlugins` 的具体类型分支、`createMcpRouter`、`createA2aRouter`、`initializeMobileLinkRuntime`；
  - `/api/sessionState` 的 64kb 限制仍先于全局 100mb；
  - `createApp` 签名与返回值不变。
- **风险与缓解**：数据目录时序 + 中间件顺序 + 宿主在 `createApp` 后注入 `app.locals.desktop` → 组合根只做装配，不假设 desktop 已注入；把中间件顺序写成显式有序数组；三宿主各跑一次冒烟（§7 R2/R3）。

#### R-03 初始化归口（P0｜难度中｜风险中）

- **背景**：P2；`builtinPlugins` 由 `app.ts` 生产，5 组路由消费（tools / ext / nodes / agents / skills）。
- **描述**：
  - `pluginMarket.initialize()`：初始化 tool / node / ext / skill / agent 五类插件目录，扫描内置清单，返回 `builtinPlugins: Record<"tool"|"node"|"ext"|"skill"|"agent", Set<string>>` 与 `revision`；顺序固定 tools → nodes → ext → skills → agents。
  - `mediaGeneration.initialize()`：初始化 providers 目录、计算 `tfRouter.ts/apiMart.ts/metaso.ts/compshare.ts` 的 sha256 revision、启动 `initializeProviderModels()` 非阻塞刷新。
  - `assetLibrary.warmup()`：`sweepThumbnailCache()`。
  - `mcpIntegration.mount(app)` / `agentAccess.mount(app)` / `localRuntime.initialize(app)`：分别挂 `/mcp`、`/a2a`、移动互联运行时。
- **验收**：
  - `app.ts` 中 0 处插件初始化代码；
  - `app.locals.builtinPlugins` 结构与键名不变；5 组路由行为不变；
  - 初始化幂等、顺序固定；providers 哈希值与改动前一致（可用同一组文件对比）。
- **风险与缓解**：初始化失败阻断启动；`initializePlugins` 的 marker/revision 语义不能改 → 把原函数原样迁入适配器，仅移动调用点，不改实现。

#### R-04 服务目录模块化（P0｜难度很高｜风险高）

- **背景**：P1 + P3；模块边界要落到目录，地图才能据 glob 切分。
- **描述**：按下表迁移/归属，**覆盖全部 237 文件，无遗漏、无重复**。
  - **物理迁移范围**：只迁移 `src/utils/<域>` 与 5 个顶层工具（`documents.ts`、`fileHttp.ts`、`exec.ts`、`monitor.ts`、`personalization.ts`），以及 `remoteConnection.ts`。`src/lib/**`、`src/types/desktop.ts` 与 `src/routes/**` **保持原位**，逻辑上归属对应模块（方案 B），避免额外改动数百处 `@/lib` 引用与 URL 推导。
  - `agent` 侧的 2 处 `@/utils/documents` 引用（`agent/assets.ts:12`、`agent/tools/index.ts:19`）随迁；其余 `agent → server` 引用按 `u` facade/re-export 保持可用。

  | 子模块 | 服务/工具来源（glob） | 路由来源（当前） | 文件 | 行数 |
  | --- | --- | --- | --- | --- |
  | `bootstrap` | `src/app.ts`、`src/index.ts`、`src/core.ts`、`src/router.ts`、`src/utils.ts`、`scripts/**` | — | 8 | 710 |
  | `assetLibrary` | `src/utils/assets/**` | `routes/assets/**` | 27 | 2,615 |
  | `mediaGeneration` | `src/utils/ai/**`、`src/utils/media/**`、`src/utils/ffmpeg/**`、**`src/utils/documents.ts`** | `routes/ai/**`、`routes/providers/**`、`routes/ffmpeg/**` | 42 | 2,994 |
  | `pluginMarket` | `src/utils/plugins/**`、`src/utils/skills/**`、`src/utils/teams/**` | `routes/tools/**`、`routes/nodes/**`、`routes/ext/**`、`routes/skills/**`、`routes/agents/**`、`routes/plugins/**` | 49 | 2,283 |
  | `mcpIntegration` | `src/utils/mcp/**` | `routes/mcp/**` | 20 | 1,433 |
  | `localRuntime` | `src/utils/workspace/**`、`src/utils/desktop/**`、`src/utils/mobileLink/**`、`src/utils/exec.ts`、`src/remoteConnection.ts` | `routes/workspaces/**`、`routes/desktop/**`、`routes/exec/**`、`routes/mobileLink/**` | 45 | 2,195 |
  | `agentAccess` | `src/utils/singleAgent/**`、`src/utils/sessionState/**`、`src/utils/browser/**` | `routes/agent.ts`、`routes/agent/**`、`routes/singleAgent/**`、`routes/browser/**`、`routes/sessionState/**` | 26 | 1,193 |
  | `platformCore` | `src/lib/**`、`src/utils/conf/**`、`src/utils/monitor.ts`、`src/utils/personalization.ts`、**`src/utils/fileHttp.ts`**、`src/types/desktop.ts` | `routes/settings/**`、`routes/monitor/**` | 20 | 926 |

  **第 1 轮漏掉的 2 个文件（本版显式登记）：**

  | 文件 | 行数 | 地图原归属 | 本版归属 | 直接引用点 | 归属理由 |
  | --- | --- | --- | --- | --- | --- |
  | `src/utils/documents.ts` | 74 | `local_runtime` | **`mediaGeneration`** | `utils/ai/index.ts:16`、`agent/assets.ts:12`、`agent/tools/index.ts:19` | `readDocument` 只依赖 `lib/documentFormats`，是模型读取文档的能力，无工作区/宿主语义 |
  | `src/utils/fileHttp.ts` | 40 | `local_runtime` | **`platformCore`** | `routes/assets/thumb.ts:3`、`routes/assets/read.ts:2`、`routes/ext/read.ts:5`、`routes/nodes/files.ts:3`、`routes/workspaces/files/thumb.ts:7`、`routes/workspaces/files/read.ts:3` | `sendFile` 是 Express 响应横切工具，被 6 个路由复用，无本地运行时状态 |

  - 246 处深路径 `@/utils/<域>` 同步迁移；`utils.ts` 保留 `u` 的兼容 facade（145 个调用文件本轮不改）。
  - `package.json` exports 同步：`./browser`、`./mcp`、`./mobileLink`、`./desktop`、`./remoteConnection`、`./agent/mentionSources` 等指向新路径或 re-export。
- **验收**：
  - `apps/server/src/modules/` 下 7 个应用子模块目录成形（组合根仍在 `src/app.ts`）；
  - 文件归属审计脚本输出 `237 / 237`，无孤儿、无重复；
  - `grep -r '@/utils/' apps/server/src` 归零（facade/re-export 白名单除外）；
  - `bun run typecheck` 通过；14 个 `@toonflow/server/*` exports 可 import；36 个外部引用文件不报错。
- **风险与缓解**：`import.meta.dirname` 相对定位、`createRequire(import.meta.url)` 解析第三方包、Bun 打包路径 → 迁移后核对 `utils/conf` 相对层深、`plugins/install`、`teams/install` 的 `createRequire`；`build` 产物实际启动验证（§7 R5）。

#### R-05 路由装配分组（P1｜难度高｜风险高｜可豁免 E4）

- **背景**：P5。`router.ts` 161 条扁平挂载。
- **描述**：`core.ts` 由“每个文件一条 `app.use`”改为“每个 URL 前缀生成一个子 Router”；`router.ts` 只保留 21 个 `/api/*` 域级挂载 + `/mcp` + `/a2a`；URL 由“模块声明前缀 + 目录内相对路径”推导，两者必须逐条等价。**不新增路由文件**（分组代码生成在 `router.ts` 内），避免突破文件预算。
- **验收**：
  - `bun run routes` 重新生成后，187 个端点的 method + path 与基线清单完全一致；
  - 挂载语句从 161 条降为 23 条；`router.ts` 行数不作硬指标；
  - `core.ts` 生成规则有明确前缀映射，不靠隐式约定。
- **风险与缓解**：路径漂移 = 前端 `/api` 字面量静默 404。缓解：先冻结 187 端点基线；逐条 diff；手工冒烟覆盖每个前缀。若评审认为收益不足，**豁免 E4** 并保留 161 条挂载。

#### R-06 聚合入口收敛（P1｜难度高｜风险高｜部分豁免 E2）

- **背景**：P3。`utils.ts` 37 个出口、145 文件引用；5 个出口来自 `@/agent`。
- **描述**：`utils.ts` 由“全量聚合”改为“按模块分组的薄 facade”（每模块一段 re-export，仍导出同名 key 以保持 `u.assets` 等调用不变）；`@/agent` 的 5 个出口在 AgentHost 就绪前保留并登记 E2。
- **验收**：
  - `utils.ts` 内每个出口都能追溯到唯一模块；
  - 移除 1 个模块的改动不再需要动 `utils.ts` 公共结构；
  - `u.<domain>` 的既有调用面零修改（145 文件不改）。
- **风险与缓解**：facade 保留过度 → 收敛名存实亡。缓解：以“出口归属注释 + 模块目录”作为可评审产物，而非仅靠行数。

#### R-07 跨域依赖边界与契约（P0/P2｜难度高｜风险中）

**先更正第 1 轮的三处失真：**

1. `assetLibrary → agent` 不是“3 处纯类型”，而是 **3 处（1 type + 2 value）**；另有 `localRuntime` 的 **1 处 value**。`mentionAssetType` 是运行期函数，不是类型。
2. `pluginMarket ↔ mediaGeneration` 方向写反：实测是 **pluginMarket → mediaGeneration**（`utils/plugins/install.ts:11`），**反向 import 为 0**；上一版“mediaGeneration 反向依赖 pluginMarket”不成立。
3. `mcpIntegration → pluginMarket` 不止 `install` 一处：实测 **3 个 import 点**（`dxt.ts`、`tools.ts`、`resources.ts`），符号包括 `decodeText` / `skillPath` / `skillZip` / `listTools` / `skills/files` 命名空间；上一版只提 install 且写“3 处”但未列全。

**4 条边、判据与处理**（下表的 `file:line` 是**实施前**的现状路径；R-04 迁移后按 `apps/server/src/modules/<域>` 同名模块复核）：

| 边 | 方向 | 证据（`file:line`） | 现状计数 | 类型 | 本期处理 | 可执行判据 |
| --- | --- | --- | --- | --- | --- | --- |
| **A** | `assetLibrary → agent` + `localRuntime → agent` | `utils/assets/index.ts:5`（`MentionQuery`，type）；`utils/assets/library.ts:5`、`utils/assets/thumb.ts:4`（`mentionAssetType`，value）；`routes/workspaces/files/thumb.ts:10`（同函数，value） | **4 处**（3 + 1） | 1 type + 3 value | **消除**：把 `MentionQuery`、`mentionAssetType` 下沉到 `src/lib/mentionSources.ts`（或 `src/types/mentionSources.ts`）；`agent/mentionSources.ts` re-export 保持 `@toonflow/server/agent/mentionSources` 路径不变；更新 4 处 import | `grep -rn 'from "@/agent' apps/server/src/modules/assetLibrary apps/server/src/modules/localRuntime apps/server/src/routes/assets apps/server/src/routes/workspaces` → **0**（实施前基线为 4 行）；`grep -rn 'mentionAssetType'` 仅出现在新 lib、re-export、调用点；web 4 处 `@toonflow/server/agent/mentionSources` 仍可 import |
| **B** | `pluginMarket → mediaGeneration` | `utils/plugins/install.ts:11` `import { addMediaProvider } from "@/utils/media/provider"` | **1 处** | value | **固化单向契约**（不是“切断反向”，因为反向本来就是 0）：`mediaGeneration` 模块入口公开 `addMediaProvider`（或 `installProvider`）作为供应商安装契约；`pluginMarket` 只从模块公开入口 import | 反向：`grep -rn 'from "@/utils/plugins' apps/server/src/utils/media apps/server/src/routes/ai apps/server/src/routes/providers apps/server/src/routes/ffmpeg` → **0**；正向 import 不再指向 `utils/media/provider` 深路径；模块 `dependencies` 声明与实际一致 |
| **C** | `mcpIntegration → pluginMarket` | `utils/mcp/dxt.ts:9`（`decodeText, skillPath, skillZip`）；`utils/mcp/tools.ts:13`（`listTools`）；`utils/mcp/resources.ts:6`（`skills/files` 命名空间） | **3 处** | value | **显式化为安装/工具内核公共契约**（豁免 E1）：`pluginMarket` 公开 `installKernel`（`decodeText`/`skillPath`/`skillZip`）与 `listTools`；`mcpIntegration` 只从模块公开入口 import | `grep -rn 'from "@/utils/plugins/install\|from "@/utils/plugins/tools\|from "@/utils/skills/files' apps/server/src/utils/mcp` → **0**（改为模块公开路径）；依赖声明含 `pluginMarket` |
| **D** | `platformCore ↔ pluginMarket / localRuntime`（teams/mobileLink 类型环） | `utils/conf/index.ts:5` `import type { RemoteTeam } from "@/utils/teams"`；`:8` `import type { MobileLinkConfig } from "@/utils/mobileLink"`；反向值：`utils/teams/index.ts:5`、`utils/teams/install.ts:4`、`utils/teams/files.ts:6`、`utils/mobileLink/index.ts:10` 均 `import conf` | **2 type + 4 value** | 混合环 | **消除 2 条 type 边**：把 `RemoteTeam`、`MobileLinkConfig` 下沉到 `src/types/`（或 `platformCore` 的类型模块）；反向 `teams/mobileLink → conf` 保留（platformCore 是配置源；其自身对 local/media 的弱边按 E10 另计）。若类型下沉成本高，**豁免 E5** | `grep -rn 'from "@/utils/teams\|from "@/utils/mobileLink' apps/server/src/utils/conf` → **0**；反向 4 处允许且不新增；模块依赖方向 `pluginMarket/localRuntime → platformCore` 单向 |

- **验收（R-07 总）**：
  - A 的 4 处 import 归零；B 的反向 import 保持 0；C 的 3 处深路径 import 归零（改为模块公开入口）；D 的 2 条 type 边归零或登记 E5；
  - 模块 `dependencies` 声明与实际 import 一致；剩余跨模块引用均有豁免编号；
  - **不要求**消除 `agentAccess → @/agent`（8）、`utils.ts → @/agent`（5）、`mcpIntegration → @/agent`（2）、`platformCore → @/agent`（3）、`pluginMarket → @/agent`（1）、`agent → server`（51）的运行期/配置类依赖（NG1/E2/E7/E8/E9）。
- **风险与缓解**：`mentionSources` 下沉可能牵动 web 的 `@toonflow/server/agent/mentionSources` 契约（4 处引用）→ 保留原路径 re-export，不改 web；类型下沉可能引入新文件 → 计入 platformCore 预算（20+2=22 ≤55）。

#### R-08 宿主装配兼容（P0｜难度低｜风险中）

- **背景**：`createApp` 由独立 server、Electrobun 桌面、Android/OHOS 移动三处调用；桌面在拿到 app 后才设置 `app.locals.desktop` 并启动 MCP runtime；移动端叠加 `/api/connection` 与反向代理。
- **描述**：保持 `createApp` 参数与返回值不变；`@toonflow/server/{app,remoteConnection,desktop,platform,documentFormats,nodeMenu,modelReasoning,mcp,mobileLink,browser,agent/types,singleAgent/types,agent/mentionSources,i18n}` 全部 export 路径可用（必要时 re-export 转发）。
- **验收**：
  - 三宿主可启动；桌面 `app.locals.desktop` 注入路径与门禁行为不变；
  - `/api/desktop/*` 15 个端点仍仅桌面可用；
  - 14 个 exports、36 文件/57 处引用不报错。
- **风险与缓解**：`@toonflow/server/*` 是 web 的编译期契约 → 先冻结 14 个 export 清单，迁移后逐项 import 冒烟。

#### R-09 规范与地图同步（P0｜难度低｜风险低）

- **描述**：更新 `AGENTS.md`（目录结构、`utils.ts` 入口规则、模块入口约定）；在实施完成后提供与地图字段同构的模块清单（id / files / lines / entries / deps）；`package.json` exports 与 `tsconfig` paths 同步。
- **验收**：AGENTS.md 与代码一致（无“文档写 A、代码是 B”）；地图新模块的 glob 与 `src/modules/<域>/**` 对得上；14 个 exports 全部可解析。

#### R-10 回归基线与 13 项逐条冒烟（P0｜难度中｜风险低｜先行）

**M0 冻结四份基线：**

1. `git rev-parse HEAD` = `d084136`；
2. 187 条 `method + path` 清单（附录 A 命令生成）；
3. `router.ts` 全文 + 161 条挂载清单；
4. `bun run typecheck` 通过状态（本机无 `bun`，M0 在实施环境复跑并记录）；
5. 14 个 exports / 36 文件 / 57 处引用清单；

**13 项冒烟（逐条实列，覆盖 7 个应用子模块）：**

| # | 子模块 | 方法 + 路径 | 请求要点（固定 fixture） | 基线期望（改动前后 diff 为空） | 验证点 |
| --- | --- | --- | --- | --- | --- |
| 1 | assetLibrary | `GET /api/assets/list` | `library=global&directory=<fixture>&limit=20&sort=name` | `200`；`data` 结构与基线一致（`items` 数组 / `nextCursor`） | 前缀挂载、分页、库根解析 |
| 2 | assetLibrary | `PUT /api/assets/save` | `library=global&directory=<fixture>&path=smoke.txt&overwrite=true`；body 原始字节 `ok` | `200`；`data.path`、`data.revision` 与基线一致 | raw 100mb 解析器、路径越界防护 |
| 3 | mediaGeneration | `POST /api/ai/media/generate` | `{directory:<fixture>, mediaType:"image", ...固定模型/提示词}`；无供应商时记录同一 4xx | 有供应商：`200` + JSON body（去掉心跳空行后）与基线一致；无供应商：与基线相同的 4xx | JSON 流式响应、供应商/模型解析、计费入口 |
| 4 | mediaGeneration | `POST /api/ai/generate/stop` | `{runId:"<固定 uuid>"}`；同源请求 | `200`；`data.stopped` 与基线一致（未命中为 `false`） | 运行注册表、stop 墓碑、`aiRuns` |
| 5 | pluginMarket | `GET /api/tools/get` | 无 body；同源请求 | `200`；`data.tools` 数组、`data.canManage` 布尔 | `builtinPlugins.tool` 消费、工具清单 |
| 6 | pluginMarket | `PUT /api/tools/save` | 从 #5 取一个内置工具名；`{name:"<builtin>", config:{}}`；本机/桌面请求 | `200`；`data` 为校验后配置；非本机为 `403`（与基线一致） | 工具配置校验、`conf` 写入、本机门禁 |
| 7 | mcpIntegration | `GET /api/mcp/status` | 同源请求 | `200`；`data.enabled`、`data.connections`、`data.endpoint` 与基线一致 | MCP 运行时、控制通道、app 请求校验 |
| 8 | localRuntime | `GET /api/workspaces/files/list` | `directory=<fixture>&path=` | `200`；`data.entries` 数组、`data.empty` 布尔 | 工作区根解析、隐藏项过滤 |
| 9 | localRuntime | `PUT /api/workspaces/files/write` | `directory=<fixture>&path=smoke.txt&expectedRevision=<fixture 当前 sha256>`；body 原始字节 `ok` | `200`；`data.revision` 为新内容 sha256（与基线一致）；不带 `expectedRevision` 时 `data` 为空 | raw 100mb 解析器、锁、revision、路径防护 |
| 10 | localRuntime | `POST /api/desktop/update/check` | 无 body；桌面宿主启动 | 桌面：`200` + update 结构；独立 server：与基线相同的 `4xx` | `app.locals.desktop` 注入、桌面门禁 |
| 11 | localRuntime | `POST /api/exec` | `{requestId:"<uuid>", directory:<fixture>, command:"echo smoke", cwd:"", timeoutMs:5000}` | `200` SSE；事件类型序列 `[start, stdout, exit]` 与基线一致 | SSE、并发限制、命令执行边界 |
| 12 | platformCore | `GET /api/settings/get` | 同源请求 | `200`；`data` 设置对象与基线一致 | `conf`、i18n、app 请求校验 |
| 13 | agentAccess | `GET /api/sessionState/get` | 同源请求 | `200`；`data.state` 与基线一致 | `/api/sessionState` 64kb 中间件顺序、会话状态读写 |

**补充冒烟（不计入 13，用于覆盖剩余高风险点）：**

| # | 方法 + 路径 | 目的 |
| --- | --- | --- |
| S1 | `GET /api/plugins/export?type=tool&name=<builtin>` | 插件导出 ZIP、本机门禁、`fflate` |
| S2 | `GET /api/mcp/servers/list` | MCP 服务器配置读取 |
| S3 | `POST /api/singleAgent/run` | Agent 流式运行（需固定 provider/model；事件序列对比） |
| S4 | `GET /api/monitor/status` | 监控端点、系统指标 |

- **验收**：
  - 13 项逐条记录 `status`、`content-type`、归一化 body（时间戳/随机 ID/绝对路径置零）或 SSE 事件类型序列；改动前后 diff 为空；
  - `bun run typecheck`、`bun run build` 通过；`build/server` 产物可启动；
  - 13 项覆盖 7 个模块的关键链路；**另对 21 个 `/api/*` 前缀各取 1 个首端点做 status diff（不计入 13 项）**，确保前缀挂载无遗漏。
- **风险与缓解**：环境无供应商/无桌面宿主导致响应不同 → 以“改动前后一致”为判据，不以固定 200 为唯一判据；所有 fixture 与响应快照归档在 M0 文档。

#### R-11 结构化豁免登记（P0｜难度低｜风险低）

- **描述**：凡本需求内不消除的问题，逐条按 §8 模板登记，写明“尝试过什么、为什么不拆、替代缓解、何时复核”。
- **验收**：每条残余问题都有编号、责任人与复核触发条件；评审可在豁免栏直接勾选同意/驳回。

---

## 5. 方案选项与推荐

| 方案 | 内容 | 改动面 | URL 风险 | 能否“消除”237 文件模块 | 预估人日 | 结论 |
| --- | --- | --- | --- | --- | --- | --- |
| **A｜仅清单化** | 只新增 7 个模块入口声明与依赖清单，`utils/`、`routes/` 目录不动；`app.ts` 瘦身 | 小（~15 文件） | 无 | **否**（地图仍只有 1 个 237 文件模块） | 4-5 | 可作过渡，不满足验收 |
| **B｜服务模块化 + 路由保留** | 方案 A + `utils/<域>` 迁入 `src/modules/<域>`；`routes/` 位置与 `core.ts` 不变，URL 零风险 | 中（~200 文件路径 + 246 处引用） | 无 | **基本可以**（子模块 = modules/** + routes/<域>/**） | 9-11 | **推荐第一期** |
| **C｜全量目录化** | 方案 B + 路由文件也迁入模块目录 + `core.ts` 按域生成子 Router；`utils.ts` 收敛 | 大（全部 237 文件 + 生成器） | **高**（路径由目录推导） | **可以** | 16-20 | **推荐第二期（评审后再定 R-05）** |

**推荐路径**：`R-10 基线` → `R-01/02/03/08` → `R-04` → 评审决策 R-05 → `R-06/07` → `R-09/11`。
理由：先把组合根与初始化从 `app.ts` 剥离（低风险、立竿见影），再做目录迁移；路由目录与生成器的改动（R-05）风险最高、收益相对最小，应作为独立决策点。

---

## 6. 验收标准

### 6.1 硬性结构指标

- [ ] 地图/清单中 `server-api` 拆为 **8 个模块（1 组合根 + 7 应用子模块）**；文件归属审计 `237/237`，无孤儿、无重复。
- [ ] **业务实现文件 ≤50 / 模块**；**含契约/装配文件 ≤55 文件 / ≤3,300 行 / 模块**；当前最大 `pluginMarket` 49+2=51，满足。
- [ ] `app.ts` **≤80 行**，且 0 处具体插件类型、供应商哈希、`initializePlugins`、`createMcpRouter`/`createA2aRouter` 构造、`initializeMobileLinkRuntime`（R-02）。
- [ ] `bootstrap` 子模块合计 **≤900 行**（现状 710）。
- [ ] 每个子模块有入口文件，声明职责 / 路由前缀 / 初始化 / 导出 / 依赖（R-01）。
- [ ] 模块间依赖符合 §2.3 与 R-07：**`assetLibrary` 3 处 + `localRuntime` 1 处 `mentionSources` import 归零**；B 反向 0；C 深路径 0；D 的 2 条 type 边归零或 E5；其余运行期/配置类依赖按 E2/E6/E7/E8/E9/E10 登记且不新增。
- [ ] **不存在“为了满足 ≤50 而隐藏文件”的计数游戏**：模块入口、初始化适配、路由分组适配均须计入硬上限；业务实现计数规则在 R-09 清单中写明。

### 6.2 契约与回归

- [ ] **187 个端点的方法与路径 100% 不变**（逐条 diff 基线）。
- [ ] `bun run routes` 生成结果与基线一致（若采纳 R-05：挂载粒度变、端点清单不变）。
- [ ] `bun run typecheck`、`bun run build` 通过；`build/server` 产物可启动。
- [ ] `@toonflow/server/*` 14 个 export 全部可用（36 个文件 / 57 处引用不报错）。
- [ ] 三宿主启动冒烟：独立 server（`dev` 与 `build/server` 两种路径）、桌面（`app.locals.desktop` 门禁 + update 流转）、移动（`/api/connection` 代理）。
- [ ] **13 项冒烟逐条通过**（§4.2 R-10 表 1–13），补充 S1–S4 记录结果；21 个 `/api/*` 前缀各 1 个首端点 status diff 为空。

### 6.3 规范与交付物

- [ ] `AGENTS.md` 已同步（目录结构、`utils.ts` 规则、模块入口约定）。
- [ ] 无新增 controller/service/repository 分层；无新增测试文件；无新增第三方依赖。
- [ ] 豁免登记表完整（编号、理由、替代缓解、复核触发条件、责任人）。
- [ ] 模块清单已提交，可供架构侧重新生成地图。
- [ ] 13 项冒烟与 4 项补充的 fixture、响应快照、diff 结果已归档。

---

## 7. 风险登记表

| 编号 | 风险 | 概率 | 影响 | 缓解措施 |
| --- | --- | --- | --- | --- |
| R1 | 路由 URL 漂移（前端 `/api` 字面量静默 404） | 中 | 极高 | 先冻结 187 端点基线；R-05 单独评审；生成器改动后逐条 diff；手工冒烟覆盖每个 URL 前缀 |
| R2 | 启动顺序回归（`TOONFLOW_DATA_DIR` 必须先于 `conf` 加载；`/api/sessionState` 64kb 限制必须先于全局 100mb） | 中 | 高 | 把“中间件顺序与初始化顺序”写成 `app.ts` 内的显式有序数组；改动前后对同一条请求链路做手工验证（#13） |
| R3 | 宿主耦合：桌面在 `createApp` 之后注入 `app.locals.desktop` 并启动 MCP runtime；移动端包一层代理 | 中 | 高 | 组合根只做“装配”，不假设 `desktop` 已注入；保持 `createApp` 返回值与 exports 不变；三宿主各跑一次冒烟（#10、S1） |
| R4 | 循环依赖扩散（`conf → teams/mobileLink` 类型边、`dxt ↔ servers` 运行期环） | 中 | 中 | 本期按 R-07 D 消除 2 条 type 边；运行期环按原样迁移并登记 E5/E1，避免重构中放大 |
| R5 | 路径敏感代码失效（`import.meta.dirname` 定位数据目录、`createRequire(import.meta.url)` 解析第三方包、Bun 单文件打包） | 中 | 高 | 迁移后核对 `utils/conf` 的相对层深、`plugins/install`、`teams/install` 的 `createRequire`；`build` 产物实际启动验证 |
| R6 | 改动面过大导致评审不可控（145 处聚合引用 + 246 处深路径） | 高 | 中 | 保持 `u` 外观不变；按模块分 PR（每模块一次评审）；机械迁移与语义调整分开提交 |
| R7 | 与并行需求冲突（AgentHost、contracts 包、插件去重） | 中 | 中 | 明确 NG1/NG2/NG5；`utils.ts` 与 `@/agent` 出口只做登记不动，留待 AgentHost 立项 |
| R8 | 无自动化测试兜底（规范禁止新增测试） | 高 | 高 | 用“端点清单 + `router.ts` diff + typecheck/build + 13 项冒烟 + 4 项补充”五件套替代；交付说明如实写“未做自动化功能测试” |
| R9 | “文档式拆分”：模块入口只是摆设，实际依赖仍混乱 | 中 | 高 | 用 `routePrefixes` 并集/交集、模块 `dependencies` 与实际 import 的对账作为验收证据（R-07 grep 判据），而非只看目录是否存在 |
| R10 | 文件预算再次被自身需求突破（R-01 入口 + R-03 适配 + R-05 分组） | 中 | 中 | 双层预算（业务 ≤50 / 含契约 ≤55）；新增文件必须在模块清单登记；`pluginMarket` 最坏 51，留 4 个余量；若 R-05 需新增 7 个路由适配文件，则改为生成式（不新增文件）或重新评审上限 |
| R11 | 地图重新生成口径不一致（glob、exclude、行数统计、2 文件归属差异） | 中 | 中 | 在 R-09 提供与地图字段同构的清单；显式记录 `documents.ts`、`fileHttp.ts` 的归属更正；重算后校验 237/14,349 |
| R12 | 本机无 `bun`，无法复跑 typecheck/build | 高 | 低 | M0 在实施环境复跑并记录；本需求矩阵明确“未重跑”，不伪造结果 |

---

## 8. 豁免判定与结构化豁免模板

### 8.1 豁免判定标准（满足任一即可申请）

1. **物理不可拆**：受 `AGENTS.md` 或工具链强约束（如“一个接口一个文件”、`routes/**` 扫描）。
2. **成本大于收益**：拆分带来的回归风险显著高于可量化的结构收益，且已有替代缓解。
3. **依赖未就绪**：需要另一个模块/需求先行（如 AgentHost 未落地则 `@/agent` 出口无法移除）。
4. **语义同源**：两项职责共享同一安全边界或同一生命周期，强行拆分反而增加出错面。

### 8.2 已识别的候选豁免（供评审勾选）

| 编号 | 关联需求 | 问题 | 建议结论 | 替代缓解 |
| --- | --- | --- | --- | --- |
| E1 | R-07 C | `utils/plugins/install.ts`（450 行）是 teams / mcp(dxt) / workspace 共用的安装内核；`listTools` 与 `skills/files` 同属插件市场公共能力 | 允许保留为 `pluginMarket` 公开“安装/工具内核”，不强行下沉 | 模块入口公开 `installKernel`/`listTools`；MCP 只走公开入口，禁止深路径；跨域调用必须走契约 |
| E2 | R-06 / NG1 | `utils.ts` 中 5 个 `@/agent` 出口（agent / canvas / question / a2aSettings / mentionFiles） | 本期保留 | 待 AgentHost 端口化立项后统一移除；期间在出口处加归属注释并登记 |
| E3 | R-07 | `/api/exec`（进程执行）与工作区同属 `localRuntime` | 允许合并 | 二者共用 `isLocalWorkspaceRequest` 同一安全边界；若不合并则单独评估 |
| E4 | R-05 | 若评审拒绝改造 `core.ts` 生成器：`router.ts` 保留 161 条扁平挂载 | 豁免 | 仍需按域分组注释 + 模块前缀清单对账；在模块入口声明前缀，禁止跨模块抢路由 |
| E5 | R-07 D | `conf` 对 `teams`/`mobileLink` 的 2 条 `import type` 类型边 | 优先消除；成本高时本期保留 | 类型下沉到 `src/types/` 属独立需求；期内禁止新增反向依赖，保留时登记 |
| E6 | NG1 | `agent → server` 51 处、`server → agent` 19 处运行期/配置类依赖（agentAccess 8、platformCore 3、pluginMarket 1、mcpIntegration 2、utils.ts 5） | 本期不消除 | 需 AgentHost 端口化；本需求只消除 4 处 mentionSources 非编排依赖 |
| E7 | §2.3 | `platformCore` 的 3 处 `@/agent` 依赖：`utils/conf/index.ts:6`（`A2aSettings` type）、`routes/settings/save.ts:6`、`routes/settings/systemPrompt.ts:3`（prompt 常量/上限 value） | 本期保留；type 边可随 E5 类型下沉，2 处 value 保留 | 不新增第 4 处；模块依赖表标注 type/value |
| E8 | §2.3 | `utils/mcp/tools.ts:8-9` 对 `@/agent/tools`、`@/agent` 的运行期依赖 | 本期保留 | MCP 工具执行 Agent 是其职责；模块入口声明依赖，禁止扩散到其他 MCP 文件 |
| E9 | §2.3 | `routes/agents/a2a/save.ts:8` 对 `@/agent/runtime/model` 的 `getAgentModelConfiguration` 依赖（pluginMarket） | 本期保留 | A2A 插件保存需校验 Agent 模型；仅此 1 处，禁止扩散 |
| E10 | §3.1 | 6 条单向弱边：`mcp→media`、`mcp→local`、`asset→media`、`platform→local`、`platform→media`、`agentAccess→pluginMarket` | 本期保留 | 在模块 `dependencies` 中声明；禁止新增反向 import；R-07 只处理 4 条高价值边 |

### 8.3 豁免说明模板（每条必填）

```text
豁免编号：EX-<模块>-<序号>
关联需求：R-xx
问题描述：<一句话说明未消除的结构问题，含行数/文件数>
尝试过的方案：<方案 A 结果、方案 B 结果>
豁免理由：<对应 §8.1 的哪一条，附量化依据>
影响范围：<文件数/端点数/宿主>
替代缓解：<可执行的约束或校验手段，写明如何评审>
复核触发条件：<例如 "AgentHost 落地后"、"单文件 > 800 行时"、"新增第 3 类插件类型时">
有效期：<本次发布 / 至下个架构评审周期>
责任人：
评审结论：□ 同意  □ 驳回（理由：____）
```

---

## 9. 实施顺序与里程碑（评审通过后执行）

| 阶段 | 内容 | 出口条件 |
| --- | --- | --- |
| M0 | 冻结基线：187 端点、161 挂载、typecheck/build、14 exports、13 项冒烟 fixture | 基线文档归档，可逐条 diff |
| M1 | R-01 + R-02 + R-03 + R-08：模块入口、组合根瘦身、初始化归口、宿主兼容 | `app.ts` ≤80 行；typecheck 通过；三宿主启动 |
| M2 | R-04：`utils/<域>` 迁入 `src/modules/<域>`，含 `documents.ts`/`fileHttp.ts`；`u` facade 保持 | 237/237 归属；246 处引用迁移；端点 diff 为空 |
| M3 | R-07：4 条边按判据处理（A 消除、B/C 契约化、D 消除或 E5） | 4 条 grep 判据全部满足 |
| M4 | 评审决策点：R-05（路由分组）采纳或豁免 E4 | 决策记录入 §11 |
| M5 | R-06 + R-09 + R-11 + 13 项冒烟 | 依赖对账通过；AGENTS 同步；豁免表完成；冒烟 diff 为空 |
| M6 | 交付审查：结构指标 + 契约回归 + 地图重新切分申请 | §6 全部勾选 |

---

## 10. 待评审决策点

- **Q1｜拆分深度**：采纳方案 B（服务模块化，URL 零风险）就交付，还是必须做到方案 C（路由也进模块目录）？
- **Q2｜R-05 路由生成器**：是否改造 `core.ts` 为按域生成子 Router？若不改，是否接受豁免 E4？
- **Q3｜`utils.ts` 存废**：保留 `u` 兼容 facade（145 文件不动）是否可接受为“已收敛”，还是要求同步改调用点？
- **Q4｜NG1 边界**：是否同意本版“只消除 4 处 mentionSources 非编排依赖，运行期/配置类 agent 依赖登记 E2/E6/E7/E8/E9”的口径？
- **Q5｜R-07 边 B/C**：`pluginMarket → mediaGeneration`、`mcpIntegration → pluginMarket` 采用“公开契约 + 禁止深路径”是否足以判定为“已处理”？
- **Q6｜文件预算**：接受“业务实现 ≤50 / 含契约 ≤55 文件 / ≤3,300 行”的双层预算，还是要求更严格的单层上限（如 ≤52）？
- **Q7｜13 项冒烟**：是否接受“以改动前后 diff 为空”为判据（而非固定 200），以适配无供应商/无桌面宿主的环境？

---

## 11. 评审意见栏

> 待评审人填写。可逐条对 R-01～R-11、Q1～Q7、E1～E10 给出结论。

| 评审人 | 日期 | 结论（通过 / 有条件通过 / 驳回） | 意见 |
| --- | --- | --- | --- |
|  |  |  |  |
|  |  |  |  |
|  |  |  |  |

**自由意见区**

```text
（留空，待评审填写）
```

---

## 附录 A：本次核验所用只读命令（可复现）

> 所有命令在仓库根目录执行；只读，不修改任何业务文件。

```bash
# 1) 模块文件/行数对账（结果 237 / 14,349）
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

# 2) 路由与端点基线
find apps/server/src/routes -name '*.ts' | wc -l                       # 161
grep -rhoE '\.(get|post|put|patch|delete|all)\(' apps/server/src/routes | sort | uniq -c
# 合计 187：GET 67 / POST 79 / PUT 20 / DELETE 11 / ALL 8 / PATCH 2
grep -c 'app.use' apps/server/src/router.ts                            # 161

# 3) 聚合入口耦合
grep -rl 'from "@/utils"' apps/server/src --include='*.ts' | wc -l     # 145（路由占 144）
grep -rho 'from "@/utils/[a-zA-Z]*' apps/server/src --include='*.ts' | wc -l      # 246

# 4) 环的两端（import 行口径）
grep -rn 'from "@/utils' apps/server/src/agent --include='*.ts' | wc -l   # 51
grep -rn 'from "@/agent' apps/server/src --include='*.ts' | grep -v '^apps/server/src/agent/' | wc -l  # 23

# 5) R-07 四条边基线
grep -rn 'from "@/agent' apps/server/src/utils/assets apps/server/src/routes/workspaces --include='*.ts'
# 期望 4 行：assets/index.ts:5、assets/library.ts:5、assets/thumb.ts:4、routes/workspaces/files/thumb.ts:10

grep -rn 'from "@/utils/plugins' apps/server/src/utils/media --include='*.ts'   # 0（反向）
grep -rn 'from "@/utils/media' apps/server/src/utils/plugins --include='*.ts'   # 1：install.ts:11（正向）

grep -rn 'from "@/utils/plugins\|from "@/utils/skills' apps/server/src/utils/mcp --include='*.ts'
# 期望 3 行：dxt.ts:9、tools.ts:13、resources.ts:6

grep -rn 'from "@/utils/teams\|from "@/utils/mobileLink' apps/server/src/utils/conf --include='*.ts'
# 期望 2 行：conf/index.ts:5,8（type）
grep -rn 'from "@/utils/conf' apps/server/src/utils/teams apps/server/src/utils/mobileLink --include='*.ts'
# 期望 4 行：teams/index.ts:5、teams/install.ts:4、teams/files.ts:6、mobileLink/index.ts:10

# 6) 文件预算复核（业务实现 vs 含契约）
python3 - <<'PY'
import json
d=json.load(open('.easyvibe/map/modules/server-api.json'))
for s in d['sub_modules']:
    print(s['id'], len(s['files']))
PY

# 7) 基线质量（M0 在实施环境执行；本机当前 PATH 无 bun）
cd apps/server && bun run typecheck
```

---

## 附录 B：与第 1 版的关键差异摘要

| 项 | 第 1 版 | 第 2 版 |
| --- | --- | --- |
| NG1 | “不切断 server ↔ agent 双向 import”，与 R-07/6.1 冲突 | 收窄为“不消除运行期依赖；消除 4 处 mentionSources 非编排依赖”；新增 §2.3 边界表 |
| R-07 边数/判据 | 3 条边，方向/计数/类型有误 | 4 条边；逐条 `file:line`、方向、计数、type/value、处理方式、grep 判据 |
| `pluginMarket` 文件上限 | ≤50，自身新增即突破 | 业务 ≤50；含契约 ≤55；最坏 51 |
| R-04 覆盖 | 漏 `documents.ts`、`fileHttp.ts` | 显式纳入并给出引用点、归属、理由；237 对账 |
| 冒烟 | 声称 13 项，实列 9 项 | 13 项逐条方法/路径/fixture/期望 + 4 项补充 |
| 模块行数 | media 2,920 / local 2,309 / platform 886 | media 2,994 / local 2,195 / platform 926（2 文件语义归位后） |
| 初始化归口 | 6 类插件 + 供应商哈希全归 pluginMarket | 插件 5 类 → pluginMarket；providers/hash → mediaGeneration；缩略图 → assetLibrary |
| typecheck | 记录通过 | 本版未重跑（无 bun），M0 必跑，不伪造 |
