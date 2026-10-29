# 记忆：画布边缘自动平移

## Situation

画布面板的 `<vue-flow>` 上 `auto-pan-on-node-drag` / `auto-pan-on-connect` 从初始提交起就是 `false`。节点一多、画布铺满视口后，把节点或连线往视口外拖时画布不会跟着走，必须先松手、平移、再拖第二段。窄面板（Agent 面板或素材库展开）时更明显。

## Task

拖动节点（含多选、分组与组内子节点）或从端口拖连线靠近画布边缘时，画布自动平移，元素始终跟手。

## Action

只改 `apps/web/src/pages/workspace/panels/canvas/index.vue`，不写自研 rAF：

- `:auto-pan-on-node-drag="true"`（原 false）
- `:auto-pan-on-connect="true"`（原 false）
- `:auto-pan-speed="autoPanSpeed"`：新增 `pointerInCanvas = ref(true)` + `autoPanSpeed = computed(() => pointerInCanvas ? 20 : 0)`，`.canvas` 的内联 `@pointermove` / `@pointerleave` 抽成 `onCanvasPointerMove` / `onCanvasPointerLeave` 维护它。默认峰值 15 略拖沓，取 20；热区固定 40px 不可调。
- `:node-drag-threshold="4"`：默认 1px，贴边点击节点手抖 1px 就会开拖并触发平移；4px 后微抖被当点击（顺带让"单击节点开 Agent 面板"更稳）。

**为什么用速度归零而不是关开关**：`calcAutoPan` 不夹取坐标，光标越过容器边界后速度饱和最高值（20px/帧 ≈ 1200px/s），节点被侧栏挡住还在滑。节点侧 `autoPan` 只在启动时检查 `autoPanOnNodeDrag`（中途关不掉），连线侧关掉后循环提前 return 且**不再重启**；而 `autoPanSpeed` 两边都是每帧读取，所以统一用"速度在 20/0 间切换"的传感器式做法，进出画布都即时响应。

内置链路（`@vue-flow/core@1.48.2` `useDrag`）：`eventStart` 记录 `vueFlowRef` 矩形；首次 `drag` 启动 rAF；每帧 `calcAutoPan`（40px 热区线性加速，峰值=autoPanSpeed）→ `panBy` → 被拖节点按 `-delta/zoom` 重算位置，所以节点跟手、多选与组嵌套天然覆盖；`eventEnd` 取消 rAF。循环由计时器驱动，光标停在边缘不动也持续滑动。连线侧是同构循环，由 `autoPanOnConnect` 控制。

关键校验点：`autoPanSpeed` 不在 Vue Flow 的 `storeOptionsToSkip`（id/vueFlowRef/viewportRef/initialized/modelValue/nodes/edges/maxZoom/minZoom/translateExtent/hooks/defaultEdgeOptions）里，prop 会经 `useWatchProps` 同步进 store，因此能生效。`nodeDragThreshold` 为默认 0，`eventStart` 里立即 `startDrag`，不存在"先平移、节点后跟上"的空窗。

## Result

`apps/web typecheck` 无新增（仅既有 `singleAgent/types.ts` 报错）；`deploy-local.sh --build` 成功；产物 `build/web/assets/workspace-DOdzJPPR.js` 含 `"auto-pan-on-node-drag":!0,"auto-pan-on-connect":!0,"auto-pan-speed":we.value,"node-drag-threshold":4`。

评审子代理确认：`panBy` 走 `d3Zoom.transform` 且 `sourceEvent` 为 null，`moveStart/moveEnd` 提前 return，不会误清 `edgeDisconnect`；落盘是 500ms 防抖，持续平移只推迟写盘；抓手模式下 `.vue-flow__transformationpane * { pointer-events:none }` 使节点收不到 pointerdown，不会出现"抓手时拖节点也平移"。上游限制：连线拖拽的悬停目标不随自动平移刷新，指针停住时判定滞后，动一下鼠标自愈。

不做的：框选拖拽的自动平移（内置不提供）、平移边界（`translateExtent`）、边缘视觉提示（用户明确不要，与 Figma 一致）。

若后续觉得 40px 热区触发太晚，唯一手段是自研 rAF —— 但必须自己按 `delta/zoom` 修正被拖元素位置，等于复制框架内部逻辑，成本较高。
