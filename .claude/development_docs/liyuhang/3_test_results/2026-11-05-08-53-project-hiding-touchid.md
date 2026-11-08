# 测试结果：项目隐藏（Touch ID 验证）

- 时间：2026-11-05 08:53（09:00 部署）
- 对应：`../1_requirements_matrix/2026-11-05-08-53-project-hiding-touchid.md`、`../2_requirements_solutions/2026-11-05-08-53-project-hiding-touchid.md`

## 1. 原生验证可行性（本机实测）

| 项目 | 结果 |
| --- | --- |
| 系统 | macOS 15.7（24G222），arm64 |
| 裸 Mach-O 调 LocalAuthentication | `canEvaluatePolicy(LAPolicyDeviceOwnerAuthentication)` = 可用，生物识别可用 |
| 真实 `evaluatePolicy` | 返回 `result=0`，耗时约 5s（系统弹窗完成验证），说明未签名/临时签名进程也能正常弹窗 |
| 签名要求 | 至少 ad-hoc 签名；本机应用本身即 ad-hoc（`Signature=adhoc`，无 Team ID），新增 dylib 已 `codesign --force --sign -` |
| 外部资料 | tidcli / pinentry-touchid / Keyclasp 均证明无 bundle、无 entitlement 可用；`NSFaceIDUsageDescription` 只与 Face ID 相关 |

## 2. 自动化

| 项目 | 结果 |
| --- | --- |
| `bun test src/lib/projectVisibility.test.ts` | 5 pass / 0 fail |
| `bun test`（apps/web 全量） | 51 pass / 0 fail |
| `bun run typecheck`（web，vue-tsc） | 仅剩既有 `server/.../types.ts` 找不到 `@/agentRuntime`（历史遗留） |
| typecheck（desktop / server） | 通过 |
| `bun run build:macPicker` | 生成 `libToonflowAuth.dylib`，`codesign -v` 通过 |
| `bun run build:desktop` | 成功（三次）；产物 `index.js` 内含 `tnf_authenticate`、`tnf_cancel`、`/api/desktop/auth`、`supportsAuthentication`、`threadsafe` |
| 部署 | `app/bun/index.js`、`app/mac/libToonflowAuth.dylib`、`views/mainview/` 已同步到 `/Applications/toonflow-exec.app`（09:00），**未重启应用** |

## 3. 代码评审（子 agent）

文档评审与代码评审提出的问题及处理：

- P1 远端桌面连接（`desktop=1&remote=1`）无法调用本机 `/api/desktop`：初始解锁态改为 `!isDesktop || isRemoteConnection`，锁图标与设置开关在该模式隐藏。
- P1 无验证能力的安装包（Windows/旧包）可隐藏但无法解锁：新增能力探测 `GET /api/desktop/auth`（不带 id）与 `supportsAuthentication()`；探测为 false 时禁用隐藏按钮并拒绝隐藏。
- P1 工作区已挂载后切换项目（画布下拉/MCP）不经过守卫：增加对 `project.directory / hidden` 的 watch，统一拦回首页。
- P1 首页创作框预填上次打开的隐藏项目：锁定态不再预填。
- P1 MCP settings 快照泄露隐藏项目：锁定态抹掉列表项与按隐藏目录命名的 store 键。
- P1 `JSCallback` 跨线程回调未声明 `threadsafe`：已加 `threadsafe: true`。
- P1 设备连接目录：与 R7 冲突，决定**不过滤**并在文档中记为已知边界。
- P2 锁图标 tooltip 暴露「隐藏项目」字样：改为「解锁 / 锁定」。
- P2 解锁后跳 tab 与文档不一致：改为停留在「项目」页。
- P2 会话 TTL 与原生超时相同可能先过期：原生超时改为 4 分钟。
- P2 锁定后素材库仍停在隐藏项目：锁定瞬间退出到全局库。
- P2 R6「验证后进入」：改为验证后在隐藏项目页手动打开（文档同步）。
- P0 正式打包不会生成验证库：`build.ts` 在 macOS 非 dev 构建前补跑 `build:macPicker`（reviewer 看到的旧快照）。
- P1 页面级拦截晚于挂载：改为路由 `beforeEach` 拦截 `/workspace`，并在拦截时清空当前项目指针；MCP `openProject` 增加同规则拒绝。
- P2 超时弹窗悬空：原生新增 `tnf_cancel()`（`LAContext.invalidate`），4 分钟超时主动关闭；同进程并发验证直接失败。
- P2 能力探测过宽：`supportsAuthentication()` 改为调用 `tnf_auth_available()`，无可用凭据（无指纹且无密码）时也判为不支持；锁图标同步隐藏。
- P2 轮询不可取消：解锁过程持 `AbortController`，锁定/关闭即中断轮询。

## 4. 待人工验证（需重启应用）

1. 首页项目区锁定态只看到锁图标；点击弹 Touch ID，通过后出现「项目 / 隐藏项目」分段。
2. 普通项目卡片悬停出现眼睛按钮，点击后项目从「项目」页消失；切到「隐藏项目」可见。
3. 隐藏项目页点眼睛按钮恢复；项目回到「项目」页。
4. 设置 → 隐私 →「显示隐藏项目」：打开需验证，关闭立即锁定；关闭时首页自动回到「项目」页。
5. 重启应用后：首页看不到隐藏项目；画布项目下拉、素材库项目分组里也没有。
6. 上次打开隐藏项目时重启并进入工作区：被拦回首页提示验证；验证后在隐藏项目页手动打开可进入。
7. 取消验证 / 验证失败：保持锁定，不出现隐藏项目。
8. 手机远程/浏览器访问：隐藏项目照常显示。
9. 工具 → 验证 `settings.json` 中项目项出现 `"hidden": true`，打开该项目后标记仍在。

## 5. 已知边界

1. 隐藏只是界面层：Finder / 命令行仍能看到项目目录与文件，不做加密。
2. 设备连接设置里的允许目录仍包含隐藏项目（远程访问需要）。
3. 原生弹窗的应用名取决于进程（Bun 主进程），可能显示为通用名称；弹窗正文有「验证以显示隐藏项目」说明。
4. 同时打开目录选择器时，系统验证会被会话互斥挡住（提示稍后重试）。
