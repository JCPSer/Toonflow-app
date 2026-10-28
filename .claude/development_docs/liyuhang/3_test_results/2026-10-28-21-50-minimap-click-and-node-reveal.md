# 测试结果：小地图点击跳转 + 自动建节点视口跟随

- 记录时间：2026-10-28 21:50
- 关联：`4_bugs_fix/bug_analysis-2026-10-28-21-26-frame-capture-and-node-reveal.md`、`bug_solution-2026-10-28-21-26-frame-capture-and-node-reveal.md`（含「六、评审后修正」）

## 一、本轮改动

1. 小地图支持点击跳转（此前只能拖视口框）。
2. 抽公共助手 `revealNodeInViewport()`，把「自动新增节点落在视口外」的跟随覆盖到：AI 建节点（`useCanvasTools`）、截帧（`videoPlayer`）、音轨/片段（`videoActions`）、图片变体、全景宫格、图片标记、音频派生。
3. 按审查意见修正截帧：rvfc 在 seek 前注册并按 `mediaTime` 过滤、空帧重试改为重新 seek（`nudgeFrame`）、两帧 rAF 确保已合成、rvfc 句柄及时取消。

## 二、静态验证

| 包 | 结果 |
| --- | --- |
| `apps/web` | 仅既有 `singleAgent/types.ts(2,33)` 一条，无新增 |
| `packages/nodeScaffold` | 0 错 |
| `packages/nodes/videoNode` | 0 错 |
| `packages/nodes/imageNode` | 0 错 |
| `packages/nodes/audioNode` | 0 错 |

## 三、产物与部署

- `deploy-local.sh --build` 全量构建安装；运行期节点包两轮分别更新 7 个 / 3 个。
- `videoNode.umd.js`、`imageNode.umd.js`、`audioNode.umd.js` 均含 `updateNodeInternals` / 跟随调用。
- web 产物 `workspace-bFQ3OT8e.js` 含小地图点击处理。

## 四、待手测

1. 小地图：点击空白处应把该处移到屏幕中心；拖动视口框仍应正常；缩放不变。
2. 截帧后新节点应出现在可视区内（源节点贴右边缘时尤其明显）。
3. AI 连续建多个节点时，镜头只应在安静 320ms 后移动一次，且落在最后一个新节点上。
4. 截首帧 / 尾帧仍应有内容；若失败应弹「视频帧解码失败，请重试」。

## 五、未覆盖

- 离屏容器（`position:fixed; left:-10000px`）是否在 WKWebView 中建立可绘制呈现层，仍只能靠手测；这是本轮修复唯一的假设前提。
- 小地图点击坐标换算按 `preserveAspectRatio: xMidYMid meet` 推导，若后续改了 minimap 尺寸/比例需要复核。
- 带 alpha 通道且整帧透明的视频会被 `isBlankFrame` 误判为解码失败（当前场景不存在）。
