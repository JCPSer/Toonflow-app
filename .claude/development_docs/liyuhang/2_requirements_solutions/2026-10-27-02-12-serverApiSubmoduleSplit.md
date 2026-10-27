# 方案设计 · server-api 应用子模块拆分

## 0. 文档元信息

| 项 | 内容 |
| --- | --- |
| 文档编号 | **SOL-2026-10-27-01** |
| 对应需求 | `REQ-2026-10-26-06`（`.easyvibe/development_docs/liyuhang/1_requirements_matrix/2026-10-26-23-29-serverApiSubmoduleSplit-v6.md`，第 6 版） |
| 需求标题 | server-api 按素材库 / 媒体生成 / 插件市场 / MCP·工作区拆出应用子模块，`app.ts` 只保留组合根与路由装配 |
| 影响模块 | `server-api`（`apps/server`） |
| 方案类型 | 结构性重构（架构整改），**零业务行为变更** |
| 编写人 | 方案设计 agent（harness 规则 2.2） |
| 编写时间 | 2026-10-27 02:12 |
| 代码基线 | 需求矩阵 B0 = `d084136`；**本次设计复核时的 HEAD = `1861cd0`**（差异见 F-01） |
| 本轮回写 | 仅新增本文件与 `INDEX-2026-10.md`；**未修改任何源码**（`git status --porcelain apps/server` 相对本轮开始时未新增改动） |
| 评审入口 | §9 评审意见栏（留空待填）；§7 列出 3 个待裁决设计分支（D-01 / D-02 / D-03） |

> 阅读顺序建议：§1 结论速览（5 分钟）→ §3 方案级发现（决定方案能否落地）→ §4 对应 R 的详细方案 → §5 UI 说明 → §7 待裁决点 → §9 评审意见栏。
>
> **引用约定**：`矩阵 §x` / `§A.x` / `§R-xx` / `A-xx` / `Lxx` / `Qxx` / `Exx` 一律指**需求矩阵**（REQ-2026-10-26-06）的章节与编号；**不带前缀的 `§x`** 指本文档自己的章节。

---

## 1. 结论速览

1. **采用矩阵默认方案 B**：`src/utils/<域>/**` 整体迁入 `src/modules/<模块>/<域>/**`，`src/routes/**` 与 `src/lib/**`、`src/types/**` 原地不动（URL 不变）；新建 7 个模块入口 + 1 个组合契约 + 1 个共享下沉文件（L2 固定 9 个）。
2. **`app.ts` 由 160 行降到 ≤80 行**：只保留「参数归一 → 动态装配 7 个入口 → 8 项初始化序列 → 7 项中间件 → 静态/错误 → 返回 app」。所有插件类型分支、供应商哈希、MCP/A2A 网关构造、移动互联初始化全部下沉到入口。
3. **装配必须用动态 `import(...)`，不能用静态 `from`**：`pluginMarket` 与 `mediaGeneration` 两个入口的静态 re-export 面必然求值 `conf`（`plugins/install.ts:7`、`media/provider.ts:11`），一旦 `app.ts` 静态 import 它们，`conf` 会在 `createApp` 设置 `TOONFLOW_DATA_DIR` **之前**求值，直接击穿 A-08 / A-25（`f2a`/`f2b`）与三宿主数据目录语义。该结论与矩阵 A.3 ③ 的「`app.ts` 段 = 7 个 `from` 行」冲突 → **D-01**。
4. **`ModuleContext` 需要 3 个补充字段/导出**（`pluginRoots`、`pluginRevision`、`gateways`）与 2 个额外具名导出（`prepare`、`initializeRuntime`），否则 15 步初始化无法归口、`/mcp`、`/a2a` 无法机器判归属 → **D-03**（契约补充，仍满足 L2 #8 ≤40 行与 R-01「额外具名导出」许可）。
5. **R-07D 的正确机制是「单行混合 import」而非「新增 re-export 行」**：矩阵原文要求的 `export type { ... } from "@/modules/platformCore/conf"` 会给 `teams/index.ts`、`mobileLink/index.ts` 各**新增 1 行** → `d4` 由 4 变 6（矩阵自身判据失败）。方案改为把类型并入两文件**已有的** `import conf from ...` 行（`import conf, { type X } from ...`），行数不变 → `d3=0`、`d4=4`、A.3 的 `103` 段同时成立 → **D-02**。
6. **每个子需求 R-01～R-15 都有可执行的落地步骤**（§4），并逐条映射到 A-01～A-29 的验收判据；无法消除项沿用 E1–E12 结构化豁免，不新增豁免。
7. **无 UI 变动**：本需求不改任何 HTTP 端点、响应结构、鉴权与静态资源；前端 145 处 `u.*` 与 162 个端点全部不依赖「服务端内部目录形状」。UI 侧只做界面回归检查（§5）。

---

## 2. 总体架构设计

### 2.1 目标目录结构（交付态）

```text
apps/server/
├─ src/
│  ├─ app.ts                    # 组合根（≤80 行）
│  ├─ index.ts core.ts router.ts utils.ts   # bootstrap，不移动
│  ├─ types/
│  │   ├─ module.ts             # 【L2】ServerModule / ModuleContext 组合契约
│  │   └─ ...                   # 既有类型，不移动
│  ├─ lib/
│  │   ├─ mentionSources.ts     # 【L2】MentionQuery + mentionAssetType（R-07A 下沉）
│  │   └─ ...                   # i18n / desktop / responseFormat / platform 等，不移动
│  ├─ modules/
│  │   ├─ assetLibrary/         # 【L2】index.ts + assets/**
│  │   ├─ mediaGeneration/      # 【L2】index.ts + ai/** media/** ffmpeg/** documents.ts
│  │   ├─ pluginMarket/         # 【L2】index.ts + plugins/** skills/** teams/**
│  │   ├─ mcpIntegration/       # 【L2】index.ts + mcp/**
│  │   ├─ localRuntime/         # 【L2】index.ts + workspace/** desktop/** mobileLink/** exec.ts remoteConnection.ts
│  │   ├─ agentAccess/          # 【L2】index.ts + singleAgent/** sessionState/** browser/**
│  │   └─ platformCore/         # 【L2】index.ts + conf/** monitor.ts personalization.ts fileHttp.ts
│  ├─ routes/                   # 161 个路由文件，**不移动**（URL 由路径生成，见 core.ts）
│  ├─ agent/                    # 不属本模块；但其 50 处 `@/utils/<域>` 说明符必须跟迁
│  └─ utils/                    # 交付态必须为空（`src/utils.ts` 不在该目录内）
└─ scripts/                     # 归 bootstrap
```

**结构等式（交付态必须成立）**：`bootstrap 9 + 28 + 43 + 50 + 21 + 46 + 27 + 22 = 246 = 237（L1）+ 9（L2）`。

### 2.2 `createApp` 装配流程图（交付态）

```text
宿主（src/index.ts | desktop | mobile）
   │ createApp({ webRoot, appVersion, dataDirectory, toolsRoot, nodesRoot, extRoot,
   │            providersRoot, skillsRoot, agentsRoot, pluginRevision })
   ▼
[0] 参数归一：if (dataDirectory) process.env.TOONFLOW_DATA_DIR = resolve(dataDirectory)
   │            ← 必须在任何“会求值 conf”的模块被 import 之前
   ▼
[1] 动态 import 7 个入口（Promise.all，7 个 `import("@/modules/<id>")` 字面量）
   │            ← 用动态 import 而非静态 from：见 D-01
   ▼
[2] context = { appVersion, dataDirectory, pluginRoots{tool,node,ext,providers,skills,agent},
   │             pluginRevision, syncPluginDirectory: pluginMarket.syncDirectory }
   ▼
[3] platformCore.prepare()                     → 动态 import conf + setLocaleFallback（原 B0:60-62）
   ▼
[4] 步骤 1-7（顺序固定、全部 await，除非标注 void）
   │  pluginMarket.initializeTools / initializeNodes / initializeExt
   │  mediaGeneration.initializeProviders（哈希 + ctx.syncPluginDirectory）
   │  assetLibrary.warmup（void + 空 catch，步骤 5）
   │  pluginMarket.initializeSkills / initializeAgents
   ▼
[5] const app = express(); app.locals.appVersion = appVersion
   ▼
[6] 步骤 8：app.locals.builtinPlugins = await pluginMarket.scanBuiltin(context)   ← 唯一 1 处赋值
   ▼
[7] dev 分支：await buildRoute(); app.use(logger("dev"))          （必须在中间件之前）
   ▼
[8] 7 项中间件（行号严格递增，sessionState 64kb 必须在全局 json 之前）
   │  platformCore.corsGuard → languageRequest → /a2a 2mb → raw 100mb →
   │  /api/sessionState 64kb → 全局 json/urlencoded 100mb → /api/desktop 门禁
   ▼
[9]  await mediaGeneration.refreshModels()     → 内部 `await import(...)` + `void 刷新.catch(warn)`（步骤 9）
[10] await import("@/router") → router.default(app)             （步骤 10）
[11] await mcpIntegration.mount(app, context)                   （步骤 11，/mcp）
[12] await agentAccess.mount(app, context)                      （步骤 12，/a2a，动态 import @/agent/a2a）
[13] app.use(express.static(webRoot))                           （步骤 13）
[14] app.use(errorHandler)                                      （步骤 14）
[15] await localRuntime.initializeRuntime(app, context)         （步骤 15）
   ▼
return app
```

### 2.3 模块契约（`src/types/module.ts`，伪代码，≤40 行）

```text
PluginRoots = { tool?, node?, ext?, providers?, skills?, agent? }        // 宿主传入的 6 类插件根

ModuleContext = {
  appVersion: string
  dataDirectory?: string                 // 与 B0 的 `dataDirectory && xxxRoot` 守卫语义一致
  pluginRoots: PluginRoots
  pluginRevision?: string                // 构建版本号；有值时 initializePlugins 走覆盖同步
  syncPluginDirectory?(target, source, fileFilter?, revision?): Promise<void>
}                                        // 注入方 = app.ts（值取自 pluginMarket.syncDirectory）

ServerModule = {
  id: "assetLibrary" | "mediaGeneration" | "pluginMarket" | "mcpIntegration"
    | "localRuntime" | "agentAccess" | "platformCore"
  routePrefixes: readonly string[]       // 只放 21 个 /api/* 前缀，并集两两无交集
  gateways?: readonly string[]           // 非 /api 挂载点：/mcp→mcpIntegration，/a2a→agentAccess
  dependencies: readonly string[]        // 只能是附录 C 白名单子集
  exports: readonly string[]             // 入口对外公开的符号名（供 A-06/A-18 对账）
  initialize?(context): Promise<void>
  warmup?(context): void                 // 仅 assetLibrary：同步签名、fire-and-forget
  mount?(app, context): Promise<void>
  syncDirectory?(...): Promise<void>     // 仅 pluginMarket：供 app.ts 注入 ModuleContext
}
```

**额外具名导出**（R-01 已允许，`ServerModule` 只约束公共字段）：
`platformCore.prepare`、`mediaGeneration.initializeProviders / refreshModels / addMediaProvider`、`pluginMarket.initializeTools / initializeNodes / initializeExt / initializeSkills / initializeAgents / scanBuiltin / syncDirectory / decodeText / skillPath / skillZip / listTools / skillFiles`、`assetLibrary.warmup`、`localRuntime.initializeRuntime`、`mcpIntegration.mount`、`agentAccess.mount`。

> **为什么要 `gateways`**：A-07 要求「`/mcp` 只属 mcpIntegration、`/a2a` 只属 agentAccess」可判定，但 `routePrefixes` 的并集必须**恰好等于** 21 个 `/api/*` 前缀。把 `/mcp`、`/a2a` 塞进 `routePrefixes` 会让并集变 23 项，判据直接失败；不写又没有机器可读归属。`gateways` 是两全的唯一表达方式（D-03）。

### 2.4 迁移映射（矩阵 §1.6.2 SPEC 的执行摘要）

> 「文件数」= 该模块的 **L1 存量总计**（迁移的域文件 + 不移动的 `routes/**`），`routes` 位置不变只换归属。

| 模块 | 来源（B0） | 目标（F） | 文件数（含不移动的路由） |
| --- | --- | --- | --- |
| assetLibrary | `src/utils/assets/**` | `src/modules/assetLibrary/assets/**` | 27（域 9 + routes/assets 18） |
| mediaGeneration | `utils/{ai,media,ffmpeg}/**`、`utils/documents.ts` | `modules/mediaGeneration/{ai,media,ffmpeg}/**`、`documents.ts` | 42 |
| pluginMarket | `utils/{plugins,skills,teams}/**` | `modules/pluginMarket/{plugins,skills,teams}/**` | 49 |
| mcpIntegration | `utils/mcp/**` | `modules/mcpIntegration/mcp/**` | 20 |
| localRuntime | `utils/{workspace,desktop,mobileLink}/**`、`utils/exec.ts`、`src/remoteConnection.ts` | `modules/localRuntime/{workspace,desktop,mobileLink}/**`、`exec.ts`、`remoteConnection.ts` | 45 |
| agentAccess | `utils/{singleAgent,sessionState,browser}/**` | `modules/agentAccess/{singleAgent,sessionState,browser}/**` | 26 |
| platformCore | `utils/conf/**`、`utils/{monitor,personalization,fileHttp}.ts` | `modules/platformCore/conf/**`、`monitor.ts`、`personalization.ts`、`fileHttp.ts` | 20 |
| bootstrap | 5 个根文件 + `scripts/**` | 原地 + 新增 1 契约 | 8 → 9 |

> 迁移只做**前缀替换**（`@/utils/<域>` → `@/modules/<模块>/<域>`），不改导入形态；`src/agent/**` 的 50 处说明符同步替换（文件本身不移动）。完整迁移点清点见附录 A。

---

## 3. 方案级发现与设计决策（**评审重点**）

> 本节是本轮设计相对需求矩阵的**增量结论**：4 条「按矩阵字面无法同时满足」的冲突（F-01～F-04）与 3 条「矩阵没写到、但落地必须定」的设计分支（D-01～D-03）。每条都给证据与复现命令，供评审裁决。

### 3.1 F-01｜基线已漂移：HEAD 比 B0 多 3 行（**需要 M0 重新冻结**）

| 项 | 矩阵（B0 = `d084136`） | 本次实测（HEAD = `1861cd0`） | 差异来源 |
| --- | --- | --- | --- |
| server-api 文件数 | 237 | **237** | 无 |
| server-api 行数 | 14,349 | **14,352** | `1861cd0` 的 canvas「节点引用」提交 |
| `agentAccess` 行数 | 1,193 | **1,196** | `src/routes/agent/mentionSource.ts` +5/−2 |
| 路由文件 / 端点 / 前缀 | 161 / 162 / 21 | **161 / 162 / 21** | 只是既有路由体内新增分支，无新端点 |
| L3 行数上限 | 14,839 | **14,842** | `14,352 + 490` |

复现：

```bash
python3 - <<'PY'
import glob
f=[p for p in glob.glob('apps/server/**/*.ts',recursive=True) if '/src/agent/' not in p and '/node_modules/' not in p]
print(len(f), sum(sum(1 for _ in open(x,encoding='utf-8')) for x in f))   # 237 14352
PY
```

**处置建议**：M0 以「实施开始时的 HEAD」为基线重新冻结，并把矩阵 §1.1 / §3.2 / §6.9 的 `L02`（14,349→14,352）、`L23`（14,839→14,842）、`agentAccess` 行数（1,193→1,196）同步 +3。
**不改的东西**：所有**结构性判据**（237/9/246、161/162/21、145、246 处深路径、20 条边）在 HEAD 上逐项复现，方案与验收口径不受影响；`f2a/f2b/f2c/f4/f5/g` 组探针在 HEAD 上同样可跑（不依赖这 3 行）。

#### 3.1.1 本轮复核实测（HEAD = `1861cd0`，2026-10-27 02:10–02:20）

| 复核项 | 命令（摘要） | 实测 | 矩阵 B0 |
| --- | --- | --- | --- |
| 文件 / 行数 | §3.1 复现脚本 | **237 / 14,352** | 237 / 14,349 |
| 路由文件 | `find src/routes -name '*.ts' \| wc -l` | **161** | 161 |
| 端点 | 锚定式提取（含 `createRouter()` 别名写法） | **162**（79 post / 51 get / 20 put / 10 delete / 2 patch） | 162 |
| 深路径五段 | `grep -rho 'from "@/utils/[a-zA-Z]*'` 分段 | **246** = 50 + 62 + 103 + 30 + 1 | 246 |
| facade 文件 | `grep -rl 'from "@/utils"'` | **145** | 145 |
| 默认数据目录锚点 | `f2a` 静态解析 | `../../../../../data` → `<repo>/data`，`match=1` | 1 |
| 跨模块相对 import | `f2c` | **2**（`src/index.ts:3`、`utils/singleAgent/types.ts:2`） | 2 |
| 仓库数据文件 | `md5 -q data/settings.json` | `2070ab2a421e8275194f363a19a60048` | 同左（`f2b` 的前置值） |
| 运行环境 | `command -v bun` | 不在 `PATH`；可用 `/opt/homebrew/bin/bun` 覆盖 | 与矩阵一致 |

> 两个“复现陷阱”（M0/M6 执行时注意）：
> ① 端点提取的 pattern **不能加词边界**：`providers/media/delete.ts` 用的是 `import { Router as createRouter }`，`createRouter().delete(` 只有在 `Router\(\)` 作为子串匹配时才会计入（加 `\b` 会得到 161）。
> ② `f2b` 会写 `settings.json` 的临时文件：回归前先记录仓库 `data/settings.json` 的 md5（上表值），事后必须一致。

### 3.2 F-02｜A.3 ③ 的「`app.ts` 段 = 7 个 `from` 行」与 A-08 静态导入边界互斥 → **D-01**

**证据链（静态面必然求值 `conf`）**：

| 入口 | 静态 re-export / 调用面 | 是否求值 `conf` |
| --- | --- | --- |
| pluginMarket | `export { decodeText, skillPath, skillZip } from "./plugins/install"`（c9 要求逐字存在） | **是**：`plugins/install.ts:7 import conf from "@/modules/platformCore/conf"` |
| mediaGeneration | `export { addMediaProvider } from "./media/provider"`（b5 要求 `import { addMediaProvider } from "@/modules/mediaGeneration"`） | **是**：`media/provider.ts:11 import conf` |
| platformCore | `prepare()` 内**动态** `import("./conf")` | 否（受控） |
| mcpIntegration / localRuntime / agentAccess / assetLibrary | 挂载与预热均为动态 `import(...)`（g4b=4、f1d=1） | 否（受控） |

即：**`app.ts` 只要静态 import 1 个入口（pluginMarket 或 mediaGeneration），`conf` 就会在 `createApp` 执行前求值** → `TOONFLOW_DATA_DIR` 尚未设置 → 数据目录落到默认值 → `f2a`/`f2b` 直接 FAIL，且桌面/移动宿主显式传入的 `dataDirectory` 会与 `conf` 实际目录不一致（NG4 破坏）。

而矩阵 A.3 ③ 的 `app.ts` 段命令是 `grep 'from "@/modules/...' → 7`。两条约束的交集为空。

**两个可行分支（需评审裁决）**：

| 分支 | 做法 | B0 段 | F 段 | 合计 | 影响 |
| --- | --- | --- | --- | --- | --- |
| **A（推荐）** | `app.ts` 只用动态 `import("@/modules/<id>")`；A.3 ③ 的 `app.ts` 段期望改为 **0**，合计 **245**；另立装配判据：`grep -o 'import\("@/modules/[a-zA-Z]*' app.ts \| wc -l` = **7**（7 个 id 互不重复） | 1 | **0** | 246 → **245** | 只改 1 个期望值 + 1 条推导 + 新增 1 条正向装配判据；B0 基线 246 与台账 L10 不变 |
| B | 把 A.3 的计数对象扩展为「`from` 行 + `import("…")` 字面量」 | **9**（1 静态 + 8 动态） | **7** | 246 → 254 / 252 | 台账 L10、L11 两行都要改（246→254、252 保持），§3.2 叙述连带 |

> 推荐 A 的理由：① B0 的 246 是“静态深路径导入”的口径，动态 import 不属于该口径，扩口径会让 B0 历史基线失真；② 「7 个入口是否真被装配」用一条独立正向判据表达更直接；③ 方案 A 的代码与方案 B 完全一致，只是判据写法不同，后续切换零成本。

### 3.3 F-03｜`ModuleContext` 字段不足，15 步无法归口 → **D-03**

矩阵 L2 #8 给出的 `ModuleContext` 只有 `dataDirectory / appVersion / syncPluginDirectory`。但 R-03 步骤 1-8 需要 `toolsRoot / nodesRoot / extRoot / providersRoot / skillsRoot / agentsRoot` 与 `pluginRevision`，否则入口只能反向去读 `process.env` 或重新实现参数归一（与 R-02「组合根持有参数」冲突）。
**设计**：新增 `pluginRoots`、`pluginRevision`（仍 ≤40 行，见 §2.3），并在 R-01 的「额外具名导出」清单登记 `platformCore.prepare`、`localRuntime.initializeRuntime`（步骤 15 需要 `app` 句柄，矩阵契约的 `initialize(context)` 无此参数）。
**影响**：A-06 检查的字段为「职责/前缀/初始化/导出/依赖」，新增字段是**超集**，不改变任何期望值；E11/E12 等豁免不受影响。

### 3.4 F-04｜R-07D 的「re-export 类型」会给两个文件各加 1 行 → `d4` 由 4 变 6 → **D-02**

矩阵 R-07D 描述：`teams/index.ts`、`mobileLink/index.ts` 以 `export type { ... } from "@/modules/platformCore/conf"` re-export。实测这两条语句是**新增行**，而 `d4` 的 pattern 是 `from "@/(utils/conf|modules/platformCore/conf)`（只数行，不区分 type/value）：

| 机制 | `teams`+`mobileLink` 目录内 `from …conf` 行数（F） | `d4`（期望 4） | A.3 ③ `modules` 段（期望 103） |
| --- | --- | --- | --- |
| 矩阵原文（新增 2 条 re-export 行） | 4 + 2 = **6** | **FAIL** | 103（`@/modules/…conf` 已在 4 行内计数，新增行也命中 → **105**） |
| **本方案（并入已有 conf import 行）**：`import conf, { type RemoteTeam } from "@/modules/platformCore/conf"` | **4** | PASS | **103** |

实现要点：两处 `export type` 定义行删除、类型定义搬到 `conf`；`teams/index.ts:5`、`mobileLink/index.ts:10` 的默认导入行扩为「默认值 + `type` 具名」的**单行混合 import**（`verbatimModuleSyntax: true` 支持行内 `type` 修饰符），行数不变。
备选（若评审倾向保留矩阵原文）：把 `d4` 期望改为 6 并新增 `d4_value=4`（只数 `import … from` 行）作为“反向 4 条 value 保留”的守护。

### 3.5 F-05｜11 处「非 `from` 形态」的路径引用不在任何判据覆盖内

| # | 位置 | 形态 | 迁移后 | 由谁兜底 |
| --- | --- | --- | --- | --- |
| 1-8 | `app.ts` 的 8 处 `import("@/utils/…")`（conf / initializeExt / assets-thumb / ai-initialize / mcp tools·control·resources / mobileLink） | 动态 alias | 全部移入模块入口（A.3 不计） | A-08 禁用符号 + A-26 `g4b` |
| 9 | `plugins/install.ts:443` `import("@/utils/teams/install")` | 动态 alias | `import("@/modules/pluginMarket/teams/install")` | `typecheck`（同模块内解析） |
| 10-11 | `src/index.ts:24-25` `import("./utils/mcp/runtime")`、`import("./utils/mobileLink")` | **动态相对** | `import("./modules/mcpIntegration/mcp/runtime")`、`import("./modules/localRuntime/mobileLink")` | `typecheck`（TS 会解析动态说明符） |

> 结论：A.3 / `f2c` 都**抓不到**第 10-11 项（它们不是 `from` 行，也不是 `../` 前缀），只有 `bun run typecheck` 会失败——因此 M2 的“引用形态清点”必须逐条核对这 11 处，不能只跑 grep 判据。设计上把它列为 M2 出口条件之一（§5.2）。

### 3.6 设计决策汇总（本轮新增，均不改变验收期望值，除已标注的 D-01）

| ID | 决策 | 依据 | 待评审 |
| --- | --- | --- | --- |
| **D-01** | `app.ts` 用 7 个动态 `import("@/modules/<id>")` 装配；A.3 ③ 的 `app.ts` 段期望 0（合计 245）+ 新增装配判据 = 7 | F-02 | ☑ 需裁决 |
| **D-02** | R-07D 用「单行混合 import」而非新增 re-export 行 | F-04 | ☑ 需裁决 |
| **D-03** | `ModuleContext` 增 `pluginRoots`/`pluginRevision`；`ServerModule` 增 `gateways`；新增 `prepare`/`initializeRuntime` 具名导出 | F-03 / §2.3 | ☑ 需确认 |
| D-04 | 步骤 9 在 `app.ts` 写 `await mediaGeneration.refreshModels()`，函数内部 `await import(...)` + `void 刷新().catch(warn)` | 保真：B0 的 import 是 `await`（失败会 reject），只有“刷新”是 `void` | 记录 |
| D-05 | `corsOriginAllowed`（17 行）与 `prepare`（conf + locale）下沉到 `platformCore` 入口 | `app.ts` ≤80 行预算（附录 B）；`lib/i18n` 不得静态 import `conf`（会在 `app.ts` 静态图求值） | 记录 |
| D-06 | `scanBuiltin` 的扫描实体放 `plugins/initialize.ts`（既有文件），入口只留 1 行调用 | 入口 ≤60 行预算；R-03 禁止新增适配文件 | 记录 |
| D-07 | 路由分组注释由 `core.ts` 生成器产出（注释行不得包含 `app.use` 字面量） | `router.ts` 每次 dev 启动会被重写，手写注释会被覆盖 | 记录 |
| D-08 | 迁移期间以「一次性 prefix 替换脚本 + `typecheck` + 端点清单 diff」三道闸推进，脚本只在 /tmp 执行、不落库 | AGENTS 禁止新增测试/脚本文件；A-24 | 记录 |

---

## 4. 子需求详细方案

> 每条固定四段：**背景 → 目标 → 描述 → 详细方案设计**；末尾给「验收对应 / 风险与回滚」。
> 所有伪代码只表达结构与顺序，不落到真实实现；实际代码在评审通过后由实施方编写。

### R-01 模块契约对象与 7 个应用子模块入口

**背景**：现状只有目录名，没有“模块入口”。地图 side 把 237 个文件登记成 1 个模块，任何跨域调用都无法从代码结构上判定归属；`app.ts` 里的初始化序列是唯一的“事实模块表”。

**目标**：7 个入口各 ≤60 行、各自声明职责/前缀/初始化钩子/导出/依赖；入口本身不承载业务实现，只做编排与公开面。

**描述**：入口 = `default: ServerModule` + 领域所需的具名操作导出；契约见 §2.3。入口的组织规则（同时是 A-29 `lr1–lr5` 的实现约束）：

| 规则 | 内容 | 判据 |
| --- | --- | --- |
| R1-1 | 对**自家域内**文件只许相对路径（`./…`） | `lr2`（5 个入口 ≥1 处；`agentAccess`/`platformCore` 允许 0） |
| R1-2 | 入口内**不得**出现 `@/modules/<自身>` | `lr3=0` |
| R1-3 | 入口内**不得** import 其它模块（跨模块只能经 `ModuleContext` 注入或由 `app.ts` 装配） | `lr4=0` |
| R1-4 | `assets/thumb` 在 `assetLibrary` 入口内必须是**动态** `void import("./assets/thumb")` | `f1d=1`、`g2=1` |
| R1-5 | `@/agent/a2a` 在 `agentAccess` 入口内必须保持动态 import | A-13 `a3`（19 而非 20） |
| R1-6 | MCP 的四条 import 必须保持动态且写在 `mount` 内 | `g4b=4` |

**详细方案设计**：

**(a) 入口骨架（7 个同构，伪代码）**

```text
import type { ServerModule, ModuleContext } from "@/types/module"
<静态 import / re-export：只针对自家域，且不得把 conf 之外的副作用提前>     // 见 R1-7
export async function <操作名>(...) { ...编排... }                        // 步骤对应的实现，落在域文件或本文件

const module: ServerModule = {
  id: "<模块 id>",
  routePrefixes: ["/api/<前缀>", ...],
  gateways?: ["/mcp" | "/a2a"],
  dependencies: ["<白名单里的模块 id>", ...],
  exports: ["<具名导出>", ...],
  initialize?/warmup?/mount?: <编排函数>,
}
export default module
```

> R1-7（隐式规则）：入口**允许**静态 import 自家域文件（入口只在 `createApp` 内被动态 import，求值时机已在 `TOONFLOW_DATA_DIR` 之后）；唯一例外是 `assets/thumb`（R1-4，因为它读 `conf.path` 计算缓存根，且 f1d 要求动态形态）。

**(b) 逐入口设计**

| # | 入口 | routePrefixes | gateways | dependencies（白名单） | 具名导出（除 default） | 初始化职责 | 静态面是否会求值 conf |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `assetLibrary/index.ts` | `/api/assets` | — | localRuntime, mediaGeneration, platformCore | `warmup` | 步骤 5（预热，`void` + 空 catch） | 否（thumb 走动态） |
| 2 | `mediaGeneration/index.ts` | `/api/ai`, `/api/ffmpeg`, `/api/providers` | — | localRuntime, platformCore | `addMediaProvider`, `initializeProviders`, `refreshModels` | 步骤 4（供应商同步 + 哈希）、步骤 9（模型刷新） | **是**（`./media/provider`） |
| 3 | `pluginMarket/index.ts` | `/api/tools`, `/api/nodes`, `/api/ext`, `/api/skills`, `/api/agents`, `/api/plugins` | — | localRuntime, mediaGeneration, platformCore | `syncDirectory`, `initializeTools`, `initializeNodes`, `initializeExt`, `initializeSkills`, `initializeAgents`, `scanBuiltin`, `decodeText`, `skillPath`, `skillZip`, `listTools`, `skillFiles` | 步骤 1/2/3/6/7、步骤 8（内置扫描） | **是**（`./plugins/install`） |
| 4 | `mcpIntegration/index.ts` | `/api/mcp` | `/mcp` | localRuntime, mediaGeneration, platformCore, pluginMarket | `mount` | 步骤 11（`/mcp` 网关） | 否（4 条动态 import） |
| 5 | `localRuntime/index.ts` | `/api/workspaces`, `/api/desktop`, `/api/exec`, `/api/mobileLink` | — | assetLibrary, mediaGeneration, platformCore | `initializeRuntime` | 步骤 15（`initializeMobileLinkRuntime(app)`） | 否（动态 import） |
| 6 | `agentAccess/index.ts` | `/api/agent`, `/api/browser`, `/api/sessionState`, `/api/singleAgent` | `/a2a` | platformCore, pluginMarket | `mount` | 步骤 12（`/a2a`，动态 import `@/agent/a2a`） | 否 |
| 7 | `platformCore/index.ts` | `/api/settings`, `/api/monitor` | — | localRuntime, mediaGeneration | `prepare`, `corsGuard` | 步骤 0（`TOONFLOW_DATA_DIR` 之后求值 `conf` + `setLocaleFallback`）、中间件第 1 项 | 受控（`prepare` 内动态 `./conf`） |

> `dependencies` 的口径 = 该模块对其它模块的**直接 import 边**（A.11 口径，不含 bootstrap facade 与 `@/agent`）。上表与 §2.4 的 20 条边逐条对应：E10 的 7 条弱边（如 `assetLibrary → mediaGeneration` 1 行、`agentAccess → pluginMarket` 1 行）**也必须在白名单里**，否则「声明与实际边」会不一致（A-18 会把它当作未声明依赖）。

**(c) 关键入口的编排细节（伪代码）**

```text
// pluginMarket.scanBuiltin —— 步骤 8：键恰为 tool/node/ext/skill/agent，值为 Set<string>
scanBuiltin(context):
  return scanBuiltinIn(context.pluginRoots)
   其中 scanBuiltinIn 放在既有文件 ./plugins/initialize.ts：
     for each type in [tool,node,ext,skill,agent]:
        root = pluginRoots[type]; if (!root) → Set()
        entries = readdir(root, {withFileTypes:true}).catch(ENOENT → [], 其它 errno 抛出)
        names   = (skill|agent) ? 目录名 : 文件名按类型 pattern 过滤后去后缀
        pattern = tool → /^[a-z][a-zA-Z0-9]*\.tool\.js$/
                  ext  → /^ext-[a-z][a-zA-Z0-9]*\.umd\.js$/
                  其它 → /^[a-z][a-zA-Z0-9]*\.umd\.js$/
  return { tool, node, ext, skill, agent }        // app.ts 只做 1 次赋值
```

```text
// mediaGeneration.initializeProviders —— 步骤 4
initializeProviders(context):
  if (!(context.dataDirectory && context.pluginRoots.providers)) return      // 与 B0 守卫一致
  sourceDirectory = resolve(context.pluginRoots.providers, "media")
  revision = context.pluginRevision
  if (revision === undefined):
     hash = sha256()
     for name in ["tfRouter.ts","apiMart.ts","metaso.ts","compshare.ts"]:     // 顺序即数组顺序
        bytes = readFile(resolve(sourceDirectory, name)).catch(ENOENT → 空 Buffer, 其它 errno 抛出)
        hash.update(name).update("\0").update(bytes).update("\0")
     revision = hash.digest("hex")
  await context.syncPluginDirectory(resolve(dataDirectory,"providers"), sourceDirectory, ["tfRouter.ts",...], revision)
     // 注意：走 context 注入，绝不 import pluginMarket（A-08 的可判定要求之一）
```

```text
// platformCore.prepare —— 步骤 0（唯一允许求值 conf 的入口路径）
prepare():
  conf = (await import("./conf")).default          // 动态：保证 app.ts 已设置 TOONFLOW_DATA_DIR
  setLocaleFallback(() => normalizeLocale(conf.get("settings",{}).ui?.language) ?? detectLocale([...]))
```

**(d) `routePrefixes` 的并集校验思路**（A-07 的落地算法）

```text
prefixes = ∪ entry.routePrefixes        // 期望：21 项、两两无交集
manifest = §A.14 脚本输出（21 项 + 归属 + 首端点）
assert prefixes == manifest.keys 且 owner 一致
assert "/mcp" ∈ mcpIntegration.gateways 且不在任何 routePrefixes 里
assert "/a2a" ∈ agentAccess.gateways 且不在任何 routePrefixes 里
```

**验收对应**：A-06（7 入口存在/≤60 行/字段齐全）、A-07（前缀所有权）、A-18（依赖白名单）、A-29（`lr1–lr5`）。
**风险与回滚**：入口与实际目录脱节（“文档式拆分”）→ 用 `routePrefixes` 反向对账 + `dependencies` 与实际 import 对账；入口超 60 行 → 把实现体下沉到既有域文件（D-06 的同一原则），入口只留 1-2 行调用。

---

### R-02 `app.ts` 瘦身为组合根

**背景**：`app.ts` 160 行同时承担参数归一、6 类插件初始化、供应商哈希、缩略图预热、模型刷新、MCP/A2A 网关构造、静态资源、错误处理、移动互联初始化；这些职责与“组合根”无关，且各自有不同的阻塞性/错误语义。

**目标**：`app.ts` ≤80 行；禁用符号 0 命中；中间件 7 项顺序与行号可判；`createApp` 签名与返回值逐字不变。

**描述**：`app.ts` 只保留 5 件事——参数归一、**动态装配**、8 项初始化调用（步骤 1-8）、7 项中间件、静态/错误/收尾（步骤 9-15）。目标骨架（伪代码，行预算见附录 B）：

```text
import logger / express / buildRoute / errorFromCause / desktopRequest / languageRequest / getRuntimePlatform / resolve
import type { ModuleContext } from "@/types/module"

export async function createApp({ webRoot, appVersion = "", dataDirectory, toolsRoot, nodesRoot,
                                  extRoot, providersRoot, skillsRoot, agentsRoot, pluginRevision }: <同 B0 的匿名类型>) {
  if (dataDirectory) process.env.TOONFLOW_DATA_DIR = resolve(dataDirectory)                  // [0]
  const [platformCore, pluginMarket, mediaGeneration, assetLibrary, mcpIntegration, localRuntime, agentAccess]
    = await Promise.all([ import("@/modules/platformCore"), import("@/modules/pluginMarket"),
                          import("@/modules/mediaGeneration"), import("@/modules/assetLibrary"),
                          import("@/modules/mcpIntegration"), import("@/modules/localRuntime"),
                          import("@/modules/agentAccess") ])                                  // [1] 7 个字面量
  const context: ModuleContext = { appVersion, dataDirectory,
    pluginRoots: { tool: toolsRoot, node: nodesRoot, ext: extRoot, providers: providersRoot,
                   skills: skillsRoot, agent: agentsRoot },
    pluginRevision, syncPluginDirectory: pluginMarket.syncDirectory }                         // [2]
  await platformCore.prepare()                                                                // [3] 步骤 0
  await pluginMarket.initializeTools(context)                                                 // [4] 步骤 1
  await pluginMarket.initializeNodes(context)                                                 //     步骤 2
  await pluginMarket.initializeExt(context)                                                   //     步骤 3
  await mediaGeneration.initializeProviders(context)                                          //     步骤 4
  assetLibrary.warmup(context)                                                                //     步骤 5（void 语义）
  await pluginMarket.initializeSkills(context)                                                //     步骤 6
  await pluginMarket.initializeAgents(context)                                                //     步骤 7
  const app = express()
  app.locals.appVersion = appVersion
  app.locals.builtinPlugins = await pluginMarket.scanBuiltin(context)                         //     步骤 8（唯一赋值）
  if (getRuntimePlatform().development) { await buildRoute(); app.use(logger("dev")) }        //     dev 分支
  app.use(platformCore.corsGuard)                                                             // 中间件 1
  app.use(languageRequest)                                                                    // 2
  app.use("/a2a", express.json({ limit: "2mb" }))                                             // 3
  app.use(["/api/workspaces/files/write", "/api/assets/save"], express.raw({...,limit:"100mb"}))// 4
  app.use("/api/sessionState", express.json({ limit: "64kb" }))                               // 5
  app.use(express.json({ limit: "100mb" }))                                                   // 6
  app.use(express.urlencoded({ extended: true, limit: "100mb" }))                             // 6'
  app.use("/api/desktop", desktopRequest)                                                     // 7
  await mediaGeneration.refreshModels()                                                       //     步骤 9（见 D-04）
  await (await import("@/router")).default(app)                                               //     步骤 10
  await mcpIntegration.mount(app, context)                                                    //     步骤 11
  await agentAccess.mount(app, context)                                                       //     步骤 12
  app.use(express.static(webRoot))                                                            //     步骤 13
  app.use((err, request, response, next) => {                                                 //     步骤 14（内联 4 行）
    if (response.headersSent) return next(err)
    const body = errorFromCause(err); console.error(err)
    response.status(body.code).json(body)
  })
  await localRuntime.initializeRuntime(app, context)                                          //     步骤 15
  return app
}
```

**详细方案设计（关键判定点）**：

1. **为什么是动态 import**：见 D-01 / F-02。装配行写成 `import("@/modules/<id>")` 字面量，既满足「静态图不含 conf」，又让装配关系一眼可数（7 个）。
2. **步骤 8 的锚点**：`app.locals.builtinPlugins` 必须在 `const app = express()` **之后**、dev 分支**之前**，且全文件只出现 1 次赋值（A-08/A-10）。
3. **中间件顺序**：7 项必须逐行写开（不能用循环或数组），行号严格递增；`/api/sessionState` 的 64kb 必须在全局 `express.json` 之前（大 body 不能被先按 100mb 读入）。
4. **CORS 第 1 项**：`corsOriginAllowed`（拒 `Origin: "null"`、拒非同源、放行设备令牌）整体搬到 `platformCore.corsGuard`，`app.ts` 只引用。**禁止**把 `cors()` 换成静态配置——它会改变 403 语义。
5. **错误处理内联**：`headersSent → next(err)`；否则 `console.error(err)` + `errorFromCause(err)`；顺序与 B0 一致（步骤 13 之后、15 之前）。
6. **`createApp` 幂等**：`app.ts` 不得新增模块级可变状态；两次调用只允许通过 `initializePlugins` 的 marker 生效（`f5`）。

**验收对应**：A-08（≤80 行 + 禁用符号 0 + `builtinPlugins` 1 处）、A-09（中间件行号）、A-10（步骤 8 锚点）、A-25（`f2a/f2b` 静态导入边界）、A-21（三宿主）。
**风险与回滚**：行数超标 → 附录 B 给出 3 个可裁剪项（优先级从低到高）；中间件写法“顺手合并” → A-09 行号判据直接 FAIL；`conf` 提前求值 → `f2b` 会写仓库 `data/settings.json`，属于**可观测污染**，M0 必须先记录该文件 md5。

---

### R-03 初始化 15 步归口与「顺序 + 阻塞性 + 错误语义」固化

**背景**：15 步的顺序与失败语义现在只存在于 `app.ts:59-158` 的代码里。第 3 轮打回指出步骤 5 的“非阻塞 + 静默吞错”未被记录，实施时极易被“统一化”成 `await` 或加日志。

**目标**：15 步逐行迁入入口后，**顺序、阻塞性、错误语义、B0 行号锚点**仍可逐行核对。

**描述（归口表：步骤 → 入口符号 → 阻塞性 → 错误语义 → 保真要点）**：

| 序 | 入口符号 | 阻塞性 | 错误语义（必须保真） | 设计要点 |
| --- | --- | --- | --- | --- |
| 1 | `pluginMarket.initializeTools` | `await` | 抛出 → `createApp` reject | `dataDirectory && tool` 守卫保留 |
| 2 | `pluginMarket.initializeNodes` | `await` | 抛出 | pattern `*.umd.js` |
| 3 | `pluginMarket.initializeExt` | `await`（内部动态 import `initializeExt`） | 抛出 | **保持动态 import** |
| 4 | `mediaGeneration.initializeProviders` | `await` | 抛出 + `readFile` 的 `ENOENT → 空 Buffer`，其它 errno 抛出 | 哈希顺序=数组顺序；`pluginRevision` 有值时跳过哈希；同步走 `ctx.syncPluginDirectory` |
| 5 | `assetLibrary.warmup` | **同步调用，不 await** | **静默吞错**：`void import("./assets/thumb").then(...).catch(() => {})`，空 catch，无日志 | 位置在步骤 4 之后、6 之前；清扫体内部失败由 `thumb.ts` 自己 warn 并 resolve |
| 6 | `pluginMarket.initializeSkills` | `await` | 抛出 | 首次安装补齐 |
| 7 | `pluginMarket.initializeAgents` | `await` | 抛出 | 同上 |
| 8 | `pluginMarket.scanBuiltin` → `app.locals.builtinPlugins` | `await`（`Promise.all`） | 抛出 + `readdir` 的 `ENOENT → []` | **在 `express()` 之后**；5 键 `Set<string>` |
| 9 | `mediaGeneration.refreshModels` | 刷新 `void`（import 仍 `await`，见 D-04） | **warn**：`void initializeProviderModels().catch(warn)` | **不得与步骤 5 合并成同一 helper** |
| 10 | `router.default(app)` | `await`（动态 import） | 抛出 | 161 条挂载 |
| 11 | `mcpIntegration.mount` | `await`（4 条动态 import 并发） | 抛出 | `/mcp` + 翻译/本地化上下文包装 |
| 12 | `agentAccess.mount` | `await`（动态 import `@/agent/a2a`） | 抛出 | 改静态会让 `a3` 由 19 变 20 |
| 13 | `express.static(webRoot)` | 同步注册 | — | — |
| 14 | 错误处理中间件 | 同步注册 | `headersSent → next`；否则 `console.error` + `errorFromCause` | 位于 13 之后、15 之前 |
| 15 | `localRuntime.initializeRuntime(app, context)` | `await`（内部动态 import） | 抛出 | 只登记 `app` 的 runtime 槽位（`runtimes` Map） |

**详细方案设计（保真约束清单，实施期逐条自检）**：

```text
[F1] 步骤 5 必须保持「动态 import + then + 空 catch」三件套
     ✗ 不许改成 await / ✗ 不许加 console.warn / ✗ 不许与 Promise.all 合并
[F2] 步骤 9 的 warn 必须留在入口（`initializeProviderModels().catch(warn)`），且与步骤 5 不是同一 helper
[F3] 步骤 4 的 ENOENT 容错只覆盖 readFile；不得扩大成 catch-all
[F4] 步骤 8 的 ENOENT 容错只覆盖 readdir
[F5] 步骤 3 与 12 的动态 import 不得改静态
[F6] TOONFLOW_DATA_DIR 必须先于 conf 求值（app.ts [0] 在 [1] 之前）
[F7] conf 的默认数据目录锚点随迁移补深度（R-15）
[F8] singleAgent/types.ts 的相对 import 只补深度、不改 alias（R-15 / f2c）
```

**验收对应**：A-10（顺序 + 步骤 8 锚点 + 5 键 Set）、A-25（`f1a–f5`）、A-26（`g1–g6` 结构层 + 语义层逐行比对）。
**风险与回滚**：语义被“统一化”（R4/R17）→ `g3`（空 catch 计数）、`g4`（warn 型）在 F 相各自 =1，合并即 FAIL；步骤 8 位置被移动 → `g5` 行号判据 FAIL；预热被改成 `await` → `g1=1`（期望 0）FAIL。

---

### R-04 服务目录模块化（迁移）

**背景**：15 个 `utils/*` 子域、246 处深路径（含 agent 侧 50 处）、145 个 facade 调用面。这是本需求体量最大、最容易“漏一处”的部分。

**目标**：`src/utils/**` 交付态为空（`src/utils.ts` 除外）；7 个模块目录成形；246 处说明符一处不漏；`@/utils/` 深路径归零。

**描述（迁移流水线）**：

```text
M2-1  git mv（按附录 A 的 15 个域 + 3 个顶层文件 + remoteConnection.ts）
M2-2  前缀替换（alias 形态不变）：
        @/utils/<域>[/…] → @/modules/<模块>/<域>[/…]
        覆盖 5 个命名空间：agent 50 / routes 62 / utils→modules 103 / utils.ts 30 / app.ts（转型为入口装配）
M2-3  非 from 形态的 11 处（附录 C）逐条处理：8 处进入口、1 处 alias 换前缀、2 处相对路径换前缀
M2-4  深度补偿 2 处（R-15）
M2-5  exports 映射（5 个 target）+ AGENTS.md + 模块清单（R-09）
M2-6  三道闸：typecheck → 端点清单 diff → 深路径计数（246 → 245/252，见 D-01）
```

**详细方案设计（关键点）**：

1. **只用 `git mv`，不用“复制 + 删除”**：保证 L1 台账把 237 个文件识别为「移动」而非「新增 + 删除」（A-01/A-02 的判定基础）。
2. **前缀替换必须“先长后短”**：先替换 `@/utils/`（带斜杠）再处理裸 `@/utils`（facade，不动）。否则会把 `@/utils` facade 误改成 `@/modules`。伪代码：

```text
for file in all_ts(exclude: agent? no —— agent 也要改说明符):
   text = read(file)
   text = replace_all(text, 'from "@/utils/', 'from "@/modules/<owner(域)>/')       // 按域映射
   text = replace_all(text, 'import("@/utils/', 'import("@/modules/<owner(域)>/')   // 同域内允许保留 alias
   write(file)
assert 不含 'from "@/utils/' 的残留（白名单：src/utils.ts 自身、facade 行 'from "@/utils"'）
```

3. **`src/agent/**` 必须改**：50 处 `@/utils/<域>` 是**说明符**，不是依赖方向；NG1 只承诺“不消除运行期依赖”，不豁免“路径更新”。漏改会由 `typecheck` 直接抓（模块不存在）。
4. **深度补偿**：
   - `modules/platformCore/conf/index.ts`：`resolve(import.meta.dirname, "../../../../../data")` → **6 级**（`../../../../../../data`），保证 `f2a=1`；
   - `modules/agentAccess/singleAgent/types.ts`：`"../../agent/runtime/types"` → **`"../../../agent/runtime/types"`**，且**不得改 alias**（否则 `a3` 19→20、A.11 多一条未登记边、`f2c` 2→1）。
5. **不动的东西**：`src/routes/**`（URL）、`src/lib/**`、`src/types/**`、`src/{app,index,core,router,utils}.ts` 的路径、`src/index.ts:3` 的 `../../../electrobun.config`。

**验证分层（对应判据）**：

| 层 | 手段 | 判据 |
| --- | --- | --- |
| 编译 | `bun run typecheck` | A-19（必然抓住所有漏改的 alias 与相对路径） |
| 计数 | `grep -rho 'from "@/modules/[a-zA-Z]*'` 分段 | A.3 ③（50/62/103/30/0 或 7） |
| 归零 | `grep -rn 'from "@/utils/'` = 0，`find src/utils -name '*.ts'` = 0 | A.3 ⑤（`scope_min=263`） |
| 台账 | L1/L2/L3 审计脚本 | A-01～A-03（246 = 237 + 9） |

**验收对应**：A-01～A-03、A-12、A-19、A-29。
**风险与回滚**：`routes` 段 62 处漏改 → 端点 404（A-11 端点 diff 为 `path` 未变，但运行期 404 会在冒烟暴露）；**回滚策略**：迁移作为**单一提交**（M2 一个 commit）落地，任一闸失败即 `git revert`，不产生“半迁移”工作树（半迁移会让 `utils/` 与 `modules/` 同时存在，测试与冒烟基线全部失效）。

---

### R-05 路由装配分组（默认 E4：保留 161 条挂载）

**背景**：`router.ts` 327 行、161 条扁平 `app.use`，由 `src/core.ts` 扫描 `routes/**` 自动生成（`fileNameToRoutePath` 决定 URL）。手写的分组注释会在下次 dev 启动被生成器覆盖。

**目标**：URL 与挂载条数完全不变；`router.ts` 有 7 段模块分组注释；注释与入口 `routePrefixes` 可对账。

**描述**：改造点在**生成器**（`core.ts`）而非产物（`router.ts`）。E4 默认：仍是“每文件一条 `app.use`”。

**详细方案设计**：

```text
core.ts 模板改造（伪代码）：
  owners = { agent: agentAccess, agents: pluginMarket, ai: mediaGeneration, assets: assetLibrary,
             browser: agentAccess, desktop: localRuntime, exec: localRuntime, ext: pluginMarket,
             ffmpeg: mediaGeneration, mcp: mcpIntegration, mobileLink: localRuntime,
             monitor: platformCore, nodes: pluginMarket, plugins: pluginMarket, providers: mediaGeneration,
             sessionState: agentAccess, settings: platformCore, singleAgent: agentAccess,
             skills: pluginMarket, tools: pluginMarket, workspaces: localRuntime }        // 21 项，源自 §3.6
  for entry in sorted(routes/**/*.ts):
     firstSegment = entry 的第一段（agent.ts 与 agent/** 归并）
     if owners[firstSegment] 与上一条不同:
        emit  "  // ---- <module> : /api/<segment> ----"        // 注释里不得出现 "app.use" 字面量
     emit  app.use("/api" + fileNameToRoutePath(entry), routeN)
  if 生成内容 == 现有文件内容: 不写盘
```

**关键约束**：

1. 注释行**不得包含 `app.use` 字面量**，否则 `grep -c 'app.use' router.ts` 会 >161，A-11/R-05 判 FAIL。
2. 生成器不再“只比 import/挂载段”，而是**整文件比对**（现有行为），所以分组注释必须由生成器产出，否则每次 `bun run routes` 就丢。
3. `owners` 表是唯一来源：A-07 用同一张表反向核对入口 `routePrefixes`；两边不一致即 FAIL。
4. 若后续评审选 Q2-C（前缀子 Router），需另立需求；本方案不做。

**验收对应**：A-07（前缀所有权）、A-11（162 端点 / 161 挂载 diff 为空）、A-24（无新增路由文件）。
**风险与回滚**：注释影响挂载计数 → 上面第 1 条已约束；生成器改造破坏 URL → 端点清单 diff（`method + path` 字符串比较）立即暴露。

---

### R-06 聚合入口 `utils.ts` 收敛为薄 facade

**背景**：`utils.ts` 75 行、37 个 key、5 个来自 `@/agent`；145 个文件（其中 144 个路由文件）依赖它。它是“编译期依赖闭包”的集中点，但**不能删**：改 145 个调用点的收益远小于风险。

**目标**：37 个 key 与 B0 逐 key 一致；145 个调用文件零修改；每个 key 有归属模块注释；≤130 行。

**描述**：结构从“平铺 re-export”改为“按模块分组 + 组内 re-export”，导出名与默认对象形状完全不变。

**详细方案设计**：

```text
// 文件结构（伪代码）
/* bootstrap：框架与平台能力 */        → conf / personalization
/* assetLibrary */                    → assets
/* mediaGeneration */                 → mediaGeneration, mediaTasks, mediaProvider, mediaBilling,
                                        ffmpeg, ai, aiRuns, providerDebug
/* pluginMarket */                    → plugins, nodePlugins, extPlugins, pluginInstall, skillFile, teams
/* mcpIntegration */                  → mcpControl, mcpRuntime, mcpServers, mcpDxt
/* localRuntime */                    → workspace, workspaceFile, workspaceDownload, chatImages, desktop, exec, mobileLink
/* agentAccess（E2：保留 5 个 agent 出口） */ → agent, canvas, question, a2aSettings, browser, singleAgent, mentionFiles
/* platformCore */                    → cleanNodeMenuSettings, removeLegacySettings

export default { <37 个 key，顺序可与 B0 相同或按组排列，键名逐字一致> }
```

**关键约束**：

1. **`src/utils.ts` 不得被 bootstrap 静态图引用**：它静态 import 了 `@/modules/platformCore/conf`，一旦 `app.ts`/`core.ts` 静态引入，`conf` 会在 `TOONFLOW_DATA_DIR` 之前求值（与 R-02 同一约束）。
2. 迁移后 `utils.ts` 的 30 处 `@/utils/<域>` 说明符改为 `@/modules/<模块>/<域>`，**行数仍是 30**（A.3 ③ 的 `utils.ts` 段）。
3. 5 个 agent 出口保持（E2）；`mentionFiles` 的 `from "@/utils"` 是 145 个 facade 文件中的第 145 个，不许动。
4. 组内注释只写模块名，不写“TODO/临时”——注释被 A-06/A-18 用来对账归属。

**验收对应**：A-12（37 key diff 为空）、A-22（145 facade 文件不变）、A-18（facade 边仍归 bootstrap）。
**风险与回滚**：顺手“优化”某个 key 名 → 145 个调用面在 typecheck 阶段大面积报错（可自动发现）；把 facade 做成“按需懒加载” → 会让同步调用点变成 Promise（行为破坏），**禁止**。

---

### R-07 跨域依赖边 A–D 的消除与契约化

**背景**：4 类跨域调用隐式存在：`assets/workspaces → @/agent/mentionSources`（4 处）、`plugins → media/provider`（1）、`mcp → plugins/skills`（3）、`conf ↔ teams/mobileLink`（2 type + 4 value）。

**目标**：A 的 4 处归零；B/C 深路径归零、改为模块公开入口；D 的 2 条 type 边归零且反向 4 条 value 不变；计数变化只允许矩阵 §2.4 登记的形态。

**描述与详细方案设计（逐边）**：

**(A) `mentionSources` 下沉**

```text
新建 src/lib/mentionSources.ts（≤30 行）：
    export type MentionQuery = { query?, cursor?, limit?, signal? }
    export function mentionAssetType(path) { … }        // 依赖 ./documentFormats（同目录，平台层）
agent/mentionSources.ts：
    删除上述两个定义，改为 `export type { MentionQuery } from "../lib/mentionSources"`
                            `export { mentionAssetType } from "../lib/mentionSources"`
    ← 路径不变，`@toonflow/server/agent/mentionSources` 契约不变（R-08）
4 处调用点改指 `@/lib/mentionSources`：
    modules/assetLibrary/assets/index.ts（type）/ library.ts / thumb.ts
    routes/workspaces/files/thumb.ts
计数效果：server→agent 23 − 4 = 19；asset→platform 24 + 3 = 27；local→platform 75 + 1 = 76
```

> 注意：`agent/mentionSources.ts` 里其余函数（`mentionRecord/mentionNodeName/…`）**不移动**，避免把 agent 的编排语义搬进 lib；只下沉“纯类型 + 纯路径判定”这 2 个符号，这也是 NG1 允许的“非编排类工具/类型依赖下沉”。

**(B) `pluginMarket → mediaGeneration` 单向契约**

```text
pluginMarket/index.ts：export { addMediaProvider } from "./media/provider"       ← 公开面（b5 的目标）
plugins/install.ts：   import { addMediaProvider } from "@/modules/mediaGeneration"   // 整行逐字
                         ← 原 `@/utils/media/provider`（1 行 1:1 替换，A.3 的 103 段不变）
计数效果：pluginMarket→mediaGeneration 深路径 1 → 0（入口引用）；边计数仍 1（#19 不变）
```

**(C) `mcpIntegration → pluginMarket` 契约化**

```text
pluginMarket/index.ts：
    export { decodeText, skillPath, skillZip } from "./plugins/install"     ← c9 要求逐字存在
    export { listTools } from "./plugins/tools"
    export * as skillFiles from "./skills/files"
mcp/dxt.ts：      import { decodeText, skillPath, skillZip } from "@/modules/pluginMarket"
mcp/tools.ts：    import { listTools } from "@/modules/pluginMarket"
mcp/resources.ts：import { skillFiles as skillFile } from "@/modules/pluginMarket"   // namespace 别名，调用面不变
计数效果：3 条深路径 → 0；入口引用 3；`skillFile.` 调用点 7 处、dxt 符号行 4 处保持不变
```

**(D) `conf ↔ teams/mobileLink` 的 type 环消除（机制见 D-02）**

```text
platformCore/conf/index.ts：
    删除 `import type { RemoteTeam } from ...`、`import type { MobileLinkConfig } from ...`
    在本文件定义 RemoteTeam / MobileLinkConfig（配置 schema 的 owner）
    需要 AgentCard 时：`import type { AgentCard } from "@toonflow/teams-scaffold/a2a"`（不命中 d3 的 pattern）
pluginMarket/teams/index.ts（第 5 行）：
    import conf, { type RemoteTeam } from "@/modules/platformCore/conf"          ← 单行混合，行数不变
localRuntime/mobileLink/index.ts（第 10 行）：
    import conf, { type MobileLinkConfig } from "@/modules/platformCore/conf"    ← 同上
    删除本地 `export type RemoteTeam` / `export type MobileLinkConfig` 定义行
计数效果：d3（conf 侧）= 0；d4（反向，只数行）= 4 不变；A.3 的 103 段不变；A.11 #17 = 0、#15 保留 1 条 value
```

**契约影响与回滚**：

| 变动 | 对外影响 | 兜底 |
| --- | --- | --- |
| `agent/mentionSources.ts` 变 re-export | `@toonflow/server/agent/mentionSources` 路径/导出名不变 | A-12（14 exports 键名）+ 桌面 `mentionSources` 引用冒烟 |
| `RemoteTeam` / `MobileLinkConfig` 的“定义文件”变化 | 包里没有导出这两个类型（查看 `package.json` exports），仓内消费者由 typecheck 覆盖 | `bun run typecheck` |
| 入口 re-export 造成 `pluginMarket` ⇄ `mediaGeneration` 双向？ | **不会**：`mediaGeneration` 不 import `pluginMarket`（走 `ctx.syncPluginDirectory`） | A-18 白名单审计 |

**验收对应**：A-13（`a1=4`→`a2=0`、`a3` 三个计数）、A-14（`b1..b5`）、A-15（`c1..c9`）、A-16（`d1..d5`）。

---

### R-07E `dxt ↔ servers` 模块内环（默认 E11 冻结）

**背景**：B0 的 2 个 file 级 SCC 之一；R-07D 之后是唯一残留（`size=2`）。

**目标**：默认保留 2 条边，两相各 1；形态冻结（文件内 0 处相对 import）；SCC `count=1,size=2`。

**描述**：两函数（`removeBundleDirectory` / `removeMcpBundle`）互为兜底清理，拆出第三方模块只增加无业务含义的抽象。

**详细方案设计**：

```text
迁移后路径：modules/mcpIntegration/mcp/{dxt.ts,servers.ts}
dxt.ts     : import { saveImportedMcpServers } from "@/modules/mcpIntegration/mcp/servers"   ← 保持 alias
servers.ts : import { removeMcpBundle } from "@/modules/mcpIntegration/mcp/dxt"              ← 保持 alias
禁止：改成 "./servers" / "./dxt"（会让 e5a/e5b 由 0 变 1，SCC 判据与形态冻结同时失真）
若评审选 Q8（消除）：新增 mcp/bundle.ts（L2 10 / L3 247），两命令归零、SCC=0
```

**验收对应**：A-17（`e1..e6`）、A-18（SCC）、E11 模板（§8.4）。
**风险与回滚**：把“冻结”当“未完成” → E11 勾选栏明确“已裁决=保留”；误改成相对路径 → `e5` 立即 FAIL。

---

### R-08 宿主装配兼容（`createApp` 签名与 14 exports）

**背景**：三宿主（独立 server / Electrobun 桌面 / Android·OHOS 移动）复用 `@toonflow/server/app`；桌面在拿到 app 后注入 `app.locals.desktop`；移动端在 `listen` 后初始化 MCP 与设备互联。

**目标**：`createApp` 签名与返回值逐字不变；14 个 exports 键名逐字不变（5 个 target 随迁移更新）；三宿主可启动。

**描述**：迁移会改变 5 个 export 的 target 文件位置，键名与导出符号不变。

**详细方案设计**：

| export 键 | B0 target | F target | 备注 |
| --- | --- | --- | --- |
| `./app` | `src/app.ts` | 不变 | 签名不变 |
| `./remoteConnection` | `src/remoteConnection.ts` | `src/modules/localRuntime/remoteConnection.ts` | 桌面/移动 `createRemoteConnection` |
| `./mcp` | `src/utils/mcp/runtime.ts` | `src/modules/mcpIntegration/mcp/runtime.ts` | 桌面/移动 `initializeMcpRuntime` |
| `./mobileLink` | `src/utils/mobileLink/index.ts` | `src/modules/localRuntime/mobileLink/index.ts` | 5 个符号 |
| `./browser` | `src/utils/browser/index.ts` | `src/modules/agentAccess/browser/index.ts` | `closeBrowsers` |
| `./singleAgent/types` | `src/utils/singleAgent/types.ts` | `src/modules/agentAccess/singleAgent/types.ts` | 类型契约 |
| 其余 8 个 | `src/lib/**`、`src/types/**`、`src/agent/**` | 不变 | 不移动 |

**验证步骤（伪代码）**：

```text
1) 键集合 diff：package.json exports 的 key 排序后与 B0 比对 → 空
2) target 存在性：每个 target 文件必须存在（G-EXIST）
3) 符号可解析：对 14 个键逐个 `import(...)` 冒烟（Bun 运行时），断言至少 1 个具名导出
4) 三宿主启动：server(dev/build) / desktop / mobile，10s 内端口监听且无未捕获异常
5) 桌面门禁：`/api/desktop/*` 15 端点仍挂在 `app.use("/api/desktop", desktopRequest)` 之后
```

**关键约束**：桌面在 `createApp` **之后**注入 `app.locals.desktop`，因此 `desktopRequest` 必须在**请求期**读 `req.app.locals.desktop`（现状即如此）；方案不改这一时序，也不把 desktop 门禁搬进入口（否则注入顺序会破坏 15 个端点的 404/403 语义）。

**验收对应**：A-12（14 exports / 36 文件 / 57 引用）、A-21（三宿主）、A-19（build 产物启动）。
**风险与回滚**：target 改错 → 桌面 `connection.ts` 等 5 个入口编译失败（可自动发现）；`/api/desktop` 门禁位置被移动 → 15 端点冒烟（S1..S8 之外的 A-21 判据）失败。

---

### R-09 规范、地图与包导出同步

**背景**：地图现在把 237 个文件记成 1 个模块（`health.score = 50`、`god_module`）；`AGENTS.md` 的目录结构章节没有 `src/modules/**` 这一层；地图详细快照还滞后 9 个文件。

**目标**：文档、地图、包导出三处与代码同构，重算后能被地图工具直接消费。

**描述与详细方案设计**：

```text
1) AGENTS.md 增补「服务端模块划分」小节：
   - 8 个模块 id / 职责 / 路由前缀 / 入口文件 / 依赖白名单（一张表）
   - 入口约定：default 导出 ServerModule；入口不 import 其它模块；自家域内用相对路径
   - 迁移约定：`@/modules/<模块>/<域>` 形态冻结，禁止相对路径跨模块
2) 模块清单：即 AGENTS.md 的同一张表（不新增机器可读文件，避免 L2 越界）。
   地图工具按目录结构识别 `src/modules/<id>`（`src/utils/**` 清空后不会再有歧义），
   清单的用途是“人读 + 评审对账”，不作为地图输入；若地图工具需要显式 hint，则在 M5 复算时再定（届时仍不新增仓库文件）
3) 地图重算：用现有工具扫描 HEAD（不手改 map.json 的模块定义）
4) package.json exports：5 个 target 随迁移更新（R-08 表）
5) tsconfig：`paths: {"@/*": ["./src/*"]}` 已自动覆盖 `src/modules/**`，**不新增条目**
6) 变更记录：登记 §1.2 的 2 处归属更正（documents.ts → mediaGeneration、fileHttp.ts → platformCore）
   与 9 个滞后文件；重算校验 `237 + 9 = 246`
```

**验收对应**：A-22（AGENTS 一致 / 地图 8 模块 / exports 无悬空）、A-12。
**风险与回滚**：地图 glob 口径与 §A.1 不一致 → 在模块清单里显式写“统计口径 = 附录 A.1”，重算用同一脚本；`AGENTS.md` 写成“未来态” → 要求“写完的当天必须与代码一致”，否则 M5 不算通过。

---

### R-10 回归基线与 13 项冒烟（先行）

**背景**：行为不可变是本需求唯一的硬承诺；所有结构判据都建立在“端点集合与响应不变”的前提上。

**目标**：M0 冻结 5 份基线 + 13 项冒烟 + S1–S8 + 21 个前缀首端点；交付态逐条 diff 为空。

**描述（冒烟执行器的设计，不落库）**：

```text
/tmp/smoke.ts（heredoc 生成，不进仓库）：
   build = process.env.SMOKE_BASE   // "B0" | "F"，决定读取哪份基线快照
   app   = await createApp({ webRoot: <tmp>/web, dataDirectory: <tmp>/data, ...六类插件根 })
   server = app.listen(0)            // 随机端口
   for case in 13 项:
       res = await fetch(url, {method, headers, body})
       record = { status, contentType, normalizedBody | sseEvents }
       write(`/tmp/baseline-${build}/${case}.json`, record)
   归一化：时间戳→<TS>；UUID→<UUID>；绝对路径→<PATH>；端口→<PORT>；临时哈希→<HASH>；
           SSE 只记事件类型序列；忽略 date/etag；数组顺序保留、对象 key 排序
   diff：逐 case 比较 B0 与 F 的快照，输出 `smoke_diff=<n>`（期望 0）
```

**关键设计**：

1. **fixture 固定**：13 项里的 `<fixture>` 是同一份临时工作区（M0 归档其目录树哈希）；无供应商/无桌面宿主时按“改动前后一致”判 4xx（§6.6 规则 4）。
2. **21 前缀首端点**：用 §A.14 脚本输出首端点清单，逐条只比 `status`（避免把列表内容差异误判为回归）。
3. **S1–S8**：覆盖 `builtinPlugins` 的 5 组消费与 MCP/导出路径，只要求“有记录”，不要求 200。
4. **三宿主**：独立 server（dev + `build/server`）、桌面（Electrobun）、移动端；桌面额外验证 15 个 `/api/desktop/*` 端点的门禁码不变。
5. **为什么不用测试框架**：AGENTS 禁止新增测试/自检文件（A-24），冒烟脚本只在 `/tmp`，输出粘贴进证据日志。

**验收对应**：A-11（端点 diff）、A-20（13 + S1–S8 + 21 前缀）、A-21（三宿主）、A-19（typecheck/build）。
**风险与回滚**：环境差异（无 FFmpeg/无供应商/无桌面）→ 以“B0 与 F 一致”为判据而非固定 200；随机端口/临时目录导致 diff 噪声 → 已在归一化规则里列出。

---

### R-11 结构化豁免登记

**背景**：验收口径允许“无法消除项”以结构化豁免收口，但要求可执行判据与复核触发条件。

**目标**：E1–E12 逐条完整；被驳回的豁免转为验收项。

**描述与详细方案设计**：

```text
每条豁免填 8 个字段（模板见矩阵 §8.3）：
  [E<n>] 标题 / 关联需求与验收项 / 事实与证据（file:line + 计数 + 命令）/
  未消除理由（契约·范围·风险 三选一 + 具体说明）/ 替代缓解（机制 + 判据）/
  复核触发条件（阈值/事件/时间）/ 责任人（角色）/ 有效期
规则：
  - 无判据的豁免无效（A-23）
  - E11/E12 必须用矩阵 §8.4 的完整模板且判据两相化
  - 本轮不新增豁免：方案已把 E1–E12 全部映射到 R 与 A（见下表）
```

| 豁免 | 本方案落点 | 判据 |
| --- | --- | --- |
| E1 插件内核复用 | R-07C 入口 re-export | A-15 `c7/c9` |
| E2 `utils.ts` 5 个 agent 出口 | R-06 facade 保留 | A-12 |
| E3 `/api/exec` 归 localRuntime | R-04 目录归属 | A-04/A-18 |
| E4 161 条扁平挂载 | R-05 E4 | A-07/A-11 |
| E5 `conf` 2 条 value 依赖 | R-07D 保留反向 value | A-16 `d5` |
| E6 19 处 agent 运行期依赖 | R-07A 只消除 4 处 | A-13 `a3` |
| E7 `platformCore → @/agent` 3 处 | 不动 | §2.3 边界表 |
| E8 MCP 运行 Agent | 不动 | §2.3 |
| E9 `pluginMarket` A2A 校验 | 不动 | §2.3 |
| E10 7 条弱边 | R-13 冻结 | A-18 |
| E11 `dxt ↔ servers` | R-07E | A-17 |
| E12 模块级 SCC | R-13 | A-18 |

**验收对应**：A-23。
**风险与回滚**：豁免写成“以后再说” → 缺判据即无效；评审驳回即回到对应 R 的验收项。

---

### R-12 三本台账与预算审计

**背景**：第 2 轮打回 #1 的根因是“移动/新增/删除”混算；第 5 版引入的 `scope_files` 观测化把“文件数变化”与“判据有效性”解耦。

**目标**：L1 `237/237`、L2 `new_total=9`、L3 `246 = 237 + 9`，逐模块预算全通过。

**描述（审计算法，按序执行）**：

```text
B0      = git ls-tree -r --name-only <base> -- apps/server | 过滤 .ts（附录 A.1 glob，排除 src/agent/**）
MOVED   = 显式 old → new 映射（15 个域 + documents/exec/remoteConnection + monitor/personalization/fileHttp）
EXPECTED= apply(MOVED, B0) ∪ L2(9)
FINAL   = find apps/server -name '*.ts' 过滤（src/modules/** + lib/** + routes/** + types/**
          + 5 个根文件 + scripts/**；排除 src/agent/**；src/utils/** 必须为空）
assert FINAL == EXPECTED                      → actual_expected_diff = 0
NEW     = FINAL − apply(MOVED, B0)            → 9，且路径逐字等于 §3.3 L2 表
DELETED = B0 − MOVED.keys                     → 0
L1 = assign(B0)        → {237, assigned 237, unassigned 0, duplicated 0, orphan 0}
L3 = assign(EXPECTED)  → {246, assigned 246, unassigned 0, duplicated 0}
assert per_module: business ≤ 50 ∧ final ≤ 55 ∧ lines ≤ 3300 ∧ bootstrap ≤ 900 ∧ entry ≤ 60
assert 单项预算：app.ts ≤ 80、utils.ts ≤ 130、每个入口 ≤ 60
```

**逐模块预算（交付态，与矩阵 §3.3 一致；行数上限 = 存量 + L2 预算）**：

| 模块 | 业务 | 契约 | 交付 | 行数上限 |
| --- | --- | --- | --- | --- |
| bootstrap | 8 | 1 | 9 | 750（另 ≤900） |
| assetLibrary | 27 | 1 | 28 | 2,675 |
| mediaGeneration | 42 | 1 | 43 | 3,054 |
| pluginMarket | 49 | 1 | 50 | 2,343 |
| mcpIntegration | 20 | 1 | 21 | 1,493 |
| localRuntime | 45 | 1 | 46 | 2,255 |
| agentAccess | 26 | 1 | 27 | 1,256（+3 漂移，见 F-01） |
| platformCore | 20 | 2 | 22 | 1,016 |
| 合计 | **237** | **9** | **246** | **14,842** |

**验收对应**：A-01～A-05、A-28（`scope_assertions=0`）。
**风险与回滚**：`git mv` 被替换成“复制 + 删除” → `DELETED ≠ 0` / `NEW > 9`，审计直接失败；把新文件藏进既有目录 → `FINAL − apply(MOVED,B0)` 仍是 9（因为路径集合比对，不看目录）。

---

### R-13 模块级 SCC 与依赖白名单

**背景**：`assetLibrary / localRuntime / mediaGeneration / platformCore / pluginMarket` 之间存在双向依赖（如 `asset→local 8` / `local→asset 3`），要求“模块级无环”在本次范围内不可达。

**目标**：不承诺 DAG；只承诺“20 条直接边的计数不超过 R-07 后的预期值、且不出现新的 source→target 对”。

**描述（审计算法）**：

```text
edges = 扫描 src/**（排除 agent/**）的 `import ... from`（A.11 口径：只算 import，不算 re-export）
按 owner(file) 归属模块；对每条解析目标文件并归属 → 聚合 (source,target) → {lines,type,value}
SCC   = Tarjan(模块图)        → 期望 {assetLibrary, localRuntime, mediaGeneration, platformCore, pluginMarket}
                                + {agentAccess} + {mcpIntegration}
文件级 SCC（A.6 口径：import + export…from）→ 期望 R-07D 后 count=1（size=2，dxt/servers）
白名单：每个入口 dependencies ⊆ 附录 C；E10 的 7 条弱边逐条 current ≤ 预期
```

**预期值（与矩阵 §2.4 对齐）**：`#5 24→27`、`#8 75→76`、`#15 2→1`、`#17 1→0`、`#12/#19` 计数不变；其余 15 条不变。

**详细方案设计（白名单表，入口 `dependencies` 的唯一合法取值）**：

| 入口 | 允许依赖（= 该模块的直接 import 边） | 对应 §2.4 的边 |
| --- | --- | --- |
| assetLibrary | localRuntime, mediaGeneration, platformCore | #3、#4(E10)、#5 |
| mediaGeneration | localRuntime, platformCore | #13、#14 |
| pluginMarket | localRuntime, mediaGeneration, platformCore | #18、#19、#20 |
| mcpIntegration | localRuntime, mediaGeneration, platformCore, pluginMarket | #9、#10、#11、#12 |
| localRuntime | assetLibrary, mediaGeneration, platformCore | #6、#7(E10)、#8 |
| agentAccess | platformCore, pluginMarket | #1、#2(E10) |
| platformCore | localRuntime, mediaGeneration | #15、#16（#17 在 R-07D 后为 0，故不列入） |

> 白名单是“模块**条目**级直接依赖”的声明，不覆盖运行期经 `@/utils` facade 或 `@/agent` 的依赖（后者由 E2/E6/E7/E8/E9 登记）。

**验收对应**：A-18、E10/E12。
**风险与回滚**：把 SCC-1 当作“拆分失败” → 评审意见栏需明确验收口径（“god module 消除 + 子模块预算”，不是“模块级无环”）；出现 SCC-1 之外的新环 → FAIL 并要求回退该边。

---

### R-14 判据工程（两相 / 守卫 / 台账 / 文档自审）

**背景**：前 5 轮打回的核心失效模式是“判据不可执行、期望不可达、证据相位错配”。本需求把“判据本身”当作交付物之一。

**目标**：所有验收证据可由评审**原样复跑**；文档与证据的相位、数值、说明符形态可机械校验。

**描述（证据流水线）**：

```text
[E1] edge_check <label> <phase> <expect> <scope_min> <ERE> <paths...>
       - G-EXIST：任一路径不存在 → missing=<path> + FAIL
       - G-MATCH：expect=0 时要求 scope_files ≥ scope_min ≥ 1
       - G-SCOPE：scope_min 单独占位（结构上不可能把 scope 当 expect）
       - 输出：check=<label> phase=<B0|F> expect=<n> scope_files=<n> scope_min=<n> hits=<n> verdict=<PASS|FAIL>
[E2] file_count <label> <expect> <ERE> <file>            // 单文件计数（f1/f3/g 组）
[E3] 探针：f2a（静态锚点）/ f2b（显式目录 + 仓库不被写）/ f4/f5（Bun 运行时）
[E4] 台账复算：§6.9 的 L01–L32 逐行跑 B0 命令，mismatch=0
[E5] 文档自审：§A.12（phase/证据相位/说明符）、§A.13（台账/scope 断言/l2_relative）、§A.13.2（形态）
```

**详细方案设计（实施期怎么产出证据）**：

| 里程碑 | 跑什么 | 产出 | 禁止 |
| --- | --- | --- | --- |
| M0 | 基线 5 份 + 21 前缀首端点 + 13 项 fixture | 基线快照 + `data/settings.json` md5 | — |
| M1 | B0 上跑 `f*` / `g*`（可表达部分） | 基线对照值 | **不得**作为 A-25/A-26/A-29 的 PASS 证据 |
| M3 | A/B/C/D 边判据 + 结构判据 | `check=…` 证据行 | 用裸 `@/utils/` 作 PH-F 唯一 pattern |
| M6 | 全量 A-01～A-29 中除语义组 | 结构/契约/台账/回归证据包 | 用 M1 输出填 F 相证据列 |
| M7 | 交付态跑 `f1a–f5`、`g1–g6`、`lr1–lr5` | 语义组判定 | 与 M1 混用 |

**四条守卫在方案中的落点**：

| 守卫 | 方案里的对应机制 |
| --- | --- |
| G-EXIST | 迁移后所有判据路径都指向 `src/modules/**`；M3 前先跑一次路径存在性清单 |
| G-MATCH | 所有“归零”判据都带 `scope_min`（41 / 32 / 7 / 1 / 4 / 263 …） |
| G-POS | F 相独有的正向判据（`b5` / `c7` / `f1c` / `lr2`）都用“符号存在 + 下限”证明可达 |
| G-SCOPE | 所有 `scope_files` 只进输出行，不进期望列；`scope_pred` 只作说明 |

**验收对应**：A-27（`criteria_total=29`、`phase_evidence_mismatch=0`）、A-28（`ledger_rows=32`、`scope_assertions=0`、`l2_relative_defined=1`）、A-29。
**风险与回滚**：实施者为图省事改用“临时 grep 当证据” → §6.7 规则 5：作为验收证据的命令**必须**是矩阵附录给出的命令；判据脚本落库 → A-24 直接 FAIL。

---

### R-15 默认数据目录锚点不变 + 相对路径深度补偿

**背景**：`conf/index.ts:11` 用 5 级相对路径锚定默认数据目录（`<repo>/data`）。迁移到 `modules/platformCore/conf` 后目录深 1 级，同样的 5 级只到 `apps/data` —— 三宿主都显式传 `dataDirectory`，所以**线上不会立刻暴露**，但直接 `createApp()` 会静默改写默认目录（NG4 破坏）。

**目标**：默认锚点在 F 相仍解析为 `<repo>/data`；跨模块相对路径条数不变（2）。

**描述与详细方案设计**：

```text
[1] 锚点补偿（Q12 默认 A）：
    modules/platformCore/conf/index.ts
      resolve(import.meta.dirname, "../../../../../data")      // B0：5 级 → <repo>/data
   →  resolve(import.meta.dirname, "../../../../../../data")    // F：6 级 → <repo>/data
    判据 f2a：静态解析该字面量 → realpath 结果 == <repo>/data（两相均须为 1）

[2] 相对路径深度补偿：
    modules/agentAccess/singleAgent/types.ts
      "../../agent/runtime/types" → "../../../agent/runtime/types"
    ✗ 禁止改成 "@/agent/runtime/types"（会让 a3 由 19 变 20、A.11 多一条边、f2c 由 2 变 1）
    src/index.ts 的 "../../../electrobun.config" 不移动、不变

[3] 双保险：
    - 静态：f2a（锚点解析）
    - 运行时：f2b（TOONFLOW_DATA_DIR=<tmp>/data → conf.path 落 <tmp>/data/settings.json，
                    且仓库 data/settings.json 的 md5 前后一致）
```

**为什么不选 Q12-B（由 `createApp` 计算后经 `ModuleContext` 注入）**：`conf` 的默认目录是**模块级**求值（`mkdirSync` + `realpathSync` 在模块作用域执行），改成注入需要把 `conf` 的初始化改成惰性工厂，牵动 40 个直接 import `conf` 的文件，收益远低于“补一级路径”。

**验收对应**：A-25（`f2a/f2b/f2c`）、A-19（typecheck）、R-15 行。
**风险与回滚**：只补锚点漏补 `singleAgent/types.ts` → typecheck 失败（可自动发现）；把相对路径改 alias → `f2c` 与 `a3` 同时失真，判据会 FAIL。

---

## 5. UI 影响评估与界面回归说明

### 5.1 结论：**本需求没有任何 UI 变动**

| 维度 | 结论 | 依据 |
| --- | --- | --- |
| 新增/修改组件、样式、布局、文案 | **无** | 改动全部在 `apps/server/src`，`apps/web`、`apps/desktop` 的渲染层零改动 |
| 交互行为 | **无** | 162 个端点的 method + path + 请求/响应结构 + 状态码不变（A-11） |
| 前端调用面 | **无** | 145 个文件 `import u from "@/utils"` 与 37 个 key 不变（A-12）；`/api` 字面量由 `routes/**` 路径决定，路由文件不移动 |
| 错误提示 | **无** | 错误处理中间件顺序与 `errorFromCause` + i18n 文案链路不变 |
| 桌面/移动壳 | **无** | 14 个 `@toonflow/server/*` exports 键名不变（5 个 target 随迁移更新，由构建解析） |

> 因此本节不提供组件/视觉/交互设计稿；只提供**界面回归检查清单**，用于证明“零 UI 变动”这一结论，并在评审阶段作为人工验收路径。

### 5.2 界面回归检查清单（按模块 → 界面位置 → 交互点）

| # | 模块 | 界面位置 | 交互点 | 服务端前缀 | 判定 |
| --- | --- | --- | --- | --- | --- |
| 1 | assetLibrary | 首页素材库、画布素材库抽屉 | 列表分页、缩略图、重命名/移动、回收站、拖拽导入 | `/api/assets` | 列表项与缩略图正常；空库显示空态；删除后回收站出现条目 |
| 2 | mediaGeneration | 文本/图片/视频节点、模型设置 | 生成、停止、历史、模型下拉、供应商配置 | `/api/ai` `/api/providers` `/api/ffmpeg` | 流式输出正常结束；停止立即生效；无供应商时保持原 4xx 提示 |
| 3 | pluginMarket | 插件/技能/节点/扩展/Agent 面板 | 安装、启停、排序、导出 ZIP | `/api/tools` `/api/nodes` `/api/ext` `/api/skills` `/api/agents` `/api/plugins` | 五类内置清单条数不变（依赖 `builtinPlugins`）；本机门禁 403 语义不变 |
| 4 | mcpIntegration | 设置 → MCP | 服务器增删改、状态、控制通道事件 | `/api/mcp` + `/mcp` | 连接状态与事件流不变 |
| 5 | localRuntime | 工作区文件树、编辑器、命令执行面板 | 列表/读写/缩略图/重命名/删除；执行命令 | `/api/workspaces` `/api/exec` | 文件树与内容一致；SSE 事件序列 `start→stdout→exit` |
| 6 | localRuntime（桌面） | 桌面壳内菜单/剪贴板/更新 | 剪贴板读写、更新检查、窗口控制 | `/api/desktop`（15 端点） | 桌面端 200、独立 server 保持原 4xx/404 门禁码 |
| 7 | agentAccess | Agent 对话、会话管理、浏览器工具 | 发送/停止/回退/fork/压缩、上下文引用 | `/api/agent` `/api/singleAgent` `/api/sessionState` `/api/browser` | 流式事件顺序不变；会话列表/状态一致 |
| 8 | platformCore | 设置页、监控页 | 语言切换、系统提示、存储/内存监控 | `/api/settings` `/api/monitor` | 语言切换后文案即时生效（验证 `setLocaleFallback` 时序未变） |

### 5.3 现象 → 断点对照（UI 异常时快速定位）

| 界面现象 | 高概率原因 | 设计上已加的护栏 |
| --- | --- | --- |
| 首页素材库空白/转圈 | `routes/assets` 说明符迁移遗漏，路由未注册 | A-11 端点 diff + 冒烟 #1 |
| 缩略图 404 但文件正常 | `assets/thumb` 被静态引入导致 `conf` 提前求值（缓存根错位） | `f1d`（入口必须 `void import`）+ `f2a/f2b` |
| 生成/设置页报“需要重新配置” | 默认数据目录漂移（读到空 `settings.json`） | `f2a`（锚点 6 级）+ `f2b`（仓库 data 不被写） |
| 任务栏/插件列表条数变少 | `builtinPlugins` 扫描根或 pattern 变化 | A-10（5 键 `Set`）+ S5–S8 |
| 桌面端功能全 404 | `desktopRequest` 门禁被移出中间件区 | A-09 + A-21 |
| 语言切换不生效 | `setLocaleFallback` 早于 `conf` 求值或未调用 | `platformCore.prepare` 时序（步骤 0） |

### 5.4 UI 侧的验收动作（不需要设计，只需要执行）

1. 三宿主启动后逐条走 §5.2 的 8 组页面（每项至少 1 次读 + 1 次写操作）。
2. 对比“改动前录屏/截图基线”与“改动后”，要求**无可见差异**（含空态与错误提示文案）。
3. 桌面端额外验证 `/api/desktop/*` 15 端点门禁码（非桌面宿主应保持原 4xx，不得变成 500）。
4. 若出现差异，按 §5.3 定位到对应 R 与判据，作为 FAIL 证据记录。

---

## 6. 实施计划、里程碑与变更面

### 6.1 里程碑（与矩阵 §9 一一对应，含本方案新增的出口条件）

| 里程碑 | 主要动作 | 出口条件（可判定） |
| --- | --- | --- |
| **M0 基线冻结** | 5 份基线 + 21 前缀首端点 + 13 项 fixture；记录 `data/settings.json` md5 | 归档齐全；`git status --porcelain apps/server` 为空；**按 F-01 以实施时 HEAD 重算数字** |
| **M1 B0 语义探针** | 在 B0 快照跑 `f*` / `g*` | 输出归档为 M7 对照；**不得**作为 A-25/A-26/A-29 证据 |
| **M2 目录迁移** | `git mv` 59 个文件 + 前缀替换 + 11 处非 from 引用 + 2 处深度补偿 + exports/AGENTS | `utils/` 为空；`typecheck` 通过；端点清单 diff 为空；深路径计数符合 D-01 裁决 |
| **M3 模块契约** | 7 入口 + `types/module.ts` + `lib/mentionSources.ts` + `app.ts` 瘦身 + 15 步归口 + A–D 边 | A-06/A-08/A-09/A-10/A-13～A-17 的 M3 证据行齐备 |
| **M4 装配与回归** | `utils.ts` 分组、`core.ts` 分组注释与 `router.ts` 重生成、13 + S1–S8 + 21 前缀 | `app.use` = 161；端点 diff 为空；冒烟 diff 为空 |
| **M5 规范与地图** | AGENTS.md、模块清单、exports、地图重算 | A-12/A-22 |
| **M6 终验（结构）** | A-01～A-24、A-27、A-28 | 全部 PASS 或 §9 有明确裁决 |
| **M7 终验（语义）** | 交付态跑 `f1a–f5`、`g1–g6`、`lr1–lr5` | A-25/A-26/A-29 证据列指向 M7 |

**提交策略**：M2 单独 1 个 commit（可整体 revert）；M3 按模块拆分 commit（`assetLibrary` / `mediaGeneration` / `pluginMarket` / `mcpIntegration` / `localRuntime` / `agentAccess` / `platformCore` / bootstrap 装配），每个 commit 后跑 `typecheck`，保证任意一步都可回退。

### 6.2 变更面清单（文件级）

| 类别 | 数量 | 说明 |
| --- | --- | --- |
| 新增（L2） | **9** | 7 入口 + `types/module.ts` + `lib/mentionSources.ts` |
| 移动（`git mv`） | **59** | `src/utils/**` 58 个 + `src/remoteConnection.ts` 1 个 |
| 原地不动 | **178** | `bootstrap` 8（`app/index/core/router/utils.ts` + `scripts/**` 3）+ `routes/**` 161 + `lib/**` 8 + `types/**` 1；**237 = 59 + 178** |
| 需改说明符（机械替换） | **93** | 非 agent 72 个 + agent 21 个（含 `app.ts`、`utils.ts`、`routes/**`） |
| 需人工编辑（非机械替换） | **约 15** | `app.ts`、`utils.ts`、`core.ts`、`router.ts`(生成)、`index.ts`、`package.json`、`AGENTS.md`、`agent/mentionSources.ts`、`conf/index.ts`、`teams/index.ts`、`mobileLink/index.ts`、`singleAgent/types.ts`、`plugins/install.ts`、`mcp/{dxt,tools,resources}.ts` |
| 冻结不动 | — | `src/agent/**` 的结构、`routes/**` 的位置、14 exports 的键名 |

### 6.3 回滚策略

1. **单点回滚**：M3 的模块级 commit 可独立 revert（入口是新增文件，删除即回到“无入口”状态，不影响运行期）。
2. **整体回滚**：M2 是唯一“破坏性”提交（路径全变），回滚 = revert 该提交 + 重跑 `typecheck`；M3-M5 的改动全部依赖 M2 的目录，故随之失效。
3. **数据面**：迁移不改数据目录布局；`f2b` 证明仓库 `data/` 不被探针写入。若 `f2a` 失败（锚点写错），回滚只涉及 1 行常量。

---

## 7. 待评审裁决点

> 以下 3 项是**方案层新增**、需求矩阵未覆盖但直接影响可落地性的分支。未在 §9 填写时，按“推荐”列执行。

| ID | 议题 | 选项 | 推荐 | 不裁决的后果 |
| --- | --- | --- | --- | --- |
| **D-01** | `app.ts` 的 7 个入口装配形态与 A.3 ③ 的计数 | **A：动态 import，app.ts 段期望 0（合计 245）+ 新增装配判据 = 7** / B：扩口径（B0 254 / F 252） | **A** | 若强行静态 import，`f2a/f2b` 必 FAIL（数据目录漂移） |
| **D-02** | R-07D 的类型归属实现 | **A：单行混合 import（`import conf, { type X } from …`），d4 仍 4** / B：矩阵原文 re-export，d4 改 6 + 新增 `d4_value=4` | **A** | 按矩阵原文写会让自己定义的 `d4=4` 判据失败 |
| **D-03** | 契约补充（`pluginRoots` / `pluginRevision` / `gateways` / `prepare` / `initializeRuntime`） | **A：补充（仍 ≤40 行）** / B：把 roots 与 revision 塞进 `dataDirectory` 旁的独立参数对象（会改 `createApp` 签名 → 违反 R-08） | **A** | 15 步无法归口；`/mcp`、`/a2a` 归属不可判 |

> 与矩阵既有决策点的关系：Q1–Q12 全部沿用默认值（B / E4 / 保留 facade / 4 消除 19 保留 / 入口 re-export / 预算 / diff 为空 / E11 / 固定 9 / 接受 E12 / alias 冻结 / 锚点深度补偿）。本方案的 D-01～D-03 **不改变** Q1–Q12 的任何取值，只补足其落地细节。

---

## 8. 交付物清单与验收对照

### 8.1 交付物

| 交付物 | 形态 | 判据 |
| --- | --- | --- |
| 7 个模块入口 + 契约 + 共享下沉 | 9 个新文件 | A-02、A-06 |
| 迁移后的 7 个模块目录 | 59 个文件移动 | A-01、A-03 |
| 瘦身后的 `app.ts`（≤80 行） | 1 个文件 | A-08、A-09、A-10 |
| 分组注释的 `router.ts` + 生成器改造 | 2 个文件 | A-07、A-11 |
| 分组 facade `utils.ts`（37 key） | 1 个文件 | A-12 |
| 同步的 `AGENTS.md` + `package.json` | 2 个文件 | A-22 |
| 13 + S1–S8 + 21 前缀冒烟记录、三宿主记录 | 证据日志（不落库） | A-20、A-21 |
| A-01～A-29 证据包（含 M3/M6/M7 三段） | 证据日志 | A-27、A-28 |
| E1–E12 豁免表 | 文档章节 | A-23 |

### 8.2 需求 → 方案 → 验收 对照

| 需求 | 方案章节 | 主要验收 |
| --- | --- | --- |
| R-01 入口与契约 | §2.3、§4 R-01 | A-06、A-07、A-18、A-29 |
| R-02 `app.ts` 瘦身 | §2.2、§4 R-02、附录 B | A-08、A-09、A-21、A-25 |
| R-03 15 步归口 | §4 R-03 | A-10、A-25、A-26 |
| R-04 目录迁移 | §2.4、§4 R-04、附录 A | A-01～A-03、A-12、A-19、A-29 |
| R-05 路由分组 | §4 R-05 | A-07、A-11、A-24 |
| R-06 facade | §4 R-06 | A-12、A-22 |
| R-07 边 A–D | §4 R-07 | A-13～A-16 |
| R-07E 内环 | §4 R-07E | A-17、E11 |
| R-08 宿主兼容 | §4 R-08 | A-12、A-19、A-21 |
| R-09 规范/地图 | §4 R-09 | A-22 |
| R-10 回归与冒烟 | §4 R-10、§5.2 | A-11、A-20、A-21 |
| R-11 豁免 | §4 R-11 | A-23 |
| R-12 三本账 | §4 R-12 | A-01～A-05 |
| R-13 SCC 与白名单 | §4 R-13 | A-18 |
| R-14 判据工程 | §4 R-14 | A-27、A-28、A-29 |
| R-15 数据目录锚点 | §4 R-15 | A-25、A-19 |

### 8.3 覆盖度与可读性自检

| 维度 | 自检结论 | 核对位置 |
| --- | --- | --- |
| **覆盖度** | 矩阵 16 条子需求（R-01～R-15 + R-07E）**逐条**有「背景 / 目标 / 描述 / 详细方案设计」；每条结尾有「验收对应 + 风险与回滚」 | §4 全节 |
| | 4 类跨域边（A/B/C/D）、15 步初始化、21 个前缀、59 个迁移文件、11 处非 `from` 引用、2 处深度补偿、5 个 exports target 全部有落点 | §4、附录 A |
| **可读性** | 方案只用伪代码/流程图（共 18 段，单段 ≤25 行），无大段真实代码；真实代码只在评审通过后由实施方编写 | §2.2、§2.3、§4 |
| **无歧义** | 每个机制都写了「形态 + 计数效果 + 判据 label」；3 个待裁决分支给出选项、推荐与不裁决的后果 | §3、§7 |
| **UI** | 明确“零 UI 变动”，并给出 8 组界面回归清单与“现象 → 断点”对照表 | §5 |
| **与矩阵的关系** | 5 条方案级发现（F-01～F-05）+ 3 条待裁决（D-01～D-03）显式登记，**不隐式修改**任何验收期望；D-01 若采纳才改变 1 个数值（252→245） | §3、§7 |
| **改动边界** | 本轮只新增本文件与索引，未修改任何源码（`git status --porcelain apps/server` 为空） | §0 |

---

## 9. 评审意见栏

> 使用方式：评审逐条填写。**未填写的 D 项按 §7「推荐」执行；未勾选的豁免视为驳回。**

### 9.1 总体结论

| 项 | 填写 |
| --- | --- |
| 方案评审结论 | ☐ 通过（进入实施） ☐ 打回（见 9.2） ☐ 有条件通过（见 9.4） |
| 评审人 / 日期 |  |
| 一句话意见 |  |

### 9.2 打回/修改意见（逐条）

| # | 意见（可引用章节号） | 严重度 | 期望处置 | 方案方回应 |
| --- | --- | --- | --- | --- |
| 1 |  |  |  |  |
| 2 |  |  |  |  |
| 3 |  |  |  |  |
| 4 |  |  |  |  |

### 9.3 设计决策裁决（D-01～D-03）

| D | 推荐 | 评审裁决（采纳推荐 / 改选，改选请写明） | 备注 |
| --- | --- | --- | --- |
| D-01 `app.ts` 装配形态与 A.3 计数 | A（动态 import；245 + 装配判据 = 7） |  |  |
| D-02 R-07D 类型归属实现 | A（单行混合 import；`d4=4`） |  |  |
| D-03 契约补充 | A（`pluginRoots`/`pluginRevision`/`gateways`/`prepare`/`initializeRuntime`） |  |  |

### 9.4 里程碑与豁免确认

| 项 | 结论（同意 / 不同意 + 说明） |
| --- | --- |
| M0 基线按实施时 HEAD 重冻结（F-01：14,352 行 / agentAccess 1,196 / 上限 14,842） |  |
| Q1–Q12 全部沿用默认值 |  |
| E1–E12 豁免（沿用矩阵 §8，未新增） |  |
| 验收口径为“god module 消除 + 子模块预算”，不要求模块级 DAG（E12） |  |

### 9.5 实施许可

| 项 | 填写 |
| --- | --- |
| 是否允许开始实施 | ☐ 是 ☐ 否 |
| 附加约束（如指定基线 commit、限定提交数量） |  |
| 指定复核人 |  |

---

## 附录 A：迁移点清单（M2 的执行底稿）

### A.1 域目录迁移（15 个域 + 3 个顶层文件 + 1 个根文件，共 59 个文件）
| 来源 | 目标 | 文件数 |
| --- | --- | --- |
| `utils/assets/**` | `modules/assetLibrary/assets/**` | 9 |
| `utils/ai/**` | `modules/mediaGeneration/ai/**` | 8 |
| `utils/media/**` | `modules/mediaGeneration/media/**` | 7 |
| `utils/ffmpeg/**` | `modules/mediaGeneration/ffmpeg/**` | 1 |
| `utils/documents.ts` | `modules/mediaGeneration/documents.ts` | 1 |
| `utils/plugins/**` | `modules/pluginMarket/plugins/**` | 6 |
| `utils/skills/**` | `modules/pluginMarket/skills/**` | 1 |
| `utils/teams/**` | `modules/pluginMarket/teams/**` | 3 |
| `utils/mcp/**` | `modules/mcpIntegration/mcp/**` | 7 |
| `utils/workspace/**` | `modules/localRuntime/workspace/**` | 4 |
| `utils/desktop/**` | `modules/localRuntime/desktop/**` | 1 |
| `utils/mobileLink/**` | `modules/localRuntime/mobileLink/**` | 1 |
| `utils/exec.ts` | `modules/localRuntime/exec.ts` | 1 |
| `src/remoteConnection.ts` | `modules/localRuntime/remoteConnection.ts` | 1 |
| `utils/singleAgent/**` | `modules/agentAccess/singleAgent/**` | 2 |
| `utils/sessionState/**` | `modules/agentAccess/sessionState/**` | 1 |
| `utils/browser/**` | `modules/agentAccess/browser/**` | 1 |
| `utils/conf/**` | `modules/platformCore/conf/**` | 1 |
| `utils/{monitor,personalization,fileHttp}.ts` | `modules/platformCore/…` | 3 |

> 合计：`utils/**` 53 + `utils/*.ts` 5 = 58，再 + `src/remoteConnection.ts` = **59**。
> 校验方式：`find apps/server/src/utils -name '*.ts' | wc -l` = 58（含 5 个顶层 `.ts`），与上表逐行相加一致。
> `utils/` 迁移后为空目录（必须删除）。M2 以 `git ls-tree` 为准并写入 L1/L2 台账；上表是**目录级底稿**，若某域在实施期间新增文件，以台账为准并触发 L1 口径复核。

### A.2 非 `from` 形态引用（11 处，必须逐条处理）
| # | 位置 | 处理 |
| --- | --- | --- |
| 1 | `app.ts` `import("@/utils/conf")` | 移入 `platformCore.prepare`（`import("./conf")`） |
| 2 | `app.ts` `import("@/utils/plugins/initializeExt")` | 移入 `pluginMarket.initializeExt` |
| 3 | `app.ts` `import("@/utils/assets/thumb")` | 移入 `assetLibrary.warmup`（保持 `void import("./assets/thumb")`） |
| 4 | `app.ts` `import("@/utils/ai/initialize")` | 移入 `mediaGeneration.refreshModels` |
| 5-7 | `app.ts` `import("@/utils/mcp/{tools,control,resources}")` | 移入 `mcpIntegration.mount`（4 条动态 import） |
| 8 | `app.ts` `import("@/utils/mobileLink")` | 移入 `localRuntime.initializeRuntime` |
| 9 | `plugins/install.ts` `import("@/utils/teams/install")` | `import("@/modules/pluginMarket/teams/install")` |
| 10-11 | `src/index.ts` `import("./utils/mcp/runtime")`、`import("./utils/mobileLink")` | `import("./modules/mcpIntegration/mcp/runtime")`、`import("./modules/localRuntime/mobileLink")` |

### A.3 深度补偿（2 处，不得改 alias）
| 文件 | B0 | F | 判据 |
| --- | --- | --- | --- |
| `modules/platformCore/conf/index.ts` | `../../../../../data`（5 级） | `../../../../../../data`（6 级） | `f2a=1` |
| `modules/agentAccess/singleAgent/types.ts` | `../../agent/runtime/types` | `../../../agent/runtime/types` | `f2c=2`、`a3=19` |

### A.4 exports target（5 个变更）
`./remoteConnection`、`./mcp`、`./mobileLink`、`./browser`、`./singleAgent/types` —— 键名不变，仅 target 随 SPEC 更新；其余 9 个不变（`./app`、`./desktop`、`./platform`、`./documentFormats`、`./nodeMenu`、`./modelReasoning`、`./agent/types`、`./agent/mentionSources`、`./i18n`）。

---

## 附录 B：行数预算

### B.1 `app.ts`（目标 ≤80）

| 区块 | 预估行 |
| --- | --- |
| import（含 `resolve`、`getRuntimePlatform`、`ModuleContext`） | 9 |
| `createApp` 签名（参数解构 + 类型字面量） | 14 |
| `[0]-[2]` 参数归一 + 7 个动态 import + context | 10 |
| `[3]-[4]` 步骤 0-7 调用（含 warmup） | 9 |
| `[5]-[7]` express / appVersion / scanBuiltin / dev 分支 | 6 |
| `[8]` 7 项中间件 | 7 |
| `[9]-[15]` 步骤 9-15（含错误处理 4 行） | 12 |
| return + 结构行（空行/括号） | 5 |
| **合计** | **≈72（余量 8）** |

> 超预算时的裁剪优先级（从低到高）：① context 字面量压成 2 行；② 错误处理抽成 `platformCore.errorHandler`（连带 +1 导入，-3 行）；③ 步骤 1-7 用显式数组 + `for…await`（-4 行，但会削弱“15 步逐行可读”，**仅在评审同意时**）。

### B.2 各入口（目标 ≤60）

| 入口 | 预估行 | 主要构成 |
| --- | --- | --- |
| assetLibrary | ≈16 | 动态 warmup + module 对象 + （可选）类型 re-export |
| mediaGeneration | ≈45 | providers 同步（哈希/ENOENT）+ refreshModels + re-export + module 对象 |
| pluginMarket | ≈50 | 3 条 re-export + syncDirectory + 5 个 init 包装 + scanBuiltin + module 对象 |
| mcpIntegration | ≈38 | 4 条动态 import + `createMcpRouter` 选项 + module 对象 |
| localRuntime | ≈22 | `initializeRuntime`（动态 import）+ 类型导出 + module 对象 |
| agentAccess | ≈16 | 动态 `@/agent/a2a` + module 对象 |
| platformCore | ≈40 | `corsGuard`（原 17 行外移）+ `prepare` + module 对象 |

> 超 60 行的统一处置：把实现体下沉到既有域文件（如 `plugins/initialize.ts` 承载 `scanBuiltin`），入口只留 1-2 行调用——与 D-06 同一原则，且不新增文件（L2 固定 9）。

---

## 附录 C：术语与引用

| 术语 | 含义 |
| --- | --- |
| B0 / PH-B0 | 矩阵基线与基线相（`d084136` 快照） |
| F / PH-F | 交付态与交付相（实施后工作树） |
| L1 / L2 / L3 | 存量 237 / 新增 9 / 交付 246 三本台账 |
| edge_check | 带 `scope_min` 守卫的边判据执行器（G-EXIST/G-MATCH/G-SCOPE） |
| `f*` / `g*` / `lr*` | 步骤 5 与 R-15 语义探针 / 15 步结构探针 / 入口说明符形态判据 |
| D-0x | 本方案新增的设计决策（§3.6、§7） |
| F-0x | 本方案新增的方案级发现（§3.1–§3.5） |
| E1–E12 | 结构化豁免（矩阵 §8） |

**引用文档**：
- 需求矩阵：`1_requirements_matrix/2026-10-26-23-29-serverApiSubmoduleSplit-v6.md`（REQ-2026-10-26-06）
- 开发规范：`AGENTS.md`（目录结构、路由规则、文件统一入口、测试边界）
- 地图：`.easyvibe/map/map.json`、`.easyvibe/map/modules/server-api.json`
