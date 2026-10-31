# 方案：工程分享包（导出 / 导入）

- 时间：2026-10-31 10:20
- 对应需求：`1_requirements_matrix/2026-10-31-09-40-project-share-export.md`（R1–R18）
- 代码基线：`feat/exec-node`（`783aeda`）

## 1. 总体流程

```
导出
  前端：首页工程卡片右键 → 输入口令（可空）→ flush 画布保存
  服务端 POST /api/workspaces/share/export  →  返回 taskId（异步）
    1. 扫描画布 JSON（全部 *.json 且 toonflowCanvas:true）
    2. 收集被引用文件（引用即保留）
    3. 清理画布 JSON（剥离会话指针、悬空指针）
    4. 复制到 staging（工作区内），逐文件压缩（ffmpeg，并发 2）
    5. 流式写容器：manifest + 条目（媒体原样存储，文本/JSON deflate）
    6. 可选：分块 AES-256-GCM 加密
    7. 写入用户选定路径
    8. 删除 staging
  前端：轮询 /api/workspaces/share/status?id=  显示百分比 / 可取消

导入
  前端：首页「导入工程」→ 选本地文件
  服务端 POST /api/workspaces/share/import  →  taskId
    1. 读文件头（魔数/版本/flags）
    2. 加密包：scrypt 派生 + 分块解密
    3. 读 manifest → 逐条目校验（路径、大小、sha256）→ 写入新工程目录
    4. 校验画布合法（复用 clone.ts 的规则）
    5. 失败：整目录删除
  前端：完成后刷新工程列表并打开
```

## 2. 容器格式 v1（`.tfproj`）

### 2.1 文件头（固定 64 字节，永远明文）

| 偏移 | 长度 | 字段 | 说明 |
| --- | --- | --- | --- |
| 0 | 8 | magic | `TFPROJ\0\0`（`54 46 50 52 4F 4A 00 00`） |
| 8 | 2 | version | `1`（大端 uint16） |
| 10 | 2 | flags | bit0 = 加密，其余保留必须为 0 |
| 12 | 4 | chunkSize | 加密分块大小（明文填 0） |
| 16 | 8 | payloadSize | **负载字节数**：明文包 = 文件总长 − 64；加密包 = 密文总长（含所有 tag） |
| 24 | 16 | salt | 加密时 scrypt 的 salt；明文全 0 |
| 40 | 12 | nonce | 加密时 GCM 的 nonce 基串；明文全 0 |
| 52 | 12 | reserved | 必须为 0 |

> 加密时不泄露文件名：manifest 在负载内部，头部只有 KDF 参数与长度。
> `payloadSize` 明确定义为「头部之后的字节数」，明文/密文各自成立——不再出现「末条用 payloadSize 收口」这种既依赖明文又依赖密文的算法。

### 2.2 负载（解密后的明文）

```
[uint32 manifestLen][manifest JSON (UTF-8)][entry 0][entry 1]...
```

`manifest`：

```jsonc
{
  "format": "tfpak",
  "version": 1,
  "createdAt": "2026-10-31T10:20:00.000Z",
  "appVersion": "x.y.z",
  "project": { "name": "我的工程" },
  "canvases": ["画布1.json"],
  "stats": { "fileCount": 128, "bytes": 41234567, "compressed": 96 },
  "entries": [
    { "path": "画布1.json", "offset": 0, "size": 8123, "storedSize": 1904, "sha256": "...", "codec": "deflate" },
    { "path": "assets/8f2c.../v1.mp4", "offset": 1904, "size": 3120000, "storedSize": 3120000, "sha256": "...", "codec": "store" }
  ]
}
```

- **每条显式存 `storedSize`**，不再靠下一条 offset 推断——加密后密文长度 ≠ 明文长度，推断必然错。
- `codec: "store"`：媒体文件直接存储（已压缩格式再 deflate 收益 ≈0，且能随机访问、省一次全量解压），`storedSize === size`。
- `codec: "deflate"`：只用于 `.json` / `.md` / `.txt` / 无扩展名小文件。**这些文件在写 manifest 之前先整体压进内存**（它们很小），从而 `storedSize` 在写 manifest 时已知；媒体则边读边写，不需要长度预估。
- **解压炸弹防线是显式校验，不是 `decompressSync` 的 `out` 参数**：实测 `fflate` 传 `out` 时 `resize=false`，越界写入被**静默丢弃**、返回截断后的 subarray，不抛异常。因此必须：分配 `size` 缓冲 → 解压 → 比对 `result.length === size` → 再比对 sha256，任一不符即拒绝。

### 2.3 加密（flag bit0）

- KDF：`crypto.scrypt(password, salt16, 32, { N: 2^15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 })`。
  - **`maxmem` 必须显式给**：N=2^15/r=8 的理论内存需求约 32 MiB，恰好顶到 Node 默认上限，不传直接抛 `ERR_CRYPTO_INVALID_SCRYPT_PARAMS`（实测，Bun 1.3.11）；这不是优化项。
  - 实测派生耗时 35–44 ms；AES-256-GCM 对 128 MiB 加密 23 ms / 解密 18 ms。
- 分块 AEAD（STREAM 构造，避免大文件整块入内存）：
  - 每 4 MiB 一块，nonce = 12 字节 GCM nonce 的前 4 字节 + 8 字节块计数器；
  - 每块 AAD = 块序号（BE64），防重排；
  - 末块额外附加一个「最后一块」标记块（0 长度 AAD 不同），防截断；
  - 最后一块的 tag 即整包 tag。
- 口令错误 → 首块 GCM tag 校验失败 → 返回明确的「口令错误」，**不建任何目录**。

## 3. 引用收集（R4）

服务端扫描，纯函数 `collectShareFiles(canvasJson)`。**不是「引用即保留」——历史指针也是引用**，按引用收集会把 `crop.previous` 的旧图一并带进包，等于历史没删掉。按字段分三级：

| 级别 | 字段 | 处置 |
| --- | --- | --- |
| ① 展示必需 | `outputs.*.value.url`、`textPath`、`modelPath`、`frameAnalysis.source/resultSource/lastResult.scenes[].image/video/audio`、`frameAnalysisResult.manifest`、**文本正文 markdown 里的图片** | 收集；**文件缺失 → 中止导出**（`textPath` 尤其不能容忍：`content.md` 是正文唯一载体，指针丢了会用空串重建并静默覆盖正文） |
| ② 历史可回退 | `crop.last/previous/appliedUrl`、`scale.previous/appliedUrl`、`inpaint.*` | **不收集，字段整块删除** |
| ③ 可重建 | 缩略图、`cache/thumbs` | 不收集 |

- ① 内的目录型产物（`assets/<id>/analysis<hash>/`）由其内部文件被逐条引用而自然收全；未被引用的 analysis 目录整体丢弃。
- **文本节点插图**：路径既不在 `node.data` 里、也不一定以 `assets/` 开头，必须解析 `content.md` 的 markdown 图片语法后再做路径解析。
- 对外部/全局库路径（旧画布残留的 `assets/<rel>` 指全局库、跨项目粘贴失败的残留引用）单独收集成 `missing[]`，导出完成时列出——不静默丢弃。

## 4. 画布 JSON 清理（R5）

对每个画布 JSON 做纯函数变换 `sanitizeCanvasForShare(json, keptFiles)`：

1. 删除 `data.agentSessionFile` / `data.agentSessionCloneFrom`（会话不导出）。
2. 删除 ② 类字段：`crop.previous` / `crop.appliedUrl` / `scale.previous` / `scale.appliedUrl` 逐字段删；**`inpaint` 必须整个对象删或整个保留**——`source/original/guide/mask/images` 缺一个就会在生成时抛「局部重绘素材无效」（`imageInpaint.ts:30-33`）。
3. **`textPath` / `modelPath` 永不删除**；对应文件不在 `keptFiles` 里就直接中止导出。
4. **压缩换格式时同步改写**：`内容路径 → 新扩展名`，以及 `outputs[handle].value.mimeType`（webm→`video/mp4`、png→`image/jpeg`）。不改 mimeType 会让 Blob 按旧类型包装，WKWebView 拒绝播放。
5. 保留 `disabled`、便签、分组、`viewport`、节点位置尺寸。
6. 不做节点 ID 重映射（导入永远是独立工程，ID 不冲突）。
7. 写入 manifest 的 `canvases` 列表。

## 5. 媒体压缩（R6）

对 `keptFiles` 里扩展名属于图片/视频的文件，串行队列并发 2：

| 类型 | 处理 | 参数 |
| --- | --- | --- |
| 视频（mp4/mov/m4v/webm/mkv） | 转 MP4 H.264（**输出改名 `.mp4` 并改写画布路径+mimeType**） | `-c:v libx264 -preset veryfast -crf 24 -pix_fmt yuv420p`，滤镜值 **`scale='trunc(min(1920,iw)/2)*2':-2`**（单个 argv；内层单引号是 **FFmpeg 自身的参数引用**，不能省——去掉后 filterchain 会按逗号截断，报 `No such filter`）+ `-c:a aac -b:a 128k -ac 2` + `-movflags +faststart` + `-fps_mode passthrough`；保留原帧率与音轨 |
| 图片 png/jpg/jpeg/webp（静态） | 最长边 ≤2048，**含 alpha 的保留 PNG/WebP（仅缩放，扩展名不变）**，其余转 JPEG（**改名 `.jpg` 并改写画布**） | `scale='min(2048,iw)':'min(2048,ih)':force_original_aspect_ratio=decrease` + `-q:v 3`（同样需要内层引号）；`yuv420p` 类参数不用于图片 |
| GIF/APNG/动态 WebP、SVG、TIFF | 跳过 | — |
| 音频 | 不压 | — |
| 其他（.md/.json/模型） | 不压 | — |

- **奇数尺寸**：`scale=...:-2` 只保证高度偶数；宽度必须自己算成偶数（`trunc(.../2)*2`），否则 `641x361` 这类源会直接报 `width not divisible by 2` 而整包中止（实测）。实测压缩后 165,616 B → 11,631 B（7.0%）。
- **alpha 判定不能靠 pix_fmt**：调色板 PNG 带 `tRNS` 时 `ffprobe` 只报 `pal8`，按 `pix_fmt` 嗅探会漏，进而静默把透明区转成实色（实测透明黑 → `fe0000`，退出码 0、无告警）。可靠做法：**解码首帧到 `rgba` 后扫 alpha 字节**，存在 <255 即视为含 alpha。
- **换格式必须改名**：`.webm/.mkv/.ogv → .mp4`、`.png → .jpg`，同时改写画布里的路径与 `mimeType`。**不能覆盖同名文件**——画布按声明的 `mimeType` 包装 Blob（`apps/web/src/lib/workspaceFiles.ts:55-62`），声明 `video/webm` 而字节是 MP4 时 WKWebView 直接 `SRC_NOT_SUPPORTED`。同格式（mp4→mp4、jpg→jpg）才覆盖同名。
- 压缩后若体积反而变大 → 保留原文件（记录 `skippedLarger`）。
- 压缩前 `ffprobe` 读时长/宽高/旋转；旋转素材依赖 ffmpeg 默认 `-autorotate`。
- 前置检查（R7）：`getToolStatus` 两件全就绪 + `availableEncoders` 含 `libx264`；否则**导出接口直接 409 拒绝**，前端弹「去设置安装」。
- 单文件失败（R8）：**整包中止**，删除 staging，返回失败文件名。

## 6. staging 与 ffmpeg 沙箱

- staging 放 **工程目录内**：`<project>/.toonflow/share-<uuid>/`。
  - 理由：`createWorkspaceFfmpeg(cwd)` 把显式路径限制在工厂根内（`packages/ffmpeg/src/runtime.ts:22-55`）；放工程内即天然满足。
  - `.toonflow` 本来就已在文件树隐藏与保护名单里（`localRuntime/workspace/files.ts:105`、`routes/workspaces/files/list.ts:17`），**不需要额外改造**。
- 结束（成功/失败/取消）都 `rm -rf` staging。进程崩溃残留无法在启动时清扫——服务器没有「已打开工程列表」（`app.ts` 不知道用户开过哪些目录），改为**工程打开时清扫该工程下的 `.toonflow/share-*`**。

## 7. 打包与写入

- 顺序写：先写 64 字节占位头 → 写 manifest（此时所有 `storedSize` 已知）→ 逐条写 entry → 回填 `payloadSize`。
- 未加密：直接写入目标位置的临时名 `*.part`，完成后 `rename`。
- 加密：边写边加密到 `*.part`，最后追加末块 tag。
- **目标路径不走网络**（否则等于把任意写文件能力暴露给前端）：前端先调 `/api/desktop/selectSaveFile`，主进程把路径留在 pending 表里、只回一个一次性 token（TTL 5 分钟，`apps/desktop/src/saveFile.ts:12,31,50`）；导出请求带 `saveToken`，服务端在写入前用新增的 `DesktopRuntime.takeSaveTarget(token)` 换取真实路径并即时作废。
  - 不能用现有 `/api/desktop/saveFile` 落盘：它用 `express.raw({ limit: "100mb" })` 把整包读进内存（`routes/desktop/saveFile.ts:11`），500MB 的包直接 413。

## 8. 导入

### 8.1 两条入口两条通道

| 入口 | 拿到的东西 | 传输 | 理由 |
| --- | --- | --- | --- |
| 首页「导入工程…」 | 原生对话框给的**真实路径** | 服务端直接读盘 | 无中转、无大小限制 |
| 拖 `.tfproj` 到首页 / 工程页 | 只有 `File` 对象 | **流式上传到临时文件**，再按路径走同一套处理 | WKWebView 不给路径（Electrobun 只实现了拖放后的焦点恢复，`preload/externalDropFocus.ts`） |

- 需要新增 `/api/desktop/selectFile`（打开文件对话框），现有只有 `selectSaveFile` / `selectDirectory`。
- 上传路由 **不挂 `express.raw`**：`req` 直接 `pipe` 到 `<data>/tmp/import-<uuid>.tfproj`，边写边校验魔数；超过 2 GiB 中断并删除。上传完成后与「直接读盘」分支汇合到同一个 `importFromPath()`。
- 拖拽侧前端：`dragover`/`drop` + `dataTransfer.files`，按扩展名 `.tfproj` 预过滤，非本格式立即提示；首页已有的 drop 处理（`apps/web/src/pages/home/index.vue:382`）需要区分「媒体附件」与「工程包」两种类型。
- **授权边界**：`getRuntimePlatform().local` 在 macOS 开发服务器上也是 `true`（`lib/platform.ts:18`），**不能当「桌面端」判据**。正确判据是 `req.app.locals.desktop`（`lib/desktop.ts:5`，`app.ts:59` 挂在 `/api/desktop` 前缀）。故新路由 `/api/desktop/selectFile` 天然受三道校验；`share/import` 必须显式 `assertAppRequest` 且仅在 desktop 下接受绝对路径，服务器/移动端一律拒绝。

### 8.2 校验与落盘

1. **选文件**：路径随请求传服务端（对话框分支）。
2. **校验链**：
   - 头部魔数/版本/flags/chunkSize；`payloadSize` ≤ 2 GiB。
   - 条目数 ≤ 5000；单条 `size` ≤ 1 GiB；总解码大小 ≤ 2 GiB。
   - 路径：拒绝绝对路径、盘符、`..`、控制字符、反斜杠，并拒绝 Windows 保留名（`CON`/`NUL`/`AUX`/`COM1`…）；统一 `/`。**复用 `resolveWorkspacePath`（`localRuntime/workspace/files.ts:72`）而不是 `workspaceMediaPath`**——后者是给 ffmpeg 入参用的，不覆盖保留名与符号链接。
   - 每个条目 sha256 必须与 manifest 一致。
   - 必须至少含 1 个合法画布（复用 `routes/workspaces/clone.ts:40-58` 的校验规则）。
3. **落盘**：`<workspaces>/<name>-<8位>` 唯一目录；先写 `*.partial` 再整体 rename 发布（与 `copyCanvasFiles` 的发布语义一致）。
4. **失败**：整目录删除；口令错误在建目录前就失败。
5. **工程根标记（R20）**：必须一并写入 `.toonflow/ui.json` 与 `library/.library/index.json`。
   - 缺 `.toonflow/` → 同源缩略图校验不过（`localRuntime/workspace/index.ts:23-35`），导入后视频封面破图，直到第一次保存画布才生成 `ui.json`。
   - 缺 `library/.library/index.json` → 项目素材库根判定失败，静默降级到新建的空 `library-assets`（`assetLibrary/assets/roots.ts:116-149`），分享过去的库文件在素材面板里消失。
6. **后处理（R14）**：扫描画布引用的 `modelId/providerId` 与本机模型清单比对，**同时**比对节点类型 `remote-*Node` 是否已安装（缺插件目前只渲染永久 loading 占位，无任何文案，`canvas/index.ts:63-65`），合并成一个可关闭横幅。

## 9. ffmpeg 来源解析改造（R17）

`packages/ffmpeg/src/index.ts` 的 `getToolStatus` 增加候选目录：

```
candidates = [
  downloaded,                        // <data>/ffmpeg/<target>/ffmpeg   (mode !== system)
  ...extraDirs,                      // 新增
  Bun.which(executableName(name))    // mode !== download
]
extraDirs（darwin）: /opt/homebrew/bin, /usr/local/bin, /opt/local/bin, ~/.local/bin
extraDirs（win32）: %ProgramFiles%\ffmpeg\bin, %LOCALAPPDATA%\Microsoft\WinGet\Links
extraDirs（linux）: /usr/local/bin, /usr/bin, /snap/bin
```

- **不修改 `process.env.PATH`**：`packages/tools/browser/src/host.ts:78` 也读 PATH，全局改动会外溢。
- 探测顺序不变：应用内下载优先（`auto`），再候选目录。
- 改动面很小：`getToolStatus` 全仓只有 1 个调用方（`mediaGeneration/ffmpeg/index.ts:44-48`），新增参数做成可选即非破坏；设置页 `origin: "system"` 已被渲染成「系统安装版」（`ffmpeg.vue:81`），UI 不用改。
- 另需新写一个 `availableEncoders` 的宿主侧调用——仓库目前只在浏览器白名单里暴露了它，宿主内部从未真正用过（`browserTypes.ts:26-27` 仅是能力声明）。

## 10. 接口

| 方法 | 路由 | 说明 |
| --- | --- | --- |
| POST | `/api/workspaces/share/export` | body `{ directory, password?, savePath }` → `{ taskId }` |
| GET | `/api/workspaces/share/status?id=` | `{ phase, done, total, bytes, currentFile, missing[], skippedLarger[], error }` |
| POST | `/api/workspaces/share/cancel` | 取消（AbortController） |
| POST | `/api/workspaces/share/import` | body `{ filePath }` → `{ taskId }`（对话框入口） |
| PUT | `/api/workspaces/share/upload` | `application/octet-stream` 流式落到临时文件 → `{ tempPath }`（拖拽入口） |
| POST | `/api/desktop/selectFile` | 新增，打开文件对话框（`filters: .tfproj`） |

任务表 **不能直接复用** `mediaGeneration/media/tasks.ts`（只有 60 行、无进度字段），照抄它的形态（内存 Map、结束 5 分钟清理、上限 1000）另写一份，额外带 `{ phase, done, total, bytes, currentFile, missing[], skippedLarger[] }`。

## 11. UI

- 首页工程卡片右键：「分享工程…」。
- 弹窗：口令（可空，留空即明文）→ 选择保存位置 → 进度条（百分比 + 当前文件 + 已压缩字节）→ 可取消 → 完成（附 `missing[]` / `skippedLarger[]` 清单）。
- 首页「导入工程…」：选文件 → 进度 → 完成打开；等同一条路径上的拖放区（拖 `.tfproj` 进来即触发）。
- 工程页：整页可接收 `.tfproj` 拖放（与画布现有的媒体拖放互不干扰，按扩展名分流）。
- 缺 ffmpeg：导出入口点击后直接提示「需要 FFmpeg」+ 跳转设置。

## 12. 验证

| 用例 | 期望 |
| --- | --- |
| 往返一致性 | 明文包导出→导入，画布 JSON、未压缩文件逐字节一致 |
| 历史裁剪 | 节点历史弹窗（导入后）为空；拉片分镜/3D 模型/文本正文仍在 |
| 压缩生效 | 样例 20s 视频 40MB→3–5MB；导入后能播放、能截首尾帧、能提取音轨 |
| 加密 | 明文/加密两种包都能导入；错误口令报「口令错误」且无目录残留 |
| 安全 | 穿越路径、超大条目、条目数超限、sha256 不符、魔数错误全部拒绝且无落盘 |
| 取消 | 导出中途取消，staging 与 `*.part` 都被清理 |
| 缺 ffmpeg | 拒绝导出，无任务创建、无 staging |
| Homebrew ffmpeg | 删掉应用内下载的二进制后，仍识别 `origin=system` |
| 奇数宽视频 | 641×361 源压缩成功（不报 `width not divisible by 2`） |
| 透明 PNG | 透明区在导入后仍透明（不被转成实色） |
| 加密分块 | 0 字节 / 单块 / 跨块 / 恰好整块边界 四种长度往返一致 |
| 拖拽 500MB 包 | 内存不出现等量尖峰；完成后临时文件已删 |
| saveToken 过期 | 超过 5 分钟再导出，明确报「保存位置已失效」，不产生半截文件 |
| 格式互换 | webm 源压缩后改名 `.mp4` 且画布 mimeType 同步；导入后能播放 |
| PNG→JPEG | 改名 `.jpg`，画布路径与 mimeType 同步；含 alpha 的不转 |
| 文本插图 | 含 3 张 markdown 插图的文本节点，导入后图片仍在 |
| 素材库标记 | 导入后素材库面板能看到被引用的库文件，不是空目录 |
| 缺节点插件 | 打开含未安装节点类型的工程，有明确文案而非永久 loading |

## 13. 风险与回退

| 风险 | 处置 |
| --- | --- |
| 压缩链有损，接收方重跑结果不同 | 导出弹窗明示；不提供「无损」档 |
| 大工程内存 | 媒体 `store` 不经过 deflate；加密分块；导入按条目流式写盘 |
| 加密分块实现出错 → 大文件损坏 | 单测覆盖 0 字节 / 单块 / 跨块 / 空文件；末尾追加整包 sha256 二次校验 |
| ffmpeg 编码器缺失（系统版无 libx264） | 前置 `availableEncoders` 检查，缺失即拒绝并提示应用内下载 |
| `.toonflow/share-*` 出现在文件树 | `files/list` 过滤 + 启动清扫 |
| 新增 `selectFile` 路由的路径信任 | 仅桌面端可用（`desktop` 平台判定），服务端只读该路径，不写入 |

## 14. 待定（实现前需拍板）

1. ~~扩展名与文件关联~~：已定 `.tfproj`，不注册文件关联，靠首页/工程页拖放与导入入口。
2. scrypt N=2^15 在本机大文件上的实际耗时（测试文档记录后确认）。
3. 压缩档位是否需要在设置里开一个「分享压缩」高级项（当前决定：写死）。

## 15. 方案评审（子 agent，2026-10-31 10:50）

- 报告：`review-2026-10-31-1050-solution.md`（脚本与实测输出在 `$CLAUDE_JOB_DIR/tmp/`）

| # | 意见 | 处置 |
| --- | --- | --- |
| P0-1 | `selectSaveFile` 只回一次性 token、路径留在主进程；`/api/desktop/saveFile` 用 `raw(100mb)` 全量入内存 | 采纳：导出改收 `saveToken`，新增 `DesktopRuntime.takeSaveTarget(token)`；不用 saveFile 落盘 |
| P1-1 | 视频滤镜在奇数宽源失败；单文件失败会放大成整包中止 | 采纳滤镜修正（`trunc(min(1920,iw)/2)*2`，单 argv 不带引号）；**失败仍中止**——这是用户明确选择，靠修正滤镜消除诱因 |
| P1-2 | 透明 PNG 转 JPEG 静默丢 alpha；按 pix_fmt 嗅探会漏 `pal8+tRNS` | 采纳：解码首帧到 rgba 扫 alpha |
| P1-3 | `decompressSync(out)` 不报错只静默截断，不能当解压炸弹防线 | 采纳：显式比对 `length` 与 `sha256` |
| P1-4 | 容器自相矛盾：密文长度≠明文长度、`storedSize` 靠推断拿不到、流式 deflate 提前未知长度 | 采纳：每条显式存 `storedSize`；小文本先压进内存；`payloadSize` 明确定义为「头部之后字节数」 |
| P1-5 | scrypt 不传 `maxmem` 直接抛错（默认 32MiB 恰好卡边界） | 采纳：`maxmem: 128MiB`，实测 35–44ms |
| P1-6 | `.toonflow` 已在文件树隐藏；但无启动清扫挂载点 | 采纳：删掉多余的隐藏改造；改为工程打开时清扫 `.toonflow/share-*` |
| P1-7 | `platform.local` 不能当桌面端判据 | 采纳：用 `req.app.locals.desktop` + `assertAppRequest` |
| P2-a | `availableEncoders` 宿主侧从未真正调用 | 采纳：新写宿主侧探测 |
| P2-b | `getToolStatus` 只有 1 个调用方、origin UI 已有 | 采纳：可选参数，UI 不改 |
| P2-c | `workspaceMediaPath` 不拒 Windows 保留名 | 采纳：改用 `resolveWorkspacePath` |
| P2-d | `tasks.ts` 不能直接复用 | 采纳：照抄形态另写，带进度字段 |
| P2-e | 文档里 `usage.ts:259` 引错 | 已改为 `matchCanvasValue`（`usage.ts:52`） |


## 16. 需求评审（子 agent，2026-10-31 10:50）

- 报告：`review-2026-10-31-1050-requirements.md`

| # | 意见 | 处置 |
| --- | --- | --- |
| P0-1 | 压缩换格式却覆盖同名文件、画布 mimeType 仍是旧格式 → WKWebView 不播 | 采纳：换格式必须改名 + 改写路径与 mimeType（§4.4、§5） |
| P1-2 | R4「按引用收集」会把 `crop.previous` 的旧图一并保留，历史没删掉 | 采纳：改为字段三级分类（§3） |
| P1-3 | 没带 `library/.library/index.json`，导入后素材库根判定失败、静默建空库 | 采纳：R20 + §8.2 第 5 条 |
| P1-4 | 没带 `.toonflow/`，首开画布同源缩略图校验不过、视频封面破图 | 采纳：同上 |
| P1-5 | R14 只覆盖模型缺失，没覆盖节点插件缺失（永久 loading） | 采纳：R14 与 §8.2 第 6 条合并三类提示 |
| P1-6 | `data.inpaint` 不能逐字段删 | 采纳：整个对象删或整个留（§4.2） |
| P1-7 | `textPath` 不能删，否则空串重建覆盖正文 | 采纳：§4.3 永不删除，缺文件即中止 |
| P1-8 | 文本正文 markdown 图片不在扫描范围 | 采纳：R21 + §3 |
| P2 | R12 的 512MB 与 R19 的 2GiB 不一致 | 采纳：统一 2 GiB |

## 17. 代码审查（子 agent，2026-10-31 11:10）

- 报告：`review-2026-10-31-1110-share-code.md`（0 P0 遗留 / 3 P1 / 12 P2）

| # | 意见 | 处置 |
| --- | --- | --- |
| P0 | 拖拽导入加密包必然失败：口令错误后临时包被删，重试 404 | 采纳：口令错误（`SHARE_PASSWORD`）时保留临时包，改由带 1 小时 TTL 的上传入口清扫 |
| P1-1 | 画布引用可含 `..`，工程外文件被打进包、且产出的包无法导入 | 采纳：所有引用统一走 `resolveRef()`（拒绝 `..`／绝对路径／scheme，`isWithin` 校验，且必须是普通文件） |
| P1-2 | 导入探测画布时把每个 `.json` 整体读进内存 | 采纳：按 `entry.size ≤ 20 MB` 且不在 `assets/library` 下才探测；单条上限收紧到 1 GiB |
| P1-3 | import 路由缺桌面端判定，服务器部署接受任意绝对路径；export 在服务器模式 500 | 采纳：两个路由都显式判 `req.app.locals.desktop`，返回可读的 404 |
| P2 | 压缩并发 2 未实现 | 采纳：`mapLimit(2)`，进度计数并发安全 |
| P2 | 换格式改名可能撞上同目录已有文件 | 采纳：`uniquePath()` 保证包内唯一；同扩展名（png→png）不算撞车（首轮实现过严，已修） |
| P2 | 打包阶段不再校验内容哈希 | 采纳：导出全程 `lockWorkspaceFiles([root])`，避免编辑器/Agent 并发改写 |
| P2 | 导入直接以最终目录名落盘 | 采纳：先写 `<name>.partial-<rand>`，校验通过后 `rename` 发布 |
| P2 | 崩溃残留的 `.toonflow/share-*` 无清扫点 | 采纳：导出开始时清扫超过 24 小时的 `share-*` |
| P2 | 状态接口每次轮询都返回完整 manifest | 采纳：状态响应剔除 `entries` |
| P2 | `stats.compressed` 被当字节数展示 | 采纳：前端改为「其中 N 个文本条目已压缩」 |
| P2 | 恶意 manifest 让 `sanitizeName` 崩成 500 | 采纳：`String(name ?? "")` |
| P2 | `findCanvases` 先全量读再判大小 | 采纳：先 `stat` 再读；排除项补 `.agent` |
| P2 | `useShareFileDrop` 拦截所有单文件拖入 | 部分采纳：仍然拦 dragover（否则 drop 不派发），但只在确认是 `.tfproj` 时显示遮罩；非分享文件 drop 时不 stopPropagation |
| P2 | markdown 改写用 `split/join` | 保留：raw 串来自同一文档，替换精确匹配即可；尖括号写法已包含在 raw 中 |
| P2 | 测试只覆盖纯函数层 | 记录：编排层由一次性端到端脚本验证（本轮已验证，脚本未入库） |

## 18. 子 agent 交付报告回填（2026-10-31 12:10）

三条与实现相关的修正，均以代码与实测为准：

| 项 | 结论 |
| --- | --- |
| 滤镜写法 | 任务书里「不带引号」是错的：`scale=trunc(min(1920,iw)/2)*2:-2` 即使作为单个 argv 也会被 filterchain 的逗号截断，报 `No such filter`。正确写法是 `scale='trunc(min(1920,iw)/2)*2':-2`——**内层单引号是 FFmpeg 自身的参数引用**。图片同理。实现与集成测试已按带引号版本钉死。 |
| 容器 `offset` 语义 | `types.ts` 注释与实现不一致：实现为「相对 manifest 之后的条目数据区起点，首条为 0」，否则 manifestLen 与 offset 互相依赖。注释已更正。 |
| markdown 路径解析 | 采用仓库既有语义 `decodeURIComponent(source.split(/[?#]/)[0])`（**先截断再解码**），与 `textNode/src/markdownContent.ts:22-36` 一致。 |
| `useShareDrop` | 修正：`dragover` 只在确认或可能的单文件拖入时 `preventDefault`（否则 drop 不派发），但**不再 `stopPropagation`**——那会让画布/素材库/输入框的拖放高亮全部失效。 |
| 容器缓存 | 导入按条目 `extract` 时，`manifestLength` 与终止块校验原本每条重算一次（每条最多 4 MiB 解密）。按「路径 + size + mtime + 口令」缓存，最多 8 条。 |
