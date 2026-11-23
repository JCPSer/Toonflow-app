# 测试记录：画布渲染架构级优化（批次 1 + 批次 2）

- 时间：2026-11-22 09:35
- 范围：诊断浮层增强、视口外节点内容降级、Canvas 连线层

## 单测

| 文件 | 用例 | 结果 |
| --- | --- | --- |
| `nodeTiers.test.ts` | 7（相交判定、迟滞带、恢复、未测量不降级） | 通过 |
| `edgePaths.test.ts` | 12（handle 锚点四向、computedPosition、pickHandle、跟随变换三种比例、路径生成与裁剪、画布坐标换算） | 通过 |
| `edgeVisibility.test.ts` | 9（原有） | 通过 |

合计 28 例通过。`bun test apps/web/src/pages/workspace/panels/canvas` 在整目录下会出现
`Cannot find module '@/components/agent/agentRun'`，是该目录历史遗留的 `@/` 别名解析问题
（与本次改动无关），单独文件运行全部通过。

## 类型检查

`bun run --filter '@toonflow/web' typecheck`：仅剩既有错误
`apps/server/src/modules/agentAccess/singleAgent/types.ts` 找不到 `@/agentRuntime`（非本次改动）。

## 构建

`bun run --filter '@toonflow/web' build` 成功；已同步到
`/Applications/toonflow-exec.app/Contents/Resources/app/views/mainview`
（备份 `mainview.bak-20261122-093327`）。

## 待真机验收

1. 开发者选项打开「画布性能诊断浮层」。
2. 点「合成基准」：记录 `合成 N 帧 · 平均 X ms`。这是绕开 Vue、只改 transform 的纯合成帧间隔。
3. 平移画布，记录浮层 `主线程 X ms`（已改为每帧采样的中位数）。
4. 记录 `边根` / `path` / `DOM` 三项：改造后 path 应为 0、边根仍是边数、DOM 总数明显下降。

判读：
- 合成基准 ≈16.7ms 且真实平移仍 ~30ms → 瓶颈在主线程派生计算，继续收敛 viewport 派生更新。
- 合成基准也 ~30ms → 上限在图层合成/出帧，需要进一步分级（减少图层数量或换渲染方式）。
