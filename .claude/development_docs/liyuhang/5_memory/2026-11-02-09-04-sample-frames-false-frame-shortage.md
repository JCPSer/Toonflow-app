# 记忆：sampleFrames 误报「帧数不足」

- 时间：2026-11-02 09:04
- 类型：Bug 修复

## STAR

**Situation（背景）**
用户在视频节点上让 Agent 看视频，`sampleFrames`（宫格）报 `抽帧失败：未生成文件（视频时长或可用帧数不足）`；同一节点的 `captureFrame` 能出单帧。产物目录 `assets/<nodeId>/inspect/` 里只有 `frame-*.jpg`，没有 `contact-*.jpg`。

**Task（任务）**
查清是视频真的帧数不足，还是工具链路的问题，并修掉。

**Action（行动）**
- 反证「帧数不足」：把用户工程里那条 1920×2560 / 24fps / 10.125s 的视频，用应用自带的 ffmpeg 6.0 跑 4/9/16 三档宫格命令，全部正常出图。
- 读码定位：`inspectVideo.ts` 的 `clearOutputs` 清理规则是「同类产物 ∪ 所有 `*.tmp.jpg`」，而 `sample()` 在 ffmpeg 成功**之后**才清理旧宫格，于是把本次刚写好的 `.contact-9.<uuid>.tmp.jpg` 一并删掉；随后 `settleOutput` 查目录找不到文件，抛出「未生成文件（视频时长或可用帧数不足）」。
- 单帧偶发成功的原因：单帧 ffmpeg 很快，清理时的目录列表可能还没看到临时文件；宫格要解码整段，列表稳定可见，必删。
- 修复：`inspectPlan.ts` 新增纯函数 `isStaleOutput(name, pattern, keep?)`；`clearOutputs` 支持 `keep` 排除本次临时文件；`temporaryExists` 用「列表 + 读文件兜底」判断新图是否落地。
- 复审 P1 整改：初版仍是「先清理后结算」，新图失败时上一轮宫格已被删。改为先 `settleOutput`（确认新图存在 → 删旧 target → 改名），成功后再 `clearOutputs(pattern, keep = target)`。
- 补 8 组单测（含「失败不删旧产物」「列表滞后不误报」）；重建并部署 `videoNode.umd.js`、`videoGenerationNode.umd.js` 到 `/Applications/toonflow-data/nodes/`。

**Result（结果）**
`inspectPlan` + `inspectVideo` 单测 31 pass；node-video 类型检查与两个节点包构建通过；部署 md5 `5917bd33…` / `e6ff1106…`，未重启应用。

## 关键经验

1. 「未生成文件」类错误先怀疑自己的清理/改名逻辑，再怀疑编码：临时文件命名如果和「残留回收」规则共用后缀，很容易误伤自己。
2. 用「写入后立刻清理」的顺序时，必须把本次写入的文件从清理集合里排除。
3. 判断文件是否存在不要只信目录列表（可能滞后）；改名成功本身就是存在性证据。
4. 两个节点包共用同一份查看代码时，重建必须两个都做。
