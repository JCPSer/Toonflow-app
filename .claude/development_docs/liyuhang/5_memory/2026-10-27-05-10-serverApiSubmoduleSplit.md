# 记忆 · server-api 应用子模块拆分（结构重构 · 零行为变更）

## S — Situation（背景）

`apps/server`（server-api）长期是单一 `god_module`：237 文件 / 14,349 行 / 161 个路由文件 / 162 个注册端点，同时承担素材库、媒体生成、插件安装、MCP、工作区、桌面桥接与命令执行。模块地图无法识别子域，`utils.ts` 以 37 个入口聚合并被 145 个文件引用，`app.ts` 160 行混写 6 类插件初始化、供应商哈希、缩略图预热、模型刷新、MCP/A2A 构造与移动互联。评审在第 8 轮后通过方案 `SOL-2026-10-27-04`（v4）。

## T — Task（任务）

按素材库 / 媒体生成 / 插件市场 / MCP / 工作区·桌面 / agent 接入 / 平台核心拆出 7 个应用子模块入口，`app.ts` 只保留组合根与路由装配；全程零业务行为变更、零 UI 变动、零新增依赖。

## A — Action（动作）

1. **M0 基线冻结**：HEAD `1861cd0` = 237 文件 / 14,352 行；162 端点清单、`router.ts` 全文、14 exports、B0 快照（`d084136`）归档到 `/tmp/m0` 与 `/tmp/b0`。
2. **L2 骨架（9 个文件）**：`types/module.ts`（`ServerModule`/`ModuleContext`/`PluginRoots`）、`lib/mentionSources.ts`（`MentionQuery` + `mentionAssetType` 下沉）、7 个 `modules/*/index.ts`。入口统一「静态面 → 动态块 → 契约对象」三段式，行数 18/43/57/31/16/18/46。
3. **迁移 59 文件**：`git mv` 保留历史（assets 9、media 系 17、plugin 系 10、mcp 7、local 系 8、agentAccess 4、platformCore 4），`src/utils/**` 清空；246 处说明符只换前缀（agent 50 / routes 62 / modules 103 / `utils.ts` 30）。
4. **R-07 边契约化**：A 提及依赖下沉 `@/lib/mentionSources`（4 处归零、server→agent 23→19）；B 插件安装只经 `@/modules/mediaGeneration` 取 `addMediaProvider`；C MCP 只经 `@/modules/pluginMarket` 取安装内核与 `skillFiles`；D `RemoteTeam`/`MobileLinkConfig` 归 `conf` 所有 + 2 条 type re-export（file 级 15 文件环消失）。
5. **组合根瘦身**：`app.ts` 160→78 行，9 个形参与类型逐字不变；7 个入口用动态 `import()` 并发装配（入口静态面会传递求值 `conf`，静态化会破坏 `TOONFLOW_DATA_DIR` 时序）；15 步顺序/阻塞性/吞错语义逐条保真（步骤 5 `void`+空 catch、步骤 9 `void`+warn 分处两个入口）。
6. **R-15 锚点补偿**：`conf` 默认数据目录 5 级 → 6 级（仍解析 `<repo>/data`）；`remoteConnection.ts` 的 `./lib/i18n` 改 `@/lib/i18n`、`singleAgent/types.ts` 相对深度 +1（`f2c` 保持 2）。
7. **R-05/R-09**：`core.ts` 生成器加 21 条模块分组注释（`app.use` 仍 161）；`package.json` 5 个 target 跟迁（14 键名不变）；`AGENTS.md` 增模块入口与契约、8 模块清单、platformCore 4+16 台账口径。

## R — Result（结果）

- **结构**：8 个模块 → 9 / 28 / 43 / 50 / 21 / 46 / 27 / 22 = **246 文件 / 14,584 行**（上限 14,839）；`app.ts` 78 行；`src/utils/**` 为空；file 级 SCC 2 → 1（仅 `dxt↔servers`，E11）。
- **行为**：162 端点 / 161 路由文件 / 21 前缀 / 14 exports 逐字不变；**42 条接口请求 B0↔F 归一化 diff 为空**；`createApp` 幂等（`f5_marker=rev1`）、预热故障被静默吞掉（`f4_unhandled=0`）。
- **判据**：A.3③ `k1=245 k2=7 k4=252`（E13）；`d4v=4 d4t=2 raw=6`（E14）；`l2_relative=PASS`；n1 `59+178=237`、`9,240+5,109=14,349`。
- **偏差**：2 处 +1（`local→platform 77`、`mcp→platform 36`），均为既有边增量，登记 **E15**；无新增 source→target 对。
- **落地文件**：59 移动 + 9 新增 + `app.ts`/`core.ts`/`index.ts`/`utils.ts` + `package.json` + `AGENTS.md`；0 测试文件、0 依赖、0 分层文件落库。
