# 修复方案：视频预览 + 文本节点流式输出导致画布卡死

日期：2026-10-26 15:50（16:40 按评审修订）
对应分析：`bug_analysis-2026-10-26-15-20-canvas-freeze-video-stream.md`

## 一、总体思路

两条互不依赖的改动，分别去掉两个成本源：

1. **文本流式降频**：delta 先进本地缓冲，按固定时间片（200 ms，长文自适应到 400 ms）写回 `outputs.text.value`。`outputs` 仍是唯一真源，下载/复制/文档读取/存盘语义不变；节点渲染与画布 `data` watcher 的频率从「每 delta」降到「每秒 2–5 次」。
2. **视频单播放**：应用级协调器统一管理 `<video>/<audio>`，任何时刻只允许一个媒体在播；画布不可见、页面隐藏时自动暂停。

不在本次范围：`preload` 收敛（会让 `ready` 永不置位、播放按钮永久禁用，需单独设计）、把 el-tree 改增量更新。

## 二、文本节点流式改造（`packages/nodes/textNode/src/index.vue`）

### 2.1 缓冲与节流

```
生成开始：
  received = false; buffer = ""; flushTimer = undefined
  outputs.value.text.value 保持不变

onEvent(text):
  received = true; buffer += delta
  若没有待执行的 flushTimer：
    flushTimer = setTimeout(flush, interval)

flush():
  flushTimer = undefined
  outputs.value.text.value = buffer

interval = buffer.length > 20000 ? 400 : 200
```

- 停止/结束时立即 `flush()` 并清掉计时器。
- 不在 `markdownPreview` 里再引入第二套计时器，rAF 合并已足够。

### 2.2 收尾的三种情况（数据安全）

| 情况 | 处理 |
| --- | --- |
| 正常完成 | `outputs.value.text.value = result.text`（信任服务端最终文本，不用 buffer 覆盖） |
| 用户停止 / 流中断，且 `received` | `outputs.value.text.value = buffer` |
| 一个 delta 都没收到就失败（引用为空、401、网络错误、立刻停止） | **不写 `outputs`、不保存**，保留原正文 |

`finally` 里的 `saveText` 只在「正常完成」或「有 delta 的中断」时执行；无 delta 失败保持原文件不动。

### 2.3 `save` 事件与生成中落盘

`nodeEvent.on("save")` 现在生成中保存 `outputs.value.text.value`。改造后：

- 生成中：保存 `buffer`（若 `received`），否则跳过；保持 `documentState.dirty = true`，避免误标已保存。
- 生成结束：走 2.2 的收尾，再由 `saveText` 落盘。

### 2.4 输出消费者对照

| 消费者 | 位置 | 生成中的取值 |
| --- | --- | --- |
| 节点模板 / 文档面板预览 | `textNode/src/index.vue:12-18`、`nodeSkeleton.mountDocument` | `outputs`（最长 200–400 ms 延迟），可接受 |
| 下载按钮 | `index.vue:91-97`（watch outputs） | 同上延迟 |
| 节点复制 / 下游 copy | `nodeEvent.on("copy")` | 同上延迟 |
| `readDocumentNode` | `canvas/index.vue:649-668` | 同上延迟 |
| `nodeTools.setText` | 生成中直接抛错 | 不变 |

即所有消费者留在 `outputs`，只接受秒级延迟；不再引入 `displayText` 这第二套真源。

## 三、视频单播放

### 3.1 应用级协调器（新增 `apps/web/src/lib/mediaPlayback.ts`）

```
installMediaPlayback():
  document.addEventListener("play", onPlay, true)
  document.addEventListener("visibilitychange", pauseAllWhenHidden)

onPlay(event):
  el = event.target
  if !(el instanceof HTMLMediaElement): return
  if el.dataset.concurrent === "on": return        // 显式豁免
  for other in document.querySelectorAll("video,audio"):
    if other !== el && !other.paused: other.pause()
```

- 在 `main.ts` 中安装一次，覆盖画布节点、素材库预览、历史记录、拉片报告、任何原生 `<video>`，不依赖各组件自行注册。
- 豁免通过 `data-concurrent="on"` 标注：缩略图静音预览、摄像头/屏幕共享预览这类不应被主播放暂停的元素（实施时逐个确认）。
- 已知边界：只在当前渲染进程内生效（本应用无 iframe，可接受）。

### 3.2 画布不可见时暂停

`canvas/index.vue` 的 `active` watcher（882-887 附近）里追加：`rootEl.querySelectorAll("video")` 逐个 `pause()`。后台画布、切到文档面板都会触发。

### 3.3 不做

- 不改 `preload="auto"`、不改 `ready/poster` 逻辑（评审确认会破坏播放按钮与首帧）。
- 不暂停后台画布的 `<audio>`（无此场景）。

## 四、影响面

| 文件 | 改动 |
| --- | --- |
| `packages/nodes/textNode/src/index.vue` | 缓冲 + 节流 + 三种收尾 + save 分支 |
| `apps/web/src/lib/mediaPlayback.ts` | 新增协调器 |
| `apps/web/src/main.ts` | 安装协调器 |
| `apps/web/src/pages/workspace/panels/canvas/index.vue` | 非活动时暂停本画布视频 |

节点包改动需要 `bun run build:nodes`，并同步到 dev 数据目录与 app 安装目录（`initializePlugins` 不会覆盖已存在文件）。

## 五、验证要点

1. 长文本生成期间：文本预览持续更新；画布 `data` watcher 频率可测地下降（DevTools Performance 长任务减少）。
2. 「引用为空 / 401 / 立刻停止」三种失败路径下，原正文与磁盘文件保持不变（回归用例）。
3. 停止后正文完整、磁盘已保存，`documentState.dirty` 正确。
4. 播放视频 A 后播放 B：A 暂停；打开素材库预览播放：画布视频暂停；反向同样成立（协调器统一管理）。
5. 切换画布 / 最小化窗口：视频暂停。
6. 节点包构建、两端类型检查、app 重打包后复测。

## 六、评审意见

用户评审通过（2026-10-26）。

> 已采纳的评审意见：撤销历史不随 delta 触发（事实更正）；preload 收敛改为不做；协调器提升到应用级并覆盖所有原生播放器；补充三种收尾与数据安全；补充消费者对照表；建议先做三组对照实验。
