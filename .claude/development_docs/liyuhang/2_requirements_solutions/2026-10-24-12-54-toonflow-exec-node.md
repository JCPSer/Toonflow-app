# 方案设计：Toonflow「运行指令」节点

## 背景

见需求矩阵 `2026-10-24-12-54-toonflow-exec-node.md`。

## 总体结构

```
画布节点 execNode (WebView)
   │  fetch POST /api/exec  (SSE, x-toonflow-workspace: 1)
   ▼
apps/server  routes/exec/index.ts
   │  Bun.spawn([shell, "-lc", command], { cwd, detached })
   ▼
本地 shell → 子进程树
   │  stdout / stderr 流 → SSE 事件
   ▼
节点输出面板 / 节点值 / 下游
```

## R1 服务端路由

路径 `POST /api/exec`，独立 router 文件，在 `apps/server/src/router.ts` 注册。

请求体（zod strict）：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| directory | string 1..4096 | 工作区绝对路径，经 `u.workspace.resolveWorkspace` 校验 |
| command | string 1..20000 | 要执行的命令全文 |
| cwd | string ≤4096，可选 | 工作区相对子目录，缺省为工作区根 |
| timeoutMs | int 0..3600000，可选 | 0 表示不限时，缺省 600000 |

前置校验：`u.mcpControl.assertAppRequest(req)` + `u.workspace.isLocalWorkspaceRequest(req)`，
后者已覆盖 `x-toonflow-workspace`、本机地址、同源、非 MobileLink 四项。

响应：`text/event-stream`，每条 `data: <json>\n\n`

| 事件 | 字段 |
| --- | --- |
| start | pid, cmd, cwd, shell |
| stdout | data |
| stderr | data |
| exit | code, signal, durationMs, timedOut, killed |

心跳 `: keepalive\n\n` 每 5 秒。`res` close / `req` aborted / socket close 任一触发即终止进程组。

## R2 进程管理

- shell 取 `process.env.SHELL || "/bin/sh"`，以 `-lc` 执行，保证用户 PATH 与别名可用。
- `Bun.spawn` 使用 `detached: true` 使子进程成为进程组组长，终止时 `process.kill(-pid, "SIGKILL")`，
  避免 `sh -c "python x.py"` 只杀掉 sh 而留下 python。若运行时不支持 detached，退化为 `child.kill("SIGKILL")` 并记录差异。
- 输出用 `stream()` 增量读，按块转发；300ms 内的碎块合并，减少事件数量。
- 超时由独立 `setTimeout` 触发，先 SIGTERM，5 秒未退则 SIGKILL，事件里标记 `timedOut: true`。
- 全局并发上限 8，超出返回 429，防止误开一堆命令把机器打满。

## R3/R4 节点

`src/exec/index.vue`，UMD 产物 `execNode.umd.js`。

- handles：`in`（target，`*`，触发）、`text`（source，STRING，完整输出含退出码）、`stdout`（source，STRING，纯 stdout）
- 工作区目录通过 `files.getWorkspaceFiles().list()` 的返回 `directory` 取得（绝对路径）
- UI 自上而下：命令多行输入（等宽字体）→ 运行/停止/清空 → 状态行（退出码、耗时、行数）→ 输出面板（等宽、自动滚底、stderr 用红色区分）
- 停止 = abort fetch，服务端连接断开即杀进程组
- 输出面板最多保留 20000 行，超出丢弃最早的，避免长命令把 DOM 撑死

## R5 持久化

`node.data = { command, cwd, timeoutMs, last: { code, durationMs, at } }`。
命令输入防抖 400ms 写入；运行结果只记录摘要，不存完整输出（避免画布 JSON 膨胀）。

## R6 Agent 接口

- `node:runCommand({ command?, cwd?, timeoutMs? })`：命令缺省用节点里已有的；最多等 90s，未完成返回 `{ running: true }`
- `node:getExecStatus()`：返回 `running / exitCode / durationMs / tail`（尾部 200 行）

## R7 构建

`bun run build:nodes` → `build:web` → `build:server` → `bun run build:desktop` → `package:desktop`。
节点产物另外同步到 `data/nodes`，打包不会带上自定义节点（保持与官方节点隔离）。

## 风险与取舍

- **执行面暴露**：路由只接受本机同源请求，但同机任何浏览器页面在关闭同源检查后仍可能命中；
  用户明确选择不做白名单，此处如实记录，不再加限制。
- **打包耗时**：electrobun 首次构建需要复制 web 产物与 bun 二进制，耗时可能 10 分钟以上。
- **未签名产物**：本地构建 `codesign: 0`，替换已安装 app 后首次启动可能被 Gatekeeper 拦一次。

## 评审意见

> 待用户填写

## 评审结论

> 待定
