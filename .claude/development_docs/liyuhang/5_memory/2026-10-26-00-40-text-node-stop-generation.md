# 文本节点生成中可打断（STAR）

## Situation

文本节点点「生成」后按钮变成转圈 loading 并禁用，整段生成期间没有任何停止入口。长文生成几十秒到几分钟，写错提示词只能等它跑完。用户要求：生成中把转圈变成可点击的停止按钮，真正中断上游，已生成部分保留可编辑。

调研发现：`textNode` 调 `ai.generate` 时根本没传 signal；后端 `/api/ai/generate` 只在连接关闭时 abort 上游，而源码注释自己写着 Bun 的静默 SSE 可能不通知关闭——单靠断连达不到"真中断"。

## Task

1. 生成中按钮变停止，点击立即停，Esc 也能停。
2. 停止后保留已生成文字，可继续编辑/保存。
3. 上游请求真的被中断（不止前端不显示）。
4. 只补文本节点，Agent 面板保持原样。

## Action

**双通道停止**：

- 前端：每次生成 new AbortController + `crypto.randomUUID()` 作 runId，`ai.generate({ signal, runId })`；点停止先 `controller.abort()` 立刻停渲染，再 fire-and-forget 调 `notifyGenerateStop(runId)`。
- 后端：新增 `utils/ai/runs.ts` 注册表（`Map<runId, Set<controller>>` + 60s 墓碑，经 `utils.ts` 暴露成 `u.aiRuns`），`/api/ai/generate` 在任何 await 之前登记、外层 finally 回收；新增 `POST /api/ai/generate/stop`（`assertAppRequest` + `z.uuid()`），按 runId 直接 abort，不依赖 socket 关闭。

**交互细节**：

- 按钮去掉 Element Plus 的 `:loading`（它会加原生 disabled，停止按钮点不动），改图标切换 + 分支 disabled，生成中恒可点。
- 底栏原来由 `bottomVisible && slotsVisible` 控制，多选/拖动时会被脚手架整体卸载；给 `nodeSkeleton` 加 `bottomPinned` prop，生成期间钉住底栏。
- Esc 两级：promptCard 上的 `@keydown.esc` 管焦点在输入区；window 兜底只在「本画布前台（`canvasActive` 注入）+ 本节点唯一选中 + 非输入法组词 + 未 defaultPrevented」时响应。

**停止后的语义**：`result.text` 只在未 abort 时写入；finally 保存的是停止瞬间累计的文本；用户主动停止不弹错（`stopRequested` 标志）；节点卸载/切画布这类隐式中断在 finally 里补发一次 stop，避免上游继续跑。

## Result

- 三端类型检查通过，web 与桌面主进程产物重建，app 已同步重签（备份 `/tmp/toonflow-exec-old20.app`）。
- 服务端实测（隔离实例 + mock SSE）：stop 后流立即结束、无 error 事件、mock 上游收到 client aborted、日志 `run abort → stop hit → stream ended by abort`；墓碑竞态也能立刻中止；缺 header 403、非法 id 400。
- 界面链路（点按钮/Esc）因 dev 数据目录只有 fake-model，未能在画布内发起真实长文生成，需在有真实模型的机器上手工复验。

## 补充（01:05）：节点产物需要单独构建

上轮只重建了 web 与桌面主进程，`build/nodes/textNode.umd.js` 仍是旧的，界面上自然还是转圈。节点是 **独立的 UMD 产物**（`bun run build:nodes`），`nodeSkeleton`/`nodeAi` 等脚手架代码被打进每个节点包，所以改节点或脚手架后必须：

1. `bun run build:nodes`
2. 同步 `build/nodes` 到 `Contents/Resources/app/nodes`
3. 重新 `codesign`
4. 重启 app（webview 才会重新拉取节点文件）

校验方式：`grep "停止生成" build/nodes/textNode.umd.js`，旧产物为 0。

## 经验

- "断开连接等于停止上游"是错误假设：运行时可能根本不通知 close（本仓库 Bun 1.3.14 实测如此）。要保证中断，必须有服务端可寻址的 stop。
- 受控组件里 `:loading` 不是视觉状态，它会 disable 按钮——把"停止"做成 loading 按钮等于做不了停止。
- 判断 Esc 归属不能只看"节点是否选中"：后台画布仍然保留选中态且不卸载，必须引入"当前画布是否前台"的作用域。
- 共享脚手架里的可见性条件（bottomVisible/slotsVisible）会互相抵消，给一个"钉住"开关比在业务组件里绕过条件更安全。
- 这个仓库有三条独立的构建产物：web、桌面主进程、节点/工具/扩展的 UMD。改节点或 nodeScaffold 只重建前两个，界面上等于没改。验收前先按特征字符串确认产物里真的有新代码。
