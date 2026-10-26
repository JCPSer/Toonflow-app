# 修复方案：画布性能优化 + 文本节点输入区自动隐藏

日期：2026-10-26 17:20
对应分析：`bug_analysis-2026-10-26-17-10-workspace-perf.md`

## 一、文本节点输入区

- 删除 `:bottomPinned="generating"`，`bottomVisible` 改为只看 `node.selected`，与 videoGenerationNode / imageGenerationNode 一致。
- 生成中取消选中即收起；重新点选节点可继续看到模型选择与停止按钮。
- 不改批量生成/状态显示逻辑。

## 二、渲染成本

1. **停靠面板去模糊**：`.floatingPanel.docked` 增加 `backdrop-filter: none`。停靠态底色本来就是不透明色，视觉零变化，但不再对背后画布做逐帧模糊。
2. **长文预览惰性布局**：`.textPreview` 内 `.textNodeMarkdown > *` 加 `content-visibility: auto; contain-intrinsic-size: auto 120px;`。预览仍是 240px 限高可滚动，屏外段落不再参与布局/合成。
3. 保留用户确认的两项：浮层毛玻璃、连线流动动画默认开启。若后续仍需进一步降载，可再讨论「仅高亮选中节点的连线」或性能模式。

## 三、不做 / 待办

- 不改 `preload="auto"`：`videoPlayer` 的播放按钮依赖 `loadeddata`，改成 metadata 会让按钮永久不可点，需要单独设计（ready 改到 metadata、封面单独生成）。
- 不改节点 Blob 加载方式：`acquireUrl` 会把整段视频读成 Blob 并缓存，26 节点实测堆 313 MB；改为同源 Range URL 需要新增服务端媒体端点与移动端回退，单独立项。
- 不调低 `useNodePreviewReady` 的 240px 预挂载阈值。
- 环境侧（已更正）：截图中的 GPU/内存是远端 ComfyUI 机器的数据，不代表本机；本机卡顿需以应用内帧率读数为准。

## 三之二、应用内 30 帧：自适应降级

- 新增 `apps/web/src/lib/frameBudget.ts`：每 2s 统计 rAF 帧率；连续 2 个窗口 < 45 帧 → `html[data-performance="low"]`；恢复 > 55 帧连续 3 个窗口后移除。页面隐藏时不计。
- 低帧模式下用全局 CSS 关闭浮层与工具卡片的 `backdrop-filter`、关闭 `.vue-flow__edge.animated` 的描边动画；不动用户的设置值。
- 开发者选项新增「自动降低特效」开关（默认开启），并显示「当前 N 帧」；关闭后始终使用完整效果。
- 取舍：降级约需 4s 才触发，避免瞬时卡顿误伤；恢复同样滞后，避免来回抖动。

## 四、验证要点

1. 文本节点生成中点画布空白：输入区立即收起；点回节点恢复；其它节点行为不变。
2. 停靠素材库面板时 `getComputedStyle(panel).backdropFilter === "none"`，视觉与之前一致。
3. 长文节点滚动流畅，滚动条位置与内容对应（`contain-intrinsic-size: auto` 记录真实尺寸）。
4. 26 节点画布静止 60 fps；强制动画场景不再出现 250 ms 级长帧（实测最大帧 267 ms）。

## 五、评审意见

用户选择：文本节点直接隐藏；毛玻璃保留；连线动画保持开启；长文预览限高可滚动。方案按此实施。
