# Bug 方案：画布视频节点暂停后画面变黑

- 时间：2026-11-03 13:31
- 对应分析：`bug_analysis-2026-11-03-13-31-video-pause-black.md`
- 用户选型：A 暂停帧画布覆盖

## 1. 目标

播放中点暂停后，画面区必须停在当前帧；继续播放、拖进度条、切 src、进出全屏、闲置释放等路径下，覆盖层不能残留、也不能挡住播放中的画面。

## 2. 方案设计

### 2.1 结构

```
.videoPlayer
├─ .videoStage（position: relative，v-if=hasSource）
│  ├─ <video class=videoPreview>          // 原样，负责播放/音频/截帧
│  └─ <canvas class=pausedFrame v-show>   // 新增，绝对定位盖住画面区
├─ .posterStage（无 src 时的海报态）
└─ .playerControls（原样）
```

`canvas` 用 `v-show` 而不是 `v-if`：暂停事件里要同步拿得到画布，不能等一次挂载。

### 2.2 绘制

```
recordPausedFrame():
    源就绪（readyState≥2 且有 videoWidth/Height）？否→返回
    盒 = video.getBoundingClientRect()
    画布位图 = round(盒宽 × DPR) × round(盒高 × DPR)（变化时才改尺寸）
    isBlankFrame(video) 为真 → 不覆盖（留原生层，不盖黑底）
    scale = min(画布宽/视频宽, 画布高/视频高)     // object-fit: contain 口径
    drawImage(video, 居中留白, 视频宽×scale, 视频高×scale)
    显示覆盖层
```

要点：
- 只按**元素显示尺寸 × DPR** 绘制，不按 1920×2560 的固有分辨率——同屏十几个节点会到几十 MB。
- 绘制用 `contain` 居中，与 `.videoPreview { object-fit: contain; max-height: 240px }` 的显示口径一致。

### 2.3 状态机

| 事件 | 动作 |
| --- | --- |
| `pause` | `playing=false`；**同步**画并显示（此时解码器仍持有最后一帧） |
| `ended` | 同上（结束不一定触发 `pause`） |
| `play` | `playing=true`；**等 `presentedFrame` 报告「已呈现一帧」再撤层**，避免先撤层后出画闪黑；撤之前若又暂停，保留层 |
| `seeked` | 暂停态且层可见：等 `presentedFrame` 后重画（`seeked` 不代表帧可绘制，沿用 `nudgeFrame` 的经验） |
| `fullscreenchange` | 进全屏：隐藏（top layer 只渲染 video 自身）；退全屏：下一帧若仍暂停则补画 |
| `src` 变化 | 层可见性归零（同时覆盖 30 秒闲置 `deactivate` 导致的重新挂载） |
| 元素尺寸变化 | `ResizeObserver` → 暂停态重画（画布缩放 / 节点变宽） |
| `error` | 隐藏 |
| 组件卸载 | 现有 `onBeforeUnmount` 路径无需额外处理，`ResizeObserver` 随 watch 清理 |

### 2.4 不做的事

- 不改播放、音量、截帧、输出值、服务端；不碰 `useLazyFileUrl` 的 30 秒闲置策略。
- 不加 `translateZ(0)/will-change`（用户选择只做 A；`will-change` 在 WebKit 上另有已知副作用，本仓库画布合成层开关正因为此默认关闭）。
- 全屏态不覆盖（top layer 限制），退出全屏补画——列为已知缺口。

## 3. 影响面

| 文件 | 改动 |
| --- | --- |
| `packages/nodes/videoNode/src/components/videoPlayer.vue` | 模板加 `.videoStage` + `canvas.pausedFrame`；新增 `recordPausedFrame/clearPausedFrame/onPlay/onPause/onEnded/onSeeked/readFullscreen` 与 `ResizeObserver`；样式两段 |
| 构建产物 | `videoNode.umd.js`、`videoGenerationNode.umd.js`（后者内联同一个播放器组件），需同步到 `/Applications/toonflow-data/nodes/` |

不影响 web 构建与桌面主进程；节点包更新后需重启应用生效。

## 4. 验证

1. `vue-tsc --noEmit` 通过（videoNode 包）。
2. 外部 WKWebView 实测（Swift + AppKit 最小宿主）：带 `transform` 祖先 + `overflow:hidden` 卡片 + `object-fit:contain` + blob 源 + 真实 1920×2560 工程视频，`pause` 事件里 `drawImage` 得到非空帧（8×8 采样 alpha 合计 16320），暂停 1 秒后再画同样非空 → 覆盖层方案可落地。
3. 人工（需重启应用）：暂停看帧、拖进度条换帧、继续播放不闪黑、进出全屏、切节点/切画布后无残留。

## 5. 评审意见

（代码评审结论见 `3_test_results/2026-11-03-13-31-video-pause-black.md`）
