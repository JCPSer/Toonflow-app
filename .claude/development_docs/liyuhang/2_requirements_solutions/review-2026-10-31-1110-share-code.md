# 代码审查：工程分享包（导出 / 导入）

- 时间：2026-10-31 11:10
- 审查对象：`feat/exec-node` 工作区未提交改动（`git status` / `git diff` 对照）
- 设计依据：`2_requirements_solutions/2026-10-31-10-20-project-share-export.md`
- 审查范围：`apps/server/src/modules/workspaceShare/*`、`apps/server/src/routes/workspaces/share/*`、`apps/server/src/routes/desktop/selectFile.ts`、`apps/server/src/router.ts`、`apps/server/src/types/desktop.ts`、`apps/desktop/src/{saveFile,index,connection}.ts`、`packages/ffmpeg/src/index.ts`、`apps/web/src/lib/projectShare.ts`、`apps/web/src/components/projectShare/*`、home / workspace / settings 相关改动

## 0. 验证

| 项 | 结果 |
| --- | --- |
| `bun test apps/server/src/modules/workspaceShare/` | 67 pass / 0 fail（0.8s） |
| `bun run --filter '@toonflow/server' typecheck` | 通过（exit 0） |
| `bun run --filter '@toonflow/web' typecheck` | 失败，但唯一报错是既有无关文件 `apps/server/src/modules/agentAccess/singleAgent/types.ts(2,33): Cannot find module '@/agentRuntime'`（该文件不在本次改动内，属基线问题） |
| 静态核对 | `join(root, "assets/../../../x")` 实测逃逸工程根，见 P1-1 |

单测覆盖集中在 `collect` / `compress` / `container` 三个纯函数层；`export.ts`、`import.ts`、`tasks.ts`、6 个路由和全部前端逻辑均无测试。下面 P0 的缺陷正好落在这段无测试的胶水层。

## 1. 做得好的地方

- 容器格式实现基本按方案落地：显式 `storedSize`、`payloadSize` 定义清晰、加密分块含块序 AAD 与终止块、口令错误在建目录前失败、`.part` 临时名 + rename 发布、取消路径清理到位（`container.ts`）。
- 解压炸弹防线是对的：显式比对解压后 `length === size` 再比 `sha256`，没有误用 `decompressSync(out)`（`container.ts:360-394`）。
- 路径校验复用了 `resolveWorkspacePath`，导入侧对条目路径的防穿越、Windows 保留名、符号链接检查是完整的（`import.ts:56-59` + `localRuntime/workspace/files.ts:72-87`）。
- 桌面端信任边界在保存侧处理得比方案更严：`takeSaveTarget` 一次性 token、token 用后即焚、导出目标不走网络；`/api/desktop/*` 由 `desktopRequest` 统一守卫。
- 压缩侧修正了奇数宽、alpha 嗅探（rgba 扫描）、换格式改名 + 画布 mimeType 同步，且都写了针对性单测。

---

## 2. 问题清单（按严重度）

### [P0] 拖拽导入加密分享包必然失败：口令重试时临时文件已被删除

**证据**

- `apps/server/src/routes/workspaces/share/import.ts:40-44`：任务结束（**无论成败**）都会删除 `tmp` 下的 `input.filePath`。
- `apps/web/src/components/projectShare/shareImportDialog.vue:191-204`：拖拽入口第一次 `run()` 用空口令上传并立即导入；上传成功后 `sourceFile = undefined`，只留 `sourcePath`（服务端临时路径）。
- `shareImportDialog.vue:247-250`：口令模式下「用口令重试」只是拿 `sourcePath` 重新 `startShareImport`，不会重新上传。

**链路**：拖入加密包 → 上传成功 → 首次导入无口令 → 服务端返回「该分享包已加密，需要口令」→ 路由 finally 删除临时包 → 前端弹口令框 → 用户输入正确口令重试 → 服务端 `lstat` 404「分享文件不存在或已被移动」。即：拖拽入口导入加密包 100% 不可用（明文包不受影响）。

**建议**：至少二选一。

1. 服务端：`SHARE_PASSWORD` 失败时保留临时文件（返回 `tempPath` 与一个短期 token），由前端重试时带回；清理交给带 TTL 的临时文件清扫。
2. 或前端：口令失败后保留 `File` 对象并重新上传（需要有“重新上传”状态）。

同时补一条端到端用例：拖拽加密包 → 错口令 → 对口令 → 导入成功。

---

### [P1] 导出引用收集存在 `..` 路径穿越：任意文件被打进分享包，且产出的包无法导入

**证据**

- `apps/server/src/modules/workspaceShare/collect.ts:36-40`：`normalizeRelativePath` 只替换反斜杠、去 `./`，**不拒绝 `..`**。
- `collect.ts:141-151`：`referencedPaths` 只做 `^(assets|library|library-assets)/` 前缀匹配，`assets/../../../x` 命中。
- `apps/server/src/modules/workspaceShare/export.ts:78`（`exists(join(root, ref))`）、`:82`（`requiredPaths` 的 `join(root, required)`）、`:106/114/132/136`（打包源路径）都直接 `join(root, ref)`。
- 实测：`join("/Users/me/ToonflowWorkspaces/proj", "assets/../../../.ssh/id_rsa")` → `/Users/me/.ssh/id_rsa`。
- 导入侧并不校验画布内部引用（`import.ts` 只校验 manifest 条目路径），所以一个恶意 `.tfproj` 里放一个合法画布（`toonflowCanvas/nodes/edges/viewport` 都齐）就能植入 `data.textPath` / 任意字符串引用。

**影响**

1. 用户打开被投放的工程后点击「分享工程」，工程外的本地文件会被读入分享包（发给接收方即泄露）。
2. `/dev/zero`、FIFO 之类引用会让 `hashFile`（`export.ts:18-22`）永不结束，导出挂死。
3. 这些 `..` 条目会被导出侧照写进 manifest，导入侧 `resolveWorkspacePath` 一律拒绝，用户拿到一个“导出成功但对方永远导入不了”的包。

**建议**：把「画布里的引用」当不可信输入。`referencedPaths` / `requiredPaths` / `collectTextNodes` 落盘前统一走 `resolveWorkspacePath(root, ref)`（或等价校验：拒绝 `..`、绝对路径、scheme），并且要求 `lstat().isFile()`——顺带解决“引用指向目录时 `hashFile` 报 EISDIR”的另一类导出失败。

---

### [P1] 导入探测画布时把每个 `.json` 条目整体读进内存（无大小上限）→ 内存打爆 / 拒绝服务

**证据**

- `apps/server/src/modules/workspaceShare/import.ts:66-72`：`canvasPaths` 取**所有** `.json` 条目，逐个 `readFile(join(...))` 后 `isCanvasContent()`（内部 `TextDecoder` 全量解码 + `JSON.parse`）。
- `container.ts:257`：单条 `size/storedSize` 上限用的是 `SHARE_MAX_PAYLOAD`（2 GiB），不是方案 §8.2 写的 1 GiB。
- `export.ts:161-165`：画布是最后追加进 `sources` 的，所以正常大工程导入时，探测会先把 `assets/**/manifest.json` 等所有素材 JSON 全量读一遍才轮到画布。

**影响**：一个 2 GiB 的 `.json` 条目（或正常工程里几十/上百 MB 的分镜 manifest）会被 `readFile` 整体读入，再解码成等量字符串、再 `JSON.parse`；恶意包可据此把服务端/桌面主进程 OOM 打崩。

**建议**：canvas 探测先 `stat().size <= 20 MB`（与 `discover.ts:7` 的 `MAX_CANVAS_BYTES` 对齐）再读；单条大小上限按方案收紧到 1 GiB；只对「路径不像 assets/library 下大文件」的条目做探测。

---

### [P1] `/api/workspaces/share/import` 没有桌面端判定，服务器部署接受任意绝对路径；`share/export` 在服务器模式 500

**证据**

- `apps/server/src/routes/workspaces/share/import.ts:18-27`：只做 `assertAppRequest` + 扩展名 + `lstat`，**没有** `req.app.locals.desktop` 判断，之后把前端给的绝对路径直接交给 `importProject`。
- 方案 §8.1 明确要求：「`share/import` 必须显式 `assertAppRequest` 且仅在 desktop 下接受绝对路径，服务器/移动端一律拒绝」。
- 反面对照：`routes/workspaces/share/export.ts:22` 调 `u.desktop.getDesktopRuntime(req).takeSaveTarget(...)`，而服务器模式下 `req.app.locals.desktop` 为 `undefined`（`localRuntime/desktop/index.ts:116-118` 直接返回），会抛 `TypeError` → 500，而不是一句「仅桌面端可用」。

**影响**：服务器部署里任何能打开应用页面的客户端都能让服务端读取服务器上任意 `.tfproj` 绝对路径（存在性探针 + 导入服务器上的文件），与方案设定的信任边界不符；导出接口的报错也不可读。

**建议**：import 路由加显式 `if (!req.app.locals.desktop) return 404/403`（或用 `desktopRequest` 同款判定）；export 路由同理，返回统一文案而不是 TypeError。

---

### [P2] 压缩并发 2 未实现（方案 §5 明确要求）

**证据**：`apps/server/src/modules/workspaceShare/export.ts:103-137` 是严格 `for ... await compressMedia(...)` 串行；`isAnimated`/`hasAlpha`/`probeEncoders` 也逐个 spawn。

**影响**：图片/视频多的工程导出时间近似线性叠加（每个媒体至少 2 次 ffmpeg 探测 + 1 次转码），与方案标称的 2 路并发不符。

**建议**：写一个 2 路的 `mapLimit`；注意上一轮的产物路径冲突（见下一条）和 `onProgress.currentFile` 并发语义。

---

### [P2] 换格式改名后可能撞车 → 分享包里两条同路径条目，导入时静默丢一份

**证据**：`export.ts:126` 目标路径 = `原路径去扩展名 + plan.outputExt`；`sources` 里会同时出现 `a.png→a.jpg` 与原本就存在的 `a.jpg`（同目录），或 `clip.mov→clip.mp4` 与 `clip.mp4`。`container.writeShareFile` 不检查重名，manifest 两条 entry 同 `path`；导入逐条 rename 覆盖，最后一份生效。

**影响**：画布里两条不同引用都指向同一文件，用户看到的是“素材串了/丢了一份”，且导出过程无任何提示。

**建议**：staging 落盘前用 `Set` 记录已占用路径，冲突时加 `-share` 后缀并写入 `mapping`，确保映射唯一。

---

### [P2] 打包阶段不再校验内容哈希：导出成功但对方导入 sha256 失败

**证据**：`export.ts:114/122/132/136` 先 `hashFile` 得到 sha；`container.ts:453-467` 的 `streamSource` 只校验“读到的字节数 == 声明的 size”。文件在 hash 与打包之间被改写且大小不变时，包内字节与 manifest 的 sha 不一致，导出仍返回成功。

**建议**：容器边读边算 sha256（本来就有 `createHash` 依赖），写完与 manifest 对比；或在导出全程对工程加 `lockWorkspaceFiles`（目前导出完全没加锁，Agent/编辑器并发写入会直接命中这个风险）。

---

### [P2] 导入直接以最终目录名落盘，没有 `.partial` 再 rename 发布（方案 §8.2.3）

**证据**：`import.ts:45-49`：`uniqueDirectory()` 拿到最终名后立刻 `mkdir(directory)`，随后逐条目直接写最终路径。

**影响**：

- 导入进行中，`/api/workspaces/list` / 任何扫描 workspaces 根的逻辑能看到半成品工程；
- 进程崩溃后留下一个名字已被占用的坏目录，之后导入同名工程会被迫叫 `name-2`，坏目录永远留着。

**建议**：`<name>.partial-<uuid>` 写完 → `rename` 发布（与 `copyCanvasFiles` 的发布语义一致）。

---

### [P2] 崩溃残留的 `.toonflow/share-*` 没有清扫挂载点（方案 §6 要求）

**证据**：全仓 `grep "share-"` 只有 `export.ts:95`（写 staging），没有任何“工程打开时清扫”的实现。

**影响**：进程被强制退出/断电后，工程里会留下整份媒体副本（可达 GB 级），且用户不可见。

**建议**：在工程打开/工作区校验路径里清理 `.toonflow/share-*`（过期或非当前进程的）。

---

### [P2] 加密封装按条目重复读取并解密首个 4 MiB 块

**证据**：`container.ts:335`：`extractShareEntry` 每条都调用 `readManifestLength`（打开文件 + 读并解密第一块，最多 4 MiB）；`:396` 每条再 `verifyEndBlock` 一次。

**影响**：N 条目加密包额外 N 次文件打开 + N×4 MiB 读取与 AES 解密；500~1000 条目时是秒级到十几秒的纯开销（`deriveKey` 有缓存，不算 scrypt）。

**建议**：`readShareManifest` 已经把 `manifestLength` 算出来了，把它和 `plainSize` 作为参数传给 `extractShareEntry`；终止块校验在整包末尾做一次即可。

---

### [P2] 状态接口每 800ms 轮询都返回完整 manifest（含全部 entries 与 sha256）

**证据**：`tasks.ts:64-70` 把 `result.manifest` 原样放进 `status`；前端 `projectShare.ts:161-173` 以 800ms 轮询。manifest entries 上限 5000 条（`types.ts:8`）。

**影响**：大工程每个轮询响应数百 KB，导入/导出期间持续产生 JSON 序列化与网络开销。

**建议**：status 的 `result` 裁剪为 `{ path, name, stats }`；manifest 全量只在完成时读取一次，或单独提供接口。

---

### [P2] `stats.compressed` 是“压缩条目数”，前端当字节数展示

**证据**：`container.ts:517` `compressed: compressed.size`（Map 大小 = deflate 条目数）；`shareExportDialog.vue:158-162` 却渲染成 `打包后 ${formatShareBytes(stats.compressed)}`。

**影响**：导出完成页会显示「打包后 7 B」这类错误信息，用户无法据此判断包体积。

**建议**：manifest 增加 `storedBytes`（实际负载字节）供展示，或前端把文案改成「已压缩条目数」。

---

### [P2] 恶意 manifest 会让导入在 `sanitizeName` 处崩成 500

**证据**：`import.ts:23-35`：`sanitizeName(rawName)` 直接 `name.replace(...)`；`import.ts:45` 传入 `manifest.project?.name ?? ""`，未校验类型。`project.name` 为数字/null/对象时抛 `TypeError`（`project` 为数字时 `?.name` 亦失败），最终 500。

**建议**：`validateManifest` 里把 `project.name`（字符串）、`canvases`（字符串数组）、`stats` 一起校验，失败按 `SHARE_FORMAT` 处理。

---

### [P2] `findCanvases` 对每个 `.json` 先全量 `readFile` 再判 20 MB；目录黑名单缺 `.agent` 等

**证据**：`discover.ts:6` 的 `SKIP_DIRECTORIES` 没有 `.agent` / `skill` / `skills` / `.easyvibe`；`:40-41` 先 `readFile` 后才判断 `content.byteLength > MAX_CANVAS_BYTES`。

**影响**：Agent 会话文件等大 JSON 被整体读进内存后才丢弃；扫描时间随无关目录增长。

**建议**：先 `stat().size` 判限再读；补齐目录黑名单。

---

### [P2] `useShareFileDrop` 把所有“单文件拖入”都在 window 捕获阶段拦截，与注释相反

**证据**：`useShareDrop.ts:28-37`：`draggedShareFile` 对非 `.tfproj` 的单文件返回 `"unknown"`（真值），`onDrag` 随即 `preventDefault()` + `stopPropagation()`。注释写的却是“非分享文件直接放行”。

**影响**：拖入单个图片/视频时，`home` promptCard、`messageInput`、画布、素材库的 `dragenter`/`dragover` 处理器全部收不到事件——拖拽高亮/遮罩、`dropEffect='none'` 等状态逻辑失效（drop 本身因为 window 已 `preventDefault` 仍会派发，所以不会完全阻断附件上传，但交互退化且行为与注释不符）。

**建议**：只有 `kind === "share"` 时 `preventDefault/stopPropagation`；`"unknown"` 只用于保持 `dragging=false`，不拦截。

---

### [P2] 文本正文插图改写用 `split(raw).join(next)`，会丢掉 markdown 尖括号包裹

**证据**：`export.ts:140-152`：`content.split(image.raw).join(next)`；`next` 由 `relative()` 生成，原 raw 若是 `<assets/a b.png>`，替换后变成 `assets/a b.jpg`（无 `<>`），带空格路径不再被 markdown 识别。

**建议**：保留原包裹形式（raw 以 `<` 开头时新值也包 `<>`），或对空格/括号/`#?` 做 percent-encode。

---

### [P2] 测试只覆盖纯函数层，导出/导入编排与前端零覆盖

**证据**：只有 `collect.test.ts` / `compress.test.ts` / `container.test.ts`；`export.ts`、`import.ts`、`tasks.ts`、6 个路由、`projectShare.ts`、`shareImportDialog.vue` 无测试。

**影响**：本报告 P0（路由 + 前端生命周期）与 P1（画布探测大小、桌面端判定）都不会被现有测试发现。

**建议**：补三类用例：导入编排（明文/加密/错误口令重试/取消/失败清理/超大 JSON）、路由信任边界（非 desktop 拒绝绝对路径）、前端轮询与取消（可抽 `projectShare.ts` 的轮询/重试状态机单测）。

---

## 3. 与方案的一致性对照（非缺陷，供确认）

| 方案条目 | 实现状态 |
| --- | --- |
| §5 并发 2 | 未实现（见 P2） |
| §6 工程打开时清扫 staging | 未实现（见 P2） |
| §8.1 import 仅桌面端 | 未实现（见 P1） |
| §8.2 条目数 ≤5000 / 单条 ≤1 GiB / 总解码 ≤2 GiB | 5000 与总 2 GiB 有；单条上限实际 2 GiB |
| §8.2.3 `.partial` 后 rename | 未实现（见 P2） |
| §9 `availableEncoders` 宿主侧探测 | 已实现（`probeEncoders`），且不去改 PATH |
| §7 saveToken | 已实现，且 token 用后即焚 |
| 复用 `createWorkspaceFfmpeg` 沙箱 | 未复用，改直接 `Bun.spawn(ffmpeg, ...)`。功能上无害（只读工程内文件 + 写 staging），但属于重复实现，后续 ffmpeg 来源/参数策略变更要改两处 |

## 4. 结论

容器层与纯函数层质量较高，单测可信；问题集中在**编排层与两侧信任边界**：P0 是拖拽导入加密包的确定性失败，三个 P1 分别是导出路径穿越、导入内存放大、import 缺少桌面端判定 —— 建议这四条在合并前修复，并同步补上导出/导入编排与前端重试的测试。
