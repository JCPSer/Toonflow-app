# Bug 方案：截帧空白 + 自动新增节点落在视口外

- 记录时间：2026-10-28 21:26
- 代码基线：`1e4a457`
- 关联分析：`bug_analysis-2026-10-28-21-26-frame-capture-and-node-reveal.md`

## 一、B1 方案：让解码元素参与渲染，并确认帧真的呈现了

三道改动的共同目标是「画之前先确认这一帧存在」，任何一道单独都不够：

```
captureFrame:
    frameVideo ← 新建 video
    holder     ← 离屏容器（fixed, left:-10000px, 2×2, overflow:hidden）
    holder.appendChild(frameVideo); body.appendChild(holder)   ← 整个截帧期间保持挂载
    await loadFrame(...)
    draw:
        重试 ≤3 次:
            clearRect → drawImage
            if 8×8 缩略采样 alpha 非全 0: 成功
            else 等下一帧呈现后重试
        仍为全透明 → 抛「视频帧解码失败，请重试」，不生成节点
    finally: holder.remove() → video 清 src
```

要点：

1. **必须挂进文档**：WKWebView 对脱离文档的 video 不保证有可绘制的呈现层，这是空白的主因。容器必须活到本次截帧画完，不能随 `loadFrame` 结束就摘掉——这正是初版容易踩的坑。
2. **seeked 之后还要等「呈现」**：优先用 `requestVideoFrameCallback`（Safari 15.4+ 有），老 WebKit 退回两次 `requestAnimationFrame`；两者都加 400ms 兜底，避免个别编码永远等不到回调而卡死 15 秒超时。
3. **空帧不提交**：用 8×8 缩略画布采样 alpha，全 0 即判定没画出来。重试 3 次仍空就明确报错——宁可让用户重试，也不要把一张透明 PNG 落成图片节点，那正是用户看到的「空白图片」。
4. 目标时间算法保持不变（首帧 0.05s、尾帧 `duration - 0.05`、当前帧取播放器 `currentTime`），它们本身没有问题。

## 二、B2 方案：新节点不在视口内时平滑移过去

在 `useCanvasTools.ts` 增加 `revealNode(nodeId)`，`addNode` 落盘后调用：

```
revealNode(id):
    node ← findNode(id); (dimensions | viewport) 缺失则直接返回
    可见矩形 ← 由 viewport(x, y, zoom) 与 dimensions 反算，四边留 32px 内边距
    if 节点完整落在可见矩形内: return
    setCenter(节点中心, { zoom: 当前缩放, duration: 240 })
```

- **不改节点坐标**：AI 是按上下游关系推算位置的，强行改坐标会打乱它的布局意图。
- **保持缩放**：只平移不缩放，用户的手感更连贯。
- **天然去抖**：同一批新增里，第一次平移后后续节点通常已落在视口内，不会连续甩镜头。
- 刚创建的节点尺寸可能还没测量（0×0），按点位居中即可；可见性判断因此偏保守（倾向判为不可见），不会漏移。

## 三、验证计划

1. web / videoNode 类型检查 0 新增错误。
2. 产物核对：三个节点包（videoNode、videoGenerationNode、frameAnalysisNode）都含 `requestVideoFrameCallback` 与「视频帧解码失败」；web 产物含 `setCenter` 调用链。
3. 手测：重启后在视频节点分别截首帧、当前帧、尾帧，都应得到有内容的图片；若仍失败应弹「视频帧解码失败，请重试」而不是空白节点。
4. 手测：让 AI 在远离当前视口的位置新增节点，画布应平滑移动到新节点；已在视口内的新增不应触发移动。

## 四、未覆盖

- 空帧重试仍失败时的兜底（例如改用播放器元素 seek 后还原进度、或服务端 ffmpeg 抽帧）没有实现，先看新链路的实际效果。
- 其他自动新增节点（逐帧拉片、全景、局部重绘、截帧堆叠）暂未接入 `revealNode`。

## 五、评审意见

- 子 agent 评审：
- 用户评审：

## 六、评审后修正（21:45）

子 agent 审查逐条核对 Vue Flow 1.48.2 与 WebKit 行为后，改了这些：

1. **尺寸测量**：`addNode` 之后仅 `nextTick` 拿不到节点尺寸（Vue Flow 的 ResizeObserver 回调还要再等一个 `nextTick`），`revealNode` 的可见性判断会退化成「左上角点是否在视口内」，居中也会对到左上角。改为抽出共享助手 `revealNodeInViewport()`（`packages/nodeScaffold/src/nodeViewport.ts`），内部先 `updateNodeInternals([id])` + `nextTick`，仍量不到时按 240×180 估算中心。
2. **批量平移**：逐次 `setCenter` 会互相打断，而且第二次判断读到的是上一段动画中途的 viewport。`useCanvasTools` 改为攒 320ms，只按最后一个新节点平移一次。
3. **rvfc 注册时机**：`seeked` 之后再注册 `requestVideoFrameCallback`，暂停元素上几乎永远不会触发，只剩 400ms 超时兜底，「确认已呈现」名存实亡。改为在设置 `currentTime` **之前**注册，并按 `metadata.mediaTime` 过滤掉解析阶段的旧帧，不符就继续等下一帧；之后再加两帧 rAF 确保已合成。
4. **重试不会产生新帧**：空帧重试原来只是等 400ms 再画同一帧。新增 `nudgeFrame()`，把时间戳挪 40ms 再 seek 一次，逼解码器重新出帧。
5. **内边距单位**：32/40 是屏幕像素，要除以 zoom 换算回画布坐标，否则放大时留白被放大、缩小时几乎贴边。
6. **rvfc 句柄**：settle 时调用 `cancelVideoFrameCallback`，避免每轮截帧遗留回调。

同时把「自动新增节点」的跟随范围从 AI 建节点扩大到所有节点内自动生成的节点：截帧（videoPlayer）、音轨/片段（videoActions）、图片变体、全景宫格、图片标记、音频派生。
