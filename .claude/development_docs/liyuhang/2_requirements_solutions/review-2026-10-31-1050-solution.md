# 技术评审：工程分享包方案

- 时间：2026-10-31 10:50
- 被审文档：`2_requirements_solutions/2026-10-31-10-20-project-share-export.md`
- 代码基线：`feat/exec-node`（`783aeda`）
- 方法：逐条核实方案中的技术假设，全部结论附代码位置或实测输出；实测脚本置于 `/Users/liyuhang/.claude/jobs/7d111af0/tmp/`（未写入仓库）
- 环境：macOS 14.6（arm64）、Bun 1.3.11、ffmpeg 6.0（`/Applications/toonflow-data/ffmpeg/darwin-arm64/ffmpeg`）与 Homebrew ffmpeg 7.1.1

---

## 一、问题清单（按严重度）

### [P0-1] §7「前端先取路径、再随请求传服务端」整条链路不成立

**问题**
方案写「目标路径由前端先调现有 `/api/desktop/selectSaveFile` 取得，再随导出请求传服务端」，但现有实现**从不把绝对路径交给前端**，且 `saveFile` 有 100 MB 硬上限。

**证据**
- `apps/desktop/src/saveFile.ts:31` 的 `selectSaveFile(fileName)` 返回的是**一次性 token**，绝对路径只存在主进程的 `pendingSaves` 里（`:12`），TTL 5 分钟（`:13`），`pendingSaves.set(token, { path: selected, ... })`（`:50`）。
- `apps/server/src/routes/desktop/selectSaveFile.ts:12` → `res.json(success({ token }))`；`apps/server/src/types/desktop.ts:45` 的返回类型就是 `Promise<string | null>`（token）。
- `apps/server/src/routes/desktop/saveFile.ts:11` → `raw({ type: "application/octet-stream", limit: "100mb" })`：整个包体先进内存 `Buffer`，再 `writeAtomic(selected, content)`（`apps/desktop/src/saveFile.ts:65`）。GB 级分享包走不通，且流式写无从谈起（这正是方案 §13 想避免的「大工程内存」）。
- 另：`selectSaveFile` 只在 `win32`/`darwin` 可用（`apps/desktop/src/saveFile.ts:39` 抛「当前系统不支持桌面另存为」）。

**建议**
沿用既有的 token 语义，把「选路径」与「写内容」解耦：

1. `DesktopRuntime` 增加 `takeSaveTarget(token): string`（或 `consumeSaveTarget`），由导出任务在写盘前消费 token 取回路径，**路径始终不经过网络**；
2. §10 接口的 body 从 `{ directory, password?, savePath }` 改为 `{ directory, password?, saveToken }`；
3. `saveFile` 路由继续服务小文件导出（≤100 MB）场景，分享包不复用它；
4. 前端在 Linux/ohos 桌面端要隐藏「分享工程 → 保存到本地」，或改走浏览器下载。

---

### [P1-1] §5 视频滤镜在奇数宽源上直接失败，而 R8 规则会让整包中止

**问题**
`scale='min(1920,iw)':-2` 只在 **源宽为偶数** 时成立；宽度小于 1920 时不缩放，原始奇数宽原样进入 libx264 + `yuv420p` → 编码器初始化失败。方案规定「单文件失败整包中止」（§5 / §12），于是一个 641 宽的录屏/用户素材会让整个导出失败。

**证据（实测，ffmpeg 6.0）**
```
$ ffmpeg -i odd.mp4 -c:v libx264 -preset veryfast -crf 24 -pix_fmt yuv420p \
    -vf "scale='min(1920,iw)':-2" -an out_odd.mp4
[libx264] width not divisible by 2 (641x362)
[vost#0:0/libx264] Error initializing output stream: ...
```
`force_divisible_by=2` 不解决（只在 `force_original_aspect_ratio` 生效时起作用，实测仍报 `641x362`）。实测可行写法：
```
-vf "scale='trunc(min(1920,iw)/2)*2':-2"      → OK，输出 640x360
```

**建议**
- 参数改为 `scale='trunc(min(1920,iw)/2)*2':-2`（或加 `,pad=ceil(iw/2)*2:ceil(ih/2)*2` 保留奇偶像素）；
- 把 R8「单文件失败整包中止」改成「失败项回退为 `codec:store` 原样打包 + 记入 `skippedFailed[]`」，只在**打包/写盘**失败时中止——分享包的目标是可导入，不是必须全压。

---

### [P1-2] §5 透明 PNG → JPEG 会静默丢 alpha（且 `pix_fmt` 探测漏掉 pal8+tRNS）

**问题**
方案写「透明保留 PNG/WebP，其余转 JPEG」，但代码库里**没有任何 alpha 判定**（`grep alpha|yuva|pix_fmt` 只命中 `apps/server/src/modules/assetLibrary/assets/thumb.ts:54` 的固定 `-pix_fmt yuvj420p` 与两个节点包的固定 `yuv420p`）。若判定写错，ffmpeg **不报错**，直接把透明区当不透明像素编码。

**证据（实测）**
- 源：800x600 rgba，角点像素 `ff 00 00 00`（alpha=0）。按方案参数转 JPEG → 输出 `yuvj444p`，角点像素 `fe 00 00`（红色保留、alpha 丢失），退出码 0，**无任何告警**。
- `pix_fmt` 不足以判定透明：带 tRNS 的索引 PNG（pal8）`ffprobe` 只报 `pix_fmt=pal8`；rgba 报 `pix_fmt=rgba`；不透明报 `rgb24`。
- 可靠判定：解码首帧到 rgba 后扫描 alpha 字节——pal_trns.png `alpha min 0 / max 255`，noalpha.png `min 255 / max 255`，判定正确。

**建议**
- alpha 判定用「解码首帧 rgba、扫 alpha 字节」或 `alphaextract` 后取最小值，不要用 `pix_fmt.includes("a")`；
- 检出 alpha ⇒ 一律保留 PNG（或转 WebP，两套 ffmpeg 都有 `libwebp`，实测 `-encoders` 均含 `libwebp`/`libwebp_anim`）；
- 若确要转 JPEG，显式合成到白底（`-filter_complex` 叠 `color=white`），不要依赖默认行为；
- JPEG 输出显式带 `-pix_fmt yuvj420p`（现有 `thumb.ts:54` 就是这么做的）；不加时的默认 `yuvj444p` 体积更大。

---

### [P1-3] §2.2 认为 `decompressSync(data, { out })` 会挡住解压炸弹——它不报错，只静默截断

**问题**
「先按 `size` 分配缓冲再 `decompressSync(..., { out })`，天然挡住解压炸弹」。实际内存确实是限住了，但**超限不会抛错**，得到的是被截断的数据，只有调用方自己比对长度/sha 才能发现。

**证据**
- `apps/server/node_modules/fflate/lib/index.cjs:231`：`var resize = noBuf || st.i != 2;` → 传了 `out` 且走 `decompressSync`（`st.i === 2`，`:1228`）时 `resize === false`，`cbuf()` 扩容分支全部跳过，写入用 `buf[bt++] = sym`（`:351`）——TypedArray 越界写是**静默丢弃**；返回 `buf.subarray(0, bt)`（`:394`）会被 `subarray` 截到 `buf.length`。
- 实测（fflate 0.8.3，Bun 1.3.11）：
  - 4 MiB 明文 deflate → 10 226 字节；传 1 KiB `out`：**不抛异常**，返回 1 024 字节，且就是传入的那个 buffer；
  - 传过大的 `out`：返回 4 194 304 字节（正确）。
  - 唯一会抛的是存储块路径的 `buf.set()` → `RangeError: Range consisting of offset and length are out of bounds`（实测），错误信息不可读。

**建议**
文档改写为「`out` 只限制内存占用」，并在实现里强制：
```ts
const out = new Uint8Array(entry.size);
decompressSync(data, { out });
if (out.byteLength !== entry.size || sha256(out) !== entry.sha256) throw 包已损坏;
```
同时把 `RangeError` 也映射成「条目损坏」而不是 500。另注：`decompressSync` 是同步全量解压，2 GiB 的 deflate 条目会在主线程上一次性占 2 GiB，条目上限建议对 `codec=deflate` 单独收紧（例如 ≤ 256 MiB）。

---

### [P1-4] §2.2 / §2.3 容器布局自相矛盾：加密时「末条用 payloadSize 收口」不成立；manifest 先写也需要预压缩

**问题一（长度推导）**
§2.1 定义 `payloadSize = 负载总字节数（加密时为密文长度）`，§2.2 说「`storedSize` 由下一条的 `offset` 或 payload 尾推出（末条用 `payloadSize` 收口）」。加密包下密文长度 = 明文 + 每 4 MiB 一个 16 字节 tag + 末块标记，**不等于** 明文负载长度，末条长度会被算大。明文包下还有第三个问题：§2.1 的 32 字节头之后紧跟 `16 字节 salt + 12 字节 nonce`（共 28 字节），这 28 字节是否计入 `payloadSize`、payload 起点是 32 还是 60，文档没写死。

**问题二（写入顺序）**
§7「先写占位头 → 写 manifest → 逐条写 entry」。但 entry 的 `offset` 依赖前一条的 `storedSize`，而 `storedSize` 只有压完才知道；流式 deflate（见下文实测可用）在写完前拿不到长度，因此**无法在写 entry 之前写出正确的 manifest**。

**建议**
1. 每个 entry 显式记录 `storedSize`（或在 entry 头部写 8 字节长度前缀），彻底去掉「由下一条 offset 推」的隐式约定；
2. 明确「payload 从 offset 60 开始（32 字节头 + 28 字节 KDF 参数区），`payloadSize` 只统计 payload，不含 0–59」；
3. 由于 `codec:deflate` 只用于 json/md/txt，先在内存里压好这些小条目得到 `storedSize` 再写 manifest 即可（媒体走 `store`，`storedSize === size`）；或改为「entry 区在前、manifest footer 在后」的布局。

---

### [P1-5] §2.3 加密分块：`node:crypto` 在 Bun 下可用，但 maxmem 必须显式给（实测数据）

**结论：假设成立，且必须写 `maxmem`**

**证据（Bun 1.3.11 / node v24.3.0 兼容层）**
```
scryptSync(pw, salt16, 32, { N: 2**15, r: 8, p: 1, maxmem: 64MB })  → 44.1 ms
scrypt 同参数 不传 maxmem → ERR_CRYPTO_INVALID_SCRYPT_PARAMS
    Invalid scrypt params: ... OPENSSL_internal:MEMORY_LIMIT_EXCEEDED
scrypt async 三次：39.8 / 36.4 / 35.1 ms
N=2^14 对照：16.3 ms
createCipheriv("aes-256-gcm") 4 MiB 块 × 32（128 MiB）加密：23 ms
解密：18 ms
```
（`N=2^15, r=8` 恰好需要 32 MiB，OpenSSL 默认 `maxmem` 也是 32 MiB，边界相等即报错——方案里的 `maxmem: 64MB` 是**必要**而不是可选优化。）

**建议**
- 把 `maxmem: 64MB` 标成硬性要求写进实现说明；
- scrypt 走异步版（35–40 ms 在主线程同步跑也能接受，但导入是异步任务，无必要阻塞）；
- 128 MiB/s 量级的 GCM 吞吐说明「分块加密」不是瓶颈，4 MiB 块大小合理。

---

### [P1-6] §6 staging 位置成立，但「`files/list` 需要隐藏 `.toonflow`」这句是多余的；真正的缺口是启动清扫的挂载点

**证据**
- 路径限制确认是「**相对 root 解析，绝对路径 realpath 后必须仍在 root 内**」，不是相对 cwd：`packages/ffmpeg/src/runtime.ts:18` `createFfmpeg(directory)` 里 `const root = realpathSync(directory)`，`:22` `assertWithin()` 用 `relative(root, path)` 判定，`:29` `resolvePath()` 先 `resolve(root, path)` 再 `assertWithin`，并对不存在的父目录逐级 realpath 校验。`createWorkspaceFfmpeg(cwd,…)` 传的 `cwd` 就是工程目录（`apps/server/src/modules/mediaGeneration/ffmpeg/index.ts:33` `createFfmpeg(cwd)`；`routes/ffmpeg/execute.ts:36` 的 cwd 来自 `resolveWorkspace`）。→ staging 放在 `<project>/.toonflow/share-<uuid>/` **满足沙箱**。
- `.toonflow` **已经在隐藏名单里**：`apps/server/src/modules/localRuntime/workspace/files.ts:105` `hiddenWorkspaceEntries = new Set([".toonflow", ".git", ".agent", ".library", ".trash", ".thumbs", "library", "library-assets"])`，`:107` `isHiddenWorkspaceEntry`；`apps/server/src/routes/workspaces/files/list.ts:17-19` 在 `atWorkspaceRoot` 时过滤；Agent 侧同样过滤（`apps/server/src/agent/tools/index.ts:192`）；跨项目搬运也跳过（`routes/workspaces/files/transfer.ts:96`）。→ **不需要改 `files/list`**。
- 但 `app.ts` 里没有任何「按工程目录清扫」的启动钩子，`createApp`（`apps/server/src/app.ts:12-65`）只初始化内置插件与模块；`assets.warmup(context)`（`:41`）不带工程列表，桌面端的工程目录是运行时才知道的。所以「启动时清扫 `.toonflow/share-*`」缺少可挂载的位置。

**建议**
- §6 删掉「该目录需要在 `files/list` 隐藏」，改为「已被隐藏名单覆盖（`files.ts:105`），无需改动」；
- 清扫改为**工程打开时**（`resolveWorkspace` 首次命中 / 画布宿主加载后）执行一次，或在 `resolveWorkspacePath` 的目录枚举处惰性清理；写进方案 §6。

---

### [P1-7] §8 导入「服务端直接读本地路径」的授权边界没有定义，且 `local` 不等于「桌面端」

**问题**
方案 §13 风险表写「仅桌面端可用（`desktop` 平台判定）」，但没有说明用什么判定。`getRuntimePlatform().local` **不等于**桌面端。

**证据**
- `apps/server/src/lib/platform.ts:18`：`const local = desktopSystem && (development || desktop);` —— macOS/Windows 上 `bun run dev:server` 的 `local` 也是 `true`。
- `apps/server/src/modules/localRuntime/workspace/index.ts:45`：`if (getRuntimePlatform().local && isLocalWorkspaceRequest(req)) return directory;` —— `isLocalWorkspaceRequest` 要求 loopback + 同源 + `x-toonflow-workspace: 1`（同文件 `:9-15`），这个头是前端全局可加的（`apps/web/src/stores/sessionState.ts:48` 等）。
- 真正的「桌面端」判定是 `req.app.locals.desktop`：`apps/server/src/lib/desktop.ts:5` 找不到就 404「此接口仅在桌面客户端中可用」，`apps/server/src/app.ts:59` 把整个 `/api/desktop` 前缀挂在该中间件下，且 POST 还要求 `hostname === 127.0.0.1` + 同源 + `x-toonflow-desktop: 1`（`lib/desktop.ts:9-13`）。
- 反 CSRF 的通用判定是 `assertAppRequest`（`apps/server/src/modules/mcpIntegration/mcp/control.ts:75-78`，要求 `x-toonflow-workspace: 1`），大多数工作区路由都用它。

**建议**
- 新的 `/api/desktop/selectFile` 放在 `/api/desktop` 前缀下 → 自动获得 404 / 同源 / `x-toonflow-desktop` 三道校验，无需另写；
- `/api/workspaces/share/import` 必须自己做：`assertAppRequest(req)` + 仅当 `req.app.locals.desktop` 存在时允许 `filePath` 为任意绝对路径；服务器部署时**只接受 workspaces 根内的相对路径**（复用 `resolveWorkspace`），否则 403；
- 同一条边界也要覆盖 `/export`：服务端写盘目标同理，非桌面端只允许写到数据目录/用户下载目录下。

---

### [P2-1] §9 ffmpeg 探测：`Bun.which` 早已存在，缺的只是候选目录；`origin` 的 UI 也早已支持

**证据**
- `packages/ffmpeg/src/index.ts:53` 已经是 `const path = hasDownload ? downloaded : mode === "download" ? null : Bun.which(executableName(name));`，`:54` 已经产出 `origin: "download" | "system"`。方案写的「candidates = [downloaded, …extraDirs, Bun.which]」里，只有 `extraDirs` 是新东西。
- `Bun.which` 严格按 `PATH` 查找（实测）：`env PATH=/usr/bin:/bin bun -e 'Bun.which("ffmpeg")'` → `null`；`env -i bun` → `null`；`PATH=/opt/homebrew/bin` → `/opt/homebrew/bin/ffmpeg`。所以「GUI 启动的 App 拿不到 shell 的 PATH」这个理由成立，`extraDirs` 确实解决真问题。
- `origin` 的展示已就绪：`apps/web/src/components/settings/panels/pluginMarket/ffmpeg.vue:81` 按 `origin === 'download' ? '下载版' : '系统安装版'` 渲染；`:130` 的 `downloaded` 计算也读 `origin`。→ **不需要改 UI**。
- `getToolStatus` 签名改动的影响面：全仓库仅 **1 个调用方** `apps/server/src/modules/mediaGeneration/ffmpeg/index.ts:48`（`getStatus()` 内），没有测试或其他包直接调用；新增 `extraDirs?: string[]` 可选参数是**非破坏性**改动。
- 探测顺序与 `mode` 语义需保持不变：`mode === "download"` 时不回退系统版（`:53`），`mode === "system"` 时不看下载版（`:52`）。

**建议**
- §9 改成「在现有 `Bun.which` 之前插入 `extraDirs`（按 `mode !== 'download'` 生效）」，别写成「新增 Bun.which」；
- `extraDirs` 建议按平台顺序 `darwin: /opt/homebrew/bin, /usr/local/bin, /opt/local/bin, ~/.local/bin`，Windows 用 `%ProgramFiles%\ffmpeg\bin`、`%LOCALAPPDATA%\Microsoft\WinGet\Links`；命中后仍要跑 `readVersion` 校验（现有 `:56` 已经这么做，失败会落到 `error` 而不是让导出崩）；
- 设置页加一句「已识别：/opt/homebrew/bin/ffmpeg」比只显示「系统安装版」更有用（可选）。

---

### [P2-2] §5 缺 `availableEncoders` 检查的实现路径，且实际运行版本与 catalog 不一致

**证据**
- 全仓库没有任何 `-encoders` / `availableEncoders` 的实际调用：`grep -rn "availableEncoders|libx264|-encoders"` 只命中 `packages/ffmpeg/src/browserTypes.ts:27`（fluent 方法白名单）、`packages/tools/ffmpeg/src/index.ts:75`（给 Agent 的说明）、以及两个节点包写死的 `videoCodec("libx264")`。方案 §5/§13 说的「前置 `availableEncoders` 含 libx264」是**新增能力**，不是现成接口。
- 本机两套 ffmpeg 都有 `libx264` / `libwebp` / `aac`（实测 `-encoders` 输出）。
- 版本：`packages/ffmpeg/src/catalog.ts:117` 等 5 处写 `6.1.1`，但本机 `/Applications/toonflow-data/ffmpeg/darwin-arm64/ffmpeg -version` 打印 **`ffmpeg version 6.0`**；Homebrew 是 7.1.1。方案里 `-fps_mode passthrough`（需 ≥5.0）在 6.0 与 7.1.1 上都实测通过。

**建议**
- 把编码器探测实现成 `ffmpeg -hide_banner -encoders` 解析（`Bun.spawn` + 缓存），与 §9 的 `getToolStatus` 放同一层，避免每次导出都跑；
- 别用版本号当能力判据；`-fps_mode` 在 6.0 已验证可用，前置检查只需管 `libx264`。

---

### [P2-3] §4 / §3 引用收集与画布清理：可复用现有实现，但方案引错了位置、缺了保护

**证据**
- 现有递归扫描的正确参照是 `apps/server/src/modules/assetLibrary/assets/usage.ts:52` 的 `matchCanvasValue`（`depth > 64` 上限、数组/对象递归、只对规范化后的字符串做前缀匹配），不是方案写的 `usage.ts:259`（那是 `findAssetUsageBatch` 的函数体）。
- 方案 §3 的递归遍历没有深度上限与体积上限，建议照抄 `depth > 64`。
- `copyCanvasFiles`（`apps/web/src/pages/workspace/panels/canvas/canvasFiles.ts:74-150`）已经实现了「按画布复制被引用素材 + 复制 `textPath` + 把 `agentSessionFile` 转成 `agentSessionCloneFrom`」，与 §4 的清理目标高度重合；但它在前端、且会重映射节点 ID。服务端版需要独立实现，别误以为可以直接 import。
- §4「删除指向不在 keptFiles 中的字段 —— 值置空或整项移除，由节点自身容忍缺失」目前**没有证据**。`canvas/index.vue:1026-1033` 在保存前会校验 `textPath` 的合法性，但各节点对 `crop.last` / `frameAnalysis.lastResult.scenes[]` 缺失值是否容忍未验证。

**建议**
- §3 引用改为 `usage.ts:52`；
- §4 增加一条「逐节点验证 `lastResult.scenes[].video = null` 后节点可重新渲染」，否则退化为「保留字段但不保证可用」；
- 扫描加 `depth ≤ 64` 与单文件 ≤ 20 MB（与 `routes/workspaces/clone.ts:40` 的画布候选判定口径一致）。

---

### [P2-4] §8.2 路径校验「复用 `workspaceMediaPath`」——口径不够严

**证据**
- `packages/nodeScaffold/src/workspaceFiles.ts:28` 的 `workspaceMediaPath` 只拒绝：绝对路径 / 盘符+scheme / 控制字符 / `..`。**不拒绝** Windows 保留名（`con`、`nul`、`lpt1`…）、尾部点/空格。
- 服务端已有更严格且带真实路径containment 的实现：`apps/server/src/modules/localRuntime/workspace/files.ts:72` `resolveWorkspacePath`（含 `resolve` + `realpath` + `isWithin(root, actual)`），`routes/workspaces/clone.ts:68-72` 正是「先 `allowMissingParents` 建父目录、再解析最终路径」的两段式用法。

**建议**
- 导入落盘统一走 `resolveWorkspacePath(directory, entry.path, true)`（建父目录）+ `resolveWorkspacePath(directory, entry.path)`（校验），不要自己写正则；`workspaceMediaPath` 只用于「从画布读出的媒体路径」。

---

### [P2-5] §7/§8 发布语义引用不准；新路由的文件结构需要说明

**证据**
- `routes/workspaces/clone.ts:62` 用的是 `mkdtemp(join(parent, `${name}-`))` 直接建最终目录、失败时整目录删除（`:75-92`），**没有 `*.partial` → rename**；
- 「与 `copyCanvasFiles` 的发布语义一致」也不对：`copyCanvasFiles` 是**前端**实现，临时目录名是 `.toonflowCopy<uuid>`（`canvasFiles.ts:76`），且 `isHiddenWorkspaceEntry` 之外还有单独的 `startsWith(".toonflowCopy")` 跳过规则（`clone.ts:42`）。

**建议**
- §8.3 直接写「与 `clone.ts` 的导入语义一致：`mkdtemp` 建最终目录，成功返回、失败整目录 rm」；如果确实想要 `*.partial` + rename，写清楚它会和 `clone.ts` 不一致，并说明理由（例如同名工程已存在时的原子发布）；
- 补充：`apps/server/src/router.ts` 在 dev 下由 `apps/server/src/core.ts:24-59` 的 `generateRouter()` **自动生成**（`app.ts:47-48` 在 development 下调 `buildRoute`），新增路由只需建文件，不手改 router.ts。

---

### [P2-6] §10 任务表不能「直接复用」`mediaGeneration/media/tasks.ts`

**证据**
`apps/server/src/modules/mediaGeneration/media/tasks.ts` 共 60 行：
- `type MediaTask = { cwd, controller, settledAt?, result?: ApiResponse<GeneratedMedia[]> }`（`:5-10`）——只有最终结果，**没有** `phase / done / total / bytes / currentFile / missing[] / skippedLarger[]` 任何进度字段；
- `start(cwd, taskId, mediaType, request)`（`:33`）签名与分享导出无关；
- `status(cwd, taskIds[])` / `cancel(cwd, taskIds[])`（`:46`、`:55`）是 **cwd 作用域的批量** API，而分享是 `?id=` 单个、且 `cwd` 语义不同；
- 可复用的只有模式：内存 `Map`、`settledAt + 300000` 清理（`:26`）、上限 1000（`:37`）、`setInterval(cleanup, 30000).unref()`（`:28-29`）。

**建议**
新建 `apps/server/src/modules/share/tasks.ts`，照抄 4 个约束（Map / 5 min / 1000 / unref 定时器），任务体改为 `{ controller, phase, done, total, bytes, currentFile, missing, skippedLarger, error, settledAt }`；同时建议按 `taskId` 记录**发起方的 directory**，status/cancel 校验 directory 归属（现有 media tasks 的 `task.cwd !== cwd` 就是这个意思，`:48`）。

---

### [P2-7] §2.1 文件头字段有冗余/歧义

**证据**
- magic 已含版本字节（`TFPAK\0\0\1` 的第 8 字节），偏移 8 再放一个大端 `version` 属于双重版本号；
- 偏移 24 的「8 字节 salt/nonce 指针」名不副实：实际是「头后紧跟 28 字节数据」，既不是指针，也没有长度字段；
- `chunkSize` 未加密时为 0，与「每 4 MiB 一块」的实现默认值耦合在文档里。

**建议**
把 24–32 定义为 `kdfOffset/kdfLength` 或直接规定「payload 从 60 开始」；版本只保留头部 `version` 字段。

---

## 二、逐条核实清单（对应任务必查项）

| # | 待核实假设 | 结论 | 关键证据 |
| --- | --- | --- | --- |
| 1 | fflate 能流式写（`Zip`/`ZipDeflate`） | **成立**，且另有更适合本方案的 `Deflate` 流式类 | 实测 0.8.3 导出含 `Deflate/Zip/ZipDeflate/ZipPassThrough`；`new Deflate((chunk, final) => …)` + `push(sub, true)` 在 Bun 下正常回调 |
| 1b | `decompressSync(data, { out })` 支持指定输出缓冲 | **成立，但不报错截断** | 见 P1-3 |
| 2 | Bun 下 `createCipheriv("aes-256-gcm")` / `scrypt` 可用 | **成立** | 见 P1-5 实测 |
| 2b | scrypt maxmem 会不会挡住 N=2^15 | **会，默认 32 MiB 不够；必须给 64 MiB** | `ERR_CRYPTO_INVALID_SCRYPT_PARAMS / MEMORY_LIMIT_EXCEEDED` |
| 3 | `createWorkspaceFfmpeg` 限「相对 cwd」还是「绝对路径在 directory 内」 | **后者**：root = `realpathSync(directory)`，相对 rescope、绝对 realpath 后 containment | `packages/ffmpeg/src/runtime.ts:18-55` |
| 3b | `.toonflow` 是否已在 `files/list` 隐藏 | **已隐藏**（根层），无需改动 | `files.ts:105-108`、`list.ts:17-19` |
| 4 | `selectSaveFile` + `saveFile` 能否写任意用户路径 | **不能按方案的方式用**：只回 token、不回路径；`saveFile` 限 100 MB 且全量入内存 | 见 P0-1 |
| 4b | 是否存在 `/api/desktop/selectFile` | **不存在**（只有 `selectDirectory` / `selectSaveFile` / `providerFile/select`） | `ls apps/server/src/routes/desktop/`；`grep selectFile` 无命中 |
| 5 | `platform.ts` 如何区分桌面/服务器 | `local = desktopSystem && (development || desktop)`；桌面判定实际应看 `req.app.locals.desktop` | `platform.ts:18`、`lib/desktop.ts:5` |
| 6 | `Bun.which` 行为 | 严格读 `PATH`；GUI 环境下拿不到 Homebrew 路径是真问题 | 实测三种 PATH 场景 |
| 6b | `getToolStatus` 签名改动影响面 | 仅 1 个调用方，可选参数非破坏 | `apps/server/.../ffmpeg/index.ts:48` |
| 6c | `origin: "system"` 的 UI 展示位置 | 已展示为「系统安装版」 | `pluginMarket/ffmpeg.vue:81` |
| 7 | `scale='min(1920,iw)':-2` 在本机 ffmpeg 是否可用 | **偶数宽可用；奇数宽失败**；单引号必须原样作为单个 argv 传入 | 见 P1-1 与附录 A |
| 7b | 透明 PNG 转 JPEG 会不会丢 alpha | **会，且无告警**；代码库无任何 alpha 处理 | 见 P1-2 |
| 8 | 任务表能否直接复用 | **不能，只能照抄形态** | 见 P2-6 |

---

## 三、建议的方案修订点（按改动量）

1. **§7 重写**（P0-1）：`saveToken` 取代 `savePath`，新增 `DesktopRuntime.takeSaveTarget`。
2. **§5 参数修正**（P1-1/P1-2）：`trunc` 保护 + alpha 判定规则 + JPEG `-pix_fmt yuvj420p`。
3. **§2.2 容器补 `storedSize`**、**§2.1 明确 payload 起点**（P1-4）。
4. **§2.2 解码校验**：`out` 只限内存，长度与 sha 必须显式比对（P1-3）。
5. **§5 失败策略**：单文件失败降级为 store，而不是整包中止（P1-1）。
6. **§6 改写**：`.toonflow` 已隐藏；清扫改为「工程打开时」。
7. **§8 授权**：桌面/服务器两条路径写死（P1-7）。
8. **§9 改写**：`Bun.which` 已有，只加 `extraDirs`；UI 无需改。
9. **§10 任务表**：改为「照抄形态，新建模块」。
10. **§12 补测例**：奇数宽视频、透明 PNG（含 pal8+tRNS）、4 GiB 边界、密文包末条长度。

---

## 附录 A：实测脚本与原始输出

脚本位置：`/Users/liyuhang/.claude/jobs/7d111af0/tmp/`（`t1_fflate.mjs`、`t2_crypto.mjs`、`t3_which.mjs`，另生成了 `src.mp4`、`odd.mp4`、`alpha.png`、`pal_trns.png`、`noalpha.png` 等测试素材）。

### A.1 fflate

```
fflate exports: AsyncDeflate,…,Deflate,…,Zip,ZipDeflate,ZipPassThrough,decompressSync,…
orig 4194304 deflate 10226
A out exact     -> len 4194304 identical true
B out too small -> NO THROW, returned len 1024 buf len 1024 same ref true
C out too large -> returned len 4194304 orig buf 8388608
D stored-block overflow -> THROW RangeError Range consisting of offset and length are out of bounds
E Deflate class streaming: available, typeof push = function
F Zip/ZipDeflate streaming: available
```

### A.2 crypto

```
scryptSync ok 32 took 44.1 ms
scrypt default maxmem -> ERR_CRYPTO_INVALID_SCRYPT_PARAMS Invalid scrypt params: … MEMORY_LIMIT_EXCEEDED
scrypt async run 0 39.8 ms / 1 36.4 ms / 2 35.1 ms
scrypt N=2^14: 16.3 ms
AES-GCM 128MiB encrypt: 23 ms, out 134218240 bytes
AES-GCM 128MiB decrypt: 18 ms
bun 1.3.11 node v24.3.0
```

### A.3 Bun.which

```
PATH=/usr/bin:/bin  -> ffmpeg: null ffprobe: null
PATH=/opt/homebrew/bin -> ffmpeg: /opt/homebrew/bin/ffmpeg
env -i（无 PATH）-> undefined, ffmpeg: null
```

### A.4 ffmpeg 滤镜

```
A  scale=min(1920,iw):-2              -> No such filter: 'iw):-2'（无单引号时逗号被当作滤镜分隔）
B  scale='min(1920,iw)':-2            -> OK，640x360
C  scale='min(2048,iw)':'min(2048,ih)':force_original_aspect_ratio=decrease -> OK
D  同 C 去引号                         -> No option name near 'decrease'
E  奇数宽 641x361 + B                  -> width not divisible by 2 (641x362)，编码器初始化失败
F  scale='trunc(min(1920,iw)/2)*2':-2 -> OK，640x360
G  奇数宽图片 + C + -q:v 3             -> OK，641x361 yuvj444p
```

### A.5 alpha

```
源 alpha.png 角点 rgba    : ff 00 00 00   (alpha=0)
转 JPEG 后角点 rgb        : fe 00 00      (alpha 丢失，RGB 保留，退出码 0)
ffprobe pix_fmt: pal_trns.png -> pal8 | alpha.png -> rgba | noalpha.png -> rgb24
解码 rgba 扫 alpha 字节  : pal_trns min 0 max 255 | alpha.png min 0 max 0 | noalpha min 255 max 255
```

### A.6 编码器与版本

```
/Applications/toonflow-data/ffmpeg/darwin-arm64/ffmpeg : ffmpeg version 6.0
  -encoders: libx264 / libx264rgb / libvpx-vp9 / libwebp / libwebp_anim / aac
/opt/homebrew/bin/ffmpeg : ffmpeg version 7.1.1，同样编解码器齐全
packages/ffmpeg/src/catalog.ts:117 等 5 处声明 version: "6.1.1"
```
