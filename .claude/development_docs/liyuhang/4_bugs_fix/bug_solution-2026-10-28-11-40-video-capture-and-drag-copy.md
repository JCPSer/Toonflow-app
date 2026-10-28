# bug 修复方案：视频节点截帧与画布拖动副本、素材库目录右键

- 记录时间：2026-10-28 11:40
- 对应分析：`bug_analysis-2026-10-28-11-26-video-capture-and-drag-copy.md`
- 决策：截帧在海报态也开放；首帧改为 seek 到极小时间；素材库文件/目录/空白处都提供本地定位；拖动副本不改默认键位，只确认设置可改并写清说明

## 一、B1 截帧按钮不再依赖播放

### 1.1 现状

- 按钮条件里带 `player.ready`（`videoNode/src/index.vue:28`、`videoPlayer.vue:44`）。
- `ready` 只在 `<video>` 的 `loadeddata` 里置真；海报态 `hasSource=false`，没有 `<video>`，`ready` 恒为 false。
- `captureFrame` 首行 `!ready.value` 直接 return。

### 1.2 方案

```
按钮可用条件（播放器内下拉与节点工具栏一致）：
  outputFile 存在 && !capturing && !uploading && !exporting

captureFrame：
  guard: readOnly / 缺 node、flow、files / capturing → return
  sourceUrl = await ensureSource()        // 见 1.3
  按命令决定取样时间：
    current → 播放器 video?.currentTime ?? 0
    first   → 0
    last    → 结束时间（由临时 video 的 duration 决定）
  用临时 <video> 解码并 canvas 绘制（见 B2）
```

- `ready` 只继续服务「播放/进度条/音量」这些真实播放控件，不再充当截帧前置条件。
- 节点工具栏按钮同步去掉 `player?.ready` 判断，避免海报态下仍灰着。

### 1.3 海报态取源

子层拿不到父层 `activate` 的 promise（`index.vue:95-98` 只把 `previewUrl` 传下来），且 `watch(src)` 会无条件 `captureController?.abort()`（`videoPlayer.vue:97-98`），所以「emit activate 后等 src 变化」会自我中断。改为：

```
父层 index.vue：defineExpose({ activate })

子层 captureFrame：
  if (!src) {
    awaitingSource = true
    await playerRef.activate()        // useLazyFileUrl 的 activate 在 url 已存在时立即返回
    awaitingSource = false
    if (!src) throw new Error("视频尚未就绪，请稍后重试")
  }
  controller = new AbortController()   // 必须在 src 就绪之后创建
```

- `watch(src)` 里加 `if (!awaitingSource) captureController?.abort()`，避免激活过程自己掐掉本次截帧。
- 仍然不复制文件：复用既有 activate 链路与 Blob URL。

## 二、B2 首帧取不到图

### 2.1 根因

`loadFrame` 对 `time === 0` 走 `onloadeddata` 直接 resolve，不等待一次 seek。此时只保证「有数据可用」，不保证解码出的画面已经可绘制；WebKit 上 `drawImage` 常得到全黑帧。尾帧走 `currentTime = duration - 0.001` 的 `seeked` 路径，所以正常。

### 2.2 方案

```
loadFrame(element, src, mode: { kind: "time"; time: number } | { kind: "last" }):
  element.preload = "auto"; element.muted = true
  onloadedmetadata:
    total = element.duration
    若 !Number.isFinite(total) 或 total <= 0 → reject("无法读取视频时长")
    target = mode === "last" ? clampLast(total) : clampTime(mode.time, max(0, total - 0.05))
  element.currentTime = target            // 注册 seeked 之后才赋值
  onseeked:
    若 element.readyState >= 2 且 element.videoWidth > 0 → resolve
    否则 reject("视频帧尚未就绪")
  onerror → reject("无法读取视频帧")
  超时 15s / abort → reject

clampLast(total):
  total <= 0.1 ? 0 : total - 0.05          // 极短视频不去减到负数
clampTime(time, max):
  time <= 0 ? 0.05 : Math.min(time, max)   // 首帧固定取 0.05s，强制一次真实 seek
```

关键约束（评审指出）：

- **不要**在赋值 `currentTime` 后用 `|currentTime - target|` 判断就绪：赋值会同步改变 `currentTime`，且 `loadedmetadata` 时 `readyState` 常已 ≥2，会立刻假成功、画到旧帧。
- **唯一 resolve 入口是 `seeked`**，并在其中再校验 `readyState >= 2 && videoWidth > 0`。
- 目标时间恰好等于当前时间时不会触发 `seeked`，因此首帧统一取 `0.05` 而不是 `0`。
- `duration` 非有限值（流式/损坏文件）直接报错，避免算出 NaN 永远等待。
- 三种命令都走临时 `<video>`，但**当前帧的时间取播放器元素的 `video.value.currentTime`**（不是 `currentTime` ref，`watch(src)` 会把它清零）；海报态没有 `<video>`，当前帧回退为取海报帧同位置（0.05s）并在提示里说明。

## 三、B3 素材库目录右键本地定位

### 3.1 前端

| 位置 | 现状 | 改动 |
| --- | --- | --- |
| 网格/列表中的文件与**文件夹** | 非背景分支已对所有 entry 渲染 `reveal-in-os`（`AssetContextMenu.vue:18-20`） | 无需改动 |
| **空白处**右键 | 只渲染「新建文件夹 / 上传到此」（`AssetContextMenu.vue:14-17`） | 增加 `reveal-in-os`，定位到当前目录 |
| 目录树根节点 | `AssetTreeView.vue:291-294` 把 `path=""` 的 root 交给 `showEntryMenu`，后者转成 `background=true`，同样落在缺失分支 | 由上面的背景分支改动一并覆盖；执行前需确保库已切换完成 |

执行命令时 `selector()` 读的是当前 store 状态，树根切换库走的是 `emit("select-library")`；命令处理里先 `setLibrary`/等待一次 tick 再调 reveal，避免定位到上一个库。

### 3.2 服务端

不要放宽共用的 `pathField`（11 个路由 + 批量数组都在用）。在 `reveal.ts` 内单独声明：

```
const revealPathField = z.string().max(4096)   // 允许空串表示库根
```

`resolveWorkspacePath(root, "")` 解析到库根本身，`isWithin` 成立，`lstat` 为目录，`showItemInFolder` 直接选中。`.trash/.library/.thumbs` 仍由 `assertAssetRelativePath` 拒绝；`reveal.ts` 没有 `protectWorkspaceRoot`，不需要额外放行。

## 四、B4 拖动副本

结论：**不改默认键位**（用户已选「只改代码不改默认」）。现有实现已支持在设置里把「创建副本」改为 Opt+Shift：

- `shortcutPressed` 对四个修饰键做严格全等比较（`canvasShortcuts.ts:120-121`），按住 Opt+Shift 时 `copyOnDrag="Alt"` 不会误命中；
- `canvas/index.vue:304-305` 先算 duplicate 再算 copy，语义不重叠；
- `isShortcutAllowed` 对 drag 只要求纯修饰键，`Alt+Shift` 合法；冲突检测只比字符串全等，`Alt` 与 `Alt+Shift` 可共存。

改绑后拖动走 `duplicateNodes(withEdges = true)`：新 id、触发节点 `copy` 事件、带**入边**（连线）、标签追加「 - 副本」，与用户期望一致，代码无需改动。

本轮只做两件小事：

1. 设置项说明补一句：录制纯修饰键要「按住目标组合再松开」，`Opt+Shift` 这类组合对松开顺序敏感，避免录成 `Shift` 或 `Opt`。
2. 回归确认 Opt=复制（不带连线）、Opt+⌘/Ctrl+Alt=创建副本，改绑后立即生效。

## 五、测试方案

1. 类型检查：`@toonflow/node-video`、`@toonflow/web`、`@toonflow/server`。
2. 海报态（未播放）点截帧：首帧/尾帧/当前帧都能生成图片节点；首帧不是全黑。
3. 播放中截帧：当前帧与画面一致，且不会打断播放/改变进度。
4. 素材库：右键文件夹 → 访达选中该目录；右键空白处 → 访达选中当前目录；右键库根 → 选中库根；远程/移动端不出现该项。
5. 设置里把「创建副本」改为 Alt+Shift 后拖动：带连线、标签为「xxx - 副本」、原节点不变；Opt 拖动仍是复制。
6. `.trash` / `.library` 路径 reveal 仍 403。

## 六、风险

| 风险 | 处置 |
| --- | --- |
| 海报态激活整段视频，大文件有等待 | 复用既有 activate 链路与 15s 超时提示；不额外复制文件 |
| 0.05s 与真正首帧存在极小差异 | 视觉无差别；如需严格 0s 可后续加服务端抽帧兜底 |
| 临时 video 与播放器同时解码，内存翻倍 | 截帧结束立即 `removeAttribute("src") + load()` 释放（现有 finally 已有） |
| reveal 允许空 path 后误定位库根 | 仅本机+桌面双重守卫；内部目录仍被拒 |

## 七、评审意见

- 子 agent 方案评审（2026-10-28 12:05）：
  - B1：「emit activate 后等 src 变化」不可行——子层拿不到 activate 的 promise，且 `watch(src)` 会无条件 abort 本次截帧。已改为父层 `defineExpose({ activate })` + `awaitingSource` 抑制 abort + src 就绪后再建 controller。采纳。
  - B2：`readyState>=2 && |currentTime-target|<1e-3` 会假成功（赋值同步改 currentTime、loadedmetadata 时 readyState 常已 ≥2）；目标时间等于当前时间时不触发 `seeked` 会拖到超时。已改为「`seeked` 唯一 resolve 入口 + 首帧固定 0.05s + duration 非有限值直接报错 + 极短视频 clamp」。采纳。
  - B2 补充：当前帧时间应取播放器元素的 `video.value.currentTime`，不能读被 `watch(src)` 清零的 ref。已写清。
  - B3：网格里文件夹其实已有 reveal，真正缺失的是背景分支与树根；共享 `pathField` 被 11 个路由复用，不能放宽，需在 reveal 内单独声明。已改。
  - B4：`shortcutPressed` 是严格全等，Alt 不会误命中 Alt+Shift，改绑可行；真问题是录制纯修饰键对松开顺序敏感，需在说明里提示。已采纳。
- 用户评审：
