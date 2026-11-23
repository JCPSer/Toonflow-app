# Bug 分析：画布平移卡顿的全量性能排查

- 时间：2026-11-22 00:05
- 现象：179–254 边、190–201 节点的画布，平移平均 26–33ms（约 30–38fps）；界面隐藏连线/节点/地图/背景后仍 33ms；合成优化开关无差别。
- 方法：四个子 agent 并行只读审计（画布热路径、节点组件、保存历史、窗口渲染配置），结合真机浮层数据。

## 关键结论

1. **不是「线多」本身**：隐藏全部画布图层后帧耗时不变，说明瓶颈不在 179 条连线的光栅化。
2. **33.1ms ≈ 30fps 上限**：界面近乎空的情况下仍是这个数，优先怀疑显示刷新率 30Hz（外接屏/低电量模式）或 WebKit 出帧节流，而不是渲染负载。需要用户确认显示器刷新率与低电量模式。
3. 多画布宿主让后台画布保持挂载（`canvasHost.vue`），`visibility:hidden` 不跳过布局；开 2–3 张同规模画布时主线程负担线性叠加。
4. 每次平移手势结束都会触发一次完整画布序列化与写盘（视口变化 = 全量 `toObject` + pretty JSON + PUT）。

## 证据清单（按影响排序）

| # | 位置 | 问题 | 建议 |
| --- | --- | --- | --- |
| 1 | `canvasHost.vue:3-18,182-184` | 多画布保持挂载，隐藏画布仍有完整 DOM/store/watcher，`visibility:hidden` 不省布局 | 后台无任务画布按引用计数卸载或 `content-visibility:hidden` |
| 2 | `canvas/index.vue:1613` + `1513-1536` | 视口变化触发整画布 `toObject()`（JSON stringify+parse）+ pretty `writeJson` + 写盘 | 视口单独持久化或仅在 moveEnd 节流；自动保存用紧凑 JSON |
| 3 | `workspace/index.vue:511-519`，`floatingPanel.vue:346-355` | 画布上方 6 类 chrome 与悬浮 Agent 面板常驻 `backdrop-filter: blur(6px)`，画布每帧变化都要重算背景模糊 | chrome 改不透明底色；悬浮面板默认停靠或去 blur |
| 4 | `selectionToolbar.vue:117-126` | `toolbarStyle` 依赖 viewport，每帧重算并读 `offsetWidth/offsetHeight` 强制同步布局；选中 201 节点时还遍历选区 | 尺寸缓存到 ResizeObserver，位置用 transform 写 DOM，computed 内不读布局 |
| 5 | `agentNodePanel.vue:209-228` + 模板 | 打开面板后每帧执行 `panelStyle()` 读 viewport，且每次 render 生成新对象/回调，拖累对话树 | 定位抽离到轻壳，props 稳定引用 |
| 6 | `canvas/index.vue:1958-1999` | 每个 wheel/gesture 事件读 `getBoundingClientRect`，有样式失效时升级为同步布局 | 缓存画布 rect，rAF 合并 |
| 7 | `canvas/index.vue:555-567` | viewport 每帧变化都 clearTimeout+setTimeout | 只在 false→true 时启动一次 |
| 8 | `agentLinkLayer.vue:80-131` | pointermove 每次读 rect 并对每条关系线 `isPointInStroke`；有任务时 paths 每帧重算 | rAF 合并 + 缓存 rect + 原生 pointer-events |
| 9 | `nodeSkeleton.vue:1082-1107` | 运行态 `box-shadow` 无限动画，非合成属性 | 改伪元素 opacity/scale，超阈值降级 |
| 10 | `audioNode/audioPlayer.vue:64-93` | 每个音频节点整段解码 + 逐样本求波形，与是否可见无关 | 卡片 preload=metadata，波形按需/降采样/缓存 |
| 11 | `workspaceFiles.ts:82-112` | 卡片只用缩略图，却为每个节点下载原文件 Blob | 改用 `useLazyFileUrl`，仅编辑器激活 |
| 12 | `nodeSkeleton.vue:5-35` 等 | 每个节点常驻 persistent `el-dropdown`/popover（400–600 个 popper） | `:persistent="false"` 或改画布级单菜单 |
| 13 | `imageNode/src/index.vue:65-72` | 每节点常驻 5 个编辑器组件 + 12 个 Vue Flow 钩子 | 按 `previewReady && 打开` 延迟挂载 |
| 14 | `workspaceFiles.ts:126-136` | 卡片解码 1024 缩略图，实际显示 240px | 卡片用 256/384 |
| 15 | `videoGenerationNode/src/index.vue:316` | 挂载即发 DELETE 清理请求 | 去掉 immediate，仅 URL 变化时清 |
| 16 | `nodeSkeleton.vue:457-465,519-546` | 每节点 9（图片 21）个全局钩子，每次手势开始 fan-out 4k 回调 | 菜单/面板打开时才注册 |

## 已排除

- 透明窗口、vibrancy、disable-gpu、app-region drag：均无。
- 小地图：用户关掉后无差别。
- 平移时每节点 deep watcher、拖动时撤销快照：均已被运行态字段排除与 grouping 挡住。
- sessionState 每帧写入：不会，视口不进 sessionState。

## 待确认

1. 显示器刷新率是否 60Hz/120Hz；是否开了低电量模式（会锁 30Hz）。
2. 卡顿时是否选中有节点（selectionToolbar 会每帧强制布局）。
3. 是否同时打开了多张画布。

## 处理顺序建议

第一批（低风险、与帧率直接相关）：3、6、7、4、5；第二批：1、2；第三批：节点侧 9–15。
