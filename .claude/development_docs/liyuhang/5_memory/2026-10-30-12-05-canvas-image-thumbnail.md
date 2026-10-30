# 变更记录：画布图片缩略图化（消除平移/缩放卡顿）

时间：2026-10-30 12:05
类型：性能 bug 修复（画布渲染 + 图片链路）

## Situation

50 余个节点的画布上，突然平移或缩放会大概率卡一下，非必现。现场画布 54 节点、41 个图片输出，图片是 3072×4096（12–17 MB PNG）。

实测（Playwright WebKit，与桌面端同为 WebKit 但不同构建）：同一张 12 MB PNG 首次显示，9 次采样里 4 次出现 **156–161 ms** 主线程阻塞；换成 1024 缩略图后 13 次采样全部 18–19 ms。`createImageBitmap` 与 `decoding="async"` 都不能把解码挪出主线程。

## Task

在不改变任何视觉与交互的前提下，让画布上不再解码原图：卡片用缩略图，编辑/导出仍用原图。

## Action

- 服务端 `routes/workspaces/files/thumb.ts`：`size` 上限 512 → 1024（内部生成本就允许 2048）。
- `nodeScaffold/workspaceFiles.ts` 新增 `useThumbUrl(file, size)`：按**扩展名**白名单（png/jpg/jpeg/webp/bmp/avif）返回缩略图 URL，动图/svg/tiff 与能力缺失时返回空串；`useNode` 透出。
- `imageEditor.vue`：新增 `previewSrc`；`shownSrc = editingSrc ?? (thumbUsable ? previewSrc : src)`；缩略图 `error` 静默回退原图；`start()` 加重入锁、空 `src` 守卫，先 `cancel()` 再切原图并等待 `img` 的 load/error；`createCanvas()` 断言当前必须是原图，避免用 1024 导出标记/重绘。
- 两个图片节点：接入 `thumbUrl`，卡片 `v-if` 与宽度计算同时认缩略图；`watch(thumbUrl)` 在输出变化时预热；下载、全屏、裁剪/缩放/宫格/打光/多角度/全景继续用 `previewUrl` 原图。
- `referenceCard.vue`：卡片 `v-if`/`src` 改用 `displayUrl`（缩略图优先），查看器仍用原图，失败回退。
- `canvasMenu.vue`：`applyCanvas` 后扫描当前画布 `data.outputs` 的 IMAGE，延迟 800 ms 起串行预热（间隔 50 ms），切画布即停。
- `workspaceFiles.ts`（web）`warmThumb` 补 try/catch。

## Result

- 现场画布：视口内 15 张卡片全部为 `files/thumb?size=1024`（775×1024），无 `blob:` 原图；进入"标记"自动切原图（1515×2002，画布同尺寸），退出回到缩略图；下载链接仍是原图 blob。
- 手势 3 轮：缩小 1 次 80–95 ms 尖峰（首次批量挂载预览），其余 0；改造前同场景为 160–450 ms 级解码阻塞。
- 类型检查与 `deploy-local.sh --build` 通过，已重启应用。
- 遗留：阶段一不降低内存（原图 Blob 仍随节点挂载整份读取，约 0.5–0.7 GB），阶段二拟改用惰性 acquire/release；透明 PNG 目前会显示黑底；首次打开老画布需等缩略图生成（约 0.3 s/张，服务端全局并发 2）。
