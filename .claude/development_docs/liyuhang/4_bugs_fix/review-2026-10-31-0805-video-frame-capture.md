# 代码审查：视频截帧改走宿主 ffmpeg

审查对象：未提交改动（`videoPlayer.vue` 为主，含 `frameTarget.ts/.test.ts`、两个 `index.vue`、`tsconfig.json`），基线 `HEAD`。
审查方式：通读 `git diff` + 新增文件，交叉核对 `@toonflow/ffmpeg/browser`、`@toonflow/nodes-scaffold` 与 server ffmpeg 路由；实跑 `vue-tsc --noEmit`（videoNode，通过）与 `bun test frameTarget.test.ts`（6/6 通过）；用本机 ffmpeg 7.1.1 复现了 seek 越界行为（见 P1-2）。

## 结论

**不通过**（2 项 P1 需整改后复审）。

P1-1 直接违反方案 `bug_solution-2026-10-31-07-30-video-frame-capture-mismatch.md:55` 的「ffmpeg 不可用时自动走兜底、不弹安装引导」；P1-2 在特定输入下会静默提交一个指向不存在文件的图片节点。其余主链路质量不错，无需返工。

已核查且未发现问题的点：

- **海报态**：宿主路径不再依赖 `resolveSource` 激活，`current` 退化为首帧并提示（`videoPlayer.vue:522`）；`sourcePath` 由父层 `outputFile?.url` 提供，海报态也有值。
- **播放中截帧**：宿主路径完全不接触播放元素，播放状态与进度不受影响；canvas 兜底仍用独立离屏元素。
- **切画布/卸载/只读切换**：`captureController.abort()` 同步触发（`videoPlayer.vue:104-123`），`nodeFfmpeg(signal)` 与 `runFfmpeg` 都能收到取消。
- **连续点击/并发**：`capturing` 守卫在首个 `await` 之前置位（`videoPlayer.vue:503-506`），按钮同时 disabled。
- **空帧重试回位**：`nudgeFrame` 现在会 seek 回目标时刻（`videoPlayer.vue:369-384`），修掉了「静默换帧」。
- **资源释放**：`imageSize` 的 `acquireUrl` 在 `finally` 中 `release()`（`videoPlayer.vue:473-475`），未引入 Blob URL 泄漏。
- **帧时刻口径**：首帧/尾帧/当前帧在 canvas 与宿主两条路径上一致，`frameTarget` 对 NaN/极短视频的夹取正确。

## P0

无。

## P1

### P1-1 ffmpeg 未安装时仍会弹安装引导，与方案要求相反

- **问题**：宿主取帧是默认路径，`createWorkspaceFfmpeg` 在检测不到 ffmpeg 时**先**通知 `requiredListeners`、**再**抛 424；前端 `ffmpegRequired` 收到事件即弹「当前操作需要 FFmpeg，是否下载并安装」确认框（移动端直接弹 warning）。截帧本身有 canvas 兜底且会成功，用户却同时看到「已截取为图片节点」和安装引导；每截一次都再弹一次。这正是方案 §2.1 明确要避免的行为。
- **证据**：`packages/nodes/videoNode/src/components/videoPlayer.vue:408`（`nodeFfmpeg(signal)`）→ `apps/server/src/modules/mediaGeneration/ffmpeg/index.ts:27`（`for (const listener of requiredListeners) listener()`）→ `apps/web/src/components/settings/ffmpegRequired.vue:17-31`；对照 `bug_solution-2026-10-31-07-30-video-frame-capture-mismatch.md:55`。
- **建议**：给宿主加「静默探测」入口——execute 请求增加 `notifyRequired: false`（或 prepare 阶段返回可用性而不触发监听），缺失时直接走 B 路径；安装引导只保留给「没有兜底、确实需要 ffmpeg」的用户主动操作。若产品上就是希望截帧也引导安装，则需同步修改方案 §2.1 与测试文档 §4 的表述，不要两边矛盾。

### P1-2 宿主取帧不校验产物，会静默提交指向不存在文件的图片节点

- **问题**：`runFfmpeg` 只等 `end`/`error`，`captureOnHost` 随后无条件返回 `assets/<id>/frame.png`。但 ffmpeg 在「seek 目标越过最后一帧 PTS」时会以 **exit 0** 正常结束且不写任何文件（stderr: `Output file is empty, nothing was encoded`），`end` 事件照发。`imageSize` 把这类失败（`/read` 404、解码失败、AbortError）全部 catch 成 `0×0` 继续往下走，最终 `addNodes` 指向一个打不开的文件，并提示「已截取为图片节点」。现实可达路径是 `currentFrameSeek()` 的兜底分支：用户把进度条拖到 `duration` 时返回 `duration - 0.001`，而末帧 PTS ≈ `duration - 1/fps`，必然越界。
- **证据**：`videoPlayer.vue:422-423`（无条件 return output）、`459-476`（catch 全吞，`471-473`）、`532-536`（0×0 仍当成功）、`592`（addNodes 使用该路径）、`497-500`（兜底目标）。本机 ffmpeg 7.1.1 复现：2.000s/30fps 素材（末帧 PTS 1.966667）执行 `-ss 1.999 -i src.mp4 -pix_fmt rgb24 -y -update 1 -frames:v 1 out.png` → `exit=0`、`out.png` 不存在；同命令 `-ss 1.966667` 正常产出。
- **建议**：① 取帧返回前校验产物确实存在且非空（`list`/`read` 或让 `imageSize` 的 0×0 视为失败），失败按「宿主取帧失败」处理——回退 canvas 或抛明确错误；② `current` 的 seek 目标夹到「最后一帧 PTS」以内：优先 rVFC 的 PTS，拿不到时不要用 `duration - ε`，可改走 `-sseof -1` 取末帧，或先 ffprobe 出末帧时间。

## P2

### P2-1 rVFC 常驻监听在换源/卸载时没有真正取消

- **问题**：`trackPresentedFrame` 递归注册 rVFC，`src` 变化与 `onBeforeUnmount` 只把 `trackingSource` 置空，已注册但未触发的回调没有 `cancelVideoFrameCallback`。暂停中的元素可能很久不呈现新帧，回调会一直挂在 media element 上；元素本身可被回收，不构成严格内存泄漏，但与「资源释放」口径不符。另外 `481` 先写 `trackingSource`、`484` 才判断能力，老 WebKit（无 rVFC）下会永久标记为「已追踪」。
- **证据**：`videoPlayer.vue:479-493`、`106-123`。
- **建议**：保存 handle，在换源/卸载时调用 `cancelVideoFrameCallback`；能力判断放在置位之前。

### P2-2 当前帧 PTS 无一致性校验，stale PTS 会静默取错帧

- **问题**：`currentFrameSeek()` 只要 `presentedMediaTime` 有限就无条件采用，不与 `video.currentTime` 比对。若 rVFC 未在 seek 后触发（老 WebKit）或回调尚未追上（刚拖完进度条就点截帧），会拿上一次呈现帧的 PTS 去 seek，得到「上一帧」而没有任何提示——正是本次要修的那类问题。测试文档 §5.3 已把老 WebKit 记为已知限制，但「拖完立刻截」这条更常见。
- **证据**：`videoPlayer.vue:497-500`；`3_test_results/2026-10-31-07-51-video-frame-capture.md:56`。
- **建议**：加一行守卫——`Math.abs(presentedMediaTime - (video.value?.currentTime ?? 0))` 超过约一帧（如 0.25s）就回退到 `currentTime - FRAME_EPSILON`；或记录「PTS 对应的播放头位置」一并比对。

### P2-3 取消/超时后的清理与子进程写盘存在竞态，且错误被全吞

- **问题**：`runFfmpeg` 的 `abort`/超时分支调 `command.kill("SIGKILL")` 后**立即** reject，而浏览器侧 `kill` 只是发信号（真正的 cancel 握手是 `cancel()` 里等响应头再 abort）；`captureOnHost` 的 catch 随即 `remove(directory, true)`，可能与仍在写 `frame.png` 的子进程交错（Windows 上易 EBUSY），错误又被 `.catch(() => {})` 全吞，最后留下空目录且无任何记录。对照 `videoActions` 用 `Promise.allSettled` 并在非 ENOENT 时提示，口径不一致。
- **证据**：`videoPlayer.vue:442-449`、`424-427`；`packages/ffmpeg/src/browser.ts:71-78`、`139-141`；`videoActions.vue:410-414`。
- **建议**：取消后等 `end`/`error`（加 2～3s 宽限）再清理，或改为「先由宿主删产物」；清理失败至少 `console.warn`，并区分 ENOENT。另：`addNodes` 在 `revealNodeInViewport` 之前提交，reveal 抛错时节点保留但 finally 删了文件（`videoPlayer.vue:584-595`），属既有问题，建议顺手把 `committed` 提到 addNodes 之后/把两者纳入同一事务。

### P2-4 `sourcePath` 未经工作区路径校验

- **问题**：同一个包里的 `videoProcessing.ts` 有 `normalizePath`，拒绝绝对路径、scheme、`..` 与控制字符；`captureOnHost` 把 `sourcePath` 直接交给 `factory(sourcePath)`，`packages/ffmpeg/src/remote.ts:24-27` 也只校验参数是字符串。另外 `assets/${id}` 与 `ensureNodeDirectory` 的返回值重复计算。
- **证据**：`videoProcessing.ts:11-17`、`videoPlayer.vue:410-421`。
- **建议**：导出并复用 `normalizePath`；目录用 `ensureNodeDirectory` 的返回值，去掉手写的 `assets/${id}` 副本。

### P2-5 与 `videoProcessing.runCommand` 重复实现「signal → kill → end/error」

- **问题**：两处都是同一套 ffmpeg 运行包装，行为还不完全一致（`runCommand` 监听 `start` 事件兜底「取消早于 spawn」，`runFfmpeg` 没有；一个用默认 SIGKILL，一个有 20s 超时）。后续改一处容易漏另一处。
- **证据**：`videoPlayer.vue:431-456`、`videoProcessing.ts:32-41`。
- **建议**：抽成共享 helper（参数：command、signal、可选 timeout），两个调用点复用它。

### P2-6 `frameAnalysisNode` 的播放器没传 `sourcePath`，截帧仍走 canvas

- **问题**：共享的 `videoPlayer` 在该节点里同样显示截帧菜单（`videoPlayer.vue:44`，`files` 默认就有），但 `frameAnalysisNode` 没有传 `source-path`，因此这里的截帧继续走 canvas 路径，保留 +2/255 色差；「逐帧拉片」场景恰恰最在意帧一致性。
- **证据**：`packages/nodes/frameAnalysisNode/src/index.vue:19`。
- **建议**：补 `:source-path="source?.url"`（该值已是工作区路径，`videoAnalysis` 里也用它调 ffmpeg）；若确属本次范围外，请在方案/测试文档中显式注明。

### P2-7 测试只覆盖纯函数，宿主命令构造没有回归网

- **问题**：`frameTarget.test.ts` 覆盖良好，但真正容易写错的部分——`-sseof` 必须在 `-i` 前、首/当前帧必须带 `-frames:v 1`、`-update 1`——没有任何测试；`tsconfig.json` 又用 `exclude` 把测试文件排除在 `vue-tsc` 之外（本包也没有 `test` 脚本/CI 入口），测试文件完全不参与类型检查。
- **证据**：`frameTarget.test.ts`、`videoPlayer.vue:413-421`、`tsconfig.json:8-10`。
- **建议**：把三种命令的构造抽成纯函数返回 `{ inputOptions, outputOptions, seek }` 并做快照/断言测试（尤其 `-sseof` 位置与 `-frames:v 1`）；如需测试类型检查，另建 `tsconfig.test.json`。

### P2-8 `imageSize` 为算节点宽度多读一次整图

- **问题**：为了 `240 × 宽高比` 的定宽，把整张 PNG 通过 `acquireUrl` 读回再解码一次；1600×2112 的 PNG 通常数 MB，随后图片节点渲染还会再读一次。对截帧这种低频操作影响有限，但属于无谓开销。
- **证据**：`videoPlayer.vue:459-476`、`532-536`、`587`。
- **建议**：尺寸改由 ffprobe（或 `-frames:v 1` 前先探测）提供；或首次截帧先按 1:1 定宽，等节点加载后再用真实尺寸修正。
