# 记忆 · 第 9 轮整改：OHOS 构建插件路径联动 + 漂移守卫

## S — Situation（背景）

server-api 子模块拆分（59 文件迁移到 `apps/server/src/modules/**`）通过了结构评审，但独立审查第 9 轮打回 **B-1**：`compat/ohos/nodeBuildPlugin.ts` 仍以旧字面路径索引被迁移的源文件，`memberReplacements` 键、`specialFiles` 与 4 处 `file === "..."` 分支全部失配。插件只对命中的文件执行 Bun→Node 转换，键不命中即静默跳过，HAP 产物会在启动期加载 `Bun.plugin(...)` 时崩溃；`replaceOnce()` 的唯一匹配守卫因此被绕过。

## T — Task（任务）

把插件的 14 处旧路径引用改到迁移后的真实文件，并新增「目标必须存在」守卫，使同类漂移从静默失败变为构建即失败；不改动打回意见以外的代码，不申请豁免。

## A — Action（动作）

1. **路径联动**：10 个目标文件、14 处引用全部更新——`remoteConnection.ts` → `modules/localRuntime/remoteConnection.ts`；`utils/desktop` → `modules/localRuntime/desktop`；`utils/media/{provider,priceReference}` → `modules/mediaGeneration/media/*`；`utils/plugins/{install,tools,ext,initializeExt}` → `modules/pluginMarket/plugins/*`；`utils/teams/files` → `modules/pluginMarket/teams/files`；`utils/mcp/resources` → `modules/mcpIntegration/mcp/resources`。未迁移的 `routes/desktop/clipboard/write.ts`、`packages/{file,ffmpeg}`、`apps/mobile/src/server.ts` 保持原样。
2. **漂移守卫**：模块加载期遍历 `memberReplacements` 键与 `specialFiles`，`existsSync(resolve(root, file))` 失败即抛 `OHOS 构建转换目标不存在`；守卫先于 `setup()`，构建直接失败而非产出坏包。
3. **验证**：静态扫描 `14 → 0`；用真实源文件调用插件 `onLoad`，15 个字面路径全部存在、14 个需转换文件全部转换（`renameExclusive.ts` 仅参与 `onResolve`）、13 个注入 `toonflow:ohos-runtime` 导入、去注释后 Bun API 残留 `0`；负向测试把 1 个键改回旧路径，`import` 即抛守卫错误。
4. **回归**：`apps/server`、`apps/mobile`、`apps/desktop`、`compat/ohos` 四处 typecheck 全 0；服务端 bundle 3162 模块 / 23.26 MB；源码模式启动 391ms，7 个端点返回码与基线一致（200/403/400/401/404）。

## R — Result（结果）

- **B-1 闭环**：插件 14 处旧路径引用清零，10 个目标文件恢复 Bun→Node 转换（`Bun.plugin`/`Bun.Archive`/`Bun.Transpiler`/`Bun.Image`/`Bun.hash`/`Bun.spawn`/`Bun.escapeHTML`/`@toonflow/file/bun` 全部改写）；新增守卫可拦截复发。
- **改动边界**：仅 `compat/ohos/nodeBuildPlugin.ts`（+20/−14）；`apps/server` 零改动、无新增依赖、无新增测试文件。
- **未覆盖**：HAP 端到端需 Windows + DevEco + OHOS Node 共享库，本机不可执行；等价证据为插件 `onLoad` 真实文件实测 + 服务端打包/启动冒烟，已在 TEST-2026-10-27-02 §5 声明。
- **遗留**：审查 P2-1（`ServerModule.dependencies` 漂移）、P2-2（地图重算）与 P3 项按本轮指令未处理。
