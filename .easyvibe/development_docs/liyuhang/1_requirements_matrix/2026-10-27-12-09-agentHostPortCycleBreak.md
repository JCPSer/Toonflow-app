# 需求矩阵 · AgentHost 端口切断 agent↔应用双向依赖（架构级环治理）

## 0. 文档元信息

| 项 | 内容 |
| --- | --- |
| 文档编号 | **REQ-2026-10-27-01** |
| 版本 | 第 1 版（首版，待评审） |
| 需求来源 | 架构地图全局关注点 `c-arch-1`（`.easyvibe/map/map.json`，`health.decay_flags = [circular_dep, layer_violation]`）；模块级 `c-server-api-2`（`server-api.health.score = 72`）、`c-agent-runtime-1`（`agent-runtime.health.score = 62`） |
| 需求标题 | 抽取 AgentHost 端口，切断 agent-runtime → 应用层（`@/utils`·`@/lib`·`@/modules`）的静态依赖，并由 `app.ts` 单向装配 agent 与各应用子模块 |
| 影响模块 | `agent-runtime`（主）、`server-api`（主）、`web-console`（契约连带）、`ai-providers`（模型契约连带）；派生影响：`desktop-shell`、`mobile-shell`（`@toonflow/server/i18n`·`platform` 导入） |
| 需求类型 | 结构性重构（架构整改），**不改变任何业务行为、HTTP 契约、事件协议与磁盘格式** |
| 优先级 | **P0**（地图判为 critical，且环位于每条 Agent 请求的必经路径） |
| 当前状态 | **待评审**；本轮仅新增需求文档与索引，业务代码零改动 |
| 编写人 | 需求分析 agent（harness 规则 2.1 执行者） |
| 编写时间 | 2026-10-27 12:09 |
| 基线 | `git HEAD = 89572b5`；`.easyvibe/map/map.json` 生成于 `2026-10-27T08:01:50+08:00`（`repo head_short = 1861cd0`，滞后 4 个提交，模块归属未变） |
| 验收口径 | 问题消除 + 审查通过；无法消除项按 §8 结构化豁免登记；判定按 §6 二值表 + §9 决策默认值执行 |

### 0.1 一句话需求

把 agent 运行时对应用能力的 74 处静态 import 收敛到一个**由应用侧实现、在组合根注入**的 `AgentHost` 端口，同时清掉应用层对 agent 的 24 处反向引用，使 `agent-runtime` 与 `server-api` 之间不再构成环，且该结论可用固定命令复检。

---

## 1. 背景

### 1.1 问题原文（地图关注点）

> `c-arch-1`（critical）：agent-runtime 与应用层双向 import（agent→应用 71 处、应用→agent 24 处）构成环，且环位于每条 Agent 请求的必经路径，任何一侧改动都会牵动另一侧。
> 建议：先抽 AgentHost 端口切断 agent→`@/utils`·`@/lib`，再让 `app.ts` 单向装配 agent 与各应用子模块。

同类关注点：

| 关注点 | 严重度 | 与本需求的关系 |
| --- | --- | --- |
| `c-server-api-2` | critical | 给出同一问题的应用侧视角：`utils.ts` 37 个出口、被 145 个文件引用，且聚合了 agent 能力 |
| `c-agent-runtime-1` | critical | 给出 agent 侧视角：`run()` 直接依赖工作区与模型能力。**注**：地图原文仍写 `@/utils/workspace`、`@/utils/ai`，是拆分前的旧路径；当前实际为 `@/modules/localRuntime/workspace/files`、`@/modules/mediaGeneration/ai`（`agent/runtime/index.ts:11,27`）与 `@/lib/i18n`（`:28`） |
| `c-arch-4` | high | 应用层内部 53 条跨子模块深引；**本需求不处理**（见 NG4） |
| `c-arch-3` | high | web 把插件/服务端源码编译进主包；本需求只保证不恶化（见 R-07） |

### 1.2 环的实际形状（本轮实测，非地图转述）

**方向一：agent → 应用（23 / 29 个 agent 文件命中，74 处）**

| 计数口径 | 数值 | 说明 |
| --- | --- | --- |
| 别名口径 `@/(modules\|lib\|utils)` | **71** | `@/modules` 50 + `@/lib` 20 + `@/utils` 1，与主地图 `e7` 一致 |
| 相对逃逸口径 `../lib/**`、`../../lib/**` | **3** | `agent/mentionSources.ts:8/135`、`agent/runtime/types.ts:2`，**地图未计入** |
| **解析口径合计（本需求验收口径）** | **74** | 71 + 3 |
| 其中 `import type`（构建期擦除） | 6 | 其余 68 条为运行期值边 |

**方向二：应用 → agent（11 个源码文件 + 3 条包契约，24 处）**

| 消费方 | 条数 | 形态 | 说明 |
| --- | --- | --- | --- |
| `src/utils.ts:19,20,21,33,35` | 5 | 静态值 | 聚合出口导出 `agent`/`canvas`/`question`/`a2aSettings`/`mentionFiles` |
| `modules/agentAccess/singleAgent/index.ts:7–11` | 5 | 静态值 | 单 Agent 运行复用 agent 的工具/模型/请求/会话/提问能力 |
| `modules/agentAccess/index.ts:6` | 1 | **动态** | `mount` 内 `await import("@/agent/a2a")`（AGENTS.md 冻结的 9 处动态块之一） |
| `modules/mcpIntegration/mcp/tools.ts:8,9` | 2 | 静态值 | MCP 网关运行 Agent |
| `modules/platformCore/conf/index.ts:5` | 1 | 静态**类型** | `A2aSettings` |
| `modules/agentAccess/singleAgent/types.ts:2` | 1 | 静态**类型** | `AgentEvent` |
| `routes/**`（agent.ts 2、settings 2、agents/a2a 1、singleAgent 1） | 6 | 5 值 + 1 类型 | 路由直接调 agent 的模型配置/提示词/Schema |
| `@toonflow/teams-scaffold`（conf、pluginMarket/teams、routes/agents/connect） | 3 | 包契约 | 该包按地图归属 `agent-runtime` 模块 |
| **合计** | **24** | 21 源码 + 3 包契约 | 类型边 4 条（源码 3 + 包契约 1）；**源码值边 18 条**（含 1 条动态），包契约值边 2 条（E5） |

**环的收敛点（file 级强连通分量，本轮实测）**

| 图 | SCC 数 | 含 agent 的 SCC | 成员 |
| --- | --- | --- | --- |
| 全边（含 `import type`） | 4 | 2 | ① 10 文件：8 个 agent 文件 + `utils.ts` + `modules/agentAccess/singleAgent/index.ts`；② 6 文件：`agent/a2a/settings.ts` + `workspace/files.ts` + `workspace/index.ts` + `mobileLink/index.ts` + `mcp/control.ts` + `conf/index.ts` |
| 仅值边（运行期环） | 3 | **1** | ① 10 文件（同上）；其余 2 个 SCC 均为应用层内部（`pluginMarket` 3 文件、`mcpIntegration` 2 文件） |

> 结论：**运行期真正闭环的只有一个 10 文件 SCC，但它覆盖了 agent 的 `index/assets/mentionFiles/tools/teams/runtime(index,delegation)` 与 `utils.ts`**，即 `/api/agent` 流式接口的整条装载链。第二个 6 文件 SCC 由 `conf → agent/a2a/settings` 的**类型边**构成，构建后擦除，但静态图仍然是环，且它把 `conf`（进程级单例、模块顶层即初始化）拖进了 agent 的装载顺序。

### 1.3 为什么这个环必须处理（而不只是"不好看"）

1. **在必经路径上**：`routes/agent.ts → utils.ts → agent/index.ts → agent/runtime/index.ts → @/modules/* → (145 个文件) → utils.ts`。任何一次 Agent 请求都会走完整条链。
2. **装载顺序被业务无关的东西绑定**：`modules/platformCore/conf/index.ts` 在**模块顶层**执行 `mkdirSync`/`realpathSync`/`new Conf(...)`/写入默认供应商；agent 的 8 处 `conf` 引用、以及 `agent/a2a/settings.ts:71` 的 `conf.onDidChange("a2a", …)` 模块级副作用，把"配置求值时机"与"agent 装载时机"耦合在一起。`app.ts` 现有的「先设 `TOONFLOW_DATA_DIR`、再动态装配」这一保证，只靠人工纪律维持。
3. **扇出极大**：`utils.ts` 被 145 个文件静态引入，其中 5 行 re-export agent，使"任何一个应用模块"都可能在装载期把 agent 拖进来，形成应用层内部的隐式耦合面。
4. **改动放大**：任何一侧的接口/初始化顺序变化都要同时核对另一侧的 74/24 条边；地图已将其标为 `direction_violation`（`e7`）。

### 1.4 agent 需要的应用能力清单（端口的输入面，本轮逐行统计）

| # | 能力 | 应用侧落点 | 条数 | 主要符号 | 备注 |
| --- | --- | --- | --- | --- | --- |
| 1 | 工作区路径解析 / 文件锁 / 越界保护 | `modules/localRuntime/workspace/files.ts`、`workspace/chatImages.ts` | 13 | `resolveWorkspacePath`、`lockWorkspaceFiles`、`writeWorkspaceFile`、`renameWorkspaceFile`、`isWithin`、`isHiddenWorkspaceEntry`、`protectWorkspaceRoot`、`protectWorkspaceLibraryPath`、`importImage` | **安全边界**，语义不可变 |
| 2 | 配置读写与变更订阅 | `modules/platformCore/conf` | 8 | `conf.get`（`settings`/`a2a`）、`conf.onDidChange("a2a")` | 进程级单例；模块级副作用 |
| 3 | 素材库 | `modules/assetLibrary/assets(+roots)` | 6 | `openAssetLibrary`、`createAssetDirectory`、`importAssetFile`、`importFileIntoLibrary`、`moveAsset`、`readAssetFile`、`writeAssetFile`、`removeAsset`、`getAssetsDirectory`、`assertAssetRelativePath`、`queryAssets` | |
| 4 | 语言模型目录 / 引用文件 | `modules/mediaGeneration/ai(+files,+requestFiles)` | 5 | `getConfiguredModel`、`providerSchema`、`getModelLimits`、`readAiReferences`、`referenceContent`、`createFileTransport`、`FileRequestLimitError`、`getRequestFiles`、`RequestFile` | 与 `ai-providers` 契约相关（R-08） |
| 5 | 个性化 / 记忆 | `modules/platformCore/personalization` | 3 | `isMemoryEnabled`、`readDocument`、`saveDocument`、`maxDocumentLength` | |
| 6 | 团队 | `modules/pluginMarket/teams` | 4 | `readTeam`、`saveTeamFile`、`listTeams`、`getRemoteTeam` | |
| 7 | 工具插件 | `modules/pluginMarket/plugins/tools` | 2 | `listTools`、`loadTool`、`validateToolConfig` | |
| 8 | 技能 | `modules/pluginMarket/skills/files` | 1 | `directory`、`isEnabled` | |
| 9 | MCP | `modules/mcpIntegration/mcp/{control,servers}` | 3 | `callControl`、`getConnection`、`getAppOrigin`、`createMcpAgentTools` | 反向：MCP 也运行 Agent |
| 10 | 文档读取 | `modules/mediaGeneration/documents` | 2 | `readDocument` | |
| 11 | 媒体生成 / FFmpeg | `modules/mediaGeneration/{media/generation,ffmpeg}` | 2 | `listMediaModels`、`generateMedia`、`createWorkspaceFfmpeg` | |
| 12 | 浏览器 | `modules/agentAccess/browser` | 1 | `createBrowserContext` | |
| 13 | 聚合出口 | `utils.ts`（默认导出） | 1 | `u.workspaceFile`、`u.assets` | 属于 #1/#3 的重复入口 |
| 14 | 共享基础（`lib`） | `lib/i18n`(8)、`lib/documentFormats`(5)、`lib/modelReasoning`(5)、`lib/platform`(2)、`lib/mentionSources`(2) | 22 | `t`/`translateMessage`/`translateError`、`decodeTextFile`/`get*Mime*`、`thinkingLevels`/`ThinkingLevel`、`getRuntimePlatform`、`mentionAssetType`/`MentionQuery` | 20 别名 + 2 相对；纯函数/进程态 |

合计 = 50（`@/modules`）+ 1（`@/utils`）+ 22（`lib`）= **73**，另加 `agent/runtime/types.ts:2` 的类型边 = **74**。

### 1.5 现存的、不可突破的约束（来自 AGENTS.md 与地图）

| 约束 | 内容 | 对本需求的影响 |
| --- | --- | --- |
| C1 | 模块入口 `index.ts` ≤60 行；入口内不得出现 `@/modules/**`；跨模块统一 alias | Host 实现落点必须遵守（落在某个模块域内或 bootstrap） |
| C2 | `app.ts` 不静态 import 模块入口；9 处动态块冻结 | agent 的装配只能走动态 import；新增动态块需登记 |
| C3 | 模块级 SCC 不承诺无环；file 级只保留 `mcp/dxt↔servers` 环；E10 深引清单冻结 | 本需求不新增跨模块深引；Host 实现尽量落在单域内 |
| C4 | **不新增测试/自检文件、不新增检查命令、不新增 CI 自动测试入口** | 复检只能用一次性命令（grep / heredoc 到 `/tmp`），不得提交脚本 |
| C5 | `conf` 只允许在 `platformCore/conf/index.ts` 初始化，且必须晚于 `TOONFLOW_DATA_DIR` 设置 | Host 注入必须在 `createApp` 内、数据目录确定之后 |
| C6 | web 通过 workspace 直接编译 `@toonflow/server` 源码；desktop/mobile 通过 `@toonflow/server/{i18n,platform,mcp,browser,desktop}` 复用 | 任何契约搬迁都会连带 3 个宿主 + web 的 typecheck/build |

---

## 2. 目标与非目标

### 2.1 目标（可度量）

| 编号 | 目标 | 度量 |
| --- | --- | --- |
| G1 | agent → 应用的静态 import 归零（解析口径，登记豁免除外） | 74 → 0 |
| G2 | 应用 → agent 的**运行期值边**归零；静态边仅剩唯一装配点与登记豁免 | 源码值边 18 → 0；包契约值边 2 按 E5 保留；静态边 24 → ≤ 登记数 |
| G3 | 含 agent 文件的 file 级 SCC 归零；模块级 `agent-runtime → server-api` 边消失 | SCC 1（值图）→ 0；`e7` 消失 |
| G4 | 行为零变化 | 全仓 typecheck、构建、13 项冒烟全通过 |
| G5 | 结论可复检、口径不漂移 | 固定命令在 5 个里程碑上的数值单调不增，末态达标 |
| G6 | 文档与地图同源 | AGENTS.md 模块表/引用清单、`map.json` 与子图重算一致 |

### 2.2 非目标（NG）

| 编号 | 非目标 | 理由 |
| --- | --- | --- |
| NG1 | 不消除 agent 对应用能力的**运行时依赖**（工作区、模型、素材、工具、团队、MCP 仍然必需） | 本需求只改"访问方式"，不改"是否需要" |
| NG2 | 不改任何 HTTP 路由、请求/响应结构、`AgentEvent` 字段、会话文件格式、设置文件格式 | 前端/桌面/移动/A2A 已固化 |
| NG3 | 不重构 `run()`、`sessions.ts`（`c-agent-runtime-2/3`）、不拆 `compshare.ts`（`c-ai-providers-1`） | 独立关注点，另行立项 |
| NG4 | 不处理应用层内部 53 条跨子模块深引（`c-arch-4`） | 与环无关；同批改动会放大风险 |
| NG5 | 不新增测试、自检脚本、检查命令或 CI 入口 | AGENTS.md「测试与检查边界」 |
| NG6 | **不得通过修改地图模块 glob、模块归属或计数方式**使边"消失" | 否则为口径漂移（见 R-09、A-15） |
| NG7 | 不把 agent 的能力整体搬进应用层（方向相反，同样破坏分层） | 领域能力留在 domain 层 |

---

## 3. 需求矩阵

> 优先级：P0 = 本需求不可缺项；P1 = 收口与外围。难度：低 / 中 / 中高 / 高。风险按"对行为与安全的破坏可能"评估。

| 编号 | 背景 | 目标 | 描述 | 优先级 | 难度 | 风险 |
| --- | --- | --- | --- | --- | --- | --- |
| **R-01** | agent 对 14 类应用能力有 74 处散点引用，没有任何契约层；每类能力的语义（路径授权、文件锁、本地化、取消、超时）只存在于实现里 | 给出**唯一**的 AgentHost 契约，agent 只依赖契约 | 定义 `AgentHost`：按 §1.4 的 14 类分组，逐符号列出签名与语义约束（尤其 #1 的安全语义、#2 的变更订阅、#4 的模型解析）；给出注入 API 与生命周期约定；明确"契约内不得出现 express 的 `Request`/`Response`"，避免把 HTTP 语义漏进领域层 | P0 | 高 | 中：端口过宽 → 新"上帝对象"；语义描述不全 → 实现漂移 |
| **R-02** | 50 条 `@/modules` + 1 条 `@/utils`，其中 14 条落在 `run()`(6)/`requests.ts`(3)/`sessions.ts`(5) 的请求热路径 | agent 对应用模块的静态 import 归零 | 按能力分批把消费点改为 Host 调用；把 `conf.onDidChange("a2a")` 等**模块级副作用**改为显式初始化注册（由装配点触发）；异常 `message`/`status`/`code` 语义保持不变 | P0 | 高 | 高：错误码与异常文案漂移、文件锁丢失、语言上下文丢失 |
| **R-03** | 22 条 `@/lib` 边（i18n 8、documentFormats 5、modelReasoning 5、platform 2、mentionSources 2）；lib 被地图归入 `server-api`，但同时被 desktop/mobile/web 复用 | 消除 agent→应用 `lib` 的静态边，且不把纯函数/常量塞进端口变成噪音 | 三选一（Q3）：① 全部端口化；② 把无应用依赖的 lib 物理下沉到共享层，`apps/server/src/lib/*` 仅再导出以保 `@toonflow/server/*` 路径；③ 分治（`i18n`/`platform` 端口化，纯数据/纯函数下沉） | P0 | 中高 | 中：契约路径搬迁连带 web 13 条、desktop 6 条、mobile 3 条导入 |
| **R-04** | 应用侧没有 Host 实现；`conf` 是进程级单例且在模块顶层初始化 | 唯一实现点 + 唯一注入点，注入严格晚于数据目录确定 | 在 `server-api` 内新增 Host 实现（遵守 C1/C3，优先落在 `agentAccess` 域），在 `createApp` 设完 `TOONFLOW_DATA_DIR` 之后、任何 agent 代码被求值之前注入；agent 侧不得 import 实现文件 | P0 | 中 | 高：时机错误会让 `conf` 按错误目录初始化，三宿主数据目录静默降级 |
| **R-05** | 24 条反向边；`utils.ts` 的 5 条 re-export 构成 10 文件 SCC 的应用侧半边 | 应用→agent 的**源码**运行期值边归零（包契约值边按 E5 保留），静态边仅剩"装配点 + 注册表" | `utils.ts` 去 agent（37 → 32 出口）；`routes/**` 6 条改为经注册表取 agent 能力；`singleAgent` 5 条、`mcp/tools` 2 条改为经 Host/注册表；`conf` 的 `A2aSettings` 类型边迁移到配置层或契约层 | P0 | 中 | 高：初始化顺序变化导致 `/api/agent`、`/a2a`、`/mcp` 在启动早期不可用 |
| **R-06** | `app.ts` 目前只装配 7 个模块；agent 由 `utils.ts`/`routes` 静态引入，未纳入装配 | agent 只由组合根装配，`app.ts` 单向依赖 agent | 在 15 步装配序列中固定 `注入 Host → 装配 agent → mount 各模块` 的位次；保持 C2 的 9 处动态块不变（新增必须登记）；桌面/移动复用 `createApp` 时行为一致 | P0 | 中 | 中：装配顺序改变会引发"路由早于 agent 就绪"或"conf 早求值" |
| **R-07** | web 静态导入 18 条 `@toonflow/server/agent*`（types 14、mentionSources 4）+ 13 条 lib 顶层契约（modelReasoning 5、documentFormats 4、nodeMenu 4）；web 会把 server 源码编入主包 | 类型有唯一归属，web 构建不破 | 决定 `AgentEvent`/`AgentMention`/`AgentStats`/`A2aSettings`/`ThinkingLevel`/模型目录类型的归属；**默认冻结 `@toonflow/server/*` 导出路径**，只改实现内部，让 web 零改动；若必须迁移，同步改 web 18 条并重跑 typecheck | P1 | 中 | 中：web 是独立构建，破坏后只在 `build:web` 阶段暴露 |
| **R-08** | agent 经 `mediaGeneration/ai` 取模型目录，其底层是 `@toonflow/providers`；`providerSchema`/`getModelLimits` 既被 agent 用也被服务端用 | 模型能力契约单一来源，agent 不绕应用层取模型 | 二选一（Q7）：① Host 暴露 `models` 能力（默认，不动 `packages/providers`）；② 把纯函数（schema/reasoning/limits）下沉到 `ai-providers`，agent 与 server 共用。若选②，需登记 `@toonflow/providers` 新增 `@earendil-works/pi-ai` 依赖与 exports 变化 | P1 | 中 | 中：为"消除一条边"给 domain 包引入重依赖，可能得不偿失 |
| **R-09** | 地图 glob/计数口径未冻结，存在"改口径即达标"的空间 | 口径冻结、数字可复现、趋势单调 | 冻结 `.easyvibe/map/_analysis/*.py` 的 `MODULES` 与计数方式（别名口径 + 解析口径并行记录）；建立台账 L01–L12；所有无法消除的边进 §8 豁免表，逐条写明理由与复核人 | P0 | 低 | 中：口径漂移 = 假达标 |
| **R-10** | 改造面 98 条边，且在高热链路 | 行为零变化 | 业务等价验证：全仓 typecheck、服务端/桌面/移动/ web 构建、13 项冒烟（§6.4），重点覆盖流式事件序列、并发会话锁、路径越界、i18n、A2A token 失效取消 | P0 | 中 | 高：静态环有时"掩盖"装载顺序缺陷，拆环后可能暴露新的时序问题 |
| **R-11** | AGENTS.md 模块表、`dependencies` 清单、地图子图是评审依据 | 代码与文档同源 | 更新 AGENTS.md 目录结构/模块表/引用清单；按同一 glob 重算 `map.json` 与 11 个子图，`coverage 706/706` 不得下降 | P1 | 低 | 低：漏更新会让下一轮评审以旧数据判定 |

---

## 4. 需求详述（边界与产出）

### 4.1 R-01 AgentHost 契约

- **范围**：只定义契约与注入 API，**不含实现**。契约按 §1.4 的 14 类分组；对 #1 工作区能力必须逐条注明"返回值/异常与现实现一致、不得放宽越界校验、不得省略文件锁"。
- **边界**：契约类型中不得出现 `express`、`Request`、`Response`；不得暴露 `conf` 实例本身（否则等于把单例耦合改名后保留）。
- **产出**：契约文件（落在 agent 侧或独立契约层，见 Q1）+ `注入 API`（见 Q2）+ 一份"符号 → 现实现 file:line"对照表（进方案文档）。
- **不做**：不实现能力、不改任何消费点（该阶段 A2P 必须仍是 74，用来证明"只加不改"）。

### 4.2 R-02 agent 消费点切换

- **分组**（4 批，每批独立可回滚）：
  1. 低风险纯读取：`documents`、`personalization`、`skills`、`plugins/tools`、`teams`（10 条）
  2. 模型与媒体：`mediaGeneration/ai`（5）、`media`（1）、`ffmpeg`（1）（7 条）
  3. 工作区与素材（安全敏感）：`workspace`（13）、`assets`（6）、`browser`（1）、`utils`（1）（21 条）
  4. 配置与 MCP：`conf`（8）、`mcp`（3）（11 条）
- **硬约束**：每批结束后 A2P 必须**严格下降**，且不得引入新的 `@/modules` 目标；`agent/` 目录内出现任何 `@/lib`、`@/modules`、`@/utils` 即判失败（A-01/A-02）。
- **模块级副作用**：`agent/a2a/settings.ts:71` 的 `conf.onDidChange("a2a", …)` 与 `let controller` 必须改为"Host 初始化时注册"，并保持现有语义：A2A 配置变化 → 取消在跑任务（冒烟 S-05 覆盖）。
- **错误语义**：现有 `Object.assign(new Error(msg), { status: 400/404/409 })` 与 i18n 文案不得变化；Host 不得吞错、不得包装成新错误类型。

### 4.3 R-03 lib 22 条

| 选项 | 做法 | 优点 | 代价 |
| --- | --- | --- | --- |
| A 全端口化 | `host.i18n.t`、`host.platform.*`、`host.formats.*`、`host.thinking.*` | agent 零 lib 依赖，口径最干净 | 常量/纯函数过端口，噪音大；`t()` 必须在请求 ALS 上下文内解析，易错 |
| B 下沉共享层 | 物理移动到无应用依赖的共享位置，`apps/server/src/lib/*` 仅 `export *` 保 `@toonflow/server/*` | 语义不变、web/desktop/mobile 契约路径不变；与 `lib/mentionSources.ts` 已有注释"下沉以避免反向依赖"的先例一致 | 需决定落点（新 `packages/*` 或 server 内中立目录），并同步地图归属（**属于物理迁移，不是口径漂移**） |
| **C 分治（默认建议）** | `i18n`(8)、`platform`(2) 走端口；`documentFormats`(5)、`modelReasoning`(5)、`mentionSources`(2) 下沉 | 只对"有进程态/需装配"的能力建端口，纯数据走下沉 | 混合形态，需要在方案里写清两套规则的分界 |

### 4.4 R-04 Host 实现与注入

- **落点**：`apps/server/src/modules/agentAccess/**`（域内新文件，经模块入口导出装配函数），避免新增跨模块深引（C3）。
- **注入时机**：`createApp` 内、`process.env.TOONFLOW_DATA_DIR` 设置之后、任何 `@/modules/**`/agent 代码被求值之前。**禁止**在模块顶层 import `conf` 的实现文件。
- **唯一性**：全仓只允许一处 `configureAgentHost(...)` 调用点（A-09 校验）。

### 4.5 R-05 反向边

| 消费方 | 目标形态 |
| --- | --- |
| `utils.ts` | 删除 5 条 agent re-export；`u.agent/u.canvas/u.question/u.a2aSettings/u.mentionFiles` 不再存在；37 → 32 出口 |
| `routes/**`（6 条） | 经注册表取 `run`/`trackAgentEvent`/`getAgentModelConfiguration`/`defaultSystemPrompt` 等；注册表只做"持有 + 转发"，不含业务 |
| `singleAgent/index.ts`（5 条） | 经 Host / 注册表取工具、模型、请求配置、会话读取、提问通道 |
| `mcpIntegration/mcp/tools.ts`（2 条） | 经注册表取 `runAgent` 与 `createAgentTools` |
| `conf/index.ts`（1 条类型） | `A2aSettings` 移入配置层（AGENTS.md 规定配置层拥有自己的类型）或契约层 |
| `agentAccess/index.ts`（1 条动态） | 保留；作为"装配点"登记（E4） |
| `teams-scaffold`（3 条） | 保留；属于包契约，登记 E5 |

### 4.6 R-06 装配序列（不得改变既有 15 步语义）

目标顺序：确定数据目录 → 动态加载 7 个入口 → `platform.prepare` → 插件/供应商/技能/Agent 初始化 → `express()` 与中间件 → 路由 → `mcp.mount` → `agentAccess.mount` → 静态资源 → 错误处理 → `local.initializeRuntime`。
**新增**：在 `platform.prepare` 之后、`agentAccess.mount` 之前，完成 `Host 实现创建 → 注入 → agent 装配`。位次一旦确定写入 AGENTS.md。

### 4.7 R-07 / R-08 契约

- R-07 默认"导出路径冻结"：`@toonflow/server/agent/types`、`/agent/mentionSources`、`/modelReasoning`、`/documentFormats`、`/nodeMenu`、`/desktop`、`/singleAgent/types` 七个 subpath 保持不变。
- R-08 默认"Host 暴露 models 能力"，`packages/providers` 的 `exports`/`dependencies` 不变；若评审选择下沉，需要单独登记依赖变化。

### 4.8 R-09 复检命令（一次性执行，不落库）

见 §6.5；脚本经 heredoc 落到 `/tmp`，执行后删除，符合 C4。

---

## 5. 里程碑与阶段目标

| 里程碑 | 内容 | A2P（解析/值） | P2A（源码静态/动态/包） | 含 agent 的 file SCC | 判定 |
| --- | --- | --- | --- | --- | --- |
| **M0 基线** | 本轮冻结（不改代码） | 74 / 68 | 20 / 1 / 3（合计 24） | 2（全边）/ 1（值边） | 台账 L01–L12 |
| **M1 契约与注入骨架** | 只新增契约 + 注入 API（**不加空实现、不改消费点**） | 74 / 68（**必须不变**） | 24（不变） | 不变 | typecheck 通过；证明"只加不改" |
| **M2 agent 侧切换** | 4 批替换 50+1 条（含 R-03 的 `lib` 处理） | 74 → 0 / 68 → 0 | 24（不变） | 2 → 0（全边）；1 → 0（值边） | 每批严格下降 |
| **M3 反向切断** | utils/routes/singleAgent/mcp/conf | 0 | 静态 20 → 3（全为 `import type`，E1/E2）；动态 1（E4）；包契约 3（E5） | 0（全边） | 源码值边 0 |
| **M4 收口** | 文档、地图、AGENTS.md、全量冒烟 | 0 | 同上 | 0 | A-01–A-16 全 PASS |

**单调性规则**：任一里程碑相对上一里程碑，A2P 与 P2A 的任一分项**不得上升**；若上升，必须在该里程碑的方案文档中登记原因与消除计划，否则视为失败。

---

## 6. 验收标准（二值判定）

### 6.1 判定表

| 编号 | 判据 | 命令/方法 | 期望 |
| --- | --- | --- | --- |
| **A-01** | agent→应用别名边归零 | §6.5 P1 | `0` |
| **A-02** | agent→应用相对逃逸边归零 | §6.5 P2 | `0` |
| **A-03** | agent→应用值边归零 | §6.5 P1+P2 过滤 `import type` | `0` |
| **A-04** | 应用→agent **源码**运行期值边归零（包契约 2 条按 E5 保留） | §6.5 P3 + 类型过滤 + 剔除 `teams-scaffold` | `0` |
| **A-05** | 应用→agent 静态边 ≤ 登记豁免数 | §6.5 P3 + §8 | `≤ §8 登记条目`（默认 ≤3 类型边） |
| **A-06** | 含 agent 的 file 级 SCC = 0 | §6.5 P6 | `agent_scc=0` |
| **A-07** | 模块级 `agent-runtime → server-api` 边消失 | 地图 edges / P1 | `e7` 不存在 |
| **A-08** | `utils.ts` 不再聚合 agent | `grep -c "@/agent" apps/server/src/utils.ts` | `0` |
| **A-09** | 装配唯一：仅组合根注入、仅注册表转发 | 注入 API 调用点 `grep -rn "configureAgentHost(" apps/server/src \| wc -l`；`grep -rln "@/agent" apps/server/src --exclude-dir=agent` | 注入点 `1`；引用文件集合 ⊆ {`app.ts`, 注册表, `agentAccess/index.ts`(动态), `conf`(类型豁免), 类型文件} |
| **A-10** | 数据目录时序不变：显式 `dataDirectory` 生效、仓库 `data/` 不被写 | `TOONFLOW_DATA_DIR=$(mktemp -d) TOONFLOW_SERVER_PORT=<空闲端口> bun run start:server`（启动成功后结束进程）；启动前后各取一次 `md5 data/settings.json` | 临时目录出现 `settings.json`；仓库 `data/settings.json` 的 md5 与 mtime 不变 |
| **A-11** | 全仓类型检查通过 | `bun run typecheck`（根） | 退出码 0 |
| **A-12** | 构建通过 | `bun run build`（含 `build:server`） | 退出码 0，产物可启动 |
| **A-13** | 13 项冒烟全通过 | §6.4 | 全 PASS |
| **A-14** | web 契约未被破坏 | `apps/web` 执行 `bun run typecheck` + `bun run build` | 退出码 0 |
| **A-15** | 口径未漂移 + 地图/文档同步 | 比对 `.easyvibe/map/_analysis/*.py` 的 `MODULES` 与基线一致；`map.json` 重算后 `coverage 706/706`；AGENTS.md 模块表与 `dependencies` 与实测一致 | 全部一致 |
| **A-16** | 未新增测试/自检文件 | `git status --porcelain` 过滤 `.test.ts`/`.spec.ts`/`check*.ts`/`scripts/check*` | `0` |

### 6.2 判定规则

1. 一条判据只有"实测通过"与"实测失败"两种结论，禁止"基本通过"。
2. 任何 A-01–A-09 失败 → 本需求不算完成，无论其他项是否通过。
3. 豁免必须同时在 §8 登记，且 A-05 的上界按登记条目数收紧；未登记的边一律算失败。
4. 命令必须在 §0 记录的基线提交上可复现；口径变化（例如新增源文件）需先更新台账再判定。

### 6.3 趋势验证（"复检可验证趋势"的落地）

- 每个里程碑记录一次 L01–L12 的快照，形成 5 行台账；
- 判定"趋势"= ① 任一分项不上升；② M4 达标；③ 快照命令与口径与 §6.5 完全一致（可由评审人独立重跑）。

### 6.4 冒烟矩阵（13 项，行为等价）

| # | 场景 | 路径/入口 | 期望 |
| --- | --- | --- | --- |
| S-01 | Agent 流式对话（文本） | `POST /api/agent` | NDJSON 事件序列与改造前一致，末态 `done` |
| S-02 | 附件 + 提及 | `POST /api/agent`（`attachments`/`mentions`） | 校验、错误文案、事件一致 |
| S-03 | 会话锁/并发 | 同 `sessionFile` 并发两次 | 第二次 `409`，文案一致 |
| S-04 | 压缩/回退/分叉/回答/画布结果 | `/api/agent/{compact,rewind,fork,answer,canvasResult}` | 行为一致 |
| S-05 | A2A 配置变更取消在跑任务 | `PUT /api/settings/save` 改 `a2a` | 在跑任务被取消，`/a2a` token 校验仍生效 |
| S-06 | A2A JSON-RPC | `/a2a` | 鉴权、方法路由、错误码一致 |
| S-07 | 工作区越界与文件锁 | `/api/workspaces/files/*` 越界路径 | 拒绝，状态码与文案一致 |
| S-08 | 素材提及源 | `/api/agent/mentionSource`、`/api/assets/*` | 分页、类型判定一致 |
| S-09 | MCP 网关运行 Agent | `/mcp` `tools/list` + 调用 | 工具清单与执行一致 |
| S-10 | 单 Agent 运行 | `/api/singleAgent/*` | 状态机、暂停/恢复、工具回调一致 |
| S-11 | 技能与团队 | `/api/skills`、`/api/agents` | 列表/启用状态一致 |
| S-12 | i18n | `Accept-Language` 切换后触发 Agent 错误 | 事件与响应文案语言正确 |
| S-13 | 三宿主装配 | 桌面/移动 `createApp`（不监听） | 应用创建成功，数据目录正确 |

### 6.5 探针命令（可直接粘贴执行）

```bash
# P1 agent→应用（别名口径，与地图 e7 对账）
grep -rn --include='*.ts' -E "from ['\"]@/(modules|lib|utils|routes|types|app|router|core)" apps/server/src/agent | wc -l
# 基线（M0）: 71   目标（M4）: 0

# P2 agent→应用（相对逃逸）
grep -rn --include='*.ts' -E "from ['\"]\.\./(\.\./)?(lib|modules|utils)" apps/server/src/agent | wc -l
# 基线: 3   目标: 0

# P3 应用→agent（源码静态 + 动态）
grep -rn --include='*.ts' "@/agent" apps/server/src --exclude-dir=agent | wc -l
# 基线: 21  目标: ≤ §8 登记条目（默认 ≤3，且全为 import type）

# P4 应用→agent（包契约，地图归属 agent-runtime）
grep -rn --include='*.ts' "@toonflow/teams-scaffold" apps/server/src --exclude-dir=agent | wc -l
# 基线: 3   目标: 3（E5 登记）

# P5 utils 扇入（不得因本需求放大）
grep -rl --include='*.ts' -E "from ['\"]@/utils['\"]" apps/server/src | wc -l
# 基线: 145 目标: 145（只允许减少，不允许增加）

# P6 file 级 SCC（heredoc 到 /tmp，执行后删除；不落库）
python3 - <<'PY'
import os,re,sys
SRC="apps/server/src"; files=[]
for b,d,f in os.walk(SRC):
    d[:]=[x for x in d if x!="node_modules"]
    files += [os.path.join(b,n) for n in f if n.endswith(".ts")]
def res(s,c):
    if s.startswith("@/"): p=os.path.join(SRC,s[2:])
    elif s.startswith("."): p=os.path.normpath(os.path.join(os.path.dirname(c),s))
    else: return None
    for q in (p+".ts",os.path.join(p,"index.ts")):
        if os.path.isfile(q): return q
pat=re.compile(r"""^\s*(import|export)\s+(type\s+)?(.*?)from\s*['"]([^'"]+)['"]""",re.M)
g={}
for f in files:
    t=open(f,encoding="utf-8").read(); e=set()
    for m in pat.finditer(t):
        if m.group(2) or re.match(r"^\s*type\b",m.group(3) or ""): continue
        x=res(m.group(4),f)
        if x: e.add(x)
    for m in re.finditer(r"""import\(\s*['"]([^'"]+)['"]\s*\)""",t):
        x=res(m.group(1),f)
        if x: e.add(x)
    g[f]=e
idx={};low={};on=set();st=[];out=[];c=[0];sys.setrecursionlimit(20000)
def go(v):
    idx[v]=low[v]=c[0];c[0]+=1;st.append(v);on.add(v)
    for w in g.get(v,()):
        if w not in idx: go(w);low[v]=min(low[v],low[w])
        elif w in on: low[v]=min(low[v],idx[w])
    if low[v]==idx[v]:
        comp=[]
        while True:
            w=st.pop();on.discard(w);comp.append(w)
            if w==v:break
        if len(comp)>1: out.append(comp)
for v in files:
    if v not in idx: go(v)
print("scc_total",len(out),"agent_scc",sum(1 for s in out if any(os.path.relpath(p,SRC).startswith("agent/") for p in s)))
PY
# 基线: scc_total 3 agent_scc 1   目标: agent_scc 0
```

**说明**：以上命令仅用于人工复检，不写入仓库、不加入 `package.json`、不进入 CI（C4）。

### 6.6 数值台账（L01–L12，每个里程碑记录一次）

| 编号 | 指标 | 口径 | M0 基线 | M4 目标 |
| --- | --- | --- | --- | --- |
| L01 | agent→应用 别名边 | P1 | 71 | 0 |
| L02 | agent→应用 相对逃逸边 | P2 | 3 | 0 |
| L03 | agent→应用 合计 | P1+P2 | 74 | 0 |
| L04 | agent→应用 值边 | P1+P2 剔除 `import type` | 68 | 0 |
| L05 | 应用→agent 源码静态边 | P3 | 20（17 值 + 3 类型） | 3（全类型，E1/E2） |
| L06 | 应用→agent 源码动态边 | P3 | 1（E4） | 1（E4） |
| L07 | 应用→agent 包契约边 | P4 | 3（2 值 + 1 类型，E5） | 3（E5） |
| L08 | 应用→agent 合计 | L05+L06+L07 | 24 | ≤ 7（按豁免登记收紧） |
| L09 | 应用→agent 源码值边 | P3 剔除 `import type` 与动态 | 17（+1 动态 = 18） | 0 |
| L10 | `@/utils` 扇入文件数 | P5 | 145 | ≤ 145（只降不升） |
| L11 | 含 agent 的 file 级 SCC | P6（值边）与全边 | 值边 1 / 全边 2 | 0 / 0 |
| L12 | 结构规模 | `find`/`wc` | agent 29 文件 4,032 行；`utils.ts` 37 出口 75 行；`apps/server/src` 272 文件 18,546 行 | 出口 32（去 5 条 agent 聚合） |

> 台账规则：L01–L09 任一分项在相邻里程碑间上升即判失败（除 §8 明确登记的豁免变化）；L10–L12 仅作趋势参考，不作为否决项，但 L12 的"出口 37→32"是 R-05 的交付物。

---

## 7. 风险登记

| 编号 | 风险 | 概率/影响 | 触发条件 | 缓解 |
| --- | --- | --- | --- | --- |
| RK-01 | `conf` 早求值 → 三宿主数据目录静默降级 | 中/高 | Host 实现文件在模块顶层 import `conf`，或被 agent 侧静态引入 | 注入只在 `createApp` 内、`TOONFLOW_DATA_DIR` 之后；A-10 探针；Host 实现禁止顶层副作用 |
| RK-02 | 文件锁/路径授权语义丢失（**安全**） | 中/高 | 端口实现"顺手简化"了 `protectWorkspaceRoot`/`lockWorkspaceFiles` | 端口方法 1:1 透传，禁止在 Host 内重写校验；评审清单逐符号核对；S-07 覆盖 |
| RK-03 | 请求语言上下文丢失 | 中/中 | 把 `t()` 变为注入函数并在模块顶层缓存 locale | 语言仍走 `AsyncLocalStorage`；Host 只转发调用，不持有 locale |
| RK-04 | 事件/协议漂移 | 低/高 | 迁移时"顺手"调整 `AgentEvent` 字段或 `send` 时序 | 类型定义只搬不改；A-14 + S-01/S-04 |
| RK-05 | 启动早期路由不可用 | 中/中 | 装配顺序变化，`mount` 早于 agent 装配 | 固定装配位次；S-05/S-06/S-09 |
| RK-06 | 端口成为新上帝对象 | 中/中 | 14 类能力塞进一个扁平对象，签名不分组 | 契约按能力分组，每组独立类型；评审限制：端口不得暴露 `express`、`conf` 实例、未使用的"预留"方法 |
| RK-07 | 假切断 | 中/高 | Host 实现放在 agent 内；或 agent 侧保留了 re-export 的中间层 | A-01/A-02/A-09 三重校验；`agent/` 目录禁止出现 `@/modules`、`@/lib`、`@/utils`（grep 即判） |
| RK-08 | 口径漂移（改 glob/归属让边消失） | 中/中 | 为达标修改 `MODULES` 或计数方式 | A-15；R-09；§8 豁免必须可复核 |
| RK-09 | web/桌面/移动连带破坏 | 中/中 | 迁移 `lib/*` 或 `@toonflow/server/*` 导出 | 默认冻结导出路径（Q6）；全仓 typecheck + 三宿主构建 |
| RK-10 | 大 diff 不可评审 | 高/中 | 一次性改完 98 条边 | 4 批实施，每批独立提交、独立回归、独立回滚 |
| RK-11 | 静态环掩盖的时序缺陷被暴露 | 中/中 | 拆环后某些模块的初始化顺序变化 | 每批后执行 S-01/S-05/S-09；发现即回滚该批 |
| RK-12 | 与 E10 冻结深引冲突 | 低/低 | Host 实现跨模块深引 | Host 落在 `agentAccess` 单域；确需新增按 AGENTS.md 登记 |

---

## 8. 候选豁免（无法在不扩大范围的前提下消除）

| 编号 | 内容 | 条数 | 理由 | 复核方式 |
| --- | --- | --- | --- | --- |
| E1 | `conf/index.ts` 的 `import type { A2aSettings }` | 1 | `verbatimModuleSyntax: true` 下类型边构建期擦除；迁移会与"配置层拥有类型"规则冲突，需单独决策 | P3 过滤 `import type` 后应为 0 |
| E2 | `singleAgent/types.ts`、`routes/agent.ts` 的 `import type { AgentEvent }` | 2 | 同上，运行期无依赖 | 同上 |
| E3 | 应用层内部 SCC（`pluginMarket` 3 文件、`mcpIntegration` 2 文件） | 2 个 SCC | 与 agent 无关（`c-arch-4`/NG4） | SCC 探针按 `agent_scc` 判定 |
| E4 | `agentAccess/index.ts` 的动态 `import("@/agent/a2a")` | 1 | 装配点，C2 冻结的 9 处动态块之一 | 允许存在于装配清单 |
| E5 | `@toonflow/teams-scaffold` 3 条包契约 | 3 | 该包按地图归属 `agent-runtime`；包契约不是源码依赖，移动归集会构成 NG6 | 计入 P4，数值恒为 3 |
| E6 | `conf` 进程级单例 | 1 | 全仓唯一配置实例，属既有设计 | Host 只转发，不替换单例 |
| E7 | i18n `AsyncLocalStorage` 全局态 | 1 | 请求域语言分发机制 | 不改变分发方式 |
| E8 | `utils.ts` 仍被 145 个文件引用 | 145 | 本需求只去掉其中的 agent 聚合，不动聚合模式 | P5 只允许下降 |
| E9 | `packages/teams`、`packages/skills` 目录扫描（agent 运行期读盘） | — | 插件化能力，需运行期读取 | 经 Host 的 teams/skills 能力访问 |
| E10 | web 的 18 条 `@toonflow/server/agent*` 静态导入 | 18 | 默认冻结导出路径，不属本次消除目标（`c-arch-3` 独立治理） | A-14 构建通过即可 |

> 豁免规则：新增豁免必须写明"为何无法消除""代价是什么""何时重新评估"；评审未通过的豁免不计入 A-05 上界。

---

## 9. 待决策点（评审请逐条确认或改写默认值）

| 编号 | 问题 | 选项 | 默认建议 |
| --- | --- | --- | --- |
| Q1 | 端口契约放哪里？ | A `apps/server/src/agent/host.ts`；B 新建 `packages/*contract*`；C 扩展现有 `packages/toolScaffold` | **A**（agent 内定义，应用实现，避免新包与新构建链） |
| Q2 | 如何注入？ | A 模块级 `configureAgentHost(host)` 单例；B `run(options, send, host)` 逐次传参；C 扩展 `ModuleContext` | **A**（与仓库"进程级单例 + 组合根装配"风格一致，改动面最小；代价是隐式依赖，用 A-09 约束） |
| Q3 | 22 条 `lib` 边怎么处理？ | A 全端口化；B 全下沉（保 server 再导出）；C 分治 | **C**（`i18n`/`platform` 端口化；纯数据/纯函数下沉） |
| Q4 | 反向边允许形态？ | A 注册表 + 类型豁免；B 追求源码零静态边（全部动态） | **A** |
| Q5 | 验收计数口径？ | A 解析口径（含相对路径，74/24）；B 仅别名口径（71/24）；C 仅值边 | **A**，并同时记录 B 用于地图对账 |
| Q6 | 是否同步迁移 web 契约？ | A 冻结 `@toonflow/server/*` 导出路径，web 零改动；B 抽 contracts 包并改 web 18+13 处 | **A**（本需求只治环） |
| Q7 | 模型契约是否下沉 `ai-providers`？ | A Host 暴露 models 能力（不动 providers）；B 纯函数下沉到 providers | **A**（避免给 domain 包引入 `pi-ai` 重依赖） |
| Q8 | 实施粒度？ | A 4 批（M2 分 4 组）；B 一次性 | **A** |
| Q9 | 存量应用层内部 SCC 是否同批处理？ | A 不处理（E3）；B 同批 | **A** |
| Q10 | `utils.ts` 最终形态？ | A 保留聚合、去 agent（37→32）；B 废除 `utils` 改直引 | **A**（B 会触碰 145 个文件，与 NG4 冲突） |

---

## 10. 评审意见栏

> 请评审人在下表填写；未填写的行视为"未审"。结论只在最后一行填写。

### 10.1 需求整体

| 项 | 意见 |
| --- | --- |
| 需求边界是否成立（G1–G6 / NG1–NG7） |  |
| 影响模块是否遗漏 |  |
| 优先级与难度评估是否合理 |  |
| 验收标准是否可判定（A-01–A-16） |  |
| 里程碑与单调性规则是否可接受 |  |

### 10.2 待决策点（Q1–Q10）

| 编号 | 采纳默认 | 改为 | 理由 |
| --- | --- | --- | --- |
| Q1 |  |  |  |
| Q2 |  |  |  |
| Q3 |  |  |  |
| Q4 |  |  |  |
| Q5 |  |  |  |
| Q6 |  |  |  |
| Q7 |  |  |  |
| Q8 |  |  |  |
| Q9 |  |  |  |
| Q10 |  |  |  |

### 10.3 豁免（E1–E10）

| 编号 | 同意 | 驳回 | 说明 |
| --- | --- | --- | --- |
| E1–E10 |  |  |  |

### 10.4 结论

| 项 | 内容 |
| --- | --- |
| 评审结论 |  |
| 打回意见 |  |
| 评审人 / 时间 |  |
