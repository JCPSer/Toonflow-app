# 记忆：submitProvider 中止原因透传 + Agent 运行日志 + 客户端工具硬超时

## Situation

内置「AI 生成媒体供应商」对话里的 `submitProvider` 100% 返回「工具调用已取消」，7 次尝试（40 KB→500 字节）全失败，前端拿不到任何原因。服务端这一路径此前没有任何可追查记录，错误文案又是硬编码的，用户和模型都无法判断是断网、点了停止、还是对话框被关掉。

排查中确认两件事：一是这条链路（全仓库唯一的客户端工具）在隔离实例里跑得通，说明不是结构性缺陷；二是 Bun 1.3.11 的 node:http 兼容层**根本不上报客户端断开**，`run.ts` 的三条断连监听全是死代码。

## Task

在不猜测根因的前提下：把中止的真实原因透传给工具结果与日志，让下一次实机复现能一次定性；同时补上「前端丢失回传」时的兜底，避免整轮永久悬挂。

## Action

- 新增 `apps/server/src/lib/agentLog.ts`：写 `<data>/logs/agent.log`，2 MB 轮转一份，单值截断 300 字，Promise 串行追加，全部 best-effort（写失败吞异常）。
- `singleAgent/index.ts`
  - 新增 `abortDetail` / `clientToolAbortError`：从 `signal.reason` 取真实原因，产出「工具调用被中止：<原因>」，并带 `code: "TOOL_ABORTED"`。
  - `createClientTool` 的 abort 监听改用上面的构造函数；派发/回填都落日志；加 600 s 硬超时（文案由常量派生）。
  - `run()`：外部信号 reason 缺失时补「对话连接已关闭」；记录 `run.start` / `run.abort` / `run.failed` / `run.end`；工具包装里监听 SDK 运行信号，**仅当整轮控制器未中止时**记 `run.signal.abort`（B3 判据）。
  - `control()` 记 `control` 日志（stop/close 是前端唯一能中止整轮的入口）；`close()` 记 `session.close`，并把「先 finish 挂起调用、再 abort」的顺序调正，避免通用中止原因抢走「临时对话已关闭」。
- `routes/singleAgent/run.ts`：三条断连监听各自带 reason（对话连接已关闭 / 请求已中断 / 网络连接已断开），只加原因不改中止时机。
- `agent/runtime/requests.ts`：模型请求看门狗触发时记 `model.request.timeout`（phase/seconds/visible），用来对齐用户看到的「提示超时」。

## Result

`tsc` 退出码 0；隔离实例验证：正常路径仍成功、`control(close)` 后工具结果变成「临时对话已关闭」、`control(stop)` 变成「工具调用被中止：本次回复已停止」、不回传时按超时中止；日志按预期落盘。桌面入口重新打包（23,545,282 B）并部署到 `/Applications/toonflow-exec.app/Contents/Resources/app/bun/index.js`，旧包备份在 `/tmp/toonflow-app-bun-index-20261027-1204.bak`。**根因待用户重启后复现一次，用 `logs/agent.log` 定性（本轮只解决「查不到」和「会悬挂」）。**
