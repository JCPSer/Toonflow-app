# 测试结果：媒体供应商支持重命名（显示名称）

- 时间：2026-10-30 15:41
- 对应方案：`2_requirements_solutions/2026-10-30-15-45-media-provider-rename.md`
- 构建：`bun run --filter '@toonflow/server' build`、`bun run --filter '@toonflow/web' build` 通过；`./scripts/deploy-local.sh --build` 已安装（**未重启应用**）

## 1. 类型检查与构建

| 项 | 结果 |
| --- | --- |
| `bun run --filter '@toonflow/server' typecheck` | 通过（退出码 0） |
| `bun run --filter '@toonflow/server' build` | 通过（index.js 23.29 MB） |
| `bun run --filter '@toonflow/web' build` | 通过（两次：初版与焦点调整后） |
| `bun run --filter '@toonflow/web' typecheck` | **失败，但与本次改动无关**：`apps/server/src/modules/agentAccess/singleAgent/types.ts(2,33) Cannot find module '@/agentRuntime'`。该文件与 `apps/web/tsconfig.json`、`tsconfig.base.json` 均未改动（`git status` 为空），属仓库基线问题 |
| `./scripts/deploy-local.sh --build` | 通过：桌面入口、前端、节点包、工具、扩展已安装；运行期节点包「无变化」 |
| 生效条件 | 服务端与前端都装在桌面入口/资源里，**需重启应用**（未由自动化重启） |

## 2. 服务函数级端到端（真实 `renameMediaProvider` + 真实 conf/workspace 文件模块）

临时脚本（不入库）：`apps/server/src/__rename-e2e.tmp.ts`，运行时设 `TOONFLOW_DATA_DIR` 指向 `mkdtempSync` 建的真实临时目录，在 `providers/` 下写真实 `.ts` 文件后调用真实函数。共 28 项断言，全部通过。

| 用例 | 结果 |
| --- | --- |
| 正常改名（带首尾空格） | 通过：返回 `label` 已 trim 更新 |
| 只改 label 一行 | 通过：文件内容 = 原文仅替换 label，其余字节逐一相等 |
| ID 不变 / 模型列表字节不变 | 通过 |
| revision 更新且与列表接口一致 | 通过 |
| 列表返回新显示名 | 通过 |
| 改成自己的名字（无操作） | 通过：不写盘、revision 不变 |
| CRLF 文件 | 通过：只换 label，7 行 CRLF 全部保留 |
| 模板字面量 label | 通过：替换为 JSON 字符串字面量 |
| 名字含 `"` 与 `\` | 通过：转义正确，文件仍可解析 |
| 与其它供应商重名 | 通过：409「已存在同名供应商：另一个」，文件不变 |
| 大小写/近似名（另壹个） | 通过：允许（严格相同才算重名） |
| revision 过期 | 通过：409，文件保留先提交者的名字（首跑文案为「请刷新页面后重试」，整改后统一为「请刷新页面后再重命名」，状态码与行为不变） |
| 空名 / 纯空白 / 201 字 | 通过：400 |
| 含换行 / 含控制字符 `\u0001` | 通过：400 |
| 语法错误的供应商文件 | 通过：400，文件未写入 |
| tfRouter（真实内置源码）改名 | 通过：`id` 不变、`supportsPrice`/`supportsBalance` 仍为 true、文件只改 label |
| 改名后全部供应商仍可解析 | 通过（除故意损坏的测试文件） |
| 改名后模型仍可读取 | 通过 |

评审整改后（输入禁用、控制字符校验扩展、409 文案统一、无操作提前判等、去掉冗余断言）用第二版回归脚本重跑，27 项全部通过，新增覆盖：名字含 `"`、`\`、`${}`、中文与组合 emoji（ZWJ 允许）；C1（U+0085）、零宽空格（U+200B）、U+2028/2029、bidi 覆盖/隔离（U+202E/2066）、BOM（U+FEFF）一律 400；CRLF 行数、models 字节、坏文件不写入等回归项保持不变。

复审把「不可见字符」从枚举式改为 Unicode 类别判定（拒绝 `\p{Cc}`/`\p{Cf}`/`\p{Zl}`/`\p{Zp}`，仅放行 ZWJ），又用 14 项字符用例复核：U+2028/2029、ZWSP、ZWNJ、LRM、软连字符、WORD JOINER、BOM、C1、bidi 覆盖、LRI、换行共 12 类均 400；组合 emoji 与「中文😀」允许。该次改动只触及字符校验，回归脚本与 HTTP 脚本未重跑，server typecheck 通过。

## 3. 节点模型列表联动（真实 `listMediaModels`）

临时脚本（不入库）：`apps/server/src/__rename-feed.tmp.ts`。

| 用例 | 结果 |
| --- | --- |
| 改名前后 `providerLabel` 来源正确 | 通过：改名前后分别是旧名与新名 |
| `/api/ai/media/models` 数据层返回新分组名 | 通过：`providerLabel = 改名后的节点名` |
| `providerId` 不变 | 通过 |

## 3.5 HTTP 路由级端到端（真实 express + `validateFields` + 错误中间件）

临时脚本（不入库）：`apps/server/src/__rename-http.tmp.ts`，在 `127.0.0.1:0` 起最小 express，挂真实路由、真实 `errorFromCause` 中间件，用 `fetch` 发 PUT。

| 用例 | 结果 |
| --- | --- |
| 正常改名（带首尾空格） | 通过：200，`data.label` 已 trim，文件写入新名字 |
| 空白名 | 通过：400（zod `trim().min(1)`） |
| 非法文件名 `../demo.ts` | 通过：400 |
| 与其它供应商重名 | 通过：409，文案「已存在同名供应商：另一个」 |
| revision 过期 | 通过：409，文案「供应商文件已被修改，请刷新页面后再重命名」（整改后重跑，6 项断言全部通过） |

测试环境未加载中文语言包，`validateFields` 的参数错误文案显示为英文（应用内为中文），属测试环境差异。

## 4. 部署

| 项 | 结果 |
| --- | --- |
| `./scripts/deploy-local.sh --build` | 退出码 0 |
| 安装范围 | 桌面入口 `app/Contents/Resources/app/bun/index.js`、前端 `build/web`、节点包、工具、扩展 |
| 运行期节点包 | 无变化（本次未改节点） |
| 安装产物核对 | `build/desktop/main/index.js` 与 `app/Contents/Resources/app/bun/index.js` 逐字节一致；产物内含 `providers/media/rename` 路由；前端产物含 `renameProviderDialog-*.js` 分包 |
| 重启 | **未重启**，由用户自行重启后生效 |

## 5. 未覆盖 / 需人工确认

- **应用内 UI 手测**：卡片按钮、弹窗交互、节点下拉刷新属浏览器侧行为，本次只做了构建与数据层验证，需重启后在应用里点一次确认（改名 → 设置列表与节点下拉均显示新名 → 已选该供应商的节点仍能生成）。
- **完整服务进程**：未启动整个 `createApp()`（会装配全部模块），改用最小 express 挂真实路由验证，见 §3.5。
- **回车提交**：已移除显式 `keyup.enter`，改为依赖 `el-form` 原生隐式提交；未在 Chrome/WKWebView 各实测一次回车只发一个请求。
- **两窗口并发实测**：revision 冲突路径由函数级用例覆盖，未构造两个浏览器窗口同时提交。
- **404（文件被并发删除）、锁冲突 409、弹窗 409 conflict 交互**：由代码审查确认路径（ENOENT → 全局映射 404、`lockWorkspaceFiles` 抛 EBUSY 409、dialog 收到「已被修改」关闭并通知父组件刷新），未逐一构造运行时用例。
- **插件市场重装覆盖**：已知行为（重装后名字回到安装包写法），未单独实测。

## 6. 清理

- 临时脚本在 `apps/server/src/__rename-e2e.tmp.ts`、`apps/server/src/__rename-feed.tmp.ts`，运行后删除，未进入仓库。
- 测试全部在 `mkdtemp` 的临时目录内进行，未改动用户真实 `providers/` 目录与任何项目数据。

## 7. 代码审查（子 agent）

| 审查项 | 结论 | 处理 |
| --- | --- | --- |
| 需求评审（初审） | 不通过：R5 锁范围、R6 刷新链路、重装事实、AST 定位、重名范围共 5 条 P1；另有 16 条 P2 | 已全部整改，见需求矩阵 §6.1、方案 §6.1 |
| 需求评审（复审） | 待回传（评审 agent 通道延迟，已另开文件通道） | — |
| 代码审查 | 通过，无 P0；1 条 P1（保存中未禁用输入）+ 13 条 P2 | 全部处理：输入禁用、去掉 `keyup.enter`、不可见字符改为 Cc/Cf/Zl/Zp 判定（放行 ZWJ）、409 冲突刷新列表、文案统一、无操作提前判等并 trim、输入清错误、去冗余断言、路由 `trim()` 校验 |
| 需求复审 | 通过，无 P0/P1；8 条 P2（不可见字符改类别判定、trim 口径、§5 矛盾句、R10 措辞、R2 转义验收、409 文案契约、测试文档同步、方案残留 400） | 已全部采纳并同步文档 |
| 区间替换正确性 | 通过：`as const`、`satisfies`、类型断言、括号、BOM、注释同名串、字符串键名、含 `"`/`\`/`${}` 的新名，均只改 label 值区间 | 与自测一致 |
| 回归 | `parseProvider` 仅新增字段，save/delete/validate/load/refresh 不受影响 | typecheck + build 复核通过 |

评审整改后回归：`bun run --filter '@toonflow/server' typecheck` 通过、`@toonflow/web` build 通过；重跑回归脚本 27 项、HTTP 脚本 6 项，全部通过（新增 11 个不可见/控制字符用例与含 `"`/`\`/`${}` 的转义用例）。复审后字符校验改为 Unicode 类别判定，另跑 14 项字符用例全部通过，其余用例未重跑。
