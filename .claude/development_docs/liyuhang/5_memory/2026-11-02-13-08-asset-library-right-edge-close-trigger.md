# 记忆：素材库面板右边缘悬停关闭入口

- 时间：2026-11-02 13:08
- 类型：需求开发

## STAR

**Situation（背景）**
素材库面板打开后只有标题栏右上角 `×` 一个关闭入口。用户在面板右侧操作时希望就近关闭，并与刚加的左边缘打开入口形成左右对称的交互。

**Task（任务）**
在素材库面板右边缘竖直居中加悬停关闭入口：外侧 12×160 热区触发 36px 圆形左箭头按钮，点击关闭面板；停靠与浮层都生效；贴屏幕右缘时可回退到面板内侧。

**Action（行动）**
- 新增 `assetPanelCloseTrigger.vue`，作为 `floatingAssetLibrary` 默认 slot 的第二个根节点渲染进 `floatingPanel` 的 `<aside>`；`aside` 为 `fixed` 且无 `overflow`，绝对定位的按钮因此天然跟随面板拖动、缩放与停靠切换。
- 热区（`right: -12px`）与按钮（`right: -44px`）全部在面板边框外，不与右侧 5px 缩放热区重叠；根容器 `pointer-events: none`，只有热区与可见按钮接收指针。
- 回退：读 `panel.style.left/width`（不读受 translateX 动画污染的 `getBoundingClientRect`）判断 `right + 52 > innerWidth`，空间不足时按钮翻到面板内侧 8px，仅淡入淡出；窗口 resize 后 `nextTick` 重算，键盘聚焦走 `reveal()` 同样先重算。
- 把左右两个入口的悬停状态机抽成 `useHoverReveal.ts`（显示无延迟、160ms 收起、hovering + activeElement 守卫、window blur/focus、documentElement mouseleave、卸载清理），左入口改为复用。
- 两个入口统一使用 `translate()` 标注 aria-label/title，并补 `@media (hover: none)` 隐藏，避免触屏隐形热区吞点击。
- 评审整改：回退态只淡入（首次翻转不变向滑入）、根容器 `z-index: 3`、补记外侧热区会截获画布点击/滚轮的已知降级。

**Result（结果）**
web 类型检查（仅既有 `@/agentRuntime` 报错）与构建通过；产物 `workspace-DNHCwwcd.js` md5 `3e5092b2…`、`index.html` md5 `0eccf3cc…` 已同步到应用目录；设计评审「修改后通过」、实现复审「通过」；**未重启应用**。

## 关键经验

1. 面板边缘的附属控件直接做成面板 `aside` 的绝对定位子元素，比监听面板 rect 简单得多，拖拽/缩放/停靠都自动跟随。
2. 判断「是否贴住视口边缘」不要读 `getBoundingClientRect()`：面板显隐动画的 `translateX` 会污染结果；读布局用的内联 `left/width` 更稳。
3. `window resize` 里父组件先改响应式值、DOM 后更新，子组件必须 `nextTick` 后再量。
4. 键盘聚焦路径要和鼠标悬停走同一套定位计算，否则回退态下会出现「按 Enter 关闭了看不见的按钮」。
5. 隐形热区在触屏上是纯负担，`@media (hover: none)` 隐藏是必要守卫。
