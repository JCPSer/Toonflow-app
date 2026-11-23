# 记忆：画布渲染架构级优化（节点内容降级 + Canvas 连线）

- 时间：2026-11-22 09:35

## STAR

**Situation**：前五批清掉每帧布局读取与常驻模糊后，201 节点 / 179 边平移仍 26–33ms。
四层全部 `display:none` 仍 33ms，说明瓶颈不是"连线光栅化"，但 DOM 规模确实让样式重算与
图层内容一直很重；同时 `previewReady` 是一次性锁存，浏览一遍后 201 个节点全部常驻渲染。

**Task**：在不改画布 JSON 格式、不丢用户状态的前提下，把渲染规模降下来，并提供能判断
"主线程 vs 合成"的基准。

**Action**：
1. 诊断浮层：主线程延迟改为每帧 0ms 定时器采样取中位数；新增「合成基准」（rAF 直接改
   `transformationpane.transform`，3 秒）与 `边根` / `DOM` 读数。
2. 节点内容分级降级：`nodeTiers.ts` 纯几何 + 迟滞（外扩 0.6 降级 / 0.25 恢复）；在节点元素上
   打 `data-canvas-tier="far"` 并用显式宽高钉住 `.contentCard`，`content-visibility: hidden`
   跳过整棵内容子树的样式与绘制。端口、标题栏、播放器、运行态全部保留且可逆；选中/拖动/
   焦点在节点内/媒体播放中/分组节点/对话面板指向的节点永不降级。
3. Canvas 连线层：`edgePaths.ts`（与库内 `getHandlePosition`/`getSimpleBezierPath` 同构）+ 
   `edgeCanvasLayer.vue`（栅格快照 + CSS 跟随，平移缩放 0 重绘）。库内边层用 CSS 隐藏、
   边组件插槽渲染空组件，path 由 358 → 0。命中使用 `isPointInStroke` 40 画布单位，
   点击弹同一个断开气泡，悬停补 cursor，显隐/配色/虚线动画/禁用透明度全部对齐。

**Result**：28 例单测通过、构建成功、已同步待重启。真机需用浮层读两组数判断是否还需继续收敛
主线程（判读方式见测试记录）。
