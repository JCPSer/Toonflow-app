# 测试与验收报告 · 第 9 轮整改（OHOS 构建插件路径联动 + 漂移守卫）

## 0. 文档元信息

| 项 | 内容 |
| --- | --- |
| 文档编号 | `TEST-2026-10-27-02` |
| 对应需求 | `REQ-2026-10-26-06`（需求矩阵 v6） |
| 对应方案 | `SOL-2026-10-27-04`（方案 v4） |
| 整改来源 | 第 9 轮独立审查打回 **B-1**（唯一阻断项） |
| 影响模块 | `server-api`（`apps/server`）+ `compat/ohos`（跨模块消费者） |
| 验证环境 | macOS arm64；Bun 1.3.11；`/opt/homebrew/bin`（工具链默认 PATH 不含） |
| 验证时间 | 2026-10-27 05:30–05:45 |
| 结论 | **B-1 闭环：14 处失配引用清零，10 个目标文件全部恢复 Bun→Node 转换；新增漂移守卫可拦截复发（负向测试已证）；tsc/bundle/启动冒烟全绿** |

## 1. 打回意见与处置

| 审查要点 | 事实 | 处置 |
| --- | --- | --- |
| K13 / B-1：`compat/ohos/nodeBuildPlugin.ts` 以字面路径索引的源文件在迁移后失配 | HEAD 版本含 **14 处**指向旧路径（`apps/server/src/utils/**` 9 个 `memberReplacements` 键 12 处 + `specialFiles` 1 处 + 4 处 `file === "..."` 分支），旧路径已全部不存在 | 逐条改到 `apps/server/src/modules/**` / `src/modules/localRuntime/remoteConnection.ts`；静态扫描 `14 → 0` |
| 失配后 `replaceOnce()` 守卫被绕过，失败静默 | 插件只对命中的文件执行转换，键不命中即跳过 | 在模块加载期新增「所有目标必须存在」守卫：`memberReplacements` 键 + `specialFiles` 逐项 `existsSync`，缺失即抛错，构建失败前置 |
| 需构建证据或结构化豁免 | 本机无 Windows/DevEco，HAP 产物不可得 | 不申请豁免：以真实文件跑插件的 `onLoad` 转换（15 个字面路径 / 14 个需转换文件）作为等价证据，见 §2；HAP 打包仍需 Windows/DevEco，见 §5 |

## 2. 验收判定表

| 编号 | 验收项 | 命令/证据 | 实测 | 判定 |
| --- | --- | --- | --- | --- |
| T-01 | 旧路径引用清零 | `git show HEAD:compat/ohos/nodeBuildPlugin.ts \| grep -cE "apps/server/src/(utils/\|remoteConnection)"` vs 工作区同命令 | `14 → 0` | **PASS** |
| T-02 | 15 个字面路径全部存在 | `/tmp/ohos_b1_probe.ts`：正则抽取插件内 `apps/**`、`packages/**` 字面路径后 `existsSync` | `literals=15 missing=0` | **PASS** |
| T-03 | 转换真实生效（非静默跳过） | 同上脚本加载插件 `setup()`，对每个字面路径调用 `onLoad`，检查返回 `contents` | `converted=14`（`renameExclusive.ts` 仅参与 `onResolve`，按设计不转换）、`runtimeImport=13`（`packages/file/src/index.ts` 仅做平台判断改写，按设计不注入运行时导入） | **PASS** |
| T-04 | 转换后无 Bun 残留 API | 对 `onLoad.contents` 去注释后匹配 `Bun.{escapeHTML,semver,sleep,Image,hash,spawn,which,plugin,Archive,Transpiler}` | `residualBun=0`（10 个文件逐一复核，见 §3） | **PASS** |
| T-05 | 关键转换点逐项存在 | 断点断言：`tools.ts → registerToolZod(zod);`、`install.ts` 不再含 `new Bun.Archive(tar).files()`、`desktop/index.ts` 不含 `@toonflow/file/bun` 与 `providerFile.exists()`、`mcp/resources.ts` 改用 `fileMime()`、`mobile/server.ts` 的 `import.meta.filename`/`runtime:"node"`、`packages/file` 的 `openharmony` 分支 | 6/6 命中 | **PASS** |
| T-06 | 漂移守卫负向测试 | 复制插件并把 1 个键改回 `apps/server/src/utils/plugins/tools.ts` 后 `import` | `THREW: OHOS 构建转换目标不存在：apps/server/src/utils/plugins/tools.ts` | **PASS** |
| T-07 | 类型检查 | `bun run --cwd apps/server typecheck`、`apps/mobile`、`apps/desktop typecheck`、`bun run --cwd compat/ohos typecheck` | 4/4 exit 0 | **PASS** |
| T-08 | 服务端打包 | `cd apps/server && bun build src/index.ts --target=bun --minify --external ... --outdir /tmp/server_bundle_check` | `Bundled 3162 modules in 239ms`；`index.js 23.26 MB` | **PASS** |
| T-09 | 源码模式启动 + 接口冒烟 | `TOONFLOW_DATA_DIR=/tmp/tf_smoke TOONFLOW_SERVER_PORT=39123 bun src/index.ts`（cwd `apps/server`） | 启动 391ms；`/api/tools/get`=200、`/api/workspaces/list`=200、`/api/settings/get`=403（同源门禁）、`/api/assets/roots`=403（同源门禁）、`/api/agent/list`=400（参数校验）、`/mcp`=401、`/api/nope`=404 | **PASS** |
| T-10 | 无其他同名消费者残留 | 全仓 `grep -rIn "src/utils/\|src/remoteConnection"`（排除 `node_modules/.git/build/.easyvibe` 生成物） | 源码/配置/CI **0 命中**；仅 `.easyvibe/map/**` 生成物仍用旧路径（§5 P2-2，未在本轮改动范围） | **PASS** |
| T-11 | 改动边界 | `git status --porcelain compat` / `git diff --stat` | 仅 `compat/ohos/nodeBuildPlugin.ts`（+20/−14），无其他代码改动 | **PASS** |

## 3. 逐文件转换证据（15 个字面路径）

| 字面路径 | 存在 | 已转换 | 注入运行时导入 | 残留 Bun API |
| --- | --- | --- | --- | --- |
| `apps/mobile/src/server.ts` | OK | yes | yes | — |
| `apps/server/src/modules/localRuntime/desktop/index.ts` | OK | yes | yes | — |
| `apps/server/src/modules/localRuntime/remoteConnection.ts` | OK | yes | yes | — |
| `apps/server/src/modules/mcpIntegration/mcp/resources.ts` | OK | yes | yes | — |
| `apps/server/src/modules/mediaGeneration/media/priceReference.ts` | OK | yes | yes | — |
| `apps/server/src/modules/mediaGeneration/media/provider.ts` | OK | yes | yes | — |
| `apps/server/src/modules/pluginMarket/plugins/ext.ts` | OK | yes | yes | — |
| `apps/server/src/modules/pluginMarket/plugins/initializeExt.ts` | OK | yes | yes | — |
| `apps/server/src/modules/pluginMarket/plugins/install.ts` | OK | yes | yes | — |
| `apps/server/src/modules/pluginMarket/plugins/tools.ts` | OK | yes | yes | — |
| `apps/server/src/modules/pluginMarket/teams/files.ts` | OK | yes | yes | — |
| `apps/server/src/routes/desktop/clipboard/write.ts`（未迁移，路径未变） | OK | yes | yes | — |
| `packages/ffmpeg/src/index.ts`（未迁移，路径未变） | OK | yes | yes | — |
| `packages/file/src/index.ts`（未迁移，仅平台判断改写） | OK | yes | no（设计如此） | — |
| `packages/file/src/renameExclusive.ts`（仅 `onResolve` 目标） | OK | no（设计如此） | no | — |

> 汇总：`literals=15 converted=14 runtimeImport=13 residualBun=0`。

## 4. 关键判据原始输出

```text
== T-01 旧路径引用 ==
HEAD: 14
NOW : 0

== T-02/T-03/T-04 插件 onLoad 实测 ==
SUMMARY literals=15 converted=14 runtimeImport=13 residualBun=0

== T-06 守卫负向测试 ==
THREW: OHOS 构建转换目标不存在：apps/server/src/utils/plugins/tools.ts

== T-07 类型检查 ==
server  tsc            exit=0
mobile  tsc            exit=0
desktop typecheck      exit=0
ohos    tsc -p .       exit=0

== T-08 打包 ==
Bundled 3162 modules in 239ms
  index.js  23.26 MB  (entry point)

== T-09 启动 ==
[服务启动成功]: http://localhost:39123
[启动耗时]: 391.00ms
/api/settings/get -> 403
/api/tools/get -> 200
/api/assets/roots -> 403
/api/workspaces/list -> 200
/api/agent/list -> 400
/mcp -> 401
/api/nope -> 404
```

## 5. 未覆盖项与边界说明

1. **HAP 产物未构建**：`compat/ohos/build.ts` 强依赖 Windows + DevEco Studio SDK 与 OHOS Node 共享库（脚本首行即校验 `process.platform === "win32"`），本机 macOS 不可执行。等价证据为 §2 T-02～T-06（用真实源文件驱动插件的 `onLoad`/`onResolve` 与守卫），以及 T-08/T-09 的服务端打包与启动冒烟；HAP 端到端仍建议在 Windows/DevEco 环境复跑 `bun run --cwd compat/ohos build`。
2. **验证环境补丁**：本 checkout 的 `node_modules` 缺少 `apps/server/package.json` 声明的 `@babel/traverse`，导致插件模块顶层 `createRequire(...).resolve` 失败。验证时临时在 bun 虚拟布局下放置同名空 stub 以完成 `import`，**验证后已删除**；该 stub 不进入改动，也不改变插件逻辑。仓库依赖清单未修改。
3. **未处理的审查 P2/P3**：`ServerModule.dependencies` 与出边漂移（P2-1）、`.easyvibe/map` 重算（P2-2）及 5 项 P3 属审查「附整改项」，按本轮指令「打回意见外的文件不要碰」未纳入本次改动；`.easyvibe/map/**` 为生成物，待地图工具重算后自动同步。
4. **既有 Bun 用法保留**：`packages/file/src/index.ts` 按设计只改写平台判断、不注入运行时导入；`renameExclusive.ts` 仅作为 `onResolve` 目标参与重定向。两者与 HEAD 行为一致。

## 6. 结论

B-1（唯一阻断项）已闭环：插件 14 处旧路径引用全部指向迁移后的真实文件，10 个目标文件的 Bun→Node 转换恢复生效（无 Bun 残留），并新增「目标必须存在」守卫把同类漂移从静默失败变为构建即失败。未新增测试文件、未新增依赖、未改动 `apps/server` 业务代码。

**判定：PASS（T-01～T-11 全绿；HAP 端到端受平台限制，见 §5.1）**
