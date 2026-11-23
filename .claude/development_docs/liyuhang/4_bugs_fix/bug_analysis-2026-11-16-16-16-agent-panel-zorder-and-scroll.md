# Bug 分析：Agent 对话面板被下方节点盖住 + 重新打开不贴最新消息

- 时间：2026-11-16 16:16
- 范围：`apps/web/src/pages/workspace/panels/canvas/index.vue`、`components/agentNodePanel.vue`、`apps/web/src/components/agent/conversation/messageList.vue`
- 用户现象：
  1. Agent 对话面板下方有图片节点或其他节点时，面板会「闪」——用户确认表现是**被下方节点盖住**，发生在打开面板瞬间，且不定时出现。
  2. 每次打开 Agent 面板不一定是最近的会话位置，可能跳到前面某条消息。

## 1. Bug 矩阵

| # | 背景 | 目标 | 描述 | 优先级 | 难度 | 风险 |
| --- | --- | --- | --- | --- | --- | --- |
| B1 | 面板挂在 `<vue-flow>` 默认插槽里，`.vue-flow` 自身是 `position:relative; z-index:0` 层叠上下文；节点在 `.vue-flow__viewport`（z-index 4）+ `.vue-flow__transformationpane`（transform，合成层）里 | 面板在画布内恒定压住所有节点，不因下方节点重绘被覆盖 | 打开面板瞬间或不定时，下方图片节点/其他节点绘制到面板之上；用户已在设置里开「画布合成优化」（`will-change: transform`） | P1 | 中 | 中：WKWebView 合成层顺序问题属宿主行为，只能结构性规避，无法单测覆盖 |
| B2 | `messageList.vue` 的贴底逻辑用 `useVirtualizer().scrollToEnd()`，其终点 = `getTotalSize() - getSize()`，而行高默认按 `estimateSize: 240` 估算 | 打开面板/点「回到最新消息」后一定停在最后一条消息 | 图片、工具卡片等行实测高度远大于 240px；估算总高偏小，`scrollToEnd()` 落在中段某条消息上；虚拟器随后按「保持视口上方行补偿」策略修正滚动，视觉位置被固定在该中段消息，表现为打开后跳到前面 | P1 | 中 | 低：纯前端滚动逻辑，可写纯逻辑单测 + 手工矩阵 |

## 2. 根因分析

### B1 层叠顺序
- 面板 `.agentNodePanel` 为 `position:absolute; z-index:10`，但它是 `.vue-flow`（`z-index:0; position:relative`，形成层叠上下文）的**子节点**，因此 `10` 只在 `.vue-flow` 内部生效。
- 节点渲染链路：`.vue-flow__viewport`（`z-index:4; overflow:clip`）→ `.vue-flow__pane`（z-index 1）→ `.vue-flow__transformationpane`（`transform`，z-index 2，且开启「画布合成优化」后带 `will-change: transform`）→ `.vue-flow__nodes` → 节点。
- 数学上 `10 > 4` 应当恒在上面；但 WKWebView 对「被 transform/will-change 提升的合成层」存在越层重绘的已知行为（本项目 10-24 已因 WKWebView 选中高亮在缩放层留残影做过同类规避）。合成层顺序抖动不依赖 DOM 顺序，因此表现为「打开瞬间/不定时」。
- 追加风险：Vue Flow 选中节点会临时 `zIndex + 1000`，虽然仍在 viewport 上下文内，但进一步放大了合成层顺序抖动的可见概率。

### B2 虚拟列表贴底
- `scrollToEnd()` 只做一次定位，且基于「未测量行的 240px 估算」；真实内容（图片、工具卡片、代码块）行高远超估算。
- 虚拟器 `anchorTo:"end"` + 自定义 `shouldAdjustScrollPositionOnItemSizeChange`（保留视口上方行高补偿）会在测量补齐后**保持当前视觉位置**，不会把视口再推到真正的底部。
- 于是「打开面板」在长对话/含媒体对话里落到中段；短对话（不足一屏或行高接近估算）表现正常，符合「不一定」。

## 3. 影响面
- B1 只影响画布内 Agent 面板显示层级，不涉及数据与派发逻辑。
- B2 只影响对话消息列表的初始滚动位置，不涉及消息数据；`jumpToTurn`（轮次目录）另有独立收敛逻辑，不受影响。

## 4. 验收要点（用户手工）
1. 面板下方放图片节点/跑着的节点，反复打开/关闭面板、缩放画布：面板始终完整可见，不被节点覆盖。
2. 打开含图片、工具卡片的较长对话：落点固定在最后一条消息。
3. 点右下角「回到最新消息」同样落到最后一条。
4. 手动滚动到历史位置后，切到别的画布再回来：按用户选择，回到最新消息。

## 5. 评审意见

| 评审人 | 意见 | 结论 |
| --- | --- | --- |
| 子 agent 评审 | B1 方向成立；`.canvas` 本身不是层叠上下文（目前靠外层 `container` 查询的隐式 containment），需显式加隔离；`translateZ(0)` 非必要且有糊字/包含块风险，首个补丁不要加。B2 不应裸写 `scrollTop`，取消/互斥/状态回落需按共享 epoch 设计；根因描述需修正，`scrollToEnd` 实际走 `scrollToIndex(count-1, end)` → `getMaxScrollOffset()`，`resizeItem` 有 wasAtEnd 自动补滚 | 采纳，详见方案 v2 |

### 评审记录（v1 → v2）
1. B1 修正：`translateZ(0)` 移除；`.canvas` 增加 `isolation: isolate` 显式收束层级边界，并说明此前依赖隐式 containment。
2. B2 修正：根因证据补齐——`@tanstack/virtual-core@3.17.11` 的 `scrollToEnd()` 对末项返回 `getMaxScrollOffset()`，且 `resizeItem` 在贴底状态下会自动补滚；因此「落在前面」的确证因子是（a）激活时 `else scrollToOffset(messageScrollOffset)` 主动恢复旧偏移，（b）测量过程中 `onChange` 把 `atLatestMessage` 翻成 false 后不再修正。方案保留按估算落点不精确时用收敛循环兜底。
3. B2 修正：`scrollToLatest` 不写裸 `scrollTop`，只调 `scrollToEnd()`；与 `jumpToTurn` 共用 `scrollEpoch` 所有权；补 wheel/touch/keydown/失活/卸载取消；`finally` 按 token 归属回落 `atLatestMessage`。
