# 需求矩阵 · AgentHost 端口切断 agent↔应用双向依赖（架构级环治理）

> **第 2 版 · 第 1 轮打回后重做**。本版只改需求矩阵与索引，**业务代码零改动**（`git status --porcelain apps packages` 为空）。评审通过后才进入方案与实施。

## 0. 文档元信息

| 项 | 内容 |
| --- | --- |
| 文档编号 | **REQ-2026-10-27-02** |
| 版本 | 第 2 版（替代 REQ-2026-10-27-01） |
| 需求来源 | `.easyvibe/map/map.json` → `health.concerns.c-arch-1`（critical）、`modules[server-api].health.concerns.c-server-api-2`（critical）、`modules[agent-runtime].health.concerns.c-agent-runtime-1`（critical）；全局 `decay_flags = [circular_dep, layer_violation]` |
| 需求标题 | 抽 AgentHost 端口切断 `agent-runtime → 应用层`（`@/utils`·`@/lib`·`@/modules`）的静态依赖；反向 `应用层 → agent` 收敛到唯一装配面；由组合根单向装配 |
| 影响模块 | `agent-runtime`（主）、`server-api`（主）、`shared-foundation`（纯契约下沉）、`web-console`（契约连带只验不改）、`ai-providers`（契约连带只验不改）；派生：`desktop-shell`、`mobile-shell`（`@toonflow/server/*` 导出路径不变） |
| 需求类型 | 结构性重构（架构整改）。**不改变任何业务行为、HTTP 契约、NDJSON 事件字段、磁盘格式、设置格式** |
| 优先级 | **P0**（地图 critical；环位于每条 Agent 请求的必经路径） |
| 当前状态 | **待评审（第 2 版）** |
| 编写人 | 需求分析 agent（harness 规则正文 2.1 执行者） |
| 编写时间 | 2026-10-27 12:23 |
| 基线 | `git HEAD = 89572b5`（与第 1 版相同）；地图生成于 `2026-10-27T08:01:50+08:00`（`head_short = 1861cd0`，滞后 4 个提交，模块归属未变） |
| 上一版 | `2026-10-27-12-09-agentHostPortCycleBreak.md`（REQ-2026-10-27-01，**第 1 轮打回**） |
| 验收口径 | 20 条二值判据（A-01～A-20）+ 精确台账（L01～L18）+ 冲突优先级规则（§6.2）。**表内不存在范围型期望**，任何"≤ / 约 / 趋势"都不作为验收结论 |

### 0.1 第 1 轮打回意见逐条处置（本版核心修订）

| # | 打回意见（原文） | 根因（本版实测定位） | 本版处置（可核对） | 落点 |
| --- | --- | --- | --- | --- |
| 1 | **A-04 与 E4 冲突** | ① A-04 用 P3 计数，"源码运行期值边归零"的期望是 `0`，但 P3 含 `agentAccess/index.ts:6` 的动态 `import("@/agent/a2a")`（E4 明确保留）→ 实测 18 条，`0` 不可达；② 更根本的是 G2 把"应用→agent"当作要**归零**的方向，与地图建议"由 `app.ts` **单向装配 agent**"（即应用→agent 是设计方向）自相矛盾 | 重新定向 G2：**应用→agent 是允许方向**，要求不是归零而是"收敛到唯一装配面"；把反向边拆成 4 个独立维度（静态值 / 静态类型 / 动态 / 包契约），A-04 改为**文件集合精确相等**，A-05 改为**说明符集合精确相等**；E4 只在 A-05 的枚举里出现 1 次，不再混入"静态值"判据 | §2.1 G2、§6.1 A-04/A-05、§8 E4 |
| 2 | **A-05 与 E4 冲突** | A-05 期望"≤ §8 登记条目（默认 ≤3 类型边）"，但 P3 的 21 行 = 17 静态值 + 3 静态类型 + 1 动态；把动态算进去是 4，不算又没写清，且"≤"本身不是唯一判定 | 删除"≤"型期望；A-05 的期望写成**精确枚举的 13 行**（静态值 11 + 静态类型 1 + 动态 1）；动态单独记 L07，不作为 A-05 的分子；`teams-scaffold` 单独由 A-06 判定（3） | §6.1 A-05/A-06、§6.5 L05–L08 |
| 3 | **A-15 与 Q1、Q3 默认值冲突** | ① A-15 把 `coverage 706/706` 写成固定值：Q1 默认 A 新增 `apps/server/src/agent/host.ts`、Q3 默认 C 新增 `packages/formats/**`，任何新代码文件都会让 706 变成非 706 → 判据必失败；② A-15 要求"`MODULES` 与基线一致"，但 Q3 默认 C 是**物理下沉**三个纯模块，必须改归属 glob；③ "AGENTS.md `dependencies` 与实测一致"没有定义"实测"是什么，且 `agentAccess` 若声明依赖 `agent-runtime`，会与 7 子模块依赖表（只含子模块 id）不可表达 | 把 A-15 拆成三条：**A-16 口径冻结**（`map.json` 的 glob 集合 = M0 ∪ manifest 的 3 条新增，无删除/加宽；§6.5 探针命令文本冻结）；**A-17 归属覆盖**（`uncovered == 0`；`files_total == 714`；新增代码文件 == 8 个枚举路径）；**A-18 归属迁移证据**（每个纯模块副本与 M0 旧文件逐字节相同、旧路径保留再导出 shim；globs 变更 == manifest 枚举（3 条）；禁止加宽 glob）。新增"口径漂移 vs 归属迁移"的可判定定义（§6.6）。`dependencies` 改为**逐项枚举的期望表**，明确 `agentAccess` **不新增** `agent-runtime` 依赖（Host 由 bootstrap 注入） | §6.1 A-16/A-17/A-18、§6.6、§2.3、§9 Q1/Q3 |
| 4 | **R-04 注入时序不可实现** | 第 1 版把注入点放在"`platform.prepare` 之后、`agentAccess.mount` 之前"，同时要求"在任何 agent 代码被求值之前"。实测：`createApp` 中 `await import("@/router")` 在 `agentAccess.mount` **之前**，而 `routes/agent.ts` 等 4 个路由文件静态 import `@/agent` → agent 在 router 装载时已被求值；且模块入口的 9 处动态块已冻结，注入无法搭 `platform.prepare`/`mount` 的便车。两条要求互斥，按字面不可实现 | 注入点改为 **`await media.refreshModels()` 之后、`await import("@/router")` 之前**（新增装配步骤 9.5）；由 bootstrap 文件 `apps/server/src/agentHost.ts` 承担创建与配置；`agentHost.ts` 运行时只静态可达 `apps/server/src/agent/host.ts`（无副作用的契约叶子）；不变量改写为三条**可实现且可探针验证**的规则：**I1 无顶层捕获、I2 注入先于首次使用、I3 未注入即 fail-fast**。删除"任何 agent 代码被求值之前"这一不可验证的绝对表述 | §1.7、§4 R-03、§6.1 A-09/A-10 |
| 5 | **验收不可唯一判定** | 逐条清点第 1 版：`≤ 登记条目`、`只降不升`、`单调不增`、`趋势达标` 是范围/趋势；`⊆ {…类型文件}` 的"类型文件"未定义；`行为一致`、`文案一致`、`模块表与实测一致` 是主观；`map.json 重算后 706/706` 依赖未冻结的脚本；13 项冒烟只写"一致" | ① 20 条判据全部为**整数或精确集合**；② 计数类判据要求 **grep 与 Python 解析双算相等**（§6.7 G3）；③ 所有期望 0 的 grep 都附**正控制**（同正则在 M0 快照上必须 >0，§6.7 G1）；④ 冒烟改为逐条的**状态码 + 事件类型序列 + 精确文案**断言（§6.4）；⑤ 趋势只留在**台账**，且每个里程碑给出精确期望值（§5），偏差即失败；⑥ 新增"不可达即回评审"的硬规则（§6.2 规则 4）；⑦ 地图覆盖改为可执行探针（读 `map.json` 的 globs 重算，§6.5 P12） | §5、§6.1、§6.2、§6.4、§6.7 |

### 0.2 第 2 版自查发现（非打回意见，但影响正确性，一并纠正）

| # | 位置 | 第 1 版写法 | 实测 / 纠正 | 复现命令 |
| --- | --- | --- | --- | --- |
| S1 | §1.4 能力清单合计 | `50 + 1 + 22 = 73`，另加 1 条类型边 = 74 | **lib 是 23 不是 22**：`@/lib` 20 条 + 相对逃逸 3 条（`agent/mentionSources.ts:8,135`、`agent/runtime/types.ts:2`）。正确分解：`50（@/modules）+ 1（@/utils）+ 23（lib/相对）= 74`；其中值边 68、类型边 6（别名 4 + 相对 2） | `grep` + Python 双算，§0.5 E1 |
| S2 | §1.2 "23 / 29 个 agent 文件命中" | 未给复现命令 | 实测 **23 个文件**命中（21 个含别名边、2 个只含相对边），29 个 `.ts` 文件 / 4,032 行 | §0.5 E2 |
| S3 | 第 1 版 A-09（引用集合） | `⊆ {app.ts, 注册表, agentAccess/index.ts(动态), conf(类型豁免), 类型文件}` | "类型文件"未定义，且把 `conf` 留在集合里与"反向收敛"矛盾。本版改为 **3 个精确文件 + 13 行精确说明符**；`conf` 的类型边通过 Q3 的纯契约下沉消除，不再豁免 | §6.1 A-04/A-05 |
| S4 | §6.4 冒烟 | "事件序列一致 / 文案一致" | 无法二值判定。改为逐条断言：HTTP 状态、首末事件 type、必须出现的 type、精确错误文案（均取自现网源码） | §6.4 |
| S5 | 第 1 版 A-13（数据目录） | "启动成功后结束进程" | "成功"无定义。改为：日志出现固定串 `[服务启动成功]` 后发 `SIGTERM`；同时取仓库 `data/settings.json` 的 `md5` 与 `mtime` 前后相等 | §6.1 A-11 |
| S6 | 地图对账 | 地图 `e7` 记 71 条 | 地图别名口径 71、解析口径（含相对）= 74；两者都保留，A-01 判别名、A-02 判相对、A-03 判合计；**不以地图数字直接裁决**，以 §6.5 探针为准，地图只做 A-08 的边存在性判定 | §6.1 A-08、§6.5 |
| S7 | 新文件预算 | 未给 | 实施必然新增代码文件（契约、Host、门面、纯契约包）。本版冻结为 **8 个枚举路径**（5 个新逻辑 + 3 个纯迁移副本），超出即失败；`files_total` 由 706 变为 714 | §6.1 A-17、§6.5 P12 |

### 0.3 与第 1 版的关键差异

| 项 | 第 1 版（REQ-2026-10-27-01） | 第 2 版（本版） |
| --- | --- | --- |
| 反向边目标 | 源码值边归零、静态边 ≤3 | **收敛到 3 个文件 / 13 行**（精确集合），反向是允许方向 |
| 反向边维度 | 静态/动态/包契约混在 P3 | 4 个独立维度：静态值 11、静态类型 1、动态 1、包契约 3 |
| 验收项 | A-01～A-16 | **A-01～A-20**（范围/趋势全部删除） |
| 注入时序 | `platform.prepare` 后、`mount` 前 | **`await media.refreshModels()` 后、`await import("@/router")` 前**（步骤 9.5） |
| 注入不变量 | "任何 agent 代码被求值之前" | I1 无顶层捕获 / I2 注入先于首次使用 / I3 fail-fast |
| 地图口径 | MODULES 冻结 + `706/706` | glob 集合 = M0 ∪ manifest；归属迁移走 manifest + “内容相同副本 + shim”证据；`uncovered=0`、`files_total=714` |
| 台账 | L01–L12（趋势参与判定） | **L01–L18**（台账不参与判定，里程碑表给精确期望） |
| 冒烟 | "一致" | 逐条二值断言（状态码 / 事件类型 / 精确文案） |
| 里程碑 | M0–M4 | **M0–M5**（M1 完成反向收敛；M4 环消除；M2–M4 分 5 批消 A2P） |
| 新文件 | 未约束 | **8 个枚举路径**（§6.1 A-17） |

### 0.4 覆盖度 / 可测性 / 无歧义自检

| 维度 | 本版保证方式 | 核对位置 |
| --- | --- | --- |
| **覆盖度** | 第 1 轮 5 条打回 → §0.1 逐条落到 G/R/A/Q/E；自查 7 条 → §0.2。地图 3 个 critical 关注点、AGENTS 6 条硬约束、74/24 条边、11 个能力分组、file SCC、web 38 条契约导入、providers 契约 → 全部有归属 | §0.1、§0.2、§1.4、§1.5、§8、附录 A |
| **可测性** | 20 条判据全部给出：探针编号、精确期望、相位、正控制；计数类双算；集合类逐项枚举；冒烟 13 条逐条断言；覆盖探针可直接执行 | §6.1、§6.4、§6.5、§6.7 |
| **无歧义** | 术语与计数口径 §1.6；求值时序实测 §1.7；口径漂移定义 §6.6；冲突优先级 §6.2；Q1–Q10 全有默认值；E1–E12 逐条给"为何不能消除 / 代价 / 复核方式" | §1.6、§1.7、§6.2、§6.6、§9、§8 |

### 0.5 本轮实测证据（HEAD = `89572b5`，2026-10-27 12:10–12:22 执行）

| # | 命令（摘要） | 实测输出 | 对应断言 / 台账 |
| --- | --- | --- | --- |
| E1 | §6.5 P1（grep）+ P2（grep）+ Python 双算 | 别名 `71`（值 67 / 类型 4）；相对 `3`（值 1 / 类型 2）；合计 `74`，值 `68` | L01–L04、A-01～A-03 |
| E2 | `grep -rl` 命中文件数；`find/wc` | 命中 `23` 个 agent 文件；agent `29` 文件 / `4,032` 行 | L14 |
| E3 | 反向 `@/agent` grep + Python | `21` 行 / `11` 文件；静态值 `17`、静态类型 `3`、动态 `1` | L05–L10 |
| E4 | `grep -rn "@toonflow/teams-scaffold" apps/server/src --exclude-dir=agent \| wc -l` | `3` | L08、A-06 |
| E5 | `grep -rl "from \"@/utils\"" apps/server/src \| wc -l`；utils 键数 | `145`；`37` | L11、L12、A-07 |
| E6 | §6.5 P6（SCC 脚本） | `scc_total 3 agent_scc 1`；含 agent 的 SCC = 10 文件（8 agent + `utils.ts` + `singleAgent/index.ts`）；另两个应用内 SCC = 3 文件、2 文件 | L13、A-08 |
| E7 | §6.5 P12（读 `map.json` globs 重算） | `files 706 uncovered 0`；模块文件数 `server-api 246 / agent-runtime 33 / web 176 / …` | L16、A-17 |
| E8 | 静态可达性（Python） | `app.ts` 静态链 6 文件、到 agent **0**；`@/router` 被 `await import`；7 个入口静态面到 agent **0**、到 conf 5 个入口命中 | §1.7、A-10 |
| E9 | agent 顶层副作用扫描 | 唯一业务副作用：`agent/a2a/settings.ts:71` 的 `conf.onDidChange("a2a", …)`；其余为声明/常量 | §1.7、R-03 |
| E10 | web 契约导入 | `@toonflow/server/*` 共 `38`：`agent/types 14`、`agent/mentionSources 4`、`singleAgent/types 3`、`documentFormats 4`、`modelReasoning 5`、`nodeMenu 4`、`desktop 4` | L17、A-14 |
| E11 | `find apps/server/src -name '*.ts'` + `wc -l` | `272` 文件 / `18,546` 行；`app.ts 78` 行；`utils.ts 37` 出口 / `75` 行 | L15、L18 |
| E12 | `git status --porcelain apps packages` | 空（本版仅文档） | §0 元信息 |

> 结论：第 1 轮 5 条打回全部有实测根因与可执行处置；基线数字在本机可复现，且与地图别名口径 71 可对账（解析口径 74 为本版验收口径）。

---

## 1. 背景

### 1.1 问题原文（地图关注点）

> `c-arch-1`（critical）：agent-runtime 与应用层双向 import（agent→应用 71 处、应用→agent 24 处）构成环，且环位于每条 Agent 请求的必经路径，任何一侧改动都会牵动另一侧。
> 建议：先抽 AgentHost 端口切断 agent→`@/utils`·`@/lib`，再让 `app.ts` 单向装配 agent 与各应用子模块。

| 关联关注点 | 严重度 | 与本需求的关系 |
| --- | --- | --- |
| `c-server-api-2` | critical | 应用侧视角：`utils.ts` 37 出口 / 145 文件引用，且聚合 agent |
| `c-agent-runtime-1` | critical | agent 侧视角：`run()` 直接依赖工作区、模型、i18n；地图原文的 `@/utils/*` 是拆分前旧路径，当前为 `@/modules/localRuntime/workspace/files`、`@/modules/mediaGeneration/ai`、`@/lib/i18n` |
| `c-arch-4` | high | 应用层内部 53 条跨子模块深引；**本需求不处理**（NG4），但不得新增模块对（A-18） |
| `c-arch-3` | high | web 编译期固化插件/服务端契约；本需求冻结导出路径、只验不改（A-14） |
| `c-ai-providers-1` | high | `compshare.ts` 1839 行；**不处理**（NG3），本需求只保证 providers 依赖不变（Q7 默认 A） |

### 1.2 环的实测形状（本轮逐行统计，HEAD = 89572b5）

**方向一：agent → 应用（23 / 29 个文件命中，74 处）**

| 计数口径 | 数值 | 构成 |
| --- | --- | --- |
| 别名 `@/(modules\|lib\|utils)`（= 地图 `e7`） | **71** | `@/modules` 50、`@/lib` 20、`@/utils` 1 |
| 相对逃逸 `../lib/**`（地图未计） | **3** | `agent/mentionSources.ts:8`（类型）、`:135`（值）、`agent/runtime/types.ts:2`（类型） |
| **解析口径合计** | **74** | 值 68 + 类型 6 |
| 其中 `import type`（构建后擦除） | 6 | 别名 4（`assetLibrary/assets/roots` 1、`lib/modelReasoning` 3）+ 相对 2 |

**方向二：应用 → agent（21 行 / 11 文件 + 3 条包契约）**

| 维度 | 行数 | 文件 | 说明 |
| --- | --- | --- | --- |
| 静态值 | **17** | `utils.ts`(5)、`singleAgent/index.ts`(5)、`mcp/tools.ts`(2)、`routes/agent.ts`(1)、`settings/systemPrompt.ts`(1)、`settings/save.ts`(1)、`agents/a2a/save.ts`(1)、`singleAgent/run.ts`(1) | 运行期值依赖 |
| 静态类型 | **3** | `conf/index.ts`(1)、`singleAgent/types.ts`(1)、`routes/agent.ts`(1) | 构建后擦除，但静态图仍是边 |
| 动态 | **1** | `agentAccess/index.ts:6` `await import("@/agent/a2a")` | AGENTS.md 冻结的 9 处动态块之一（E4） |
| 包契约 | **3** | `modules/platformCore/conf/index.ts`、`modules/pluginMarket/teams/files.ts`、`routes/agents/connect.ts` 对 `@toonflow/teams-scaffold` | 该包归属 `agent-runtime`（E5） |
| **合计** | **24** | 11 源码文件 + 3 包契约 | |

**环的收敛点（file 级 SCC）**

| 图 | SCC 总数 | 含 agent 的 SCC | 成员 |
| --- | --- | --- | --- |
| 值边（运行期） | 3 | **1** | 10 文件：`agent/{assets,index,mentionFiles}`、`agent/runtime/{delegation,index}`、`agent/teams/index`、`agent/tools/{index,subAgent}`、`utils.ts`、`modules/agentAccess/singleAgent/index.ts` |
| 应用层内部 | 2 | 0 | `pluginMarket` 3 文件；`mcpIntegration` 2 文件 |

> 关键结论：**环不需要"反向归零"才能断**。只要反向值边从"agent 的依赖闭包内的文件"（`utils.ts`、`singleAgent`、`routes`）迁出到"agent 不依赖的 bootstrap 门面"，file 级 SCC 即消失；`agent→应用` 归零则是**地图模块级边 `e7` 消失**与"任何一侧改动不再牵动另一侧"的充分条件。本版把这两件事拆成 M1 与 M2–M4 两个阶段，分别验收。

### 1.3 为什么必须处理（而不只是"不好看"）

1. **必经路径**：`routes/agent.ts → utils.ts → agent/index.ts → agent/runtime/index.ts → @/modules/* → (145 个文件) → utils.ts`。
2. **装载顺序被业务无关项绑定**：`modules/platformCore/conf/index.ts` 在模块顶层执行 `mkdirSync/realpathSync/new Conf(...)` 并写入默认供应商；agent 的 8 处 `conf` 引用把配置求值时机与 agent 装载时机耦合。`app.ts` 靠"先设 `TOONFLOW_DATA_DIR` 再动态装配"的人工纪律维持（A-11 守住）。
3. **扇出极大**：`utils.ts` 被 145 个文件静态引用，其中 5 行 re-export agent，使任一路由都可能在装载期把 agent 拖进来。
4. **改动放大**：任一侧接口/初始化顺序变化都要同时核对 74/24 条边；地图已标 `direction_violation`（`e7`）。

### 1.4 agent 需要的应用能力（端口的输入面，逐行统计）

| # | 能力组 | 应用侧落点 | 条数 | 主要符号 | 本版处理 |
| --- | --- | --- | --- | --- | --- |
| 1 | 工作区（安全边界） | `modules/localRuntime/workspace/files.ts`、`workspace/chatImages.ts` | 13 | `resolveWorkspacePath`、`lockWorkspaceFiles`、`writeWorkspaceFile`、`renameWorkspaceFile`、`isWithin`、`isHiddenWorkspaceEntry`、`protectWorkspaceRoot`、`protectWorkspaceLibraryPath`、`importImage` | Host |
| 2 | 配置 | `modules/platformCore/conf` | 8 | `conf.get("settings"/"a2a")`、`conf.onDidChange("a2a")` | Host |
| 3 | 素材库 | `modules/assetLibrary/assets(+roots)` | 6 | `openAssetLibrary`、`createAssetDirectory`、`importAssetFile`、`importFileIntoLibrary`、`moveAsset`、`readAssetFile`、`writeAssetFile`、`removeAsset`、`getAssetsDirectory`、`assertAssetRelativePath`、`queryAssets` | Host |
| 4 | 模型目录 / 引用文件 | `modules/mediaGeneration/ai(+files,+requestFiles)` | 5 | `getConfiguredModel`、`providerSchema`、`getModelLimits`、`readAiReferences`、`referenceContent`、`createFileTransport`、`FileRequestLimitError`、`getRequestFiles`、`RequestFile` | Host |
| 5 | 个性化 / 记忆 | `modules/platformCore/personalization` | 3 | `isMemoryEnabled`、`readDocument`、`saveDocument`、`maxDocumentLength` | Host |
| 6 | 团队 | `modules/pluginMarket/teams` | 4 | `readTeam`、`saveTeamFile`、`listTeams`、`getRemoteTeam` | Host |
| 7 | 工具插件 | `modules/pluginMarket/plugins/tools` | 2 | `listTools`、`loadTool`、`validateToolConfig` | Host |
| 8 | 技能 | `modules/pluginMarket/skills/files` | 1 | `directory`、`isEnabled` | Host |
| 9 | MCP | `modules/mcpIntegration/mcp/{control,servers}` | 3 | `callControl`、`getConnection`、`getAppOrigin`、`createMcpAgentTools` | Host |
| 10 | 文档读取 | `modules/mediaGeneration/documents` | 2 | `readDocument` | Host |
| 11 | 媒体 / FFmpeg | `modules/mediaGeneration/{media/generation,ffmpeg}` | 2 | `listMediaModels`、`generateMedia`、`createWorkspaceFfmpeg` | Host |
| 12 | 浏览器 | `modules/agentAccess/browser` | 1 | `createBrowserContext` | Host |
| 13 | i18n | `lib/i18n` | 8 | `t`、`translateMessage`、`translateError` | Host（转发 ALS 上下文，不持有 locale） |
| 14 | 平台判定 | `lib/platform` | 2 | `getRuntimePlatform` | Host |
| 15 | 纯契约（下沉） | `lib/{documentFormats,modelReasoning,mentionSources}` + `agent/a2a/settings` 的 `A2aSettings` | 13 | `decodeTextFile`、`getReadableFileMimeType`、`thinkingLevels`、`ThinkingLevel`、`mentionAssetType`、`MentionQuery`、`A2aSettings` | 下沉 `packages/formats`（Q3 默认 C）。**13 = A2P 边**（documentFormats 5 + modelReasoning 6 + mentionSources 2）；`A2aSettings` 是反向类型边（`conf→agent`），随同迁移用于消除 1 条反向边，不计入 13 |
| 16 | 聚合出口 | `utils.ts` | 1 | `u.workspaceFile`、`u.assets` | Host |
| | **合计** | | **74** | 50 + 1 + 23 | |

> 分组规则：**有进程态 / 需装配 / 需请求上下文**的能力进 Host；**纯类型 / 纯函数 / 纯常量**下沉 foundation（§1.6 D3）。这条分界是本需求"无歧义"的核心。

### 1.5 不可突破的约束（AGENTS.md + 地图）

| 约束 | 内容 | 对本需求的影响 |
| --- | --- | --- |
| C1 | 模块入口 `index.ts` ≤60 行；入口静态面不得出现 `@/modules/**`；入口只允许 `import` / `export … from "./自家域/…"` / 纯 `import type` | Host 实现不能挂在入口静态面；入口只静态导出自家域 `./agentHost` 等 |
| C2 | `app.ts` 不静态 import 模块入口；入口的 9 处动态块冻结 | 注入步骤放在 `app.ts` 对 bootstrap 文件的动态 import，不新增入口动态块 |
| C3 | 模块级 SCC 不承诺无环；file 级仅保留 `mcp/dxt↔servers`；E10 深引清单冻结，不新增模块对 | Host 落 bootstrap（已声明依赖全部入口），不新增模块对；新增深引文件 1 个（`agentHost.ts`）登记 |
| C4 | **不新增测试/自检文件、不新增检查命令、不新增 CI 入口** | 复检用一次性命令 / heredoc 到 `/tmp`，执行后删除 |
| C5 | `conf` 只在 `platformCore/conf/index.ts` 初始化，且必须晚于 `TOONFLOW_DATA_DIR` | 注入必须在 `createApp` 内、数据目录确定之后 |
| C6 | web 直接编译 `@toonflow/server` 源码；desktop/mobile 经 `@toonflow/server/{i18n,platform,mcp,browser,desktop}` 复用；`apps/server/package.json` 14 个 exports | 冻结导出路径（A-14），迁移只改实现、不改 path |
| C7 | `verbatimModuleSyntax: true` | 纯类型端口可用 `import type`；但 A-01 仍按"解析口径"把类型边计入（更严） |

### 1.6 术语与计数口径（消除歧义的第一道闸）

| 术语 | 定义 | 探针 |
| --- | --- | --- |
| A2P（agent→应用） | `apps/server/src/agent/**` 内 `import/export … from` 中，说明符以 `@/modules`、`@/lib`、`@/utils`、`@/routes`、`@/types`、`@/app`、`@/router`、`@/core` 开头，或以 `../lib`、`../../lib`、`../modules`、`../../modules`、`../utils` 开头 | P1、P2 |
| A2P-别名 / A2P-相对 | 上述两类分别计数 | P1 / P2 |
| A2P-值 / A2P-类型 | 说明符所在语句是否以 `import type` / `export type` 开头 | P1+P2 过滤 |
| P2A（应用→agent） | `apps/server/src` 内、**排除 `agent/` 目录**，说明符以 `@/agent` 结尾或 `@/agent/…` 的行。**必须用边界正则 `@/agent(/\|[^A-Za-z])`**，避免把新门面 `@/agentRuntime`、`@/agentHost` 误计 | P3a/P3b |
| P2A-静态值 / 静态类型 / 动态 | 语句形态：`import`（非 type）/ `import type` / `await import(...)` | P3b |
| P2A-包契约 | `@toonflow/teams-scaffold` 在 `apps/server/src`（排除 agent）中的行数 | P4 |
| D1 装配面 | 允许出现 P2A 的文件集合。本版定为 3 个：`apps/server/src/agentRuntime.ts`、`apps/server/src/agentHost.ts`、`apps/server/src/modules/agentAccess/index.ts` | P3a |
| D2 口径漂移 | 归因算法 / 计数正则变化，或 glob 加宽（例：`apps/server/src/**`），或文件归属变化但无“内容相同副本 + 旧路径 shim”证据 | P10 |
| D3 归属迁移 | 把纯模块复制到新位置（与 M0 旧文件逐字节相同）并把旧路径改为再导出 shim；同步更新 `map.json` 的 `files` globs；新增 glob 与新增文件逐条列入 manifest | P11/P12/P13 |
| D4 趋势 | 里程碑台账 L01–L09 的数值序列。**只作记录，不作验收结论**；验收看每个里程碑的精确期望（§5） | 台账 |
| D5 相位 | 所有探针默认在 **M5（交付态）** 执行；M0 仅用于基线正控制 | §6.7 |

### 1.7 求值时序实测（R-03 可实现性的依据）

| 事实 | 证据 | 对注入的要求 |
| --- | --- | --- |
| `app.ts` 的静态 import 链只到 6 个文件，**不达 agent** | E8：`app.ts` 静态闭包 6 文件，`agent/` 命中 0 | 注入不必担心静态前置求值 |
| 7 个模块入口的静态面 **不达 agent** | E8：7 个入口到 `agent/` 命中 0 | `Promise.all` 装载入口不会求值 agent |
| 5 个入口的静态面**已求值 `conf`**（`assetLibrary/mediaGeneration/pluginMarket/mcpIntegration/localRuntime`） | E8：5 个入口到 `conf/index.ts` 命中 1 | 数据目录必须在 `Promise.all` 之前设置（现状已满足） |
| agent 首次被求值于 `await import("@/router")` | `routes/agent.ts:4,9`、`settings/systemPrompt.ts:3` 等 6 条静态 import；`router.ts` 静态 import 全部路由 | 注入必须在 router import 之前 |
| `agentAccess.mount` 在 router import 之后 | `app.ts`：`router.default(app)` → `mcp.mount` → `agentAccess.mount` | 第 1 版的注入点（mount 前）**晚于** agent 求值，与其自身要求矛盾 |
| agent 唯一的业务级顶层副作用是 `a2a/settings.ts:71` 的 `conf.onDidChange` | E9 | 迁到 Host 初始化时注册；契约叶子必须无副作用 |

> 因此本版把注入点定在 **步骤 9.5**：`await media.refreshModels()` 之后、`await import("@/router")` 之前。该位置同时满足：C5（数据目录已定）、`conf` 已初始化、agent 运行时尚未求值、`mount` 之后的所有路由/网关都能拿到已配置的 Host。

---

## 2. 目标与非目标

### 2.1 目标（可度量，全部二值）

| 编号 | 目标 | 度量（M5 期望） |
| --- | --- | --- |
| G1 | agent→应用静态 import 归零（解析口径） | A2P 74 → **0**（别名 71→0、相对 3→0、值 68→0） |
| G2 | 应用→agent **收敛到唯一装配面**（不是归零；`app.ts` 单向装配 agent 是设计方向） | P2A 24 → **13 源码行（3 文件）+ 3 包契约 = 16**；源码行 = 静态值 11 + 静态类型 1 + 动态 1 |
| G3 | file 级含 agent 的 SCC 归零；地图模块边 `e7` 消失 | SCC 1 → **0**；`e7` 不存在；`e9` 保留且计 13 |
| G4 | 行为零变化 | typecheck / build / web 构建 / 13 项冒烟全过（A-12～A-15） |
| G5 | 结论可复检且唯一 | 20 条判据全部整数/精确集合；双算一致；正控制成立；偏差即失败 |
| G6 | 文档、地图、归属同源 | A-16/A-17/A-18/A-20 全过 |
| G7 | 不新增测试/自检/CI | A-19 |

### 2.2 非目标（NG）

| 编号 | 非目标 | 理由 |
| --- | --- | --- |
| NG1 | 不消除 agent 对应用能力的**运行时依赖**（工作区、模型、素材、工具、团队、MCP 仍必需） | 只改访问方式 |
| NG2 | 不改 HTTP 路由、请求/响应结构、`AgentEvent` 字段、会话/设置文件格式 | 前端、桌面、移动、A2A 已固化 |
| NG3 | 不重构 `run()`、`sessions.ts`、不拆 `compshare.ts` | 独立关注点 |
| NG4 | 不处理应用层内部 53 条跨子模块深引 | 与环无关；不新增模块对即可（A-18） |
| NG5 | 不新增测试、自检脚本、检查命令、CI 入口 | AGENTS.md「测试与检查边界」 |
| NG6 | **不得通过加宽地图 glob、改计数正则、改模块归属让边"消失"** | 口径漂移（§6.6） |
| NG7 | 不把 agent 能力整体搬进应用层 | 领域能力留在 domain |
| NG8 | 不改变 `@toonflow/server/*` 导出路径、`packages/providers` 的 exports 与依赖 | web/桌面/移动与 providers 零改动（A-14） |
| NG9 | 不新增跨模块 source→target 对 | E10 冻结；新增深引文件仅 1 个且登记（A-18） |

### 2.3 依赖方向与"装配面"裁决表

| 关系 | 允许？ | 最终落点 | 判据 |
| --- | --- | --- | --- |
| agent → 应用（`@/modules`、`@/lib`、`@/utils`） | **禁止** | 无 | A-01/A-02/A-03 |
| agent → foundation（`@toonflow/file`、`@toonflow/formats`、`@toonflow/i18n`） | 允许 | 不变/新增 formats | A-03 |
| agent → agent-tools / ai-providers | 允许 | 不变 | — |
| 应用 → agent（值） | **允许但唯一** | `apps/server/src/agentRuntime.ts`（11 行：值 10 + 类型 1） | A-04/A-05 |
| 应用 → agent（装配） | **允许但唯一** | `apps/server/src/agentHost.ts`（1 行：`@/agent/host`） | A-04/A-05 |
| 应用 → agent（A2A 网关动态） | **允许且冻结** | `modules/agentAccess/index.ts:6`（E4） | A-05、L07 |
| 应用 → agent（包契约） | **允许且冻结** | `@toonflow/teams-scaffold` 3 条（E5） | A-06 |
| agentAccess → 应用域 | 允许（既有） | 不变 | A-18 |

> `agentAccess.dependencies` **保持 `["platformCore","pluginMarket"]`**：Host 由 bootstrap 注入，不是子模块依赖；这一条直接消除"Q1 与 AGENTS 依赖表不可表达"的冲突（A-20）。

---

## 3. 需求矩阵总表

> 优先级：P0 = 本需求不可缺项；P1 = 收口与外围。难度：低 / 中 / 中高 / 高。风险按"对行为与安全的破坏可能"评估。

| 编号 | 背景 | 目标 | 描述 | 优先级 | 难度 | 风险 |
| --- | --- | --- | --- | --- | --- | --- |
| **R-01** | agent 对 14 类应用能力有 74 处散点引用，无契约层；路径授权、文件锁、语言上下文、取消/超时语义只存在于实现里 | 给出**唯一**的 AgentHost 契约，agent 只依赖契约 | 新增 `apps/server/src/agent/host.ts`：① 纯类型/接口，按 §1.4 的 14 组分组；② `configureAgentHost(host)` / `getAgentHost()`；③ `getAgentHost()` 未配置时抛固定错误；④ **禁止**出现 `express` 的 `Request`/`Response`、**禁止**暴露 `conf` 实例；⑤ 值/异常/status 语义 1:1 透传，不得放宽越界校验或省略文件锁；⑥ 文件内不得有顶层副作用，只允许 `let host` 与函数声明 | P0 | 高 | 中：端口过宽 → 新上帝对象；语义漏写 → 实现漂移 |
| **R-02** | 24 条反向边散落在 11 个源码文件；`utils.ts` 5 条 re-export 与 `singleAgent` 5 条构成 10 文件 SCC 的应用半边 | P2A 收敛为 3 文件 / 13 行（唯一装配面）；SCC 在 M4 归零 | 新增 `apps/server/src/agentRuntime.ts` 门面（10 值 + 1 类型说明符）；`utils.ts` 改为 `import * as … from "./agentRuntime"`（37 键不变）；`routes/**` 6 条、`singleAgent/index.ts` 5 条、`singleAgent/types.ts` 1 条、`mcp/tools.ts` 2 条改为经门面；`conf` 的 `A2aSettings` 类型迁到 `@toonflow/formats`；`agent/a2a/settings.ts:71` 的顶层 `conf.onDidChange` 迁到 Host 初始化注册 | P0 | 中高 | 高：初始化顺序变化导致 `/api/agent`、`/a2a`、`/mcp` 早期不可用 |
| **R-03** | 应用侧没有 Host 实现；`conf` 是进程级单例且在模块顶层初始化；`app.ts` 只装配 7 个模块 | 唯一实现点 + 唯一注入点，注入严格晚于数据目录与 `platform.prepare`，且先于 agent 首次求值 | 新增 `apps/server/src/agentHost.ts`（bootstrap）：`createAgentHost(context)` 组装 §1.4 的 12 组应用能力（经既有深引文件，不新增模块对）；`initializeAgentHost(context)` 内 `configureAgentHost(createAgentHost(context))`；`app.ts` 在 **步骤 9.5**（`await media.refreshModels()` 后、`await import("@/router")` 前）动态 `import("./agentHost")` 并调用。**不新增入口动态块** | P0 | 中高 | 高：时机错误 → `conf` 早求值/数据目录静默降级；顶层捕获 → 注入失效 |
| **R-04** | 74 条 A2P 中 50 条 `@/modules` + 1 条 `@/utils` + 23 条 lib/相对；其中 14 条在 `run()`/`requests.ts`/`sessions.ts` 热路径 | A2P 74 → 0，分 5 批严格单调 | B0 纯下沉 13 条（`documentFormats` 5、`modelReasoning` 5+1、`mentionSources` 2）→ 61；B1 低风险读取 12 条（personalization 3、teams 4、tools 2、skills 1、documents 2）→ 49；B2 模型/媒体/i18n/platform 17 条（ai 5、media 1、ffmpeg 1、i18n 8、platform 2）→ 32；B3 安全敏感 21 条（workspace 13、assets 6、browser 1、utils 1）→ 11；B4 配置/MCP 11 条（conf 8、mcp 3）→ 0。每批独立可回滚，错误 `message/status/code` 不变 | P0 | 高 | 高：错误码/文案漂移、文件锁丢失、语言上下文丢失 |
| **R-05** | 13 条 lib/相对边是纯类型/纯函数；`apps/server/src/lib/*` 同时被 web/desktop/mobile 经 `@toonflow/server/*` 复用 | agent 不再 import 应用 `lib`，且不把纯函数塞进端口 | 新建 `packages/formats`（foundation，零依赖）：`documentFormats.ts`、`modelReasoning.ts`、`mentionSources.ts`、`a2a.ts`（`A2aSettings`）+ `index.ts`；三个纯模块复制到 `packages/formats/src`（与旧文件逐字节相同），`apps/server/src/lib/*` 保留**同名再导出 shim**（`@toonflow/server/*` 路径不变）；agent 改 `@toonflow/formats`；`apps/server/package.json` 增加 workspace 依赖 | P0 | 中高 | 中：新包构建/类型检查链、shim 漂移 |
| **R-06** | 现有 15 步装配由人工纪律维持；三宿主共用 `createApp` | 装配位次固化、三宿主行为一致 | 在 §4 R-06 的步骤表中把"步骤 9.5 注入"写死；保持 9 处入口动态块不变；桌面/移动 `createApp` 不监听、`setRuntimeHost` 先于 `createApp` 的现状不变；A-11 验证数据目录 | P0 | 中 | 中：装配顺序改变引发"路由早于 Host 就绪"或"conf 早求值" |
| **R-07** | web 对 `@toonflow/server/*` 有 38 条静态导入（agent 21、lib 级 13、desktop 4）；导出路径被 3 个宿主复用 | 导出路径冻结，web/桌面/移动零改动 | 14 个 exports 全部保持 target 路径；`lib/{documentFormats,modelReasoning}` 与 `agent/mentionSources` 改为从 formats 再导出；`agent/runtime/types`、`singleAgent/types` 不动；A-14 重跑 web typecheck+build | P1 | 中 | 中：web 独立构建，破坏只在 `build:web` 暴露 |
| **R-08** | agent 经 `mediaGeneration/ai` 取模型目录，底层是 `@toonflow/providers`；`providerSchema/getModelLimits` 被 agent 与服务端共用 | 模型能力单一来源，agent 不绕应用层取模型 | 默认 Q7-A：Host 暴露 `models` 能力，`packages/providers` 的 `exports`/`dependencies` 零改动；不把 `pi-ai` 等重依赖引入 domain 包 | P1 | 中 | 中：若评审改判 Q7-B，需登记 providers 依赖变化并重跑 ai-providers 构建 |
| **R-09** | 地图 glob/计数口径未冻结；第 1 版 `706/706` 与新文件冲突 | 口径冻结、归属迁移可审计、数字可复现 | ① `map.json` 的 glob 集合 = M0 ∪ manifest（3 条新增，无删除/加宽，A-16）；② 归属迁移 manifest：`server-api.files += apps/server/src/{agentHost.ts,agentRuntime.ts}`、`shared-foundation.files += packages/formats/**`；③ 每个副本与 M0 旧文件逐字节相同且旧路径保留 shim；④ 禁止加宽 glob；⑤ 覆盖探针读 `map.json` 重算（A-17/A-18） | P0 | 中 | 中：口径漂移 = 假达标；迁移证据缺失 = 归属失真 |
| **R-10** | 改造面 74 + 24 条边，且在高热链路 | 行为零变化 | 业务等价验证：全仓 typecheck、server build、web build、13 项冒烟逐条断言（§6.4），重点覆盖 NDJSON 事件类型、并发会话、路径越界、i18n、A2A 取消、MCP 网关、单 Agent | P0 | 中 | 高：静态环有时"掩盖"装载顺序缺陷，拆环后暴露新时序问题 |
| **R-11** | AGENTS.md 模块表、dependencies、目录结构、地图子图是评审依据 | 代码与文档同源 | 更新 AGENTS.md：目录结构新增 `agentHost.ts`/`agentRuntime.ts`；模块表 `agentAccess.dependencies` 保持 `["platformCore","pluginMarket"]`；新增步骤 9.5；重算 `map.json` 与 11 个子图，`coverage_ratio = 1.0` | P1 | 低 | 低：漏更新会让下一轮评审以旧数据判定 |
| **R-12** | 任何结构改造都会新增文件；第 1 版未约束，导致"数字随实施漂移" | 新文件与深引可预算、可审计 | 冻结新增代码文件 **8 个**（§6.6 表）：3 个纯迁移副本（`packages/formats/src/{documentFormats,modelReasoning,mentionSources}.ts`）+ 5 个新逻辑（`packages/formats/src/{a2a,index}.ts`、`apps/server/src/agent/host.ts`、`agentHost.ts`、`agentRuntime.ts`）；新增跨模块深引文件 **1 个**（`agentHost.ts`，importer 侧），新增子模块对 **0**；超出即视为范围变更，回评审 | P0 | 低 | 中：预算过紧会逼出妥协实现；过松会让"趋势"失真 |

---

## 4. 需求详述（边界与产出）

### 4.1 R-01 AgentHost 契约（`apps/server/src/agent/host.ts`）

- **只定义契约 + 注册表，不含实现**。契约按 §1.4 的 1–14 组分组，每组一个独立命名空间类型（`workspace`/`settings`/`assets`/`models`/`personalization`/`teams`/`tools`/`skills`/`mcp`/`documents`/`media`/`browser`/`i18n`/`platform`），不得摊平成一个 60 方法的扁平对象。
- **硬边界**：契约内不得出现 `express`、`Request`、`Response`；不得暴露 `conf` 实例；不得出现"预留但未使用"的方法（评审可逐符号驳回）。
- **安全语义逐条写死**：`workspace.*` 必须注明"返回路径/异常与 `modules/localRuntime/workspace/files.ts` 现实现一致；不得放宽 `protectWorkspaceRoot`/`protectWorkspaceLibraryPath`；不得省略 `lockWorkspaceFiles`；不得吞掉 `status: 400/403/409`"。
- **生命周期**：
  - `configureAgentHost(host: AgentHost): void`：全仓只允许 1 次调用（A-09）。
  - `getAgentHost(): AgentHost`：未配置时抛 `new Error("AgentHost 未注入")`，**不得返回兜底实现**（fail-fast）。
  - 模块顶层不得调用 `getAgentHost()`、不得 `const h = getAgentHost()`（A-09 的顶层捕获 = 0）。
- **产出**：契约文件 + 一份"契约符号 → 现实现 `file:line`"对照表（进方案文档，进评审附件）。本阶段 A2P 必须仍是 74（证明"只加不改"）。

### 4.2 R-02 反向收敛与门面（M1 的核心）

**新增门面 `apps/server/src/agentRuntime.ts`**（bootstrap，不 import `@/utils`，避免自环）：

| 说明符 | 形态 | 提供给谁 |
| --- | --- | --- |
| `@/agent` | 值（`export * as agent`） | `utils.ts` 的 `agent` 键；`routes/agent/*` 的 run/session 方法 |
| `@/agent/tools` | 值 | `singleAgent/index.ts`、`mcp/tools.ts` |
| `@/agent/runtime/model` | 值 | `routes/agent.ts`、`routes/agents/a2a/save.ts`、`routes/singleAgent/run.ts`、`singleAgent/index.ts` |
| `@/agent/runtime/prompt` | 值 | `routes/settings/systemPrompt.ts`、`routes/settings/save.ts` |
| `@/agent/runtime/sessions` | 值 | `singleAgent/index.ts` |
| `@/agent/runtime/requests` | 值 | `singleAgent/index.ts` |
| `@/agent/bridge/canvas` | 值 | `utils.ts` 的 `canvas` 键 |
| `@/agent/bridge/question` | 值 | `utils.ts` 的 `question` 键、`singleAgent/index.ts` |
| `@/agent/a2a/settings` | 值 | `utils.ts` 的 `a2aSettings` 键 |
| `@/agent/mentionFiles` | 值 | `utils.ts` 的 `mentionFiles` 键 |
| `@/agent/runtime/types` | **类型**（`export type { AgentEvent }`） | `routes/agent.ts`、`singleAgent/types.ts` |

**消费点改造（同一提交内完成，保证反向只降不升）**：

| 消费方 | 现状 | 目标 |
| --- | --- | --- |
| `utils.ts:19,20,21,33,35` | 5 条 `@/agent` | 1 条 `import * as agentRuntime from "./agentRuntime"`；`agent/canvas/question/a2aSettings/mentionFiles` 5 个键**保持原名**，值改为门面字段；37 键不变 |
| `routes/agent.ts:4,9` | 1 类型 + 1 值 | 类型 `AgentEvent` 从 `@/agentRuntime`；`getAgentModelConfiguration` 从 `u.agentRuntime` |
| `routes/settings/systemPrompt.ts:3` | 1 值 | `defaultSystemPrompt`/`maxSystemPromptLength` 从 `u.agentRuntime` |
| `routes/settings/save.ts:6` | 1 值 | 同上 |
| `routes/agents/a2a/save.ts:8` | 1 值 | `getAgentModelConfiguration` 从 `u.agentRuntime` |
| `routes/singleAgent/run.ts:7` | 1 值 | 同上 |
| `singleAgent/index.ts:7–11` | 5 值 | 从 `@/agentRuntime` 取同名符号 |
| `singleAgent/types.ts:2` | 1 类型 | `AgentEvent` 从 `@/agentRuntime` |
| `mcp/tools.ts:8,9` | 2 值 | 从 `@/agentRuntime` 取 `createAgentTools`/`run` |
| `conf/index.ts:5` | 1 类型 | `A2aSettings` 从 `@toonflow/formats` |
| `agent/a2a/settings.ts:71` | 顶层副作用 | 改为导出的 `registerA2aSettingsWatcher(host)`，由 `configureAgentHost` 调用；取消语义与文案 `A2A 设置已修改，当前任务已取消` 不变 |

> 结果：P2A 从 21 行 / 11 文件降为 **12 静态行（11 值 + 1 类型）/ 2 文件 + 1 动态行 / 1 文件**；`utils.ts`、`routes/**`、`singleAgent`、`mcp/tools`、`conf` 全部归零。**M1 仍残留一个最小环**：`utils.ts → agentRuntime.ts → agent/mentionFiles.ts → utils.ts`（`mentionFiles` 仍 import `@/utils`，属 B3 的 1 条边），因此 file SCC 到 M4 才归零；模块级 `e7`/`e9` 仍在，等 R-04 清零 A2P 后 `e7` 消失。

### 4.3 R-03 Host 实现与注入（`apps/server/src/agentHost.ts` + `app.ts` 步骤 9.5）

- **落点**：`apps/server/src/agentHost.ts`（bootstrap 层，与 `app.ts`/`utils.ts` 同模块）。不得落在 `modules/agentAccess/**`：Host 需要 6 个域的能力，落在子模块会新增 `agentAccess→assetLibrary/mediaGeneration/mcpIntegration/...` 模块对（违反 NG9）。
- **能力组装**：按 §1.4 的 1–14 组，复用 `utils.ts` 已使用的深引文件（`workspace/files`、`conf`、`assets`、`ai`、`personalization`、`teams`、`plugins/tools`、`skills/files`、`mcp/{control,servers}`、`documents`、`media/generation`、`ffmpeg`、`browser`），**只做转发，不重写校验**。新增深引文件仅此 1 个（A-18）。
- **注入实现**：

```ts
// apps/server/src/agentHost.ts（示意，方案阶段细化签名）
import { configureAgentHost } from "@/agent/host";
export function initializeAgentHost(context: ModuleContext) {
  configureAgentHost(createAgentHost(context));
}
```

  `@/agent/host` 是契约叶子：无副作用、只依赖 `@toonflow/formats` 的类型。`agentHost.ts` 静态可达的 agent 文件集合必须**恰好**是 `{apps/server/src/agent/host.ts}`（A-10）。
- **`app.ts` 位次（步骤 9.5）**：

```ts
await media.refreshModels();
await (await import("./agentHost")).initializeAgentHost(context);   // 步骤 9.5
const router = await import("@/router");
router.default(app);
```

  注入行号必须 **大于** `await platform.prepare(context)` 的行号，且 **小于** `await import("@/router")` 的行号（A-10）。不新增入口动态块；`agentAccess.mount` 的 `@/agent/a2a` 动态块保持不变（E4）。
- **不变量**：
  - **I1 无顶层捕获**：agent 内不得有模块顶层 `getAgentHost()` 调用或赋值（A-09）。
  - **I2 注入先于首次使用**：`createApp` 内注入完成于 router 装载之前；所有 Host 消费都发生在请求期或 `mount` 期（A-10）。
  - **I3 fail-fast**：未注入时 `getAgentHost()` 抛固定错误，禁止兜底（A-09）。
- **明确删除**："在任何 agent 代码被求值之前注入"这一表述不再作为需求；可实现且更强的表述是"注入先于**运行时模块**求值，注入时唯一求值的 agent 文件是无副作用的契约叶子"（A-10 的可达性探针）。

### 4.4 R-04 agent 消费点切换（5 批，精确数字）

| 批次 | 内容 | 条数 | 批次后 A2P | 回滚点 |
| --- | --- | --- | --- | --- |
| **B0 纯下沉** | `documentFormats` 5、`modelReasoning` 5+1、`mentionSources` 2 | **13** | 74 → **61** | `git revert` 本批；lib shims 恢复直引 |
| **B1 低风险读取** | `personalization` 3、`teams` 4、`plugins/tools` 2、`skills/files` 1、`documents` 2 | **12** | 61 → **49** | 单批回滚 |
| **B2 模型/媒体/i18n/platform** | `ai` 3 + `ai/files` 1 + `ai/requestFiles` 1、`media/generation` 1、`ffmpeg` 1、`i18n` 8、`platform` 2 | **17** | 49 → **32** | 单批回滚 |
| **B3 安全敏感** | `workspace/files` 12 + `chatImages` 1、`assets` 3 + `roots` 3、`browser` 1、`utils` 1 | **21** | 32 → **11** | 单批回滚；S-07 必跑 |
| **B4 配置/MCP** | `conf` 8、`mcp/control` 2 + `mcp/servers` 1 | **11** | 11 → **0** | 单批回滚 |

**每批硬约束**：
1. 该批结束后 A2P 必须等于表中值（不是"下降即可"）；不等于即失败。
2. 不得新增任何 `@/modules`、`@/lib`、`@/utils` 目标。
3. 不得改变错误 `message`/`status`/`code`；Host 不得包装新错误类型。
4. 每批后跑 S-01/S-05/S-07/S-09（§6.4）；任一失败回滚该批。

**错误语义对照（必须逐条保留）**：`400 文件路径无效`、`403 只能复制普通文件或文件夹`、`409 对话正在运行，请等待回复完成`、`409 画布正在保存，请重试`、`413 个性化文档不能超过 20000 个字符`、`A2A 设置已修改，当前任务已取消`。

### 4.5 R-05 纯契约下沉（`packages/formats`）

| 文件 | 来源 | 内容 | 新位置 |
| --- | --- | --- | --- |
| `documentFormats.ts` | `apps/server/src/lib/documentFormats.ts` | `documentFormats`、`getDocumentMimeType`、`getTextMimeType`、`getReadableFileMimeType`、`getReadableFileExtension`、`decodeTextFile`、`readableFileAccept` | `packages/formats/src/documentFormats.ts`（内容与旧文件相同） |
| `modelReasoning.ts` | `apps/server/src/lib/modelReasoning.ts` | `thinkingLevels`、`defaultThinkingLevels`、`ThinkingLevel`、`ReasoningEfforts` | `packages/formats/src/modelReasoning.ts`（内容与旧文件相同） |
| `mentionSources.ts` | `apps/server/src/lib/mentionSources.ts` | `MentionQuery`、`mentionAssetType` | `packages/formats/src/mentionSources.ts`（内容与旧文件相同） |
| `a2a.ts` | `agent/a2a/settings.ts:11–18` 的类型 | `A2aSettings` | `packages/formats/src/a2a.ts`（新增） |
| `index.ts` | 新增 | 显式再导出上述 4 个模块 | `packages/formats/src/index.ts`（新增） |

- **shim 规则**：`apps/server/src/lib/{documentFormats,modelReasoning,mentionSources}.ts` 保留，内容为显式再导出（不得 `export *` 把 `a2a`/其他模块带出）；`@toonflow/server/{documentFormats,modelReasoning}`、`@toonflow/server/agent/mentionSources` 路径不变（A-14）。
- **依赖方向**：`packages/formats` 零 dependencies、零 imports（除同包内）；foundation 叶子；不得 import `apps/server` 或任何 domain 包。
- **tsconfig/工作区**：`packages/formats/package.json`（`name: @toonflow/formats`、`exports: { ".": "./src/index.ts" }`、`typecheck` 脚本）+ `tsconfig.json`；根 `workspaces: ["packages/*"]` 已覆盖；`apps/server` 增加 `workspace:*` 依赖。

### 4.6 R-06 装配序列（只增不改语义）

| 步骤 | 现状 | 本版 |
| --- | --- | --- |
| 0 | 设置 `TOONFLOW_DATA_DIR` | 不变 |
| 1 | 动态加载 7 个入口（`Promise.all`） | 不变 |
| 2 | 构造 `ModuleContext` | 不变 |
| 3 | `platform.prepare` | 不变 |
| 4–8 | 插件/技能/Agent 目录初始化、`media.initializeProviders`、`assets.warmup` | 不变 |
| 9 | `media.refreshModels` | 不变 |
| **9.5** | — | **新增：`initializeAgentHost(context)`**（Host 创建 + 注入；先于 router） |
| 10 | `await import("@/router")` | 不变 |
| 11 | `mcp.mount` | 不变 |
| 12 | `agentAccess.mount`（E4 动态块） | 不变 |
| 13–15 | 静态资源、错误处理、`local.initializeRuntime` | 不变 |

- 三宿主：桌面 `apps/desktop/src/index.ts:236`、移动 `apps/mobile/src/server.ts:107` 均经 `createApp`，不监听；`setRuntimeHost` 仍在 `createApp` 之前调用。A-11 对三宿主同时成立。
- **禁止**：把 `initializeAgentHost` 挂到某个模块入口的静态面（会让 `Promise.all` 阶段求值 agent 契约以外的代码）；把注入挪到 `agentAccess.mount`（晚于 router，违反 I2）。

### 4.7 R-07 / R-08 契约冻结

- `apps/server/package.json` 的 14 个 exports **target 全部不变**；只允许实现文件内部改来源。
- web 的 38 条导入零改动；`agent/types`、`singleAgent/types`、`agent/mentionSources`、`documentFormats`、`modelReasoning`、`nodeMenu`、`desktop` 的 TS 类型形状不变。
- `packages/providers` 零改动；`server-api → ai-providers` 边保持；agent 通过 Host `models` 取模型目录，不直接 import providers。

### 4.8 R-09 / R-12 口径、归属与预算

- **冻结对象**（A-16）：
  - 模块归属算法（glob → 首命中）与计数正则（P1–P13 内的字面量）不变；
  - `map.json` 的 `modules[].files` glob 集合 = M0 集合 ∪ §6.6 的 3 条新增（2 个文件 + 1 个 glob），删除/改写为 0；
  - §6.5 的 P1–P13 命令文本以本文档为准，实施期不得改写（改写即回评审）。
  - 包归属：若地图工具的包→模块映射需要登记，新增 `@toonflow/formats → shared-foundation` 一行；该行属于 manifest，不计为口径漂移。
- **允许的归属迁移**（A-17/A-18）：
  - `server-api.files += ["apps/server/src/agentHost.ts", "apps/server/src/agentRuntime.ts"]`
  - `shared-foundation.files += ["packages/formats/**"]`
  - 3 个纯模块副本与 M0 旧文件逐字节相同（§6.5 P13 的 `diff` 为空）。
- **禁止的漂移**：加宽 glob（如 `apps/server/src/**`）、把新文件塞进既有 glob 的宽匹配（如放进 `lib/**`）以规避归属登记、改计数正则、改 SCC 边类型（值/类型）。
- **预算**（A-17）：新增代码文件恰好 8 个（5 个新逻辑 + 3 个纯迁移副本）；`files_total = 706 + 8 = 714`；`uncovered = 0`；`coverage_ratio = 1.0`。

---

## 5. 里程碑与精确期望（趋势只在台账，不作验收结论）

> 每一行都是**唯一期望值**；任一分项不等于表中值即失败（不允许"下降即可"）。

| 里程碑 | 内容 | A2P 别名/相对/合计/值 | P2A 源静态值/型/动态 | P2A 包契约 | P2A 文件数 | file SCC 总/含 agent | `e7` | 交付门 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **M0** | 基线冻结（本轮，不改代码） | 71 / 3 / 74 / 68 | 17 / 3 / 1 | 3 | 11 | 3 / 1 | 存在 | 台账 L01–L18 |
| **M1** | 契约 + 门面 + Host 实现 + 步骤 9.5 注入 + 反向收敛（R-01/R-02/R-03） | **71 / 3 / 74 / 68** | **11 / 1 / 1** | 3 | **3** | **3 / 1** | 存在 | typecheck + build + S-01/S-05/S-07/S-09 + S-13 |
| **M2** | B0 纯下沉（R-05） | **61 / 0 / 61 / 60** | 11 / 1 / 1 | 3 | 3 | 3 / 1 | 存在 | 单批回归 |
| **M3** | B1 + B2（R-04） | **32 / 0 / 32 / 31** | 11 / 1 / 1 | 3 | 3 | 3 / 1 | 存在 | 单批回归 |
| **M4** | B3 + B4（R-04） | **0 / 0 / 0 / 0** | 11 / 1 / 1 | 3 | 3 | 2 / 0 | **不存在** | S-07、S-09、S-10 重点 |
| **M5** | 文档、地图、AGENTS、全量判据（R-06/R-07/R-08/R-09/R-11/R-12） | 0 / 0 / 0 / 0 | 11 / 1 / 1 | 3 | 3 | 2 / 0 | 不存在 | A-01～A-20 全 PASS |

> M1 的 A2P **必须仍是 74**：证明"只加不改、反向先收敛"；M2 起 A2P 严格下降且每批等于表中值。M1–M3 的 file SCC 仍为 `3 / 1`，残留的最小环是 `utils.ts → agentRuntime.ts → agent/mentionFiles.ts → utils.ts`（`mentionFiles` 的 `@/utils` 边要到 B3 才移除）；M4 才变 `2 / 0`。**模块级 `e7` 仍在**（agent 仍 import 应用），SCC 与 `e7` 都由 A-08 判定，与 A-09（注入唯一）不混淆。

---

## 6. 验收标准

### 6.1 二值判定表（A-01～A-20）

| 编号 | 判据 | 探针 | 期望（唯一值 / 精确集合） | 正控制（防空转） |
| --- | --- | --- | --- | --- |
| **A-01** | agent→应用 别名边 = 0 | P1 | `0` | M0 快照 `71`（P1 在 `git show 89572b5:apps/server/src/agent` 上 >0） |
| **A-02** | agent→应用 相对逃逸边 = 0 | P2 | `0` | M0 `3` |
| **A-03** | agent→应用 合计 = 0 且值边 = 0 | P1+P2 双算 | `0 / 0` | M0 `74 / 68` |
| **A-04** | P2A 文件集合 = 装配面 | P3a | 精确等于 `{apps/server/src/agentRuntime.ts, apps/server/src/agentHost.ts, apps/server/src/modules/agentAccess/index.ts}` | M0 `11` 文件；M5 集合非空（3） |
| **A-05** | P2A 说明符集合 = 枚举 13 行（静态值 11 + 静态类型 1 + 动态 1） | P3b | 精确等于 §6.5 P3b 的 13 行枚举；`静态值=11, 静态类型=1, 动态=1` | 同正则 M0 `21` 行 |
| **A-06** | P2A 包契约 = 3 | P4 | `3`（`modules/platformCore/conf/index.ts`、`modules/pluginMarket/teams/files.ts`、`routes/agents/connect.ts` 各 1） | 同正则 M0 `3`；文件非空 |
| **A-07** | `utils.ts` 不再聚合 agent；出口键不变 | P5 | `@/agent` 行 = `0`；默认导出键 = `37` | M0 `5` 行 / `37` 键 |
| **A-08** | file SCC：含 agent = 0；总数 = 2；地图 `e7` = 0 | P6 | `scc_total=2, agent_scc=0, e7=0` | M0 `3 / 1 / 1` |
| **A-09** | 注入唯一且 fail-fast | P7 | `export function configureAgentHost` = `1`；`configureAgentHost(createAgentHost` = `1`；`export function initializeAgentHost` = `1`；`app.ts` 内 `initializeAgentHost(` = `1`；顶层捕获 = `0`；`AgentHost 未注入` 文案 = `1` | M0 两个函数均不存在（G-EXIST 先判存在）；S-13 实测抛错 |
| **A-10** | 注入时序可实现 | P8 | ① `注入行号 < await import("@/router") 行号` 且 `> await platform.prepare(context) 行号`；② `agentHost.ts` 静态可达 agent 文件集合 = **恰好** `{apps/server/src/agent/host.ts}`；③ `app.ts` 静态可达 agent = `0` | M0：`agentHost.ts` 不存在（G-EXIST 先判存在）；`app.ts` 静态可达 agent = `0` 且 `router import` 存在 |
| **A-11** | 数据目录时序不变 | P9 | ① 临时目录出现 `settings.json`；② 仓库 `data/settings.json` 的 `md5` 与 `mtime` 前后相等；③ 日志出现 `[服务启动成功]` | M0 同命令应通过（基线行为） |
| **A-12** | 全仓类型检查通过 | `bun run typecheck`（根） | 退出码 `0` | M0 同命令 `0` |
| **A-13** | 构建通过 | `bun run build` | 退出码 `0`，产物可启动 | M0 同命令 `0` |
| **A-14** | web / 宿主契约未破坏 | P10 | `apps/web` `typecheck` + `build` 退出码 `0`；`apps/server/package.json` 的 14 个 exports target 与 M0 逐字相等 | M0 快照比对 |
| **A-15** | 13 项冒烟逐条通过 | §6.4 | `13/13` | 每条给出明确状态码/事件/文案，不写"一致" |
| **A-16** | 计数口径未漂移 | P11 | `map.json` 的 glob 集合 = M0 glob 集合 ∪ §6.6 manifest（3 条新增：2 个文件 + 1 个 glob）；删除 = 0、改写 = 0；§6.5 P1–P13 命令文本与本文档逐字一致 | M0 基线 glob 快照；新增集合非空 |
| **A-17** | 归属覆盖与文件预算 | P12 | `uncovered = 0`；`files_total = 714`；新增代码文件集合**恰好**等于 §6.6 的 8 个路径 | M0 `706 / 0`；新增集合非空 |
| **A-18** | 归属迁移与深引登记 | P13 | ① 3 个纯模块副本与 M0 旧文件逐字节相同（`diff` 空）；② 旧路径仍存在且为再导出 shim；③ 新增跨模块深引文件 = `1`（**importer 侧**定义：某文件 import 另一子模块的非入口文件；`apps/server/src/agentHost.ts` 是唯一新增者）；④ 新增 source→target 子模块对 = `0` | M0 旧文件存在（3/3）；M5 副本存在且 `diff` 空 |
| **A-19** | 未新增测试/自检/CI | `git status --porcelain` 过滤 | 命中 `0`：`.test.ts`、`.spec.ts`、`scripts/check*`、`check*.ts`、`package.json` 新增 test/check 脚本 | 过滤命令对 M0 命中 `0` |
| **A-20** | 文档与依赖表同源 | §6.8 逐行比对 | AGENTS.md 模块表 8 行 `dependencies` 精确等于 §6.8 表；`agentAccess.dependencies = ["platformCore","pluginMarket"]`；目录结构包含两个新 bootstrap 文件与步骤 9.5 | 直接字符串比对（含空格） |

### 6.2 判定规则（消除"不可唯一判定"）

1. **只有 PASS / FAIL**：任何"基本通过""趋势良好""可接受"都不成立。
2. **期望必须是整数或精确集合**：表内不得出现 `≤`、`≥`、`约`、`区间`、`只降不升`、`趋势`。豁免的绝对上界只允许作为**台账参考**，不进入 A 表。
3. **双算一致**（G3）：A-01～A-06、A-08、A-17 的每个数字必须由 `grep` 与 Python 解析各算一次，两次相等才 PASS；不相等判 FAIL（说明口径有歧义）。
4. **不可达即回评审**：实施中若发现某期望不可达（例如新文件导致 `files_total` 不是 714），**不得就地放宽**；必须回需求评审修订本表并重新出号。
5. **冲突优先级**：A 表内部若出现互相矛盾，以"更严 + 更具体"者为准，且必须在同一轮内改写另一条；不允许留两条同时成立。
6. **豁免前置**：任何未在 §8 登记的边/文件，一律计入判据分子；登记项必须给出"为何不能消除 / 代价 / 复核方式 / 复核人"。
7. **相位**：所有 A 项在 M5 判定；M0 只做正控制与基线记录。M1–M4 用 §5 的里程碑门，不替代 A 项。

### 6.3 趋势的落地（不参与验收）

- 每个里程碑按 §6.5 探针记录 L01–L18 一行，共 6 行；
- "趋势可验证" = 6 行台账的每个分项**等于 §5 的表中值**；不等于即失败；
- 评审人可独立重跑 P1–P13 复算任意一行；台账不写入仓库脚本（C4）。

### 6.4 冒烟矩阵（13 项，逐条二值）

> 固定 fixture：`directory=<tmp-workspace>`（含 `AGENTS.md`）、`providerId/modelId` 指向测试供应商。所有断言只看**稳定可观察量**，不看模型正文。

| # | 场景 | 入口 | 二值断言 |
| --- | --- | --- | --- |
| **S-01** | Agent 流式文本 | `POST /api/agent` | HTTP `200` + `Content-Type: application/x-ndjson`；首事件 `type=session`；包含 `userMessage`；末事件 `type=done`；无 `type=error` |
| **S-02** | 附件 + 提及 | `POST /api/agent`（`attachments`/`mentions`） | 同 S-01；超限附件返回 `type=error` 且文案含 `不支持此附件格式` 或 `文本引用最多支持 100000 个字符` |
| **S-03** | 并发会话 | 同 `sessionFile` 并发两次 | 第二次的 NDJSON 出现 `type=error` 且 `message` 精确等于 `对话正在运行，请等待回复完成`；随后 `done` |
| **S-04** | 压缩/回退/分叉/回答/画布结果 | `/api/agent/{compact,rewind,fork,answer,canvasResult}` | 各自 HTTP `200` 且响应 `code=200`；压缩并发时 `409` + `对话正在运行，请先停止后再压缩`；回退并发时 `409` + `对话正在运行，请先停止后再回退` |
| **S-05** | A2A 配置变更取消在跑任务 | `PUT /api/settings/save` 改 `a2a` | 在跑任务收到取消，错误文案精确 `A2A 设置已修改，当前任务已取消`；`/a2a` token 校验仍返回 `401`（无 token） |
| **S-06** | A2A JSON-RPC | `/a2a` | 无 token `401`；带错误 token `401`；合法 token + 未知方法返回 JSON-RPC `-32601` |
| **S-07** | 工作区越界与文件锁 | `/api/workspaces/files/*` 越界路径 | HTTP `400` 且 `message=文件路径无效`；越界符号链接 `403` |
| **S-08** | 素材提及源 | `/api/agent/mentionSource`、`/api/assets/*` | HTTP `200`；分页字段 `cursor/limit` 存在；`dataType` ∈ `{IMAGE,VIDEO,AUDIO,FILE,STRING}` |
| **S-09** | MCP 网关运行 Agent | `/mcp` `tools/list` + 调用 | `tools/list` HTTP `200`，`result.tools` 非空且 **与 M0 采集的工具名排序列表逐项相等**；调用返回 `result.content` 数组 |
| **S-10** | 单 Agent 运行 | `/api/singleAgent/*` | 启动 `200`；暂停/恢复状态机 `status` 依次为 `running → paused → running`；工具回调返回 `200` |
| **S-11** | 技能与团队 | `/api/skills`、`/api/agents` | HTTP `200`；`data` 数组长度与 M0 采集值相等（同一 fixture） |
| **S-12** | i18n | `Accept-Language: en-US` + 触发 Agent 附件错误 | `type=error` 的 `message` 与 `zh-CN` 下**不相等**且为英文；`zh-CN` 下精确等于 `不支持此附件格式` |
| **S-13** | 三宿主装配 + fail-fast | 桌面/移动 `createApp`（不监听）；未注入时直接 `getAgentHost()` | `createApp` resolve；数据目录正确；直接调用 `getAgentHost()`（临时 heredoc）抛出 `AgentHost 未注入` |

> S-09/S-11 的"M0 采集值"在 M0 用同一 fixture 采一次并写入台账，M5 比对；这是**精确集合相等**，不是"看起来一致"。

### 6.5 探针（P1–P13，可直接粘贴；脚本经 heredoc 到 `/tmp`，执行后删除）

```bash
# P1 agent→应用（别名口径；地图 e7 对账用）
grep -rn --include='*.ts' -E "from ['\"]@/(modules|lib|utils|routes|types|app|router|core)" apps/server/src/agent | wc -l
# M0=71  M5=0

# P2 agent→应用（相对逃逸）
grep -rn --include='*.ts' -E "from ['\"]\.\./(\.\./)?(lib|modules|utils)" apps/server/src/agent | wc -l
# M0=3   M5=0

# P3a 反向文件集合（A-04）
grep -rlE --include='*.ts' '@/agent(/|[^A-Za-z])' apps/server/src --exclude-dir=agent | sort
# M0=11 文件；M5 精确等于 3 个枚举文件（见 A-04）

# P3b 反向说明符集合（A-05）
grep -rnE --include='*.ts' '@/agent(/|[^A-Za-z])' apps/server/src --exclude-dir=agent
# M0=21 行（静态值 17 / 静态类型 3 / 动态 1）
# M5=13 行，精确枚举：
#   agentRuntime.ts:  @/agent, @/agent/tools, @/agent/runtime/model, @/agent/runtime/prompt,
#                     @/agent/runtime/sessions, @/agent/runtime/requests, @/agent/bridge/canvas,
#                     @/agent/bridge/question, @/agent/a2a/settings, @/agent/mentionFiles,
#                     @/agent/runtime/types(type)
#   agentHost.ts:     @/agent/host
#   agentAccess/index.ts:  @/agent/a2a（动态）
# 分类计数必须为 静态值 11 / 静态类型 1 / 动态 1

# P4 包契约（A-06）
grep -rn --include='*.ts' "@toonflow/teams-scaffold" apps/server/src --exclude-dir=agent | wc -l
# M0=3  M5=3

# P5 utils（A-07）
grep -cE '@/agent(/|[^A-Za-z])' apps/server/src/utils.ts           # M0=5  M5=0
python3 - <<'PY'
import re
t=open('apps/server/src/utils.ts',encoding='utf-8').read()
body=t.split('export default {',1)[1]
print(len(re.findall(r'^\s{2}[A-Za-z_$][\w$]*,\s*$',body,re.M)))  # M0=37 M5=37
PY

# P6 file SCC（A-08；值边）
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
# M0: scc_total 3 agent_scc 1    M5: scc_total 2 agent_scc 0

# P6b 地图边 e7（A-08）
python3 - <<'PY'
import json
m=json.load(open('.easyvibe/map/map.json'))
print(sum(1 for e in m['edges'] if e['from']=='agent-runtime' and e['to']=='server-api'))
PY
# M0=1  M5=0（重算后的 map.json）

# P7 注入唯一（A-09）
grep -c "export function configureAgentHost" apps/server/src/agent/host.ts                  # 1
grep -rn "configureAgentHost(createAgentHost" apps/server/src --include='*.ts' | wc -l       # 1
grep -c "export function initializeAgentHost" apps/server/src/agentHost.ts                   # 1
grep -n "initializeAgentHost(" apps/server/src/app.ts | wc -l                                # 1
grep -rnE '^\s*(export\s+)?(const|let|var)\s+\w+\s*=\s*getAgentHost\(' apps/server/src/agent | wc -l  # 0
grep -c "AgentHost 未注入" apps/server/src/agent/host.ts                                     # 1
```

> **P7 的口径**：六行分别对应 A-09 的六个子项；不把"定义 + 调用"合并成一个模糊的 `configureAgentHost(` 计数。

```bash
# P8 注入时序（A-10）
python3 - <<'PY'
import re
t=open('apps/server/src/app.ts',encoding='utf-8').read().splitlines()
def idx(pat):
    for i,l in enumerate(t,1):
        if re.search(pat,l): return i
    return -1
print("prepare",idx(r'platform\.prepare\('))
print("inject",idx(r'initializeAgentHost\('))
print("router",idx(r'await import\("@/router"\)'))
PY
# 期望：prepare < inject < router

python3 - <<'PY'
import os,re
SRC="apps/server/src"
def res(s,c):
    if s.startswith("@/"): p=os.path.join(SRC,s[2:])
    elif s.startswith("."): p=os.path.normpath(os.path.join(os.path.dirname(c),s))
    else: return None
    for q in (p+".ts",os.path.join(p,"index.ts")):
        if os.path.isfile(q): return q
def edges(f):
    t=open(f,encoding="utf-8").read(); out=set()
    for m in re.finditer(r"""^\s*(?:import|export)\s+(?:type\s+)?(?:[^'"]*?)from\s*['"]([^'"]+)['"]""",t,re.M):
        if re.match(r"^\s*(?:import|export)\s+type\b",m.group(0)): continue
        q=res(m.group(1),f)
        if q: out.add(q)
    return out
start=os.path.join(SRC,"agentHost.ts"); seen={start}; st=[start]; hit=set()
while st:
    v=st.pop()
    for w in edges(v):
        if w not in seen:
            seen.add(w); st.append(w)
            if os.path.relpath(w,SRC).startswith("agent/"): hit.add(os.path.relpath(w,SRC))
print("static_agent_reachable",sorted(hit))
PY
# 期望：['agent/host.ts']

# P9 数据目录（A-11）
TMP=$(mktemp -d); BEFORE=$(md5 -q data/settings.json 2>/dev/null || md5sum data/settings.json | cut -d' ' -f1); BT=$(stat -f %m data/settings.json 2>/dev/null || stat -c %Y data/settings.json)
TOONFLOW_DATA_DIR="$TMP" TOONFLOW_SERVER_PORT=3999 bun run start:server > /tmp/start.log 2>&1 &
PID=$!; for i in $(seq 1 60); do grep -q "\[服务启动成功\]" /tmp/start.log && break; sleep 1; done
grep -q "\[服务启动成功\]" /tmp/start.log && echo START_OK; test -f "$TMP/settings.json" && echo CONF_OK
kill $PID; wait $PID 2>/dev/null
AFTER=$(md5 -q data/settings.json 2>/dev/null || md5sum data/settings.json | cut -d' ' -f1); AT=$(stat -f %m data/settings.json 2>/dev/null || stat -c %Y data/settings.json)
[ "$BEFORE" = "$AFTER" ] && [ "$BT" = "$AT" ] && echo REPO_DATA_UNCHANGED
# 期望：START_OK / CONF_OK / REPO_DATA_UNCHANGED 三行齐全

# P10 web 与 exports（A-14）
(cd apps/web && bun run typecheck && bun run build); echo "web_exit=$?"
node -e "const p=require('./apps/server/package.json'); console.log(Object.entries(p.exports).sort().map(([k,v])=>k+'='+v).join('\n'))"

# P11 口径冻结（A-16）
python3 - <<'PY'
import json,subprocess
now=json.load(open('.easyvibe/map/map.json'))
base=json.loads(subprocess.run(["git","show","89572b5:.easyvibe/map/map.json"],capture_output=True,text=True).stdout)
def globs(m): return {mo['id']: set(mo['files']) for mo in m['modules']}
g0,g1=globs(base),globs(now)
delta={k:(sorted(g1.get(k,set())-g0.get(k,set())), sorted(g0.get(k,set())-g1.get(k,set()))) for k in set(g0)|set(g1)}
print({k:v for k,v in delta.items() if v!=([],[])})
PY
# 期望：新增恰好 3 条（server-api 2 个文件 + shared-foundation 1 个 glob）；删除 0 条；改写 0 条

# P12 覆盖与文件预算（A-17）
python3 - <<'PY'
import json,os,re
ROOT=os.getcwd()
CODE={".ts",".tsx",".js",".jsx",".mjs",".cjs",".mts",".cts",".vue",".sql",".ets",".java",".kt",".kts",".cs",".cpp",".h",".hpp",".m",".mm"}
SKIP={"node_modules","dist","build",".git",".easyvibe",".hutch","__pycache__",".cottontail-tmp"}
files=[]
for base,dirs,fs in os.walk(ROOT):
    dirs[:]=[d for d in dirs if d not in SKIP and not d.startswith(".git")]
    for n in fs:
        if os.path.splitext(n)[1] in CODE: files.append(os.path.relpath(os.path.join(base,n),ROOT).replace(os.sep,"/"))
m=json.load(open('.easyvibe/map/map.json'))
def rx(p):
    i,n,res=0,len(p),""
    while i<n:
        c=p[i]
        if c=="*":
            if p[i:i+3]=="**/": res+="(?:.*/)?"; i+=3; continue
            if p[i:i+2]=="**": res+=".*"; i+=2; continue
            res+="[^/]*"
        elif c=="?": res+="[^/]"
        else: res+=re.escape(c)
        i+=1
    return re.compile("^"+res+"$")
pats=[(mo['id'],rx(g)) for mo in m['modules'] for g in mo['files']]
un=[f for f in files if not any(r.match(f) for _,r in pats)]
print("files",len(files),"uncovered",len(un)); print(un[:10])
PY
# M0: files 706 uncovered 0    M5: files 714 uncovered 0

# P13 归属迁移与深引（A-18）
for f in documentFormats modelReasoning mentionSources; do
  git show 89572b5:apps/server/src/lib/$f.ts | diff - packages/formats/src/$f.ts >/dev/null && echo "$f IDENTICAL"
  head -1 apps/server/src/lib/$f.ts
done
# 期望：3 个 IDENTICAL；3 个 shim 首行含 @toonflow/formats

# 新增深引文件：8 个新增文件中出现 `@/modules` 的集合必须恰好是 {agentHost.ts}
for f in packages/formats/src/documentFormats.ts packages/formats/src/modelReasoning.ts packages/formats/src/mentionSources.ts \
         packages/formats/src/a2a.ts packages/formats/src/index.ts apps/server/src/agent/host.ts \
         apps/server/src/agentHost.ts apps/server/src/agentRuntime.ts; do
  grep -q 'from "@/modules' "$f" && echo "DEEP $f"
done
# 期望：只输出 DEEP apps/server/src/agentHost.ts

# 新增 source→target 子模块对 = 0：agentHost 的 7 个目标在 M0 已由 utils/routes 引入
for m in assetLibrary mediaGeneration pluginMarket mcpIntegration localRuntime agentAccess platformCore; do
  n=$(git grep -l "@/modules/$m" 89572b5 -- apps/server/src/utils.ts apps/server/src/routes | wc -l | tr -d ' ')
  [ "$n" -gt 0 ] && echo "$m EXISTING"
done
# 期望：7 行 EXISTING（无新增子模块对）
```

### 6.6 口径漂移 vs 归属迁移（可判定定义）

| 判定 | 条件 | 结论 |
| --- | --- | --- |
| **归属迁移（允许）** | ① 3 个纯模块副本与 M0 旧文件逐字节相同；② 旧路径保留再导出 shim；③ `modules[].files` 的差异**恰好**是：`server-api += ["apps/server/src/agentHost.ts","apps/server/src/agentRuntime.ts"]`、`shared-foundation += ["packages/formats/**"]`；④ `uncovered = 0`；⑤ `files_total = 714` | A-16/A-17/A-18 PASS |
| **口径漂移（失败）** | ① 归因算法或计数正则变化；② glob 加宽（`apps/server/src/**`、`packages/**` 等）；③ 文件归属变化但无内容相同证据；④ 把新文件塞进既有宽 glob（如 `lib/**`）规避登记；⑤ 改 SCC 的边类型（值/类型）让环消失 | 直接 FAIL，无论其他项 |

**8 个新增代码文件（A-17 的唯一集合；多一个/少一个均 FAIL）**：

| # | 路径 | 性质 |
| --- | --- | --- |
| 1 | `packages/formats/src/documentFormats.ts` | 纯迁移副本（与 `89572b5:apps/server/src/lib/documentFormats.ts` 逐字节相同） |
| 2 | `packages/formats/src/modelReasoning.ts` | 纯迁移副本（同上） |
| 3 | `packages/formats/src/mentionSources.ts` | 纯迁移副本（同上） |
| 4 | `packages/formats/src/a2a.ts` | 新逻辑（`A2aSettings` 类型，来自 `agent/a2a/settings.ts:11–18`） |
| 5 | `packages/formats/src/index.ts` | 新逻辑（显式再导出 1–4） |
| 6 | `apps/server/src/agent/host.ts` | 新逻辑（AgentHost 契约 + 注册表） |
| 7 | `apps/server/src/agentHost.ts` | 新逻辑（Host 实现 + 注入） |
| 8 | `apps/server/src/agentRuntime.ts` | 新逻辑（唯一反向门面） |

> 3 个 shim（`apps/server/src/lib/{documentFormats,modelReasoning,mentionSources}.ts`）**不是新增文件**：它们原本就存在，只改内容为再导出。`packages/formats/package.json`、`tsconfig.json` 不是代码扩展名，不计入 `files_total`。

### 6.7 探针守卫（G 系列）

| 守卫 | 内容 | 判定 |
| --- | --- | --- |
| **G1 正控制** | 每个期望 0 的 grep，必须在 M0 快照（`git show 89572b5:…` 或 M0 记录值）上 >0 | 否则 FAIL（空搜索） |
| **G2 存在性** | 判据引用的文件/符号必须存在（`test -f`、`grep -q`） | 不存在即 FAIL，不得判"无异常" |
| **G3 双算** | 计数类判据用 `grep` 与 Python 各算一次 | 不等即 FAIL |
| **G4 精确集合** | A-04/A-05/A-06/A-17/A-18 用集合相等，不用子集/上界 | 多一个或少一个都 FAIL |

### 6.8 AGENTS.md `dependencies` 期望表（A-20 的唯一对象）

| 模块 | 期望 `dependencies`（精确字符串） |
| --- | --- |
| `bootstrap` | 全部 7 个入口（组合契约，不算域边） |
| `assetLibrary` | `["localRuntime","mediaGeneration","platformCore"]` |
| `mediaGeneration` | `["localRuntime","platformCore"]` |
| `pluginMarket` | `["localRuntime","mediaGeneration","platformCore"]` |
| `mcpIntegration` | `["localRuntime","mediaGeneration","platformCore","pluginMarket"]` |
| `localRuntime` | `["platformCore"]` |
| **`agentAccess`** | **`["platformCore","pluginMarket"]`**（**不新增** `agent-runtime`；Host 由 bootstrap 注入） |
| `platformCore` | `["localRuntime"]` |

### 6.9 数值台账（L01–L18；记录用，不参与验收）

| 编号 | 指标 | 口径 | M0 | M5 |
| --- | --- | --- | --- | --- |
| L01 | A2P 别名 | P1 | 71 | 0 |
| L02 | A2P 相对 | P2 | 3 | 0 |
| L03 | A2P 合计 | P1+P2 | 74 | 0 |
| L04 | A2P 值 | P1+P2 去 type | 68 | 0 |
| L05 | P2A 源静态值 | P3b | 17 | 11 |
| L06 | P2A 源静态类型 | P3b | 3 | 1 |
| L07 | P2A 源动态 | P3b | 1 | 1 |
| L08 | P2A 包契约 | P4 | 3 | 3 |
| L09 | P2A 合计 | L05+L06+L07+L08 | 24 | 16 |
| L10 | P2A 文件数 | P3a | 11 | 3 |
| L11 | `@/utils` 扇入文件数 | P5 | 145 | ≤145（只降不升，仅记录） |
| L12 | `utils.ts` 默认导出键 | P5 | 37 | 37 |
| L13 | file SCC 总/含 agent | P6 | 3 / 1 | 2 / 0 |
| L14 | agent 文件/行 | `find/wc` | 29 / 4,032 | 30 / +契约行 |
| L15 | `apps/server/src` 文件/行 | `find/wc` | 272 / 18,546 | 274 / +装配行 |
| L16 | 地图覆盖 files/uncovered | P12 | 706 / 0 | 714 / 0 |
| L17 | web `@toonflow/server/*` 导入 | `grep` | 38 | 38 |
| L18 | 地图 `e7` 计数 | P6b | 1 | 0 |

> L11/L14/L15 仅作趋势参考，不作为否决项；L01–L10、L13、L16、L18 的 M5 值必须精确相等（A 表已逐条判定）。

---

## 7. 风险登记

| 编号 | 风险 | 概率/影响 | 触发条件 | 缓解 |
| --- | --- | --- | --- | --- |
| **RK-01** | `conf` 早求值 → 三宿主数据目录静默降级 | 中/高 | `agentHost.ts` 或其静态依赖在 `TOONFLOW_DATA_DIR` 之前被求值 | 注入在 `createApp` 步骤 9.5（数据目录已设且 `platform.prepare` 已跑）；A-11 探针 |
| **RK-02** | 文件锁/路径授权语义丢失（安全） | 中/高 | Host 实现"顺手简化"了 `protectWorkspaceRoot`/`lockWorkspaceFiles` | Host 只转发不重写；R-01 逐符号对照表；A-15 S-07 |
| **RK-03** | 请求语言上下文丢失 | 中/中 | 把 `t()` 变为注入函数并在模块顶层缓存 locale | Host 只转发 `lib/i18n` 的调用，不持有 locale；A-15 S-12 |
| **RK-04** | 事件/协议漂移 | 低/高 | 迁移时调整 `AgentEvent` 字段或 `send` 时序 | 类型只搬不改；A-15 S-01/S-04 |
| **RK-05** | 启动早期路由不可用 | 中/中 | 注入晚于 router，或 `mount` 早于 Host | 步骤 9.5；A-10 行序；A-15 S-05/S-06/S-09 |
| **RK-06** | 端口成为新上帝对象 | 中/中 | 14 组摊平为一个扁平对象 | 分组类型；R-01 边界；评审可逐符号驳回 |
| **RK-07** | 假切断 | 中/高 | Host 实现放回 agent 内；或 agent 保留 re-export 中间层 | A-01/A-02 + A-10 可达性 + A-18 深引清单 |
| **RK-08** | 口径漂移（改 glob/归属让边消失） | 中/中 | 为达标加宽 glob 或改正则 | A-16/A-17/A-18；§6.6 判定表 |
| **RK-09** | web/桌面/移动连带破坏 | 中/中 | 迁移 `lib/*` 或 `@toonflow/server/*` 导出 | 导出路径冻结（A-14）；全仓 typecheck + web build |
| **RK-10** | 大 diff 不可评审 | 高/中 | 一次性改完 74 条边 | M1 只做反向收敛；B0–B4 五批独立提交、独立回归、独立回滚 |
| **RK-11** | 静态环掩盖的时序缺陷被暴露 | 中/中 | 拆环后初始化顺序变化 | 每批后 S-01/S-05/S-07/S-09；失败回滚该批 |
| **RK-12** | 新包 `packages/formats` 的构建/类型链断裂 | 中/中 | 未加 workspace 依赖或 typecheck 脚本 | R-05 的 package.json/tsconfig 清单；A-12/A-13 |
| **RK-13** | `agentHost.ts` 新增深引被判定为"新模块对" | 低/中 | Host 落在 `agentAccess` 而非 bootstrap | 明确落 bootstrap；A-18 判"新增模块对 = 0" |

---

## 8. 候选豁免（无法在不扩大范围的前提下消除）

| 编号 | 内容 | 条数 | 理由 | 复核方式 |
| --- | --- | --- | --- | --- |
| **E1** | `conf` 进程级单例 | 1 | 全仓唯一配置实例，属既有设计 | Host 只转发，不替换单例；A-12/A-13 + S-05 |
| **E2** | i18n `AsyncLocalStorage` 全局态 | 1 | 请求域语言分发机制 | Host 不持有 locale；A-15 S-12 |
| **E3** | 应用层内部 2 个 SCC（`pluginMarket` 3 文件、`mcpIntegration` 2 文件） | 2 个 SCC | 与 agent 无关（`c-arch-4`/NG4） | A-08 只判 `agent_scc` 与总数 2 |
| **E4** | `modules/agentAccess/index.ts:6` 的动态 `import("@/agent/a2a")` | 1 | AGENTS.md 冻结的 9 处动态块之一 | 计入 A-05 的"动态 1"；不得新增动态块 |
| **E5** | `@toonflow/teams-scaffold` 3 条包契约 | 3 | 该包按地图归属 `agent-runtime`；移动归集会构成 NG6 | A-06 恒为 3 |
| **E6** | `agentHost.ts` 新增跨模块深引文件（importer 侧） | 1 | bootstrap → 各子模块是已声明关系（`dependencies = 全部 7 个入口`），不新增子模块对；`agentRuntime.ts` 只是被 agentAccess/mcpIntegration 引用的**目标**，其 importer 已存在且已有 bootstrap 深引 | A-18 判"新增深引文件 = 1、新增子模块对 = 0" |
| **E7** | `agentRuntime.ts` 作为唯一反向门面（11 行） | 11 | 这是"应用→agent 单向装配"的**设计方向**，不是环 | A-04/A-05 的精确集合 |
| **E8** | `utils.ts` 仍被 145 个文件引用 | 145 | 本需求只去掉其中的 agent 聚合，不动聚合模式 | A-07；L11 只记录 |
| **E9** | `packages/teams`、`packages/skills` 运行期读盘 | — | 插件化能力，运行期必需 | 经 Host 的 teams/skills 能力访问 |
| **E10** | web 的 38 条 `@toonflow/server/*` 静态导入 | 38 | 冻结导出路径，属 `c-arch-3` 独立治理 | A-14 构建通过且 exports 不变 |
| **E11** | Host 的 `i18n`/`platform` 两组转发 | 10 | 有进程态/请求上下文，不适合下沉为纯函数 | R-01 分组；A-01 |
| **E12** | 新 foundation 包 `packages/formats` | 1 包 | 纯契约下沉的唯一干净落点；归属迁移而非新模块层 | §6.6；A-16/A-17 |

> 豁免规则：新增豁免必须写明"为何无法消除""代价是什么""何时重新评估"；评审未通过的豁免不计入 A 表分子。

---

## 9. 待评审决策点（Q1–Q10，均有默认值）

| 编号 | 问题 | 选项 | 默认建议 | 默认值与验收的一致性 |
| --- | --- | --- | --- | --- |
| **Q1** | 契约放哪里？ | A `apps/server/src/agent/host.ts`；B 新合同包；C 扩展 `toolScaffold` | **A** | A 已被 `agent/**` glob 覆盖，无新增 glob；`agentHost.ts` 的 `@/agent/host` 1 行计入 A-05 |
| **Q2** | 如何创建与注入？ | A bootstrap `agentHost.ts` + 模块级注册表；B 每次 `run(options, send, host)` 传参；C 扩 `ModuleContext` | **A** | A 满足 C1/C2/C3；B 改动 74 处调用面；C 会把 Express 语义带进领域 |
| **Q3** | 23 条 lib/相对边怎么处理？ | A 全端口化；B 全下沉；C 分治 | **C** | 纯契约下沉 13 条 → `packages/formats`（manifest 已枚举）；`i18n`/`platform` 10 条进 Host。A 会引入 ALS 陷阱；B 会让 `t()` 过包边界 |
| **Q4** | 反向边允许形态？ | A 唯一门面 + 类型再导出；B 反向也归零（全动态） | **A** | B 与"app.ts 单向装配 agent"矛盾，且会让 13 个调用点变异步 |
| **Q5** | 计数口径？ | A 解析口径（含相对，74/24）；B 仅别名（71/24）；C 仅值边 | **A**，同时记录 B 用于地图对账 | A 与 A-01～A-06 一致 |
| **Q6** | 是否同步迁移 web 契约？ | A 冻结导出路径；B 抽 contracts 包并改 web | **A** | B 会破坏 A-14 的 38 条零改动 |
| **Q7** | 模型契约是否下沉 `ai-providers`？ | A Host 暴露 models；B 纯函数下沉 | **A** | B 会给 domain 包引入重依赖，且改 `providers` exports（违反 NG8） |
| **Q8** | 实施粒度？ | A 5 批（B0–B4）；B 一次性 | **A** | A 与 §5 的精确数字一一对应 |
| **Q9** | 应用层内部 SCC 同批处理？ | A 不处理（E3）；B 同批 | **A** | B 会扩大 53 条深引改造，违反 NG4 |
| **Q10** | 新文件预算？ | A 8 个路径（5 新 + 3 迁移副本）；B 不限 | **A** | A 是 A-17 的唯一判定对象 |

---

## 10. 评审意见栏

> 请评审人在下表填写；未填写的行视为"未审"。结论只在最后一行填写。

### 10.1 需求整体

| 项 | 意见 |
| --- | --- |
| 需求边界是否成立（G1–G7 / NG1–NG9） |  |
| 影响模块是否遗漏 |  |
| 优先级与难度评估是否合理 |  |
| 验收标准是否可判定（A-01–A-20） |  |
| 里程碑与精确期望是否可接受 |  |
| 口径漂移 / 归属迁移定义是否可接受（§6.6） |  |

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

### 10.3 豁免（E1–E12）

| 编号 | 同意 | 驳回 | 说明 |
| --- | --- | --- | --- |
| E1–E12 |  |  |  |

### 10.4 打回意见（逐条）

| # | 意见 | 要求修订的位置 |
| --- | --- | --- |
| 1 |  |  |
| 2 |  |  |
| 3 |  |  |

### 10.5 结论

| 项 | 内容 |
| --- | --- |
| 评审结论 |  |
| 评审人 / 时间 |  |

---

## 附录 A：M0 反向边精确清单（A-05 的基线对象）

> 用 §6.5 P3b 在 HEAD `89572b5` 复算得到，共 21 行 / 11 文件。M5 的 13 行必须替换本表（不多不少）。

| # | 文件:行 | 形态 | 说明符 | M5 去向 |
| --- | --- | --- | --- | --- |
| 1 | `utils.ts:19` | 值 | `@/agent` | `agentRuntime.ts` |
| 2 | `utils.ts:20` | 值 | `@/agent/bridge/canvas` | `agentRuntime.ts` |
| 3 | `utils.ts:21` | 值 | `@/agent/bridge/question` | `agentRuntime.ts` |
| 4 | `utils.ts:33` | 值 | `@/agent/a2a/settings` | `agentRuntime.ts` |
| 5 | `utils.ts:35` | 值 | `@/agent/mentionFiles` | `agentRuntime.ts` |
| 6 | `modules/platformCore/conf/index.ts:5` | **类型** | `@/agent/a2a/settings` | `@toonflow/formats`（`A2aSettings`） |
| 7 | `modules/agentAccess/index.ts:6` | **动态** | `@/agent/a2a` | 保留（E4） |
| 8 | `modules/agentAccess/singleAgent/types.ts:2` | **类型** | `@/agent/runtime/types` | `@/agentRuntime` |
| 9 | `modules/agentAccess/singleAgent/index.ts:7` | 值 | `@/agent/tools` | `@/agentRuntime` |
| 10 | `modules/agentAccess/singleAgent/index.ts:8` | 值 | `@/agent/runtime/model` | `@/agentRuntime` |
| 11 | `modules/agentAccess/singleAgent/index.ts:9` | 值 | `@/agent/runtime/requests` | `@/agentRuntime` |
| 12 | `modules/agentAccess/singleAgent/index.ts:10` | 值 | `@/agent/runtime/sessions` | `@/agentRuntime` |
| 13 | `modules/agentAccess/singleAgent/index.ts:11` | 值 | `@/agent/bridge/question` | `@/agentRuntime` |
| 14 | `modules/mcpIntegration/mcp/tools.ts:8` | 值 | `@/agent/tools` | `@/agentRuntime` |
| 15 | `modules/mcpIntegration/mcp/tools.ts:9` | 值 | `@/agent` | `@/agentRuntime` |
| 16 | `routes/agent.ts:4` | **类型** | `@/agent/runtime/types` | `@/agentRuntime` |
| 17 | `routes/agent.ts:9` | 值 | `@/agent/runtime/model` | `@/agentRuntime` |
| 18 | `routes/settings/systemPrompt.ts:3` | 值 | `@/agent/runtime/prompt` | `@/agentRuntime` |
| 19 | `routes/settings/save.ts:6` | 值 | `@/agent/runtime/prompt` | `@/agentRuntime` |
| 20 | `routes/agents/a2a/save.ts:8` | 值 | `@/agent/runtime/model` | `@/agentRuntime` |
| 21 | `routes/singleAgent/run.ts:7` | 值 | `@/agent/runtime/model` | `@/agentRuntime` |

## 附录 B：M0 agent→应用 74 行按目标汇总（A-01～A-03 的基线对象）

| 目标 | 条数 | 明细 |
| --- | --- | --- |
| `@/modules` | **50** | workspace/files 12、workspace/chatImages 1、conf 8、assets 3、assets/roots 3、ai 3、ai/files 1、ai/requestFiles 1、personalization 3、teams 4、plugins/tools 2、skills/files 1、mcp/control 2、mcp/servers 1、documents 2、media/generation 1、ffmpeg 1、browser 1 |
| `@/utils` | **1** | `agent/mentionFiles.ts:3` |
| `@/lib`（别名） | **20** | i18n 8、documentFormats 5、modelReasoning 5、platform 2 |
| 相对逃逸 | **3** | `agent/mentionSources.ts:8`（类型）、`:135`（值）、`agent/runtime/types.ts:2`（类型） |
| **合计** | **74** | 值 68 + 类型 6 |

## 附录 C：M0 实测命令输出（可复现）

```
$ grep -rn --include='*.ts' -E "from ['\"]@/(modules|lib|utils|routes|types|app|router|core)" apps/server/src/agent | wc -l
71
$ grep -rn --include='*.ts' -E "from ['\"]\.\./(\.\./)?(lib|modules|utils)" apps/server/src/agent | wc -l
3
$ grep -rnE --include='*.ts' '@/agent(/|[^A-Za-z])' apps/server/src --exclude-dir=agent | wc -l
21
$ grep -rn --include='*.ts' "@toonflow/teams-scaffold" apps/server/src --exclude-dir=agent | wc -l
3
$ grep -rl --include='*.ts' -E "from ['\"]@/utils['\"]" apps/server/src | wc -l
145
$ find apps/server/src/agent -name '*.ts' | wc -l ; find apps/server/src/agent -name '*.ts' -print0 | xargs -0 cat | wc -l
29
4032
$ find apps/server/src -name '*.ts' | wc -l ; find apps/server/src -name '*.ts' -print0 | xargs -0 cat | wc -l
272
18546
```

> 说明：本附录只记录本轮执行结果；不写入仓库脚本、不加入 `package.json`、不进入 CI（C4）。
