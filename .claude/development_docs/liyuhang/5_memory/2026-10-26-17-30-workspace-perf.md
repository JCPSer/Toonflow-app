# 记忆：文本节点输入区自动隐藏 + 画布渲染成本治理

## Situation

文本节点生成中点画布空白，输入区不收起；十几个节点的画布配合 Agent 面板时整体偏卡，ComfyUI 占满 GPU/内存时会整片无响应。

## Task

统一文本节点输入区显隐；用实测数据定位画布主要成本，做无视觉回归的优化。

## Action

- `packages/nodes/textNode/src/index.vue`：去掉 `:bottomPinned="generating"`，`bottomVisible` 改为只看 `node.selected`，与 video/image 节点一致；预览内 `content-visibility: auto; contain-intrinsic-size: auto 120px` 只布局可视区段落。
- `apps/web/src/pages/workspace/components/floatingPanel.vue`：`.docked` 加 `backdrop-filter: none`（底色本来不透明，模糊纯浪费）。

## Result

- 点空白 → 节点取消选中 → `promptCard` 消失（真实 pointer 事件序列验证）。
- 26 节点实测：基线 16.7 ms/帧；强制 21 条连线动画时最大帧 266.7 ms；去掉全部毛玻璃后降到 133.8 ms；单视频播放 16.7 ms；拖动节点 16.9 ms。
- 停靠素材库面板 `backdrop-filter` 变为 `none`，Agent 未停靠面板保留 blur。
- `vue-tsc`、nodes build、web build 通过；app 已重打包。

## 精度要点

- 长帧主因是 SVG `stroke-dashoffset` 动画叠加浮层模糊，不是节点数量；单视频播放与拖拽本身都很便宜。
- `videoPlayer` 的 `ready` 依赖 `loadeddata`，把 `preload` 降到 `metadata` 会让播放按钮永久不可点，必须先改 ready 与封面生成。
- `acquireUrl` 把整段视频读成 Blob 并常驻缓存（26 节点堆 ≈ 313 MB），改同源 Range URL 需要新增媒体端点与移动端回退，属独立改造。
