# START 记忆：桌面入口被 server 产物覆盖导致无窗口

- 时间：2026-11-17 19:14

## Situation
用户反馈「又打不开应用了」。应用进程在跑（launcher + bun main.js），但 `lsappinfo` 显示 windowCount 为 NULL、截图无主窗口。

## Task
定位启动无窗口原因并恢复应用。

## Action
1. 检查 `Resources/app/bun/index.js`：大小 23.3MB、无窗口代码——这是 `build/server/index.js`（standalone server）产物。
2. 确认历史包大小：桌面入口约 17.86MB、包含 `BrowserWindow`/`服务启动成功` 等桌面主进程代码；server 入口约 23.36MB。
3. 用 `bun run build:desktop` 重新构建，解压 `Resources/<hash>.tar.zst`（zig-zstd decompress）得到 `app/bun/index.js`，覆盖并保留坏文件为 `.broken-server-*`。
4. 重新启动应用，主窗口恢复。

## Result
- 根因：本轮 18:33、18:58、19:08 三次部署都把 `build/server/index.js` 当成桌面入口覆盖 `app/bun/index.js`，桌面主进程代码被纯 server 包替换，窗口永不 show。
- 正确流程：Web/节点/工具可以单独构建同步；**`app/bun/index.js` 必须取 `build:desktop` 的负载**（或导出桌面负载后再替换），不能用 `build:server` 产物。
- 备份命名区分：`.bak-<time>`（桌面）、`.bak-<time>` 里 23MB 的那些是误覆盖的 server 包，`.broken-server-*` 为本次确认的坏包。
