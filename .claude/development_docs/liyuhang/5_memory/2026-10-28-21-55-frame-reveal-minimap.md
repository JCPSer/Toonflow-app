# 记忆：截帧空白修复、自动建节点跟随、小地图点击

## Situation

用户报告三件事：截帧得到的图片是空白的（补充：首帧也空白，当前帧正常）；AI 自动新增的节点总落在屏幕外；小地图只能拖动不能点击跳转。同时追问「截取尾帧生成的节点会不会也在屏幕外」。

## Task

让截帧稳定拿到内容；所有自动新增的节点都保证可见；小地图支持点击定位。

## Action

- **截帧**：根因是取帧用的 `<video>` 从未插入文档，WKWebView 下即使 `seeked` + `readyState=4`，`drawImage` 仍得到全透明画布。改为挂进离屏容器（`position:fixed; left:-10000px`，2×2）并**活到本次截帧结束**；`presentedFrame()` 在设置 `currentTime` **之前**注册 `requestVideoFrameCallback`，按 `metadata.mediaTime` 过滤解析阶段的旧帧，不符继续等下一帧，600ms 兜底；之后两帧 rAF 确保已合成；绘制后用 8×8 缩略采样查 alpha，全透明则 `nudgeFrame()` 把时间戳挪 40ms 重新 seek 逼解码器出帧，三次仍空就报错而不是生成空白节点。
- **节点跟随**：新增 `packages/nodeScaffold/src/nodeViewport.ts` 的 `revealNodeInViewport(flow, nodeId)`——先 `updateNodeInternals([id])` + `nextTick` 拿真实尺寸（只 `nextTick` 拿不到，ResizeObserver 回调还要再等一轮），可见矩形由 `viewport` 与 `dimensions` 反算，内边距按 zoom 换算，只在新节点不完整可见时 `setCenter`（显式传当前 zoom，否则默认会跳到 maxZoom）。接入 AI 建节点、截帧、音轨/片段、图片变体、全景宫格、图片标记、音频派生。
- **批量去抖**：AI 一次会连续建多个节点，`useCanvasTools` 里攒 320ms 后只按最后一个新节点平移一次，避免连续甩镜头和读到动画中途的 viewport。
- **小地图**：MiniMap 只 emit 自身像素坐标，换算规则是内部实现，所以点击处理用 SVG 的 `viewBox` + `getBoundingClientRect()` 反算画布坐标（扣除 `xMidYMid meet` 的留白），再 `setCenter(..., { zoom: 当前值, duration: 180 })`。

## Result

`apps/web`、`nodeScaffold`、`videoNode`、`imageNode`、`audioNode` 五个包 typecheck 全 0（web 仅剩既有的 `singleAgent/types.ts` 找不到 `@/agentRuntime`）；`deploy-local.sh --build` 两轮全量构建部署，运行期节点包分别更新 7 个 / 3 个，产物核对命中。

Copilot 审查（核对 Vue Flow 1.48.2 与 WebKit 行为）查出的问题已全部落实：尺寸测量缺失、批量平移互相打断、rvfc 注册时机无效、重试不产生新帧、内边距单位、rvfc 句柄未取消。

未验证前提：WKWebView 是否会给「在文档中但完全在视口外」的 video 建立可绘制呈现层。这是截帧修复唯一的假设，只能手测。
