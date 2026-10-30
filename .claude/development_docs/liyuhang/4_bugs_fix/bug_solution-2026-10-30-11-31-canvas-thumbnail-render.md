# bug 修复方案：画布图片统一走缩略图，消除解码卡顿

- 时间：2026-10-30 11:31（v2，11:52 按子 agent 初审 + 补充实测修订）
- 对应分析：`bug_analysis-2026-10-30-11-19-canvas-image-decode-stutter.md`
- 处理 bug：B1（原图解码阻塞）、B3（批量挂载）、B4（引用图）、B5（回退）、B6（size 上限）；B2 拆为阶段二

## 1. 方案总览

```
阶段一（必做）
  生成/导入图片 ──► warmThumb(1024)                    ┐
  打开画布 ──► 扫描当前画布 data.outputs 的 IMAGE 预热 ─┤─► 服务端 ffmpeg 生成 JPEG（并发 2，永久缓存）
  画布卡片 <img> ──► /files/thumb?size=1024            ┘   （解码 18–19 ms，实测无卡顿）
  缩略图失败 / 格式不支持 ──► 静默回退原图

阶段二（实测后再决定）
  原图 Blob 常驻（40 张约 0.5–0.7 GB）──► 缩略图常驻 + 原图按需 activate/release
```

阶段一只改"画布上展示什么"，不动节点数据与交互；阶段二才动原图的获取方式。

## 2. 改造点分类（评审要求）

图片节点里同一个 `previewUrl` 今天同时承担三种角色，必须分清：

| 角色 | 今天用 `previewUrl` 的位置 | 本次是否换缩略图 |
| --- | --- | --- |
| **展示源**（卡片上显示） | `imageEditor` 的 `<img :src>`（`packages/nodes/imageNode/src/components/imageEditor.vue:3`）；`referenceCard` 的 `<el-image :src>`（`:4-9`） | **换成缩略图** |
| **像素计算源**（坐标、尺寸、切片） | `imageCrop`（`imageCrop.vue:288-292, 641-653`）、`imageScale` 的 `sizeProbe`（`imageScale.vue:18, 202-219`）、`imageGridSplit`（`imageGridSplit.vue:127-142`）、`imageEditor` 的标记/重绘输出（`:315-317, 366-367`） | **必须原图**，换成缩略图会让输出分辨率与坐标系错乱 |
| **导出源** | `downloadUrl`（两个节点模板第 8 行 → `nodeSkeleton.vue:62-74`）、全屏 `el-image-viewer :urlList`（`imageNode:70-74`、`imageGenerationNode:108-112`）、全景导出（`imagePanorama.vue:33,60`） | **必须原图**，否则下载/全屏/导出变成 1024 |
| **3D 纹理** | 打光/多角度舞台（`imageLightingStage.vue:256-257`、`imageMultiAngleStage.vue:227-228`） | 保持原图（产出走 `source` 原路径，纹理用缩略图会让预览变糊，不做） |

## 3. 阶段一详细设计

### 3.1 服务端：放宽缩略图边长到 1024

- `apps/server/src/routes/workspaces/files/thumb.ts`：`size` 的 `z.coerce.number().int().min(64).max(512)` → `max(1024)`。
- `ensureAssetThumbnail` 内部本就允许 1–2048（`assetLibrary/assets/thumb.ts:76`），不需要改。
- 资产库路由 `apps/server/src/routes/assets/thumb.ts:11` **不动**（素材库与工作区是两条链路）。
- 失败语义：schema 不通过是 **400**，FFmpeg 缺失/生成失败是 **404/424**——前端两条都要回退原图。

### 3.2 图片节点：展示用缩略图，编辑/导出仍用原图

`packages/nodes/imageNode/src/components/imageEditor.vue`：

```
props: { src（原图，不变）, previewSrc?（缩略图，新增） }

state:
  thumbUsable = ref(true)          // 缩略图失败后本节点永久退回原图
  editingSrc  = ref<string>()      // 编辑期间临时切原图
  shownSrc    = editingSrc ?? (thumbUsable && previewSrc ? previewSrc : src)

onImageError(img):
  若当前是 previewSrc 且 previewSrc !== src → thumbUsable = false（静默换原图重试）
  否则清 editingSrc 并 emit('error')

start(mode):                       // 标记 / 局部重绘
  重入锁 + props.src 为空直接返回
  先 cancel()（会清掉 editingSrc），再 editingSrc = src
  await nextTick() 让 <img> 真正换 src
  await 监听 img 的 load/error（只 await nextTick 不够）
  原图加载失败 → 清 editingSrc 并退出，不建 0×0 画布
  最后用原图 naturalWidth/Height 初始化画布（掩码分辨率不降级）

createCanvas()（导出像素源）:
  若存在 previewSrc 且 editingSrc 不是原图 → 抛错，禁止用缩略图导出

cancel(): editingSrc = undefined   // 退出编辑释放原图解码位图
```

- 现有 `watch(() => props.src, cancel)` 语义不变（真正换图才取消编辑）。
- `emit('load')` 时机不变；调用方只用长宽比，缩略图比例一致。

两个节点接线（`imageNode/src/index.vue`、`imageGenerationNode/src/index.vue`）：

- 新增 `thumbUrl = computed(() => 该节点能拿到 outputFile 且格式在可缩略白名单内 ? files.thumbUrl(outputFile.url, 1024) : "")`；拿不到能力时返回空串。
- `<imageEditor :src="previewUrl" :previewSrc="thumbUrl" ...>`。
- 其余所有 `:src="previewUrl"` / `downloadUrl` / `urlList` **原样保留**。

### 3.3 引用图卡片

`packages/nodeShared/src/components/referenceCard.vue`：

- `v-if` 改为 `displayUrl`（缩略图优先），否则缩略图会被"原图读完"的旧条件挡在后面。
- 卡片 `<el-image :src>` 用 256 档缩略图（显示尺寸只有 48×48）；`previewSrcList` 仍为原图，查看器只在点击时创建 `<img>`。
- 失败回退原图；原图未读完时允许先记录失败、读完再渲染。
- 注意：原图 Blob 目前仍在挂载时整份读取（阶段二才消除），本阶段只省掉 12 MB 位图解码。

### 3.4 格式白名单与回退

```
可缩略：png / jpg / jpeg / webp / bmp / avif
回退原图：gif / apng（动图，压成首帧是可见变化）、svg / tif / tiff（FFmpeg 失败或路由 400）
其余：按 MIME 判断，非 image/* 不进入缩略图分支
```

透明 PNG：JPEG 缩略图丢 alpha（显示黑底）。阶段一先接受该限制（现场素材为 rgb24），并在方案里记录：若后续出现透明素材，改为按 IHDR color type 检测后回退原图，或为 PNG 输出 WebP 缩略图。

### 3.5 预热

- **写入路径预热**：不做逐点插桩，改为在两个图片节点里 `watch(thumbUrl)`——生成、替换、上传、裁剪、缩放、切分、标记/重绘只要换出新的输出路径就会触发一次 `warmThumb(path, 1024)`（与原视频节点语义一致，且不会漏掉新增写点）。不加 `immediate`，避免画布打开时为每个节点重复请求。
- **打开画布预热**：`canvasMenu.vue` 的 `applyCanvas` 在 `setNodes/setViewport` 之后扫描当前画布 `nodes[].data.outputs`，取 `dataType === "IMAGE"` 且扩展名在白名单内的条目，串行 `warmThumb(path, 1024)`：
  - 先等 800 ms，让视口内的 `<img>` 先占用服务端并发队列；
  - 每张之间间隔 50 ms；
  - 切换画布时令牌失效即停（多画布宿主会同时保留实例，只在激活的画布预热）。
- 服务端并发仍是全局 2（与素材库共用队列），所以预热只做"提前排队"，不提高并发。

### 3.6 首开空窗的验收口径

- 缩略图请求中：图片区域保持空白（内容区本来就有 `min-height`），不显示破图；`nodeSkeleton` 的骨架只覆盖插件加载，不覆盖图片加载。
- 单张生成约 0.3 s；视口附近 13 张、并发 2 时约 2 s 内逐步出现；41 张全量冷启动可能十几秒，预热就是为了把这段时间提前消化。
- **不做超时回退**：`<img>` 没有超时事件，且超时切原图会重新引入 156–161 ms 解码尖峰。只有真正 `error`（404/400/424/解码失败）才回退原图。

## 4. 阶段二（可选，实测后再定）

若阶段一完成后仍有 >50 ms 帧，或进程内存仍超标，再做：

- 图片节点改用 `useLazyFileUrl`（已有 `activate/deactivate + generation` 防竞态：`packages/nodeScaffold/src/workspaceFiles.ts:106-152`）；
- 全屏/下载走 `nodeSkeleton` 的 `downloadResolver`/`fullscreenResolver`（`:227-232`），不常驻原图 Blob；
- 各"像素计算源"入口在打开前 `await activate()`，关闭后 `deactivate()`。

阶段一已能让画布上不再解码原图；阶段二解决的是 0.5–0.7 GB 压缩 Blob 常驻。

阶段二的已知前提（评审补充，实施时逐条处理）：

- `useLazyFileUrl` 的 `posterUrl` 写死 512，需要加 size 参数，否则画布降回 512；
- `activate()` 目前不返回成败，调用方无法判断就打开裁剪/标记，应返回结果或抛错；
- 两个图片节点里 `!previewUrl` 形式的禁用条件共 19 处，`previewUrl` 变惰性后会永远点不动，必须统一改成 `outputFile`/`posterUrl`；
- `nodeSkeleton` 的 `<a download>` 分支优先于 `downloadResolver`，阶段二必须移除内联 `:downloadUrl="previewUrl"`；
- 下载/查看器期间要保持激活，关闭后再 `deactivate`，避免 Blob URL 被提前撤销。

## 5. 测试计划

1. 现场画布首次打开：41 个图片节点依次出现，无破图；对比改造前首屏时间。
2. 重进画布：图片即时出现（命中缓存）。
3. 连续平移/缩放 3 轮：统计 >50 ms 帧数、p95 帧时间，目标 0–1 次 / ≤25 ms。
4. 全屏预览：原图，清晰度与今天一致。
5. 裁剪 / 缩放 / 宫格切分 / 标记 / 局部重绘：输出分辨率与原图一致（用 3072×4096 素材核对导出尺寸）。
6. 下载：文件仍是原图，不是 1024。
7. 引用图卡片：48 px 正常，点击查看为原图。
8. 异常回退：临时把 FFmpeg 改名 / 造一个 svg 引用 / 请求一个不存在的 path → 节点回退原图，无错误弹窗。
9. 动图（gif）：保持原图与动画。
10. 生成新图：落盘后缩略图已预热，卡片秒开。

## 6. 风险

- 首次打开老画布存在 0.3 s/张的生成窗口；41 张冷启动可能十几秒（服务端全局并发 2，与素材库共用队列）。
- 阶段一不降低内存：原图 Blob 仍随节点挂载整份读取，省掉的只是 12 MB 位图解码。
- 缩放 >2 倍时 1024 缩略图略软（用户已确认接受）。
- 透明 PNG 显示为黑底（现场无此素材，记录为已知限制）。
- 缩略图缓存 `immutable` + 无 mtime：同路径原地覆写会读到旧图。图片写入走"新文件新路径"，本次不触发；记录为后续项。
- 服务端失败无负缓存：同一个坏文件每次挂载都会重跑 FFmpeg（前端已按 path 回退，不再请求）。

## 7. 评审意见

### 7.1 子 agent 初审（已完成）

三轮评审（分析初审、方案评审、实现审查）意见均已处理：实现审查提出的编辑态代次竞态、`waitImageLoad` 挂死、缩略图失败误报错、展开锚点收敛、预热背压与取消、扩展名白名单一致性、便签 save 提交与颜色校验、工具摘要字段白名单、全中断配色，均已在代码中修正并重新构建部署。

第二轮（方案评审）已吸收：referenceCard 的 `v-if` 顺序、删除"3 秒超时回退"、`start()` 与 `cancel()` 的先后与 load 等待、重入锁、导出前断言原图、预热改为单点 watch、预热让出首屏、`warmThumb` 吞错、扩展名白名单与服务端对齐、阶段二前提清单、阶段一不降内存的口径。

已吸收：现状盘点、1024 的 400 语义、入口三分法、下载/全屏必须原图、引用图 48 px、历史预览不纳入、`backdrop-filter` 降级、证据标注引擎、格式/动图/alpha 边界、`.toonflow` 前置、首开空窗口径、预热挂点、验收指标。

未采纳：512 作为画布默认（E4 证明 1024 解码同样无卡顿，且 512 在 2x 屏已接近 1:1，放大即糊）。

### 7.2 用户评审

- 评审结论：待填写
- 意见：待填写
