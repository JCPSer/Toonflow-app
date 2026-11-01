# Agent 可编程开启/使用「首帧 / 尾帧」输出

- 时间：2026-10-31 23:01
- 涉及文件：`packages/nodes/videoNode/src/frameOutputTool.ts`（新增）、`frameOutputTool.test.ts`（新增）、`frameOutput.ts`、`videoNode/src/index.vue`、`videoGenerationNode/src/index.vue`

## STAR

**Situation**
首/尾帧输出项只能由用户点节点菜单开启，节点没注册任何 `nodeTools`，Agent 既开不了也不知道存在这个能力。用户要求「不能让用户来，Agent 全自动去用」。

**Task**
给两个视频节点加 Agent 可调用的 `setFrameOutputs({first?,last?})`：同步抽帧、返回端口与路径，开关与手动菜单共用同一套状态机，不改画布协议与宿主。

**Action**
1. `toggle` 拆成可编程核心 `apply(key,on,signal)`（抛错、不弹 UI）+ UI 壳 `toggle`（保留原提示），新增 `state(key)`。
2. 新模块 `frameOutputTool.ts`：纯工厂 + 桩对象可测；未传项返回当前状态，单项失败不抛整体错误；`pendingReason` 区分 `no-video/extracting/idle`，并透出每路 `error`。
3. 抽帧并发加固（3 轮审查驱动）：
   - 每路独立 `controller` + `epochs`，开关 A 不再取消 B；
   - 整轮 `round` + `JobTicket{round,epochs,explicitSource}`，排队中的旧 job 不会拿旧视频回填；
   - `queuedRounds` 让「排队未启动」不被误判成闲置重试；
   - 关闭请求遇到在途开启时不再早退，强制 abort，实现「最后一次为准」；
   - 写回改为重新读 `config.value`，避免覆盖另一路开关；
   - `remove(target)` 前二次校验代次；外部取消优先于 superseded 文案。

**Result**
- 按 `AGENTS.md` 不新增测试文件；既有 18 例回归通过，两个节点包 typecheck 0 错误；两包构建通过，`setFrameOutputs` 已进 UMD。
- `scripts/deploy-local.sh` 已同步节点包（未重启），6 处 md5 一致。
- 真机 Agent 自主发现/调用与并发边界待用户重启后验证。

## 教训

- 节点能力 = `nodeTools` 才是 Agent 的发现面；只做 UI 菜单等于 Agent 不可见。工具描述要写「何时用」而不只是「是什么」。
- 同一 composable 既服务 UI 又服务工具时，先拆出「抛错的核心 + 负责提示的壳」，否则工具永远拿不到失败原因。
- 「全局 epoch/controller」在单入口时成立，多入口（UI + Agent 并发）就会变成跨路取消；按 key 隔离才是正确粒度。
- 排队任务必须在入队时快照意图（round/epochs），否则 clear() 只能取消正在跑的，取消不了还在队列里的。
- 仓库 `AGENTS.md` 禁止新增 `.test.ts`；实现期先写了再删是浪费，动手前先看测试边界，验证用 typecheck/构建/手动链路。

## 关联

- 需求/方案/测试：`1_requirements_matrix/2026-10-31-22-30-agent-frame-outputs.md`、`2_requirements_solutions/2026-10-31-22-30-agent-frame-outputs.md`、`3_test_results/2026-10-31-23-01-agent-frame-outputs.md`。
- 前置功能：`5_memory/2026-10-31-10-15-video-frame-outputs.md`（首/尾帧输出端口本体）。
