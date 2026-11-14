# Bug 分析：桌面应用启动后无窗口

- 时间：2026-11-14 11:45
- 级别：P0（应用不可用）
- 状态：已定位并修复

## 1. 现象

点击 Dock 里的 `toonflow-exec` 后，菜单栏显示 toonflow 为前台应用，但没有主窗口；进程（launcher/bun）存在且服务端口在监听。

## 2. 证据链

| 检查 | 结果 |
| --- | --- |
| `pgrep launcher/bun` | 进程存在，`[服务启动成功]` 有输出 |
| `curl http://127.0.0.1:3000/` | 404，`Cannot GET /` |
| `curl /api/nodes/get` | 200 但 `data: []`（静态根与节点根都不存在） |
| CoreGraphics 窗口列表 | 只有菜单栏小窗，无主窗口 |
| 桌面入口体积 | `Contents/Resources/app/bun/index.js` 23,338,356 B，与 `build/server/index.js` 完全一致 |
| 入口标记 | 当前入口无 `BrowserWindow`；同目录 `index.js.bak.202611131833`（17,839,323 B）有 2 处 |
| 系统日志 | `order all windows front`、WKWebView/IMK 初始化都有，说明原生层在跑，但主窗口从未 `show()` |

## 3. 根因

桌面主窗口由 `apps/desktop/src/index.ts` 创建，启动时 `hidden: Boolean(splash)`，只有前端页面加载并调用 `desktop.ready()` 后才 `mainWindow.show()`。该逻辑打包在 `Resources/app/bun/index.js` 里。

11/13 18:33 部署「服务端包」时，把 **server 构建**（`build/server/index.js`）直接覆盖到了桌面入口 `Resources/app/bun/index.js`。server 构建只有 `createApp`，没有 Electrobun 的窗口代码：

1. 服务仍能启动、API 仍可用（所以日志看起来正常）；
2. 静态目录 `webRoot` 由桌面入口计算并传入，入口被替换后该路径为空/不存在 → `/` 404；
3. 页面加载失败 → `desktop.ready()` 永不触发 → 窗口永远 hidden。

旧进程在 18:33 前已启动、代码在内存中，所以当晚仍可用；今天重启加载了错误入口才暴露。与今天 11:27 的宫格节点改动无关（节点 UMD 只影响插件加载，不参与主窗口创建）。

## 4. 影响面

- 所有重启后的桌面启动都无窗口；
- 数据目录、用户节点、工作区未损坏（`data/nodes/initialized` 仍为 `2nv546dkpsgay`，内置同步未触发）。

## 5. 评审意见

（待填写）

- 是否通过：
- 其他要求：
