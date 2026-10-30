# 方案设计 · server-api 应用子模块拆分（第 3 版 · 第 7 轮打回后重做）

## 0. 文档元信息

| 项 | 内容 |
| --- | --- |
| 文档编号 | **SOL-2026-10-27-03** |
| 对应需求 | `REQ-2026-10-26-06`（`1_requirements_matrix/2026-10-26-23-29-serverApiSubmoduleSplit-v6.md`，第 6 版） |
| 上一版方案 | `SOL-2026-10-27-02`（`2026-10-27-02-41-serverApiSubmoduleSplit-v2.md`）——**第 7 轮评审打回** |
| 需求标题 | server-api 按素材库 / 媒体生成 / 插件市场 / MCP·工作区拆出应用子模块，`app.ts` 只保留组合根与路由装配 |
| 影响模块 | `server-api`（`apps/server`） |
| 方案类型 | 结构性重构（架构整改），**零业务行为变更、零 UI 变动** |
| 编写人 | 方案设计 agent（harness 规则 2.2 执行者） |
| 编写时间 | 2026-10-27 02:52 |
| 代码基线 | 矩阵 B0 = `d084136`；本轮只读复核 HEAD = **`1861cd0`**（`apps/server` 工作树干净） |
| 本轮写回 | 仅新增本文档与 `INDEX-2026-10.md`；**未修改任何源码/测试/脚本**（探针脚本一律 heredoc 到 `/tmp`） |
| 评审入口 | §10 评审意见栏（留空待填）；§8 待裁决点 D-01～D-07 |

> **引用约定**：`矩阵 §x`、`§A.x`、`§R-xx`、`A-xx`、`Lxx`、`Qxx`、`Exx` 一律指**需求矩阵**（REQ-2026-10-26-06）；**不带前缀的 `§x`** 指本文档自己的章节。
> **阅读顺序**：§1 打回处置（3 分钟）→ **§2 入口静态面（本轮核心）** → §3 说明符相位 → §4 总体架构 → §5 逐条 R → §8 裁决点 → §10 评审栏。

---

## 1. 第 7 轮打回处置总览

### 1.1 三条打回 → 定性 → 处置 → 落点

| # | 第 7 轮打回意见 | 定性 | 本版处置（可核对） | 落点 |
| --- | --- | --- | --- | --- |
| 1 | **入口骨架缺静态 `from`** | **方案缺陷**：v2 的 A.1 骨架把公开面写成占位符 `<公开面：export … from "./<自家域>">`，只有 `mediaGeneration` / `pluginMarket` 两个入口落成真实静态行；另 3 个入口在骨架里**只有动态 `import()`**，而动态 `import()` 不产生 `from "./…"` | 新增 **§2.2 规则 S1–S5**：入口第一段代码必须是**静态面**；A.1 骨架改为「静态面为必选行，缺行 = A-06 不通过」；逐入口给出**值级**静态行（§2.3），并在附录 A 给出 7 个骨架全文 | §2.2、§2.3、附录 A |
| 2 | **A-29 `lr2` 仅 4≠7** | 与 #1 **同根因**（不是两条独立缺陷）：v2 设计稿推演后 `assetLibrary / mcpIntegration / localRuntime` 的静态相对 import = 0 → `lr2=4` | ① **复现**：按 v2 骨架重建 7 个入口 → 脚本实跑 `lr2_entry_relative_ok=4`、`FAIL`（附录 B `s1a`）；② **修复**：按 §2.3 补齐 → `lr2_entry_relative_ok=7`、`PASS`（附录 B `s1b`）；③ 给出 3 种**禁止的补法**（§2.4），避免“为凑数写静态 import” | §2.3、§2.5、附录 B |
| 3 | **附录 A.4 仍用迁移后非法的 `@/utils` 说明符** | **方案缺陷（相位错误）**：A.4 是 **F 相**块，却写着 B0 的 `@/utils/mcp/{tools,control,resources}`；迁移后这 3 个文件在 `modules/mcpIntegration/mcp/**`，该说明符**不存在** | ① A.4 三条改为 `./mcp/{tools,control,resources}`（§3.1）；② 新增 **`s5` 全文相位扫描**（F 相块内 `from "@/utils` / `import("@/utils` 必须 = 0），对本版实跑 `violations=0`，对 **v2 实跑捕获 4 行**（§3.2） | §3.1、§3.2、附录 B `s5` |

> **关键点**：三条打回**没有一条要求改需求矩阵的期望值**。所有期望（`lr1–lr5`、`g4b=4`、`f1d=1`、`b5s=1`、`c7s=3`）**原样保留**，改的是方案骨架与说明符。§2.5 用矩阵的**原脚本**在模拟目录上验证了这一点。

### 1.2 结论速览（6 条）

1. **入口静态面成为显式设计对象**：7 个入口的静态行逐条可数（§2.3 表），5 个 `MIN_REL=1` 的入口**各有 1 条值级静态相对 import**，`lr2=7` 由此**结构性成立**（不是靠调参数）。
2. **补静态面有代价且已量化**：3 个模块的**求值时刻**从「步骤 11 / 步骤 15 / 请求期」前移到「步骤 [1]」，但**调用时刻不变**、`conf` 仍在 `TOONFLOW_DATA_DIR` 之后求值；静态图**不含 `src/agent/**`**（探针 `s6`：8 / 7 / 5 模块，agent 边 = 0）。
3. **F 相说明符全部合法**：入口内只有 `./…`（自家域）与外部包；`s5` 对本文档实跑 `violations=0`，对 v2 实跑 `violations=4`（可复现打回 #3）。
4. **v2 的三项既有修正保持不动**（第 6 轮打回已认定修正）：R-07B 公开面归 `mediaGeneration`、`PluginRoots` 六类插件词表零映射、`exports` = app.ts 调用面（`b5s=1`/`c7s=3` 的前提）。
5. **`app.ts` 仍用 7 个动态 `import()` 装配**（D-01，未被本轮打回）。若评审认为“静态 `from`”指的是 `app.ts` 侧，见 **D-07**（该读法会与 F-02 / `f2a`/`f2b` 冲突，本版给了证据与替代口径）。
6. **零 UI、零端点、零 exports**：162 端点、21 前缀、14 个 `@toonflow/server/*` export 键名逐字不变（§6 给界面回归清单）。

### 1.3 本轮只读复核实测（HEAD = `1861cd0`，2026-10-27 02:45–02:55）

| # | 复核项 | 命令（摘要） | 实测 | 矩阵值 |
| --- | --- | --- | --- | --- |
| V1 | 文件 / 行数 | 矩阵 §A.1 口径 glob | **237 / 14,352** | 237 / 14,349（F-01 漂移 +3） |
| V2 | 路由文件 | `find src/routes -name '*.ts' \| wc -l` | **161** | 161 |
| V3 | 端点（锚定式） | `Router().\|router.\|app.` + method 计数 | **162** = 79 post / 51 get / 20 put / 10 delete / 2 patch | 162 |
| V4 | 深路径 | `grep -rho 'from "@/utils/[a-zA-Z]*'` | **246** | 246 |
| V5 | facade 文件 | `grep -rl 'from "@/utils"'` | **145** | 145 |
| V6 | `app.ts` / `utils.ts` 行数 | `wc -l` | **160 / 75** | 160 / 75 |
| V7 | `utils/**` 内相对 import | `grep -rn 'from "\.\{1,2}/' src/utils` | **21** | 21 |
| V8 | `routes/` 一级条目 | `ls src/routes \| wc -l` | **22** = 21 目录 + `agent.ts` | 21 前缀 + 1 |
| V9 | `utils/plugins/` 内容 | `ls` | `ext/initialize/initializeExt/install/nodes/tools`（**无 `media/`**） | 打回 #1（第 6 轮）成立 |
| V10 | `addMediaProvider` 定义 / 消费 | 读 `media/provider.ts` + `grep` | 定义 `media/provider.ts`；唯一跨域消费 `plugins/install.ts:11` | b1=1 |
| V11 | **`lr2` 复现（v2 骨架）** | 附录 B `s1a` | `lr2_entry_relative_ok=4` → `FAIL` | 与评审一致 |
| V12 | **`lr2` 修复（本版骨架）** | 附录 B `s1b` | `lr2_entry_relative_ok=7` → `PASS` | A-29 期望 |

> V1 的 +3 行沿用 v2 的 F-01 登记（canvas「节点引用」提交）；M0 以实施开始时的 HEAD 重冻结，结构性判据（237/9/246、161/162/21、145、246、20 条边）逐项可复现。

---

## 2. 入口静态面设计（打回 #1 / #2 的修复详设）

### 2.1 失败复现：v2 为什么只有 4

`A-29` 的 `lr2` 正则是 `from\s+"(\.{1,2}/[^"]*)"` —— **只认静态 `from`，不认动态 `import()`**。v2 的 7 个入口逐条对照：

| 入口 | `MIN_REL` | v2 的静态相对 import | 达标 | 为什么落空 |
| --- | --- | --- | --- | --- |
| `assetLibrary` | 1 | **0** | ✗ | 只有 `void import("./assets/thumb").then(...)`（`f1d` 要求），动态形态无 `from` |
| `mediaGeneration` | 1 | **1** | ✓ | `export { addMediaProvider } from "./media/provider"`（`b5s` 要求） |
| `pluginMarket` | 1 | **4** | ✓ | `c9` 三条 re-export + `export { default as syncDirectory } from "./plugins/initialize"` |
| `mcpIntegration` | 1 | **0** | ✗ | 只有 `mount` 内 4 条 `import("./…")`（`g4b=4` 要求） |
| `localRuntime` | 1 | **0** | ✗ | `initializeRuntime` 内 `await import("./mobileLink")` |
| `agentAccess` | 0 | 0 | ✓（允许） | 唯一依赖 `@/agent/a2a`（外部模块） |
| `platformCore` | 0 | 0 | ✓（允许） | 唯一自家域 `./conf` 必须动态（`f2a/f2b` 时序） |

**→ 4/7。** 脚本实跑（附录 B `s1a`，`/tmp` 模拟目录，使用矩阵 A.13.2 的原脚本逻辑）：

```text
l2_relative: lr1_exist=1 lr2_entry_relative_ok=4 lr3_self_alias=0 lr4_cross_alias=0 lr5_other_alias=0
l2_relative=FAIL
```

**根因**：v2 把“入口的延迟装配优先”当成了普遍形态。3 个落空入口恰好就是 B0 里**必须延迟装配**的三处（`thumb` / MCP 4 条 / `mobileLink`），于是“动态”与“静态面”被混为一谈。**修法不是把动态改静态**（会撞 `f1d`/`g4b`/`f2a`），而是**给每个入口补一条与动态块无关的静态面**。

### 2.2 设计规则（S1–S5，实施 checklist 的硬约束）

| 规则 | 内容 | 判据 |
| --- | --- | --- |
| **S1 必有静态面** | 每个入口**第一段代码**是静态面（`import … from "./…"` 或 `export … from "./…"`）；`MIN_REL=1` 的 5 个入口**至少 1 条是值级**（不得只用 `import type` 凑数） | A-29 `lr2=7`；A-06 |
| **S2 静态面优先“真用”** | 能在钩子里直接调用的符号优先（mediaGeneration / pluginMarket / localRuntime）；钩子**必须**保留动态形态的（`assetLibrary.warmup`、`mcpIntegration.mount`），静态面改选**同模块的边界常量/契约函数** | §2.3 表 |
| **S3 静态面不得触达 `@/agent`** | 静态面引入的模块，其**静态 import 图**不得包含 `src/agent/**`（否则把 agent 运行期提前到步骤 [1]） | 探针 `s6`（agent 边 = 0） |
| **S4 动态块成员冻结** | `assetLibrary` 的 `void import("./assets/thumb")`、`mcpIntegration` 的 4 条 `import("./…")` **各占 1 行**（矩阵 `file_count` 按行计） | `f1d=1`、`g2=1`、`g4b=4` |
| **S5 说明符相位** | 入口内只允许两种说明符：`./…`（自家域）与外部包（`@toonflow/*`、`express`）；**禁止** `@/utils/**`（迁移后不存在）与 `@/modules/**`（`lr3`/`lr4`） | A-29 `lr3=lr4=0`；`s5` |

### 2.3 逐入口静态面取值表（`lr2=7` 的结构性来源）

| # | 入口 | 静态面（确切行） | 形态 | 为什么是它 | 静态图（`s6`） | 关联判据 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `assetLibrary` | `import { internalAssetDirectories } from "./assets/roots";` + `export { internalAssetDirectories };` | 值（`Set` 常量） | `warmup` 必须动态（S4）→ 静态面选本模块**路径安全常量**（`.library/.trash/.thumbs`）；`roots` 是 `library` / `libraryMeta` / `watch` / `routeSchema` 的共同基座（`guard` 不依赖它） | **8 模块 / agent 边 0** | `lr2` ✓、`f3a=0` |
| 2 | `mediaGeneration` | `export { addMediaProvider } from "./media/provider";` | 值（函数） | 第 6 轮打回 #1 的契约：`pluginMarket` 唯一消费点的来源 | 既有（`media/provider`） | `b5s=1`、`lr2` ✓ |
| 3 | `pluginMarket` | `export { decodeText, skillPath, skillZip } from "./plugins/install";` / `export { listTools } from "./plugins/tools";` / `export * as skillFiles from "./skills/files";` / `export { default as syncDirectory } from "./plugins/initialize";` | 值（4 条） | 前 3 条 `c9` **逐字**要求；第 4 条是 `app.ts` 调用面（A-08 禁用 `initializePlugins`） | 既有 | `c7s=3`、`lr2` ✓ |
| 4 | `mcpIntegration` | `import { getMcpSettings } from "./mcp/control";` + `export { getMcpSettings };` | 值（函数） | `mount` 的 4 条必须动态（S4）→ 静态面选 `control`：它是 MCP 自家域里**唯一不依赖 `@/agent`** 的模块（`tools` 依赖 `@/agent`） | **7 模块 / agent 边 0** | `g4b=4`、`lr2` ✓ |
| 5 | `localRuntime` | `import { initializeMobileLinkRuntime } from "./mobileLink";`（钩子直接调用） | 值（函数） | 唯一“真用”的静态面：`initializeRuntime` 的整条逻辑就是它；`mobileLink` 顶层只有 `WeakMap`/`Symbol` | **5 模块 / agent 边 0** | A-26 步骤 15、`lr2` ✓ |
| 6 | `agentAccess` | 无 | — | 唯一依赖是 `@/agent/a2a`（外部模块），静态化会破坏 `@/agent` 边口径 | — | `lr2` 允许 0 |
| 7 | `platformCore` | 无 | — | 唯一自家域 `./conf` 必须动态（`f2a/f2b` 数据目录时序） | — | `lr2` 允许 0 |

> `s6` 的判定口径：从静态面目标文件出发做 BFS，**只跟随静态 import、忽略 `import type`**，统计可达模块数与 `@/agent/**` 边数（附录 B）。

### 2.4 三种“凑数写法”及为什么禁止

| 写法 | 后果 | 结论 |
| --- | --- | --- |
| 在 `assetLibrary` 静态 `import "./assets/thumb"` | `thumb.ts` 顶部 `from "@/agent/mentionSources"` → **静态图含 agent**（违反 S3）；且与 `f1d` 的“动态”语义自相矛盾 | **禁止** |
| 在 `mcpIntegration` 静态 `import "./mcp/tools"` | `tools.ts` 顶部 `@/agent`、`@/agent/tools` → 同上；还会与 `g4b` 的 4 行动态块冲突 | **禁止** |
| 5 个入口一律用 `export type { … } from "./…"` | 形式合法（`lr2` 正则会命中），但**运行期零信息**，评审可判“形式化满足” | **禁止作为默认**；若要采用必须**全表切换**（D-06） |

### 2.5 机械验证（矩阵原脚本 + 本版骨架，实跑）

模拟目录 `/tmp/sim` 按附录 A 写入 7 个骨架 + 2 个非入口 L2 文件，运行矩阵 §A.13.2 的**同一脚本逻辑**：

```text
  entry=assetLibrary    relative=1 min=1 self_alias=0 cross_alias=0 ok=1
  entry=mediaGeneration relative=1 min=1 self_alias=0 cross_alias=0 ok=1
  entry=pluginMarket    relative=4 min=1 self_alias=0 cross_alias=0 ok=1
  entry=mcpIntegration  relative=1 min=1 self_alias=0 cross_alias=0 ok=1
  entry=localRuntime    relative=1 min=1 self_alias=0 cross_alias=0 ok=1
  entry=agentAccess     relative=0 min=0 self_alias=0 cross_alias=0 ok=1
  entry=platformCore    relative=0 min=0 self_alias=0 cross_alias=0 ok=1
  missing=0 []
l2_relative: lr1_exist=1 lr2_entry_relative_ok=7 lr3_self_alias=0 lr4_cross_alias=0 lr5_other_alias=0
l2_relative=PASS
```

同一批骨架的其他判据（`file_count` 按行计，与矩阵一致）：

| 判据 | 命令 | 期望 | 骨架实测 |
| --- | --- | --- | --- |
| `g4b` | `grep -cE 'import\(' mcpIntegration/index.ts` | 4 | **4**（4 条动态 import 各占 1 行） |
| `f1c` | `grep -cE 'sweepThumbnailCache\(' assetLibrary/index.ts` | 1 | **1** |
| `f1d` / `g2` | `grep -cE 'void .*import\("\./assets/thumb"\)\|void import\('` | 1 | **1** |
| `g3` | `grep -cE 'catch\(\(\) => \{\}\)' assetLibrary/index.ts` | 1 | **1** |
| `f3a` | `grep -cE 'console\.' assetLibrary/index.ts` | 0 | **0** |
| `g4` | `grep -c 'initializeProviderModels()\.catch' mediaGeneration/index.ts` | 1 | **1** |
| `b5s` | `grep -c 'addMediaProvider' mediaGeneration/index.ts` | 1 | **1** |
| `c7s` | `grep -cE '(decodeText\|listTools\|skillFiles)' pluginMarket/index.ts` | 3 | **3** |
| A-06 | `wc -l */index.ts` | ≤60 | 15 / 17 / 17 / 18 / 21 / 21 / 25（7 个入口） |

> 非空转：把 `localRuntime` 的静态行改回 `await import("./mobileLink")`（即 v2 形态）→ `lr2=6` → `FAIL`（附录 B `s1c`）。

### 2.6 静态面的副作用评估（会不会“为了判据改行为”）

| 静态面 | 求值时刻（B0 → F） | 顶层副作用 | 调用时刻 | 结论 |
| --- | --- | --- | --- | --- |
| `./assets/roots` | 首次请求期（`routes/assets/*`）→ 步骤 [1] | 无（纯函数 + `Set` 常量；经 `workspace` 间接求值 `conf`/`mobileLink`） | 步骤 5 仍走 `void import("./assets/thumb")` | 等价 |
| `./mcp/control` | 步骤 11（动态块）→ 步骤 [1] | `zod` schema + `new Map()` | 步骤 11 `mount` 内仍动态 import（**模块表命中，不二次求值**） | 等价 |
| `./mobileLink` | 步骤 15 → 步骤 [1] | `WeakMap` + 2 个 `Symbol`（无监听、无 I/O） | 步骤 15 调 `initializeMobileLinkRuntime(app)` | 等价 |

**三条共同结论**：

1. **`conf` 求值时刻**：B0 是 `createApp` 开头（形参归一之后），F 是步骤 [1]（`TOONFLOW_DATA_DIR` 已在步骤 [0] 设置）→ `f2a/f2b` 判据（默认锚点 = `<repo>/data`、显式目录生效、仓库 `data/` 不被写）**不受影响**；探针 `f4/f5`（`createApp` 幂等、预热失败被吞）仍以 M7 判定。
2. **无 `@/agent` 提前求值**：静态图 agent 边 = 0（`s6`）。这是选 `roots` / `control` / `mobileLink` 而**不选** `thumb` / `tools` 的**唯一原因**。
3. **错误语义不变**：静态面 import 失败 = 入口 `import()` 失败 = `createApp` reject，与 B0 同属“reject”类（A-26 第 6 列）；不引入新的 warn/静默分支。

### 2.7 实施 checklist（M2 出口条件，逐条可勾）

1. 7 个入口**第一段代码**为静态面；`assetLibrary`/`mediaGeneration`/`pluginMarket`/`mcpIntegration`/`localRuntime` 各有 ≥1 条**值级** `from "./…"`；
2. `assetLibrary` 的 `void import("./assets/thumb")`、`mcpIntegration` 的 4 条 `import("./…")` **各占独立行**，不得合并、不得改成静态；
3. 入口内 `@/modules/**` 计数 = 0（`lr3`/`lr4`）、`@/utils/**` 计数 = 0（`s5`）；
4. 静态面的目标文件**逐字存在**（`localRuntime` 段 `s4` 的扩展：入口内全部 `from "…"` 解析到文件）；
5. `app.ts` 仍**不**静态 import 任何 `@/modules/**`（D-01）。

---

## 3. 说明符相位修正（打回 #3 的修复详设）

### 3.1 附录 A.4 修正前后

**修正前（v2 原文，F 相块内写 B0 说明符）**：

```text
# 修正前（v2 原文，错误写法：F 相块内写了 B0 说明符；迁移后 src/utils/mcp/** 不存在）
import("@toonflow/mcp"), import("@/utils/mcp/tools"), import("@/utils/mcp/control"), import("@/utils/mcp/resources"),
```

**修正后（本版）**：

```text
# PH-F（正确：外部包保持；自家域一律相对）
import("@toonflow/mcp")        # 外部包（@toonflow/mcp）
import("./mcp/tools")          # modules/mcpIntegration/mcp/tools.ts
import("./mcp/control")        # modules/mcpIntegration/mcp/control.ts
import("./mcp/resources")      # modules/mcpIntegration/mcp/resources.ts
```

**逐判据影响（全部不变）**：

| 判据 | 影响 | 说明 |
| --- | --- | --- |
| `g4b`（F 期望 4） | **不变** | 4 条 `import(` 仍各占 1 行（`file_count` 按行计） |
| `e5a/e5b`（`mcp/**` 目录内相对 import = 0） | **不变** | 该判据扫**目录内文件**，不扫入口；且入口用的是 `./mcp/…`（跨层相对不受此约束） |
| `f2c`（非 agent 的 `../` 相对 import = 2） | **不变** | `f2c` 只数 `from "../`；入口全是 `./` 与 `@/` |
| A.3 ③ 模块段（103） | **不变** | 该段只数 `from "@/modules/`；入口不出现该形态（`lr4=0`） |
| `lr2` | **不变** | 动态 import 不参与 `lr2`；`mcpIntegration` 的静态面由 `./mcp/control` 的静态 `import` 提供（§2.3 #4） |

### 3.2 `s5`：全文相位扫描（本轮新增，可机械复现）

**规则**：把本文档（以及未来任何方案/证据文档）的每个 fenced code block 视为一个相位块：

1. 块的标签 = **块前一行文字 + info string + 块内前 3 行**；含 `PH-B0` / `B0` / `修正前` / `历史` / `v2 原文` / `错误写法` → **B0/历史块**，允许出现 `from "@/utils…"`、`import("@/utils…")`；
2. 其余块 → **F 相块**，出现 `from "@/utils` 或 `import("@/utils` 即计一次违规；
3. `violations=0` 才通过；
4. **引用旧正文必须标注**：引用 v2 错误写法的块要在块内前 3 行写明“v2 原文 / 错误写法”，否则计违规（§3.1 与附录 B.4 即按此处理）。

```bash
cat > /tmp/probe_doc_specifiers.py <<'PY'
import re, sys
path = sys.argv[1]
lines = open(path, encoding="utf-8").read().split("\n")
BAD = re.compile(r'(from\s+"@/utils|import\("@/utils)')
blocks, cur, inside = [], None, False
for ln in lines:
    if ln.strip().startswith("```"):
        if not inside:
            inside = True
            cur = {"header": ln, "prev": blocks[-1]["close"] if blocks else "", "lines": []}
        else:
            inside = False; cur["close"] = ln; blocks.append(cur); cur = None
        continue
    if inside: cur["lines"].append(ln)
total = 0; hits = []
for b in blocks:
    label = (b["prev"] + " " + b["header"] + " " + "\n".join(b["lines"][:3])).lower()
    exempt = any(k in label for k in ("ph-b0", "b0", "修正前", "历史", "v2 原文", "错误写法"))
    for ln in b["lines"]:
        if BAD.search(ln):
            total += 1
            if not exempt: hits.append(ln.strip()[:120])
print(f"doc={path.split('/')[-1]} code_blocks={len(blocks)} utils_specifier_lines={total} f_phase_violations={len(hits)}")
for h in hits[:8]: print("  *", h)
PY
python3 /tmp/probe_doc_specifiers.py <文档路径>
```

**本轮实跑**：

| 文档 | 输出 | 结论 |
| --- | --- | --- |
| `2026-10-27-02-41-…-v2.md`（上一版） | `code_blocks=26 utils_specifier_lines=4 f_phase_violations=4`（L277 / **L829** / L863 / L864） | **复现打回 #3**（L829 即 A.4 的 3 条 `@/utils/mcp/*`） |
| 本文档 `2026-10-27-02-52-…-v3.md` | `code_blocks=30 utils_specifier_lines=3 f_phase_violations=0` | **通过**：3 处 `@/utils` 全部落在显式标注的“v2 原文 / 修正前”块内（§3.1 的修正前块） |

**非空转验证**：把 §3.1 的“修正后”块中 `import("./mcp/tools")` 改回 `import("@/utils/mcp/tools")`（且不带“修正前 / v2 原文”标注）→ `f_phase_violations=1` → **FAIL**。本轮实测走过此步：改回后输出 `f_phase_violations=1`，恢复后为 `0`。

### 3.3 本版全部 F 相块的说明符清单

| 块 | 说明符形态 | 期望 | 校验 |
| --- | --- | --- | --- |
| §2.2–§2.5、附录 A（7 个骨架） | `./<自家域>/…`、`@/types/module`、`express`、`@toonflow/mcp`、`@/agent/a2a` | 无 `@/utils`、无 `@/modules` | `s5` + `lr3/lr4` |
| §3.1 修正后块 | `./mcp/*` + `@toonflow/mcp` | 同上 | `s5` |
| §4.2 装配流程 | `import("@/modules/<id>")`（app.ts 侧，**允许**） | 7 处 | D-01 的正向判据 |
| §5 各 R 项伪代码 | `@/modules/<模块>/<域>`（深路径迁移后形态）或 `./…` | 无 `@/utils` | `s5` |
| 附录 B 探针 | `@/utils` 仅出现在 **PH-B0** 标注块 | 允许 | `s5` 豁免 |

---

## 4. 总体架构设计

### 4.1 目标目录结构（交付态）

```text
apps/server/src/
├─ app.ts                         # 组合根（≤80 行）：参数归一 → 动态装配 7 入口 → 步骤 1–15
├─ index.ts core.ts router.ts utils.ts   # bootstrap，原地不动
├─ types/module.ts                # 【L2】ServerModule / ModuleContext / PluginType / PluginRoots（仅类型，≤40 行）
├─ lib/mentionSources.ts          # 【L2】MentionQuery + mentionAssetType（R-07A 下沉）
├─ modules/
│  ├─ assetLibrary/     index.ts + assets/**                          (9 + 入口)
│  ├─ mediaGeneration/  index.ts + ai/** media/** ffmpeg/** documents.ts   ← addMediaProvider 在此
│  ├─ pluginMarket/     index.ts + plugins/** skills/** teams/**
│  ├─ mcpIntegration/   index.ts + mcp/**
│  ├─ localRuntime/     index.ts + workspace/** desktop/** mobileLink/** exec.ts remoteConnection.ts
│  ├─ agentAccess/      index.ts + singleAgent/** sessionState/** browser/**
│  └─ platformCore/     index.ts + conf/** monitor.ts personalization.ts fileHttp.ts
├─ routes/                        # 161 个路由文件，不移动（URL 由路径生成）
├─ agent/                         # 不属本模块；其 50 处 server 说明符跟迁
└─ utils/                         # 交付态为空（src/utils.ts 不在该目录）
```

**结构等式（交付态）**：`bootstrap 9 + 28 + 43 + 50 + 21 + 46 + 27 + 22 = 246 = 237（L1）+ 9（L2）`。

### 4.2 `createApp` 装配流程（交付态，伪代码流程图）

```text
宿主（src/index.ts | desktop | mobile）调用 createApp({...})   ← 签名逐字不变（9 个形参）
   ▼
[0] 参数归一：dataDirectory && (process.env.TOONFLOW_DATA_DIR = resolve(dataDirectory))
   │            ← 必须早于任何“会求值 conf”的模块（入口静态面也在 [1] 才有机会求值 conf）
   ▼
[1] const [A, M, P, C, L, G, K] = await Promise.all(7 个 import("@/modules/<id>"))
   │            ← D-01：app.ts 不静态 import 入口（F-02：pluginMarket/mediaGeneration 入口静态面求值 conf）
   ▼
[2] ctx = { appVersion, dataDirectory,
            pluginRoots: { tool, node, ext, skill, provider, agent },   ← 唯一翻译点（六类插件词表）
            pluginRevision, syncPluginDirectory: P.syncDirectory }
   ▼
[3] await K.prepare()                          ← 动态 import ./conf + setLocaleFallback
   ▼
[4] 步骤 1–7（顺序固定，全部 await；步骤 5 例外 = void）
   │  1 P.initializeTools  2 P.initializeNodes  3 P.initializeExt  4 M.initializeProviders
   │  5 A.warmup（void，内部空 catch）  6 P.initializeSkills  7 P.initializeAgents
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
[9]  await M.refreshModels()          （内部：await import("./ai/initialize") 后 void 刷新 + warn）
[10] await import("@/router"); router.default(app)
[11] await C.mount(app, ctx)          （/mcp；入口内 4 条动态 import，各占 1 行）
[12] await G.mount(app, ctx)          （/a2a；入口内 await import("@/agent/a2a")）
[13] app.use(express.static(webRoot))
[14] app.use(errorHandler)
[15] await L.initializeRuntime(app, ctx)   （入口静态 import ./mobileLink，调用在此）
   ▼
return app
```

### 4.3 模块契约（`src/types/module.ts`，伪代码 ≤40 行）

```text
PluginType        = "tool" | "node" | "ext" | "skill" | "provider" | "agent"   // = install.ts 的 patterns 六类
BuiltinPluginType = "tool" | "node" | "ext" | "skill" | "agent"                // = builtinPlugins 的 5 键

PluginRoots   = { [K in PluginType]?: string }        // 键名 = PluginType（零映射；第 6 轮打回 #2 的修法）
ModuleContext = { appVersion, dataDirectory?, pluginRoots, pluginRevision?,
                  syncPluginDirectory?(target, source, fileFilter?, revision?): Promise<void> }
ServerModule  = { id: <7 个字面量联合>, routePrefixes: readonly string[], gateways?: readonly string[],
                  dependencies: readonly string[],       // 附录 C 白名单子集（不含 bootstrap）
                  exports: readonly string[],            // = app.ts 的调用面（D-04）
                  initialize?(ctx), warmup?(ctx),        // warmup 仅 assetLibrary：同步、fire-and-forget
                  mount?(app, ctx), syncDirectory?(...) }
```

### 4.4 7 个入口一览（含**静态面**这一列，本轮新增）

| # | 入口 | `routePrefixes` | `gateways` | **静态面（本轮修复点）** | 动态块（冻结） | `exports`（app.ts 调用面） |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `assetLibrary` | `/api/assets` | — | `./assets/roots`（`internalAssetDirectories`） | `void import("./assets/thumb")` | `warmup` |
| 2 | `mediaGeneration` | `/api/ai` `/api/ffmpeg` `/api/providers` | — | `./media/provider`（`addMediaProvider`） | `await import("./ai/initialize")` | `initializeProviders`、`refreshModels` |
| 3 | `pluginMarket` | `/api/tools` `/api/nodes` `/api/ext` `/api/skills` `/api/agents` `/api/plugins` | — | 4 条（`./plugins/install`、`./plugins/tools`、`./skills/files`、`./plugins/initialize`） | 无 | 7 个（含 `scanBuiltin`） |
| 4 | `mcpIntegration` | `/api/mcp` | `/mcp` | `./mcp/control`（`getMcpSettings`） | 4 条（`@toonflow/mcp` + `./mcp/{tools,control,resources}`） | `mount` |
| 5 | `localRuntime` | `/api/workspaces` `/api/desktop` `/api/exec` `/api/mobileLink` | — | `./mobileLink`（`initializeMobileLinkRuntime`，钩子直接用） | 无 | `initializeRuntime` |
| 6 | `agentAccess` | `/api/agent` `/api/browser` `/api/sessionState` `/api/singleAgent` | `/a2a` | 无（MIN_REL=0） | `await import("@/agent/a2a")` | `mount` |
| 7 | `platformCore` | `/api/settings` `/api/monitor` | — | 无（MIN_REL=0） | `await import("./conf")` | `prepare`、`corsGuard` |

> `routePrefixes` 并集必须**逐字等于** §3.6 的 21 项且两两无交集；`/mcp`、`/a2a` 只出现在 `gateways`（塞进 `routePrefixes` 会让并集变 23 项，A-07 直接 FAIL）。

### 4.5 迁移映射（矩阵 §1.6.2 SPEC 摘要）

| 模块 | 来源（B0） | 目标（F） | 文件数（含不移动的路由） |
| --- | --- | --- | --- |
| assetLibrary | `utils/assets/**` | `modules/assetLibrary/assets/**` | 27（域 9 + `routes/assets` 18） |
| mediaGeneration | `utils/{ai,media,ffmpeg}/**`、`utils/documents.ts` | `modules/mediaGeneration/…` | 42 |
| pluginMarket | `utils/{plugins,skills,teams}/**` | `modules/pluginMarket/…` | 49 |
| mcpIntegration | `utils/mcp/**` | `modules/mcpIntegration/mcp/**` | 20 |
| localRuntime | `utils/{workspace,desktop,mobileLink}/**`、`utils/exec.ts`、`src/remoteConnection.ts` | `modules/localRuntime/…` | 45 |
| agentAccess | `utils/{singleAgent,sessionState,browser}/**` | `modules/agentAccess/…` | 26 |
| platformCore | `utils/conf/**`、`utils/{monitor,personalization,fileHttp}.ts` | `modules/platformCore/…` | 20 |
| bootstrap | 5 个根文件 + `scripts/**` + `types/module.ts` | 原地 + 1 契约 | 8 → 9 |

> 迁移只做**前缀替换**，不改导入形态；`src/agent/**` 的 50 处说明符同步替换（文件不移动）；两处相对路径深度补偿见 §5 R-04 / R-15。

---

## 5. 子需求详细方案（R-01～R-15 + R-07E）

> 每条固定四段：**背景 → 目标 → 描述 → 详细方案设计**；末尾给「验收对应 / 风险与回滚」。伪代码只表达结构与顺序，不贴真实实现。

### R-01 模块契约对象与 7 个应用子模块入口（P0｜难度中｜风险中）

- **背景**：现状只有目录名。237 个文件在地图里是 1 个模块（`god_module`，score 50），跨域调用无法从结构上判定归属；入口文件不存在，`app.ts` 直接内联各域调用。
- **目标**：7 个入口各存在、≤60 行、字段齐全；每个入口**同时具备静态面与钩子**（本轮新增的硬要求）。
- **描述**：契约见 §4.3；入口组织规则即 **S1–S5**（§2.2）；入口按「静态面 → 钩子 → 契约对象」三段排列，静态面写在文件最上方。
- **详细方案设计**：
  ```text
  文件结构（三段固定顺序，任何入口不得例外）：
    ① 静态面   import/export … from "./<自家域>/…"     ← 5 个入口至少 1 条值级（S1/S2）
    ② 动态块   import("./…") 或 await import("./…")    ← 仅 f1d / g4b 冻结的 2 处（S4）
    ③ 契约对象 const module: ServerModule = { id, routePrefixes, gateways?, dependencies, exports, 钩子 }
    export default module
  ```
  - 三段顺序的意义：`lr2` 的静态行、`g4b` 的动态行、`A-06` 的字段**各自独立可判**，互不遮挡；
  - `dependencies` = 该模块对其它模块的**直接深路径边**（20 条边子集，含 E10 的 7 条弱边），`@/agent` 边不计入（NG1/E6）；
  - 入口**不承载业务实现**：实现体下沉既有域文件（不新增文件，L2 固定 9 个）。
- **验收对应**：A-06、A-07、A-18、A-29（`lr1–lr5`）；补充 `s1a/s1b/s1c`（§2.5）。
- **风险与回滚**：入口与目录脱节 → `routePrefixes` 反向对账（§A.14）+ `dependencies` 与实际边对账；入口超 60 行 → 实现体下沉；静态面缺行 → `lr2<7` 立即 FAIL（已在 M2 前移）。

### R-02 `app.ts` 瘦身为组合根（P0｜难度中｜风险高）

- **背景**：`app.ts` 160 行混写参数归一、6 类插件初始化、供应商哈希、缩略图预热、模型刷新、MCP/A2A 构造、静态与错误处理、移动互联。
- **目标**：≤80 行；禁用符号 0；7 项中间件顺序可判；`createApp` 签名/返回值逐字不变。
- **描述**：只保留 5 件事——参数归一、动态装配 7 入口、步骤 1–8、7 项中间件、步骤 9–15（§4.2）。
- **详细方案设计**：
  ```text
  app.ts 内**禁用的符号**（矩阵 A-08 的逐字正则，计数必须 = 0）：
    initializePlugins | autoInstallProviders | createHash | createMcpRouter | createA2aRouter
    | initializeMobileLinkRuntime | initializeProviderModels
    （`initializePlugins` 的包装名必须叫 `syncDirectory`，否则该正则命中）
  另有两类由其它判据覆盖、本方案同样禁止在 app.ts 出现：
    sweepThumbnailCache（f1b 期望 0）、scanBuiltin 的实现体（A-10：5 键扫描整体归口到步骤 8 的入口调用）
  app.ts 内**必须**只有 1 处 `app.locals.builtinPlugins = ...`（步骤 8），且同文件 0 处 `readdir`/`pattern` 分支
  ```
  - `pluginRoots` 的 6 个赋值是**唯一**把 `createApp` 形参翻译成插件类型词表的点（`{ tool, node, ext, skill, provider, agent }`）；
  - 本版**不改变** D-01（7 个动态 `import()`）：`pluginMarket` / `mediaGeneration` 入口静态面求值 `conf`，`app.ts` 静态 import 会让 `conf` 在 `TOONFLOW_DATA_DIR` 之前求值（F-02）；
  - **入口静态面的求值时刻**由步骤 [0] → [1] 的顺序保证（§2.6）。
- **验收对应**：A-08、A-09、A-25（`f2a/f2b`）、A-26（`g5` 行号递增）。
- **风险与回滚**：数据目录时序 → 步骤 [0] 先于 [1]；中间件顺序 → 显式有序块 + `grep -n`。

### R-03 初始化 15 步归口与「顺序 + 阻塞性 + 错误语义」（P0｜难度中｜风险高）

- **背景**：15 步的顺序/阻塞性/吞错语义各不相同，5 组路由消费 `builtinPlugins`。
- **目标**：15 步全部归口；每步的锚点、阻塞性、错误语义逐项可核对（A-26）。
- **描述**：顺序表见矩阵 §R-03；本版对 3 处受影响步骤给出确切形态。
- **详细方案设计**：
  ```text
  步骤 4 initializeProviders(ctx)（mediaGeneration 入口）：
     guard: ctx.dataDirectory && ctx.pluginRoots.provider        ← 键名 "provider"（六类词表）
     source = resolve(ctx.pluginRoots.provider, "media")
     revision = ctx.pluginRevision ?? sha256(4 个内置文件；ENOENT → 空 Buffer，其它 errno 抛出)
     await ctx.syncPluginDirectory(resolve(dataDirectory,"providers"), source, [4 个文件名], revision)
  步骤 5 warmup（assetLibrary 入口；**同步签名 + void + 空 catch**）：
     void import("./assets/thumb").then(({ sweepThumbnailCache }) => sweepThumbnailCache()).catch(() => {})
  步骤 8 scanBuiltin(ctx)（pluginMarket 入口）：
     5 键 = BUILTIN_TYPES；roots 按同一词表索引；readdir ENOENT→[]、其它 errno 抛出
  步骤 9 refreshModels（mediaGeneration 入口）：
     await import("./ai/initialize")（导入失败 → createApp reject）
     void initializeProviderModels().catch(error => console.warn("启动时刷新供应商模型失败：", error))
  步骤 15 initializeRuntime（localRuntime 入口）：
     静态 import ./mobileLink（求值在步骤 [1]）+ 此处调用 initializeMobileLinkRuntime(app)
  ```
  - 步骤 5 与步骤 9 **禁止**合并成同一个 helper（R17）：一个是静默吞错、一个是 warn，`g3`/`g4` 分别计数。
- **验收对应**：A-10（5 键 `Set` + 顺序 + 锚点）、A-25（`f1a–f1d`）、A-26（`g1–g6`）、`s3`（非空性）。
- **风险与回滚**：把静默吞错改成带日志、或 `void` 改 `await` → `g1/g3` 立即 FAIL；`scanBuiltin` 键名漂移 → `s2` + `typecheck` 双杀。

### R-04 服务目录模块化（P0｜难度很高｜风险高）

- **背景**：15 个 `utils/*` 子域、246 处深路径、145 处 facade 引用；大文件集中在少数域（`assets/library.ts` 729 行、`media/provider.ts` 498 行、`plugins/install.ts` 450 行）。
- **目标**：`src/utils/**` 只留 `src/utils.ts`（facade）；7 个模块目录成形；246 处深路径一处不漏；`@/utils/` 深路径归零。
- **描述**：按 SPEC 逐目录迁移，**只替换前缀不改形态**；含 `src/agent/**` 的 50 处说明符更新；`src/routes/**`、`src/lib/**`、`src/types/**` 原地不动。
- **详细方案设计**：
  ```text
  for (old, new) in SPEC 映射: git mv <old> <new>            // 保留文件历史
  for 每个 .ts 文件: 前缀替换                              // 迁移前 "@/utils/<域>" → 迁移后 "@/modules/<模块>/<域>"
                     （只改前缀；`import type` / `export * as` / namespace 别名一律不动）
  两处相对路径深度补偿（**不得**改 alias，否则 f2c 与边计数失真）：
     utils/singleAgent/types.ts:2   "../../agent/runtime/types" → "../../../agent/runtime/types"
     src/index.ts:3                 "../../../electrobun.config"  不变（文件不移动）
  三道闸：typecheck → 端点 method+path diff → A.3 深路径分段计数（50/62/103/30/0）
  ```
- **验收对应**：A-01/A-02/A-03（台账）、A-13（`f2c=2`）、§A.3 ①②③⑤、A-29（`lr5`）。
- **风险与回滚**：漏改一处 → `typecheck` 失败；误改形态 → `f2c` 变 3；入口里写 `@/utils` → `s5` 立即 FAIL（本轮新增闸门）。

### R-05 路由装配分组（P1｜难度高｜默认豁免 E4）

- **背景**：`router.ts` 327 行 / 161 条扁平 `app.use`，由 `core.ts` 在 dev 下按 `routes/**` 目录重写。
- **目标**：按模块分组可读；**URL 与端点数量不变**（162 / 161 / 21 前缀）。
- **描述**：保留 161 条挂载（E4），只在生成器里加分组注释与空行，不新增路由分组文件。
- **详细方案设计**：`core.ts` 的生成器按「模块 → 前缀」输出注释块；注释行**不得**含 `app.use` 字面量（否则 A-11 的挂载计数会变）；`router.ts` 每次 dev 启动重写，故手写注释会被覆盖 → 所有分组信息必须来自生成器。
- **验收对应**：A-11、A-07、`router.ts` 全文 diff（M0 冻结）。
- **风险与回滚**：分组导致挂载顺序变化 → 全文 diff 比对；顺序被打乱 → 直接回滚 R-05（其余 R 不受影响）。

### R-06 聚合入口 `utils.ts` 收敛为薄 facade（P1｜部分豁免 E2）

- **背景**：`utils.ts` 75 行 / 37 出口 / 5 个来自 `@/agent`，是 bootstrap 枢纽环（E12）。
- **目标**：调用面冻结（145 个文件不变）；内部路径跟迁；`@/agent` 5 个出口保留（E2）。
- **描述**：只改 30 条深层 import 的目标前缀，不改 `export * as` 结构；`mediaProvider` namespace 保留（4 处消费）。
- **详细方案设计**：
  ```text
  utils.ts：`import * as mediaProvider from "@/modules/mediaGeneration/media/provider"`（**域文件**，不是入口）
  → 保持 `u.mediaProvider.addMediaProvider` 调用面不变；
  → 不引入 facade → 入口 → 域 的多余层级（否则 145 计数与求值面都会变）。
  ```
- **验收对应**：A.3 ④（145）、A-12（14 exports）、E2/E12。
- **风险与回滚**：facade 少一个出口 → 145 个文件的 `u.xxx` 崩；`typecheck` + 145 计数双保险。

### R-07 跨域依赖边 A–D（P0｜难度高｜风险中）

- **背景**：4 类隐式跨域调用：素材库/工作区 → `@/agent`（A）、插件安装内核被 MCP 复用（B/C）、`conf` 的 type 环（D）。
- **目标**：A 的 4 处归零；B/C 深路径归零改公开入口；D 的 2 条 type 边归零且反向 4 条 value 不变。
- **描述**：四条边各自给出「目标形态 + 唯一消费点 + 禁止项」，并以矩阵 `a/b/c/d` 组的 label 逐项对齐；不做任何行为改写，只改说明符与公开面。
- **详细方案设计**：
  ```text
  (A) mentionSources 下沉
      新建 src/lib/mentionSources.ts（≤30 行）：MentionQuery（type）+ mentionAssetType（纯路径判定）
      agent/mentionSources.ts → 仅 re-export（保持 @/agent 外部契约）
      4 处调用点改指 @/lib/mentionSources：assetLibrary/assets/{index,library,thumb}.ts、routes/workspaces/files/thumb.ts

  (B) pluginMarket → mediaGeneration（第 6 轮打回 #1 的修法，保持不变）
      公开面：mediaGeneration/index.ts  `export { addMediaProvider } from "./media/provider"`（b5s=1）
      消费点：pluginMarket/plugins/install.ts:11 整行 `import { addMediaProvider } from "@/modules/mediaGeneration";`
      禁止：pluginMarket 入口出现该符号；install.ts 该行与其它符号合并（b5 要求整行逐字）

  (C) mcpIntegration → pluginMarket
      pluginMarket/index.ts：c9 三条 re-export（逐字）
      mcp/{dxt,tools,resources}.ts：改指 @/modules/pluginMarket（resources 用 `{ skillFiles as skillFile }` 保 7 处调用面）

  (D) conf ↔ teams/mobileLink 的 type 环
      platformCore/conf/index.ts：删 2 条 type import，在本文件定义 RemoteTeam / MobileLinkConfig
      teams/index.ts、mobileLink/index.ts：改为**单行混合 import**（`import conf, { type X } from "@/modules/platformCore/conf"`）
      → 行数不变：d3=0 且 d4=4 同时成立；反向 value 边不动
  ```
- **验收对应**：A-13（`a1=4→a2=0`、`a3` 三段）、A-14（`b1..b5s`）、A-15（`c1..c9`）、A-16（`d1..d5`）。
- **风险与回滚**：`agent/mentionSources` 外部契约 → 保留原路径 re-export + 桌面冒烟；B 边公开面放回 pluginMarket → `b5s=0` 立即 FAIL；C 边 namespace 别名写错 → `c8a` 由 7 变 0。

### R-07E `dxt ↔ servers` 模块内环（P2｜难度低｜默认豁免 E11）

- **背景**：B0 的 2 个 file 级 SCC 之一（`size=2`），R-07D 后唯一残留。
- **目标**：冻结 2 条边（两相各 1）；目录内相对 import = 0；`scc_count=1,size=2`。
- **描述**：两函数互为兜底清理，拆开只会增加无业务含义的抽象。
- **详细方案设计**：迁移后 `modules/mcpIntegration/mcp/{dxt,servers}.ts` 互引**保持 alias**；**禁止**改成 `./servers`/`./dxt`（会让 `e5a/e5b` 由 0 变 1）。
- **验收对应**：A-17（`e1..e6`）、E11 模板（§8.4 沿用）。
- **风险与回滚**：把“冻结”当“未完成” → E11 勾选栏写明「已裁决 = 保留」。

### R-08 宿主装配兼容（P0｜难度低｜风险中）

- **背景**：三宿主（独立 server / Electrobun 桌面 / 移动端）复用 `@toonflow/server/app`；桌面拿到 app 后注入 `app.locals.desktop`。
- **目标**：`createApp` 签名与 14 个 export 键名逐字不变；三宿主行为不变。
- **描述**：`package.json` 的 5 个 target 按 SPEC 更新（`./mcp`、`./mobileLink`、`./browser`、`./singleAgent/types`、`./remoteConnection`），**键名不动**。
- **详细方案设计**：`pluginRoots` 的翻译在 `createApp` 内部完成，宿主无感；桌面 15 个 `/api/desktop/*` 端点门禁仍在中间件区同一位置；入口静态面不改变 `app.locals.desktop` 的注入时刻（宿主在 `createApp` resolve 后注入）。
- **验收对应**：A-12、A-21（三宿主启动 + 桌面 15 端点门禁）。
- **风险与回滚**：exports target 改错 → 5 个入口 404/编译失败；A-12 + 三宿主冒烟兜底。

### R-09 规范、地图与包导出同步（P0｜难度低｜风险低）

- **背景**：`AGENTS.md` 目前只描述 1 个 `server-api` 模块；地图按目录 glob 统计。
- **目标**：AGENTS 与新结构一致；地图重算 = L3 `246 / ≤14,839+Δ`；exports 无悬空。
- **描述**：AGENTS 增「模块入口」小节（静态面/动态块/契约对象三段式）、模块清单（8 个 id）、变更记录（归属更正 + 9 个滞后文件），并保持 `tsconfig.paths` 不变。
- **详细方案设计**：AGENTS 增「模块入口」小节，写明静态面/动态块/契约对象三段式（S1–S5）；模块清单（8 个 id / 职责 / 前缀 / 文件 / 行数 / 依赖）供地图消费；变更记录登记 §1.2 的 2 处归属更正与 9 个滞后文件。
- **验收对应**：A-22。
- **风险与回滚**：地图 glob/行数口径差异 → 模块清单显式记录口径（沿用矩阵 §1.2 的做法）。

### R-10 回归基线与 13 项冒烟（P0｜先行）

- **背景**：结构重构必须证明“行为零变化”，否则评审无法判定。
- **目标**：M0 冻结 5 份基线（HEAD、162 条 method+path、`router.ts` 全文、typecheck/build 状态、14 exports/36 文件/57 引用）；13 项 + S1–S8 逐条可比。
- **描述**：S7（`GET /api/skills/list`）、S8（`GET /api/agents/get`）是第 6 轮打回 #2 的功能探针（读 `builtinPlugins.skill/.agent`）。
- **详细方案设计**：冒烟判据 = 归一化后 diff 为空；S7/S8 额外记录「内置项数量」列（B0 基线值 → F 必须相等），把 `s3` 的非空性做成可读证据。
- **验收对应**：A-20（13 项 + S1–S8 + 21 前缀）、A-11。
- **风险与回滚**：fixture 不稳定 → 固定目录 + 固定 uuid；响应含时间戳 → 归一化白名单。

### R-11 结构化豁免登记（P0｜难度低｜风险低）

- **背景**：部分问题（bootstrap 枢纽环、`dxt↔servers`、`utils.ts` 5 个 agent 出口）无法在本需求内消除。
- **目标**：E1–E12 逐条填表（编号/理由/缓解/触发条件/责任人/判据），E11/E12 给完整模板。
- **描述**：沿用矩阵 §8.2 的 E1–E12 候选清单与 §8.4 的 E11/E12 完整模板，逐条填「编号/理由/缓解/触发条件/责任人/判据」六列。
- **详细方案设计**：沿用矩阵 §8.2 候选清单与 §8.4 的 E11/E12 模板；本版**不新增豁免**（三条打回都是方案缺陷，已修正而非豁免）。
- **验收对应**：A-23。

### R-12 三本台账与预算审计（P0｜难度中｜风险低）

- **背景**：237 文件需要逐文件归属（L1）、9 个新文件登记（L2）、交付态汇总（L3）。
- **目标**：L1 237 / L2 9 / L3 246、≤14,839 行（+Δ）；业务 ≤50/模块；交付 ≤55 文件、≤3,300 行/模块；`app.ts` ≤80；入口 ≤60。
- **描述**：三本台账（L1/L2/L3）+ 5 类预算（单模块业务 ≤50、交付 ≤55 文件 / ≤3,300 行、`app.ts` ≤80、入口 ≤60、契约文件行数上限）+ A-24 的边界检查（零测试/零依赖/零分层）。
- **详细方案设计**：审计脚本口径与矩阵 §A.10 一致；本版**不增加文件**（`scanBuiltin` 实现留在既有 `plugins/initialize.ts`；`addMediaProvider` 公开在既有入口）；入口静态面**只是 import 行**，不改变行数预算（§2.5 实测 15–25 行）。
- **验收对应**：A-01～A-05、A-24。

### R-13 模块级 SCC 与依赖白名单（P1｜难度低｜风险中）

- **背景**：模块级 20 条直接边 + bootstrap 枢纽环；`dependencies` 若无约束会与实现脱节。
- **目标**：`dependencies` ⊆ 白名单；SCC-1（5 域模块）与含 bootstrap 枢纽环按 E12 接受；file 级 SCC 收敛为 `dxt↔servers`。
- **描述**：机械判定「`dependencies` ⊆ 白名单」「实际边 − 声明边 = ∅」「模块级 SCC 成员与 §2.4 一致」。
- **详细方案设计**：`dependencies` = 该模块对其它模块的**直接深路径边**（20 条边子集，含 E10 的 7 条弱边，否则「声明 ≠ 实际」）；入口新增的**相对** import（`./…`）不计入跨模块边（§2.6）。
- **验收对应**：A-18、§A.6、§A.11。

### R-14 判据工程（两相 / 守卫 / 台账 / 相位扫描）（P0｜难度中｜风险中）

- **背景**：前 6 轮打回中，4 次是「判据不可执行 / 不可达 / 引用悬空」，2 次是「方案踩空判据」。
- **目标**：每条判据有 phase；无悬空引用；方案级探针 `s1–s6` 全部可执行且非空转。
- **描述**：6 组方案级探针（`s1a/s1b/s1c`、`s2`、`s3`、`s4`、`s5`、`s6`）与矩阵既有 A 项的对应关系，以及每条探针的「scope + B0 可达性 + 非空转」三件套。
- **详细方案设计**：
  ```text
  s1a  lr2 复现（v2 骨架 → 4 / FAIL）        s1b  lr2 修复（本版骨架 → 7 / PASS）
  s1c  lr2 非空转（本版骨架删 1 条 → 6 / FAIL）
  s2   pluginRoots 键集合 = 6、近义词 0（沿用 v2）
  s3   builtinPlugins 非空 + 与 B0 逐字相等（沿用 v2；M1 基线 / M7 判定）
  s4   入口内全部 `from "…"` 的目标文件存在（F-07；M2 出口条件）
  s5   全文说明符相位扫描（本轮新增；F 相块 violations=0）
  s6   入口静态面静态图 agent 边 = 0（本轮新增；8/7/5 模块）
  ```
- **验收对应**：A-27、A-28、A-29；§2.5、§3.2、附录 B。
- **风险与回滚**：探针写成“零命中即通过”的空转判据 → 每个 `s` 都带 scope 与 B0 可达性证明（附录 B）。

### R-15 默认数据目录锚点不变 + 相对路径深度补偿（P0｜难度低｜风险中）

- **背景**：`conf/index.ts:11` 的默认锚点 `resolve(import.meta.dirname, "../../../../../data")`（5 级）→ `<repo>/data`；迁到 `modules/platformCore/conf` 后深 1 级会落到 `apps/data`。
- **目标**：`f2a` 在 F 相仍 = 1；`f2b` 显式目录生效且仓库 `data/` 不被写。
- **描述**：两种实现（Q12）：**A 深度补偿**（5 → 6 级）/ B 稳定锚点（向上查找 `package.json`）。
- **详细方案设计**（默认 A）：
  ```text
  补偿：`resolve(import.meta.dirname, "../../../../../../data")`（5 → 6 级）
  校验：f2a 静态解析 = <repo>/data；f2b 处显式 TOONFLOW_DATA_DIR 生效；仓库 data/settings.json md5 前后一致
  本轮补充约束：入口静态面（§2.6）不改变 conf 的求值前提——步骤 [0] 设 env、步骤 [1] 才 import 入口
  ```
- **验收对应**：A-25（`f2a/f2b`）、L24。
- **风险与回滚**：补偿级数算错 → `f2a` 立即 FAIL（探针只读、零副作用）；锚点改法不统一 → 只允许 A/B 二选一。

---

## 6. UI 影响评估与界面回归说明

### 6.1 结论：**本需求没有任何 UI 变动**

| 维度 | 是否有变动 | 依据 |
| --- | --- | --- |
| 端点集合 | 无 | 162 条 method+path 逐条 diff（A-11）；`routes/**` 原地不动 |
| 路由与 URL | 无 | URL 由 `core.ts` 的 `fileNameToRoutePath` 从文件路径生成，路由文件不移动 |
| 响应结构 | 无 | 不改任何 handler 与 `lib/responseFormat` |
| 静态资源 | 无 | `express.static(webRoot)` 位置与参数不变（步骤 [13]） |
| 前端调用面 | 无 | 145 个文件继续 `import u from "@/utils"`；`utils.ts` 只换内部前缀（R-06） |
| 初始化语义 | 无 | 15 步的**调用**顺序/阻塞性/错误语义不变（A-26）；仅 3 个模块的**求值时刻**前移（§2.6） |

> **UI 设计说明（按任务要求显式给出）**：本需求为服务端结构性重构，**不新增/不修改任何界面、组件、样式、交互与文案**。因此“UI 设计”部分的交付物是**无 UI 变更声明 + 界面回归清单**（§6.2），而不是设计稿。若评审要求 UI 侧证据，只执行 §6.3 的检查动作，无需设计工作。

### 6.2 界面回归检查清单（按模块 → 界面位置 → 交互点）

| # | 模块 | 界面位置 | 交互点 | 期望 |
| --- | --- | --- | --- | --- |
| U1 | assetLibrary | 素材库面板（列表/预览/收藏/回收站） | 打开目录、缩略图出现 | 与基线一致；缩略图 `GET /api/assets/thumb` 200 |
| U2 | assetLibrary | 素材库 → 右键菜单 | 重命名/移动/删除/还原 | 状态码与提示文案一致 |
| U3 | mediaGeneration | 媒体生成面板 | 选择供应商/模型 → 生成 | `GET /api/providers/*` 列表数一致；生成任务可提交 |
| U4 | pluginMarket | 插件市场（工具/节点/扩展/技能/团队） | 安装/启用/卸载 | 列表内置徽标（`builtinPlugins`）**仍在**（S7/S8） |
| U5 | mcpIntegration | 设置 → MCP | 启停、连接、工具列表 | 状态与工具数与基线一致 |
| U6 | localRuntime | 工作区/桌面更新/移动互联 | 打开项目、检查更新、配对设备 | 桌面 15 端点门禁不变；`/api/connection` 代理一致 |
| U7 | agentAccess | Agent 对话 / 会话状态 | 发送消息、切换会话、@ 素材 | 会话恢复与提及（mentionSources）一致 |

### 6.3 「现象 → 断点」对照（UI 异常时的定位顺序）

| 现象 | 第一断点 | 第二断点 | 第三断点 |
| --- | --- | --- | --- |
| 页面 404 / 接口全挂 | `router.ts` 是否 161 条（A-11） | `routePrefixes` 并集是否 21 项（A-07） | `app.ts` 装配顺序（§4.2） |
| 素材缩略图空白 | `assetLibrary.warmup`（`f1c/f1d`） | `assets/thumb` 缓存目录（`conf.path`） | 数据目录锚点（`f2a`） |
| 插件列表“内置”徽标消失 | `scanBuiltin` 5 键（A-10） | `pluginRoots` 键名（`s2`） | 非空性（`s3`） |
| MCP 面板连不上 | `mcpIntegration.mount` 的 4 条动态 import（`g4b=4`） | `/mcp` 网关归属（A-07） | `getMcpSettings`（静态面） |
| 移动端配对失败 | 步骤 15 调用（A-26） | `localRuntime` 静态面 `./mobileLink`（§2.3 #5） | `conf` 的 `MobileLinkConfig` 类型边（R-07D） |
| 媒体生成返回 500 | `refreshModels` 的 `void` 语义（`g4`） | `initializeProviders` 哈希/同步（步骤 4） | 供应商目录根（`pluginRoots.provider`） |

### 6.4 UI 侧验收动作（只需执行，不需设计）

三宿主各启动一次（A-21），按 §6.2 的 U1–U7 各走 1 遍；判据是「响应归一化后 diff 为空」，不要求人工判读视觉效果。

---

## 7. 实施计划与里程碑（评审通过后执行）

| 里程碑 | 内容 | 出口条件（全部可判） |
| --- | --- | --- |
| **M0 基线冻结** | 5 份基线：HEAD、162 端点清单、`router.ts` 全文、typecheck/build、14 exports/36 文件/57 引用 | 5 份基线落盘；`apps/server` 工作树干净 |
| **M1 B0 语义探针** | 矩阵 `f4/f5`、`g1–g6`、`s3` 的 **B0 基线**输出 | 结果归档；**明确标注“不得作为 A-25/A-26 的 PASS 证据”**（矩阵 §1.6.6） |
| **M2 骨架落地** | 7 个入口（含**静态面**）+ `types/module.ts` + `lib/mentionSources.ts` | `s1b`（`lr2=7`）、`s4`（入口说明符目标存在）、`s2`、`typecheck` 通过 |
| **M3 迁移与边契约化** | R-04 迁移、R-07 A–D、R-07E 冻结 | `typecheck`；A.3 分段 50/62/103/30/0；`a2/b3/b4/b5/c4..c9/d3/d4` 达标 |
| **M4 组合根瘦身** | R-02/R-03：`app.ts` ≤80、15 步归口、中间件顺序 | A-08、A-09、`g5` 行号递增 |
| **M5 规范与豁免** | R-09（AGENTS/地图/exports）、R-11（E1–E12） | A-22、A-23 |
| **M6 台账与文档自审** | R-12 三本台账、A-27/A-28 自审 | `ledger_rows=32`、`doc_audit=PASS`、`stale_specifier_in_PHF=0` |
| **M7 F 相语义探针** | A-25 / A-26 / A-29 的**交付态**证据 | `f1a–f1d`、`f2a–f2c`、`f3a/f3b`、`f4/f5`、`g1–g6`、`lr1–lr5`、`s1b/s3/s5/s6` 全部达标 |

**变更面（文件级）**：9 个 L2 新文件 + 246 个迁移/改前缀文件 + `app.ts` + `utils.ts` + `core.ts`（分组注释）+ `package.json`（5 个 target）+ `AGENTS.md`。**零测试文件、零新依赖、零 controller/service/repository**（A-24）。

**回滚策略**：M2–M4 每步都是独立可回滚的 commit；迁移用 `git mv`（保留历史），回滚 = `git revert`；入口静态面若被评审否决（D-06），只改 3 个入口的 1 行。

---

## 8. 待评审裁决点（D-01～D-07，均有默认值）

| ID | 议题 | 默认 | 备选 | 依据 / 影响 |
| --- | --- | --- | --- | --- |
| **D-01** | `app.ts` 装配形态 | **A：7 个动态 `import()`** | B：静态 import 7 入口 | F-02：`pluginMarket`/`mediaGeneration` 入口静态面求值 `conf` → 静态化会让 `conf` 早于 `TOONFLOW_DATA_DIR`（`f2a/f2b` FAIL）。A.3 ③ 的 `app.ts` 段因此为 0，合计 245 |
| **D-02** | R-07D 的 `RemoteTeam`/`MobileLinkConfig` 归属 | **A：并入已有 `import conf from …` 的**单行混合 import** | B：新增 re-export 行 | F-04：方案 B 会让 `d4` 4→6、A.3 的 103 段 103→105 |
| **D-03** | `PluginRoots` 键名口径 | **A：六类插件词表** `{tool,node,ext,skill,provider,agent}`（零映射） | B：宿主参数词表 + 映射表 | 第 6 轮打回 #2（`skills` vs `skill` 静默空集，实测 `silent_empty=2`） |
| **D-04** | `ServerModule.exports` 语义 | **A：= `app.ts` 调用面** | B：= 入口公开的全部符号 | F-06：方案 B 会把 `b5s` 顶到 2、`c7s` 顶到 4 |
| **D-05** | 步骤 9 两段语义的归口 | **A：入口 `refreshModels()` 内两段，`app.ts` 只 `await` 一次** | B：拆成两个钩子 | A-08 禁用符号（`app.ts` 不得出现 `initializeProviderModels`）；`g4` 要求 warn 型 |
| **D-06** | **入口静态面的取值形态（本轮新增）** | **A：值级 re-export（§2.3）** | B：全部改 `export type { … } from "./…"`（零运行期求值，`lr2` 仍 =7） | 代价对比见 §2.6：A 让 3 个模块求值前移（可证等价），B 零求值漂移但“运行期零信息”。**切换成本 = 改 2 个入口各 1 行**（assetLibrary、mcpIntegration） |
| **D-07** | **“入口骨架缺静态 `from`”的口径（本轮新增）** | **A：指入口文件（§2 的修法）** | B：指 `app.ts` 应静态 import 7 入口 | A 与三条打回的全部上下文一致（`lr2`/A.4 都是入口侧）；**B 会与 F-02 冲突**：`conf` 早于 `TOONFLOW_DATA_DIR` 求值 → `f2a/f2b` FAIL，且 A.3 ③ 的 `app.ts` 段由 0 变 7（合计 252 而非 245），需同时修改矩阵 A.3 ③ 的期望。**若评审选 B，本方案需回炉并连带修订矩阵** |

---

## 9. 交付物与验收对照

### 9.1 交付物（本次方案设计阶段）

| 交付物 | 路径 | 状态 |
| --- | --- | --- |
| 本方案 | `.easyvibe/development_docs/liyuhang/2_requirements_solutions/2026-10-27-02-52-serverApiSubmoduleSplit-v3.md` | 新增 |
| 索引 | `.easyvibe/development_docs/liyuhang/2_requirements_solutions/INDEX-2026-10.md` | 更新 |
| 源码/测试/脚本 | — | **零改动**（探针只在 `/tmp`） |

### 9.2 需求 → 方案 → 验收 对照

| 子需求 | 方案章节 | 验收项 | 本轮是否受影响 |
| --- | --- | --- | --- |
| R-01 入口与契约 | §4.3、§4.4、**§2.2–§2.5**、附录 A | A-06、A-07、A-29 | **是（本轮核心）** |
| R-02 组合根瘦身 | §4.2、§5 R-02 | A-08、A-09 | 否 |
| R-03 15 步归口 | §5 R-03 | A-10、A-25、A-26 | 仅步骤 15 求值时刻（§2.6） |
| R-04 目录模块化 | §4.5、§5 R-04 | A-01～A-03、A-13 | 否 |
| R-05 路由分组 | §5 R-05 | A-11、A-07 | 否 |
| R-06 facade | §5 R-06 | A.3 ④、A-12 | 否 |
| R-07 边 A–D | §5 R-07 | A-13～A-16 | 否（B 边修法沿用 v2） |
| R-07E dxt 环 | §5 R-07E | A-17 | 否 |
| R-08 宿主兼容 | §5 R-08 | A-12、A-21 | 否 |
| R-09 规范/地图 | §5 R-09 | A-22 | 否（新增 S1–S5 描述） |
| R-10 回归基线 | §5 R-10 | A-20、A-11 | 否 |
| R-11 豁免 | §5 R-11 | A-23 | 否 |
| R-12 台账预算 | §5 R-12 | A-01～A-05、A-24 | 否（入口行数已实测 ≤25） |
| R-13 SCC/白名单 | §5 R-13 | A-18 | 否（相对 import 不计跨模块边） |
| R-14 判据工程 | §5 R-14、附录 B | A-27、A-28、A-29 | **是（新增 `s5`/`s6`）** |
| R-15 数据目录锚点 | §5 R-15 | A-25（`f2a/f2b`） | 否（§2.6 已证前提不变） |

### 9.3 覆盖度与可读性自检

| 维度 | 结论 |
| --- | --- |
| 子需求覆盖 | 16/16（R-01～R-15 + R-07E）均有「背景 / 目标 / 描述 / 详细方案设计」 |
| 打回覆盖 | 第 7 轮 3 条 → §1.1 定性 → §2 / §3 逐条修复（含复现、修复、非空转三层证据） |
| 可判定性 | 每条修复都绑定**矩阵原脚本**或**本轮新增可执行探针**（`s1a/s1b/s1c/s5/s6`） |
| UI | 零 UI 变动；§6 给出 7 行界面回归清单 + 6 行「现象 → 断点」 |
| 产物边界 | 仅新增方案文档 + 更新索引；源码/测试/脚本零改动 |

---

## 10. 评审意见栏（待填写）

### 10.1 总体结论

- ☐ 通过（进入实施）
- ☐ 打回（请填写 10.2）
- ☐ 有条件通过（请填写条件与对应 D 项）

评审人：＿＿＿＿＿＿ 评审时间：＿＿＿＿＿＿ 备注：＿＿＿＿＿＿

### 10.2 打回意见（逐条，评审填写）

| # | 章节 / 位置 | 意见 | 严重程度（阻断 / 一般） |
| --- | --- | --- | --- |
| 1 |  |  |  |
| 2 |  |  |  |
| 3 |  |  |  |

### 10.3 第 7 轮打回处置确认（评审勾选）

| # | 打回意见 | 本版处置 | 证据 | 确认 |
| --- | --- | --- | --- | --- |
| 1 | 入口骨架缺静态 `from` | 7 个入口骨架均有静态面，5 个入口值级（§2.3、附录 A） | `s1b`（`lr2=7`） | ☐ 认可 ☐ 不认可 |
| 2 | A-29 `lr2` 仅 4≠7 | 复现（4）+ 修复（7）+ 非空转（6→FAIL） | 附录 B `s1a/s1b/s1c` | ☐ 认可 ☐ 不认可 |
| 3 | 附录 A.4 用迁移后非法的 `@/utils` | A.4 改相对说明符 + `s5` 全文扫描（v2 捕获 4 行、本版 0 行） | 附录 B `s5` | ☐ 认可 ☐ 不认可 |

### 10.4 裁决点确认（D-01～D-07）

| D | 默认 | 裁决（采纳默认 / 选备选 / 其他） | 备注 |
| --- | --- | --- | --- |
| D-01 | A：`app.ts` 动态装配 |  |  |
| D-02 | A：单行混合 import |  |  |
| D-03 | A：六类插件词表 |  |  |
| D-04 | A：`exports` = app.ts 调用面 |  |  |
| D-05 | A：步骤 9 两段同归入口 |  |  |
| **D-06** | **A：值级静态面** |  | 若选 B，改 2 个入口各 1 行 |
| **D-07** | **A：静态 `from` 指入口** |  | 若选 B，需连带修订矩阵 A.3 ③ 并回炉 |

### 10.5 实施许可

- ☐ 许可实施（按 M0 → M7）
- ☐ 先补材料再议（请写明缺什么）：＿＿＿＿＿＿

---

## 附录 A：7 个入口骨架（伪代码；实现体一律省略）

> 说明：**只保留与判据相关的行**（静态面、动态块、契约对象、关键错误语义），实现体用 `/* … */` 省略。骨架行数实测 15–25 行（≤60，A-06）。
> 每个骨架的 ① 段（静态面）都含**至少 1 条值级 `from "./…"`**（`lr2`）；⑤ 段（动态块）只在 `f1d`/`g4b` 冻结的两处出现。

### A.1 `assetLibrary/index.ts`

```text
import type { ServerModule, ModuleContext } from "@/types/module";      // 外部（bootstrap 类型）
import { internalAssetDirectories } from "./assets/roots";             // ← ① 静态面（值级，lr2）

export { internalAssetDirectories };                                    // 模块边界常量（路径安全清单）

export function warmup(context: ModuleContext) {                        // 步骤 5：同步签名、fire-and-forget
  void import("./assets/thumb").then(({ sweepThumbnailCache }) => sweepThumbnailCache()).catch(() => {});
}                                                                       // f1c=1 f1d=1 g2=1 g3=1 f3a=0

const module: ServerModule = {
  id: "assetLibrary",
  routePrefixes: ["/api/assets"],
  dependencies: ["localRuntime", "mediaGeneration", "platformCore"],
  exports: ["warmup"],
  warmup,
};
export default module;
```

### A.2 `mediaGeneration/index.ts`

```text
import type { ServerModule, ModuleContext } from "@/types/module";
export { addMediaProvider } from "./media/provider";                    // ← ① 静态面（b5s=1；R-07B 契约）

export async function initializeProviders(context: ModuleContext) {     // 步骤 4
  /* guard(ctx.dataDirectory && ctx.pluginRoots.provider)
     source = resolve(ctx.pluginRoots.provider, "media")
     revision = ctx.pluginRevision ?? sha256(4 文件；ENOENT→空 Buffer，其它 errno 抛出)      // g6a/g6b
     await ctx.syncPluginDirectory(resolve(ctx.dataDirectory,"providers"), source, [...], revision) */
}

export async function refreshModels() {                                  // 步骤 9（D-05）
  const { default: initializeProviderModels } = await import("./ai/initialize");   // 导入失败 → reject
  void initializeProviderModels().catch(error => console.warn("启动时刷新供应商模型失败：", error));  // g4=1
}

const module: ServerModule = {
  id: "mediaGeneration",
  routePrefixes: ["/api/ai", "/api/ffmpeg", "/api/providers"],
  dependencies: ["localRuntime", "platformCore"],
  exports: ["initializeProviders", "refreshModels"],
  initialize: initializeProviders,
};
export default module;
```

### A.3 `pluginMarket/index.ts`

```text
import type { ServerModule, ModuleContext } from "@/types/module";
export { decodeText, skillPath, skillZip } from "./plugins/install";    // ← ① 静态面（c9 逐字）
export { listTools } from "./plugins/tools";                            //    c9 逐字
export * as skillFiles from "./skills/files";                           //    c9 逐字
export { default as syncDirectory } from "./plugins/initialize";        //    app.ts 调用面（A-08）

export async function initializeTools(context: ModuleContext) { /* 委托既有 initializePlugins */ }
export async function initializeNodes(context: ModuleContext) { /* 同构 */ }
export async function initializeExt(context: ModuleContext)   { /* 同构（initializeExt） */ }
export async function initializeSkills(context: ModuleContext){ /* 同构 */ }
export async function initializeAgents(context: ModuleContext){ /* 同构 */ }
export async function scanBuiltin(context: ModuleContext)     { /* 5 键 Set（BUILTIN_TYPES，零映射） */ }

const module: ServerModule = {
  id: "pluginMarket",
  routePrefixes: ["/api/tools", "/api/nodes", "/api/ext", "/api/skills", "/api/agents", "/api/plugins"],
  dependencies: ["localRuntime", "mediaGeneration", "platformCore"],
  exports: ["syncDirectory", "initializeTools", "initializeNodes", "initializeExt",
            "initializeSkills", "initializeAgents", "scanBuiltin"],
};
export default module;
```

### A.4 `mcpIntegration/index.ts`（打回 #3 的修正点：4 条动态 import 全部改相对）

```text
import type { Application } from "express";
import type { ServerModule, ModuleContext } from "@/types/module";
import { getMcpSettings } from "./mcp/control";                         // ← ① 静态面（值级，lr2）
                                                                        //    control 是 MCP 域内唯一不依赖 @/agent 的模块（s6）
export { getMcpSettings };                                              // MCP 连接设置契约

export async function mount(app: Application, context: ModuleContext) {
  const [{ createMcpRouter }, { getMcpTools }, { authorizeMcp }, { skillResources }] = await Promise.all([
    import("@toonflow/mcp"),                                            // ← ⑤ 外部包
    import("./mcp/tools"),                                              // ← ⑤ 自家域（原错误：@/utils/mcp/tools）
    import("./mcp/control"),
    import("./mcp/resources"),
  ]);                                                                   // g4b=4（4 行，file_count 按行计）
  app.use("/mcp", createMcpRouter({ getTools: getMcpTools, authorize: authorizeMcp,
    resources: skillResources, /* runInRequest / translate / translateError 同 B0 */ }));
}

const module: ServerModule = {
  id: "mcpIntegration",
  routePrefixes: ["/api/mcp"],
  gateways: ["/mcp"],
  dependencies: ["localRuntime", "mediaGeneration", "platformCore", "pluginMarket"],
  exports: ["mount"],
  mount,
};
export default module;
```

### A.5 `localRuntime/index.ts`

```text
import type { Application } from "express";
import type { ServerModule, ModuleContext } from "@/types/module";
import { initializeMobileLinkRuntime } from "./mobileLink";             // ← ① 静态面（值级；钩子直接使用）

export async function initializeRuntime(app: Application, context: ModuleContext) {   // 步骤 15
  initializeMobileLinkRuntime(app);                                     // 调用时刻与 B0 相同（求值时刻前移，见 §2.6）
}

const module: ServerModule = {
  id: "localRuntime",
  routePrefixes: ["/api/workspaces", "/api/desktop", "/api/exec", "/api/mobileLink"],
  dependencies: ["assetLibrary", "mediaGeneration", "platformCore"],
  exports: ["initializeRuntime"],
};
export default module;
```

### A.6 `agentAccess/index.ts`（`MIN_REL=0`）

```text
import type { Application } from "express";
import type { ServerModule, ModuleContext } from "@/types/module";

export async function mount(app: Application, context: ModuleContext) {
  const { createA2aRouter } = await import("@/agent/a2a");              // ← ⑤ 外部模块（agent），必须动态
  app.use("/a2a", createA2aRouter());
}

const module: ServerModule = {
  id: "agentAccess",
  routePrefixes: ["/api/agent", "/api/browser", "/api/sessionState", "/api/singleAgent"],
  gateways: ["/a2a"],
  dependencies: ["platformCore", "pluginMarket"],
  exports: ["mount"],
  mount,
};
export default module;
```

### A.7 `platformCore/index.ts`（`MIN_REL=0`）

```text
import type { Request, Response, NextFunction } from "express";
import type { ServerModule, ModuleContext } from "@/types/module";

export async function prepare(context: ModuleContext) {                 // 步骤 [3]
  const { default: conf } = await import("./conf");                     // ← ⑤ 必须动态（f2a/f2b 时序）
  /* setLocaleFallback(() => normalizeLocale(conf.get("settings",{}).ui?.language) ?? detectLocale(...)) */
}

export function corsGuard(request: Request, response: Response, next: NextFunction) {
  /* corsOriginAllowed 下沉到此（B0 的 app.ts 私有函数），语义逐字保留 */
}

const module: ServerModule = {
  id: "platformCore",
  routePrefixes: ["/api/settings", "/api/monitor"],
  dependencies: ["localRuntime", "mediaGeneration"],
  exports: ["prepare", "corsGuard"],
};
export default module;
```

### A.8 2 个非入口 L2 文件（只列契约，不含实现）

```text
src/types/module.ts        仅类型（PluginType / BuiltinPluginType / PluginRoots / ModuleContext / ServerModule）
                           → 运行期 import = 0（lr5=0）；≤40 行
src/lib/mentionSources.ts  MentionQuery（type）+ mentionAssetType（纯路径判定）；≤30 行；不 import @/modules
```

---

## 附录 B：本轮只读探针与实测（全部在 `/tmp` 执行，不落库）

### B.1 基线复核（§1.3 V1–V8）

```bash
# PH-B0（仅基线复核：文件/行数、路由、端点、深路径、facade）
python3 - <<'PY'
import glob
files=[p for p in glob.glob('apps/server/**/*.ts',recursive=True) if '/src/agent/' not in p and 'node_modules' not in p]
print(len(files), sum(sum(1 for _ in open(p,encoding='utf-8',errors='ignore')) for p in files))
PY
# 实测：237 14352（矩阵 B0 = 237 / 14,349 → +3 行漂移，F-01）
find apps/server/src/routes -name '*.ts' | wc -l                                  # 161
grep -rho 'from "@/utils/[a-zA-Z]*' apps/server/src --include='*.ts' | wc -l      # 246
grep -rl 'from "@/utils"' apps/server/src --include='*.ts' | wc -l                # 145
ls apps/server/src/utils/plugins                                                  # ext initialize initializeExt install nodes tools（无 media/）
```

### B.2 `s1a/s1b/s1c`：`lr2` 的复现 → 修复 → 非空转

```bash
# 在 /tmp 建两套模拟目录（不改仓库）：
#   /tmp/sim_v2 = v2 骨架（assetLibrary / mcpIntegration / localRuntime 只有动态 import）
#   /tmp/sim    = 本版骨架（附录 A）
python3 /tmp/probe_l2_relative_v2.py   # s1a 复现打回
# 实测：lr2_entry_relative_ok=4  l2_relative=FAIL

python3 /tmp/probe_l2_relative_sim.py  # s1b 本版
# 实测：lr2_entry_relative_ok=7  l2_relative=PASS

# s1c 非空转：删掉 localRuntime 的静态面（改回 await import("./mobileLink")）
# 实测：lr2_entry_relative_ok=6  l2_relative=FAIL
```

> 三套跑的是**矩阵 §A.13.2 的同一脚本逻辑**（`MIN_REL` 表、`REL`/`ALIAS` 正则逐字一致），只把根路径换成 `/tmp`。

### B.3 其余判据在骨架上的实测（`file_count` 按行计）

```bash
grep -cE 'import\('                              /tmp/sim/apps/server/src/modules/mcpIntegration/index.ts   # 4  (g4b)
grep -cE 'sweepThumbnailCache\('                 /tmp/sim/apps/server/src/modules/assetLibrary/index.ts     # 1  (f1c)
grep -cE 'void .*import\("\./assets/thumb"\)|void import\(' /tmp/sim/apps/server/src/modules/assetLibrary/index.ts  # 1 (f1d/g2)
grep -cE 'catch\(\(\) => \{\}\)'                 /tmp/sim/apps/server/src/modules/assetLibrary/index.ts     # 1  (g3)
grep -cE 'console\.'                             /tmp/sim/apps/server/src/modules/assetLibrary/index.ts     # 0  (f3a)
grep -c  'initializeProviderModels()\.catch'     /tmp/sim/apps/server/src/modules/mediaGeneration/index.ts  # 1  (g4)
grep -c  'addMediaProvider'                      /tmp/sim/apps/server/src/modules/mediaGeneration/index.ts  # 1  (b5s)
grep -cE '(decodeText|listTools|skillFiles)'     /tmp/sim/apps/server/src/modules/pluginMarket/index.ts      # 3  (c7s)
wc -l                                            /tmp/sim/apps/server/src/modules/*/index.ts               # 15–25（≤60，A-06）
```

### B.4 `s5`：全文说明符相位扫描（打回 #3 的证据）

```bash
python3 /tmp/probe_doc_specifiers.py <v2 文档>
# 实测：code_blocks=26 utils_specifier_lines=4 f_phase_violations=4
#   L829（v2 原文，错误写法，仅作对照）：4 条动态 import 一行写，其中 3 条用了迁移前的深路径说明符
#   → 即评审打回的附录 A.4（另 3 行为未标 B0 的基线探针，已在本版全部显式标注）

python3 /tmp/probe_doc_specifiers.py <本版文档>
# 实测：见 §3.2 表（f_phase_violations=0）
```

### B.5 `s6`：入口静态面的静态 import 图（S3 的证据）

```bash
python3 /tmp/probe_static_graph.py    # BFS 静态 import，忽略 import type，统计可达模块与 @/agent 边
# 实测：
#   assets/roots   static_modules=8  runtime_@agent_edges=0
#   mcp/control    static_modules=7  runtime_@agent_edges=0
#   mobileLink     static_modules=5  runtime_@agent_edges=0
# 可达清单（assets/roots）：lib/{i18n,nodeMenu,platform,responseFormat} + assets/roots + conf + mobileLink + workspace
```

### B.6 `s4`（沿用）：入口说明符的目标存在性

```bash
python3 - <<'PY'
import os, re
ENTS = ["assetLibrary","mediaGeneration","pluginMarket","mcpIntegration","localRuntime","agentAccess","platformCore"]
REL = re.compile(r'(?:from|import\()\s*"(\.{1,2}/[^"]+)"')
for e in ENTS:
    p=f"apps/server/src/modules/{e}/index.ts"; miss=[]
    if not os.path.isfile(p): print(f"{e:<15} <missing entry>"); continue
    for spec in REL.findall(open(p,encoding="utf-8").read()):
        base=os.path.normpath(os.path.join(os.path.dirname(p),spec))
        if not any(os.path.isfile(base+s) for s in (".ts","/index.ts")): miss.append(spec)
    print(f"{e:<15} missing={len(miss)} {miss}")
PY
# 期望（F 相）：missing=0（7 个入口全部）；本轮的 3 个骨架已用 /tmp/sim 的文件结构验证路径形态
```

---

## 附录 C：与 v2 的差异索引

| 位置 | v2 | v3（本版） | 原因 |
| --- | --- | --- | --- |
| 入口骨架 | 公开面是占位符；3 个入口只有动态 import | **每入口必有静态面**（§2.2 S1），7 个骨架全文（附录 A） | 打回 #1、#2 |
| `assetLibrary` | 只有 `void import("./assets/thumb")` | 增 `./assets/roots`（`internalAssetDirectories`） | `lr2` |
| `mcpIntegration` | 只有 4 条 `import("@/utils/mcp/*")` | 增 `./mcp/control` 静态面；4 条动态改 `./mcp/*` | `lr2`＋打回 #3 |
| `localRuntime` | `initializeRuntime` 内 `await import("./mobileLink")` | 静态 `import { initializeMobileLinkRuntime } from "./mobileLink"` | `lr2`；求值时刻变化已登记（§2.6） |
| 附录 A.4 | `@/utils/mcp/{tools,control,resources}` | `./mcp/{tools,control,resources}` | 打回 #3 |
| 判据探针 | `s1–s4` | `s1a/s1b/s1c`、`s2–s4`、**`s5`（相位扫描）**、**`s6`（静态图 agent 边）** | R-14 |
| 决策点 | D-01～D-05 | **D-06（静态面形态）、D-07（“静态 from”口径）** | 本轮新增 |
| 未变 | R-07B 公开面、`PluginRoots` 词表、`exports` 语义、`app.ts` 动态装配、D-01～D-05 | **全部保持** | 第 6 轮已认定修正 |

---

## 附录 D：一页纸结论（给评审）

1. **打回 #1/#2 同一个根因**：入口“动态 import 优先”压倒了“静态面”，导致 `lr2=4`。本版把**入口三段式**（静态面 → 动态块 → 契约对象）写成硬规则，5 个入口各补 1 条**值级**静态行，`lr2=7` 由结构保证（脚本实跑 PASS / FAIL 两侧都有证据）。
2. **打回 #3 是相位错误**：F 相块里写了 B0 说明符。已改相对路径，并新增可机械复跑的全文扫描 `s5`（对 v2 捕获 4 行、对本版 0 行）。
3. **补静态面有代价但可证等价**：3 个模块求值时刻前移到步骤 [1]（`conf` 仍在 `TOONFLOW_DATA_DIR` 之后），调用时刻与错误语义不变，静态图 `@/agent` 边 = 0。
4. **没有改任何需求期望值**，也没有新增 A 项：本版只改方案骨架与说明符，`s1–s6` 作为既有 A 项的证据补充。
5. **待评审两件事**：D-06（静态面取值形态，值级 vs 类型级）与 D-07（“静态 from”指的是入口还是 `app.ts`；后者需连带改矩阵）。
