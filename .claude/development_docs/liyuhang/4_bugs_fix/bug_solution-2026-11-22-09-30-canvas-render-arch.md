# 画布渲染架构级优化（方案）

- 时间：2026-11-22 09:30
- 分析：`bug_analysis-2026-11-22-09-25-canvas-render-arch.md`
- 目标规模：500 节点 / 500 边 60fps 平移缩放；201 节点现状必须明显改善。
- 约束：不改画布 JSON 格式、不改 `data`/`nodes` 应用数据、不降级日常操作体验、所有降级可逆。

## 一、总体架构：三层分离

| 层 | 内容 | 更新时机 | 每帧成本 |
| --- | --- | --- | --- |
| L1 连线层 | 单张 Canvas 位图（canvas 坐标系 Path2D） | 数据/样式变化、区域越界、缩放结束、10Hz 虚线动画 | 平移=CSS transform，缩放=CSS scale，**0 重绘** |
| L2 节点层 | Vue Flow 节点 DOM（保留，负责测量/交互/状态） | 不变 | 不变 |
| L3 节点内容层 | 视口外节点把 `.contentCard` 内容降级为不渲染 | 手势结束后判定 | 视口外 ≈ 0 |

核心思想：**平移/缩放只动 transform，不重绘任何内容**；重绘只发生在「手势结束」和「区域越界」两个时机。

## 二、L1：Canvas 连线层

### 2.1 为什么不用 Vue Flow 的边组件

- 库为**每条边渲染一个 `<svg class="vue-flow__edges">` 根元素**，179 条边 = 179 个 SVG 根；裁剪只能让 `<g>` 返回 null，根元素不消失。
- 每条边还有一根 40 画布单位的透明命中 path，DOM 再翻一倍。

### 2.2 结构

```
.vue-flow
├── .vue-flow__viewport            (z-index 4，节点在这里)
├── <div class="edgeCanvasWrap">   (z-index 1，位于默认插槽，绘制在节点之下)
│     └── <canvas class="edgeCanvas">
├── <background>                   (默认插槽)
└── 现有菜单/工具条/浮层
```

- 默认插槽渲染在 `.vue-flow` 根层（非变换层），因此画布自己用 CSS `transform` 跟随视口。
- 不放进变换层的原因：变换层里 canvas 尺寸必须覆盖整个内容范围（几千×几千画布单位），显存不可控。

### 2.3 位图与跟随（关键）

位图按「栅格快照」记录：`raster = { viewport: {x,y,zoom}, rect: {x,y,w,h} }`，`rect` 是快照时覆盖的屏幕矩形（视口外扩 35%）。

当前视口 `V` 下，位图需要施加的变换（变换原点 `0 0`，元素定位 `left:0;top:0`）：

```
k = V.zoom / raster.zoom
tx = (rect.x - raster.x) * k + V.x
ty = (rect.y - raster.y) * k + V.y
transform: translate(tx, ty) scale(k)
```

推导：位图像素 `p` → 快照时屏幕 `rect.x + p` → 画布坐标 `c = (rect.x + p - raster.x)/raster.zoom` → 当前屏幕 `c*V.zoom + V.x = p*k + tx`。

- 平移：`k = 1`，只剩 translate → 纯合成。
- 缩放：`k ≠ 1`，把位图整体缩放 → 纯合成，视觉上与 SVG 同样会「先糊后清」。
- 该函数是纯函数，单独单测（含 zoom 往返、平移连续性）。

### 2.4 重绘时机

| 触发 | 说明 |
| --- | --- |
| 数据/样式变化 | 边增删、节点位置变化（拖动、整理、撤销、粘贴）、禁用态、选中态、连线颜色设置、连线动画开关、`L` 显隐 |
| 区域越界 | 当前视口超出快照 `rect` 的 25% 内边距 |
| 缩放偏离 | `k` 与 1 相差超过 15%，或 `viewportMoving` 由真变假 |
| 虚线动画 | 存在 animated 边且未拖动、未平移时，10Hz 重绘（与现有 `steps(20)` 同频） |

期间任何触发都合并到一次 `requestAnimationFrame`。

### 2.5 绘制规则（与现状逐项对齐）

| 项 | 现状 | Canvas 实现 |
| --- | --- | --- |
| 路径 | `getSimpleBezierPath`（simplebezier） | 直接复用库导出函数生成 `d` → `Path2D` |
| 端点 | 库 `getHandlePosition(node, handleBounds.source[0], …)` | 同一套公式本地复刻（10 行，附单测） |
| 线宽 | `stroke-width: 1`（画布单位） | `ctx.scale(zoom*dpr)` 后 `lineWidth = 1` |
| 默认颜色 | `--vf-connection-path` / `#b1b1b7` | 同值 |
| 端点活跃 | `.edgeActive` → `var(--canvasEdgeColor)` | 读根元素 CSS 变量解析后的实际色值 |
| 端点禁用 | `stroke-opacity: .35` | `globalAlpha = .35` |
| 虚线动画 | `stroke-dasharray: 5`，offset 10→0，2s `steps(20)` | 同样参数按 10Hz 步进 |
| 命中带宽 | `interactionWidth: 40`（画布单位） | `isPointInStroke` + `lineWidth = 40` |
| 点击连边 | 显示「断开」气泡（在 `clientX/clientY`） | 命中后调用同一个 `showEdgeDisconnect` |
| 悬停 | 无额外高亮，仅 `cursor: pointer` | 命中时切换 `cursor`（rAF 合并） |
| 显隐开关 | `edgesHidden` 隐藏整层 | 不绘制 |

### 2.6 视觉清晰度

- 位图 backing store 像素 = `rect.w × zoom × devicePixelRatio`，`ctx.scale(zoom*dpr)` 后按画布单位绘制 → 静态时与 SVG 同清晰度。
- 仅在缩放过程中临时模糊，手势结束当帧重绘恢复。

## 三、L3：视口外节点内容降级

### 3.1 作用点

不改节点包，不动 `previewReady`。在 `.vue-flow__node` 上打类 `canvasNodeFar`，由 web 侧 `:deep()` 命中节点内部的 `.contentCard`：

```
.vue-flow__node.canvasNodeFar .contentCard {
  content-visibility: hidden;
  contain-intrinsic-size: var(--canvasNodeW) var(--canvasNodeH);
}
```

- `.contentCard` 是 `el-card`（正文容器），**端口 `handle`、标题栏、角标都是它的兄弟节点**，因此端口坐标测量不受影响。
- 节点整体尺寸 = 标题栏 + 卡片（intrinsic size 固定为降级前测得的尺寸）→ Vue Flow 的 `offsetWidth/offsetHeight` 与 `getHandleBounds` 结果不变。

### 3.2 判定

- 视口框（画布坐标）外扩 `0.25` 屏 → 在框内保留，框外降级。
- 只在「手势结束 + 120ms 空闲」「画布尺寸变化」「节点集合变化」时重算，不在平移中逐帧算。
- 一次判定两趟：先读全部节点尺寸，再写类名与 CSS 变量，避免读写交替触发同步布局。
- 遍历的是 `.vue-flow__nodes` 的 `children`（每个带 `data-id`），不做 querySelector。

### 3.3 保护例外（永不降级）

| 例外 | 判定 |
| --- | --- |
| 选中 / 拖动中 / 缩放中 | `node.selected`、`node.dragging`、`node.resizing` |
| 焦点在节点内 | 节点元素 `contains(document.activeElement)` |
| 媒体正在播放 | 节点内 `video/audio` 且 `!paused` |
| 对话框/面板正指向它 | `agentNodePanel` 当前节点、`previewTarget` |
| 分组节点 | `type === "canvasGroup"` |

### 3.4 失效与恢复

- 恢复 = 移除类名与 CSS 变量，下一帧恢复渲染。
- 节点在降级期间尺寸变化（生成完成）：下次判定读到的仍是 intrinsic size，不影响连线几何；恢复后按真实内容重新测量。

## 四、诊断与验收（本批一起做）

1. 浮层「主线程」改为持续采样：每帧记录一次 0ms 定时器延迟，取 500ms 内中位数（现实现每 500ms 只采一次，容易落到空闲期）。
2. 新增「基准：纯合成平移」：rAF 直接改 `transformationpane.style.transform` 3 秒（不经过 Vue），报告帧间隔。用于区分「主线程」与「出帧/合成」上限。
3. 新增读数：`.vue-flow__edges` 根元素数量（改造后应为 179 个空壳或更少）、画布内 DOM 元素总数。

## 五、分批交付

| 批次 | 内容 | 用户可见变化 |
| --- | --- | --- |
| 1 | 分层基准 + 节点内容降级（L3） | 无视觉变化；视口外节点不渲染内容 |
| 2 | Canvas 连线层（L1） | 连线外观/交互对齐；连线不再进 DOM |
| 3 | 联通、回归、归档 | 无 |

每批独立构建、独立回滚，构建后同步到 `views/mainview` 与节点包目录，由用户自行重启。

## 六、风险与对策

| 风险 | 对策 |
| --- | --- |
| `content-visibility` 不支持 | 特性检测（`CSS.supports`），不支持时整层逻辑不启用，只损失收益 |
| 降级读尺寸造成布局抖动 | 两趟读写 + 仅对「本次变化的节点」处理 |
| Canvas 与节点图层不同步（位移抖动） | 变换由同一个 `viewport` 快照在同一帧内计算；单测覆盖连续位移 |
| 边点击与画布框选/拖拽冲突 | 画布 `pointer-events: none`，命中测试走画布根事件；命中时 `stopPropagation` 阻止 `paneClick` 清掉气泡 |
| 拖节点时每帧重绘 | 合并到 rAF；拖动中按 30Hz 上限重绘 |
| 多画布并存 | 后台画布不绘制、不加监听；切回时重绘 |

## 七、评审意见

（待填写）

- 评审结论：
- 修改项：

## 八、评审结论与实施修正（2026-11-22 09:35）

子 agent 首轮评审提出 18 条，逐条处置：

| 评审 | 处置 |
| --- | --- |
| P0 分析把 `display:none` 当成仍在渲染 | 已改：分析文档承认 `display:none` 会跳过子树布局与绘制，因此"四层全隐藏仍 33ms"不能推断为连线光栅化。为此在本批加了「合成基准」按钮：先测「纯 rAF 改 transform（不经过 Vue）」的帧间隔，再决定后续方向。 |
| P0 Canvas 无法插到 pane 与节点之间 | 确认：canvas 在 `.vue-flow` 根层、`z-index: 1`（低于 viewport 的 4），视觉上仍在节点之下、背景之上；命中改在 `.canvas` **捕获阶段**做几何测试，图层始终 `pointer-events: none`。 |
| P0 位图在 maxZoom×dpr 下会爆内存 | 公式复核：矩形是**画布坐标**且按 zoom 反算，像素宽高 ≈ 视口 ×1.7 ×dpr，与 zoom 无关。仍加两道保险：单边像素上限 4096、dpr 上限 2，超限用 `scale` 降采样（`k > 1` 由浏览器拉伸），并补了降采样路径的单测。 |
| P0 忽略 `sourceHandle/targetHandle`、用 `position` 而非 `computedPosition` | 实现已是按 id 取 handle（`pickHandle`）+ `computedPosition`，与库内 `getEdgeHandle`/`getHandlePosition` 同构；文档里那句 `handleBounds.source[0]` 已作废。补了 4 例单测。 |
| P0 命中优先级：节点/浮层在上，边在下 | 已加：命中前先看 `event.target.closest(".vue-flow__node, .vue-flow__panel, .el-popper, [role=dialog], [role=menu], [role=listbox]")`，命中则不做边的几何测试；边命中后 `stopPropagation + stopImmediatePropagation`，阻止 `paneClick` 清掉气泡。 |
| P1 「179 → 0」与「保留空壳」矛盾 | 统一为：**保留边数据与库内计算，`<svg>` 壳仍为 179 个，但 path 由 358 降为 0**（边组件插槽改渲染空组件）。验收看 path 数与 DOM 总数，不看 svg 壳数。要彻底归零必须把边从 store 迁出并接管 `toObject`/历史/剪贴板，超出本次范围。 |
| P1 跟随公式前提未写明 | 已写明并实现：rect 为画布坐标、canvas CSS 尺寸显式设置、`raster.scale` 是实际像素比；补了 `scale < zoom` 的降采样用例。 |
| P1 缩放策略自相矛盾 | 明确：手势中只做 transform；`|k−1| > 20%` 且**已停止手势**才重绘；越界时手势内最多 160ms 一次。文档里"15% 就重绘"作废。 |
| P1 节点位移不触发重绘 / 拖动+动画每帧全量重绘 | 节点位移经既有的逐元素深监测 → `scheduleCanvasChange` → `touchEdges()` 覆盖（撤销/粘贴/整理同路径）；拖动期 `moving=true` 暂停虚线动画并按 rAF 合并重绘。 |
| P1 L3 尺寸钉法的 border-box 口径 | 已改：不再用 `contain-intrinsic-size`，改为读 `.contentCard` 的 `offsetWidth/offsetHeight`（border-box）并显式 `width/height + box-sizing: border-box` 钉住，降级前后盒子逐像素一致。选择器改用 `data-canvas-tier`（Vue 重渲染会整体改写 class，直接挂类会被冲掉）。 |
| P1 交互缺项 | 已补：`handMode`/`viewportMoving`/`dragActive` 下不做悬停命中；`edgesHidden` 复刻"有活跃边则整层可见"的例外；颜色改由 `watch(uiSettings.theme/primaryColor, generalSettings.*)` 失效重绘；配色模式为「不区分」时活跃边仍用默认灰（`colored` 标志）。 |
| P2 验收方法 | 已加：主线程延迟改为**每帧** 0ms 定时器采样取中位数；新增「合成基准」。仍缺 trace 级的 scripting/paint 分解，等真机数据决定是否补。 |

## 九、第二轮代码审查处置（2026-11-22 09:44）

| 审查 | 处置 |
| --- | --- |
| P0 节点尺寸/端口变化不触发连线重绘（`dimensions`/`handleBounds` 是运行态字段，被逐元素深监测排除） | 订阅 `flow.onNodesChange`，`type === "dimensions"` 时 `touchEdges()`。 |
| P1 画布浮层上的点击被几何命中劫持 | 判决改成正向判定：只有 `target` 在 `.vue-flow__pane` 内、且不在 `.vue-flow__node` / 框选矩形内才做连线命中。工具条、横幅、队列、空画布引导、诊断浮层都在 `.vue-flow` 根层，天然出局。 |
| P1 关闭连线后只要有选中节点就画出全部连线 | 改为逐条过滤：隐藏时只画端点活跃的边；命中测试同样过滤，不可见的边不能被点中。 |
| P1 禁用/解除禁用后连线透明度不刷新 | `data.disabled` / `label` 的监视器里补 `touchEdges()`。 |
| P1 只平移后关窗不落盘视口 | 加 `viewportDirty`：视口变化只置脏不写盘，`saveCanvasState` 在 flush 前按需调度一次写入。平移期间仍然零写入、零脏提示。 |
| P2 虚线定时器在手势开始/早退路径不停 | `moving` 变真时立即 `syncAnimation()`；`!box`、`!active`、`!visible` 三条早退路径都补 `syncAnimation()`。 |
| P2 双击连线会弹「新建节点」 | `openNodeMenu` 先做一次连线命中，命中则不弹菜单。 |
| P2 诊断浮层 A/B 类被重渲染冲掉、基准中途卸载不还原 transform | A/B 改为直接写目标元素 inline `display`；基准记录 pane 与原始 transform，卸载时还原。 |
| P2 恢复节点时 O(候选×节点) 遍历 | 每轮先建一次 `id → element` 映射；恢复判定改用 `flow.findNode` 的实时坐标（撤销/整理/分组拖动把节点挪进视口时不会误判）。 |
| P2 revision 通道绕过手势限频 | 接受：拖节点必须每帧更新受影响边的几何；实测后再决定是否分静态层/动态层。 |

## 十、真机主线程定位与第三批改动（2026-11-22 10:33）

### 真机读数（用户提供，206 节点 / 206 边）

`平均 33.8ms、最长 81ms、慢帧 8/240、节点 206、边 206、路径 0、边根 206、DOM 12952、
合成开、will-change transform、层N block / E none、主线程 29.0ms`

结论：**主线程 29ms/帧**，所以瓶颈是主线程工作，不是出帧。

### 用真实画布做的定位实验

把 `5-别墅cos.json` 的 206 个节点真实坐标/尺寸/视口导出，在 WebKit（26.4）+ 你的窗口尺寸
2478×1464 @2x 下驱动真实平移，逐项关闭再测「每帧主线程延迟中位数」：

| 配置 | 帧平均 | 主线程中位数 |
| --- | --- | --- |
| 现场基线（含 will-change） | 16.97ms | **9ms** |
| 去掉 will-change | 16.77ms | **5ms** |
| 视口外节点 `visibility: hidden` | 16.70ms | **2ms** |
| 视口外节点 `display: none` | 16.90ms | 3ms |
| 节点层整体 `display:none` | 16.65ms | 2ms |
| 关小地图 / 关背景图案 / 关连线层 / 关 HUD | 16.6–16.9ms | 8–10ms |

三条可执行结论：

1. **`will-change: transform` 是负优化**：同一手势每帧主线程 9ms → 5ms。超大图层（内容跨度
   16576×5280 画布单位）被提升成合成层后分块重建比合成收益更贵。所以「画布合成优化」开关下线。
2. **每帧主线程成本正比于「被绘制的节点数」**：视口外节点不绘制后 9ms → 2ms，与整个节点层不绘制持平。
   顺带解释了此前「四层全隐藏仍 33ms」：当时的 A/B 类挂在画布根 class 上，被 Vue 重渲染冲掉了，
   实际什么都没隐藏。
3. 小地图、背景图案、连线 Canvas、诊断浮层都不是主因（关掉仍在 8–10ms）。

### 第三批改动

1. 节点降级机制从「`.contentCard` 加 content-visibility + 钉尺寸」改为「**整节点 `visibility:hidden`**」：
   - 盒子仍在布局里，Vue Flow 的 offset 测量与端口 handleBounds 不受影响（display:none 会归零）；
   - 不再读 `offsetWidth/offsetHeight`，整个判定零同步布局；
   - `!important` 压过 Vue Flow 内联的 `visibility: visible`，`data-canvas-tier` 不会被重渲染冲掉。
2. 平移过程中也做完整分级判定（节流 50ms）：降级不再需要读布局，判定只剩 200 次包围盒相交，
   避免"连续平移时被画过又离开的节点一直留在绘制里，越拖越慢"。
3. 下线 `will-change: transform`（CSS 规则删除、设置项移除），存储字段保留兼容旧配置。

### 预期与验收

真机应从「主线程 29ms / 平均 33.8ms」降到个位数主线程、帧平均接近 16.7ms。
若仍有 20ms+，说明还有一处与节点数量相关的主线程工作，下一步按「节点层内逐项剥离」定位。

## 十一、Agent 关系线动画是持续 GPU 占用的主因（2026-11-22 11:39）

用户反馈「agent 通信连线的动画会导致卡顿」，复现验证后成立。

### 实验

在 WebKit（26.4，2478×1464@2x）铺 6 条横跨视口的虚线，测量 WebKit GPU 进程 CPU：

| 动画方式 | GPU 进程 CPU |
| --- | --- |
| 不动画（静态虚线） | 0% |
| `linear` 每帧插值（原实现） | **≈200%**（20 秒内把进程平均拉到 101%） |
| `steps(11)`，10Hz 跳变 | **≈40%** |

结论：`stroke-dashoffset` 是**非合成属性**，每帧插值都要重绘整段 path 的包围盒；关系线横跨几千像素时，
一次重绘就是全窗口级别的面积。这也解释了此前「把节点层/连线层都隐藏仍然卡」——动画的绘制与这些层无关。

### 改动

1. `.agentLinkLine` 的动画从 `linear` 改成 `steps(11)`（10Hz，重绘频率降到 1/6，视觉仍是流动虚线）。
2. 平移、缩放、拖动节点、画布切到后台时 `animation-play-state: paused`（手势期间零重绘）。
3. 关系线超过 16 条时不再流动（任务风暴时不跟着一起画）。
4. 跟随「节点连线动画」设置，关掉后关系线也保持静态虚线（给用户一个彻底关掉的开关）。
