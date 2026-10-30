# 需求矩阵 · web 前后端与插件契约解耦（contracts 包 + 插件 UI 注册表）· 第 3 版

> 本版是**第 2 轮评审打回后的重做**。打回意见 4 条全部属于「判据结构缺陷」，不是数字微调，因此本版**重建了验收判据的构造方式**，而不是在旧表上改数。四条意见的逐条处置见 §0.2。

## 0. 文档元信息

| 项 | 内容 |
| --- | --- |
| 文档编号 | **REQ-2026-10-28-03** |
| 版本 | 第 3 版。**替代** REQ-2026-10-28-02 的判据体系（第 2 版的 R-01/R-02/R-05/R-06/R-07/R-08/R-09/R-10/R-11/R-12 需求意图保留，凡与之冲突的数字与判据以本版为准） |
| 需求来源 | `.easyvibe/map/map.json` → `modules[web-console].health.concerns[0]`（`c-web-console-1`，**critical**）；`health.concerns[1]`（`c-web-console-2`，high，本需求**不处理**）；派生 `edges` 的 `web-console → server-api`（`type: api`） |
| 需求标题 | 抽 `@toonflow/contracts` 集中路由常量与请求/响应类型；web `/api` 字面量归零；web 对 `@toonflow/server` 的**值依赖归零**；插件 UI 改注册表动态加载；插件包内 `/api` 字面量归零；修复基线类型检查红灯 |
| 影响模块 | **`web-console`（主）**；派生：`shared-foundation`（新增 `packages/contracts`、`packages/formats` 增 `nodeMenu`/`desktop`）、`server-api`、`agent-tools`、`workflow-nodes`、`canvas-extensions`、`media-toolkit` |
| 需求类型 | 结构性重构（契约治理）。**不改变任何 HTTP URL、方法、请求/响应结构、状态码、错误文案、插件产物格式、磁盘格式、构建产物路径** |
| 优先级 | **P0**（地图 critical；且基线已有可复现的类型检查失败，见 §0.3） |
| 当前状态 | **待评审**。本轮只产出需求文档与索引，业务代码零改动 |
| 编写人 | 需求分析 agent（harness 规则正文 2.1 执行者） |
| 编写时间 | 2026-10-28 16:00 |
| 基线 | `git HEAD = 1342529`（工作区对 `apps` / `packages` / `compat` 干净：`git status --porcelain apps packages compat` 输出为空） |
| 环境 | `bun 1.3.11`、`node v24.21.0`、`vue-tsc 6.0.3`。本轮**实跑**了 web/root typecheck、`vite build`（含 `--sourcemap` 产物）、以及 §7 全部基线探针 |

### 0.1 一句话需求

把 web、后端与插件三方之间**靠字符串和源码路径维系的隐式契约**，改为**由 `@toonflow/contracts` 单一来源提供**的显式契约，使「接口改名 / 插件 UI 变更」从「运行期 404 或构建期静默打进主包」变成「编译期一处改动」。

### 0.2 第 2 轮打回意见的逐条处置（**本版的核心变更**）

| # | 打回意见 | 根因（本轮已复现） | 第 3 版处置 | 落点 |
| --- | --- | --- | --- | --- |
| 1 | **A-07 以 144 路径对 164 端点求 `missing=0` 不可达** | 第 2 版的 `contract_paths=144` 是「web 120 + ops 32 + plugins 16 去重」的**消费侧**集合，`164` 是**服务端端点**集合。两个集合按不同口径构造（前者去重后含 baseURL 前缀与守卫字符串，后者含未被任何客户端调用的端点），因此 `missing=0` 在当时是**靠口径巧合**得到的，任何一条路径的展开方式变化都会翻转结论；而 `144 ≠ 164` 时写 `missing=0` 也无法自证 | **改为单一口径宇宙 R**：`E`（服务端端点 164）∪ `HOST`（宿主壳端点 4）= `R`（168）。客户端声明集合 `D` 也**全部解析到同一形态**（静态字面量 + baseURL 拼接 + 路径模板按受控域展开 + MCP operations），`D=161`。判据写成三条独立可测的等式：`D ⊆ R`（`missing=0`）、`D ∩ R = 161`、`R ∖ D` **精确等于 7 个具名残留**（§2.4）。**不再出现 `144` 这个数** | §2.4、§5.1 A-07、§7 P7 |
| 2 | **A-14 在字面量归零后判据坍缩** | 第 2 版的判据是「产物去重路径 ∖ web 源码声明路径 = 插件来源」。当 web 字面量归零后，该式的左项只由插件贡献、右项变成空集，等式**恒真**——它测的是「两集合之差」，不是「产物里有没有插件契约」 | **改为来源归因（provenance）判据**：用 `vite build --sourcemap` 的 `sources` / `sourcesContent`，统计**来源文件位于 `packages/**` 且内容含 `/api` 字面量**的 `(file, path)` 对。判据 = `pkg_origin_paths = 0` 且 `pkg_origin_files = 0`；M0 正控制 = `12 / 4`（§7 P15）。该判据与 web 侧字面量是否归零**完全解耦**，且带非零正控 | §5.1 A-14、§7 P15 |
| 3 | **R-04 的 21 行与所列 11 行矛盾** | 第 2 版 R-04 写「21 行纯类型改指」，但表里只列了 11 行类型；实际 `21 = 10 行值 + 11 行类型`，而「值迁移」在 R-03 里，R-04 的标题却写成「21 行纯类型」。**同一句话混用了两个集合** | **拆成两条需求 + 两个判据**：**R-04a 值迁移 = 10 行 / 10 文件 / 4 子路径**；**R-04b 类型迁移 = 11 行 / 10 文件 / 4 子路径**；合计 **21 行 / 19 文件**（交叠 1 文件 = `stores/settings.ts`）。另列**冻结 17 行 / 16 文件 / 2 子路径**（E7）。行级清单见 §3.2 | §3.2、§5.1 A-04 |
| 4 | **请求/响应类型集中缺判据** | 第 2 版只有一句「`src/types.ts` 再导出 formats 的类型」，没有任何计数或集合判据，无法判定「集中」是否发生 | **新增 R-09 + 5 条判据**（A-15～A-19），全部整数或精确集合：信封声明 42→0、内联信封泛型 39→0、R 域未标注调用点 30→0、`ReqSet`（22 个共享写端点）的请求类型 0→22、8 个重复响应载荷类型 web 本地声明 8→0 且定义分歧 2→0。基线逐项实测定量见 §3.4 | §3.4、§5.1 A-15～A-19、§7 P16～P20 |

### 0.3 本轮独立复算：基线相对第 2 版的变化

第 2 版基线为 `b52454e`；本轮 HEAD 前移 3 个提交（`02ac8d8`、`c74b610`、`1342529`），其中 `1342529` 改动了 `apps/server/src/routes/assets/reveal.ts` 与多处 web/packages 文件。**所有数字本轮重测**，与第 2 版不一致处如下（其余一致）：

| 口径 | 第 2 版 | 本轮实测 | 原因 |
| --- | --- | --- | --- |
| HEAD | `b52454e` | **`1342529`** | 3 个新提交 |
| 服务端 `/api` 字面量总数 | 234 | **235** | 新增 `routes/assets/reveal.ts` 一行 |
| 　其中手写（不含 `router.ts`） | 71 | **72** | 同上 |
| 　服务端端点全集 | 164 | **164**（不变） | 新路由已在旧计数内 |
| 新增宿主端点 `connect` | 未计 | **+1**（`/api/connection/connect`） | `remoteConnection.ts:128` |
| 客户端声明路径（去重） | 144 | **161**（新口径，见 §2.4） | 口径重建 |
| web 规模 | 175 文件 / 42,742 行 | **175 文件 / 42,758 行** | 期间提交改动 |
| `TfResponse` 等外部信封 | 未区分 | **单列 1 处（`lib/tf.ts`）并豁免 E11** | 指向外部站点，不属本应用 API |

**仍在基线确认的既有红灯（与第 2 版一致，非本轮引入）**：

| 命令 | 结果 |
| --- | --- |
| `cd apps/web && bun x vue-tsc --noEmit` | **exit 2**，恰 1 条：`../server/src/modules/agentAccess/singleAgent/types.ts(2,33): error TS2307: Cannot find module '@/agentRuntime' or its corresponding type declarations.` |
| `bun run typecheck`（根） | **exit 2**（唯一失败为 `@toonflow/web`，其余 workspace exit 0） |
| `cd apps/web && bun x vite build` | exit 0（构建不经过类型检查，坏契约不阻断构建） |

### 0.4 口径对账表（本版权威基线，全部 A 判据只引用此表）

| # | 口径 | 基线值（HEAD = `1342529`） | 探针 |
| --- | --- | --- | --- |
| 1 | web `/api` 字面量出现次数 | **131**（`plain 109` + `tmpl 22`） | P1 |
| 2 | 　其中守卫判断（`startsWith` / `pathname`） | **2**（`lib/i18n.ts:32`、`document/extensions.ts:80`） | P1 |
| 3 | 　涉及文件数 | **53** | P1 |
| 4 | 　含 `/api/` 的**行**数（含 1 行注释） | **132** | P2 |
| 5 | 　注释行 | **1**（`SaveToLibraryDialog.vue:84`） | P2 |
| 6 | 　固定前缀（静态字面量） | **20** | P3 |
| 7 | 　参数化路径族（`${}` 位于路径段） | **9**（install / save / get\|list / setEnabled\|uninstall / desktop.update / connection / mcp.control / mcp.servers / ffmpeg） | P3 |
| 8 | 　查询串模板（`${}` 位于 `?` 之后） | **11** 处 | P3 |
| 9 | web 静态去重路径 | **88** | P4 |
| 10 | baseURL 相对段展开路径 | **26**（`assetLibrary/api.ts` 15 + `workspaceFiles.ts` 10 + `/api/workspaces/clone` 1） | P4 |
| 11 | **W**（web 声明路径，含模板展开） | **150** | P4 |
| 12 | 插件/骨架包内 `/api` 字面量 | **19 处 / 6 文件**（静态去重 **14** + 查询串模板 **2**） | P8 |
| 13 | MCP operations 的 `path` 条数 | **32** | P9 |
| 14 | **D**（客户端声明路径并集，去 baseURL 基址） | **161** | P7 |
| 15 | **E**（服务端端点路径） | **164** | P6 |
| 16 | **HOST**（web 声明但宿主壳挂载） | **4** | P7 |
| 17 | **R** = `E ∪ HOST` | **168** | P7 |
| 18 | **D ∖ R**（missing） | **0** | P7 |
| 19 | **R ∖ D**（residual） | **7**（具名，§2.4） | P7 |
| 20 | web 对 `@toonflow/server` 导入 | **38 行 / 30 文件 / 7 子路径**（值 **10** / 类型 **28**） | P5 |
| 21 | 插件/骨架包子路径导入 | **17 子路径**（骨架 12 / 实现 5）；行 **52**（值 31 / 类型 21） | P5 |
| 22 | 　骨架 12 子路径 | **40 行 / 33 文件 / 值 23 / 类型 17** | P5 |
| 23 | 　实现 5 子路径 | **12 行 / 9 文件 / 值 8 / 类型 4** | P5 |
| 24 | 服务端 `/api` 字面量（`router.ts` 单列） | **235 = 163（生成物）+ 72（手写）** | P10 |
| 25 | 手写 72 的分解 | operations **32** + routePrefixes **21** + 中间件 **15** + 生产者 routes **3** + `core.ts` 生成模板 **1** | P10 |
| 26 | 信封形状声明（`code` + `data`） | **43 处 / 27 文件**；内部 **42/26**，外部 `lib/tf.ts` **1** | P16 |
| 27 | 　其中内联 axios 泛型 | **39** | P16 |
| 28 | 　其中本地别名 | **4**（`ApiResponse`、`DocumentResponse`、`Envelope`、`TfResponse`） | P16 |
| 29 | axios 调用点 | **107** = 内联信封泛型 **39** + 其他内联泛型 **20** + 命名泛型 **15** + **无泛型 33** | P17 |
| 30 | 　无泛型中落在 R 域内 | **30 处 / 20 文件**（另 3 处：2 处动态 `url` 变量、1 处外部遥测 URL） | P17 |
| 31 | 共享端点 `S`（web ∩ MCP ops） | **32** | P18 |
| 32 | 　其中写方法（`S_mut`） | **22** | P18 |
| 33 | web ∩ server 同名类型声明 | **11**（**6 定义相同 / 5 定义分歧**） | P19 |
| 34 | 　其中「响应载荷类型」子集 | **8**（分歧 **2**：`AssetListOptions`、`ModelsHidden`） | P19 |
| 35 | 产物中 `/api` 去重路径 | **107**（434 个 `.js`） | P15 |
| 36 | **产物来源归因**：`packages/**` 中含 `/api` 字面量的来源文件 | **4 文件 / 12 路径** | P15 |
| 37 | web 主包内 `packages/**` 来源文件数（去重，含 `.json`） | **58**（其中 `locales/*` 29、代码 29） | P15 |
| 38 | 宿主壳 `/api` 字面量（仅记录，不在验收范围） | desktop **12** / mobile **5** | P14 |
| 39 | web 规模 | **175 文件 / 42,758 行** | P21 |
| 40 | web typecheck / root typecheck / vite build | **exit 2 / exit 2 / exit 0** | P13 |

## 1. 背景

### 1.1 问题原文（地图关注点）

> `c-web-console-1`（**critical**）：web 源码含 130 处 `/api` 字面量、7 个 `@toonflow/server` 源码契约与 17 个插件/骨架运行时子路径，前后端与插件契约在编译期固化。
> 建议：抽 contracts 包集中路由常量与请求/响应类型，插件 UI 改注册表动态加载。

> `c-web-console-2`（high）：巨型页面（`canvas/index.vue` 1,545 行等）与 8 个 Pinia store 交织。**本需求不处理**（NG3）。

| 关联关注点 | 严重度 | 与本需求的关系 |
| --- | --- | --- |
| 地图全局 `c-arch-3` | high | 「web 编译期 import 插件运行时包、引用 server 源码/接口……安装式插件无法影响 UI」 |
| `edges`：`web-console → server-api`（`type: api`） | strong | 交付后该边的契约描述应改为「17 处纯协议类型 + 契约包常量」 |

### 1.2 为什么现在做（三条递进理由，均已实测）

1. **漂移的失败模式是静默的**：`routes/nodes/get.ts:30` 产出 `` `/api/nodes/files?name=${name}` ``，`canvas/index.vue:1345` 用 `!==` 逐字比对同一模板；`document/extensions.ts:80` 用 `startsWith("/api/ext/")` 与 `routes/ext/list.ts:23` 逐字耦合；`toolScaffold/src/client.ts:31` 把 `/api/tools/client?name=...&version=[a-f0-9]{64}` 写成正则。任一侧改一个字符，表现是「功能静默失效」，编译期与类型检查都不会提示。
2. **插件契约已实质进入主包**：实测 `vite build --sourcemap` 后，产物中有 **4 个 `packages/**` 来源文件 / 12 条 `/api` 路径**（`nodeAi.ts` 8、`browserPanel.vue` 2、`toolsScaffold/client.ts` 1、`ffmpeg/browser.ts` 1）。主包含 **58** 个 `packages/**` 来源文件（去重后）。
3. **类型契约已经在报错**：web 的 `vue-tsc` 在 HEAD 上 **exit 2**，唯一错误是 web 解析服务端源码时命中的 `@/agentRuntime` 别名。构建不经过类型检查，红灯被日常流程掩盖。

### 1.3 不可突破的约束（已核对到源码）

| 编号 | 约束 | 核对结果 | 对本需求的影响 |
| --- | --- | --- | --- |
| C1 | `apps/server/package.json` 的 **14 个 exports 键与 target 不得变更** | 实测恰 14 键：`app`、`remoteConnection`、`desktop`、`platform`、`documentFormats`、`nodeMenu`、`modelReasoning`、`mcp`、`mobileLink`、`browser`、`agent/types`、`singleAgent/types`、`agent/mentionSources`、`i18n` | 只能「新增 contracts + 服务端留 shim」，不得删改既有导出 |
| C2 | 模块入口 `index.ts` ≤60 行；入口静态面不得出现 `@/modules/**` | AGENTS 模块入口条款 | R-07 只改 `routePrefixes` 字面量与域文件，不动入口依赖结构 |
| C3 | 「一个接口一个文件」，URL 由 `core.ts` 从文件路径生成 | `core.ts:46` 生成 `` app.use("/api" + routePath) `` | **`router.ts` 是生成物**，禁止手改，只能用 `bun run routes` 重生成 |
| C4 | 不新增测试/自检文件、不新增检查命令、不新增 CI 入口 | AGENTS「测试与检查边界」 | 所有一致性校验以 `/tmp` 一次性命令给出 |
| C5 | 新建文件/文件夹用小驼峰 | AGENTS 第 7/9/10/12 条 | `packages/contracts/src/{api,envelope,headers,types,index}.ts` 合规 |
| C6 | 插件 UI 宿主全局仅 `toonflowNodeHost` / `toonflowExts` / `toonflowToolViews`（另有 `toonflowToolHost` 运行时共享对象） | 实测 `toolScaffold/src/client.ts:13` | R-05 必须复用 `loadToolComponent`，不得引入第 4 套机制 |
| C7 | 跨插件共享组件统一放 `packages/nodeShared`（现 9 个 exports，**无** `videoPlayer`/`markdownPreview`） | 实测 `packages/nodeShared/package.json` | 迁移目标已定，需新增 2 个 exports |
| C8 | web 的 i18n 由 Vite 插件在构建期改写 `apps/web/src` 源码抽取文案 | `apps/web/vite.config.ts` 使用 `@toonflow/i18n/vite` | contracts 在 `apps/web/src` 之外，**不参与** transform → 契约包内不得含用户可见文案 |
| C9 | 使用其他 workspace 包必须在其 `package.json` 声明依赖并经包名 imports | AGENTS 跨包依赖条款 | web 当前**未声明** `@toonflow/formats` / `@toonflow/contracts`，`node_modules/@toonflow/{formats,contracts}` **均无软链**；R-03 必须先接线 + `bun install` |
| C10 | 插件产物由 `createToolConfig` 生成 `build/tools/<name>.tool.js`，`components` 元数据取自 build.ts | 实测 `packages/toolScaffold/index.ts:12-31`；`packages/tools/canvas/build.ts:17` 已有 `components` 用法 | R-05② 沿用既有 `components` 机制，**不新增格式** |

## 2. 目标与非目标

### 2.1 目标（全部可二值判定，数字全部来自 §0.4）

| 编号 | 目标 | 交付态度量 |
| --- | --- | --- |
| G1 | web 源码 `/api` 字面量归零 | 131 → **0**；含 `/api/` 行 132 → **0** |
| G2 | 路由常量唯一来源，且**与服务端端点集合同一口径可对账** | `D=161`、`R=168`、`D ∖ R = 0`、`R ∖ D` 精确 = 7 个具名残留（§2.4） |
| G3 | web 不再取 server 的**运行期值** | 值导入 10 → **0**（R-04a 10 行清零） |
| G4 | web 对 server 的依赖收敛为纯协议类型 | 38 行 / 30 文件 / 7 子路径 → **17 行 / 16 文件 / 2 子路径**，全部 `import type` |
| G5 | 插件 UI 有统一加载方式 | 实现类子路径 5 → **1**（`tool-canvas/runtime`，E2）；实现类值行 8 → **2**；`tool-browser/panel`、`node-video`、`node-text` 静态 import 归零 |
| G6 | 插件包内 `/api` 字面量归零，主包不再含插件契约 | `packages/**` 19 → **0**；产物中 `packages/**` 来源的 `/api` 路径 **12 → 0**、来源文件 **4 → 0** |
| G7 | 请求/响应类型集中，且有硬判据 | 信封声明 42 → **0**；内联信封泛型 39 → **0**；无泛型 axios 33 → **1**（外部遥测，E12）；`ReqSet` 22 端点请求类型 0 → **22**；8 个重复载荷类型 web 本地声明 8 → **0**、定义分歧 2 → **0** |
| G8 | 行为零变化且**类型检查真正变绿** | root `typecheck` exit **0**（含 web）；web `vite build` exit 0；§6.3 冒烟 **12/12** |
| G9 | 文档/地图/规范同源 | AGENTS 增补 contracts 与注册表规则；`map.json` 把 `packages/contracts/**` 归 `shared-foundation`，更新 `web-console` 的 `review_note` 与 e18 标签、`files_total` |

### 2.2 非目标

| 编号 | 非目标 | 理由 |
| --- | --- | --- |
| NG1 | 不改任何 HTTP URL、方法、请求体、响应结构、状态码、错误文案、SSE/NDJSON 字段 | 桌面/移动/外部 MCP 客户端已固化 |
| NG2 | 不删改 `apps/server/package.json` 的 14 个 exports | C1 |
| NG3 | 不拆 `canvas/index.vue`（1,548 行）等巨型页面、不拆 Pinia store | `c-web-console-2`，独立需求 |
| NG4 | 不处理应用层内部深引 | 独立需求 |
| NG5 | 不新增测试/自检脚本/CI 入口 | C4 |
| NG6 | 不改 `core.ts` 的 URL 生成规则，不手改 `router.ts` | C3 |
| NG7 | contracts 只放 URL 常量、信封类型、header 名、纯协议类型，零运行时依赖 | 保持 foundation 层无出边 |
| NG8 | 不引入第 4 套插件宿主全局 | C6 |
| NG9 | 不改插件产物结构（`build/tools/*.tool.js` 元数据键、`build/nodes/*.umd.js`、`build/ext/*.umd.js`） | C10；只允许 browser 工具**新增既有 `components` 字段的取值** |
| NG10 | 不改 `packages/formats` 既有 5 个 exports 的 target | `@toonflow/server/{documentFormats,modelReasoning,agent/mentionSources}` 的 shim 依赖它 |
| NG11 | 不把「探针通过」当成「实现正确」 | 探针只证计数/集合；行为由冒烟与 code review 判 |

### 2.3 依赖方向裁决表

| 关系 | 允许？ | 落点 | 判据 |
| --- | --- | --- | --- |
| `web → contracts`（值：URL、header、信封、请求/响应类型） | **允许（唯一来源）** | `@toonflow/contracts/{api,envelope,headers,types}` | A-01/A-03/A-15/A-16/A-18/A-19 |
| `web → formats`（值：`documentFormats`、`modelReasoning`、`mentionSources`、`nodeMenu`） | **允许**（需先加依赖，C9） | `@toonflow/formats/*` | A-04 |
| `web → server`（类型：`agent/types`、`singleAgent/types`） | **允许但冻结**（17 行） | 不变 | A-04、E7 |
| `web → server`（值） | **禁止** | 无 | A-04 |
| `server → contracts` | **允许** | 3 个生产者 routes、`mcp/operations.ts`、7 个 `routePrefixes` | A-08 |
| `plugins/scaffold → contracts` | **允许**（仅 URL 常量） | `nodeAi`、`browserPanel`、`questionCard`、`comfyMonitor`、`ffmpeg/browser`、`toolScaffold/client` | A-12 |
| `contracts → formats` | 允许（同层；`import type` 或纯常量） | — | A-09 |
| `contracts → server / tools-scaffold / nodes-scaffold / ext-scaffold / providers` | **禁止** | 无 | A-09 |

> `contracts` 与 `formats` 同属 `shared-foundation`。`agent/types` 与 `singleAgent/types` 引用 `ToolCall`/`ToolDefinition`/`QuestionRequest`（来自 `@toonflow/tools-scaffold`，属 `agent-tools` 域），下沉会新建 layer violation —— **这就是 G4 只能到 17 行的原因**。

### 2.4 契约宇宙的精确定义（A-07 的唯一口径）

> 本节是打回意见 #1 的结构性修复。所有集合都由探针输出，不是估算。

| 符号 | 含义 | 构造方式（探针） | 基线值 |
| --- | --- | --- | --- |
| **E** | 服务端端点路径集合 | 从 `router.ts` 取 163 条 `app.use("<path>", routeN)`；对每个 route 文件按其 router 变量名（`Router()` / `router` / `createRouter()` 别名）抽取 `.<method>("<sub>")`；`sub === "/"` 时路径即挂载点，否则拼接 | **164**（163 个挂载 + `/api/assets/usage/batch`） |
| **HOST** | web 声明、但由宿主壳挂载的端点 | `D ∖ E` 中逐条查明挂载位置 | **4**：`/api/connection/connection`、`/api/connection/connect`、`/api/connection/disconnect`（`remoteConnection.ts:121/128/171` 的 `router.post("/connect")` 等，经 `gateway.use("/api/connection", connection.router)` 挂载）、`/api/mobile/exports`（`apps/mobile/src/server.ts:75`） |
| **R** | 契约宇宙 = `E ∪ HOST` | 并集 | **168** |
| **W** | web 声明路径 | ① 静态字面量（去查询串）**88**；② `axios.create({ baseURL })` 客户端的相对段按 baseURL 展开，含单次调用级 `baseURL` 覆盖 **26**；③ 路径模板按受控域展开（见下）**36** | **150** |
| **P** | 插件/骨架包声明路径 | `packages/**` 字面量 19 处：静态去重 **14** + 查询串模板 **2** | **16** |
| **M** | MCP operations 声明路径 | `modules/mcpIntegration/mcp/operations.ts` 的 `path:` 字段 | **32** |
| **D** | 客户端声明路径并集 | `(W ∪ P ∪ M) ∖ BASES`，`BASES = {/api, /api/assets, /api/workspaces, /api/workspaces/files}`（4 个 baseURL 基址本身不是端点；M0 中 W 实际含其中 3 条，`/api` 仅出现在守卫行不计入 W） | **161** |

**路径模板的受控域展开（36 条，逐条给控制表达式）**

| # | 模板（源码原样） | 控制表达式域 | 展开条数 |
| --- | --- | --- | --- |
| 1 | `/api/${type === "ext" ? "ext" : `${type}s`}/install`（2 处） | `PluginType ∈ {node, ext, skill, tool, agent}` | 5 |
| 2 | `/api/${path}/install`（`pluginMarket/index.vue:671`，`path` 取自 `pluginTypes[plugin.type].path`） | 同上 | 5（与 1 重合 5） |
| 3 | `/api/${path}/save`（`pluginConfigDialog.vue:48`；仅 node/ext/tool 有配置） | `{nodes, ext, tools}` | 3 |
| 4 | `/api/${category.path}/${type === "ext" ? "list" : "get"}`（`pluginMarket/index.vue:527`） | ext→list，其余→get | 5 |
| 5 | `/api/${pluginTypes[plugin.type].path}/${action}`（`pluginMarket/index.vue:760`，`action: "setEnabled" \| "uninstall"`） | 5 类型 × 2 动作 | 10 |
| 6 | `/api/desktop/update/${nextAction}` | `{check, download, apply}`（`read` 走 `GET /api/desktop/update`） | 3 |
| 7 | `/api/connection/${action}` | `{connect, disconnect}` | 2 |
| 8 | `/api/mcp/control/${path}` | `{state, result}` | 2 |
| 9 | `/api/mcp/servers/${mode === "json" ? "importJson" : "importDxt"}` | `{importJson, importDxt}` | 2 |
| 10 | `/api/ffmpeg/${action}` | `{download, cancel}` | 2 |
| 11 | 查询串模板（`${}` 在 `?` 之后，路径部分静态）：`/api/assets/{read,save,thumb,events}`、`/api/ai/media/balanceEvents`、`/api/mcp/control/events`、`/api/nodes/files`、`/api/workspaces/files/thumb`、`/api/browser/stream`、`/api/monitor/status` | 取 `?` 之前的静态路径 | 11 |

> 去重后模板新增（不在 88 条静态里）的路径 = **36**。

**`R ∖ D` 的 7 条残留（逐条给事实）**

| # | 端点 | 现状（实测） | 处置 |
| --- | --- | --- | --- |
| 1 | `POST /api/desktop/openUrl` | 服务端有路由（`routes/desktop/openUrl.ts`），web 与桌面壳**均无调用**；桌面壳走 IPC `openUrl`（`apps/desktop/src/index.ts:117`） | 保留；contracts 中登记 `hostOwnedInternal`，判据允许为残留 |
| 2 | `POST /api/exec` | 无客户端调用；`localRuntime/index.ts` 只在 `routePrefixes` 中出现 | 同上 |
| 3 | `POST /api/exec/cancel` | 同上（注释提及，非调用） | 同上 |
| 4 | `GET /api/ext/read` | 由 `ext/list` 返回的 `url` 字段承载，web 用 `<script src=...>` 加载，不拼字符串；服务端 `routes/ext/list.ts:23` 是唯一生产者 | 由 R-06 工厂统一（生产者 + `extensions.ts:80` 守卫） |
| 5 | `GET /api/mobileLink/heartbeat` | 服务端到**远端**的主动探测（`remoteConnection.ts:65` 用 `${active.url}/api/mobileLink/heartbeat`） | 保留 |
| 6 | `POST /api/mobileLink/pair` | 服务端到远端的主动调用（`remoteConnection.ts:152`） | 保留 |
| 7 | `GET /api/tools/client` | 由 `tools/renderers` 返回的 `url` 承载，`toolScaffold/client.ts:31` 用正则校验；服务端 `routes/tools/renderers.ts:9` 是唯一生产者 | 由 R-06 工厂统一 |

> 结论：**7 条全部有明确归属**（3 条无客户端调用、2 条服务端主动外呼、2 条由生产者 URL 承载）。「`R ∖ D = 7`」因此是一个**具名精确集合**判据，不是「允许误差」。

## 3. 需求矩阵总表

> 优先级：P0 = 不可缺项；P1 = 收口项（不阻塞「问题消除」，但阻塞「结构闭环」）。
> 难度：低 / 中 / 中高 / 高。风险按「对行为与构建产物的破坏可能」评估。

| 编号 | 阶段 | 背景 | 目标 | 描述 | 优先级 | 难度 | 风险 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **R-01** | M1 | 131 处字面量分散 53 文件；固定前缀 20 个、参数化路径族 9 个、查询串模板 11 处 | 新建 `@toonflow/contracts` 作为 URL/header/信封/请求响应类型的唯一来源 | 新建 `packages/contracts`：`package.json`（`name: @toonflow/contracts`、`exports: {".", "./api", "./envelope", "./headers", "./types"}`、`typecheck` 脚本、**零 dependencies**）、`tsconfig.json`。`src/api.ts` 导出 `apiBase = "/api"` 与 `apiRoutes`（按 §2.4 的 20 个固定前缀分组，覆盖 150 条路径 + 10 个工厂）；`src/envelope.ts` 导出 `ApiResponse<T>`、`ApiErrorPayload`、`ApiCode`；`src/headers.ts` 导出 3 个 `x-toonflow-*` 与 `acceptLanguage`；`src/types.ts` 再导出 formats 类型；`src/index.ts` 汇总 | P0 | 中高 | 中：常量与 `router.ts` 漂移会假通过（A-07 的双向集合兜住）；`apiRoutes` 变上帝对象（按前缀分组 + 行数上限 420，E5） |
| **R-02** | M2/M3 | 131 处字面量：`components` 81 / `lib` 21 / `pages` 19 / `stores` 8 / `main.ts` 2 | web 字面量归零 | 按 5 批替换：B1 `lib/**`（21 处 / 8 文件）→ B2 `stores/**`+`main.ts`（10 / 5）→ B3 `pages/**`（19 / 6）→ B4 `components/settings/**`（60 / 26）→ B5 其余 `components/**`（21 / 8）。**9 个参数化路径族逐个手写工厂调用**（不用正则批量替换）；**11 处查询串模板**改为 `apiRoutes.*(params)`；2 处守卫改 `pathname.startsWith(apiBase + "/")` 与 `startsWith(apiRoutes.ext.base + "/")`；唯一注释行 `SaveToLibraryDialog.vue:84` 一并改写 | P0 | 中高 | 高：拼错常量 = 全站 404；工厂参数顺序错 = 静默错 URL（A-06 用替换前后 URL 全集合逐条对账） |
| **R-03** | M2 | web 取 server **10 行值**（`documentFormats` 4、`nodeMenu` 3、`agent/mentionSources` 2、`modelReasoning` 1） | 值是唯一来源 | ① **先接线**：`apps/web/package.json` 增 `"@toonflow/formats": "workspace:*"`、`"@toonflow/contracts": "workspace:*"`，`bun install` 后确认两条软链存在（C9）；② formats 已有的 3 个模块直接改指（7 行，零新代码）；③ `nodeMenu` 3 行 → 把 `apps/server/src/lib/nodeMenu.ts` 逐字节复制到 `packages/formats/src/nodeMenu.ts`，原路径改再导出 shim；④ `desktop` 类型 4 行下沉到 `@toonflow/formats/desktop` | P0 | 中 | 中：未加依赖即改 import 会让 vite 解析失败；副本漂移（A-10 diff 为空） |
| **R-04a** | M2 | web 取 server 的 **10 行值**，散在 10 个文件 | 值导入归零 | 10 行逐行改指：`documentFormats` 4 行（`textAttachments.ts:4`、`conversation.vue:84`、`conversation/messageInput.vue:61`、`pages/home/index.vue:131`）；`nodeMenu` 3 行（`stores/settings.ts:7`、`nodeMenuSettings.vue:126`、`canvas/components/nodeMenu.vue:97`）；`agent/mentionSources` 2 行（`mentionMenu.vue:53`、`canvasHost.vue:33`）；`modelReasoning` 1 行（`addCustomProviderDialog.vue:170`）。**逐行清单见 §3.2** | P0 | 低 | 低：纯路径替换，A-04 与 typecheck 双控 |
| **R-04b** | M2 | web 取 server 的 **11 行类型**（纯契约），散在 10 个文件 | 类型导入收敛 | 11 行改指 `@toonflow/contracts/types` / `@toonflow/formats/*`：`desktop` 4、`modelReasoning` 4、`agent/mentionSources` 2、`nodeMenu` 1。**保留不动** `agent/types` 14 行 + `singleAgent/types` 3 行（=17 行，E7） | P0 | 中 | 中：结构等价但名义不同导致注解失效（typecheck 兜住） |
| **R-05** | M3 | 插件实现类 5 子路径 / 12 行 / 9 文件静态 import，与 ext/tool 的动态注册表**双轨** | 插件 UI 统一加载 | ① `node-video/videoPlayer` + `node-text/markdownPreview`（各 1 行，仅 `pages/home/exploreProcess.vue`）→ 复制到 `packages/nodeShared/src/components/`，`nodeShared` 增 2 个 exports，web 改指（C7）；② `tool-browser/panel`（2 行）改 `loadToolComponent("browser")`（复用 `toonflowToolViews`，C6），**要求** `packages/tools/browser/build.ts` 声明 `components: { browserPanel: "src/browserPanel.vue" }`，产物元数据 `components` 由 `[]` 变 `["browserPanel"]`；`isBrowserTool`（2 行）移入 `@toonflow/tools-scaffold/runtime`（纯函数）；③ `tool-canvas/runtime` 保留静态（E2）；④ 12 个骨架子路径保留静态（E1），冻结 `12/41/34` | P0 | 高 | 高：装旧版 browser 工具的用户看不到面板（缓解见 §8 R4）；`components.d.ts` 由 unplugin 自动生成可能被重写 |
| **R-06** | M3 | web/插件消费后端产出的 URL 并**逐字校验**（3 处生产者 + 1 处守卫） | 生产者与消费者共用同一工厂 | `contracts/api.ts` 提供 `nodes.files(name)`、`ext.read(name)`、`tools.client(name, version)`；`routes/{nodes/get,ext/list,tools/renderers}.ts` 改调用工厂；消费侧 `canvas/index.vue:1292,1345`、`document/extensions.ts:80`、`toolScaffold/src/client.ts:31` 改用同一工厂（`client.ts` 属 agent-tools，见 Q4） | P0 | 中 | 中：`tools.client` 正则含 64 位 hex 版本号约束，改写时若放松会削弱安装态校验（保留为对解析后 `version` 参数的校验） |
| **R-07** | M4 | 服务端手写 `/api` 字面量 **72**（不含生成物 163） | 两侧共用一份常量 | ① 生产者 + MCP 工具面 **35**（`operations.ts` 32 + 3 个生产者 routes）→ 读 contracts；② 模块 `routePrefixes` **21**（7 个入口文件）→ 读 contracts 前缀常量（Q5=B）；③ 中间件/安全判断 **15**（`app.ts` 4、`mobileLink` 7、`mcp/tools.ts` 2、`remoteConnection.ts` 2）按 Q5；④ `core.ts` 的 1 条生成模板**不动**；⑤ `router.ts` 生成物**不动** | P1 | 中高 | 高：`operations.ts` 是 32 个 MCP 工具面，改错让外部客户端全 404；`app.ts` 的 `express.raw` 路径写错会让上传上限失效 |
| **R-08** | M3 | **插件包内 19 处 `/api` / 6 文件 / 静态去重 14 + 查询串模板 2**，其中 4 文件 12 路径进 web 主包 | 包内字面量归零，主包不再含插件契约 | `nodeAi.ts` 10 → `apiRoutes.ai.*`；`browserPanel.vue` 3 → `apiRoutes.browser.*`；`questionCard.vue` 2 → `apiRoutes.{agent,singleAgent}.answer`；`comfyMonitor/index.vue` 2 → `apiRoutes.monitor.*`；`ffmpeg/browser.ts` 1 → `apiRoutes.ffmpeg.execute`；`toolScaffold/client.ts` 2 → `apiRoutes.tools.{renderers,client}`。插件/骨架包增加 `@toonflow/contracts` 依赖（构建期内联，不改产物格式） | P0 | 中 | 中：插件构建需能解析 workspace 包；external 配置漏项会打包失败（三种插件构建兜住） |
| **R-09** | M2 | **请求/响应类型无单一来源**（打回意见 #4） | 类型集中且有硬判据 | ① **信封唯一来源**：`contracts/envelope.ts` 的 `ApiResponse<T>`；web 内部 42 处信封形状声明（39 内联 + 3 本地别名，另 1 处 `TfResponse` 属外部 API → E11）全部消灭；② **消除内联信封泛型**：39 处 `axios.<m><{ code; data }>` 改为 `axios.<m><ApiResponse<T>>`；③ **补齐无泛型调用点**：R 域内 30 处（20 文件）全部标注响应类型（域外 3 处：2 处动态 `url` 变量 + 1 处外部遥测 → E12）；④ **请求类型**：22 个共享写端点（`S_mut`）全部有 `contracts/types` 中具名 `ReqXxx` 类型，web 调用点用 `axios.<m><ApiResponse<Res>, ReqXxx>`；⑤ **重复载荷类型收口**：web ∩ server 同名声明 11 个 → 其中响应载荷子集 8 个由 contracts 单一提供（6 个定义相同、2 个分歧 `AssetListOptions`/`ModelsHidden` 需先统一），web 本地声明 8 → 0 | P0 | 中高 | 高：`AssetListOptions`/`ModelsHidden` 两侧定义分歧，直接合并会改变行为 → 必须先判定「哪侧为准」（Q11），并在冒烟里验证；请求类型改为具名会暴露 `server` 端 zod 与类型不一致 |
| **R-10** | M1 | **B-1**：`singleAgent/types.ts:2` 的 `@/agentRuntime` 让 web typecheck 长期 exit 2 | web/root typecheck 归绿 | 按 Q10：**A（默认，最小）** 改为同包相对路径，使该文件及其闭包 **0 条 `@/` 别名**（闭包实测仅此 1 条）；B 把 `SingleAgentEvent` 依赖的 `AgentEvent` 结构化重声明到 `contracts/types`（受 `ToolCall` 依赖限制，代价高）；C 给 web tsconfig 加 server 路径映射（会把整个 server src 拖进 web 类型图，不推荐） | P0 | 低 | 低：改 1 行；风险是「web 绿了但 server 侧别名风格不一致」（server typecheck 双控） |
| **R-11** | M4 | 契约两处维护会再次漂移，现有流程无守卫（C4 禁新增脚本） | 漂移可被一次性命令发现 | ① **P7 集合比对**（`D` vs `R`，双向差集 + 7 条具名残留）；② **P12 URL 等价**（替换前 131 条快照 → 替换后常量求值重算）；③ **P8 包内字面量**；④ **P15 产物来源归因**（sourcemap）。四条写入 §7，`/tmp` 执行不落库；⑤ AGENTS 增补「新增接口必须同时在 `contracts/api.ts` 登记」 | P0 | 中 | 中：探针只能证明计数/集合，不能证明「常量真的被使用」（A-01 归零 + A-02 下界共同兜住） |
| **R-12** | M4 | 地图 `web-console.files = ["apps/web/**","postcss.config.ts"]`；新增 contracts 后归属不明 | 归属登记、覆盖率不退化 | `map.json`：`shared-foundation.files += ["packages/contracts/**"]`；`files_total` 加新增文件数；`web-console.health.review_note` 与 `concerns[0]` 的 finding 更新为交付态数字；`e18` 标签改为「17 处纯协议类型 + 契约包常量」；重算 `coverage_ratio`；AGENTS 目录结构与模块表同步 | P1 | 低 | 低：漏更新会让下轮评审以旧数据判定 |
| **R-13** | 每批 | 改动面 131 字面量 + 38 包导入 + 12 插件导入 + 19 包内字面量 + 72 服务端字面量 + 42 信封声明 + 33 无泛型调用 | 行为零变化、可逐批回滚 | 5 个 web 批 + 3 个契约批 + 1 个插件批 + 1 个服务端批 + R-10 独立 1 行批 + R-09 类型批，**各自独立可回滚**；每批后跑 root `typecheck`、`build:web`、以及与该批相关的冒烟子集 | P0 | 中 | 高：批量替换最易把查询参数拼接改错（每批 ≤60 处、模板逐个手写） |

### 3.1 R-05 插件 UI 处置矩阵（17 子路径，逐条给去向）

| 子路径 | 类型/值行 | 文件 | 去向 | 依据 |
| --- | --- | --- | --- | --- |
| `nodes-scaffold/{connection,nodeAi,nodeDocument,nodeEvent,nodeSkeleton,nodeTools,runtime,values,workspaceFiles}`（9） | 40 行中的 **30**（值 20 / 类型 10） | 25 | **保留静态**，登记 **E1**；`nodeAi` 的 10 条 URL 由 R-08 改为常量（import 本身不动） | 骨架是「宿主提供给插件的运行时」，web 就是宿主 |
| `tools-scaffold/{runtime,client}`（2） | **6**（值 2 / 类型 4） | 5 | **保留静态**，登记 **E1**（`client.loadToolComponent` 本身就是注册表入口）；新增 `isBrowserTool` | 同上 |
| `ext-scaffold/runtime`（1） | **4**（值 1 / 类型 3） | 4 | **保留静态**，登记 **E1** | 同上 |
| `tool-canvas/runtime`（1） | **6**（值 2 / 题 4） | 6 | **保留静态**，登记 **E2** | `canvasSchemas` 是画布工具的业务参数 zod schema，web 作画布宿主必须解析；下沉会反转插件所有权 |
| `tool-browser/panel`（1） | **2**（值 2） | 2 | **改动态**：`loadToolComponent("browser")` | 工具已有注册表，只是 browser 未声明 `components` |
| `tool-browser/client`（1） | **2**（值 2） | 2 | **迁移**：`isBrowserTool` → `@toonflow/tools-scaffold/runtime` | 1 行纯判断，属脚手架 |
| `node-video/videoPlayer`（1） | **1**（值 1） | 1 | **迁移**：→ `@toonflow/node-shared/videoPlayer` | C7 |
| `node-text/markdownPreview`（1） | **1**（值 1） | 1 | **迁移**：→ `@toonflow/node-shared/markdownPreview` | C7 |

> **交付态精确期望（A-05）**：实现类子路径集合 = `{@toonflow/tool-canvas/runtime}`（`impl_specs=1`）；实现类 `impl_lines=6 / files=6 / value=2 / type=4`；骨架 `scaffold_specs=12 / lines=41 / files=34 / value=25 / type=16`。
> 骨架数字变化的**唯一成因**（改法 1，默认）：`providerAgentDialog.vue:74` 的 `import type { ToolCall }` 改为同一行的 `import { isBrowserTool, type ToolCall }`（**不增行**，值 +1、类型 −1）；`messageList.vue:91` 整行从 `tool-browser/client` 替换为 `tools-scaffold/runtime`（**不增行**，值 +1）；`tool-browser/client` 的 2 条值行消失（值 −2）。
> 净效果：`lines 40 → 41`（`+1` 来自 `tools-scaffold/runtime` 新增的 `isBrowserTool` 导出行，**不是**新增 import 行）、`value 23 → 25`、`type 17 → 16`、`files 33 → 34`（`providerAgentDialog.vue` 与 `messageList.vue` 计入骨架文件集）。
> 若评审改选 **Q7=B**（browser 面板不改动态），则 `tool-browser/{panel,client}` 都不动，A-05 的骨架期望回到 `12/40/33/23/17`，实现类期望变为 `4 子路径 / 10 行 / 7 文件 / 值 6 / 类型 4`。**二选一必须在 §10 勾选，不允许实施时就地放宽。**

### 3.2 R-04a / R-04b 行级清单（打回意见 #3 的处置）

**R-04a 值迁移：10 行 / 10 文件 / 4 子路径**

| # | 位置 | 子路径 | 改指 |
| --- | --- | --- | --- |
| 1 | `components/agent/textAttachments.ts:4` | `documentFormats` | `@toonflow/formats/documentFormats` |
| 2 | `components/agent/conversation.vue:84` | `documentFormats` | 同上 |
| 3 | `components/agent/conversation/messageInput.vue:61` | `documentFormats` | 同上 |
| 4 | `pages/home/index.vue:131` | `documentFormats` | 同上 |
| 5 | `stores/settings.ts:7` | `nodeMenu` | `@toonflow/formats/nodeMenu` |
| 6 | `components/settings/panels/general/nodeMenuSettings.vue:126` | `nodeMenu` | 同上 |
| 7 | `pages/workspace/panels/canvas/components/nodeMenu.vue:97` | `nodeMenu` | 同上 |
| 8 | `components/agent/mentionMenu.vue:53` | `agent/mentionSources` | `@toonflow/formats/mentionSources` |
| 9 | `pages/workspace/panels/canvas/canvasHost.vue:33` | `agent/mentionSources` | 同上 |
| 10 | `components/settings/panels/languageModel/addCustomProviderDialog.vue:170` | `modelReasoning` | `@toonflow/formats/modelReasoning` |

**R-04b 类型迁移：11 行 / 10 文件 / 4 子路径**

| # | 位置 | 子路径 | 改指 |
| --- | --- | --- | --- |
| 1 | `App.vue:56` | `desktop` | `@toonflow/formats/desktop` |
| 2 | `stores/desktopUpdate.ts:3` | `desktop` | 同上 |
| 3 | `components/settings/panels/developer/index.vue:184` | `desktop` | 同上 |
| 4 | `lib/desktopProtocol.ts:6` | `desktop` | 同上 |
| 5 | `stores/settings.ts:8` | `modelReasoning` | `@toonflow/formats/modelReasoning` |
| 6 | `components/singleAgentDialog.vue:73` | `modelReasoning` | 同上 |
| 7 | `components/modelPopover.vue:57` | `modelReasoning` | 同上 |
| 8 | `components/settings/panels/pluginMarket/a2aSettingsDialog.vue:27` | `modelReasoning` | 同上 |
| 9 | `components/agent/mentionSources.ts:4` | `agent/mentionSources` | `@toonflow/formats/mentionSources` |
| 10 | `components/agent/mentionSources.ts:6`（`export type {}` 再导出） | `agent/mentionSources` | 同上 |
| 11 | `pages/workspace/panels/canvas/components/nodeMenuItems.vue:75` | `nodeMenu` | `@toonflow/formats/nodeMenu` |

**交叉口径**

| 项 | 数 | 说明 |
| --- | --- | --- |
| 值行 | **10** | 10 个不同文件 |
| 类型行（可迁移） | **11** | 10 个不同文件 |
| 合计迁移 | **21 行 / 19 文件** | 交叠 1 文件 = `stores/settings.ts`（第 7、8 行） |
| 冻结（E7） | **17 行 / 16 文件 / 2 子路径** | `agent/types` 14 + `singleAgent/types` 3 |
| 交付态 server 导入 | **17 / 16 / 2 / 值 0 / 类型 17** | 全部 `import type` |

### 3.3 R-02 的 5 个 web 批次（本轮实测）

| 批次 | 范围 | 处数 | 文件数 |
| --- | --- | --- | --- |
| **B1** | `apps/web/src/lib/**` | **21** | **8** |
| **B2** | `apps/web/src/stores/**` + `main.ts` | **10** | **5** |
| **B3** | `apps/web/src/pages/**` | **19** | **6** |
| **B4** | `apps/web/src/components/settings/**` | **60** | **26** |
| **B5** | 其余 `apps/web/src/components/**` | **21** | **8** |
| | **合计** | **131** | **53**（B1∪B2 去重后 13 个不重复文件） |

### 3.4 R-09 请求/响应类型集中的基线定量（打回意见 #4 的处置）

**(a) 信封声明（`code` + `data` 形状）**

| 类别 | 处数 | 文件数 | 处置 |
| --- | --- | --- | --- |
| 内联 axios 泛型 `axios.<m><{ code: ...; data: ... }>` | **39** | 23 | 全部改 `ApiResponse<T>` → 0 |
| 本地类型别名：`ApiResponse`(deviceLink) / `DocumentResponse`(personalization) / `Envelope`(assetLibrary/api.ts) | **3** | 3 | 删除，改用 contracts → 0 |
| 外部 API 信封 `TfResponse`（`lib/tf.ts:11`，指向 `api.toonflow.net`） | **1** | 1 | **保留，登记 E11** |
| **合计** | **43** | **27** | 内部 **42/26 → 0/0** |

**(b) axios 调用点（107 处）**

| 类别 | 处数 | 交付态 |
| --- | --- | --- |
| 内联信封泛型 | **39** | 改 `ApiResponse<T>`（保留泛型，形状统一） |
| 其他内联泛型（如 `{ data: MediaProvider[] }`、`<Blob>`） | **20** | 统一为 `ApiResponse<T>` 或保留 `Blob`（下载类，E13 白名单） |
| 命名泛型（`ApiResponse<T>` 等） | **15** | 不变或改指 contracts |
| **无泛型** | **33** | R 域内 **30 → 0**；域外 **3**（2 处动态 `url` 变量：`pluginMarket/index.vue:763,764` → 改为常量后自动落入 R 域；1 处外部遥测 `anonymousData.ts:145` → **E12 保留**） |

**(c) 共享写端点 `S_mut`（22 个）的请求类型**

| 项 | 数 |
| --- | --- |
| `S` = web ∩ MCP operations | **32** |
| `S_mut`（`POST`/`PUT`/`PATCH`/`DELETE`） | **22** |
| 　请求体经 `validateFields(..., "body")`（默认）校验 | **17** |
| 　原始字节流（`assets/save`：`req.is("application/octet-stream")`） | **1** |
| 　其余 4（`assets/{import,mkdir,remove,rename}`）经 `validateAssetFields`（等价 body 校验） | **4** |
| web 侧调用点已覆盖的 `S_mut` | **22/22**（静态 8 + baseURL 客户端 9 + 路径模板 5） |
| 　其中已带响应泛型的调用点 | **4** |
| 　无泛型调用点 | **16**（§5.1 A-18 要求全部标注） |
| 交付态 | 22 个具名 `ReqXxx` + 22 个具名 `ResXxx`，web 调用点全部带泛型 |

**(d) web ∩ server 同名类型声明（11 个）**

| 类型名 | web 位置 | server 位置 | 定义 | 处置 |
| --- | --- | --- | --- | --- |
| `ApiResponse` | `deviceLink.vue:138` | `lib/responseFormat.ts:3` | **分歧**（web `data: T`，server `data: T \| null; message: string`） | 统一到 contracts（以 server 为准） |
| `AssetEntry` | `assetLibrary/types.ts:4` | `modules/assetLibrary/assets/library.ts:27` | **相同** | 收口到 contracts |
| `AssetLibrary` | `mentionMenu.vue:63`（局部） | `agent/host.ts:13`、`assets/roots.ts:7` | **分歧**（web 是 id 联合，server 是对象） | **同名的语义不同**，web 侧改名 `AssetLibraryId`（不在载体上收口，见 E14） |
| `AssetLibraryKind` | `stores/assetLibrary.ts:5` | `assets/roots.ts:5` | **相同** | 收口 |
| `AssetListOptions` | `assetLibrary/types.ts:73` | `assets/library.ts:16` | **分歧**（web 多了 `AssetSelector` 交集） | **必须先裁决**（Q11） |
| `AssetSortField` | `stores/assetLibrary.ts:8` | `assets/library.ts:13` | **相同** | 收口 |
| `AssetSortOrder` | `stores/assetLibrary.ts:9` | `assets/library.ts:15` | **相同** | 收口 |
| `AssetUsage` | `assetLibrary/types.ts:48` | `assets/usage.ts:5` | **相同** | 收口 |
| `BalanceSnapshot` | `lib/providerBilling.ts:6`（局部） | `media/billing.ts:8`（局部） | **相同** | 收口 |
| `ModelsHidden` | `stores/settings.ts:98` | `media/ai/visibility.ts:5` | **分歧**（web 必填 `HiddenKind`，server 可选 `Partial<ModelKind>`） | **必须先裁决**（Q11） |
| `PluginType` | `pluginMarket/types.ts:2` | `types/module.ts:4` | **分歧**（web 5 值；server 6 值含 `provider`） | **同名的语义不同**，web 侧改名 `MarketPluginType`（E14） |

> 汇总：**相同 6 / 分歧 5**；其中「响应载荷类型」子集 8 个（`AssetEntry`、`AssetLibraryKind`、`AssetListOptions`、`AssetSortField`、`AssetSortOrder`、`AssetUsage`、`BalanceSnapshot`、`ModelsHidden`），交付态 web 本地声明 **8 → 0**，分歧 **2 → 0**；另 3 个（`ApiResponse`、`AssetLibrary`、`PluginType`）按上表分别「统一 / 改名 / 改名」处理。

## 4. 里程碑与精确期望

| 里程碑 | 内容 | 关键期望 | 交付门 |
| --- | --- | --- | --- |
| **M0** | 基线冻结（本轮，零代码改动） | §0.4 全表可复现；**web typecheck exit 2**、root typecheck exit 2 | §7 的 P1–P21 均可跑出表中数字 |
| **M1** | R-01 建 contracts（只加不改）+ R-10 修 B-1 | 新增 contracts 代码文件 **5**；web 字面量**仍为 131**（证明只加不改）；**root typecheck exit 0** | A-09 PASS；A-13 PASS；`build:web` exit 0 |
| **M2** | R-03 接线 + R-04a/R-04b + R-09(a)(b) + R-02 的 B1/B2 | web 值导入 **0**；server 总导入 **17**（全 `import type`）；web 字面量 131 → **100**；内部信封声明 42 → **0**；无泛型 33 → **3**（域外，含 2 个待 R-02 B4 收口的动态 `url`） | root typecheck exit 0；`build:web` exit 0；A-04/A-11 绿 |
| **M3** | R-02 的 B3/B4/B5 + R-05 + R-06 + R-08 + R-09(c)(d) | web 字面量 → **0**；实现类子路径 → **1**；包内字面量 19 → **0**；产物插件来源路径 12 → **0**；`S_mut` 请求类型 22/22；重复载荷类型 web 本地声明 8 → **0** | A-01/A-03/A-05/A-06/A-12/A-14/A-18/A-19 PASS；S-04/S-05/S-06/S-07/S-09 |
| **M4** | R-07 + R-11 + R-12 | 服务端手写 72 → **16**（Q5=B：保留 15 中间件 + 1 生成模板）；地图归属更新；`coverage_ratio` 不退化 | A-08 PASS；A-07 双向差集符合期望 |
| **M5** | 终验 | A-01～A-19 全 PASS；冒烟 12/12；豁免表填满 | 全量判据 + 审查通过 |

> 手写 72 → 16 的算式：`72 − 32（operations）− 21（routePrefixes）− 3（生产者 routes）= 16`；16 = 15（中间件/安全判断，E4）+ 1（`core.ts` 的生成模板，E4）。

## 5. 验收标准

### 5.1 二值判定表（A-01～A-19）

| 编号 | 判据 | 探针 | 期望（唯一值 / 精确集合） | 正控制（M0 实测） |
| --- | --- | --- | --- | --- |
| **A-01** | web 源码 `/api` 字面量归零 | P1 | `occ=0 plain=0 tmpl=0 guard=0 comment=0 files=0` | `occ=131 plain=109 tmpl=22 guard=2 comment=1 files=53` |
| **A-02** | web 内无任何 `/api/` 文本，且常量确被使用 | P2 | `lines=0`；使用 `apiRoutes`/`apiBase` 的文件数 **≥ 45**（下界） | `lines=132`；常量使用 0 文件 |
| **A-03** | 固定前缀在 `apiRoutes` 中全部存在 | P3 | 静态前缀集合 **20/20** 命中；参数化路径族 **9/9** 有对应工厂；交付态 web 侧前缀计数 = 0 | 20 前缀 / 9 族（§2.4） |
| **A-04** | web 对 server 依赖面收缩 | P5 | `server_lines=17 files=16 specs=2 value=0 type=17`；`specs = {@toonflow/server/agent/types, @toonflow/server/singleAgent/types}` | `38 / 30 / 7 / 10 / 28` |
| **A-05** | 插件实现类子路径收敛 | P5 | `impl_specs=1`（`@toonflow/tool-canvas/runtime`）、`impl_lines=6`、`impl_files=6`、`impl_value=2`、`impl_type=4`；`scaffold_specs=12`、`scaffold_lines=41`、`scaffold_files=34`、`scaffold_value=25`、`scaffold_type=16` | impl `5 / 12 / 9 / 8 / 4`；scaffold `12 / 40 / 33 / 23 / 17` |
| **A-06** | URL 文本零变化 | P12 | 替换前 131 条（+ 包内 19 + ops 32）的 URL 文本集合 == 替换后由常量求值集合；`diff=0`；2 处 `encodeURIComponent` 的位置不变（`ai.balanceEvents`、`mcp.controlEvents`） | 快照即基线（M0 `diff=0` 自证） |
| **A-07** | **客户端声明路径与服务端端点同一口径对账** | P7 | `E=164`、`HOST=4`、`R=168`、`W=150`、`P=16`、`M=32`、`D=161`；**`D ∖ R = 0`**；**`D ∩ R = 161`**；**`R ∖ D` 精确 = §2.4 的 7 条具名集合**；`contract_paths` 只允许等于 `D`（161），**不允许出现 Any 其他数字** | `D=161`、`missing=0`、`residual=7`（同一脚本在 M0 即成立，说明判据本身在基线上可计算） |
| **A-08** | 服务端手写字面量收敛 | P10 | Q5=B → `handwritten=16`；`generated_router=163` 恒定；拆分固定 `72 = 32 + 21 + 15 + 3 + 1` → 交付 `16 = 15 + 1` | `handwritten=72 generated=163` |
| **A-09** | contracts 零外部依赖 | P11 | 外部 `@toonflow` 依赖集合 = `{formats}`；`dependencies` 键 = 0；代码文件 = 5 | 包不存在 → 判 **FAIL**（不得判「无异常」） |
| **A-10** | 副本无漂移 | P13 | `nodeMenu`、`desktop` 与旧路径逐字节相同；旧路径为再导出 shim；`@toonflow/server/{nodeMenu,desktop}` target 未变 | `documentFormats/modelReasoning/mentionSources` 已 IDENTICAL（3/3）；`nodeMenu/desktop` 未下沉 |
| **A-11** | 行为零变化（全局绿） | P14 + 冒烟 | root `typecheck` **exit 0**（含 web）；`build:web` exit 0；`build:tools`/`build:nodes`/`build:ext` exit 0；§6.3 冒烟 **12/12**；server `exports` 14 键与 target 逐字不变 | root typecheck **exit 2**；build:web exit 0 |
| **A-12** | 插件包内 `/api` 字面量归零 | P8 | `packages/**` `occ=0 files=0`（E9 登记的例外除外，期望空集） | `19 / 6`（静态去重 14 + 查询串模板 2） |
| **A-13** | B-1 修好：web 解析的 server 源码闭包内 0 条 `@/` 别名 | P20 | 从 7 个 web 所用子路径出发的闭包：`alias_imports=0`；web typecheck 单包 **exit 0** | 闭包 `alias_imports=1`；单包 exit 2 |
| **A-14** | **产物中插件来源的 `/api` 路径归零（来源归因判据）** | P15 | `vite build --sourcemap` 后：`pkg_origin_files=0` 且 `pkg_origin_paths=0`；同时 `all_pkg_sources` 仍 ≥ 50（M0=58；防「把插件整体排除出主包」把判据做成恒真） | `pkg_origin_files=4`、`pkg_origin_paths=12`、`all_pkg_sources=58` |
| **A-15** | 信封形状声明唯一来源 | P16 | `apps/web/src` 内部信封形状声明 = **0**（内联 39 → 0、本地别名 3 → 0）；`lib/tf.ts` 的 `TfResponse` = **1**（E11） | `internal=42 / files=26`；`inline=39`；`alias=3` |
| **A-16** | 内联信封泛型归零 | P17 | `axios.<m><{ code: ...; data: ... }>` = **0**；改为 `ApiResponse<T>` 的调用点 = **39** | `env_inline=39` |
| **A-17** | 无泛型 axios 调用点收敛 | P17 | 总数 **33 → 1**（E12 的外部遥测）；R 域内 **30 → 0**；`R 域外非 E12` **2 → 0** | `untyped=33`（R 域内 30 / 域外 3） |
| **A-18** | 共享写端点的请求类型齐备 | P18 | `S=32`、`S_mut=22`；`contracts/types` 中 `ReqXxx` 具名类型 = **22**、`ResXxx` = **22**；web 侧 `S_mut` 调用点 **22/22** 带泛型（M0 为 4 带 / 16 无） | `S_mut=22`；带泛型 4、无泛型 16 |
| **A-19** | 重复载荷类型收口 | P19 | web ∩ server 同名声明 **11**：响应载荷子集 **8** 的 web 本地声明 = **0**、两侧定义分歧 = **0**；另 3 个按 §3.4(d) 分别「统一/改名」后，同名且定义分歧 = **0** | 同名 11（相同 6 / 分歧 5）；载荷子集 8（分歧 2） |

### 5.2 判定规则

1. 只有 PASS / FAIL；不接受「基本通过」「趋势良好」「≤ / 约 / 含…或…」。
2. 期望必须是整数或精确集合；计数类判据用**两种独立算法**各算一次（shell + Python 解析），相等才 PASS。
3. **不可达即回评审**：实施中若发现期望不可达（常量与 `router.ts` 天然不一致、某插件产物无法声明 components、某类型两侧语义不可合并），**不得就地放宽**，回需求评审修订本表。
4. 豁免前置：任何未在 §9 登记的项，一律计入判据分子。
5. 相位：A-01～A-19 在 **M5 交付态**判定；M0 只作正控制与基线记录。
6. `router.ts` 是生成物：以「手改 `router.ts` 达成 A-07/A-08」的实现方式判 FAIL（同时违反 C3）。
7. **A-07 只允许一个数**：`D` 必须由探针脚本单一实现产出，`contract_paths` 不得由文档另行给出（这正是第 2 版被打回的原因）。

### 5.3 契约宇宙的守卫（防判据坍缩）

| 守卫 | 作用 | 检查方式 |
| --- | --- | --- |
| **G-EXIST** | 探针遍历的目录/文件必须存在 | 任一输入路径不存在 → 探针 exit 9（不得输出 0 判 PASS） |
| **G-NONEMPTY** | M0 基线集合不得为空 | `E`、`D`、`installed_plugins` 在 M0 都必须 > 0（M0：164 / 161 / 17） |
| **G-DUAL** | `D` 与 `R` 必须由**不同实现路径**产出 | `E` 来自 `router.ts` 静态解析；`D` 来自客户端源码扫描 + ops 源；两者不得共享中间结果 |
| **G-PROVENANCE** | A-14 的归因必须来自 sourcemap，而非路径字符串比差 | 若 `all_pkg_sources < 50`（M0=58）→ 判 FAIL（防止「插件没被打包」把判据做成恒真） |
| **G-NONZERO** | 所有「归零」判据在 M0 必须非零 | A-01/A-12/A-14/A-15/A-16/A-19 的 M0 值均为非零（131/19/11/42/39/8） |

## 6. 冒烟矩阵（12 项，全部走 HTTP 层验证「URL 未变」）

> fixture 放 `/tmp`，执行后删除。启动沿用既有做法：`cd apps/server && TOONFLOW_DATA_DIR=$TMP bun src/index.ts`。

| # | 场景 | 请求 | 二值断言 |
| --- | --- | --- | --- |
| **S-01** | 设置读写（`stores/settings.ts`） | `GET /api/settings/get`、`PUT /api/settings/save` | 均 HTTP 200 且 `code=200` |
| **S-02** | 会话状态 | `GET /api/sessionState/get`、`PATCH /api/sessionState/patch` | 均 200；`get` 返回 `code=200` |
| **S-03** | 工作区文件（baseURL + 10 相对段） | `GET /api/workspaces/files/list?directory=<ws>&path=` | 200；`data.directory` 等于 `<ws>` 的 realpath |
| **S-04** | 素材库（baseURL + 15 相对段） | `GET /api/assets/list?library=project&directory=<ws>` | 200；`code=200` |
| **S-05** | 节点列表与脚本 URL（R-06 工厂） | `GET /api/nodes/get` | 每条 `item.url` **精确等于** `/api/nodes/files?name=<item.name>`（用常量求值比对） |
| **S-06** | 扩展列表与脚本 URL（R-06 工厂 + 守卫） | `GET /api/ext/list` | 每条 `item.url` 精确等于 `/api/ext/read?name=<name>`；web 守卫仍放行 |
| **S-07** | 工具渲染器（R-06 工厂 + 64 hex） | `GET /api/tools/renderers` | 每条 `url` 匹配 `^/api/tools/client?name=<小驼峰>&version=<64 hex>$`（M0 与 M5 正则等价） |
| **S-08** | Agent 流式 | `POST /api/agent`（fixture 供应商） | 200、`Content-Type: application/x-ndjson; charset=utf-8`、首行 `type=session`、末行 `type=done`、`type=error` 行数 0 |
| **S-09** | 工作区越界（不变式） | `GET /api/workspaces/files/list?directory=<ws>&path=../etc` | 400；body 精确 `{"code":400,"data":null,"message":"文件路径无效"}` |
| **S-10** | FFmpeg SSE | `GET /api/ffmpeg/events` | 200 且 `Content-Type: text/event-stream` |
| **S-11** | 计费 SSE（`providerBilling.ts`） | `GET /api/ai/media/balanceEvents?accountIds=` | 200 且 `Content-Type: text/event-stream` |
| **S-12** | 宿主契约与产物 | ① `build/web` 全文检索 `packages/contracts/src` 源路径字符串；② `apps/server/package.json` 的 exports | ① **0 命中**；② 14 个键与 target 与 M0 **逐字相等** |

> **S-13（R-09 专用，与类型集中直接相关）**：`GET /api/assets/list` 与 `PUT /api/settings/save` 的响应体键集合，M0 与 M5 **逐键相等**（含 `code`/`data`/`message` 的有无），用于证明「信封统一」没有改变序列化结果。

## 7. 探针（P1–P21，`/tmp` 一次性执行，不落库）

> 所有探针只读、只输出整数或集合。实施方需把 **M0 与 M5 两次输出**一起贴进实施报告。
> 每条探针都按 §5.3 的守卫执行：路径不存在 → exit 9；M0 期望为 0 的项，若 M0 输出也为 0 → exit 8（判据坍缩）。

### P1 web `/api` 字面量分类计数（A-01）

```bash
# 遍历 apps/web/src 的 .ts/.vue；跳过行首为 // * /* 的整行注释；
# 用引号边界匹配（双/单引号/反引号紧跟 /api）；反引号计 tmpl；同一行含 startsWith( 计 guard；
# 注释行内出现 /api 计 comment（不计 occ）。
# M0 期望：occ=131 plain=109 tmpl=22 guard=2 comment=1 files=53
# M5 期望：全 0
```

### P2 web 内 `/api/` 文本残留（A-02）

```bash
grep -rn "/api/" apps/web/src --include='*.ts' --include='*.vue' | wc -l    # M0=132  M5=0
grep -rl "apiRoutes\|apiBase" apps/web/src --include='*.ts' --include='*.vue' | wc -l   # M0=0  M5>=45
```

### P3 前缀与模板族（A-03）

```bash
# ① 静态字面量的第二段前缀去重 → M0=20：desktop(16) providers(16) agent(13) mcp(8) settings(7)
#    skills(6) workspaces(5) mobileLink(5) agents(5) singleAgent(5) assets(4) ffmpeg(3)
#    connection(2) sessionState(2) nodes(2) tools(2) ai(2) ext(2) plugins(1) mobile(1)
# ② 路径段模板族（${} 位于路径段）→ M0=9：install / save / get|list / setEnabled|uninstall /
#    desktop.update / connection / mcp.control / mcp.servers / ffmpeg
# ③ 查询串模板（${} 在 ? 之后）→ M0=11
# ④ 守卫（startsWith/pathname）→ M0=2（裸 /api、/api/ext）
# M5：①②③④ 均 0，且 apiRoutes 中 20 前缀 20/20 + 9 族 9/9 存在
```

### P4 web 声明路径 W（A-07 的输入）

```bash
# ① 静态去重（去查询串）：M0=88
# ② baseURL 展开：assetLibrary/api.ts 的 client.<m>("/x") 15 条 + /reveal → 15；
#    workspaceFiles.ts 10 条（含 1 条 baseURL 覆盖 /api/workspaces + /clone）→ 10；
#    合计 26（去重后）
# ③ 路径模板按 §2.4 的受控域展开 → 36 条（其中 5 条与 ① 重合，净新增 31；
#    但 install 族 5 条中 3 条已在 ①，故 W = 88 + 26 + 36 = 150）
# ④ 去掉 BASES（W 中实际出现 3 条 baseURL 基址：/api/assets、/api/workspaces、/api/workspaces/files）→ D_web = 147
# M0：static=88 exp=26 tpl=36 W=150
```

### P5 web 对 `@toonflow` 包的导入（A-04/A-05）

```bash
# 识别 import/export ... from "@toonflow/<pkg>[/sub]"；import type 或 {} 内全为 type 前缀者计 type；
# 混合导入（{ type A, B }）按是否含非 type 名判定：含则整行计 value。
# M0 server：38 行 / 30 文件 / 7 子路径；值 10 / 类型 28
# 逐子路径 M0：
#   agent/types       14 行(0 值/14 型) 14 文件
#   modelReasoning     5 行(1 值/4 型)   5 文件
#   nodeMenu           4 行(3 值/1 型)   4 文件
#   desktop            4 行(0 值/4 型)   4 文件
#   documentFormats    4 行(4 值/0 型)   4 文件
#   agent/mentionSources 4 行(2 值/2 型) 3 文件
#   singleAgent/types  3 行(0 值/3 型)   2 文件
# M0 插件/骨架：17 子路径 / 52 行 / 36 文件；骨架 12/40/33（值 23/型 17）；实现 5/12/9（值 8/型 4）
# 骨架 = nodes-scaffold|tools-scaffold|ext-scaffold；实现 = 其余
# M5：server 17/16/2（值 0/型 17）；骨架 12/41/34（值 25/型 16）；实现 1/6/6（值 2/型 4）
```

### P6 服务端端点全集 E（A-07 的一半）

```bash
# ① 从 router.ts 取 app.use("<path>", routeN) → M0=163
# ② 对每个 route 文件按其 router 变量名（const router = Router() / Router() / createRouter() 别名）
#    抽取 .<method>("<sub>")；sub === "/" 用挂载点，否则拼接
# ③ 交叉校验：每个 route 文件必须至少抽出 1 条（否则 exit 1 并打印文件名）
# M0：mounts=163 endpoints=164（多出的一条为 /api/assets/usage/batch）
# 方法分布：POST 81 / GET 51 / PUT 20 / DELETE 10 / PATCH 2
```

### P7 客户端声明路径 D 与服务端端点对账（A-07 主判据）

```bash
# 输入：W（P4）∪ P（P8 的静态去重）∪ M（P9）− BASES → D
# 输入：E（P6）∪ HOST（4 条具名）→ R
# 输出：D、R、D-R（missing）、R-D（residual）
# M0：W=150 P=16 M=32 BASES=4 D=161 E=164 HOST=4 R=168 missing=0 residual=7
# residual 必须逐条打印，且与 §2.4 的 7 条逐字相等（顺序无关，集合相等）
# M5：同一脚本，D 与 residual 的集合不变（判据是「集合相等」，不是「数相等」）
```

### P8 `packages/**` 内 `/api` 字面量（A-12）

```bash
# 遍历 packages（排除 node_modules）的 .ts/.vue，跳过注释行，引号边界匹配 /api
# M0：19 处 / 6 文件；静态去重 14；查询串模板 2
#    nodeAi.ts 10（8 静态去重）／browserPanel.vue 3（2）／questionCard.vue 2（2）
#    comfyMonitor/index.vue 2（1 静态 + 1 查询串）／ffmpeg/browser.ts 1（1）／toolScaffold/client.ts 1（1）
# M5：0 / 0
```

### P9 MCP operations 的 path（A-07 的 M）

```bash
grep -c 'path: "/api' apps/server/src/modules/mcpIntegration/mcp/operations.ts   # M0=32
# 去查询串、去重后仍为 32；32 条全部在 E 内（M0 已成立）
```

### P10 服务端 `/api` 字面量（A-08）

```bash
# 遍历 apps/server/src 的 .ts，引号边界匹配 /api，router.ts 单列为 generated
# M0：occ=235 files=17 generated=163 handwritten=72
# 手写 72 的分解（必须逐条打印文件与行号）：
#   operations.ts 32 / 7 个 routePrefixes 入口 21 / 中间件安全判断 15 /
#   生产者 routes 3 / core.ts 生成模板 1
# M5（Q5=B）：handwritten=16（中间件 15 + core.ts 1）；generated 恒 163
```

### P11 contracts 外部依赖与文件数（A-09）

```bash
# packages/contracts/src 中 from "@toonflow/..." 的包名集合 == {formats}
# package.json 无 "dependencies" 键（undefined 或 {}）
# src/*.ts 文件数 == 5
# M0：包不存在 → exit 9（判 FAIL，不得判「无异常」）
```

### P12 URL 文本等价（A-06）

```bash
# 替换前：对 apps/web/src 逐行取出引号边界内的 /api 文本（模板原样，不去变量）
#         另加 packages 内 19 条与 MCP operations 的 32 条 → /tmp/url_baseline.json
# 替换后：用 contracts 常量与工厂对同一批调用点求值，得到同规模集合
# 判定：两集合逐条相等（diff=0）；2 处 encodeURIComponent 的参数位置不变
# M0：快照即基线（diff=0 自证）；M5：diff=0
```

### P13 副本一致性（A-10）

```bash
diff <(git show 1342529:apps/server/src/lib/nodeMenu.ts) packages/formats/src/nodeMenu.ts   # 空
diff <(git show 1342529:apps/server/src/types/desktop.ts)  packages/formats/src/desktop.ts    # 空
# 并确认 apps/server/src/lib/nodeMenu.ts 与 src/types/desktop.ts 已改为再导出 shim，
# 且 apps/server/package.json 的 ./nodeMenu、./desktop target 未变
```

### P14 类型检查与构建（A-11/A-13）

```bash
(cd apps/web && bun x vue-tsc --noEmit)            # M0: exit 2（1 条）  M5: exit 0
bun run typecheck                                  # M0: exit 2          M5: exit 0
bun run --filter '@toonflow/web' build             # M0/M5: exit 0
bun run build:tools / build:nodes / build:ext      # M0/M5: exit 0
```

### P15 **产物来源归因**（A-14，打回意见 #2 的判据）

```bash
cd apps/web && bun x vite build --outDir /tmp/webprobe --emptyOutDir --sourcemap
```

```python
# 遍历 /tmp/webprobe 下所有 *.js.map：
#   for (source, content) in zip(map["sources"], map["sourcesContent"]):
#       若 content 为 None：跳过
#       若 "packages/" in source 且 content 含 /api 字面量：
#           pkg_origin_files.add(source); pkg_origin_paths |= {去查询串的路径}
#       若 "packages/" in source：all_pkg_sources.add(source)   # 无条件计入
# 输出：pkg_origin_files / pkg_origin_paths / all_pkg_sources
# M0：pkg_origin_files=4  pkg_origin_paths=12  all_pkg_sources=58
#     12 条 = /api/ai/{generate, generate/stop, media/generate, media/models, media/price,
#             media/tasks/cancel, media/tasks/status, models}（nodeAi 8 条）
#            + /api/browser/{input, stream}（browserPanel）
#            + /api/tools/renderers（toolScaffold/client）
#            + /api/ffmpeg/execute（ffmpeg/browser）
# M5：pkg_origin_files=0  pkg_origin_paths=0  且 all_pkg_sources >= 50（G-PROVENANCE）
# 注意：本判据与「web 源码字面量是否为 0」完全无关；即使 web 从未归零，本判据仍可判定。
```

### P16 信封形状声明（A-15）

```bash
# (a) 内联：axios.<get|post|put|delete|patch><{ ... }>，对象体内同时含 `code: number|string` 与 `data: ...`
# (b) 别名：type X<T> = { ... }，体内同时含 code 与 data
# 统计两者之和，排除 apps/web/src/lib/tf.ts（外部 API）
# M0：internal=42 / files=26；inline=39；alias=3（ApiResponse / DocumentResponse / Envelope）
#     external=1（TfResponse，E11）
# M5：internal=0；external=1
```

### P17 axios 泛型使用（A-16/A-17）

```bash
# 对每个 axios.<method>(...) 调用点，按尖括号配平取泛型实参：
#   无泛型            → untyped
#   泛型体是对象且含 code+data → env_inline
#   其他对象字面量     → other_inline
#   命名/其他          → named
# M0：total=107  env_inline=39  other_inline=20  named=15  untyped=33
#     untyped 的 URL 归属：R 域内 30（20 文件）/ 域外 3
#       域外 3 = pluginMarket/index.vue:763,764（动态 url 变量）+ anonymousData.ts:145（外部遥测）
# M5：env_inline=0；untyped=1（仅 E12 遥测）；R 域内 untyped=0
```

### P18 共享写端点的请求/响应类型（A-18）

```bash
# ① S = {operations.ts 的 path} ∩ {web 声明路径}
# ② S_mut = { p ∈ S | E[p] 含 POST/PUT/PATCH/DELETE } → M0=22
# ③ 对每个 p：读 router.ts 的 mount→route 文件，判定请求形态：
#      validateFields(shape, "body"|缺省) → body 17；req.is("application/octet-stream") → raw 1；
#      validateAssetFields(...) → asset 4
# ④ 统计 web 侧调用点（axios 字面量 + baseURL client + 路径模板 + XHR request.open）：
#      M0：22/22 端点有调用点；带泛型 4、无泛型 16（其中 5 处是模板展开的 install）
# ⑤ contracts/types 中 grep -c '\bReq[A-Z]\w*' / '\bRes[A-Z]\w*'
#      M5：各 22
```

### P19 重复载荷类型收口（A-19）

```bash
# ① 分别抽取 apps/web/src（排除 node_modules）与 apps/server/src（排除 routes/）的
#    type/interface 声明名集合 → 交集 = 11（M0）
# ② 逐名取两处声明体，去注释、压空白后比较：
#      相同 6：AssetEntry、AssetLibraryKind、AssetSortField、AssetSortOrder、AssetUsage、BalanceSnapshot
#      分歧 5：ApiResponse、AssetLibrary、AssetListOptions、ModelsHidden、PluginType
# ③ 载荷子集 8（§3.4d）：web 本地声明数 M0=8；分歧数 M0=2（AssetListOptions、ModelsHidden）
# M5：载荷子集 web 本地声明=0；同名且定义分歧=0（改名不算同名）
```

### P20 `@/` 别名闭包（A-13）

```bash
# 从 web 实际使用的 7 个 server 子路径（exports target）出发做 BFS，
# 沿相对 import 与 @toonflow 包 exports（仅 .ts 源文件）展开，统计 from "@/..." 的行数
# M0：closure_files=10  alias_imports=1（singleAgent/types.ts 的 @/agentRuntime）
# M5：alias_imports=0
```

### P21 规模与产物（R-13 预算，A-11 辅助）

```bash
# code 扩展名（.ts .tsx .js .jsx .mjs .cjs .mts .cts .vue .sql .ets .java .kt .kts .cs .cpp .h .hpp .m .mm）
# M0：apps/web 175 文件 / 42,758 行
# 产物：434 个 .js；去重 /api 路径 107（仅记录，不作判据）
```

## 8. 风险与缓解

| # | 风险 | 影响 | 概率 | 缓解 | 判据 |
| --- | --- | --- | --- | --- | --- |
| R1 | 常量值拼错（131 处中任一处） | 该功能 404，用户可见 | 中 | A-06 逐条对账；每批后跑该批 URL 子集 | A-06 |
| R2 | 模板工厂参数顺序/编码方式改变 | 查询参数错位 | 中 | 9 族 36 条逐个手写核对；2 处 `encodeURIComponent` 位置不变 | A-06 |
| R3 | `apiRoutes` 变上帝对象（150 路径 + 10 工厂） | 可维护性下降 | 中 | 按 20 前缀分组；`api.ts` ≤420 行；readme 给「新增接口 = 一行常量 + 一行挂载」 | E5 |
| R4 | browser 面板改动态后，旧安装实例无面板 | 界面缺失（非崩溃） | 高 | `loadToolComponent` 返回 undefined 时按「无面板」降级并保持对话可用；`messageList.vue` 在 `components` 为空时不渲染 `<browserPanel>` | S-07 + 人工 |
| R5 | web 类型迁移后 `vue-tsc` 报「结构相同但名义不同」 | 类型检查失败 | 中 | 只改 import 路径不改类型名；`AssetListOptions`/`ModelsHidden` 先按 Q11 裁决再合并 | A-11 |
| R6 | 未加 workspace 依赖就改指向 formats/contracts | vite 解析失败（C9） | 高 | M2 第一步先接线 + `bun install` + 检查软链 | A-11 |
| R7 | 插件包引入 contracts 后，插件构建 external 配置漏项 | `build:tools` 失败 | 中 | 实施时跑全部三种插件构建；契约包零依赖，可安全内联 | A-11 |
| R8 | **A-07 的 residual 被质疑为「放宽」** | 期望值反复 | 中 | 7 条具名 + 每条给「现状事实 + 处置」，并区分「无调用者(3) / 服务端外呼(2) / 生产者承载(2)」；A-07 同时要求 `D∩R=161` 与 `missing=0`，不是单靠 residual 成立 | A-07、§2.4 |
| R9 | **A-14 退化为恒真** | 判据失效 | 中 | G-PROVENANCE：`all_pkg_sources >= 50` 同时成立；M0 正控 4/12 非零 | A-14、§5.3 |
| R10 | **R-09 请求类型把 server zod 与 TS 类型的不一致暴露出来** | 实施期发现两侧字段名不同 | 高 | P18 只要求「具名类型存在 + 调用点带泛型」，不要求 zod 与 TS 完全同构；不一致项登记到 E15 的「已发现差异」清单，不阻塞本需求 | A-18、E15 |
| R11 | `map.json` 归属未更新 | 下轮评审以旧数据判定 | 中 | R-12 逐条列 glob | A-07 之外另做存在性检查 |
| R12 | B-1 的修法选了「给 web 加 server 路径映射」 | 把整个 server src 拖进 web 类型图 | 低 | Q10 默认 A（同包相对路径） | A-13 |

## 9. 豁免判定与结构化豁免（E1–E15）

### 9.1 判定标准（满足任一即申请）

1. 消除需改变对外契约（HTTP / 包导出 / 宿主行为 / 插件产物格式）；
2. 消除需超出本需求范围（跨模块 / 跨包 / 改宿主壳）；
3. 消除引入的风险或复杂度高于收益，且已有可执行替代缓解。

### 9.2 候选豁免（未勾选视为驳回 → 转验收项）

| ID | 关联 | 内容 | 未消除的理由 | 替代缓解（可执行） | 复核触发 |
| --- | --- | --- | --- | --- | --- |
| **E1** | R-05 | **12 个骨架子路径保留静态**（`nodes-scaffold` 9、`tools-scaffold` 2、`ext-scaffold` 1；交付态 41 行 / 34 文件 / 值 25 / 类型 16） | 骨架不是插件，而是「宿主提供给插件的运行时库」；web 就是宿主，改动态会让插件编译期拿不到类型 | ① 冻结 `12/41/34`，不得再增长；② 三个宿主全局不变（C6）；③ **骨架内不得新增 `/api` 字面量**（A-12 持续保证） | 任一项增长，或骨架内出现新的 `/api` |
| **E2** | R-05 | **`@toonflow/tool-canvas/runtime` 保留静态**（6 行 / 6 文件，值 2 行 `canvasSchemas`） | `canvasSchemas` 是画布工具的业务参数 zod schema，web 作画布宿主必须解析 agent 传来的工具调用；下沉会反转插件所有权并让 foundation 依赖 zod | ① 冻结 6 行不变；② 白名单仅 `canvasSchemas`（值）+ `CanvasContext`/`CanvasToolCall`（类型） | 出现第 3 个值导出时重评 |
| **E3** | R-01/R-07 | **HOST 4 条**（`/api/connection/{connection,connect,disconnect}` 由 `remoteConnection.ts` 的 router 经宿主 `gateway.use("/api/connection")` 挂载；`/api/mobile/exports` 由 `apps/mobile/src/server.ts:75` 挂载） | 属宿主壳；移动壳部分是 ArkTS/Java，无法直接 import TS 契约包 | ① contracts 中以 `hostOwned` 标注；② A-07 的 `HOST=4` 精确；③ web 行为不变 | 宿主壳新增 `/api/*` 路由 |
| **E4** | R-07 | **服务端 16 处保留手写**：中间件/安全判断 15（`app.ts` 4、`mobileLink/index.ts` 7 含小写比较、`mcp/tools.ts` 2、`remoteConnection.ts` 2）+ `core.ts` 生成模板 1 | 这些不是「客户端调用 URL」，而是服务端自身的路由分组与前缀判断；小写比较与外部 URL 拼接无法用常量表达 | ① 72 的拆分固定为 32+21+15+3+1；② 交付 `handwritten=16`；③ 每条保留项加 `ACT:` 注释说明为何手写 | 安全判断新增分支时 |
| **E5** | R-01 | **`apiRoutes` 允许长到 150 路径 + 10 工厂（约 168 键）** | URL 常量天然多；拆包会让「唯一来源」变成 5 个来源 | 按 20 前缀分组；`api.ts` 行数上限 420；readme 固定动作 | 超过 420 行时拆分 |
| **E6** | NG3 | **`canvas/index.vue`（1,548 行）等巨型组件不拆** | 属 `c-web-console-2`，独立需求 | 本需求对该文件只允许「URL 替换 ±5 行」 | 出现结构性重写时 |
| **E7** | G4 | **17 行 server 协议类型保留**（`agent/types` 14 + `singleAgent/types` 3，16 文件） | 二者引用 `ToolCall`/`QuestionRequest`/`ToolDefinition`（`@toonflow/tools-scaffold`，属 agent-tools 域）。contracts 在 foundation，下沉会新建 layer violation | ① 冻结 17 行 / 16 文件 / 2 子路径；② 全部 `import type`；③ 若未来 tools-scaffold 归位 foundation 再迁移 | 出现第 3 个 server 子路径时 |
| **E8** | NG9 | **插件产物仅新增 `components` 元数据的取值**（browser 工具由 `[]` 变 `["browserPanel"]`） | 用户机器上已装旧插件，改产物结构会让它们失效 | 只新增取值，格式与既有 `canvas` 一致（C10：`Object.keys(components)` 写入 `string[]`） | 需要改产物结构时 |
| **E9** | R-08 | **插件包内确需保留的字面量**（默认期望为**空集**） | 预置位：若实施发现某条无法常量化，必须登记 `file:line` | 若登记，A-12 的期望相应改为精确集合 | 出现新的插件包 |
| **E10** | R-05/R-08 | **宿主壳（desktop 12 / mobile 5）字面量不纳入本需求** | 属 `desktop-shell` / `mobile-shell`；移动壳非 TS | 只记录计数，不改动 | 宿主壳需要与 contracts 对齐时 |
| **E11** | R-09 | **`lib/tf.ts` 的 `TfResponse<T>` 保留**（外部 API `api.toonflow.net` 的信封） | 不是本应用 API；把它并入 contracts 会把外部服务的信封语义带进 foundation | ① A-15 的期望 `internal=0 / external=1`；② `tf.ts` 不在 R 域内，A-07 不受影响 | 外部 API 信封变更时 |
| **E12** | R-09 | **`lib/anonymousData.ts:145` 的外部遥测调用保留无泛型** | 目标 URL 是 `https://api.toonflow.net/...`，不属本应用 API | ① A-17 期望 `untyped=1` 且该条被具名；② 探针必须打印 file:line 证明「唯一的 1」就是它 | 遥测迁移到内部端点时 |
| **E13** | R-09 | **下载类 `<Blob>` 泛型保留**（`lib/saveFile.ts:77`、`assetDetailDrawer.vue:212` 等） | `responseType: "blob"` 的响应不是 JSON 信封，套 `ApiResponse<T>` 会改变类型语义 | ① 白名单文件+行号；② A-16 只统计「JSON 信封泛型」，不含 `<Blob>` | 下载链路改造时 |
| **E14** | R-09 | **同名但语义不同的 2 个类型在 web 侧改名**（`AssetLibrary` → `AssetLibraryId`；`PluginType` → `MarketPluginType`） | 二者是「同名不同物」，合并不是集中而是错误；改名是消除歧义的最小动作 | ① A-19 要求「同名且定义分歧 = 0」，改名即满足；② 旧名不得在 web 保留别名导出 | web 侧新增同名类型时 |
| **E15** | R-09 | **请求类型的「字段级不完全同构」不在本需求内消除**（server zod 校验与 `ReqXxx` TS 类型的字段可选性/收窄可能不同） | 逐端点比对 zod 与 TS 等价，代价远超本需求；且会改变运行期校验语义 | ① A-18 只要求「具名类型存在 + 调用点带泛型」；② 实施时把发现的差异逐条写入实施报告的「E15 差异清单」，**不改 zod** | 出现运行期 400 与类型不符时 |

## 10. 待评审决策点（Q1–Q13，均有默认值）

| # | 决策 | 选项 | 默认 | 理由 |
| --- | --- | --- | --- | --- |
| **Q1** | 契约包位置 | **A 新建 `packages/contracts`** / B 并入 `packages/formats` / C 放 `apps/web/src/lib` 本地 | **A** | B 让 formats 承载 HTTP 语义，与其「文件/模型格式」定位冲突且已有 5 个 exports；C 无法被 server 与插件复用 |
| **Q2** | 插件 UI 收敛程度 | A 全改动态（含骨架）/ **B 分类处置** / C 只做 nodeShared 迁移 | **B** | A 会让插件编译期失去类型；C 不解决 browser 面板的双轨 |
| **Q3** | server 协议类型 17 行 | **A 保留并冻结（E7）** / B 把 tools-scaffold 类型下沉 foundation 后迁移 | **A** | B 是跨模块层级调整，超出本需求 |
| **Q4** | `toolScaffold/client.ts` 是否改 | **A 改** / B 不改，只在 web 侧对齐 | **A** | 不改则 `/api/tools/client` 仍有一处手写正则；改则只 1 个文件 1 条常量 |
| **Q5** | R-07 服务端收敛范围 | A 只做生产者+MCP 35 / **B 再加 routePrefixes 21（消除 56，保留 16）** / C 连中间件一起（保留 1） | **B** | A 不够（`routePrefixes` 仍是第 3 个副本）；C 会把 `toLowerCase()` 安全判断改坏 |
| **Q6** | A-08 期望值（须与 Q5 一致） | A `handwritten=36` / **B `16`** / C `1` | **B** | 期望值必须由 Q5 唯一决定 |
| **Q7** | `browser` 工具是否改动态 | **A 改（R-05②）** / B 不改（把 `tool-browser/{panel,client}` 登记为 E2 类豁免） | **A** | 不改则「插件 UI 注册表」只覆盖 tool 类的一部分 |
| **Q8** | 是否允许改插件产物元数据取值 | **A 允许新增 `components` 取值** / B 不允许（则 Q7 只能选 B） | **A** | 与既有 `canvas` 机制完全一致（C10） |
| **Q9** | R-08 包内字面量范围 | **A 全部 19 处收敛** / B 只收敛进主包的 12 条路径 / C 不处理 | **A** | B 只堵住「编进主包」，`nodeAi` 其余路径在插件自己运行时仍会漂移 |
| **Q10** | B-1 的修法（R-10） | **A 同包相对路径** / B `AgentEvent` 下沉 contracts / C web tsconfig 加 server 路径映射 | **A** | A 最小且根因正确；C 会把 B-1 的成因制度化 |
| **Q11** | **两侧定义分歧的 2 个载荷类型以哪侧为准** | **A 以 server 为准**（`AssetListOptions` 去掉 web 侧 `AssetSelector` 交集；`ModelsHidden` 改为 server 的可选 `Partial`）/ B 以 web 为准 / C 两个都改名并存 | **A** | web 是消费方，以生产方的结构为准最安全；C 违背「单一来源」 |
| **Q12** | **A-07 的 residual 7 条是否接受** | **A 接受具名集合** / B 要求 residual=0（则必须把 `openUrl`/`exec`/`exec/cancel`/`mobileLink/{heartbeat,pair}` 也做成常量，包括服务端外呼 URL） | **A** | B 需要给服务端主动外呼与服务端内部路由也建常量，超出「客户端契约」范围；且 `mobileLink` 的小写比较刻意存在（E4） |
| **Q13** | **A-14 的 `all_pkg_sources >= 50` 是否可接受** | **A 接受** / B 改为「产物中 `packages/**` 来源文件必须与 M0 逐条相同」 | **A** | B 会让「插件路径归零」与「插件代码仍在主包」耦合，任一正常重构（如 split chunk）都会误判 |

## 11. 评审意见栏

> 使用方式：评审逐条填写。未填写的 Q 项按 §10 默认值执行；未勾选的豁免视为驳回（转验收项）。
> **本轮特别请评审确认三件事**：① §2.4 的契约宇宙定义（`E/HOST/R/W/P/M/D`）是否认可为唯一口径；② A-14 的**来源归因**判据（含 `all_pkg_sources >= 50` 守卫）是否认可；③ R-09 的 5 条判据（A-15～A-19）是否足以判定「请求/响应类型已集中」。

### 11.1 总体结论

| 项 | 填写 |
| --- | --- |
| 评审结论 | ☐ 通过（进入方案与实施） ☐ 打回（见 11.2） |
| 评审人 / 日期 |  |
| 一句话意见 |  |

### 11.2 打回意见（逐条填写）

| # | 意见（可引用章节号） | 严重度 | 期望处置 | 需求方回应 |
| --- | --- | --- | --- | --- |
| 1 |  |  |  |  |
| 2 |  |  |  |  |
| 3 |  |  |  |  |
| 4 |  |  |  |  |
| 5 |  |  |  |  |

### 11.3 决策点裁决（Q1–Q13）

| Q | 默认值 | 评审裁决（采纳默认 / 改选，改选请写明） |
| --- | --- | --- |
| Q1 契约包位置 | A 新建 `packages/contracts` |  |
| Q2 插件 UI 收敛程度 | B 分类处置 |  |
| Q3 server 协议类型 17 行 | A 保留并冻结 |  |
| Q4 `toolScaffold/client.ts` | A 改 |  |
| Q5 R-07 范围 | B（含 routePrefixes，保留 16） |  |
| Q6 A-08 期望值 | B `handwritten=16` |  |
| Q7 `browser` 工具改动态 | A 改 |  |
| Q8 允许改插件元数据取值 | A 允许 |  |
| Q9 包内字面量范围 | A 全部 19 处 |  |
| Q10 B-1 修法 | A 同包相对路径 |  |
| Q11 分歧载荷类型以哪侧为准 | A 以 server 为准 |  |
| Q12 A-07 的 residual 7 条 | A 接受具名集合 |  |
| Q13 A-14 的 `all_pkg_sources >= 50` | A 接受 |  |

### 11.4 豁免裁决（E1–E15）

| 豁免 | 结论（同意 / 驳回→转验收项） | 说明 |
| --- | --- | --- |
| E1 12 个骨架子路径保留静态（41 行 / 34 文件 / 值 25 / 类型 16） |  |  |
| E2 `tool-canvas/runtime` 保留静态 |  |  |
| E3 HOST 4 条宿主端点 |  |  |
| E4 服务端 16 处手写（15 中间件 + 1 生成模板） |  |  |
| E5 `apiRoutes` 150+工厂 |  |  |
| E6 巨型组件不拆 |  |  |
| E7 17 行 server 协议类型 |  |  |
| E8 插件产物仅加 `components` 取值 |  |  |
| E9 插件包内保留字面量（期望空集） |  |  |
| E10 宿主壳字面量不纳入 |  |  |
| E11 `TfResponse` 外部信封保留 |  |  |
| E12 外部遥测调用保留无泛型 |  |  |
| E13 下载类 `<Blob>` 泛型保留 |  |  |
| E14 同名异义类型在 web 侧改名 |  |  |
| E15 请求类型字段级差异不消除 |  |  |

### 11.5 验收勾选（汇总）

| 分组 | 条目 | 结论 |
| --- | --- | --- |
| 契约归零 | A-01、A-02、A-03 | ☐ PASS ☐ FAIL |
| 依赖收缩 | A-04、A-05、A-09、A-10 | ☐ PASS ☐ FAIL |
| URL 与端点一致 | A-06、A-07、A-08 | ☐ PASS ☐ FAIL |
| 插件契约 | A-12、A-14 | ☐ PASS ☐ FAIL |
| 类型集中 | A-15、A-16、A-17、A-18、A-19 | ☐ PASS ☐ FAIL |
| 类型与构建 | A-11、A-13 | ☐ PASS ☐ FAIL |

### 11.6 其他意见（不限格式）

```

```

## 12. 附录

### 12.1 第 2 版打回意见与第 3 版处置对照（速查）

| 打回意见 | 第 2 版的问题形态 | 第 3 版的处置 | 判据 |
| --- | --- | --- | --- |
| A-07 不可达 | 消费侧 144 vs 生产侧 164，`missing=0` 靠口径巧合 | 单一口径宇宙 `R=168`；`D=161`；三条独立等式 + 7 条具名残留 | A-07、§2.4、P7 |
| A-14 坍缩 | 「产物 − 源码声明 = 插件来源」在两集合都空时恒真 | 改为 sourcemap **来源归因**；`pkg_origin_* = 0` + `all_pkg_sources >= 50` 守卫 | A-14、§5.3、P15 |
| R-04 矛盾 | 「21 行纯类型」实为 10 值 + 11 类型 | 拆 R-04a / R-04b；21 行 = 10 + 11；另列冻结 17 行 | §3.2、A-04 |
| 类型集中缺判据 | 只有一句「再导出」 | R-09 + 5 条判据（声明 42→0、内联 39→0、无泛型 30→0、Req 22/22、重复 8→0） | §3.4、A-15～A-19 |

### 12.2 本轮实测的探针输出（M0，用于正控制）

```
P1  occ=131 plain=109 tmpl=22 guard=2 comment=1 files=53
P2  lines=132 ; apiRoutes/apiBase 使用文件=0
P3  静态前缀=20 ; 路径模板族=9 ; 查询串模板=11 ; 守卫=2
P4  static=88 exp=26 tpl=36 W=150 D_web=147
P5  server 38/30/7（值 10/型 28）；插件 17/52/36；骨架 12/40/33（23/17）；实现 5/12/9（8/4）
P6  mounts=163 endpoints=164（POST 81 / GET 51 / PUT 20 / DELETE 10 / PATCH 2）
P7  D=161 E=164 HOST=4 R=168 missing=0 residual=7
P8  19 处 / 6 文件 / 静态去重 14 / 查询串模板 2
P9  ops=32（32/32 在 E 内）
P10 occ=235 files=17 generated=163 handwritten=72（32+21+15+3+1）
P11 包不存在（expect FAIL）
P13 documentFormats / modelReasoning / mentionSources 3/3 IDENTICAL
P14 web typecheck exit 2（1 条 TS2307）/ root typecheck exit 2 / build:web exit 0
P15 pkg_origin_files=4 pkg_origin_paths=12 all_pkg_sources=58
P16 internal=42/26（inline 39 / alias 3）；external=1
P17 total=107 env_inline=39 other_inline=20 named=15 untyped=33（R 域内 30/20 文件；域外 3）
P18 S=32 S_mut=22；web 调用点 22/22；带泛型 4 / 无泛型 16
P19 同名 11（相同 6 / 分歧 5）；载荷子集 8（分歧 2）
P20 closure_files=10 alias_imports=1
P21 apps/web 175 文件 / 42,758 行；产物 434 个 .js，去重 /api 路径 107
```

### 12.3 引用本文件的产物

- 需求矩阵索引：`./INDEX-2026-10.md`
- 方案文档（评审通过后）：`../2_requirements_solutions/<yyyy-MM-dd-hh-mm>-webConsoleContractDecoupling.md`
- 验证报告（实施后）：`../3_test_results/<yyyy-MM-dd-hh-mm>-webConsoleContractDecoupling-impl.md`
- 上一版（被判据替代）：`./2026-10-28-11-18-webConsoleContractDecoupling-v2.md`
- 第 1 版（已被替代）：`./2026-10-28-01-12-webConsoleContractDecoupling.md`
