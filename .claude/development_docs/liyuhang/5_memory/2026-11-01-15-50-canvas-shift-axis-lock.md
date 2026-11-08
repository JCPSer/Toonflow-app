# 记忆：画布拖动按住 Shift 单轴锁定

- 时间：2026-11-01 15:50
- 类型：功能新增

## STAR

**Situation（背景）**
画布节点拖动完全交给 `@vue-flow/core@1.48.2` 的 `useDrag`，按下超过 8px 后两轴同时跟随鼠标。整理画布、把节点排成一行/一列时只能靠肉眼或 16px 网格吸附逐步挪，容易错位。主流画布工具都支持拖动时按住 Shift 单轴锁定；本画布的 Shift 在默认拖动配置中没有被占用（拖动复制是 Alt / Alt+⌘）。

**Task（任务）**
给画布所有「节点整体移动」加 Shift 单轴锁定：动态主轴、锚点为拖动起点、中途按下/松开 Shift 生效、覆盖单节点/多选/多选包围框/分组、与网格吸附和拖动复制叠加、无视觉提示、固定 Shift 不进设置。

**Action（行动）**
- 新增 `apps/web/src/pages/workspace/panels/canvas/axisLock.ts`：纯逻辑 `dragAxis`（按指针相对起点的位移判定主轴，相等取水平）、`lockPoint`（另一轴写回起点）、`createAxisLock`（press/start/apply/reset 状态机）。
- `index.vue` 接线：画布 `pointerdown.capture` 记录指针起点（仅主键）；`onNodeDragStart` 在 active/settings 守卫之前记录每个被拖动节点的起始相对坐标；`onNodeDrag` 先 `axisLock.apply` 再 `dragCopy.update()`；`onNodeDragStop` 重置。
- 修 `shortcutPressed` 严格修饰键匹配导致 Shift+Alt 不触发拖动复制的问题：新增 `allowExtraShift`，仅拖动复制两处使用（绑定含 Shift 时仍要求按住 Shift，其它修饰键继续严格）。
- 新增 `axisLock.test.ts`（12 条）与 `canvasShortcuts.test.ts`（4 条）。

**Result（结果）**
19 个单测通过（34 expects），web 类型检查仅既有 `@/agentRuntime` 报错；web 已构建并 rsync 到安装目录（`index.html` `9373f463…`、入口 `index-BeCCdLCU.js` `6b9605f8…`、画布分块 `workspace-Dwsh0jtN.js` `921f5843…`），未重启应用。

实现复审无 P1；按建议补了「拖动中第二个指针不覆盖锚点」守卫、画布切换/失活时的 `reset()`、触摸取点与「不在锚点里的节点保持原样」测试。

初评与实现复审均确认：`nodeDrag` 在 Vue Flow 写好本次原始位移之后触发、收尾的 `updateNodePositions(dragItems,false,false)` 不写位置，所以宿主层每帧写回不会被覆盖；`computedPosition` 的 watcher 是 `flush:"post"`，同一帧只渲染校正后坐标；多选包围框同样派发 `nodeDrag*`；抓手模式/缩放手柄/连线/框选不会误触发。

已知限制：指针完全静止时按下/松开 Shift 要等下一次移动才生效；拖入/拖出分组的网格吸附优先于轴锁（最多偏 8px）；用户把拖动复制或平移改绑成 Shift 会有手势叠加。

## 关键经验

1. Vue Flow 没有内置轴锁，但 `nodeDrag` 事件在节点位置写入之后、收尾事件不写位置——宿主层每帧按锚点写回是安全且不需要补丁的做法。
2. `shortcutPressed` 是修饰键严格全等：任何「组合手势 + 新修饰键」都要显式放行，否则会静默匹配失败（Shift+Alt 拖动复制曾因此完全不触发）。
3. `getDragItems` 排除的是「祖先被选中」的子节点，不是「父组正在被拖」；因此锁父组坐标即可，子节点自动跟随，不能逐个改。
4. 拖动复制的副本每帧读取原节点 `position`，任何位置校正必须排在 `dragCopy.update()` 之前。
5. 拖动开始前（`nodeDragStart`）记录锚点，不能等第一次 `nodeDrag`；阈值内的位移不能算进锚点。
