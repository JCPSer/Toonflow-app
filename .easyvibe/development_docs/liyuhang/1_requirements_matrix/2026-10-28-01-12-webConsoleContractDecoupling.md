# 需求矩阵 · web 前后端与插件契约解耦（contracts 包 + 插件 UI 注册表）

## 0. 文档元信息

| 项 | 内容 |
| --- | --- |
| 文档编号 | **REQ-2026-10-28-01** |
| 版本 | 第 1 版（首版，待评审） |
| 需求来源 | `.easyvibe/map/map.json` → `modules[web-console].health.concerns.c-web-console-1`（**critical**）；全局 `health.concerns.c-arch-3`（high）；`edges.e18`（`web-console → server-api`，`type: api`） |
| 需求标题 | 抽 `@toonflow/contracts` 契约包集中 `/api` 路由常量与请求/响应类型；web 对 `@toonflow/server` 源码的值依赖归零；插件 UI 由静态 import 改为注册表 + 动态入口 |
| 影响模块 | **`web-console`（主）**；派生：`shared-foundation`（新增 `@toonflow/contracts`，`packages/formats` 增 2 个纯模块副本）、`server-api`（手写 `/api` 字面量）、`agent-tools`/`workflow-nodes`/`canvas-extensions`（插件 UI 注册表协议） |
| 需求类型 | 结构性重构（契约治理）。**不改变任何 HTTP URL、请求/响应结构、状态码、文案、插件产物格式、磁盘格式与构建产物路径** |
| 优先级 | **P0**（地图 critical；契约漂移在当前流程里只能在运行期暴露） |
| 当前状态 | **待评审**；本轮**只产出需求文档与索引，业务代码零改动**（`git status --porcelain apps packages compat scripts docs AGENTS.md` 为空） |
| 编写人 | 需求分析 agent（harness 规则正文 2.1 执行者） |
| 编写时间 | 2026-10-28 01:12 |
| 基线 | `git HEAD = b52454e`；`.easyvibe/map/map.json` 的 `meta.provenance.head_short = 794886b`、`generated_at = 2026-10-27T22:34:05+08:00`（滞后 2 个提交；`apps/web/**` 自 `794886b` 起零改动，实测 `git diff --stat 794886b HEAD -- apps/web` 为空） |
| 验收口径 | **问题消除 = A-01～A-11 全 PASS**；不可消除项按 §8 结构化豁免登记（E1–E8），未勾选豁免即转验收项。所有判据为**整数或精确集合**，探针为 `/tmp` 一次性命令（不新增测试/自检/CI 文件，遵守 AGENTS「测试与检查边界」） |

### 0.1 一句话需求

把 web 与后端、web 与插件之间**靠字符串和源码路径维系的隐式契约**，改为**由 `@toonflow/contracts` 单一来源提供、web 只依赖契约**的显式契约，使「接口改名 / 插件 UI 变更」从「运行期 404 或构建期静默打包」变成「编译期一处改动」。

### 0.2 与地图口径的对账（先消除歧义，再谈验收）

地图写「130 处 `/api` 字面量、7 个 `@toonflow/server` 源码契约、17 个插件/骨架运行时子路径」。本轮可复现基线如下，**以本节为准**（§6 的 A-01 等判据全部引用本表）：

| 口径 | 基线值（HEAD = `b52454e`） | 命令 |
| --- | --- | --- |
| web `/api` 字面量出现次数 | **131**（地图 130，差 1） | **§6.5 P1**（下方探针，可整块粘贴） |
| 其中：请求 URL（plain 字符串） | **107** 处 / 88 个去重文本 | 见 §6.5 P1 |
| 其中：请求 URL（模板字符串） | **22** 处 / 14 个去重模板 | P1 |
| 其中：守卫判断（`startsWith("/api/…")`） | **2** 处（`lib/i18n.ts:32`、`document/panels/document/extensions.ts:80`） | P1 |
| 其中：纯注释 | **0** 处（唯一注释行 `SaveToLibraryDialog.vue:84` 不含引号，不计入字面量） | P1 |
| web 涉及文件数 | **53**（`.ts` 18 / `.vue` 35） | P1 |
| web `/api` 第二段前缀（含守卫） | **21** 个：`desktop`17、`providers`16、`agent`13、`mcp`11、`assets`10、`settings`7、`bare`7、`skills`6、`workspaces`6、`mobileLink`5、`agents`5、`singleAgent`5、`ffmpeg`4、`nodes`4、`connection`3、`ai`3、`ext`3、`tools`2、`sessionState`2、`plugins`1、`mobile`1 | **§6.5 P2** |
| `@toonflow/server` 导入行 | **38** 行 / **30** 文件 / **7** 个去重子路径（地图「7 个」一致） | P3 |
| 其中：**值**导入（会打进 web 主包） | **10** 行 / 9 文件 | P3 |
| 其中：`import type`（构建期擦除） | **28** 行 / 22 文件 | P3 |
| 插件/骨架子路径 | **17** 个去重（地图 17 一致） | P4 |
| 其中：骨架 `*-scaffold` | 12 个去重 / 40 行 / 33 文件（值 23、类型 17） | P4 |
| 其中：具体插件（`tool-*`、`node-*`） | 5 个去重 / 12 行 / 9 文件（值 8、类型 4） | P4 |
| web 代码规模 | 176 文件 / 42,751 行（地图 42,491 行，差 260 行，属 `components.d.ts` 自动生成文件差异） | P9 |

> **130 vs 131 的解释**：地图计数可能排除了裸前缀 `/api/` 的某一次出现（如 `lib/i18n.ts:32` 的 `startsWith("/api/")`，其后不带路径）。这是**计数口径差，不是地图错误**；本需求验收一律使用 131，并在 A-01 允许以「131 → 0」为唯一期望。

### 0.3 当前实测：契约已经漂移过一次（用事实说明为何是 P0）

| 证据 | 内容 |
| --- | --- |
| 服务端产出的 URL 与 web 硬编码的判断条件**各自独立维护** | `apps/server/src/routes/nodes/get.ts:30` 产出 `url: "/api/nodes/files?name=…"`；`apps/web/src/pages/workspace/panels/canvas/index.vue:1345` 用 `node.url !== \`/api/nodes/files?name=…\`` **逐字比对**。任一侧改一个字符（如换成 `/api/nodes/file`），web 会把全部节点判为「地址无效」并在控制台打 `节点地址无效`，**编译期与类型检查均无任何提示** |
| 同类第二处 | `apps/web/src/pages/workspace/panels/document/extensions.ts:80` 校验 `url.pathname.startsWith("/api/ext/")`，与 `apps/server/src/routes/ext/list.ts:23` 的 `/api/ext/read?name=${name}` 逐字耦合 |
| 同类第三处 | `packages/toolScaffold/src/client.ts:25` 用正则 `^/api/tools/client\?name=…&version=[a-f0-9]{64}$` 校验 `apps/server/src/routes/tools/renderers.ts:9` 产出的 URL |
| 同类第四处 | `apps/web/src/lib/providerBilling.ts:126` 的 `EventSource(\`/api/ai/media/balanceEvents?accountIds=…\`)` 与 `apps/server/src/routes/ai/media/balanceEvents.ts` 的文件名生成规则耦合（SSE 长连接，漂移表现为「计费余额永不刷新」而不是报错） |
| 双事实源（运行时） | `MCP` 工具面在 `apps/server/src/modules/mcpIntegration/mcp/operations.ts` 中**手写 32 条 `path: "/api/…"`**，与 `router.ts` 的 163 条挂载点构成两套事实源；实测 32/32 全部命中（本次未漂移），但**无任何守卫**阻止下次漂移 |
| 契约承载方式 | web 消费的 7 个 `@toonflow/server/*` 子路径中，**6 个直接指向 `apps/server/src/**` 源码文件**（`package.json` 的 `exports` target 为 `.ts`），只有 `desktop` 指向 `src/types/desktop.ts` 纯类型文件。这使 web 的 `vue-tsc` 会解析服务端源码，也让 `documentFormats` / `nodeMenu` / `mentionSources` 的**值**（共 10 行导入）被编译进 web 主包 |
| 插件 UI 双轨 | 文档扩展（`ext`）与工具 UI（`tool`）**已经是**注册表 + 动态脚本加载（`extensions.ts`、`toolScaffold/src/client.ts`），但节点 UI 的部分组件与工具面板仍**静态 import**：`@toonflow/tool-browser/panel`（2 处）、`@toonflow/node-video/videoPlayer`、`@toonflow/node-text/markdownPreview`（`pages/home/exploreProcess.vue`），以及 `@toonflow/tool-canvas/runtime` 的 `canvasSchemas`（**值**导入，6 行中 2 行为值） |

> 结论：当前不是「可能会漂移」，而是「**已经把同一事实源复制到了 3 个语言/2 个进程边界上，并且靠人工逐字保持同步**」。地图把它标为 critical 是准确的。

---

## 1. 背景

### 1.1 问题原文（地图关注点）

> `c-web-console-1`（**critical**）：web 源码含 130 处 `/api` 字面量、7 个 `@toonflow/server` 源码契约与 17 个插件/骨架运行时子路径，前后端与插件契约在编译期固化。
> 建议：抽 contracts 包集中路由常量与请求/响应类型，插件 UI 改注册表动态加载。

| 关联关注点 | 严重度 | 与本需求的关系 |
| --- | --- | --- |
| `c-arch-3`（全局） | high | 同一事实的架构视角：「web 在编译期 import 插件运行时包 30 处、引用 server 源码/接口 38 处，插件与前后端契约都被静态编入主包，安装式插件无法影响 UI」 |
| `edges.e18` | strong | `web-console → server-api`，`type: api`，标签「30 文件 38 处 `@toonflow/server` 契约与 130 处 `/api` 字面调用」。**本需求的目标之一就是让该边的 `api` 依赖退化为「契约包依赖」** |
| `c-server-api-4` | high | 应用层内部 53 条深引 / 契约无运行时守卫。**本需求不处理**（见 NG6）；但 R-07 之后 `/api` 路径会成为两边共用的常量，间接降低应用层边界漂移 |
| `c-web-console-2` | high | 巨型页面（`canvas/index.vue` 1,548 行等）。**本需求不处理**（见 NG3） |

### 1.2 为什么这不是「代码不好看」，而是「一定会坏」

1. **同一份 URL 事实有 4 个副本**：`apps/server/src/routes/**` 的文件树（`core.ts` 据此生成 `router.ts`）→ `apps/server/src/modules/*/index.ts` 的 `routePrefixes`（7 处，共 21 个前缀）→ `apps/server/src/modules/mcpIntegration/mcp/operations.ts` 的 32 条手写 `path` → web 的 131 处字面量。四者**没有任何自动校验**。
2. **漂移的失败模式是静默的**：`/api/nodes/files?name=` 这类 URL 被 web 逐字比对（§0.3 第 1 条），改名后表现是「节点菜单全空 + 控制台一行 `节点地址无效`」，**不是构建失败**；`balanceEvents` SSE 改名后表现是「余额不刷新」。两者都要靠人工发现。
3. **web 的 typecheck 会解析服务端源码**：`apps/server/package.json` 的 14 个 `exports` 中 6 个 target 指向 `apps/server/src/**/*.ts`。web 的 `vue-tsc` 因此把服务端源码纳入类型图，任何服务端内部类型重构都会以「web 类型错误」的形式暴露，反之亦然——**两个模块被编译期绑死**（这正是 `c-arch-3` 的判断）。
4. **插件 UI 双轨**：`ext` 与 `tool` 的 UI 已经是动态注册表（`extensions.ts` 按 `/api/ext/list` + `<script>` 注入；`toolScaffold/client.ts` 按 `/api/tools/renderers` + `<script>` 注入），而 `tool-browser/panel`、`node-video/videoPlayer`、`node-text/markdownPreview` 仍静态 import，`tool-canvas/runtime` 的 `canvasSchemas` 甚至把**插件业务 zod schema** 打进 web 主包。同一种「插件 UI」有两套加载方式，新插件作者无法从代码判断该用哪套。

### 1.3 不可突破的约束（`AGENTS.md` + 既有架构）

| 约束 | 内容 | 对本需求的影响 |
| --- | --- | --- |
| C1 | `apps/server/package.json` 的 **14 个 `exports` target 不得变更**（桌面/移动经 `@toonflow/server/{i18n,platform,mcp,browser,desktop,app,remoteConnection,mobileLink}` 复用） | 契约迁移只能「新增 contracts 包 + 服务端保留 shim」，不能删/改既有导出 |
| C2 | 模块入口 `index.ts` ≤60 行；入口静态面不得出现 `@/modules/**` | R-07 若改服务端，只能改 `modules/*/index.ts` 的 `routePrefixes` 字面量与域文件，不新增入口依赖 |
| C3 | 「一个接口一个文件」，URL 由 `core.ts` 从文件路径生成；`bun run routes` 重新生成 `router.ts` | **`router.ts` 是生成物（163 条 `app.use`），不是事实源**；R-07 不能「手改 router.ts」来对齐常量 |
| C4 | **不新增测试/自检文件、不新增检查命令、不新增 CI 入口** | 所有一致性校验以 `/tmp` 一次性命令给出（§6.5），不落库 |
| C5 | 新建文件/文件夹必须小驼峰；禁止短横线/蛇形/帕斯卡 | `packages/contracts/src/{api,envelope,headers,index}.ts` 合规；域内子路径名亦须小驼峰 |
| C6 | 插件 UI 现状：`window.toonflowNodeHost` / `toonflowExts[id]` / `toonflowToolViews[name]` 三个宿主全局 | R-05 的注册表协议必须与三者之一对齐，**不得引入第 4 套机制** |
| C7 | 跨插件共享组件统一放 `packages/nodeShared`（`@toonflow/node-shared`） | `videoPlayer` / `markdownPreview` 的迁移目标已由规范指定，不需新造位置 |
| C8 | web 的 i18n 由 Vite 插件在构建期改写源码抽取文案 | 新增的 contracts 包**不参与** i18n transform（`/apps/web/src/` 之外的路径不改写），因此契约包内**不得含用户可见文案** |

---

## 2. 目标与非目标

### 2.1 目标（可度量，全部二值）

| 编号 | 目标 | 度量（交付态期望） |
| --- | --- | --- |
| G1 | web 源码中 `/api` 字面量归零 | 131 → **0**（含 2 处守卫判断；`plain` 107 / `tmpl` 22 / `guard` 2、`comment` 0 全部为 0） |
| G2 | 路由常量有唯一来源且可复核 | `apiRoutes` 恰好覆盖**客户端实际声明的 144 个具体路径 + 14 个模板工厂**；与服务端端点全集（**164** = 163 个挂载 + 子路径 `/api/assets/usage/batch`）双向比对：`missing_in_contracts=0`、`invented_in_contracts=0` |
| G3 | web 不再从 `@toonflow/server` 取**运行期值** | 值导入 10 → **0**；值导入全部改由 `@toonflow/formats`（已存在）或 `@toonflow/contracts` 提供 |
| G4 | web 对 `@toonflow/server` 的**纯类型**依赖收敛到「协议类型」一类 | 38 行 → **17 行**（精确：`agent/types` 14 + `singleAgent/types` 3），其余 21 行迁到 `@toonflow/contracts`；剩余 17 行**全部为 `import type`** |
| G5 | 插件 UI 至少有统一加载方式 | 插件实现类子路径 5 → **1**（`@toonflow/tool-canvas/runtime`，登记豁免 E2）；值导入行 12 → **6**；`tool-browser/panel` 与 `node-video|node-text` 的静态 import 归零 |
| G6 | 行为零变化 | `typecheck`（根）、`build`（根）、`build:web`、`build:desktop` 的静态可判定部分、§6.4 的 12 项冒烟逐条通过 |
| G7 | 结论可复检且唯一 | A-01～A-11 全部整数/精确集合；每条给探针编号、命令、期望、正控制 |
| G8 | 文档、地图、规范同源 | AGENTS 新增 contracts 包与注册表规则；`map.json` 的 `web-console.files` 增加 `packages/contracts/**` 归属登记（见 R-09） |

### 2.2 非目标（NG）

| 编号 | 非目标 | 理由 |
| --- | --- | --- |
| NG1 | 不改变任何 HTTP URL、方法、请求体、响应结构、状态码、错误文案、SSE/NDJSON 事件字段 | 桌面/移动/外部 MCP 客户端已固化 |
| NG2 | 不删除、不改名 `apps/server/package.json` 的 14 个 `exports` | 桌面/移动依赖（C1） |
| NG3 | 不拆 `canvas/index.vue`（1,548 行）、`pluginMarket/index.vue`（1,145 行）等巨型页面，不拆 Pinia store | 属 `c-web-console-2`，独立需求 |
| NG4 | 不处理应用层内部 53 条跨子模块深引 | 属 `c-server-api-4`，独立需求 |
| NG5 | 不新增测试/自检脚本/CI 入口 | C4 |
| NG6 | 不改 `core.ts` 的「文件路径 → URL」生成规则，不手改 `router.ts` | C3 |
| NG7 | 不把插件业务逻辑搬进 contracts（contracts 只放 URL 常量、信封类型、header 名、纯类型） | 保持 contracts 零运行时依赖 |
| NG8 | 不引入第 4 套插件宿主全局（沿用 `toonflowNodeHost` / `toonflowExts` / `toonflowToolViews`） | C6 |
| NG9 | 不改变插件产物格式（`build/nodes/*.umd.js`、`build/tools/*.tool.js`、`build/ext/*.umd.js` 的元数据注释结构与文件路径） | 安装态插件在用户机器上已存在，改格式会使旧插件失效 |
| NG10 | 不改 `packages/formats` 既有 5 个 exports 的 target | `@toonflow/server/{documentFormats,modelReasoning,agent/mentionSources}` 三个 shim 依赖它 |
| NG11 | 不把「探针通过」当成「实现正确」 | 探针只证明计数/集合；行为正确由 §6.4 冒烟与 code review 判定 |

### 2.3 依赖方向裁决表

| 关系 | 允许？ | 落点 | 判据 |
| --- | --- | --- | --- |
| `web-console → contracts`（值：URL 常量、header 常量） | **允许（唯一）** | `@toonflow/contracts/api`、`/headers` | A-01/A-02 |
| `web-console → formats`（值：`documentFormats`、`modelReasoning`、`mentionSources`、`nodeMenu`） | **允许** | `@toonflow/formats/*` | A-04 |
| `web-console → contracts`（类型：协议/信封） | **允许** | `@toonflow/contracts/types`、`/envelope` | A-04 |
| `web-console → server`（类型：`agent/types`、`singleAgent/types`） | **允许但冻结**（17 行，因引用了插件脚手架类型） | 不变 | A-04 |
| `web-console → server`（值） | **禁止** | 无 | A-04 |
| `contracts → formats` | 允许（同层，靠 `import type` 或纯常量） | — | A-09 |
| `contracts → server / tools-scaffold / nodes-scaffold / ext-scaffold / providers` | **禁止** | 无 | A-09（否则 contracts 从 foundation 反向依赖 domain） |
| `server → contracts` | **允许**（P1，R-07 生效时） | `modules/*/index.ts`、`mcp/operations.ts`、`routes/{nodes/get,ext/list,tools/renderers}.ts` | A-08 |
| `plugins → contracts` | 允许（P1，仅 URL 常量） | 可选 | A-08 |

> `contracts` 与 `formats` 同属 `shared-foundation` 层。**contracts 不得依赖 `@toonflow/tools-scaffold`**——它是 `agent-tools` 模块（domain 层）的一部分，反向依赖会新建 layer violation。这条约束直接决定了 G4 只能收敛到 17 行（`agent/types` 与 `singleAgent/types` 引用 `ToolCall`/`ToolDefinition`，无法下沉）。

---

## 3. 需求矩阵总表

> 优先级：P0 = 本需求不可缺项；P1 = 收口项（不阻塞「问题消除」，但阻塞「结构闭环」）。
> 难度：低 / 中 / 中高 / 高。风险按「对行为与构建产物的破坏可能」评估。

| 编号 | 阶段 | 背景 | 目标 | 描述 | 优先级 | 难度 | 风险 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **R-01** | M1 | 131 处 `/api` 字面量分散在 53 个文件、21 个前缀，无单一来源（§0.3） | 新建 `@toonflow/contracts`，成为 URL/header/信封的唯一来源 | 新建 `packages/contracts`（foundation 层）：`package.json`（`name: @toonflow/contracts`、`exports: {".", "./api", "./envelope", "./headers", "./types"}`、`typecheck` 脚本、**零 dependencies**、`peerDependencies` 无）、`tsconfig.json`；`src/api.ts` 导出 `apiBase = "/api"` 与 `apiRoutes` 常量树（按 21 个前缀分组，覆盖 **144 个具体路径 + 14 个模板工厂函数**，如 `apiRoutes.agent.message`、`apiRoutes.nodes.files(name)`）；`src/envelope.ts` 导出 `ApiResponse<T>`、`ApiErrorPayload`、`ApiCode` 联合；`src/headers.ts` 导出 4 个 header 名常量（`x-toonflow-workspace`、`x-toonflow-desktop`、`x-toonflow-mobile-link`、`x-toonflow-local-client`）与 `acceptLanguage`；`src/types.ts` **只做再导出**（`export type { … } from "@toonflow/formats/…"`），不含新类型；`src/index.ts` 显式再导出四个子模块 | P0 | 中高 | 中：常量与 `router.ts` 漂移会让 G2 假通过（由 A-07 集合比对兜住）；`apiRoutes` 变成上帝对象（由「按 21 前缀分组，每组一个文件级对象」约束） |
| **R-02** | M2 | 131 处字面量：107 plain + 22 模板 + 2 守卫，分布在 `components` 81 / `lib` 21 / `pages` 19 / `stores` 8 / `main.ts` 2 | web 侧字面量归零，全部改读常量 | 按 5 批替换（§4.2）：B1 `lib/**`（21 处 / 8 文件）→ B2 `stores/**` + `main.ts`（10 处 / 5 文件）→ B3 `pages/**`（19 处 / 6 文件）→ B4 `components/settings/**`（60 处 / 26 文件）→ B5 其余 `components/**`（21 处 / 8 文件）。守卫 2 处改为 `pathname.startsWith(apiBase + "/")` 与 `startsWith(apiRoutes.ext.base + "/")`。**URL 字符串输出逐字不变**（A-06 用双算对账） | P0 | 中高 | 高：拼错常量值 = 全站 404；模板工厂参数顺序错误 = 静默错 URL（A-06 用「替换前后 131 条 URL 全集相等」兜底） |
| **R-03** | M2 | `apps/web` 对 `@toonflow/server` 取 10 行**值**（`documentFormats` 4、`nodeMenu` 4、`mentionSources` 2、`modelReasoning` 1 → 部分重叠），使服务端源码进入 web 主包 | 值导入归零 | ① `documentFormats` / `modelReasoning` / `mentionSources` 的 7 行直接改指 `@toonflow/formats/*`（三个模块已在 `packages/formats` 存在，**零新代码**）；② `nodeMenu` 4 行（`stores/settings.ts:7`、`nodeMenuSettings.vue:126`、`nodeMenu.vue:97`、`nodeMenuItems.vue:75`）→ 把 `apps/server/src/lib/nodeMenu.ts`（98 行、零 `@/` 依赖）**逐字节复制**到 `packages/formats/src/nodeMenu.ts`，原路径改再导出 shim（与 `documentFormats` 同款）；③ 结果：server 值导入 10 → 0，`@toonflow/server/nodeMenu` 的 target **不变**（C1） | P0 | 中 | 中：`nodeMenu` 副本漂移（A-10 用 `diff` 为空判定） |
| **R-04** | M2 | 21 行纯类型从 `@toonflow/server/*` 取，其中 `desktop`（4）、`nodeMenu`（4）、`modelReasoning`（5）、`documentFormats`（4）、`agent/mentionSources`（4）属纯契约 | 类型导入迁到 contracts，剩 17 行协议类型 | ① `src/types.ts` 不再导出新类型，而是 `export type { PluginInstallRequest, PluginInstallType, updateSnapshot, DesktopRuntime } from "@toonflow/formats/desktop"`（先把 `apps/server/src/types/desktop.ts` 58 行**逐字节复制**到 formats，原路径改 shim）；② 21 行改指 `@toonflow/contracts/types` / `@toonflow/formats/*`；③ **保留不动**：`agent/types` 14 行、`singleAgent/types` 3 行（二者引用 `ToolCall`/`ToolDefinition`，属 `agent-tools` 层，不得下沉，见 §2.3） | P0 | 中 | 中：类型「结构等价但不同名」导致 web 现有类型注解失效（A-11 用 `typecheck` 兜底） |
| **R-05** | M3 | 插件实现类子路径 5 个 / 12 行 / 9 文件静态 import；而 `ext`/`tool` 已有动态注册表，形成双轨 | 插件 UI 加载方式统一，静态 import 只剩「宿主必须解析的 schema」 | ① `@toonflow/node-video/videoPlayer` + `@toonflow/node-text/markdownPreview`（各 1 行，仅 `pages/home/exploreProcess.vue`）→ 复制到 `packages/nodeShared/src/components/`，`@toonflow/node-shared` 增加两个 exports，web 改指 nodeShared（依据 C7，跨插件共享组件归 nodeShared）；② `@toonflow/tool-browser/panel`（2 行）+ `client`（2 行：`isBrowserTool`）→ `panel` 改为 `loadToolComponent("browser")` 经 `/api/tools/renderers` 动态加载（**要求** `packages/tools/browser/build.ts` 声明 `components: { browserPanel: "src/browserPanel.vue" }`，产物仍是 `browser.tool.js`，元数据 `components` 从 `[]` 变 `["browserPanel"]`）；`isBrowserTool` 移入 `@toonflow/tools-scaffold/runtime`（纯函数，1 行）；③ `@toonflow/tool-canvas/runtime` 的 `canvasSchemas` **保留静态**，登记 E2；④ 12 个骨架子路径**保留静态**，登记 E1，并冻结「12 个 / 40 行 / 33 文件」上限 | P0 | 高 | 高：`tool-browser` 的面板从「构建期固定」变「运行期按 renderers 列表加载」，装旧版 browser 工具的用户会看不到面板（NG9 的边界：仅当重新安装/重新构建插件才生效）；`components.d.ts` 自动生成文件可能被 unplugin 重新写入 |
| **R-06** | M3 | `web` 仍需消费后端产出的 URL（`/api/nodes/files?name=`、`/api/ext/read?name=`、`/api/tools/client?name=&version=`），且 web 侧**逐字校验**它们 | 生产者与消费者共用同一模板工厂 | `contracts/api.ts` 为 3 个生产者 URL 提供工厂：`nodes.files(name)`、`ext.read(name)`、`tools.client(name, version)`；`apps/server/src/routes/{nodes/get,ext/list,tools/renderers}.ts` 改为调用工厂；web 侧 `canvas/index.vue:1345`、`document/extensions.ts:80`、`toolScaffold/client.ts:25` 的正则/比对改用同一工厂（`client.ts` 属 `agent-tools` 模块，见 Q4） | P0 | 中 | 中：`tools.client` 的正则含 `[a-f0-9]{64}` 版本号约束，改写时若放松会削弱安装态校验（A-08 保留该正则并要求版本段仍为 64 位 hex） |
| **R-07** | M4 | 服务端另有 **71 处手写 `/api` 字面量**（不含 `router.ts` 生成物的 163 条）：`mcp/operations.ts` 32、`mobileLink/index.ts` 7、`pluginMarket/index.ts` 6、`routes/{tools/renderers,nodes/get,ext/list}.ts` 各 1、`app.ts` 4、`localRuntime/index.ts` 4、`agentAccess/index.ts` 4、`mediaGeneration/index.ts` 3、`platformCore/index.ts` 2、`mcp/tools.ts` 2、`remoteConnection.ts` 2、`mcpIntegration/index.ts` 1、`assetLibrary/index.ts` 1 | 两侧共用一份常量，消除「4 个副本」 | 分两类处理：① **生产者/工具面**（`operations.ts` 32 + 3 个生产者 3，共 35）改为读 `contracts/api`；② **模块 `routePrefixes`**（21 个前缀 / 7 个入口）改为读 `contracts/api` 的前缀常量；③ **中间件挂载与安全判断**（`app.ts` 4、`mobileLink` 7、`mcp/tools.ts` 2、`remoteConnection.ts` 2，共 15）按 Q5 决定；④ `router.ts` 是生成物，**不动** | P1 | 中高 | 高：`operations.ts` 是 MCP 工具面（46 个 MCP 工具），改错会让外部 MCP 客户端全部 404；`app.ts` 的 `express.raw` 挂载路径写错会让上传 100MB 上限失效 |
| **R-08** | M4 | 契约一旦两处维护就会再次漂移；现有流程无任何守卫（C4 禁止新增脚本） | 漂移可被一次性命令发现 | ① 新增 **A-07 集合比对探针**（`/tmp`：客户端声明路径 ∪ 服务端端点全集，双向差集必须为 0，且常量不得发明服务端不存在的路径）；② 新增 **A-06 URL 等价探针**（替换前快照 131 条 URL 文本 → 替换后由常量求值重算 → 逐条相等）；③ 把两条探针写进本文件 §6.5，**不落库**；④ AGENTS.md 增补「新增接口必须同时在 `contracts/api.ts` 登记」规则 | P0 | 中 | 中：探针只做「文件内联」检查，无法发现「常量存在但无人使用」（由 A-01 归零 + A-07 双向差集共同兜住） |
| **R-09** | M4 | 地图 `web-console.files = ["apps/web/**","postcss.config.ts"]`；新增 `packages/contracts` 后归属不明 | 归属登记、覆盖率不退化 | `map.json`：`web-console.files` 不变；`shared-foundation.files += ["packages/contracts/**"]`；`edges` 新增 `web-console → shared-foundation` 的契约依赖（`e23` 已存在，仅更新标签）；重算 `coverage_ratio` 与 `files_total`（`718 + 新增文件数`）；AGENTS.md 目录结构与模块表同步 | P1 | 低 | 低：漏更新会让下一轮评审以旧数据判定 |
| **R-10** | 每批 | 改动面 131 处字面量 + 38 行包导入 + 12 行插件实现导入，跨 53 + 30 + 9 个文件 | 行为零变化、可逐批回滚 | 5 个 web 批次（R-02）+ 3 个契约批次（R-01/R-03/R-04）+ 1 个插件批次（R-05）**各自独立可回滚**；每批后跑 `bun run typecheck`、`bun run --filter '@toonflow/web' build`、§6.4 冒烟中与该批相关的子集；任一失败回滚该批 | P0 | 中 | 高：同一批内 131 处替换若批量正则改写，容易把 `?` 查询参数拼接方式改错（B1–B5 每批 ≤60 处，且模板工厂逐个手写，不做正则批量替换） |
| **R-11** | M5 | 新增 1 个包会带来「文件预算」与「是否值得」的争论 | 新增文件可预算、可审计 | 冻结新增**代码文件 7 个**：`packages/contracts/src/{api,envelope,headers,types,index}.ts`（5）、`packages/formats/src/{nodeMenu,desktop}.ts`（2，均为逐字节副本）；新增**非代码文件恰好 3 个**：`packages/contracts/{package.json,tsconfig.json,readme.md}`；新增插件产物**元数据字段** 1 个（`browser.tool.js` 的 `components: ["browserPanel"]`）；**新增文件总数 = 10**。超出即视为范围变更，回评审 | P0 | 低 | 中：预算过紧会逼出「把常量塞进 web 本地文件」的妥协（那会让 G2 不可达） |

---

## 4. 需求详述

### 4.1 R-01 契约包形状

```
packages/contracts/
  package.json          # name/private/type/exports/scripts.typecheck；零 dependencies
  tsconfig.json         # extends ../../tsconfig.base.json，include ["src"]
  readme.md             # 一页说明：常量怎么加、为什么不能放业务逻辑
  src/
    api.ts              # apiBase + apiRoutes（21 组）
    envelope.ts         # ApiResponse<T> / ApiErrorPayload / ApiCode
    headers.ts          # 4 个 header 名 + acceptLanguage
    types.ts            # 只再导出 @toonflow/formats 的纯契约类型
    index.ts            # 显式再导出以上四个
```

**`apiRoutes` 的分组（21 组，与 §0.2 的前缀统计一一对应）**

| 组 | 前缀 | 静态路径数 | 模板工厂 | 说明 |
| --- | --- | --- | --- | --- |
| `desktop` | `/api/desktop` | 12 | `update(action)` | 含 `update`/`ready`/`clipboard/*`/`providerFile/*`/`saveFile`/`selectSaveFile`/`selectDirectory`/`devtools`/`plugins/install` |
| `providers` | `/api/providers` | 10 | — | `models`/`media/*`(6)/`debug/*`(2) |
| `agent` | `/api/agent` | 12 | — | 含裸 `/api/agent` |
| `mcp` | `/api/mcp` | 9 | `servers(inspect|importJson|importDxt)`、`control(path)`、`controlEvents(id)` | 注意 `/api/mcp/status` 与 `/skill` 不同源 |
| `assets` | `/api/assets` | 8 + `base` | `events(params)`、`read(params)`、`thumb(params)`、`save(query)` | `base` = `/api/assets`（`axios.create` 的 baseURL） |
| `settings` | `/api/settings` | 6 | — | 含 `personalization/get|save`、`systemPrompt` |
| `skills` | `/api/skills` | 6 | — | `list`/`read`/`move`/`order`/`create`/`save` |
| `workspaces` | `/api/workspaces` | 5 + `filesBase` | `filesThumb(params)` | `filesBase` = `/api/workspaces/files` |
| `mobileLink` | `/api/mobileLink` | 4 | — | `status`/`config`/`pairing`/`revoke` |
| `agents` | `/api/agents` | 5 | — | `a2a/get`、`a2a/save`、`connect`、`read`、`save` |
| `singleAgent` | `/api/singleAgent` | 4 | — | `control`/`create`/`toolResult`/`run` |
| `ffmpeg` | `/api/ffmpeg` | 3 | `action(name)` | `progress`/`status`/`events` |
| `nodes` | `/api/nodes` | 1 | `files(name)` | `get` + 工厂 |
| `connection` | `/api/connection` | 2 | `action(name)` | **由宿主壳提供**（`apps/desktop/src/connection.ts:82`、`apps/mobile/src/server.ts:101`），合同上仍属同一前缀 |
| `ai` | `/api/ai` | 2 | `balanceEvents(ids)` | `models`、`media/balance` |
| `ext` | `/api/ext` | 2 + `base` | — | `list`/`save`；`base` 用于守卫 |
| `tools` | `/api/tools` | 2 | — | `get`、`renderers`（工厂 `client(name,version)` 由 R-06 加） |
| `sessionState` | `/api/sessionState` | 2 | — | `get`/`patch` |
| `plugins` | `/api/plugins` | 1 | — | `export` |
| `mobile` | `/api/mobile` | 1 | — | `exports`（**由移动宿主提供**，`apps/mobile/src/server.ts:75`） |
| `pluginInstall` | 动态 | — | `install(type)`、`list(type)`、`get(type)`、`save(type)`、`action(type,action)` | 覆盖 `installPluginFile.ts:13`、`pluginMarket/index.vue:527/671/760`、`pluginConfigDialog.vue:48`、`developer/index.vue:477` 的 `\`/api/${…}\`` 拼接 |

> **两条「前缀来自宿主壳而非 server」的事实必须写进 readme**：`/api/connection*` 由桌面壳与移动壳各自挂载（`connection.router`），`/api/mobile/exports` 只在移动壳存在。web 作为同一份产物同时跑在三种宿主下，因此这些常量不能"因为 server 里没有"就被删掉——A-07 的集合比对必须把这 4 条列为**宿主豁免**（E3）。

### 4.2 R-02 的 5 个 web 批次（精确数字）

| 批次 | 范围 | 出现次数 | 文件数 | 主要形态 |
| --- | --- | --- | --- | --- |
| **B1** | `apps/web/src/lib/**` | **21**（plain 15 / tmpl 5 / guard 1） | **8** | `workspaceFiles.ts` 的 `axios.create({ baseURL })` + 4 模板、`mcpControl.ts` 的 SSE（1 模板）与 `control/${path}`、`providerBilling.ts` 的 `EventSource`、`saveFile.ts`、`clipboard.ts`（5 处）、`mobile.ts`（3）、`i18n.ts`（守卫 1）、`desktopProtocol.ts` |
| **B2** | `apps/web/src/stores/**` + `main.ts` | **10**（plain 9 / tmpl 1） | **5** | `sessionState.ts` 的两条 `const *_URL`、`desktopUpdate.ts`（1 模板）、`settings.ts`（3）、`workspace.ts`、`main.ts`（2） |
| **B3** | `apps/web/src/pages/**` | **19**（plain 11 / tmpl 7 / guard 1） | **6** | `canvas/index.vue`（3，含 2 模板 + 逐字比对）、`document/extensions.ts`（3，含守卫）、`assetLibrary/api.ts`（6：`axios.create` + 5 模板）、`workspacePicker.vue`（3）、`canvasDrop.ts`（2）、`hello/index.vue`（2） |
| **B4** | `apps/web/src/components/settings/**` | **60**（plain 52 / tmpl 8） | **26** | `pluginMarket/*`（9 文件，18 处）、`mediaModel/*`（4 文件）、`languageModel/*`（3）、`developer/*`（3 文件，9 处）、`deviceLink.vue`（4）、`personalization.vue`（4）、`mcp/index.vue`（2）、`nodeMenuSettings.vue`、`about.vue`、`systemPromptDialog.vue`、`ffmpegRequired.vue`、`installPluginFile.ts` |
| **B5** | `apps/web/src/components/{agent/**,singleAgentDialog.vue,...}` | **21**（plain 20 / tmpl 1） | **8** | `conversation.vue`（7）、`singleAgentDialog.vue`（5）、`agent/index.vue`（4）、`menu.vue`、`skillMenu.vue`、`mentionContent.vue`、`mentionThumbnail.vue`（1 模板）、`mentionSources.ts` |
| | **合计** | **131**（plain 107 / tmpl 22 / guard 2） | **53**（文件跨批重叠，去重后 53；B1∪B2 = 13 个文件不重复） | |

**唯一需要改写的注释行**：`pages/workspace/panels/assetLibrary/components/SaveToLibraryDialog.vue:84` 的 JSDoc 里嵌了原始路径 `/api/assets/import`。为让 A-02 可判为 0，该行改为「走素材导入接口（`apiRoutes.assets.import`），不再读取成 Blob 上传」。这是本次唯一一处**非代码语义**的改动。

> **不做正则批量替换**：模板字符串必须改为工厂调用（`\`/api/ffmpeg/${action}\`` → `apiRoutes.ffmpeg.action(action)`），plain 字符串必须改为常量引用。每批替换后用 A-06 的等价探针核对该批涉及的 URL 文本集合。

### 4.3 R-05 插件 UI 处置矩阵（17 → 13，逐条给去向）

| 子路径 | 值/类型 | 行数 | 文件 | 去向 | 依据 |
| --- | --- | --- | --- | --- | --- |
| `@toonflow/nodes-scaffold/{connection,nodeAi,nodeDocument,nodeEvent,nodeSkeleton,nodeTools,runtime,values,workspaceFiles}`（9） | 值 23 / 类型 6 | 33 | 28 | **保留静态**，登记 **E1** | 骨架是「宿主提供给插件的运行时」，web 是宿主；改动态会让插件无法在编译期拿到类型 |
| `@toonflow/tools-scaffold/{runtime,client}`（2） | 值 2 / 类型 4 | 6 | 5 | **保留静态**，登记 **E1**（`client.loadToolComponent` 本身就是注册表入口） | 同上 |
| `@toonflow/ext-scaffold/runtime`（1） | 值 1 / 类型 3 | 4 | 4 | **保留静态**，登记 **E1** | 同上；`defineExt` 是插件侧校验器 |
| `@toonflow/tool-canvas/runtime`（1） | 值 2 / 类型 4 | 6 | 6 | **保留静态**，登记 **E2** | `canvasSchemas` 是画布工具的业务参数 schema，web 作为画布宿主必须解析；下沉会反转插件所有权 |
| `@toonflow/tool-browser/panel`（1） | 值 2 | 2 | 2 | **改动态**：`loadToolComponent("browser")` | 工具已有注册表（`toolScaffold/client.ts`），只是 browser 没声明 `components` |
| `@toonflow/tool-browser/client`（1） | 值 2 | 2 | 2 | **迁移**：`isBrowserTool` → `@toonflow/tools-scaffold/runtime` | 1 行纯判断，属脚手架 |
| `@toonflow/node-video/videoPlayer`（1） | 值 1 | 1 | 1 | **迁移**：→ `@toonflow/node-shared/videoPlayer` | C7：跨插件共享组件归 nodeShared |
| `@toonflow/node-text/markdownPreview`（1） | 值 1 | 1 | 1 | **迁移**：→ `@toonflow/node-shared/markdownPreview` | 同上 |
| | | | | **交付：13 个子路径**（骨架 12 + `tool-canvas/runtime` 1） | |

> 交付态判据（A-05）：插件实现类子路径精确集合 = `{@toonflow/tool-canvas/runtime}`；插件实现类值导入行 = **6**（全部 `tool-canvas/runtime`：`canvasSchemas` 2 + 类型 4 中的值 2，另 4 行为类型）。
> **R-05 ②的前提条件**：`packages/tools/browser/build.ts` 当前未声明 `components`（实测 `build/tools/browser.tool.js` 元数据为 `"components":[]`），因此 `loadToolComponent("browser")` 现在拿不到组件。实施必须同时改 `build.ts` 与 `browserPanel.vue` 的导出形状（组件名需与 `tools` 字段匹配），并重新构建插件——**这是本需求唯一的「产物变化」**。

### 4.4 R-06 生产者/消费者共用工厂（当前逐字耦合的 3 处）

| 生产者 | 消费者 | 当前约束 | 改后 |
| --- | --- | --- | --- |
| `routes/nodes/get.ts:30` → `/api/nodes/files?name=${name}` | `canvas/index.vue:1345` 逐字 `!==` | 完全相同字符串 | 双方 `apiRoutes.nodes.files(name)` |
| `routes/ext/list.ts:23` → `/api/ext/read?name=${name}` | `document/extensions.ts:80` 的 `startsWith("/api/ext/")` + `?revision=` 拼接 | 前缀 + 前缀 | `apiRoutes.ext.read` 工厂 + `extensions.ts` 用 `new URL(apiRoutes.ext.read(extension.id))` 比对 origin 与 pathname |
| `routes/tools/renderers.ts:9` → `/api/tools/client?name=&version=` | `toolScaffold/src/client.ts:25` 正则 `^/api/tools/client\?name=([a-z][a-zA-Z0-9]*?)&version=([a-f0-9]{64})$` | 正则字面量 | `apiRoutes.tools.client(name, version)` + **保留** `[a-f0-9]{64}` 校验（改成对 URL 解析后的 `version` 参数做正则） |

### 4.5 R-08 一致性探针（不落库）

| 探针 | 作用 | 期望 |
| --- | --- | --- |
| **P5（A-07）** | 客户端声明路径（web + MCP 工具面 + 插件包）与服务端端点全集双向比对 | `consumed_paths=144`、`server_endpoints=164`、`consumed_in_server=138`、`consumed_not_in_server=6`（**精确 6 条 = 3 个 baseURL 前缀 + 3 条宿主端点**，见 E3）、`invented_in_contracts=0` |
| **P6（A-06）** | 替换前 URL 文本快照（131 条）→ 替换后常量求值重算 | 两集合逐条相等；`diff=0` |
| **P7（A-09）** | `packages/contracts/src/**` 的 import 目标 | 只允许 `@toonflow/formats/**` 与包内相对路径；`0` 条指向 `@toonflow/{tools-scaffold,nodes-scaffold,ext-scaffold,providers,server}` |
| **P8（A-10）** | `nodeMenu` / `desktop` 副本 vs 旧路径 | `diff` 为空（3 个文件：`nodeMenu`、`desktop`，加 `formats` 既有的 3 个） |
| **P9** | 规模核对 | `apps/web` 176 文件 / 42,751 行（基线）；`packages/contracts` 5 个代码文件 |

---

## 5. 里程碑与精确期望

| 里程碑 | 内容 | 关键期望 | 交付门 |
| --- | --- | --- | --- |
| **M0** | 基线冻结（本轮，零代码改动） | web 字面量 **131**（plain 107 / tmpl 22 / guard 2 / comment 0）、文件 53、前缀 21；server 导入 38 行 / 30 文件 / 7 子路径（值 10 / 类型 28）；插件子路径 17（骨架 12 / 实现 5）；web 176 文件 / 42,751 行 | 本文件 §0.2 全表可复现（P1–P4、P9） |
| **M1** | R-01 建 `packages/contracts`（只加不改） | 新增代码文件 5；`contracts` typecheck exit 0；web 字面量**仍为 131**（证明只加不改）；A-09 PASS | A-07 在 M1 即可跑（`missing_in_contracts` 允许 >0，仅记录） |
| **M2** | R-03 + R-04（值/类型迁移）+ R-02 的 B1/B2 | server 值导入 **0**；server 总导入 **17**（全 `import type`）；web 字面量 131 → **100**（B1 21 + B2 10） | `bun run typecheck` exit 0；`build:web` exit 0 |
| **M3** | R-02 的 B3/B4/B5 + R-05 + R-06 | web 字面量 → **0**；插件实现类子路径 → **1**（`tool-canvas/runtime`）；插件值导入 → **6** | A-01/A-03/A-05/A-06/A-07 PASS；§6.4 冒烟 S-04/S-07/S-09 |
| **M4** | R-07 + R-08 + R-09 | 服务端手写字面量 71 → **15**（Q5=B 默认；Q5=A → 36、Q5=C → 0）；`map.json` 归属更新；`coverage_ratio=1.0` | A-08 PASS；A-07 双向差集为 0 |
| **M5** | 终验 | A-01～A-11 全 PASS；§6.4 12 项冒烟逐条 PASS；豁免表填满 | 全量判据 + 审查通过 |

---

## 6. 验收标准

### 6.1 二值判定表（A-01～A-11）

| 编号 | 判据 | 探针 | 期望（唯一值 / 精确集合） | 正控制 |
| --- | --- | --- | --- | --- |
| **A-01** | web 源码 `/api` 字面量归零 | P1 | `occ=0 req=0 plain=0 tmpl=0 guard=0 comment=0 files=0` | M0 实测 `occ=131 req=129 plain=107 tmpl=22 guard=2 comment=0 files=53` |
| **A-02** | `apiBase` 是 web 唯一入口 | P1b | 含 `/api/` 的行数 = **0**（该口径同时覆盖注释、字符串与正则，且不会误伤外部域名 `https://api.toonflow.net`，因为它是 `/api.` 不是 `/api/`）；使用 `apiBase`/`apiRoutes` 的文件数 ≥ **40**（下界，证明常量真的被用而不是被删功能） | M0：`grep -rn "/api/" apps/web/src --include='*.ts' --include='*.vue' \| wc -l` = **132**（131 字面量 + 1 注释行 `SaveToLibraryDialog.vue:84`） |
| **A-03** | 前缀覆盖完整 | P2 | 交付态 `prefixes=0`（因全部走常量）；M0 快照 `21` 个前缀逐一在 `apiRoutes` 中存在（集合比对 21/21） | M0 前缀列表（§0.2） |
| **A-04** | web 对 server 的依赖面收缩 | P3 | `server_lines=17 files=16 specs=2 value=0 type=17`；`specs` 精确 = `{@toonflow/server/agent/types, @toonflow/server/singleAgent/types}` | M0 `38 / 30 / 7 / 10 / 28` |
| **A-05** | 插件实现类子路径收敛 | P4 | `impl_specs=1`（= `@toonflow/tool-canvas/runtime`）、`impl_lines=6`、`impl_value=2`、`impl_type=4`；骨架 `scaffold_specs=12`、`scaffold_lines=40`、`scaffold_files=33`（**不得增长**） | M0 `impl_specs=5 impl_lines=12 impl_value=8`；`scaffold 12/40/33` |
| **A-06** | URL 文本零变化 | P6 | 替换前 131 条 URL 文本集合 == 替换后由常量求值的集合；`diff=0`。模板工厂的参数顺序与 URL 编码位置逐一核对（**恰好 2 个**模板含 `encodeURIComponent`：`ai.balanceEvents` 与 `mcp.controlEvents`） | 探针自身用 M0 快照做输入，M0 时 `diff=0` 成立 |
| **A-07** | 常量与服务端端点一致（无遗漏、无发明） | P5 | `contract_paths=144`、`missing_in_contracts=0`、`invented_in_contracts=0`、`server_endpoints=164`、`router_mounts=163`、`consumed_not_in_server=6` | M0 `contract_paths=0`（包不存在）；M1 允许 `missing_in_contracts>0`（只加不改阶段） |
| **A-08** | 服务端手写字面量收敛 | P4 | 三个候选值，**由评审在 §10 的 Q5/Q6 选定其一**：Q5=A → `handwritten=36`；**Q5=B（默认）→ `handwritten=15`**；Q5=C → `handwritten=0`。且 `generated_router=163` 恒定（`router.ts` 为生成物，不计入） | M0 `handwritten=71 generated=163` |
| **A-09** | contracts 零外部依赖 | P7 | `contracts_imports_outside_formats=0`；`contracts_package_dependencies=0` | M0 包不存在 → 先判存在（不存在即 FAIL，不得判"无异常"） |
| **A-10** | 副本无漂移 | P8 | `nodeMenu` 与 `desktop` 的副本与旧路径 `diff` 为空；旧路径仍为再导出 shim 且 `@toonflow/server/{nodeMenu,desktop}` 的 target 未变 | M0 旧文件存在（2/2） |
| **A-11** | 行为零变化 | §6.4 + 构建 | `bun run typecheck` exit 0；`bun run build` exit 0；`bun run --filter '@toonflow/web' build` exit 0；12 项冒烟 **12/12**；`apps/server/package.json` 的 14 个 exports target 与 M0 逐字相等 | M0 同命令（`typecheck` 无 bun 环境时以「实施报告 + 审查复核」为准，见 §7 R-6） |

### 6.2 判定规则

1. 只有 PASS / FAIL；不接受「基本通过」「趋势良好」「≤ / 约 / 含…或…」。
2. 期望必须是整数或精确集合；计数类判据用**两种独立算法**各算一次，相等才 PASS（`grep` 与 Python 解析）。
3. **不可达即回评审**：实施中发现某期望不可达（例如常量与 `router.ts` 天然不一致、某插件产物无法声明 components），**不得就地放宽**，回需求评审修订本表。
4. 豁免前置：任何未在 §8 登记的项，一律计入判据分子。
5. 相位：A-01～A-11 在 **M5 交付态**判定；M0 只作正控制与基线记录。
6. `router.ts` 是生成物：任何以「手改 `router.ts` 达成 A-07」的实现方式判 FAIL（同时违反 C3）。

### 6.3 探针（P1–P9，`/tmp` 一次性执行，不落库）

```bash
# P1 web `/api` 字面量（A-01 / A-02）
cd "$ROOT"
python3 - <<'PY'
import os,re
WEB="apps/web/src"
files=sorted([os.path.join(b,n) for b,d,f in os.walk(WEB) for n in f if n.endswith((".ts",".vue"))])
lit=re.compile(r'(["\'\`])(/api/[^"\'\`$\n]*)')
occ=req=guard=plain=tmpl=comment=0; fl=set()
for f in files:
    for line in open(f,encoding="utf-8").read().splitlines():
        s=line.strip(); hits=list(lit.finditer(line))
        if not hits: continue
        if s.startswith(("//","*","/*")): comment+=len(hits); continue
        for m in hits:
            occ+=1; fl.add(f)
            if "startsWith(" in line: guard+=1
            else:
                req+=1; plain += m.group(1)!="`"; tmpl += m.group(1)=="`"
print(f"occ={occ} req={req} plain={plain} tmpl={tmpl} guard={guard} comment={comment} files={len(fl)}")
PY
# M0 期望：occ=131 req=129 plain=107 tmpl=22 guard=2 comment=0 files=53
# M5 期望：occ=0 req=0 plain=0 tmpl=0 guard=0 comment=0 files=0
```

```bash
# P1b 任一形态的 `/api/` 残留（A-02，比 P1 更严：含注释、字符串、正则）
grep -rn "/api/" apps/web/src --include='*.ts' --include='*.vue' | wc -l   # M0=132  M5=0
grep -rl "apiRoutes\|apiBase" apps/web/src --include='*.ts' --include='*.vue' | wc -l   # M0=0  M5>=40
# 说明：用 `/api/`（带尾斜杠）而不是 `/api`，避免把外部域名 https://api.toonflow.net 误判；
#       M0 的 132 = 131 字面量 + 1 纯注释行
```

```bash
# P2 前缀分布（A-03）
cd "$ROOT"
python3 - <<'PY'
import os,re,collections
WEB="apps/web/src"
files=sorted([os.path.join(b,n) for b,d,f in os.walk(WEB) for n in f if n.endswith((".ts",".vue"))])
lit=re.compile(r'(["\'\`])(/api/[^"\'\`$\n]*)')
pref=collections.Counter()
for f in files:
    for line in open(f,encoding="utf-8").read().splitlines():
        s=line.strip()
        if s.startswith(("//","*","/*")): continue
        for m in lit.finditer(line):
            t=re.sub(r'\$\{.*','',m.group(2)).split("?")[0]
            pref[(t.split("/")[2] if len(t.split("/"))>2 else "") or "(bare)"]+=1
print("prefixes",len(pref)); print(" ".join(f"{k}={v}" for k,v in pref.most_common()))
PY
# M0：prefixes=21
#     desktop=17 providers=16 agent=13 mcp=11 assets=10 settings=7 (bare)=7 skills=6 workspaces=6
#     mobileLink=5 agents=5 singleAgent=5 ffmpeg=4 nodes=4 connection=3 ai=3 ext=3
#     tools=2 sessionState=2 plugins=1 mobile=1
#     注：(bare)=7 是 `/api/` 后直接接模板变量的裸前缀（`/api/${type}/install` 等 5 处
#        + `/api/` 守卫 1 处 + 1 处 `/api/` 前缀拼接），由 A-01/A-02 统一归零
# M5：prefixes=0
```

```bash
# P3 web 对 @toonflow 包的导入口径（A-04 / A-05）
cd "$ROOT"
python3 - <<'PY'
import os,re
WEB="apps/web/src"
files=sorted([os.path.join(b,n) for b,d,f in os.walk(WEB) for n in f if n.endswith((".ts",".vue"))])
pat=re.compile(r'^\s*(import|export)\s+(type\s+)?(.*?)from\s*["\'](@toonflow/(?:server|nodes-scaffold|tools-scaffold|ext-scaffold|tool-browser|tool-canvas|node-text|node-video)[^"\']*)["\']')
srv=[];scaf=[];impl=[]
for f in files:
    for i,line in enumerate(open(f,encoding="utf-8").read().splitlines(),1):
        m=pat.match(line)
        if not m: continue
        spec=m.group(4); typ=bool(m.group(2)) or bool(re.match(r'^\s*type\b',m.group(3) or ""))
        rec=(f,i,spec,"type" if typ else "value")
        if spec.startswith("@toonflow/server"): srv.append(rec)
        elif any(spec.startswith("@toonflow/"+p) for p in ("nodes-scaffold","tools-scaffold","ext-scaffold")): scaf.append(rec)
        else: impl.append(rec)
for name,rows in (("server",srv),("scaffold",scaf),("plugin_impl",impl)):
    print(f"{name}: lines={len(rows)} files={len({r[0] for r in rows})} specs={len({r[2] for r in rows})} "
          f"value={len([r for r in rows if r[3]=='value'])} type={len([r for r in rows if r[3]=='type'])}")
print("server_specs:",sorted({r[2] for r in srv}))
print("impl_specs:",sorted({r[2] for r in impl}))
PY
# M0：server 38/30/7/10/28 ; scaffold 40/33/12/23/17 ; plugin_impl 12/9/5/8/4
# M5：server 17/16/2/0/17 ; scaffold 40/33/12/23/17 ; plugin_impl 6/6/1/2/4
```

```bash
# P4 服务端 `/api` 字面量（A-08；router.ts 为生成物，单列）
cd "$ROOT"
python3 - <<'PY'
import os,re
SRC="apps/server/src"; lit=re.compile(r'(["\'\`])(/api/[^"\'\`$\n]*)')
tot=0;files=0;gen=0
for b,d,f in os.walk(SRC):
    for n in f:
        if not n.endswith(".ts"): continue
        p=os.path.join(b,n); c=len(lit.findall(open(p,encoding="utf-8").read()))
        if c:
            tot+=c; files+=1
            if p.endswith("/router.ts"): gen=c
print(f"server_occ={tot} files={files} generated_router={gen} handwritten={tot-gen}")
PY
# M0：server_occ=234 files=16 generated_router=163 handwritten=71
# M5：Q5=A → 36 ; Q5=B（默认）→ 15 ; Q5=C → 0
```

```bash
# P5 客户端声明路径 vs 服务端端点全集 的双向差集（A-07）
cd "$ROOT"
python3 - <<'PY'
import os,re
SRC="apps/server/src"
# ① 服务端端点全集 = router.ts 的 app.use 挂载 ∪ 各路由文件的子路径
src=open(f"{SRC}/router.ts",encoding="utf-8").read()
imp=dict((m.group(1),m.group(2)) for m in re.finditer(r'import (route\d+) from "(\./routes/[^"]+)"',src))
mounts={m.group(2):m.group(1) for m in re.finditer(r'app\.use\("(/api[^"]*)", (route\d+)\)',src)}
ep=set(mounts.values())
pat=re.compile(r'(?:router|Router\(\))\.(get|post|put|delete|patch|all)\(\s*"([^"]*)"')
for var,base in mounts.items():
    for m in pat.finditer(open(os.path.join(SRC,imp[var]+".ts"),encoding="utf-8").read()):
        p=m.group(2); ep.add(base if p in ("/","") else base+("" if p.startswith("/") else "/")+p)
# ② 客户端声明路径（web 字面量 + baseURL 相对段 + MCP 工具面 + 插件包）
def statics(files):
    out=set()
    for f in files:
        for line in open(f,encoding="utf-8").read().splitlines():
            s=line.strip()
            if s.startswith(("//","*","/*")): continue
            for m in re.finditer(r'(["\'\`])(/api/[^"\'\`$\n]*)',line):
                v=m.group(2)
                if "$" in v or "startsWith(" in line or v.endswith("/"): continue
                out.add(v.split("?")[0])
    return out
web=[os.path.join(b,n) for b,d,f in os.walk("apps/web/src") for n in f if n.endswith((".ts",".vue"))]
wp=statics(web)
for base,f in [("/api/workspaces/files","apps/web/src/lib/workspaceFiles.ts"),
               ("/api/assets","apps/web/src/pages/workspace/panels/assetLibrary/api.ts")]:
    for s in set(re.findall(r'client\.(?:get|post|put|delete|patch)(?:<[^>]*>)?\(\s*"(/[^"]*)"',open(f,encoding="utf-8").read())):
        wp.add("/api/workspaces/clone" if s=="/clone" else base+s)
ops={m.group(1) for m in re.finditer(r'path:\s*"(/api[^"]*)"',open(f"{SRC}/modules/mcpIntegration/mcp/operations.ts",encoding="utf-8").read())}
plug=set()
for b,d,f in os.walk("packages"):
    d[:]=[x for x in d if x!="node_modules"]
    for n in f:
        if n.endswith((".ts",".vue")): plug|=statics([os.path.join(b,n)])
consumed=wp|ops|plug
HOST={"/api/connection/connection","/api/connection/disconnect","/api/mobile/exports"}
BASES={"/api/assets","/api/workspaces","/api/workspaces/files"}
print("router_mounts",len(mounts),"server_endpoints",len(ep))
print("web_paths",len(wp),"ops",len(ops),"plugins",len(plug),"consumed",len(consumed))
print("consumed_in_server",len(consumed&ep),"consumed_not_in_server",len(consumed-ep),
      "host_or_base",len((consumed-ep)&(HOST|BASES)))
print("missing",sorted(consumed-ep))
PY
# M0 实测：router_mounts=163 server_endpoints=164 web_paths=120 ops=32 plugins=16
#          consumed=144 consumed_in_server=138 consumed_not_in_server=6 host_or_base=6
# M1：contracts 包刚建立，允许 consumed_not_in_server 里有未登记项（仅记录）
# M5 期望：consumed_not_in_server 精确 = 6，且全部落在 HOST ∪ BASES；
#          contracts 中不得出现 HOST/BASES 之外「服务端不存在的路径」（invented=0）
```

```bash
# P6 URL 文本等价（A-06）：替换前快照 vs 替换后求值
cd "$ROOT"
python3 - <<'PY'
import os,re,json,collections
WEB="apps/web/src"
files=sorted([os.path.join(b,n) for b,d,f in os.walk(WEB) for n in f if n.endswith((".ts",".vue"))])
lit=re.compile(r'(["\'\`])(/api/[^"\'\`$\n]*)')
now=[]
for f in files:
    for i,line in enumerate(open(f,encoding="utf-8").read().splitlines(),1):
        s=line.strip()
        if s.startswith(("//","*","/*")): continue
        for m in lit.finditer(line): now.append(m.group(2))
print("literal_url_texts",len(now),"distinct",len(set(now)))
PY
# M0：literal_url_texts=131 distinct=103（提交前把该集合存为 /tmp/url_baseline.json）
# M5：literal_url_texts=0；由常量求值重算出的集合必须与基线 103 条去重文本逐条相等
```

```bash
# P7 contracts 的外部依赖（A-09）
cd "$ROOT"
if [ -d packages/contracts/src ]; then
  echo "== 外部 @toonflow 依赖（只允许 @toonflow/formats）=="
  grep -rhoE 'from "@toonflow/[^"]+"' packages/contracts/src | sed 's/.*"@toonflow\///;s/\/.*//' | sort -u
  echo "== 依赖字段（期望 0 行）=="
  grep -c '"dependencies"' packages/contracts/package.json || true
  echo "== 代码文件数（期望 5）=="
  find packages/contracts/src -name '*.ts' | wc -l
else
  echo "contracts_package_absent"
fi
# M0 期望：contracts_package_absent（包不存在 → 先判存在，不存在即 A-09 记 FAIL，不得判"无异常"）
# M5 期望：外部依赖列表恰好一行 `formats`；dependencies 0；代码文件 5
```
```bash
# P8 纯契约副本一致性（A-10）
# 说明：documentFormats / modelReasoning / mentionSources 已在 2fda44f 下沉，基准取该提交的父提交；
#       nodeMenu / desktop 是本次新下沉，基准取当前 HEAD（b52454e）。
cd "$ROOT"
for pair in \
  "2fda44f^:apps/server/src/lib/documentFormats.ts apps/server/src/lib/documentFormats.ts documentFormats" \
  "2fda44f^:apps/server/src/lib/modelReasoning.ts apps/server/src/lib/modelReasoning.ts modelReasoning" \
  "2fda44f^:apps/server/src/lib/mentionSources.ts apps/server/src/lib/mentionSources.ts mentionSources" \
  "b52454e:apps/server/src/lib/nodeMenu.ts apps/server/src/lib/nodeMenu.ts nodeMenu" \
  "b52454e:apps/server/src/types/desktop.ts apps/server/src/types/desktop.ts desktop"; do
  set -- $pair; base=$1; shim=$2; name=$3
  if [ -f "packages/formats/src/$name.ts" ]; then
    git show "$base" | diff - "packages/formats/src/$name.ts" >/dev/null && echo "$name IDENTICAL" || echo "$name DIFF"
  else
    echo "$name ABSENT"
  fi
  grep -q 'from "@toonflow/formats' "$shim" 2>/dev/null && echo "$name SHIM_OK" || echo "$name NOT_SHIM"
done
# M0：documentFormats/modelReasoning/mentionSources = IDENTICAL + SHIM_OK；nodeMenu/desktop = ABSENT + NOT_SHIM
# M5：5/5 IDENTICAL + SHIM_OK
```
```bash
# P9 规模（R-11 预算）
cd "$ROOT"
python3 - <<'PY'
import os
CODE={".ts",".tsx",".js",".jsx",".mjs",".cjs",".mts",".cts",".vue",".sql",".ets",".java",".kt",".kts",".cs",".cpp",".h",".hpp",".m",".mm"}
def scan(root,extra=None):
    n=loc=0
    for b,d,f in os.walk(root):
        d[:]=[x for x in d if x!="node_modules"]
        for x in f:
            if os.path.splitext(x)[1] in CODE:
                n+=1; loc+=len(open(os.path.join(b,x),encoding="utf-8",errors="ignore").read().splitlines())
    if extra:
        n+=1; loc+=len(open(extra,encoding="utf-8").read().splitlines())
    return n,loc
print("web",scan("apps/web","postcss.config.ts"))
print("contracts",scan("packages/contracts"))
PY
# M0：web (176, 42751) ; contracts (0,0)
# M5：web (176, ~42751) ; contracts (5, >=120)
```

### 6.4 冒烟矩阵（12 项，全部走 HTTP 层验证「URL 未变」）

> 全部 fixture 放 `/tmp`，执行后删除。启动方式沿用既有做法：`cd apps/server && TOONFLOW_DATA_DIR=$TMP bun src/index.ts`。

| # | 场景 | 请求 | 二值断言 |
| --- | --- | --- | --- |
| **S-01** | 设置读写（`stores/settings.ts` 改用常量） | `GET /api/settings/get`、`PUT /api/settings/save` | 均 HTTP 200 且 `code=200` |
| **S-02** | 会话状态（`stores/sessionState.ts` 的两个 `const *_URL`） | `GET /api/sessionState/get`、`PATCH /api/sessionState/patch` | 均 HTTP 200；`get` 返回 `code=200` |
| **S-03** | 工作区文件（`workspaceFiles.ts` 的 `baseURL` + 10 个相对段） | `GET /api/workspaces/files/list?directory=<ws>&path=` | HTTP 200；`data.directory` 与 `<ws>` 的 `realpath` 相等 |
| **S-04** | 素材库（`assetLibrary/api.ts` 的 `baseURL` + 15 个相对段） | `GET /api/assets/list?library=project&directory=<ws>` | HTTP 200；`code=200` |
| **S-05** | 节点列表与脚本 URL（R-06 工厂） | `GET /api/nodes/get` | 每个 `item.url` 精确等于 `/api/nodes/files?name=<item.name>`（用常量求值比对，**不允许**用「包含 `name=`」等模糊判定） |
| **S-06** | 扩展列表与脚本 URL（R-06 工厂 + 守卫） | `GET /api/ext/list` | 每个 `item.url` 精确等于 `/api/ext/read?name=<name>`；web 侧守卫仍放行（URL 的 `pathname` 以 `/api/ext/` 开头） |
| **S-07** | 工具渲染器（R-06 工厂 + 64 位 hex 校验） | `GET /api/tools/renderers` | 每条 `url` 匹配 `^/api/tools/client\?name=[a-z][a-zA-Z0-9]*&version=[a-f0-9]{64}$`（M0 与 M5 正则相同） |
| **S-08** | Agent 流式（`components/agent/**` 的 13 处） | `POST /api/agent`（fixture 供应商） | HTTP 200、`Content-Type: application/x-ndjson; charset=utf-8`、首行 `type=session`、末行 `type=done`、`type=error` 行数 0 |
| **S-09** | 工作区越界（不变式） | `GET /api/workspaces/files/list?directory=<ws>&path=../etc` | HTTP 400；body 精确 `{"code":400,"data":null,"message":"文件路径无效"}` |
| **S-10** | FFmpeg SSE（`EventSource`） | `GET /api/ffmpeg/events` | HTTP 200 且 `Content-Type: text/event-stream`（15s 内收到首个事件或保持连接） |
| **S-11** | 计费 SSE（`providerBilling.ts`） | `GET /api/ai/media/balanceEvents?accountIds=` | HTTP 200 且 `Content-Type: text/event-stream` |
| **S-12** | 宿主契约与 exports | ① `GET /packages/contracts/src/api.ts` 不存在于产物；② `apps/server/package.json` 的 exports | ① `build/web` 内不含 `packages/contracts/src/api.ts` 的源文件路径字符串；② 14 个 export 的 key 与 target 与 M0 **逐字相等** |

### 6.5 计数台账（L01–L12，只作记录，不作验收结论）

| # | 项 | M0 | M1 | M2 | M3 | M4 | M5 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| L01 | web `/api` 出现次数 | 131 | 131 | 100 | 0 | 0 | 0 |
| L02 | 其中 plain / tmpl / guard | 107/22/2 | 107/22/2 | 83/16/1 | 0/0/0 | 0/0/0 | 0/0/0 |
| L03 | 涉及文件数 | 53 | 53 | 40 | 0 | 0 | 0 |
| L04 | 前缀数 | 21 | 21 | 17 | 0 | 0 | 0 |
| L05 | `@toonflow/server` 导入行 | 38 | 38 | 17 | 17 | 17 | 17 |
| L06 | 其中值导入 | 10 | 10 | 0 | 0 | 0 | 0 |
| L07 | 插件实现类子路径 | 5 | 5 | 5 | 1 | 1 | 1 |
| L08 | 插件实现类值导入行 | 8 | 8 | 8 | 2 | 2 | 2 |
| L09 | 骨架子路径 / 行 / 文件 | 12/40/33 | 12/40/33 | 12/40/33 | 12/40/33 | 12/40/33 | 12/40/33 |
| L10 | 服务端手写字面量 | 71 | 71 | 71 | 71 | 15（Q5=B） | 15（Q5=B） |
| L11 | `contracts` 代码文件 | 0 | 5 | 5 | 5 | 5 | 5 |
| L12 | 新增文件总数 | 0 | 8 | 8 | 10 | 10 | 10 |

> L01 的 M2 期望 = 131 − 31（B1 21 + B2 10）= **100**；M3 期望 = 100 − 100（B3 19 + B4 60 + B5 21）= **0**。**分项不许「下降即可」**。
> L03 的 M2 期望 = 53 − 13（B1∪B2 不重复文件数）= **40**；L04 的 M2 期望 = 21 − 4（B1 的 `ai`/`connection`/`mobile`/`plugins`？实测被消除的 4 个前缀为 `ai`、`connection`、`mobile`、`sessionState`）= **17**。

> 批次归属按文件路径前缀判定（`lib/`→B1、`stores/`+`main.ts`→B2、`pages/`→B3、`components/settings/`→B4、其余 `components/`→B5），可机械复算（§6.3 P2 的分批变体）。

### 6.6 与既有验收的关系

- 本需求**不覆盖** `c-web-console-2`（巨型组件）：`canvas/index.vue` 在 B3 中只改 3 处 URL，不拆文件；行数变化上限 **±5 行**（改常量后通常 0 变化）。
- 本需求**不覆盖** `c-arch-4`（应用层深引）。
- 若 R-07 被 §10 裁决为「不做」，A-08 期望变为 `handwritten=71`（服务端零改动），且 E4 的范围需扩大到 21 处 `routePrefixes` 并一并勾选同意；否则本需求只能判「问题部分消除」。

---

## 7. 风险与缓解

| # | 风险 | 影响 | 概率 | 缓解 | 判据 |
| --- | --- | --- | --- | --- | --- |
| R1 | 常量值拼错（131 处里任何一处） | 该功能 404，用户可见 | 中 | A-06 的 URL 文本等价探针（替换前后逐条比对）；每个 web 批次后跑该批次的 URL 子集 | A-06 |
| R2 | 模板工厂参数顺序/编码方式改变 | 查询参数错位（例：`?path=` 与 `?directory=` 互换） | 中 | 8 个含 `encodeURIComponent` 的模板逐一人工核对；A-06 要求 `encodeURIComponent` 位置不变 | A-06 |
| R3 | `apiRoutes` 变成上帝对象（144 条路径 + 14 个工厂） | 可维护性下降，替代了旧问题 | 中 | 按 21 个前缀分组为 21 个子对象，每组集中在一段注释下；`api.ts` 预期 ≤ 400 行 | E5 登记上限 |
| R4 | `browser` 工具改动态加载后，旧安装实例无面板 | 用户界面缺失（非崩溃） | 高（若采纳 R-05②） | `loadToolComponent` 返回 `undefined` 时回退到「无面板」并保持对话可用；`browser.tool.js` 元数据 `components` 为空时 `messageList.vue` 不渲染 `<browserPanel>` | §6.4 S-07 + 人工验证 |
| R5 | web 类型迁移后 `vue-tsc` 报「结构相同但名义不同」 | 构建失败 | 中 | 迁移用「改 import 路径，不改类型名」的最小改动；A-11 兜底 | A-11 |
| R6 | 本环境无 `bun`/`node`，无法亲自跑 typecheck/build | 结论可信度下降 | 高 | 需求阶段只给「实施后必须由实施方执行并贴输出」；审查阶段以「静态逐点核对 + 已有构建产物存在」为替代证据，并在 §10 显式登记该限制 | A-11 |
| R7 | `map.json` 归属未更新 | 下轮评审以旧数据判定 | 中 | R-09 逐条列 glob；A-07 之外另做「`map.json` 是否含 `packages/contracts/**`」的存在性检查 | R-09 |
| R8 | 常量与服务端端点天然无法 100% 对齐（3 条宿主端点 + 3 个 baseURL 前缀） | A-07 的期望被质疑 | 中 | 把这 6 条写进 E3 结构化豁免，并让探针输出 `consumed_not_in_server=6` 作为**唯一允许的非零** | A-07 |

---

## 8. 豁免判定与结构化豁免（E1–E8）

### 8.1 判定标准（满足任一即申请）

1. 消除需改变对外契约（HTTP/包导出/宿主行为/插件产物格式）；
2. 消除需超出本需求范围（跨模块/跨包/改宿主壳）；
3. 消除引入的风险或复杂度高于收益，且已有可执行替代缓解。

### 8.2 候选豁免（供评审勾选；未勾选视为驳回 → 转验收项）

| ID | 关联 | 内容 | 未消除的理由 | 替代缓解（可执行） | 复核触发 |
| --- | --- | --- | --- | --- | --- |
| **E1** | R-05 | **12 个骨架子路径保留静态 import**（`nodes-scaffold` 9、`tools-scaffold` 2、`ext-scaffold` 1；40 行 / 33 文件） | 骨架不是插件，是「宿主提供给插件的运行时库」；web 就是宿主。改动态会让插件在编译期拿不到类型，等于废掉脚手架的价值 | ① 冻结计数 `12/40/33` 不得增长；② `toonflowNodeHost`/`toonflowExts`/`toonflowToolViews` 三个全局保持不变（C6）；③ 新增骨架子路径需登记 | 任一项增长；或出现第 4 套宿主全局 |
| **E2** | R-05 | **`@toonflow/tool-canvas/runtime` 保留静态**（6 行 / 6 文件，值 2 行 `canvasSchemas`） | `canvasSchemas` 是画布工具的业务参数 zod schema；web 作为画布宿主必须用它解析 agent 传来的工具调用。下沉到 contracts 会反转插件所有权（contradicts NG7），下沉到 formats 会让 foundation 依赖 zod | ① 冻结 6 行不变；② 只允许 `canvasSchemas` 与类型被导入（`0` 条其他值导出，白名单见 §8.3） | 出现第 3 个值导出（如 `canvasOperations`）时重评 |
| **E3** | R-01/R-08 | **6 条声明路径不在服务端端点全集内**：3 条宿主端点 `/api/connection/connection`、`/api/connection/disconnect`、`/api/mobile/exports`；3 个 baseURL 前缀 `/api/assets`、`/api/workspaces`、`/api/workspaces/files` | 前三条由 `apps/desktop/src/connection.ts:82` 与 `apps/mobile/src/server.ts:101/75` 挂载（属 `desktop-shell`/`mobile-shell`）；后三条是 `axios.create({ baseURL })` 的既有用法（`assetLibrary/api.ts:7`、`workspaceFiles.ts:9`、`workspaceFiles.ts:51`），它们本身不是端点而是拼接基址 | ① A-07 的 `consumed_not_in_server` 精确等于 `6`，且 `host_or_base=6`（6 条全部落在 HOST ∪ BASES）；② 这 6 条在 `contracts/api.ts` 用 `hostOwned` / `baseUrlOnly` 注释标明来源；③ web 侧行为不变 | 宿主壳新增 `/api/*` 路由、或新增第三个 baseURL 客户端时 |
| **E4** | R-07 | **服务端 15 处中间件挂载与安全判断保留手写**：`app.ts` 4（`express.raw` 2、`express.json` 1、`desktopRequest` 1）、`mobileLink/index.ts` 7（含小写比较 `/api/mobilelink/pair`）、`mcp/tools.ts` 2、`remoteConnection.ts` 2（拼 `active.url`） | 这些不是「客户端调用 URL」，而是**服务端自身的路由分组与前缀判断**；小写比较与外部 URL 拼接无法用常量表达，改成常量会让原本刻意的 `toLowerCase()` 语义丢失 | ① 71 的拆分固定为 **35（生产者 3 + `mcp/operations.ts` 32，Q5 消除）+ 21（7 个入口的 `routePrefixes`）+ 15（本豁免保留：`app.ts` 4 + `mobileLink` 7 + `mcp/tools.ts` 2 + `remoteConnection.ts` 2）**，Q5=B 下 A-08 期望 `handwritten=15`；② 每条保留项加 `ACT:` 注释说明为何手写 | 安全判断新增分支时 |
| **E5** | R-01 | **`apiRoutes` 允许长到 144 条路径 + 14 个工厂（≈158 个键）** | URL 常量天然多；拆包会让「唯一来源」变成 5 个来源 | 按 21 前缀分组；`api.ts` 行数上限 400；readme 给出「新增接口 = 加一行常量 + 一行 `router.ts` 挂载」的固定动作 | `api.ts` > 400 行时拆分 |
| **E6** | NG3 | **`canvas/index.vue`（1,548 行）等巨型组件不拆** | 属 `c-web-console-2`，独立需求 | 本需求对该文件只允许「URL 替换 ±5 行」 | 出现结构性重写时 |
| **E7** | G4 | **17 行 `@toonflow/server` 协议类型保留**（`agent/types` 14、`singleAgent/types` 3） | 二者引用 `ToolCall`/`QuestionRequest`（`@toonflow/tools-scaffold`，属 `agent-tools` 模块）。contracts 在 foundation，下沉会新建 layer violation（§2.3） | ① 冻结 17 行 / 2 个子路径；② 全部为 `import type`（构建期擦除，不进程主包）；③ 若未来 `tools-scaffold` 归位 foundation，再迁移 | 出现第 3 个 server 子路径时 |
| **E8** | NG9 | **插件产物格式不改**（除 `browser.tool.js` 的 `components` 元数据） | 用户机器上已安装旧版本插件，改格式会使它们失效 | 只新增 `components` 元数据字段，且格式与 `mediaGeneration`/`canvas` 等既有工具一致（`string[]`） | 需要改产物结构时 |

### 8.3 E2 的白名单（可直接核对）

```
@toonflow/tool-canvas/runtime 允许被 web 导入的符号（精确）：
  canvasSchemas        （值）
  CanvasContext        （类型）
  CanvasToolCall       （类型）
  其他一律不允许（尤其 canvasOperations / 任何 handler）
```

---

## 9. 待评审决策点（Q1–Q8，均有默认值）

| # | 决策 | 选项 | 默认 | 理由 |
| --- | --- | --- | --- | --- |
| **Q1** | 契约放在哪 | **A 新建 `packages/contracts`** / B 并入 `packages/formats` / C 放在 `apps/web/src/lib` 本地文件 | **A** | B 会让 formats 承载「HTTP 语义」，与其「文件/模型格式」定位冲突，且 formats 有 5 个既有 exports 不宜扩张；C 无法被服务端与插件复用，等于把「4 个副本」变成「5 个副本」 |
| **Q2** | 插件 UI 收敛程度 | A 全部改动态（含骨架）/ **B 分类处置：骨架保留、共享组件进 nodeShared、工具面板走 renderer 注册表** / C 只做 nodeShared 迁移 | **B** | A 会让插件在编译期失去类型且需重写 3 个脚手架；C 不解决 `tool-browser/panel` 的双轨问题 |
| **Q3** | `@toonflow/server` 的协议类型（17 行） | **A 保留并冻结（E7）** / B 把 `tools-scaffold` 的类型下沉到 foundation 后迁移 | **A** | B 是一次跨模块的层级调整，超出本需求范围 |
| **Q4** | `toolScaffold/client.ts` 是否改 | **A 改（它在 `agent-tools` 模块内，但本就是 web 消费的客户端入口）** / B 不改，只在 web 侧对齐 | **A** | 不改的话 `/api/tools/client?name=&version=` 仍有一处手写正则（`c-arch-3` 未闭环）；改的话只有 1 个文件、1 条常量 |
| **Q5** | R-07 服务端收敛范围 | A 只做「生产者 3 + `mcp/operations.ts` 32」= 消除 35 / **B 再加上 7 个模块的 `routePrefixes` 21 处 = 消除 56** / C 连中间件挂载一起 = 消除 71（含 E4 撤回） | **B** | A 不够（`routePrefixes` 仍是第 3 个副本）；C 会把 `toLowerCase()` 的安全判断改坏 |
| **Q6** | A-08 的期望值（与 Q5 联动，二者必须一致） | A `handwritten=36`（Q5=A） / **B `handwritten=15`（Q5=B）** / C `handwritten=0`（Q5=C） | **B** | 期望值必须由 Q5 唯一决定，避免「期望值随实施漂移」；71 = 35（生产者+工具面）+ 21（`routePrefixes`）+ 15（中间件与安全判断） |
| **Q7** | `browser` 工具是否改动态 | **A 改（R-05②）** / B 不改（把 `tool-browser/panel` 也登记为 E2 类豁免） | **A** | 不改则「插件 UI 注册表」只覆盖 ext/tool 两类中的 tool 的部分，问题未闭环 |
| **Q8** | 是否允许修改插件产物元数据 | **A 允许新增 `components` 字段** / B 不允许（则 Q7 只能选 B） | **A** | 与既有 `canvas`/`mediaGeneration` 工具的 `components` 机制完全一致，不构成新格式 |

---

## 10. 评审意见栏

> 使用方式：评审逐条填写。未填写的 Q 项按 §9 默认值执行；未勾选的豁免视为驳回（转验收项）。

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

### 10.3 决策点裁决（Q1–Q8）

| Q | 默认值 | 评审裁决（采纳默认 / 改选，改选请写明） |
| --- | --- | --- |
| Q1 契约包位置 | A 新建 `packages/contracts` |  |
| Q2 插件 UI 收敛程度 | B 分类处置 |  |
| Q3 server 协议类型 17 行 | A 保留并冻结 |  |
| Q4 `toolScaffold/client.ts` | A 改 |  |
| Q5 R-07 范围 | B（含 `routePrefixes`，消除 56、保留 15） |  |
| Q6 A-08 期望值 | B `handwritten=15` |  |
| Q7 `browser` 工具改动态 | A 改 |  |
| Q8 允许改插件元数据 | A 允许 |  |

### 10.4 豁免裁决（E1–E8）

| 豁免 | 结论（同意 / 驳回→转验收项） | 说明 |
| --- | --- | --- |
| E1 12 个骨架子路径保留静态 |  |  |
| E2 `tool-canvas/runtime` 保留静态 |  |  |
| E3 6 条宿主/baseURL 路径 |  |  |
| E4 服务端 15 处中间件/安全判断 |  |  |
| E5 `apiRoutes` 144+14 键 |  |  |
| E6 巨型组件不拆 |  |  |
| E7 17 行 server 协议类型 |  |  |
| E8 插件产物仅加 `components` |  |  |

### 10.5 验收勾选（汇总）

| 分组 | 条目 | 结论 |
| --- | --- | --- |
| 契约归零 | A-01、A-02、A-03 | ☐ PASS ☐ FAIL |
| 依赖收缩 | A-04、A-05、A-09 | ☐ PASS ☐ FAIL |
| URL 与挂载一致 | A-06、A-07、A-08 | ☐ PASS ☐ FAIL |
| 副本与行为 | A-10、A-11 | ☐ PASS ☐ FAIL |

### 10.6 其他意见（不限格式）

```

```

---

## 11. 附录：基线清单（M0，可逐条复算）

### A. web `/api` 字面量按文件分布（53 文件 / 131 处）

| 文件 | 处数 | 备注 |
| --- | --- | --- |
| `components/agent/conversation.vue` | 7 | |
| `components/settings/panels/pluginMarket/skillEditorDialog.vue` | 6 | |
| `pages/workspace/panels/assetLibrary/api.ts` | 6 | `axios.create` baseURL + 5 模板 |
| `components/settings/panels/developer/providerDebugDialog.vue` | 5 | |
| `components/settings/panels/pluginMarket/mcpServers.vue` | 5 | |
| `components/singleAgentDialog.vue` | 5 | |
| `lib/clipboard.ts` | 5 | 同一 URL 重复 3 次 |
| `components/agent/index.vue` | 4 | |
| `components/settings/panels/deviceLink.vue` | 4 | |
| `components/settings/panels/personalization.vue` | 4 | 两对 get/save |
| `components/settings/panels/pluginMarket/index.vue` | 4 | 3 处模板拼接 |
| 其余 42 个文件 | 各 1–3 | 完整清单见 §6.3 P1 的输出 |

### B. 14 个模板（B1–B5 必须逐一手写工厂）

| # | 模板 | 位置 | 工厂 |
| --- | --- | --- | --- |
| 1 | `` `/api/desktop/update/${nextAction}` `` | `stores/desktopUpdate.ts:117` | `desktop.update(action)` |
| 2 | `` `/api/ffmpeg/${action}` `` | `pluginMarket/ffmpeg.vue:229` | `ffmpeg.action(name)` |
| 3 | `` `/api/mcp/servers/${mode}` `` | `mcpImportForm.vue:169` | `mcp.servers(mode)` |
| 4 | `` `/api/mcp/control/${path}` `` | `lib/mcpControl.ts:78` | `mcp.control(path)` |
| 5 | `` `/api/mcp/control/events?connectionId=${encodeURIComponent(id)}` `` | `lib/mcpControl.ts:163` | `mcp.controlEvents(id)` |
| 6 | `` `/api/connection/${action}` `` | `lib/mobile.ts:72` | `connection.action(name)` |
| 7 | `` `/api/ai/media/balanceEvents?accountIds=${encodeURIComponent(g)}` `` | `lib/providerBilling.ts:126` | `ai.balanceEvents(ids)` |
| 8 | `` `/api/workspaces/files/thumb?${params}` `` | `lib/workspaceFiles.ts:162` | `workspaces.filesThumb(params)` |
| 9 | `` `/api/assets/events?${params}` `` | `assetLibrary/api.ts:161` | `assets.events(params)` |
| 10 | `` `/api/assets/thumb?${params}` `` | `assetLibrary/api.ts:370` | `assets.thumb(params)` |
| 11 | `` `/api/assets/read?${params}` `` ×2 | `assetLibrary/api.ts:376,381`；`mentionThumbnail.vue:39` | `assets.read(params)` |
| 12 | `` `/api/assets/save?${query}` `` | `assetLibrary/api.ts:416` | `assets.save(query)` |
| 13 | `` `/api/nodes/files?name=${name}` `` ×2 | `canvas/index.vue:1292,1345` | `nodes.files(name)` |
| 14 | `` `/api/${type===…}/install` `` 等 5 处插件族拼接 | `installPluginFile.ts:13`、`pluginMarket/index.vue:527,671,760`、`pluginConfigDialog.vue:48`、`developer/index.vue:477` | `pluginInstall.install/list/get/save/action(type)` |

### C. 引用本文件的产物

- 需求矩阵索引：`./INDEX-2026-10.md`
- 方案文档（评审通过后）：`../2_requirements_solutions/<yyyy-MM-dd-hh-mm>-webConsoleContractDecoupling.md`
- 验证报告（实施后）：`../3_test_results/<yyyy-MM-dd-hh-mm>-webConsoleContractDecoupling-impl.md`
