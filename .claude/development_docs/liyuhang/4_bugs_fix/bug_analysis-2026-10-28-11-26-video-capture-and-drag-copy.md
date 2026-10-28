# bug 分析：视频节点截帧与画布拖动副本、素材库目录右键

- 记录时间：2026-10-28 11:26
- 来源：用户 2026-10-28 反馈的四条问题
- 代码基线：`b52454e`（工作区仅有 `.easyvibe/**` 地图产物改动）

## 一、背景

视频节点的截帧能力、画布拖动的复制语义、素材库右键的本地定位，是三条独立链路，但都属于「操作入口存在、行为不符合直觉」这一类问题。

## 二、bug 矩阵

### B1 「截取视频帧」只有视频播放时才可点

- 现象：视频节点处于海报态（未点播放）时，截帧下拉按钮是 disabled；必须先点播放、等视频加载出画面才能截帧。
- 优先级：P1（高频操作被迫多一步）
- 难度：低
- 风险：中（截帧依赖 `ready` 与真实解码，放松禁用条件后要保证失败有明确提示，不能出现「点了没反应」）
- 代码位置：`packages/nodes/videoNode/src/components/videoPlayer.vue:28、44、298`
  - 按钮 `:disabled="!player?.ready || player?.capturing ..."`（`index.vue:28`）与播放器内 `:disabled="!ready || capturing"`（`videoPlayer.vue:44`）
  - `ready` 只在 `<video @loadeddata>` 触发时置真（`readPreview`），而海报态下 `hasSource=false`，`<video>` 根本不存在 → `ready` 永远 false
  - `captureFrame` 首行直接 `if (... || !ready.value || ...) return;`，海报态无从进入
- 根因：`ready` 被同时用作「播放器可交互」与「可解码帧」两个语义；海报态没有 `<video>` 元素，前者天然为假。

### B2 「截取首帧」拿不到图，当前帧/尾帧正常

- 现象：首帧截取失败（无图片节点生成，或生成空白图）；当前帧、尾帧正常。
- 优先级：P1
- 难度：低
- 风险：中（首帧定位方式在部分编码/容器上表现不同）
- 代码位置：`videoPlayer.vue:307-320`、`loadFrame()`
- 根因推测（需复现确认）：`loadFrame` 对 `time === 0` 走 `onloadeddata` 直接 `finish()`，此时只保证有可绘制数据，未保证解码器停在首帧关键帧；同时 `source.src = src; source.load()` 之后立刻依赖 `loadeddata`，在某些 WebKit 版本里 `loadeddata` 早于可绘制帧到来，`drawImage` 得到全黑或空图。尾帧因为走了 `currentTime = duration - 0.001` 的 `seeked` 路径，反而稳定。

### B3 素材库文件夹没有「打开本地目录」

- 现象：素材库文件可以右键在访达中显示，但**文件夹**（含目录树节点）没有该菜单项；空白处右键也没有。
- 优先级：P1
- 难度：低
- 风险：低
- 代码位置：`apps/web/src/pages/workspace/panels/assetLibrary/components/AssetContextMenu.vue`、`index.vue:397-420`
- 根因：`reveal-in-os` 命令在非背景菜单里已渲染，但 `showBackgroundMenu` 打开的是 `background=true` 分支，该分支只渲染「新建文件夹 / 上传到此」；另外目录树节点复用的 `AssetTreeNode` 在 `AssetTreeView.onNodeContextMenu` 里被裁掉部分字段，需要确认 `type` 是否正确传递为 `directory`。

### B4 Opt+拖动不是「创建副本」

- 现象：按住 Opt 拖动节点，得到的是「复制」语义（`copyOnDrag` → `startDragCopy(nodes, withEdges=false)`，只复制节点本体、不带连线、不触发节点 `copy` 事件的数据搬迁）；用户期望的是「创建副本」（`duplicateOnDrag`，带连线、触发 `useNodeEvent.emit("copy")`、标签加「- 副本」）。
- 优先级：P2
- 难度：低
- 风险：低
- 代码位置：`apps/web/src/lib/canvasShortcuts.ts:10-11`、`apps/web/src/pages/workspace/panels/canvas/index.vue:300-310`
- 根因：默认绑定把 `copyOnDrag` 设成 `Alt`、`duplicateOnDrag` 设成 `Alt+Meta`，两条路径都调用 `startDragCopy`，区别只在 `withEdges`；用户按 Opt 命中前者。用户要求「Opt+Shift 拖动才是副本，且设置里可改」，但最终决定**只改代码不改默认值**，即不改 `defaultCanvasShortcuts`，只保证设置里可自由改绑并生效。

## 三、非目标

- 不改服务端 ffmpeg 抽帧链路（首帧缩略图接口不动）。
- 不改素材库的 reveal 权限守卫与远程/移动端可见性规则。
- 不改变 `copyOnDrag` 与 `duplicateOnDrag` 的默认键位（用户已选「只改代码不改默认」）。
- 不动其它节点的截帧/预览逻辑。

## 四、验收标准

1. 视频节点处于海报态（未播放）时，截帧按钮可点；截首帧能立即得到图片节点；截当前帧在海报态下取海报帧（或提示需播放后再截），截尾帧正常。
2. 海报态截帧失败时有明确错误提示，不会静默无响应。
3. 素材库中右键**文件夹**（网格与目录树）出现「在访达中显示」，点击后 Finder 选中该目录；右键**空白处**出现「在访达中显示当前目录」并定位到当前路径。
4. 设置里把「创建副本」改成 Opt+Shift 后，Opt+Shift 拖动生成带连线、带「- 副本」标签、触发节点 copy 事件的新节点；Opt 拖动保持原复制语义。
5. 未修改设置的用户，默认行为与升级前一致（Opt=复制，Opt+⌘=创建副本）。

## 五、评审意见

- 子 agent 初审：
- 用户评审：
