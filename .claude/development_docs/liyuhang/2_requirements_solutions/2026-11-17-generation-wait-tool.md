# 需求方案：生成节点提供阻塞等待工具（替代 sleep 猜时长）

- 时间：2026-11-17 19:00
- 用户痛点：Agent 启动图片/视频生成后，用 bash sleep 猜时间，经常图片早已生成完还在等，浪费整轮时间。
- 用户选择：生成节点专用等待；失败/取消返回状态对象；不设超时；同时改工具描述与系统提示。

## 现状
- 生成类节点共用 `packages/nodeShared/src/useNodeGeneration.ts`：`status`（idle/running/succeeded/failed）+ `outputs`，已注册 `getGenerationStatus` / `cancelGeneration`。
- `generateImage` / 视频 / 音频工具的 description 只提示「用 getGenerationStatus 查询」，模型于是 sleep 轮询。
- 系统提示写着「没有实际等待或状态能力时，不承诺后台自动跟进」——能力缺口写在提示里。

## 方案
1. 新增纯逻辑 `packages/nodeShared/src/generationStatus.ts`：
   - `waitForGenerationStatus(status, signal)`：`status` 不是 running 立即返回；否则 `watch(status, { flush: "sync" })`，切到终态同一拍 resolve；`signal` abort 时以 `AbortError` reject，并清理 watch 与监听。
2. `useNodeGeneration` 注册 `waitForGeneration` 工具（无参数）：
   - `await waitForGenerationStatus(status, signal)` → 返回 `getStatus()`（status/error/outputs）。
   - 失败/取消不抛错，交给模型判断重试或换方案。
   - description 明确：启动生成后直接调用，不要 sleep/bash/反复 getGenerationStatus；中断会结束等待。
3. 三个生成节点的 `generate*` 描述改为「立即返回已开始，随后用 waitForGeneration 阻塞等待结束（不要 sleep 或轮询）」。
4. 系统提示「工具与真实结果」段更新：说明 waitForGeneration 能力，明确不要用 sleep 等待或轮询；没有等待能力时才退回原有保守表述。
5. `packages/nodeShared/tsconfig.json` 的 `types` 增加 `bun`（新测试文件需要）。

## 伪代码
```
waitForGenerationStatus(status, signal):
  if status != running: return
  promise:
    stop = watch(status, v => v == running ? : { stop(); resolve() }, sync)
    onAbort = () => { stop(); remove; reject(AbortError) }
    signal.aborted ? onAbort() : signal.on(abort, onAbort, once)
```

## 风险
- 工具长阻塞依赖 canvasCall 通道：停止/打断/节点删除/切画布必须能 abort 掉 canvasCall，否则 watch 悬挂。评审重点核验。
- 不设超时：若供应商任务永远不结束且没被取消，模型会一直挂在该工具里；用户明确选择不封顶，接受该风险。
- 同一节点重复/并发等待：都监听同一个 status ref，会一起放行，返回同一份终态，语义可接受。

## 验收
1. 启动图片生成 → Agent 调 waitForGeneration → 图片一完成立刻返回 succeeded + outputs，不再空等。
2. 生成失败/取消 → 返回 failed + error，不抛工具错误。
3. 等待中停止/打断/删除节点 → 工具以中断结束，节点不停在运行中。
4. 视频/音频节点同样生效。

## 评审意见

| 评审人 | 意见 | 结论 |
| --- | --- | --- |
| 子 agent 评审 | **P1-1**：三层 120s 硬超时（nodeScaffold `nodeTools.call`、web `useCanvasTools.call`、server `bridge/canvas.ts`）会让 waitForGeneration 最多等 2 分钟，视频/音频必然失败——核心需求不成立。**P1-2**：dev 运行时读 `data/nodes` 的副本可能未同步（桌面端读 Resources/app/nodes，本次已同步）。**P2**：cancelGeneration 描述仍引导轮询；旧 outputs 歧义；failed/cancelled 不可机器区分；系统提示能力声明过强且调用名应为 `node:waitForGeneration`；技能文档仍是旧口径；同批工具串行会阻塞后续启动；长等待期间 UI 显示“等待模型响应”；去超时后的兜底风险；测试缺清理/已中断/并发 | 采纳，见下方修订 |

## 实施修订（评审后）

1. **三层超时统一豁免**：在 `packages/toolScaffold/src/runtime.ts` 新增 `isLongRunningNodeTool` / `isLongRunningCanvasCall`（按 `nodeTools.args.name` 判断），nodeScaffold、web `useCanvasTools`、server `bridge/canvas.ts` 共用；`waitForGeneration` 不再套 120s 总时限，仍受本轮取消信号约束。
2. **取消可区分**：`getStatus()` 增加 `cancelled` 布尔（AbortError → failed+cancelled=true），工具描述说明。
3. **旧输出警告恢复**：`getGenerationStatus` / `waitForGeneration` 描述保留「outputs 可能来自上一次生成，只有 succeeded 表示本次成功」。
4. **cancelGeneration 描述**改为「随后用 waitForGeneration 等它真正结束」。
5. **系统提示**改为条件式：`getNodeTools` 返回 `node:waitForGeneration` 时先启动本轮所有独立生成再逐个等待；无能力时保持原保守语义。
6. **技能文档**：`v118workflow/references/canvasOperations.md`、`workflow/references/canvasExecution.md`、`workflow/SKILL.md` 更新为优先 waitForGeneration（同时保留无能力时的结束本轮口径）。
7. **测试**补已中断 signal、终态后 abort 不二次结算，共 6 例。
8. **未做**：服务端 `/api/agent/abort` 不向浏览器下发 `canvasCancel`（当前同页停止/打断都会 abort 本地流，等待能结束；跨窗口场景可能悬挂，记为已知风险）；技能已安装到用户数据目录的副本不会随源码更新（`initializeSkills` 无 revision）。
