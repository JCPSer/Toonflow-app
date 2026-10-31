# Bug 方案：视频截帧改为宿主侧 ffmpeg 精确取帧

- 时间：2026-10-31 07:30（初次）/ 2026-10-31 08:20（按初审修订）
- 对应分析：`bug_analysis-2026-10-31-07-30-video-frame-capture-mismatch.md`
- 代码基线：`f72ee6f`
- 涉及文件：
  - `packages/nodes/videoNode/src/components/videoPlayer.vue`（主改动）
  - `packages/nodes/videoNode/src/index.vue`、`packages/nodes/videoGenerationNode/src/index.vue`（传 `sourcePath`）
  - 新增 `frameTarget.ts`（纯函数 + 单测）

## 1. 目标

1. 「首帧」= frame 0，「尾帧」= 最后一帧；与 ffmpeg 系工具（剪映）同帧、同像素。
2. 消除「更亮约 2 个灰阶」。
3. ffmpeg 不可用（未安装、移动端）时靠兜底路径保证**帧序正确**，只保留已知色差。

## 2. 总体方案

```
captureFrame(command)
  ├─ 有 sourcePath 且 ffmpeg 可用 ──> A. 宿主侧 ffmpeg 取帧（默认）
  └─ 否则 ──────────────────────────> B. canvas 兜底（帧时刻与重试逻辑修正）
  A/B 都产出「工作区里的 PNG 路径」
  → 之后仍走原有的「找空位 / addNodes / revealNodeInViewport / 失败回滚」
```

### 2.1 A 路径：宿主侧 ffmpeg

前置：

- `videoPlayer` 新增 prop `sourcePath?: string`（视频的工作区相对路径）；父组件传 `:source-path="outputFile?.url"`。
- 取 ffmpeg 工厂用 `useNode().ffmpeg`（内部即 `useNodeFfmpeg` → `createBrowserFfmpeg`，见 `nodeFfmpeg.ts:6-14`），**不再新建第三套 ffmpeg 调用**。
- 路径校验、超时、取消沿用 `packages/ffmpeg/src/browser.ts` 的既有能力；参数风格与 `videoAnalysis.ts:281-282` 的取帧先例一致。

命令（统一 `-an`、`-pix_fmt rgb24`、`-y`、输出 `.png`）：

| command | 取帧方式 | 说明 |
| --- | --- | --- |
| first | 无 seek，`-frames:v 1` | 直接解第 1 帧（实测与 `-ss 0` 结果一致） |
| last | 输入参数 `-sseof -1`，输出参数 `-update 1`（不限帧数） | 从末尾前 1s 解到结尾，逐帧覆盖同一文件，落盘即真正的最后一帧；不足 1s 时自动从 0 开始（实测与 ffprobe 末帧真值逐字节一致） |
| current | `-ss <该帧 PTS>` + `-frames:v 1` | ffmpeg 的 `-ss` 是「第一个 PTS ≥ 目标的帧」（实测 `-ss 10.018` 取到 10.042 那帧）；播放头 `currentTime` 是连续值、通常落在一帧中间，拿它当目标必然取到下一帧，所以用 rVFC 记录的「已呈现帧 PTS」（`metadata.mediaTime`）作目标。`currentTime - 1ms` 只用于 rVFC 不可用或 PTS 与播放头相差 >0.5s 的兜底，此时可能差 1 帧 |

旋转：ffmpeg 默认 `-autorotate` 开启，输出按**显示方向**，与 `video.videoWidth/Height`（显示方向）一致；A5 用带旋转元数据的真机素材验证。

产物与清理：

```
id = crypto.randomUUID()                       // 与现有实现一致：为新节点分配 id
ensureNodeDirectory(files, id)                 // 建 assets 与 assets/<id>
ffmpeg → assets/<id>/frame.png                 // 直写，不读回内存再上传
uploadStarted = true                           // 从「已开始写盘」起算，任一后续失败都 remove("assets/"+id, true)
```

- 取消：`AbortSignal` 一路传到 `createBrowserFfmpeg(directory, signal)`；切画布 / 卸载 / 只读切换触发 abort，服务端会 cancel 子进程并删临时产物。
- ffmpeg 失败（未安装/执行失败）且非用户取消 → 自动走 B 路径，不弹安装引导（移动端不支持应用内安装，见 `ffmpegRequired.vue:22-23`）。

### 2.2 B 路径：canvas 兜底（修正帧时刻、重试、容差）

| 项 | 现状 | 改为 |
| --- | --- | --- |
| 首帧 target | `max(0.05, …)` | `max(0.001, …)`：0.001s 仍落在 frame 0 内，且能触发真实 seek（推翻上一轮「0.05 没问题」的结论，理由见分析文档 §3.1） |
| 尾帧 target | `max(0.01, duration - 0.05)` | `max(0.001, duration - 0.001)`，落在最后一帧内 |
| 呈现判据 | `|mediaTime - target| ≤ 0.15` | **去掉容差比对**：`seeked` 之后呈现的第一帧即目标帧（暂停元素不会自行前进），600ms 仅作超时兜底 |
| 空帧重试 | 挪 ±40ms 且不回位 | 挪动后重试，**成功后把 `currentTime` 重新 seek 回 target**，避免静默换帧 |
| 空帧检测 | 8×8 采样 | 不变 |

色差（+2/255）在兜底路径上仍存在，属已知限制，写入测试文档。

### 2.3 何时回退

```
sourcePath 为空 / readOnly
/ node.ffmpeg 抛错（未安装、移动端不支持）
/ ffmpeg 执行失败（非用户取消）
→ B 路径
```

用户主动取消（signal aborted）不触发回退，直接结束。

### 2.4 时间计算的纯函数

新增 `packages/nodes/videoNode/src/frameTarget.ts`：

```
frameTarget("first", duration) -> 0.001
frameTarget("last",  duration) -> max(0.001, duration - 0.001)
frameTarget("current", duration, currentTime) -> clamp(currentTime)
```

只用于兜底路径，但抽成纯函数 + 单测，避免以后两套逻辑各自漂移。

## 3. 交互与 UI

无新增按钮、无菜单变化、无新提示。兜底成功时不额外提示（避免噪音）。

## 4. 验证（对应分析文档 A1–A10）

| 用例 | 期望 |
| --- | --- |
| 首/尾帧（24/30/50fps） | 与 ffprobe 帧表推出的真值**逐字节一致**（`cmp`） |
| 亮度 | 与 ffmpeg 真值整幅均值差 ≤1/255 |
| 旋转素材 | 宽高方向正确，首/尾帧仍准确 |
| 短视频 / VFR / 无音轨 / start_time≠0 | 均能截出真正首/尾帧 |
| 播放中截帧 | 不打断播放、进度不变 |
| 未安装 ffmpeg / 移动端 | 走兜底，帧序正确（结构比对 L1<0.03），有已知色差 |
| 中途取消 | 进程被杀，无残留 `assets/<id>` |
| 连续点击 / 并发 | 第二次点击被 `capturing` 拦住 |
| 下游接续 | 起始帧一致，无跳变（人工） |

## 5. 风险与回退

| 风险 | 处置 |
| --- | --- |
| 长 GOP 视频 `-ss` 精确 seek 慢 | 单帧解码通常 <2s；沿用既有超时与 AbortSignal |
| `-update 1` 行为差异 | 宿主 ffmpeg 为内置下载版；失败自动回退 canvas |
| 直写工作区破坏既有回滚语义 | `uploadStarted` 提前到「建目录成功」时置位，清理覆盖 ffmpeg 产物 |
| 高频交互受影响 | 改动集中在取帧段；删掉 A 路径即可整体回退 |

## 6. 方案评审（用户填写）

- 结论：**验收通过**（2026-10-31，用户重启后真机验证：尾帧与剪映同时间线对比无可见亮度差，尾帧跑首尾帧接续无跳变）
- 意见：—

## 7. 子 agent 代码审查

- 结论：不通过（0 P0 / 2 P1 / 8 P2），已全部处置或记录
- 审查报告：`review-2026-10-31-0805-video-frame-capture.md`

| # | 意见 | 处置 |
| --- | --- | --- |
| P1-1 | 缺 FFmpeg 时宿主仍会触发安装引导，与「失败静默回退」矛盾 | 采纳：`BrowserFfmpegOptions` 增加 `silentRequired`，经 zod schema → `createWorkspaceFfmpeg({ silent })` 透传；截帧调用 `nodeFfmpeg(signal, { silentRequired: true })`，prepare 与 run 两次请求都带标记 |
| P1-2 | ffmpeg 可能 exit 0 但没写文件（seek 越过末帧），会提交指向空文件的节点 | 采纳：宿主产物必须能读出宽高，否则回收目录并回退 canvas；`currentFrameSeek` 增加「PTS 与播放头相差 >0.5s 视为过期」的守卫 |
| P2-1 | rVFC 常驻订阅未取消；能力判断晚于置位 | 采纳：保存 handle，换源/卸载调 `cancelVideoFrameCallback`；先判能力再置位 |
| P2-2 | stale PTS 静默取错帧 | 采纳：见 P1-2 的第二条 |
| P2-3 | 取消后立刻删目录可能与子进程写盘交错 | 采纳：清理前等 200ms，失败 `console.warn` 不再全吞 |
| P2-4 | `sourcePath` 未做工作区路径校验；目录名重复计算 | 采纳：新增 `nodeScaffold/workspaceFiles.workspaceMediaPath()`，截帧入口先规范化；`videoProcessing.normalizePath` 与 `videoAnalysis.analysisPath` 改为复用同一实现（不再有第三份）；目录改用 `ensureNodeDirectory` 的返回值 |
| P2-5 | 与 `videoProcessing.runCommand` 重复 | 记录：本轮保留截帧专用的 20s 超时 + kill 后 2s 宽限，与 `runCommand` 语义已对齐，合并留待统一 |
| P2-6 | `frameAnalysisNode` 的播放器没传 `sourcePath` | 采纳：补 `:source-path="source?.url"` |
| P2-7 | 宿主命令构造无回归网；测试文件被 tsconfig 排除 | 记录：命令构造已由宿主链路实测覆盖（首/尾/当前帧逐像素一致）；测试类型检查待另建 `tsconfig.test.json` |
| P2-8 | `imageSize` 为定宽多读一次整图；无超时可能锁死 `capturing` | 采纳超时：3s 未加载按 1:1 放行；整图读取暂保留（同时作为「产物是否存在」的校验） |
| 追加-1 | 取消后立即删目录没等宿主结束 | 采纳：`kill` 后等 `end`/`error`（2s 宽限）再 reject |
| 追加-2 | 缺 `-map 0:v:0`，带封面图的素材可能选错流 | 采纳 |
| 追加-3 | 未复用开始时的工作区实例 | 采纳：`workspace` 作为参数传入 `captureOnHost` / `imageSize` |
