# Bug 分析：视频预览 + 文本节点流式输出导致画布卡死

日期：2026-10-26 15:20
状态：待评审

## 一、背景

工作区里同时开着视频节点（预览可播放）和文本节点（生成中）时，文本节点每收到一段增量就会重绘自身与预览内容；用户反馈此时画布会持续卡顿，最终一次性冻结，只能强杀应用。用户补充：素材库预览弹窗和画布节点视频都会出现，且「某个瞬间直接冻结，没有明显前置掉帧过程」。

## 二、现象

1. 文本节点 `generateText` 流式输出期间，画布出现明显掉帧/卡顿。
2. 视频节点或素材库预览弹窗在播放时，卡顿加剧。
3. 最终画布完全无响应（点击、拖拽、缩放都无效），只能强制退出应用。

## 三、已核实的事实（代码层面）

### 3.1 流式刷新链路

| 环节 | 位置 | 行为 |
| --- | --- | --- |
| 增量写入 | `packages/nodes/textNode/src/index.vue:264` | `onEvent` 每收到一个 `text` delta 就 `outputs.value.text.value = text += delta` |
| 节点数据回写 | `packages/nodeScaffold/src/nodeSkeleton.vue:589-598` | `watchEffect` 把 `props.outputs` 赋给 `node.data.outputs` |
| 画布自动保存 | `apps/web/src/pages/workspace/panels/canvas/index.vue:816-855` | `element.data` 的 deep watcher → `scheduleCanvasSave`（500 ms debounce，序列化整张画布写入） |
| Markdown 预览 | `packages/nodes/textNode/src/markdownPreview.vue:24-47` | `modelValue` 变化取消上一帧并 `requestAnimationFrame` 重新 `markdownDom(全文)`；同一帧内的多个 delta 只解析一次，所以峰值是「每帧一次全文重解析」 |

> 更正（评审）：撤销历史**不随** delta 记录。`nodeRuntimeFields` 含 `data`，`stopFields` 排除了 `data`，输出变化只走 `stopData` → `scheduleCanvasSave`；且 `useCanvasHistory.capture()` 只快照 `data.label`，正文本就不进历史。

即：delta 频率决定重绘频率，没有节流；文档越长，每次 `markdownDom` 的解析成本越高。

### 3.2 视频实例与播放策略

| 事实 | 位置 |
| --- | --- |
| 节点播放器是原生 `<video preload="auto">`，无 autoplay/loop，播放由按钮触发 | `packages/nodes/videoNode/src/components/videoPlayer.vue:3-22` |
| 每个视频节点、frameAnalysis 节点各自持有一个播放器实例，没有数量上限 | 三个节点 `index.vue` + `analysisReport.vue:50` |
| 节点进入过视口后常驻，不随视口卸载 | `packages/nodeScaffold/src/useNodePreviewReady.ts:20-45`、`nodeSkeleton.vue:144` |
| Vue Flow 关闭按视口渲染 | `canvas/index.vue:19-21`（`only-render-visible-elements=false`） |
| 画布切换不卸载节点；后台画布仅 `visibility:hidden` | `canvasHost.vue:2-21, 510-519` |
| 没有任何「同一时间只播一个」或「非活动时暂停」的逻辑 | `videoPlayer.vue` 不接收 active/canvasActive |
| 素材库预览弹窗是独立 `<video>` 实例，打开时不暂停画布视频 | `AssetPreview.vue:8-21` |

结论：同时播放的视频数量 = 前台节点 + 后台画布节点 + 素材库弹窗，均独立解码。

### 3.3 其他叠加成本

- Agent 面板是 `position: fixed` + `backdrop-filter: blur(6px)` 的半透明浮层，默认覆盖在画布上（`floatingPanel.vue:340-358`）。画布每次重绘都会让模糊层重新合成。
- 文本预览、节点骨架、markdown 设备像素级重排叠加多路视频解码，主线程与 GPU 同时吃满。

## 四、根因假设（按可能性排序）

| 序号 | 假设 | 依据 | 验证方式 |
| --- | --- | --- | --- |
| H1 | 流式 delta 无节流，逐 token 触发 markdown 解析与画布重绘，与视频解码叠加后主线程饱和，任务队列持续堆积直到冻结 | 3.1、3.2 | 在长文本生成时采样 Performance 面板：确认每帧 `markdownDom` 耗时与帧率 |
| H2 | 多路视频同时解码（前台 + 后台画布 + 预览弹窗）耗尽 GPU/内存，触发一次性卡死 | 3.2 | 只保留一个视频播放，复测是否仍冻结 |
| H3 | 自动保存反复被 debounce 重置，偶发整画布 `toObject`（正文已通过 `toJSON: () => ({})` 排除，成本低于预估） | 3.1 | 统计 `toObject` 实际执行次数 |
| H4 | Agent 面板 `backdrop-filter` 在画布持续重绘时反复合成模糊层 | 3.3 | 临时去掉 blur 复测帧率 |

### 4.1 实施前应先做的对照实验

修复同时涉及节点包与 web 两层，回归面大。动手前先做三个 5 分钟对照实验，确认冻结消失的临界条件：

1. 只保留一个视频播放（其余暂停），复现生成 + 播放组合；
2. 关闭 Agent 面板（或临时去掉 `backdrop-filter`）复测；
3. 生成时缩小/移出文本节点，使预览不参与渲染，复测。

任一实验即可排除一个成本源，避免「改了三处仍卡」或「改错地方」。

## 五、修复目标

1. 文本节点流式输出不再逐 delta 触发重绘：合并增量，限制刷新频率；生成长文时帧率保持可用。
2. 全局同一时间最多一个视频在播放；后台画布与不可见节点自动暂停；非播放状态的视频不预加载整段。
3. 画布在「文本节点生成 + 视频播放」组合下不再冻结，且冻结后无需强杀（允许自动降级：暂停视频、降低刷新频率）。

## 六、优先级与风险

- 优先级：P0（冻结需强杀应用，直接阻断使用）。
- 难度：中。涉及节点包（textNode/videoNode 播放器）、web 画布与素材库三处，需要遵守节点 UMD 构建与数据目录同步流程。
- 风险：节流后文本「跳动感」变化；暂停策略可能与用户预期冲突（需保留手动播放）；修改 nodeSkeleton 的通用数据回写可能影响其它节点，需限制在文本输出场景。

## 七、评审意见

用户评审通过（2026-10-26）：先实现后实测。评审已更正「撤销历史随 delta 触发」的事实错误，并把 H3 降级。
