# STAR：Toonflow 运行指令节点

## Situation

Toonflow 画布节点只能使用宿主开放的 files / ffmpeg / asr / ai 四类能力，
138 条服务端路由里没有任何执行系统命令的入口。用户持有 app 源码（自有 fork），
同意改源码补一条执行路由，并打包成未签名 app 自行测试。

## Task

在画布上提供「运行指令」节点：手填命令 → 运行 → 实时看 stdout/stderr → 结果作为文本输出给下游。
要求任意命令、实时流式、不做上游注入。

## Action

1. 先枚举全部 138 条路由和全仓 5 处进程启动点，确认「缺路由」而不是「缺鉴权」，再决定改源码。
2. 服务端新增 `POST /api/exec`（SSE）与 `POST /api/exec/cancel`；进程用 detached 进程组，终止发负 pid 信号。
3. 真机跑通后才发现：Bun 在客户端断开时**三个 close 监听一个都不触发**，命令会变成不可杀的孤儿。
   这与仓库 ffmpeg 路由顶部那句注释同源，于是补了显式取消接口，abort 只作兜底。
4. 子 agent 审查出 7 条（输出无上限、节点行截断 O(n)、cancel 竞态、Windows 链路、reader 不 settle 等），全部修复。
5. 打包被 hutch 的 bun 工具链下载卡死，改为手工重组 .app，复用已装 app 自带的同版本运行时。

## Result

画布上可跑任意命令，输出按秒到达，退出码与耗时正确，「停止」能杀干净进程组。
产物 `/Applications/toonflow-exec.app`（156 MB），服务端路由在打包运行时验证通过。
未覆盖：打包 app 内的画布点击、下游连线消费、Windows 实测。
