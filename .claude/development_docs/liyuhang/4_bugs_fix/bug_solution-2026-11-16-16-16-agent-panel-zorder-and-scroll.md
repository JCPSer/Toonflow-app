# Bug 修复方案：Agent 对话面板层叠 + 打开不贴最新消息

- 时间：2026-11-16 16:16
- 对应分析：`bug_analysis-2026-11-16-16-16-agent-panel-zorder-and-scroll.md`

## 方案 B1：把面板移出 `.vue-flow` 层叠上下文 + 独立合成层

1. `index.vue`：`<agentNodePanel>` 从 `<vue-flow>` 默认插槽移到 `</vue-flow>` 之后、`.canvas` 根节点内，与 `.vue-flow` 平级。
   - `.canvas` 为 `position:relative; overflow:hidden`，几何尺寸与 `.vue-flow` 一致，面板 `left/top` 坐标含义不变（仍由 `viewport`、`dimensions` 换算）。
   - 面板层级从「`.vue-flow` 上下文内部的 10」变为「`.canvas` 上下文中的 10」，而 `.vue-flow` 整体只有 0 —— 节点不论内部 z-index 多高、合成层怎么提升，都无法超过一个完整层叠上下文。
   - 依赖检查：面板通过 `useVueFlow(runtimeKey)` 取 store（与 DOM 位置无关），props 全部由 canvas 传入，不依赖插槽上下文；`pointer-source`、事件捕获语义与此前一致。
2. `.canvas` 追加 `isolation: isolate`：显式建立层叠上下文，把面板的 `z-index:10` 关在画布内。
   - 评审指出 `.canvas` 自身不是层叠上下文，当前边界来自外层 `container` 查询的 layout containment，属于隐式依赖；一旦外层样式变动，面板会盖住工作区 chrome（切换器/工具条同为 z-index 5）。
3. 不再给面板加 `transform: translateZ(0)`：评审指出面板 `left/top` 带小数，合成层非整数偏移在 WKWebView 易糊字，且改变 `position:fixed` 后代的包含块；首个补丁用结构化层叠修复即可。

伪代码：

```
.canvas (isolation: isolate, 层叠上下文)
  .vue-flow (z-index: 0 层叠上下文)
     viewport(4) > pane(1) > transformationpane(2, 合成层) > nodes
     agentLinkLayer
  agentNodePanel (z-index: 10)   ← 恒在 .vue-flow 之上，且不越出画布
```

不改动：节点 z-index 派生逻辑、link 图层、面板定位与尺寸换算。

## 方案 B2：贴底改为「边贴边测」收敛（v2，评审后）

在 `messageList.vue` 新增 `scrollToLatest()`，并与 `jumpToTurn` 共用一把滚动所有权：

```
scrollEpoch / jumping / pinning
  cancelJump():           scrollEpoch++ ; jumping=false ; pinning=false ; atLatest=isAtEnd()
  jumpToTurn():           token=++scrollEpoch ; jumping=true ; pinning=false
  scrollToLatest():       token=++scrollEpoch ; pinning=true ; atLatest=true
  onChange():             jumping || pinning → 直接返回
  watch(active=false):    scrollEpoch++ ; 清两个标志
  onBeforeUnmount():      同上
```

`scrollToLatest()` 收敛：

```
循环最多 20 次（每轮 40ms）:
  token 失效 → 退出
  容器高度为 0（刚 v-show 出来）→ 等一帧再试
  virtualizer.scrollToEnd()            // 只用库 API，不裸写 scrollTop
  等一帧
  最后一条消息的 rect.bottom ≤ 列表 bottom + 2 且 isAtEnd() → stable++
  stable ≥ 2 → 退出
finally: token 仍有效 → pinning=false, atLatest=isAtEnd()
```

- 评审指正：`scrollToEnd()` 在 3.17.11 会走 `scrollToIndex(count-1, {align:"end"})`，末项直接取 `getMaxScrollOffset()`，且 `resizeItem` 在贴底状态下会自动补滚；所以「落在前面」的确证因子是激活时恢复旧偏移 + 测量中 `atLatestMessage` 被翻成 false。收敛循环按估算落点不精确时兜底。
- 用户中途滚动（wheel/touch/keydown/失活/卸载）都会让 epoch 失效，收敛立刻让位。
- 替换调用点：
  - `watch([active, messageList])` 激活时：始终 `scrollToLatest()`（按用户选择「总是贴最新消息」），不再恢复 `messageScrollOffset`；主 Agent 面板与画布节点面板共用本组件，行为一致。
  - 模板「回到最新消息」按钮：`scrollToLatest()`。
  - 删除不再使用的 `messageScrollOffset`（变量、`onChange` 内赋值、恢复分支）。
- `jumpToTurn` 的收敛逻辑保持不变，仅 token 换成共享 epoch；`measureMessage` 实时行贴底逻辑不变。

## 测试
- 纯逻辑：无新增纯函数；`scrollToLatest` 依赖 DOM，走手工矩阵（分析文档第 4 节）。
- 回归：`agentDispatcher.test.ts`、`agentLinks.test.ts`、`roles.test.ts` 不受影响，仍需全绿；`vue-tsc` 保持基线。
- 构建：`bun run --filter '@toonflow/web' build`。

## 评审意见

| 评审人 | 意见 | 结论 |
| --- | --- | --- |
| 子 agent 评审 | P1-1 取消与互斥不成立（cancelJump 只认 jumping；jumpToTurn 与贴最新会互相拉扯；onChange 会中途改写 atLatest；缺 keydown/失活/卸载取消）→ 已按共享 epoch + 四类取消修正。P1-2 `translateZ(0)` 高风险 → 已删。P2 `.canvas` 非层叠上下文 → 已加 isolation；不裸写 scrollTop → 已改为只调 scrollToEnd；收敛条件补 isAtEnd + 最后一行可见 + 零高度等待；messageScrollOffset 删除影响范围已核验（仅本文件 3 处） | 通过，已落实到方案 v2 |
