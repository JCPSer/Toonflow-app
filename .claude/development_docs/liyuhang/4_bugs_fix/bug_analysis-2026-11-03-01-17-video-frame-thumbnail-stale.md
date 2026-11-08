# Bug 分析：视频重新生成后首尾帧仍显示上一版视频

- 时间：2026-11-03 01:17
- 提出人：用户
- 现象：视频重新生成后，首帧/尾帧输出端口产出的图片仍是上一个视频的
- 状态：根因已定位，方案待实施

## 1. 背景

首帧/尾帧不是服务端返回的字段，而是节点侧用宿主 ffmpeg 从「当前视频」抽帧后写回工作区：

- 文件名固定：`assets/<nodeId>/frame-first.jpg`、`assets/<nodeId>/frame-last.jpg`（`packages/nodes/videoNode/src/frameOutputPlan.ts:12-15`）
- 抽帧：先写唯一临时名再 `remove + rename` 覆盖到固定名（`packages/nodes/videoNode/src/frameOutput.ts:151-189`）
- 输出值：`outputs.firstFrame/lastFrame = { dataType: "IMAGE", value: { url: <固定路径> } }`

视频每次生成都是新 UUID 文件名，但抽出来的帧始终覆盖同两个路径，**输出值 URL 字符串逐字符不变**。

## 2. 复现与定位

在用户真实工程 `/Volumes/WD_BLACK_MAC/[0]【AI Art】/2026/蕾姆Rem` 上验证：

| 检查 | 结果 |
| --- | --- |
| 扫描 4 个画布里全部 `firstFrame`/`lastFrame` 输出（65 条） | 每条 `frame-*.jpg` 的 mtime 都晚于其 `outputs.video` 指向的视频文件 |
| 节点 `88eadb5b-…`：取当前视频最后一帧与本机 ffmpeg 重抽，和盘上 `frame-last.jpg` 做 PSNR | 平均 70.74 dB（视觉无差别，仅 JPEG 重编码差异） |
| 节点 `23a149b6-…` 首帧同样比对 | 72.27 dB |

结论：**落盘内容是对的，刷新链路也是通的**，问题只在显示层缓存：

| 层 | 机制 | 后果 |
| --- | --- | --- |
| 展示层 `<img :src>` | 输出值 URL 不变 → `thumbUrl()` 返回同一字符串 → DOM 属性不变，浏览器不重新请求 | 下游引用卡（`packages/nodeShared/src/components/referenceCard.vue:77-81`）永远显示旧图，即使服务端已更新 |
| HTTP 缓存 | `/api/workspaces/files/thumb` 返回 `Cache-Control: private, max-age=31536000, immutable`（`apps/server/src/routes/workspaces/files/thumb.ts:33`），URL 无版本参数 | 即使重新挂载 `<img>`（输出项下拉就是这样），浏览器也不会回源校验，继续用旧字节 |
| 服务端缩略图磁盘缓存 | 缓存文件名与 ETag 都含源文件 mtime（`apps/server/src/modules/assetLibrary/assets/thumb.ts:38-45`） | 只要真有请求就会拿到新图，不是问题点 |
| `/read` | `Cache-Control: no-store`（`apps/server/src/routes/workspaces/files/read.ts:16`） | 重新读取必然是新内容，不是问题点 |

用户反馈的「下载/导出拿到的文件也是旧的」经盘面核对不成立：盘上文件与当前视频逐帧一致，看到的旧图来自同一套显示层缓存。

## 3. Bug 矩阵

| 编号 | Bug | 优先级 | 复杂度 | 风险 |
| --- | --- | --- | --- | --- |
| B1 | 缩略图 URL 无版本，同路径覆写后 `<img>` 不重新请求，下游引用卡显示旧帧 | P0 | 低（前端加版本号） | 低：版本号按目录+路径缓存，数量与画布节点同量级 |
| B2 | 缩略图响应 `immutable` + 一年有效期，重启后同一 URL 仍可能命中磁盘缓存里的旧图 | P1 | 极低（改响应头） | 低：每次显示多一次本地条件请求（304） |

## 4. 不在本次范围

- 不改首尾帧文件名与抽帧 ffmpeg 参数。
- 不改 `/api/assets/thumb`（素材库是导入副本，不做原地覆写，保持 immutable 以免素材库面板变慢）。
- 不改 `frameOutput.ts` 的刷新/代次逻辑（已核对无误）。

## 5. 验收标准

1. 视频重新生成后，输出项下拉里的首帧/尾帧缩略图显示新视频的帧。
2. 下游引用卡显示的同样是新帧，无需切换画布或刷新节点。
3. 未重新生成时，缩略图仍走缓存（不应每次回源生成）。
4. 重启应用后，同一条缩略图 URL 也能拿到最新内容。

## 6. 评审意见

用户已在选型问答中确认：服务端改 `no-cache` + 前端加 URL 版本号；`/api/assets/thumb` 不改。
