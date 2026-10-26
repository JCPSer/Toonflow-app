# 记忆：视频节点首帧缩略图 + 按需加载 + 闲置卸载

## Situation

视频节点直接 `<video :src=blob preload=auto>`：`acquireUrl` 把整段视频读成 Blob 并按路径常驻（26 节点实测堆 ≈313 MB），`loadeddata` 之前卡片是黑块，运行时 canvas 生成的首帧只在组件内存里、重挂载即丢。

## Task

首屏显示首帧图；不播放就不读整段视频；缓存可自动生成/失效/回收；无 FFmpeg 时行为不倒退；暂停后闲置自动释放内存。

## Action

- 服务端 `utils/assets/thumb.ts`：缓存布局改为两级 `<sha1(realpath)>/<edge>-<size>-<mtime>.jpg` + `source.txt`；导出 `dropThumbnailCache`、`scheduleThumbnailSweep`（去抖 5s）、`sweepThumbnailCache`（跳过外接卷未挂载、缺 source.txt 不足 10 分钟的目录、旧扁平 jpg）。
- 新端点 `routes/workspaces/files/thumb.ts`：`assertAssetRequest(media)` 同源校验 + `resolveWorkspaceFile(..., { sameOriginMedia: true })`；`private, immutable` + ETag + 304；FFmpeg 缺失返回 424 与 404 区分。
- `utils/workspace/index.ts`：媒体端点项目标记放宽为「素材库索引或 `.toonflow` 目录」，解决新项目首屏竞态。
- `routes/workspaces/files/remove.ts`：删除后 `scheduleThumbnailSweep()`（rm 之后 realpath 失效，不能逐文件反推缓存键）。
- `app.ts`：在 `TOONFLOW_DATA_DIR` 确定后动态 `import` thumb 模块再 sweep（静态引入会让缓存落到默认 data 目录）。
- 前端契约 `nodeScaffold/workspaceFiles.ts`：`thumbUrl`/`warmThumb` + `useLazyFileUrl`（惰性 acquire/release，带 generation 防竞态），经 `useNode().files` 暴露。
- `videoPlayer.vue`：新增 `posterUrl` 与海报态（首帧图 + 播放按钮）、`activate`/`deactivate` 事件、暂停/离开 30s 闲置卸载、`posterSize` 事件；`src` 为空即海报态，父子组件行为向后兼容。
- `nodeSkeleton.vue`：新增 `downloadResolver`/`fullscreenResolver`，未持有 Blob 时按钮仍可点，点击后再索取地址。
- `videoNode` / `videoGenerationNode`：改用 `useLazyFileUrl`，下载/全屏走 resolver，剪辑类操作先 `await activate()` 再打开（避免 videoActions 因 src 变化 reset）；落盘与生成成功处 `warmThumb`。

## Result

- 端点实测：200 出图 / 304 命中 / 400 非媒体 / 403 非同源 / 404 无标记项目；删除源文件 8s 内缓存目录整块回收，另一份仍在磁盘的缓存不受影响。
- 全量 typecheck、build:nodes、build 通过；应用已重打包，`/Applications/data/nodes` 同步 9 个节点包。
- 待应用内手测：海报态观感、闲置 30s 卸载、生成后封面刷新、无 FFmpeg 回退。

## 精度要点

- `rm` 之后再算 `sha1(realpath)` 会失败，删除回收必须交给清扫（或删除前采样）。
- 缓存键必须含 `size` 与 `mtimeMs`，部分文件系统 mtime 精度约 2s，只写 edge 会命中旧帧。
- ETag 必须由 `real+edge+size+mtime` 派生，只用目录 hash 会 304 旧图。
- `<img>` 带不了自定义头，媒体端点只能靠同源校验 + 项目标记；`workspaces` 根内的目录本来就是允许的，标记只对根外项目生效。
- `thumb.ts` 顶层 `import conf`，启动清扫必须动态引入，否则 desktop 打包环境的缓存路径错到默认 data 目录。
