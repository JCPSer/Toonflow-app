# MEM-2026-10-27-04 · AgentHost 端口切断 agent↔应用双向依赖

- 需求：REQ-2026-10-27-05（矩阵 v5）· 方案：SOL-2026-10-27-05 · 验证：TEST-2026-10-27-04

## S（Situation）

`agent-runtime` 与应用层互为静态依赖：agent→应用 74 处（本机实测 75），应用→agent 21 行/11 文件；file 级有一个 10 文件大环（`agent/**` + `utils.ts` + `singleAgent/index.ts`），且环位于每条 Agent 请求的必经路径。地图边 `e7` 为 `direction_violation`。

## T（Task）

- agent 侧对 `@/modules`、`@/lib`、`@/utils` 的静态依赖归零（A2P=0）。
- 应用→agent 收敛到唯一门面，消费文件精确 3 个（门面 / 装配 / 冻结动态块）。
- 由 `app.ts` 单向装配：新增步骤 9.5 注入 Host，位置在 `platform.prepare` 之后、`await import("@/router")` 之前。
- 零行为变化：HTTP / NDJSON / 错误文案 / i18n 的 ALS / 平台判定每次调用 / 46 个 MCP 工具 / 5 个旧 `utils` 键。

## A（Action）

1. **契约**：新增 `agent/host.ts`——14 组、60 符号、纯类型 + `let installed` + `configureAgentHost`/`getAgentHost`（fail-fast、二次注入抛错）。三个应用类型（`AssetLibrarySelector`/`RequestFile`/`RuntimePlatform`）结构型重声明，`FileRequestLimitError` 传类引用，`i18n.t`/`getRuntimePlatform`/`skills.directory` 只转发函数引用。
2. **实现与注入**：新增 `agentHost.ts`，按 20 条源路径装配 14 组（4 空格缩进键，i18n 8 行与 platform 2 行同批迁出）；`app.ts` 增加 1 行步骤 9.5。
3. **反向门面**：新增 `agentRuntime.ts`（12 说明符），`utils.ts` 改 1 条命名空间导入 + 保留 5 个旧键 + 新增 `agentRuntime` 键（38 键）；`routes/**`、`singleAgent/**`、`mcp/tools.ts` 全部改走门面。
4. **纯契约下沉**：新增 `packages/formats`（`modelReasoning`/`documentFormats`/`mentionSources` 逐字节副本 + `a2a` 类型 + barrel，自带 `typecheck`），三个 `lib/*` 改为具名再导出 shim，14 个 exports 路径不变；`conf → agent` 的类型边改指 formats。
5. **消费点迁移**：B0 13 行 → formats；B1 12 行、B2 17 行（i18n 8 + platform 2 同批）、B3 21 行（含多目标行）、B4 11 行 → `host.*`；错误文案、文件锁、越界校验逐条保留。
6. **运行时细节**：A2A watcher 改为注入后惰性注册（注册成功才置位，注入前调用会抛 `AgentHost 未注入`）；`mobileLink` 中间件写入 `res.locals.toonflowMobileLink`，`getAppOrigin` 退化为 `resolveAppOrigin(bag)` 的薄适配器；诊断日志迁到 `agent/log.ts`（目录取 `settings.settingsPath()`）。
7. **收口**：`delegation → runtime/index` 的域内环改为依赖注入；地图删 `e7`、`e9` 标签改 17、新增 3 条 glob；`AGENTS.md` 登记步骤 9.5 与「agent 只能经契约取能力」。

## R（Result）

- **A2P 75 → 0**（P1=0、P2=0）；P2A **21 行/11 文件 → 14 行/3 文件**；file SCC **2 / 含 agent 0**；`e7` 删除。
- 契约 14 组 / 60 符号、装配 14 组、`utils` 38 键、`failfast_exit 0`、`module_scope_refs 0`、`prepare(35) < inject(63) < router(64)`。
- 运行期 16/16 子断言通过（Agent 流式、单 Agent、i18n 中英双串、越界 400、MCP 46 工具、A2A 关闭态、技能/团队列表、桌面与移动静态装配）。
- `apps/server` 与 `packages/formats` typecheck、server/web build 全绿；`files_total 718 / uncovered 0`。
- 偏差：基线漂移使 A2P 基线为 75（矩阵 74），连带 P3b=14、`e9`=17、新增代码文件 9；P17 为 5 行（导入合并）。详见 TEST-2026-10-27-04 §5。
