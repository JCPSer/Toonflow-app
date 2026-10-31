# 测试结果：视频节点截帧改为宿主 ffmpeg 取帧

- 时间：2026-10-31 07:51
- 对应方案：`4_bugs_fix/bug_solution-2026-10-31-07-30-video-frame-capture-mismatch.md`
- 环境：macOS 14.6 arm64 / Bun 1.3.11（dev） / ffmpeg 7.1.1（系统）
- 素材：24fps / 1600×2112 / H.264 yuv420p / `color_range=tv` / bt709 / trc=iec61966-2-1，481 帧，duration 20.041s

## 1. 静态检查

| 项 | 结果 |
| --- | --- |
| `bun run --filter '@toonflow/node-video' typecheck` | 通过 |
| `bun run --filter '@toonflow/node-video-generation' typecheck` | 通过 |
| `bun run --filter '@toonflow/node-video' build` | 通过（`build/nodes/videoNode.umd.js`） |
| `bun run --filter '@toonflow/node-video-generation' build` | 通过 |
| `bun test packages/nodes/videoNode/src/frameTarget.test.ts` | 6 例 / 36 断言全过 |

## 2. 纯函数单测（`frameTarget`）

| 用例 | 结果 |
| --- | --- |
| 首帧 = 0.001s（>0，能触发 seeked） | 通过 |
| 尾帧落在最后一帧区间内（20.04 ∈ [20.0, 20.041]） | 通过 |
| 当前帧原样返回，超出时长夹到末尾 | 通过 |
| duration 为 0 / 负 / NaN / Infinity 不产生 NaN 或负值 | 通过 |
| 极短视频（<1ms）不越界 | 通过 |
| 当前帧非法输入按 0 处理 | 通过 |

## 3. 宿主 ffmpeg 链路（走真实 `createFfmpeg` + `executeRemoteFfmpeg`）

用与浏览器侧完全相同的调用序列（`noAudio` → `outputOptions`/`inputOptions`/`seekInput` → `output` → `run`）在临时工作区实跑，
产物与 ffmpeg 命令行真值逐像素比对（两边都解码成 `rawvideo rgb24` 后 `cmp`）：

| 用例 | 命令 | 结果 |
| --- | --- | --- |
| 首帧 | `-pix_fmt rgb24 -y -update 1 -frames:v 1` | **PIXEL-IDENTICAL** |
| 尾帧 | `-sseof -1` + `-pix_fmt rgb24 -y -update 1` | **PIXEL-IDENTICAL** |
| 当前帧（精确 PTS 10.000） | `-ss 10.000 -update 1 -frames:v 1` | **PIXEL-IDENTICAL** |

首次运行发现 ffmpeg 告警「filename does not contain an image sequence pattern」——已补 `-update 1` 消除。

## 4. 关键行为验证（脚本/推理，非真机 UI）

| 项 | 结果 |
| --- | --- |
| ffmpeg `-ss` 语义 | 实测「第一个 PTS ≥ 目标的帧」（`-ss 10.018` 取到 10.042 那帧）→ 当前帧必须给精确 PTS，已用 rVFC 的 `mediaTime` |
| 亮度 | 产物等于 ffmpeg 口径，比改动前的 canvas 产物低 1.75/255（与剪映一致） |
| 帧序 | 由 0.05s / duration−0.05 改为真正的第 1 帧 / 最后 1 帧 |
| 取消 | AbortSignal → `command.kill("SIGKILL")` → 服务端 abort 子进程；目录由 `captureOnHost` 自行回收 |
| 兜底 | ffmpeg 缺失/失败自动回落 canvas，帧时刻改用 `frameTarget`（0.001 / duration−0.001） |

## 4.1 代码审查后的复测（P1-1 / P1-2 修正）

| 项 | 结果 |
| --- | --- |
| `@toonflow/ffmpeg` / `@toonflow/server` / video / video-generation / frame-analysis typecheck | 全部通过 |
| 宿主链路三条路径复测（首/尾/当前帧） | 仍 **PIXEL-IDENTICAL** |
| `bun test frameTarget.test.ts` | 6/6 |
| 缺 FFmpeg 静默回退 | `silentRequired` 贯通 browser → route schema → `createWorkspaceFfmpeg({ silent })`；不再弹安装引导（真机未验，逻辑路径已通） |
| 产物缺失保护 | 宿主产物读不出宽高即回收目录并回退 canvas（`-ss` 越过末帧时 ffmpeg exit 0 不写文件） |
| 部署 | `deploy-local.sh --build`：11 个节点包 + 桌面入口已更新，`videoNode.umd.js` 安装产物与构建产物字节一致 |
| 追加修正复测（`-map 0:v:0` / 路径规范化 / workspace 复用 / kill 后 2s 宽限） | 三条路径仍 **PIXEL-IDENTICAL**；六包 typecheck 通过；重新构建安装完成（未重启） |
| **真机验收（用户）** | **通过**：尾帧与剪映同时间线对比无可见亮度差；尾帧跑首尾帧接续无跳变 |

## 5. 未覆盖 / 已知限制

1. ~~**真机 UI 未跑**~~：已由用户在重启后验证**通过**（2026-10-31）——视频节点截尾帧放入剪映与同一时间线的原视频对比，无可察觉亮度/细节差；用尾帧跑首尾帧接续工作流，接缝正常。首帧同在本次验证范围内。
2. **旋转元数据素材**：ffmpeg 默认 `-autorotate`，预期输出按显示方向，但本机未构造出带 display matrix 的真机素材，未实测。
3. **VFR**：首/尾帧按 `-sseof`/`-frames:v 1` 取值不受影响；「当前帧」在 VFR 下若 rVFC 不可用（老 WebKit），可能差 1 帧。
4. **移动端**：无内置 ffmpeg，只能走 canvas 兜底，保留 +2/255 色差。
5. **兜底路径的 canvas 色差**未做补偿（偏移随素材色彩标记变化，做常数补偿会引入新偏差）。
6. 海报（`assets/thumb.ts` 的 `-ss 0.5`）不在本次范围，节点封面本来就不是 frame 0。
