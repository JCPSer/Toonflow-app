# 手动压缩撞上 WKWebView 60 秒空闲超时

- 时间：2026-10-31 11:58
- 涉及文件：`apps/server/src/routes/agent/compact.ts`

## STAR

**Situation**
用户在 agent 面板点「立即压缩」，等约一分钟后弹「压缩上下文失败」，没有其他文案；会话文件没有任何写入，也没有新的 compaction 条目。

**Task**
先判断是服务端压缩失败还是客户端没收到结果，再让大历史的压缩能真正走完。

**Action**
1. 用用户真实会话的**拷贝**在隔离实例（独立数据目录）上压缩：三份都 HTTP 200（48.6/69.8/61.7 s）。
2. 再把这些拷贝放到**用户正在运行的应用服务**（127.0.0.1:51766，必须带 `Origin` 头才被认作本机请求）上压：HTTP 200，66.6 s，响应 4.36 MB。→ 服务端没问题。
3. 请用户复现一次，同时每 2 秒采样会话文件：文件 mtime 与 compaction 条数都不变，且弹错时间约一分钟。→ 客户端在 ~60 秒放弃连接，服务端 `res.once("close")` → `abortCompaction`，摘要作废。
4. 对上根因：`URLSessionConfiguration.timeoutIntervalForRequest` 默认 60 秒，WKWebView 继承；WebKit 还把异步 XHR 超时夹到 60 秒上限。「一次请求里阻塞 60-70 秒、期间零字节」正好被掐断。
5. 修复只改一条路由：await 之前先 `res.write(" ")`（JSON 允许前导空白），之后每 10 秒补一个空白，用数据流动重置空闲计时；失败用 `errorFromCause` 组装响应体（首字节已发出，状态码固定 200，前端本来就按 `code` 判成败）。

**Result**
流式复测：响应头 17 ms、首字节 18 ms、心跳每 10 s、73.8 s 时拿到 3.25 MB 响应且 `JSON.parse` 成功（code 200，382 条消息）。typecheck 通过，桌面入口重新打包（+220 B）并安装，未重启应用。

## 教训

- 「等一分钟才弹错」几乎等于 60 秒网络超时，而不是业务错误——因为业务错误都是秒回。
- 定位顺序应当是**先确认服务端有没有留下副作用**（文件 mtime / 数据库 / 日志），比反复猜错误码快得多。
- 前端兜底文案会把真实原因吃掉：只要响应体没有 `message`（连接层异常、空响应、非 JSON）就显示同一句话。以后新增的长请求接口，要么带心跳，要么按 `error.code` 再兜一层。

## 关联

- 同一约束在桌面对话框上已踩过一次：`5_memory/2026-10-31-10-55-desktop-dialog-focus.md`（那里用「两段式 start/poll」绕开）。
- 分析/方案/测试：`4_bugs_fix/bug_analysis-2026-10-31-11-58-compact-60s-timeout.md`、`4_bugs_fix/bug_solution-2026-10-31-11-58-compact-60s-timeout.md`、`3_test_results/2026-10-31-11-58-compact-60s-timeout.md`。
