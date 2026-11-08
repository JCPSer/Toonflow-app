# 测试结果：画布拖动按住 Shift 单轴锁定

- 时间：2026-11-01 16:10
- 对应方案：`2_requirements_solutions/2026-11-01-15-50-canvas-shift-axis-lock.md`
- 结论：自动化测试与静态链路核对通过；已构建并同步 web 产物，**未重启应用**，需用户重启后做人工验收

## 1. 单元测试

命令：`bun test apps/web/src/pages/workspace/panels/canvas/axisLock.test.ts apps/web/src/lib/canvasShortcuts.test.ts`

```
19 pass / 0 fail / 34 expect() calls
```

覆盖：

- `dragAxis`：横向/纵向主轴、相等取水平、负方向按绝对值、零位移。
- `lockPoint`：水平锁定纵坐标、垂直锁定横坐标。
- `createAxisLock`：未按下不生效、按住 Shift 写回起点、松开 Shift 自由拖动、越过对角线切换主轴、多节点各自保留起点、右键与拖动中第二个左键不覆盖锚点、不在锚点里的节点保持原样、触摸事件按 `touches[0]` 取点、reset 后失效。
- `shortcutPressed`：默认严格全等（多按 Shift 不命中 Alt）、`allowExtraShift` 只放行额外 Shift、绑定含 Shift 时仍要求按住、带按键绑定照旧校验。

## 2. 类型检查

| 包 | 命令 | 结果 |
| --- | --- | --- |
| `apps/web` | `bun run --filter '@toonflow/web' typecheck` | 仅既有报错 `apps/server/src/modules/agentAccess/singleAgent/types.ts(2,33) TS2307 Cannot find module '@/agentRuntime'` |

## 3. 构建与部署核对

| 产物 | md5（构建 = 安装目录） | 说明 |
| --- | --- | --- |
| `index.html` | `9373f463b89b6d6cf30719ac3f41b2d8` | 引用 `assets/index-BeCCdLCU.js` |
| `assets/index-BeCCdLCU.js` | `6b9605f873e5b4610bb6b0b90949dcac` | 入口 |
| `assets/workspace-Dwsh0jtN.js` | `921f5843a7f346451e16fd3096b4f672` | 画布与轴锁逻辑所在分块 |

部署方式：`rsync -a build/web/ <安装目录>/`（不带 `--delete`，保留旧哈希分块，避免正在运行的应用按需加载旧文件时 404）。安装目录：`/Applications/toonflow-exec.app/Contents/Resources/app/views/mainview/`。**未重启应用。**

## 4. 静态链路核对

| 断言 | 证据 |
| --- | --- |
| `nodeDragStart` 早于第一段位移，锚点记录的是拖动前坐标 | `vue-flow-core.mjs` 的 `eventDrag`：先 `startDrag`（触发 `nodeDragStart`）再 `updateNodes` |
| `nodeDrag` 触发时节点已是本次原始位移后的坐标，写回安全 | `updateNodes` 内先 `updateNodePositions` 再 `onDrag`；收尾的 `updateNodePositions(dragItems,false,false)` 不写位置 |
| 写回同一帧只渲染校正后坐标，不闪 | `computedPosition` 的 watcher 为 `flush: "post"`，同步写回后只在渲染前计算一次 |
| 多选包围框同样派发 `nodeDragStart/nodeDrag/nodeDragStop` | `NodesSelection` 组件的 `useDrag` 同时触发 `selectionDrag*` 与 `nodeDrag*` |
| 拖动复制读取的是校正后的原节点坐标 | `selectionToolbar.vue` 的 `update()` 先读 `node.position` 存入 `positions`，再还原原节点；本次接线把 `axisLock.apply` 放在 `dragCopy.update()` 之前 |
| 拖动复制手势不再被额外 Shift 打断 | `shortcutPressed` 的 `allowExtraShift` 仅供 `copyOnDrag`/`duplicateOnDrag` 两处使用，其它调用方不传，行为与改动前一致（有单测） |
| 组内子节点不会被重复校正 | `getDragItems` 在祖先被选中时排除子节点，拖动列表只含父组；写回父组相对坐标即可 |
| 抓手模式/缩放手柄/框选/连线不误伤 | 抓手模式 CSS 关闭节点指针事件；缩放手柄 `.nodrag`；框选走 `selectionDrag*`；连线 handle `.nodrag` |
| 撤销历史不受影响 | `useCanvasHistory` 按 `nodeDragStart`/`nodeDragStop` 分组，轴锁写回不产生额外记录 |

## 5. 代码审查

实现完成后由 code-reviewer 子 Agent 复审（结果见下节）。

## 5.1 实现复审整改

code-reviewer 复审结论：**无 P1**。核心链路（锚点时序、写回不被覆盖、渲染时序、拖动复制读取顺序、`shortcutPressed` 回归、`GraphNode.position` 直接赋值、撤销历史）均经源码核实成立。P2/P3 处理如下：

| 级别 | 问题 | 处理 |
| --- | --- | --- |
| P2 | 拖动进行中第二个左键 pointerdown（多指针/掌触）会清空锚点，本次拖动剩余时间轴锁静默失效 | 已修：`press` 在锚点非空时直接 return；补「拖动中第二个左键不覆盖锚点」单测 |
| P2 | R7（Shift+Alt 副本锁轴）只测了纯逻辑，没有覆盖「先锁轴再 `dragCopy.update()`」的接线顺序 | 代码处已用注释标明顺序不可交换；补「不在锚点里的节点保持原样」单测。顺序本身无自动化测试，列为已知缺口 |
| P3 | `shortcutPressed` 对非布尔 `shiftKey` 的语义变化 | 真实 DOM 事件均为布尔，默认行为与改动前一致；不调整 |
| P3 | `reset()` 只挂在 `nodeDragStop`，拖动被切画布/失活打断时残留 | 已补 `watch([canvasId, props.active])` 与 `onScopeDispose` 的 `axisLock.reset()` |
| P3 | 触摸事件取点分支无测试 | 已补 `touches[0]` 用例 |

## 6. 已知限制

- 拖动中指针完全静止时按下/松开 Shift 不会立即重算；继续移动指针即生效（Vue Flow 位置未变化时不派发 `nodeDrag`）。
- 拖入/拖出分组时，`finishGroupDrag` 的网格吸附优先于轴锁，松手瞬间锁定轴最多偏离 8px。
- 若用户把「节点复制 / 创建副本 / 画布平移」改绑成 Shift：拖动复制会与轴锁同时触发；平移会进入抓手模式导致节点不可拖。本次不做校验拦截。
- 触屏没有 Shift，行为不变；分组缩放手柄、框选矩形绘制不锁轴。

## 7. 未覆盖项（需重启后人工确认）

按需求矩阵第 5 节验收标准逐条操作：

1. 单节点按住 Shift 横向/纵向拖动，另一轴坐标不变。
2. 拖动中越过对角线，主轴切换、另一轴弹回起点。
3. 多选 3 个节点拖动、拖多选包围框、拖分组，整体锁轴且相对位置不变。
4. Shift+Alt 拖动复制：副本创建且锁轴，原节点留在原位（本次重点回归项）。
5. 网格吸附开启时，锁定轴保持起点原值、自由轴吸附。
6. 撤销/重做把一次锁轴拖动还原为一步。
