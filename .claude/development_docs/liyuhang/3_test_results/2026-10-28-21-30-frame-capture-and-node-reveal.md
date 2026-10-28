# 测试结果：截帧空白 + 自动新增节点落在视口外

- 记录时间：2026-10-28 21:30
- 关联：`4_bugs_fix/bug_analysis-2026-10-28-21-26-frame-capture-and-node-reveal.md`、`bug_solution-2026-10-28-21-26-frame-capture-and-node-reveal.md`

## 一、复现实验（Chromium）

用项目内两份真实视频（1920×2560，12.249s），在 Chrome 里复刻原 `loadFrame` 逻辑：未挂文档的 `<video>`，等 `seeked` 后逐档 `drawImage` 到 canvas，统计非黑像素与 alpha。

| 目标 | seeked | readyState | 非黑像素占比 | alpha 非零占比 |
| --- | --- | --- | --- | --- |
| duration − 0.05 | true | 4 | 1.000 | 1.000 |
| duration − 0.001 | true | 4 | 1.000 | 1.000 |
| duration − 0.5 | true | 4 | 1.000 | 1.000 |
| duration − 2 | true | 4 | 1.000 | 1.000 |

结论：同一份代码在 Chromium 下拿不到空帧，问题只在 WebKit 侧——未挂入文档的 video 即使 `seeked` + `readyState = 4`，`drawImage` 也可能得到全透明画布。

## 二、静态验证

- `apps/web` vue-tsc：仅既有的 `singleAgent/types.ts(2,33)` 一条，无新增错误。
- `packages/nodes/videoNode` vue-tsc：0 错。

## 三、产物与部署

- `scripts/deploy-local.sh --build` 全量构建并安装；运行期节点包更新 3 个：`videoNode.umd.js`、`videoGenerationNode.umd.js`、`frameAnalysisNode.umd.js`。
- 三个节点包产物均含 `requestVideoFrameCallback` 与「视频帧解码失败」文案。
- web 产物 `workspace-*.js` 含 `setCenter` 调用链（`revealNode`）。

## 四、待手测

1. 视频节点：截首帧 / 当前帧 / 尾帧都应有内容；若解码失败应弹「视频帧解码失败，请重试」，而不是生成空白图片节点。
2. 视频生成节点、帧分析节点同样截一次，确认共享组件的修复生效。
3. 让 AI 在远离当前视口处新增节点：画布平滑移过去；已在视口内的新增不应移动画面。
4. 连续新增多个节点时观察镜头是否被反复甩动。

## 五、未覆盖

- 无法在 WKWebView 内直接跑自动化验证，只能靠手测；`requestVideoFrameCallback` 在暂停元素上的行为也只在代码层做了兜底假设。
- 未验证跨域视频场景（workspace 资源为同源，理论上不会触发 canvas taint）。
