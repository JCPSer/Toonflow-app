# 需求方案：视频节点首帧缩略图 + 按需加载

日期：2026-10-26 19:20
对应需求：`1_requirements_matrix/2026-10-26-19-10-video-node-poster-thumbnail.md`

## 一、总体思路

复用服务端已有的「FFmpeg 抽帧 + 数据目录缓存」能力（`apps/server/src/utils/assets/thumb.ts`），把它从「素材库专用」提升为「任意绝对路径可请求」的公共能力；新增一个工作区文件缩略图端点，前端视频节点默认只渲染 `<img>`，用户点播放时才去取 Blob 并挂 `<video>`。

数据流：

```
视频落盘（拖入/生成/处理产物）
        │  预热请求（fire & forget）
        ▼
GET /api/workspaces/files/thumb?directory&path&size
        │
        ├─ 命中缓存 → 直接回 jpg（immutable + ETag）
        └─ 未命中 → lstat 取 realpath/size/mtime → 入队 FFmpeg 抽帧 → 回 jpg
                        │
                        └─ FFmpeg 不可用 → 404，前端回退为旧行为（直接挂 video）

视频节点卡片：<img src=thumb> + 播放按钮
        │ 用户点击播放 / 拖动进度 / 截帧 / 全屏
        ▼
    acquireUrl(path) → Blob URL → 挂载 <video>
```

## 二、服务端设计

### 2.1 缩略图缓存布局（R3 + R5）

现状：`cache/thumbs/<sha1(realpath|size|mtime|edge)>.jpg`，无法从源文件反查缓存，删除时无法精确回收。

改为两级：

```
<dataDir>/cache/thumbs/<sha1(realpath)>/
        ├─ source.txt              # 存放 realpath，供启动清扫与排障
        └─ <edge>-<mtimeMs>.jpg    # 同一文件不同尺寸/不同版本并存
```

- 删除源文件：`rm -rf <sha1(realpath)>`，无需枚举尺寸。
- 启动清扫：遍历一级目录，读 `source.txt`，`realpath` 已不存在则整目录删除。
- 兼容：旧版扁平缓存文件不再命中，随清扫一并删除（一次性成本，缩略图可再生）。

### 2.2 公共能力改造（`utils/assets/thumb.ts`）

`ensureAssetThumbnail` 保持对外签名不变（素材库、引用缩略图继续用），内部改为新布局；新增导出：

- `thumbCacheDirectoryFor(realpath)`：返回该源文件的缓存目录。
- `dropThumbnailCache(absolutePath)`：删除该源文件对应缓存目录（删除路径调用）。
- `sweepThumbnailCache()`：启动清扫孤儿目录，串行、限流，失败只记日志。

生成参数沿用现有：视频 `-ss 0.5`、单帧、等比缩放到目标边长、`-q:v 3`；并发上限保持 2，保持 `pending` 去重。

### 2.3 新端点（R1）

`GET /api/workspaces/files/thumb`

| 参数 | 说明 |
| --- | --- |
| `directory` | 工作区目录（与 `/read` 一致） |
| `path` | 工作区相对路径 |
| `size` | 可选，目标边长，默认 256，范围 64–512 |

- 复用 `resolveWorkspaceFile` 校验路径，`lstat` 必须是文件。
- 设计上按素材库 `/api/assets/thumb` 的方式**放行同源 `<img>` 直连**（不要求 `x-toonflow-workspace` 头），路径安全由 `resolveWorkspaceFile` + 工作区根校验保证。
- 命中返回 `Cache-Control: public, max-age=31536000, immutable` + `ETag`；未命中/FFmpeg 不可用返回 `404 {error:"缩略图不可用"}`。
- 只对 `IMAGE`/`VIDEO` 类型生效（复用 `mentionAssetType`）。

### 2.4 删除路径回收（R5）

`routes/workspaces/files/remove.ts`：删除前记录绝对路径（`realpath` + 是否目录），删除成功后：

- 文件：`dropThumbnailCache(absolutePath)`。
- 目录：遍历其下文件逐个 drop（节点目录 `assets/{nodeId}` 内的视频）。

不改素材库删除逻辑：素材删除最终也会走文件移除或 `.trash` 移动；`.trash` 内的文件按「源文件仍存在」保留缓存，`purge` 时随清扫回收。

## 三、前端设计

### 3.1 缩略图 URL（R1）

`apps/web/src/lib/workspaceFiles.ts` 新增：

```ts
function thumbUrl(path: string, size = 256): string  // 拼 query，不发请求
function warmThumb(path: string, size = 256): void   // fetch fire & forget，失败忽略
```

不经过 Blob，`<img>` 直连，走 HTTP 缓存。

### 3.2 视频节点按需挂载（R2）

`packages/nodes/videoNode/src/index.vue`：

- 移除挂载即执行的 `files.useFileUrl(...)`，改为惰性：`activated` 为 false 时 `src` 为空。
- `activated` 在以下任一发生时置真：点击播放、拖动进度、截帧、全屏、进入「替换视频」失败回退等需要真实解码的操作。
- 未激活状态渲染 `videoPlayer` 的 poster 态（见 3.3），不创建 `<video>`。

`packages/nodes/videoNode/src/components/videoPlayer.vue`：

- 新增 props：`posterUrl?: string`、`active: boolean`（或 `src` 为空即海报态）。
- 海报态 UI：`<img :src="posterUrl">` + 中央播放按钮 + 底部时长占位（`--:--`），进度条禁用。
- 激活后行为与现在一致：`preload="auto"`、`loadeddata` 置 `ready`、控件可用。
- 移除了运行时 canvas 生成 poster 的分支：`posterUrl` 已就绪；若 `posterUrl` 请求 404，则保持旧路径（挂 `<video>` 用运行时 canvas 兜底），保证无 FFmpeg 的机器观感不倒退。

其他视频类节点（`videoGenerationNode`、`frameAnalysisNode`、`director3dNode`）是否同样接入：本次**先只改 videoNode**，其余节点保持现状，后续按同一套 props 推广。

### 3.3 预热（R4）

- `canvasDrop.ts` 写入视频文件后调用 `warmThumb(copiedPath)`。
- `videoGenerationNode` 拿到 `result.path` 后同样调用一次。
- 历史节点没有缓存时，节点上屏即请求 thumb 端点，实现懒补。

### 3.4 闲置卸载（R7）

`videoPlayer.vue` 内部状态机：`poster → loading → playing/paused → idle`。

- `pause` / `ended` / 鼠标离开卡片后启动 30s 计时器；计时到点且未处于播放态 → 触发 `deactivate`：卸载 `<video>`（清 `src`、`load()` 重置）、`release()` Blob、回到海报态。
- 计时器在 `play`、`pointerenter`、`seeking` 时清除；卡片重新可见/鼠标移入时不做提前加载，用户点播放再激活。
- 卸载时保留 `currentTime`（显示在进度条上），下次激活不自动 seek，避免误操作预期（可选：恢复上次位置，本次不做）。
- 页面隐藏（`visibilitychange`）时直接卸载，不等待超时。

### 3.5 UI 影响

- 视觉变化：黑屏 → 首帧画面；首帧模糊程度与素材库网格一致。
- 交互变化：首次点击播放会有一次「点亮」过程（要点：此时才发起 Blob 读取，播放启动比现在略慢，需要在按钮上加 loading 态）。
- 海报态的播放按钮沿用现有 `playButton` 样式，避免新增视觉语言。

## 四、风险与取舍

| 风险 | 处理 |
| --- | --- |
| 缓存布局改造影响素材库缩略图 | 布局改造后旧缓存自然失效，可再生；素材库端只依赖 `ensureAssetThumbnail` 返回值，不感知路径 |
| 启动清扫耗时 | 仅遍历一级目录 + 读小文件，异步执行、失败只记日志；目录数上限与现有素材量同量级 |
| 激活时机遗漏导致「点播放没反应」 | 统一由 `videoPlayer` 内部 `activate()` 触发，节点只提供 `acquire` 回调 |
| FFmpeg 缺失 | 端点 404，前端回退旧路径，行为不倒退 |
| 首帧抽在 0.5s，个别视频开头是纯黑 | 沿用素材库策略保证一致性；如需要可后续改为「0.5s 与 5% 时长取小」 |

## 五、验收标准

1. 新拖入视频，节点首屏即为首帧图，无需等待解码；网络面板无整段视频请求。
2. 未播放的视频节点，`performance.memory` 或不出现大 Blob（对比改造前同一画布）。
3. 点击播放：按钮 loading → 播放；进度、音量、全屏、截帧可用。
3.5 播放后暂停 30s：`<video>` 元素被移除、Blob 释放（DevTools Memory 快照中该 ObjectURL 消失）；再次点播放可立即恢复。
4. 删除视频节点后，`cache/thumbs/<hash>/` 目录消失；删除前停掉应用再启动，孤儿目录被清扫。
5. 关闭 FFmpeg（或指向无效路径）时，视频节点回退为旧行为且不报错刷屏。
6. `vue-tsc`、`bun run build:nodes`、`bun run build` 通过，应用重打包后实测。

## 六、评审意见

用户确认：范围取 `videoNode + videoGenerationNode`；下载/全屏改为「点击时先加载再执行」；缩略图边长 512。

子 agent 评审出的阻断项与处理：

| 阻断项 | 处理 |
| --- | --- |
| `resolveWorkspaceFile` 无法带 `sameOriginMedia` | 加 options 参数，缩略图端点传 `{ sameOriginMedia: true }` |
| 只靠标记会漏同源校验 | 端点层先 `assertAssetRequest(req, { media: true })`，再走路径解析 |
| 新项目 `.library` 标记未创建 → 首屏 404 | 媒体端点项目标记放宽为「素材库索引 **或** `.toonflow` 目录」 |
| `thumbUrl` 放在 web lib，节点包引用不到 | 扩展 `WorkspaceFiles` 契约 + `useLazyFileUrl`，经 `useNode().files` 暴露 |
| 惰性化让下载/全屏不可用 | `nodeSkeleton` 新增 `downloadResolver` / `fullscreenResolver` |
| 海报态点不到播放/进度/截帧 | `src` 为空即海报态，播放按钮可点并 emit `activate` |
| 先 open 后激活会被 `videoActions` reset | 改为 `await activate()` 后再 open |
| `rm` 后无法反推缓存键 | 删除后去抖 `scheduleThumbnailSweep`，不做逐文件回收 |
| 静态 import 会让缓存落到默认 data 目录 | `app.ts` 在 `TOONFLOW_DATA_DIR` 确定后动态 import 再 sweep |

高优项的落地：缓存键与 ETag 均含 `edge+size+mtime`；FFmpeg 缺失返回 424 而非 404；`posterUrl` 存在时才跳过 canvas 兜底；节点宽度改用海报 `naturalWidth` 定宽；输出替换时重置 `videoWidth` 并由 `useLazyFileUrl` 的 watch 释放旧 Blob；清扫跳过卷未挂载与 10 分钟内的新目录。

未处理（记录在案）：desktop 与 remote 网关统一 `no-store`，远程模式下缩略图不走 HTTP 缓存；素材库删除（非工作区 `remove`）暂不主动触发清扫，依赖启动清扫与去抖清扫。
