# 需求矩阵 · AgentHost 端口切断 agent↔应用双向依赖（架构级环治理）

> **第 4 版 · 第 3 轮打回后重做**。本版只改需求矩阵与索引，**业务代码零改动**（`git status --porcelain apps packages compat` 无输出）。评审通过后才进入方案与实施。

## 0. 文档元信息

| 项 | 内容 |
| --- | --- |
| 文档编号 | **REQ-2026-10-27-04** |
| 版本 | 第 4 版（替代 REQ-2026-10-27-03） |
| 需求来源 | `.easyvibe/map/map.json` → `health.concerns.c-arch-1`（critical）、`modules[server-api].health.concerns.c-server-api-2`（critical）、`modules[agent-runtime].health.concerns.c-agent-runtime-1`（critical）；全局 `decay_flags = [circular_dep, layer_violation]` |
| 需求标题 | 抽 AgentHost 端口切断 `agent-runtime → 应用层`（`@/utils`·`@/lib`·`@/modules`）的静态依赖；反向 `应用层 → agent` 收敛到唯一门面；由组合根单向装配 |
| 影响模块 | `agent-runtime`（主）、`server-api`（主）、`shared-foundation`（纯契约下沉）、`web-console`（契约连带只验不改）、`ai-providers`（契约连带只验不改）；派生：`desktop-shell`、`mobile-shell`（`@toonflow/server/*` 导出路径不变） |
| 需求类型 | 结构性重构（架构整改）。**不改变任何业务行为、HTTP 契约、NDJSON 事件字段、磁盘格式、设置格式** |
| 优先级 | **P0**（地图 critical；环位于每条 Agent 请求的必经路径） |
| 当前状态 | **待评审（第 4 版）** |
| 编写人 | 需求分析 agent（harness 规则正文 2.1 执行者） |
| 编写时间 | 2026-10-27 13:35 |
| 基线 | `git HEAD = 89572b5`（与第 1/2/3 版相同）；地图 `generated_at = 2026-10-27T08:01:50+08:00`（`head_short = 1861cd0`，滞后 4 个提交，模块归属未变） |
| 上一版 | `2026-10-27-12-59-agentHostPortCycleBreak-v3.md`（REQ-2026-10-27-03，**第 3 轮打回**） |
| 验收口径 | 23 条二值判据（A-01～A-23）+ 精确台账（L01～L24）+ 冲突优先级规则（§6.2）+ 7 项探针自检（A-23）+ fixture 归属守卫（G7）。**A 表内不存在范围型期望**，任何"≤ / 约 / 趋势 / 含 / 或"都不作为验收结论 |

### 0.1 第 3 轮打回意见处置（本轮核心修订）

| # | 打回意见（原文） | 根因（本轮**已复现**） | 本版处置（可核对） | 落点 |
| --- | --- | --- | --- | --- |
| 1 | **A-23 的 P15-T 自检 fixture 缺 `configureAgentHost`，按文档执行必失败，M5 无法通过验收** | v3 的 P15-T 直接复用 **P7b-T 的 AST fixture** `/tmp/agenthost_fixture/agent/host.ts`。该文件按 AST 探针的需要只导出 `getAgentHost`（**3 行**），而 P15 脚本 `host_failfast.ts` 解构 `{ configureAgentHost, getAgentHost }` 并调用 `configureAgentHost(sentinel)`。实测复现（命令与输出见 §0.1.1）：`TypeError: configureAgentHost is not a function`，**退出码 1**，`failfast_exit` 一行根本没有输出。因此 A-23 的 `P15-T exit=0` 不可达 → A-23 恒 FAIL → §5 的 M5 门" A-01～A-23 全 PASS"**不可能通过** | ① **fixture 归属拆分**：P7b-T 的 fixture 移到 `/tmp/agenthost_fixture/p7b/agent/`（只服务 AST 探针，不得被其他探针复用）；P15 建立**独立** fixture `/tmp/agenthost_fixture/p15/{ok,fallback,missing}/host.ts`，`ok` 版本**完整实现 §4.1 的三项契约**（`configureAgentHost` / `getAgentHost` / 两条精确错误消息）。<br>② **探针加存在性守卫**：P15 脚本在 import 后先判 `typeof configureAgentHost === "function" && typeof getAgentHost === "function"`，否则输出 `failfast_fixture_invalid` 并 `exit 9`（把"崩溃"变成"可判定失败"）。<br>③ **A-23 从 4 项扩为 7 项**：`P7b-T=3`、`P14-T 1/1`、`P15-T1(ok)=0`、`P15-T2(fallback)=4`、`P15-T3(missing)=9`、`P16-T-a(m0)=none/true/reason`、`P16-T-b(lazy)=未注入/true/reason`。<br>④ **G7 新守卫**：fixture 必须由**自身探针块内**创建，跨探针复用 = FAIL；附静态审计脚本（§6.10）。<br>⑤ **新增 §6.10 复跑脚本**：一条命令复跑 7 项自检，任一项不等于期望即 FAIL | §6.5 P7b-T/P14-T/P15/P15-T/P16-T、§6.1 A-23、§6.7 G5/G7、§6.10、§0.5 E27–E33 |

**结论**：修复后 7 项自检**在 M0 即可全部复跑通过**（fixture 不依赖仓库改造），因此不存在"走到 M5 才发现自检不可执行"的路径，§5 的 M5 门恢复可达。

#### 0.1.1 打回意见的复现证据（可粘贴执行）

```bash
# 复现 v3 的 P15-T：P7b-T 的 fixture 只有 getAgentHost
$ cat /tmp/agenthost_fixture/agent/host.ts      # v3 §6.5 P7b-T 创建的内容
export function getAgentHost() { throw new Error("AgentHost 未注入"); }
$ bun /tmp/host_failfast.ts /tmp/agenthost_fixture/agent/host.ts
6 | configureAgentHost(sentinel as never);
    ^
TypeError: configureAgentHost is not a function. (In 'configureAgentHost(sentinel)', 'configureAgentHost' is undefined)
      at /private/tmp/host_failfast.ts:6:1
$ echo $?
1
```

> 该输出即"按文档执行必失败"的证据：v3 的 A-23 期望 `P15-T exit=0`，实际 `exit=1`；`failfast_exit` 未打印。
>
> **注意**：上面 `/tmp/agenthost_fixture/agent/host.ts` 是 **v3 的废弃路径**，本版已迁移到 `/tmp/agenthost_fixture/p7b/agent/`（AST 探针专用）与 `/tmp/agenthost_fixture/p15/`（fail-fast 探针专用）；任何探针都不得再引用旧路径（G7）。

### 0.2 本轮自查发现（非打回意见，但同属"按文档执行会失败"，一并纠正）

| # | 位置 | v3 写法 | 本轮实测 / 纠正 | 复现命令 |
| --- | --- | --- | --- | --- |
| S1 | §6.1 A-23、§6.7 G5 | 要求 `P16-T pre_error=none post_aborted=true reason 精确` | **v3 从未定义 P16-T**（全文 grep 只在 A-23/G5 两处引用，§6.5 无该自检块）→ 与 P15-T 同类缺陷：引用不可执行的自检。本版新增 **P16-T-a（m0 语义 fixture）** 与 **P16-T-b（lazy 语义 fixture）**，两者共用 `/tmp/a2a_watch.ts`，分别断言 `pre_error=none` 与 `pre_error=AgentHost 未注入`，`post_aborted=true`、`reason` 逐字符相同 | §6.5 P16-T、A-23、E32/E33 |
| S2 | §6.5 P15 脚本 | 无 fixture 存在性守卫 | 缺导出时以 `TypeError` 崩溃、无 `failfast_exit` 输出，**失败原因不可判定**（与"实现真的 fail-fast"无法区分）。本版加守卫：`failfast_fixture_invalid` + `exit 9` | §6.5 P15、§6.10 T3 |
| S3 | 附录 D 的 D5 | "P15-T（fixture host.ts）→ failfast_exit 0" | 只记结果、未记 fixture 内容 → **证据不可复现**。本版把 fixture 的 heredoc 写进探针块，并新增负控制 T2/T3 | §6.5 P15-T、§6.10 |
| S4 | fixture 命名空间 | 多个探针共用 `/tmp/agenthost_fixture/agent` | 命名冲突是 S1 的直接成因。本版 per-probe 子目录：`p7b/`、`p15/`、`p16/`、`new_files_fixture/` | §6.5、G7 |
| S5 | 基线数字 | v3 记录 71/3/74、21 行/11 文件、37 键、706/0、SCC 3/1 | **本轮全部复跑，逐项一致**（E1–E11）；无口径漂移 | §0.5 |

### 0.3 与第 3 版的关键差异

| 项 | 第 3 版（REQ-2026-10-27-03） | 第 4 版（本版） |
| --- | --- | --- |
| P15-T fixture | 复用 P7b-T 的 3 行 fixture（缺 `configureAgentHost`）→ 必失败 | **独立 3 个 fixture**（ok/fallback/missing），`ok` 完整实现三项契约 |
| P15 脚本 | 无守卫，缺导出即 TypeError | **存在性守卫**：`failfast_fixture_invalid` + `exit 9` |
| P16-T | **未定义**（A-23/G5 悬空引用） | **定义 2 个**（m0 / lazy 语义），双相可判 |
| A-23 自检项 | 4 项（其中 2 项不可执行/未定义） | **7 项全部可执行**，含 2 个负控制 |
| fixture 归属 | 混用 `/tmp/agenthost_fixture/agent` | per-probe 子目录 + **G7 跨复用守卫** + §6.10 静态审计 |
| 复跑入口 | 无 | **§6.10 一条命令跑完 7 项** |
| 验收口径 | 23 条判据 + L01–L21 | **23 条判据 + L01–L24**（新增自检数、fixture 自包含数、M5 门可达性） |
| 其余（R/A/Q/E/P、基线数字、冒烟） | — | **不变**（本轮复跑一致，见 §0.5） |

### 0.4 覆盖度 / 可测性 / 无歧义自检

| 维度 | 本版保证方式 | 核对位置 |
| --- | --- | --- |
| **覆盖度** | 第 3 轮 1 条打回 → §0.1 处置；自查 5 条 → §0.2。地图 3 个 critical 关注点、AGENTS 7 条硬约束、74/24 条边、16 组能力、file SCC、web 38 条契约导入、providers 契约 → 全部有归属 | §0.1、§0.2、§1、§2、§8、附录 A/B |
| **可测性** | 23 条判据全部给：探针编号、精确期望、相位、正控制；计数类双算（G3）；集合类逐项枚举（G4）；13 项冒烟（16 子断言）逐条给请求/fixture/状态码/精确事件与文案；**7 项探针自检全部带自包含 fixture 与精确退出码** | §6.1、§6.4、§6.5、§6.7、§6.10 |
| **无歧义** | 术语与计数口径 §1.6；求值时序实测 §1.7；口径漂移定义 §6.6；冲突优先级 §6.2；Q1–Q10 全有默认值；E1–E13 逐条给"为何不能消除 / 代价 / 复核方式"；A 表禁用"含/或/≤/约/趋势"；**fixture 归属唯一（G7）** | §1.6、§1.7、§6.2、§6.6、§9、§8、§6.7 |
| **可执行性（本轮新增维度）** | 每个自检块 = "创建 fixture + 运行 + 期望"三件套写在**同一个代码块**内；负控制保证探针非空转；§6.10 一次性复跑 | §6.5、§6.7 G7、§6.10 |

### 0.5 本轮实测证据（HEAD = `89572b5`，2026-10-27 13:10–13:35 执行）

| # | 命令（摘要） | 实测输出 | 对应 |
| --- | --- | --- | --- |
| E1 | P1 + P2 | 别名 `71`（`@/modules` 50 / `@/lib` 20 / `@/utils` 1）；相对 `3`；合计 `74` | A-01～A-03 |
| E2 | P3a | `11` 个文件（逐项见 §0.2 S5 / 附录 A） | A-04 |
| E3 | P3b + 分类 | `21` 行；静态值 `17`、静态类型 `3`、动态 `1` | A-05 |
| E4 | P4 | `3` | A-06 |
| E5 | P5a / P5b | `5` 行 `@/agent`；默认导出键 `37` | A-07 |
| E6 | P6 | `scc_total 3 agent_scc 1`（含 agent 的 SCC = 10 文件） | A-08 |
| E7 | P12 | `files 706 uncovered 0` | A-17 |
| E8 | P6b | 地图 `e7 = 1` | A-08 |
| E9 | 基线规模 | `app.ts 78` 行、`utils.ts 75` 行、`agent 29 文件/4032 行`、`src 272 文件/18546 行`、`routes 161 文件`、`exports 14`、web 契约导入 `38` | 附录 A、A-14 |
| E10 | `git status --porcelain apps packages compat` | 空（本版仅文档） | §0 元信息 |
| E11 | P14（M0） | `code_new 0 / noncode_new 0` | A-17 |
| E12–E26 | v3 的冒烟实跑（S-01/S-03/S-04/S-06/S-07/S-08/S-10/S-11/S-12/S-13a、P16 M0、P7b、P14） | 与 v3 记录逐项一致；本版未改动这些探针与 fixture | A-15、A-22 |
| **E27** | **P7b-T**（新路径 `/tmp/agenthost_fixture/p7b/agent`） | `module_scope_refs 3`，输出 `sample.ts:3`，**exit 1** | A-23 T1 |
| **E28** | **P14-T**（临时 git 仓库） | `code_new 1`（`apps/server/src/new.ts`）/ `noncode_new 1`（`package.json`），`.easyvibe/doc.md` 被排除，**exit 0** | A-23 T2 |
| **E29** | **P15-T1**（fixture `p15/ok`，完整契约） | `failfast_exit 0`，**exit 0** | A-23 T3、A-09 |
| **E30** | **P15-T2**（fixture `p15/fallback`：无 fail-fast + 无二次注入保护） | `failfast_exit 4`，**exit 4**（命中缺失的 fail-fast 与二次注入保护） | A-23 T4 |
| **E31** | **P15-T3**（fixture `p15/missing`：只有 `getAgentHost`，即 v3 的缺陷 fixture） | `failfast_fixture_invalid`，**exit 9** | A-23 T5 |
| **E32** | **P16-T-a**（fixture `p16/m0`：顶层注册的 M0 语义） | `pre_error none` / `app_ok function` / `post_aborted true` / `reason A2A 设置已修改，当前任务已取消`，**exit 0** | A-23 T6 |
| **E33** | **P16-T-b**（fixture `p16/lazy`：首次 `getA2aSignal()` 惰性注册的 M5 语义） | `pre_error AgentHost 未注入` / `app_ok function` / `post_aborted true` / `reason` 同上，**exit 0** | A-23 T7、A-22 |

> 本节所有命令均在 `/tmp` 下执行，不写仓库、不加脚本、不进 CI（C4）。

#### 0.5.1 「按文档原样执行」验证（本轮新增，直接回应第 3 轮打回）

把 §6.5 的自检代码块**原样抽取并逐块执行**（脚本 `run_doc_blocks.py` 只做"取 ```bash 块 → `bash -c`"，不加任何补丁），结果：

| 块 | 退出码 | 关键输出 | 期望 | 结论 |
| --- | --- | --- | --- | --- |
| P7b（仓库） | `0` | `module_scope_refs 0` | `0` | PASS |
| P14（M0） | `0` | `code_new 0 / noncode_new 0` | `0 / 0` | PASS |
| P15（M0） | `1` | 无输出（`test -f` 为假，G2 先判存在） | 不判定 | 预期 |
| P16（M0，真实仓库） | `0` | `pre_error none` / `app_ok function` / `post_aborted true` / `reason A2A 设置已修改，当前任务已取消` | 同左 | PASS |
| **P7b-T（T1）** | `1` | `module_scope_refs 3` | `3` | PASS |
| **P14-T（T2）** | `0` | `code_new 1 / noncode_new 1` | `1 / 1` | PASS |
| **P15-T1（T3）** | `0` | `failfast_exit 0` | `0` | PASS |
| **P15-T2（T4）** | `4` | `failfast_exit 4` | `4` | PASS |
| **P15-T3（T5）** | `9` | `failfast_fixture_invalid` | `9` | PASS |
| **P16-T-a（T6）** | `0` | `pre_error none` / `app_ok function` / `post_aborted true` / `reason` 精确 | 同左 | PASS |
| **P16-T-b（T7）** | `0` | `pre_error AgentHost 未注入` / `app_ok function` / `post_aborted true` / `reason` 精确 | 同左 | PASS |

> 结论：**7/7 自检在 M0 按文档原样执行即通过**，第 3 轮点名的"按文档执行必失败"已消除；M5 门（A-01～A-23 全 PASS）恢复可达。

---

## 1. 背景

### 1.1 问题原文（地图关注点）

> `c-arch-1`（critical）：agent-runtime 与应用层双向 import（agent→应用 71 处、应用→agent 24 处）构成环，且环位于每条 Agent 请求的必经路径，任何一侧改动都会牵动另一侧。
> 建议：先抽 AgentHost 端口切断 agent→`@/utils`·`@/lib`，再让 `app.ts` 单向装配 agent 与各应用子模块。

| 关联关注点 | 严重度 | 与本需求的关系 |
| --- | --- | --- |
| `c-server-api-2` | critical | 应用层 145 个文件经 `utils.ts` 可达 agent；`utils.ts` 5 条 re-export 是环的应用半边 |
| `c-agent-runtime-1` | critical | agent 29 个文件 / 4,032 行中 23 个命中应用路径，没有端口层 |
| 全局 `decay_flags` | `circular_dep`、`layer_violation` | 本需求是两者同时收敛的唯一路径 |

### 1.2 环的实测形状（HEAD = 89572b5，本轮复跑）

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

**环的收敛点（file 级 SCC，本轮复跑）**

| 图 | SCC 总数 | 含 agent 的 SCC | 成员 |
| --- | --- | --- | --- |
| 值边（运行期） | 3 | **1** | 10 文件：`agent/{assets,index,mentionFiles}`、`agent/runtime/{delegation,index}`、`agent/teams/index`、`agent/tools/{index,subAgent}`、`utils.ts`、`modules/agentAccess/singleAgent/index.ts` |
| 应用层内部 | 2 | 0 | `pluginMarket` 3 文件；`mcpIntegration` 2 文件 |

> 关键结论：**环不需要"反向归零"才能断**。只要反向值边从"agent 的依赖闭包内的文件"（`utils.ts`、`singleAgent`、`routes`）迁出到"agent 不依赖的 bootstrap 门面"，file 级 SCC 即消失；`agent→应用` 归零则是**地图模块级边 `e7` 消失**与"任何一侧改动不再牵动另一侧"的充分条件。本版把这两件事拆成 M1（反向收敛）与 M2–M4（A2P 分 5 批清零），分别验收。

### 1.3 为什么必须处理（而不只是"不好看"）

1. **必经路径**：`routes/agent.ts → utils.ts → agent/index.ts → agent/runtime/index.ts → @/modules/* → (145 个文件) → utils.ts`。
2. **装载顺序被业务无关项绑定**：`modules/platformCore/conf/index.ts` 在模块顶层执行 `mkdirSync/realpathSync/new Conf(...)`；agent 的 8 处 `conf` 引用把配置求值时机与 agent 装载时机耦合。`app.ts` 靠"先设 `TOONFLOW_DATA_DIR` 再动态装配"的人工纪律维持（A-11 守住）。
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
| 15 | 纯契约（下沉） | `lib/{documentFormats,modelReasoning,mentionSources}` + `agent/a2a/settings` 的 `A2aSettings` | 13 | `decodeTextFile`、`getReadableFileMimeType`、`thinkingLevels`、`ThinkingLevel`、`mentionAssetType`、`MentionQuery`、`A2aSettings` | `packages/formats`（Q3 默认 C）。**13 = A2P 边**（documentFormats 5 + modelReasoning 6 + mentionSources 2）；`A2aSettings` 是反向类型边（`conf→agent`），随 R-05a 迁移用于消除 1 条反向边，不计入 13 |
| 16 | 聚合出口 | `utils.ts` | 1 | `u.workspaceFile`、`u.assets` | Host |
| | **合计** | | **74** | 50 + 1 + 23 | |

> 分组规则：**有进程态 / 需装配 / 需请求上下文**的能力进 Host；**纯类型 / 纯函数 / 纯常量**下沉 foundation（§1.6 D3）。这条分界是本需求"无歧义"的核心。

### 1.5 不可突破的约束（AGENTS.md + 地图）

| 约束 | 内容 | 对本需求的影响 |
| --- | --- | --- |
| C1 | 模块入口 `index.ts` ≤60 行；入口静态面不得出现 `@/modules/**`；入口只允许 `import` / `export … from "./自家域/…"` / 纯 `import type` | Host 实现不能挂在入口静态面；入口只静态导出自家域 `./agentHost` 等 |
| C2 | `app.ts` 不静态 import 模块入口；入口的 9 处动态块冻结 | 注入步骤放在 `app.ts` 对 bootstrap 文件的动态 import，不新增入口动态块 |
| C3 | 模块级 SCC 不承诺无环；file 级仅保留 `mcp/dxt↔servers`；E10 深引清单冻结，不新增模块对 | Host 落 bootstrap（已声明依赖全部入口），不新增模块对；新增深引文件 1 个（`agentHost.ts`）登记 |
| C4 | **不新增测试/自检文件、不新增检查命令、不新增 CI 入口** | 复检用一次性命令 / heredoc 到 `/tmp`，执行后删除（本轮 7 项自检亦如此） |
| C5 | `conf` 只在 `platformCore/conf/index.ts` 初始化，且必须晚于 `TOONFLOW_DATA_DIR` | 注入必须在 `createApp` 内、数据目录确定之后 |
| C6 | web 直接编译 `@toonflow/server` 源码；desktop/mobile 经 `@toonflow/server/{i18n,platform,mcp,browser,desktop}` 复用；`apps/server/package.json` 14 个 exports | 冻结导出路径（A-14），迁移只改实现、不改 path |
| C7 | `verbatimModuleSyntax: true` | 纯类型端口可用 `import type`；但 A-01 仍按"解析口径"把类型边计入（更严） |

### 1.6 术语与计数口径（消除歧义的第一道闸）

| 术语 | 定义 | 探针 |
| --- | --- | --- |
| A2P（agent→应用） | `apps/server/src/agent/**` 内 `import/export … from` 中，说明符以 `@/modules`、`@/lib`、`@/utils`、`@/routes`、`@/types`、`@/app`、`@/router`、`@/core` 开头，或以 `../lib`、`../../lib`、`../modules`、`../../modules`、`../utils` 开头 | P1、P2 |
| A2P-别名 / A2P-相对 | 上述两类分别计数 | P1 / P2 |
| A2P-值 / A2P-类型 | 说明符所在语句是否以 `import type` / `export type` 开头 | P1+P2 过滤 |
| P2A（应用→agent，直连） | `apps/server/src` 内、**排除 `agent/` 目录**，说明符以 `@/agent` 结尾或 `@/agent/…` 的行。**必须用边界正则 `@/agent(/\|[^A-Za-z])`**：`@/agentRuntime` 与 `@/agentHost` 是**门面**，不计入 P2A | P3a/P3b |
| P2A-静态值 / 静态类型 / 动态 | 语句形态：`import`（非 type）/ `import type` / `await import(...)` | P3b |
| P2A-包契约 | `@toonflow/teams-scaffold` 在 `apps/server/src`（排除 agent）中的行数 | P4 |
| **D1a 门面定义面** | 允许直接 import `@/agent**` 的文件集合。本版：**3 个** `apps/server/src/agentRuntime.ts`、`agentHost.ts`、`modules/agentAccess/index.ts` | P3a |
| **D1b 门面导入面** | 允许 import `agentRuntime.ts` 的文件集合。本版：**5 个 / 10 行**（`utils.ts` 1、`routes/agent.ts` 1 类型、`singleAgent/index.ts` 5、`singleAgent/types.ts` 1 类型、`mcp/tools.ts` 2） | P17 |
| D2 口径漂移 | 归因算法 / 计数正则变化，或 glob 加宽（例：`apps/server/src/**`），或文件归属变化但无"内容相同副本 + 旧路径 shim"证据 | P11 |
| D3 归属迁移 | 把纯模块复制到新位置（与 M0 旧文件逐字节相同）并把旧路径改为再导出 shim；同步更新 `map.json` 的 `files` globs；新增 glob 与新增文件逐条列入 manifest | P13/P14 |
| D4 台账 | 里程碑台账 L01–L24 的数值序列。**只作记录，不作验收结论**；验收看每个里程碑的精确期望（§5） | 台账 |
| D5 相位 | 所有 A 项默认在 **M5（交付态）** 执行；M0 仅用于基线正控制；S-05/S-13b 与 **A-23 的 7 项自检**是例外：自检在 M0 就可执行（fixture 不依赖仓库改造） | §6.7 G6 |
| **D6 自检（selftest）** | 一项**不依赖被测仓库改造**的可执行检查：用合成 fixture 复现探针的期望输出，证明探针非空转。本版 7 项：T1–T7（§6.5、§6.10） | A-23 |

### 1.7 求值时序实测（R-03 可实现性的依据）

| 事实 | 证据 | 对注入的要求 |
| --- | --- | --- |
| `app.ts` 的静态 import 链只到 6 个文件，**不达 agent** | E8（v3 记录，本轮未变） | 注入不必担心静态前置求值 |
| 7 个模块入口的静态面 **不达 agent** | 同上 | `Promise.all` 装载入口不会求值 agent |
| 5 个入口的静态面**已求值 `conf`** | 同上 | 数据目录必须在 `Promise.all` 之前设置（现状已满足） |
| agent 首次被求值于 `await import("@/router")` | `routes/agent.ts:4,9`、`settings/systemPrompt.ts:3` 等 6 条静态 import；`router.ts` 静态 import 全部路由 | 注入必须在 router import 之前 |
| `agentAccess.mount` 在 router import 之后 | `app.ts`：`router.default(app)` → `mcp.mount` → `agentAccess.mount` | 注入点在 `mount` 之前必然晚于 agent 求值，故不能用 `mount` 作为注入点 |
| agent 唯一的业务级顶层副作用是 `a2a/settings.ts:71` 的 `conf.onDidChange` | E9 | 迁到 Host 初始化时注册；契约叶子必须无副作用 |
| 导入 `agent/a2a/settings.ts` 本身不会登记 watcher（M5 目标）；注入前 `getA2aSignal()` 必须 fail-fast | E32（M0 语义 `pre_error=none`）/ E33（M5 语义 `AgentHost 未注入`），两者均由同一 `/tmp/a2a_watch.ts` 产出 | A-22 的 pre/post 双相；由 **P16-T-a/b** 证明探针能区分两相 |

> 因此本版把注入点定在 **步骤 9.5**：`await media.refreshModels()` 之后、`await import("@/router")` 之前。该位置同时满足：C5（数据目录已定）、`conf` 已初始化、agent 运行时尚未求值、`mount` 之后的所有路由/网关都能拿到已配置的 Host。

---

## 2. 目标与非目标

### 2.1 目标（可度量，全部二值）

| 编号 | 目标 | 度量（M5 期望） |
| --- | --- | --- |
| G1 | agent→应用静态 import 归零（解析口径） | A2P 74 → **0**（别名 71→0、相对 3→0、值 68→0） |
| G2 | 应用→agent **收敛到唯一门面**（不是归零；`app.ts` 单向装配 agent 是设计方向） | P2A 24 → **13 直连源码行（3 文件）+ 3 包契约 = 16**；门面导入面 **10 行 / 5 文件**（A-21） |
| G3 | file 级含 agent 的 SCC 归零；地图模块边 `e7` 消失 | SCC 1 → **0**；`e7` 不存在；`e9` 保留且计 13 |
| G4 | 行为零变化 | typecheck / build / web 构建 / 13 项冒烟全过（A-12～A-15） |
| G5 | 结论可复检且唯一 | 23 条判据全部整数/精确集合；双算一致；正控制成立；**7 项自检可复现（A-23）** |
| G6 | 文档、地图、归属同源 | A-16/A-17/A-18/A-20 全过 |
| G7 | 不新增测试/自检/CI | A-19（探针仍为 `/tmp` 一次性脚本） |

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
| NG10 | 不把"自检通过"当作"实现正确" | 自检只证明探针可信；实现正确仍由 A 表判定 |

### 2.3 依赖方向与"装配面"裁决表

| 关系 | 允许？ | 最终落点 | 判据 |
| --- | --- | --- | --- |
| agent → 应用（`@/modules`、`@/lib`、`@/utils`） | **禁止** | 无 | A-01/A-02/A-03 |
| agent → foundation（`@toonflow/file`、`@toonflow/formats`、`@toonflow/i18n`） | 允许 | 不变/新增 formats | A-03 |
| agent → agent-tools / ai-providers | 允许 | 不变 | — |
| 应用 → agent（直连值） | **允许但唯一** | `agentRuntime.ts`（10 值） | A-04/A-05 |
| 应用 → agent（装配） | **允许但唯一** | `agentHost.ts`（1 值：`@/agent/host`） | A-04/A-05 |
| 应用 → agent（A2A 网关动态） | **允许且冻结** | `modules/agentAccess/index.ts:6`（E4） | A-05、L07 |
| 应用 → agent（包契约） | **允许且冻结** | `@toonflow/teams-scaffold` 3 条（E5） | A-06 |
| 应用 → **门面**（`@/agentRuntime` / `./agentRuntime`） | **允许，精确 5 文件 / 10 行** | `utils.ts`、`routes/agent.ts`、`singleAgent/index.ts`、`singleAgent/types.ts`、`mcp/tools.ts` | A-21 |
| agentAccess → 应用域 | 允许（既有） | 不变 | A-18 |

> `agentAccess.dependencies` **保持 `["platformCore","pluginMarket"]`**：Host 由 bootstrap 注入，不是子模块依赖；门面由 3 个域文件静态引用，属 bootstrap 反向引用，登记在 E13，不新增子模块对（A-20/A-18）。

---

## 3. 需求矩阵总表

> 优先级：P0 = 本需求不可缺项；P1 = 收口与外围。难度：低 / 中 / 中高 / 高。风险按"对行为与安全的破坏可能"评估。**"阶段"列**：任何需求只在其阶段验收，M1 不依赖 M2 之后才交付的东西。

| 编号 | 阶段 | 背景 | 目标 | 描述 | 优先级 | 难度 | 风险 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **R-01** | M1 | agent 对 14 类应用能力有 74 处散点引用，无契约层；路径授权、文件锁、语言上下文、取消/超时语义只存在于实现里 | 给出**唯一**的 AgentHost 契约，agent 只依赖契约 | 新增 `apps/server/src/agent/host.ts`：① 纯类型/接口，按 §1.4 的 14 组分组；② `configureAgentHost(host)` / `getAgentHost()`；③ 未配置抛固定错误 `AgentHost 未注入`；已配置再注入抛固定错误 `AgentHost 已注入`；④ **禁止**出现 `express` 的 `Request`/`Response`、**禁止**暴露 `conf` 实例；⑤ 值/异常/status 语义 1:1 透传，不得放宽越界校验或省略文件锁；⑥ 文件内不得有顶层副作用，只允许 `let host` 与函数声明 | P0 | 高 | 中：端口过宽 → 新上帝对象；语义漏写 → 实现漂移 |
| **R-02** | M1 | 24 条反向边散落在 11 个源码文件；`utils.ts` 5 条 re-export 与 `singleAgent` 5 条构成 10 文件 SCC 的应用半边 | P2A 收敛为 3 文件 / 13 行（唯一门面）；门面导入面精确 5 文件 / 10 行；SCC 在 M4 归零 | 新增 `apps/server/src/agentRuntime.ts` 门面（10 值 + 1 类型说明符）；`utils.ts` 改为 `import * as agentRuntime from "./agentRuntime"`，5 个旧键**保持原名**并新增第 38 键 `agentRuntime`；`routes/**` 5 条值改为 `u.agentRuntime.*`、1 条类型从 `@/agentRuntime`；`singleAgent/index.ts` 5 行、`singleAgent/types.ts` 1 行、`mcp/tools.ts` 2 行改为 `@/agentRuntime`；`conf` 的 `A2aSettings` 类型迁到 `@toonflow/formats`（R-05a）；`agent/a2a/settings.ts:71` 的顶层 `conf.onDidChange` 改为**惰性注册**：`export function registerA2aSettingsWatcher()` 在首次 `getA2aSignal()` 时执行一次，内部经 `getAgentHost().settings.onChange("a2a", cb)` 注册；不得在模块顶层注册（否则 A-10 的 `agentHost.ts` 可达集会被拖入 `agent/a2a/settings.ts`）；取消语义与文案 `A2A 设置已修改，当前任务已取消` 不变 | P0 | 中高 | 高：初始化顺序变化导致 `/api/agent`、`/a2a`、`/mcp` 早期不可用 |
| **R-03** | M1 | 应用侧没有 Host 实现；`conf` 是进程级单例且在模块顶层初始化；`app.ts` 只装配 7 个模块 | 唯一实现点 + 唯一注入点，注入严格晚于数据目录与 `platform.prepare`，且先于 agent 首次求值 | 新增 `apps/server/src/agentHost.ts`（bootstrap）：`createAgentHost(context)` 组装 §1.4 的 12 组应用能力（经既有深引文件，不新增模块对）；`initializeAgentHost(context)` 内 `configureAgentHost(createAgentHost(context))`；`app.ts` 在 **步骤 9.5**（`await media.refreshModels()` 后、`await import("@/router")` 前）动态 `import("./agentHost")` 并调用。**不新增入口动态块** | P0 | 中高 | 高：时机错误 → `conf` 早求值/数据目录静默降级；顶层捕获 → 注入失效 |
| **R-04** | M2–M4 | 74 条 A2P 中 50 条 `@/modules` + 1 条 `@/utils` + 23 条 lib/相对；其中 14 条在 `run()`/`requests.ts`/`sessions.ts` 热路径 | A2P 74 → 0，分 5 批严格等于表中值 | B0 纯下沉 13 条（`documentFormats` 5、`modelReasoning` 6、`mentionSources` 2）→ 61；B1 低风险读取 12 条（personalization 3、teams 4、tools 2、skills 1、documents 2）→ 49；B2 模型/媒体/i18n/platform 17 条（ai 5、media 1、ffmpeg 1、i18n 8、platform 2）→ 32；B3 安全敏感 21 条（workspace 13、assets 6、browser 1、utils 1）→ 11；B4 配置/MCP 11 条（conf 8、mcp 3）→ 0。每批独立可回滚，错误 `message/status/code` 不变 | P0 | 高 | 高：错误码/文案漂移、文件锁丢失、语言上下文丢失 |
| **R-05a** | **M1** | M1 必须消除 `conf→agent` 类型边，且 `A2aSettings` 依赖 `ThinkingLevel`；把整个 R-05 放 M2 会导致 M1 不可实现 | `packages/formats` 在 M1 即可用（3 个代码文件） | 新建 `packages/formats`（foundation，零依赖）+ `package.json` + `tsconfig.json`；`modelReasoning.ts` 从 `apps/server/src/lib/modelReasoning.ts` **逐字节复制**；新增 `a2a.ts`（`A2aSettings`，`thinkingLevel?: ThinkingLevel` 引用同包 `modelReasoning`）；新增 `index.ts` 显式再导出；`apps/server/src/lib/modelReasoning.ts` 改为再导出 shim（`@toonflow/server/modelReasoning` 路径不变）；`conf/index.ts:5` 改 `import type { A2aSettings } from "@toonflow/formats"`；`agent/a2a/settings.ts` 改为从 formats 导入并 `export type { A2aSettings }`；`apps/server/package.json` 增加 `@toonflow/formats: workspace:*` | P0 | 中高 | 中：新包构建/类型检查链、web 解析 workspace 包、shim 漂移 |
| **R-05b** | **M2** | 剩余 13 条 lib/相对边（documentFormats 5 + mentionSources 2 + modelReasoning 6：5 别名 + 1 相对）仍直连应用 | agent 不再 import 应用 `lib`；B0 后 A2P = 61 | 在 formats 增加 `documentFormats.ts`、`mentionSources.ts` **逐字节副本**（`mentionSources.ts` 的 `./documentFormats` 同包引用）；`index.ts` 增加两项显式再导出；`lib/{documentFormats,mentionSources}.ts` 改为再导出 shim；agent 的 13 条边改指 `@toonflow/formats`（含已在 M1 建好副本的 modelReasoning 6 条） | P0 | 中 | 中：shim 漂移、web 构建 |
| **R-06** | M1 | 现有 15 步装配由人工纪律维持；三宿主共用 `createApp` | 装配位次固化、三宿主行为一致 | 在 §4.6 的步骤表中把"步骤 9.5 注入"写死；保持 9 处入口动态块不变；桌面/移动 `createApp` 不监听、`setRuntimeHost` 先于 `createApp` 的现状不变；A-11 验证数据目录 | P0 | 中 | 中：装配顺序改变引发"路由早于 Host 就绪"或"conf 早求值" |
| **R-07** | M1（实现）/M2（shim 补齐）/M5（验证） | web 对 `@toonflow/server/*` 有 38 条静态导入；导出路径被 3 个宿主复用 | 导出路径冻结，web/桌面/移动零改动 | 14 个 exports 全部保持 target 路径；`lib/{documentFormats,modelReasoning}` 与 `agent/mentionSources` 改为从 formats 再导出；`agent/runtime/types`、`singleAgent/types` 不动；A-14 重跑 web typecheck+build | P1 | 中 | 中：web 独立构建，破坏只在 `build:web` 暴露 |
| **R-08** | M1（Host）/M3（agent 切换） | agent 经 `mediaGeneration/ai` 取模型目录，底层是 `@toonflow/providers`；`providerSchema/getModelLimits` 被 agent 与服务端共用 | 模型能力单一来源，agent 不绕应用层取模型 | 默认 Q7-A：Host 暴露 `models` 能力，`packages/providers` 的 `exports`/`dependencies` 零改动；不把 `pi-ai` 等重依赖引入 domain 包 | P1 | 中 | 中：若评审改判 Q7-B，需登记 providers 依赖变化并重跑 ai-providers 构建 |
| **R-09** | M5 | 地图 glob/计数口径未冻结；`706/706` 与新文件冲突 | 口径冻结、归属迁移可审计、数字可复现 | ① `map.json` 的 glob 集合 = M0 ∪ manifest（3 条新增，无删除/加宽，A-16）；② 归属迁移 manifest：`server-api.files += apps/server/src/{agentHost.ts,agentRuntime.ts}`、`shared-foundation.files += packages/formats/**`；③ 每个副本与 M0 旧文件逐字节相同且旧路径保留 shim；④ 禁止加宽 glob；⑤ 覆盖探针读 `map.json` 重算（A-17/A-18） | P0 | 中 | 中：口径漂移 = 假达标；迁移证据缺失 = 归属失真 |
| **R-10** | 每批 | 改造面 74 + 24 条边，且在高热链路 | 行为零变化 | 业务等价验证：全仓 typecheck、server build、web build、13 项冒烟逐条断言（§6.4），重点覆盖 NDJSON 事件类型、并发会话、路径越界、i18n、A2A 取消、MCP 网关、单 Agent | P0 | 中 | 高：静态环有时"掩盖"装载顺序缺陷，拆环后暴露新时序问题 |
| **R-11** | M5 | AGENTS.md 模块表、dependencies、目录结构、地图子图是评审依据 | 代码与文档同源 | 更新 AGENTS.md：目录结构新增 `agentHost.ts`/`agentRuntime.ts`/`packages/formats`；模块表 `agentAccess.dependencies` 保持 `["platformCore","pluginMarket"]`；新增"门面导入面 5 文件 / 10 行"登记；新增步骤 9.5；重算 `map.json` 与 11 个子图，`coverage_ratio = 1.0` | P1 | 低 | 低：漏更新会让下一轮评审以旧数据判定 |
| **R-12** | M1–M2 | 任何结构改造都会新增文件；不分阶段会导致"数字随实施漂移" | 新文件与深引可预算、可审计、逐里程碑可判 | 冻结新增代码文件 **8 个**：M1 交付 6 个（`packages/formats/src/{modelReasoning,a2a,index}.ts`、`apps/server/src/agent/host.ts`、`agentHost.ts`、`agentRuntime.ts`），M2 交付 2 个（`packages/formats/src/{documentFormats,mentionSources}.ts`）；新增非代码文件 **恰好 2 个**（`packages/formats/{package.json,tsconfig.json}`）；新增跨模块深引文件 **1 个**（`agentHost.ts`，importer 侧），新增子模块对 **0**；超出即视为范围变更，回评审 | P0 | 低 | 中：预算过紧会逼出妥协实现；过松会让"趋势"失真 |

---

## 4. 需求详述（边界与产出）

### 4.1 R-01 AgentHost 契约（`apps/server/src/agent/host.ts`）

- **只定义契约 + 注册表，不含实现**。契约按 §1.4 的 1–14 组分组，每组一个独立命名空间类型（`workspace`/`settings`/`assets`/`models`/`personalization`/`teams`/`tools`/`skills`/`mcp`/`documents`/`media`/`browser`/`i18n`/`platform`），不得摊平成一个 60 方法的扁平对象。
- **硬边界**：契约内不得出现 `express`、`Request`、`Response`；不得暴露 `conf` 实例；不得出现"预留但未使用"的方法（评审可逐符号驳回）。
- **安全语义逐条写死**：`workspace.*` 必须注明"返回路径/异常与 `modules/localRuntime/workspace/files.ts` 现实现一致；不得放宽 `protectWorkspaceRoot`/`protectWorkspaceLibraryPath`；不得省略 `lockWorkspaceFiles`；不得吞掉 `status: 400/403/409`"。
- **生命周期**（**P15 与 P15-T 的唯一依据**）：
  - `configureAgentHost(host: AgentHost): void`：全仓只允许 1 次调用（A-09）；第二次调用抛 `new Error("AgentHost 已注入")`。
  - `getAgentHost(): AgentHost`：未配置时抛 `new Error("AgentHost 未注入")`，**不得返回兜底实现**（fail-fast）。
  - 模块顶层不得调用 `getAgentHost()`、不得 `const h = getAgentHost()`、不得解构/取别名（A-09 的 `module_scope_refs = 0`）。
  - 契约的 `settings` 能力必须提供 `onChange(section, listener)`（等价 `conf.onDidChange`）；`conf.onDidChange("a2a")` 的注册由 `agent/a2a/settings.ts` 的 `registerA2aSettingsWatcher()` 惰性执行（首次 `getA2aSignal()`，此时 Host 已注入），**不得**在模块顶层注册（R-02/A-22）。
- **产出**：契约文件 + 一份"契约符号 → 现实现 `file:line`"对照表（进方案文档，进评审附件）。本阶段 A2P 必须仍是 74（证明"只加不改"）。

#### 4.1.1 自检 fixture 的契约形状（第 3 轮打回的根因修复）

> 打回根因：v3 的 P15-T 复用了 P7b-T 的 AST fixture，该 fixture 只导出 `getAgentHost`，缺少 `configureAgentHost`，导致 `TypeError`。本节把 fixture 的**必需形状**写进需求，P15-T 的三个 fixture 必须逐项满足下表，任何一项缺失即 G2 FAIL。

| 符号 | `p15/ok`（T3） | `p15/fallback`（T4，负控制） | `p15/missing`（T5，负控制） |
| --- | --- | --- | --- |
| `export function configureAgentHost` | **有**，二次调用抛 `AgentHost 已注入` | 有，但**无**二次注入保护 | **无** |
| `export function getAgentHost` | **有**，未配置抛 `AgentHost 未注入` | 有，但**返回兜底对象**（违反 fail-fast） | 有，抛 `AgentHost 未注入` |
| 期望 `failfast_exit` | `0` | `4` | 不适用（守卫先触发） |
| 期望 stdout | `failfast_exit 0` | `failfast_exit 4` | `failfast_fixture_invalid` |
| 期望退出码 | `0` | `4` | `9` |

> 负控制的作用：证明 P15 探针**真的能发现**"没有 fail-fast"和"没有二次注入保护"——否则 `exit 0` 可能只是空转。`p15/missing` 则证明守卫把"缺导出"从不可判定的崩溃变成可判定的 `9`。

### 4.2 R-02 反向收敛与门面（M1 的核心）

**新增门面 `apps/server/src/agentRuntime.ts`**（bootstrap，不 import `@/utils`，不 import `@/modules`）：

| 说明符 | 形态 | 导出给谁（精确符号） |
| --- | --- | --- |
| `@/agent` | 值（`export * as agent`） | `utils.ts` 的 `agent` 键；`mcp/tools.ts` 的 `run` |
| `@/agent/tools` | 值 | `createAgentToolContext`（singleAgent/index）、`createAgentTools`（mcp/tools） |
| `@/agent/runtime/model` | 值 | `createAgentModel`（singleAgent/index）、`getAgentModelConfiguration`（routes/settings/singleAgent 经 `u.agentRuntime`） |
| `@/agent/runtime/prompt` | 值 | `defaultSystemPrompt`、`maxSystemPromptLength`（routes/settings 经 `u.agentRuntime`） |
| `@/agent/runtime/sessions` | 值 | `getToolResultText`（singleAgent/index） |
| `@/agent/runtime/requests` | 值 | `configureAgentRequests`（singleAgent/index） |
| `@/agent/bridge/canvas` | 值（`export * as canvas`） | `utils.ts` 的 `canvas` 键 |
| `@/agent/bridge/question` | 值（`export * as question` + 具名） | `utils.ts` 的 `question` 键；`createQuestionContext`、`answerQuestion`（singleAgent/index） |
| `@/agent/a2a/settings` | 值（`export * as a2aSettings`） | `utils.ts` 的 `a2aSettings` 键 |
| `@/agent/mentionFiles` | 值（`export * as mentionFiles`） | `utils.ts` 的 `mentionFiles` 键 |
| `@/agent/runtime/types` | **类型**（`export type { AgentEvent }`） | `routes/agent.ts`、`singleAgent/types.ts` |

> 门面只导出上表符号，**不得**多加（评审可逐符号驳回）。

**D1b 门面导入面（A-21 的唯一对象；5 文件 / 10 行）**

| 消费方 | 现状 | 目标 | 行数 |
| --- | --- | --- | --- |
| `utils.ts:19,20,21,33,35` | 5 条 `@/agent` | 1 条 `import * as agentRuntime from "./agentRuntime"`；5 个旧键保持原名，新增 `agentRuntime` 键（总 38 键） | 1 |
| `routes/agent.ts:4` | 1 类型 | `import type { AgentEvent } from "@/agentRuntime"` | 1 |
| `routes/agent.ts:9` | 1 值 | `u.agentRuntime.getAgentModelConfiguration` | 0（经 utils） |
| `routes/settings/systemPrompt.ts:3` | 1 值 | `u.agentRuntime.defaultSystemPrompt/maxSystemPromptLength` | 0 |
| `routes/settings/save.ts:6` | 1 值 | 同上 | 0 |
| `routes/agents/a2a/save.ts:8` | 1 值 | `u.agentRuntime.getAgentModelConfiguration` | 0 |
| `routes/singleAgent/run.ts:7` | 1 值 | 同上 | 0 |
| `singleAgent/index.ts:7–11` | 5 值 | `@/agentRuntime`（5 行） | 5 |
| `singleAgent/types.ts:2` | 1 类型 | `@/agentRuntime` | 1 |
| `mcp/tools.ts:8,9` | 2 值 | `@/agentRuntime`（2 行） | 2 |
| `conf/index.ts:5` | 1 类型 | `@toonflow/formats`（R-05a，不计 D1b） | 0 |
| `agent/a2a/settings.ts:71` | 顶层副作用 | 改为 `registerA2aSettingsWatcher()`：首次 `getA2aSignal()` 时注册一次；内部用 `getAgentHost().settings.onChange("a2a", cb)` | — |

> 结果：P2A 从 21 行 / 11 文件降为 **12 静态行（11 值 + 1 类型）/ 2 文件 + 1 动态行 / 1 文件**；`utils.ts`、`routes/**`、`singleAgent`、`mcp/tools`、`conf` 全部不再直连 `@/agent**`。**M1 仍残留一个最小环**：`utils.ts → agentRuntime.ts → agent/mentionFiles.ts → utils.ts`（`mentionFiles` 仍 import `@/utils`，属 B3 的 1 条边），因此 file SCC 到 M4 才归零；模块级 `e7`/`e9` 仍在，等 R-04 清零 A2P 后 `e7` 消失。

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
  - **I1 无顶层捕获**：agent 内不得有模块求值域的 `getAgentHost` 引用（A-09 的 AST 探针）。
  - **I2 注入先于首次使用**：`createApp` 内注入完成于 router 装载之前；所有 Host 消费都发生在请求期或 `mount` 期（A-10）。
  - **I3 fail-fast**：未注入时 `getAgentHost()` 抛固定错误，禁止兜底；二次注入抛固定错误（A-09/S-13b/P15）。

### 4.4 R-04 agent 消费点切换（5 批，精确数字）

| 批次 | 内容 | 条数 | 批次后 A2P | 回滚点 |
| --- | --- | --- | --- | --- |
| **B0 纯下沉**（R-05b，M2） | `documentFormats` 5、`modelReasoning` 6（副本已在 M1 建立）、`mentionSources` 2 | **13** | 74 → **61** | `git revert` 本批；lib shims 恢复直引 |
| **B1 低风险读取**（M3） | `personalization` 3、`teams` 4、`plugins/tools` 2、`skills/files` 1、`documents` 2 | **12** | 61 → **49** | 单批回滚 |
| **B2 模型/媒体/i18n/platform**（M3） | `ai` 3 + `ai/files` 1 + `ai/requestFiles` 1、`media/generation` 1、`ffmpeg` 1、`i18n` 8、`platform` 2 | **17** | 49 → **32** | 单批回滚 |
| **B3 安全敏感**（M4） | `workspace/files` 12 + `chatImages` 1、`assets` 3 + `roots` 3、`browser` 1、`utils` 1 | **21** | 32 → **11** | 单批回滚；S-07 必跑 |
| **B4 配置/MCP**（M4） | `conf` 8、`mcp/control` 2 + `mcp/servers` 1 | **11** | 11 → **0** | 单批回滚 |

**每批硬约束**：
1. 该批结束后 A2P 必须等于表中值（不是"下降即可"）；不等于即失败。
2. 不得新增任何 `@/modules`、`@/lib`、`@/utils` 目标。
3. 不得改变错误 `message`/`status`/`code`；Host 不得包装新错误类型。
4. 每批后跑 S-01/S-05/S-07/S-09（§6.4）；任一失败回滚该批。

**错误语义对照（必须逐条保留）**：`400 文件路径无效`、`403 只能复制普通文件或文件夹`、`409 对话正在运行，请等待回复完成`、`409 画布正在保存，请重试`、`413 个性化文档不能超过 20000 个字符`、`A2A 设置已修改，当前任务已取消`。

### 4.5 R-05a / R-05b 纯契约下沉（`packages/formats`）

| 文件 | 来源 | 阶段 | 内容 | 新位置 |
| --- | --- | --- | --- | --- |
| `modelReasoning.ts` | `apps/server/src/lib/modelReasoning.ts` | **M1** | `thinkingLevels`、`defaultThinkingLevels`、`ThinkingLevel`、`ReasoningEfforts` | `packages/formats/src/modelReasoning.ts`（逐字节副本） |
| `a2a.ts` | `agent/a2a/settings.ts:11–18` 的类型 | **M1** | `A2aSettings`（`thinkingLevel?: ThinkingLevel` 引用同包） | `packages/formats/src/a2a.ts`（新增） |
| `index.ts` | 新增 | **M1** | 显式再导出 `modelReasoning`、`a2a`；M2 再追加两项 | `packages/formats/src/index.ts`（新增） |
| `documentFormats.ts` | `apps/server/src/lib/documentFormats.ts` | **M2** | `documentFormats`、`getDocumentMimeType`、`getTextMimeType`、`getReadableFileMimeType`、`getReadableFileExtension`、`decodeTextFile`、`readableFileAccept` | `packages/formats/src/documentFormats.ts`（逐字节副本） |
| `mentionSources.ts` | `apps/server/src/lib/mentionSources.ts` | **M2** | `MentionQuery`、`mentionAssetType`（同包引用 `./documentFormats`） | `packages/formats/src/mentionSources.ts`（逐字节副本） |

- **M1 的 shim**：`apps/server/src/lib/modelReasoning.ts` 保留，内容为显式再导出（含 `from "@toonflow/formats"`，不含任何 `from "@/(modules|lib|utils)`；`@toonflow/server/modelReasoning` 路径不变）。
- **M2 的 shim**：`apps/server/src/lib/{documentFormats,mentionSources}.ts` 保留，内容为再导出（含 `from "@toonflow/formats"`，不含任何 `from "@/(modules|lib|utils)`；不得 `export *` 把 `a2a`/其他模块带出）；`@toonflow/server/{documentFormats,modelReasoning}`、`@toonflow/server/agent/mentionSources` 路径不变（A-14）。
- **依赖方向**：`packages/formats` 零 dependencies、零 imports（除同包内）；foundation 叶子；不得 import `apps/server` 或任何 domain 包。
- **tsconfig/工作区**：`packages/formats/package.json`（`name: @toonflow/formats`、`exports: { ".": "./src/index.ts" }`、`typecheck` 脚本）+ `tsconfig.json`；根 `workspaces: ["packages/*"]` 已覆盖；`apps/server` 增加 `workspace:*` 依赖。
- **`a2a.ts` 的类型归属**：`agent/a2a/settings.ts` 改为 `import type { A2aSettings } from "@toonflow/formats"; export type { A2aSettings };`（agent→foundation 允许，A-03）。

### 4.6 R-06 装配序列（只增不改语义）

| 步骤 | 现状 | 本版 |
| --- | --- | --- |
| 0 | 设置 `TOONFLOW_DATA_DIR` | 不变 |
| 1 | 动态加载 7 个入口（`Promise.all`） | 不变 |
| 2 | 构造 `ModuleContext` | 不变 |
| 3 | `platform.prepare` | 不变 |
| 4–8 | 插件/技能/Agent 目录初始化、`media.initializeProviders`、`assets.warmup` | 不变 |
| 9 | `media.refreshModels` | 不变 |
| **9.5** | — | **新增：`initializeAgentHost(context)`**（Host 创建 + 注入 + watcher 注册；先于 router） |
| 10 | `await import("@/router")` | 不变 |
| 11 | `mcp.mount` | 不变 |
| 12 | `agentAccess.mount`（E4 动态块） | 不变 |
| 13–15 | 静态资源、错误处理、`local.initializeRuntime` | 不变 |

- 三宿主：桌面 `apps/desktop/src/index.ts:235`（`setRuntimeHost`）→ `:240`（`createApp`）、移动 `apps/mobile/src/server.ts:21`（`setRuntimeHost`）→ `:108`（`createApp`）均经 `createApp`，不监听；`setRuntimeHost` 仍在 `createApp` 之前调用。A-11 与 S-13c 对三宿主同时成立。
- **禁止**：把 `initializeAgentHost` 挂到某个模块入口的静态面（会让 `Promise.all` 阶段求值 agent 契约以外的代码）；把注入挪到 `agentAccess.mount`（晚于 router，违反 I2）。

### 4.7 R-07 / R-08 契约冻结

- `apps/server/package.json` 的 14 个 exports **target 全部不变**；只允许实现文件内部改来源。
- web 的 38 条导入零改动；`agent/types`、`singleAgent/types`、`agent/mentionSources`、`documentFormats`、`modelReasoning`、`nodeMenu`、`desktop` 的 TS 类型形状不变。
- `packages/providers` 零改动；`server-api → ai-providers` 边保持；agent 通过 Host `models` 取模型目录，不直接 import providers。

### 4.8 R-09 / R-12 口径、归属与预算

- **冻结对象**（A-16）：
  - 模块归属算法（glob → 首命中）与计数正则（P1–P18 内的字面量）不变；
  - `map.json` 的 `modules[].files` glob 集合 = M0 集合 ∪ §6.6 的 3 条新增（2 个文件 + 1 个 glob），删除/改写为 0；
  - §6.5 的 P1–P18 命令文本以本文档为准，实施期不得改写（改写即回评审）。
  - 包归属：若地图工具的包→模块映射需要登记，新增 `@toonflow/formats → shared-foundation` 一行；该行属于 manifest，不计为口径漂移。
- **允许的归属迁移**（A-17/A-18）：
  - `server-api.files += ["apps/server/src/agentHost.ts", "apps/server/src/agentRuntime.ts"]`
  - `shared-foundation.files += ["packages/formats/**"]`
  - 3 个纯模块副本与 M0 旧文件逐字节相同（§6.5 P13 的 `diff` 为空）。
- **禁止的漂移**：加宽 glob（如 `apps/server/src/**`）、把新文件塞进既有 glob 的宽匹配（如放进 `lib/**`）以规避归属登记、改计数正则、改 SCC 边类型（值/类型）。
- **预算**（A-17，逐里程碑）：M1 新增代码文件 **6**、`files_total = 712`；M2 新增代码文件 **8**、`files_total = 714`；非代码新增 **恰好 2**；`uncovered = 0`；`coverage_ratio = 1.0`。

---

## 5. 里程碑与精确期望（趋势只在台账，不作验收结论）

> 每一行都是**唯一期望值**；任一分项不等于表中值即失败（不允许"下降即可"）。

| 里程碑 | 内容 | A2P 别名/相对/合计/值 | P2A 源值/型/动态 | P2A 包契约 | P2A 文件 | D1b 行/文件 | `utils.ts` 键 | file SCC 总/含 agent | `e7` | 新增代码/总文件 | 交付门 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **M0** | 基线冻结（本轮，不改代码） | 71 / 3 / 74 / 68 | 17 / 3 / 1 | 3 | 11 | 0 / 0 | 37 | 3 / 1 | 存在 | 0 / 706 | 台账 L01–L24 + **A-23 的 7 项自检全部复现** |
| **M1** | 契约 + 门面 + Host 实现 + 步骤 9.5 注入 + 反向收敛 + **R-05a** | **71 / 3 / 74 / 68** | **11 / 1 / 1** | 3 | **3** | **10 / 5** | **38** | **3 / 1** | 存在 | **6 / 712** | typecheck + build + **S-01～S-13**（S-05 判 `pre_error=AgentHost 未注入 / post=true`、S-13b 生效）+ A-04/A-05/A-07/A-09/A-10/A-21/A-22/**A-23** |
| **M2** | B0 纯下沉（R-05b） | **61 / 0 / 61 / 60** | 11 / 1 / 1 | 3 | 3 | 10 / 5 | 38 | 3 / 1 | 存在 | **8 / 714** | 单批回归 + A-17 里程碑门 |
| **M3** | B1 + B2 | **32 / 0 / 32 / 31** | 11 / 1 / 1 | 3 | 3 | 10 / 5 | 38 | 3 / 1 | 存在 | 8 / 714 | 单批回归 |
| **M4** | B3 + B4 | **0 / 0 / 0 / 0** | 11 / 1 / 1 | 3 | 3 | 10 / 5 | 38 | **2 / 0** | **不存在** | 8 / 714 | S-07、S-09、S-10、S-12 重点 |
| **M5** | 文档、地图、AGENTS、全量判据（R-06/R-07/R-08/R-09/R-11/R-12） | 0 / 0 / 0 / 0 | 11 / 1 / 1 | 3 | 3 | 10 / 5 | 38 | 2 / 0 | 不存在 | 8 / 714 | **A-01～A-23 全 PASS（含 A-23 的 7 项自检）** |

> ① M1 的 A2P **必须仍是 74**：证明"只加不改、反向先收敛"；M2 起 A2P 严格等于表中值。② M1–M3 的 file SCC 仍为 `3 / 1`，残留最小环是 `utils.ts → agentRuntime.ts → agent/mentionFiles.ts → utils.ts`（`mentionFiles` 的 `@/utils` 边要到 B3 才移除）；M4 才变 `2 / 0`。③ **模块级 `e7` 仍在**（agent 仍 import 应用），SCC 与 `e7` 都由 A-08 判定。④ **M1 必须有 `packages/formats`**（R-05a），否则 A-04/A-05 的 3 文件/13 行不可达；M2 才补齐另外两个纯模块。⑤ M5 的 `files_total` 与 M2 相同（无新增代码文件），8 个新文件集合在 M2 已封闭。⑥ **A-23 自检在 M0 即全部可执行**（7 项，E27–E33 已实跑），因此 M5 门不存在"自检不可执行"的死路；M1–M5 只需重跑同一组命令确认未回退。

---

## 6. 验收标准

### 6.1 二值判定表（A-01～A-23）

| 编号 | 判据 | 探针 | 期望（唯一值 / 精确集合） | 正控制（防空转） |
| --- | --- | --- | --- | --- |
| **A-01** | agent→应用 别名边 = 0 | P1 | `0` | M0 快照 `71`（P1 在 `git show 89572b5:apps/server/src/agent` 上 >0） |
| **A-02** | agent→应用 相对逃逸边 = 0 | P2 | `0` | M0 `3` |
| **A-03** | agent→应用 合计 = 0 且值边 = 0 | P1+P2 双算 | `0 / 0` | M0 `74 / 68` |
| **A-04** | P2A 文件集合 = 门面定义面 D1a | P3a | 精确等于 `{apps/server/src/agentRuntime.ts, apps/server/src/agentHost.ts, apps/server/src/modules/agentAccess/index.ts}` | M0 `11` 文件；M5 集合非空（3） |
| **A-05** | P2A 说明符集合 = 枚举 13 行（静态值 11 + 静态类型 1 + 动态 1） | P3b | 精确等于 §6.5 P3b 的 13 行枚举；`静态值=11, 静态类型=1, 动态=1` | 同正则 M0 `21` 行 |
| **A-06** | P2A 包契约 = 3 | P4 | `3`（`modules/platformCore/conf/index.ts`、`modules/pluginMarket/teams/files.ts`、`routes/agents/connect.ts` 各 1） | 同正则 M0 `3`；文件非空 |
| **A-07** | `utils.ts` 不再聚合 agent；出口键精确 38 | P5a/P5b | `@/agent` 行 = `0`；默认导出键 = `38`，键集合**恰好** = M0 的 37 键 ∪ `{agentRuntime}`；`agent/canvas/question/a2aSettings/mentionFiles` 5 键仍在 | M0 `5` 行 / `37` 键；`agentRuntime` 键由 A-21 证明非空转 |
| **A-08** | file SCC：含 agent = 0；总数 = 2；地图 `e7` = 0 | P6/P6b | `scc_total=2, agent_scc=0, e7=0` | M0 `3 / 1 / 1` |
| **A-09** | 注入唯一、无顶层捕获、fail-fast | P7 + P7b + P15 | `export function configureAgentHost`=1；`export function getAgentHost`=1；`configureAgentHost(createAgentHost`=1；`export function initializeAgentHost`=1；`app.ts` 内 `initializeAgentHost(`=1；`AgentHost 未注入`=1；`AgentHost 已注入`=1；**`module_scope_refs=0`**；**P15 的 `failfast_exit=0` 且退出码 `0`** | P7b-T `3`；P15-T1 `0`、P15-T2 `4`、P15-T3 `9`（§6.10）；M0 `agent/host.ts` 不存在 → G2 先判存在（不存在即 FAIL，不得判"无异常"） |
| **A-10** | 注入时序可实现 | P8 | ① `prepare 行号 < inject 行号 < router 行号`；② `agentHost.ts` 静态可达 agent 文件集合 = **恰好** `{apps/server/src/agent/host.ts}`；③ `app.ts` 静态可达 agent = `0` | M0：`agentHost.ts` 不存在（G2 先判存在）；`app.ts` 静态可达 agent = `0` 且 `router import` 存在 |
| **A-11** | 数据目录时序不变 | P9 | ① `<tmp>/settings.json` 存在且可被 `json.load` 解析；② 仓库 `data/settings.json` 的 `md5` 与 `mtime` 前后相等；③ 日志出现 `[服务启动成功]` | M0 同命令应通过（E17 历史实跑） |
| **A-12** | 全仓类型检查通过 | `bun run typecheck`（根） | 退出码 `0` | M0 同命令 `0` |
| **A-13** | 构建通过 | `bun run build` | 退出码 `0`，产物可启动 | M0 同命令 `0` |
| **A-14** | web / 宿主契约未破坏 | P10 | `apps/web` `typecheck` + `build` 退出码 `0`；`apps/server/package.json` 的 14 个 exports target 与 M0 逐字相等 | M0 快照比对（E9：exports 14） |
| **A-15** | 13 项冒烟逐条通过 | §6.4 | **16/16 子断言（13 项）**；每条给出精确状态码/事件/文案；S-02b 是 S-02 的第二子项，S-13a/b/c 是 S-13 的三个子项；S-05/S-13b 是迁移项，M0/M5 期望不同（§6.4 明示） | 每条有固定 fixture 与精确期望；S-12/S-13 已在 M0 实跑（E13/E17） |
| **A-16** | 计数口径未漂移 | P11 | `map.json` 的 glob 集合 = M0 glob 集合 ∪ §6.6 manifest（3 条新增：2 个文件 + 1 个 glob）；删除 = 0、改写 = 0；§6.5 P1–P18 命令文本与本文档逐字一致 | M0 基线 glob 快照；新增集合非空 |
| **A-17** | 归属覆盖、文件预算与新增文件集合 | P12 + P14 | ① `uncovered = 0`；② `files_total = 714`；③ `code_new` **恰好** 8 个路径（§6.6 表）；④ `noncode_new` **恰好** `{packages/formats/package.json, packages/formats/tsconfig.json}`；⑤ 里程碑：M1 `code_new=6`、`files_total=712`；M2 `code_new=8`、`files_total=714` | M0 `code_new=0 / noncode_new=0 / files 706`（E11）；P14-T `1 / 1`（E28） |
| **A-18** | 归属迁移与深引登记 | P13 | ① 3 个纯模块副本与 M0 旧文件逐字节相同（`diff` 空）；② 旧路径仍存在且为再导出 shim（`SHIM_OK` 且 `PURE`，见 P13）；③ 新增跨模块深引文件（`@/modules/<id>` 深引）= `1`（`agentHost.ts`，importer 侧）；④ 新增 source→target 子模块对 = `0` | M0 旧文件存在（3/3）；M5 副本存在且 `diff` 空 |
| **A-19** | 未新增测试/自检/CI | `git status --porcelain` 过滤 | 命中 `0`：`.test.ts`、`.spec.ts`、`scripts/check*`、`check*.ts`；`package.json` 新增脚本名以 `test` 或 `check` 开头（**`typecheck` 不算**） | 过滤命令对 M0 命中 `0` |
| **A-20** | 文档与依赖表同源 | §6.8 逐行比对 | AGENTS.md 模块表 8 行 `dependencies` 精确等于 §6.8 表；`agentAccess.dependencies = ["platformCore","pluginMarket"]`；目录结构包含两个新 bootstrap 文件、`packages/formats` 与步骤 9.5；新增"门面导入面 5 文件 / 10 行"登记 | 直接字符串比对（含空格） |
| **A-21** | 门面导入面精确（D1b） | P17 | 行 `10`、文件 `5`、值 `8`、类型 `2`；文件集合 = `{utils.ts, routes/agent.ts, singleAgent/index.ts, singleAgent/types.ts, mcp/tools.ts}`；说明符集合 = `{./agentRuntime ×1, @/agentRuntime ×9}` | M0 `0 行 / 0 文件`（E21 历史值）；`utils.ts` 的 `agentRuntime` 键由 A-07 精确判定 |
| **A-22** | A2A watcher 从模块顶层迁到 Host 注入后的惰性注册 | P16 + S-05 | ① 静态：`agent/**` 内 `conf.onDidChange` = `0`；`agent/a2a/settings.ts` 内 `export function registerA2aSettingsWatcher` = `1` 且 `registerA2aSettingsWatcher()` 调用 = `1`；`agent/host.ts` 内 `onChange(` = `1`；② 运行时：`pre_error` 精确 `AgentHost 未注入`、`post_aborted=true`、`reason` 精确 `A2A 设置已修改，当前任务已取消` | M0 静态 `1 / 0 / 0 / G2`（E9）；M0 运行时 `pre_error=none`、`post_aborted=true`、reason 同（E12/P16）；**P16-T-a/b 证明探针能区分两相**（E32/E33） |
| **A-23** | **探针自检（G5）7 项** | P7b-T / P14-T / P15-T1～T3 / P16-T-a/b（§6.10 一次复跑） | **T1** `module_scope_refs=3`（exit 1）；**T2** `code_new=1 noncode_new=1`（exit 0）；**T3** `failfast_exit=0`（exit 0）；**T4** `failfast_exit=4`（exit 4）；**T5** `failfast_fixture_invalid`（exit 9）；**T6** `pre_error=none / post_aborted=true / reason 精确`（exit 0）；**T7** `pre_error=AgentHost 未注入 / post_aborted=true / reason 精确`（exit 0）。**7/7 全等于期望** | ① 两个负控制（T4/T5）证明探针能发现"无 fail-fast""无二次注入保护""缺导出"；② T6/T7 同一脚本两相不同输出，证明 P16 非空转；③ **fixture 自包含 7/7、跨探针复用 0**（§6.10 的 `fixture_audit`）；④ 任一不等即 FAIL（探针不可信） |

### 6.2 判定规则（消除"不可唯一判定"）

1. **只有 PASS / FAIL**：任何"基本通过""趋势良好""可接受"都不成立。
2. **期望必须是整数或精确集合**：A 表内不得出现 `≤`、`≥`、`约`、`区间`、`只降不升`、`趋势`、`含…或…`。台账可记录范围，但不进入 A 表。
3. **双算一致**（G3）：A-01～A-07、A-08、A-17、A-21 的每个数字必须由 `grep` 与 Python 解析各算一次，两次相等才 PASS；不相等判 FAIL（说明口径有歧义）。
4. **不可达即回评审**：实施中若发现某期望不可达（例如新文件导致 `files_total` 不是 714，或某自检退出码不等于期望），**不得就地放宽**；必须回需求评审修订本表并重新出号。
5. **冲突优先级**：A 表内部若出现互相矛盾，以"更严 + 更具体"者为准，且必须在同一轮内改写另一条；不允许留两条同时成立。
6. **豁免前置**：任何未在 §8 登记的边/文件，一律计入判据分子；登记项必须给出"为何不能消除 / 代价 / 复核方式 / 复核人"。
7. **相位**：A 项在 M5 判定；M0 只做正控制与基线记录；M1–M4 用 §5 的里程碑门。S-05/S-13b 的 M0 期望与 M5 不同，§6.4 已逐条写明；**A-23 的 7 项自检在 M0 起即可执行**，且每个里程碑都要重跑（防回退）。
8. **探针先行**：P7b/P14/P15/P16 在任一里程碑使用前，必须先跑对应自检（A-23）；自检不过，探针结果不得作为判定依据。
9. **自检必须自包含**（本轮新增，打回根因）：每项自检的"创建 fixture + 运行 + 期望"三件套必须写在**同一个代码块**内；**禁止**复用其他探针的 fixture（G7）。fixture 命名空间按探针隔离（`p7b/`、`p15/`、`p16/`、`new_files_fixture/`）。

### 6.3 趋势的落地（不参与验收）

- 每个里程碑按 §6.5 探针记录 L01–L24 一行，共 6 行；
- "趋势可验证" = 6 行台账的每个分项**等于 §5 的表中值**；不等于即失败；
- 评审人可独立重跑 P1–P18 与 §6.10 复算任意一行；台账不写入仓库脚本（C4）。

### 6.4 冒烟矩阵（13 项，逐条二值）

#### 6.4.1 固定 fixture（全部放 `/tmp`，执行后删除；不写入仓库）

| 编号 | fixture | 内容 |
| --- | --- | --- |
| F1 | 数据目录 | `TMP=$(mktemp -d)`；`$TMP/settings.json` 预置：`{"settings":{"customProviders":[{"id":"fixture","apiUrl":"http://127.0.0.1:3988/v1","apiKey":"fixture-key","protocol":"openai-completions","models":[{"id":"fixture-model","label":"Fixture"}]}]}}` |
| F2 | 工作区 | `mkdir -p "$TMP/workspaces/ws"`；所有请求的 `directory` = `$TMP/workspaces/ws` 的绝对路径（`realpath` 后） |
| F3 | 假供应商 | `/tmp/fake-openai.mjs`：`Bun.serve`；`POST /v1/chat/completions` 返回 `Content-Type: text/event-stream`，固定 2 个 chunk（`delta.content="OK"` + `finish_reason="stop"` + usage）与 `data: [DONE]`；`FAKE_DELAY_MS` 控制延迟（S-03 用 4000，其余用 0） |
| F4 | 启动 | `cd apps/server && TOONFLOW_DATA_DIR="$TMP" TOONFLOW_SERVER_PORT=<port> bun src/index.ts`；等待日志 `[服务启动成功]` |
| F5 | 语言头 | 需要精确中文时带 `Accept-Language: zh-CN`；需要英文时带 `Accept-Language: en` |
| F6 | 单 Agent 头 | `Origin: http://127.0.0.1:<port>` + `x-toonflow-workspace: 1`（`assertAppRequest` 要求） |

#### 6.4.2 13 项断言

| # | 场景 | 入口与精确请求 | 二值断言 | M0 基线 |
| --- | --- | --- | --- | --- |
| **S-01** | Agent 流式文本 | `POST /api/agent`，`{"prompt":"请只回复 OK","directory":"<ws>","providerId":"fixture","modelId":"fixture-model"}`；F3 延迟 0 | HTTP `200`；`Content-Type: application/x-ndjson; charset=utf-8`；首行 `type=session`；恰好 1 行 `type=userMessage`；末行 `type=done`；`type=error` 行数 `0`；存在 `type=text` 且 `delta=OK` | PASS（E14 历史实跑） |
| **S-02** | 附件校验（参数层） | `POST /api/agent`，`attachments:[{"name":"a.zip","path":"/etc/hosts","mimeType":"application/zip"}]`；`zh-CN` | HTTP `400`；`Content-Type: application/json`；body 精确 `{"code":400,"data":["字段 attachments.0 不支持此附件格式"],"message":"参数错误"}` | PASS |
| **S-02b** | 文本附件超限（运行期） | 在 `<ws>/a.txt` 写 `400001` 个 `a`；`attachments:[{"name":"a.txt","path":"a.txt","mimeType":"text/plain"}]`；`zh-CN` | HTTP `200`（NDJSON 已 flush）；恰好 1 行 `type=error`，`message` 精确 `文本附件最多支持 100000 个字符，请缩小内容后重试`；`done` 行数 `0` | PASS |
| **S-03** | 并发会话 | ① A：`POST /api/agent`（无 `sessionFile`）→ 等到 `done`，取 `session.file=S`；② B：同 body + `"sessionFile":S`（F3 延迟 4000）→ 等到 B 首行；③ C：同 body + `"sessionFile":S`；`zh-CN` | C：HTTP `200`；恰好 1 行 `type=error`，`message` 精确 `对话正在运行，请等待回复完成`；C 的 `done` 行数 `0`；B 最终含 `done` | PASS（E15 历史实跑） |
| **S-04** | 会话操作 | ① `GET /api/agent/get?directory=<ws>&sessionFile=S` → 取 `data.messages[0].entryId=E`；② `POST /api/agent/fork`，`{"directory":"<ws>","sessionFile":S,"entryId":E}`；③ 在 S-03 的 B 在跑时 `POST /api/agent/compact`（`{"directory":"<ws>","sessionFile":S}`）与 `POST /api/agent/rewind`（`+ "entryId":E`）；`zh-CN` | ② HTTP `200` 且 `code=200`、`data.file` 匹配 `^[\w-]+\.jsonl$`、`data.conversation.messages[0].entryId == E`；③ compact：HTTP `409` 且 body 精确 `{"code":409,"data":null,"message":"对话正在运行，请先停止后再压缩"}`；rewind：HTTP `409` 且 body 精确 `{"code":409,"data":null,"message":"对话正在运行，请先停止后再回退"}` | PASS（E26 历史实跑） |
| **S-05** | A2A watcher 迁移 | `/tmp/a2a_watch.ts`（P16，`cd apps/server` 执行）：`TOONFLOW_DATA_DIR=<tmp>` → import `agent/a2a/settings.ts` → **注入前**调 `getA2aSignal()`，记录 `pre_error`（无异常记 `none`）→ import `conf` → `createApp({webRoot:<tmp>,dataDirectory:<tmp>})` → 再调 `getA2aSignal()` → `conf.set("a2a",{…token:"b"*32})` → 等 1200ms → 记录 `post` | **M5**：`pre_error` 精确 `AgentHost 未注入`、`app_ok function`、`post_aborted=true`、`post.reason.message` 精确 `A2A 设置已修改，当前任务已取消`。**M0 正控制**：`pre_error=none`、`post_aborted=true`、reason 同（E12） | M0：`none/true`（迁移项，M0 期望不同） |
| **S-06** | A2A 网关关闭态 | A2A 未启用（F1 默认）；`GET /a2a/demo`、`POST /a2a/demo`（body `{}`） | 两者均 HTTP `404`，响应体精确 `Not Found` | PASS（E25 历史实跑） |
| **S-07** | 工作区越界 | `GET /api/workspaces/files/list?directory=<ws>&path=../etc`；`zh-CN` | HTTP `400`；body 精确 `{"code":400,"data":null,"message":"文件路径无效"}` | PASS |
| **S-08** | 素材提及源 | `GET /api/agent/mentionSource?operation=canvases&directory=<ws>` | HTTP `200`；body 精确 `{"code":200,"data":[],"message":"Success"}` | PASS（E24 历史实跑） |
| **S-09** | MCP 网关 | ① 默认设置 `POST /mcp`（无 token）→ HTTP `401`；② F1 增加 `"mcp":{"enabled":true,"token":"<64 位 hex>","port":0}` 后，带 `Authorization: Bearer <token>` + `Accept: application/json, text/event-stream`：`initialize` → 取响应头 `Mcp-Session-Id` → `notifications/initialized` → `tools/list` | ① HTTP `401`，body 精确 `{"jsonrpc":"2.0","id":null,"error":{"code":-32001,"message":"MCP is not enabled or the access credentials are invalid"}}`；② initialize HTTP `200`（SSE `event: message`）；notifications HTTP `202`；tools/list HTTP `200`，解析 `data:` 行后 `result.tools` **46** 个、名称排序列表与 M0 逐项相等（首项 `getAppState`） | PASS（M0=46，历史实跑） |
| **S-10** | 单 Agent | ① `POST /api/singleAgent/create`（F6 头）`{"tools":[],"directory":"<ws>","systemPrompt":"x"}` → 取 `data.sessionId`；② `POST /api/singleAgent/run` `{"sessionId":<S>,"runId":<uuid4>,"prompt":"请只回复 OK","providerId":"fixture","modelId":"fixture-model"}`；③ `POST /api/singleAgent/control` `{"sessionId":<S>,"action":"close"}` | ① HTTP `200`，body 精确 `{"code":200,"data":{"sessionId":"<uuid4>"},"message":"Success"}`；② HTTP `200`、NDJSON，事件类型序列**逐项等于 M0 采集值** `[status, text, text, text, text, complete, status, done]`，首行 `{"type":"status","status":"running"}`，末行 `{"type":"done"}`，`type=error` 行数 `0`；③ HTTP `200`，body 精确 `{"code":200,"data":{"status":"idle"},"message":"Success"}` | PASS（E23 历史实跑） |
| **S-11** | 技能与团队列表 | ① `GET /api/agent/skills?directory=<ws>`（F1 空工作区）；② `GET /api/agents/get`（无 F6 头） | ① HTTP `200`、`code=200`，`data` 名称排序**恰好** `["canvas","v118workflow","workflow"]`（3 个内置技能）；② HTTP `200`，body 精确 `{"code":200,"data":{"agents":[]},"message":"Success"}` | PASS（E22 历史实跑） |
| **S-12** | i18n 逐请求 | `POST /api/agent`，`{"prompt":"{{mention:11111111-1111-4111-8111-111111111111}}","directory":"<ws>","providerId":"fixture","modelId":"fixture-model","mentions":[{"id":"11111111-1111-4111-8111-111111111111","label":"越界媒体","source":{"kind":"canvas","canvasId":"x.json","canvasName":"x","nodeId":"n1","nodeName":"n","outputId":"o1","outputName":"out"},"dataType":"IMAGE","value":{"url":"/etc/hosts","mimeType":"image/png"}}]}`；分别带 `Accept-Language: en` 与 `zh-CN` | 各返回恰好 1 行 `type=error`：<br>`en`：`{"type":"error","message":"Reference \"越界媒体\" is not available: 文件路径无效"}`<br>`zh-CN`：`{"type":"error","message":"引用「越界媒体」不可用：文件路径无效"}`<br>两条字符串必须**逐字符相等**（不作"是英文"这类主观判定） | PASS（E13 历史实跑） |
| **S-13a** | 服务端装配 + 数据目录 | F1/F4；`GET /api/tools/get`；记录仓库 `data/settings.json` 的 md5 与 mtime | 日志含 `[服务启动成功]`；`$TMP/settings.json` 存在且 `json.load` 成功；`GET /api/tools/get` → HTTP `200` 且 body `code=200`；仓库 `data/settings.json` md5 与 mtime 前后相等 | PASS（E17 历史实跑） |
| **S-13b** | fail-fast + 双注入 | `/tmp/host_failfast.ts`（P15） | 退出码 `0`；stdout `failfast_exit 0`；覆盖：未注入抛 `AgentHost 未注入`、注入后 `getAgentHost()===sentinel`、二次注入抛 `AgentHost 已注入` | M0：`agent/host.ts` 不存在 → G2 先判存在（迁移项，M0 不判 PASS/FAIL）；**探针自身的可信度由 P15-T1～T3 证明（E29–E31）** |
| **S-13c** | 桌面/移动静态装配 | 精确计数（P18） | 桌面 `apps/desktop/src/index.ts`：`await import("@toonflow/server/app")`=1、`await createApp({`=1、`setRuntimeHost("desktop")` 行号 `<` `createApp` 行号、`app.listen(`=0、`@/agent` 引用=0；移动 `apps/mobile/src/server.ts`：`await import("@toonflow/server/app")`=1、`await createApp({`=1、`setRuntimeHost("mobile")` 行号 `<` `createApp` 行号、`app.use(toonflow)`=1、`@/agent` 引用=0 | PASS（235<240；21<108，历史实测） |

> **计数口径**：S-01～S-13 共 13 项；S-02 含 S-02a（表中 S-02）与 S-02b 两个子断言，S-13 含 S-13a/b/c 三个子断言，故表中 16 行子断言必须 **16/16** 全过。
> **S-02b 说明**：该路径在 `agent/runtime/index.ts:80` 抛 `status:400`，但响应头已 flush，所以 HTTP 仍是 `200`，错误以 NDJSON `type=error` 返回；这与 S-02 的参数层 `400 JSON` 不是同一路径，断言分开。
> **S-05 说明**：它是**迁移判据**（M0 期望 `pre_error=none`，M5 期望 `pre_error=AgentHost 未注入`），不是纯回归；M0 的 `none` 是探针非空转的正控制。两个相位的可产出性由 **P16-T-a/P16-T-b** 证明（E32/E33）。
> **S-13b 说明**：M0 没有 `agent/host.ts`，所以只能做"存在性检查"，不能判 PASS；M5 必须退出码 0。**S-13b 依赖的 P15 探针本身必须先通过 P15-T1～T3**（§6.10）。
> **S-13c 说明**：桌面/移动宿主无法在当前环境启动（无 Electrobun/DevEco），因此用"精确静态计数 + 行序"代替运行时；这与第 2 轮审查报告 §7 的环境限制一致，且所有数字可复算。

---

### 6.5 探针（P1–P18 + 7 项自检，可直接粘贴）

> 统一约定：`ROOT=$(pwd)`（仓库根）；`BUN=/opt/homebrew/bin/bun`（本机 `bun` 不在 `PATH` 时覆盖）。所有命令只读，不写仓库。
> **自检块格式（G7）**：每个自检块都是"创建 fixture + 运行 + 期望"三件套，**fixture 只在本块内创建、只在本块内使用**。

```bash
# P1 agent→应用（别名口径；地图 e7 对账用）
grep -rn --include='*.ts' -E "from ['\"]@/(modules|lib|utils|routes|types|app|router|core)" apps/server/src/agent | wc -l
# M0=71  M5=0
```

```bash
# P2 agent→应用（相对逃逸）
grep -rn --include='*.ts' -E "from ['\"]\.\./(\.\./)?(lib|modules|utils)" apps/server/src/agent | wc -l
# M0=3   M5=0
```

```bash
# P3a 反向直连文件集合（A-04；边界正则：@/agentRuntime、@/agentHost 不计）
grep -rlE --include='*.ts' '@/agent(/|[^A-Za-z])' apps/server/src --exclude-dir=agent | sort
# M0=11 文件；M5 精确等于 3 个枚举文件（见 A-04）
```

```bash
# P3b 反向直连说明符集合（A-05）
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
```

```bash
# P4 包契约（A-06）
grep -rn --include='*.ts' "@toonflow/teams-scaffold" apps/server/src --exclude-dir=agent | wc -l
# M0=3  M5=3
```

```bash
# P5a utils 不再直连 agent（A-07）
grep -cE '@/agent(/|[^A-Za-z])' apps/server/src/utils.ts           # M0=5  M5=0

# P5b utils 默认导出键（A-07；精确集合）
python3 - <<'PY'
import re
t=open('apps/server/src/utils.ts',encoding='utf-8').read()
body=t.split('export default {',1)[1].split('\n};',1)[0]
keys=re.findall(r'^\s{2}([A-Za-z_$][\w$]*),\s*$',body,re.M)
print("keys",len(keys)); print("\n".join(sorted(keys)))
PY
# M0=37；M5=38（= M0 ∪ {agentRuntime}）
```

```bash
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
```

```bash
# P6b 地图边 e7（A-08）
python3 - <<'PY'
import json
m=json.load(open('.easyvibe/map/map.json'))
print(sum(1 for e in m['edges'] if e['from']=='agent-runtime' and e['to']=='server-api'))
PY
# M0=1  M5=0（重算后的 map.json）
```

```bash
# P7 注入注册与唯一（A-09 的 7 个静态子项）
grep -c "export function configureAgentHost" apps/server/src/agent/host.ts                   # 1
grep -c "export function getAgentHost" apps/server/src/agent/host.ts                        # 1
grep -rn "configureAgentHost(createAgentHost" apps/server/src --include='*.ts' | wc -l       # 1
grep -c "export function initializeAgentHost" apps/server/src/agentHost.ts                   # 1
grep -n "initializeAgentHost(" apps/server/src/app.ts | wc -l                                # 1
grep -c "AgentHost 未注入" apps/server/src/agent/host.ts                                     # 1
grep -c "AgentHost 已注入" apps/server/src/agent/host.ts                                     # 1
# M0：host.ts / agentHost.ts 不存在 → G2 先判存在（不存在即 FAIL）
```

```bash
# P7b 模块求值域引用探针（A-09 的 I1；AST）
cat > /tmp/agent_scope_probe.mjs <<'MJS'
const ROOT = process.argv[2];
const TARGET = process.argv[3] ?? `${ROOT}/apps/server/src/agent`;
const EXCLUDE = process.argv[4] ?? `${TARGET}/host.ts`;
const { parse } = await import(`${ROOT}/apps/server/node_modules/@babel/parser/lib/index.js`);
const fs = await import("node:fs");
const path = await import("node:path");
const NAME = "getAgentHost";
const DEFERRED = new Set(["FunctionDeclaration","FunctionExpression","ArrowFunctionExpression","ObjectMethod","ClassMethod","ClassPrivateMethod"]);
function walk(node, found) {
  if (!node || typeof node.type !== "string") return;
  if (node.type === "ImportDeclaration") return;
  if (node.type === "ClassDeclaration" || node.type === "ClassExpression") {
    for (const el of node.body.body) {
      if (el.type === "StaticBlock") walk(el, found);
      else if ((el.type === "ClassProperty" || el.type === "ClassAccessorProperty") && el.static) walk(el.value, found);
    }
    return;
  }
  if (DEFERRED.has(node.type)) return;
  if (node.type === "Identifier" && node.name === NAME) { found.push(node.start); return; }
  for (const [, value] of Object.entries(node)) {
    if (Array.isArray(value)) { for (const child of value) if (child && typeof child.type === "string") walk(child, found); }
    else if (value && typeof value.type === "string") walk(value, found);
  }
}
function files(dir) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) out.push(...files(p));
    else if (p.endsWith(".ts") && !p.endsWith(".d.ts")) out.push(p);
  }
  return out;
}
let total = 0; const bad = [];
for (const file of files(TARGET)) {
  if (path.resolve(file) === path.resolve(EXCLUDE)) continue;
  const ast = parse(fs.readFileSync(file, "utf8"), { sourceType: "module", plugins: ["typescript"], errorRecovery: true });
  const found = [];
  for (const stmt of ast.program.body) walk(stmt, found);
  if (found.length) { total += found.length; bad.push(`${path.relative(ROOT, file)}:${found.length}`); }
}
console.log(`module_scope_refs ${total}`);
if (bad.length) console.log(bad.join("\n"));
process.exit(total === 0 ? 0 : 1);
MJS
$BUN /tmp/agent_scope_probe.mjs "$ROOT"
# M0=0（exit 0）；M5=0（exit 0）
```

```bash
# P7b-T 自检（A-23 T1）：合成 fixture 必须报 3（顶层 const / 顶层 if / class static）
mkdir -p /tmp/agenthost_fixture/p7b/agent
cat > /tmp/agenthost_fixture/p7b/agent/sample.ts <<'TS'
import { getAgentHost } from "./host";
const captured = getAgentHost();
if (process.env.X) { getAgentHost(); }
export function ok() { const h = getAgentHost(); return h; }
const arrow = () => getAgentHost();
class A { static s = getAgentHost(); m() { return getAgentHost(); } }
TS
cat > /tmp/agenthost_fixture/p7b/agent/host.ts <<'TS'
export function getAgentHost() { throw new Error("AgentHost 未注入"); }
TS
$BUN /tmp/agent_scope_probe.mjs "$ROOT" /tmp/agenthost_fixture/p7b/agent
# 期望：module_scope_refs 3（exit 1）
```

```bash
# P8 注入时序（A-10）
python3 - <<'PY'
import re
t=open('apps/server/src/app.ts',encoding='utf-8').read().splitlines()
def idx(pat):
    for i,l in enumerate(t,1):
        if re.search(pat,l): return i
    return -1
prepare=idx(r'await platform\.prepare\(')
inject=idx(r'initializeAgentHost\(')
router=idx(r'await import\("@/router"\)')
print("prepare",prepare,"inject",inject,"router",router)
PY
# 期望：prepare < inject < router
```

```bash
# P8b 静态可达性（A-10 ②③；相对 import 解析）
python3 - <<'PY'
import os,re
SRC="apps/server/src"
def res(s,c):
    if s.startswith("@/"): p=os.path.join(SRC,s[2:])
    elif s.startswith("."): p=os.path.normpath(os.path.join(os.path.dirname(c),s))
    else: return None
    for q in (p+".ts",os.path.join(p,"index.ts")):
        if os.path.isfile(q): return q
pat=re.compile(r"""^\s*(import|export)\s+(?!type\b)(.*?)from\s*['"]([^'"]+)['"]""",re.M)
def closure(entry):
    seen=set(); stack=[entry]
    while stack:
        f=stack.pop()
        if f in seen or not f or not os.path.isfile(f): continue
        seen.add(f)
        for m in pat.finditer(open(f,encoding="utf-8").read()):
            x=res(m.group(3),f)
            if x: stack.append(x)
    return seen
for entry in ["apps/server/src/app.ts","apps/server/src/agentHost.ts"]:
    if not os.path.isfile(entry): print(entry,"MISSING"); continue
    c=closure(entry)
    print(entry,"files",len(c),"agent_hits",[p for p in c if "/agent/" in p])
PY
# 期望：agentHost.ts 的 agent 可达集恰好 ['apps/server/src/agent/host.ts']；app.ts agent_hits []
```

```bash
# P9 数据目录（A-11；源码启动，不用 build 产物）
TMP9=$(mktemp -d)
( cd apps/server && TOONFLOW_DATA_DIR="$TMP9" TOONFLOW_SERVER_PORT=3999 timeout 25 $BUN src/index.ts > /tmp/start9.log 2>&1 & echo $! > /tmp/start9.pid )
sleep 8
grep -q '\[服务启动成功\]' /tmp/start9.log && echo START_OK
python3 -c "import json;json.load(open('$TMP9/settings.json'));print('CONF_JSON_OK')"
curl -s -o /dev/null -w 'TOOLS_HTTP=%{http_code}\n' http://127.0.0.1:3999/api/tools/get
kill "$(cat /tmp/start9.pid)" 2>/dev/null
# 期望：START_OK / CONF_JSON_OK / TOOLS_HTTP=200
```

```bash
# P10 web 与 exports（A-14）
python3 - <<'PY'
import json
d=json.load(open('apps/server/package.json'))['exports']
print("exports",len(d))
for k,v in sorted(d.items()): print(k,v)
PY
# M0 快照比对：14 行逐字相等
```

```bash
# P11 口径冻结（A-16）
python3 - <<'PY'
import json
m=json.load(open('.easyvibe/map/map.json'))
for mo in m['modules']:
    if mo['id'] in ('server-api','shared-foundation'):
        print(mo['id'],len(mo['files']))
        for g in mo['files']: print("  ",g)
PY
# 期望：新增恰好 3 条（server-api 2 个文件 + shared-foundation 1 个 glob）；删除 0 条；改写 0 条
```

```bash
# P12 覆盖（A-17）
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
# M0: files 706 uncovered 0    M1: 712    M2/M5: 714
```

```bash
# P13 归属迁移与深引（A-18）
for f in documentFormats modelReasoning mentionSources; do
  git show 89572b5:apps/server/src/lib/$f.ts | diff - packages/formats/src/$f.ts >/dev/null && echo "$f IDENTICAL"
  grep -q 'from "@toonflow/formats"' apps/server/src/lib/$f.ts && echo "$f SHIM_OK"
  ! grep -qE 'from "@/(modules|lib|utils)' apps/server/src/lib/$f.ts && echo "$f PURE"
done
# 期望：3 个 IDENTICAL；3 个 SHIM_OK；3 个 PURE

for f in packages/formats/src/documentFormats.ts packages/formats/src/modelReasoning.ts packages/formats/src/mentionSources.ts \
         packages/formats/src/a2a.ts packages/formats/src/index.ts apps/server/src/agent/host.ts \
         apps/server/src/agentHost.ts apps/server/src/agentRuntime.ts; do
  grep -q 'from "@/modules' "$f" && echo "DEEP $f"
done
# 期望：只输出 DEEP apps/server/src/agentHost.ts

for m in assetLibrary mediaGeneration pluginMarket mcpIntegration localRuntime agentAccess platformCore; do
  n=$(git grep -l "@/modules/$m" 89572b5 -- apps/server/src/utils.ts apps/server/src/routes | wc -l | tr -d ' ')
  [ "$n" -gt 0 ] && echo "$m EXISTING"
done
# 期望：7 行 EXISTING（无新增子模块对）
```

```bash
# P14 新增文件集合（A-17）
cat > /tmp/new_files_probe.py <<'PY'
import subprocess, sys, os
repo, base = sys.argv[1], sys.argv[2]
CODE = {".ts",".tsx",".js",".jsx",".mjs",".cjs",".mts",".cts",".vue",".sql",".ets",".java",".kt",".kts",".cs",".cpp",".h",".hpp",".m",".mm"}
def git(*a):
    return subprocess.run(["git","-C",repo,*a],capture_output=True,text=True).stdout.splitlines()
added = sorted({p for p in git("diff","--name-only","--diff-filter=A",base,"--") + git("ls-files","--others","--exclude-standard")
                if p and not p.startswith(".easyvibe/")})
code = sorted(p for p in added if os.path.splitext(p)[1] in CODE)
other = sorted(p for p in added if os.path.splitext(p)[1] not in CODE)
print("code_new", len(code)); [print("  C", p) for p in code]
print("noncode_new", len(other)); [print("  N", p) for p in other]
PY
python3 /tmp/new_files_probe.py "$ROOT" 89572b5
# M0: code_new 0 / noncode_new 0
# M1: code_new 6 / noncode_new 2
# M2/M5: code_new 8 / noncode_new 2
```

```bash
# P14-T 自检（A-23 T2）：临时 git 仓库加入 1 个 .ts + 1 个 package.json
rm -rf /tmp/new_files_fixture && mkdir -p /tmp/new_files_fixture && cd /tmp/new_files_fixture
git init -q && echo x > base.txt && git add . && git -c user.email=a@b -c user.name=t commit -qm base
mkdir -p apps/server/src .easyvibe && echo y > apps/server/src/new.ts && echo z > package.json && echo d > .easyvibe/doc.md
python3 /tmp/new_files_probe.py /tmp/new_files_fixture HEAD
# 期望：code_new 1 / noncode_new 1（.easyvibe/doc.md 被排除）
```

```bash
# P15 fail-fast + 双注入（S-13b / A-09；M5 用真实 host.ts）
# 探针自带 fixture 守卫：缺导出时输出 failfast_fixture_invalid 并 exit 9（不再以 TypeError 崩溃）
cat > /tmp/host_failfast.ts <<'TS'
const HOST_FILE = process.argv[2];
const mod = await import(HOST_FILE);
const { configureAgentHost, getAgentHost } = mod;
if (typeof configureAgentHost !== "function" || typeof getAgentHost !== "function") {
  console.log("failfast_fixture_invalid");
  process.exit(9);
}
let code = 0;
try { getAgentHost(); code = 1; } catch (error) { if (error.message !== "AgentHost 未注入") code = 2; }
const sentinel = { i18n: { t: (s: string) => s } } as unknown;
configureAgentHost(sentinel as never);
if (getAgentHost() !== sentinel) code = 3;
try { configureAgentHost(sentinel as never); code = 4; } catch (error) { if (error.message !== "AgentHost 已注入") code = 5; }
console.log("failfast_exit", code);
process.exit(code);
TS
test -f "$ROOT/apps/server/src/agent/host.ts" && $BUN /tmp/host_failfast.ts "$ROOT/apps/server/src/agent/host.ts"
# M5 期望：failfast_exit 0（exit 0）
# M0：文件不存在 → G2 先判存在，不得执行、不得判"无异常"（此时 test -f 为假，块退出码 1 属预期，不是判据）
```

```bash
# P15-T1 自检（A-23 T3）：完整契约 fixture（configureAgentHost + getAgentHost + 两条精确消息）
mkdir -p /tmp/agenthost_fixture/p15/ok
cat > /tmp/agenthost_fixture/p15/ok/host.ts <<'TS'
export type AgentHost = { readonly i18n: { t(key: string): string } };
let installed: AgentHost | null = null;
export function configureAgentHost(host: AgentHost): void {
  if (installed) throw new Error("AgentHost 已注入");
  installed = host;
}
export function getAgentHost(): AgentHost {
  if (!installed) throw new Error("AgentHost 未注入");
  return installed;
}
TS
$BUN /tmp/host_failfast.ts /tmp/agenthost_fixture/p15/ok/host.ts
# 期望：failfast_exit 0（exit 0）
```

```bash
# P15-T2 自检（A-23 T4，负控制）：无 fail-fast + 无二次注入保护 → 必须被探针发现
mkdir -p /tmp/agenthost_fixture/p15/fallback
cat > /tmp/agenthost_fixture/p15/fallback/host.ts <<'TS'
export type AgentHost = { readonly i18n: { t(key: string): string } };
let installed: AgentHost | null = null;
export function configureAgentHost(host: AgentHost): void { installed = host; }
export function getAgentHost(): AgentHost { return installed ?? { i18n: { t: (key: string) => key } }; }
TS
$BUN /tmp/host_failfast.ts /tmp/agenthost_fixture/p15/fallback/host.ts
# 期望：failfast_exit 4（exit 4）——1 = 未 fail-fast；4 = 缺二次注入保护
```

```bash
# P15-T3 自检（A-23 T5，负控制）：复现第 3 轮打回的缺陷 fixture（只有 getAgentHost）→ 必须被守卫拦下
mkdir -p /tmp/agenthost_fixture/p15/missing
cat > /tmp/agenthost_fixture/p15/missing/host.ts <<'TS'
export function getAgentHost() { throw new Error("AgentHost 未注入"); }
TS
$BUN /tmp/host_failfast.ts /tmp/agenthost_fixture/p15/missing/host.ts
# 期望：failfast_fixture_invalid（exit 9）；若输出 TypeError，说明守卫被删 → G5 FAIL
```

```bash
# P16 A2A watcher 迁移（A-22/S-05；M0/M5 双相）
cat > /tmp/a2a_watch.ts <<'TS'
const ROOT = process.argv[2], DATA = process.argv[3];
process.env.TOONFLOW_DATA_DIR = DATA;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const { getA2aSignal } = await import(`${ROOT}/apps/server/src/agent/a2a/settings.ts`);
let preError = "none";
try { getA2aSignal(); } catch (error) { preError = (error as Error).message; }
console.log("pre_error", preError);
const conf = (await import(`${ROOT}/apps/server/src/modules/platformCore/conf/index.ts`)).default;
const { createApp } = await import(`${ROOT}/apps/server/src/app.ts`);
const app = await createApp({ webRoot: DATA, dataDirectory: DATA });
console.log("app_ok", typeof app.use);
const post = getA2aSignal();
conf.set("a2a", { enabled: false, directory: "", token: "b".repeat(32), providerId: "", modelId: "" });
await sleep(1200);
console.log("post_aborted", post.aborted);
console.log("reason", (post.reason as Error | undefined)?.message);
TS
( cd apps/server && TMP16=$(mktemp -d) && $BUN /tmp/a2a_watch.ts "$ROOT" "$TMP16" )
# M0（正控制，E12）：pre_error none / app_ok function / post_aborted true / reason A2A 设置已修改，当前任务已取消
# M5：pre_error AgentHost 未注入 / app_ok function / post_aborted true / reason 同上
```

```bash
# P16-T-a 自检（A-23 T6）：M0 语义 fixture（模块顶层注册，注入前可用）
P=/tmp/agenthost_fixture/p16/m0/apps/server/src
mkdir -p /tmp/agenthost_fixture/p16/m0
mkdir -p "$P/agent/a2a" "$P/modules/platformCore/conf"
cat > "$P/modules/platformCore/conf/index.ts" <<'TS'
type Listener = () => void;
const listeners: Listener[] = [];
const conf = {
  set(_section: string, _value: unknown) { for (const listener of listeners) listener(); },
  onDidChange(_section: string, listener: Listener) { listeners.push(listener); },
};
export default conf;
TS
cat > "$P/agent/a2a/settings.ts" <<'TS'
import conf from "../../modules/platformCore/conf/index";
export type A2aSignal = { aborted: boolean; reason?: Error };
const signal: A2aSignal = { aborted: false };
conf.onDidChange("a2a", () => {
  signal.aborted = true;
  signal.reason = new Error("A2A 设置已修改，当前任务已取消");
});
export function getA2aSignal(): A2aSignal { return signal; }
TS
cat > "$P/app.ts" <<'TS'
export async function createApp(_options: { webRoot: string; dataDirectory: string }) {
  return { use() {} };
}
TS
$BUN /tmp/a2a_watch.ts /tmp/agenthost_fixture/p16/m0 /tmp/agenthost_fixture/p16/m0_data
# 期望：pre_error none / app_ok function / post_aborted true / reason A2A 设置已修改，当前任务已取消
```

```bash
# P16-T-b 自检（A-23 T7）：M5 语义 fixture（首次 getA2aSignal 惰性注册；注入前必须抛）
P=/tmp/agenthost_fixture/p16/lazy/apps/server/src
mkdir -p /tmp/agenthost_fixture/p16/lazy
mkdir -p "$P/agent/a2a" "$P/modules/platformCore/conf"
cat > "$P/modules/platformCore/conf/index.ts" <<'TS'
type Listener = () => void;
const listeners: Listener[] = [];
const conf = {
  set(_section: string, _value: unknown) { for (const listener of listeners) listener(); },
  onDidChange(_section: string, listener: Listener) { listeners.push(listener); },
};
export default conf;
TS
cat > "$P/agent/a2a/settings.ts" <<'TS'
import conf from "../../modules/platformCore/conf/index";
export type A2aSignal = { aborted: boolean; reason?: Error };
let injected = false;
let signal: A2aSignal | null = null;
export function injectAgentHost() { injected = true; }
export function getA2aSignal(): A2aSignal {
  if (!injected) throw new Error("AgentHost 未注入");
  if (!signal) {
    const created: A2aSignal = { aborted: false };
    signal = created;
    conf.onDidChange("a2a", () => {
      created.aborted = true;
      created.reason = new Error("A2A 设置已修改，当前任务已取消");
    });
  }
  return signal;
}
TS
cat > "$P/app.ts" <<'TS'
import { injectAgentHost } from "./agent/a2a/settings";
export async function createApp(_options: { webRoot: string; dataDirectory: string }) {
  injectAgentHost();
  return { use() {} };
}
TS
$BUN /tmp/a2a_watch.ts /tmp/agenthost_fixture/p16/lazy /tmp/agenthost_fixture/p16/lazy_data
# 期望：pre_error AgentHost 未注入 / app_ok function / post_aborted true / reason A2A 设置已修改，当前任务已取消
```

```bash
# P17 门面导入面（A-21）
grep -rnE --include='*.ts' 'from ["'"'"'](\./|@/)agentRuntime["'"'"']' apps/server/src
python3 - <<'PY'
import re,subprocess
rows=subprocess.run(["grep","-rnE","--include=*.ts","from [\"'](\\./|@/)agentRuntime[\"']","apps/server/src"],capture_output=True,text=True).stdout.splitlines()
files=sorted({r.split(":",1)[0] for r in rows})
print("rows",len(rows),"files",len(files)); print("\n".join(files))
PY
# M0：0 行 / 0 文件
# M5：10 行 / 5 文件（utils.ts 1、routes/agent.ts 1 类型、singleAgent/index.ts 5、singleAgent/types.ts 1 类型、mcp/tools.ts 2）
```

```bash
# P18 桌面/移动静态装配（S-13c）
for f in apps/desktop/src/index.ts apps/mobile/src/server.ts; do
  echo "== $f"
  grep -c 'await import("@toonflow/server/app")' "$f"
  grep -c 'await createApp({' "$f"
  grep -n 'setRuntimeHost("desktop")\|setRuntimeHost("mobile")\|await createApp({' "$f"
  grep -c 'app.listen(' "$f"
  grep -c '"@/agent' "$f"
done
# 桌面：1 / 1 / 235<240 / 0 / 0；移动：1 / 1 / 21<108 / 1（外层移动 app 监听）/ 0；另 `grep -c 'app.use(toonflow)' apps/mobile/src/server.ts` = 1
```

---

### 6.6 口径漂移 vs 归属迁移（可判定定义）

| 判定 | 条件 | 结论 |
| --- | --- | --- |
| **归属迁移（允许）** | ① 3 个纯模块副本与 M0 旧文件逐字节相同；② 旧路径保留再导出 shim；③ `modules[].files` 的差异**恰好**是：`server-api += ["apps/server/src/agentHost.ts","apps/server/src/agentRuntime.ts"]`、`shared-foundation += ["packages/formats/**"]`；④ `uncovered = 0`；⑤ `files_total = 714`（M1 为 712，只是阶段值） | A-16/A-17/A-18 PASS |
| **口径漂移（失败）** | ① 归因算法或计数正则变化；② glob 加宽（`apps/server/src/**`、`packages/**` 等）；③ 文件归属变化但无内容相同证据；④ 把新文件塞进既有宽 glob（如 `lib/**`）规避登记；⑤ 改 SCC 的边类型（值/类型）让环消失 | 直接 FAIL，无论其他项 |

**8 个新增代码文件（A-17 的唯一集合；多一个/少一个均 FAIL）**

| # | 路径 | 阶段 | 性质 |
| --- | --- | --- | --- |
| 1 | `packages/formats/src/modelReasoning.ts` | **M1** | 纯迁移副本（与 `89572b5:apps/server/src/lib/modelReasoning.ts` 逐字节相同） |
| 2 | `packages/formats/src/a2a.ts` | **M1** | 新逻辑（`A2aSettings`，来自 `agent/a2a/settings.ts:11–18`） |
| 3 | `packages/formats/src/index.ts` | **M1** | 新逻辑（M1 再导出 1–2；M2 追加 4–5） |
| 4 | `packages/formats/src/documentFormats.ts` | **M2** | 纯迁移副本（与旧文件逐字节相同） |
| 5 | `packages/formats/src/mentionSources.ts` | **M2** | 纯迁移副本（与旧文件逐字节相同） |
| 6 | `apps/server/src/agent/host.ts` | **M1** | 新逻辑（AgentHost 契约 + 注册表 + watcher 注册入口） |
| 7 | `apps/server/src/agentHost.ts` | **M1** | 新逻辑（Host 实现 + 注入） |
| 8 | `apps/server/src/agentRuntime.ts` | **M1** | 新逻辑（唯一反向门面） |

**新增非代码文件（恰好 2 个）**：`packages/formats/package.json`、`packages/formats/tsconfig.json`。
> 3 个 shim（`apps/server/src/lib/{documentFormats,modelReasoning,mentionSources}.ts`）**不是新增文件**：它们原本就存在，只改内容为再导出。`packages/formats/package.json`、`tsconfig.json` 不是代码扩展名，不计入 `files_total`，但计入 `noncode_new` 精确集合（A-17）。

| 阶段 | `code_new` | `noncode_new` | `files_total` |
| --- | --- | --- | --- |
| M0 | 0 | 0 | 706 |
| M1 | 6（#1/#2/#3/#6/#7/#8） | 2 | **712** |
| M2 | 8 | 2 | **714** |
| M3/M4/M5 | 8 | 2 | 714 |

### 6.7 探针守卫（G 系列）

| 守卫 | 内容 | 判定 |
| --- | --- | --- |
| **G1 正控制** | 每个期望 0 的 grep，必须在 M0 快照（`git show 89572b5:…` 或 M0 记录值）上 >0 | 否则 FAIL（空搜索） |
| **G2 存在性** | 判据引用的文件/符号必须存在（`test -f`、`grep -q`）；**探针引用的 fixture 必须由本块创建** | 不存在即 FAIL，不得判"无异常" |
| **G3 双算** | 计数类判据用 `grep` 与 Python 各算一次 | 不等即 FAIL |
| **G4 精确集合** | A-04/A-05/A-06/A-17/A-21/A-22 用集合相等，不用子集/上界 | 多一个或少一个都 FAIL |
| **G5 探针自检** | P7b/P14/P15/P16 必须先通过 A-23 的 **7 项自检（T1–T7）**；自检的每个期望值（含 2 个负控制的 `4`/`9`）必须逐项复现 | 任一自检不等于期望即 FAIL，探针结果不得使用 |
| **G6 相位** | 判据只能在声明的相位使用：A 项在 M5；M0 只做正控制；S-05/S-13b 的 M0/M5 期望不同；**A-23 的 7 项自检在 M0 起即可执行** | 相位不符即 FAIL |
| **G7 fixture 归属（本轮新增）** | 每项自检的 fixture 必须由**本自检块**创建、只由本自检块消费；fixture 目录按探针隔离（`p7b/`、`p15/`、`p16/`、`new_files_fixture/`）；**跨探针复用 = FAIL** | §6.10 的 `fixture_audit` 输出 `entries=7 self_contained=7 run_bound=7 cross_reuse=0` |

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

### 6.9 数值台账（L01–L24；记录用，不参与验收）

| 编号 | 指标 | M0（本轮实测） | M1 | M2 | M3 | M4 | M5 | 探针 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| L01 | A2P 别名 | 71 | 71 | 61 | 32 | 0 | 0 | P1 |
| L02 | A2P 相对 | 3 | 3 | 0 | 0 | 0 | 0 | P2 |
| L03 | A2P 合计 | 74 | 74 | 61 | 32 | 0 | 0 | P1+P2 |
| L04 | A2P 值边 | 68 | 68 | 60 | 31 | 0 | 0 | P1+P2 |
| L05 | P2A 行 | 21 | 13 | 13 | 13 | 13 | 13 | P3b |
| L06 | P2A 文件 | 11 | 3 | 3 | 3 | 3 | 3 | P3a |
| L07 | P2A 动态行 | 1 | 1 | 1 | 1 | 1 | 1 | P3b |
| L08 | P2A 包契约 | 3 | 3 | 3 | 3 | 3 | 3 | P4 |
| L09 | `utils.ts` 的 `@/agent` 行 | 5 | 0 | 0 | 0 | 0 | 0 | P5a |
| L10 | `utils.ts` 默认导出键 | 37 | 38 | 38 | 38 | 38 | 38 | P5b |
| L11 | D1b 行 | 0 | 10 | 10 | 10 | 10 | 10 | P17 |
| L12 | D1b 文件 | 0 | 5 | 5 | 5 | 5 | 5 | P17 |
| L13 | file SCC 总数 | 3 | 3 | 3 | 3 | 2 | 2 | P6 |
| L14 | 含 agent 的 SCC | 1 | 1 | 1 | 1 | 0 | 0 | P6 |
| L15 | 地图边 `e7` | 1 | 1 | 1 | 1 | 0 | 0 | P6b |
| L16 | `files_total` | 706 | 712 | 714 | 714 | 714 | 714 | P12 |
| L17 | `code_new` | 0 | 6 | 8 | 8 | 8 | 8 | P14 |
| L18 | `noncode_new` | 0 | 2 | 2 | 2 | 2 | 2 | P14 |
| L19 | 新增跨模块深引文件 | 0 | 1 | 1 | 1 | 1 | 1 | P13 |
| L20 | 新增 source→target 子模块对 | 0 | 0 | 0 | 0 | 0 | 0 | P13 |
| L21 | `app.ts` 行数（预算 ≤80） | 78 | 80 | 80 | 80 | 80 | 80 | `wc -l` |
| L22 | A-23 自检项 | 7（可执行） | 7 | 7 | 7 | 7 | 7 | §6.10 |
| L23 | fixture 自包含 / 跨复用 | 7 / 0 | 7 / 0 | 7 / 0 | 7 / 0 | 7 / 0 | 7 / 0 | §6.10 |
| L24 | A-23 可判定（M5 门可达） | 1 | 1 | 1 | 1 | 1 | 1 | §6.10 |

> L21 是唯一含预算（≤80）的台账行；按 §6.2 规则 2，它**不进入 A 表**。其余全部为精确整数。

---

### 6.10 A-23 自检复跑与 fixture 归属审计（第 3 轮打回的机制化防线）

#### 6.10.1 7 项自检一览（本轮全部实跑，E27–E33）

| # | 自检 | 依赖探针 | fixture | 期望 stdout | 期望退出码 |
| --- | --- | --- | --- | --- | --- |
| T1 | P7b-T | P7b | `/tmp/agenthost_fixture/p7b/agent`（`sample.ts` + `host.ts`） | `module_scope_refs 3` | `1` |
| T2 | P14-T | P14 | `/tmp/new_files_fixture`（临时 git 仓库） | `code_new 1` / `noncode_new 1` | `0` |
| T3 | P15-T1 | P15 | `/tmp/agenthost_fixture/p15/ok/host.ts` | `failfast_exit 0` | `0` |
| T4 | P15-T2（负控制） | P15 | `/tmp/agenthost_fixture/p15/fallback/host.ts` | `failfast_exit 4` | `4` |
| T5 | P15-T3（负控制） | P15 | `/tmp/agenthost_fixture/p15/missing/host.ts` | `failfast_fixture_invalid` | `9` |
| T6 | P16-T-a | P16 | `/tmp/agenthost_fixture/p16/m0`（M0 语义） | `pre_error none` / `app_ok function` / `post_aborted true` / `reason A2A 设置已修改，当前任务已取消` | `0` |
| T7 | P16-T-b | P16 | `/tmp/agenthost_fixture/p16/lazy`（M5 语义） | `pre_error AgentHost 未注入` / `app_ok function` / `post_aborted true` / `reason A2A 设置已修改，当前任务已取消` | `0` |

> 执行顺序：T1 建脚本 → T3/T4/T5（T3 的 `ok` fixture 必须含 `configureAgentHost`，**这是第 3 轮打回的直接修复点**）→ T6/T7 → T1/T2 可独立执行。
> T4/T5 是**负控制**：若实现只"看起来通过"而探针其实是空转，T4 会输出 `0` 而不是 `4`，T5 会以 `TypeError` 崩溃而不是 `9` —— 两种偏离都直接判 FAIL。

#### 6.10.2 fixture 归属静态审计（G7；可直接粘贴）

```bash
# 校验本文档的 7 个自检块：fixture 是否"本块创建 + 本块消费"，是否存在跨探针复用
python3 - <<'PY'
import re
path=".easyvibe/development_docs/liyuhang/1_requirements_matrix/2026-10-27-13-35-agentHostPortCycleBreak-v4.md"
lines=open(path,encoding="utf-8").read().splitlines()
starts=[i for i,l in enumerate(lines) if re.match(r'^# P[0-9]', l)]
segs=[]
for k,i in enumerate(starts):
    j=starts[k+1] if k+1<len(starts) else len(lines)
    segs.append((lines[i], "\n".join(lines[i:j])))
MAN=[
 ("P7b-T","/tmp/agenthost_fixture/p7b/agent",'agent_scope_probe.mjs "$ROOT" /tmp/agenthost_fixture/p7b/agent'),
 ("P14-T","/tmp/new_files_fixture","new_files_probe.py /tmp/new_files_fixture HEAD"),
 ("P15-T1","/tmp/agenthost_fixture/p15/ok","host_failfast.ts /tmp/agenthost_fixture/p15/ok/host.ts"),
 ("P15-T2","/tmp/agenthost_fixture/p15/fallback","host_failfast.ts /tmp/agenthost_fixture/p15/fallback/host.ts"),
 ("P15-T3","/tmp/agenthost_fixture/p15/missing","host_failfast.ts /tmp/agenthost_fixture/p15/missing/host.ts"),
 ("P16-T-a","/tmp/agenthost_fixture/p16/m0","a2a_watch.ts /tmp/agenthost_fixture/p16/m0 "),
 ("P16-T-b","/tmp/agenthost_fixture/p16/lazy","a2a_watch.ts /tmp/agenthost_fixture/p16/lazy "),
]
def seg_of(tag):
    for head,body in segs:
        if re.match(r'^# '+re.escape(tag)+r'\b', head): return body
    return None
ok=bound=cross=0
for tag,fix,run in MAN:
    body=seg_of(tag)
    if body is None: print(f"{tag} MISSING_BLOCK"); continue
    has_mk=f"mkdir -p {fix}" in body
    has_run=run in body
    mk_segs=sum(1 for _,b in segs if f"mkdir -p {fix}" in b)
    ok+=has_mk; bound+=has_run
    if mk_segs!=1 or "agenthost_fixture/p7b" in body and tag.startswith("P15"): cross+=1
    print(f"{tag} mkdir={int(has_mk)} run={int(has_run)} mkdir_segments={mk_segs}")
print(f"fixture_audit entries={len(MAN)} self_contained={ok} run_bound={bound} cross_reuse={cross}")
PY
# 期望：entries=7 self_contained=7 run_bound=7 cross_reuse=0
```

#### 6.10.3 复跑矩阵（每个里程碑各跑一次；输出与 6.10.1 逐项比对）

| 里程碑 | 需复跑 | 通过条件 |
| --- | --- | --- |
| M0 | T1–T7 | 7/7 等于期望（本轮 E27–E33 已达成） |
| M1 | T1–T7 + P15（真实 host.ts） | 7/7 + `failfast_exit 0` |
| M2–M4 | T1–T7 | 7/7 |
| M5 | T1–T7 + P15 + P16 + 全部 A 项 | 7/7 且 A-01～A-23 全 PASS |

---

## 7. 风险登记

| 编号 | 风险 | 触发条件 | 影响 | 缓解 | 检出判据 |
| --- | --- | --- | --- | --- | --- |
| RK-1 | 端口过宽 → 新的"上帝对象" | 契约把 74 个符号逐个摊平暴露 | agent 仍然耦合实现细节，只是换了个文件 | 按 §1.4 的 14 组命名空间分组；契约内禁止 `Request/Response/conf`；"预留未使用"的方法评审可逐符号驳回 | R-01 评审 + A-01/A-03 |
| RK-2 | 语义漂移（错误码/文案/文件锁） | Host 转发时"顺手"重写校验 | S-02/S-03/S-04/S-07/S-12 失败；文件锁丢失导致并发写坏 | 只做转发；错误语义对照表（§4.4）逐条保留；B3 单独一批并强制跑 S-07 | A-15、R-04 批次门 |
| RK-3 | 注入时机不当 | 注入放在 `agentAccess.mount` 或 `Promise.all` 前 | `conf` 早求值/数据目录降级；或 agent 首次使用早于注入 | 固定步骤 9.5；A-10 三条子断言 + P8b 静态可达集 | A-10、A-11 |
| RK-4 | 顶层捕获 | 为省事写 `const host = getAgentHost()` | 注入前求值即崩；fail-fast 失效 | 契约叶子无副作用；P7b AST 探针 + `module_scope_refs=0` | A-09、T1 |
| RK-5 | watcher 注册时机回退 | 把 `conf.onDidChange("a2a")` 留在模块顶层 | `agentHost.ts` 可达集被拖入 `a2a/settings.ts`；A-10 ② 失败 | 惰性注册；P16 双相 + P16-T-a/b | A-22、T6/T7 |
| RK-6 | 口径漂移掩盖问题 | 加宽 glob、改正则、把新文件塞进 `lib/**` | 数字"变好"但环仍在 | A-16/A-17/A-18 + §6.6 定义 + G3 双算 | A-16～A-18 |
| RK-7 | 自检空转（本轮的教训） | 自检 fixture 与被测探针不匹配、或负控制缺失 | "自检通过"但探针其实什么都没测；验收看似通过实则失效 | fixture 形状写进 R-01.1；7 项自检含 2 个负控制；G7 归属审计 | A-23、§6.10 |
| RK-8 | 导出路径破坏 web/桌面/移动 | 改 `apps/server/package.json` exports target | web 构建失败、桌面/移动启动失败 | exports 冻结；A-14 逐字比对 + P18 | A-14、S-13c |
| RK-9 | 新包构建链问题 | `packages/formats` 未被 workspace/tsconfig 覆盖 | 全仓 typecheck 失败 | 零依赖 foundation；根 workspaces 已覆盖；M1 先建包再接边 | A-12/A-13 |
| RK-10 | 里程碑数字漂移 | 实施中"顺手"多建文件 | 预算失效、归属失真 | R-12 精确预算 + P14 精确集合；超出即回评审 | A-17、T2 |

## 8. 候选豁免（无法在不扩大范围的前提下消除）

| 编号 | 豁免对象 | 为何不能消除 | 代价 | 复核方式 | 复核人 |
| --- | --- | --- | --- | --- | --- |
| E1 | `@toonflow/teams-scaffold` 3 条包契约（`conf/index.ts`、`pluginMarket/teams/files.ts`、`routes/agents/connect.ts`） | 该包归属 `agent-runtime`，但只暴露纯数据/类型；移除需改包归属与 3 处调用 | 中 | P4 恒为 3；A-06 | 评审人 |
| E2 | `agentAccess/index.ts` 的 `await import("@/agent/a2a")` 动态块 | AGENTS.md 冻结的 9 处入口动态块之一；移除会改装配语义 | 高 | P3b 恒为 1 行动态；A-05 | 评审人 |
| E3 | `agent → foundation`（`@toonflow/file`、`@toonflow/formats`、`@toonflow/i18n`） | 领域包依赖允许方向，且 formats 是本次新增的纯契约落点 | 低 | A-03 只统计应用层前缀 | 评审人 |
| E4 | 应用层内部 53 条跨子模块深引 | 与环无关，改动面大 | 高 | A-18 ④ 只要求"不新增子模块对" | 评审人 |
| E5 | 模块级 SCC（`app.ts`/`utils.ts` 组合根与 7 个入口之间） | AGENTS.md 明确"模块级不承诺无环" | — | A-08 只判 file 级 + `e7` | 评审人 |
| E6 | `mcpIntegration/mcp/{dxt,servers}` 2 文件 file SCC | 既有的模块内环，与本需求无关 | 中 | P6 只期望 `scc_total=2` | 评审人 |
| E7 | `pluginMarket/teams` 3 文件 file SCC | 同上 | 中 | P6 | 评审人 |
| E8 | `agentAccess.dependencies` 不含 `agent-runtime` | Host 由 bootstrap 注入，不是子模块依赖；加入会造成新的模块级环 | 中 | A-20 精确字符串 | 评审人 |
| E9 | `agentHost.ts` 的 1 个新增跨模块深引文件 | Host 实现必须组装 6 个域的能力，放在 bootstrap 是最小新增 | 低 | A-18 ③ = 1 | 评审人 |
| E10 | web 的 38 条 `@toonflow/server/*` 导入 | 契约冻结是本次目标之一 | 低 | A-14 逐字相等 | 评审人 |
| E11 | `packages/providers` 零改动 | agent 经 Host `models` 取模型目录，不直接依赖 providers | 低 | R-08 + A-14 | 评审人 |
| E12 | A2A 取消文案 `A2A 设置已修改，当前任务已取消` | 用户可见文案，冻结 | 低 | S-05 精确字符串 | 评审人 |
| E13 | `agentRuntime.ts` 被 3 个应用域文件静态引用（`singleAgent/index.ts`、`singleAgent/types.ts`、`mcp/tools.ts`） | 它们不能经 `utils.ts`（会形成新的 utils 环），只能直连门面 | 低 | A-21 精确 5 文件 / 10 行 | 评审人 |

## 9. 待评审决策点（Q1–Q10，均有默认值）

| 编号 | 决策点 | 选项 | **默认** | 影响 |
| --- | --- | --- | --- | --- |
| Q1 | 环的切断口径 | A 双向归零 / **B 反向收敛 + 正向归零** | **B** | A 表按 B 设计；改成 A 需重写 A-04/A-05/A-21 |
| Q2 | 端口粒度 | A 一个扁平接口 / **B 14 组命名空间** | **B** | R-01 评审依据 |
| Q3 | 纯契约落点 | A 留在 `lib` / B 全部进 formats / **C formats + lib shim** | **C** | A-14 路径冻结、A-18 |
| Q4 | 反向收敛落点 | A `utils.ts` 继续聚合 / **B 新建 `agentRuntime.ts` 门面** | **B** | A-21 |
| Q5 | 门面导出面 | **A 只导出上表 11 个说明符** / B 允许 `export *` | **A** | A-05/A-21 |
| Q6 | 文件预算 | **A 业务 8 个新增代码文件 + 2 个非代码** / B 放宽 | **A** | A-17、T2 |
| Q7 | 模型能力来源 | **A Host 暴露 `models`（providers 零改动）** / B agent 直连 providers | **A** | R-08、A-14 |
| Q8 | 冒烟范围 | **A 13 项（16 子断言）** / B 缩减 | **A** | A-15 |
| Q9 | 自检项数 | **A 7 项（含 2 负控制）** / B 只保留 4 项 | **A** | A-23；B 会重蹈第 3 轮覆辙 |
| Q10 | 自检 fixture 归属 | **A per-probe 隔离 + G7 静态审计** / B 共用 fixture | **A** | §6.10.2；B 即第 3 轮的缺陷 |

## 10. 评审意见栏

> 本节留空，待用户填写。评审通过后本矩阵才进入方案与实施阶段。

### 10.1 需求整体

| 项 | 意见 |
| --- | --- |
| 背景与问题成立性 |  |
| 目标与非目标（§2） |  |
| 需求矩阵（§3，R-01～R-12） |  |
| 验收标准（§6，A-01～A-23） |  |
| 可执行性（§0.5.1、§6.10） |  |
| 其他 |  |

### 10.2 待决策点（Q1–Q10）

| 编号 | 评审结论（采纳默认 / 改判为） | 备注 |
| --- | --- | --- |
| Q1 |  |  |
| Q2 |  |  |
| Q3 |  |  |
| Q4 |  |  |
| Q5 |  |  |
| Q6 |  |  |
| Q7 |  |  |
| Q8 |  |  |
| Q9 |  |  |
| Q10 |  |  |

### 10.3 豁免（E1–E13）

| 编号 | 同意 / 驳回 | 备注 |
| --- | --- | --- |
| E1 |  |  |
| E2 |  |  |
| E3 |  |  |
| E4 |  |  |
| E5 |  |  |
| E6 |  |  |
| E7 |  |  |
| E8 |  |  |
| E9 |  |  |
| E10 |  |  |
| E11 |  |  |
| E12 |  |  |
| E13 |  |  |

### 10.4 打回意见（逐条）

| 轮次 | 意见 | 处置是否认可 | 备注 |
| --- | --- | --- | --- |
| 第 1 轮 | A-04/A-05/A-15 与 E4、Q1、Q3 默认值冲突；R-04 注入时序不可实现；验收不可唯一判定 | 已在 v2 处置 |  |
| 第 2 轮 | M1 需 `packages/formats` 与阶段划分矛盾；A-09 探针误判顶层捕获；A-17 新文件集合无探针；S-12/S-13 模糊 | 已在 v3 处置 |  |
| 第 3 轮 | **A-23 的 P15-T 自检 fixture 缺 `configureAgentHost`，按文档执行必失败，M5 无法通过验收** | **本轮 §0.1 / §0.5.1 / §6.10 处置** |  |

### 10.5 结论

| 项 | 填写 |
| --- | --- |
| 评审结论（通过 / 打回） |  |
| 打回理由（如打回） |  |
| 评审人 |  |
| 评审时间 |  |

---

## 附录 A：M0 反向边精确清单（A-05 的基线对象，本轮复跑）

| # | 文件:行 | 形态 | 说明符 |
| --- | --- | --- | --- |
| 1 | `utils.ts:19` | 值 | `@/agent` |
| 2 | `utils.ts:20` | 值 | `@/agent/bridge/canvas` |
| 3 | `utils.ts:21` | 值 | `@/agent/bridge/question` |
| 4 | `utils.ts:33` | 值 | `@/agent/a2a/settings` |
| 5 | `utils.ts:35` | 值 | `@/agent/mentionFiles` |
| 6 | `modules/platformCore/conf/index.ts:5` | 类型 | `@/agent/a2a/settings` |
| 7 | `modules/agentAccess/index.ts:6` | 动态 | `@/agent/a2a` |
| 8 | `modules/agentAccess/singleAgent/index.ts:7` | 值 | `@/agent/tools` |
| 9 | `modules/agentAccess/singleAgent/index.ts:8` | 值 | `@/agent/runtime/model` |
| 10 | `modules/agentAccess/singleAgent/index.ts:9` | 值 | `@/agent/runtime/requests` |
| 11 | `modules/agentAccess/singleAgent/index.ts:10` | 值 | `@/agent/runtime/sessions` |
| 12 | `modules/agentAccess/singleAgent/index.ts:11` | 值 | `@/agent/bridge/question` |
| 13 | `modules/agentAccess/singleAgent/types.ts:2` | 类型 | `@/agent/runtime/types` |
| 14 | `modules/mcpIntegration/mcp/tools.ts:8` | 值 | `@/agent/tools` |
| 15 | `modules/mcpIntegration/mcp/tools.ts:9` | 值 | `@/agent` |
| 16 | `routes/agent.ts:4` | 类型 | `@/agent/runtime/types` |
| 17 | `routes/agent.ts:9` | 值 | `@/agent/runtime/model` |
| 18 | `routes/settings/save.ts:6` | 值 | `@/agent/runtime/prompt` |
| 19 | `routes/settings/systemPrompt.ts:3` | 值 | `@/agent/runtime/prompt` |
| 20 | `routes/agents/a2a/save.ts:8` | 值 | `@/agent/runtime/model` |
| 21 | `routes/singleAgent/run.ts:7` | 值 | `@/agent/runtime/model` |

> 合计 21 行 / 11 文件：值 17、类型 3、动态 1。M5 目标见 §6.5 P3b 的 13 行枚举（值 11、类型 1、动态 1）。

## 附录 B：M0 agent→应用 74 行按目标汇总（A-01～A-03 的基线对象）

| 目标前缀 | 条数 | 归属批次（R-04） |
| --- | --- | --- |
| `@/modules/localRuntime/workspace` | 13 | B3（12）+ B3（chatImages 1） |
| `@/modules/platformCore/conf` | 8 | B4 |
| `@/modules/assetLibrary/assets` | 6 | B3 |
| `@/modules/mediaGeneration/ai` | 5 | B2 |
| `@/modules/pluginMarket/teams` | 4 | B1 |
| `@/modules/platformCore/personalization` | 3 | B1 |
| `@/modules/mcpIntegration/mcp` | 3 | B4 |
| `@/modules/pluginMarket/plugins` | 2 | B1 |
| `@/modules/mediaGeneration/documents` | 2 | B1 |
| `@/modules/pluginMarket/skills` | 1 | B1 |
| `@/modules/mediaGeneration/media` | 1 | B2 |
| `@/modules/mediaGeneration/ffmpeg` | 1 | B2 |
| `@/modules/agentAccess/browser` | 1 | B3 |
| **`@/modules` 小计** | **50** | |
| `@/lib/i18n` | 8 | B2 |
| `@/lib/modelReasoning` | 5 | B0（副本）+ 别名原样切换 |
| `@/lib/documentFormats` | 5 | B0 |
| `@/lib/platform` | 2 | B2 |
| **`@/lib` 小计** | **20** | |
| `@/utils` | 1 | B3 |
| 相对 `../lib/**` | 3 | B0（2）+ modelReasoning 1 |
| **合计** | **74** | |

> B0 的 13 条 = `documentFormats` 5 + `mentionSources` 2（相对）+ `modelReasoning` 6（5 别名 + 1 相对）；B0 后 74 → 61，与 §5 的 M2 期望一致。

## 附录 C：本轮实测命令输出（可复现）

```bash
$ grep -rn --include='*.ts' -E "from ['\"]@/(modules|lib|utils|routes|types|app|router|core)" apps/server/src/agent | wc -l
71
$ grep -rn --include='*.ts' -E "from ['\"]\.\./(\.\./)?(lib|modules|utils)" apps/server/src/agent | wc -l
3
$ grep -rlE --include='*.ts' '@/agent(/|[^A-Za-z])' apps/server/src --exclude-dir=agent | wc -l
11
$ grep -rnE --include='*.ts' '@/agent(/|[^A-Za-z])' apps/server/src --exclude-dir=agent | wc -l
21
$ grep -rn --include='*.ts' "@toonflow/teams-scaffold" apps/server/src --exclude-dir=agent | wc -l
3
$ grep -cE '@/agent(/|[^A-Za-z])' apps/server/src/utils.ts
5
$ python3 - <<'PY'   # P5b
... print("keys",len(keys))
keys 37
$ python3 - <<'PY'   # P6
scc_total 3 agent_scc 1
$ python3 - <<'PY'   # P12
files 706 uncovered 0
$ python3 /tmp/new_files_probe.py "$ROOT" 89572b5
code_new 0
noncode_new 0
$ wc -l apps/server/src/app.ts apps/server/src/utils.ts
78 apps/server/src/app.ts
75 apps/server/src/utils.ts
$ find apps/server/src/agent -name '*.ts' | wc -l ; cat ...
29 / 4032
$ find apps/server/src -name '*.ts' | wc -l ; cat ...
272 / 18546
$ python3 -c "import json;print(len(json.load(open('apps/server/package.json'))['exports']))"
14
$ grep -rn "@toonflow/server" apps/web/src --include='*.ts' --include='*.vue' | wc -l
38
```

## 附录 D：冒烟实测（M0 基线，历史实跑记录）

| # | 场景 | 实测 | 对应 |
| --- | --- | --- | --- |
| D1 | S-01 Agent 流式 | `200` + NDJSON，事件序 `session, stats, stats, userMessage, text×3, stats, done`，`text.delta=OK`，无 `error` | A-15 |
| D2 | S-03 并发会话 | 第三个请求 `200` + 单行 `对话正在运行，请等待回复完成`，无 `done` | A-15 |
| D3 | S-04 会话操作 | fork `200`；compact `409 对话正在运行，请先停止后再压缩`；rewind `409 对话正在运行，请先停止后再回退` | A-15 |
| D4 | S-06 A2A 关闭态 | `GET/POST /a2a/demo` → `404 Not Found` | A-15 |
| D5 | S-07 工作区越界 | `400` body `{"code":400,"data":null,"message":"文件路径无效"}` | A-15 |
| D6 | S-08 提及源 | `200` body `{"code":200,"data":[],"message":"Success"}` | A-15 |
| D7 | S-10 单 Agent | 事件序 `[status,text,text,text,text,complete,status,done]`；close → `{"status":"idle"}` | A-15 |
| D8 | S-11 技能/团队 | 3 个内置技能；`/api/agents/get` → `{"agents":[]}` | A-15 |
| D9 | S-12 i18n | en / zh-CN 两条精确字符串 | A-15 |
| D10 | S-13a 装配 | `START_OK / CONF_JSON_OK / TOOLS_HTTP=200 / REPO_DATA_UNCHANGED` | A-11 |
| D11 | S-05 A2A 迁移（M0 相） | `pre_error none / post_aborted true / reason` 精确（本轮 P16 复跑一致，§0.5.1） | A-22 |
| D12 | P7b（仓库） | `module_scope_refs 0` | A-09 |
| D13 | P14（M0） | `code_new 0 / noncode_new 0` | A-17 |
| D14 | A-23 的 7 项自检 | 全部等于期望（§0.5.1、E27–E33） | A-23 |

> 说明：以上脚本只在 `/tmp` 执行，不写入仓库、不加入 `package.json`、不进入 CI（C4）。
