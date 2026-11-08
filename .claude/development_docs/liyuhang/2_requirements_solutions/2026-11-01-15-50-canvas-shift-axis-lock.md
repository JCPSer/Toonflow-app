# 需求方案：画布拖动按住 Shift 单轴锁定

- 时间：2026-11-01 15:50
- 对应需求：`1_requirements_matrix/2026-11-01-15-50-canvas-shift-axis-lock.md`
- 状态：待评审

## 1. 方案总览

在画布宿主层（`apps/web/src/pages/workspace/panels/canvas/`）新增一个纯逻辑模块 `axisLock.ts`，并在 `index.vue` 的 Vue Flow 拖动事件上接线：

```
pointerdown（画布捕获阶段） → 记录指针起点
nodeDragStart            → 记录每个被拖动节点的起始相对坐标
nodeDrag                  → 若按住 Shift：按指针位移判定主轴，把另一轴写回起始值
nodeDragStop              → 清空本次拖动状态
```

不改 Vue Flow 源码、不新增设置项、不新增 UI。

## 2. 涉及文件

| 文件 | 变更 |
| --- | --- |
| `apps/web/src/pages/workspace/panels/canvas/axisLock.ts` | 新增：轴判定、坐标锁定、拖动状态机（纯逻辑，无 Vue 依赖） |
| `apps/web/src/pages/workspace/panels/canvas/axisLock.test.ts` | 新增：纯逻辑单测 |
| `apps/web/src/pages/workspace/panels/canvas/index.vue` | 接线：pointerdown 记录起点；拖动开始/移动/结束调用轴锁；保证先锁轴再 `dragCopy.update()` |
| `apps/web/src/lib/canvasShortcuts.ts` | `shortcutPressed` 增加 `allowExtraShift`：拖动复制手势忽略额外按住的 Shift，Shift+Alt 仍能拖出副本 |
| `apps/web/src/lib/canvasShortcuts.test.ts` | 新增：严格匹配 / 忽略额外 Shift / 绑定含 Shift / 带按键绑定 |

## 3. 详细设计

### 3.1 状态机

```
type Axis = "x" | "y"

状态（每次按下鼠标重置）：
  origin: 指针的屏幕坐标（clientX/clientY）
  starts: Map<nodeId, {x, y}>   被拖动节点在拖动开始时的相对坐标
```

| 时机 | 动作 |
| --- | --- |
| 画布 `pointerdown`（捕获） | `origin = { clientX, clientY }`；清空 `starts` |
| `nodeDragStart` | 对事件里的每个节点记录 `{ ...node.position }` 作为锚点 |
| `nodeDrag` | 若事件带 `shiftKey`：用指针相对 `origin` 的位移判定主轴，把每个节点的另一轴写回锚点值 |
| `nodeDragStop` | 清空 `origin` 与 `starts` |

### 3.2 轴判定

```
dx = 当前 clientX - origin.clientX
dy = 当前 clientY - origin.clientY
axis = |dx| >= |dy| ? "x" : "y"
```

- 用屏幕坐标而不是画布坐标：视口缩放是等比缩放，两轴比较结果不受 zoom 影响。
- 用「相对拖动起点」而不是「相对上一帧」：中途按下/松开 Shift 时主轴不会因为上一帧已被锁定而误判。
- 相等时取水平轴，与多数工具一致。

### 3.3 坐标写回

```
lockPoint(current, start, axis):
  axis === "x" ? { x: current.x, y: start.y } : { x: start.x, y: current.y }
```

- 写的是节点的 `position`（相对父节点的坐标）。对没有父节点的节点，它就等于绝对坐标；对组内节点（父组没有一起被拖）父坐标不变，锁相对轴等价于锁绝对轴。
- 祖先节点被选中时，Vue Flow 的 `getDragItems` 会把子节点排除在拖动列表外，子节点随父节点整体移动，因此只需要锁父组，不能再去改子节点。
- 只在值确实变化时赋值，避免每帧产生多余的响应式更新。
- 写回发生在 Vue Flow 应用本次位移之后、渲染之前（`computedPosition` 的 watcher 是 `flush: "post"`），同一帧内只会渲染校正后的位置，不会闪烁。

### 3.4 与现有拖动逻辑的接线顺序

`index.vue` 现有（第一个 `onNodeDragStart`，第二个 `flow.onNodeDragStart(closeAgentPortMenu)` 只负责关菜单，不参与本次改动）：

```
flow.onNodeDragStart(({ event, nodes }) => {
  dragCopy = undefined;
  if (!props.active || props.settingsVisible) return;   // 守卫：非激活画布/设置面板不处理
  …按 Alt/Alt+⌘ 启动拖动复制…
});
flow.onNodeDrag(() => dragCopy?.update());
flow.onNodeDragStop(({ nodes }) => { …副本落位 / finishGroupDrag… });
```

改为：

```
flow.onNodeDragStart(({ event, nodes }) => {
  axisLock.start(nodes);          // 记锚点，必须放在 active/settings 守卫之前
  dragCopy = undefined;
  if (!props.active || props.settingsVisible) return;
  …原有拖动复制判断（忽略额外 Shift，见 3.5）…
});
flow.onNodeDrag(({ event, nodes }) => {
  axisLock.apply(event, nodes);   // 先锁轴
  dragCopy?.update();             // 副本读取校正后的原节点坐标
});
flow.onNodeDragStop(({ nodes }) => {
  axisLock.reset();
  …原有逻辑…
});
```

拖动复制的工作方式（`selectionToolbar.startDragCopy`）：原节点每帧被还原到起点，副本读取原节点的 `position` 作为自身位置。因此锁轴必须排在 `dragCopy.update()` 之前，副本才会跟着锁轴移动；松手后 `finishGroupDrag` 用的是校正后的坐标。

### 3.5 事件与平台细节

- `nodeDrag` 的事件可能是 `MouseEvent` 或 `TouchEvent`：只有前者可能有 `shiftKey`；触摸没有 Shift，直接跳过。坐标取值兼容 `touches[0] / changedTouches[0]`。
- 抓手模式（Space/H）下节点不可拖（画布用 CSS 关闭了 transformation pane 的指针事件），拖动事件不会触发，无需额外判断。
- 拖动阈值（8px）之前的 Shift 按下不产生任何位移，不需要处理。
- Shift 在默认拖动配置中未被占用：拖动复制是 Alt / Alt+⌘，框选快捷键默认 None；`Shift+⌘+G` 等是键盘快捷键，与拖动不冲突。
- `shortcutPressed` 原本要求修饰键严格全等，按住 Shift+Alt 时「Alt 拖动复制」会匹配失败。本次给该函数加 `allowExtraShift` 选项，只有拖动复制两处传 true：绑定不含 Shift 时忽略额外的 Shift，绑定本身含 Shift 时仍要求按住 Shift，其他修饰键继续严格匹配。用 `Shift` 起拖 → 下一次指针移动时锁轴；先按 Alt 起拖再按 Shift → 副本与锁轴同时生效。若用户把拖动复制改绑成 Shift，会同时触发复制与轴锁（记录在边界表，不做拦截）。
- 网格吸附开启时，Vue Flow 会先吸附两轴，随后我们把锁定轴写回起点原值——即用户确认的「锁定轴不动、自由轴照常吸附」。

### 3.6 不采用的方案

| 方案 | 不采用原因 |
| --- | --- |
| 给 `@vue-flow/core` 打 patch，在 `useDrag.updateNodes` 内实现轴锁 | 仓库已有 `patches/vueFlowCore.patch`（维护 `dist` 的 js 与 mjs 两份产物），升级 Vue Flow 时容易冲突；轴锁只在宿主画布使用，放宿主层更可控 |
| 捕获阶段改写 `pointermove` 的 clientX/clientY | 依赖改写只读事件属性，且会影响同一手势里的其它监听方（自动平移、指针位置记录），隐式副作用大 |
| 增加设置项/参考线/光标提示 | 用户明确选择内置 Shift、无视觉提示，保持改动面最小 |

## 4. 边界与异常

| 场景 | 期望 |
| --- | --- |
| 拖动中途跨越对角线 | 主轴切换，另一轴弹回起点（用户已确认） |
| 拖动中松开 Shift | 下一次指针移动恢复自由，节点跳到鼠标对应的两轴位置 |
| 按住 Shift 后指针完全静止 | 不会立即重算；继续移动才生效（Vue Flow 位置没变时不派发 `nodeDrag`） |
| 按住 Shift 只沿锁定轴方向推 | 未越过对角线时节点不动；越过对角线主轴切换后正常移动 |
| 拖入/拖出分组 | `finishGroupDrag` 的网格吸附与组贴合优先于轴锁，锁定轴最多偏离 8px |
| 用户把拖动复制/平移改绑成 Shift | 不做拦截：拖动复制与轴锁可能同时触发，平移（抓手模式）会让节点不可拖 |
| 分组拖动 | 组与子节点整体只沿主轴移动，组内相对位置不变 |
| 多选包围框拖动 | 与单节点一致，整体锁轴 |
| 拖动复制 + Shift | 副本锁轴移动，原节点留在原位 |
| 触屏/手写笔 | 没有 Shift，行为不变 |
| 画布未激活/设置面板打开 | 不会产生拖动事件，逻辑不触发 |
| 撤销/重做 | 拖动仍由 dragStart/dragStop 包成一批，只生成一条历史记录 |

## 5. 测试方案

1. 单测 `axisLock.test.ts`：
   - 轴判定：横/竖/相等/正负方向/零位移；
   - 坐标锁定：x 轴锁 y、y 轴锁 x、锚点保持不变；
   - 状态机：未按下指针时不锁定；记录锚点后写回；reset 后不再生效。
2. 类型检查：`apps/web` 的 `vue-tsc`（允许既有 `@/agentRuntime` 报错）。
3. 构建 web 产物并同步到安装目录，核对 md5；不重启应用。
4. 静态链路核对：拖动事件注册顺序、拖动复制读取校正后坐标、拖动历史分组不受影响。
5. 人工验收（重启后）：按需求矩阵第 5 节逐条操作，重点验证多选、分组、拖动复制、网格吸附叠加。

## 6. 风险与对策

| 风险 | 对策 |
| --- | --- |
| 校正被 Vue Flow 下一帧覆盖 | 每帧都按锚点重算，不依赖上一帧结果 |
| 与拖动复制互相踩 | 校正排在 `dragCopy.update()` 之前；副本只读原节点位置 |
| 分组子节点被误改 | 只写拖动事件里的节点（Vue Flow 已排除被选中父组的子节点） |
| 影响非拖动场景 | 只在 `nodeDragStart→nodeDragStop` 之间生效，且必须按住 Shift |
| 升级 Vue Flow 后事件签名变化 | 依赖的 `nodeDrag` 事件是公开 API；单测覆盖纯逻辑，升级后人工回归 |

## 7. 评审意见

子 Agent 初评（2026-11-01 16:05），结论与整改：

| 级别 | 意见 | 处理 |
| --- | --- | --- |
| P1 | `shortcutPressed` 严格全等修饰键，Shift+Alt 时拖动复制不成立 | 已修：新增 `allowExtraShift`，仅拖动复制手势使用；补 4 条单测 |
| P2 | 指针静止时按下/松开 Shift 不会立即重算 | 接受，写入边界表与需求 R4 |
| P2 | 文档漏写第二个 `onNodeDragStart` 与 active/settings 守卫 | 已补进 3.4，并注明 `axisLock.start` 在守卫之前 |
| P2 | R3 措辞与动态主轴矛盾 | 已在需求矩阵改写 |
| P2 | Shift 可被改绑到拖动手势/平移 | 写入边界表，不拦截 |
| P3 | 换组吸附会覆盖锁定轴 | 写入边界表 |
| P3 | patch 产物数量描述 | 已改为 js/mjs 两份 |
| P3 | 「沿锁定轴推不动」未限定未越对角线 | 已在边界表改写 |
| P3 | 子节点排除条件应为「祖先被选中」 | 已在 3.3 改写 |

已核实的关键点：`onNodeDrag` 在 Vue Flow 写好原始位移之后触发、收尾的 `updateNodePositions(dragItems,false,false)` 不写位置，因此写回不会被下一帧覆盖；`computedPosition` watcher 为 `flush:"post"`，同帧只渲染校正后位置；多选包围框同样派发 `nodeDrag*`；抓手模式下节点不可拖；撤销历史按 dragStart/dragStop 分组，轴锁不额外产生记录。

## 8. 版本记录

| 版本 | 时间 | 说明 |
| --- | --- | --- |
| v1 | 2026-11-01 15:50 | 初稿 |
