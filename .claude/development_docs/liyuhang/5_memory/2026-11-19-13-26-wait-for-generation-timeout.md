# 记忆：waitForGeneration 超时豁免修复（STAR）

- 时间：2026-11-19 13:26

## Situation

Agent 用 `node:waitForGeneration` 等待视频/音频生成时，超过 120 秒必报「画布调用超时，请确认画布仍然打开」，长任务不可用。

## Task

让长任务豁免真正生效，同时保留普通节点函数的 120 秒兜底。

## Action

- 根因：节点函数注册名带 `node:` 前缀（`nodeScaffold/nodeTools.ts`），而 `toolScaffold/runtime.ts` 的 `LONG_RUNNING_NODE_TOOLS` 存的是裸名 `waitForGeneration`，服务端画布桥与画布执行层都命中不到豁免。
- 修复：`isLongRunningNodeTool` 先 `replace(/^node:/, "")` 再比对；服务端 `isLongRunningCanvasCall` 与 `nodeTools.call` 自动受益。
- 测试：新增 `apps/server/src/agent/canvasLongRunningCall.test.ts` 3 例（带/不带前缀、其它函数、非 nodeTools 操作）。

## Result

- 服务端 181 测试通过。
- 重新构建节点 UMD（toolScaffold 被打进每个节点）、web、桌面入口；已同步 `Resources/app` 与 `/Applications/toonflow-data/nodes`，备份 20261119-132536。
- 需用户重启应用后验证：启动视频生成并 waitForGeneration 超过 2 分钟不再超时。

## 教训

跨层共享的豁免/白名单要和实际注册名保持同一命名规则；带前缀与裸名混用，测试要同时覆盖两种形态。
