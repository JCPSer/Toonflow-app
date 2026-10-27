# 方案设计 · server-api 应用子模块拆分（第 2 版 · 第 6 轮打回后重做）

## 0. 文档元信息

| 项 | 内容 |
| --- | --- |
| 文档编号 | **SOL-2026-10-27-02** |
| 对应需求 | `REQ-2026-10-26-06`（`1_requirements_matrix/2026-10-26-23-29-serverApiSubmoduleSplit-v6.md`，第 6 版） |
| 上一版方案 | `SOL-2026-10-27-01`（`2026-10-27-02-12-serverApiSubmoduleSplit.md`）——**第 6 轮评审打回** |
| 需求标题 | server-api 按素材库 / 媒体生成 / 插件市场 / MCP·工作区拆出应用子模块，`app.ts` 只保留组合根与路由装配 |
| 影响模块 | `server-api`（`apps/server`） |
| 方案类型 | 结构性重构（架构整改），**零业务行为变更、零 UI 变动** |
| 编写人 | 方案设计 agent（harness 规则 2.2 执行者） |
| 编写时间 | 2026-10-27 02:41 |
| 代码基线 | 矩阵 B0 = `d084136`；本轮只读复核 HEAD = **`1861cd0`**（`apps/server` 工作树干净） |
| 本轮写回 | 仅新增本文档与 `INDEX-2026-10.md`；**未修改任何源码/测试/脚本** |
| 评审入口 | §9 评审意见栏（留空待填）；§7 待裁决点 D-01～D-05 |

> **引用约定**：`矩阵 §x`、`§A.x`、`§R-xx`、`A-xx`、`Lxx`、`Qxx`、`Exx` 一律指**需求矩阵**（REQ-2026-10-26-06）；**不带前缀的 `§x`** 指本文档自己的章节。
> **阅读顺序**：§1 打回处置（5 分钟）→ §3 两处修复详设（评审重点）→ §2 总体架构 → §4 逐条 R → §5 UI → §7 裁决点 → §9 评审栏。

---

## 1. 本轮打回处置总览

### 1.1 打回意见 → 定性 → 处置 → 落点

| # | 第 6 轮打回意见 | 定性（本版结论） | 本版处置 | 落点 |
| --- | --- | --- | --- | --- |
| 1 | R-07B 把 `addMediaProvider` 从 `pluginMarket` 入口指向**不存在的** `./media/provider` | **上版方案自身缺陷**：把 R-07C 的「目标模块入口公开、来源模块消费」机制，错套到 R-07B 的反方向；矩阵 v6 的 b1–b5s 判据本身正确 | 公开面归 **`mediaGeneration` 入口**；`pluginMarket` 只做**唯一消费点**（`plugins/install.ts:11` 整行替换）；给出 4 条禁止项与 b1–b5s 逐项对齐；验证求值面/环/103 段/lr2/lr4 不受影响 | **§3.1** |
| 2 | `scanBuiltin` 的 `pluginRoots.skill` 与契约字段 `skills` **不一致** | **上版方案自身缺陷**：`PluginRoots`（宿主参数词表：`skills`/`agents`）与内置扫描键（`skill`/`agent`）混用同一「按 key 索引」的写法，且无任何判据能发现 | `PluginRoots` 键名统一到**六类插件词表**（`tool/node/ext/skill/provider/agent`，与 `install.ts` 的 `patterns` 同词表），扫描改为**零映射**；补类型级 `Record` 守卫 + 3 层探针 | **§3.2** |

> 两条打回**均不改需求矩阵的任何期望值**：b1–b5s、A-10（5 键 `Set`）、A-29（`lr1–lr5`）全部原样满足。改的是方案，不是判据。

### 1.2 结论速览（7 条）

1. **采用矩阵默认方案 B**（`src/utils/<域>/**` → `src/modules/<模块>/<域>/**`，`src/routes/**`、`src/lib/**`、`src/types/**` 原地不动）；L2 固定 9 个新文件（7 入口 + 契约 + `lib/mentionSources.ts`）。
2. **R-07B 修正后四条判据可同时成立**：`b1=1`（B0）→ `b3=0`、`b4=0`、`b5=1`（整行逐字）、`b5s=1`；模块级边 `#19 pluginMarket → mediaGeneration` 仍为 1 行，**不新增也不消失**。
3. **`scanBuiltin` 修正后 5 个 builtin 键全部有确定的根目录来源**；上版写法实测会让 `skill`、`agent` 两类**静默变成空集**（§3.2.1 实测 `silent_empty=2`），而现有判据（A-10 只数「5 键 `Set`」）**不会失败**——这是本版新增守卫的直接动因。
4. **新增 3 条方案级发现**：`F-06`（入口 `exports` 数组会把 `b5s`/`c7s` 的 token 计数顶高，实测 2≠1、4≠3）、`F-07`（入口相对 re-export 的**目标存在性**无判据）、`F-08`（`scanBuiltin` 的**非空性**无判据）。三条都给了可执行守卫，且**不新增 A 项**（挂在既有 A-06/A-10/A-19 的证据里）。
5. **`app.ts` 由 160 行降到 ≤80 行**：7 个入口一律**动态 `import()`** 装配（D-01），禁用符号 0 命中，15 步初始化顺序/阻塞性/错误语义逐行保真（§4 R-02/R-03）。
6. **零 UI 变动**：不改端点、不改响应结构、不改静态资源；前端 145 处 `u.*` 与 162 个端点都不依赖服务端内部目录形状（§5 给界面回归清单）。
7. **可回滚**：迁移只用前缀替换 + `typecheck` + 端点清单 diff 三道闸；脚本只在 `/tmp` 执行、不落库（矩阵 A-24）。

### 1.3 本轮只读复核实测（HEAD = `1861cd0`，2026-10-27 02:35–02:45）

| # | 复核项 | 命令（摘要） | 实测 | 矩阵值 |
| --- | --- | --- | --- | --- |
| V1 | 文件 / 行数 | §A.1 口径 glob | **237 / 14,352** | 237 / 14,349（复述 F-01，+3 行漂移） |
| V2 | 路由文件 | `find src/routes -name '*.ts' \| wc -l` | **161** | 161 |
| V3 | 端点 | 锚定式提取（`Router().`/`router.`/`app.`） | **162** = 79 post / 51 get / 20 put / 10 delete / 2 patch | 162 |
| V4 | 深路径 | `grep -rho 'from "@/utils/[a-zA-Z]*'` | **246** | 246 |
| V5 | facade 文件 | `grep -rl 'from "@/utils"'` | **145** | 145 |
| V6 | `app.ts` / `utils.ts` 行数 | `wc -l` | **160 / 75** | 160 / 75 |
| V7 | `utils/**` 内相对 import | `grep -rn 'from "\.\{1,2}/' src/utils` | **21** | 21 |
| V8 | 打回 #1 的正向证据 | `grep -rn 'from "…/media/provider"' src/utils/plugins` | **1**（`plugins/install.ts:11`） | b1=1 |
| V9 | 打回 #1 的反向证据 | `grep … src/utils/media src/routes/{ai,providers,ffmpeg}` | **0** | b2=0 |
| V10 | 打回 #1 的路径证据 | `ls apps/server/src/utils/plugins/` | `ext/initialize/initializeExt/install/nodes/tools` —— **无 `media/`** | 打回成立 |
| V11 | 打回 #2 的行为证据 | 键错位复现脚本（§3.2.1） | `silent_empty=2`（`skill`、`agent`） | — |
| V12 | 发现 F-06 的计数证据 | 模拟入口文件 `grep -c`（§3.3.1） | `b5s: 2≠1`、`c7s: 4≠3` | — |

> 复现命令见**附录 B**（全部只读，脚本写 `/tmp`）。

---

## 2. 总体架构设计

### 2.1 目标目录结构（交付态）

```text
apps/server/src/
├─ app.ts                         # 组合根（≤80 行）：参数归一 → 动态装配 7 入口 → 步骤 1–15
├─ index.ts core.ts router.ts utils.ts   # bootstrap，原地不动
├─ types/module.ts                # 【L2】ServerModule / ModuleContext / PluginType / PluginRoots（仅类型，≤40 行）
├─ lib/mentionSources.ts          # 【L2】MentionQuery + mentionAssetType（R-07A 下沉）
├─ modules/
│  ├─ assetLibrary/     index.ts + assets/**                         (9 + 入口)
│  ├─ mediaGeneration/  index.ts + ai/** media/** ffmpeg/** documents.ts   ← addMediaProvider 在这里（§3.1）
│  ├─ pluginMarket/     index.ts + plugins/** skills/** teams/**
│  ├─ mcpIntegration/   index.ts + mcp/**
│  ├─ localRuntime/     index.ts + workspace/** desktop/** mobileLink/** exec.ts remoteConnection.ts
│  ├─ agentAccess/      index.ts + singleAgent/** sessionState/** browser/**
│  └─ platformCore/     index.ts + conf/** monitor.ts personalization.ts fileHttp.ts
├─ routes/                        # 161 个路由文件，不移动（URL 由路径生成）
├─ agent/                         # 不属本模块；其 50 处 server 说明符跟迁
└─ utils/                         # 交付态为空（`src/utils.ts` 不在该目录）
```

**结构等式（交付态必须成立）**：`bootstrap 9 + 28 + 43 + 50 + 21 + 46 + 27 + 22 = 246 = 237（L1）+ 9（L2）`。

### 2.2 `createApp` 装配流程（交付态，伪代码流程图）

```text
宿主（src/index.ts | desktop | mobile）
   │ createApp({ webRoot, appVersion?, dataDirectory?, toolsRoot?, nodesRoot?, extRoot?,
   │            providersRoot?, skillsRoot?, agentsRoot?, pluginRevision? })   ← 签名逐字不变
   ▼
[0] 参数归一：dataDirectory && (process.env.TOONFLOW_DATA_DIR = resolve(dataDirectory))
   │            ← 必须是任何“会求值 conf”的模块被 import 之前
   ▼
[1] const [A, M, P, C, L, G, K] = await Promise.all(7 个 import("@/modules/<id>"))   ← 动态，见 D-01
   ▼
[2] ctx = { appVersion, dataDirectory,
            pluginRoots: { tool: toolsRoot, node: nodesRoot, ext: extRoot,
                           skill: skillsRoot, provider: providersRoot, agent: agentsRoot },   ← 唯一翻译点（§3.2）
            pluginRevision, syncPluginDirectory: P.syncDirectory }
   ▼
[3] await K.prepare()                     ← conf 动态 import + setLocaleFallback（原 B0:60-62）
   ▼
[4] 步骤 1–7（顺序固定）
   │  1 await P.initializeTools(ctx)        2 await P.initializeNodes(ctx)    3 await P.initializeExt(ctx)
   │  4 await M.initializeProviders(ctx)    5    A.warmup(ctx)（void，内部空 catch）
   │  6 await P.initializeSkills(ctx)       7 await P.initializeAgents(ctx)
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
[9]  await M.refreshModels()              （内部：await import 后 void 刷新 + warn，见 D-06）
[10] await import("@/router"); router.default(app)
[11] await C.mount(app, ctx)              （/mcp，入口内 4 条动态 import）
[12] await G.mount(app, ctx)              （/a2a，入口内 await import("@/agent/a2a")）
[13] app.use(express.static(webRoot))
[14] app.use(errorHandler)
[15] await L.initializeRuntime(app, ctx)  （initializeMobileLinkRuntime）
   ▼
return app
```

> **为什么必须动态装配**（D-01，沿用 F-02 结论）：`pluginMarket`、`mediaGeneration` 两个入口的静态面必然求值 `conf`（`plugins/install.ts:7`、`media/provider.ts:11`）。`app.ts` 一旦静态 `from "@/modules/…"`，`conf` 会在 `TOONFLOW_DATA_DIR` 之前求值 → `f2a/f2b` 直接 FAIL、三宿主数据目录语义破坏。

### 2.3 模块契约（`src/types/module.ts`，修正版，伪代码 ≤40 行）

```text
// —— 词表（本版核心修正：三套键名从此只有两套，且二者同为“插件类型”语义）——
PluginType       = "tool" | "node" | "ext" | "skill" | "provider" | "agent"
                   // 与 plugins/install.ts 的 patterns 六类逐字一致（§3.2）
BuiltinPluginType = "tool" | "node" | "ext" | "skill" | "agent"
                   // = app.locals.builtinPlugins 的 5 键（R-03 步骤 8 / A-10 冻结）；provider 不在其中

PluginRoots = { [K in PluginType]?: string }        // 6 类插件根目录；键名 = PluginType
ModuleContext = {
  appVersion: string
  dataDirectory?: string
  pluginRoots: PluginRoots
  pluginRevision?: string
  syncPluginDirectory?(target, source, fileFilter?: RegExp | readonly string[], revision?): Promise<void>
}                                                   // 由 app.ts 注入（值取 pluginMarket.syncDirectory）

ServerModule = {
  id: "assetLibrary" | "mediaGeneration" | "pluginMarket" | "mcpIntegration"
    | "localRuntime" | "agentAccess" | "platformCore"
  routePrefixes: readonly string[]                  // 只放 21 个 /api/* 前缀，并集两两无交集
  gateways?: readonly string[]                       // 非 /api 挂载点：/mcp、/a2a
  dependencies: readonly string[]                    // 附录 C 白名单子集，不含 bootstrap
  exports: readonly string[]                         // 【语义见 D-04】= app.ts 的调用面，不是全部公开符号
  initialize?(context): Promise<void>
  warmup?(context): void                             // 仅 assetLibrary：同步签名、fire-and-forget
  mount?(app, context): Promise<void>
  syncDirectory?(...): Promise<void>                 // 仅 pluginMarket
}
```

**本版相对上一版的三处修正**（对应两条打回 + 一条自查）：

| 项 | 上一版（被驳回） | 本版 | 依据 |
| --- | --- | --- | --- |
| `PluginRoots` 键 | `{ tool, node, ext, providers, skills, agent }`（宿主参数词表） | `{ tool, node, ext, skill, provider, agent }`（**插件类型词表**） | §3.2：两套词表混用导致 `scanBuiltin` 索引错位，静默空集 |
| `scanBuiltin` 实现 | `for type of [tool,node,ext,skill,agent]: roots[type]` | 同一词表下 `roots[type]` **零映射**（`BuiltinPluginType ⊂ PluginType`） | §3.2.2 |
| 入口公开面 | `pluginMarket` 入口 `export { addMediaProvider } from "./media/provider"`（文件不存在） | `mediaGeneration` 入口公开；`pluginMarket` 只消费 | §3.1 |
| `exports` 字段语义 | 「入口对外公开的**全部**符号名」 | 「**app.ts 的调用面**」（编排钩子），公开面由 `export … from` 语句本身表达 | §3.3 F-06（否则 `b5s`/`c7s` 计数必挂） |

### 2.4 7 个入口一览（含公开面与归属，`§3.1` 修正后的最终形态）

| # | 入口 | routePrefixes | gateways | dependencies（20 条边子集） | **公开面**（`export … from`/具名导出） | `exports`（app.ts 调用面） |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `assetLibrary` | `/api/assets` | — | localRuntime, mediaGeneration, platformCore | `warmup` | `warmup` |
| 2 | `mediaGeneration` | `/api/ai` `/api/ffmpeg` `/api/providers` | — | localRuntime, platformCore | **`addMediaProvider`（`./media/provider`）**、`initializeProviders`、`refreshModels` | `initializeProviders`, `refreshModels` |
| 3 | `pluginMarket` | `/api/tools` `/api/nodes` `/api/ext` `/api/skills` `/api/agents` `/api/plugins` | — | localRuntime, mediaGeneration, platformCore | `decodeText/skillPath/skillZip`（`./plugins/install`）、`listTools`（`./plugins/tools`）、`skillFiles`（`./skills/files`）、`syncDirectory`（`./plugins/initialize`）、`initializeTools/…/initializeAgents/scanBuiltin` | `syncDirectory`, `initializeTools`, `initializeNodes`, `initializeExt`, `initializeSkills`, `initializeAgents`, `scanBuiltin` |
| 4 | `mcpIntegration` | `/api/mcp` | `/mcp` | localRuntime, mediaGeneration, platformCore, pluginMarket | `mount` | `mount` |
| 5 | `localRuntime` | `/api/workspaces` `/api/desktop` `/api/exec` `/api/mobileLink` | — | assetLibrary, mediaGeneration, platformCore | `initializeRuntime` | `initializeRuntime` |
| 6 | `agentAccess` | `/api/agent` `/api/browser` `/api/sessionState` `/api/singleAgent` | `/a2a` | platformCore, pluginMarket | `mount` | `mount` |
| 7 | `platformCore` | `/api/settings` `/api/monitor` | — | localRuntime, mediaGeneration | `prepare`, `corsGuard` | `prepare`, `corsGuard` |

**形态约束（A-29 的实现前提）**：入口对**自家域内**文件只用 `./…` 相对路径；入口内**不得**出现 `@/modules/<自己>`（`lr3`）与 `@/modules/<其他>`（`lr4`）。跨模块一律「由 `app.ts` 装配」或「由来源模块的**域文件** import 目标模块入口」（如 `plugins/install.ts` → `@/modules/mediaGeneration`，见 §3.1.4）。

### 2.5 迁移映射（矩阵 §1.6.2 SPEC 执行摘要）

| 模块 | 来源（B0） | 目标（F） | 文件数（含不移动的路由） |
| --- | --- | --- | --- |
| assetLibrary | `utils/assets/**` | `modules/assetLibrary/assets/**` | 27（域 9 + routes/assets 18） |
| mediaGeneration | `utils/{ai,media,ffmpeg}/**`、`utils/documents.ts` | `modules/mediaGeneration/{ai,media,ffmpeg}/**`、`documents.ts` | 42 |
| pluginMarket | `utils/{plugins,skills,teams}/**` | `modules/pluginMarket/{plugins,skills,teams}/**` | 49 |
| mcpIntegration | `utils/mcp/**` | `modules/mcpIntegration/mcp/**` | 20 |
| localRuntime | `utils/{workspace,desktop,mobileLink}/**`、`utils/exec.ts`、`src/remoteConnection.ts` | `modules/localRuntime/…` | 45 |
| agentAccess | `utils/{singleAgent,sessionState,browser}/**` | `modules/agentAccess/…` | 26 |
| platformCore | `utils/conf/**`、`utils/{monitor,personalization,fileHttp}.ts` | `modules/platformCore/…` | 20 |
| bootstrap | 5 个根文件 + `scripts/**` + `types/module.ts` | 原地 + 1 契约 | 8 → 9 |

> 迁移只做**前缀替换**（`@/utils/<域>` → `@/modules/<模块>/<域>`），不改导入形态；`src/agent/**` 的 50 处说明符同步替换（文件本身不移动）。两处相对路径深度补偿见 §4 R-04/R-15。

---

## 3. 打回项修复详设（评审重点）

### 3.1 打回 #1｜R-07B：`addMediaProvider` 的归属与公开面

#### 3.1.1 事实与证据

| 事实 | 证据 |
| --- | --- |
| `addMediaProvider` 的**定义**在 `utils/media/provider.ts:280`，所属模块 = **mediaGeneration** | `export async function addMediaProvider(source: string)` |
| 全仓**唯一**的跨域消费点是 `utils/plugins/install.ts:11`（所属模块 = pluginMarket） | `import { addMediaProvider } from "@/utils/media/provider";`（b1=1，实测） |
| 反向零消费（mediaGeneration 不引 pluginMarket） | b2=0（实测） |
| `utils/plugins/` 下**没有** `media/` 子目录 | `ls` 实测：`ext/initialize/initializeExt/install/nodes/tools` |
| 另有两处「同名但不是同一条边」 | `media/provider.ts:280`（定义，模块内）；`mcp/operations.ts:105`（字符串常量，不 import）；`routes/providers/media/add.ts:8` 走 facade `u.mediaProvider`（R-06 冻结，不属本边） |

**上一版方案的错误写法**：

```text
pluginMarket/index.ts：export { addMediaProvider } from "./media/provider"   ← ❌ 该文件在 pluginMarket 下不存在
plugins/install.ts：   import { addMediaProvider } from "@/modules/pluginMarket"  ← ❌ 与 b5 的整行期望相反
```

三重失败后果：① 目标路径 `./media/provider` 在 pluginMarket 下不存在 → `typecheck` 失败（A-19）；② `lr2/lr4` 语义上把「跨模块」写成「自家域」，`b5` 整行不匹配、`b5s`（mediaGeneration 入口须公开该符号）= 0；③ 把 R-07C 的机制（**目标模块入口公开、来源模块消费**）错套成「来源模块自己公开、自己消费」，等于把边 B 抹掉而不是契约化。

#### 3.1.2 修正方案（唯一正确形态）

```text
① mediaGeneration/index.ts（公开面，1 行）：
     export { addMediaProvider } from "./media/provider"        // 相对路径 → lr2 达标（REL 正则同时匹配 export…from）

② pluginMarket/plugins/install.ts:11（消费点，整行逐字替换，1:1）：
     import { addMediaProvider } from "@/modules/mediaGeneration";

③ pluginMarket/index.ts：**不得**出现 addMediaProvider（任何形态）

④ app.ts：**不得**静态 import mediaGeneration（D-01：7 个入口全部动态）
```

**逐判据对齐**（矩阵 §A.7.2，全部无需修改）：

| label | 判据 | 期望 | 本方案如何满足 |
| --- | --- | --- | --- |
| `b1` | B0：`plugins/` 内 `from "…/media/provider"` | 1 | 实测 1（`install.ts:11`） |
| `b2` | B0 反向 | 0 | 实测 0 |
| `b3` | F 反向（联合模式，`scope_min=32`） | 0 | mediaGeneration 全部域文件均不引 pluginMarket（含 `ai/**`：本轮 `grep` 实测 0，见 §3.1.5） |
| `b4` | F 前向深路径（`scope_min=6`） | 0 | `install.ts` 该行改为入口引用，`plugins/**` 内无其它深路径 |
| `b5` | F 入口引用 | 1，且**整行**为 `import { addMediaProvider } from "@/modules/mediaGeneration";` | 唯一消费点整行替换；不合并其它符号（否则整行不等） |
| `b5s` | F `mediaGeneration/index.ts` 内 `addMediaProvider` 行数 | **1** | 只有公开面那一行；`exports` 数组**不列**该名（F-06，§3.3） |

#### 3.1.3 可行性验证（四个「会不会崩」的问题，逐个回答）

| 风险 | 结论 | 论证 |
| --- | --- | --- |
| 会不会形成 `pluginMarket ⇄ mediaGeneration` 环？ | **不会** | `install.ts`（域文件）→ mediaGeneration **入口**；mediaGeneration 侧对 pluginMarket 的边为 0（`#19` 只有单向 1 行）；`utils/{ai,media,ffmpeg}` 内按「引用 plugins / skills / teams」三词 grep 实测 0 命中 |
| 会不会提前求值 `conf` / 改变求值顺序？ | **不会** | B0 的 `install.ts:11` **已经**静态求值 `media/provider.ts`；改后唯一新增求值单元是入口文件本身（只含函数声明 + 常量对象），求值面 = B0 ∪ {入口} |
| 会不会破坏 A.3 ③ 的 `103` 段？ | **不会** | 该段统计 `src/modules/**` 内 `from "@/modules/[a-zA-Z]*` 的行数；B0 的同一行原本计在 `@/utils` 的 103 段里，1:1 替换后仍计 1 行 |
| 会不会触碰 A-29？ | **不会，反而更稳** | `lr2`（mediaGeneration 需 ≥1 处相对 import）由 ① 直接满足；`lr3/lr4=0` 由「入口不引其它模块」保证；消费点在域文件、不在入口 |

#### 3.1.4 显式禁止项（写进实施 checklist，M2 出口条件）

1. `pluginMarket/index.ts` **禁止**出现 `addMediaProvider`；
2. `modules/pluginMarket/**` 内 **禁止**出现 `./media/…` 或 `@/modules/pluginMarket/media/…` 形式；
3. `plugins/install.ts:11` **禁止**与其它符号合并成多符号 import（b5 要求整行逐字）；
4. `mediaGeneration/index.ts` 的 `exports` 数组 **禁止**列 `addMediaProvider`（b5s 计数，见 §3.3 F-06）。

#### 3.1.5 本轮补充实测（支撑上表 b3）

```bash
grep -rn 'from "@/utils/\(plugins\|skills\|teams\)' apps/server/src/utils/ai \
        apps/server/src/utils/media apps/server/src/utils/ffmpeg      # 0 命中
```

---

### 3.2 打回 #2｜`scanBuiltin` 的键名与 `PluginRoots` 字段不一致

#### 3.2.1 事实、根因与危害（含实测）

**B0 的真实键名（两套词表，来源不同）**：

| 词表 | 内容 | 来源 |
| --- | --- | --- |
| **宿主参数** | `toolsRoot / nodesRoot / extRoot / providersRoot / skillsRoot / agentsRoot` | `app.ts` 的 `createApp` 形参（三宿主调用） |
| **内置扫描键** | `tool / node / ext / skill / agent`（**5 键**） | `app.ts:96` 的字面量对象 + `builtinPlugins` 的 5 个消费者（`routes/{tools/get,nodes/get,ext/list,agents/get,skills/get}.ts`） |
| **安装类型** | `node / ext / tool / skill / provider / agent`（**6 类**） | `plugins/install.ts:436` 的 `patterns`（含 `provider`） |

上一版把 `PluginRoots` 写成宿主参数词表（`skills`/`agents`），却用扫描键去索引（`pluginRoots[type]`，`type ∈ {tool,node,ext,skill,agent}`）→ `roots.skill`、`roots.agent` 为 `undefined`。

**实测（复现脚本，`/tmp` 执行，§附录 B）**：

```text
契约键: ['agents','ext','node','providers','skills','tool']
扫描键: ['tool','node','ext','skill','agent']
结果:   { tool:T, node:N, ext:E, skill:<EMPTY>, agent:<EMPTY> }
silent_empty = 2
```

**危害等级：高（静默）**。后果是 `builtinPlugins.skill` / `.agent` 恒为空集 → `GET /api/skills/list`、`GET /api/agents/get` 里所有内置技能/团队都显示为「非内置」（前端徽标消失、内置项可被误删）。而现有判据**全部仍会 PASS**：A-10 只判「5 键 + 值为 `Set`」，S7/S8 只判「与基线一致」（基线本身也可为空）。→ 这正是必须在本版**补守卫**的理由（§3.3 F-08）。

#### 3.2.2 修正方案：单一词表 + 零映射 + 三层守卫

```text
// ① 词表统一（src/types/module.ts）
PluginType        = "tool" | "node" | "ext" | "skill" | "provider" | "agent"    // 6 类 = install.ts patterns
BuiltinPluginType = Exclude<PluginType, "provider">                            // 5 类 = builtinPlugins 键
PluginRoots       = { [K in PluginType]?: string }                             // 字段名 = PluginType

// ② app.ts 的唯一翻译点（6 个赋值，一眼可审）
pluginRoots = { tool: toolsRoot, node: nodesRoot, ext: extRoot,
                skill: skillsRoot, provider: providersRoot, agent: agentsRoot }

// ③ scanBuiltin 实现（放在既有文件 modules/pluginMarket/plugins/initialize.ts，不新增文件）
const BUILTIN_TYPES = ["tool","node","ext","skill","agent"] as const satisfies readonly BuiltinPluginType[]
scanBuiltin(roots: PluginRoots):
   entries = await Promise.all(BUILTIN_TYPES.map(async type => {
       root = roots[type]                       // ← 键名同词表：不存在 skills/agents 这类“近义词”
       if (!root) return [type, new Set()]
       list = readdir(root, { withFileTypes: true }).catch(ENOENT → [], 其它 errno 抛出)
       names = (type === "skill" || type === "agent") ? 目录名 : 文件名按 pattern 过滤后去后缀
       return [type, new Set(names)]
   }))
   return Object.fromEntries(entries)           // 返回 Record<BuiltinPluginType, Set<string>>

// ④ 入口只留 1 行调用（≤60 行预算）
export const scanBuiltin = (context) => scanBuiltinIn(context.pluginRoots)
```

**为什么「零映射」比「显式映射表」更稳**：打回的本质是**用 A 词表的键去查 B 词表的对象**。若保留两套词表 + 映射表，任何一次改名都要同步三处（类型、映射、调用）；把 `PluginRoots` 直接键在插件类型上，索引表达式退化为 `roots[type]`（同一变量），**类型检查器就能守住**：`roots` 的键集合 = `PluginType`，而 `type: BuiltinPluginType ⊂ PluginType`，任何一侧改名都会让 `satisfies` / 索引处 `typecheck` 报错（A-19）。

#### 3.2.3 三层守卫（不改任何 A 项期望）

| 层 | 守卫 | 形态 | 期望 | 归属 |
| --- | --- | --- | --- | --- |
| 类型层 | `PluginRoots` 键来自 `PluginType`；`BUILTIN_TYPES` 用 `satisfies readonly BuiltinPluginType[]`；`scanBuiltin` 返回 `Record<BuiltinPluginType, Set<string>>` | 编译期 | `bun run typecheck` 通过；把 `skill` 改成 `skills` → 编译失败 | A-19（M2 出口条件） |
| 结构层 | `s1`：`app.ts` 的 `pluginRoots` 字面量键集合 = 6 项；`s2`：`initialize.ts` 的键访问集合 ⊆ 6 项，且**不含** `skills/agents/providers` 这类近义词 | `grep` + `/tmp` 脚本 | `s1_keys=6 s2_keys=6 near_miss=0` | A-06/A-10 的补充证据（M2/M7） |
| 行为层 | `s3`：**同一份 fixture** 下，B0（`createApp` 后 dump `builtinPlugins`）与 F（`scanBuiltin`）的 5 个 `Set` **size 与成员逐字相等**，且每个提供根的类别 `size ≥ 1` | 运行时探针（扩展矩阵 `f5` 探针） | `s3_keys=5 s3_nonempty=5 s3_diff=0` | A-10 的补充证据（M1 基线 / M7 判定） |

> `s3` 是**两相可比**的：B0 侧不需要 `scanBuiltin` 这个符号，只要能 dump `app.locals.builtinPlugins` 的 5 个 `Set`；矩阵 `f5` 探针已经在读 `builtin_keys=tool,node,ext,skill,agent`，只需把 values 的 `size` 一并打印。

#### 3.2.4 显式禁止项

1. `PluginRoots` **禁止**出现 `skills`/`agents`/`providers` 等宿主参数名（它们是 `createApp` 形参名，不是插件类型）；
2. `scanBuiltin` **禁止**使用函数内局部映射表或字符串拼接（如 `type + "s"`）来取根目录；
3. `app.ts` 的 `pluginRoots` 字面量 **禁止**用展开/动态计算（必须 6 个显式键，`s1` 才能判定）；
4. `builtinPlugins` 的**键名与数量**冻结为 5 个（`A-10`）；`provider` 只进 `PluginRoots`，不进 `builtinPlugins`。

---

### 3.3 本轮自查发现（非打回意见，但同属「方案会踩空」的缺陷）

#### 3.3.1 `F-06`：入口 `exports` 数组会把 `b5s`/`c7s` 的 token 计数顶高（实测必挂）

矩阵的 `b5s`/`c7s` 是 `file_count`（`grep -c`，**按行**计）：

```text
b5s: file_count 1 'addMediaProvider'        modules/mediaGeneration/index.ts
c7s: file_count 3 '(decodeText|listTools|skillFiles)'  modules/pluginMarket/index.ts
```

上一版把「入口对外公开的全部符号名」都列进 `ServerModule.exports` → 同一符号在入口出现 **2 次**（re-export 行 + `exports` 数组）。**模拟实测**（`/tmp`）：

| 写法 | `b5s` | `c7s` |
| --- | --- | --- |
| 上一版语义（`exports` 列全部公开符号） | **2**（期望 1）❌ | **4**（期望 3）❌ |
| 本版语义（`exports` = app.ts 调用面） | **1** ✅ | **3** ✅ |

**修正（D-04）**：`ServerModule.exports` 的语义收窄为「**`app.ts` 的调用面**（编排钩子）」，公开面由 `export { … } from "./…"` 语句自身表达（其存在性由 `c9`、`b5s`、`A-19 typecheck` 三重保证）。该语义与 A-06「字段齐全」不冲突，也不改变任何期望值。

#### 3.3.2 `F-07`：入口相对 re-export 的「目标存在性」没有判据

`A-29` 的 `lr1` 只校验 **9 个 L2 文件存在**，不校验入口内 `from "./…"` 的**目标文件**是否是它自己模块里的真实路径（R-07B 的 `./media/provider` 正是这一类）。虽然 `typecheck`（A-19）最终会报错，但**晚且粗**。
**修正**：M2 出口条件新增 `s4`（只读脚本）：对 7 个入口内所有 `from "…"` 说明符解析到绝对路径并断言文件存在，输出 `s4_specifiers=N s4_missing=0`。不新增 A 项（并入 A-19 的 M2 前移检查）。

#### 3.3.3 `F-08`：`builtinPlugins` 的**非空性**没有判据

`A-10` 的期望是「5 键、值为 `Set`」——空 `Set` 也 PASS。B0 行为里，只要宿主给了 `skillsRoot`，`builtinPlugins.skill` 就必然非空（B0:95-106 用的是 5 个真实根）。上版的键错位正是「判据全绿、功能已坏」。
**修正**：并入 §3.2.3 的 `s3`（M1 基线 / M7 判定），不改 A-10 期望值，只在证据里补「非空 + 与 B0 逐字相等」两列。

#### 3.3.4 `F-01` 复述：基线行数漂移（上一版已登记，本版未消除）

HEAD `1861cd0` 实测 **237 / 14,352**，矩阵 B0（`d084136`）为 237 / 14,349。差异来自 canvas「节点引用」提交对 `routes/agent/mentionSource.ts` 的 +5/−2。**处置**：M0 以「实施开始时 HEAD」重新冻结，`L02`、`L23`、`agentAccess` 行数三项按 `+Δ` 同步；**所有结构性判据（237/9/246、161/162/21、145、246 深路径、20 条边）在 HEAD 上逐项复现**（§1.3 V1–V7），故不影响方案。

### 3.4 设计决策汇总（D 项）

| ID | 决策 | 依据 | 需评审 |
| --- | --- | --- | --- |
| **D-01** | `app.ts` 用 **7 个动态 `import("@/modules/<id>")`** 装配；A.3 ③ 的 `app.ts` 段期望 0（合计 245）+ 另立「装配 7 入口」正向判据 | 矩阵 A.3 ③ 的 7 个 `from` 与 A-08 静态导入边界互斥（F-02） | ☑ |
| **D-02** | R-07D 用「**单行混合 import**」（`import conf, { type RemoteTeam } from …`）而非新增 re-export 行 | 否则 `d4` 4→6、A.3 的 103 段 103→105（F-04） | ☑ |
| **D-03** | `ModuleContext` 增 `pluginRoots`/`pluginRevision`，`ServerModule` 增 `gateways`；新增具名导出 `prepare`/`initializeRuntime` | 15 步初始化与 `/mcp`·`/a2a` 归属需要（F-03）；**键名按本版 §3.2 修正** | ☑ |
| **D-04** | `ServerModule.exports` 语义 = 「app.ts 调用面」 | F-06（`b5s`/`c7s` 计数） | ☑ |
| **D-05** | 步骤 9 在 `app.ts` 写 `await M.refreshModels()`；函数体内部 `await import("./ai/initialize")` 后 `void 初始化().catch(warn)` | 保真 B0：「import 失败 → `createApp` reject」「刷新失败 → warn 且不阻塞」两种语义不能合并 | ☑ |

> D-06（沿用）：`corsOriginAllowed`+`prepare` 下沉 `platformCore`；D-07：`scanBuiltin` 实现在既有 `plugins/initialize.ts`（不新增文件）；D-08：路由分组注释由 `core.ts` 生成器产出；D-09：迁移用一次性 prefix 替换脚本 + `typecheck` + 端点清单 diff，脚本不落库。

---

## 4. 子需求详细方案

> 每条固定四段：**背景 → 目标 → 描述 → 详细方案设计**；末尾给「验收对应 / 风险与回滚」。伪代码只表达结构与顺序。

### R-01 模块契约对象与 7 个应用子模块入口（P0）

- **背景**：现状只有目录名，没有「模块入口」；地图把 237 文件登记为 1 个模块（`god_module`，score 50），跨域调用无法从结构上判定归属。
- **目标**：7 个入口各 ≤60 行，各自声明职责/前缀/网关/依赖/导出/钩子；入口不承载业务实现。
- **描述**：契约见 §2.3；入口组织规则 R1-1～R1-6（自家域 `./`；无自引用 alias；无跨模块 alias；`assets/thumb` 必须动态；`@/agent/a2a` 必须动态；MCP 4 条 import 必须动态且写在 `mount` 内）。
- **详细方案设计**：
  ```text
  import type { ServerModule, ModuleContext } from "@/types/module"     // type-only
  <公开面：export … from "./<自家域>"，逐条与 c9/b5s 对齐>
  <钩子实现：initialize/mount/warmup/syncDirectory，必要时下沉到自家域既有文件>
  const module: ServerModule = { id, routePrefixes, gateways?, dependencies, exports, …钩子 }
  export default module
  ```
  - `routePrefixes` 并集必须**逐字等于** §3.6 的 21 项且两两无交集；`/mcp`、`/a2a` 只出现在 `gateways`（不塞进 `routePrefixes`，否则并集变 23 项直接 FAIL）。
  - `exports` 按 D-04 只列 app.ts 调用面（§2.4 最后一列）。
- **验收对应**：A-06、A-07、A-18、A-29（`lr1–lr5`）；补充 `s1`（§3.2.3）。
- **风险与回滚**：入口与目录脱节 → `routePrefixes` 反向对账 + `dependencies` 与实际 import 对账；入口超 60 行 → 实现体下沉既有域文件（D-07 同原则）。

### R-02 `app.ts` 瘦身为组合根（P0）

- **背景**：`app.ts` 160 行里混写参数归一、6 类插件初始化、供应商哈希、缩略图预热、模型刷新、MCP/A2A 构造、静态与错误处理、移动互联；各自阻塞性不同。
- **目标**：`app.ts` ≤80 行；禁用符号 0 命中；7 项中间件顺序可判；`createApp` 签名/返回值逐字不变。
- **描述**：只保留 5 件事——参数归一、动态装配 7 入口、8 项初始化调用（步骤 1–8）、7 项中间件、步骤 9–15。
- **详细方案设计**（结构见 §2.2）：`pluginRoots` 的 6 个赋值是**唯一**把 `createApp` 形参翻译成插件类型的点（§3.2.2 ②）；`syncPluginDirectory` 由 `P.syncDirectory` 注入；`app.locals.builtinPlugins` 只保留 1 处赋值。
- **验收对应**：A-08（≤80、禁用符号 0、`builtinPlugins` 1 处）、A-09、A-25（`f2a/f2b`）、A-26（`g5` 行号递增）。
- **风险与回滚**：数据目录时序 → 动态装配 + `prepare` 内动态 `conf`；中间件顺序 → 写成显式有序块并 `grep -n` 校验。

### R-03 初始化 15 步归口与「顺序 + 阻塞性 + 错误语义」（P0）

- **背景**：15 步的顺序/阻塞性/吞错语义各不相同，且 5 组路由消费 `builtinPlugins`。
- **目标**：15 步全部归口；每步锚点（B0 行号）、阻塞性、错误语义逐项可核对。
- **描述**：顺序表见矩阵 §R-03；本版**新增**两处与本轮修复相关的实现细节：
  ```text
  步骤 4 initializeProviders(ctx)：
     guard: ctx.dataDirectory && ctx.pluginRoots.provider          ← 键名 = "provider"（§3.2）
     source = resolve(ctx.pluginRoots.provider, "media")
     revision = ctx.pluginRevision ?? sha256(4 个内置文件，ENOENT→空 Buffer，其它 errno 抛出)
     await ctx.syncPluginDirectory(resolve(dataDirectory,"providers"), source, [4 个文件名], revision)
  步骤 8 scanBuiltin(ctx)：
     5 键 = BUILTIN_TYPES；roots 按同一词表索引（§3.2.2 ③）；readdir ENOENT→[]、其它 errno 抛出
  步骤 9 refreshModels()：
     入口内 `await import("./ai/initialize")`（失败 → createApp reject）
     随后 `void initializeProviderModels().catch(error => console.warn("启动时刷新供应商模型失败：", error))`
  ```
- **详细方案设计**：步骤 5（`assetLibrary.warmup`）保持「同步签名 + `void import("./assets/thumb")` + 空 `catch(() => {})`」，**禁止**与步骤 9 合并成同一个 helper（R17）。
- **验收对应**：A-10（5 键 `Set` + 顺序 + 锚点）、A-25（`f1a–f1d`、`f4/f5`）、A-26（`g1–g6`）；补充 `s3`（非空性 + 与 B0 逐字相等）。
- **风险与回滚**：把「静默吞错」改成带日志、或把 `void` 改成 `await` → `g1/g3` 立即 FAIL；`scanBuiltin` 键名漂移 → `s2` + `typecheck` 双杀。

### R-04 服务目录模块化（P0）

- **背景**：15 个 `utils/*` 子域、246 处深路径、145 处 facade 引用；`utils/plugins/install.ts`（450 行）等大文件集中在 pluginMarket。
- **目标**：`src/utils/**` 只留 `src/utils.ts`（facade）；7 个模块目录成形；246 处深路径一处不漏；`@/utils/` 深路径归零。
- **描述**：按 SPEC 逐目录迁移，只替换前缀不改形态；包含 `src/agent/**` 的 50 处说明符更新；`src/routes/**`、`src/lib/**`、`src/types/**` 不动。
- **详细方案设计**：
  ```text
  for (old, new) in SPEC 映射:
      git mv <old> <new>                                  // 保留历史
  for 每个 .ts 文件:
      替换 "@/utils/<域>" → "@/modules/<模块>/<域>"        // 只改前缀；不动 import 形态
  两处相对路径深度补偿（不得改 alias，否则 f2c/边计数失真）：
      utils/singleAgent/types.ts:2   "../../agent/runtime/types" → "../../../agent/runtime/types"
      src/index.ts:3                 "../../../electrobun.config"  不变
  三道闸：typecheck → 端点 method+path diff → A.3 深路径分段计数
  ```
- **验收对应**：A-01/A-02/A-03（台账）、A-13（`f2c=2`）、§A.3 ①②③⑤。
- **风险与回滚**：漏改一处 → `typecheck` 失败（TS 解析 alias）；误改形态 → `f2c` 变 3。

### R-05 路由装配分组（P1｜默认豁免 E4）

- **背景**：`router.ts` 327 行 / 161 条扁平 `app.use`，由 `core.ts` 在 dev 下按 `routes/**` 目录重写。
- **目标**：按模块分组可读；**URL 与端点数量不变**。
- **描述**：默认保留 161 条挂载（E4），只在生成器里加分组注释与空行；不新增路由分组文件。
- **详细方案设计**：`core.ts` 的生成器按「模块 → 前缀」输出注释块（注释行**不得**含 `app.use` 字面量，否则 A.11 的挂载计数会变）；`router.ts` 每次 dev 启动重写，故任何手写注释都会被覆盖。
- **验收对应**：A-11（161/162）、A-07（21 前缀）；E4 豁免表。
- **风险与回滚**：分组导致挂载顺序变化 → `router.ts` 全文 diff（M0 冻结）比对。

### R-06 聚合入口 `utils.ts` 收敛为薄 facade（P1｜部分豁免 E2）

- **背景**：`utils.ts` 75 行 / 37 出口 / 5 个来自 `@/agent`，是 bootstrap 枢纽环（E12）。
- **目标**：调用面冻结（145 个文件不变），内部路径跟迁；`@/agent` 5 个出口保留（E2）。
- **描述**：只改 30 条 `from "@/utils/<域>"` 的目标前缀，不改 `export * as` 结构；`mediaProvider` namespace 保留（`routes/providers/media/add.ts:8` 等 4 处消费）。
- **详细方案设计**：`import * as mediaProvider from "@/modules/mediaGeneration/media/provider"`（**域文件**，不是入口）——保持 routes 侧 `u.mediaProvider.addMediaProvider` 不变，且不引入 facade → 入口 → 域的多余层。
- **验收对应**：A.3 ④（145）、A-12（14 exports）、E2/E12。
- **风险与回滚**：facade 出口少一个 → 145 个文件里的 `u.xxx` 崩；用 `typecheck` + 145 计数双保险。

### R-07 跨域依赖边 A–D（P0）

- **背景**：4 类隐式跨域调用（详见矩阵 §R-07 表）。
- **目标**：A 的 4 处归零；B/C 深路径归零改公开入口；D 的 2 条 type 边归零且反向 4 条 value 不变。
- **描述与详细方案设计**：
  **(A) `mentionSources` 下沉**
  ```text
  新建 src/lib/mentionSources.ts（≤30 行）：MentionQuery（type）+ mentionAssetType（纯路径判定）
  agent/mentionSources.ts：改为 `export type { MentionQuery } from "../lib/mentionSources"`
                            `export { mentionAssetType } from "../lib/mentionSources"`
  4 处调用点改指 @/lib/mentionSources：assetLibrary/assets/{index,library,thumb}.ts、routes/workspaces/files/thumb.ts
  ```
  **(B) `pluginMarket → mediaGeneration`（本轮修正项）**：见 §3.1；公开面在 **mediaGeneration** 入口，消费点唯一。
  **(C) `mcpIntegration → pluginMarket`**
  ```text
  pluginMarket/index.ts：export { decodeText, skillPath, skillZip } from "./plugins/install"   // c9 逐字
                        export { listTools } from "./plugins/tools"
                        export * as skillFiles from "./skills/files"
  mcp/{dxt,tools,resources}.ts：改指 @/modules/pluginMarket（resources 用 `{ skillFiles as skillFile }` 保持 7 处调用面）
  ```
  **(D) `conf ↔ teams/mobileLink` 的 type 环（D-02）**
  ```text
  platformCore/conf/index.ts：删 2 条 type import，在本文件定义 RemoteTeam / MobileLinkConfig
  pluginMarket/teams/index.ts:5   → import conf, { type RemoteTeam } from "@/modules/platformCore/conf"
  localRuntime/mobileLink/index.ts:10 → import conf, { type MobileLinkConfig } from "@/modules/platformCore/conf"
  （单行混合 import：行数不变 → d3=0 且 d4=4 同时成立）
  ```
- **验收对应**：A-13（`a1=4→a2=0`、`a3` 三段）、A-14（`b1..b5s`）、A-15（`c1..c9`）、A-16（`d1..d5`）。
- **风险与回滚**：`agent/mentionSources` 外部契约 → 保留原路径 re-export + 桌面冒烟；B 边误把公开面放回 pluginMarket → `b5s=0` 立即 FAIL；C 边 namespace 别名写错 → `c8a` 由 7 变 0。

### R-07E `dxt ↔ servers` 模块内环（P2｜默认 E11）

- **背景**：B0 的 2 个 file 级 SCC 之一，R-07D 后唯一残留（`size=2`）。
- **目标**：冻结 2 条边（两相各 1）；文件内 0 处相对 import；`scc_count=1,size=2`。
- **描述**：两函数互为兜底清理，独立第三方模块只增加无业务含义抽象。
- **详细方案设计**：迁移后 `modules/mcpIntegration/mcp/{dxt,servers}.ts` 互引**保持 alias**（`@/modules/mcpIntegration/mcp/servers` ↔ `…/dxt`）；**禁止**改成 `./servers`/`./dxt`（会让 `e5a/e5b` 由 0 变 1）。
- **验收对应**：A-17（`e1..e6`）、E11 模板。
- **风险与回滚**：把「冻结」当「未完成」→ E11 勾选栏写明「已裁决=保留」。

### R-08 宿主装配兼容（P0）

- **背景**：三宿主（独立 server / Electrobun 桌面 / 移动端）复用 `@toonflow/server/app`；桌面在拿到 app 后注入 `app.locals.desktop`。
- **目标**：`createApp` 签名与 14 个 exports 键名逐字不变；三宿主行为不变。
- **描述**：`package.json` 的 5 个 target 按 SPEC 更新（`./mcp`、`./mobileLink`、`./browser`、`./singleAgent/types`、`./remoteConnection`），键名不动。
- **详细方案设计**：移动端/桌面对 `createApp` 的调用参数**逐字不变**；`pluginRoots` 的翻译在 `createApp` 内部完成，宿主无感；桌面 15 个 `/api/desktop/*` 端点门禁仍在中间件区同一位置。
- **验收对应**：A-12、A-21（三宿主启动 + 桌面 15 端点门禁）。
- **风险与回滚**：exports target 改错 → 5 个入口 404/编译失败；由 A-12 + 三宿主冒烟兜底。

### R-09 规范、地图与包导出同步（P0）

- **目标**：`AGENTS.md` 目录结构与新模块一致；模块清单（8 模块 id/职责/前缀/文件/行数/依赖）可被地图消费；地图重算 = L3 `246 / ≤14,839+Δ`。
- **详细方案设计**：变更记录里显式登记 §1.2 的 2 处归属更正与 9 个滞后文件；地图重算用同脚本；`tsconfig.paths` 仍为 `@/* → ./src/*`（无需新增条目）。
- **验收对应**：A-22。
- **风险与回滚**：地图 glob/行数口径差异 → 在模块清单显式记录口径。

### R-10 回归基线与 13 项冒烟（P0｜先行）

- **目标**：M0 冻结 5 份基线（HEAD、162 条 method+path、`router.ts` 全文、typecheck/build 状态、14 exports/36 文件/57 引用）；13 项 + S1–S8 冒烟逐条可比。
- **描述**：13 项覆盖 7 个模块（矩阵 §R-10 表）；其中 **S7（`GET /api/skills/list`）与 S8（`GET /api/agents/get`）是本轮打回 #2 的功能探针**——它们读的正是 `builtinPlugins.skill` / `.agent`，若键错位则「内置项全部变成非内置」（§3.2.1）。
- **详细方案设计**：冒烟判据 = 归一化后 diff 为空；S7/S8 额外记录「内置项数量」这一列（B0 基线值 → F 必须相等），把 F-08 的非空性做成**可读证据**。
- **验收对应**：A-20（13 项 + S1–S8 + 21 前缀首位端点）、A-11。
- **风险与回滚**：fixture 不稳定 → 用固定目录与固定 uuid；响应含时间戳 → 归一化白名单。

### R-11 结构化豁免登记（P0）

- **目标**：E1–E12 逐条填表（编号/理由/缓解/触发条件/责任人/判据），E11/E12 给完整模板。
- **详细方案设计**：沿用矩阵 §8.2 候选清单；本版**不新增豁免**（两条打回都是方案缺陷，已修正而非豁免）。
- **验收对应**：A-23。

### R-12 三本台账与预算审计（P0）

- **目标**：L1 237 / L2 9 / L3 246、≤14,839 行（+Δ）；业务 ≤50/模块；交付 ≤55 文件、≤3,300 行/模块；`app.ts` ≤80；入口 ≤60；`types/module.ts` ≤40；`lib/mentionSources.ts` ≤30。
- **详细方案设计**：审计脚本口径与矩阵 §A.10 一致；本轮修正**不增加**任何文件（`scanBuiltin` 实现在既有 `initialize.ts`，`addMediaProvider` 公开在既有入口）。
- **验收对应**：A-01～A-05、A-24。
- **风险与回滚**：入口超行 → 实现体下沉；`exports` 语义收窄**不**减少行数（D-04 只是不再重复列举符号）。

### R-13 模块级 SCC 与依赖白名单（P1）

- **目标**：`dependencies` ⊆ 白名单；SCC-1（5 域模块）与含 bootstrap 枢纽环按 E12 接受；file 级 SCC 收敛为 `dxt↔servers`。
- **详细方案设计**：`dependencies` = 该模块对其它模块的**直接深路径边**（20 条边子集，含 E10 的 7 条弱边，否则「声明 ≠ 实际」）；`@/agent` 边不计入白名单（NG1/E6）。
- **验收对应**：A-18、§A.6、§A.11。
- **风险与回滚**：漏声明弱边 → 审计脚本按「实际边 − 声明边 = ∅」判定。

### R-14 判据工程（两相 / 守卫 / 台账 / 文档自审）（P0）

- **目标**：每条判据有 phase；`stale_specifier_in_PHF=0`、`vacuous_zero=0`、`reachability_miss=0`、`scope_assertions=0`、`unreachable=0`；文档自审可机械复现。
- **详细方案设计**：本版在**不改 A 项**的前提下新增 3 条方案级探针（`s1`–`s4`，§3.2.3/§3.3），并把 `s3` 归入 **M7**（F 相证据），B0 侧只作基线对照（§1.6.6 的相位规则）。
- **验收对应**：A-27、A-28、A-29；本文档自身的「打回 → 修复 → 判据」对照（§1.1）。
- **风险与回滚**：探针写成「零命中即通过」的空转判据 → 每个 `s` 都带 `scope_files` 与 B0 可达性证明（附录 B）。

### R-15 默认数据目录锚点不变 + 相对路径深度补偿（P0）

- **背景**：`conf/index.ts:11` 的默认锚点 `resolve(import.meta.dirname, "../../../../../data")`（5 级）→ `<repo>/data`；迁到 `modules/platformCore/conf` 后深 1 级会落到 `apps/data`。
- **目标**：`f2a` 在 F 相仍 = 1（默认目录不变）；`f2b` 显式目录生效且仓库 `data/` 不被写。
- **描述**：两种实现（Q12）：**A 深度补偿**（改 6 级）/ B 稳定锚点（向上查找 `package.json`）。
- **详细方案设计**（默认 A）：
  ```text
  conf/index.ts: resolve(import.meta.dirname, "../../../../../../data")   // 5 → 6 级
  校验：f2a 静态解析 = <repo>/data；f2b 处显式 TOONFLOW_DATA_DIR 生效；仓库 data/settings.json md5 前后一致
  ```
- **验收对应**：A-25（`f2a/f2b`）、L24。
- **风险与回滚**：补偿级数算错 → `f2a` 立即 FAIL（探针只读、零副作用）；锚点改法不统一 → 只允许 A/B 二选一，不得各自实现。

---

## 5. UI 影响评估与界面回归说明

### 5.1 结论：**本需求没有任何 UI 变动**

| 维度 | 是否变动 | 依据 |
| --- | --- | --- |
| 端点（method + path） | 否 | 161 个路由文件不移动，`core.ts` 按目录生成挂载 → URL 不变（A-11） |
| 响应体结构 / 状态码 / 错误文案 | 否 | 只改服务端内部目录与 import 说明符；`lib/responseFormat`、`lib/i18n` 未改 |
| 鉴权 / 同源校验 / 桌面门禁 | 否 | 7 项中间件顺序与内容逐项保真（A-09）；`/api/desktop` 门禁位置不变 |
| 静态资源与前端构建 | 否 | `express.static(webRoot)` 位置不变；`apps/web` 零改动 |
| 设计系统 / 组件 / 交互 | 否 | 无新增界面、无文案、无布局 |

> 因此本节不含「UI 设计说明」（无界面需要设计），只给**界面回归清单**与**异常定位对照**：拆分若出错，现象会出现在前端，而根因在服务端装配。

### 5.2 界面回归检查清单（按模块 → 界面位置 → 交互点）

| # | 服务端模块 | 界面位置 | 交互点 | 期望现象 |
| --- | --- | --- | --- | --- |
| 1 | assetLibrary | 素材库页 | 列表 / 上传 / 缩略图 | 列表分页正常；缩略图异步生成（首屏不阻塞）；保存后 revision 更新 |
| 2 | mediaGeneration | 媒体生成面板 · 设置→媒体模型 | 生成图片/视频；供应商增删改 | 生成流式返回；供应商列表与「内置」标记正确 |
| 3 | pluginMarket | 插件市场 · 工具/节点/扩展/技能/团队页 | 列表、安装、导出、删除 | **内置项必须显示「内置」徽标**（S5–S8 的核心；见 §3.2.1） |
| 4 | mcpIntegration | 设置→MCP | 状态、服务器列表、工具清单 | 状态与连接数正确；工具清单与 `/mcp` 一致 |
| 5 | localRuntime | 工作区文件树 · 设置→移动互联 | 读写文件、执行命令、设备配对 | 编辑器保存带 revision 冲突提示；SSE 命令输出正常 |
| 6 | agentAccess | Agent 会话页 | 运行 / 中断 / 回滚 / 浏览器 | 流式事件序列与基线一致 |
| 7 | platformCore | 全局（语言、设置、监控） | 语言切换、设置读写 | 语言即时生效；`/api/settings/get` 结构与基线一致 |

### 5.3 「现象 → 断点」对照（UI 异常时的定位顺序）

| 前端现象 | 优先看的服务端锚点 | 对应判据 |
| --- | --- | --- |
| 内置插件/技能/团队的「内置」徽标全丢 | `app.locals.builtinPlugins` 的 5 键与 `scanBuiltin` 的根目录来源 | §3.2 `s2`/`s3`、A-10、S5–S8 |
| 中文文案变英文 / 报错语言不对 | `platformCore.prepare()` 的 `setLocaleFallback` 是否在 `conf` 之后、入口之前 | A-26 步骤 0、`f2b` |
| 首屏卡住（缩略图阻塞启动） | `assetLibrary.warmup` 是否被 `await` | A-25 `f1a/g1` |
| 供应商列表为空 / 重复安装 | 步骤 4 的 `pluginRoots.provider` 键与哈希 revision | §3.2、`g6a/g6b`、A-26 |
| 工作区保存 404 / 路径错 | `TOONFLOW_DATA_DIR` 是否在 `conf` 之前设置（装配顺序） | `f2a`、A-09 |
| MCP / Agent 页面 404 | `gateways` 归属与步骤 11/12 的挂载顺序 | A-07、`g4b=4` |

### 5.4 UI 侧验收动作（只需执行，不需设计）

1. 起服务（三宿主各一次），走 §5.2 的 7 行；2. 对 S5–S8 四个页面**数一遍内置项数量**并与 B0 记录逐项比对；3. 切换语言一次、保存一次设置；4. 上传一次素材并确认缩略图出现。

---

## 6. 实施计划、里程碑与变更面

### 6.1 里程碑（与矩阵 §9 一一对应，本版补充出口条件）

| M | 内容 | 出口条件（本版补充加粗） |
| --- | --- | --- |
| M0 | 基线冻结（HEAD、端点清单、`router.ts`、typecheck/build、exports 清单） | 以**实施开始时 HEAD** 为准，同步 F-01 复述项的 `+Δ` |
| M1 | B0 语义探针基线（`f4/f5`、`g` 组、**`s3` 的 B0 侧 dump**） | 只作对照，**不得**作为 A-25/A-26/A-29 的 PASS 证据 |
| M2 | 目录迁移 + 引用替换 + 契约/入口落地 | `typecheck` 通过；**`s4`（入口说明符目标存在性）= 0 missing**；**`s1/s2` 键集合 = 6**；11 处非 `from` 形态引用逐条核对 |
| M3 | 边 A–D 与 E11 判据取证 | `a1..a3`、`b1..b5s`、`c1..c9`、`d1..d5`、`e1..e6` 全绿 |
| M4 | `app.ts` 瘦身 + 15 步归口 | ≤80 行、禁用符号 0、`builtinPlugins` 1 处、`g5` 行号递增 |
| M5 | 规范/地图/exports 同步 | A-22 |
| M6 | 结构验收 + 文档自审 | A-01～A-24、A-27、A-28 |
| M7 | **F 相语义探针**（`f1a–f5`、`g1–g6`、`lr1–lr5`、**`s3`**） | A-25/A-26/A-29 的证据只能来自 M7 |

### 6.2 变更面（文件级）

| 类别 | 数量 | 说明 |
| --- | --- | --- |
| 迁移文件（路径变更） | 59 | 15 个域 + 3 个顶层 utils 文件 + `src/remoteConnection.ts` + 40 个域内文件（详见附录 A） |
| 说明符变更（文件不移动） | 197 处 | `routes/**` 62 + `utils.ts` 30 + `agent/**` 50 + 入口/装配 55 处等 |
| 新增（L2） | 9 | 7 入口 + `types/module.ts` + `lib/mentionSources.ts` |
| 语义修改（非机械） | 6 处 | `install.ts:11`（§3.1）、`plugins/initialize.ts`（scanBuiltin）、`conf/index.ts`（R-07D + R-15）、`teams/index.ts:5`、`mobileLink/index.ts:10`、`agent/mentionSources.ts` |
| UI / 前端 | 0 | — |

### 6.3 回滚策略

1. 迁移按「目录 → 引用 → 入口」三段提交，每段可单独 `git revert`；
2. 每段合入前必须 `typecheck` + 端点清单 diff 为空；
3. 入口落地采用「先加文件、最后切换 `app.ts`」的顺序，切换点单一（`app.ts` 一处），回滚只需还原 `app.ts` + 保留迁移目录（新目录未被引用即无副作用）。

---

## 7. 待评审裁决点

| ID | 议题 | 推荐 | 若改选的影响 |
| --- | --- | --- | --- |
| **D-01** | `app.ts` 装配形态（动态 `import`）与 A.3 ③ 的 `app.ts` 段计数 | **A：动态 import**；`app.ts` 段期望 0，合计 245，另立「装配 7 入口 = 7」正向判据 | B：把动态 import 计入深路径 → B0 基线 246→254，台账 L10/L11 与叙述连带改 |
| **D-02** | R-07D 的 `RemoteTeam`/`MobileLinkConfig` 归属实现 | **A：并入已有 conf import 行**（单行混合 import），`d4` 保持 4 | B：保留矩阵原文 re-export → `d4=6`、A.3 的 103 段变 105，需同步改两处期望 |
| **D-03** | `PluginRoots` 键名 | **A：插件类型词表（`skill`/`provider`/`agent`）**，扫描零映射 | B：宿主参数词表 + 显式映射表（多一处同步点，正是本轮打回的成因） |
| **D-04** | `ServerModule.exports` 语义 | **A：app.ts 调用面**（公开面由 `export … from` 表达） | B：列全部公开符号 → `b5s=2`、`c7s=4`，须同步修订矩阵两条判据 |
| **D-05** | 步骤 9 的两段语义（import await + 刷新 void）放在哪 | **A：入口 `refreshModels()` 内两段，`app.ts` 只 `await` 一次** | B：`app.ts` 里写两行 → 违反 A-08 的禁用符号（`initializeProviderModels` 计数 = 0） |

---

## 8. 交付物与验收对照

### 8.1 交付物（本次方案设计阶段）

| 文件 | 说明 |
| --- | --- |
| 本文档 | 方案设计第 2 版（第 6 轮打回后重做） |
| `INDEX-2026-10.md` | 方案索引新增本行 + 上一版标记为「打回」 |
| 源码 | **零修改**（`git status --porcelain apps/server` 为空） |

### 8.2 需求 → 方案 → 验收 对照

| 需求 | 方案落点 | 验收项 | 本轮是否被修正 |
| --- | --- | --- | --- |
| R-01 契约与 7 入口 | §2.3/§2.4/§4 R-01 | A-06/A-07/A-18/A-29 + `s1` | ✅ 契约键名与 `exports` 语义修正 |
| R-02 `app.ts` 瘦身 | §2.2/§4 R-02 | A-08/A-09/A-25 | 否（沿用） |
| R-03 15 步归口 | §2.2/§4 R-03 | A-10/A-25/A-26 + `s3` | ✅ 步骤 8 的键映射修正、步骤 4 的根键名修正 |
| R-04 目录模块化 | §2.5/§4 R-04 | A-01～A-03/A-13 | 否 |
| R-05 路由分组（E4） | §4 R-05 | A-11/A-07 | 否 |
| R-06 facade 收敛 | §4 R-06 | A.3 ④/A-12 | 否 |
| R-07 A–D 边 | §3.1/§4 R-07 | A-13～A-16 + `b5s` | ✅ B 边整体重写 |
| R-07E dxt↔servers（E11） | §4 R-07E | A-17 | 否 |
| R-08 宿主兼容 | §4 R-08 | A-12/A-21 | 否 |
| R-09 规范/地图/exports | §4 R-09 | A-22 | 否 |
| R-10 基线与冒烟 | §4 R-10 | A-20 | ✅ S7/S8 增列「内置项数量」 |
| R-11 豁免登记 | §4 R-11 | A-23 | 否（不新增豁免） |
| R-12 台账与预算 | §4 R-12 | A-01～A-05/A-24 | 否（文件数不变） |
| R-13 SCC/白名单 | §4 R-13 | A-18 | 否 |
| R-14 判据工程 | §3.2.3/§3.3/§4 R-14 | A-27/A-28/A-29 + `s1–s4` | ✅ 新增 4 条方案级探针 |
| R-15 数据目录锚点 | §4 R-15 | A-25（`f2a/f2b`） | 否 |

### 8.3 覆盖度与可读性自检

- 子需求覆盖：R-01～R-15 + R-07E = **16/16** 均有「背景 / 目标 / 描述 / 详细方案设计」。
- 打回覆盖：2/2 逐条 → §1.1 → §3.1/§3.2（含实测证据、禁止项、判据对齐、可行性验证）。
- 自查发现：本版新增 F-06/F-07/F-08；F-01（基线漂移）复述并交由 M0 重冻结。每条都有实测或判据缺口分析 + 守卫方案。
- 禁止大段真实代码：全文仅伪代码/流程图/命令；命令均为**只读探针**，写在 `/tmp`。
- UI：零 UI 变动 → §5 给影响评估 + 7 行回归清单 + 现象→断点对照。

---

## 9. 评审意见栏

> 留空，待用户/评审填写。可逐条勾选或写「打回 + 理由」。

### 9.1 总体结论

| 项 | 填写 |
| --- | --- |
| 结论 | ☐ 通过 ☐ 有条件通过 ☐ 打回 |
| 评审批次 | 第 7 轮 |
| 评审人 / 日期 | |

### 9.2 打回意见处置确认

| # | 上轮打回项 | 本版处置 | 是否接受 |
| --- | --- | --- | --- |
| 1 | R-07B `addMediaProvider` 指向不存在的 `./media/provider` | 公开面归 `mediaGeneration` 入口；`pluginMarket` 唯一消费点；4 条禁止项 | ☐ 接受 ☐ 不接受（理由：） |
| 2 | `scanBuiltin` 的 `pluginRoots.skill` 与契约字段 `skills` 不一致 | 键名统一为插件类型词表；零映射；类型/结构/行为三层守卫 | ☐ 接受 ☐ 不接受（理由：） |

### 9.3 设计决策裁决（D-01～D-05）

| D | 推荐 | 裁决 |
| --- | --- | --- |
| D-01 `app.ts` 动态装配 + 装配判据 | A | ☐ 同意 ☐ 改选 __ |
| D-02 R-07D 单行混合 import | A | ☐ 同意 ☐ 改选 __ |
| D-03 `PluginRoots` 键名 = 插件类型 | A | ☐ 同意 ☐ 改选 __ |
| D-04 `exports` = app.ts 调用面 | A | ☐ 同意 ☐ 改选 __ |
| D-05 步骤 9 的两段语义归口 | A | ☐ 同意 ☐ 改选 __ |

### 9.4 新增探针确认（`s1`–`s4`，不改 A 项）

| 探针 | 内容 | 归属证据 | 确认 |
| --- | --- | --- | --- |
| `s1` | `app.ts` 的 `pluginRoots` 字面量键集合 = 6 | A-06/A-10 补充 | ☐ 采纳 ☐ 不采纳 |
| `s2` | 实现文件的根键访问集合 ⊆ 6，且无 `skills/agents/providers` 近义词 | A-10 补充 | ☐ 采纳 ☐ 不采纳 |
| `s3` | B0↔F 的 `builtinPlugins` 五键 size/成员逐字相等且非空 | **M1 基线 / M7 判定** | ☐ 采纳 ☐ 不采纳 |
| `s4` | 入口内 `from "…"` 说明符目标文件存在（`missing=0`） | A-19 前移到 M2 | ☐ 采纳 ☐ 不采纳 |

### 9.5 实施许可

| 项 | 填写 |
| --- | --- |
| 是否允许进入实施 | ☐ 允许 ☐ 需再改一版 |
| 附加条件 | |

---

## 附录 A：入口骨架与关键编排（伪代码）

### A.1 入口骨架（7 个同构，≤60 行）

```text
import type { ServerModule, ModuleContext } from "@/types/module"        // type-only，lr5=0 不受影响
<公开面：export … from "./<自家域>" | 具名导出函数>
const module: ServerModule = {
  id, routePrefixes, gateways?, dependencies,
  exports: [<app.ts 调用面>],                                            // D-04
  initialize?, warmup?, mount?, syncDirectory?,
}
export default module
```

### A.2 `pluginMarket` 入口（本版关键形态）

```text
export { decodeText, skillPath, skillZip } from "./plugins/install"       // c9 逐字
export { listTools } from "./plugins/tools"                               // c9 逐字
export * as skillFiles from "./skills/files"                              // c9 逐字
export { default as syncDirectory } from "./plugins/initialize"           // A-08：app.ts 不再出现 initializePlugins
export const scanBuiltin = (context) => scanBuiltinIn(context.pluginRoots) // 实现落在 ./plugins/initialize
export const initializeTools = (context) => initializePluginsIn(resolve(context.dataDirectory,"tools"),
                                     context.pluginRoots.tool, /^[a-z][a-zA-Z0-9]*\.tool\.js$/, context.pluginRevision)
… （nodes / ext / skills / agents 同构，参数顺序与 B0 逐项一致）
const module: ServerModule = { id: "pluginMarket", routePrefixes: [6 项], dependencies: [...],
    exports: ["syncDirectory","initializeTools","initializeNodes","initializeExt",
              "initializeSkills","initializeAgents","scanBuiltin"], … }
export default module
```

> `exports` 里**没有** `decodeText/listTools/skillFiles/addMediaProvider`——这正是 `c7s=3`、`b5s=1` 成立的前提（§3.3.1）。

### A.3 `mediaGeneration` 入口（本版关键形态）

```text
import type { ServerModule, ModuleContext } from "@/types/module"
export { addMediaProvider } from "./media/provider"                       // b5s=1；同时满足 lr2
export async function initializeProviders(context) { …哈希 + ctx.syncPluginDirectory… }
export async function refreshModels() {
  const { default: initializeProviderModels } = await import("./ai/initialize")    // 失败 → reject
  void initializeProviderModels().catch(error => console.warn("启动时刷新供应商模型失败：", error))  // g4=1
}
const module: ServerModule = { id: "mediaGeneration", routePrefixes: ["/api/ai","/api/ffmpeg","/api/providers"],
    dependencies: ["localRuntime","platformCore"], exports: ["initializeProviders","refreshModels"], … }
export default module
```

### A.4 `mcpIntegration` 入口（`g4b=4` 的形态约束）

```text
export async function mount(app, context) {
  const [{ createMcpRouter }, { getMcpTools }, { authorizeMcp }, { skillResources }] = await Promise.all([
    import("@toonflow/mcp"), import("@/utils/mcp/tools"), import("@/utils/mcp/control"), import("@/utils/mcp/resources"),
  ])                                            // 必须恰好 4 条 `import(`；形参类型用 `import type { Express }`，不得写 `import("express").Express`
  app.use("/mcp", createMcpRouter({ getTools, authorize, resources, runInRequest, translate, translateError }))
}
```

### A.5 `assetLibrary` 入口（步骤 5 的语义保真）

```text
export function warmup(context) {                       // 同步签名、返回 void（A-06 行内不得有 async/Promise）
  void import("./assets/thumb").then(({ sweepThumbnailCache }) => sweepThumbnailCache()).catch(() => {})
}                                                       // 单行：f1d=1、g2=1、g3=1；文件内 0 处 console.*（f3a=0）
```

---

## 附录 B：本轮只读探针与实测（可复现）

> 全部只读；脚本写 `/tmp`，**不落库**（矩阵 §6.7 规则 5）。

### B.1 基线复核（§1.3 V1–V7）

```bash
# V1 文件/行数（237 / 14,352）
python3 - <<'PY'
import glob
f=[p for p in glob.glob('apps/server/**/*.ts',recursive=True) if '/src/agent/' not in p and '/node_modules/' not in p]
print(len(f), sum(sum(1 for _ in open(x,encoding='utf-8')) for x in f))
PY
# V2/V3 路由文件与端点
find apps/server/src/routes -name '*.ts' | wc -l                      # 161
grep -rhoE '(Router\(\)|router|app)\.(get|post|put|delete|patch|all)\(' apps/server/src/routes --include='*.ts' \
  | sed -E 's/.*\.([a-z]+)\(/\1/' | sort | uniq -c                    # 79/51/20/10/2
# V4/V5 深路径与 facade
grep -rho 'from "@/utils/[a-zA-Z]*' apps/server/src --include='*.ts' | wc -l   # 246
grep -rl 'from "@/utils"' apps/server/src --include='*.ts' | wc -l             # 145
# V6/V7
wc -l < apps/server/src/app.ts      # 160
wc -l < apps/server/src/utils.ts    # 75
grep -rn 'from "\.\{1,2}/' apps/server/src/utils --include='*.ts' | wc -l      # 21
```

### B.2 打回 #1 的证据（V8–V10）

```bash
grep -rn 'from "@/\?\(utils/media\|modules/mediaGeneration/media\)/provider"' apps/server/src/utils/plugins   # 1 → install.ts:11
grep -rn 'from "@/\?\(utils/plugins\|modules/pluginMarket/plugins\)' \
     apps/server/src/utils/media apps/server/src/routes/ai apps/server/src/routes/providers apps/server/src/routes/ffmpeg  # 0
ls apps/server/src/utils/plugins      # ext initialize initializeExt install nodes tools  → 无 media/
```

### B.3 打回 #2 的复现（V11，键错位 → 静默空集）

```bash
python3 - <<'PY'
roots_contract = {"tool":"T","node":"N","ext":"E","providers":"P","skills":"S","agents":"A"}  # 上一版契约
builtin_keys = ["tool","node","ext","skill","agent"]                                          # B0 扫描键
out = {k: (roots_contract.get(k) or "<EMPTY>") for k in builtin_keys}
print(out, "silent_empty =", sum(v=="<EMPTY>" for v in out.values()))    # 2
roots_v2 = {"tool":"T","node":"N","ext":"E","provider":"P","skill":"S","agent":"A"}           # 本版契约
out2 = {k: roots_v2[k] for k in builtin_keys}
print(out2, "silent_empty =", sum(not v for v in out2.values()))        # 0
PY
```

### B.4 F-06 的计数复现（`grep -c` 按行计）

```bash
cd "$(mktemp -d)"
printf 'export { addMediaProvider } from "./media/provider";\nconst m = { exports: ["addMediaProvider"] };\n' > bad.ts
printf 'export { addMediaProvider } from "./media/provider";\nconst m = { exports: ["initializeProviders"] };\n' > good.ts
grep -c 'addMediaProvider' bad.ts      # 2  （期望 1 → FAIL）
grep -c 'addMediaProvider' good.ts     # 1  ✅
printf 'export { decodeText, skillPath, skillZip } from "./plugins/install";\nexport { listTools } from "./plugins/tools";\nexport * as skillFiles from "./skills/files";\nconst m={exports:["decodeText","listTools","skillFiles"]};\n' > bad2.ts
grep -cE '(decodeText|listTools|skillFiles)' bad2.ts   # 4（期望 3 → FAIL）
```

### B.5 F 相待跑探针（M7）：`s1`–`s4`

```text
s1  apps/server/src/app.ts 内 `pluginRoots: { … }` 的键集合       期望 6：tool,node,ext,skill,provider,agent
s2  modules/pluginMarket/plugins/initialize.ts 的 `roots[...]` 键访问集合
    期望 ⊆ 6，且不含 skills/agents/providers（near_miss=0）
s3  B0：createApp(fixture) 后 dump builtinPlugins 5 键的 size/成员
    F ：同上（或直接调用 scanBuiltin(fixture roots)）
    期望 s3_keys=5 s3_nonempty=5 s3_diff=0
s4  7 个入口内所有 `from "…"` 说明符解析到文件                  期望 s4_missing=0
```

---

## 附录 C：行数预算与文件预算（沿用矩阵，本版未增文件）

| 项 | 上限 | 本版估算 | 说明 |
| --- | --- | --- | --- |
| `app.ts` | 80 | ~62 | 7 个动态 import + 6 行 ctx + 15 步调用 + 7 中间件 |
| 每个入口 | 60 | 28–52 | `pluginMarket` 最长（7 条 re-export + 6 个钩子包装） |
| `types/module.ts` | 40 | ~34 | 仅类型，无运行期常量（`BUILTIN_TYPES` 放 `plugins/initialize.ts`） |
| `lib/mentionSources.ts` | 30 | ~22 | 1 type + 1 函数 + 1 依赖 |
| L2 行数合计 | 490 | ~370 | 余量用于 `pluginMarket` 入口的 6 个包装函数 |
| L3 交付 | 246 文件 / ≤14,839+Δ 行 | 246 / ~14,722+Δ | Δ = M0 冻结时的基线漂移（当前 +3） |
| 单模块业务文件 | ≤50 | pluginMarket 49（最紧） | 本版未新增业务文件 |
| 单模块交付 | ≤55 文件 / ≤3,300 行 | mediaGeneration 43 / ~3,054 | — |

---

## 附录 D：与上一版方案的差异索引

| 章节 | 上一版（SOL-2026-10-27-01） | 本版（SOL-2026-10-27-02） | 触发 |
| --- | --- | --- | --- |
| §2.3 契约 | `PluginRoots = {tool,node,ext,providers,skills,agent}`；`exports` = 全部公开符号 | `PluginRoots = {tool,node,ext,skill,provider,agent}`；`exports` = app.ts 调用面 | 打回 #2、F-06 |
| §2.4 入口表 | `pluginMarket` 公开 `addMediaProvider` | `mediaGeneration` 公开，`pluginMarket` 消费 | 打回 #1 |
| §4 R-07(B) | 「pluginMarket 入口 export addMediaProvider from ./media/provider」 | 「mediaGeneration 入口公开 + install.ts 整行消费」+ 4 条禁止项 + 4 项可行性验证 | 打回 #1 |
| §3.2（新增） | — | 键名统一 + 零映射 + 三层守卫 | 打回 #2 |
| §3.3（新增） | — | F-06/F-07/F-08 与 `s1`–`s4` | 本轮自查 |
| §4 R-10 | S7/S8 只判 diff | 增列「内置项数量」 | F-08 |
| §7 裁决点 | D-01～D-03 | D-01～D-05（新增 D-04/D-05） | 本轮 |
