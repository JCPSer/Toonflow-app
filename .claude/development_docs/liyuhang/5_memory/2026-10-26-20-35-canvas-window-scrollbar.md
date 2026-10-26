# 记忆：画布区域窗口级滚动条

## Situation

工作区有时在窗口底部与右侧同时出现滚动条；窗口越窄越容易复现。

## Task

彻底消除工作区内的窗口级滚动条，同时不让状态条被裁、不影响其它页面滚动。

## Action

- `apps/web/src/App.vue`：`watchEffect` 按 `route.path.startsWith("/workspace")` 切换 `html.workspaceViewportLock`；样式 `html.workspaceViewportLock, html.workspaceViewportLock body { height: 100%; overflow: hidden; }`。
- `apps/web/src/pages/workspace/panels/canvas/index.vue`：`.canvas` 增加 `overflow: hidden`，画布内浮层不再撑开页面。
- `packages/ext/comfyMonitor/src/index.vue`：`.comfyMonitor` 增加 `flex-wrap: wrap`、`max-height: calc(100% - 16px)`、`overflow: auto`。

## Result

- 800×560 修复前 `scrollWidth/clientWidth = 1237/794`，修复后 `800/800`；`scrollHeight/clientHeight = 560/560`。
- 状态条在窄窗口折行，折叠/清理/设置按钮仍在画布内。
- web typecheck/build、ext build 通过；应用与运行期 `ext`、`ext-comfyMonitor.umd.js` 已同步，需重启生效。

## 精度要点

- 溢出源不是 Vue Flow（它自己 `overflow: hidden`），而是与它同级的覆盖层：`position: absolute; display: flex; max-width: calc(100% - 16px)` 但**不换行、不滚动**的容器，子项 `nowrap` 时会直接撑破盒模型。
- 横向滚动条会占高度，进而诱发纵向滚动条，「下方和右侧同时出现」是同一个根因。
- 文档级 `body` 的 `overflow: hidden` 可能来自 Element Plus 弹窗锁滚动（`el-message-box-parent--hidden`），排查时不要误判为样式生效。
- 直接改 hash 排查路由类样式会被应用「恢复上次工作区」的逻辑接管，必须以 `router.currentRoute` 为准。
