# 需求评审：工程分享包（导出 / 导入）—— 边界与漏项

- 时间：2026-10-31 10:50
- 评审对象：
  - `1_requirements_matrix/2026-10-31-09-40-project-share-export.md`（R1–R18）
  - `2_requirements_solutions/2026-10-31-10-20-project-share-export.md`（方案）
- 代码基线：`feat/exec-node`（`783aeda`）
- 评审范围：**只做需求边界与漏项**，不评价实现风格、不评价技术选型。
- 方法：逐个节点包读 `data` 的真实读写点；反查"非节点 data 引用但导入后必须存在"的文件；逐个字段验证"缺失后节点是否还能工作"；逐条核对需求矩阵的自相矛盾。

## 0. 结论摘要

- 方案 §3 的引用收集**机制**（递归 + 前缀匹配）方向正确，但**显式清单**与真实字段存在 4 处差集，且有一个字段族（文本节点正文内的 markdown 图片）**根本不在扫描范围内**。
- 方案遗漏了两类"不在节点 data 里、但导入后必须存在"的项目文件：项目素材库标记 `.library/index.json`、项目 UI 标记 `.toonflow/`。后者直接决定导入后首屏所有缩略图/视频封面是否 404。
- "压缩产物覆盖同名文件、画布 JSON 无需改写路径"这一条与 R6 的"转 MP4 / 转 JPEG"**直接冲突**，会让节点的 `mimeType` 与文件真实格式不一致。这是本次最可能的线上事故点。
- 需求矩阵内部有 6 处自相矛盾/不可验收（R1↔R6、R4↔R5、R6 内部、R10↔方案 §7、R2↔R15、R12↔方案 §8）。

---

## 1. 按严重度排序的条目

### [P0] 1. 压缩"覆盖同名文件"与"转 MP4 / 转 JPEG"冲突，导致扩展名、mimeType 与文件内容不一致

**问题**
方案 §5 规定"压缩产物覆盖同名文件，画布 JSON 无需改写路径"；同一张表又规定视频一律转 MP4（H.264）、非透明图片一律转 JPEG。两者叠加的后果：

- `assets/<id>/xxx.webm`（或被支持的 `.ogv`）被写成 H.264/MP4 字节，但文件名、以及画布里的 `outputs.video.value.mimeType: "video/webm"` 都还是 WebM；
- `.mkv` 同理（画布 mimeType 为 `video/x-matroska`）；
- 非透明 PNG 被写成 JPEG 字节，文件名仍是 `.png`，画布 mimeType 仍是 `image/png`。

接收方渲染时，`acquireUrl` 用**画布里的 mimeType** 造 Blob：`new Blob([data], { type: mimeType })`，即"声明 WebM、内容是 MP4"。WKWebView/Safari 的 `<video>` 会按 MIME 选解复用器，大概率 `MEDIA_ERR_SRC_NOT_SUPPORTED`。而 R6 的验收标准恰恰是"导入后节点能正常播放、截首尾帧、提取音轨"。

**证据**
- 方案 §5 表格与结论：`2_requirements_solutions/2026-10-31-10-20-project-share-export.md:128-134`
- R6 验收：`1_requirements_matrix/2026-10-31-09-40-project-share-export.md:62`
- 应用自身能产出的媒体格式集合（含 `video/webm`、`video/ogg→ogv`、`image/avif`、`image/bmp`）：`apps/server/src/modules/mediaGeneration/media/generation.ts:18-24`、`220`
- 节点数据的 mimeType 是画布持久化的：`packages/nodes/videoGenerationNode/src/index.vue:386`、`packages/nodes/imageNode/src/index.vue:254`
- Blob 按 mimeType 包装：`apps/web/src/lib/workspaceFiles.ts:55-62`
- 服务端读文件按扩展名给 Content-Type：`apps/server/src/routes/workspaces/files/read.ts:34`

**建议**
需求必须新增一条硬性口径："压缩后若容器/编码发生变化，必须同步改写画布的 `url` 扩展名与 `value.mimeType`"，并把 R6 验收补成"至少一个 `.webm` 源视频往返后能在接收方播放"。方案里的"覆盖同名文件 / 无需改写路径"应删除或限定为"同格式重编码"。

---

### [P1] 2. R4 与 R5 自相矛盾：`crop.previous` / `scale.previous` 既会被当作引用保留，又被假设为"指向已丢弃文件"

**问题**
R4 的口径是"按引用收集：data 里引用到的文件保留"；`crop.previous.url`、`scale.previous.url`（裁剪/缩放前的旧图）正是 data 里的字符串，会被递归扫描命中并保留。于是：

- "剔除全部历史素材"的目标落空——每做一次裁剪/缩放就多留一张完整的旧图（原图可能 3072×4096）；
- R5 的"删除指向已丢弃文件的指针（如 `crop.previous`）"**没有可删除对象**，因为它的目标从没被丢弃。

同一问题也出现在 `frameAnalysis.lastResult`（保留上次拉片的全部帧/切片/原音轨）。

**证据**
- 字段真实存在：`packages/nodes/imageNode/src/index.vue:286-289`（scale.previous/appliedUrl 写入）、`327-330`（crop.previous/appliedUrl）
- 类型定义：`packages/nodes/imageNode/src/index.vue:93-97`
- 递归扫描口径：方案 `§3`（`2_requirements_solutions/2026-10-31-10-20-project-share-export.md:93-110`）
- R5 表述：`1_requirements_matrix/2026-10-31-09-40-project-share-export.md:61`

**建议**
需求里把字段分成三类并写死处置：
1. **展示必需**（`outputs.*`、`textPath`、`modelPath`、`inpaint.*`、`frameAnalysis.*`、`frameAnalysisResult.manifest`）→ 保留文件 + 保留字段；
2. **历史可回退**（`crop.previous/appliedUrl`、`scale.previous/appliedUrl`、`crop.last`）→ **不收集文件、整字段删除**（节点已确认可降级，见第 13 条）；
3. **可重建**（缩略图缓存、`.agent` 会话）→ 丢弃。
并据此把 R4 的"引用即保留"改成"**按白名单字段**保留"，递归扫描只作为兜底与 `missing[]` 检测，不再作为裁剪口径。

---

### [P1] 3. 导入后项目素材库会被判成"用户目录"，分享过去的库文件在素材面板里消失

**问题**
项目素材库的根判定完全依赖 `<root>/.library/index.json` 这个标记文件。分享包只会带 `library/` 下被引用的媒体文件，**没有带标记**。接收方首开项目时：

1. `library` 存在、是目录、但没有 `.library/index.json`，且目录里有用户文件 → `isClaimInterrupted()` 返回 false；
2. 于是判定 "library 被用户占用"，`library-assets` 不存在 → **新建并认领 `library-assets`**；
3. 素材面板指向空的 `library-assets`，分享过来的 `library/xxx.png` 在库里"看不见"（节点仍能按路径渲染，但用户无法在素材库管理、也无法再次引用）。

R3 的验收"`library/` 只出现被引用文件"还会把"带标记"判为违规，进一步误导实现。

**证据**
- 标记文件定义与判定：`apps/server/src/modules/assetLibrary/assets/roots.ts:29-50`
- 降级分支（primary 无标记 → 认领 fallback）：`apps/server/src/modules/assetLibrary/assets/roots.ts:116-149`
- fallback 一旦认领即固定：`apps/server/src/modules/assetLibrary/assets/roots.ts:120-123`
- 隐藏/保护名单（`.library` 属于内部目录，正常不会被当成用户内容）：`apps/server/src/modules/localRuntime/workspace/files.ts:105`

**建议**
需求新增 R3 例外项：**导出时必须带 `library/.library/index.json`（或 `library-assets/.library/index.json`）标记，并保持源工程用的是哪个根名**；导入后若标记缺失，必须由导入器重建标记 + 空索引，禁止静默降级到另一个根。R3 验收改为"`library/` 除 `.library/index.json` 外只出现被引用文件"。

---

### [P1] 4. `.toonflow/` 缺失 → 导入后第一次打开画布，所有缩略图/视频封面 404（正是"非目标"里被略过的预热问题）

**问题**
`<img>`/封面这类同源请求无法带工作区标记，服务端只放行"已知项目根"：有素材库标记 **或** 有 `.toonflow/` 目录。新导入的工程两者都没有（`.toonflow/ui.json` 要等画布打开后 500ms 防抖才写），于是首开画布的瞬间，所有 `thumbUrl` 请求都走 404/424 分支：

- 图片节点回退原图（可接受，但慢）；
- 视频节点的 `posterUrl` 是纯 `<img>`，无 onerror 兜底，节点上会出现**破图**，直到用户点播放。

需求把这件事归到"非目标"，但它其实是导入路径必须保证的落地条件。

**证据**
- 已知项目根判定（只认 library 标记或 `.toonflow` 目录）：`apps/server/src/modules/localRuntime/workspace/index.ts:23-35`、`64-66`
- 缩略图端点走同源媒体校验：`apps/server/src/routes/workspaces/files/thumb.ts:19`
- 缩略图 URL 是无头的裸 URL：`apps/web/src/lib/workspaceFiles.ts:160-162`
- 写 `.toonflow/ui.json` 的时机（画布切换时，500ms 防抖）：`apps/web/src/lib/projectUi.ts:91-101`、`apps/web/src/pages/workspace/panels/canvas/canvasHost.vue:66`
- 视频节点 poster 无失败兜底：`packages/nodeScaffold/src/workspaceFiles.ts:181-184`、`packages/nodes/videoNode/src/components/videoPlayer.vue:24-25`

**建议**
把"导入后首屏可用"从非目标提升为需求项：导入器在发布目录前写入 `.toonflow/`（可只写目录，或写一份 `{version:1,lastCanvas:<默认画布>}`），并在验收里加"断网+清缓存后首次打开导入工程，画布内所有图片/视频封面无破图、无 4xx 日志"。

---

### [P1] 5. 接收方缺少节点插件时没有提示（R14 只覆盖模型/供应商）

**问题**
R14 只要求在"模型/供应商不存在"时提示。但节点本身是插件市场的包，画布里出现接收方没装的 `remote-xxxNode` 时会渲染成**永久 loading 占位**，没有任何文案。这比缺模型更常见（分享出去的工程往往用了对方没装的节点）。

**证据**
- 未知节点类型渲染加载占位：`apps/web/src/pages/workspace/panels/canvas/index.vue:63-65`
- 缺插件时已有的提示文案（但只在拖拽/粘贴路径触发）：`apps/web/src/pages/workspace/panels/canvas/index.vue:1570`
- 节点可用性来自插件列表：`apps/web/src/pages/workspace/panels/canvas/index.vue:302-308`

**建议**
R14 扩成"导入后缺失资源清单"，至少含三类：**节点类型/插件**、**模型/供应商**、**引用了但包里不存在的文件**；三者在一条可关闭横幅里合并展示，节点卡片上也给出可点击的"缺失节点"占位。

---

### [P1] 6. `data.inpaint` 不能按字段逐条删——半删会让节点在生成时抛错

**问题**
局部重绘节点的 `inpaint` 是一个耦合对象：`source`、`original`、`guide`、`mask` 四个路径 + `images[]` 参考图必须**同时齐全**，否则生成时直接抛"局部重绘素材无效，请重新创建重绘节点"；同时 `inpaint.source` 还参与参考图去重与提示词编号映射。

方案 §4 只说"删除指向不在 keptFiles 中的路径字段（值置空或整项移除）"，如果实现按字段逐个置空，会得到"`inpaint` 还在但 `guide` 为空"的半残状态：节点照样显示重绘角标、照样可以点生成，然后必失败。

**证据**
- 结构化校验（四路径 + images 全量校验，失败即抛）：`packages/nodes/imageNode/src/imageInpaint.ts:30-33`
- `source` 参与参考图过滤与提示词映射：`packages/nodes/imageGenerationNode/src/index.vue:231-247`
- `guide` 缺失时只是不显示标注图（不会崩）：`packages/nodes/imageGenerationNode/src/index.vue:258-260`
- 字段写入点（三张图 + source 同批写入）：`packages/nodes/imageNode/src/components/imageEditor.vue:444-458`

**建议**
需求里明确："`inpaint` 按**整对象**原子处理——任一必需文件缺失则整段 `inpaint` 删除（节点降级成普通生成节点），绝不逐字段置空"。

---

### [P1] 7. `textPath` 不能删：删了就**静默清空正文**

**问题**
文本节点的正文只存在 `assets/<id>/content.md` 里，画布 JSON 的 `outputs` 被 `toJSON` 强制序列化为 `{}`。如果按"删除指向已丢弃文件的指针"把 `textPath` 删掉，节点下次加载会走"首次创建"分支：从 `outputs.text.value`（空串）新建 content.md，把原正文覆盖成空——**不报错、不提示**。这是整包导出里唯一会静默毁数据的字段。

**证据**
- `outputs` 序列化清空：`packages/nodes/textNode/src/index.vue:232`
- 加载分支与写盘：`packages/nodes/textNode/src/index.vue:200-232`（尤其 `207-210`）
- 正文只在磁盘：`packages/nodes/textNode/src/index.vue:142`、`172`
- 服务端的同款说明（画布里只剩 textPath）：`apps/server/src/agent/mentionFiles.ts:120-121`

**建议**
把 `textPath` 提升为"**不可丢弃字段**"：若 `content.md` 未被收集到，导出应**直接失败**（而不是净化掉指针）。验收加一条"文本节点往返后正文逐字节一致（含中英文与换行）"。

---

### [P1] 8. 文本节点正文里的 markdown 图片不在收集范围内，必然丢图

**问题**
R4 的扫描对象是"每个节点 `data` 的全部路径字段"。文本节点的正文是**一个文件**，正文里的图片是相对路径（如 `![](cover.png)`，相对 `assets/<id>/content.md` 解析）。这些引用：

- 不在 canvas JSON 里（所以递归扫描看不到）；
- 即使去扫 content.md，字符串也不以 `assets/` 或 `library/` 开头（表达式不命中）。

结果：文本节点里的插图在导入后变成"图片读取失败"。

**证据**
- 图片按文档路径解析为相对路径：`packages/nodes/textNode/src/markdownContent.ts:22-36`
- 渲染时按解析后的路径读取：`packages/nodes/textNode/src/markdownContent.ts:84-105`
- 编辑器保留原始 `src`：`packages/nodes/textNode/src/markdownExtensions.ts:1-20`
- 预览/编辑器都把文档路径传进去：`packages/nodes/textNode/src/index.vue:19`、`55`

**建议**
需求补一条收集规则："对每个 `textPath` 指向的 markdown，按文档所在目录解析所有 `![]()` 引用并一并收集；解析失败（越界/非法）的条目进入 `missing[]`"。验收："含插图的文本节点往返后插图仍可显示"。

---

### [P1] 9. Agent 节点被剥离会话后"不能接着改"，与 R1 的"节点/内容齐全"冲突，但需求未声明

**问题**
R1 承诺"接收方导入后节点、连线、提示词、当前媒体齐全，能接着改"；非目标又规定"不导出 `.agent/` 会话"。对 Agent 节点，这两条不可同时成立：节点卡片上只剩 `agentLastPrompt`（最近一句提示词），整个上下文、工具调用历史、产物引用全部消失。这不属于"媒体"，需求矩阵里没有任何一句交代。

**证据**
- 节点只展示 `agentLastPrompt`：`packages/nodes/agentNode/src/index.vue:8-12`、`40`
- 会话指针的三个字段：`packages/nodes/agentNode/src/index.vue:91-95`
- 面板在会话文件 404 时的行为（解绑 + 提示"会话文件已丢失，已重新开始"）：`apps/web/src/pages/workspace/panels/canvas/components/agentNodePanel.vue:226-239`

**建议**
两条路选一条并写进需求：
- a) 接受"Agent 节点退化为只有提示词"，但在导出确认弹窗与 R14 提示里**明说"Agent 节点对话不会随包带走"**，并把 R1 的"齐全"限定为"媒体/提示词/连线"；
- b) 若要保住对话，就把它降级成一段可读的 markdown 摘要导出（仍不带 `.agent/`）。

---

### [P1] 10. R12 的 512MB 上限与方案 §8 的 2GiB 上限直接冲突

**问题**
R12 写"总大小上限（沿用 512MB）"，方案 §8 写"payloadSize ≤ 2 GiB / 总解码 ≤ 2 GiB"。两者必须二选一，否则安全验收（"超大条目被拒"）没有可判定的阈值。

**证据**
- R12：`1_requirements_matrix/2026-10-31-09-40-project-share-export.md:68`
- 方案 §8：`2_requirements_solutions/2026-10-31-10-20-project-share-export.md:158-161`
- 现有克隆链路确实是 512MB：`apps/server/src/routes/workspaces/clone.ts:30`

**建议**
以"解压后总量"为主口径并给出明确数值（推荐沿用 512MB，超出就提示"请先拆分工程"）；若确实要放宽到 2GiB，必须在需求矩阵里改 R12 并说明理由（分享包不走 HTTP body，与克隆链路的限制不同源）。

---

### [P1] 11. 压缩类型表没覆盖应用自己就能产出的格式（avif / bmp / ogv）

**问题**
方案 §5 的图片处理只列 png/jpg/jpeg/webp，跳过项只列 GIF/APNG/动态 WebP、SVG、TIFF；视频只列 mp4/mov/m4v/webm/mkv。但生成链路的合法输出还包含 `image/avif`、`image/bmp`、`video/ogg`(.ogv)。这些文件落进"其他→不压"的兜底，与 R6"图片/视频按固定标准档重新编码"的目标不一致，且验收无法判定。

**证据**
- 方案 §5 表：`2_requirements_solutions/2026-10-31-10-20-project-share-export.md:126-132`
- 生成链路允许的输出格式：`apps/server/src/modules/mediaGeneration/media/generation.ts:18-24`

**建议**
R6 改成"按**扩展名全集**给出处置表"，并对未列格式显式写明"原样保留"，让"重新编码覆盖哪些格式"可验收。

---

### [P1] 12. R6 的"最长边 ≤1080p"与方案滤镜、与自己的样例验收互相矛盾

**问题**
R6 写"最长边 ≤1080p"，验收样例却是"20s / 1600×2112 降到 3–5MB"。方案用的滤镜是 `scale='min(1920,iw)':-2`——只限宽，竖屏 1600×2112 里"最长边"是 2112，仍然超过 1080p（1920）。三条口径（需求文字 / 滤镜 / 样例）两两不一致。

**证据**
- R6：`1_requirements_matrix/2026-10-31-09-40-project-share-export.md:62`
- 方案滤镜：`2_requirements_solutions/2026-10-31-10-20-project-share-export.md:128`

**建议**
统一成"**短边 ≤1080、长边不限**"（对应 `-2` 偶数、竖屏 815×1080 会明显掉画质）或"长边 ≤1920"，并同步改样例尺寸预期。

---

### [P2] 13. "节点历史弹窗打开为空"这条验收写错了

`mediaHistory` 打开时会把**当前输出**补进列表（`packages/nodeShared/src/components/mediaHistory.vue:144-152`），所以导入后历史弹窗是"1 条（当前媒体）"而不是空。按现文案验收会误判为不通过。

**建议**：改为"历史弹窗只含当前输出 1 条，不含任何更早生成的文件"。

---

### [P2] 14. R10 与方案 §7/§11 的保存位置时机相反

R10 写"完成后选保存位置"，方案 §7 是"前端先调 `selectSaveFile` 取得路径，再随导出请求传服务端"（即**先选**），§11 的 UI 顺序也是"口令 → 选择保存位置 → 进度"。三处不一致，验收（"完成后选保存位置"）无法执行。

**证据**：`1_requirements_matrix/...:66`；`2_requirements_solutions/...:152`、`201`

---

### [P2] 15. R7 的"含 libx264"没有数据来源，验收也没覆盖它

方案要求"`getToolStatus` 两件全就绪 + `availableEncoders` 含 `libx264`"，但 `getToolStatus` 只返回 path/origin/version/error；`availableEncoders` 是 fluent-ffmpeg 的**命令实例方法**，不是工具状态字段。R7 的验收只测"无 ffmpeg"，测不到"有 ffmpeg 但没 libx264"（Homebrew 的 ffmpeg 一般都带，但自定义编译的常缺）。

**证据**：`packages/ffmpeg/src/index.ts:49-61`；`packages/ffmpeg/src/browserTypes.ts:27`（`availableEncoders` 属于命令代理方法）

**建议**：要么把"探测 libx264"列为需求项并给验收（"删掉 libx264 的 ffmpeg 下点导出必须拒绝"），要么删掉这句。

---

### [P2] 16. R15（导出前 flush 画布）与 R2（只在首页导出）矛盾

导出入口只有首页卡片右键，而首页与工作区互斥（单工程），不存在"改了节点立刻在首页导出"的场景。R15 的验收"改了节点立刻导出，包内是改后内容"无法执行。

**证据**：R2 `...:58`、R15 `...:71`；单工程模型 `apps/web/src/stores/workspace.ts:70-77`

**建议**：改成"退出工作区时保证画布已落盘（现有 `flushAllLastCanvas` 链路）"，或直接删掉 R15。

---

### [P2] 17. R3 的排除项里有两条在本仓库不存在 / 不在项目目录内

- `.easyvibe`：全仓库只出现在文档路径里，项目目录里没有这个产物，写进排除表会让人以为需要防御；
- `cache/thumbs`：缩略图缓存在 `<data>/cache/thumbs`，**在项目目录之外**（`apps/server/src/modules/assetLibrary/assets/thumb.ts:11`），导出时天然不会带上。

**建议**：删除这两条，改为"排除 `.toonflow/share-*`（staging 自身）"。

---

### [P2] 18. R9 的"明文 + sha256 校验"没有定义校验对象与失败行为

R9 写"留空 = 明文 + sha256 校验"，方案 §2 的头部/清单里只有**逐条目** sha256，整包 sha256 只出现在 §13 风险表（"末尾追加整包 sha256"）里，格式章节没有它。验收"明文包与加密包都能导入"覆盖不到"校验失败必须拒绝"。

**证据**：R9 `...:65`；方案 §2.2 `...:57-77`；方案 §13 `...:224`

**建议**：明确校验对象（建议整包摘要写进头部保留字段或 manifest 尾），并补验收"篡改 1 字节必被拒"。

---

### [P2] 19. R14 的判定口径与方案不一致，且"打开工程时"与"导入后一次性"不同

R14 说"打开工程时提示重选……有失效引用时列出数量"；方案 §8.5 是导入时比对并返回 `missingModels[]`、前端开工程后横幅提示。前者是"每次打开"，后者是"导入那一次"。另外"列出数量"与"提示重选"是两种交互，验收只写了"提示可关闭"。

**证据**：R14 `...:70`；方案 §8.5 `...:165`

**建议**：定为"**导入完成时**比对一次 + 横幅列出可点击的具体项（节点名 + 缺失类型）"，并去掉"数量"这种不可操作的表述。

---

### [P2] 20. 导入后的工程名会带 8 位随机后缀，`manifest.project.name` 实际没被使用

方案 §8.3 用 `<name>-<8位>` 建目录，而首页工程名取自目录 basename（`apps/web/src/pages/home/...`、`apps/web/src/stores/workspace.ts:27-37`）。结果列表里显示"我的工程-3f9a2b71"；manifest 里的 `project.name` 成了死字段。

**建议**：导入器把 manifest 名写进目录名并仅在重名时加后缀；或明确"导入后自动把显示名改成 manifest 名"。

---

### [P2] 21. `assets/generated/` 以及"单段 assets 路径"没有处置口径

- 生成链路在未指定目录时写到 `assets/generated`（`generation.ts:194`）；R4 只写了"`assets/<nodeId>/` 下其余文件全部丢弃"，对 `assets/generated` 里未被引用的残留没有说法。
- 收集正则 `/^assets\/[^/]+\//` 要求至少两段；`assets/foo.png`（直接放在 assets 根下）不命中。理论上节点 data 不会产生这种路径，但 `setImage` 工具接受任意工作区相对路径（`packages/nodes/imageNode/src/index.vue:175-197`）。

**建议**：把 R4 的丢弃范围写成"`assets/**` 下除白名单引用外的全部文件"，正则放宽为 `^assets/` 前缀即可（递归扫描本身不区分层级）。

---

### [P2] 22. `outputs` 指向不存在文件时的处置没有定义

`isNodeOutput` 只校验结构（非空 url + mimeType），不校验文件是否存在。所以"无指向不存在文件的字段"这条验收对 `outputs` 无法达成：既不能删（节点会变空白、下游已消费过该值），也不能"置空"（结构校验直接判无效，节点变成无输出）。

**证据**：`packages/nodeScaffold/src/values.ts:27-48`；R5 验收 `...:61`

**建议**：在需求里把 `outputs` 明确排除在"删除悬空指针"之外——输出指向的文件缺失时**保留字段、记入 `missing[]`、节点显示"文件缺失"占位**。验收改成"除 `outputs` 外无悬空指针；`outputs` 的缺失在清单里列全"。

---

## 2. 附：逐节点路径字段全表（与方案 §3 清单的差集）

图例：✅ 方案已列 ｜ ⭕ 未列但递归扫描能兜住 ｜ ❌ 完全不在扫描范围

| 节点包 | 字段 | 来源 | 覆盖 |
| --- | --- | --- | --- |
| imageNode | `outputs.image.value.url` | `packages/nodes/imageNode/src/index.vue:140` | ✅ |
| imageNode | `crop.last.url` | `:96`、`components/imageCrop.vue:102` | ✅ |
| imageNode | `crop.previous.url` | `index.vue:328` | ✅ |
| imageNode | `crop.appliedUrl` | `index.vue:329` | ✅ |
| imageNode | `scale.previous.url` / `scale.appliedUrl` | `index.vue:287-288` | ✅（`scale.*`） |
| imageNode | `lighting` / `multiAngle` | `components/imageLighting.vue:73`、`imageMultiAngle.vue:81` | 无路径（纯参数） |
| imageGenerationNode | `outputs.image.value.url` | `src/index.vue:190` 等处 | ✅ |
| imageGenerationNode | `inpaint.source` | `components/imageEditor.vue:456`（imageNode 侧写入） | ⭕ 差集 |
| imageGenerationNode | `inpaint.original` | 同上 | ⭕ 差集 |
| imageGenerationNode | `inpaint.mask` | 同上 | ⭕ 差集 |
| imageGenerationNode | `inpaint.images[].path` | 同上（`:455`） | ⭕ 差集 |
| imageGenerationNode | `inpaint.guide` | 方案 `§3:100` | ✅ |
| videoGenerationNode | `outputs.video.value.url` | `src/index.vue:386` | ✅ |
| videoGenerationNode | `firstFrame` / `lastFrame` | 只来自边、不入 data：`src/index.vue:241-256` | 无 |
| audioGenerationNode | `outputs.audio.value.url` | `src/index.vue:225` | ✅ |
| videoNode / audioNode | `outputs.*.value.url` | `audioNode/src/index.vue:120` 等 | ✅ |
| textNode | `textPath` | `src/index.vue:142`、`229` | ✅ |
| textNode | 正文 markdown 图片（相对路径） | `markdownContent.ts:22-36`、`88-94` | ❌ 不在 canvas JSON、也不以 `assets/` 开头 |
| noteNode | 无（`noteText` / `noteStyle`） | `src/index.vue:113`、`318-325` | — |
| director3dNode | `modelPath` | `src/index.vue:104`、`132`、`176` | ✅ |
| director3dNode | `modelSnapshot`（内联文档，非路径） | `src/index.vue:190` | — |
| frameAnalysisNode | `frameAnalysis.source.url` | `src/index.vue:205`、`146` | ✅（`frameAnalysis.source`） |
| frameAnalysisNode | `frameAnalysis.resultSource` | `src/index.vue:205` | ✅ |
| frameAnalysisNode | `lastResult.scenes[].image` / `.video` | `videoAnalysis.ts:4-12` | ✅ |
| frameAnalysisNode | `lastResult.audio` | `videoAnalysis.ts:20` | ✅ |
| frameAnalysisNode | `lastResult.manifest` | `videoAnalysis.ts:25`、`243`、`305` | ⭕ 差集（只列了 `frameAnalysisResult.manifest`） |
| frameAnalysis 子节点 | `outputs.*.url` | `resultNodes.ts:88` | ✅ |
| frameAnalysis 子节点 | `frameAnalysisResult.manifest` | `resultNodes.ts:90` | ✅ |
| agentNode | `agentSessionFile` / `agentSessionCloneFrom` | `src/index.vue:92-94` | 会话，按 R2 决策排除 |
| agentNode | `agentLastPrompt`（文本） | `src/index.vue:40` | 无路径 |
| canvasGroup | 无 | — | — |

**结论**：白名单差集是 `inpaint.{source,original,mask,images[].path}` 与 `frameAnalysis.lastResult.manifest`（共 5 条，递归兜底可覆盖）；**真正漏网的是文本节点正文里的 markdown 图片**——它不在 `data` 里，任何"扫 data"的方案都收不到。

---

## 3. 附：不在节点 data 里、但导入后必须存在的文件

| 文件/目录 | 为什么必须 | 证据 | 方案是否覆盖 |
| --- | --- | --- | --- |
| `<root>/.library/index.json`（library 或 library-assets 下） | 素材库根判定 + "已知项目根"判定；缺了会降级到另一个根并新建空库 | `roots.ts:29-50`、`116-149`；`workspace/index.ts:31-34` | ❌ 未提 |
| `.toonflow/` 目录（`ui.json` 可选） | 桌面端同源媒体/缩略图放行；`lastCanvas` 指针 | `workspace/index.ts:23-35`、`64-66`；`projectUi.ts:6`、`91-101` | ❌ 未提 |
| `assets/` 与 `assets/<nodeId>/` 目录本身 | textNode / director3d 会在加载时按需创建，非必需 | `textNode/src/index.vue:212-221`；`director3dNode/src/index.vue:109-113` | 无需 |
| `<data>/cache/thumbs`（全局） | 可重建，且在项目目录外 | `assetLibrary/assets/thumb.ts:11` | 天然排除 |
| `.agent/**` | 按 R2 决策不导出；Agent 面板遇 404 会自动解绑 | `agentNodePanel.vue:226-239` | ✅ |

---

## 4. 附：字段缺失时的实际行为（"不能简单删除"清单）

| 字段 | 删了会怎样 | 证据 | 建议处置 |
| --- | --- | --- | --- |
| `textPath` | **静默清空正文**（用空串重建 content.md） | `textNode/src/index.vue:207-210` | 不可删；文件没收集到就中止导出 |
| `inpaint.*`（任一） | 生成时抛"局部重绘素材无效"，节点表现为可点但必失败 | `imageInpaint.ts:30-33` | 整对象删，别逐字段删 |
| `modelPath` + 文件缺失 | 打开导演台硬报错"导演台加载失败"，编辑器打不开 | `director3dNode/src/index.vue:122-137` | 文件没保留时整字段删（节点降级为空舞台） |
| `crop.previous` / `appliedUrl` | 安全：只隐藏"恢复裁剪前"按钮 | `components/imageCrop.vue:160-163` | 可直接删 |
| `scale.previous` / `appliedUrl` | 安全：只隐藏"恢复缩放前"按钮 | `components/imageScale.vue:97-101` | 可直接删 |
| `crop.last` | 安全：回到整图裁剪框 | `components/imageCrop.vue:295-302` | 可直接删 |
| `frameAnalysis.source` | 删整对象安全（节点变成"无输入"）；**只清空 url 会破坏 `isNodeOutput` 校验** | `frameAnalysisNode/src/index.vue:146` | 整对象删 |
| `frameAnalysis.lastResult` | 若文件缺失但字段还在 → 报告里的分镜/清单读取报错 | `analysisReport.vue:120-123` | 有任一文件缺失就整段 `lastResult` 删 |
| `frameAnalysisResult.manifest` | 报告页"下载清单"报错"文件可能已被移动或删除" | `analysisReport.vue:120-122` | 保留（文件必须一并收集） |
| `outputs.*` | 删字段 → 节点空白、语义丢失；结构校验仍认非空 url（不校验文件存在） | `values.ts:27-48` | 不删；缺失记入 `missing[]` + 节点占位提示 |
| `agentSessionFile` | 安全（面板已处理 404） | `agentNodePanel.vue:226-239` | 删（方案已定） |
| `data.outputs`（文本节点） | 本来就被序列化为 `{}`，无需处理 | `textNode/src/index.vue:232` | 保持 |

---

## 5. 附：需求矩阵自相矛盾 / 不可验收条目

| # | 矛盾点 | 位置 | 建议 |
| --- | --- | --- | --- |
| 1 | R1"不含压缩媒体时逐字节一致" vs R6"所有图片视频必压 + 失败即整包中止"——不存在未压缩路径 | R1 `:57`、R6 `:62`、R8 `:64` | R1 改成"JSON 与未压缩文件逐字节一致；压缩文件以解码结果一致为准" |
| 2 | R4"引用即保留" vs R5"删除指向已丢弃文件的指针" | R4 `:60`、R5 `:61` | 见第 2 条：字段分三类写死 |
| 3 | R12"512MB" vs 方案 §8"2GiB" | R12 `:68`、方案 `:158-161` | 见第 10 条 |
| 4 | R6"最长边≤1080p" vs 方案滤镜只限宽 vs 样例 1600×2112 | R6 `:62`、方案 `:128` | 见第 12 条 |
| 5 | R4 验收"历史弹窗为空" vs 组件总会补入当前输出 | R4 `:60`、`mediaHistory.vue:144-152` | 见第 13 条 |
| 6 | R10"完成后选保存位置" vs 方案 §7/§11"先选" | R10 `:66`、方案 `:152`、`:201` | 见第 14 条 |
| 7 | R15"导出前 flush" vs R2"只在首页导出" | R15 `:71`、R2 `:58` | 见第 16 条 |
| 8 | R3"library/ 只出现被引用文件" vs 必须带 `.library/index.json` | R3 `:59` | 见第 3 条 |
| 9 | R7"含 libx264"不可验收（无数据来源） | R7 `:63` | 见第 15 条 |
| 10 | R9"明文 + sha256 校验"未定义对象与失败行为 | R9 `:65` | 见第 18 条 |

---

## 6. 建议补进需求矩阵的新条目

| 编号 | 需求 | 优先级 | 验收 |
| --- | --- | --- | --- |
| R19 | 压缩换格式时同步改写 `url` 扩展名与 `value.mimeType` | P0 | webm 源视频往返后可在接收方播放 |
| R20 | 导出必须带项目素材库标记 `.library/index.json`（保留 library / library-assets 根名） | P1 | 导入后素材面板能看到分享过来的库文件，且不会新建空 library-assets |
| R21 | 导入必须产出一个"已知项目根"（`.toonflow/` 目录） | P1 | 首开画布无缩略图/封面 4xx |
| R22 | 导入后缺失资源清单含**节点插件**、模型/供应商、缺失文件三类 | P1 | 卸载一个节点插件后导入，横幅能列出具体节点 |
| R23 | 文本节点正文里的 markdown 图片随包收集 | P1 | 含插图的文本节点往返后插图仍显示 |
| R24 | 字段级保留策略表（展示必需 / 历史可回退 / 可重建） | P0 | 用该表实现 `sanitizeCanvasForShare`，逐字段有明确处置 |
| R25 | 压缩格式处置表覆盖 `mediaExtensions` 全集 | P1 | 对 avif/bmp/ogv 各有一个往返用例 |
