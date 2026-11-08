# 测试结果：拖动多连边节点卡顿

- 时间：2026-11-01 18:35
- 对应方案：`4_bugs_fix/bug_solution-2026-11-01-18-01-canvas-drag-edge-animation-lag.md`
- 结论：类型检查、既有单测、构建部署与静态链路核对通过；**未重启应用**，需用户重启后人工验收

## 1. 单元测试

本次定稿是 CSS 冻结动画 + 一个 computed，没有可独立单测的纯逻辑（初版的纯函数抽离在评审后移除）。回归跑既有画布用例：

```
bun test apps/web/src/pages/workspace/panels/canvas/axisLock.test.ts apps/web/src/lib/canvasShortcuts.test.ts
→ 24 pass / 0 fail / 46 expect() calls
```

## 2. 类型检查

| 包 | 命令 | 结果 |
| --- | --- | --- |
| `apps/web` | `bun run --filter '@toonflow/web' typecheck` | 仅既有报错 `apps/server/src/modules/agentAccess/singleAgent/types.ts(2,33) TS2307 Cannot find module '@/agentRuntime'` |

## 3. 构建与部署核对

| 产物 | md5（构建 = 安装目录） | 说明 |
| --- | --- | --- |
| `index.html` | `73ddd7215bd98453a804965928df8356` | 引用 `assets/workspace-C542gZNR.js` |
| `assets/workspace-C542gZNR.js` | `e0f51d47ed1b5733ea0cae7f936c7a78` | 画布路由入口 |
| `assets/workspace-C_q2TV18.js` | `15bdf33a7b6547a5d4d800b6b014b6da` | 画布主体（含 `dragActive`） |
| `assets/workspace-BC-dFJ3W.css` | `eabbe28db3730d9c18d884fc94b61201` | 含 `.dragPaused` 冻结规则 |

产物内核对：

- JS：`some(e=>e.dragging)`（拖动态派生）与 `dragPaused` 绑定各命中 1 处；
- CSS：`.canvas.dragPaused[data-v-3455a7e8] .vue-flow__edge.animated path{animation:none}`。

部署方式：`rsync -a build/web/ <安装目录>/`（不带 `--delete`）。安装目录：`/Applications/toonflow-exec.app/Contents/Resources/app/views/mainview/`。**未重启应用。**

## 4. 静态链路核对

| 断言 | 证据 |
| --- | --- |
| 拖动中不再流动 | 根节点类 `dragPaused: dragActive` + CSS `animation: none` 覆盖 `.vue-flow__edge.animated path`，特异性高于 Vue Flow 默认规则 |
| 虚线样式保留 | 只停 `animation`，`stroke-dasharray: 5` 仍来自 `.animated`，拖动中不会变实线 |
| 拖动态覆盖分组/多选/拖动复制 | `dragActive` 取任意节点 `dragging`；组内子节点虽为 false，组节点本身为 true；拖动复制的副本由 `selectionToolbar` 置 `dragging=true` |
| 不会每帧 O(N) | `dragActive` 只读 `node.dragging`，不读 `position`；使用 `flow.nodes`（全量顶点）而非会依赖 viewport 的 `getNodes` |
| 边不因拖动态重渲染 | 边的类名逻辑未改动，不读取 `dragActive`；只有根节点类名在起止各变一次 |
| 中断不会永久停流动 | `clearStuckDragging()` 在 `[canvasId, props.active]` watch 与 `resetCanvasKeys()`（window blur、设置面板开关、快捷键变更）里复位 |
| 高亮不受影响 | `edgeNodeActive` / `edgeActive` 条件未改 |
| 关闭动画时行为不变 | 没有 `animated` 类就没有流动，`dragPaused` 无副作用 |

## 5. 代码审查

实现复审（子 Agent，2026-11-01 18:26）：**通过**，无 P0/P1。

- 已用 Vue Flow 源码核对：`dragging` 在首帧位移时同步写入、松手写回 false；`flow.nodes` 为全量顶点；分组/多选/拖动复制均能覆盖；`clearStuckDragging` 不会误清正常拖动（触发点本就伴随拖动中断）；`dragActive` 拖动中不每帧失效；setup 期 `immediate` 调用安全（flow 已创建、nodes 为空）。
- 采纳的 P2：保留 `animated` 改为 CSS 冻结（虚线不消失）、补齐文档改动清单与风险口径。
- 未采纳的 P2：给 `dragActive` 与 `clearStuckDragging` 补集成测试（`.vue` 成本高）、拆分提交（由用户决定何时提交）。

## 6. 已知限制

- 拖动起步要越过 8px 拖动阈值才会写入 `dragging`，此前极短窗口内连边仍会流动一瞬。
- 拖动复制刚开始有一小段异步窗口（副本尚未创建），期间画布没有位移，不影响手感。
- 拖动期间全画布统一暂停流动：此时其它「已选中但没被拖」的节点连边也暂停（无拖动时照常流动）——已与用户确认。
- 拖动复制若在清理前被中断，副本可能残留 `dragging=true`，由失焦/切画布兜底复位。

## 7. 未覆盖项（需重启后人工确认）

1. 打开「连线流动动画」，拖动 7 连节点：不再持续发涩，松手后连边恢复流动。
2. 拖动时连边仍是虚线（只是不流动），松手后恢复流动。
3. 分组拖动、多选拖动、Shift/Alt 拖动复制：同样顺畅。
4. 不拖动时选中一个节点：其连边仍流动。
5. 拖动中 Cmd+Tab 失焦再回来：连边流动恢复（不永久停住）。
6. 关闭「连线流动动画」时：行为与之前一致。
