# Bug 修复方案：Agent 对话面板向上滚动时内容跳动

- 时间：2026-11-02 10:30
- 对应分析：`bug_analysis-2026-11-02-10-30-agent-message-up-scroll-jump.md`
- 状态：已与用户确认方向，待实施

## 1. 目标

恢复「视口上方行高变化 → 补偿 `scrollTop`」的旧行为，使向上翻历史时视口内容稳定；不改布局参数与依赖版本。

## 2. 方案概览

```
messageVirtualizer 实例创建后，赋值实例属性（不是 options）
   shouldAdjustScrollPositionOnItemSizeChange(item, delta, instance):
      offset = scrollOffset + scrollAdjustments
      if 顶边不在视口上方: return false
      if 首次测量: return true                 // 与库默认一致
      return 行底边 <= offset                  // 只补整行都在视口上方的行
        │
        ▼
resizeItem 里「向上滚动不补偿」的限制被去掉，其余判定与库默认一致
```

## 3. 关键设计

- **为什么用实例属性**：`@tanstack/virtual-core@3.17.11` 的类型里声明了 `shouldAdjustScrollPositionOnItemSizeChange`，但 `setOptions` 不会从 options 读取它；只有直接赋在实例上才会被 `resizeItem` 采用。`setOptions` 之后也不会被覆盖。
- **只去掉方向限制，保留「整行在视口上方」**：库默认的重复测量条件是「整行在视口上方且不在向上滚动」。直接把条件放宽成「顶边在视口上方」会把跨视口上沿的长行也算进来——长回复流式增长时，可见内容会被一路往上推（库注释里的 #1218）。定稿保留「整行在上方」，只删除方向限制。
- **首次测量仍按库默认**：首次测量补偿「顶边在视口上方」的行是对的（整块估算都在上方），用 `itemSizeCache.has(key)` 区分首测与重测；回调执行时本次新尺寸尚未写入缓存，读到的仍是旧值。
- **`getScrollOffset` 是私有方法**，类型层面不可用；用公开的 `scrollOffset` + `scrollAdjustments` 组合。本列表没设 `initialOffset` / `enabled`，两者等价。

## 4. 评审意见

| 级别 | 意见 | 处理 |
| --- | --- | --- |
| P1 | 初版谓词用「顶边在视口上方」无条件补偿，把跨视口上沿的长行也算进来：长回复流式增长时会把视口一路往上推（#1218） | 已修：保留「整行在视口上方」条件，只去掉 `scrollDirection !== "backward"`；首测仍按库默认 |
| P2 | 上游移除该默认值是为修复 React 场景的连锁补偿；本项目是 Vue，需要重启实测 | 已写入验收标准；如实测仍抖动，再考虑升级 `@tanstack/vue-virtual` 到 3.13.51+ |
| P2 | 与 `restoreExpandAnchor` 的手工补偿存在竞争 | 展开通常在静止状态，库默认路径本来也会补偿；实测有问题再处理 |
| P2 | `scrollOffset ?? 0` 等价 `getScrollOffset()` 依赖 `initialOffset=0`、`enabled=true` | 已写入代码注释 |
| P2 | 注释措辞（「只要变高了」「旧行为开关」）不准 | 已改为「变高或变矮」「实例级谓词，整体替换默认判定」 |

## 5. 改动清单

| 文件 | 改动 |
| --- | --- |
| `apps/web/src/components/agent/conversation/messageList.vue` | 虚拟器实例赋值 `shouldAdjustScrollPositionOnItemSizeChange`，恢复向上滚动的行高补偿 |

## 6. 风险与兼容

| 风险 | 说明 | 处理 |
| --- | --- | --- |
| 连锁补偿导致反向抖动 | 向上滚时每次测量都写一次 scrollTop | 只在顶边在视口上方时触发；如仍抖动，退回升级依赖方案 |
| 视口内行变化被补偿 | 跨上沿的行变高也会补偿 | 保证可见部分稳定，符合预期 |
