# 方案设计 · AgentHost 端口切断 agent↔应用双向依赖（架构级环治理）

> **定位**：本文件是 harness 规则正文 **2.2（方案设计）** 的产物，只做方案，**不改任何代码**。
> 输入：`1_requirements_matrix/2026-10-27-13-57-agentHostPortCycleBreak-v5.md`（REQ-2026-10-27-05，第 5 版）。
> 实施发生在用户评审通过之后。

## 0. 文档元信息

| 项 | 内容 |
| --- | --- |
| 方案编号 | **SOL-2026-10-27-05** |
| 对应需求 | **REQ-2026-10-27-05**（第 5 版；替代 REQ-2026-10-27-04） |
| 需求状态（输入口径） | **已评审通过 → 已实施（2026-10-27 20:58–21:25）**；第 6 轮（2026-10-27 22:xx）按审查意见同步地图 health 与其生成源，方案本体未变更（TEST-2026-10-27-05） |
| 基线 | `git HEAD = 89572b5`；工作树另有并行 bug 修复任务的 4 个改动（见 §0.3 F-01） |
| 影响模块 | `agent-runtime`（主）、`server-api`（主）、`shared-foundation`（新增 `packages/formats`）、`web-console`（契约连带只验不改）、`ai-providers`（契约连带只验不改）；派生 `desktop-shell`、`mobile-shell`（`@toonflow/server/*` 路径冻结） |
| 方案类型 | 结构性重构（端口 + 组合根装配）。**零行为变化**：不改 HTTP 契约、NDJSON 事件、磁盘/设置格式、i18n 的 ALS 语义、平台判定的每次调用语义 |
| 交付物 | 本文件 + 同目录 `INDEX-2026-10.md` 更新；**代码/脚本/测试零改动**（探针一律 `/tmp` 一次性执行，遵守 C4） |
| 编写时间 | 2026-10-27 14:45 |
| 约束来源 | `AGENTS.md` 七条硬约束（本方案记为 C1–C9，见 §1.3）、需求矩阵 §1.5/§2.2（NG1–NG14） |

### 0.1 第 4 轮打回意见 → 需求处置 → 方案落地（逐条）

> 打回意见已在矩阵 v5 处置完毕；本节逐条说明**方案侧如何把它变成实施动作**，确保设计不会把已修复的问题带回来。

| # | 第 4 轮打回意见 | 矩阵 v5 的处置（输入事实） | 本方案的落地设计 | 复检判据 |
| --- | --- | --- | --- | --- |
| 1 | **R-03 写「组装 12 组」与 R-01/§1.4 的 14 组（含 i18n、platform）冲突** | R-03 改 14 组；新增 §4.3.1 装配台账；i18n 只转发、platform 每次调用 | §3.3 给出 `createAgentHost` 的**14 键返回对象**伪码与 20 条源路径；附录 B 逐组给"实现来源 / 符号 / 行数 / 目标数 / 批次"；§3.1 写死 i18n 与 platform 的**引用转发**形态（不得包装、不得缓存） | P20（M5）`host_members=14 assembly_members=14 missing_*=0`；A-26 |
| 2 | **10 条 A2P 边无 Host 归属**（i18n 8 + platform 2） | Appendix E 逐行 74 行；P20（M0）`unmapped=0 i18n=8 platform=2` | 附录 C 把这 10 行**逐条列出**并绑定到 B2 批次（§3.4 表 4）；§3.4 的 B2 硬约束 5 写明"i18n 与 platform 必须同批迁移，只迁一组则批次后 A2P ≠ 32 直接失败" | P20（M0）`unmapped=0`；A-24；§3.4 批次门 |
| 3 | **A-01/A-03 归零存不可达风险** | `settingsPath()`（5 处 `conf.path`）、`AssetLibrarySelector` 类型、`getAppOrigin` header-bag；A-24 + A-26 | §3.1 逐条给出三个缺口的实施形态；§0.3 **F-03 修正** header-bag 的字段数（3 → 5）并给出应用侧 `resolveAppOrigin(bag)` 单一实现，避免"两个实现漂移"；§3.1 明确契约内**结构型重声明** `RequestFile` / `AssetLibrarySelector` / `RuntimePlatform`（不能从应用 import type，否则 A-01 不可能为 0） | A-24（74/74 有去向）+ A-26（`symbol_missing=0`）+ A-01/A-03 |
| 4 | **A-22 静态项缺探针、e9 未定义** | P19（`1/0/0/0` → `0/1/1/1`）、A-25 + P21（e9 24→16）、G3 改 16 | §3.2 写死惰性注册的**唯一形态**（模块顶层零注册）；§3.15 写死 `e9` 的计数公式（P3b + P4）与标签同步动作（R-11 交付项）；方案不新增判据编号，只把 A-22/A-25 翻译为实施动作 | P19（M0/M5）、P21（M0/M5）、T8/T11；A-22/A-25 |

**结论**：4 条打回意见在方案层均落到"具体文件 + 具体形态 + 具体批次 + 具体判据"，不存在"设计上又回到 12 组 / 10 条边无归属 / 归零靠删功能"的路径。

### 0.2 编号与口径约定

| 类别 | 约定 |
| --- | --- |
| 需求编号 | **沿用矩阵 R-01～R-15**，本方案不新增、不改写（R-05a/R-05b 视为 R-05 的两段） |
| 判据编号 | **沿用 A-01～A-26**；本方案**不新增 A 项**。方案只描述"实施动作 → 哪个 A 项判定" |
| 探针编号 | 沿用 P1～P21 与 T1～T11；命令文本以矩阵 §6.5 为准，**实施期不得改写**（A-16 冻结） |
| 里程碑 | M1～M5、批次 B0～B4 全部沿用矩阵 §5/§4.4 |
| 方案级新增前缀 | `F-` 方案级发现（不影响判据编号）、`D-` 待裁决分支、`X-` 外部协同项、`s-` 方案级一次性检查（`/tmp`，不进仓库、不进 CI） |
| 代码块约定 | 本文件所有代码块均为**伪代码或结构示意**，不是可直接编译的真实代码；真实实现由实施阶段产出 |

### 0.3 方案级发现（F 项）

> 这些是"按矩阵执行时会在方案层撞到"的事实，均已在仓库实测，不改变判据，但必须在实施前确定处置。

| 编号 | 发现 | 实测证据 | 影响 | 处置建议 |
| --- | --- | --- | --- | --- |
| **F-01** | **基线漂移**：并行 bug 修复任务在 `agent/runtime/requests.ts` 新增 `import { agentLog } from "@/lib/agentLog"`，且新增文件 `lib/agentLog.ts` 自身 import `conf` | 脏树 `P1=72`；干净基线 `89572b5` 为 `71`；矩阵 §0 已登记工作树 4 个改动 | 若该改动先合入 HEAD：A2P 74→**75**、`unmapped=1`（v5 的 74 行 manifest 未含此行）→ A-24 直接 FAIL（不可达） | **D-01**。默认：M0 仍以 `89572b5` 冻结；实施前若已合入，按矩阵 §6.2 规则 4 **回需求评审**修订 A-01/A-03/A-24 计数，方案侧同步补 1 行归属（唯一应用依赖是 `conf.path` → 归 `settings` 组，复用 `settingsPath()`，**不新增组、不新增符号**） |
| **F-02** | `app.ts` 当前 **78 行**，注入只增加 **1 行**（`await (await import("./agentHost")).initializeAgentHost(context);`） | `wc -l apps/server/src/app.ts` = 78 | 台账 L22（M1=80）与实测 79 不符；L22 属"记录用、不参与验收"（矩阵 §6.9 注），但会被评审当数字核对 | 方案按 **79** 记录；在评审意见栏登记台账更正（不改 A 表） |
| **F-03** | **`getAppOrigin(req)` 不能只靠 3 个 header 等价复现**：其内部 `allowedHost(req)` 依赖 `isMobileLinkRequest(req)`，后者读 `req.res.locals[deviceKey]`（`Symbol`，模块私有） | `modules/mcpIntegration/mcp/control.ts:38-46`；`modules/localRuntime/mobileLink/index.ts:23,37-39` | v5 §0.1#3 的 header-bag 若只有 `{origin, referer, host}`，在"桌面/开发模式 + 移动互联请求"下会从"放行"变成"403"，改变 A2A 鉴权行为 | **D-02**。默认 A：bag 扩为 **5 字段** `{origin, referer, host, hostname, mobileLink}`；应用侧新增 `resolveAppOrigin(bag)` 作为**唯一实现**，`getAppOrigin(req)` 退化为薄适配器（路由行为零变化）；agent 侧通过请求局部标志 `toonflowMobileLink` 计算 `mobileLink`（§3.1.3） |
| **F-04** | 契约内**不能** `import type` 应用类型：`AssetLibrarySelector`、`RequestFile`、`RuntimePlatform` 若从 `@/modules/**` 引入，`agent/host.ts` 自己就成了 1 条 A2P 边，A-01 永远不可能为 0 | `agent/assets.ts:7` 现有 `import type` 即反例；P1 正则覆盖 `import type` | 归零不可达 | §3.1 规定三者在 `agent/host.ts` **结构型重声明**；"Host 实现赋值给契约"由 `bun run typecheck`（A-12）做编译期可赋值性校验，不新增检查文件 |
| **F-05** | `FileRequestLimitError` 必须**传类引用**：agent 用 `instanceof` 判定 413 | `agent/runtime/requests.ts:10` | 若 Host 包装成新类或工厂，`instanceof` 失效、`status:413` 语义漂移 | 契约以"构造签名类型"表达，Host 直接转发类引用（§3.1.4） |
| **F-06** | `i18n.t` 是 **tagged template**（`TemplateStringsArray`），且语言来自 ALS | `lib/i18n.ts:43-55` | 包装成普通函数会丢签名；装配时读 `getLocale()` 会串语言（S-12 双串失败） | 契约 `t(strings, ...values)`；Host **按引用转发**，装配期不调用任何 i18n 读取函数（§3.1.6） |
| **F-07** | `getRuntimePlatform()` 每次调用读取 `process.platform` / `runtimeHost`，`setRuntimeHost` 在 `createApp` 之后仍可能变（桌面/移动启动序） | `lib/platform.ts`；`app.ts` 调用点 | 若 Host 在装配时求值并缓存，桌面/移动/开发模式判定会冻结 | 契约 `platform.getRuntimePlatform()`；Host 直接转发函数引用，禁止 `() => cached`（§3.1.7） |
| **F-08** | `skills.directory()` / `skills.isEnabled(name)` 是**读 `conf` 的函数**，不是常量 | `modules/pluginMarket/skills/files.ts:11-13` | 若装配时求值成值，`conf.path` 与 `disabledSkills` 会被冻结 | 契约保持函数形态，Host 按引用转发（§3.1.5） |
| **F-09** | 多目标行 `agent/mentionFiles.ts:3`（`u.workspaceFile` + `u.assets`）必须**同一次**改完 | 该行 `:15,:26,:59,:71,:111,:113` 共 6 处用法，跨 workspace/assets | 只改一半会让 `multi=1` 与 `host_dest=62` 的台账不一致，且 B3 批次后 A2P ≠ 11 | §3.4 B3 硬约束：该行与 `assets.ts:6-8` 同一提交完成 |
| **F-10** | M1 之后仍存在最小环：`utils.ts → agentRuntime.ts → agent/mentionFiles.ts → utils.ts` | `mentionFiles.ts:3` 属 B3 才迁移 | 若把 M1 的 `scc_total=3 / agent_scc=1` 当成回归，会误回滚 | 矩阵 §5 注②已说明；方案 §4 的 M1 门禁**不判 SCC**，只判 A-04/A-05/A-21 |
| **F-11** | 门面被 3 个**域文件**直接引用（`singleAgent/index.ts`、`singleAgent/types.ts`、`mcp/tools.ts`） | 矩阵 E13 | 若为省事把 `agent-runtime` 加进 `agentAccess.dependencies`，会新增模块对（违反 NG9/A-18/A-20） | §3.2 明确：不新增依赖表项；E13 已在矩阵登记 |
| **F-12** | `packages/formats` 是新目录，**不在任何地图 glob 内** | `map.json` 现有 `shared-foundation.files` 无 `packages/formats/**` | `uncovered > 0` → A-17 FAIL | §3.9 归属迁移 manifest 必须含 3 条新增（2 文件 + 1 glob），由 P11/P12 判定 |
| **F-13** | 根 `typecheck` 是 `bun run --filter '@toonflow/*' typecheck`，**只跑声明了该脚本的包** | 根 `package.json:scripts.typecheck` | 若 `packages/formats/package.json` 不声明 `typecheck`，全仓类型检查会**静默跳过**新包 → A-12 假通过 | §3.5 规定 formats 必须自带 `typecheck` 脚本（非代码文件，不增预算） |
| **F-14** | `agentLog` 自身用 `dirname(conf.path)` 定位日志目录，与 `settingsPath()` 语义一致 | `lib/agentLog.ts` | F-01 的归属处置有明确落点：不需要新符号 | 与 F-01/D-01 合并处置 |

### 0.4 待裁决分支（D 项，均有默认值）

| 编号 | 议题 | 选项 | **默认** | 影响面 |
| --- | --- | --- | --- | --- |
| **D-01** | 并行 bug 修复带来的基线漂移 | A 等合入后回需求评审改计数 / B 本分支先冻结 `89572b5` 并在合并时回评审 / C 让并行任务改由应用侧记录日志 | **B**（M0 用干净基线；合并前必须回评审，禁止就地放宽 §6.2 规则 4） | A-01/A-03/A-24 的 `74`；不影响 A-04～A-26 其余项 |
| **D-02** | `getAppOrigin` 端口形状 | A 5 字段 bag + 应用侧 `resolveAppOrigin` 单一实现 / B 3 字段 bag + Host 内重写判定 | **A** | A2A 鉴权等价性；S-05/S-06 回归 |
| **D-03** | `agentLog` 的最终归属（仅在 D-01 选 A 时生效） | A 归 `settings` 组（复用 `settingsPath`）/ B 移入 `apps/server/src/agent/log.ts`（新增代码文件 9、P2A +1）/ C 调用点回应用侧 | **A** | 预算 A-17、e9 计数 |
| **D-04** | 契约内应用类型 | A 结构型重声明 + 编译期可赋值性 / B 从应用 `import type` | **A**（B 会让 A-01 不可达） | A-01/A-03 |
| **D-05** | `utils.ts` 的 5 个旧键 | A 保留旧键（`agent`/`canvas`/`question`/`a2aSettings`/`mentionFiles`）+ 新增 `agentRuntime` 键 / B 删除旧键 | **A**（B 会波及 145 个 `utils.ts` 消费文件） | A-07（38 键） |
| **D-06** | `packages/formats` 的 `exports` | A `"."` + 4 条子路径（`./modelReasoning` 等），shim 精确导入 / B 只 `"."`，shim 用具名再导出 | **A**（避免 shim 意外带出 `a2a`） | A-14（14 个 server exports 不变）、A-18 |
| **D-07** | B2 批次内的顺序 | A 一次性提交（i18n 8 + platform 2 + 模型/媒体 7）/ B 先 i18n 再 platform | **A**（B 的中间态 A2P ≠ 32，违反 §3.4 批次门） | §3.4 批次门 |
| **D-08** | `agentHost.ts` 的装配写法 | A 每组一个字面量对象（4 空格缩进键）/ B 动态拼装 | **A**（P20 M5 用 `^\s{4}<group>\s*:` 计数，B 不可判定） | A-26 |

### 0.5 覆盖度 / 可读性自检

| 维度 | 保证方式 | 核对位置 |
| --- | --- | --- |
| 子需求覆盖 | 矩阵 15 项（R-01～R-15，含 R-05a/R-05b）**逐项**给"背景 / 目标 / 描述 / 详细方案设计 / 验收映射" | §3.1–§3.15、附录 A |
| 打回覆盖 | 第 4 轮 4 条 → §0.1 逐条给"处置 → 方案动作 → 判据" | §0.1 |
| 可执行 | 每个 R 都落到"改哪个文件 / 什么形态 / 哪个批次 / 哪个探针" | §3、§4、附录 D |
| 无大段代码 | 代码块仅用于**伪码与结构示意**（单个 ≤ 15 行），真实签名以"符号表 + 语义红线"表达 | §3 全章 |
| UI | 本需求零 UI 改动；仍给出"编译期契约 + 7 项界面回归 + 现象→断点" | §6 |
| 可回滚 | 每个批次、每个里程碑都有独立回滚动作 | §8 |
| 评审可填写 | 「评审意见栏」按需求/R/分支三类分组，全部留空 | §9 |

---

## 1. 背景与问题定位

### 1.1 环的形状（复述实测，不重复推导）

```
        ┌────────────────────────── 每条 Agent 请求的必经路径 ──────────────────────────┐
        │                                                                              │
routes/agent.ts ──► utils.ts ──► agent/index.ts ──► agent/runtime/index.ts ──► @/modules/* ──┐
        ▲                                                                                    │
        └──────────────────────────── 145 个文件经 utils.ts 可达 agent ◄─────────────────────┘

方向一（agent → 应用）：74 处（别名 71 + 相对逃逸 3），23/29 个 agent 文件命中
方向二（应用 → agent）：24 = 21 源码行（11 文件）+ 3 条包契约
file 级 SCC：3 个，其中含 agent 的 1 个（10 文件）
地图边：e7（agent-runtime → server-api）= 1，e9（server-api → agent-runtime）标签 24
```

### 1.2 为什么"端口"能断环（方案的核心论证）

| 命题 | 论证 | 方案动作 |
| --- | --- | --- |
| 环的**正向**半边（agent→应用）必须归零 | 只要 agent 仍 import `@/modules`/`@/lib`，地图 `e7` 就存在，任何应用侧改动仍会牵动 agent | R-01 + R-03：能力经 `AgentHost` 端口获得，端口由**组合根**注入 |
| 环的**反向**半边不必归零，但必须**唯一化** | "应用→agent"是允许方向（应用要用 agent）；环成立的条件是反向边落在"agent 的依赖闭包内"。把 21 行收敛到 3 个 bootstrap 门面（`agentRuntime.ts` / `agentHost.ts` / 冻结的 A2A 动态块），SCC 即消失 | R-02 + R-04 |
| 归零不能靠删功能 | 74 条边每条都对应真实能力；端口必须**逐条给出符号去向** | R-13：74/74 逐行归属 + M5 目标存在性 |
| 端口不能成为新上帝对象 | 14 组命名空间 + 只做转发 + 禁止 `Request`/`conf`/预留方法 | R-01 契约红线 |

### 1.3 设计约束（C1–C9 → 方案落点）

| 约束 | 内容 | 方案落点 |
| --- | --- | --- |
| C1 | 模块入口 ≤60 行、入口静态面不出现 `@/modules/**` | Host 落在 **bootstrap**（`src/agentHost.ts`），不进 `modules/agentAccess`（§3.3 落点裁决） |
| C2 | `app.ts` 不静态 import 模块入口；入口 9 处动态块冻结 | 注入用 `await import("./agentHost")` 放在 `createApp` 内（§3.3 时序） |
| C3 | 模块级 SCC 不承诺无环；file 级只保留既有 2 个 | 本方案只承诺 file SCC 2 / agent 0 + `e7=0`（§3.12） |
| C4 | 不新增测试/自检文件/检查命令/CI 入口 | 方案级 `s-` 检查与全部探针只在 `/tmp` 执行（§5.3） |
| C5 | `conf` 只在 `platformCore/conf` 初始化，且晚于 `TOONFLOW_DATA_DIR` | 注入点必须在 `platform.prepare` 之后（§3.3 步骤 9.5） |
| C6 | web 直编 server 源码；桌面/移动经 14 个 exports 复用 | 导出路径冻结（R-07，§3.7） |
| C7 | `verbatimModuleSyntax: true` | 契约纯类型可用 `import type`，但 A-01 仍按解析口径计（更严，F-04） |
| C8 | i18n locale 只来自 ALS | Host `i18n` 只转发、不缓存（F-06） |
| C9 | `getRuntimePlatform()` 每次调用读取环境 | Host `platform` 只转发（F-07） |

### 1.4 成功定义（与矩阵 §2.1 一一对应）

交付态 M5 必须同时成立：`A2P 0`、`P2A 13 行/3 文件 + 3 包契约`、`D1b 10 行/5 文件`、`file SCC 2/0`、`e7 不存在`、`e9 = 16`、`74/74 有去向`、`14 组/14 装配/60 符号/3 副本存在`、`A-12～A-15 全过（13 项冒烟 16/16）`、`11 项自检 11/11`。

---

## 2. 总体架构方案

### 2.1 目标形态

```
                       ┌───────────────────────────────┐
                       │  app.ts（组合根 / bootstrap）  │
                       │  步骤 0–15，注入固定在 9.5     │
                       └──────────────┬────────────────┘
                                      │ ① Promise.all 装载 7 个模块入口（原有）
                                      │ ② platform.prepare / 插件与目录初始化（原有）
                                      │ ③ 步骤 9.5：initializeAgentHost(context)   ← 新增
                                      ▼
        ┌───────────────────────────────────────────────────────┐
        │ agentHost.ts（唯一实现点，bootstrap 层）               │
        │   createAgentHost(context) → { 14 组能力 }             │
        │   20 条源路径：modules/** 18 + lib/{i18n,platform} 2   │
        └──────────────┬────────────────────────────────────────┘
                       │ configureAgentHost(host)   （全仓唯一一次）
                       ▼
        ┌───────────────────────────────────────────────────────┐
        │ agent/host.ts（契约叶子：纯类型 + 注册表）             │
        │   14 组 / 60 符号 / 无副作用 / 无 Request / 无 conf     │
        └──────────────┬────────────────────────────────────────┘
                       │ getAgentHost().<group>.*    （请求期/工具执行期）
                       ▼
        ┌──────────────────────────────┐        ┌──────────────────────────────┐
        │ agent/**（29 文件 / 4,032 行）│        │ 应用域 modules/**（提供实现） │
        │  A2P = 0（M5）               │        │  只被 agentHost 深度引用      │
        └──────────────┬───────────────┘        └──────────────────────────────┘
                       │ 反向：应用需要 agent 能力
                       ▼
        ┌───────────────────────────────────────────────────────┐
        │ agentRuntime.ts（唯一反向门面，11 个说明符 / 10 值+1 型）│
        │   ← utils.ts / routes/agent.ts / singleAgent / mcp/tools │
        └───────────────────────────────────────────────────────┘
```

**关键点**：`agentHost.ts` 依赖应用域，`agent` 只依赖 `agent/host.ts`；`agentRuntime.ts` 依赖 agent，应用只依赖门面。两条方向各自单向，环断开。

### 2.2 分层与落点裁决

| 层 | 文件 | 允许依赖 | 禁止依赖 | 判据 |
| --- | --- | --- | --- | --- |
| 契约 | `apps/server/src/agent/host.ts`（新增） | 仅 `@toonflow/formats` 的类型（可选） | `@/modules`、`@/lib`、`@/utils`、`express` | A-01/A-03、A-09 |
| 领域 | `apps/server/src/agent/**` | `agent/host.ts`、`@toonflow/*` foundation | 应用层任意路径 | A-01/A-02/A-03 |
| 装配 | `apps/server/src/agentHost.ts`（新增） | `@/agent/host` + 20 条应用源路径 | `@/agent` 的其它文件 | A-10 ② |
| 反向门面 | `apps/server/src/agentRuntime.ts`（新增） | `@/agent/**` 的 11 个说明符 | `@/utils`、`@/modules` | A-21、P13 |
| 组合根 | `apps/server/src/app.ts` | 门面与装配的动态 import | 静态 import 模块入口 | A-10 ③ |
| foundation | `packages/formats/**`（新增） | 同包内 | `apps/server`、任何域包 | A-17/A-18 |

### 2.3 三条不动线（方案红线）

1. **行为不动**：错误 `message`/`status`/`code`、NDJSON 事件类型与顺序、A2A 取消文案、i18n 双串、`tools/list` 46 个工具名——逐条由 S-01～S-13 判定。
2. **契约不动**：`apps/server/package.json` 的 14 个 exports target、`agentRuntime` 与 `singleAgent/types` 的类型形状、web 的 38 条导入——R-07/A-14 逐字比对。
3. **口径不动**：归因算法、计数正则、`map.json` glob 只增 3 条、`e9` 的 from/to 与标签公式——R-09/A-16/A-25。

### 2.4 端口设计原则（14 组为什么这样切）

| 原则 | 内容 | 反例（禁止） |
| --- | --- | --- |
| 按**能力**分组，不按**模块**分组 | 14 组对应"agent 需要的能力"，一个能力可来自 2 个源文件（workspace 2、assets 2、models 3、mcp 2、media 2） | 按 `modules/*` 平铺成 7 个组（会让 14 行 i18n/lang 无处归属） |
| 只做**转发** | 值/异常/status 1:1 透传；类引用直接传（F-05） | 在 Host 里"顺手"补校验、包新错误 |
| **无框架类型** | 契约内不出现 `Request`/`Response`；`getAppOrigin` 用 bag（F-03） | 把 `req` 传进端口 |
| **无进程状态** | `i18n` 不持 locale、`platform` 不缓存、`skills.directory()` 保持函数（F-06/F-07/F-08） | 装配时求值成常量 |
| **无顶层副作用** | `host.ts` 只有 `let installed` 与函数声明 | 模块顶层 `const h = getAgentHost()` |
| **无预留** | 每个符号都能在 74 行清单里找到消费点 | "以后可能用"的方法 |

---

## 3. 子需求详细方案设计

> 每个子需求按「背景 → 目标 → 描述 → 详细方案设计 → 验收映射 → 风险」五段。伪代码只表达**结构与顺序**，签名细节以符号表为准。

### 3.1 R-01 AgentHost 契约（`apps/server/src/agent/host.ts`，新增）

#### 背景

agent 的 29 个文件里有 23 个命中应用路径（74 处）。这些引用**没有契约层**：workspace 的越界校验、文件锁、`conf` 的 `path`、i18n 的 ALS、平台判定的每次调用语义，只存在于实现里。任何"抽端口"的动作，只要少列一个符号，就变成"归零靠删功能"。

#### 目标

给出**唯一**的 14 组契约，使 agent 只依赖契约；契约内不存在 `express`/`Request`/`conf`；契约顶层恰好 14 个 `readonly` 组属性；生命周期 fail-fast。

#### 描述

- 只定义类型 + 注册表（`let installed` + 两个函数），**不含实现**；
- 顶层对象形状固定（14 行、两空格缩进），供 P20 M5 计数；
- 60 个符号逐组给出（附录 B）；
- 应用侧的 3 个类型（`AssetLibrarySelector`、`RequestFile`、`RuntimePlatform`）**结构型重声明**（F-04），不 import 应用。

#### 详细方案设计

**（1）生命周期伪码（P15 的唯一对象）**

```
状态: let installed = null

configureAgentHost(host):
    若 installed 非空  → throw Error("AgentHost 已注入")
    installed = host

getAgentHost():
    若 installed 为空  → throw Error("AgentHost 未注入")     // fail-fast，禁止兜底
    return installed
```

三条不变量：I1 模块求值域不得出现 `getAgentHost`（A-09 的 AST 探针）；I2 注入先于首次使用（步骤 9.5）；I3 失败即抛，不降级。

**（2）契约分组与符号表**（完整 60 符号见附录 B；此处给"分组 + 语义红线"）

| # | 组 | 契约形态要点 | 语义红线（逐条可驳回） |
| --- | --- | --- | --- |
| 1 | `workspace` | 9 个函数：`resolveWorkspacePath(root, path, allowMissingParents?)`、`lockWorkspaceFiles(paths) → release`、`writeWorkspaceFile`、`renameWorkspaceFile`、`isWithin`、`isHiddenWorkspaceEntry`、`protectWorkspaceRoot`、`protectWorkspaceLibraryPath`、`importImage` | 返回路径/异常与 `localRuntime/workspace/files.ts` 一致；**不得**放宽 `protectWorkspaceRoot`/`protectWorkspaceLibraryPath`；**不得**省略 `lockWorkspaceFiles`；**不得**吞 `status:400/403/409` |
| 2 | `settings` | `get(section, fallback?)`、`onChange(section, listener)`、**`settingsPath()`** | 返回 `conf` 的 `get`/`onDidChange`/`path` 语义；**不得**暴露 `conf` 实例；`settingsPath()` 是 5 处 `conf.path` 的唯一去向 |
| 3 | `assets` | 11 个函数 + **`AssetLibrarySelector` 类型** | `openAssetLibrary` 的 `req` 不进端口（agent 调用点均不传）；默认参数语义保持 |
| 4 | `models` | 8 个函数/类 + `RequestFile` 类型 | `FileRequestLimitError` **类引用直传**（`instanceof` 必须成立，`status:413` 不变） |
| 5 | `personalization` | 4 个符号 | 413 文案 `个性化文档不能超过 20000 个字符` 不变 |
| 6 | `teams` | 4 个函数 | 团队禁用/未安装的错误语义不变 |
| 7 | `tools` | 3 个函数 | 工具校验失败的错误结构不变 |
| 8 | `skills` | `directory()`、`isEnabled(name)`（**函数**） | 不得在装配时求值（F-08） |
| 9 | `mcp` | `callControl`、`getConnection`、`getAppOrigin(bag)`、`createMcpAgentTools` | `getAppOrigin` 的 3 条 403 文案与 `status:403` 逐字保留；bag 5 字段（F-03） |
| 10 | `documents` | `readDocument` | 读取上限/解码语义不变 |
| 11 | `media` | 3 个函数 | FFmpeg 与媒体生成错误语义不变 |
| 12 | `browser` | `createBrowserContext` | 上下文生命周期由调用方持有，语义不变 |
| 13 | `i18n` | `t(strings, ...values)`、`translateMessage`、`translateError` | **只转发**；不持有 locale、不缓存 `getLocale()`；`t` 保持 tagged template（F-06） |
| 14 | `platform` | `getRuntimePlatform(): RuntimePlatform` | **每次调用转发**；`RuntimePlatform` 结构型 10 字段；不缓存（F-07） |

**（3）顶层形状伪码（P20 M5 计数的唯一对象）**

```
type AgentHost = {
  readonly workspace: ...      // 1
  readonly settings: ...       // 2
  readonly assets: ...         // 3
  readonly models: ...         // 4
  readonly personalization: .. // 5
  readonly teams: ...          // 6
  readonly tools: ...          // 7
  readonly skills: ...         // 8
  readonly mcp: ...            // 9
  readonly documents: ...      // 10
  readonly media: ...          // 11
  readonly browser: ...        // 12
  readonly i18n: ...           // 13
  readonly platform: ...       // 14
};
```

约束：**恰好 14 行**、两空格缩进、组名拼写与 P20 的 `GROUPS` 逐字一致（多一个、少一个、拼错都 FAIL）。

**（4）三个"归零可达性"缺口的实施形态**（对应打回意见 #3）

| 缺口 | 现状 | 契约形态 | 消费点改造 |
| --- | --- | --- | --- |
| `conf.path`（5 处） | `a2a/settings.ts:46`、`permissions.ts:43`、`skills/index.ts:19,35`、`tools/index.ts:170` 都是 `dirname(conf.path)` | `settings.settingsPath(): string` | 改为 `dirname(host.settings.settingsPath())`，**外层 `dirname` 保留**，路径语义不变 |
| `AssetLibrarySelector`（类型） | `agent/assets.ts:7` `import type` | 契约内结构型声明 `{ library?: "global"\|"project"; directory?: string; cwd?: string }` | 该 import 直接删除，改用契约类型；`bun run typecheck` 校验结构一致（F-04） |
| `getAppOrigin(req)` | 需要 `Request`，且内部依赖 mobile-link 的 `res.locals` | 契约 `getAppOrigin(bag)`，bag = `{origin?, referer?, host?, hostname?, mobileLink?}` | 应用侧新增 `resolveAppOrigin(bag)` 为唯一实现；`getAppOrigin(req)` 改为薄适配器；agent 侧由请求局部标志计算 `mobileLink`（见 3.1.3） |

**（5）三个应用类型的结构型重声明（F-04）**

| 类型 | 重声明位置 | 防漂移手段 |
| --- | --- | --- |
| `AssetLibrarySelector` | `host.ts` 的 `assets` 组 | Host 实现把应用函数赋给契约属性 → 参数逆变检查（`strictFunctionTypes`）→ 不一致即 typecheck 失败 |
| `RequestFile` | `host.ts` 的 `models` 组 | 同上（返回类型协变检查）；`inlineBytes`/`replace`/`offload`/`useReference` 逐字段声明 |
| `RuntimePlatform` | `host.ts` 的 `platform` 组 | `platform.getRuntimePlatform` 的实现必须返回 `lib/platform.getRuntimePlatform()` 的返回值 → 10 字段逐一可赋值 |

> 不新增检查文件、不新增命令：**编译器就是守卫**（A-12 兜底）。

**（6）契约叶子无副作用**

- 文件内只有：类型声明、`let installed`、两个函数；
- 不得出现顶层 `await`、`import` 副作用、`conf`/`i18n` 调用；
- 可选依赖 `@toonflow/formats` 的类型（如 `A2aSettings`），但**不必须**。

**（7）自检 fixture 形状（沿用矩阵 §4.1.1，方案不复制 fixture 代码）**

`p15/ok` 必须同时导出 `configureAgentHost` 与 `getAgentHost` 且实现二次注入保护与 fail-fast；`p15/fallback` 故意返回兜底对象；`p15/missing` 只导出 `getAgentHost`。方案的**实施责任**：`agent/host.ts` 的真实形状必须满足 `ok` 的全部特征，否则 P15 在 M5 输出非 0。

#### 验收映射

| 判据 | 方案动作 |
| --- | --- |
| A-01/A-03 | 契约 60 符号覆盖 74 行的全部去向（A-24/A-26 证明可达） |
| A-09 | P7 的 7 个静态子项 + `module_scope_refs=0` + P15 `failfast_exit 0` |
| A-26 | `host_members=14` + `symbols=60` + `symbol_missing=0` |
| A-12 | 结构型重声明由 typecheck 校验 |

#### 风险

端口过宽（RK-1）：14 组 + 只转发 + 无预留，评审可逐符号驳回；契约符号与 74 行清单**一一对应**，多出来的符号没有消费点即视为过宽。

---

### 3.2 R-02 反向收敛与门面（`agentRuntime.ts` + `utils.ts` + 惰性 watcher）

#### 背景

24 条反向边散在 11 个文件；`utils.ts` 的 5 条 re-export 与 `singleAgent/index.ts` 的 5 条构成 10 文件 SCC 的应用半边。`agent/a2a/settings.ts:71` 在**模块顶层**注册 `conf.onDidChange`，把配置求值时机与 agent 装载时机绑定。

#### 目标

P2A 收敛为 **13 行 / 3 文件**（`agentRuntime.ts` 10 值 + 1 型、`agentHost.ts` 1 值、A2A 动态块 1 行）；门面导入面**精确 10 行 / 5 文件**；watcher 改为**注入后惰性注册**。

#### 描述

新增 `agentRuntime.ts`：11 个说明符、10 个值 + 1 个类型；`utils.ts` 改为 1 行命名空间导入 + 38 键；5 个域文件改指门面；`conf` 的类型边迁到 formats；watcher 惰性化。

#### 详细方案设计

**（1）门面导出表（唯一对象，不得多加）**

| # | 说明符 | 形态 | 导出符号（精确） |
| --- | --- | --- | --- |
| 1 | `@/agent` | 值（`export * as agent`） | 命名空间 + `run`（`mcp/tools.ts` 用 `run as runAgent`） |
| 2 | `@/agent/tools` | 值 | `createAgentToolContext`、`createAgentTools` |
| 3 | `@/agent/runtime/model` | 值 | `createAgentModel`、`getAgentModelConfiguration` |
| 4 | `@/agent/runtime/prompt` | 值 | `defaultSystemPrompt`、`maxSystemPromptLength` |
| 5 | `@/agent/runtime/sessions` | 值 | `getToolResultText` |
| 6 | `@/agent/runtime/requests` | 值 | `configureAgentRequests` |
| 7 | `@/agent/bridge/canvas` | 值（`export * as canvas`） | 命名空间 |
| 8 | `@/agent/bridge/question` | 值 | `export * as question` + `createQuestionContext`、`answerQuestion` |
| 9 | `@/agent/a2a/settings` | 值（`export * as a2aSettings`） | 命名空间 |
| 10 | `@/agent/mentionFiles` | 值（`export * as mentionFiles`） | 命名空间 |
| 11 | `@/agent/runtime/types` | **类型** | `AgentEvent` |

**（2）消费方改造表（D1b 的唯一对象：10 行 / 5 文件）**

| 消费方 | 现状行 | 目标 | 门面行数 |
| --- | --- | --- | --- |
| `utils.ts:19,20,21,33,35` | 5 条 `@/agent*` | 1 条 `import * as agentRuntime from "./agentRuntime"`；默认导出**保留 5 个旧键原名**（都取 `agentRuntime.*`）+ 新增 `agentRuntime` 键（38 键） | 1 |
| `routes/agent.ts:4` | 类型 `AgentEvent` | `import type { AgentEvent } from "@/agentRuntime"` | 1 |
| `routes/agent.ts:9` | 值 `getAgentModelConfiguration` | `u.agentRuntime.getAgentModelConfiguration` | 0 |
| `routes/settings/systemPrompt.ts:3` | `defaultSystemPrompt`、`maxSystemPromptLength` | `u.agentRuntime.*` | 0 |
| `routes/settings/save.ts:6` | `maxSystemPromptLength` | `u.agentRuntime.*` | 0 |
| `routes/agents/a2a/save.ts:8` | `getAgentModelConfiguration` | `u.agentRuntime.*` | 0 |
| `routes/singleAgent/run.ts:7` | `getAgentModelConfiguration` | `u.agentRuntime.*` | 0 |
| `singleAgent/index.ts:7–11` | 5 值 | `@/agentRuntime`（5 行） | 5 |
| `singleAgent/types.ts:2` | 类型 `AgentEvent` | `@/agentRuntime` | 1 |
| `mcp/tools.ts:8,9` | 2 值 | `@/agentRuntime`（2 行） | 2 |
| `conf/index.ts:5` | `A2aSettings` 类型 | `@toonflow/formats`（R-05a，**不计 D1b**） | 0 |

合计 = 1 + 1 + 5 + 1 + 2 = **10 行 / 5 文件**（值 8、类型 2）。

**（3）`utils.ts` 的两种写法取舍（D-05）**

```
目标形态（示意）:
  import * as agentRuntime from "./agentRuntime"
  export default {
    ...既有 32 个非 agent 键不变,
    agent:        agentRuntime.agent,
    canvas:       agentRuntime.canvas,
    question:     agentRuntime.question,
    a2aSettings:  agentRuntime.a2aSettings,
    mentionFiles: agentRuntime.mentionFiles,
    agentRuntime,                       // 第 38 键
  }
```

为什么保留旧键：`utils.ts` 被 145 个文件引用，删键会波及 `routes/**`（如 `u.agent`、`u.canvas`）；保留旧键的成本是 5 行赋值，收益是零调用面变更。

**（4）watcher 惰性注册（A-22 的唯一形态）**

```
迁移前（禁止保留）: 模块顶层直接 conf.onDidChange("a2a", cb)

迁移后（唯一形态）:
  let watcherInstalled = false
  function ensureWatcher():
      if watcherInstalled: return
      watcherInstalled = true
      getAgentHost().settings.onChange("a2a", (next, previous) =>
          if 序列化相同: return
          previousController = controller
          controller = new AbortController()
          previousController.abort(Error("A2A 设置已修改，当前任务已取消")))

  getA2aSignal():
      ensureWatcher()          // 首次调用时注册；此时 Host 必已注入
      return controller.signal
```

时序后果（与矩阵 S-05 的双相完全对齐）：

| 相位 | `getA2aSignal()` 首次调用时机 | `pre_error` | 说明 |
| --- | --- | --- | --- |
| M0（现状） | 模块顶层已注册，注入概念不存在 | `none` | 正控制，证明 P16 能区分相位 |
| M5 | 请求期/装配后期 | `AgentHost 未注入` | 惰性注册触发 `getAgentHost()` 的 fail-fast |

**（5）`a2a/settings.ts` 的其余改造**

| 原引用 | 目标 | 语义保持 |
| --- | --- | --- |
| `conf.get("a2a")` | `host.settings.get("a2a")` | 返回值 cast 与默认值逻辑不变 |
| `conf.path`（`:46`） | `host.settings.settingsPath()` | 外层 `dirname` 与 `resolve(...,"workspaces")` 不变 |
| `getAppOrigin(req)`（`:59`） | `host.mcp.getAppOrigin(bag)` | bag 由 `req.get("origin")`、`req.get("referer")`、`req.get("host")`、`req.hostname`、`toonflowMobileLink` 组装；`catch { return }` 语义不变 |
| `isWithin` | `host.workspace.isWithin` | 403 `服务器部署只能使用服务器工作区` 不变 |
| `getRuntimePlatform()` | `host.platform.getRuntimePlatform()` | 每次调用转发 |
| `thinkingLevels`（`:9`） | `@toonflow/formats`（R-05a） | `A2aSettings` 同包类型 |
| `getA2aUrl(req)` | **不动**（纯 `req` 读取，无应用依赖） | 路由返回的 url 不变 |
| `authenticateA2a(req)` | 保留（`req.hostname` 判定是纯读取） | 鉴权行为不变 |

**（6）`agent/a2a/index.ts` 的改造**

`readTeam`（teams）、`callControl`/`getConnection`（mcp）改经 Host；`createA2aRouter()` 的签名与挂载方式不变（E2 动态块冻结）。

**（7）`conf/index.ts` 的类型边**

`import type { A2aSettings } from "@/agent/a2a/settings"` → `from "@toonflow/formats"`；同时 `agent/a2a/settings.ts` 改为 `export type { A2aSettings }`，保持外部引用面。

#### 验收映射

| 判据 | 期望 |
| --- | --- |
| A-04 | P3a 精确 3 文件 `{agentRuntime.ts, agentHost.ts, agentAccess/index.ts}` |
| A-05 | P3b 精确 13 行（值 11 / 型 1 / 动态 1） |
| A-06 | P4 = 3 |
| A-07 | P5a = 0；P5b = 38 键 = 37 ∪ {agentRuntime} |
| A-21 | P17 = 10 行 / 5 文件 |
| A-22 | P19（M5 `0/1/1/1`）+ P16 双相 + S-05 |

#### 风险

RK-5（watcher 回退）、RK-4（顶层捕获）。缓解：P19 静态计数 + P7b AST 探针 + T1/T7/T8 三项自检。

---

### 3.3 R-03 Host 实现与注入（`agentHost.ts` + `app.ts` 步骤 9.5）

#### 背景

应用侧没有 Host 实现；`conf` 是进程级单例且在 `platformCore/conf/index.ts` 顶层执行 `mkdirSync/realpathSync/new Conf`；`app.ts` 只装配 7 个模块入口。第 4 轮打回的根因之一就是"契约有 14 组、装配只写 12 组"。

#### 目标

**唯一实现点 + 唯一注入点**，装配 **14 组**（含 i18n、platform），注入严格晚于数据目录与 `platform.prepare`、早于 agent 首次求值。

#### 描述

`agentHost.ts` 位于 **bootstrap 层**（与 `app.ts`/`utils.ts` 同层），不落在 `modules/agentAccess/**`；`createAgentHost` 按附录 B 的 20 条源路径组装，返回**恰好 14 个组键**；`initializeAgentHost` 内调用 `configureAgentHost`；`app.ts` 在步骤 9.5 动态 import 并调用。

#### 详细方案设计

**（1）落点裁决（为什么不是 `modules/agentAccess`）**

| 候选 | 结论 | 理由 |
| --- | --- | --- |
| `modules/agentAccess/agentHost.ts` | ❌ | 需要 6 个域的能力 → `agentAccess` 会新增 `assetLibrary`/`mediaGeneration`/`mcpIntegration`/`localRuntime` 依赖 → 新增子模块对（违反 NG9/A-18/A-20） |
| `src/agentHost.ts`（bootstrap） | ✅ | bootstrap 已声明依赖全部入口；只新增 1 个跨模块深引文件（A-18 ③ = 1） |
| `agent/host.ts` 内实现 | ❌ | 会让契约自己 import 应用（A-01 不可达） |

**（2）装配伪码（14 键，4 空格缩进，D-08）**

```
createAgentHost(context):
    workspace      = { ...files 的 8 个函数, importImage: chatImages.importImage }
    settings       = { get: conf.get, onChange: conf.onDidChange,
                       settingsPath: () => conf.path }              // F: conf.path 5 处去向
    assets         = { ...assets 的 11 个函数, AssetLibrarySelector 由契约声明 }
    models         = { ...ai 的符号, ...ai/files, ...ai/requestFiles }
    personalization= { ...personalization 的 4 个符号 }
    teams          = { readTeam, saveTeamFile, listTeams, getRemoteTeam }
    tools          = { listTools, loadTool, validateToolConfig }
    skills         = { directory, isEnabled }                        // 函数引用，不求值
    mcp            = { callControl, getConnection, getAppOrigin, createMcpAgentTools }
    documents      = { readDocument }
    media          = { listMediaModels, generateMedia, createWorkspaceFfmpeg }
    browser        = { createBrowserContext }
    i18n           = { t, translateMessage, translateError }        // 引用转发，不读 locale
    platform       = { getRuntimePlatform }                          // 引用转发，不缓存
    return { workspace, settings, assets, models, personalization,
             teams, tools, skills, mcp, documents, media, browser, i18n, platform }

initializeAgentHost(context):
    configureAgentHost(createAgentHost(context))
```

**装配纪律**：
- 只做**引用转发**，不新增校验、不包错误、不改默认参数；
- i18n / platform / skills 的成员是**函数引用**，不得写成调用结果；
- 4 空格缩进的 14 个键是 P20 M5 的计数对象（缩进错一位即 FAIL）；
- `mcp.getAppOrigin` 转发应用侧 `resolveAppOrigin(bag)`（F-03/D-02）；
- **不带"同文件其它导出"**：如 `workspace/files.ts` 的 `copyWorkspaceFile`、`resolveWorkspaceFile` 没有 A2P 消费点，**不得**进契约（多导即端口过宽，RK-1/评审可逐符号驳回）。

**（3）20 条源路径（R-01/R-03/A-24/A-26 的共同对象）**

| # | 源路径 | 组 | 批次 | # | 源路径 | 组 | 批次 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `@/modules/localRuntime/workspace/files` | workspace | B3 | 11 | `@/modules/pluginMarket/plugins/tools` | tools | B1 |
| 2 | `@/modules/localRuntime/workspace/chatImages` | workspace | B3 | 12 | `@/modules/pluginMarket/skills/files` | skills | B1 |
| 3 | `@/modules/platformCore/conf` | settings | B4 | 13 | `@/modules/mcpIntegration/mcp/control` | mcp | B4 |
| 4 | `@/modules/assetLibrary/assets` | assets | B3 | 14 | `@/modules/mcpIntegration/mcp/servers` | mcp | B4 |
| 5 | `@/modules/assetLibrary/assets/roots` | assets | B3 | 15 | `@/modules/mediaGeneration/documents` | documents | B1 |
| 6 | `@/modules/mediaGeneration/ai` | models | B2 | 16 | `@/modules/mediaGeneration/media/generation` | media | B2 |
| 7 | `@/modules/mediaGeneration/ai/files` | models | B2 | 17 | `@/modules/mediaGeneration/ffmpeg` | media | B2 |
| 8 | `@/modules/mediaGeneration/ai/requestFiles` | models | B2 | 18 | `@/modules/agentAccess/browser` | browser | B3 |
| 9 | `@/modules/platformCore/personalization` | personalization | B1 | 19 | **`@/lib/i18n`** | **i18n** | B2 |
| 10 | `@/modules/pluginMarket/teams` | teams | B1 | 20 | **`@/lib/platform`** | **platform** | B2 |

> 第 19/20 条是第 4 轮打回点名的两组（10 条边）。**它们不是"顺带"**：B2 批次必须同时迁移 i18n 8 行与 platform 2 行（§3.4 硬约束 5），否则批次后 A2P ≠ 32。

**（4）i18n 与 platform 的装配语义（打回 #1 的核心）**

| 组 | 错误做法 | 正确形态 | 后果 |
| --- | --- | --- | --- |
| `i18n` | 装配时 `locale = getLocale()` 存字段；把 `t` 包成 `(s: string) => ...` | `t` 直接引用 `lib/i18n.t`；`translateMessage`/`translateError` 直接引用 | 错误做法会让 S-12 的 en/zh-CN 双串串语言（RK-11） |
| `platform` | `platform = { getRuntimePlatform: () => platformSnapshot }`（装配时求值） | 直接引用 `lib/platform.getRuntimePlatform` | 错误做法会冻结 `runtimeHost`/`NODE_ENV`，桌面/移动判定失真（RK-13 的姊妹风险） |

**（5）`getAppOrigin` 的 bag 与单一实现（F-03/D-02 默认 A）**

```
应用侧（唯一实现）:
  resolveAppOrigin(bag):                       // bag = {origin, referer, host, hostname, mobileLink}
      source = bag.origin ?? bag.referer
      若 source 空 或 不允许(bag)  → 403 只允许 Toonflow 页面访问控制连接
      url = new URL(source)（失败 → 403 页面来源无效）
      若 协议不在 {http,https} 或 url.host ≠ bag.host → 403 页面来源与服务地址不一致
      return url.origin

  getAppOrigin(req):                            // 退化为薄适配器，路由行为零变化
      return resolveAppOrigin({ origin: req.get("origin"), referer: req.get("referer"),
                                host: req.get("host"), hostname: req.hostname,
                                mobileLink: isMobileLinkRequest(req) })

  allowedHost(bag) = bag.mobileLink 或 非 requiresLocalHost 或 bag.hostname ∈ {localhost,127.0.0.1,[::1]}

agent 侧：
  bag.mobileLink = （请求局部标志 toonflowMobileLink 为真）
```

`toonflowMobileLink` 是应用与 agent 之间的**请求局部标志**（字符串键，`res.locals` 上），由 `mobileLink` 中间件写入；agent 只读不写，不 import 应用模块。这是本方案新增的**唯一**跨边界隐式契约，登记为 X-1（§7）。

**（6）注入位次（`app.ts`）**

```
... 步骤 3 platform.prepare(context)          ← 数据目录已定、conf 可安全求值
... 步骤 4–8 初始化（插件/技能/Agent/供应商/assets.warmup）
... 步骤 9 await media.refreshModels()
... 步骤 9.5 await (await import("./agentHost")).initializeAgentHost(context)   ← 新增 1 行
... 步骤 10 const router = await import("@/router"); router.default(app)        ← agent 首次求值
... 步骤 11 mcp.mount / 步骤 12 agentAccess.mount（E2 动态块）/ 13–15
```

不变量：`prepare 行号 < inject 行号 < router 行号`（A-10 ①）；`agentHost.ts` 的 agent 静态可达集**恰好** `{agent/host.ts}`（A-10 ②）；`app.ts` 的 agent 静态可达集为 0（A-10 ③）。

**（7）为什么不能用 `agentAccess.mount` 作为注入点**

`agentAccess.mount` 在 `router.default(app)` 之后；而 `routes/agent.ts` 等 6 条静态 import 在 router 装载时就会求值 agent → 注入晚于首次使用（违反 I2）。步骤 9.5 是唯一同时满足 C5 与 I2 的位置。

**（8）`app.ts` 行数**：78 → **79**（+1 行）。台账 L22 的 M1=80 需更正为 79（F-02，记录用）。

#### 验收映射

| 判据 | 期望 |
| --- | --- |
| A-09 | P7 的 `initializeAgentHost` 声明 1 / `app.ts` 调用 1 |
| A-10 | P8 位次 + P8b 两个可达集 |
| A-11 | P9 数据目录时序（`START_OK` / `CONF_JSON_OK` / `TOOLS_HTTP=200`） |
| A-26 | `assembly_members=14`、`missing_assembly=0` |
| A-23 | T10（负控制）证明缺组/缺符号会被发现 |

#### 风险

RK-3（时机）、RK-4（顶层捕获）、RK-13（Request 泄漏）。缓解：步骤 9.5 写死 + P8/P8b + P7b + F-03 的 bag 设计。

---

### 3.4 R-04 agent 消费点切换（B0–B4 五批）

#### 背景

74 条 A2P 中 50 条 `@/modules` + 1 条 `@/utils` + 23 条 lib/相对；其中 14 条位于 `run()`/`requests.ts`/`sessions.ts` 热路径。一次性改完不可回滚，且错误语义漂移无法定位。

#### 目标

A2P 74 → 0，**分 5 批严格等于**表中值；每批独立可回滚；错误 `message`/`status`/`code` 不变。

#### 描述

| 批次 | 阶段 | 内容 | 条数 | 批次后 A2P | 回滚点 |
| --- | --- | --- | --- | --- | --- |
| **B0** | M2 | `documentFormats` 5、`modelReasoning` 6、`mentionSources` 2 | **13** | 74 → **61** | revert 本批；lib shim 恢复直引 |
| **B1** | M3 | personalization 3、teams 4、tools 2、skills 1、documents 2 | **12** | 61 → **49** | 单批回滚 |
| **B2** | M3 | ai 5（`ai` 3 + `ai/files` 1 + `ai/requestFiles` 1）、`media/generation` 1、`ffmpeg` 1、**i18n 8**、**platform 2** | **17** | 49 → **32** | 单批回滚 |
| **B3** | M4 | `workspace/files` 12 + `chatImages` 1、`assets` 3 + `roots` 3、`browser` 1、`utils` 1（多目标行） | **21** | 32 → **11** | 单批回滚；S-07 必跑 |
| **B4** | M4 | `conf` 8、`mcp/control` 2 + `mcp/servers` 1 | **11** | 11 → **0** | 单批回滚 |

#### 详细方案设计

**（1）统一改造形态（每批同构）**

```
改造前:  文件顶部 import { X, Y } from "@/modules/<域>/<文件>"
改造后:  文件顶部 import { getAgentHost } from "@/agent/host"        // 契约叶子

调用点:
  函数体内  const host = getAgentHost()          // 函数作用域取一次，热路径友好
           ... host.<group>.X(...) ...
```

**硬性约束**：
- 禁止模块作用域 `const host = getAgentHost()`（A-09 的 `module_scope_refs=0`）；
- 允许函数作用域取一次后多次使用（`requests.ts`、`sessions.ts` 等热路径）；
- 不得改变参数顺序/默认值；不得吞异常；不得包装新错误类型；
- 不得新增任何 `@/modules`、`@/lib`、`@/utils` 目标。

**（2）B0（纯下沉，M2）**

| 边 | 现状 | 目标 |
| --- | --- | --- |
| `documentFormats` 5 | `assets.ts:11`、`mentionFiles.ts:7`、`mentions.ts:10`、`runtime/index.ts:29`、`sessions.ts:13` | `@toonflow/formats` |
| `modelReasoning` 6 | `a2a/settings.ts:9`、`delegation.ts:12`、`model.ts:3`、`runtime/index.ts:30`、`sessions.ts:14`、`runtime/types.ts:2`（相对） | `@toonflow/formats` |
| `mentionSources` 2 | `mentionSources.ts:8`（类型，相对）、`:135`（值，相对） | `@toonflow/formats` |

B0 之后：A2P 61（别名 61 / 相对 0 / 值 60）。

**（3）B1（低风险读取，M3）**

personalization（`tools/memory.ts:3`、`runtime/index.ts:26`、`resources.ts:9`）→ `host.personalization`；teams（`a2a/index.ts:8`、`teams/index.ts:9`、`teams/remote.ts:6`、`tools/subAgent.ts:8`）→ `host.teams`；tools（`teams/index.ts:10`、`tools/index.ts:16`）→ `host.tools`；skills（`skills/index.ts:7`）→ `host.skills`；documents（`assets.ts:12`、`tools/index.ts:19`）→ `host.documents`。

**（4）B2（模型 / 媒体 / i18n / platform，M3）**

| 子组 | 行 | 改造 |
| --- | --- | --- |
| models 5 | `runtime/index.ts:11`、`model.ts:4`、`sessions.ts:11`、`requests.ts:9`、`:10` | `host.models.*`（`FileRequestLimitError` 类引用直传） |
| media 2 | `tools/index.ts:2`、`:3` | `host.media.listMediaModels` / `generateMedia` / `createWorkspaceFfmpeg` |
| **i18n 8** | `delegation.ts:11`、`runtime/index.ts:28`、`mentions.ts:1`、`resources.ts:1`、`skills/index.ts:1`、`teams/index.ts:1`、`teams/remote.ts:1`、`tools/index.ts:1` | `host.i18n.t` / `translateMessage` / `translateError`；**调用点形态不变**（仍 `t\`...\``） |
| **platform 2** | `a2a/settings.ts:8`、`resources.ts:11` | `host.platform.getRuntimePlatform()`；**每次调用都经 Host** |

> 批次门：B2 后 A2P 必须 = **32**。若只迁 i18n 不迁 platform（或反之），会是 40 / 34 → 直接失败（D-07）。

**（5）B3（安全敏感，M4）**

| 子组 | 行 | 改造要点 |
| --- | --- | --- |
| workspace 13（目标 14） | `assets.ts:8`、`delegation.ts:10`、`imageAttachments.ts:6`、`mentions.ts:9`、`permissions.ts:5`、`resources.ts:8`、`sessions.ts:12`、`toolOutput.ts:6`、`tools/index.ts:5`、`:15`、`a2a/settings.ts:7` + 多目标行 | 文件锁与越界校验**逐条保留**：`lockWorkspaceFiles` 的 `try/finally` 结构不变；`protectWorkspaceRoot` 调用顺序不变 |
| assets 6（目标 7） | `assets.ts:6`、`:7`（类型）、`mentions.ts:7`、`:8`、`mentionFiles.ts:8`、`:9`、多目标行 | `openAssetLibrary` 不传 `req`；`AssetLibrarySelector` 用契约类型 |
| browser 1 | `tools/index.ts:4` | `host.browser.createBrowserContext` |
| utils 1（多目标） | `mentionFiles.ts:3` | 同一提交内把 `u.workspaceFile.resolveWorkspacePath` → `host.workspace.*`、`u.assets.getAssetsDirectory` → `host.assets.*`（F-09） |

> B3 必跑 S-07（越界 400 `文件路径无效`）与 S-01（流式）；任一失败回滚本批。

**（6）B4（配置 / MCP，M4）**

| 子组 | 行 | 改造要点 |
| --- | --- | --- |
| conf 8 | `a2a/settings.ts:5`、`runtime/requests.ts:11`、`permissions.ts:3`、`preferences.ts:1`、`resources.ts:10`、`sessions.ts:10`、`skills/index.ts:6`、`tools/index.ts:14` | `get` → `host.settings.get`；`conf.path` 5 处 → `settingsPath()`（外层 `dirname` 保留） |
| mcp 3 | `a2a/settings.ts:6`、`a2a/index.ts:9`、`tools/index.ts:20` | `host.mcp.getAppOrigin(bag)`（5 字段）、`getConnection`、`callControl`、`createMcpAgentTools` |

B4 后 A2P = **0**；M4 的 SCC 变 2/0、`e7` 消失。

**（7）每批的错误语义对照（必须逐条保留）**

`400 文件路径无效`、`403 只能复制普通文件或文件夹`、`409 对话正在运行，请等待回复完成`、`409 画布正在保存，请重试`、`413 个性化文档不能超过 20000 个字符`、`A2A 设置已修改，当前任务已取消`、`403 只允许 Toonflow 页面访问控制连接`、`403 页面来源无效`、`403 页面来源与服务地址不一致`。

#### 验收映射

| 判据 | 每批 | 交付态 |
| --- | --- | --- |
| A-01/A-02/A-03 | 批次后 A2P 严格等于表中值 | 0 / 0 / 0 |
| A-15 | 每批跑 S-01/S-05/S-07/S-09（B3 另跑 S-12） | 16/16 |
| A-24/A-26 | M0 与 M5 的归属/可达 | `unmapped=0` / `missing_*=0` |

#### 风险

RK-2（语义漂移）、RK-14（清单过期）。缓解：错误对照表 + 批次门 + P20 双向差集。

---

### 3.5 R-05a / R-05b 纯契约下沉（`packages/formats`）

#### 背景

13 条 A2P 边指向三个**零依赖纯模块**（`documentFormats`、`modelReasoning`、`mentionSources`）。它们没有进程态、不需要装配、不需要请求上下文——按矩阵 §1.6 的分组规则，它们**不该进 Host**，而应下沉到 foundation。另有 1 条反向类型边（`conf → agent/a2a/settings` 的 `A2aSettings`）必须在 M1 消除，否则 A-04/A-05 的 3 文件/13 行不可达。

#### 目标

M1 建立 `packages/formats`（3 个代码文件）并消除 `conf→agent` 类型边；M2 补齐另外两个纯模块；`@toonflow/server/{documentFormats,modelReasoning}`、`@toonflow/server/agent/mentionSources` 三个 path 不变。

#### 描述

| 文件 | 来源 | 阶段 | 内容 |
| --- | --- | --- | --- |
| `packages/formats/src/modelReasoning.ts` | `apps/server/src/lib/modelReasoning.ts` **逐字节复制** | M1 | `thinkingLevels`、`defaultThinkingLevels`、`ThinkingLevel`、`ReasoningEfforts` |
| `packages/formats/src/a2a.ts` | `agent/a2a/settings.ts:11–18` 的类型 | M1 | `A2aSettings`（`thinkingLevel?: ThinkingLevel`） |
| `packages/formats/src/index.ts` | 新增 | M1（M2 追加） | 显式再导出 |
| `packages/formats/src/documentFormats.ts` | `lib/documentFormats.ts` 逐字节复制 | M2 | 文件类型表与文本解码 |
| `packages/formats/src/mentionSources.ts` | `lib/mentionSources.ts` 逐字节复制 | M2 | `MentionQuery`、`mentionAssetType`（同包引用 `./documentFormats`） |

#### 详细方案设计

**（1）包结构（D-06 默认 A：根入口 + 子路径导出）**

```
packages/formats/
  package.json      // name=@toonflow/formats, type=module, exports: "." + 4 条子路径, scripts.typecheck（F-13）
  tsconfig.json     // 继承 ../../tsconfig.base.json；include: ["src"]
  src/index.ts      // 显式再导出（M1: modelReasoning + a2a；M2: + documentFormats + mentionSources）
  src/{modelReasoning,a2a,documentFormats,mentionSources}.ts
```

- **零依赖**：`dependencies` 为空；不得 import `apps/server` 或任何域包；
- **`typecheck` 脚本必须有**（F-13）：否则根 `typecheck` 的 `--filter '@toonflow/*'` 会静默跳过本包 → A-12 假通过；
- 根 `workspaces: ["packages/*"]` 已覆盖，无需改根配置；`apps/server/package.json` 增加 `"@toonflow/formats": "workspace:*"`（不是 exports 变更，A-14 不受影响）。

**（2）shim 形态（禁止 `export *`）**

```
apps/server/src/lib/modelReasoning.ts（M1 起）:
    export { thinkingLevels, defaultThinkingLevels } from "@toonflow/formats/modelReasoning"
    export type { ThinkingLevel, ReasoningEfforts } from "@toonflow/formats/modelReasoning"

apps/server/src/lib/documentFormats.ts、mentionSources.ts（M2 起）: 同构

禁止:
    export * from "@toonflow/formats"        // 会把 a2a 等符号带到 @toonflow/server/modelReasoning 的公开面
```

**（3）迁移顺序（避免"边先断、模块后建"的中间态编译失败）**

```
M1:  建包（modelReasoning 副本 + a2a + index） → lib/modelReasoning 改 shim
     → conf/index.ts 改 import type A2aSettings from formats
     → agent/a2a/settings.ts 改 import + export type
     → apps/server 加 workspace 依赖 → typecheck
M2:  加两个副本 → 两个 lib shim → agent 的 13 条边（含 M1 已建副本的 modelReasoning 6 条）改指 formats → typecheck
```

**（4）逐字节复制的校验方式**（A-18 ①）：`diff <(git show 89572b5:旧路径) 新路径` 为空；3 个副本 + 3 个 shim 的 `SHIM_OK`/`PURE` 由 P13 判定。

#### 验收映射

A-17（新增代码文件 6/8、非代码 2、`files_total` 712/714）、A-18（`IDENTICAL`/`SHIM_OK`/`PURE` 各 3）、A-14（3 个 path 不变）、A-26（`missing_b0=0`）。

#### 风险

RK-9（新包构建链）。缓解：零依赖 + 自带 `typecheck` + M1 先建包再接边。

---

### 3.6 R-06 装配序列（只增不改语义）

#### 背景

现有 15 步装配靠人工纪律维持；三宿主共用 `createApp`。新增注入必须插在"数据目录已定、`conf` 已初始化、agent 未求值"的唯一窗口。

#### 目标

步骤 9.5 固化；9 处入口动态块不变；桌面/移动的 `setRuntimeHost` 先于 `createApp` 的现状不变。

#### 描述

装配序列**只增加**"步骤 9.5"一项，其余 15 步的语义、位次与责任方不变；三宿主仍全部经 `createApp`，桌面/移动的 `setRuntimeHost` 位次不变。

#### 详细方案设计

| 步骤 | 现状 | 本方案 | 责任方 |
| --- | --- | --- | --- |
| 0 | 设 `TOONFLOW_DATA_DIR` | 不变 | `createApp` 入参 |
| 1 | `Promise.all` 装载 7 个入口 | 不变 | 组合根 |
| 2 | 构造 `ModuleContext` | 不变 | 组合根 |
| 3 | `platform.prepare` | 不变 | platformCore |
| 4–8 | 插件/技能/Agent 目录、`media.initializeProviders`、`assets.warmup` | 不变 | 各模块 |
| 9 | `media.refreshModels` | 不变 | mediaGeneration |
| **9.5** | — | **`initializeAgentHost(context)`**（建 Host + 注入） | bootstrap |
| 10 | `await import("@/router")` → `router.default(app)` | 不变（**agent 首次求值点**） | 组合根 |
| 11 | `mcp.mount` | 不变 | mcpIntegration |
| 12 | `agentAccess.mount`（E2 动态块） | 不变 | agentAccess |
| 13–15 | 静态资源、错误处理、`local.initializeRuntime` | 不变 | 组合根/localRuntime |

三宿主校验（S-13c）：桌面 `setRuntimeHost("desktop")` 行号 235 < `createApp` 240、`app.listen`=0、`@/agent`=0；移动 21 < 108、`app.use(toonflow)`=1、`@/agent`=0。

**禁止**：把 `initializeAgentHost` 挂到模块入口静态面（会在 `Promise.all` 阶段求值 Host 实现，把 6 个域提前装载）；挪到 `agentAccess.mount`（晚于 router，违反 I2）。

#### 验收映射

A-10（P8/P8b）、A-11（P9）、S-13a/b/c、A-20（AGENTS.md 步骤 9.5 登记）。

#### 风险

RK-3（时机错误）：P8 三条子断言 + P8b 可达集，任一不成立即 M1 门失败；回滚见 §8。

---

### 3.7 R-07 / R-08 契约冻结（web / 桌面 / 移动 / providers）

#### 背景

web 直接编译 `@toonflow/server` 源码，对 14 个 exports 有 **38 条**静态导入；桌面/移动经 `@toonflow/server/{i18n,platform,mcp,browser,desktop}` 复用；`@toonflow/providers` 是 agent 取模型的底层。

#### 目标

导出路径冻结、类型形状冻结、providers 零改动。

#### 描述

用"逐字快照 + 编译"代替"运行时验证"：14 个导出路径与类型形状是不可动契约；providers 的依赖表不动，agent 取模型目录改走 Host。

#### 详细方案设计

| 冻结对象 | 内容 | 校验 |
| --- | --- | --- |
| 14 个 exports | `"./app"`、`"./remoteConnection"`、`"./desktop"`、`"./platform"`、`"./documentFormats"`、`"./nodeMenu"`、`"./modelReasoning"`、`"./mcp"`、`"./mobileLink"`、`"./browser"`、`"./agent/types"`、`"./singleAgent/types"`、`"./agent/mentionSources"`、`"./i18n"` —— **target 全部不变**，只允许实现文件内部改来源 | P10 逐字快照比对 |
| 类型形状 | `AgentEvent`、`ThinkingLevel`、`A2aSettings`、`AssetLibrarySelector`、`RequestFile`、`RuntimePlatform`、`MobileLinkConfig`、`RemoteTeam`、`nodeMenu` | A-12 + web build |
| web 导入 | 38 条 `@toonflow/server/*` 零改动 | `apps/web` typecheck + build |
| providers | `packages/providers` 的 `exports`/`dependencies` 零改动；agent 经 `host.models` 取模型目录 | R-08 + A-14 |

**注意**：`packages/formats` 是**新包**，不在 14 个 exports 内；`apps/server` 对它是 `workspace:*` 依赖，不是导出路径变更。

#### 验收映射

A-14（P10 + web typecheck/build）、A-15（S-06/S-09 覆盖 MCP、S-12 覆盖 i18n）、NG8。

#### 风险

RK-8（导出路径破坏宿主）：只在 build:web 或宿主启动时暴露；缓解是「exports target 逐字冻结 + P18 静态装配计数」。

---

### 3.8 R-09 / R-12 口径、归属与预算

#### 背景

地图 glob 与计数口径未冻结；任何结构改造都会新增文件，若不分阶段，"数字随实施漂移"会让结论不可复现。

#### 目标

口径冻结、归属迁移可审计、新增文件逐里程碑可判。

#### 描述

两件事分开管：**口径**（归因算法、计数正则、glob 集合）只允许"新增登记"，**文件预算**（新增代码/非代码、`files_total`）按里程碑精确到个位。二者都由探针复算，不靠人工记账。

#### 详细方案设计

**（1）口径冻结（A-16）**

- 归因算法与 P1–P21 的正则**逐字冻结**（矩阵 §6.5 文本为准，实施期不得改写）；
- `map.json` 的 `modules[].files` glob 集合 = M0 集合 ∪ **3 条新增**（`apps/server/src/agentHost.ts`、`apps/server/src/agentRuntime.ts`、`packages/formats/**`），删除 0、改写 0；
- 包归属若需登记：新增 `@toonflow/formats → shared-foundation` 一行（属 manifest，不算漂移）。

**（2）归属迁移（A-17/A-18）**

| 项 | 内容 |
| --- | --- |
| 逐字节副本 | 3 个（`documentFormats`、`modelReasoning`、`mentionSources`），`diff` 为空 |
| 旧路径 shim | 3 个（同名 lib 文件改为具名再导出，`SHIM_OK` + `PURE`） |
| 新增跨模块深引 | **1** 个（`agentHost.ts`，importer 侧） |
| 新增 source→target 子模块对 | **0** |
| 覆盖 | `uncovered=0`、`coverage_ratio=1.0` |

**（3）预算（A-17，逐里程碑）**

| 阶段 | `code_new` | `noncode_new` | `files_total` | 新增集合 |
| --- | --- | --- | --- | --- |
| M0 | 0 | 0 | 706 | — |
| M1 | **6** | 2 | **712** | formats 的 `modelReasoning`/`a2a`/`index` + `agent/host.ts` + `agentHost.ts` + `agentRuntime.ts` |
| M2 | **8** | 2 | **714** | + formats 的 `documentFormats`/`mentionSources` |
| M3–M5 | 8 | 2 | 714 | 无新增 |

超出集合即视为范围变更，**回评审**（禁止"顺手多建一个文件"）。

#### 验收映射

A-16（P11）、A-17（P12 + P14）、A-18（P13）、T2（P14 自检）。

#### 风险

RK-6（口径漂移）、RK-10（多建文件）：P11 集合相等 + P14 精确集合 + T2 自检三重兜底。

---

### 3.9 R-13 归属清单与可达性（74/74 → 0 的证明链）

#### 背景

74 条边若没有逐行去向，"归零"只能靠删功能。第 4 轮打回正是"10 条边无归属"。

#### 目标

74/74 行有唯一去向；M5 每个去向真实存在；`unmapped=0` 与 `missing_*=0` 同时成立才允许判 A-01/A-03 为 0。

#### 描述

先证"每条边有去向"（归属完备），再证"每个去向真实存在"（可达性），最后才允许把"边 = 0"当作结论。三者缺一，归零即视为不可达。

#### 详细方案设计

**（1）三层证明链**

```
第 1 层（M0 基线）  Appendix E：74 行 file:line → dest（人读）
                     P20（M0）：实际行集 ∩ manifest 行集 双向差集
                                 unmapped=0 且 stale=0
第 2 层（M1–M4）    每批迁移后 A2P 严格等于批次表；manifest 不变（清单是 M0 的事实）
第 3 层（M5）       P20（M5）：host_members=14 / assembly_members=14 / symbols=60
                                 missing_groups=missing_assembly=missing_b0=symbol_missing=0
                    → 此时才允许 A-01（0）/A-03（0）判 PASS
```

**（2）计数的三件事必须一致**

| 指标 | 值 | 一致性来源 |
| --- | --- | --- |
| 行数 | 74 = 61（Host）+ 13（B0） | Appendix E / P20 `a2p` / `manifest` |
| 目标数 | 75 = 62（Host）+ 13（B0） | `host_dest=62`、`dest=75` |
| 多目标行 | 1（`agent/mentionFiles.ts:3` → workspace+assets） | `multi=1` |

**（3）清单维护责任**

Appendix E（人读）与 P20 的 `MANIFEST`（机读）**必须同步**；只改一处会让 `unmapped` 或 `stale` 非 0（RK-14）。实施中若因外部改动新增 A2P 行（F-01），**不得**就地补清单，必须回需求评审（矩阵 §6.2 规则 4）。

#### 验收映射

A-24（M0）、A-26（M5）、T9/T10（两个负控制）。G8：A-01/A-03 判 0 前必须先有 A-24/A-26。

#### 风险

RK-14（清单过期）、RK-17（基线漂移）：stale 与 unmapped 都判 FAIL；外部改动必须回评审。

---

### 3.10 R-14 探针补齐与自检扩项

#### 背景

A-22 的静态三项（`conf.onDidChange=0`、`registerA2aSettingsWatcher=1`、`onChange=1`）在 v4 只在正文出现，没有可粘贴的探针块；新增归属/`e9` 探针后自检项数不足。

#### 目标

P19/P20/P21 可执行、可自证、可复跑；自检 11 项（T1–T11）含 5 个负控制。

#### 描述

把每个 A 项的"证据来源"固定成一个可粘贴的探针块，并给每个新探针配一个**能把它判 FAIL** 的自检（正控 + 负控），防止"自检通过但探针空转"。

#### 详细方案设计

| 探针 | 判据 | M0 期望 | M5 期望 | 自检 |
| --- | --- | --- | --- | --- |
| **P19**（静态） | A-22 | `1/0/0/0` | `0/1/1/1` | T8（`1/1/1/1`） |
| **P20**（归属） | A-24 / A-26 | `a2p=74 unmapped=0 host=61 host_dest=62 b0=13 i18n=8 platform=2 groups=14 dest=75 multi=1` | `a2p=0 host_members=14 assembly_members=14 missing_*=0 symbols=60 symbol_missing=0` | T9（`unmapped=1`）/ T10（缺组缺符号） |
| **P21**（`e9`） | A-25 | `computed=24 label_match=1` | `computed=16 label_match=1` | T11（`label_match=0`） |

**P19 的四种计数口径**（避免注释/同行调用误判）：`conf.onDidChange(` 全 agent 计数（去注释后）→ M5 必须 0；`export function registerA2aSettingsWatcher(` → 1；调用数 = 总出现数 − 声明数 → 1；`agent/host.ts` 行首 `onChange(` → 1。

**自检执行顺序**（每次里程碑都跑，防回退）：T1（建 AST 脚本）→ T3/T4/T5 → T6/T7 → T8 → T9/T10 → T11 → T2。任一不等于期望即 G5 FAIL，探针结果不得使用。

#### 验收映射

A-23（11/11）、G5、G7（`fixture_audit entries=11 self_contained=11 run_bound=11 cross_reuse=0`）。

#### 风险

RK-7（自检空转）：5 个负控制 + fixture 归属审计；自检不过时探针结果不得使用。

---

### 3.11 R-15 `e9` 定义与标签同步

#### 背景

`e9` 是地图模块边 `server-api → agent-runtime`，标签 `24 处 agent 会话与 teams 契约`。v4 在 G3 写成"保留且计 13"，但 13 只是 P3b 的源码行，漏了 3 条包契约。

#### 目标

定义唯一、计数可复算、标签同步。

#### 描述

`e9` 是"应用→agent"的**保留边**（允许方向），只需把计数与标签说清楚、可复算，不追求归零；它的价值是作为 A-01/A-03 的反向对照——正向归零后，反向仍应恰好剩 16。

#### 详细方案设计

| 项 | 规则 |
| --- | --- |
| 定义 | 地图边 `server-api → agent-runtime`，`type: import`；标签前导整数 = **P3b 行 + P4 行** |
| 计数 | M0 `21 + 3 = 24`；M5 `13 + 3 = 16`（P3b 的 13 = 静态值 11 + 静态类型 1 + 动态 1） |
| 标签 | M5 必须为 `16 处 agent 会话与 teams 契约`（`map.json` 重算时同步） |
| 为什么不归零 | 应用→agent 是**允许方向**；门面 + 装配文件 + 冻结动态块是设计结果（E14） |
| 判定 | P21：`e9_exists=1`、`direction_ok=1`、`label_match=1`；M0 `computed=24`、M5 `computed=16` |
| 禁止 | 把 `13` 当 `e9`（漏 3 条包契约）；只改源码不改标签（`label_match=0`） |

#### 验收映射

A-25、G3（双算）、R-11 的 AGENTS/地图更新清单、T11。

#### 风险

RK-15（标签不同步）：源码降到 16 而 map.json 仍写 24 或 13 → label_match=0 直接 FAIL。

---

## 4. 里程碑实施计划（M1–M5）

> 每个里程碑都是**可独立验收**的交付单元；任一分项不等于表中值即失败（不允许"下降即可"）。

### 4.1 里程碑任务与门禁

| 里程碑 | 交付内容（新增/改动） | 关键动作 | 交付门（全过才算完成） |
| --- | --- | --- | --- |
| **M0** | 无代码改动 | 冻结基线：P1–P21 全量采集 + 11 项自检复跑 | 台账 L01–L28 的 M0 列可复现；T1–T11 = 11/11；P20 `unmapped=0`；P21 `computed=24` |
| **M1** | 新增 6 代码 + 2 非代码：`packages/formats/{modelReasoning,a2a,index}.ts`、`agent/host.ts`、`agentHost.ts`、`agentRuntime.ts`；改 `utils.ts`、5 处域文件、`conf`、`a2a/settings.ts`、`app.ts` | 建 contracts → 建门面 → 反向收敛 → 建 formats → 注入 9.5 | **A2P 仍 = 74**（只加不改）；P2A 13 行/3 文件；D1b 10/5；`utils` 38 键；`failfast_exit 0`；`computed=16`；typecheck/build/S-01～S-13 全过 |
| **M2** | +2 代码（formats 的 `documentFormats`/`mentionSources`）与 2 个 lib shim 改造 | B0 纯下沉 | A2P = **61**（61/0/60）；`files_total=712→714`；`code_new=8`；S-01/S-05/S-07/S-09 过 |
| **M3** | B1 + B2 | 低风险读取 → 模型/媒体/i18n/platform | A2P = **32**（32/0/31）；**i18n 8 与 platform 2 必须同批** |
| **M4** | B3 + B4 | 安全敏感 → 配置/MCP | A2P = **0**；SCC `2/0`；`e7` 不存在；S-07/S-09/S-10/S-12 重点 |
| **M5** | 文档/地图/AGENTS/全量判据 | R-06/R-07/R-08/R-09/R-11/R-12/R-13/R-14/R-15 收口 | A-01～A-26 全 PASS（含 11 项自检）；`e9=16` 且标签同步；AGENTS 模块表与 §6.8 逐字相等 |

### 4.2 逐里程碑精确期望（与矩阵 §5 一致）

| 里程碑 | A2P 别名/相对/合计/值 | P2A 源值/型/动态 | 包契约 | P2A 文件 | D1b 行/文件 | `utils` 键 | SCC 总/含 agent | `e7` | `e9` | 新增代码/总文件 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| M0 | 71 / 3 / 74 / 68 | 17 / 3 / 1 | 3 | 11 | 0 / 0 | 37 | 3 / 1 | 存在 | 24 | 0 / 706 |
| M1 | 71 / 3 / 74 / 68 | **11 / 1 / 1** | 3 | **3** | **10 / 5** | **38** | 3 / 1 | 存在 | **16** | **6 / 712** |
| M2 | **61 / 0 / 61 / 60** | 11 / 1 / 1 | 3 | 3 | 10 / 5 | 38 | 3 / 1 | 存在 | 16 | **8 / 714** |
| M3 | **32 / 0 / 32 / 31** | 11 / 1 / 1 | 3 | 3 | 10 / 5 | 38 | 3 / 1 | 存在 | 16 | 8 / 714 |
| M4 | **0 / 0 / 0 / 0** | 11 / 1 / 1 | 3 | 3 | 10 / 5 | 38 | **2 / 0** | **不存在** | 16 | 8 / 714 |
| M5 | 0 / 0 / 0 / 0 | 11 / 1 / 1 | 3 | 3 | 10 / 5 | 38 | 2 / 0 | 不存在 | 16 | 8 / 714 |

> M1 的 SCC 仍是 `3 / 1` 是**设计结果**（F-10：`utils.ts → agentRuntime.ts → agent/mentionFiles.ts → utils.ts` 的最小环要到 B3 才断），不是回归。

### 4.3 实施顺序（依赖关系）

```
M1:  ① packages/formats 骨架（含 typecheck 脚本）        ← F-13
     ② agent/host.ts（14 组、60 符号）
     ③ agentRuntime.ts（11 说明符）
     ④ utils.ts + 5 个域文件改指门面 + conf 类型边迁 formats
     ⑤ agentHost.ts（14 组装配）
     ⑥ a2a/settings.ts watcher 惰性化
     ⑦ app.ts 步骤 9.5（+1 行）
     ⑧ typecheck → build → 13 项冒烟
M2:  ⑨ formats 两个副本 → lib 两个 shim → 13 条边改指 formats
M3:  ⑩ B1（12 条）→ ⑪ B2（17 条，i18n 8 + platform 2 必须同批）
M4:  ⑫ B3（21 条，含多目标行）→ ⑬ B4（11 条）
M5:  ⑭ AGENTS/地图/子图重算 → ⑮ e9 标签 16 → ⑯ A-01～A-26 + 11 自检
```

---

## 5. 验收与复检执行方案

### 5.1 A-01～A-26 的"实施动作 → 探针"映射（方案视图）

| 判据 | 方案对应设计点 | 探针 | M5 期望 |
| --- | --- | --- | --- |
| A-01 / A-02 / A-03 | §3.4 五批迁移 + §3.1 契约 60 符号 | P1 / P2 / P1+P2 | `0 / 0 / 0` |
| A-04 / A-05 / A-06 | §3.2 门面 + A2A 动态块 + formats | P3a / P3b / P4 | 3 文件 / 13 行 / 3 |
| A-07 | §3.2 `utils.ts` 38 键 | P5a / P5b | 0 / 38 |
| A-08 | §3.4 B4 后 SCC | P6 / P6b | 2 / 0 / 0 |
| A-09 | §3.1 生命周期 + §3.3 注入 | P7 / P7b / P15 | 7 项 + `module_scope_refs=0` + exit 0 |
| A-10 | §3.3 步骤 9.5 + §3.6 | P8 / P8b | prepare<inject<router；可达集恰好 `{host.ts}` |
| A-11 | §3.3 注入晚于数据目录 | P9 | START_OK / CONF_JSON_OK / 200 |
| A-12 / A-13 | §3.1 结构型重声明 + §3.5 包 | typecheck / build | exit 0 |
| A-14 | §3.7 冻结 | P10 | 14 exports 逐字相等 |
| A-15 | §3.4 每批回归 | §6.4 冒烟 | 16/16 |
| A-16 | §3.8 口径冻结 | P11 | 新增恰 3 条 |
| A-17 | §3.8 预算 | P12 / P14 | 714 / 8 / 2 |
| A-18 | §3.8 迁移 | P13 | 3 IDENTICAL + 3 SHIM_OK + 3 PURE + 1 DEEP |
| A-19 | §5.3 探针只在 /tmp | 过滤命令 | 0 命中 |
| A-20 | §3.6 + §3.2（依赖表不变） | §6.8 比对 | 8 行逐字相等 |
| A-21 | §3.2 D1b | P17 | 10 / 5 |
| A-22 | §3.2 惰性 watcher | P19 + P16 + S-05 | `0/1/1/1` + 双相 |
| A-23 | §3.10 自检 | T1–T11 | 11/11 |
| A-24 | §3.9 归属 | P20（M0） | `unmapped=0` 等 11 项 |
| A-25 | §3.11 `e9` | P21 | `computed=16 label_match=1` |
| A-26 | §3.9 可达 | P20（M5） | 14/14/60/`missing_*=0` |

### 5.2 执行顺序（每次复检固定）

```
0. 环境：ROOT=仓库根；BUN 不在 PATH 时显式指定（矩阵 §6.5 约定）
1. 自检先行：T1–T11（11/11）           ← 不过则后续探针结果不得使用（G5）
2. 计数类：P1/P2/P3a/P3b/P4/P5a/P5b    ← 双算（grep + Python），不等即 FAIL（G3）
3. 结构类：P6/P6b/P7/P7b/P8/P8b/P12/P13/P14/P17/P19
4. 归属类：P20（M0/M5）、P21（M0/M5）
5. 运行类：P9（数据目录）、§6.4 冒烟 16 子断言、P15/P16
6. 构建类：typecheck / build / web typecheck+build（A-12～A-14）
7. 记录：台账 L01–L28 每个里程碑一行（记录用，不作结论）
```

### 5.3 证据留存与边界（C4）

- 所有探针、fixture、临时仓库一律在 `/tmp`；执行后删除；
- **不新增**测试文件、自检脚本、npm 脚本、CI 入口（A-19 判定）；
- 复检证据以"命令 + 输出 + 退出码"三段留在评审记录中，不写入仓库；
- 方案级一次性检查 `s1–s6`（§5.4）同样只在 `/tmp` 执行。

### 5.4 方案级一次性检查（s1–s6，验证设计假设，不作为验收判据）

| 编号 | 检查 | 目的 | 期望 |
| --- | --- | --- | --- |
| s1 | `bun run typecheck`（含 formats） | 证明结构型重声明可赋值（F-04） | exit 0 |
| s2 | 附录 B 的 60 符号 vs `agent/host.ts` 文本 | 证明契约不缺符号 | 60/60 命中 |
| s3 | P20（M5）在 M1 后的 dry-run（用 `agentHost.ts` 真实文件） | 证明 14 键缩进可被判据计数 | `assembly_members=14` |
| s4 | P8 的位次检查 | 证明步骤 9.5 落在窗口内 | prepare<inject<router |
| s5 | 同一请求下 `getAppOrigin(req)` vs `resolveAppOrigin(bag)` 的等价性（4 组头组合 × 有/无 origin） | 证明 F-03 的 bag 适配无行为漂移 | 返回值/异常类型与文案逐步相等 |
| s6 | `i18n.t` 的 tagged template 直传（`host.i18n.t\`x ${v}\``） | 证明 F-06 不被包装 | 输出与直连 `lib/i18n.t` 逐字符相等 |

---

## 6. UI / 前端影响说明（web-console）

### 6.1 结论：**零 UI 变更**

本需求是后端结构性重构。**没有**新增/删除/改名的界面元素、路由、交互或视觉样式；`web-console` 的源码**零改动**（只做编译期契约校验与回归）。因此本节不涉及"新界面设计"，只给出**契约级设计约束 + 回归设计**。

### 6.2 受影响面（编译期，非视觉）

| 面 | 是否变化 | 设计约束 |
| --- | --- | --- |
| `@toonflow/server/*` 的 14 个导出路径 | 不变 | target 逐字冻结（A-14） |
| web 的 38 条导入 | 不变 | 类型形状不得变（`AgentEvent`、`ThinkingLevel`、`A2aSettings`、`nodeMenu` 等） |
| NDJSON 事件 | 不变 | `session`/`userMessage`/`text`/`done`/`error` 的字段与顺序不变（S-01/S-10） |
| 错误文案 | 不变 | 见 §3.4(7) 的 9 条精确文案；前端按 `message` 展示，逐字冻结 |
| i18n 文案与语言切换 | 不变 | `Accept-Language` 逐请求生效（S-12 双串） |
| 设置页字段 | 不变 | `a2a`、`mcp`、`settings.agent` 的读写字段不变（S-13a/S-09） |

### 6.3 界面回归设计（7 项，逐条给"现象 → 断点方向"）

| # | 界面/场景 | 用户可见现象（若设计出错） | 断点方向 | 对应判据 |
| --- | --- | --- | --- | --- |
| U-1 | 主对话（`/api/agent` 流式） | 首字不出现、无 `done`、或 `type=error` | 注入位次 / Host `models` / i18n 转发 | S-01、A-10 |
| U-2 | 单 Agent 面板（`/api/singleAgent/run`） | 事件序列缺 `status` 或 `complete` | 门面 `configureAgentRequests` / `createAgentToolContext` | S-10、A-21 |
| U-3 | A2A 设置页（启用/保存/取消任务） | 保存后任务不取消；或保存即 500 | watcher 惰性注册 / `settings.onChange` | S-05、A-22 |
| U-4 | MCP 状态页（`/api/mcp/status`） | 403 或来源校验误判 | `getAppOrigin` bag（F-03） | S-09、s5 |
| U-5 | 技能 / 团队列表 | 列表为空或技能全部禁用 | `skills.directory()/isEnabled()` 被求值冻结（F-08） | S-11、A-26 |
| U-6 | 素材提及（`/api/agent/mentionSource`） | 提及下拉为空 / 素材打不开 | 多目标行 `mentionFiles.ts:3` 只改一半（F-09） | S-08、A-24 |
| U-7 | 工作区文件错误提示 | "文件路径无效"变成 500 或文案变化 | workspace 转发丢 `status:400` | S-07、§3.4(7) |

### 6.4 UI 红线（评审可逐条驳回）

1. 不得为配合端口而修改任何前端文件（`apps/web/**` 零改动）；
2. 不得调整错误文案、状态码或 NDJSON 字段（前端依赖）；
3. 不得把 locale 放进 Host 状态（会串语言）；
4. 不得让 `tools/list` 的工具集合变化（当前 46 个，名称排序与 M0 逐项相等）；
5. 桌面/移动宿主的 `setRuntimeHost` 调用位次不变（S-13c）。

> 若评审要求"顺手改 UI"，属于范围变更，本方案不覆盖，需另立需求。

---

## 7. 风险登记与缓解

### 7.1 承接需求矩阵的 RK-1～RK-15（方案侧补充）

| 编号 | 风险 | 方案侧缓解 | 检出 |
| --- | --- | --- | --- |
| RK-1 | 端口过宽 → 上帝对象 | 14 组 + 只转发 + 无预留；符号与 74 行一一对应（附录 B/C） | A-01/A-26 + 评审 |
| RK-2 | 语义漂移（错误码/文案/文件锁） | 错误对照 9 条；B3 单独一批；文件锁 `try/finally` 结构不动 | A-15、批次门 |
| RK-3 | 注入时机不当 | 步骤 9.5 写死；P8/P8b 三条子断言 | A-10/A-11 |
| RK-4 | 顶层捕获 | 契约叶子无副作用；函数作用域取 Host；P7b | A-09、T1 |
| RK-5 | watcher 回退到模块顶层 | 惰性注册唯一形态（§3.2(4)）；P19 | A-22、T8 |
| RK-6 | 口径漂移 | 口径冻结 + P11 + 双算 | A-16/A-25 |
| RK-7 | 自检空转 | 11 项含 5 负控制；G7 归属审计 | A-23 |
| RK-8 | 导出路径破坏 web/桌面/移动 | exports 逐字冻结 + P18 | A-14、S-13c |
| RK-9 | 新包构建链 | 零依赖 + 自带 `typecheck`（F-13） | A-12 |
| RK-10 | 里程碑多建文件 | 精确集合 + P14 | A-17、T2 |
| RK-11 | i18n ALS 被破坏 | 引用转发 + S-12 逐字符 | A-15、A-26 |
| RK-12 | `conf.path` 无去向 | `settingsPath()` 覆盖 5 处 | A-26、T10 |
| RK-13 | `Request` 进端口 | bag 5 字段 + `resolveAppOrigin` | A-26、s5 |
| RK-14 | 归属清单过期 | Appendix E 与 MANIFEST 同步；双向差集 | A-24、T9 |
| RK-15 | `e9` 标签不同步 | P21 + R-11 同步动作 | A-25、T11 |

### 7.2 方案新增风险

| 编号 | 风险 | 触发 | 影响 | 缓解 |
| --- | --- | --- | --- | --- |
| **RK-16** | bag 适配与 `getAppOrigin(req)` 不等价（F-03） | 只在"桌面/开发 + 移动互联 + 带 Origin"组合下暴露 | A2A 鉴权多放行/多拒绝 | `resolveAppOrigin` 单一实现 + `s5` 等价性检查 + S-09 回归 |
| **RK-17** | 基线漂移导致 A-24 不可达（F-01） | 并行任务先合入 | `unmapped=1`，A-01/A-03 不得判 PASS | D-01 默认 B；合入前必须回评审（禁止就地放宽） |
| **RK-18** | formats 的 `typecheck` 缺失 → A-12 假通过（F-13） | 忘配 `scripts.typecheck` | 新包类型错误无人发现 | §3.5 写死脚本；M1 门禁显式核对 `bun run --filter '@toonflow/formats' typecheck` 有输出 |
| **RK-19** | 结构型重声明与实现漂移（F-04） | 应用侧改了 `RequestFile` 字段而契约未跟 | 运行期字段缺失 | typecheck 可赋值性（返回类型协变 + 参数逆变）+ A-12 |
| **RK-20** | 门面被继续扩大（"顺手多导一个"） | 后续需求新增 agent 能力 | 反向收敛失效 | 门面导出表**逐符号可驳回**（A-05/A-21） |

### 7.3 外部协同项（X）

| 编号 | 内容 | 责任方 | 处置 |
| --- | --- | --- | --- |
| **X-1** | 请求局部标志 `toonflowMobileLink`（`res.locals` 字符串键）：应用写、agent 读，用于 `getAppOrigin` 的 `mobileLink` 语义 | 应用侧 `mobileLink` 中间件 + agent `a2a/settings.ts` | 方案登记为唯一隐式契约；只读、单向、无 import；由 `s5` 与 S-09 覆盖 |
| **X-2** | 并行 bug 修复任务的 4 个文件改动（含新增 `lib/agentLog.ts`） | 并行任务 | 按 D-01 处理；本需求不修改这些文件 |
| **X-3** | `map.json` 重算与 11 个子图 | R-11 实施方 | M5 前完成，`coverage_ratio=1.0`，`e9` 标签 16 |

---

## 8. 回滚方案

| 粒度 | 触发 | 动作 | 数据影响 |
| --- | --- | --- | --- |
| 单批（B0–B4） | 该批后 A2P ≠ 表中值，或该批指定的冒烟失败 | `git revert` 该批提交；lib shim 恢复直引（B0）；Host 消费点回退为该批之前的 import | 无（不涉及数据/设置格式） |
| M1 整体 | 注入时序 / typecheck / 冒烟失败 | 撤销 6 个新文件 + `app.ts` 的 1 行 + `utils`/域文件改动；`packages/formats` 可保留（零依赖、无引用）或一并删除 | 无 |
| M5 文档类 | 地图/AGENTS 数字与实测不符 | 只回滚文档与 `map.json` 重算提交 | 无 |
| 全量 | 评审判定方案不可行 | 回到 `89572b5`（或届时 HEAD） | 无 |

**回滚不变量**：任何回滚后都必须满足"上一里程碑的全部门禁"；不允许出现"回滚后 A2P 数字介于两批之间且无门禁"的状态。

---

## 9. 评审意见栏

> 本节留空，待用户填写。评审通过后进入实施阶段（实施不在本方案范围内）。

### 9.1 方案整体

| 项 | 意见 |
| --- | --- |
| 背景与问题定位（§1） |  |
| 总体架构（§2） |  |
| 子需求方案（§3，R-01～R-15） |  |
| 里程碑与门禁（§4） |  |
| 验收与复检执行（§5） |  |
| UI / 前端影响（§6） |  |
| 风险与回滚（§7、§8） |  |
| 方案级发现（§0.3，F-01～F-14） |  |
| 其他 |  |

### 9.2 子需求逐项

| 编号 | 通过 / 打回 | 备注 |
| --- | --- | --- |
| R-01 AgentHost 契约 |  |  |
| R-02 反向收敛与门面 |  |  |
| R-03 Host 实现与注入 |  |  |
| R-04 消费点切换（B0–B4） |  |  |
| R-05a formats（M1） |  |  |
| R-05b formats（M2） |  |  |
| R-06 装配序列 |  |  |
| R-07 契约冻结 |  |  |
| R-08 模型能力单一来源 |  |  |
| R-09 口径与归属 |  |  |
| R-10 行为等价验证 |  |  |
| R-11 文档/地图同源 |  |  |
| R-12 预算 |  |  |
| R-13 归属清单与可达性 |  |  |
| R-14 探针与自检 |  |  |
| R-15 `e9` 定义 |  |  |

### 9.3 待裁决分支（D-01～D-08）

| 编号 | 结论（采纳默认 / 改判为） | 备注 |
| --- | --- | --- |
| D-01 基线漂移处置（默认 B） |  |  |
| D-02 `getAppOrigin` bag（默认 A：5 字段） |  |  |
| D-03 `agentLog` 归属（默认 A：settings） |  |  |
| D-04 契约内应用类型（默认 A：结构型重声明） |  |  |
| D-05 `utils.ts` 旧键（默认 A：保留） |  |  |
| D-06 formats exports（默认 A：子路径） |  |  |
| D-07 B2 顺序（默认 A：一次性） |  |  |
| D-08 装配写法（默认 A：字面量 14 键） |  |  |

### 9.4 打回意见与外部协同

| 项 | 结论 | 备注 |
| --- | --- | --- |
| 第 4 轮打回 #1（14 组） |  |  |
| 第 4 轮打回 #2（10 条边归属） |  |  |
| 第 4 轮打回 #3（归零可达性） |  |  |
| 第 4 轮打回 #4（A-22 探针 / e9 定义） |  |  |
| X-1 `toonflowMobileLink` 标志 |  |  |
| X-2 并行任务基线漂移 |  |  |
| X-3 地图重算 |  |  |

### 9.5 结论

| 项 | 填写 |
| --- | --- |
| 评审结论（通过 / 打回） |  |
| 打回理由（如打回） |  |
| 评审人 |  |
| 评审时间 |  |

---

## 附录 A：章节 ↔ 子需求覆盖矩阵

| 子需求 | 背景 | 目标 | 描述 | 详细方案设计 | 验收映射 | 里程碑 |
| --- | --- | --- | --- | --- | --- | --- |
| R-01 | §3.1 | §3.1 | §3.1 | §3.1(1)–(7) | §3.1 | M1 |
| R-02 | §3.2 | §3.2 | §3.2 | §3.2(1)–(7) | §3.2 | M1 |
| R-03 | §3.3 | §3.3 | §3.3 | §3.3(1)–(8) | §3.3 | M1 |
| R-04 | §3.4 | §3.4 | §3.4 表 | §3.4(1)–(7) | §3.4 | M2–M4 |
| R-05a | §3.5 | §3.5 | §3.5 表 | §3.5(1)–(4) | §3.5 | M1 |
| R-05b | §3.5 | §3.5 | §3.5 表 | §3.5(1)–(4) | §3.5 | M2 |
| R-06 | §3.6 | §3.6 | §3.6 表 | §3.6 | §3.6 | M1 |
| R-07 | §3.7 | §3.7 | §3.7 表 | §3.7 | §3.7 | M1/M2/M5 |
| R-08 | §3.7 | §3.7 | §3.7 表 | §3.7 | §3.7 | M1/M3 |
| R-09 | §3.8 | §3.8 | §3.8 | §3.8(1)–(3) | §3.8 | M5 |
| R-10 | §3.4 | §3.4 | §3.4 | §3.4(7) + §6.3 | §3.4/§5.1 | 每批 |
| R-11 | §3.11 | §3.11 | §3.11 | §3.11 表 + §7.3 | §3.11 | M5 |
| R-12 | §3.8 | §3.8 | §3.8(3) | §3.8(3) | §3.8 | M1–M2 |
| R-13 | §3.9 | §3.9 | §3.9 | §3.9(1)–(3) | §3.9 | M0/M5 |
| R-14 | §3.10 | §3.10 | §3.10 表 | §3.10 | §3.10 | M0–M5 |
| R-15 | §3.11 | §3.11 | §3.11 | §3.11 表 | §3.11 | M0/M5 |

---

## 附录 B：14 组装配总表（源路径 / 符号 / 行数 / 目标数 / 批次）

| # | 组 | 实现来源（20 条） | 关键符号（合计 60） | 行 | 目标 | 批次 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `workspace` | `localRuntime/workspace/files`、`workspace/chatImages` | `resolveWorkspacePath`、`lockWorkspaceFiles`、`writeWorkspaceFile`、`renameWorkspaceFile`、`isWithin`、`isHiddenWorkspaceEntry`、`protectWorkspaceRoot`、`protectWorkspaceLibraryPath`、`importImage` | 13 | **14** | B3 |
| 2 | `settings` | `platformCore/conf` | `get`、`onChange`、`settingsPath` | 8 | 8 | B4 |
| 3 | `assets` | `assetLibrary/assets`、`assetLibrary/assets/roots` | `openAssetLibrary`、`createAssetDirectory`、`importAssetFile`、`importFileIntoLibrary`、`moveAsset`、`readAssetFile`、`writeAssetFile`、`removeAsset`、`getAssetsDirectory`、`assertAssetRelativePath`、`queryAssets`、`AssetLibrarySelector` | 6 | **7** | B3 |
| 4 | `models` | `mediaGeneration/ai`、`ai/files`、`ai/requestFiles` | `getConfiguredModel`、`providerSchema`、`getModelLimits`、`readAiReferences`、`referenceContent`、`createFileTransport`、`FileRequestLimitError`、`getRequestFiles`、`RequestFile` | 5 | 5 | B2 |
| 5 | `personalization` | `platformCore/personalization` | `isMemoryEnabled`、`readDocument`、`saveDocument`、`maxDocumentLength` | 3 | 3 | B1 |
| 6 | `teams` | `pluginMarket/teams` | `readTeam`、`saveTeamFile`、`listTeams`、`getRemoteTeam` | 4 | 4 | B1 |
| 7 | `tools` | `pluginMarket/plugins/tools` | `listTools`、`loadTool`、`validateToolConfig` | 2 | 2 | B1 |
| 8 | `skills` | `pluginMarket/skills/files` | `directory`、`isEnabled` | 1 | 1 | B1 |
| 9 | `mcp` | `mcpIntegration/mcp/control`、`mcp/servers` | `callControl`、`getConnection`、`getAppOrigin`、`createMcpAgentTools` | 3 | 3 | B4 |
| 10 | `documents` | `mediaGeneration/documents` | `readDocument` | 2 | 2 | B1 |
| 11 | `media` | `mediaGeneration/media/generation`、`ffmpeg` | `listMediaModels`、`generateMedia`、`createWorkspaceFfmpeg` | 2 | 2 | B2 |
| 12 | `browser` | `agentAccess/browser` | `createBrowserContext` | 1 | 1 | B3 |
| 13 | **`i18n`** | **`lib/i18n`** | `t`、`translateMessage`、`translateError` | **8** | **8** | B2 |
| 14 | **`platform`** | **`lib/platform`** | `getRuntimePlatform`、`RuntimePlatform`（类型） | **2** | **2** | B2 |
| — | 聚合行 | `utils.ts`（`u.workspaceFile`、`u.assets`） | 不计组；按实际符号分摊到 1+3 | **1** | —（已分摊） | B3 |
| | **合计** | **20 条源路径** | **60 符号** | **61** | **62** | |

计数校验：14 组单归属 60 行 + 聚合行 1 = **61 Host 行**；`mentionFiles.ts:3` 多目标 +1 = **62 Host 目标**；B0 13 行/13 目标；总 **74 行 / 75 目标 / 多目标 1 / unmapped 0**。

---

## 附录 C：74 行归属汇总（A-24 的人读视图）

> 逐行权威清单见需求矩阵 **Appendix E**（74 行 `file:line → dest`）。本附录只做**分组汇总**，并显式列出第 4 轮打回点名的 10 行与唯一多目标行，便于评审抽样核对。

### C.1 按组汇总

| 组 | 行数 | 目标数 | 批次 |
| --- | --- | --- | --- |
| workspace | 13 | 14 | B3 |
| settings | 8 | 8 | B4 |
| assets | 6 | 7 | B3 |
| models | 5 | 5 | B2 |
| personalization | 3 | 3 | B1 |
| teams | 4 | 4 | B1 |
| tools | 2 | 2 | B1 |
| skills | 1 | 1 | B1 |
| mcp | 3 | 3 | B4 |
| documents | 2 | 2 | B1 |
| media | 2 | 2 | B2 |
| browser | 1 | 1 | B3 |
| **i18n** | **8** | **8** | B2 |
| **platform** | **2** | **2** | B2 |
| 聚合行（`agent/mentionFiles.ts:3`） | 1 | —（其 2 个 dest 已分别计入 workspace/assets 的 14/7） | B3 |
| 小计（Host） | **61** | **62** | |
| B0（formats 副本） | 13 | 13 | B0 |
| **合计** | **74** | **75** | |

### C.2 第 4 轮打回点名的 10 条边（逐行）

| # | `file:line` | 组 | 改造目标 |
| --- | --- | --- | --- |
| 1 | `agent/runtime/delegation.ts:11` | i18n | `host.i18n.t` / `translateMessage` |
| 2 | `agent/runtime/index.ts:28` | i18n | `host.i18n.t` |
| 3 | `agent/runtime/mentions.ts:1` | i18n | `host.i18n.t` |
| 4 | `agent/runtime/resources.ts:1` | i18n | `host.i18n.t` |
| 5 | `agent/skills/index.ts:1` | i18n | `host.i18n.t` |
| 6 | `agent/teams/index.ts:1` | i18n | `host.i18n.t` |
| 7 | `agent/teams/remote.ts:1` | i18n | `host.i18n.t` |
| 8 | `agent/tools/index.ts:1` | i18n | `host.i18n.t` |
| 9 | `agent/a2a/settings.ts:8` | platform | `host.platform.getRuntimePlatform()` |
| 10 | `agent/runtime/resources.ts:11` | platform | `host.platform.getRuntimePlatform()` |

> 这 10 行在 B2 批次一次性迁移（D-07）；只迁 8 行 i18n 或只迁 2 行 platform，批次后 A2P 会是 40 / 34，均不等于 32 → 批次门失败。

### C.3 唯一多目标行

| `file:line` | dest | 用法 | 改造 |
| --- | --- | --- | --- |
| `agent/mentionFiles.ts:3` | `{workspace, assets}` | `u.workspaceFile.resolveWorkspacePath`（`:15,:26,:59,:71,:113`）、`u.assets.getAssetsDirectory`（`:111`） | 同一提交内分别改 `host.workspace.*` / `host.assets.*`；**不拆行**（拆行会把 A2P 由 74 变 75，违反 A-24） |

### C.4 B0 的 13 行（不进 Host）

`documentFormats` 5 + `modelReasoning` 6 + `mentionSources` 2 → `@toonflow/formats`（R-05b）；`A2aSettings` 是**反向类型边**（`conf→agent`），随 R-05a 迁移用于消除 1 条反向边，**不计入 13**。

---

## 附录 D：探针与自检执行清单（沿用矩阵 §6.5，不改写命令）

| 探针 | 用途 | 相位 | 自检 |
| --- | --- | --- | --- |
| P1 | A2P 别名（= 地图 `e7` 对账） | M0/M5 | G1 正控制（M0=71） |
| P2 | A2P 相对逃逸 | M0/M5 | G1（M0=3） |
| P3a | P2A 文件集合（A-04） | M0/M5 | G4 精确集合 |
| P3b | P2A 说明符集合（A-05） | M0/M5 | G4 |
| P4 | 包契约（A-06） | M0/M5 | 恒 3 |
| P5a/P5b | `utils.ts` 的 0 行 / 38 键 | M0/M5 | G4 |
| P6/P6b | file SCC / `e7` | M0/M5 | G3 双算 |
| P7 | 注入静态 7 项 | M1/M5 | G2 存在性 |
| P7b | 模块求值域引用（AST） | M0/M5 | **T1** |
| P8/P8b | 注入时序 / 静态可达集 | M1/M5 | G2 |
| P9 | 数据目录时序 | 任意 | 运行类 |
| P10 | 14 exports 快照 | M0/M5 | 逐字 |
| P11 | glob/口径冻结 | M0/M5 | 集合相等 |
| P12 | 覆盖与文件总数 | M0–M5 | 里程碑值 |
| P13 | 迁移/深引/子模块对 | M2/M5 | 3+3+3+1 |
| P14 | 新增文件集合 | M1/M2/M5 | **T2** |
| P15 | fail-fast + 双注入 | M1/M5 | **T3/T4/T5** |
| P16 | A2A watcher 双相 | M0/M5 | **T6/T7** |
| P17 | 门面导入面 | M1/M5 | G4 |
| P18 | 桌面/移动静态装配 | M5 | 精确计数+行序 |
| P19 | A-22 静态 | M0/M5 | **T8** |
| P20 | 归属（M0）/可达（M5） | M0/M5 | **T9/T10** |
| P21 | `e9` | M0/M5 | **T11** |

---

## 附录 E：文件预算与新增集合

**新增代码文件（恰好 8）**

| # | 路径 | 阶段 | 性质 |
| --- | --- | --- | --- |
| 1 | `packages/formats/src/modelReasoning.ts` | M1 | 逐字节副本 |
| 2 | `packages/formats/src/a2a.ts` | M1 | 新逻辑 |
| 3 | `packages/formats/src/index.ts` | M1 | 新逻辑 |
| 4 | `packages/formats/src/documentFormats.ts` | M2 | 逐字节副本 |
| 5 | `packages/formats/src/mentionSources.ts` | M2 | 逐字节副本 |
| 6 | `apps/server/src/agent/host.ts` | M1 | 契约 + 注册表 |
| 7 | `apps/server/src/agentHost.ts` | M1 | 实现 + 注入 |
| 8 | `apps/server/src/agentRuntime.ts` | M1 | 反向门面 |

**新增非代码文件（恰好 2）**：`packages/formats/package.json`、`packages/formats/tsconfig.json`。
**改造（非新增）的 shim（3）**：`apps/server/src/lib/{documentFormats,modelReasoning,mentionSources}.ts`。

---

## 附录 F：术语与计数口径（引用矩阵 §1.6，避免二次定义）

| 术语 | 本方案的用法 | 权威定义 |
| --- | --- | --- |
| A2P / P2A | agent→应用 / 应用→agent 的**直接** import 行 | 矩阵 §1.6 |
| 归属 / dest / 多目标行 / unmapped / stale | 每条 A2P 行的去向、目标集合、`multi`、`unmapped`、`stale` | 矩阵 §1.6 D7–D10 |
| D1a / D1b | 门面定义面（3 文件）/ 门面导入面（10 行 / 5 文件） | 矩阵 §1.6 |
| 相位 M0–M5 / B0–B4 | 里程碑 / 迁移批次 | 矩阵 §5、§4.4 |
| `e9` | 地图边 `server-api → agent-runtime`，计数 = P3b + P4 | 矩阵 §1.6 D11、本方案 §3.11 |
| **函数作用域取 Host** | 在函数体内 `const host = getAgentHost()` 后多次使用 | 本方案 §3.4(1)（禁止模块作用域） |
| **请求局部标志** | `res.locals` 上的 `toonflowMobileLink`（布尔） | 本方案 §0.3 F-03、§7.3 X-1 |

---

## 产物边界声明

1. 本方案**未修改任何代码文件**、未新增脚本、未新增测试、未改 `map.json`（`git status --porcelain apps packages compat` 仍只有并行 bug 修复任务的 4 项）；
2. 本方案的全部数字来自输入需求矩阵 **REQ-2026-10-27-05** 与本轮实测（`89572b5` 干净副本 + 当前工作树对比）；
3. 方案级发现 F-01/F-03 等如被评审采纳，需**先修订需求矩阵**（计数/判据）再实施；本方案不自行放宽任何判据（矩阵 §6.2 规则 4）；
4. 实施阶段产生的真实代码不在本文件范围内。
