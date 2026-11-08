# 记忆：视频重新生成后首尾帧仍显示上一版

- 时间：2026-11-03 01:17
- 类型：Bug 修复（显示层缓存）

## STAR

**Situation（背景）**
用户反馈视频重新生成后，首帧/尾帧输出端口产出的图片仍是上一个视频的。首尾帧由节点侧 ffmpeg 抽帧，固定覆盖写 `assets/<nodeId>/frame-first.jpg`、`frame-last.jpg`，输出值 URL 逐字符不变。

**Task（任务）**
在用户真实工程上确认到底是「没重抽」还是「缓存」，并让重新生成后所有显示位置立即刷新，同时不牺牲未变化时的缓存收益。

**Action（行动）**
- 盘面取证：扫描 65 条首/尾帧输出，帧 mtime 全部晚于当前视频；用 ffmpeg 重抽与盘上帧比对 PSNR 70+ dB → 落盘正确，问题在显示层。
- `apps/web/src/lib/fileVersions.ts`（新增）：会话内版本表，`normalizeWorkspacePath` 统一分隔符/大小写/空段。
- `apps/web/src/lib/workspaceFiles.ts`：`invalidateUrls` 无条件 bump 版本；`thumbUrl` 追加 `&v=<version>`，让下游常驻 `<img>` 的 src 真正变化。
- `apps/server/src/routes/workspaces/files/thumb.ts`：`Cache-Control` 由 `immutable, max-age=1y` 改为 `private, no-cache`，靠已有 ETag（含 mtime）协商，兜住重启与其它客户端。
- 新增 `fileVersions.test.ts` 5 例。

**Result（结果）**
web 43 单测、server 103 单测通过；web 类型检查仅既有 `@/agentRuntime` 报错；web 与桌面稳定版重建并同步（`index.html` md5 `581e7fec…`、`bun/index.js` md5 `ca0bd882…`），**未重启应用**。

## 关键经验

1. 「同路径原地覆写 + 长缓存 URL」是这类串图的固定配方；判断修哪层前，先比 mtime、再做像素比对，能一眼区分「没写」和「没显示」。
2. 只改 HTTP 缓存头不够：URL 不变时下游 `<img>` 连请求都不会发，必须让 src 本身变化。
3. 前端版本号只活在会话内，重启会归零，所以必须配 `no-cache` 让 ETag 协商兜底。
4. 素材库 `/api/assets/thumb` 是导入副本、不做原地覆写，保持 immutable，避免素材库面板每次打开都回源。
