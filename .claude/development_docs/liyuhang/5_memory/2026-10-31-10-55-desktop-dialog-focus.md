# 桌面端系统对话框：焦点、60 秒断流、冻结与结果丢失

- 时间：2026-10-31 10:55
- 改动文件：`apps/desktop/native/folderPicker.m`、`apps/desktop/native/activation.m`(新)、`apps/desktop/scripts/buildMacFolderPicker.mjs`、`apps/desktop/src/index.ts`、`apps/desktop/src/connection.ts`、`apps/server/src/modules/localRuntime/desktop/dialogSessions.ts`(新)、`apps/server/src/routes/desktop/dialog.ts`(新)、`apps/server/src/core.ts`、`apps/server/src/router.ts`、`apps/web/src/lib/desktopDialog.ts`(新)、`apps/web/src/lib/projectShare.ts`、`apps/web/src/lib/saveFile.ts`、`apps/web/src/pages/home/workspacePicker.vue`、`apps/web/src/components/settings/panels/developer/providerDebugDialog.vue`

## Situation

用户在首页点「新建项目 / 或打开已有项目」，弹出的系统目录面板**标题栏是灰的、键盘完全没反应**；约一分钟后提示「无法打开文件选择器，请重试」，此时面板仍开着；即使选完目录点「选择」也没有任何反应。

## Task

让原生对话框一出现就可用，且结果不再因为「挑得久」而丢失；同时消除失败路径把整个应用（含正在跑的 Agent）冻住的问题。

## Action

1. **焦点**：`folderPicker.m` 只调用了一次 `activateIgnoringOtherApps`——该 API 自 macOS 14 起被 Apple 标注 deprecated 且 **will have no effect**。改为 `finishLaunching` + 每 150ms 重试 `[NSApp activate]`，激活后再 `makeKeyAndOrderFront`。实测单靠重试只有约 40% 成功率（5 次里 3 次失败），因此新增 `activation.m` 编译成 `libToonflowActivation.dylib`，主进程 spawn 选择器后调用 `yieldActivationToApplication:` 把激活权让给子进程——这是 Apple 文档给的确定性路径。
2. **60 秒断流**：实测本机 WKWebView 对「一直没有数据」的请求 61 秒断流（XHR 61009ms / fetch 61010ms），而对话框接口的响应被绑在「用户关掉面板」那一刻。新增 `dialogSessions` 会话表 + `POST/GET /api/desktop/dialog` 两段式协议，前端 `pickDesktop()` 每 350ms 轮询，每个请求都是毫秒级。
3. **冻结**：`Utils.openFileDialog` 是同步 FFI（`dispatch_sync` + `runModal`），与 Express 同进程同事件循环。删掉目录选择器的阻塞回退；导入工程、供应商选文件改走随包 helper（新增 `--mode file --ext`），不再有任何同步对话框。
4. **顺带**：`core.ts` 的路由生成器会把 `routes/` 下的工具文件（`share/scope.ts`、`share/tmp.ts`）当成路由生成 import，导致 «has no default export»；改为跳过没有 `export default` 的文件。

## Result

| 项 | 数据 |
| --- | --- |
| 焦点实测 | 改后日志 `shown active=0 key=0` → `tick=1 ACTIVE key=1`（150ms 内） |
| 会话单测 | 6 例 / 17 断言全过 |
| typecheck | server 通过；desktop 通过；web 仅剩既有 `@/agentRuntime` 基线错误 |
| 构建部署 | `deploy-local.sh --build` 通过，helper + dylib + main/index.js + web 已进安装目录 |
| 是否重启 | **未重启**，B2/B3/B4 需用户重启后生效；B1 已热替换生效 |

## 经验

- **`orderFrontRegardless` 不是焦点修复**：它按定义只把窗口提到最前、不改变 key/main window。实测换成它之后面板再也拿不到键盘焦点，只有 cmd+tab 再点一下才行。
- **重试不是修复，让权才是**：协作式激活下，子进程自己怎么重试都是概率事件；必须由当前 active 的 App 调 `yieldActivationToApplication:`。
- **响应绑在 UI 生命周期上，迟早会撞浏览器超时**：WKWebView 的无数据上限是 60 秒，对话框开满一分钟必然丢结果；两段式（start + 轮询）是唯一稳的做法。
- **同步 FFI + 同进程 HTTP 服务 = 整个应用停摆**：Electrobun 的 `openFileDialog` 会 `dispatch_sync` 到 Cocoa 主线程 `runModal`，把它当「兜底」比不兜底更危险。
- **中文串在 esbuild 产物里是转义的**：用 `grep 中文` 校验打包产物会得到假阴性，要用路径/标识符校验。
