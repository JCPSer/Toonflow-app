# 方案：AI 新建节点固定在发起 Agent 旁边

- 时间：2026-11-02 15:12
- 对应需求：`1_requirements_matrix/2026-11-02-15-12-ai-add-node-beside-agent.md`
- 用户决策：锚点=发起调用的 Agent 节点；忽略模型坐标；右侧单列向下顺延；只改 `addNode`

## 1. 总体设计

```
conversation.vue (持有 props.nodeBinding)
        │  canvasContext.call(event, signal, { canvasId, nodeId })
        ▼
useCanvasTools.call(request, signal, origin)
        │  execute(request, signal, canvasId, origin)
        ▼
addNode 分支
   origin 有效且节点在本画布？
        ├─ 是：findSpawnPosition(锚点矩形, 已有节点矩形) → 网格吸附 → addNodes
        └─ 否：nodePosition(args.position)（原行为）
```

调用方身份由前端提供，因为只有前端持有实时几何信息（`computedPosition`、`dimensions`）和 `nodeBinding`。服务端只负责转发工具参数，不改 `canvasCall` 事件结构。

## 2. 详细设计

### 2.1 类型扩展

`packages/toolScaffold/src/runtime.ts`：

- 新增 `CanvasCallOrigin { canvasId?: string; nodeId?: string }`。
- `CanvasContext.call(request, signal?, origin?)` 增加可选第三参数。
- 服务端桥接实现的 `call(request, signal)` 少一个参数，TypeScript 兼容，无需改动。

### 2.2 调用链

- `conversation.vue` 的 `sendCanvasResult` 增加可选 `origin` 参数；调用处传入 `props.nodeBinding`。
- `useCanvasTools` 的 `call` 把 `origin` 透传给 `execute`；重定向到其他画布时同样透传。
- `addNode` 分支优先使用 origin 计算位置，计算失败或 origin 缺失时回退 `args.position`。

### 2.3 摆放算法（纯函数）

新文件 `apps/web/src/pages/workspace/panels/canvas/spawnBesideNode.ts`：

```
findSpawnPosition(anchor, occupied, { width=320, height=300, gapX=80, gapY=40 }):
  x = anchor.x + anchor.width + gapX
  y = anchor.y
  loop (最多 10000 次):
    bottom = occupied 中与候选矩形 (x, y, width, height) 相交的节点里最大的 (y + height)
    若没有相交: 返回 { x, y }
    y = bottom + gapY
```

- `anchor` 与 `occupied` 全部是绝对坐标矩形（`computedPosition` + `dimensions`）。
- 只比较 x 区间有重叠的节点，避免被远处节点无谓下推。
- 锚点自身不参与避让。
- 分组节点本身也参与避让。

### 2.4 尺寸兜底

| 对象 | 宽 | 高 |
| --- | --- | --- |
| Agent 锚点 | `dimensions.width`，缺省 300 | `dimensions.height`，缺省 180 |
| 已有节点 | `dimensions.width`，缺省 320 | `dimensions.height`，缺省 300 |
| 新节点 | 320 | 300 |

挂载后仍走 `nextTick + updateNodeInternals + nextTick`，下一次调用即可读到真实尺寸。

### 2.5 工具说明

`packages/tools/canvas/src/runtime.ts` 的 `addNode` 描述改为：存在画布 Agent 节点绑定时忽略 `position`，节点放在发起节点右侧一列；无绑定（如普通对话）时按 `position` 放置。schema 不变，避免影响既有调用。

## 3. 改动文件

| 文件 | 改动 |
| --- | --- |
| `packages/toolScaffold/src/runtime.ts` | 新增 `CanvasCallOrigin`，`CanvasContext.call` 可选第三参数 |
| `apps/web/src/components/agent/conversation.vue` | 上报画布调用时带上 `nodeBinding` |
| `apps/web/src/pages/workspace/panels/canvas/useCanvasTools.ts` | 透传 origin；addNode 使用就近摆放 |
| `apps/web/src/pages/workspace/panels/canvas/spawnBesideNode.ts` | 新增纯函数 |
| `apps/web/src/pages/workspace/panels/canvas/spawnBesideNode.test.ts` | 新增单测 |
| `packages/tools/canvas/src/runtime.ts` | `addNode` 描述同步 |

## 4. 风险与取舍

| 风险 | 处理 |
| --- | --- |
| 调用方节点已删除 / 不在当前画布 | `flow.findNode` 找不到即回退模型坐标 |
| Agent 在分组内 | 用 `computedPosition` 取绝对锚点；新节点保持顶层 |
| 右侧已有大节点 | 按矩形底边下推，不会压住 |
| 一列过长 | 用户已选单列；保持可预测优先 |
| 模型仍传坐标 | 忽略但不报错，工具描述说明原因 |

## 5. 评审意见

子 Agent 初评（2026-11-02 15:26）结论：**修改后通过**。意见与处理：

| 编号 | 意见 | 处理 |
| --- | --- | --- |
| R1（P0） | 先碰撞后吸附，吸附可能右移半格重新压住右侧节点 | 改为先吸附 x 再碰撞；向下顺延时用向上取整的 `snapOffset` |
| R2（P1） | `redirected.call` 未带 origin，renameCanvas 后 addNode 退回模型坐标 | 代理调用同样透传 origin |
| R3（P1） | `dimensions` 恒为 `{0,0}`，`??` 兜底不生效 | 全部改用 `||` |
| R4（P1） | 未校验 `origin.canvasId`，多画布实例可能放错画布 | `execute` 入口校验 origin.canvasId === canvasId |
| R5（P2） | 新节点 320×300 偏小 | 估算改 360×320，并在挂载后按实测尺寸再校正一次 |
| R6（P2） | 10000 次后可能返回碰撞坐标 | 改为抛错 |
| R7（P2） | 工具描述改了但 `build/tools/canvas.tool.js` 不会自动更新 | 单独重建 canvas 工具包并同步；`build.ts` 的 prompt 一并改掉与旧描述矛盾的一句 |
| R8（P2） | 锚点在分组内时的预期未写明 | 写入需求边界：新节点保持顶层，遇组框按矩形避让，可能落到组下方 |
| R9（P3） | `CanvasCallOrigin` 字段应必填；文档对 `sendCanvasResult` 作用域描述不准确 | 两字段均必填；文档已改 |
