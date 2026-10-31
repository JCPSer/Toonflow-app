# 需求矩阵：工程分享包（导出 / 导入）

- 时间：2026-10-31 09:40（v1，经 Grill 逐题确认）
- 提出人：liyuhang
- 模块：服务端工程打包/解包（新增 `apps/server/src/routes/workspaces/share/*`）、首页工程列表（`apps/web/src/pages/home/*`、`apps/web/src/stores/workspace.ts`）、宿主 ffmpeg（`apps/server/src/modules/mediaGeneration/ffmpeg`）
- 代码基线：`feat/exec-node`（`783aeda`）

## 1. 需求背景

希望把本地工程「分享出去」：别人拿到一个文件就能导入并继续编辑。原始工程体积主要来自节点历史素材（每次生成都落一份完整媒体），必须裁剪；图片视频还需再压一轮。

用户原始想法（2026-10-31）：

> 分享出去的图片和视频都要经过压缩，画布里节点的历史记录都要删除，仅保留当前节点展示的媒体……最后尽量压缩工程体积，导出一个自定义格式的文件（我建议是压缩文件套壳带加密），然后支持这个文件格式的导入。

### 1.1 仓库现状（已核实）

| 事实 | 依据 |
| --- | --- |
| 工程 = 一个普通目录，**没有 project.json / 元信息文件**，目录绝对路径即身份 | `apps/server/src/modules/localRuntime/workspace/index.ts:18-68` |
| 画布 = 任意层级带 `toonflowCanvas: true` 的 `*.json` | `apps/web/src/pages/workspace/canvasFile.ts:44-60` |
| 项目名/最近打开只在前端 localStorage；封面运行时扫 `assets` 首图 | `apps/web/src/stores/workspace.ts:6-10`、`home/projectCover.vue:38-52` |
| 节点历史 = `assets/<nodeId>/` 下的文件堆积，**每次生成写新文件、不引用不复用** | `mediaGeneration/media/generation.ts:216-225` |
| 当前展示值只是画布 JSON 里的 `node.data.outputs[handle].value.url` 指针 | `nodeScaffold/src/nodeSkeleton.vue:758-762` |
| 媒体路径字段远不止 `outputs`：`textPath`、`modelPath`、`inpaint.guide`、`crop.previous/appliedUrl`、`frameAnalysis.source/scenes[]`、`agentSessionFile` | 见 R4 的收集清单 |
| Agent 历史 = `.agent/sessions/*.jsonl` + `goals/` + `artifacts/` + `attachments/` | `agent/runtime/sessions.ts:544`、`toolOutput.ts:36`、`imageAttachments.ts:45` |
| 已有导入通道只有「HTTPS URL 拉 ZIP 克隆」，**无本地文件导入、无导出** | `routes/workspaces/clone.ts:15-95` |
| 现成 ZIP 解析器**主动拒绝加密 ZIP**（`flags & ~0x080e`） | `pluginMarket/plugins/install.ts:259` |
| 仓库无任何加密依赖，只有 `node:crypto` | `apps/server/package.json` |
| 仓库**不内置 ffmpeg 二进制**，运行时下载或系统 PATH；缺失抛 `FFMPEG_REQUIRED`（424） | `packages/ffmpeg/src/catalog.ts:8,115`、`mediaGeneration/ffmpeg/index.ts:22-31` |
| 服务端无 sharp/jimp，图片处理也只能走 ffmpeg | `apps/server/package.json` |
| ffmpeg 显式路径被沙箱限制在工厂根目录内 | `packages/ffmpeg/src/runtime.ts:22-55` |
| 现有 fflate 打包是**内存式**，导入侧有 512MB 上限 | `routes/plugins/export.ts:23`、`clone.ts:31` |

## 2. 需求目标

1. 从首页工程列表导出**可编辑工程副本**，接收方导入后节点、连线、提示词、当前媒体齐全，能接着改、能重新跑。
2. 包内只保留被引用的媒体，剔除全部历史素材与会话。
3. 图片/视频按固定标准档重新编码，显著减小体积。
4. 自定义容器格式：压缩 + 可选口令加密，单文件交付。
5. 导入侧安全：路径穿越、解压炸弹、超大包、版本不兼容都要挡住。

## 3. 非目标（本次不做）

- **不做只读演示形态**（仅带画布截图与成片）。
- 不做分享链接上传、云端分发、增量更新、多次分享的差异包。
- 不做「导入合并进当前工程」——导入永远新建独立目录。
- 不导出项目素材库全量（只带被引用文件）、不导出 `.agent/` 会话。
- 不做加密抗逆向（口令只防「顺手一看」，不防有意分析）。
- 不做跨版本迁移（v1 只认 v1；后续版本再议）。
- 不改现有云端克隆链路（`/api/workspaces/clone`）。

## 4. 需求矩阵

| 编号 | 需求描述 | 优先级 | 难度 | 风险 | 验收标准 |
| --- | --- | --- | --- | --- | --- |
| R1 | **容器格式**：魔数 + 版本号 + 标志位；主体为「manifest + 条目」的流式归档；可选整体 AES-256-GCM（scrypt 派生密钥）。**扩展名 `.tfproj`**，不做系统文件关联（不注册双击打开） | P0 | 高 | 中 | 同一工程导出→导入后画布与媒体逐字节一致（不含压缩媒体时）；文件头可被 `file`/`xxd` 识别为自定义格式而非 ZIP |
| R2 | **导出入口**：仅首页工程列表的工程卡片右键菜单「分享工程…」 | P0 | 低 | 低 | 右键可见；未选中工程时不出现 |
| R3 | **导出内容**：所有 `*.json` 画布 + 被引用媒体 + `manifest.json`；**排除** `.agent/`、`library/` 全量、`.trash/`、全局缩略图缓存、`.toonflowCopy*`、`.easyvibe`、`cache/thumbs` | P0 | 中 | 中 | 导出包内不含任何会话文件；`library/` 只出现被引用文件 |
| R4 | **历史裁剪口径 = 字段三级分类**（不能「按引用收集」一刀切，否则 `crop.previous` 这类历史指针会把旧图一并带进包）：① **展示必需**——`outputs.*.value.url`、`textPath`、`modelPath`、`frameAnalysis.*`、`frameAnalysisResult.*`、文本正文里 markdown 引用的图片：收集且必须存在，缺了就中止导出；② **历史可回退**——`crop.last/previous/appliedUrl`、`scale.previous/appliedUrl`、`inpaint.*`：**不收集，连同字段整块删除**；③ **可重建**——缩略图、缓存：不收集。`assets/<nodeId>/` 下未被①引用的文件全部丢弃 | P0 | 中 | 中 | 拉片分镜卡片、3D 模型、文本正文导入后仍可正常显示；裁剪「恢复上一张」按钮消失但节点不报错；节点目录只剩展示必需文件 |
| R5 | **画布 JSON 清理**：剥离 `agentSessionFile`/`agentSessionCloneFrom`；删除 R4 的②类字段**整块**（`crop` 里只去掉 `previous/appliedUrl`，`inpaint` **整个对象删或整个留**——`source/original/guide/mask/images` 缺一个就会在生成时抛「局部重绘素材无效」）；保留 `disabled`、便签、分组、`viewport`；压缩换格式的路径与 `mimeType` 同步改写 | P0 | 中 | 中 | 导入后无指向不存在文件的字段；`textPath` 永不被删；画布结构与导出方一致（除上述字段） |
| R6 | **媒体压缩（固定标准档）**：视频 `libx264 CRF 24` + 最长边 ≤1080p + AAC 128k + 保留源帧率与音轨 + `+faststart` + `yuv420p` + pad 偶数；图片最长边 ≤2048 + JPEG `-q:v 3`；带 alpha 的保留 PNG/WebP；GIF/APNG/动态 WebP、SVG、TIFF 跳过。**换格式必须改扩展名并同步改写画布里的路径与 `mimeType`**（webm/mkv/ogv → .mp4、PNG → .jpg），不能「覆盖同名文件」——画布按 `mimeType` 包装 Blob，声明与实际字节不符时 WKWebView 直接 `SRC_NOT_SUPPORTED` | P0 | 中 | 高 | 20s/1600×2112 样例视频从 40MB 级降到 3–5MB；webm 源导入后能正常播放、截首尾帧、提取音轨 |
| R7 | **压缩前置检查**：导出前确认 ffmpeg 可用且含 `libx264`；不满足 → **拒绝导出**并引导安装 | P0 | 低 | 低 | 无 ffmpeg 时点击导出立刻报错，不产生任何临时目录 |
| R8 | **压缩失败处理**：任一文件压缩失败 → **中止整包导出**、清理 staging、报错并指出文件名 | P0 | 低 | 低 | 人为破坏一个文件后导出失败，staging 目录无残留 |
| R9 | **加密为可选**：口令留空 = 明文 + sha256 校验；填了口令 = scrypt(N=2^15 起) 派生 + AES-256-GCM；容器头一个标志位区分 | P0 | 中 | 中 | 明文包与加密包都能导入；错误口令给出明确「口令错误」而非「文件损坏」 |
| R10 | **导出为异步任务**：进度（文件数 + 字节）、可取消、完成后选保存位置 | P0 | 中 | 中 | 导出中可取消且临时目录被清理；UI 有百分比 |
| R11 | **导入入口两个**：① 首页「导入工程…」→ 原生文件对话框（拿真实路径，服务端直接读盘，无大小中转）；② **把 `.tfproj` 拖到首页或工程页**（WKWebView 只给 `File` 对象、拿不到路径 → 走流式上传到临时文件再按路径处理）。**总是新建独立工程目录**，重名自动加后缀，永不覆盖 | P0 | 中 | 中 | 连续导入两次得到两个工程；同名工程不丢数据；两条入口行为一致 |
| R20 | **工程根标记随包携带**：必须带 `.toonflow/`（至少 `ui.json`）与 `library/.library/index.json`。缺前者 → 同源缩略图校验不过，导入后视频封面破图直到第一次保存画布；缺后者 → 项目素材库根判定失败，静默降级到新建的空 `library-assets`，分享过去的库文件在素材面板里消失 | P0 | 低 | 中 | 导入后立即打开画布，视频封面正常；被引用的库文件在素材库面板可见 |
| R21 | **文本节点正文里的 markdown 图片**：图片路径不在 `node.data` 里、也不一定以 `assets/` 开头，必须解析 `content.md` 收集，否则导入后正文插图全丢 | P0 | 中 | 中 | 含 3 张插图的文本节点导入后图片仍在 |
| R19 | **拖拽导入的传输**：独立路由流式接收（`req` 直接 pipe 到临时文件，不用 `express.raw`，避免整包进内存），上限 2 GiB；支持进度与取消；临时文件在成功/失败/取消后都删除；非 `.tfproj` 扩展名或魔数不符直接 415 | P0 | 中 | 中 | 500MB 包拖入不变内存尖峰；非本格式文件拖入立即拒绝且不留临时文件 |
| R12 | **导入安全**：魔数/版本校验、总大小上限 **2 GiB**（与 R19 一致，不再写 512MB）、条目数上限、路径穿越（绝对路径/`..`/符号链接/控制字符/Windows 保留名）、解压后逐条目长度校验、sha256 校验 | P0 | 中 | 高 | 构造穿越路径与超大条目的恶意包全部被拒且无落盘 |
| R13 | **导入失败不留残骸**：任何校验失败都删除已建目录；口令错误不建目录 | P0 | 低 | 低 | 失败后工程列表无新增条目 |
| R14 | **导入后提示**：① 节点引用的模型/供应商在本机不存在 → 提示重选；② **节点插件缺失**（`remote-*Node` 类型未安装，默认只会渲染永久 loading 占位、无任何文案）；③ 失效引用数量。三者合并成一个可关闭横幅 | P1 | 中 | 中 | 缺插件时有明确文案而非永久 loading；提示可关闭且不阻塞使用 |
| R15 | **画布保存前置**：导出前先 flush 画布保存，保证打包的是磁盘最新版 | P1 | 低 | 低 | 改了节点立刻导出，包内是改后内容 |
| R16 | **并发与限流**：媒体压缩并发 2（与缩略图一致），单文件独立 AbortController | P1 | 低 | 低 | 多文件导出 CPU 不被打满，取消能立刻停 |
| R17 | **ffmpeg 来源：不内置二进制**。依赖「设置 → 插件市场 → FFmpeg」的应用内下载；同时修正系统 PATH 探测——GUI 启动的应用 PATH 只有 `/usr/bin:/bin:/usr/sbin:/sbin`（实测 `toonflow-exec.app` 的 bun 进程），Homebrew/MacPorts 装的 ffmpeg 扫不到。改为在候选目录里显式查找（`/opt/homebrew/bin`、`/usr/local/bin`、`/opt/local/bin`、`~/.local/bin`），不污染全局 PATH | P0 | 低 | 低 | Homebrew 装过 ffmpeg 的机器，`mode=auto` 且未应用内下载时也能识别为 `origin=system` |
| R18 | **内置二进制留作后续**：Electrobun `build.copy` 可行，但受许可与 macOS ARM 公证双重约束，本轮不做。**实测确认**：应用内下载的 `darwin-arm64` 二进制 `-version` 输出含 `--enable-gpl --enable-nonfree`——`--enable-nonfree` 构建**按 FFmpeg 许可不可再分发**，因此「把现在下载的那份打进安装包」这条路直接不可行；真要内置必须换源（自建 GPL/LGPL 构建）并重做签名 | — | 高 | 高 | 仅在文档记录路径与约束 |

## 5. 待确认 / 需方案阶段决定

1. ~~扩展名与 MIME~~：已定 `.tfproj`，不注册文件关联。
2. **scrypt 参数与内存开销**：N=2^15 在大工程上派生耗时约几十毫秒，可接受；需实测。
3. **流式实现路径**：`Bun.Archive` 能否逐条目流式写；否则用 fflate 的 `Zip` 流式 API 或自研 tar。
4. ~~staging 位置~~：`<工程>/.toonflow/share-<uuid>/`，`.toonflow` 已在文件树隐藏与保护名单内（已核实）。
5. ~~压缩媒体的文件名~~：**换格式必须改名**（`.webm`→`.mp4`、`.png`→`.jpg`），并同步改写画布里的路径与 `mimeType`；同格式（mp4→mp4）才覆盖同名。
6. **R14 的「模型不存在」判定**：需要一份可用模型 id 清单的稳定来源。

## 6. 已知风险

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 压缩有损 → 接收方重跑同样工作流结果不同 | 中 | 在导出确认弹窗写明；文档记录 |
| 全局素材库旧路径引用（旧画布 `assets/<rel>`） | 低 | 导出前扫描并列入提示清单 |
| 大工程超出内存/512MB | 中 | 流式打包 + 导出前预估体积并提示 |
| HDR / 广色域素材压缩后观感变化 | 低 | 暂不处理，记录为已知限制 |
| 旋转元数据素材压缩后方向变化 | 低 | ffmpeg 默认 `-autorotate`，需实测 |
| 加密给人「安全」的错觉 | 低 | 导出弹窗说明「只防顺手一看」 |

## 7. Grill 决策记录

| # | 问题 | 结论 |
| --- | --- | --- |
| 1 | 分享形态 | 可编辑工程副本 |
| 2 | Agent 会话 | 整个会话不导出 |
| 3 | 加密程度 | 可选口令（scrypt + AES-256-GCM），留空则明文 + sha256 |
| 4 | 压缩档位 | 固定标准档，不做 UI 选择 |
| 5 | 导入落地 | 总是新建独立工程，重名加后缀 |
| 6 | 素材库 | 只带被引用的库文件 |
| 7 | 保留口径 | 按引用收集（不是只看 `outputs`） |
| 8 | 缺 ffmpeg / 压缩失败 | 强制中止导出 |
| 9 | 导出入口 | 只在首页列表右键 |
| 10 | ffmpeg 是否内置 | 不内置（GPL libx264 + Apple 公证双重成本），用应用内下载并修正常见 PATH 目录扫描 |
