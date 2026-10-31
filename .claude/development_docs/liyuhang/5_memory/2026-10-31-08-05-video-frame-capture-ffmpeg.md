# 视频截帧改走宿主 ffmpeg（STAR）

- 时间：2026-10-31 08:05
- 改动文件：`videoPlayer.vue`、`frameTarget.ts`(+test)、`videoNode/index.vue`、`videoGenerationNode/index.vue`、`videoNode/tsconfig.json`

## Situation

用户反馈「截取首/尾帧」与视频真实首尾帧不一致：亮度偏亮（约 2 个灰阶）+ 细节不同；把尾帧喂给首尾帧接续工作流会出现跳变。
原实现 `loadFrame` 写死首帧 `0.05s`、尾帧 `duration-0.05s`，且用 `<video>` + canvas 在 WebView 里取帧。

## Task

让截出的帧与视频真实首/尾帧一致（帧号 + 像素），且不改变现有交互。

## Action

1. 实测根因（可复现，未入库脚本）：
   - WebKit canvas 取帧与 AVFoundation 取帧**逐像素相同**（mse=0），ffmpeg 取帧比它们恒定高 1.75/255（全亮度区间恒定直流偏移，中位 +2）。
   - 两者 PNG 的色彩标记（`sRGB` vs `iCCP nclc(1,13,1)`）经 ColorSync 转到同一空间差 0 → 排除「标记不同」。
   - `0.05s` 在 24fps 落在 frame#1、`duration-0.05` 落在 frame N-2；相邻帧 PSNR 仅 17dB，错帧 = 画面不同。
   - ffmpeg 的 `-ss` 语义是「第一个 PTS ≥ 目标的帧」（`-ss 10.018` 取到 10.042 那帧）。
2. `videoPlayer` 新增 `sourcePath` prop；取帧优先走 `useNodeFfmpeg()` → `createBrowserFfmpeg`：
   - 首帧：无 seek + `-frames:v 1`
   - 尾帧：`-sseof -1` + `-update 1`
   - 当前帧：用 rVFC 记录的「已呈现帧 PTS」作 seek 目标
   - 统一 `-an -pix_fmt rgb24 -y -update 1`，产物直写 `assets/<新节点id>/frame.png`
3. canvas 兜底修正：`frameTarget()` 纯函数给 0.001 / duration−0.001；`presentedFrame` 去掉 150ms 容差；`nudgeFrame` 出帧后 seek 回目标时刻。
4. 失败/取消：`AbortSignal` → `command.kill("SIGKILL")`，`captureOnHost` 自行回收已建目录。

## Result

| 指标 | 数据 |
| --- | --- |
| 单测 | `bun test frameTarget.test.ts` 6 例 36 断言全过 |
| typecheck | video / video-generation 两个包均通过 |
| 宿主链路实测 | 首帧 / 尾帧 / 当前帧 与 ffmpeg 命令行真值**逐像素一致**（rawvideo + cmp） |
| 部署 | `deploy-local.sh --build` 完成，安装产物与构建产物字节一致（需用户自行重启） |

## 经验

- 「亮度差一点」先分清是**像素差**还是**显示解释差**：把两张图都转到同一色彩空间再比，能一次性排掉 ICC 假设。
- 系统解码器（AVFoundation/WebKit）与 ffmpeg 的颜色口径本就不同，且差值近似恒定；靠「加个偏移补偿」会随素材色彩标记漂移，必须换管线。
- ffmpeg `-ss` 不是「包含该时刻的帧」，而是「第一个 PTS ≥ 目标的帧」；取当前帧必须给帧自己的 PTS（rVFC `mediaTime`），回退 1ms 只对贴边情况有效。
- 空帧重试若挪动时间戳而不回位，等于静默换帧——重试必须可逆。
- ffmpeg 在「seek 越过末帧」时是 **exit 0 且不写文件**，只监听 end 事件会把不存在的产物当成功；产物必须校验可读。
- 需要兜底的调用方不能直接复用会弹安装引导的探测入口，静默标记要一路透传到宿主。
