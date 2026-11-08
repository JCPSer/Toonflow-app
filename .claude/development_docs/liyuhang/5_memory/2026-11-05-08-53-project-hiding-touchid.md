# 记忆：项目隐藏（Touch ID 验证）

- 时间：2026-11-05 08:53（09:00 部署）
- 类型：功能增强（隐私 / 原生桥 / 全入口过滤）

## STAR

**Situation（背景）**
用户有隐私项目，需要把软件给别人演示时项目不出现；要求首页加「显示隐藏项目」入口、设置里加开关，打开需系统密码或 Touch ID。

**Task（任务）**
桌面端所有项目入口统一隐藏指定项目；解锁走 macOS Touch ID（可回落登录密码）；本次运行有效、重启自动锁定；远程/浏览器照常显示。

**Action（行动）**
- 原生：`apps/desktop/native/auth.m` → `libToonflowAuth.dylib`，`LAContext` + `LAPolicyDeviceOwnerAuthentication`；`evaluatePolicy` 后台队列执行，`JSCallback({threadsafe:true})` 回 JS；`supportsAuthentication()` 供能力探测；4 分钟超时。
- 桥/服务端：`/api/desktop/auth` 两段式（POST 发起、GET 轮询、GET 不带 id 探测能力），复用 dialogSessions；`DesktopRuntime.authenticate`。
- web：`projectPrivacy`（会话级解锁、能力探测）、`projectVisibility`（纯过滤规则 + 单测）、`desktopAuth` 客户端；首页锁图标/分段 tab/悬停隐藏按钮；设置→隐私开关；画布下拉、素材库、MCP 列表与 settings 快照过滤；工作区对目录/隐藏变化与解锁状态做拦截。
- 数据：`Project.hidden` 随 `toonflow.projectList` 持久化；`addProject` 重建列表项时带过 hidden。

**Result（结果）**
web、主进程 `app/bun/index.js`、新 dylib 已同步到 `/Applications/toonflow-exec.app`，**未重启应用**，需用户重启后按测试文档第 4 节验收。

## 关键经验

1. LocalAuthentication 不要求 bundle/entitlement/公证，ad-hoc 即可；把验证放进主进程 dylib，弹窗归属应用本身，比独立 helper 更可信。
2. `JSCallback` 默认不允许跨线程调用，原生后台队列回调必须 `threadsafe: true`，否则是 UB。
3. 解锁状态不要持久化：写进 settings 就会「演示前忘了关」；内存态 + 重启自动锁定是最省心的模型。
4. 「隐藏」必须与「能否解锁」同时可用：Windows/旧包/库缺失时要禁止隐藏，否则藏进去就打不开。
5. 项目对象会被 `addProject` 重建、被 pinia persist 恢复；hidden 标记要在两处都保住，否则打开一次就漏。
6. 桌面端连远端服务器（`desktop=1&remote=1`）没有本机 `/api/desktop` 通道，所有原生能力都要按「不可用」处理。
7. 系统弹窗同样可能停留超过 WKWebView 60 秒无数据上限，验证必须两段式轮询。
8. 拦截要放在路由层：页面内 `router.replace` 时组件已经挂载，隐藏项目会先加载一遍；`beforeEach` + 清空当前项目指针才是干净的。
9. 原生弹窗要能主动 dismiss（`LAContext.invalidate`）：超时不关会悬在屏幕上，还会挡住下一次验证。
