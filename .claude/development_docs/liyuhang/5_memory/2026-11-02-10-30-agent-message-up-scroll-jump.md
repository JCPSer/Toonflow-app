# 记忆：Agent 对话面板向上滚动内容跳动

- 时间：2026-11-02 10:30
- 类型：Bug 修复

## STAR

**Situation（背景）**
Agent 对话消息列表是虚拟列表（`@tanstack/vue-virtual@3.13.39` → 运行时 `@tanstack/virtual-core@3.17.11`）：动态行高、`estimateSize` 固定 240px、绝对定位 + `translateY`、`anchorTo: "end"` 贴底跟随。用户往上翻历史时，滚动过程中内容一段一段错位跳动；向下翻正常。

**Task（任务）**
消除向上滚动时的跳动，不改布局参数、不升级依赖。

**Action（行动）**
- 定位：上游 TanStack/virtual #1227——3.14 起 `resizeItem` 在 `scrollDirection === "backward"` 时跳过视口上方行高变化的 `scrollTop` 补偿；3.17.x 的 `shouldAdjustScrollPositionOnItemSizeChange` 只认实例属性，不认 options。因此视口上方的行（图片/字体/工具卡片实测高度远大于 240px 估算）每变化一次，下方内容就整体位移一次。
- 修改 `apps/web/src/components/agent/conversation/messageList.vue`：虚拟器实例赋值
  `shouldAdjustScrollPositionOnItemSizeChange`——保留库默认的「整行在视口上方」条件（首测按「顶边在上方」），只删掉 `scrollDirection !== "backward"` 的限制。
- 复审 P1 整改：初版无条件用「顶边在上方」，会把跨视口上沿的长回复也纳入补偿，流式增长时视口会被一路推走（库注释 #1218）；改为按 `itemSizeCache.has(key)` 区分首测/重测。
- 类型层面 `getScrollOffset()` 私有，改用公开的 `scrollOffset` + `scrollAdjustments`。

**Result（结果）**
类型检查仅既有 `@/agentRuntime` 报错；既有 24 个画布单测通过；web 已构建并 rsync 到安装目录（`index.html` `c47ecbbd…`、`workspace-D7_LatSK.js` `a3a46cc3…`），未重启应用。

## 关键经验

1. 虚拟列表「向上滚动才跳」几乎一定是测量补偿问题，不是内容渲染问题；排查先看库是否按滚动方向跳过了补偿。
2. TanStack Virtual 3.17.x 的 `shouldAdjustScrollPositionOnItemSizeChange` 必须赋在实例上（`setOptions` 不读取 options 里的同名字段）。
3. 私有 API（`getScrollOffset`）在类型上不可用，用等价的公开字段组合（`scrollOffset + scrollAdjustments`）。
4. 修复前先确认用户现象的「方向 + 时点」（往上/往下、滚动中/停下后），能直接把嫌疑缩到补偿分支。
