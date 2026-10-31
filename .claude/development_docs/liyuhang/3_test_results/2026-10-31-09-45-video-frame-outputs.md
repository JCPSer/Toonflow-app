# 测试结果：视频节点「首帧 / 尾帧」输出

- 时间：2026-10-31 09:45
- 对应方案：`2_requirements_solutions/2026-10-31-09-35-video-frame-outputs.md`
- 环境：macOS 14.6 arm64 / Bun 1.3.11 / ffmpeg 8.x（`/opt/homebrew/bin/ffmpeg`）

## 1. 静态检查

| 项 | 结果 |
| --- | --- |
| `bun run --filter '@toonflow/node-video' typecheck` | 通过 |
| `bun run --filter '@toonflow/node-video-generation' typecheck` | 通过 |
| `NODE_ENV=production bun run build:nodes` | 通过（11 个节点全部产出） |

## 2. 单元测试

`bun test packages/nodes/videoNode/src/` → **18 例 / 69 断言全过**（`frameOutputPlan.test.ts` 14 例 + 既有 `frameTarget.test.ts` 4 例）。

覆盖：端口增删顺序与去重、只认显式 `true`、首帧无 `-sseof`、尾帧用输入侧 `-sseof -1`、`-map 0:v:0` 与 `-update 1`、handleId 与文件名不漂移。

## 3. ffmpeg 参数与产物（真实 1080p 视频）

由 `frameOutputOptions()` 生成的实际 argv：

```
首帧 ffmpeg -i src.mp4 -c:v mjpeg -q:v 2 -pix_fmt yuvj444p -update 1 -y -map 0:v:0 -frames:v 1 frame-first.jpg
尾帧 ffmpeg -sseof -1 -i src.mp4 -c:v mjpeg -q:v 2 -pix_fmt yuvj444p -update 1 -y -map 0:v:0 frame-last.jpg
```

两条命令在 1920×1080 / 30fps / 3s 素材上实跑：

| 项 | 结果 |
| --- | --- |
| 产物像素格式 | `yuvj444p`（4:4:4） |
| 首帧体积 / 耗时 | 190,615 B / 0.08 s（合成测试图，高饱和） |
| 尾帧体积 / 耗时 | 201,825 B / 0.14 s |
| 尾帧正确性 | 与「解码第 89 帧（末帧）」逐像素相同（PSNR = inf） |
| 短素材（0.5s）尾帧 | 正常产出 |
| 纯音频素材 | ffmpeg 退出码 234（`Stream map '' matches no streams`）→ 由代码转成警告，不打断节点 |
| 照片类素材 1080p | q2 + 4:4:4 = 119 KB，RGB 域 PSNR 48.97 dB；同内容 4:2:0 = 90 KB / 47.32 dB |

## 4. 构建产物核查

| 文件 | 体积 | 含 `frame-first.jpg` | 含「输出项」 |
| --- | --- | --- | --- |
| `build/nodes/videoNode.umd.js` | 229,959 B | 是 | 是 |
| `build/nodes/videoGenerationNode.umd.js` | 443,348 B | 是 | 是 |

## 5. 未覆盖 / 已知限制

1. **真机 UI 未验证**：按用户要求不重启其正在使用的应用，端口出现/缩略图/连线回收需重启后人工确认。
2. 端到端链路（生成 → 抽帧 → 下游消费）未跑，依赖第 1 项。
3. 高细节噪点素材 1080p 实测可达 ~1.75 MB（评审报告数据），故不设体积硬阈值。
4. 带封面图的纯音频素材（attached_pic）会被 `-map 0:v:0` 抽出封面图而不是失败——与现有「截取视频帧」口径一致，未特判。
5. 4K60 素材的 `-sseof` 解码量较大，30 s 超时阈值为估算，未压测。
6. 端口增删不进撤销栈（撤销快照只存 `label/disabled`），属预期行为。

## 6. 代码审查后的复测（2026-10-31 10:10）

按 `review` 列出的 10 条问题修改后重跑：

| 项 | 结果 |
| --- | --- |
| `@toonflow/node-video` typecheck | 通过 |
| `@toonflow/node-video-generation` typecheck | 通过 |
| `@toonflow/web` typecheck | 仅剩基线错误（`apps/server/.../singleAgent/types.ts` 的 `@/agentRuntime` 别名） |
| 单测 | 18 例 / 69 断言全过 |
| `build:nodes` + `@toonflow/web` build | 通过 |
| 产物 | `videoNode.umd.js` 231,740 B、`videoGenerationNode.umd.js` 445,121 B，均含 `frame-first.jpg` 与「输出项」 |

改动要点：`busy` 改为在途计数（修复永久卡死）、落盘改「临时名 + rename」、菜单去掉 `el-checkbox`、关闭端口时中止在途抽帧、挂载自检按实际路径、画布「复制到剪贴板」不再把视频节点的帧当图片。

部署：两个节点包与 web 视图已同步到 `/Applications/toonflow-exec.app/Contents/Resources/app` 与 `/Applications/toonflow-data/nodes`，**未重启应用**。

## 7. 真机回归：409 修复（2026-10-31 10:45）

真机首次验证报 `开启尾帧输出失败：Request failed with status code 409`。在隔离端口 4011 起独立服务复现并确认根因：

| 步骤 | 结果 |
| --- | --- |
| `rename` 到不存在目标 | 200 |
| `rename` 到已存在目标 | 409 `EEXIST` |
| 先 `remove` 目标再 `rename` | 200 |

修复后：`@toonflow/node-video` typecheck 通过、18 例单测全过、`build:nodes` 通过，节点包已重新部署（未重启）。

**待人工复验**：重启后连续两次「关闭再开启尾帧输出」都应成功，且文件被覆盖。
