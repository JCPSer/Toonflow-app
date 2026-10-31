# 需求方案：视频节点「首帧 / 尾帧」可配置输出

- 时间：2026-10-31 09:35（v1）
- 对应需求：`1_requirements_matrix/2026-10-31-09-35-video-frame-outputs.md`
- 代码基线：`feat/exec-node`（`783aeda`）

## 1. 方案总览

不改宿主，全部落在节点插件侧：

```
视频节点 / 视频生成节点
        │  声明期算出初始 handles（按 node.data.frameOutputs）
        ├── useNode({ handles })            → 端口与输出值随画布持久化
        │
        └── useFrameOutputs(...)            ← 新增共享模块 @toonflow/node-video/frameOutput
                 ├─ 端口增删 + 连线回收提示
                 ├─ 宿主 ffmpeg 抽帧（JPEG q95 4:4:4）
                 └─ 值回填 / 清空 / 并发合并
```

判定依据：

- 端口不是宿主写死的，是插件持有的 `handles` ref，`nodeSkeleton.vue:756` 同步进画布 JSON；
- 端口消失时宿主**自动删除悬空连线**（`nodeSkeleton.vue:766-774`），关闭输出项无需自己拆线，只需计数提示；
- 分享导出按画布字符串递归收集引用（`collect.ts:141`），帧图自动进包。

## 2. 数据结构

| 位置 | 结构 | 说明 |
| --- | --- | --- |
| `node.data.frameOutputs` | `{ first?: boolean; last?: boolean }` | 缺省视为全关；只存 `true` 也可，读取时统一按布尔兜底 |
| `node.data.outputs.firstFrame` | `{ dataType: "IMAGE", value: { url: "assets/<id>/frame-first.jpg", mimeType: "image/jpeg" } }` | 由 `nodeSkeleton.vue:761` 同步 |
| `node.data.outputs.lastFrame` | 同上，`frame-last.jpg` | |
| `node.data.handles` | 原 `in` + `video`，按开关追加 `firstFrame` / `lastFrame` | 宿主同步写入 |

端口定义：

| id | type | dataType | label |
| --- | --- | --- | --- |
| `firstFrame` | source | `IMAGE` | 首帧输出 |
| `lastFrame` | source | `IMAGE` | 尾帧输出 |

顺序固定为 `in`（target）→ `video` → `firstFrame` → `lastFrame`，关闭中间某一路时后面的端口上移，不做占位。

## 3. 关键时序：初始化必须先算 handles

`useNode()` 在初始化时用**声明期 handles** 过滤 `node.data.outputs`（`useNode.ts:29-36`）。若沿用现在的写法（`defineOptions` 只声明 `video`），那么 `firstFrame` 的已保存值会在挂载时被静默丢弃，用户重开工程就看到空图。

因此两个节点统一改成：

```
nodeId   ← useNodeId()
flow     ← useVueFlow()
saved    ← flow.findNode(nodeId)?.data
initial  ← buildFrameHandles(saved?.frameOutputs, 声明期基础端口)
{ handles, outputs, ... } ← useNode({ handles: initial })
```

兜底：若 `findNode` 在极端时序下拿不到节点，退回声明期 handles，并在**同一个 setup 内、`useNode()` 之后立即**按 `node.data.outputs` 补回丢失的帧值。

> 不能放到 `onMounted`：`nodeSkeleton.vue:758-762` 的 `watchEffect` 是立即执行的，会在子组件首帧就把握手后的 `node.data.outputs` 覆盖掉，父组件的 `onMounted` 已经读不到原值。

两个节点传入的 `node` 是 vue-flow 的节点本体（响应式对象），**不要**包 `computed`；`useNodeId()` 返回的是 **string** 而不是 ref。

## 4. 共享模块 `@toonflow/node-video/frameOutput`

新增 `packages/nodes/videoNode/src/frameOutput.ts`，在 `packages/nodes/videoNode/package.json` 的 `exports` 增加 `"./frameOutput"`。视频节点（同包）与视频生成节点（已依赖 `@toonflow/node-video`）共用。

对外接口（伪代码）：

```
FRAME_OUTPUTS = [
  { key: "first", handleId: "firstFrame", fileName: "frame-first.jpg", label: "首帧" },
  { key: "last",  handleId: "lastFrame",  fileName: "frame-last.jpg",  label: "尾帧" },
]

buildFrameHandles(enabled, baseHandles) → NodeHandle[]      // 纯函数，可单测

useFrameOutputs({
  id,              // string | ref，useNodeId() 直接给
  node,            // vue-flow 节点本体（响应式对象），不是 Ref
  outputs, handles, baseHandles,
  getFiles,        // () => WorkspaceFiles
  createFfmpeg,    // 由 useNode() 解构出的 ffmpeg
}) → {
  enabled: ComputedRef<{ first: boolean; last: boolean }>
  values:  ComputedRef<{ first?: string; last?: string }>
  busy:    Ref<boolean>
  error:   Ref<string | undefined>
  toggle(key, on): Promise<void>     // 开启=先抽帧再出端口；关闭=清值+移除端口（保留文件）
  refresh(sourcePath?): Promise<void> // 清空已开启端口 → 串行抽帧 → 回填
  clear(): void                      // 仅在「视频被清空」时用；视频写入由 refresh 内部清
}
```

连线计数用内部 `useVueFlow().getEdges`，不需要调用方传入。

抽帧命令（复用 `videoPlayer.vue:401-425` 的既有口径）：

```
首帧：ffmpeg -i <src> -map 0:v:0 -frames:v 1 -c:v mjpeg -q:v 2 \
               -pix_fmt yuvj444p -update 1 -y <out.jpg>
尾帧：ffmpeg -sseof -1 -i <src> -map 0:v:0 -c:v mjpeg -q:v 2 \
               -pix_fmt yuvj444p -update 1 -y <out.jpg>
```

- `-sseof -1` 是**输入选项**（与现有实现一致），逐帧覆盖同名文件，落盘即最后一帧；
- `-update 1` 让 image2 复用同一文件名，否则会告警且可能按序列命名；
- 不缩放，保持原始分辨率；
- `-q:v 1` 与 `-q:v 2` 映射到同一组量化表（实测文件字节数完全相同），统一写 2；
- 走 `useNodeFfmpeg(signal, { silentRequired: true })`，缺 ffmpeg 时静默失败，不弹安装引导（与截帧一致）。

### 4.1 实测数据（ffmpeg 8.x / macOS arm64）

| 用例 | 体积 | 耗时 | 质量 |
| --- | --- | --- | --- |
| 1920×1080 照片，q2 + `yuvj444p` | 119 KB | 0.08 s（首帧） | RGB 域 PSNR 48.97 dB |
| 同上，q2 + `yuvj420p` | 90 KB | — | PSNR 47.32 dB（低 1.6 dB，色度有损） |
| 1920×1080 合成测试图，q2 + `yuvj444p` | 190 KB | 0.08 s / 0.14 s（尾帧） | — |
| 同一帧 PNG | 325 KB | — | 基准 |
| 尾帧正确性 | — | — | 与「解码第 89 帧（末帧）」逐像素相同（PSNR = inf） |

结论：4:4:4 用 32% 的体积换 1.6 dB 色度保真，性价比成立；1080p 单帧实际在 0.1–0.3 MB 量级，磁盘代价可忽略。

## 5. 状态迁移

### 5.1 开启某一项

```
若当前视频存在：抽帧落盘（强制重抽，不信任残留旧值）→ 写入 outputs[handleId] → 追加端口
若当前无视频：只追加端口，值为空（等下一次生成/替换）
```

顺序上**先抽帧成功再追加端口**，避免出现一个连上去却没值的端口。关闭期间视频可能已经换过，所以重新开启必须重抽，不能直接复用上次的值。

### 5.2 关闭某一项

```
1. 统计该端口连线数 N（flow.getEdges 里 source === nodeId && sourceHandle === handleId）
2. 从 handles 移除端口、删除 outputs[handleId]
3. 帧文件**保留**（理由见下）
4. N > 0 时提示「已关闭并断开 N 条连线」
```

宿主会在 `props.handles` 变化时自动 `removeEdges`，这里只负责计数与值清理。

**不删文件的理由**：节点复制会复制 `node.data.outputs` 里的同一路径，两个节点指向同一个 `assets/<源id>/frame-*.jpg`。关闭输出项时删文件，会把复制节点正在用的图一并删掉。保留文件的代价只是节点目录里多一张 0.1–0.3 MB 的孤儿图（节点删除时随目录一起清理）。

### 5.3 视频变化（生成完成 / 替换 / 切历史）

```
clear()                       // 立即把已开关口的 value 置空，杜绝旧帧错配
abort 在途抽帧
refresh(newSourcePath)        // 串行抽首帧、尾帧，每抽完一张就回填
```

`refresh` 内部维护单一 in-flight promise：新的 refresh 会先 abort 旧的，再排队执行，保证同一节点不会被两轮 ffmpeg 交错写同名文件。

### 5.4 失败

分两条路径，不要混：

| 场景 | 行为 |
| --- | --- |
| **开启端口时**抽帧失败 | **不写 `frameOutputs`、不追加端口**，只弹一次警告。避免留下一个永远空的端口，也让用户重试时状态干净。 |
| **视频变化后重抽**失败 | 端口保留、值保持空，弹一次警告；已成功的那张照常回填。菜单里的「重新抽取」调用 `refresh(当前视频)`。 |
| 抽帧被新的视频切换打断 | 静默，不弹警告（属于预期行为）。 |

### 5.5 节点禁用 / 删除

- 禁用：沿用 `nodeInputs.readSourceValue` 的既有规则，输出视为空，不新增逻辑。
- 删除：画布 `provide("retainNodeFiles", true)`（`canvas/index.vue:476`），`removeNodeFiles()` 实际是空操作；文件由 `nodeAssetCleanup` 在节点被撤销栈淘汰后按 `assets/<uuid>` 回收，帧文件同目录一起清掉，无需额外处理。

## 6. UI 设计

位置：节点右上角工具栏，现有「截取视频帧」按钮**左侧**。

```
┌──────────────────────────────────────────────┐
│ [输出项 ▾] [截帧 ▾]        ← 工具栏          │
└──────────────────────────────────────────────┘

点击「输出项」：
┌────────────────────────────────┐
│ ☑ 首帧输出        [缩略图 96×54] │
│ ☐ 尾帧输出        [缩略图 96×54] │
│ ────────────────────────────── │
│ ↻ 重新抽取                      │
└────────────────────────────────┘
```

- 未产生视频时两个勾选项仍可点，缩略图位置显示占位图标；
- 抽帧中勾选项右侧显示 loading，禁止重复点击；
- 失败时下拉里显示一行红字原因，并提供「重新抽取」。

## 7. 改动清单

| 文件 | 改动 |
| --- | --- |
| `packages/nodes/videoNode/src/frameOutputPlan.ts` | 新增：端口构造、ffmpeg 参数（纯函数，无运行时依赖） |
| `packages/nodes/videoNode/src/frameOutputPlan.test.ts` | 新增：纯函数与命令参数单测 |
| `packages/nodes/videoNode/src/frameOutput.ts` | 新增：`useFrameOutputs` 组合式函数（端口增删、抽帧、排队、清空） |
| `packages/nodes/videoNode/src/components/frameOutputMenu.vue` | 新增：两个节点共用的「输出项」下拉 |
| `packages/nodes/videoNode/package.json` | 增加 `"./frameOutput"`、`"./frameOutputMenu"` 两个 export |
| `packages/nodes/videoNode/src/index.vue` | 初始化 handles、上传/替换/`setVideo` 后重抽、UI 下拉 |
| `packages/nodes/videoGenerationNode/src/index.vue` | 同上 + 媒体历史 select/clear 后重抽 |
| `packages/nodes/videoGenerationNode/package.json` | 无需改动（已依赖 `@toonflow/node-video`） |

不改：`nodeScaffold`、`nodeSkeleton`、画布、`workspaceShare`、服务端。

### 7.1 统一的视频写入入口

所有会改 `outputs.video` 的位置，一律「先赋值，紧接着 `refresh()`」，**不**在生成开始时提前清空：

| 节点 | 入口 | 位置 |
| --- | --- | --- |
| 视频 | 上传视频 | `videoNode/src/index.vue` `uploadVideo()` |
| 视频 | Agent 工具 `setVideo` | `videoNode/src/index.vue` `nodeTools.register("setVideo")` |
| 视频 | 替换视频 | 复用 `uploadVideo()` |
| 生成 | 生成成功 | `videoGenerationNode/src/index.vue` `startGeneration()` 的 `.then` |
| 生成 | 替换视频 | `replaceOutput()` |
| 生成 | 媒体历史「设为当前结果」 | `mediaHistory @select` → `selectVideo()` |
| 生成 | 媒体历史「清除」 | `mediaHistory @clear` → `clearVideo()`，此时调用 `frames.clear()` |

视频节点**没有**媒体历史，不要给它接 `mediaHistory` 钩子。

## 8. 测试计划

| 层次 | 覆盖 |
| --- | --- |
| 单测 | `buildFrameHandles` 增删顺序；`frameOutputOptions` 首帧无 `-sseof`、尾帧有；`frameOutputs` 只认显式 `true` |
| 静态 | 两个节点包 `vue-tsc --noEmit`；`bun run build:nodes` 通过 |
| 真机 | ① 开首帧 → 端口出现、图正确；② 开尾帧与手动「截取尾帧」画面一致；③ 切媒体历史/清除 → 帧跟随；④ 关闭 → 连线断开、端口与值消失、文件保留；⑤ 重开工程 → 端口与图都在；⑥ 复制节点后原/副本开关互不影响；⑦ 分享导出再导入 → 首/尾帧可显示 |
| 体积 | 记录 1080p 单帧实测值（典型 0.1–0.5 MB，噪点素材可到 ~1.75 MB），与 PNG 对比倍率；不设硬阈值 |

## 9. 风险与回退

| 风险 | 处置 |
| --- | --- |
| 4:4:4 JPEG 在某个下游不兼容 | 实测 `<img>`、图像节点、视频生成参考三处；异常则改 4:2:0（`yuvj420p`），体积略小、色度有损 |
| 初始化时序拿不到节点数据 | setup 内自愈（§3） |
| 生成节点与视频节点的钩子点漂移 | 抽帧与端口逻辑全部在共享模块，两个节点只调用；入口清单见 §7.1 |
| 无视频轨素材 | 开启时失败不出端口；重抽失败留空端口 + 警告 |
| 带封面图的音频素材 | `-map 0:v:0` 会抽到封面图而不是失败——与现有「截取视频帧」口径一致，暂不特判 |
| 端口增删不可撤销 | 撤销快照只存 `label/disabled`，不存 `data`（`useCanvasHistory.ts`），端口开关天然不进撤销栈，属预期 |

## 10. 评审意见

### 第一轮：子 agent 架构评审（2026-10-31 09:50）

结论：**需修订**。主干成立（不改宿主、动态端口可行、宿主自动删悬空连线、`-sseof` 口径可复用），但文档有 6 处会导致返工。已按下列处置：

| # | 意见 | 处置 |
| --- | --- | --- |
| P0-1 | 自愈写成 `onMounted` 读写 `node.data.outputs` 拿不到值（`nodeSkeleton.vue:758-762` 的 watchEffect 立即执行并覆盖） | 改为 setup 内、`useNode()` 之后立即自愈 |
| P0-2 | 关闭输出项删文件会破坏复制节点（复制节点共享同一 `outputs` 路径） | 关闭只清值与端口，保留文件；R9 验收同步改 |
| P0-3 | §5.1「先抽帧再出端口」与 R8「端口留空」矛盾 | 拆成两条路径：开启失败不出端口；重抽失败留空端口（§5.4） |
| P0-4 | 生成开始就清空，失败/取消后旧帧消失且不恢复 | 删掉「开始生成时 clear」，只在写入新视频时由 `refresh` 内部清 |
| P0-5 | 漏了 `mediaHistory @clear`、`setVideo` 工具；视频节点其实没有媒体历史 | §7.1 列出全部写入口；明确视频节点不接媒体历史 |
| P0-6 | 体积阈值 1 MB 不成立（噪点素材实测 1.75 MB）；shell 写法不能照抄 | 改为不设硬阈值只记录实测；文档明确 `outputOptions` 必须逐项传参 |
| P1-7 | `removeNodeFiles()` 并不会立即删目录 | 说明实际由 `nodeAssetCleanup` 延迟回收 |
| P1-8 | §4 接口签名缺 `baseHandles` / `createFfmpeg` | 已补全，并注明 `useNodeId()` 返回 string、`node` 不是 Ref |
| P2-9 | 若干行号偏差 | 已按证据更正 |

### 第二轮：实现代码评审（2026-10-31 10:05）

结论：**主体成立，但存在一个会让功能永久卡死的状态机缺陷**。已全部修复：

| # | 问题 | 修法 |
| --- | --- | --- |
| 1（严重） | `busy` 靠「最后一个任务」归零：`refresh()` 在 `wanted` 为空时提前 return、`toggle` 被 abort 后 catch 也跳过归零 → `busy` 永久为 true，勾选项与「重新抽取」全部禁用且无法自救 | 改为**在途操作计数** `activeOps`，`busy = activeOps > 0`；每个任务在 `finally` 无条件减一；`epoch` 只用于判断结果是否过期，不再参与 `busy` |
| 2 | 「首次开启端口」被视频变化打断时静默丢弃，用户点了没反应 | 打断时提示「视频已更新，请重新开启 X 输出」 |
| 3 | `el-checkbox` 依赖隐藏 input 的 change，抽帧失败后 input 与 `modelValue` 失步，下一次点击是空操作（要点三次） | 菜单改为自绘的 `role="menuitemcheckbox"` 按钮行，不再有隐藏 input |
| 4 | 落盘校验只看「文件是否存在」，而文件名固定且关闭端口不删文件 → 一路静默失败会把**上一版视频的旧帧**回填 | 改为写唯一临时名 `<file>.<uuid>.tmp.jpg`，校验存在后 `rename` 到固定名；失败清理临时文件 |
| 5 | **跨模块回归**：画布「复制到剪贴板」取节点里任意 IMAGE 输出，视频节点一旦有帧就变成复制图片，节点 JSON 进不了剪贴板 | `imageOutput()` 遇到 VIDEO/AUDIO/FILE 输出直接返回空，走原有节点复制路径 |
| 6 | 挂载自检按「固定文件名」判断，复制出来的节点（值指向源节点目录）会被误判缺失并清掉本来可用的值 | 改为按 `values[key]` 的实际路径校验目录与文件名 |
| 7 | 自愈块会把未通过 `isNodeOutput` / 类型校验的值塞回 `outputs`，绕过 `useNode` 的过滤 | 补 `isNodeOutput` + `isTypeCompatible(…, "IMAGE")` |
| 8 | 关闭端口不中止在途抽帧，抽完可能把值写回已删除的端口 | 关闭时 `abort()` + `epoch++`；写值前再确认 `enabled[key]` |
| 9 | 抽帧第一路失败会中断第二路 | 每项独立 `try/catch`，成功的那张照常回填 |
| 10 | 禁用节点挂载仍会抽帧写盘 | `onMounted` 先判 `node.data.disabled` |

评审确认**无需修改**的部分：`useNode` 之前用 `findNode(useNodeId())` 读配置成立；宿主自动删边与 `getEdges` 计数可靠；节点复制后副本与原件互不影响；分享导出不会误删且能正确收包；纯音频素材失败会被吞成警告。
