# 测试结果：视频节点首帧缩略图 + 按需加载

日期：2026-10-26 19:40
环境：独立测试实例（`TOONFLOW_DATA_DIR=/tmp/tf-thumb-test`，`TOONFLOW_SERVER_PORT=3199`），系统 ffmpeg `/opt/homebrew/bin/ffmpeg`；测试数据为 ffmpeg 生成的 2s 纯色 mp4（320×240，3 KB）。

## 一、服务端端点 `/api/workspaces/files/thumb`

| 用例 | 请求 | 结果 |
| --- | --- | --- |
| 正常出图 | 同源 Referer + 视频路径 + `size=512` | 200，`image/jpeg` 512×384，`Cache-Control: private, max-age=31536000, immutable`，带 `ETag` |
| 命中缓存 | 同上 + `If-None-Match` | 304，无响应体 |
| 非媒体文件 | `note.txt` | 400「该文件不支持缩略图」 |
| 文件不存在 | 不存在的路径 | 404 |
| 非同源 | 无 Origin/Referer | 403 |
| 伪造来源 | `Origin: http://evil.local` | 403 |
| 工作区根之外且无项目标记 | `/tmp/tf-outside/plain` | 404「项目素材库不存在」 |
| 工作区根之外且有 `.toonflow` | `/tmp/tf-outside/marked` | 200（新项目首屏竞态已解决） |

缓存产物（`<dataDir>/cache/thumbs`）：

```
6fec76198af04bbc595b3bafb8d0e149a28e2852/
├── 512-3049-1793013995855.8835.jpg    # edge-size-mtime
└── source.txt                          # /private/tmp/.../clip.mp4
```

## 二、删除回收

1. 通过 `DELETE /api/workspaces/files/remove` 删除 `clip.mp4`。
2. 等待去抖清扫（5s 窗口，实测 8s 内生效）。
3. 该文件对应的 `6fec…` 缓存目录整体消失；同一测试实例内另一份仍在磁盘上的视频（`plain/assets/clip.mp4` → `fd7a…`）缓存保持不动。

结论：删除回收按「源文件不存在」判定，不会误删仍被引用的缓存。

## 三、类型检查与构建

- `@toonflow/server` typecheck 通过。
- `@toonflow/node-video`、`@toonflow/node-video-generation`、`@toonflow/web` typecheck 通过。
- `bun run build:nodes` 通过；`bun run build`（web + server）通过。
- `bun scripts/bundle-desktop.ts` + `scripts/deploy-local.sh` 完成，`/Applications/data/nodes` 更新 9 个节点包（含 videoNode / videoGenerationNode / textNode）。

## 四、未覆盖（需在应用内手测）

1. 海报态观感：节点首屏显示首帧、无黑块；点击播放后按钮 loading → 开播。
2. 停顿 30s 自动卸载：`<video>` 元素消失、Blob 释放，再点播放可恢复。
3. 生成中/替换视频后封面是否即时刷新。
4. 无 FFmpeg 环境的 424 回退（本次机器 ffmpeg 可用，未构造该场景）。
5. 素材库网格缩略图在缓存布局变更后的显示（旧缓存会随 10 分钟 age 阈值被清扫，重新生成）。
