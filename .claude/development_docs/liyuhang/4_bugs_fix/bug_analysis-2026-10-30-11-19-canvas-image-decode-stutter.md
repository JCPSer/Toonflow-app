# bug 分析：画布节点多时平移/缩放卡顿

- 时间：2026-10-30 11:19（v2，11:45 按子 agent 初审修订）
- 项目：Toonflow-app（Electrobun 桌面端 WKWebView + Vue Flow）
- 现场画布：`/Volumes/WD_BLACK_MAC/[0]【AI Art】/2026/蕾姆Rem/3-教室里的大胆行为.json`
- 现场规模：54 个节点（39 `imageGenerationNode` + 5 文本 + 2 Agent + 2 图片 + 5 分组 + 1 便签），其中 41 个节点带 IMAGE 输出；当前视口挂载 13–40 张图片；素材目录 `assets/` 合计 1.2 GB（含历史文件），单张生成图为 12–17 MB 的 3072×4096 PNG

## 1. 背景与现象

用户反馈：画布节点稍多时，**突然平移或缩放会大概率卡顿一下**，非必现但概率高，影响操作手感；常态操作"已经比较流畅"。

已与用户确认的约束：

1. 卡顿规律不明显（不是固定"头一次"或"每次"）。
2. 卡顿时画布上**没有选中节点**，Agent 面板未开。
3. 只接受**无感优化**：不允许低缩放降级、不允许离屏节点不渲染等可见损失。
4. 清晰度取舍：画布统一用缩略图，接受缩放超过约 2 倍时略软。

## 2. 现状与可复用能力（评审补充）

缩略图链路已经存在，本次是"接到图片节点"，不是从零建设：

| 能力 | 位置 |
| --- | --- |
| `WorkspaceFiles.thumbUrl(path, size)` / `warmThumb(path, size)` 契约 | `packages/nodeScaffold/src/workspaceFiles.ts:9-12, 98-99` |
| 前端实现（默认 512，`/api/workspaces/files/thumb`，`immutable` 缓存） | `apps/web/src/lib/workspaceFiles.ts:160-168` |
| 服务端生成（FFmpeg，全局并发 2，磁盘缓存按 `edge-size-mtime`） | `apps/server/src/modules/assetLibrary/assets/thumb.ts`、`apps/server/src/routes/workspaces/files/thumb.ts` |
| 视频节点已有的"缩略图海报 + 原图惰性 acquire/release"范式 | `packages/nodeScaffold/src/workspaceFiles.ts:106-152`（`useLazyFileUrl`） |
| 未持有 Blob 也能下载/全屏的钩子 | `packages/nodeScaffold/src/nodeSkeleton.vue:62-82, 227-232`（`downloadResolver`/`fullscreenResolver`） |
| 既有预热调用点 | `packages/nodes/videoNode/src/index.vue:176`、`packages/nodes/videoGenerationNode/src/index.vue:372`、`apps/web/src/pages/workspace/panels/canvas/canvasDrop.ts:183` |

结论：方案应以"复用 `thumbUrl`/`warmThumb`，图片节点补上与视频节点相同的范式"为主，不新造端点。

## 3. 实测证据

测量环境说明（重要）：卡顿无法在 Electrobun 内直接录制，以下分两类证据，结论限定为"高度相关 + 待桌面端复测"。

- **WebKit 引擎**：Playwright WebKit（与 WKWebView 同为 WebKit，但**不是同一个构建**，内存策略可能不同），打开同一画布、同一批素材，注入 rAF 帧间隔采集。
- **Chromium 引擎**：Chrome DevTools trace，用于看主线程长任务的构成，不能直接代表 WKWebView 的解码行为。

| # | 实验（引擎） | 结果 |
| --- | --- | --- |
| E1 | 12 MB / 3072×4096 PNG 首次显示（WebKit，9 次采样，3 张图 ×3 轮） | **4/9 出现 156–161 ms 单帧**，其余 5 次为 18 ms。说明"解码确实会阻塞主线程约 160 ms"，但命中与否取决于图像缓存状态——与"大概率不是必现"吻合 |
| E2 | 同图 `createImageBitmap` 后再缩放到 768（WebKit） | 解码阶段仍阻塞约 163 ms，**未真正后台解码**，卡顿不消失 |
| E3 | 512 缩略图显示（WebKit，同样 9 次采样） | 9/9 为 18–19 ms，**无卡顿** |
| E4 | 1024 缩略图显示（WebKit，4 次） | 4/4 为 18–19 ms，**无卡顿** |
| E5 | 把画布上全部节点图片换成 512 缩略图后重复缩放 3 轮（WebKit） | 全部平稳，未再出现 >50 ms 帧 |
| E6 | `<img decoding="async">` / `loading="lazy"`（WebKit） | 与普通 `<img>` 无差别，**不能作为低成本替代方案** |
| E7 | Chrome trace：缩放期间的长任务 | 263 ms 的 `EventDispatch(type=load)` + 253 ms 微任务；另有 195 ms / 130 ms 的资源加载任务（Chromium 侧佐证"图片加载/解码是主要长任务来源"） |
| E8 | 无选中节点时的平移帧（WebKit） | 平稳（排除选中工具栏每帧强制布局） |
| E9 | 平移结束后 500 ms 的画布自动保存（WebKit） | 最大帧 19–24 ms（排除自动保存深拷贝为主因） |

清晰度对照（同一张图，左原图 / 右 1024 缩略图，自上而下为缩放 1x / 2x / 4x 的实际像素密度）：`/Users/liyuhang/Downloads/AI临时目录/_perf/thumb-quality.png`。1x 与 2x 无可分辨差异，4x 细节略软。

### 3.1 机制推断（标注为假设，需桌面端复测）

- 解码一张 3072×4096 位图约 50 MB；41 张同时驻留的上限约 **1.9 GiB**，这是上限估算而非实测。
- 现场还存在**确定性**的内存占用：图片节点通过 `useFileUrl` 把**原图整份**读成 Blob/ArrayBuffer（`packages/nodeScaffold/src/workspaceFiles.ts:65-93` + `apps/web/src/lib/workspaceFiles.ts:55-81`），40 张约 **0.5–0.7 GB**，与解码位图叠加形成内存压力。
- 因此更可能的机制是"内存压力 → 位图淘汰 → 再次显示时重解码（约 160 ms 阻塞）"，而不是每次都解码。

## 4. bug 矩阵

| ID | bug 描述 | 触发条件 | 优先级 | 难度 | 风险 | 本次处理 |
| --- | --- | --- | --- | --- | --- | --- |
| B1 | 画布节点直接显示原图 Blob（12–17 MB / 3072×4096），实际解码时阻塞主线程约 160 ms | 节点图片首次渲染；缓存淘汰后重绘；缩放/平移使新节点进入预加载边距 | P0 | 中 | 中：清晰度、透明通道、动图、导出源 | 是 |
| B2 | 原图 Blob 常驻：40 张约 0.5–0.7 GB，即便不显示也占内存 | 节点靠近视口即整份读取 | P0 | 中 | 中：需改为惰性 acquire/release | 是 |
| B3 | `useNodePreviewReady` 一次性从"空卡"切到"挂载图片"，缩放拉远时批量触发 | 缩小画布使大量节点同时进入 240 px 边距 | P1 | 低 | 低 | 随 B1/B2 缓解 |
| B4 | 引用图卡片（48×48 显示）加载原图 | 节点带引用图 | P1 | 低 | 低 | 是 |
| B5 | 缩略图 capability 缺失、FFmpeg 缺失、格式不支持时必须有回退 | 异常环境 / svg、tiff、动图 | P0 | 低 | 低 | 是 |
| B6 | 缩略图 `size` 上限 512，传 1024 被 `validateFields` 直接 400（不是 404/424） | 改用 1024 时 | P1 | 低 | 低 | 是 |
| B7 | 历史记录弹窗预览 | 打开历史弹窗 | P2 | 低 | 低 | 否（一次只读一张，见 5.3） |
| B8 | `backdrop-filter: blur(6px)` 覆盖画布 | 任何平移/缩放 | P3（未验证假设） | 低 | 中：去掉模糊可见 | 否，先补验证 |
| B9 | 选中工具栏每帧读 `offsetWidth` | 有选中节点 | P3 | 低 | 低 | 否（现场无选中） |
| B10 | 平移结束 500 ms 后的深拷贝 + 美化序列化 | 每次手势结束 | P3 | 低 | 低 | 否（实测 19–24 ms） |

## 5. 关键事实与边界（评审补充）

### 5.1 `<img>` 直连的前置条件

`<img>` 无法携带 `x-toonflow-workspace` 头，走的是 `assertAssetRequest(...,{media:true})` 同源校验 + `resolveWorkspaceFile(...,{sameOriginMedia:true})`。桌面端对 workspaces 根之外的目录（如 `/Volumes/.../蕾姆Rem`），要求存在 `.toonflow`（或素材库索引）标记才放行。现场项目已具备该标记（实测缩略图 200）；新项目首次打开存在短暂 404 窗口，必须由前端回退原图兜底。

### 5.2 格式与可见行为

- JPEG 缩略图丢失 alpha；PNG 是否带 alpha 需要读 IHDR 才能判断，`dataType` 区分不出来。
- `-frames:v 1` 会把 gif/apng/动态 webp 压成静态首帧，属于可见行为变化。
- `svg` 会被判为 IMAGE 但 FFmpeg 大概率失败；`tif/tiff` 直接是 FILE（路由 400）。
- 结论：**仅对 png/jpg/jpeg/webp/bmp/avif 这类静态位图启用缩略图，svg/gif/apng/tif 等回退原图**。

### 5.3 历史记录弹窗

`mediaHistory` 只在弹窗打开时读取"当前选中"的一张（`packages/nodeShared/src/components/mediaHistory.vue:85-88`），不存在批量解码；预览区高 360 px，需要原图。**保持原图，不纳入本次改造**。

### 5.4 缓存陈旧

缩略图 URL 只带 `path + size`，响应是 `private, max-age=31536000, immutable`（`apps/server/src/routes/workspaces/files/thumb.ts:33`）。同路径原地覆写会一年不刷新。本次不改（现有所有缩略图都如此），但要在方案里记录风险；图片节点的写入路径是"新文件新路径"，暂不触发。

## 6. 修复目标

1. 画布图片节点与引用图卡片的**展示源**改为 1024 缩略图；解码从约 160 ms/张 降到 <20 ms/张。
2. **原图不再随节点挂载整份读取**（阶段二）；阶段一先做到"画布上不解码原图"，全屏、裁剪、标记、局部重绘、下载等入口继续用原图。
3. 缩略图在生成/导入后预热；打开画布时对当前画布的图片输出后台预热（并发受限、可取消）。
4. 缩略图不可用时静默回退原图；不改交互、不改节点数据。
5. 验收指标：现场画布连续平移/缩放 3 轮，>50 ms 帧为 0–1；p95 帧 ≤ 25 ms；首屏图片可见时间不劣于现状（≤2 s）。内存指标只对阶段二成立——阶段一只减少解码位图，压缩 Blob 仍常驻。

## 7. 评审意见

### 7.1 子 agent 初审（已完成，见本次修订）

必须修改项已逐条吸收：补现状盘点（§2）、修正 1024 的 400 语义与波及面（§4 B6）、明确 `useFileUrl` 常驻问题（B2）、补全入口清单（方案文档）、修正引用图尺寸与历史预览优先级（B4/B7）、修正 `backdrop-filter` 位置并降级为假设（B8）、标注证据引擎（§3）、弱化 2 GB 表述（§3.1）、补格式/alpha/动图边界（§5.2）、补 `.toonflow` 前置条件（§5.1）、统一数字口径（头部、§3.1）、补验收指标（§6.5）。

未采纳：把 512 作为画布默认尺寸（会明显软化，E4 已证明 1024 解码同样无卡顿）。

### 7.2 用户评审

- 评审结论：待填写
- 意见：待填写
