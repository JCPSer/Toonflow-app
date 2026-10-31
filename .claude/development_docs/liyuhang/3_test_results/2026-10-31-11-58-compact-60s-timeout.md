# 测试结果：手动压缩被 60 秒空闲超时掐断

- 时间：2026-10-31 11:58
- 对应分析：`4_bugs_fix/bug_analysis-2026-10-31-11-58-compact-60s-timeout.md`
- 对应方案：`4_bugs_fix/bug_solution-2026-10-31-11-58-compact-60s-timeout.md`
- 环境：macOS 14.6 arm64 / Bun 1.3.11 / 安装版 `/Applications/toonflow-exec.app`（服务在 127.0.0.1:51766）

## 1. 定位过程（定位阶段，未改代码）

| 步骤 | 做法 | 结果 |
| --- | --- | --- |
| 1 | 隔离实例（端口 4011、独立 `TOONFLOW_DATA_DIR`、复用同一份 settings/providers）压缩三份 8 MB 真实会话拷贝 | 全部 HTTP 200：48.6 s / 69.8 s / 61.7 s |
| 2 | 在**用户正在运行的应用服务**（127.0.0.1:51766，带 `Origin` 头才被认作本机请求）上压缩同一份会话拷贝 | HTTP 200，66.6 s，响应 4.36 MB |
| 3 | 请用户点一次「立即压缩」，同时每 2 秒采样会话文件 mtime 与 compaction 条数 | 一分钟左右弹错，**文件 mtime 与 compaction 条数都没变** |
| 4 | 计算真实上下文 | 147,445 tokens / 512,000（28.8%），不是超长上下文 |
| 5 | 查失败文案来源 | 「压缩上下文失败」是 `conversation.vue` 的兜底串，只在响应体没有 `message` 时出现；服务端每条业务失败都有具体文案 |

结论：服务端能压缩、能落盘；用户侧是**客户端在 ~60 秒时放弃连接**（服务端 `res.once("close")` → `abortCompaction` → 摘要作废，所以什么都没写）。

## 2. 复测（修复后，隔离实例，流式客户端逐 chunk 计时）

| 指标 | 结果 |
| --- | --- |
| 响应头 | 17 ms |
| 首个心跳字节 | 18 ms |
| 心跳间隔 | 10002 / 10001 / 10002 / 10000 / 10003 / 10000 / 10003 ms（共 7 个） |
| 摘要结果到达 | 73.8 s（已越过 60 s） |
| 响应体 | 3,248,063 B，`JSON.parse` 成功（前导空白不影响） |
| 解析结果 | `code 200`、`messages 382`、`message "Success"` |

即：跨过 60 秒仍能正常收完并解析。

## 2.1 在真实渲染引擎里复核（WKWebView 探针，改代码前就先做过）

用一段独立的 WKWebView 探针程序（`wkwebview-timeout-test`，加载本机 3998 端口的测试页）实测两种响应：

| 服务端行为 | 探针结果 |
| --- | --- |
| 60 秒内零字节，之后才返回 | `xhr timeout 61009ms`；`fetch error "Load failed" 61010ms` |
| 首字节立即发、之后每 5 秒一个空白，85 秒后才结束 | 每 5 秒一次 `progress`，**85018 ms 时 `load` 成功**，响应体 `{"ok":true,"seconds":85}` |

结论：WebKit 的 60 秒限制是**空闲**超时，只要数据在流动就会被重置——心跳方案成立，这不是推断。

## 3. 静态检查与构建

| 项 | 结果 |
| --- | --- |
| `bun run --cwd apps/server typecheck` | 通过 |
| `bun scripts/bundle-desktop.ts` | 通过，`build/desktop/main/index.js` 23,620,397 B（原 23,620,177 B，+220 B） |
| 产物核对 | 含 `setInterval(Q,1e4)` 心跳；`/api/connection` 仍在（桌面网关未丢） |

## 4. 部署

- 备份：`/tmp/toonflow-app-bun-index-20261031-1158.bak`（23,620,177 B）
- 安装：`build/desktop/main/index.js` → `/Applications/toonflow-exec.app/Contents/Resources/app/bun/index.js`，md5 逐字节一致
- **未重启应用**；节点包与 web 视图本就没改，未再同步

## 5. 待人工复验

1. 重启应用后在 agent 面板点「立即压缩」，应等待 60-70 秒后提示「上下文已压缩」。
2. 压缩期间界面会一直显示「正在压缩上下文…」，属预期（心跳不改变前端表现）。
3. 压缩失败时仍应看到具体原因（例如「当前对话没有可压缩的内容」），不再是六个字的兜底文案。
