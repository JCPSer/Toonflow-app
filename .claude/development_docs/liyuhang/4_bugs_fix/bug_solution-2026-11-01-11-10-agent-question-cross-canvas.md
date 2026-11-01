# Bug 修复方案：Agent 提问横幅跨画布显示

- 时间：2026-11-01 11:10
- 分支：`feat/exec-node`
- 对应分析：`bug_analysis-2026-11-01-11-10-agent-question-cross-canvas.md`

## 1. 方案概述

把提问提醒从画布组件内的 `ref` 提升为全局 Pinia store，结构对齐任务完成提醒：

- 每条提醒带 `canvasKey`（画布实例键，改名不变）与 `canvasId`（当前文件路径）；
- 面板每次上报本画布全量未回答列表，store 按 `canvasKey` 整组替换；
- 每个画布的横幅读同一份全局列表，本画布条目按节点表过滤，其他画布条目保留；
- 跨画布点击复用现有 `activateCanvas` + `pendingFocus` 模式。

## 2. 详细设计

### 2.1 数据结构

```
CanvasAgentQuestion = AgentQuestionNotice + {
    canvasId?: string      // 画布文件路径，点击时用于 activateCanvas
    canvasKey: string      // 画布实例键，定位目标实例
}
pendingFocus = { nodeId, canvasKey }   // 目标实例消费一次
```

### 2.2 同步流程

```
agentNodePanel 提问变化
  → canvas A 的 @questions
  → store.sync(canvasKey=A, canvasId, 全量列表)
  → 替换 A 名下条目，保留其他 canvasKey 的条目
  → 所有画布的横幅 computed 重新计算
```

- 回答/关闭面板/节点删除：面板列表少一条 → sync 整组替换 → 全局同步消失。
- 画布卸载：`removeCanvas(canvasKey)` 清掉名下条目。
- 画布改名/另存：监听 `canvasId`，调用 `setCanvasId` 更新条目路径。

### 2.3 展示

| 场景 | 横幅内容 |
| --- | --- |
| 本画布提问 | 节点名（与原来一致） |
| 其他画布提问 | `画布名 · 节点名` |

- 列表 key 改为 `canvasKey:nodeId`，避免两块画布恰好同 ID 时复用错节点。
- 本画布条目仍过滤已删除/已禁用节点；其他画布条目不能按本画布节点表过滤。

### 2.4 点击流程

```
click(item)
  ├─ item.canvasKey == 当前实例
  │    → fitView(node) → agentNodePanel.open(node)
  └─ 否
       → store.requestFocus(nodeId, canvasKey)
       → activateCanvas(item.canvasId)
            ├─ 成功：目标实例 active && canvasReady 时消费 pendingFocus
            │        → nextTick → fitView + open
            └─ 失败：clearPendingFocus + ElMessage.error
```

- 与任务提醒的 `focusTaskAlert` 保持同构，不新增跨实例通信机制。

## 3. 兼容与边界

- 单画布：全局列表只有本画布条目，行为不变。
- 画布被删除：实例卸载触发 `removeCanvas`，旧条目消失。
- 跨项目：工作区销毁，store 随页面重建；不保留跨项目提醒。
- 后台画布中的 Agent 面板仍在运行，提问事件照常上报；本次只改提醒的可见范围。

## 4. 影响文件

- 新增 `apps/web/src/stores/agentQuestions.ts`
- `apps/web/src/pages/workspace/panels/canvas/index.vue`

## 5. 评审意见

| 评审人 | 结论 | 意见 |
| --- | --- | --- |
| 用户（选择题确认） | 通过 | 顶部横幅全局显示；点击切画布并打开面板。 |
| 子 Agent 审查 | 通过 | 方案与实现一致；审查补充的失效条目清理、pendingFocus 作废、跨项目显式清空均已落地。 |
