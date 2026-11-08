# Bug 修复方案：sampleFrames 误报「帧数不足」

- 时间：2026-11-02 09:04
- 对应分析：`bug_analysis-2026-11-02-09-04-sample-frames-false-frame-shortage.md`
- 状态：已实施并部署节点包

## 1. 目标

清理旧产物时排除本次正在写的临时文件；结算不再只凭目录列表判断文件是否存在。

## 2. 方案概览

```
settleOutput(temp, target):
   if not temporaryExists(temp):        # 列表 → 读文件兜底
       throw「未生成文件（视频时长或可用帧数不足）」   # 不动 target
   remove(target)
   rename(temp, target)                 # 失败原样抛

clearOutputs(directory, pattern, keep = 刚落地的 target)
   for entry in list(directory):
       if not isStaleOutput(entry.name, pattern, keepName): continue
       remove(entry)
```

## 3. 关键设计

- `isStaleOutput(name, pattern, keep)` 抽到 `inspectPlan.ts`（纯函数，可单测）：命中同类产物或 `.tmp.jpg` 规则、且不是 `keep` 时才算残留。
- **先结算、后清理**：`settleOutput` 确认新图落地并改名成功后，才用 `clearOutputs(pattern, keep = target)` 清同类旧产物。初版顺序相反，`clearOutputs` 会先删掉上一轮可用的宫格，新图失败时旧图也没了（评审 P1）。
- `temporaryExists` 先查目录列表，列表没命中再读一次文件兜底；列表请求本身失败时不据此判失败，交给改名结果定夺。
- 单元测试：`isStaleOutput` 3 组 + `clearOutputs`/`settleOutput` 5 组（含「失败不能删旧产物」「列表滞后不误报」）。

## 4. 评审意见

| 级别 | 意见 | 处理 |
| --- | --- | --- |
| P1 | 清理在结算之前：`clearOutputs` 会先删掉上一轮可用宫格（pattern 命中 target），新图失败时旧图也没了，违反验收标准 4 | 已修：改成「先 settle 后 clear」，`keep` 传刚落地的 target |
| P2 | 用列表判断存在性仍可能被缓存/滞后影响 | 已加读文件兜底；列表请求失败时不判失败 |
| P2 | `keep` 用文件名比较，理论上同名冲突 | 临时名带 UUID；`baseName` 同时处理 `/` 与 `\\` |
| P2 | 只重建了 videoNode，生成视频节点共用同一份代码 | 已同时重建并部署 videoGenerationNode |
| P2 | 关键接线无测试，只有纯函数有 | 已补 `clearOutputs`/`settleOutput` 5 组用例（假 WorkspaceFiles） |
| P2 | 注释与实现不一致 | 已改：改名成功即证明落盘，列表只用于失败归类 |

## 5. 改动清单

| 文件 | 改动 |
| --- | --- |
| `packages/nodes/videoNode/src/inspectPlan.ts` | 新增 `isStaleOutput` |
| `packages/nodes/videoNode/src/inspectVideo.ts` | `clearOutputs` 支持 `keep`；`settleOutput` 以改名为准 |
| `packages/nodes/videoNode/src/inspectPlan.test.ts` | 新增 3 组回归用例 |

## 6. 风险与兼容

| 风险 | 说明 | 处理 |
| --- | --- | --- |
| 旧宫格没被清掉 | 只排除本次临时文件，旧宫格仍按 pattern 清理 | 已覆盖 |
| 失败时删掉旧宫格 | 清理仍在 ffmpeg 成功之后执行 | 保持原行为 |
