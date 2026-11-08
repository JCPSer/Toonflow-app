# 测试结果：AI 新建节点固定在发起 Agent 旁边

- 时间：2026-11-02 15:12（15:34 完成构建与同步）
- 对应需求/方案：`1_requirements_matrix/2026-11-02-15-12-ai-add-node-beside-agent.md`、`2_requirements_solutions/2026-11-02-15-12-ai-add-node-beside-agent.md`

## 1. 改动文件

| 文件 | 改动 |
| --- | --- |
| `packages/toolScaffold/src/runtime.ts` | 新增 `CanvasCallOrigin`；`CanvasContext.call` 增加可选 origin |
| `packages/tools/canvas/src/runtime.ts` | 再导出 `CanvasCallOrigin`；`addNode` 描述说明 position 会被忽略 |
| `packages/tools/canvas/build.ts` | 工具 prompt 同步，删除「位置合理留出空间」的旧要求 |
| `apps/web/src/components/agent/conversation.vue` | 画布调用携带 `nodeBinding` |
| `apps/web/src/pages/workspace/panels/canvas/useCanvasTools.ts` | origin 透传；addNode 右侧单列摆放 + 挂载后校正 |
| `apps/web/src/pages/workspace/panels/canvas/spawnBesideNode.ts` | 新增纯函数 `findSpawnPosition` / `findFreeY` |
| `apps/web/src/pages/workspace/panels/canvas/spawnBesideNode.test.ts` | 新增 9 个用例 |

## 2. 自动化测试

| 项目 | 命令 | 结果 |
| --- | --- | --- |
| 摆放算法单测 | `bun test apps/web/src/pages/workspace/panels/canvas/spawnBesideNode.test.ts` | 9 pass / 0 fail |
| Web 类型检查 | `bun run --filter '@toonflow/web' typecheck` | 仅既有 `@/agentRuntime` 报错 |
| toolScaffold 类型检查 | `cd packages/toolScaffold && bun run typecheck` | 0 |
| tool-canvas 类型检查 | `cd packages/tools/canvas && bun run typecheck` | 0 |
| Server 类型检查 | `bun run --filter '@toonflow/server' typecheck` | 0 |
| Web 构建 | `bun run --filter '@toonflow/web' build` | 0 |
| canvas 工具构建 | `cd packages/tools/canvas && bun run build` | 0 |

用例覆盖：空画布右侧落位、同列已有节点向下顺延、多节点取最低底边、x 区间不相交不影响、上方节点不触发下推、吸附后碰撞、边缘相接不算重叠、`findFreeY` 保持 x、向下吸附向上取整。

## 3. 部署与校验（应用未重启）

| 产物 | 源 md5 | 应用内 md5 |
| --- | --- | --- |
| `app/views/mainview/index.html` | `7e6ce14ec74946105faf232bd9a2bf19` | `7e6ce14ec74946105faf232bd9a2bf19` |
| `app/tools/canvas.tool.js` | `c9ddc3332306da0063fb918ac73f143e` | `c9ddc3332306da0063fb918ac73f143e` |

- 入口 `index-CVJlh9pM.js` 引用新分块 `workspace-Si1bsB1H.js`，该分块含「节点附近没有可用的摆放位置」。
- `canvas.tool.js` 含新文案「固定放在发起节点右侧一列」与新的 prompt。
- 旧 `canvas.tool.js` 备份在作业临时目录 `canvas.tool.js.before`。
- **未重启应用**，需用户重启后生效。

## 4. 静态核对

| 项 | 结果 |
| --- | --- |
| 只有 origin 合法（canvasId 相同、节点存在）时才改变位置 | 通过 |
| 无绑定 / 节点不存在 / 跨画布 → 使用模型坐标 | 通过 |
| 重定向画布代理继续透传 origin | 通过 |
| 切换画布后的 getCanvas 不带 origin | 通过 |
| 手动新建、复制粘贴、拖入、moveNodes、arrangeCanvas 不受影响 | 通过（未改动这些路径） |
| 新节点保持顶层，坐标使用绝对坐标系 | 通过 |
| 挂载后校正失败不阻断 addNode | 通过（try/catch） |
| 摆放计算异常回退模型坐标 | 通过（try/catch） |

## 5. 残余风险与未覆盖项

1. Agent 先 `renameCanvas` 再 `addNode` 时，`nodeBinding.canvasId` 仍是旧文件名，会回退模型坐标（不报错）。
2. 复制画布文件会产生重复 nodeId；canvasId 校验可避免把节点放到副本上。
3. Agent 节点在分组内时，新节点保持顶层，可能被组框按矩形避让推到组下方。
4. 新节点尺寸挂载前只能估算，校正仅在顶层节点上生效。
5. 运行时实际摆放（连续建多个节点）需重启后在应用内验证，本次为单测 + 静态核对。

## 6. 代码审查

子 Agent 审查结论：无 P0/P1 阻塞（P1 为构建产物未更新，已在部署阶段重建 canvas 工具包）。已处理：

| 意见 | 处理 |
| --- | --- |
| 新文案未进入 `build/tools/canvas.tool.js` | 单独重建并同步，应用内 md5 一致 |
| 摆放/校正抛错会让已落盘的节点被报为失败 | 摆放失败回退模型坐标；校正失败吞掉异常 |
| 首值取整注释不准确 | 改为「从 startY 开始找空位」 |
| 需求文档与实现不一致（10000 次后返回 vs 抛错） | 文档改为计算失败回退 |
