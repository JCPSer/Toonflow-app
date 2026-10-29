# 测试结果：画布边缘自动平移

- 记录时间：2026-10-29 09:05
- 关联：`1_requirements_matrix/2026-10-29-08-50-canvas-edge-autopan.md`、`2_requirements_solutions/2026-10-29-08-50-canvas-edge-autopan.md`

## 一、本轮改动

| 位置 | 改动 |
| --- | --- |
| `apps/web/src/pages/workspace/panels/canvas/index.vue` | `<vue-flow>`：`:auto-pan-on-node-drag` / `:auto-pan-on-connect` `false → true`，`:auto-pan-speed="autoPanSpeed"`（画布内 20 / 画布外 0），`:node-drag-threshold="4"`；新增 `pointerInCanvas` ref + `autoPanSpeed` computed；`.canvas` 的内联 `@pointermove` / `@pointerleave` 抽成 `onCanvasPointerMove` / `onCanvasPointerLeave` 以维护该 ref |

无新增组件、无样式改动、无服务端改动。

## 二、静态验证

| 项 | 结果 |
| --- | --- |
| `apps/web typecheck` | 两轮均只报既有 `server/src/modules/agentAccess/singleAgent/types.ts(2,33) Cannot find module '@/agentRuntime'`，无新增 |
| `deploy-local.sh --build` | 两轮均成功（vite build 约 3s，桌面入口已安装，节点包无变化） |

产物核对（`build/web/assets/workspace-DOdzJPPR.js`）：

```
"auto-pan-on-node-drag":!0,"auto-pan-on-connect":!0,"auto-pan-speed":we.value,"node-drag-threshold":4
```

三个新属性都编译进画布 chunk；`auto-pan-speed` 绑定到 computed（`we.value`），`auto-pan-speed` 也出现在 `useWatchProps` 的受监控属性列表里，确认能同步进 store 生效。

## 三、行为依据（读 `@vue-flow/core@1.48.2` 源码）

- 节点拖动：`eventStart` 记录容器矩形与光标位置；首次 `drag` 且 `autoPanOnNodeDrag` 为真时启动 rAF 循环；每帧 `calcAutoPan`（40px 热区线性加速，峰值 = `autoPanSpeed`）→ `panBy` → 被拖节点按 `-delta/zoom` 重算，保持跟手；`eventEnd` 里 `cancelAnimationFrame`。
- 光标停在边缘不动时循环仍在跑（由计时器驱动，不依赖新的 pointermove），即"贴边持续滑动"。
- 连线拖动走 `useHandle` 内同构循环，由 `autoPanOnConnect` 控制；但其"最近手柄 / 是否可连"只在 `pointermove` 里重算，指针停住时判定会滞后（上游限制，动一下鼠标自愈）。
- `calcAutoPan` **不夹取坐标**：光标越过容器边界后速度饱和在最高值。所以用 `autoPanSpeed` 在 20/0 间切换来实现"越界即停"——节点侧循环每帧读速度、连线侧循环每帧读速度，都能即时响应；反过来切开关不行：节点侧只在启动时检查，连线侧关掉后循环提前返回且不再重启。
- 副作用核对：`panBy` 走 `d3Zoom.transform` 且 `sourceEvent` 为 null，Vue Flow 的 `moveStart/moveEnd` 提前 return，不会误清 `edgeDisconnect`；落盘由 500ms 防抖（`scheduleCanvasSave`）兜住，持续平移只是推迟写盘；撤销历史只记 nodes/edges，viewport 不进快照，平移不污染撤销栈。

## 四、待手测清单

1. 单节点拖到画布四边外沿：到热区后画布朝该方向持续平移，节点始终跟着光标；松手停止。
2. 多选拖动：整组节点一起被平移带着走，相对位置不变。
3. 分组节点拖动：分组与其子节点一起跟随平移，组框不脱离子节点。
4. 端口拖连线到边缘：画布平移，连线终点跟随光标，松手可连到原本在视口外的节点。
5. 越界：拖着节点把光标推过画布右边界（Agent 面板/素材库）后画布应停下，回到画布内继续平移。
6. 贴边点击：在右侧 40px 热区内单击节点（手抖几像素），应只打开面板、画布不滑走。
7. 回归：中键平移、抓手模式拖画布、滚轮/捏合缩放、框选、吸附（16px 网格）、组内点线断开、组内右键画布菜单、分组标题栏菜单均与改动前一致。
8. 平移过程中松手后画布位置能正常落盘（重新打开画布位置不变）。

## 五、未覆盖

- 移动端/触屏未测（桌面端为主）。
- 画布节点极多（数百）时平移帧率未做专项压测；`canvasCompositingEnabled` 开/关的大画布表现待实测。
- 平移无边界限制，可将节点拖到远处，需靠撤销或搜索定位找回。
- 撤销节点位置不会还原 viewport（viewport 不进撤销历史），属既有取舍。
