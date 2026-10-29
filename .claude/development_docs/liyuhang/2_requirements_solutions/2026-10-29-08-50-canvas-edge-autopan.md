# 需求方案：画布边缘自动平移

- 记录时间：2026-10-29 08:50
- 关联需求矩阵：`1_requirements_matrix/2026-10-29-08-50-canvas-edge-autopan.md`

## 一、结论

用 `@vue-flow/core@1.48.2` 自带能力，只改画布模板上的三个属性：打开节点拖动与连线的自动平移，并把峰值速度从默认 15 调到 20。不写自研 rAF 循环。

原因：内置实现在拖动期间自行接管「平移 + 修正被拖元素位置」，多选、组内子节点跟随、吸附、变更事件全部沿用现有链路；自研要自己按 `delta / zoom` 补算被拖元素坐标，等于复制框架内部逻辑，偏移 bug 和回归面都更大。

## 二、内置行为（读 `@vue-flow/core/dist/vue-flow-core.mjs`）

```
节点拖动 (useDrag)
  pointerdown  → 记录 containerBounds = vueFlowRef.getBoundingClientRect()
  pointermove  → 更新 mousePosition
                 首次移动且 autoPanOnNodeDrag 为真时启动 requestAnimationFrame 循环
  每帧 autoPan():
      [dx, dy] = calcAutoPan(mousePosition, bounds, speed)   // 距边缘 40px 内线性加速
      if panBy({dx, dy}) 成功:
          被拖节点整体按 (-dx/zoom, -dy/zoom) 重算位置 → 始终跟着光标
      继续下一帧
  pointerup    → 取消循环
```

要点：

- `calcAutoPan` 的热区固定 40px，越靠边速度越大，最大 `autoPanSpeed` 像素/帧；可调的只有峰值速度。
- 循环由计时器驱动，光标停在边缘不动也会持续平移，符合"拖到边缘＝持续滑动"的直觉。
- 平移量按屏幕像素给出，与缩放无关，0.2～8 倍缩下手感一致。
- 连线拖动走另一条 `useHandle` 里的同构循环，由 `autoPanOnConnect` 控制。
- `autoPanSpeed` 不在 `storeOptionsToSkip` 列表里，作为 prop 传入会同步进 store，可生效。

## 三、改动点

全部在 `apps/web/src/pages/workspace/panels/canvas/index.vue`：

1. `<vue-flow>` 属性：

```
- auto-pan-on-node-drag = false
- auto-pan-on-connect   = false
+ auto-pan-on-node-drag = true
+ auto-pan-on-connect   = true
+ auto-pan-speed        = autoPanSpeed        // 画布内 20 / 画布外 0
+ node-drag-threshold  = 4                    // 默认 1
```

2. 新增两个响应式量：`pointerInCanvas = ref(true)`、`autoPanSpeed = computed(() => pointerInCanvas ? 20 : 0)`。

3. 把 `.canvas` 上的内联 `@pointermove` / `@pointerleave` 抽成 `onCanvasPointerMove` / `onCanvasPointerLeave`，在其中维护 `pointerInCanvas`（`pointermove` 里置 true、`pointerleave` 里置 false），其余行为与原来等价（更新 `pointerPosition`，无按键时刷新选区）。抽出成具名函数而非再挂一个 `@pointermove`：同一元素重复写同名事件会被 i18n 插件的 Vue 解析器判成 `Duplicate attribute` 导致构建失败。

不新增组件、不改样式、不加视觉提示（需求 R4）。

### 为什么用"速度归零"而不是关开关

- 节点拖动侧：`autoPan` 只在**启动时**检查 `autoPanOnNodeDrag`（启动后一直跑），关开关停不下来，而 `autoPanSpeed` 是**每帧读取**。
- 连线侧：每次进入 `onPointerMove` 只在 `autoPanStarted` 为假时才会重新启动循环；中途关闭 `autoPanOnConnect` 会让循环提前返回且**不再重启**，回到画布内也不会恢复。
- 因此统一用传感器式做法：只让 `autoPanSpeed` 在 20 / 0 之间切换，两边的循环都保留，进出画布都能即时响应。

## 四、为什么不会串味

- **中键平移 / 抓手模式**：走 `panOnDrag` 与 `.handMode` 样式，与自动平移是两条独立路径；自动平移只在"按住元素拖动"期间启动。
- **组内穿透探测**：探测发生在 `.canvas` 的 `pointerdown` 捕获阶段，且只临时切换组体 `pointer-events` 做 `elementFromPoint` 采样，与拖动中的 rAF 平移无交集。
- **框选**：`SelectionMode.Partial` 与 `selectionKeyCode` 不受影响，框选本身不会触发自动平移（内置不支持，见非目标）。
- **吸附**：平移后节点位置仍经 `snapToGrid` 处理，吸附行为不变。
- **画布存档**：平移会推进 `viewport`，触发既有的 `scheduleCanvasSave` 防抖保存；拖动过程中持续平移只会推迟落盘，松手后一次写入，与中键平移一致。
- **跟随节点的 Agent 面板**：面板位置由 `viewport + node.computedPosition` 计算，两处都随平移刷新，面板继续贴住节点。
- **上传拖放**：`@dragover/@drop` 在 `.canvas` 上，文件拖入不经过节点拖动链路，不受影响。
- **指针位置**：`pointerPosition` 仍由 `onCanvasPointerMove` 写入，`addNodeAtPointer` / `dropFiles` / 搜索定位的取值与改动前完全一致，只是顺带置 `pointerInCanvas = true`。
- **贴边点击**：起步阈值 4px 后，`eventEnd` 里"位移 ≤ 阈值视为点击"的判定随之放宽到 4px，贴边单击 Agent 节点仍能正常打开面板，不会变成"拖了一下"。

## 五、验证计划

1. `apps/web` typecheck 无新增错误。
2. `./scripts/deploy-local.sh --build` 成功，产物核对 `auto-pan-*` 与 `node-drag-threshold` 已编译进 workspace 产物。
3. 手测：单节点拖到四边外沿持续平移且节点跟手；多选拖动同效；组节点连同子节点拖动同效；端口拖线到边缘画布平移；指针滑进右侧面板即停、回画布恢复；中键平移、抓手模式、滚轮缩放、框选、吸附、右键菜单均与改动前一致。

## 六、风险与未覆盖

- 内置热区固定 40px，无法调宽；若后续觉得触发过晚，唯一手段是自研（见方案一）。
- 光标停在边缘时持续平移没有绝对边界，可能把节点拖到很远；可用 Ctrl/⌘+Z 撤销，暂无"限制平移范围"需求。
- 自动平移对极低性能机器（每帧重排）理论上有额外开销，实测再议。
- 上游限制：连线拖拽时"最近手柄 / 是否可连"只在 `pointermove` 里重算，指针停在边缘不动时目标判定会滞后，再动一下鼠标即自愈；接受，不为此给 Vue Flow 打补丁。
- 起点阈值 4px 是**全局**节点拖动参数（所有节点、分组标题栏拖拽都生效），正常拖动无感，长按微抖会被判成点击（与"单击节点开面板"一致）。

## 七、评审意见

| 评审人 | 结论 | 意见 |
| --- | --- | --- |
| 代码评审子代理 | 通过，无阻断项 | 指出 `calcAutoPan` 不夹取坐标导致"拖出画布仍按最高速滑"，要求产品拍板；建议加 4px 起步阈值；确认 `panBy` 不触发 `moveStart`，不会误清 `edgeDisconnect`；确认 500ms 防抖落盘不会被平移打爆。 |
| 用户裁定 | 通过 | 越界即停；起步阈值 4px。 |
