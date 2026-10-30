# 需求矩阵 · server-api 应用子模块拆分

> **状态：第 1 轮已打回（2026-10-26）。** 本文档仅作历史记录，不再作为评审依据；修订版见 [`2026-10-26-21-36-serverApiSubmoduleSplit-v2.md`](./2026-10-26-21-36-serverApiSubmoduleSplit-v2.md)（REQ-2026-10-26-02）。

## 0. 文档元信息

| 项 | 内容 |
| --- | --- |
| 文档编号 | REQ-2026-10-26-01 |
| 需求来源 | 架构地图关注点 `c-server-api-1`（`.easyvibe/map/map.json`）、全局关注点 `c-arch-2` |
| 需求标题 | server-api 按素材库 / 媒体生成 / 插件市场 / MCP·工作区拆出应用子模块，app.ts 只保留组合根与路由装配 |
| 影响模块 | `server-api`（apps/server） |
| 需求类型 | 结构性重构（架构整改），不改业务行为 |
| 当前状态 | **第 1 轮已打回**（未实施，仓库代码零改动）；修订版见 REQ-2026-10-26-02 |
| 编写人 | 需求分析 agent（harness 规则 2.1） |
| 编写时间 | 2026-10-26 21:27 |
| 基线 | `git HEAD = d084136`，`.easyvibe/map/map.json` 生成于 2026-10-26T21:13:59+08:00 |
| 验收口径 | 问题消除 + 审查通过；无法消除项按 §8 结构化豁免说明登记 |

---

## 1. 背景

### 1.1 现状量化（本次实测，非地图转述）

| 指标 | 实测值 | 核验方式 |
| --- | --- | --- |
| server-api 文件 / 行数 | **237 文件 / 14,349 行** | 模块 glob 展开后逐文件统计，与地图数字完全一致 |
| 路由文件 | **161**（21 个一级目录 + `routes/agent.ts` 顶层文件） | `find src/routes -name '*.ts'` |
| 注册端点 | **187**（GET 67 / POST 79 / PUT 20 / DELETE 11 / ALL 8 / PATCH 2） | 逐文件提取 `.get/.post/...` |
| `router.ts` 挂载条目 | **161 条**，与 `routes/` 目录当前内容一一对应、无漂移 | 复算 `core.ts` 路径规则后逐条比对 |
| 全局聚合入口 `utils.ts` | **37 个出口**（34 个 namespace + `conf` + 2 个函数），其中 **5 个来自 `@/agent`** | 读 `utils.ts` |
| `import u from "@/utils"` 的引用 | **145 个文件**，其中 **144/161 个路由文件** | `grep -rl 'from "@/utils"'` |
| 深路径 `@/utils/<域>` 引用 | **246 处** | `grep -rho 'from "@/utils/[a-zA-Z]*'` |
| 路由 / 工具直接 `import @/agent` | **23 处**（`utils/singleAgent` 5、`utils.ts` 5、`utils/mcp/tools` 2、`routes/agent.ts` 2 等） | 同上 |
| `app.ts` | **160 行**，内含 6 类内置插件初始化、供应商源码哈希、缩略图缓存预热、供应商模型刷新、MCP 挂载、A2A 挂载、静态站点、错误处理、移动互联初始化 | 读 `src/app.ts` |
| 子模块内最大文件 | `utils/assets/library.ts` 729 行、`utils/media/provider.ts` 498 行、`utils/plugins/install.ts` 450 行 | `wc -l` |
| 基线质量 | `bun run typecheck` **通过**（无输出）；`router.ts` 生成物与目录一致 | 本地实跑 |
| 地图健康度 | 模块分 **50**，标记 `god_module` / `circular_dep` / `coupling_high` | `map.json` |

### 1.2 问题陈述（拆解为 5 个可独立验证的根因）

- **P1｜边界只存在于目录名，没有模块契约对象。** 现有 21 个路由目录、15 个 `utils/*` 目录在语义上已是分域，但没有任何"模块入口"声明（职责、路由前缀、初始化钩子、对外导出、依赖清单）。结果是地图只能把 237 个文件登记为 1 个模块，评分 50；任何治理动作都只能以整模块为单位。
- **P2｜组合根承担业务初始化。** `createApp` 内联了 6 类插件目录初始化与内置清单扫描、供应商源码哈希计算、缩略图缓存预热、供应商模型刷新、MCP/A2A 网关挂载、移动互联运行时初始化。任一插件类型或网关变化都要回到同一文件改动；同时 `app.locals.builtinPlugins` 这种跨域状态由组合根生产，5 组路由消费。
- **P3｜全局聚合入口把模块拆分成败锁死在编译期依赖闭包上。** `utils.ts` 把 34 个 namespace（含 `@/agent`）聚合成单对象，145 个文件直接依赖它。即便把目录拆开，任一域改动仍牵动同一闭包，子模块之间也无法形成单向 DAG。
- **P4｜跨域调用隐式且方向混乱。** 实测：`utils/assets` → `@/agent/mentionSources`（3 处，类型）、`utils/plugins` → `utils/media`（供应商安装）、`utils/mcp` → `utils/plugins`（DXT 安装内核）、`utils/teams` ↔ `utils/plugins` ↔ `utils/conf` 构成环（`conf` 反向 `import type` teams/mobileLink）。
- **P5｜路由装配是 161 条扁平挂载。** `router.ts` 327 行、无分组常量，新增/移动任一接口整文件重写，评审 diff 与并行开发冲突成本高（近 200 次提交中 `router.ts` 变更 20 次，位列第一）。

### 1.3 约束（来自 `AGENTS.md`，直接决定难度与风险）

| 约束 | 出处 | 对本需求的影响 |
| --- | --- | --- |
| **一个接口一个文件**，`routes/**/*.ts` 全量扫描，URL 由文件相对路径决定 | AGENTS「目录结构」「路由与路径规则」 | 目录重组会直接改变 URL；要么保持 `routes/` 位置不动，要么改造 `core.ts` 生成器并保证 URL 逐条不变 |
| **通用工具统一 `import u from "@/utils"`**，导出由 `utils.ts` 管理 | AGENTS「引用与代码风格」 | 合并/拆分聚合入口属于规范变更，需同步改 AGENTS.md，不能悄悄绕过 |
| **不为简单接口额外搭 controller / service / repository 层** | AGENTS「目录结构」 | 子模块只能是「路由 + 域工具 + 模块入口」，不得引入分层样板 |
| **禁止新增测试/自检代码** | AGENTS「测试与检查边界」 | 无法用单测兜底，回归只能靠 `typecheck` + `build` + 端点清单 diff + 手工 HTTP 冒烟 |
| `app.ts` 不监听端口、不建 worker；桌面/移动复用 `@toonflow/server/app` | AGENTS「技术栈与职责」 | `createApp` 对外签名与 `@toonflow/server/*` exports 必须保持兼容 |
| 文件/目录小驼峰、双引号、分号、两空格 | AGENTS 通用规范 | 新模块目录命名需为 `assetLibrary` / `mediaGeneration` 这类小驼峰 |

---

## 2. 目标与非目标

### 2.1 目标

- **G1**：`server-api` 在架构地图中由 1 个 237 文件模块拆为 **8 个模块（1 个组合根 + 7 个应用子模块）**，单个子模块 ≤ 50 文件、≤ 3,000 行。
- **G2**：`app.ts` 只保留组合根职责（参数归一、全局中间件顺序、模块装配、静态资源、统一错误处理），**不再出现任何插件类型、供应商哈希、具体网关的业务分支**。
- **G3**：对外 HTTP 契约 **187 个端点的方法与路径 100% 不变**；`@toonflow/server/*` 包的 exports 与 `createApp` 签名不变。
- **G4**：每个子模块有可读的模块入口（职责、路由前缀、初始化钩子、对外导出、依赖方向），模块间依赖按声明方向单向。
- **G5**：无法在本需求内消除的耦合，按 §8 模板结构化登记豁免，写明理由、替代缓解与复核触发条件。

### 2.2 非目标（明确排除，避免范围蔓延）

- **NG1**：不做 AgentHost 端口化、不切断 `server ↔ agent` 双向 import（属关注点 `c-server-api-2`，需与 `agent-runtime` 同步立项；本需求只登记依赖与豁免）。
- **NG2**：不抽前端 `contracts` 包、不改 web 的 108 处 `/api` 字面量（属 `c-web-console-1`）。
- **NG3**：不把 server 拆成多个 workspace 包（不新增 `packages/app-*`），不做跨包发布。
- **NG4**：不改任何接口行为、响应结构、鉴权语义、数据目录与插件安装语义。
- **NG5**：不做 5 组同构插件路由的去重、不拆 `library.ts`/`provider.ts` 巨型文件（可另立需求）。

---

## 3. 目标边界（建议的子模块切分）

| # | 子模块（小驼峰目录） | 职责 | 文件 / 行数 | 端点数 | 主要依赖方向 | 现状评分 |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | `bootstrap`（app.ts / index.ts / core.ts / router.ts / utils.ts / scripts） | 组合根、路由表生成、全局聚合出口 | 8 / 710 | 0 | → 全部子模块 | 48 |
| 1 | `assetLibrary`（素材库） | 全局/项目素材库根解析、索引分页、增删改移、回收站、缩略图、用量与变更事件 | 27 / 2,615 | 20 | → workspace, platformCore | 64 |
| 2 | `mediaGeneration`（媒体生成 + 模型/供应商 + ffmpeg） | LLM 模型与供应商配置、文本生成、媒体模型与生成任务、计费、ffmpeg 执行 | 41 / 2,920 | 28 | → platformCore, workspace | 55 |
| 3 | `pluginMarket`（插件市场） | tool/node/ext/skill/agent 五类插件与团队的安装、读取、保存、启停、卸载、排序、导出 | 49 / 2,283 | 49 | → platformCore, mediaGeneration | 57 |
| 4 | `mcpIntegration`（MCP） | MCP 服务器配置、DXT/JSON 导入、对外 MCP 端点、控制通道、技能资源 | 20 / 1,433 | 13 | → platformCore, pluginMarket | 71 |
| 5 | `localRuntime`（工作区 / 本机能力 / 宿主接入） | 工作区文件 CRUD 与越界防护、命令执行、桌面宿主桥、设备配对与远端代理 | 47 / 2,309 | 43 | → platformCore, bootstrap | 52 |
| 6 | `agentAccess`（Agent 会话编排） | Agent 流式会话、单 Agent 运行与工具回调、浏览器输入输出、会话状态桥接 | 26 / 1,193 | 22 | → platformCore；**当前反向依赖 agent-runtime** | 60 |
| 7 | `platformCore`（HTTP 横切与配置） | i18n、字段校验、统一响应/错误、平台能力判定、conf 持久化、设置与监控接口 | 19 / 886 | 12 | → 无（叶子，被全部引用） | 66 |
| — | **合计** | | **237 / 14,349** | **187** | | **50** |

说明：
- 文件与行数取自 `.easyvibe/map/modules/server-api.json` 的 8 个子模块清单，并与磁盘实际文件对账（地图快照缺 9 个新文件，已按语义归位后合计精确等于 237 / 14,349）。
- 端点数按 URL 前缀归集：`assets 20`、`ai+providers+ffmpeg 28`、`tools/nodes/ext/skills/agents/plugins 49`、`mcp 13`、`workspaces+desktop+exec+mobileLink 43`、`agent+singleAgent+browser+sessionState 22`、`settings+monitor 12`。
- `localRuntime` 是本需求内唯一的"多职责子模块"（工作区文件 + 命令执行 + 桌面桥 + 设备互联），建议保留但列为 P2 可再拆（见 R-07）。

---

## 4. 需求矩阵

### 4.1 矩阵总表

| 编号 | 需求项 | 可验证目标 | 优先级 | 难度 | 风险 | 依赖 |
| --- | --- | --- | --- | --- | --- | --- |
| R-01 | 建立 7 个应用子模块与组合根清单，每个模块提供入口契约 | 地图可据清单切成 8 个模块；7 个应用子模块各有 `index.ts` 声明职责/前缀/初始化/导出，组合根由 `app.ts` 承担 | **P0** | 中（3 人日） | 中 | 无 |
| R-02 | `app.ts` 瘦身为纯组合根 | `app.ts` ≤ 80 行；不含插件类型、供应商哈希、网关细节分支 | **P0** | 中（2 人日） | **高** | R-01 |
| R-03 | 插件初始化与内置清单归口 `pluginMarket` | `initializePluginRoots()` 一次返回 `builtinPlugins` 与 `revision`，组合根只调用不实现 | **P0** | 中（2 人日） | 中 | R-01 |
| R-04 | 服务目录模块化：`utils/<域>` 迁入 `src/modules/<域>` | 7 个应用子模块目录成形；`@/utils` 保持兼容 facade，246 处深路径迁移完成 | **P0** | 很高（6-8 人日） | **高** | R-01 |
| R-05 | 路由装配分组：`core.ts` 按域生成子 Router | `router.ts` 由 161 条降为约 21 条域级挂载，187 端点 method+path 全等 | P1 | 高（4 人日） | **高** | R-04 |
| R-06 | 聚合入口收敛：`utils.ts` 拆为模块级出口 + 薄 facade | 出口按模块分组；`@/agent` 出口移除（需 AgentHost，本次豁免） | P1 | 高（4 人日） | 高 | R-04、AgentHost |
| R-07 | 跨域依赖单向化（至少 3 条边） | `assetLibrary` 不依赖 agent；`pluginMarket` 不再被 `mediaGeneration` 反向依赖；安装内核显式化 | P2 | 高（4 人日） | 中 | R-04 |
| R-08 | 宿主装配兼容（desktop / mobile / 独立 server） | `createApp` 签名不变；`@toonflow/server/*` 14 个 export 全部可用；三宿主可启动 | **P0** | 低（1 人日） | 中 | R-02 |
| R-09 | 规范与地图同步 | 更新 AGENTS.md 目录结构与引用规则；提交模块清单供地图重新切分 | **P0** | 低（1 人日） | 低 | R-01…R-04 |
| R-10 | 建立并对齐回归基线 | 187 端点清单与 `router.ts` 冻结；实施后 diff 为空；typecheck/build/冒烟通过 | **P0** | 中（2 人日） | 低 | 无（先行） |
| R-11 | 豁免登记（结构化） | 每条未消除项按 §8 模板落表，含替代缓解与复核触发条件 | **P0** | 低（0.5 人日） | 低 | R-05、R-06、R-07 |

### 4.2 需求明细

#### R-01 建立子模块清单与模块入口契约（P0）

- **背景**：见 P1。当前无任何模块级声明，拆分不可评审、不可校验。
- **描述**：在 `apps/server/src/modules/<域>/index.ts` 中提供统一形状的模块声明（**不引入 service/controller 层，仅声明 + 装配**）：
  - `id` / `name` / `responsibility`（供地图与文档引用）；
  - `routePrefixes`（声明本模块占用哪些 `/api/*` 前缀，与 `router.ts` 对账，防止跨模块抢路由）；
  - `initialize(context)`（可选，替代组合根里的内联初始化）；
  - `exports`（本模块允许被其他模块使用的公开能力，其余视为内部）；
  - `dependencies`（允许依赖的模块白名单，供评审时人工核对）。
- **验收**：7 个应用子模块目录齐全（组合根留在 `src/app.ts`）；每个模块的 `routePrefixes` 并集 = 现有 21 个 URL 前缀且无交集；模块清单可直接映射为地图模块定义。
- **难度**：中；**风险**：中（若清单与实际目录脱节，会退化为"文档式拆分"）→ 缓解：`routePrefixes` 由 `router.ts` 挂载表反向核对，而不是手写猜测。

#### R-02 `app.ts` 瘦身为组合根（P0）

- **背景**：见 P2。`app.ts` 160 行里 6 类插件初始化、供应商哈希、缩略图预热、模型刷新、MCP/A2A 挂载、移动互联初始化与中间件顺序混写。
- **描述**：组合根只保留：`createApp` 参数归一与 `TOONFLOW_DATA_DIR` 设定 → 全局中间件顺序（CORS 校验、`languageRequest`、分端点 body 限制、桌面门禁）→ 遍历模块执行 `initialize` 与路由挂载 → 静态资源 → 统一错误处理。业务初始化全部移入对应模块入口，由模块返回需要写入 `app.locals` 的值。
- **验收**：`app.ts` ≤ 80 行；文件内不出现 `initializePlugins`、`autoInstallProviders`、`builtinPlugins` 具体类型分支、`createMcpRouter`、`createA2aRouter`、`initializeMobileLinkRuntime`；中间件顺序（尤其是 `/api/sessionState` 的 64kb 限制必须先于全局 100mb）保持不变。
- **难度**：中；**风险**：**高**（数据目录时序 + 中间件顺序 + 宿主在 `createApp` 之后才设置 `app.locals.desktop` 并启动 MCP runtime）→ 缓解见 §7 R2/R3。

#### R-03 插件初始化与内置清单归口 `pluginMarket`（P0）

- **背景**：P2 + 5 组路由依赖 `req.app.locals.builtinPlugins.{tool,node,ext,skill,agent}`。
- **描述**：把 6 类插件目录初始化、供应商源码哈希（`autoInstallProviders` + sha256）、内置插件名清单扫描统一到 `pluginMarket` 模块，一次性产出 `{ builtinPlugins, revision }` 写入 `app.locals`；提供幂等与顺序保证（tools → nodes → ext → providers → skills → agents）。
- **验收**：`app.ts` 中 0 处插件初始化代码；`app.locals.builtinPlugins` 结构不变（`Record<type, Set<name>>`）；5 组路由行为不变。
- **难度**：中；**风险**：中（初始化失败会阻断启动；`initializePlugins` 的 marker/revision 语义不能改）。

#### R-04 服务目录模块化（P0）

- **背景**：P1 + P3。模块边界要落到目录，地图才能据 glob 切分。
- **描述**：`src/utils/<域>` 迁移为 `src/modules/<域>/`（小驼峰命名），路由目录按下表归位或保留：

  | 模块 | 迁入的服务目录 | 对应路由目录（当前） |
  | --- | --- | --- |
  | `assetLibrary` | `utils/assets` | `routes/assets` |
  | `mediaGeneration` | `utils/media`、`utils/ai`、`utils/ffmpeg` | `routes/ai`、`routes/providers`、`routes/ffmpeg` |
  | `pluginMarket` | `utils/plugins`、`utils/skills`、`utils/teams` | `routes/tools`、`routes/nodes`、`routes/ext`、`routes/skills`、`routes/agents`、`routes/plugins` |
  | `mcpIntegration` | `utils/mcp` | `routes/mcp` |
  | `localRuntime` | `utils/workspace`、`utils/desktop`、`utils/mobileLink`、`utils/exec`、`remoteConnection.ts` | `routes/workspaces`、`routes/desktop`、`routes/exec`、`routes/mobileLink` |
  | `agentAccess` | `utils/singleAgent`、`utils/sessionState`、`utils/browser` | `routes/agent*`、`routes/singleAgent`、`routes/browser`、`routes/sessionState` |
  | `platformCore` | `utils/conf`、`lib/*`、`utils/monitor`、`utils/personalization`、`types/desktop.ts` | `routes/settings`、`routes/monitor` |

  - 246 处深路径 `@/utils/<域>` 同步迁移；`utils.ts` 保留 `u` 的兼容 facade（避免一次性改 145 个文件）。
  - `package.json` exports 同步：`./browser`、`./mcp`、`./mobileLink`、`./desktop` 指向新路径（web / desktop / mobile 三端仍可解析）。
- **验收**：`src/modules/` 下 7 个应用子模块目录成形（组合根仍在 `src/app.ts`）；`grep -r '@/utils/'` 归零（facade 与 re-export 除外）；typecheck 通过；`@toonflow/server/*` 14 个 export 全部可 import。
- **难度**：很高（涉及 237 文件中的绝大多数 + 246 处引用）；**风险**：**高**（`import.meta.dirname` 相对定位、`createRequire(import.meta.url)` 解析第三方包、Bun 打包路径）→ 缓解见 §7 R5。

#### R-05 路由装配分组（P1，可豁免）

- **背景**：P5。`router.ts` 161 条扁平挂载，是"组合根与所有子模块双向依赖"的放大器。
- **描述**：`core.ts` 由"每个文件一条 `app.use`"改为"每个 URL 前缀生成一个子 Router"，`router.ts` 只保留约 21 条域级挂载；URL 由"路由目录相对路径"改为"模块声明前缀 + 目录内相对路径"，两者必须逐条等价。
- **验收**：`bun run routes` 重新生成后，187 个端点的 method + path 与基线清单完全一致；`router.ts` ≤ 60 行；`core.ts` 生成规则有明确的前缀映射（不靠隐式约定）。
- **难度**：高；**风险**：**高**（路径漂移 = 前端 108 处 `/api` 字面量静默 404，且项目禁止用测试兜底）→ 若评审认为收益不足，建议**豁免**并保留 161 条挂载（见 §8 候选豁免 E4）。

#### R-06 聚合入口收敛（P1，部分豁免）

- **背景**：P3。`utils.ts` 37 个出口、145 文件引用；5 个出口来自 `@/agent`，是 `server ↔ agent` 环的放大器。
- **描述**：`utils.ts` 由"全量聚合"改为"按模块分组的薄 facade"（每模块一段 re-export，仍导出同名 key 以保持 `u.assets` 等调用不变）；`@/agent` 的 5 个出口在 AgentHost 就绪前**保留并登记豁免**。
- **验收**：`utils.ts` 内每个出口都能追溯到唯一模块；移除 1 个模块的改动不再需要动 `utils.ts` 公共结构；`u.<domain>` 的既有调用面零修改（145 文件不改）。
- **难度**：高；**风险**：高（与 agent 改造交叉；facade 若保留过度，收敛名存实亡）→ 缓解：以"出口归属注释 + 模块目录"作为可评审产物，而非仅靠行数。

#### R-07 跨域依赖单向化（P2）

- **背景**：P4。实测 3 类越界：素材库→agent 类型、插件市场→媒体供应商、MCP→插件安装内核，另有 `conf` ↔ `teams`/`mobileLink` 类型环。
- **描述**：按收益优先级处理：
  1. `utils/assets` 的 3 处 `@/agent/mentionSources` 类型下沉到 `types/`（切断素材库对 agent 的编译期依赖）；
  2. `pluginMarket` 依赖的 `utils/media/provider` 能力改为由 `mediaGeneration` 公开导出的 `installProvider` 契约；
  3. `mcp` 对 `utils/plugins/install`（zip 解包/版本比较）的复用**显式化为安装内核**并被允许（登记豁免 E1），不再当作隐藏耦合。
- **验收**：`grep` 证明 `modules/assetLibrary` 下 0 处 `@/agent`；模块 `dependencies` 声明与实际 import 一致；剩余跨模块引用均有豁免编号。
- **难度**：高；**风险**：中（类型下沉可能牵动 web 的 `@toonflow/server/agent/mentionSources` 契约）。

#### R-08 宿主装配兼容（P0）

- **背景**：`createApp` 由独立 server、Electrobun 桌面、Android/OHOS 移动三处调用；桌面在拿到 app 后才设置 `app.locals.desktop` 并启动 MCP runtime；移动端还叠加了 `/api/connection` 与反向代理。
- **描述**：保持 `createApp` 参数与返回值不变；`@toonflow/server/{app,remoteConnection,desktop,platform,documentFormats,nodeMenu,modelReasoning,mcp,mobileLink,browser,agent/types,singleAgent/types,agent/mentionSources,i18n}` 全部 export 路径可用（必要时改为 re-export 转发）。
- **验收**：三宿主可启动；桌面 `app.locals.desktop` 注入路径与门禁行为不变；`/api/desktop/*` 15 个端点仍仅桌面可用。
- **难度**：低；**风险**：中（`@toonflow/server/*` 是 web 的编译期契约，38 处引用）。

#### R-09 规范与地图同步（P0）

- **描述**：更新 `AGENTS.md`（目录结构、`utils.ts` 入口规则、模块入口约定）；在实施完成后提供模块清单，请求架构侧重新生成地图并把 `server-api` 拆成 8 个子模块；`package.json` exports 与 `tsconfig` paths 同步。
- **验收**：AGENTS.md 与代码一致（无"文档写 A、代码是 B"）；地图新模块的 glob 与 `src/modules/<域>/**` 对得上。
- **难度**：低；**风险**：低（但遗漏会直接导致"问题未消除"判定）。

#### R-10 回归基线（P0，先行）

- **描述**：实施前冻结三份基线：① 187 条 `method + path` 清单；② `router.ts` 全文；③ `typecheck` 通过状态。实施后逐项 diff，并要求 `bun run routes` 生成结果与基线一致（R-05 若采纳则挂载粒度变化、端点清单不变）。
- **验收**：diff 为空；`bun run typecheck`、`bun run build` 通过；手工 curl 冒烟覆盖 13 个关键端点（agent 流式、assets 读写、media generate、plugins install、mcp status、workspaces files、desktop update、settings、exec）。
- **难度**：中；**风险**：低（项目禁止新增测试文件，基线只能用文档 + 手工命令固化）。

#### R-11 结构化豁免登记（P0）

- **描述**：凡本需求内不消除的问题，逐条按 §8 模板登记，写明"尝试过什么、为什么不拆、替代缓解、何时复核"。
- **验收**：每条残余问题都有编号、责任人与复核触发条件；评审可在豁免栏直接勾选同意/驳回。

---

## 5. 方案选项与推荐

| 方案 | 内容 | 改动面 | URL 风险 | 能否"消除"237 文件模块 | 预估人日 | 结论 |
| --- | --- | --- | --- | --- | --- | --- |
| **A｜仅清单化** | 只新增 7 个模块入口声明与依赖清单，`utils/`、`routes/` 目录不动；`app.ts` 瘦身 | 小（~15 文件） | 无 | **否**（地图仍只有 1 个 237 文件模块） | 4-5 | 可作过渡，不满足验收 |
| **B｜服务模块化 + 路由保留** | 方案 A + `utils/<域>` 迁入 `src/modules/<域>`；`routes/` 位置与 `core.ts` 不变，URL 零风险 | 中（~200 文件路径 + 246 处引用） | 无 | **基本可以**（子模块 = modules/** + routes/<域>/**） | 9-11 | **推荐第一期** |
| **C｜全量目录化** | 方案 B + 路由文件也迁入模块目录 + `core.ts` 按域生成子 Router；`utils.ts` 收敛 | 大（全部 237 文件 + 生成器） | **高**（路径由目录推导） | **可以** | 16-20 | **推荐第二期（评审后再定 R-05）** |

**推荐路径**：`R-10 基线` → `R-01/02/03/08` → `R-04` → 评审决策 R-05 → `R-06/07` → `R-09/11`。
理由：先把组合根与初始化从 `app.ts` 剥离（低风险、立竿见影），再做目录迁移；路由目录与生成器的改动（R-05）风险最高、收益相对最小（地图评分中属 medium），应作为独立决策点。

---

## 6. 验收标准

### 6.1 硬性结构指标

- [ ] 地图/清单中 `server-api` 拆为 **8 个模块（1 组合根 + 7 应用子模块）**；最大子模块 **≤ 50 文件 / ≤ 3,000 行**（现状最大 49 文件为 `pluginMarket`、2,920 行为 `mediaGeneration`，已达边界）。
- [ ] `app.ts` **≤ 80 行**，且不含任何具体插件类型、供应商哈希、网关构造代码（R-02）。
- [ ] `bootstrap` 子模块合计 **≤ 800 行**（现状 710，允许小幅上升）。
- [ ] 每个子模块有入口文件，声明职责 / 路由前缀 / 初始化 / 导出 / 依赖（R-01）。
- [ ] 模块间依赖无新增环；`assetLibrary` 对 `agent` 依赖归零（R-07 第 1 项）。

### 6.2 契约与回归

- [ ] **187 个端点的方法与路径 100% 不变**（逐条 diff 基线）。
- [ ] `bun run routes` 生成结果与基线一致（若采纳 R-05：挂载粒度变、端点清单不变）。
- [ ] `bun run typecheck`、`bun run build` 通过；`build/server` 产物可启动。
- [ ] `@toonflow/server/*` 14 个 export 全部可用（web 38 处引用不报错）。
- [ ] 三宿主启动冒烟：独立 server（`dev` 与 `build/server` 两种路径）、桌面（`app.locals.desktop` 门禁 + update 流转）、移动（`/api/connection` 代理）。
- [ ] 关键端点手工冒烟 13 项（见 R-10）返回与改动前一致。

### 6.3 规范与交付物

- [ ] `AGENTS.md` 已同步（目录结构、`utils.ts` 规则、模块入口约定）。
- [ ] 无新增 controller/service/repository 分层；无新增测试文件；无新增第三方依赖。
- [ ] 豁免登记表完整（编号、理由、替代缓解、复核触发条件、责任人）。
- [ ] 模块清单已提交，可供架构侧重新生成地图。

---

## 7. 风险登记表

| 编号 | 风险 | 概率 | 影响 | 缓解措施 |
| --- | --- | --- | --- | --- |
| R1 | 路由 URL 漂移（前端 108 处 `/api` 字面量静默 404） | 中 | 极高 | 先冻结 187 端点基线；R-05 单独评审；生成器改动后逐条 diff；手工冒烟覆盖每个 URL 前缀 |
| R2 | 启动顺序回归（`TOONFLOW_DATA_DIR` 必须先于 `conf` 加载；`/api/sessionState` 64kb 限制必须先于全局 100mb） | 中 | 高 | 把"中间件顺序与初始化顺序"写成 `app.ts` 内的显式有序数组；改动前后对同一条请求链路做手工验证 |
| R3 | 宿主耦合：桌面在 `createApp` 之后注入 `app.locals.desktop` 并启动 MCP runtime；移动端包一层代理 | 中 | 高 | 组合根只做"装配"，不假设 `desktop` 已注入；保持 `createApp` 返回值与 exports 不变；三宿主各跑一次冒烟 |
| R4 | 循环依赖扩散（`conf` ↔ `teams`/`mobileLink` 类型环、`dxt` ↔ `servers` 运行期环） | 中 | 中 | 本期只做"移动位置"，不新增 import；环按原样迁移并登记豁免，避免重构中放大 |
| R5 | 路径敏感代码失效（`import.meta.dirname` 定位数据目录、`createRequire(import.meta.url)` 解析第三方包、Bun 单文件打包） | 中 | 高 | 迁移后核对 `utils/conf` 的相对层深、`plugins/install`、`teams/install` 的 `createRequire`；`build` 产物实际启动验证 |
| R6 | 改动面过大导致评审不可控（145 处聚合引用 + 246 处深路径） | 高 | 中 | 保持 `u` 外观不变；按模块分 PR（每模块一次评审）；机械迁移与语义调整分开提交 |
| R7 | 与并行需求冲突（AgentHost、contracts 包、插件去重） | 中 | 中 | 明确 NG1/NG2/NG5；`utils.ts` 与 `@/agent` 出口只做登记不动，留待 AgentHost 立项 |
| R8 | 无自动化测试兜底（规范禁止新增测试） | 高 | 高 | 用"端点清单 + `router.ts` diff + typecheck/build + 手工冒烟"四件套替代；在交付说明中如实写"未做功能测试" |
| R9 | "文档式拆分"：模块入口只是摆设，实际依赖仍混乱 | 中 | 高 | 用 `routePrefixes` 并集/交集、模块 `dependencies` 与实际 import 的对账作为验收证据，而非只看目录是否存在 |
| R10 | 地图重新生成口径不一致（glob、exclude、行数统计） | 低 | 中 | 在 R-09 提供与地图字段同构的清单（id / files / lines / entries / deps） |

---

## 8. 豁免判定与结构化豁免模板

### 8.1 豁免判定标准（满足任一即可申请）

1. **物理不可拆**：受 `AGENTS.md` 或工具链强约束（如"一个接口一个文件"、`routes/**` 扫描）。
2. **成本大于收益**：拆分带来的回归风险显著高于可量化的结构收益，且已有替代缓解。
3. **依赖未就绪**：需要另一个模块/需求先行（如 AgentHost 未落地则 `@/agent` 出口无法移除）。
4. **语义同源**：两项职责共享同一安全边界或同一生命周期，强行拆分反而增加出错面。

### 8.2 已识别的候选豁免（供评审勾选）

| 编号 | 关联需求 | 问题 | 建议结论 | 替代缓解 |
| --- | --- | --- | --- | --- |
| E1 | R-07 | `utils/plugins/install.ts`（450 行）是 teams / mcp(dxt) / workspace 共用的安装内核 | 允许保留为"安装内核"，不强行下沉 | 在模块入口中显式声明为公开能力；跨域调用必须走该契约 |
| E2 | R-06 | `utils.ts` 中 5 个 `@/agent` 出口（agent / canvas / question / a2aSettings / mentionFiles） | 本期保留 | 待 AgentHost 端口化立项后统一移除；期间在出口处加归属注释并登记 |
| E3 | R-07 | `/api/exec`（进程执行）与工作区同属 `localRuntime` | 允许合并 | 二者共用 `isLocalWorkspaceRequest` 同一安全边界；若不合并则单独评估 |
| E4 | R-05 | 若评审拒绝改造 `core.ts` 生成器：`router.ts` 保留 161 条扁平挂载 | 豁免 | 仍需按域分组注释 + 模块前缀清单对账；在模块入口声明前缀，禁止跨模块抢路由 |
| E5 | R-07 | `conf` 对 `teams`/`mobileLink` 的 `import type` 类型环 | 本期保留 | 类型下沉到 `types/` 属独立需求；期内禁止新增反向依赖 |

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
| M0 | 冻结基线：187 端点清单、`router.ts`、typecheck 结果 | 基线文档归档，可逐条 diff |
| M1 | R-01 + R-02 + R-03 + R-08：模块入口、组合根瘦身、插件初始化归口、宿主兼容 | `app.ts` ≤ 80 行；typecheck 通过；三宿主启动 |
| M2 | R-04：`utils/<域>` 迁入 `src/modules/<域>`，`u` facade 保持 | 246 处引用迁移完成；端点 diff 为空 |
| M3 | 评审决策点：R-05（路由分组）采纳或豁免 | 决策记录入 §11 |
| M4 | R-06 + R-07（按豁免边界）+ R-09 + R-11 | 依赖对账通过；AGENTS 同步；豁免表完成 |
| M5 | 交付审查：结构指标 + 契约回归 + 地图重新切分申请 | §6 全部勾选 |

---

## 10. 待评审决策点

- **Q1｜拆分深度**：采纳方案 B（服务模块化，URL 零风险）就交付，还是必须做到方案 C（路由也进模块目录）？
- **Q2｜R-05 路由生成器**：是否改造 `core.ts` 为按域生成子 Router？若不改，是否接受豁免 E4？
- **Q3｜`utils.ts` 存废**：保留 `u` 兼容 facade（145 文件不动）是否可接受为"已收敛"，还是要求同步改调用点？
- **Q4｜`@/agent` 出口**：本期是否允许登记豁免 E2，把环的切断完全交给后续 AgentHost 需求？
- **Q5｜`localRuntime` 粒度**：`/api/exec`、桌面桥、设备互联是否必须再拆为独立子模块（会新增 3 个模块与相应豁免）？
- **Q6｜交付形态**：按模块拆成多个 PR 分批评审（推荐），还是单 PR 一次性提交？

---

## 11. 评审意见栏

> 待评审人填写。可逐条对 R-01～R-11、Q1～Q6、E1～E5 给出结论。

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

```bash
# 模块文件/行数对账（结果 237 / 14,349，与地图一致）
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

# 路由与端点基线
find apps/server/src/routes -name '*.ts' | wc -l                       # 161
grep -rhoE '\.(get|post|put|patch|delete|all)\(' apps/server/src/routes | wc -l   # 187

# 聚合入口耦合
grep -rl 'from "@/utils"' apps/server/src --include='*.ts' | wc -l     # 145（路由占 144）
grep -rho 'from "@/utils/[a-zA-Z]*' apps/server/src --include='*.ts' | wc -l      # 246

# 环的两端
grep -rn 'from "@/utils' apps/server/src/agent --include='*.ts' | wc -l   # 51
grep -rn 'from "@/agent' apps/server/src --include='*.ts' | grep -v '^apps/server/src/agent/' | wc -l  # 23

# 基线质量
cd apps/server && bun run typecheck
```
