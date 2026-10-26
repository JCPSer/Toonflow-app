# Bug 分析：画布 + Agent 面板性能问题 / 文本节点输入区不自动隐藏

日期：2026-10-26 17:10
状态：已实现

## 一、现象

1. 文本节点生成中，点击画布空白，输入区（promptCard）不收起；视频/图片节点会随取消选中自动隐藏。
2. 十几个节点的画布 + 右侧 Agent 面板组合下，画布卡顿明显；截图时画布整片无响应、只能强退（同期 ComfyUI 在跑，GPU 100%、内存 31.7/31.8 GB）。

## 二、已核实的事实

### 2.1 文本节点输入区

- `nodeSkeleton.vue:87`：`v-if="!readOnly && $slots.bottom && (documentTarget || bottomPinned || (bottomVisible && slotsVisible))"`。
- `textNode/src/index.vue:4-5`：`:bottomVisible="node.selected || generating"`、`:bottomPinned="generating"`。
- 其它节点（videoGenerationNode / imageGenerationNode / audioGenerationNode）都只传 `v-model:bottomVisible="node.selected"`。
- 结论：文本节点在生成期间既把可见性绑到 `generating`，又用 `bottomPinned` 钉住，取消选中也收不起来，与其它节点行为不一致。

### 2.2 性能实测（dev，26 节点 / 21 连线，复制真实画布）

| 场景 | 平均帧 | 最大帧 |
| --- | --- | --- |
| 静态（无动画无视频） | 16.7 ms | 17.6 ms |
| 强制 21 条连线动画 + 两个大浮层毛玻璃 | 18.3 ms | **266.7 ms** |
| 上一行去掉全部 backdrop-filter | 18.0 ms | 133.8 ms |
| 单视频播放 | 16.7 ms | 17.7 ms |
| 拖动节点 60 帧 | 16.9 ms | 33.9 ms |

另有页面态：DOM ≈ 3300、JS 堆 ≈ 313 MB（26 节点、3 个视频元素）。

### 2.3 发现的浪费

- `floatingPanel.vue:348-352`：`.docked` 背景已是不透明色，但仍保留 `backdrop-filter: blur(6px)`；停靠的素材库面板 360×925 每帧都在对背后画布做模糊，纯浪费。
- `workspace/index.vue:413-421`：小卡片（画布菜单、工具菜单、面板切换）也各自带一层 blur，共 6 个小区域。
- 连线流动动画默认开启（`settings.ts:64` `canvasEdgeAnimationEnabled !== false`），强制开启 21 条时最大帧从 17 ms 涨到 267 ms。
- 文本节点预览已有 `max-height: 240px; overflow: auto`，但整篇 markdown 仍全部参与布局与合成。

### 2.4 环境因素（已更正）

截图里的「ComfyUI 40.9GB/31.8GB、GPU 100%」来自另一台机器，与本机负载无关；本机内存占用未采集。不能把冻结归因于外部 GPU 竞争，需要在应用内采集帧率与内存。

## 三、根因

1. 文本节点输入区：`bottomPinned` + `generating` 绑定的历史逻辑，未跟随其它节点统一为「选中才显示」。
2. 性能：停靠面板的无效模糊、长文预览的全量布局、连线动画与视频解码叠加；在 GPU 饱和时被放大成整片冻结。

## 四、修复目标

1. 文本节点取消选中后立即收起输入区，与其它节点一致。
2. 消除停靠面板的无效 `backdrop-filter`；长文预览只布局可视区附近内容。
3. 输出可复现的测量数据，区分应用成本与环境成本。

### 4.1 追加：应用内只有 ~30 帧（dev 浏览器 60 帧）

用户反馈同一画布在 dev 浏览器 60 帧、打包应用里约 30 帧；排除了低电量模式、外接屏、窗口失焦。桌面端运行在 WKWebView，`backdrop-filter`（大块浮层 + 6 个工具卡片）与 SVG 描边动画在 WebKit 合成器上的成本明显高于 Chromium，是 30 帧最可能的来源；本地没有可自动化的 WKWebView profiling 通道，改为内置帧率监测。

## 五、评审意见

用户确认：文本节点「直接隐藏」（与视频/图片节点一致）；毛玻璃保留、连线动画保持开启、长文预览限高可滚动（已实现，保留 240px 并叠加 `content-visibility`）。
