# 画布渲染架构级优化（分析）

- 时间：2026-11-22 09:25
- 关联：`bug_analysis-2026-11-22-00-05-canvas-pan-perf-audit.md`、`bug_solution-2026-11-22-08-58-canvas-pan-perf-batch1.md`
- 前置结论：前五批把每帧的布局读取、常驻模糊、视口写盘、节点侧重资源都清掉了，平移仍在 26–33ms/帧（约 30fps）。

## 一、现象与已排除项

| 观测 | 数据 | 含义 |
| --- | --- | --- |
| 平移平均帧间隔 | 26.3ms（201 节点 / 179 边） | 约 38fps，达不到 60fps |
| 四层全部 `display:none` 后 | 33.1ms，无改善 | **不是连线本身的光栅化**，也不是节点内容的逐帧绘制 |
| 开/关「画布合成优化」（`will-change: transform`） | 无差别 | 单靠提升合成层救不回来 |
| 开关小地图 | 无差别 | 小地图不是主因 |
| 关/开连线显隐 | 几乎无差别 | 同上 |

关键教训：现有三处「隐藏」在结构上都没有真正减少**结构成本**（DOM 数量、样式重算与序列化输入），
但 `display:none` 本身会跳过子树布局与绘制——所以「四层全隐藏仍 33ms」**不能**用「连线光栅化」解释，
它更指向视口变换、每帧派生计算或 WKWebView 出帧上限。这一点必须先用分层基准测出来再动手，
否则可能改完渲染栈也没解决 30fps。

1. `culledEdge` 在视口外返回 `null`，但 Vue Flow 为**每条边单独渲染一个 `<svg class="vue-flow__edges">` 壳**，壳不随裁剪消失（`@vue-flow/core` 边层渲染函数：每条边一个 svg root，内含 `<g class="vue-flow__edge">`）。179 条边 = 179 个 SVG 根节点，一直在 DOM 里（`display:none` 时不绘制，但仍参与样式解析与 DOM 树维护）。
2. `perfHideEdges/Nodes` 只是 CSS `display:none`，Vue 组件与响应式依赖照常存在。
3. `previewReady`（`packages/nodeScaffold/src/useNodePreviewReady.ts`）是**一次性锁存**：节点首次进入视口后永远全量渲染，注释里写明「之后保留尺寸、播放器及插件 UI 状态；不卸载节点运行时」。也就是说，用户在 201 个节点的画布上平移一遍之后，201 个节点的完整 DOM 会永久常驻。

## 二、Vue Flow 每帧做了什么（已核实）

- 平移时唯一被写的响应式状态是 `viewport`（d3-zoom 事件 → `viewport.value = {x,y,zoom}`）。
- `Transform` 组件的 computed 重算，只 patch `.vue-flow__transformationpane` 的 `transform`（`translate(Xpx,Ypx) scale(Z)`，**2D transform，非 translate3d**）。
- 节点组件、边组件自身**不依赖 viewport**（本项目 `only-render-visible-elements=false`），不会因平移重渲染。
- 因此核心库每帧的 JS 成本很小；每帧的真实成本来自两处：
  - **图层内容的重绘/重栅格**：201 个节点子树 + 179 个边 SVG 根一起在被变换的图层里。
  - **项目侧读 viewport 的派生组件**：`Background` 图案偏移、`MiniMap.viewBB`、`agentLinkLayer.paths`、`selectionToolbar.toolbarStyle`、`selectionHandle.anchor`、`agentNodePanel.panelStyle` 每个视口变化都重算一次。

## 三、根因判断

1. **渲染规模问题，不是单点 API 问题**。201 个节点 × 每个几十个 DOM 元素，加上 179 个 SVG 根，全部在同一个被 transform 的图层里；WebKit 每次合成/重栅格都要处理这些内容。
2. **缺少「可逆降级」机制**。`previewReady` 一旦为真就不再回退，导致 DOM 规模随浏览单调增长到全量。
3. **连线以「每条边一个 SVG 根」的方式存在于 DOM**，即使裁剪掉 path，壳仍在；命中路径（40px 宽）× 179 条又让 DOM 再翻一倍。

## 四、用户已确认的方向（2026-11-22 09:20 选择题）

| 决策 | 选择 |
| --- | --- |
| 视口外节点降级 | **允许可逆降级，带保护例外**（选中中 / 编辑中 / 播放中 / 有未提交编辑的节点永不降级） |
| 目标规模 | **500 节点内可 60fps 平移** |
| 连线渲染 | **一起改成 Canvas 自绘** |

## 五、目标

1. 500 节点 / 500 条边的画布，平移与缩放稳定 60fps（帧间隔 ≤ 16.7ms，慢帧率 < 5%）。
2. 日常操作体验只升不降：点击、断开连线、悬停高亮、选中、缩放、连线动画的视觉与手感保持一致。
3. 不改变画布文件格式，不改 `data` / `nodes` 应用数据。
4. 任何降级必须可逆，且不丢用户状态（编辑器中间态、播放位置、滚动位置）。

## 六、风险

| 风险 | 说明 | 缓解 |
| --- | --- | --- |
| `content-visibility` 在旧 WebKit 不支持 | 老系统上等于不降级 | 特性检测 + 渐进降级，功能不受影响只损失收益 |
| 节点隐身时尺寸塌陷污染连线坐标 | 节点高度由内容撑开 | 降级时写入 `contain-intrinsic-size` = 已测尺寸，尺寸不变、不触发 ResizeObserver |
| Canvas 连线视觉回归 | 颜色、虚线动画、命中带宽、点击断线、悬停高亮 | 复用 Vue Flow 的 `getSimpleBezierPath` + `Path2D` 保证几何一致；命中用 `isPointInStroke` 保持 40 画布单位 |
| Canvas 每帧重绘反而增加主线程负担 | 若瓶颈在主线程 | 画布放在被变换图层内、按「视口区域」重绘（不是逐帧），平移只做合成 |
| 多画布并存 | 后台画布也有一张画布元素 | 后台画布不绘制、不监听 |
| 移动端 / 触摸板手势 | 手势期间频繁 zoom | 缩放期间沿用旧位图，手势结束重绘 |

## 七、验收方式

1. 诊断浮层新增「基准：纯合成平移」：直接以 rAF 改 `transformationpane.transform`，不经过 Vue，量 3 秒帧间隔。用于证明当前 30fps 是主线程还是出帧上限。
2. 浮层主线程延迟改为**持续采样**（现有实现每 500ms 只采一次 0ms 定时器，容易采到空闲期）。
3. 改造后同样画布复测：帧间隔、慢帧率、主线程延迟、DOM 元素数、`.vue-flow__edges` 根数量（应从 179 → 0）。

## 八、评审意见

（待填写）

- 评审结论：
- 修改项：
