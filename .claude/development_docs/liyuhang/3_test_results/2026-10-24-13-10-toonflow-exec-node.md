# 测试结果：Toonflow「运行指令」节点

环境：macOS arm64 / Bun 1.3.11 / 源码 `Toonflow-app`（分支 `feat/exec-node`）
服务：`NODE_ENV=dev TOONFLOW_DATA_DIR=/tmp/tf-exec-test TOONFLOW_SERVER_PORT=3000 bun src/index.ts`
Web：`TOONFLOW_SERVER_PORT=3000 bun run --filter '@toonflow/web' dev` → 5173

## 一、服务端路由（curl 实测）

| # | 用例 | 期望 | 实际 | 结论 |
| --- | --- | --- | --- | --- |
| 1 | `echo hello; printf oops >&2; exit 7` | start / stdout / stderr / exit code 7 | 四条事件齐全，`code:7 signal:null durationMs:88` | 通过 |
| 2 | 流式到达时机 | 每秒一条，不是跑完才吐 | 三行 tick 分别在 428.797 / 429.166 / 430.170 / 431.178 到达 | 通过 |
| 3 | `cwd: ".."` 越界 | 拒绝 | `400 Invalid file path` | 通过 |
| 4 | 缺少 `x-toonflow-workspace` | 403 | `403 Only Toonflow pages may access the control connection` | 通过 |
| 5 | `timeoutMs: 500` + `sleep 30` | 超时终止 | `exit code:null signal:SIGKILL durationMs:502 timedOut:true killed:true` | 通过 |
| 6 | 客户端断开 → 进程终止 | 无残留 | **残留 1 个 `sleep 60`，8 秒后仍存活** | **失败** |

### 缺陷 1：客户端断开不触发任何 close 事件

`curl --max-time 2` 主动断开后，`res.close` / `req.aborted` / `socket.close` 三个监听一个都没触发，
子进程存活（`ps` 显示 PID 79552，PPID 为 server，PGID=PID）。8 秒后再次检查仍存活，不是延迟问题。

这不是实现失误：`apps/server/src/routes/ffmpeg/execute.ts` 顶部已有同源结论——
「Bun 的静默 SSE 不保证触发断开事件；显式取消复用本接口和单进程会话状态」，
ffmpeg 才因此单独提供 `/api/ffmpeg/cancel`。

处理：新增 `POST /api/exec/cancel`，请求体带 `requestId`，服务端用 `${cwd}\0${requestId}` 命中运行中的命令并终止。
节点「停止」改为 `abort` + 显式 cancel 双保险。断连监听保留作为尽力而为的兜底。

> 复测结果见第四节。

## 二、画布端到端（浏览器 dev 环境）

环境：vite 5173 → 代理 3000；工作区 `/tmp/tf-exec-test/workspaces/demo`；节点 `execNode.umd.js` 放入 `data/nodes`。

| # | 用例 | 实际 | 结论 |
| --- | --- | --- | --- |
| 7 | 节点出现在「添加节点」菜单 | 菜单内显示「运行指令」 | 通过 |
| 8 | 节点渲染 | 命令框、工作目录、超时（秒）、运行/停止/清空、输出区、三个接线柱（触发 `*` / 完整输出 STRING / stdout STRING） | 通过 |
| 9 | 空命令时「运行」禁用 | 禁用 | 通过 |
| 10 | `echo line1; sleep 1; echo line2; printf warn-line >&2; exit 3` | 输出区依次出现 line1 / line2 / warn-line，状态行「执行结束 · 退出码 3 · 1.1s」 | 通过 |
| 11 | 启动信息 | 「已启动：<命令> · pid 81072 · cwd /private/tmp/tf-exec-test/workspaces/demo」 | 通过 |

结论：命令执行、流式输出、退出码与耗时在真实画布中全部正确。

## 三、取消与大输出（修复后复测）

| # | 用例 | 实际 | 结论 |
| --- | --- | --- | --- |
| 12 | API 层：起 `sleep 60` → `POST /api/exec/cancel` | 取消返回 200；`sleep 60` 进程数 1→0；exec 流收到 `exit signal:SIGKILL killed:true` | 通过 |
| 13 | 画布层：节点里跑 `sleep 30` → 点「停止」 | 输出区「已停止 · 13.3s」，`pgrep -fx 'sleep 30'` 为 0 | 通过 |
| 14 | 2 MB 无换行输出（`head -c 2000000 /dev/zero \| tr '\0' a`） | 186 ms 正常结束，`exit code:0` | 通过 |
| 15 | 20 万行输出（`seq 1 200000`） | 122 ms 正常结束，末尾行完整，`exit code:0` | 通过 |

> 说明：用例 14/15 通过 curl 直连测试，未在画布内跑（节点端只保留 20000 行，超出部分丢弃）。

## 四、审查后修复与复测

子 agent 审查出 7 条，按严重度全部修复：

| 编号 | 问题 | 处理 |
| --- | --- | --- |
| H1 | 输出无上限、无背压，慢客户端可 OOM | 单流待发缓冲封顶 256 KiB，超限丢弃并补发 `truncated` 事件；`res.writableLength > 8 MB` 时丢弃该块 |
| H2 | 节点行截断是 O(n)，20 万行会冻结画布 | 摊还式裁剪（超 `MAX_LINES + 1000` 才一次性裁到 `MAX_LINES`），单块最多处理 2000 行，`:key` 换成单调 id |
| M1 | cancel 与 register 竞态 → 不可取消的孤儿进程 | 客户端 404 后延迟 400 ms 重试一次 |
| M2 | Windows 上 `/bin/sh` 不存在、进程组 kill 无效 | `win32` 用 `COMSPEC /d /s /c`，终止改 `taskkill /T /F` |
| M3 | `reader.cancel` / `await reading` 可能永不 settle | 两处都与 1 s 定时器 `Promise.race` |
| M4 | spawn 后抛错漏杀子进程 | `terminate`/`settled`/`readers` 提到外层，`finally` 里兜底终止 |
| M5 | 用户点停止时 `runCommand` 返回"成功" | 改为返回 `{ stopped: true, exitCode: null, tail }` |

复测：`sleep 60` + cancel 仍能杀干净；2 MB / 20 万行输出正常结束。

## 五、打包交付

`bun run build:desktop`（electrobun / hutch）**在本机不可用**：
hutch 需要从 `github.com/oven-sh/bun/releases` 下载 25 MB 的 bun 1.4.0 工具链，
链接 302 到 `release-assets.githubusercontent.com`，该域在本机网络下不可达；
hutch 是原生二进制，不读取 `HTTPS_PROXY`（设了也报 `HttpConnectionClosing`），
手工放入 `~/.hutch/toolchains/` 的二进制它也不认（缺自己的安装清单）。

改用等价的手工重组，复用已安装 app 自带的同版本 bun 运行时（1.4.0）：

1. `ditto /Applications/toonflow.app → toonflow-exec.app`
2. 重新构建桌面主进程 bundle：`cd apps/server && bun build ../desktop/src/index.ts --target=bun --minify --external @silvia-odwyer/photon-node --external @firecrawl/anydoc --external @firecrawl/anydoc-wasm`（23.4 MB，替掉 `Resources/app/bun/index.js`）
3. 覆盖 `views/mainview`、`mcp`、`nodes`、`tools`、`ext`、`providers`、`skills`
4. `codesign --force --deep --sign -` 重新 ad-hoc 签名

验证：
- 新 app 启动正常，桌面服务监听 56505
- `POST /api/exec`（`echo packaged-ok; pwd`）在打包运行时返回 `exit code:0`
- 装到 `/Applications/toonflow-exec.app` 后读取 `/Applications/data`，节点列表 12 个含 `execNode`

产物：`/Applications/toonflow-exec.app`（156 MB），原 `toonflow.app` 未改动。

## 未覆盖

- 打包 app 内的画布 UI 未做人工点击验证（无法脚本驱动 WKWebView），只验证了服务端路由与节点注册；节点 UI 的端到端在 dev 浏览器环境验证过。
- 下游节点消费 `完整输出`/`stdout` 的连线未实测。
- Windows 分支只按审查建议实现，未在 Windows 上验证。
