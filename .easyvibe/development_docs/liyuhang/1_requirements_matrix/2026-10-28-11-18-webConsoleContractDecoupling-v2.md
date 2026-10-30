# 需求矩阵 · web 前后端与插件契约解耦（contracts 包 + 插件 UI 注册表）· 第 2 版

## 0. 文档元信息

| 项 | 内容 |
| --- | --- |
| 文档编号 | **REQ-2026-10-28-02** |
| 版本 | 第 2 版。**替代** REQ-2026-10-28-01 的判据与范围（不是增量补丁）；第 1 版的 KPI 与结论见 §0.2 逐条对账 |
| 需求来源 | `.easyvibe/map/map.json` → `modules[web-console].health.concerns.c-web-console-1`（**critical**）；全局 `health.concerns.c-arch-3`（high）；`edges.e18`（`web-console → server-api`，`type: api`） |
| 需求标题 | 抽 `@toonflow/contracts` 集中 `/api` 路由常量与协议类型；web 对 `@toonflow/server` 的**值依赖归零**、类型依赖收敛到 2 个子路径；插件 UI 改注册表动态加载；**插件包内 `/api` 字面量一并收敛**；**修复基线类型检查失败** |
| 影响模块 | **`web-console`（主）**；派生：`shared-foundation`（新增 `packages/contracts`；`packages/formats` 增 `nodeMenu`/`desktop`）、`server-api`（`routePrefixes`、3 个生产者、`singleAgent/types` 别名）、`agent-tools`（`tools-scaffold/client`）、`workflow-nodes`（`nodes-scaffold/nodeAi`）、`canvas-extensions`（`ext/comfyMonitor`）、`media-toolkit`（`ffmpeg/browser`） |
| 需求类型 | 结构性重构（契约治理）。**不改变任何 HTTP URL、方法、请求/响应结构、状态码、文案、插件产物格式、磁盘格式与构建产物路径** |
| 优先级 | **P0**（地图 critical；且基线已有**可复现的类型检查失败**，见 §0.2 B-1） |
| 当前状态 | **待评审**。本轮**只产出需求文档与索引，业务代码零改动**：`git status --porcelain apps packages compat docs AGENTS.md` 为空 |
| 编写人 | 需求分析 agent（harness 规则正文 2.1 执行者） |
| 编写时间 | 2026-10-28 11:18 |
| 基线 | `git HEAD = b52454e`；工作区对源码路径全干净；地图 `meta.provenance.head_short = 794886b`，且 `git log 794886b..HEAD -- apps/web` 为空（web 源码自地图生成后零改动，故地图对 web 的描述仍然成立） |
| 环境 | `bun 1.3.11`、`node v24.21.0`、`vue-tsc 6.0.3`。本轮**实跑**了 root/单包 typecheck、`vite build`、以及 §6.4 全部基线探针 |
| 验收口径 | **问题消除 = A-01～A-14 全 PASS**；不可消除项按 §8 结构化豁免登记（E1–E10），未勾选豁免即转验收项。判据均为整数或精确集合；探针为 `/tmp` 一次性命令（不新增测试/自检/CI 文件，遵守 AGENTS「测试与检查边界」） |

### 0.1 一句话需求

把 web、后端与插件三方之间**靠字符串和源码路径维系的隐式契约**，改为**由 `@toonflow/contracts` 单一来源提供**的显式契约，使「接口改名 / 插件 UI 变更」从「运行期 404 或构建期静默打进主包」变成「编译期一处改动」。

### 0.2 本轮独立复算：为什么必须有第 2 版

第 1 版（`2026-10-28-01-12-webConsoleContractDecoupling.md`）的方向正确、大部分基线数字经复算属实（见 §0.3 的「✔」列），但有 **3 个会直接推翻验收口径的问题**（B-1/B-2/B-3），其中 B-1 是**当前就已经是红**的预存缺陷。

#### B-1（阻断 · 预存缺陷）：web 的类型检查在 HEAD 上就是失败的

本轮实跑，非推测：

| 命令 | 结果 |
| --- | --- |
| `cd apps/web && bun x vue-tsc --noEmit` | **exit 2**，恰好 1 条错误：`../server/src/modules/agentAccess/singleAgent/types.ts(2,33): error TS2307: Cannot find module '@/agentRuntime' or its corresponding type declarations.` |
| `bun run typecheck`（根） | **exit 2**，同一条错误经 `@toonflow/web` 上报；其余 40 个 workspace 全部 exit 0 |
| `cd apps/web && bun x vite build` | exit 0（构建不经过类型检查，所以坏的类型契约能一路溜到产物） |

根因链：

1. `apps/server/src/modules/agentAccess/singleAgent/types.ts` 第 2 行 `import type { AgentEvent } from "@/agentRuntime";`
2. 该文件是 `apps/server/package.json` 的 `exports["./singleAgent/types"]` 的 target，而 web 有 3 行 import 它（`components/singleAgentDialog.vue:57,72`、`components/settings/panels/mediaModel/providerAgentDialog.vue:75`）。
3. web 的 `tsconfig.json` 只有 `"@/*": ["./src/*"]`，`@/agentRuntime` 会被解析成 `apps/web/src/agentRuntime`（不存在）→ TS2307。
4. 该别名引入于 **`23c190f`（2026-10-27 11:50，server 拆子模块）**（`utils/singleAgent/types.ts` 的 `../../agent/runtime/types` 被改成 `@/agent/runtime/types`）；`2fda44f` 又把它改成 `@/agentRuntime`。两个形态对 web 都不可解析——也就是说 **web 类型检查自 23c190f 起持续失败**，与本次需求无关，但会被本需求的 A 判据"吸收"。
5. 第 1 版的 `2026-10-27-05-10` 测试报告记录"web typecheck 仅有 .vue 声明缺失"——那是 05:10，早于 23c190f，该结论**已过期**；v1 的 A-11 以"`bun run typecheck` exit 0"为交付期望、又以"M0 同命令"作正控制，而 M0 实际 exit 2，**正控制本身不成立**。

**结论**：本需求必须新增一条 P0 需求修复它（R-09 / A-13），否则 A-11 不可达、且"审查通过"无从谈起。

#### B-2（范围缺陷）：第 1 版的"归零"只覆盖 `apps/web/src`，漏掉**被打进 web 主包的插件契约**

`c-web-console-1` 与 `c-arch-3` 说的是"契约在编译期固化"。实测（本轮 `vite build` 到 `/tmp` 后逐字符串扫描产物）：

| 事实 | 数值 | 证据 |
| --- | --- | --- |
| `packages/**` 中的 `/api` 字面量 | **19 处 / 6 文件 / 16 个去重路径** | `nodeAi.ts` 10、`browserPanel.vue` 3、`questionCard.vue` 2、`comfyMonitor/index.vue` 2、`ffmpeg/browser.ts` 1、`toolScaffold/client.ts` 1 |
| 其中**确实进入 web 主包**的去重路径 | **5 个**：`/api/ai/media/models`、`/api/ai/media/tasks/cancel`、`/api/ai/media/tasks/status`、`/api/browser/input`、`/api/tools/renderers` | 产物逐文件扫描（`nodeAi-*.js`、`replyStream-*.js`）；`/api/browser/stream` 以 URL 模板拼接形式存在（`` `...?${query}` ``），`/api/tools/client` 只出现在 `client.ts` 的 `new RegExp(`^/api/tools/client\\?name=...`)` 正则模板里 —— 二者的引号后首字符分别为模板变量与 `^`，因此**计入 A-12 的出现次数但不计入 A-14 的引号边界去重路径** |
| 主包内 `/api` 去重路径总数 | **93**（web 源码引号边界去重 **95** 条 → 打包后 93 条：源码独有的 7 条纯模板路径被运行时拼接掉，插件侧新增 5 条） | 引号边界扫描（P9） |
| 关键载体 | `@toonflow/nodes-scaffold/nodeAi` 被 web **9 行静态 import**（`invalidateNodeModels`），是全仓唯一一个"骨架里带 10 条 `/api` 字面量且被 web 打包"的子路径 | `grep -rn nodes-scaffold/nodeAi apps/web/src` = 9 |

第 1 版的 E1 把"12 个骨架子路径全部保留静态"登记为豁免，但**没有把 nodeAi 里的 10 条 `/api` 字面量纳入任何判据**——于是按 v1 实施完，`c-arch-3` 的一半（插件契约编进主包）仍然成立，问题只能"部分消除"。第 2 版把它单列为 R-08 / A-12。

#### B-3（可达性缺陷）：v1 的 R-03 说"零新代码"，但**没有接线依赖**

v1 R-03①："`documentFormats` / `modelReasoning` / `mentionSources` 的 7 行直接改指 `@toonflow/formats/*`（三个模块已在 `packages/formats` 存在，**零新代码**）"。

源码层面成立（`packages/formats/src` 三个文件确实存在且与 server 侧逐字节等价），但**工程层面不成立**：

| 检查 | 结果 |
| --- | --- |
| `apps/web/package.json` 是否声明 `@toonflow/formats` / `@toonflow/contracts` | **均无** |
| `apps/web/node_modules/@toonflow/` 是否有 formats / contracts 软链 | **均无**（只有 asr/assets/ext-scaffold/i18n/model-icons/node-text/node-video/nodes-scaffold/providers/server/tool-browser/tool-canvas/tools-scaffold） |
| `bun.lock` 中 `apps/web` 的 dependencies | 无 formats |

也就是说：web 现在之所以能 `import "@toonflow/formats/modelReasoning"`（间接地，经 server 源码），是因为**模块解析从被导入文件所在目录往上走**，命中了 `apps/server/node_modules/@toonflow/formats`；一旦 web 直接 import formats，解析起点变成 `apps/web/src/**`，**必然找不到**。实施必须先加 workspace 依赖并 `bun install`——这是 v1 未登记的前置条件，也是 A-11 的隐性坑。

#### 0.2.4 v1 中经复算**成立**的部分（保留）

为避免重复劳动，以下 v1 结论本轮已逐条验证通过，第 2 版直接沿用：131 处字面量及其 plain/tmpl/guard 拆分、53 文件、21 前缀、B1–B5 批次数字（21/10/19/60/21，文件 8/5/6/26/8，B1∪B2=13）、38 行/30 文件/7 子路径、值 10/类型 28、17→13 插件处置矩阵、144/164/138/6 的端点对账、71 手写拆分、E3 的 6 条宿主+baseURL、E4 的 15 条构成、Q5=B 时 `handwritten=15` 的算式（71−35−21=15）。

### 0.3 口径对账表（本轮权威基线，A 判据全部引用此表）

| # | 口径 | 基线值（HEAD = b52454e） | 探针 | v1 是否一致 |
| --- | --- | --- | --- | --- |
| 1 | web `/api` 字面量出现次数 | **131** | P1 | ✔ |
| 2 | 　其中 plain / tmpl / guard / comment | **107 / 22 / 2 / 0** | P1 | ✔ |
| 3 | 　去重文本数（plain 88 + tmpl 原始 19，共 107；模板归一化后 17） | **107**（≠ v1 的 103） | P1c | ✘ v1 写 103 |
| 4 | 　涉及文件数（`.ts` 18 / `.vue` 35） | **53** | P1 | ✔ |
| 5 | 　第二段前缀数 | **21** | P2 | ✔ |
| 6 | 含 `/api/` 的**行**数（含 1 行注释） | **132** | P1b | ✔ |
| 7 | `@toonflow/server` 导入行 / 文件 / 子路径 | **38 / 30 / 7** | P3 | ✔ |
| 8 | 　其中值导入 / 类型导入 | **10 行（10 文件） / 28 行（24 文件）** | P3 | ✔ |
| 9 | 　逐子路径（值/类型） | agent/types 14(0/14)、modelReasoning 5(1/4)、desktop 4(0/4)、nodeMenu 4(3/1)、documentFormats 4(4/0)、agent/mentionSources 4(2/2)、singleAgent/types 3(0/3) | P3d | 部分（v1 未列逐项） |
| 10 | 插件/骨架子路径 去重 | **17**（骨架 12 + 实现 5） | P4 | ✔ |
| 11 | 　骨架（12 子路径）行 / 文件 / 值 / 类型 | **40 / 33 / 23 / 17** | P4 | ✔ |
| 12 | 　实现类（5 子路径）行 / 文件 / 值 / 类型 | **12 / 9 / 8 / 4** | P4 | ✔ |
| 13 | 　`tool-canvas/runtime` 行 / 文件 / 值 / 类型 | **6 / 6 / 2 / 4** | P4 | ✔ |
| 14 | 服务端 `/api` 字面量（不含生成物） | **71** | P5 | ✔ |
| 15 | 　生成物 `router.ts` 挂载 / 端点全集 | **163 / 164** | P6 | ✔ |
| 16 | 客户端声明路径（web 120 + MCP 工具面 32 + 插件包 16，去重） | **144**（命中服务端 138，6 条为宿主/baseURL） | P7 | ✔ |
| 17 | `packages/**` `/api` 字面量 | **19 / 6 文件 / 16 去重路径** | P8 | ✘ v1 未计 |
| 18 | 其中进入 web 主包的去重路径 | **5** | P9 | ✘ v1 未计 |
| 19 | 宿主壳 `/api` 字面量 | desktop **12** / mobile **5** / compat(ets) **2** | P10 | ✔（v1 只写数未给探针） |
| 20 | web 规模（code 扩展名，含 components.d.ts 135 行） | **175 文件 / 42,742 行**；含 `postcss.config.ts` 则 **176 / 42,751** | P11 | ✔（口径差异已注明） |
| 21 | **web typecheck** | **exit 2，1 条错误（B-1）** | P12 | ✘ v1 认为基线绿 |
| 22 | root typecheck | **exit 2**（唯一失败为 web） | P12 | ✘ |
| 23 | web `vite build` | exit 0，2.84s | P13 | ✔ |

### 0.4 当前实测：契约已经漂移过一次（事实，不是"可能"）

| 证据 | 内容 |
| --- | --- |
| 逐字比对 | `apps/server/src/routes/nodes/get.ts:30` 产出 `` `/api/nodes/files?name=${name}` ``；`apps/web/src/pages/workspace/panels/canvas/index.vue:1345` 用 `node.url !==` 同一模板**逐字比对**。任一侧改一个字符，web 把全部节点判为「地址无效」并在控制台打 `节点地址无效`，**编译期与类型检查都不会提示** |
| 同类第二处 | `pages/workspace/panels/document/extensions.ts:80` 校验 `url.pathname.startsWith("/api/ext/")`，与 `routes/ext/list.ts:23` 的 `/api/ext/read?name=` 逐字耦合 |
| 同类第三处 | `packages/toolScaffold/src/client.ts:31` 用 `new RegExp("^/api/tools/client" + ... + "version=[a-f0-9]{64}$")` 校验 `routes/tools/renderers.ts:9` 产出的 URL |
| 同类第四处 | `apps/web/src/lib/providerBilling.ts:126` 的 SSE 地址与 `routes/ai/media/balanceEvents.ts` 文件名规则耦合；漂移表现是「余额永不刷新」而不是报错 |
| 双事实源 | `modules/mcpIntegration/mcp/operations.ts` 手写 **32** 条 `path: "/api/..."`，与 `router.ts` 的 163 个挂载点构成两套事实源，**当前 32/32 命中但无任何守卫** |
| 契约承载方式 | web 消费的 7 个 server 子路径中 6 个 target 指向 `apps/server/src/**` 源码；`exports` 14 个键全部为 `.ts` 源文件。web 的 `vue-tsc` 因此解析服务端源码（B-1 正是这条路径上炸开的） |
| 插件 UI 双轨 | `ext` 与 `tool` 已是注册表 + 动态 `<script>`（`extensions.ts`、`toolScaffold/client.ts`），但 `tool-browser/panel`（2 处）、`node-video/videoPlayer`、`node-text/markdownPreview` 仍静态 import；`tool-canvas/runtime` 的 `canvasSchemas` 与 `nodeAi` 的 10 条 URL 直接打进主包 |

## 1. 背景

### 1.1 问题原文（地图关注点）

> `c-web-console-1`（**critical**）：web 源码含 130 处 `/api` 字面量、7 个 `@toonflow/server` 源码契约与 17 个插件/骨架运行时子路径，前后端与插件契约在编译期固化。
> 建议：抽 contracts 包集中路由常量与请求/响应类型，插件 UI 改注册表动态加载。

| 关联关注点 | 严重度 | 与本需求的关系 |
| --- | --- | --- |
| `c-arch-3`（全局） | high | 「web 编译期 import 插件运行时包 30 处、引用 server 源码/接口 38 处……安装式插件无法影响 UI」。本需求的 R-05（注册表）与 R-08（包内字面量）直接对治 |
| `edges.e18` | strong | `web-console → server-api`，`type: api`，标签「30 文件 38 处契约与 130 处 `/api` 字面调用」。交付后期望该边标签改为「17 处纯协议类型 + 契约包常量」 |
| `c-server-api-4` | high | 应用层内部深引。**本需求不处理**（NG4），但 R-07 让 `/api` 成为共用常量，间接降低边界漂移 |
| `c-web-console-2` | high | 巨型页面（`canvas/index.vue` 1,548 行）。**本需求不处理**（NG3） |

### 1.2 为什么必须现在做（三条递进理由）

1. **漂移的失败模式是静默的**：§0.4 的四处逐字耦合中，任何一处改名都表现为「某功能静默失效」而非构建失败；当前流程没有任何守卫会发现它。
2. **插件契约已实质进入主包**：`nodeAi` 的 10 条 URL、`browserPanel` 的 3 条、`toolScaffold/client` 的 2 条已被打包进 web 产物（§0.2 B-2 实测）。这使"安装式插件影响 UI"与"契约单一来源"两个目标都无法达成。
3. **类型契约已经在报错**：B-1 说明"web 编译期解析服务端源码"不是理论风险——它已经让 `bun run typecheck` 长期红灯，而且因为构建不经过类型检查，红灯被日常流程掩盖。

### 1.3 不可突破的约束（均已核对到源码）

| 编号 | 约束 | 核对结果 | 对本需求的影响 |
| --- | --- | --- | --- |
| C1 | `apps/server/package.json` 的 **14 个 exports 键名与 target 不得变更** | 已确认恰 14 个键，target 全为 `.ts` 源文件；desktop/mobile 经 `@toonflow/server/{i18n,platform,mcp,mobileLink,remoteConnection,app,browser}` 复用（19 行） | 契约迁移只能"新增 contracts + 服务端留 shim"，不能删改既有导出 |
| C2 | 模块入口 `index.ts` ≤60 行；入口静态面不得出现 `@/modules/**` | AGENTS §模块入口与契约（9 处冻结动态块） | R-07 只改 `routePrefixes` 字面量与域文件，不动入口依赖结构 |
| C3 | 「一个接口一个文件」，URL 由 `core.ts` 从文件路径生成 | `core.ts:43,46` 生成 `app.use("/api" + routePath)` | **`router.ts` 是生成物**；禁止手改，只能用 `bun run routes` 重生成 |
| C4 | 不新增测试/自检文件、不新增检查命令、不新增 CI 入口 | AGENTS「测试与检查边界」实读确认 | 所有一致性校验以 `/tmp` 一次性命令给出 |
| C5 | 新建文件/文件夹必须小驼峰 | AGENTS 第 7/9/10/12 条 | `packages/contracts/src/{api,envelope,headers,types,index}.ts` 合规 |
| C6 | 插件 UI 宿主全局仅三套：`toonflowNodeHost` / `toonflowExts` / `toonflowToolViews`（另有 `toonflowToolHost` 作为运行时共享对象） | 已 grep 确认 | R-05 必须复用 `loadToolComponent`（`toonflowToolViews`），不得引入第 4 套机制 |
| C7 | 跨插件共享组件统一放 `packages/nodeShared`（`@toonflow/node-shared`，现有 9 个 exports） | 已确认包存在 | `videoPlayer` / `markdownPreview` 的迁移目标已定，不需新造位置 |
| C8 | web 的 i18n 由 Vite 插件在构建期改写 `apps/web/src` 源码抽取文案 | `vite.config.ts` 使用 `@toonflow/i18n/vite` | contracts 包在 `apps/web/src` 之外，**不参与** i18n transform → 契约包内不得含用户可见文案 |
| C9 | 使用其他 workspace 包必须在其 `package.json` 声明依赖并经包名 imports（不得穿透 `src/`） | AGENTS 第 188 行 | R-03 必须给 web 加 `@toonflow/formats`、`@toonflow/contracts` 两条 workspace 依赖 + `bun install`（v1 遗漏） |

## 2. 目标与非目标

### 2.1 目标（全部可二值判定）

| 编号 | 目标 | 度量（交付态） |
| --- | --- | --- |
| G1 | web 源码 `/api` 字面量归零 | 131 → **0**；grep `/api/` 行数 132 → **0** |
| G2 | 路由常量唯一来源且与服务端端点双向可对账 | `apiRoutes` 覆盖 144 条声明路径 + 模板工厂；与 164 个端点比对 `missing=0`、`invented=0`、`not_in_server=6`（精确 6 条宿主/baseURL） |
| G3 | web 不再取 server 的**运行期值** | 值导入 10 → **0** |
| G4 | web 对 server 的依赖收敛为纯协议类型 | 38 → **17 行 / 16 文件 / 2 子路径**，全部 `import type` |
| G5 | 插件 UI 有统一加载方式 | 实现类子路径 5 → **1**（`tool-canvas/runtime`，E2）；实现类值行 8 → **2**；`tool-browser/panel`、`node-video`、`node-text` 静态 import 归零 |
| G6 | 插件包内 `/api` 字面量归零 | `packages/**` 19 → **0**（E9 登记例外）；进入主包的插件来源去重路径 5 → **0** |
| G7 | 行为零变化且**类型检查真正变绿** | root `typecheck` exit **0**（含 web）；web `vite build` exit 0；§6.3 冒烟 12/12 |
| G8 | 文档/地图/规范同源 | AGENTS 增补 contracts 与注册表规则；`map.json` 把 `packages/contracts/**` 归 `shared-foundation`，更新 e18 标签与 `files_total` |

### 2.2 非目标

| 编号 | 非目标 | 理由 |
| --- | --- | --- |
| NG1 | 不改任何 HTTP URL、方法、请求体、响应结构、状态码、错误文案、SSE/NDJSON 字段 | 桌面/移动/外部 MCP 客户端已固化 |
| NG2 | 不删改 `apps/server/package.json` 的 14 个 exports | C1 |
| NG3 | 不拆 `canvas/index.vue`（1,548 行）等巨型页面、不拆 Pinia store | `c-web-console-2`，独立需求 |
| NG4 | 不处理应用层内部深引 | `c-server-api-4`，独立需求 |
| NG5 | 不新增测试/自检脚本/CI 入口 | C4 |
| NG6 | 不改 `core.ts` 的 URL 生成规则，不手改 `router.ts` | C3 |
| NG7 | contracts 只放 URL 常量、信封类型、header 名、纯协议类型，零运行时依赖 | 保持 foundation 层无出边 |
| NG8 | 不引入第 4 套插件宿主全局 | C6 |
| NG9 | 不改插件产物格式（`build/tools/*.tool.js` 元数据结构、`build/nodes/*.umd.js`、`build/ext/*.umd.js`） | 用户机器上已装旧插件 |
| NG10 | 不改 `packages/formats` 既有 5 个 exports 的 target | `@toonflow/server/{documentFormats,modelReasoning,agent/mentionSources}` 三个 shim 依赖它 |
| NG11 | 不把"探针通过"当成"实现正确" | 探针只证计数/集合；行为由 §6.3 冒烟与 code review 判 |

### 2.3 依赖方向裁决表

| 关系 | 允许？ | 落点 | 判据 |
| --- | --- | --- | --- |
| `web → contracts`（值：URL、header、信封） | **允许（唯一来源）** | `@toonflow/contracts/api`、`/headers`、`/envelope` | A-01/A-03 |
| `web → formats`（值：documentFormats、modelReasoning、mentionSources、nodeMenu） | **允许**（需先加依赖，C9） | `@toonflow/formats/*` | A-04 |
| `web → server`（类型：`agent/types`、`singleAgent/types`） | **允许但冻结**（17 行） | 不变 | A-04 |
| `web → server`（值） | **禁止** | 无 | A-04 |
| `server → contracts` | **允许**（P1） | `modules/*/index.ts`、`mcp/operations.ts`、3 个生产者 routes | A-08 |
| `plugins/scaffold → contracts` | **允许**（仅 URL 常量） | `nodeAi`、`browserPanel`、`questionCard`、`comfyMonitor`、`ffmpeg/browser`、`toolScaffold/client` | A-12 |
| `contracts → formats` | 允许（同层；`import type` 或纯常量） | — | A-09 |
| `contracts → server / tools-scaffold / nodes-scaffold / ext-scaffold / providers` | **禁止** | 无 | A-09 |

> `contracts` 与 `formats` 同属 `shared-foundation`（foundation 层）。**contracts 不得依赖 `@toonflow/tools-scaffold`**——它是 `agent-tools`（domain 层）的一部分，反向依赖会新建 layer violation。这直接决定了 G4 只能到 17 行：`agent/types` 与 `singleAgent/types` 引用 `ToolCall`/`ToolDefinition`，无法下沉。

## 3. 需求矩阵总表

> 优先级：P0 = 不可缺项；P1 = 收口项（不阻塞"问题消除"，但阻塞"结构闭环"）。
> 难度：低 / 中 / 中高 / 高。风险按"对行为与构建产物的破坏可能"评估。

| 编号 | 阶段 | 背景 | 目标 | 描述 | 优先级 | 难度 | 风险 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **R-01** | M1 | 131 处字面量分散 53 文件 21 前缀，无单一来源 | 新建 `@toonflow/contracts` 作为 URL/header/信封唯一来源 | 新建 `packages/contracts`：`package.json`（`name: @toonflow/contracts`、`exports: {".", "./api", "./envelope", "./headers", "./types"}`、`typecheck` 脚本、**零 dependencies**）、`tsconfig.json`；`src/api.ts` 导出 `apiBase = "/api"` 与 `apiRoutes`（按 21 前缀分组，覆盖 144 条路径 + 模板工厂，如 `apiRoutes.nodes.files(name)`），并对 6 条宿主/baseURL 以注释 `hostOwned` / `baseUrlOnly` 标注（E3）；`src/envelope.ts` 导出 `ApiResponse<T>`、`ApiErrorPayload`、`ApiCode`；`src/headers.ts` 导出 4 个 header 名 + `acceptLanguage`；`src/types.ts` **只再导出** formats 的类型；`src/index.ts` 再导出四个子模块 | P0 | 中高 | 中：常量与 `router.ts` 漂移会假通过（A-07 双向集合兜住）；`apiRoutes` 变上帝对象（按前缀分组 + 行数上限 400，E5） |
| **R-02** | M2 | 131 处字面量：`components` 81 / `lib` 21 / `pages` 19 / `stores` 8 / `main.ts` 2 | web 字面量归零 | 按 5 批替换：B1 `lib/**`（21/8）→ B2 `stores/**`+`main.ts`（10/5）→ B3 `pages/**`（19/6）→ B4 `components/settings/**`（60/26）→ B5 其余 `components/**`（21/8）。模板必须逐个手写工厂调用（19 个原始模板 / 22 处，含 6 个 `${...}` 内嵌表达式的改为显式参数）；2 处守卫改 `pathname.startsWith(apiBase + "/")` 与 `startsWith(apiRoutes.ext.base + "/")`；唯一注释行 `SaveToLibraryDialog.vue:84` 一并改写。**禁止正则批量替换** | P0 | 中高 | 高：拼错常量=全站 404；工厂参数顺序错=静默错 URL（A-06 用替换前后 URL 全集合逐条对账） |
| **R-03** | M2 | web 取 server **10 行值**（documentFormats 4、nodeMenu 3、mentionSources 2、modelReasoning 1） | 值导入归零 | ① **先接线**：`apps/web/package.json` 增 `"@toonflow/formats": "workspace:*"`、`"@toonflow/contracts": "workspace:*"`，`bun install` 后确认 `apps/web/node_modules/@toonflow/{formats,contracts}` 软链存在（C9，v1 遗漏的前置条件）；② formats 已有的 3 个模块直接改指 `@toonflow/formats/*`（7 行，零新代码）；③ `nodeMenu` 3 行 → 把 `apps/server/src/lib/nodeMenu.ts`（零 `@/` 依赖）**逐字节复制**到 `packages/formats/src/nodeMenu.ts`，原路径改再导出 shim（server exports key 不动）；④ `desktop` 类型 4 行同样下沉到 `@toonflow/formats/desktop` | P0 | 中 | 中：未加依赖即改 import 会让 vite 解析失败（A-11 兜住）；副本漂移（A-10 diff 为空） |
| **R-04** | M2 | 21 行纯类型取 `@toonflow/server/*`，其中 desktop 4、nodeMenu 1、modelReasoning 4、documentFormats 0、mentionSources 2 属纯契约 | 类型导入收敛到 2 子路径 | 21 行改指 `@toonflow/contracts/types` / `@toonflow/formats/*`；**保留不动** `agent/types` 14 行 + `singleAgent/types` 3 行（二者引用 `ToolCall`/`ToolDefinition`，属 domain 层，不得下沉，见 §2.3） | P0 | 中 | 中：结构等价但名义不同导致注解失效（A-11 的 typecheck 兜住） |
| **R-05** | M3 | 插件实现类 5 子路径 / 12 行 / 9 文件静态 import，与 ext/tool 的动态注册表双轨 | 插件 UI 统一加载 | ① `@toonflow/node-video/videoPlayer` + `@toonflow/node-text/markdownPreview`（各 1 行，仅 `pages/home/exploreProcess.vue`）→ 复制到 `packages/nodeShared/src/components/`，`@toonflow/node-shared` 增 2 个 exports，web 改指 nodeShared（C7）；② `@toonflow/tool-browser/panel`（2 行）改为 `loadToolComponent("browser")`（复用 `toonflowToolViews`，C6），**要求** `packages/tools/browser/build.ts` 声明 `components: { browserPanel: "src/browserPanel.vue" }`，产物元数据 `components` 从 `[]` 变 `["browserPanel"]`；`isBrowserTool`（2 行）移入 `@toonflow/tools-scaffold/runtime`（纯函数 1 行）；③ `@toonflow/tool-canvas/runtime` 保留静态（E2）；④ 12 个骨架子路径保留静态（E1），冻结 `12/40/33` | P0 | 高 | 高：装旧版 browser 工具的用户看不到面板（缓解见 §7 R4）；`components.d.ts` 由 unplugin 自动生成，可能被重写 |
| **R-06** | M3 | web 消费后端产出的 URL 并**逐字校验**（§0.4 前三处） | 生产者与消费者共用同一工厂 | `contracts/api.ts` 提供 `nodes.files(name)`、`ext.read(name)`、`tools.client(name, version)`；`routes/{nodes/get,ext/list,tools/renderers}.ts` 改为调用工厂；web 侧 `canvas/index.vue:1292,1345`、`document/extensions.ts:80`、`toolScaffold/src/client.ts:31` 改用同一工厂（`client.ts` 属 agent-tools 模块，见 Q4） | P0 | 中 | 中：`tools.client` 正则含 64 位 hex 版本号约束，改写时若放松会削弱安装态校验（保留为对解析后 `version` 参数的校验） |
| **R-07** | M4 | 服务端 71 处手写 `/api`（不含生成物 163） | 两侧共用一份常量 | ① 生产者/工具面 35（`operations.ts` 32 + 3 个生产者 routes）→ 读 contracts；② 模块 `routePrefixes` **21**（7 个入口）→ 读 contracts 前缀常量；③ 中间件/安全判断 **15**（`app.ts` 4、`mobileLink` 7、`mcp/tools.ts` 2、`remoteConnection.ts` 2）按 Q5；④ `router.ts` 生成物**不动** | P1 | 中高 | 高：`operations.ts` 是 46 个 MCP 工具面，改错让外部客户端全 404；`app.ts` 的 `express.raw` 路径写错会让 100MB 上传上限失效 |
| **R-08** | M3 | **插件包内 19 处 `/api` / 6 文件 / 16 去重路径**，其中 5 条进 web 主包（B-2） | 包内字面量归零，主包不再含插件契约 | `nodeAi.ts` 10 → `apiRoutes.ai.*`；`browserPanel.vue` 3 → `apiRoutes.browser.*`；`questionCard.vue` 2 → `apiRoutes.{agent,singleAgent}.answer`；`comfyMonitor/index.vue` 2 → `apiRoutes.monitor.*`；`ffmpeg/browser.ts` 1 → `apiRoutes.ffmpeg.execute`；`toolScaffold/client.ts` 2 → `apiRoutes.tools.{renderers,client}`。插件/骨架包增加 `@toonflow/contracts` 依赖（构建期内联，不改产物格式） | P0 | 中 | 中：插件构建需能解析 workspace 包；若 external 配置漏掉会打包失败（A-11 的 `build:tools`/`build:ext`/`build:nodes` 兜住） |
| **R-09** | M1 | **B-1**：`singleAgent/types.ts` 第 2 行 `@/agentRuntime` 使 web typecheck 长期 exit 2 | web/root typecheck 归绿 | 按 Q10 选定一种：**A（默认，最小）** 改为同包相对路径，使该文件及其闭包内 **0 条 `@/` 别名**（闭包实测仅此 1 条，见 §6.4 P14）；**B** 把 `SingleAgentEvent` 需要的 `AgentEvent` 结构化重声明到 `contracts/types`（需处理对 `ToolCall` 的依赖，代价高）；**C** 给 web tsconfig 加 server 路径映射（会把整个 server src 拖进 web 类型图，不推荐） | P0 | 低 | 低：改 1 行；风险是"改完 web 绿了但 server 侧别名风格不一致"（由 A-13 与 server typecheck 双控） |
| **R-10** | M4 | 契约两处维护就会再次漂移，现有流程无守卫（C4 禁新增脚本） | 漂移可被一次性命令发现 | ① A-07 集合比对探针（客户端声明路径 ∪ 服务端端点，双向差集）；② A-06 URL 等价探针（替换前快照 131 条 → 替换后常量求值重算）；③ A-12 包内字面量探针；④ A-14 主包内容探针。四条均写入本文 §6.4，`/tmp` 执行不落库；⑤ AGENTS 增补「新增接口必须同时在 `contracts/api.ts` 登记」 | P0 | 中 | 中：探针只能证明计数/集合，不能证明"常量真的被使用"（A-01 归零 + A-02 下界共同兜住） |
| **R-11** | M4 | 地图 `web-console.files = ["apps/web/**","postcss.config.ts"]`；新增 contracts 后归属不明 | 归属登记、覆盖率不退化 | `map.json`：`shared-foundation.files += ["packages/contracts/**"]`；`files_total` 加新增文件数；`e18` 标签改为「17 处纯协议类型 + 契约包常量」；`e19/e20/e22` 标签同步（插件 import 行数变化）；重算 `coverage_ratio`；AGENTS 目录结构与模块表同步 | P1 | 低 | 低：漏更新会让下轮评审以旧数据判定 |
| **R-12** | 每批 | 改动面 131 字面量 + 38 包导入 + 12 插件导入 + 19 包内字面量 + 71 服务端字面量 | 行为零变化、可逐批回滚 | 5 个 web 批 + 3 个契约批 + 1 个插件批 + 1 个服务端批 + R-09 独立 1 行批，**各自独立可回滚**；每批后跑 root `typecheck`、`build:web`、以及 §6.3 中与该批相关的冒烟子集 | P0 | 中 | 高：批量正则改写最易把查询参数拼接改错（每批 ≤60 处、模板逐个手写） |

### 3.1 R-05 插件 UI 处置矩阵（17 → 13 子路径，逐条给去向）

| 子路径 | 值/类型行 | 文件 | 去向 | 依据 |
| --- | --- | --- | --- | --- |
| `nodes-scaffold/{connection,nodeAi,nodeDocument,nodeEvent,nodeSkeleton,nodeTools,runtime,values,workspaceFiles}`（9） | 40 行中的 30（值 20 / 类型 10） | 25 | **保留静态**，登记 **E1**；其中 `nodeAi` 的 10 条 URL 由 R-08 改为常量（import 本身不动） | 骨架是"宿主提供给插件的运行时"，web 就是宿主 |
| `tools-scaffold/{runtime,client}`（2） | 6（值 2 / 类型 4） | 5 | **保留静态**，登记 **E1**（`client.loadToolComponent` 本身就是注册表入口）；新增 `isBrowserTool` | 同上 |
| `ext-scaffold/runtime`（1） | 4（值 1 / 类型 3） | 4 | **保留静态**，登记 **E1** | 同上 |
| `tool-canvas/runtime`（1） | 6（值 2 / 类型 4） | 6 | **保留静态**，登记 **E2** | `canvasSchemas` 是画布工具的业务参数 zod schema，web 作画布宿主必须解析；下沉会反转插件所有权 |
| `tool-browser/panel`（1） | 2（值 2） | 2 | **改动态**：`loadToolComponent("browser")` | 工具已有注册表，只是 browser 未声明 `components` |
| `tool-browser/client`（1） | 2（值 2） | 2 | **迁移**：`isBrowserTool` → `@toonflow/tools-scaffold/runtime` | 1 行纯判断，属脚手架 |
| `node-video/videoPlayer`（1） | 1（值 1） | 1 | **迁移**：→ `@toonflow/node-shared/videoPlayer` | C7 |
| `node-text/markdownPreview`（1） | 1（值 1） | 1 | **迁移**：→ `@toonflow/node-shared/markdownPreview` | C7 |

> 交付态：实现类子路径精确集合 = `{@toonflow/tool-canvas/runtime}`；实现类行 12 → **6**（值 8 → **2**，类型 4 → **4**）；骨架 `12 子路径 / 41 行 / 34 文件 / 值 25 / 类型 16`（`isBrowserTool` 并入 `tools-scaffold/runtime` 造成的 +1 行 +2 值 −1 类型，算法见 §6.1 的 A-05 口径表）。

### 3.2 R-02 的 5 个 web 批次（精确数字，本轮已复算）

| 批次 | 范围 | 处数 | 文件数 | 形态（plain/tmpl/guard） |
| --- | --- | --- | --- | --- |
| **B1** | `apps/web/src/lib/**` | **21** | **8** | 15 / 5 / 1 |
| **B2** | `apps/web/src/stores/**` + `main.ts` | **10** | **5** | 9 / 1 / 0 |
| **B3** | `apps/web/src/pages/**` | **19** | **6** | 11 / 7 / 1 |
| **B4** | `apps/web/src/components/settings/**` | **60** | **26** | 52 / 8 / 0 |
| **B5** | 其余 `apps/web/src/components/**` | **21** | **8** | 20 / 1 / 0 |
| | **合计** | **131** | **53**（B1∪B2 = 13 个不重复文件） | 107 / 22 / 2 |

### 3.3 R-06 生产者/消费者共用工厂（当前逐字耦合的 3 处）

| 生产者 | 消费者 | 当前约束 | 改后 |
| --- | --- | --- | --- |
| `routes/nodes/get.ts:30` → `/api/nodes/files?name=<name>` | `canvas/index.vue:1345` 的 `!==` 逐字比对（另有 `:1292` 拼同一模板） | 完全相同字符串 | 双方 `apiRoutes.nodes.files(name)` |
| `routes/ext/list.ts:23` → `/api/ext/read?name=<name>` | `document/extensions.ts:80` 的 `startsWith("/api/ext/")` + `?revision=` 拼接 | 前缀 + 前缀 | `apiRoutes.ext.read(name)` + 守卫改用 `apiRoutes.ext.base` |
| `routes/tools/renderers.ts:9` → `/api/tools/client?name=<name>&version=<64 hex>` | `toolScaffold/src/client.ts:31` 的正则 | 正则字面量 | `apiRoutes.tools.client(name, version)`；保留 `[a-f0-9]{64}` 校验（对解析后的 `version` 参数做） |

## 4. 里程碑与精确期望

| 里程碑 | 内容 | 关键期望 | 交付门 |
| --- | --- | --- | --- |
| **M0** | 基线冻结（本轮，零代码改动） | 本文 §0.3 全表可复现；**web typecheck exit 2**（B-1） | §6.4 的 P1–P16 均可跑出表中数字 |
| **M1** | R-01 建 contracts（只加不改）+ **R-09 修 B-1** | 新增 contracts 代码文件 5；web 字面量**仍为 131**（证明只加不改）；**root typecheck exit 0** | A-09 PASS；A-13 PASS；`build:web` exit 0 |
| **M2** | R-03 接线 + R-04（类型迁移）+ R-02 的 B1/B2 | web 值导入 **0**；server 总导入 **17**（全 `import type`）；web 字面量 131 → **100** | root typecheck exit 0；`build:web` exit 0；A-11 绿 |
| **M3** | R-02 的 B3/B4/B5 + R-05 + R-06 + R-08 | web 字面量 → **0**；实现类子路径 → **1**；包内字面量 19 → **0**；主包插件来源路径 5 → **0** | A-01/A-03/A-05/A-06/A-12/A-14 PASS；S-04/S-07/S-09 |
| **M4** | R-07 + R-10 + R-11 | 服务端手写 71 → **15**（Q5=B）；地图归属更新；`coverage_ratio` 不退化 | A-08 PASS；A-07 双向差集符合期望 |
| **M5** | 终验 | A-01～A-14 全 PASS；冒烟 12/12；豁免表填满 | 全量判据 + 审查通过 |

## 5. 需求-验收对照（一页纸）

| 需求 | 主判据 | 期望 | 正控制（M0） |
| --- | --- | --- | --- |
| R-01/R-02 | A-01、A-02、A-03、A-06 | 0 / 0 / 0 / diff=0 | 131 / 132 / 21 / 快照即基线 |
| R-03/R-04 | A-04、A-11 | 17 行 16 文件 2 子路径 0 值 | 38/30/7/10 |
| R-05 | A-05 | 实现 1 子路径；骨架不增长 | 5 / 12 / 9 / 8 |
| R-06/R-07 | A-07、A-08 | 144/164/0/0/6；手写 15 | 0 / 164；71 |
| R-01/R-03 | A-09、A-10 | 0 外部依赖；diff 为空 | 包不存在；副本不存在 |
| R-08 | A-12、A-14 | 19 → 0；主包插件来源 5 → 0 | 19 / 5 |
| R-09 | A-13 | 闭包别名 0；web typecheck exit 0 | 闭包别名 1；exit 2 |
| 全部 | A-11 | typecheck/build/冒烟全绿 | 冒烟需在 M0 也跑一遍作对照 |

## 6. 验收标准

### 6.1 二值判定表（A-01～A-14）

| 编号 | 判据 | 探针 | 期望（唯一值 / 精确集合） | 正控制（M0 实测） |
| --- | --- | --- | --- | --- |
| **A-01** | web 源码 `/api` 字面量归零 | P1 | `occ=0 req=0 plain=0 tmpl=0 guard=0 comment=0 files=0` | `occ=131 req=129 plain=107 tmpl=22 guard=2 comment=0 files=53` |
| **A-02** | web 内无任何 `/api/` 文本，且常量确被使用 | P1b | `grep -c "/api/"` = **0**；使用 `apiRoutes`/`apiBase` 的文件数 **≥ 40**（下界） | 132 行；常量使用 0 文件 |
| **A-03** | 21 个前缀在 `apiRoutes` 中全部存在 | P2 | 前缀集合 21/21 命中；交付态 web 侧前缀计数 = 0 | 21 个（见 §11.2） |
| **A-04** | web 对 server 依赖面收缩 | P3 | `server_lines=17 files=16 specs=2 value=0 type=17`；`specs = {@toonflow/server/agent/types, @toonflow/server/singleAgent/types}` | `38 / 30 / 7 / 10 / 28` |
| **A-05** | 插件实现类子路径收敛 | P4 | `impl_specs=1`（= `@toonflow/tool-canvas/runtime`）、`impl_lines=6`、`impl_value=2`、`impl_type=4`；`scaffold_specs=12`、`scaffold_lines=41`、`scaffold_files=34`、`scaffold_value=25`、`scaffold_type=16` | impl `5/12/9/8/4`；scaffold `12/40/33/23/17` |
| **A-06** | URL 文本零变化 | P15 | 替换前 131 条 URL 文本集合 == 替换后由常量求值集合；`diff=0`；2 个含 `encodeURIComponent` 的模板（`ai.balanceEvents`、`mcp.controlEvents`）编码位置不变 | 快照即基线（M0 `diff=0` 自证） |
| **A-07** | 契约与服务端端点一致 | P7 | `contract_paths=144`、`missing_in_contracts=0`、`invented_in_contracts=0`、`server_endpoints=164`、`router_mounts=163`、`consumed_not_in_server=6`（全部落在 HOST ∪ BASES） | `contract_paths=0`；`144/164/138/6` |
| **A-08** | 服务端手写字面量收敛 | P5 | Q5=B（默认）→ `handwritten=15`，且 `generated_router=163` 恒定；拆分固定为 35（生产者 3 + operations 32）+ 21（routePrefixes）+ 15（E4 保留）= 71 | `handwritten=71 generated=163` |
| **A-09** | contracts 零外部依赖 | P8b | 外部 `@toonflow` 依赖集合 = `{formats}`；`dependencies` 键 = 0；代码文件 = 5 | 包不存在 → 判 FAIL（不得判"无异常"） |
| **A-10** | 副本无漂移 | P8a | `nodeMenu`、`desktop` 与旧路径逐字节相同；旧路径为再导出 shim；`@toonflow/server/{nodeMenu,desktop}` target 未变 | `documentFormats/modelReasoning/mentionSources` 已 IDENTICAL（3/3）；`nodeMenu/desktop` 未下沉 |
| **A-11** | 行为零变化（全局绿） | P12 + P13 + 冒烟 | root `typecheck` **exit 0**（含 web）；`build:web` exit 0；`build:tools`/`build:nodes`/`build:ext` exit 0；§6.3 冒烟 **12/12**；server `exports` 14 键与 target 逐字不变 | root typecheck **exit 2**（B-1）；build:web exit 0 |
| **A-12** | 插件包内 `/api` 字面量归零 | P8 | `packages/**` `occ=0 files=0`（E9 登记的例外除外，期望 E9 为空集） | `19 / 6 / 16 去重路径` |
| **A-13** | B-1 修好：web 解析的 server 源码闭包内 0 条 `@/` 别名 | P14 | 从 7 个 web 所用子路径出发的闭包：`alias_imports=0`；web typecheck 单包 **exit 0** | 闭包 `alias_imports=1`（`singleAgent/types.ts` 的 `@/agentRuntime`）；单包 exit 2 |
| **A-14** | web 主包不再含插件来源契约 | P9 | 产物内 `/api` 去重路径 ⊆ web 源码声明的路径 ∪ contracts 常量集；**插件来源去重路径 = 0**（M0 为 5：`/api/ai/media/models`、`/api/ai/media/tasks/cancel`、`/api/ai/media/tasks/status`、`/api/browser/input`、`/api/tools/renderers`） | 5 |

> **A-05 的骨架期望与实施口径（本节数字由本轮脚本模拟两种改法实算，非估算）**

`isBrowserTool`（`tool-browser/client`，2 行 / 2 文件，均为值行）移入 `@toonflow/tools-scaffold/runtime` 后，骨架计数必然变化。两种改法的**精确**结果：

| 改法 | scaffold_lines | files | specs | value | type | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| M0 基线 | 40 | 33 | 12 | 23 | 17 | 现状 |
| **改法 1（推荐 · 默认）** | **41** | **34** | 12 | **25** | **16** | `providerAgentDialog.vue:74` 的 `import type { ToolCall }` 改为 `import { isBrowserTool, type ToolCall }`（同值行，不增行）；`messageList.vue` 的 `tool-browser/client` 行整行替换为 `tools-scaffold/runtime`（不增行）；`tool-browser/client` 2 行消失 |
| 改法 2（另起一行） | 42 | 34 | 12 | 25 | 17 | 在 `providerAgentDialog.vue` 新起一行 `import { isBrowserTool }` |

> **默认按改法 1**：A-05 期望 `scaffold_lines=41 / files=34 / specs=12 / value=25 / type=16`。
> 上述差异的成因：`tool-scaffold/runtime` 原本 `(type 4, value 1)`，改法 1 把 `providerAgentDialog` 那行从 `type` 变 `value` 并新增 `messageList` 一条 `value` → `(type 3, value 3)`；`tool-browser/client` 的 2 条 value 消失。净效果 lines 40→41、value 23→25、type 17→16。
> **若评审改选 Q7=B（browser 面板不改动态）**，则 `tool-browser/panel` 与 `client` 都不动，A-05 的骨架期望回到 `12/40/33/23/17`、实现类期望变为 `4 子路径 / 10 行 / 7 文件 / 值 6 / 类型 4`。二选一必须在 §10 勾选，**不允许实施时就地放宽**。

### 6.2 判定规则

1. 只有 PASS / FAIL；不接受「基本通过」「趋势良好」「≤ / 约 / 含…或…」。
2. 期望必须是整数或精确集合；计数类判据用**两种独立算法**各算一次（grep 与 Python 解析），相等才 PASS。
3. **不可达即回评审**：实施中若发现期望不可达（常量与 `router.ts` 天然不一致、某插件产物无法声明 components），**不得就地放宽**，回需求评审修订本表。
4. 豁免前置：任何未在 §8 登记的项，一律计入判据分子。
5. 相位：A-01～A-14 在 **M5 交付态**判定；M0 只作正控制与基线记录（注意 A-11 的 M0 正控制**本身就是红的**，这正是 B-1）。
6. `router.ts` 是生成物：以「手改 `router.ts` 达成 A-07」的实现方式判 FAIL（同时违反 C3）。

### 6.3 冒烟矩阵（12 项，全部走 HTTP 层验证「URL 未变」）

> fixture 放 `/tmp`，执行后删除。启动沿用既有做法：`cd apps/server && TOONFLOW_DATA_DIR=$TMP bun src/index.ts`。

| # | 场景 | 请求 | 二值断言 |
| --- | --- | --- | --- |
| **S-01** | 设置读写（`stores/settings.ts`） | `GET /api/settings/get`、`PUT /api/settings/save` | 均 HTTP 200 且 `code=200` |
| **S-02** | 会话状态 | `GET /api/sessionState/get`、`PATCH /api/sessionState/patch` | 均 200；`get` 返回 `code=200` |
| **S-03** | 工作区文件（`workspaceFiles.ts` 的 baseURL + 10 相对段） | `GET /api/workspaces/files/list?directory=<ws>&path=` | 200；`data.directory` 等于 `<ws>` 的 realpath |
| **S-04** | 素材库（`assetLibrary/api.ts` 的 baseURL + 15 相对段） | `GET /api/assets/list?library=project&directory=<ws>` | 200；`code=200` |
| **S-05** | 节点列表与脚本 URL（R-06 工厂） | `GET /api/nodes/get` | 每条 `item.url` **精确等于** `/api/nodes/files?name=<item.name>`（用常量求值比对，不许模糊判定） |
| **S-06** | 扩展列表与脚本 URL（R-06 工厂 + 守卫） | `GET /api/ext/list` | 每条 `item.url` 精确等于 `/api/ext/read?name=<name>`；web 守卫仍放行 |
| **S-07** | 工具渲染器（R-06 工厂 + 64 hex） | `GET /api/tools/renderers` | 每条 `url` 匹配 `^/api/tools/client?name=<小驼峰>&version=<64 hex>$`（M0 与 M5 正则等价） |
| **S-08** | Agent 流式（13 处） | `POST /api/agent`（fixture 供应商） | 200、`Content-Type: application/x-ndjson; charset=utf-8`、首行 `type=session`、末行 `type=done`、`type=error` 行数 0 |
| **S-09** | 工作区越界（不变式） | `GET /api/workspaces/files/list?directory=<ws>&path=../etc` | 400；body 精确 `{"code":400,"data":null,"message":"文件路径无效"}` |
| **S-10** | FFmpeg SSE | `GET /api/ffmpeg/events` | 200 且 `Content-Type: text/event-stream`（15s 内首事件或保持连接） |
| **S-11** | 计费 SSE（`providerBilling.ts`） | `GET /api/ai/media/balanceEvents?accountIds=` | 200 且 `Content-Type: text/event-stream` |
| **S-12** | 宿主契约与产物 | ① `build/web` 全文检索 `packages/contracts/src` 源路径字符串；② `apps/server/package.json` 的 exports | ① 0 命中；② 14 个键与 target 与 M0 **逐字相等** |

### 6.4 探针（P1–P16，`/tmp` 一次性执行，不落库）

所有探针均为只读、只输出整数或集合。实施方需把 M0 与 M5 两次输出一起贴进实施报告。

```bash
# P1  web `/api` 字面量分类计数（A-01）
#   M0 期望：occ=131 req=129 plain=107 tmpl=22 guard=2 comment=0 files=53
#   M5 期望：全 0
#   做法：遍历 apps/web/src 的 .ts/.vue，跳过行首为 // * /* 的整行注释，
#         用 "双引号|单引号|反引号 紧跟 /api" 的引号边界匹配；
#         反引号计 tmpl、其余计 plain；同一行含 startsWith( 的额外计 guard。

# P1b web 内 `/api/` 文本残留（A-02，比 P1 更严：含注释与拼接）
#   grep -rn "/api/" apps/web/src --include='*.ts' --include='*.vue' | wc -l
#   M0=132（131 字面量 + SaveToLibraryDialog.vue:84 注释行）  M5=0
#   grep -rl "apiRoutes|apiBase" apps/web/src --include='*.ts' --include='*.vue' | wc -l
#   M0=0  M5>=40

# P1c 去重文本数（A-06 的输入口径）
#   本轮实测：plain 107 处 / 88 去重；tmpl 22 处 / 19 原始去重（归一化 ${...} 后 17）。
#   第 1 版写的 103 无法复现，本版以 107（88+19）为基线，A-06 用"出现次数集合"而非"去重数"判定。

# P2  前缀分布（A-03）
#   M0=21：desktop=17 providers=16 agent=13 mcp=11 assets=10 (bare)=7 settings=7
#          skills=6 workspaces=6 mobileLink=5 agents=5 singleAgent=5 ffmpeg=4 nodes=4
#          connection=3 ai=3 ext=3 tools=2 sessionState=2 mobile=1 plugins=1
#   M5：web 侧 0

# P3  web 对 @toonflow 包的导入（A-04/A-05）
#   识别 import/export ... from "@toonflow/<pkg>[/sub]"，import type 或 {} 内全为 type 前缀者计 type。
#   M0：server 38/30/7 值 10 类型 28；scaffold 40/33/12 值 23 类型 17；impl 12/9/5 值 8 类型 4
#   M5：server 17/16/2 值 0 类型 17；scaffold 41/34/12 值 25 类型 16；impl 6/6/1 值 2 类型 4

# P3d 逐子路径值/类型（A-04 的精确集合）
#   M0：agent/types 14(0/14) modelReasoning 5(1/4) desktop 4(0/4) nodeMenu 4(3/1)
#       documentFormats 4(4/0) agent/mentionSources 4(2/2) singleAgent/types 3(0/3)

# P4  插件/骨架子路径（A-05）
#   骨架 = nodes-scaffold|tools-scaffold|ext-scaffold；实现 = 其余
#   M0：17 子路径 / 52 行 / 36 文件；骨架 12/40/33（值 23/类型 17）；实现 5/12/9（值 8/类型 4）

# P5  服务端 `/api` 字面量（A-08）
#   遍历 apps/server/src 的 .ts，用引号边界匹配 /api/，router.ts 单列为 generated。
#   M0：server_occ=234 files=16 generated=163 handwritten=71
#   M5：Q5=A → 36；Q5=B → 15；Q5=C → 0；generated 恒为 163

# P6  服务端端点全集（A-07 的一半）
#   从 router.ts 的 app.use("<prefix>", routeN) 取 163 个挂载，
#   再逐个 routes/*.ts 取 .get/.post/.put/.delete/.patch/.all("/x") 拼成完整路径。
#   M0：mounts=163 endpoints=164（多出的一条为 /api/assets/usage/batch 子路径）

# P7  客户端声明路径 vs 服务端端点（A-07）
#   web 字面量（去查询串、排除模板与以 / 结尾者）∪ MCP operations 的 path ∪ packages 内字面量；
#   另把 assetLibrary/api.ts 与 workspaceFiles.ts 的 axios 相对段按 baseURL 拼全。
#   M0：web 120 + ops 32 + plugins 16 → 去重 144；in_server 138；not_in_server 6（=3 宿主 + 3 baseURL）

# P8  packages 内 `/api` 字面量（A-12）
#   M0：19 处 / 6 文件 / 16 去重路径（nodeAi 10、browserPanel 3、questionCard 2、comfyMonitor 2、ffmpeg/browser 1、toolScaffold/client 1）
#   M5：0

# P8b contracts 外部依赖与文件数（A-09）
#   packages/contracts/src 中 from "@toonflow/..." 的包名集合 == {formats}
#   package.json 无 "dependencies" 键；src/*.ts 文件数 == 5

# P8a 副本一致性（A-10）
#   diff <(git show b52454e:apps/server/src/lib/nodeMenu.ts) packages/formats/src/nodeMenu.ts   -> 空
#   diff <(git show b52454e:apps/server/src/types/desktop.ts)   packages/formats/src/desktop.ts  -> 空
#   并确认 apps/server/src/lib/nodeMenu.ts 与 src/types/desktop.ts 已改为再导出 shim

# P9  web 产物中的 `/api` 去重路径（A-14）
#   bun x vite build --outDir /tmp/webprobe --emptyOutDir
#   对 /tmp/webprobe 的 *.js 做引号边界扫描，得到去重路径集合；
#   与 web 源码声明集合求差：产物独有 = 插件来源。
#   M0：产物 93 条；产物独有 5 条（ai/media/models、ai/media/tasks/cancel、ai/media/tasks/status、browser/input、tools/renderers）
#   M5：产物独有 0

# P10 宿主壳字面量（仅记录，不在验收范围）
#   apps/desktop 12、apps/mobile 5、compat/ohos 的 index.ets 2

# P11 web 规模（R-12 预算）
#   code 扩展名（.ts/.tsx/.js/.jsx/.mjs/.cjs/.mts/.cts/.vue/.sql/.ets/.java/.kt/.kts/.cs/.cpp/.h/.hpp/.m/.mm）
#   M0：apps/web 175 文件 / 42,742 行（含自动生成的 types/components.d.ts 135 行）；
#       把 postcss.config.ts 计入则 176 / 42,751（第 1 版用的就是这个口径，两者不矛盾）

# P12 类型检查（A-11/A-13）
#   (cd apps/web && bun x vue-tsc --noEmit)                     M0：exit 2，1 条错误（B-1）  M5：exit 0
#   bun run typecheck                                           M0：exit 2               M5：exit 0

# P13 构建（A-11）
#   bun run --filter '@toonflow/web' build                      M0/M5：exit 0
#   bun run build:tools / build:nodes / build:ext               M0/M5：exit 0

# P14 `@/` 别名闭包（A-13）
#   从 web 实际使用的 7 个 server 子路径（exports target）出发做 BFS，
#   沿相对 import 与 @toonflow 包 exports（仅 .ts 源文件）展开，统计 from "@/..." 的行数。
#   M0：closure_files=10，alias_imports=1（singleAgent/types.ts 的 @/agentRuntime）
#   M5：alias_imports=0

# P15 URL 文本等价（A-06）
#   替换**前**：对 apps/web/src 逐行取出引号边界内的 /api 文本（含模板原样，不去变量），
#              另加 packages 内 19 条与 MCP operations 的 32 条，存为 /tmp/url_baseline.json；
#   替换**后**：用 contracts 常量与工厂对同一批调用点求值，得到同规模集合；
#   判定：两集合逐条相等（diff=0），且 2 个 encodeURIComponent 的位置未变
#        （apiRoutes.ai.balanceEvents / apiRoutes.mcp.controlEvents 的参数位置）。
#   M0：快照即基线（diff=0 自证）；M5：diff=0

# P16 包内字面量缺失时的存在性守卫（A-12 的负控制）
#   若某插件包改完后仍能找到 /api 字面量，脚本必须打印 file:line 并 exit 1，
#   不得因"文件不存在/无匹配"而静默判 PASS。
#   M0：19 命中、exit 1；M5：0 命中、exit 0
```

### 6.5 计数台账（L01–L14，记录用，不作结论）

| # | 项 | M0 | M1 | M2 | M3 | M4 | M5 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| L01 | web `/api` 出现次数 | 131 | 131 | 100 | 0 | 0 | 0 |
| L02 | plain / tmpl / guard | 107/22/2 | 107/22/2 | 83/16/1 | 0/0/0 | 0/0/0 | 0/0/0 |
| L03 | 涉及文件数 | 53 | 53 | 40 | 0 | 0 | 0 |
| L04 | 前缀数 | 21 | 21 | 17 | 0 | 0 | 0 |
| L05 | server 导入行 / 文件 | 38/30 | 38/30 | 17/16 | 17/16 | 17/16 | 17/16 |
| L06 | 其中值导入 | 10 | 10 | 0 | 0 | 0 | 0 |
| L07 | 插件实现类子路径 | 5 | 5 | 5 | 1 | 1 | 1 |
| L08 | 插件实现类值行 | 8 | 8 | 8 | 2 | 2 | 2 |
| L09 | 骨架 子路径/行/文件 | 12/40/33 | 12/40/33 | 12/40/33 | 12/41/34 | 12/41/34 | 12/41/34 |
| L09b | 骨架 值/类型 | 23/17 | 23/17 | 23/17 | 25/16 | 25/16 | 25/16 |
| L10 | 服务端手写字面量 | 71 | 71 | 71 | 71 | 15 | 15 |
| L11 | contracts 代码文件 | 0 | 5 | 5 | 5 | 5 | 5 |
| L12 | packages 内字面量 | 19 | 19 | 19 | 0 | 0 | 0 |
| L13 | 主包插件来源去重路径 | 5 | 5 | 5 | 0 | 0 | 0 |
| L14 | web typecheck exit | 2 | **0** | 0 | 0 | 0 | 0 |

> L01 的 M2 期望 = 131 − 31（B1 21 + B2 10）= **100**；M3 期望 = 100 − 100（B3 19 + B4 60 + B5 21）= **0**。分项不许「下降即可」。

## 7. 风险与缓解

| # | 风险 | 影响 | 概率 | 缓解 | 判据 |
| --- | --- | --- | --- | --- | --- |
| R1 | 常量值拼错（131 处中任一处） | 该功能 404，用户可见 | 中 | A-06 逐条对账；每批后跑该批 URL 子集 | A-06 |
| R2 | 模板工厂参数顺序/编码方式改变 | 查询参数错位 | 中 | 19 个原始模板逐一人工核对；2 处 `encodeURIComponent` 位置不变 | A-06 |
| R3 | `apiRoutes` 变上帝对象（144 路径 + 工厂） | 可维护性下降，用旧问题换新问题 | 中 | 按 21 前缀分组；`api.ts` ≤400 行；readme 给「新增接口 = 一行常量 + 一行挂载」 | E5 |
| R4 | browser 面板改动态后，旧安装实例无面板 | 界面缺失（非崩溃） | 高 | `loadToolComponent` 返回 undefined 时按「无面板」降级并保持对话可用；`messageList.vue` 在 `components` 为空时不渲染 `<browserPanel>` | S-07 + 人工 |
| R5 | web 类型迁移后 `vue-tsc` 报「结构相同但名义不同」 | 构建/类型检查失败 | 中 | 只改 import 路径不改类型名 | A-11 |
| R6 | 未加 workspace 依赖就改指向 formats/contracts | vite 解析失败（B-3） | 高 | M2 第一步先接线 + `bun install` + 检查软链 | A-11 |
| R7 | 插件包引入 contracts 后，插件构建 external 配置漏项 | `build:tools` 失败 | 中 | 实施时跑全部三种插件构建；契约包零依赖，可安全内联 | A-11 |
| R8 | A-07 的 6 条非零被质疑 | 期望值反复 | 中 | 写进 E3，并让探针输出 `consumed_not_in_server=6` 作为**唯一允许的非零** | A-07 |
| R9 | `map.json` 归属未更新 | 下轮评审以旧数据判定 | 中 | R-11 逐条列 glob | A-07 之外另做存在性检查 |
| R10 | B-1 的修法选了"给 web 加 server 路径映射" | 把整个 server src 拖进 web 类型图，问题放大 | 低 | Q10 默认 A（同包相对路径），评审若改选需说明 | A-13 |

## 8. 豁免判定与结构化豁免（E1–E10）

### 8.1 判定标准（满足任一即申请）

1. 消除需改变对外契约（HTTP / 包导出 / 宿主行为 / 插件产物格式）；
2. 消除需超出本需求范围（跨模块 / 跨包 / 改宿主壳）；
3. 消除引入的风险或复杂度高于收益，且已有可执行替代缓解。

### 8.2 候选豁免（未勾选视为驳回 → 转验收项）

| ID | 关联 | 内容 | 未消除的理由 | 替代缓解（可执行） | 复核触发 |
| --- | --- | --- | --- | --- | --- |
| **E1** | R-05 | **12 个骨架子路径保留静态**（`nodes-scaffold` 9、`tools-scaffold` 2、`ext-scaffold` 1；交付态 41 行 / 34 文件 / 值 25 / 类型 16） | 骨架不是插件，而是"宿主提供给插件的运行时库"；web 就是宿主，改动态会让插件编译期拿不到类型 | ① 冻结 `12/41/34`，不得再增长；② 三个宿主全局不变（C6）；③ **骨架内不得新增 `/api` 字面量**（R-08 已把现有 10 条清零，由 A-12 持续保证） | 任一项增长，或骨架内出现新的 `/api` |
| **E2** | R-05 | **`@toonflow/tool-canvas/runtime` 保留静态**（6 行 / 6 文件，值 2 行 `canvasSchemas`） | `canvasSchemas` 是画布工具的业务参数 zod schema，web 作画布宿主必须解析 agent 传来的工具调用；下沉会反转插件所有权并让 foundation 依赖 zod | ① 冻结 6 行不变；② 白名单仅 `canvasSchemas`（值）+ `CanvasContext`/`CanvasToolCall`（类型），其余一律不允许 | 出现第 3 个值导出时重评 |
| **E3** | R-01/R-07 | **6 条声明路径不在服务端端点全集内**：宿主端点 `/api/connection/connection`、`/api/connection/disconnect`、`/api/mobile/exports`；baseURL 前缀 `/api/assets`、`/api/workspaces`、`/api/workspaces/files` | 前三条由 `apps/desktop/src/connection.ts:82` 与 `apps/mobile/src/server.ts:75,101` 挂载（属宿主壳）；后三条是 `axios.create({ baseURL })` 的既有用法，本身不是端点 | ① A-07 的 `consumed_not_in_server` 精确 = 6 且全部落在 HOST ∪ BASES；② 这 6 条在 `api.ts` 用 `hostOwned`/`baseUrlOnly` 注释标明来源；③ web 行为不变 | 宿主壳新增 `/api/*` 路由，或新增第三个 baseURL 客户端 |
| **E4** | R-07 | **服务端 15 处中间件/安全判断保留手写**：`app.ts` 4（`express.raw` 2 处路径数组、`express.json` 1、`desktopRequest` 1）、`mobileLink/index.ts` 7（含小写比较 `/api/mobilelink/pair`）、`mcp/tools.ts` 2、`remoteConnection.ts` 2（拼 `active.url`） | 这些不是"客户端调用 URL"，而是服务端自身的路由分组与前缀判断；小写比较与外部 URL 拼接无法用常量表达，改常量会让刻意的 `toLowerCase()` 语义丢失 | ① 71 的拆分固定为 35 + 21 + 15；Q5=B 下 A-08 期望 15；② 每条保留项加 `ACT:` 注释说明为何手写 | 安全判断新增分支时 |
| **E5** | R-01 | **`apiRoutes` 允许长到 144 路径 + 工厂（约 158 键）** | URL 常量天然多；拆包会让"唯一来源"变成 5 个来源 | 按 21 前缀分组；`api.ts` 行数上限 400；readme 固定动作 | 超过 400 行时拆分 |
| **E6** | NG3 | **`canvas/index.vue`（1,548 行）等巨型组件不拆** | 属 `c-web-console-2`，独立需求 | 本需求对该文件只允许「URL 替换 ±5 行」 | 出现结构性重写时 |
| **E7** | G4 | **17 行 server 协议类型保留**（`agent/types` 14 + `singleAgent/types` 3） | 二者引用 `ToolCall`/`QuestionRequest`/`ToolDefinition`（`@toonflow/tools-scaffold`，属 agent-tools 域）。contracts 在 foundation，下沉会新建 layer violation | ① 冻结 17 行 / 16 文件 / 2 子路径；② 全部 `import type`；③ 若未来 tools-scaffold 归位 foundation 再迁移 | 出现第 3 个 server 子路径时 |
| **E8** | NG9 | **插件产物仅新增 `components` 元数据字段**（browser 工具由 `[]` 变 `["browserPanel"]`） | 用户机器上已装旧插件，改产物结构会让它们失效 | 只新增字段，格式与既有 `canvas`/`askUser` 一致（`string[]`，与 `components` 键对应） | 需要改产物结构时 |
| **E9** | R-08 | **插件包内确需保留的字面量**（默认期望为**空集**；实施若发现某条无法常量化的，必须在此登记） | 预置位：例如某些插件在纯浏览器环境里没有 contracts 可用 | 若登记，需给 `file:line`、原因与替代缓解；A-12 的期望相应改为精确集合 | 出现新的插件包 |
| **E10** | R-05/R-08 | **宿主壳（desktop 12 / mobile 5 / compat 2）字面量不纳入本需求** | 属 `desktop-shell` / `mobile-shell` 模块；且移动壳是 ArkTS/Java 等非 TS 语言，无法直接 import TS 契约包 | 只记录计数，不改动；由后续宿主壳需求处理 | 宿主壳需要与 contracts 对齐时 |

## 9. 待评审决策点（Q1–Q10，均有默认值）

| # | 决策 | 选项 | 默认 | 理由 |
| --- | --- | --- | --- | --- |
| **Q1** | 契约包位置 | **A 新建 `packages/contracts`** / B 并入 `packages/formats` / C 放 `apps/web/src/lib` 本地 | **A** | B 让 formats 承载 HTTP 语义，与其"文件/模型格式"定位冲突且已有 5 个 exports；C 无法被 server 与插件复用，等于把 4 个副本变成 5 个 |
| **Q2** | 插件 UI 收敛程度 | A 全改动态（含骨架）/ **B 分类处置** / C 只做 nodeShared 迁移 | **B** | A 会让插件编译期失去类型并需重写 3 个脚手架；C 不解决 browser 面板的双轨 |
| **Q3** | server 协议类型 17 行 | **A 保留并冻结（E7）** / B 把 tools-scaffold 类型下沉 foundation 后迁移 | **A** | B 是跨模块层级调整，超出本需求 |
| **Q4** | `toolScaffold/client.ts` 是否改 | **A 改**（它本就是 web 消费的客户端入口）/ B 不改，只在 web 侧对齐 | **A** | 不改则 `/api/tools/client` 仍有一处手写正则；改则只有 1 个文件 1 条常量 |
| **Q5** | R-07 服务端收敛范围 | A 只做生产者 35 / **B 再加 routePrefixes 21，消除 56** / C 连中间件一起（消除 71） | **B** | A 不够（`routePrefixes` 仍是第 3 个副本）；C 会把 `toLowerCase()` 安全判断改坏 |
| **Q6** | A-08 期望值（须与 Q5 一致） | A `handwritten=36` / **B `15`** / C `0` | **B** | 期望值必须由 Q5 唯一决定，避免实施时漂移 |
| **Q7** | `browser` 工具是否改动态 | **A 改（R-05②）** / B 不改（把 `tool-browser/panel` 也登记为 E2 类豁免） | **A** | 不改则"插件 UI 注册表"只覆盖 tool 类的一部分，问题未闭环 |
| **Q8** | 是否允许修改插件产物元数据 | **A 允许新增 `components` 字段** / B 不允许（则 Q7 只能选 B） | **A** | 与既有 `canvas`/`askUser` 机制完全一致，不构成新格式 |
| **Q9** | **R-08 包内字面量范围** | **A 全部 19 处收敛** / B 只收敛进主包的 5 条 / C 不处理（登记豁免） | **A** | B 只堵住"编进主包"，`nodeAi` 其余 5 条等在插件自己运行时仍会漂移；C 则 `c-arch-3` 未闭环。A 的代价是 6 个文件各改 1–10 行 |
| **Q10** | **B-1 的修法（R-09）** | **A 同包相对路径（改 1 行，闭包 0 别名）** / B 把 `AgentEvent` 下沉 contracts（受 tools-scaffold 依赖限制，代价高）/ C 给 web tsconfig 加 server 路径映射 | **A** | A 是最小且根因正确（别名对跨包消费者不可解析）；C 会把整棵 server src 拖进 web 类型图，等于把 B-1 的成因制度化 |

## 10. 评审意见栏

> 使用方式：评审逐条填写。未填写的 Q 项按 §9 默认值执行；未勾选的豁免视为驳回（转验收项）。
> **本轮特别请评审确认 §0.2 的 B-1/B-2/B-3 是否认可为"必须在本需求内解决"**——若认为 B-1 应拆成独立缺陷单，请在此明确，则 A-11/A-13 需相应改口径。

### 10.1 总体结论

| 项 | 填写 |
| --- | --- |
| 评审结论 | ☐ 通过（进入方案与实施） ☐ 打回（见 10.2） |
| 评审人 / 日期 |  |
| 一句话意见 |  |

### 10.2 打回意见（逐条填写）

| # | 意见（可引用章节号） | 严重度 | 期望处置 | 需求方回应 |
| --- | --- | --- | --- | --- |
| 1 |  |  |  |  |
| 2 |  |  |  |  |
| 3 |  |  |  |  |
| 4 |  |  |  |  |

### 10.3 决策点裁决（Q1–Q10）

| Q | 默认值 | 评审裁决（采纳默认 / 改选，改选请写明） |
| --- | --- | --- |
| Q1 契约包位置 | A 新建 `packages/contracts` |  |
| Q2 插件 UI 收敛程度 | B 分类处置 |  |
| Q3 server 协议类型 17 行 | A 保留并冻结 |  |
| Q4 `toolScaffold/client.ts` | A 改 |  |
| Q5 R-07 范围 | B（含 routePrefixes，消除 56、保留 15） |  |
| Q6 A-08 期望值 | B `handwritten=15` |  |
| Q7 `browser` 工具改动态 | A 改 |  |
| Q8 允许改插件元数据 | A 允许 |  |
| Q9 包内字面量范围 | A 全部 19 处 |  |
| Q10 B-1 修法 | A 同包相对路径 |  |

### 10.4 豁免裁决（E1–E10）

| 豁免 | 结论（同意 / 驳回→转验收项） | 说明 |
| --- | --- | --- |
| E1 12 个骨架子路径保留静态（41 行 / 34 文件 / 值 25 / 类型 16） |  |  |
| E2 `tool-canvas/runtime` 保留静态 |  |  |
| E3 6 条宿主/baseURL 路径 |  |  |
| E4 服务端 15 处中间件/安全判断 |  |  |
| E5 `apiRoutes` 144+工厂 |  |  |
| E6 巨型组件不拆 |  |  |
| E7 17 行 server 协议类型 |  |  |
| E8 插件产物仅加 `components` |  |  |
| E9 插件包内保留字面量（期望空集） |  |  |
| E10 宿主壳字面量不纳入 |  |  |

### 10.5 验收勾选（汇总）

| 分组 | 条目 | 结论 |
| --- | --- | --- |
| 契约归零 | A-01、A-02、A-03 | ☐ PASS ☐ FAIL |
| 依赖收缩 | A-04、A-05、A-09、A-10 | ☐ PASS ☐ FAIL |
| URL 与挂载一致 | A-06、A-07、A-08 | ☐ PASS ☐ FAIL |
| 插件契约 | A-12、A-14 | ☐ PASS ☐ FAIL |
| 类型与构建 | A-11、A-13 | ☐ PASS ☐ FAIL |

### 10.6 其他意见（不限格式）

```

```

## 11. 附录：基线清单（M0，可逐条复算）

### 11.1 web `/api` 字面量按文件分布（节选前 14 个文件；全量 53 个文件 / 131 处）

| 文件 | 处数 |
| --- | --- |
| `components/agent/conversation.vue` | 7 |
| `components/settings/panels/pluginMarket/skillEditorDialog.vue` | 6 |
| `pages/workspace/panels/assetLibrary/api.ts` | 6 |
| `components/singleAgentDialog.vue` | 5 |
| `components/settings/panels/developer/providerDebugDialog.vue` | 5 |
| `components/settings/panels/pluginMarket/mcpServers.vue` | 5 |
| `lib/clipboard.ts` | 5 |
| `components/settings/panels/deviceLink.vue` | 4 |
| `components/settings/panels/personalization.vue` | 4 |
| `components/settings/panels/pluginMarket/index.vue` | 4 |
| `components/agent/index.vue` | 4 |
| `stores/settings.ts` | 3 |
| `components/settings/panels/developer/index.vue` | 3 |
| `components/settings/panels/pluginMarket/ffmpeg.vue` | 3 |
| 其余 39 个文件 | 各 1–3 |

### 11.2 21 个前缀（A-03 的精确集合）

`desktop`、`providers`、`agent`、`mcp`、`assets`、`settings`、`(bare)`、`skills`、`workspaces`、`mobileLink`、`agents`、`singleAgent`、`ffmpeg`、`nodes`、`connection`、`ai`、`ext`、`tools`、`sessionState`、`plugins`、`mobile`

> `(bare)` 是 `/api/` 后直接接模板变量的 7 处（`/api/${type}/install` 等 5 处插件族拼接 + `/api/` 守卫 1 处 + 1 处前缀拼接），由 A-01/A-02 统一归零。
> `connection` 与 `mobile` 两个前缀由宿主壳提供（E3），contracts 中以 `hostOwned` 标注保留。

### 11.3 19 个原始模板（22 处）与工厂映射

| # | 原始模板 | 位置 | 工厂 |
| --- | --- | --- | --- |
| 1 | `/api/${category.path}/${type === "ext" ? "list" : "get"}` | `pluginMarket/index.vue:527` | `pluginInstall.list(type)` |
| 2 | `/api/${path}/install` | `pluginMarket/index.vue:671` | `pluginInstall.install(type)` |
| 3 | `/api/${path}/save` | `pluginConfigDialog.vue:48` | `pluginInstall.save(type)` |
| 4 | `/api/${pluginTypes[plugin.type].path}/${action}` | `pluginMarket/index.vue:760` | `pluginInstall.action(type, action)` |
| 5 | `/api/${type === "ext" ? "ext" : "<type>s"}/install`（2 处，内嵌模板） | `installPluginFile.ts:13`、`developer/index.vue:477` | `pluginInstall.install(type)` |
| 6 | `/api/ai/media/balanceEvents?accountIds=${encodeURIComponent(g)}` | `lib/providerBilling.ts:126` | `ai.balanceEvents(ids)`（保留编码位置） |
| 7 | `/api/assets/events?${params}` | `assetLibrary/api.ts:161` | `assets.events(params)` |
| 8 | `/api/assets/read?${params}`（3 处） | `assetLibrary/api.ts:376,381`、`mentionThumbnail.vue:39` | `assets.read(params)` |
| 9 | `/api/assets/save?${query}` | `assetLibrary/api.ts:416` | `assets.save(query)` |
| 10 | `/api/assets/thumb?${params}` | `assetLibrary/api.ts:370` | `assets.thumb(params)` |
| 11 | `/api/connection/${action}` | `lib/mobile.ts:72` | `connection.action(name)` |
| 12 | `/api/desktop/update/${nextAction}` | `stores/desktopUpdate.ts:117` | `desktop.update(action)` |
| 13 | `/api/ffmpeg/${action}` | `pluginMarket/ffmpeg.vue:229` | `ffmpeg.action(name)` |
| 14 | `/api/mcp/control/${path}` | `lib/mcpControl.ts:78` | `mcp.control(path)` |
| 15 | `/api/mcp/control/events?connectionId=${encodeURIComponent(id)}` | `lib/mcpControl.ts:163` | `mcp.controlEvents(id)`（保留编码位置） |
| 16 | `/api/mcp/servers/${mode === "json" ? "importJson" : "importDxt"}` | `pluginMarket/mcpImportForm.vue:169` | `mcp.servers(mode)` |
| 17 | `/api/nodes/files?name=${name}`（2 处） | `canvas/index.vue:1292,1345` | `nodes.files(name)` |
| 18 | `/api/workspaces/files/thumb?${params}` | `lib/workspaceFiles.ts:162` | `workspaces.filesThumb(params)` |

### 11.4 引用本文件的产物

- 需求矩阵索引：`./INDEX-2026-10.md`
- 方案文档（评审通过后）：`../2_requirements_solutions/<yyyy-MM-dd-hh-mm>-webConsoleContractDecoupling.md`
- 验证报告（实施后）：`../3_test_results/<yyyy-MM-dd-hh-mm>-webConsoleContractDecoupling-impl.md`
- 上一版（被判据替代）：`./2026-10-28-01-12-webConsoleContractDecoupling.md`
