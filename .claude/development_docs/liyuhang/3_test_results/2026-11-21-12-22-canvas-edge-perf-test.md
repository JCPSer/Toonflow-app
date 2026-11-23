# 测试记录：大型画布连线渲染优化

- 时间：2026-11-21 12:22
- 对应方案：`2_requirements_solutions/2026-11-21-12-20-canvas-edge-perf-solution.md`

## 1. 自动化测试

| 项目 | 命令 | 结果 |
| --- | --- | --- |
| 新增几何单测 | `bun test src/pages/workspace/panels/canvas/edgeVisibility.test.ts` | 9 例通过（相交/不相交/横穿/贴边/端点顺序；视口换算/缩放平移/零尺寸/外扩比例） |
| web 全量单测 | `bun test`（apps/web） | 156 例通过，18 个文件 |
| 类型检查 | `bun run typecheck` | 仅既有报错：`apps/server/src/modules/agentAccess/singleAgent/types.ts` 找不到 `@/agentRuntime`（与本次无关） |
| 构建 | `bun run --filter '@toonflow/web' build` | 成功；产物 `workspace-*.js` 含 `canvasEdgeViewBox` |
| 快捷键回归 | `bun test src/lib/canvasShortcuts.test.ts` | 16 例通过（含上一轮 L 键） |

## 2. 手工验收清单（需重启应用后逐项确认）

1. 500+ 边画布：滚轮缩放、空格/中键平移，是否明显跟手；松手 200ms 内连线恢复命中。
2. 静止时全屏扫视：是否有边被错误裁掉、平移时是否闪烁（不该有）。
3. 点击连线弹出断开按钮，删除后画布正常。
4. 隐藏/显示连线（工具条或 L 键）、选中节点高亮、虚线流动仍正常。
5. 拖动节点、分组拖动不回归。
6. 平移后保存、重开画布，节点与连线数量一致（裁剪不落盘）。

## 2.1 评审后回归（2026-11-21 12:28）

| 项 | 结果 |
| --- | --- |
| 评审 P1/P2 修复（pointer-events 目标、interactionWidth 回退、非有限坐标、$attrs、零尺寸保留） | 已改 |
| web 全量单测 | 156 例通过 |
| 类型检查 | 仅既有 server `@/agentRuntime` 报错 |
| 构建与部署 | 成功，视图备份 `mainview.bak-20261121-122840` |

## 3. 已知限制

- 视口框只按两端点包围盒判定，超长贝塞尔曲线若两端都在框外但曲线中段穿过视口，理论上存在极小概率被裁；外扩半屏后实际不可见。
- 手势期间 180ms 内点击连线会落到画布上（命中层被临时关闭），属预期取舍。
