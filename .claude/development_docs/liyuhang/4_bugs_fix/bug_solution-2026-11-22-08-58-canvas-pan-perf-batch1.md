# 修复方案（第一批）：画布平移卡顿的直接干扰项

- 时间：2026-11-22 08:58
- 来源：`bug_analysis-2026-11-22-00-05-canvas-pan-perf-audit.md`
- 结论前提：隐藏连线/节点/地图/背景后帧耗时不变，说明不是连线光栅化；先清掉每帧的布局读取与常驻模糊。

## 改动

1. **去掉画布上方常驻模糊**：`workspace/index.vue` 的 6 类 chrome（workspaceMenu 卡片、canvasMenu、balanceCard、canvasControlsCard、panelSwitcher、toolMenu）与 `floatingPanel.vue` 悬浮态，从 `70% 透明 + backdrop-filter: blur(6px)` 改为不透明底色。画布每帧变化时不再重算这些区域的背景采样。
2. **选区工具条不再每帧强制布局**：`selectionToolbar.vue` 用 ResizeObserver 缓存工具条尺寸，`toolbarStyle` 里不再读 `offsetWidth/offsetHeight`；选中 201 个节点平移时不会再触发同步布局。
3. **缩放手势缓存画布 rect**：`canvas/index.vue` 的 `zoomCanvas` 对 `getBoundingClientRect` 做 300ms 缓存，尺寸变化时失效；滚轮/捏合 100+ 次/秒不再逐次读布局。
4. **手势定时器只建一次**：`viewport` watcher 改为时间戳 + 单次 180ms 定时器自续，不再每帧 clearTimeout/setTimeout。
5. **Agent 面板对话不再随平移重渲染**：`agentNodePanel.vue` 的 `node-binding` 与 `load-extra-mentions` 改为按 nodeId 缓存的稳定引用。
6. **节点侧省内存/请求**：图片与图片生成节点卡片缩略图 1024→384（含 warmThumb）；节点右键 `el-dropdown` 加 `:persistent="false"`；视频生成节点不再在挂载时发 DELETE 清理（仅在视频 URL 真正变化时清）。

## 未包含（后续批次）

- 卡片原文件 Blob 下载（`useFileUrl`，已由 `previewReady` 门控）、每节点 5 个编辑器组件常驻、全局钩子 fan-out：留给第三批。
- 视口持久化格式不变，仍写在画布文件里（只是延后 5 秒）。

## 验证

- web 156 例单测通过；`build:web`、`build:nodes` 成功；视图与节点包已同步（备份 `mainview.bak-20261122-085802`、`/tmp/nodes*.bak-20261122-085802`）。
- 需重启后观察浮层：`平均/最长`、`主线程 xx ms`、`层N/层E`。

## 第二批（2026-11-22 09:04）

1. 视口变化不再立刻写画布：`index.vue` 的 viewport watcher 改为 5 秒空闲 debounce；切画布/关窗仍走 `flushCanvasSave`，不会丢位置。
2. 后台画布降级：`canvasHost.vue` 的 `.backgroundCanvas` 加 `content-visibility: hidden`，隐藏画布不再参与样式重算与布局（组件与运行态保留）。
3. 音频波形按需解码：`audioPlayer.vue` 增加 `active`（来自 `useNode().previewReady`），只在节点进入视口时整段解码并缓存；`preload` 从 auto 改成 metadata。两个音频节点已传 `:active="previewReady"`。

验证：web 156 测试通过；`build:nodes`、`build:web` 成功；视图与节点包同步（备份 `mainview.bak-20261122-090400`、`/tmp/nodes*.bak-20261122-090400`）。

## 第三批（2026-11-22 09:05）

1. 图片编辑器按可见性延迟挂载：`imageNode` 与 `imageGenerationNode` 的 `imagePanorama / imageGridSplit / imageScale / imageCrop / imageAdjust` 全部加 `v-if="previewReady"`。卡片本身在不可见时也不渲染 slot，按钮不可达；节点事件只用到 save/delete，引用均带可选链，不受影响。201 个图片节点从「每个 5 个编辑器组件」降到只挂当前视口内的节点。
2. 未做：卡片原图 Blob 改懒加载（`useFileUrl` 已被 `previewReady` 门控，收益低于改动面）、节点全局钩子 fan-out（每次手势一次，量级可接受）、运行态 box-shadow 动画改合成属性（会改变视觉，需单独评估）。

验证：`build:nodes`（含 imageNode / imageGenerationNode）、`build:web` 成功；视图与节点包同步（备份 `mainview.bak-20261122-090503`、`/tmp/nodes*.bak-20261122-090503`）。

## 第四批（2026-11-22 09:10，兼顾日常体验）

1. 视口不再触发保存：删掉 viewport → scheduleCanvasSave 的监听。平移/缩放不再写文件，也不会让「未保存」提示亮起；视口在切画布、关窗的既有 flush 里随整份文件落盘。
2. 选区工具条：选区包围盒改 `computed` 缓存（平移时节点坐标不变，不再每帧遍历选区），并在挂载后 `nextTick` 立刻量一次尺寸，修正首次出现时定位偏一帧的问题。
3. Agent 关系线悬停：`isPointInStroke` 合并到 rAF 每帧一次，画布 rect 缓存并随窗口尺寸失效；任务期间鼠标划过明显更顺。
4. 卡片缩略图从 384 提到 512：2x 屏上更清晰，仍比原来的 1024 少一半解码内存。

验证：web 156 测试通过；`build:nodes`、`build:web` 成功；视图与节点包同步（备份 `mainview.bak-20261122-091011`、`/tmp/nodes*.bak-20261122-091011`）。

## 第五批（2026-11-22 09:11）

1. 运行态呼吸描边改合成动画：`nodeSkeleton.vue` 不再对 `.contentCard` 动画 `box-shadow`（非合成属性，每个运行中节点每帧重绘卡片），改为 `.cardContainer::after` 静态描边 + `opacity` 呼吸；阴影只光栅化一次，之后由合成器插值。`prefers-reduced-motion` 下保持静态描边。
2. 未做：卡片原图 Blob 懒加载。原因：卡片默认已显示 512 缩略图，但十多个按钮/编辑器以 `!previewUrl` 判断可用性，改懒加载必须同时改这些门控并在每个打开动作前 `activate()`，漏一处就是「按钮点了没反应」，收益与风险不匹配；保持 `previewReady` 门控。

验证：`build:nodes`、`build:web` 成功；视图与节点包同步（备份 `mainview.bak-20261122-091103`、`/tmp/nodes*.bak-20261122-091103`）。
