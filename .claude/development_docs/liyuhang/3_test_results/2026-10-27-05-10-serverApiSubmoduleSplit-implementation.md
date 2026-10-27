# 测试与验收报告 · server-api 应用子模块拆分（实施与验证）

## 0. 文档元信息

| 项 | 内容 |
| --- | --- |
| 文档编号 | `TEST-2026-10-27-01` |
| 对应需求 | `REQ-2026-10-26-06`（需求矩阵 v6） |
| 对应方案 | `SOL-2026-10-27-04`（方案 v4，第 8 轮打回后重做版） |
| 影响模块 | `server-api`（`apps/server`） |
| 实施基线 | HEAD `1861cd0`（237 文件 / 14,352 行；矩阵 B0 `d084136` = 237 / 14,349，差 3 行走 F-01 登记） |
| 实施后规模 | **246 文件 / 14,584 行**（L3 = 237 + 9；上限 14,839） |
| 验证时间 | 2026-10-27 04:50–05:10 |
| 结论 | **A-01～A-29 全部 PASS**（A-21 的 GUI 宿主以类型检查 + 端点冒烟替代，见 §7） |

## 1. 变更范围（实际执行）

| 类别 | 内容 | 数量 |
| --- | --- | --- |
| 移动（`git mv`，保留历史） | `src/utils/<域>/**`、`src/remoteConnection.ts` → `src/modules/<模块>/**` | **59** |
| 新增（L2） | 7 个入口 + `src/types/module.ts` + `src/lib/mentionSources.ts` | **9** |
| 说明符改写 | `@/utils/<域>` → `@/modules/<模块>/<域>`（只改前缀、不改形态） | **246** 处（50 agent + 62 routes + 103 modules + 30 utils.ts + 1 app.ts→0） |
| 组合根重写 | `src/app.ts` 160 → **78 行**；`createApp` 形参与类型逐字不变 | 1 |
| 路由生成器 | `src/core.ts` 增加 21 条模块分组注释（不含 `app.use` 字面量） | 1 |
| 包导出 | `apps/server/package.json` 5 个 target 跟迁（键名 14 个不变） | 1 |
| 规范 | `AGENTS.md`：目录结构、模块入口与契约、模块清单、台账口径 | 1 |
| 边界 | **0** 新增测试文件、**0** 新增依赖、**0** controller/service/repository、判据脚本全部在 `/tmp` | — |

## 2. 验收判定表（A-01～A-29）

| 编号 | 验收项 | Phase | 实测 | 判定 |
| --- | --- | --- | --- | --- |
| A-01 | L1 存量归属 | B0+F | `total=237 assigned=237 unassigned=0 duplicated=0`（`/tmp/probe_n1.py`） | **PASS** |
| A-02 | L2 新增台账 | B0+F | `new_total=9`、9 个路径与 §3.3 逐字一致、`new_lines=276 ≤ 490` | **PASS** |
| A-03 | L3 交付台账 | F | `final_total=246 = 237 + 9`；文件/端点/路由等式全成立；行数 14,584 ≤ 14,839 | **PASS** |
| A-04 | 业务 ≤50/模块 | F | 49/43/28/27/26/22/20/8（pluginMarket 49 为最大值） | **PASS** |
| A-05 | 交付 ≤55/≤3,300/≤900 | F | 50/43/28/27/26/22/21/9；最大 2,339 行（pluginMarket）；bootstrap 691 ≤ 900 | **PASS** |
| A-06 | 7 个入口与契约 | F | 7 个 `modules/*/index.ts` 存在、`export default ServerModule`；行数 18/43/57/31/16/18/46（≤60） | **PASS** |
| A-07 | 路由前缀所有权 | F | 入口 `routePrefixes` 并集 = §3.6 的 **21 项**、集合相等且两两无交集；`gateways=['/a2a','/mcp']` | **PASS** |
| A-08 | `app.ts` ≤80 与禁用符号 | F | `wc -l = 78`；禁用符号计数 **0**；`app.locals.builtinPlugins =` 仅 **1** 处 | **PASS** |
| A-09 | 中间件顺序 | F | 行号 51 < 52 < 53 < 54 < **56**（`/api/sessionState` 64kb）< 57（全局 100mb）< 58 < 59 | **PASS** |
| A-10 | 15 步顺序 + 步骤 8 锚点 | B0+F | `express()`=43 < `builtinPlugins`=45 < `development`=47；步骤 1–7 在 `express()` 前；5 键 `Set` 实测 | **PASS** |
| A-11 | 162 端点 / 161 路由文件 | B0+F | `route_files=161 routes=161 endpoints=162`；**method+path diff 为空**（`/tmp/m0/endpoints.txt` vs 实施后） | **PASS** |
| A-12 | 14 exports / 36 文件 / 57 引用 | B0+F | 14 键名 diff 为空、14 个 target **全部存在**、**14/14 运行期 import 成功**；36 文件 / 57 引用不变 | **PASS** |
| A-13 | R-07A mentionSources 归零 | B0+F | `a1=4`(B0) → `a2=0`（scope_files=42 ≥ scope_min=41）；`server→agent 23→19`；`asset→platform 27(1t/26v)` | **PASS** |
| A-14 | R-07B plugin→media 契约 | B0+F | `b3=0`(scope 32)、`b4=0`(scope 6)、`b5=1`（整行 `import { addMediaProvider } from "@/modules/mediaGeneration";`）、`b5s=1` | **PASS** |
| A-15 | R-07C mcp→plugin 深路径 | B0+F | `c4=c5=c6=0`(scope 7)、`c7=3`、`c7s=3`、`c8a=7`、`c8b=4`、`c9` 三条 re-export 逐字存在 | **PASS** |
| A-16 | R-07D conf type 边归零 | B0+F | `d3=0`(scope 1)、`d4v=4`、`d4t=2`、`d4_raw=6`（E14 登记）；`platform→plugin 0`、`→local 1 value`、`→media 1 value` | **PASS** |
| A-17 | R-07E dxt/servers | B0+F | `e3=e4=1`、`e5a=e5b=0`；file SCC `count=1,size=2` | **PASS** |
| A-18 | 模块 SCC / 白名单 / E10 | F | 19 个非零域对（B0 的 20 条 − R-07D 归零的 `platform→plugin`）；**无新增 source→target 对**；7 个入口 `dependencies` 与实测出边 **7/7 一致**（第 10 轮修正 `localRuntime`/`platformCore` 两处方向后复核，见 `2026-10-27-08-23-serverApiSubmoduleSplit-round10Close.md` §3） | **PASS** |
| A-19 | typecheck / build / 产物启动 | F | `tsc --noEmit` 0 错误；`bun run build` 成功（`build/server/index.js` 23.26 MB）；产物启动 1,025 ms、`/api/tools/get`=200、`/mcp`=401、`/api/settings/get`=403（同源门禁，与基线一致） | **PASS** |
| A-20 | 13 项 + S1–S8 + 21 前缀 | B0+F | 42 条请求（21 前缀首端点 + 13 冒烟 + S1–S8 + 2 网关 + 404）**B0 vs F 归一化 diff 为空** | **PASS** |
| A-21 | 三宿主启动 | B0+F | 独立 server：源码模式与 `build/server` 产物均通过；`@toonflow/desktop`、`@toonflow/mobile` **typecheck 0 错误**（含 5 个改动 export）；GUI 宿主未运行，见 §7 | **PASS（受限）** |
| A-22 | AGENTS / 地图 / exports 同步 | F | `AGENTS.md` 规则与代码逐条对齐（57 条跨模块 import 中 53 深引 / 36 文件 / 4 经入口；入口 9 处动态块；装配胶水 ≤35 行）；主地图按 `src/modules/**` 重算 706/706 覆盖、`server-api` 246 文件、子图 8 子模块；exports 无悬空；`tsconfig.paths` 未改（见 `2026-10-27-08-23-serverApiSubmoduleSplit-round10Close.md` §4） | **PASS** |
| A-23 | 豁免表完整 | F | **E1–E15** 逐条填表（§6），每条含事实/理由/替代缓解/触发条件/责任人/有效期/判据 | **PASS** |
| A-24 | 无新增测试/依赖/分层 | F | `git status` 只有源码/文档改动；0 测试文件、0 依赖变更、0 判据脚本落库 | **PASS** |
| A-25 | 步骤 5 预热 + 数据目录锚点 | **F** | `f1a=0 f1b=0 f1c=1 f1d=1 f3a=0 f3b=1 f2c=2`；`f2a=1`（6 级 → `<repo>/data`）；`f2b=1`（显式目录生效、仓库 `data/settings.json` md5 不变）；`f4_resolved=1 f4_unhandled=0`；`f5_tools_equal=1 f5_marker=rev1` | **PASS** |
| A-26 | 15 步阻塞性/错误语义 | **F** | `g1=0 g2=1 g3=1 g4=1 g4b=4 g6a=1 g6b=1`；`g5` 43<45<47；步骤 5（`void`+空 catch）与步骤 9（`void`+warn）分处两个入口、未合并 | **PASS** |
| A-27 | 判据自审（能力继承） | B0+F | 方案层 `doc_audit=PASS`（v4 §2.3.4/§3.3）；本轮每条判据均带 phase 与期望值，无 vacuum zero（`scope_files ≥ scope_min` 全部成立） | **PASS** |
| A-28 | 数值台账自审 | B0+F | 本轮新增实测 21 项全部登记于 §4/§5；`scope_assertions=0`（期望列无 `scope_files`）；`missing_path_guard=0`；`vacuous_zero=0` | **PASS** |
| A-29 | L2 说明符形态 | **F** | `lr1_exist=1 lr2_entry_relative_ok=7 lr3_self_alias=0 lr4_cross_alias=0 lr5_other_alias=0` → `l2_relative=PASS` | **PASS** |

## 3. 关键判据原始输出（可逐行复核）

```text
== A.2 端点 ==
route_files=161 app_use=161
endpoints: files=161 endpoints=162
endpoint_diff_vs_B0: EMPTY

== A.3③（k1–k4）==
k1_total=245   seg_agent=50 seg_routes=62 seg_modules=103 seg_utils_ts=30 seg_app_ts_static=0
k2_app_dynamic=7      → k4 = 245 + 7 = 252（E13 归一化口径）
== A.3④ facade == 145      == A.3⑤ zero_guard == 0   src_ts=272

== A.4 ==
server_to_agent=19   agent_to_server=51   agent_to_lib=20   (51 + 20 = 71)

== A.7 边判据 ==
check=a2   phase=F expect=0   scope_files=42   scope_min=41  hits=0   verdict=PASS
check=b3   phase=F expect=0   scope_files=32   scope_min=32  hits=0   verdict=PASS
check=b4   phase=F expect=0   scope_files=6    scope_min=6   hits=0   verdict=PASS
check=b5   phase=F expect=1   scope_files=6    scope_min=6   hits=1   verdict=PASS
check=b5s  phase=F expect=1   scope_files=1    scope_min=1   hits=1   verdict=PASS
check=c4   phase=F expect=0   scope_files=7    scope_min=7   hits=0   verdict=PASS
check=c5   phase=F expect=0   scope_files=7    scope_min=7   hits=0   verdict=PASS
check=c6   phase=F expect=0   scope_files=7    scope_min=7   hits=0   verdict=PASS
check=c7   phase=F expect=3   scope_files=7    scope_min=7   hits=3   verdict=PASS
check=c7s  phase=F expect=3   scope_files=1    scope_min=1   hits=3   verdict=PASS
check=c8a  phase=F expect=7   scope_files=1    scope_min=1   hits=7   verdict=PASS
check=c8b  phase=F expect=4   scope_files=1    scope_min=1   hits=4   verdict=PASS
check=d3   phase=F expect=0   scope_files=1    scope_min=1   hits=0   verdict=PASS
check=d4v  phase=F expect=4   scope_files=4    scope_min=4   hits=4   verdict=PASS
check=d4t  phase=F expect=2   scope_files=4    scope_min=2   hits=2   verdict=PASS
d4_raw=6
check=e3   phase=F expect=1   scope_files=1    scope_min=1   hits=1   verdict=PASS
check=e4   phase=F expect=1   scope_files=1    scope_min=1   hits=1   verdict=PASS
check=e5a  phase=F expect=0   scope_files=1    scope_min=1   hits=0   verdict=PASS
check=e5b  phase=F expect=0   scope_files=1    scope_min=1   hits=0   verdict=PASS

== A.7.6 / A.7.7 ==
check=f1a phase=F expect=0 hits=0 PASS   check=f1b phase=F expect=0 hits=0 PASS
check=f1c phase=F expect=1 hits=1 PASS   check=f1d phase=F expect=1 hits=1 PASS
check=f3a phase=F expect=0 hits=0 PASS   check=f3b phase=F expect=1 hits=1 PASS
f2c=2
check=g1  phase=F expect=0 hits=0 PASS   check=g2  phase=F expect=1 hits=1 PASS
check=g3  phase=F expect=1 hits=1 PASS   check=g4  phase=F expect=1 hits=1 PASS
check=g4b phase=F expect=4 hits=4 PASS   check=g6a phase=F expect=1 hits=1 PASS
check=g6b phase=F expect=1 hits=1 PASS
g5: app=43 < builtinPlugins=45 < development=47

== A-08 / A-09 ==
app_lines=78   app_banned=0   builtin_assign=1
51 app.use(platform.corsGuard)   52 app.use(languageRequest)   53 app.use("/a2a", express.json 2mb)
54 app.use([...], express.raw 100mb)   56 app.use("/api/sessionState", express.json 64kb)
57 app.use(express.json 100mb)   58 app.use(express.urlencoded 100mb)   59 app.use("/api/desktop", desktopRequest)

== A-29 l2_relative ==
  entry=assetLibrary    relative=1 min=1  self_alias=0 cross_alias=0 ok=1
  entry=mediaGeneration relative=1 min=1  self_alias=0 cross_alias=0 ok=1
  entry=pluginMarket    relative=5 min=1  self_alias=0 cross_alias=0 ok=1
  entry=mcpIntegration  relative=1 min=1  self_alias=0 cross_alias=0 ok=1
  entry=localRuntime    relative=1 min=1  self_alias=0 cross_alias=0 ok=1
  entry=agentAccess     relative=0 min=0  self_alias=0 cross_alias=0 ok=1
  entry=platformCore    relative=0 min=0  self_alias=0 cross_alias=0 ok=1
l2_relative: lr1_exist=1 lr2_entry_relative_ok=7 lr3_self_alias=0 lr4_cross_alias=0 lr5_other_alias=0 → PASS

== A.6 file SCC ==
files= 246 scc_count= 1
  size 2 ['modules/mcpIntegration/mcp/dxt.ts', 'modules/mcpIntegration/mcp/servers.ts']
（B0 的 15 文件环已消失 = R-07D 生效；E11 的 2 文件环按默认冻结）

== n1（打回 #1 的修复点）==
moved files=59 lines=9240 ; unmoved files=178 lines=5109 ; total=237/14349
  assetLibrary moved=9/9 unmoved=18/18   mediaGeneration 17/17 + 25/25
  pluginMarket 10/10 + 39/39             mcpIntegration 7/7 + 13/13
  localRuntime 8/8 + 37/37               agentAccess 4/4 + 22/22
  platformCore 4/4 + 16/16 = 20          bootstrap 0/0 + 8/8
n1_files=PASS   n1_lines=PASS（9,240 + 5,109 = 14,349）

== A-14 台账（L3 逐模块）==
bootstrap 9/750(691)  assetLibrary 28/2675(2633)  mediaGeneration 43/3054(3037)  pluginMarket 50/2343(2339)
mcpIntegration 21/1493(1464)  localRuntime 46/2255(2205)  agentAccess 27/1253(1214)  platformCore 22/1016(1001)
per_module_budget=PASS   final_total=246
```

## 4. 运行时验证

### 4.1 语义探针（F 相）

| 探针 | 输出 | 判定 |
| --- | --- | --- |
| `f2a` 默认锚点 | `anchor_rel=../../../../../../data` → `<repo>/data`，`hits=1` | PASS |
| `f2b` 显式目录 | `f2b_explicit_dir=1 f2b_repo_data_unchanged=1`，`conf.path=<tmp>/data/settings.json` | PASS |
| `f4` 预热异常容错 | 把 `<data>/cache/thumbs` 建成普通文件注入 → `f4_resolved=1 f4_unhandled=0` | PASS |
| `f5` createApp 幂等 | 同进程连续两次 `createApp` → `f5_tools_equal=1 f5_marker=rev1` | PASS |
| `builtinPlugins` | `agent,ext,node,skill,tool` 5 键、全部 `Set`、`tool.size=1`（注入的 `demo.tool.js` 被识别） | PASS |

### 4.2 静态图探针（S6/S8）

| 检查 | 输出 | 判定 |
| --- | --- | --- |
| `app.ts` 静态图 | 7 个文件（`app.ts core.ts lib/{desktop,i18n,platform,responseFormat}.ts types/module.ts`），`modules_reached=0`、`agent_reached=0` | PASS（S8） |
| 入口静态面是否传递求值 `conf` | 5 个入口可达 `conf`（assetLibrary / localRuntime / mcpIntegration / mediaGeneration / pluginMarket），2 个不可达 | 与 F-02 一致 → 支撑 `app.ts` 动态装配（E13） |
| 入口静态图的 `@/agent` 边 | **value 边 = 0**；每个入口至多 1 条 **type 边**（来自 `conf` 的 `import type { A2aSettings }`，编译期擦除） | PASS |

### 4.3 接口冒烟：B0 vs F 逐条 diff（归一化后为空）

- 方法：用 `git worktree add d084136` 起 B0 实例（端口 3111），当前工作树起 F 实例（端口 3112），同一份 `build/` 内置插件输入、各自独立 `TOONFLOW_DATA_DIR`。
- 42 条请求：**21 个前缀首端点（§3.6 逐字）+ 13 项冒烟 + S1–S8 + `/mcp` 与 `/a2a` 网关 + 1 条 404 反例**。
- 归一化规则：JSON key 排序；时间戳/UUID/绝对路径/16 位以上十六进制 → `<TS>/<UUID>/<PATH>/<HASH>`；比较 `status` 与 `content-type`；忽略 `date`/`etag`。
- 结果：**status+body diff 为空**（`SMOKE_DIFF_EMPTY`）。
- 抽样状态码（两相一致）：`POST /api/agent`=400、`GET /api/settings/get`=403、`GET /api/tools/get`=200、`GET /api/skills/list`=400、`GET /api/agents/get`=200、`GET /api/providers/media/list`=200、`GET /mcp`=401、`POST /a2a`=404、`GET /api/nonexistent`=404。

### 4.4 构建与类型检查

```text
apps/server:  tsc --noEmit                → 0 error
apps/server:  bun run build               → Bundled 3162 modules, build/server/index.js 23.26 MB
build/server: bun build/server/index.js   → [服务启动成功] 1,025 ms；/api/tools/get=200；/mcp=401
workspace:    @toonflow/server typecheck  → 0
              @toonflow/desktop typecheck → 0
              @toonflow/mobile typecheck  → 0
              @toonflow/web typecheck     → 仅有 `.vue` 模块声明缺失（改动前如此，与本次无关）
```

## 5. 与方案期望的数值对账（2 处偏差，均已解释）

| 指标 | 方案 v4 期望 | 实测 | 结论 |
| --- | --- | --- | --- |
| A.3③ 静态 / 归一化 | 245 / 252 | **245 / 252** | 一致（E13） |
| 模块段 | 103 | **103** | 一致 |
| facade | 145 | **145** | 一致 |
| `d4v/d4t/raw` | 4 / 2 / 6 | **4 / 2 / 6** | 一致（E14） |
| `asset→platform` | 27（1t/26v） | **27（1t/26v）** | 一致 |
| `local→platform` | 76（1t/75v） | **77（1t/76v）** | **+1**：`remoteConnection.ts` 迁移后深 1 级，`./lib/i18n` 必须改为 `@/lib/i18n`（否则 `f2c` 由 2 变 3），该行成为被计数的 alias 边 |
| `mcp→platform` | 35（0t/35v） | **36（0t/36v）** | **+1**：MCP 网关的本地化包装（`runInRequest/translate/translateError`）从 `app.ts` 移入 `mcpIntegration` 入口，入口需要 `@/lib/i18n` |
| `platform→plugin` | 0 | **0** | 一致（R-07D） |
| `plugin→media` / `mcp→plugin` | 1 / 3 | **1 / 3** | 一致（R-07B/C 契约化不减计数） |
| 域间边 | 20 条（B0 表） | **19 个非零对**（= 20 − `platform→plugin`），**无新增 source→target 对** | 一致（A-18/E10 判据是“不新增对”） |
| 文件 / 行数 | 246 / ≤14,839 | **246 / 14,584** | 一致 |

> 两处 +1 都落在**既有**的 `源→目标` 对上，属“计数增量”而非“新增依赖关系”：E10 的 7 条弱边未增长，白名单未扩张。登记为 **E15**（§6）。

## 6. 结构化豁免登记（E1–E15）

| ID | 关联 | 事实与证据 | 未消除理由 | 替代缓解（可执行判据） | 复核触发条件 | 责任人 / 有效期 |
| --- | --- | --- | --- | --- | --- | --- |
| E1 | R-07C | 插件安装/工具内核以“模块入口公开面”提供（`pluginMarket/index.ts` 三条 re-export） | 抽独立包会违反 NG3（不新增包/依赖） | `c9` 三条 re-export 逐字存在 + `c7=3` | 出现第二个消费方 | server-api owner / 本版本 |
| E2 | R-06 | `utils.ts` 保留 5 个 `@/agent` 出口（`agent`、`canvas`、`question`、`a2aSettings`、`mentionFiles`） | 145 个调用面冻结，删出口会连带改 145 文件 | `facade=145`（B0=F）+ 出口数 37 逐 key 不变 | AgentHost 端口化 | 同上 |
| E3 | R-04 | `/api/exec` 与工作区同属 `localRuntime` | 共享工作区根与越界防护 | 入口 `dependencies` 显式声明；`A-07` 前缀归属唯一 | 拆分执行沙箱 | 同上 |
| E4 | R-05 | `router.ts` 保留 161 条扁平挂载，仅加 21 条分组注释 | 生成器重写的风险高于收益 | `grep -c 'app.use'`=161 + 162 端点 diff 为空 | 需要真实分组文件时 | 同上 |
| E5 | R-07D | `conf` 仍有 2 条指向 `localRuntime`/`mediaGeneration` 的**值**依赖 | 配置 schema 与业务读取同源 | `d4v=4` + `platform→local 1 value`、`→media 1 value` | 配置层拆分 | 同上 |
| E6 | NG1 | 19 处运行期 `@/agent` 依赖保留（B0 23 − R-07A 4） | 会话运行时属另一模块 | `server_to_agent=19` 上限；不新增第 20 处 | AgentHost 端口隔离 | 同上 |
| E7 | R-07D | `platformCore → @/agent` 3 处（其中 1 处为 `conf` 的 **type** 边，不参与运行期求值） | 平台配置语义需要 A2A/桌面类型 | 入口静态图 `agent value 边 = 0`（§4.2）；不新增第 4 处 | 同上 | 同上 |
| E8 | R-07C | MCP 工具运行 Agent（2 行） | MCP 端点本质是 Agent 工具面 | 仅此 2 行（`mcpIntegration → agent lines=2`） | 同上 | 同上 |
| E9 | R-07 | `pluginMarket → @/agent` 1 处（A2A 模型校验） | 校验与运行同源 | `lines=1` 上限 | 同上 | 同上 |
| E10 | R-07/R-13 | 7 条残余弱边（asset→media 1、local→media 1、mcp→local 3、mcp→media 1、platform→local 1、platform→media 1、agentAccess→pluginMarket 1） | 读配置/取枚举级弱边 | 边矩阵冻结：`域间 19 对`，**不新增 source→target 对**；每条 `lines` 不增长 | 出现第 8 条弱边 | 同上 |
| E11 | R-07E | `mcp/dxt.ts ↔ mcp/servers.ts` 模块内 2 文件环 | 互为兜底清理，拆开只是无意义抽象 | `e3=e4=1` + `e5a=e5b=0` + `SCC count=1,size=2` | 需要 Q8（消除）时 +1 文件 | 同上 |
| E12 | R-13 | 模块级 SCC-1（assetLibrary / localRuntime / mediaGeneration / platformCore / pluginMarket）+ bootstrap 枢纽环 | 既有架构事实，本需求不承诺 DAG | 边计数上限 + 白名单子集判定 | AgentHost 端口化 | 同上 |
| **E13** | R-04/R-14 | **A.3③ 静态 grep=245（矩阵 252），差 7 行**：`app.ts` 的 7 个入口装配为动态 `import()` | **5 个入口的静态面传递求值 `conf`（§4.2 实测），静态化会让 `conf` 早于 `TOONFLOW_DATA_DIR`，三宿主显式目录被静默降级（f2a/f2b 破坏）** | `k1=245`、`k2=7`、`k3=50/62/103/30/0`、`k4=252`、`zero_guard=0`、`typecheck` + 三宿主冒烟 | `app.ts` 获得安全静态装配方式 | server-api owner / 本版本 |
| **E14** | R-07D | **`d4` raw=6（矩阵期望 4）**：多出 2 条 `export type … from "@/modules/platformCore/conf"` | 2 条 re-export 是 `RemoteTeam`/`MobileLinkConfig` 的公开类型面（`@toonflow/server/agent/mentionSources`、`/mobileLink` 外部契约不删） | `d4v=4`（只数 import 行，符合矩阵 §1.6.5）+ `d4t=2` + `d3=0` + `SCC=1` | 评审坚持 raw=4（则模块段 103→101，需追加 −2 豁免） | 同上 |
| **E15** | R-07/R-13（本轮实测新增） | **两处 +1**：`localRuntime→platformCore 76→77`（`remoteConnection.ts` 的 `@/lib/i18n`，迁移深度补偿的必要改法）、`mcpIntegration→platformCore 35→36`（MCP 网关本地化包装随 `app.ts` 瘦身移入入口） | 两者都是**既有 source→target 对**的增量，不是新增依赖；若强行消除会分别触发 `f2c=3`（跨模块相对引用）或把 i18n 包装留在组合根（A-08/A-09 的净化目标） | `域间非零对=19`（无新增对）、`d4v/d5` 三条不变、`e5` 不变、白名单未扩张 | 出现新增 source→target 对 | 同上 |

## 7. 未覆盖项与受限说明

| 项 | 状态 | 说明 |
| --- | --- | --- |
| 桌面（Electrobun）GUI 启动 | **未运行** | 需要 GUI 环境与打包流程；以 `@toonflow/desktop` typecheck=0（含 `@toonflow/server/{app,mcp,mobileLink,browser,remoteConnection}` 全部 import）、15 个 `/api/desktop/*` 端点在实例冒烟中返回与 B0 相同状态替代 |
| 移动端（Android/OHOS）GUI | **未运行** | 同上；`@toonflow/mobile` typecheck=0，`apps/mobile/src/server.ts` 的 `remoteConnection`/`mcp` 引用经 exports 解析成功 |
| UI 回归（方案 §6.2 U1–U7） | **未逐界面点检** | 本需求零 UI 变动；判定改为“42 条请求 body diff 为空 + 162 端点 diff 为空”，比界面点检更严格 |
| `@toonflow/web` typecheck | 预存失败 | 仅 `.vue` 模块声明缺失（`./App.vue`、`@/pages/*.vue` 等），与本次改动无关；web 对 server 的 6 个 import 全部解析成功 |
| 真实供应商/媒体生成 | 未执行 | 无供应商凭据；按 §6.6 规则 4 以“改动前后一致”的错误体为基线 |

## 8. 复现命令（脚本不落库，全部 `/tmp`）

```bash
# 1) 结构/边/形态判据
bash /tmp/probe_f.sh                     # A.3/A.4/A.7/f*/g*/A-08/A-09
python3 /tmp/probe_l2rel.py              # A-29 l2_relative
python3 /tmp/a11_final.py f              # A.11/A-18 域边（B0 用 struct 模式 + /tmp/b0 快照）
python3 /tmp/probe_n1.py                 # n1（59/178、9,240/5,109）
python3 /tmp/probe_ledger.py             # L1/L2/L3 与逐模块预算
python3 /tmp/m0/endpoints.py             # A.11 端点清单（与 /tmp/m0/endpoints.txt diff）
# 2) 运行时
BUN=/opt/homebrew/bin/bun PHASE=F bash /tmp/probe_datadir.sh src/modules/platformCore/conf/index.ts   # f2b
CONF_FILE=apps/server/src/modules/platformCore/conf/index.ts PHASE=F python3 /tmp/probe_anchor.py      # f2a
(cd apps/server && PROBE_TMP=$(mktemp -d) /opt/homebrew/bin/bun /tmp/probe_semantics.ts)               # f4/f5
bash /tmp/smoke.sh . 3112 /tmp/smoke-f.txt                                                            # 42 条请求
```

## 9. 结论

- 关键验收（A-01～A-29）全部 PASS；两处数值偏差（`local→platform 77`、`mcp→platform 36`）均为既有边上的 +1，已登记 E15，不影响 A-18/E10 的判定。
- 行为零变化：162 端点、21 前缀、14 exports、42 条请求响应与 B0 逐字一致（归一化后）。
- 结构达成：237 文件的单模块 → 8 个子模块（9 / 28 / 43 / 50 / 21 / 46 / 27 / 22），`app.ts` 78 行、`src/utils/**` 清空、file 级 15 文件环消失。
