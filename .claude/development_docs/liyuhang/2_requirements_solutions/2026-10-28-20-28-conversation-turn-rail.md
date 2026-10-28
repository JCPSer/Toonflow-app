# 需求方案：对话轮次目录条

- 记录时间：2026-10-28 20:28
- 代码基线：`d4562fe`
- 关联需求：`1_requirements_matrix/2026-10-28-20-28-conversation-turn-rail.md`

## 一、总体思路

在 `messageList.vue` 的 `.messageViewport` 内、消息滚动容器之后，加一个绝对定位的 `<nav>`。数据直接由已有的 `displayedMessages`（虚拟列表的实际数据源，已过滤掉纯浏览器工具行）推导，不新增任何请求或状态同步。

## 二、UI 设计

### 2.1 收起态（默认）

```
┌───────────────────────────────┐
│ 消息内容…                  ▍  │  ← 贴右边 4px，宽 22px
│                            ▍  │     每条提问一根 12×3 圆角短横
│                            ▍  │     垂直居中排布，间距 4px
└───────────────────────────────┘
```

- 位置：`top: 8px; bottom: 56px; right: 4px`——底部留 56px 让开右下角"回到最新消息"按钮（`bottom:12px` + 32px 圆按钮）。
- 短横颜色 `--el-text-color-placeholder`，悬停单根或展开态下建议色 `--el-color-primary`。
- 不拦截消息区滚动：容器 `pointer-events: auto` 但宽度仅 22px；滚动穿透通过 `overscroll-behavior: contain` 只在目录自身滚动时阻断。
- 轮数 < 2 时整个节点不渲染。

### 2.2 展开态（悬停）

```
┌──────────────────────────┬──────────────────────┐
│ 消息内容…                │1 帮我把故事整理成分镜…│
│                          │2 这个镜头时长再短一点  │
└──────────────────────────┴──────────────────────┘
```

- 悬停 `nav` 时宽 260px 向左扩展，短横变为单行文字（12px，右对齐，`text-overflow: ellipsis`）。
- 底色 `--el-bg-color-overlay` + 1px 边框 + 阴影，`backdrop-filter: blur(6px)`。
- 展开后内容超出高度时目录自身 `overflow-y: auto`，细滚动条。
- 过渡 `width .16s ease` + 文字 `opacity` 淡入；减少动效偏好下不加过渡。

### 2.3 行内容

每行显示序号 + 提问首段（压缩连续空白后截断）。提问为空（只带附件/引用）时显示"（附件/引用）"占位。`title` 与 `aria-label` 给完整提问，便于悬停查看。

## 三、数据与跳转

```
turns ← displayedMessages.flatMap((msg, index) =>
           msg.role = "user" ? { id, index, label } : [])

jump(index):
    atLatestMessage ← false            // 暂时退出贴底，避免测量回调把视图拉回底部
    scrollToIndex(index, align: "start")
    nextTick: atLatestMessage ← isAtEnd()   // 按跳转后的真实位置重算
```

要点：

1. 索引必须取 `displayedMessages` 的下标，虚拟列表的 `count` 与 `getVirtualItems` 都以它为准；直接用 `props.messages` 的下标会错位。
2. 行高估算偏差由 virtual-core 的 `resizeItem` 锚定补偿与 `scrollState.reconcileScroll` 自行校正，**不要**再在 `nextTick` 里补一次 `scrollToIndex`——Vue 的 `nextTick` 早于 scroll 事件与 ResizeObserver，此时偏移没变，重复调用是空操作，反而拉长了 reconcile 的作用窗口。
3. `atLatestMessage` 不是锁：`onChange` 会用 `isAtEnd()` 重算。所以跳转后必须在 `nextTick` 补一次重算——内容不满一屏、或点的就是当前位置时不会产生位移，也就没有 scroll 事件，否则该值会一直停在 false，右下角挂出一个点不掉的「回到最新消息」。
4. 目录不参与 `onChange` 高亮，仅点击时触发。

## 四、命中区域（评审后修正）

初版把整条 nav 都设为可命中，评审指出两个实质问题：nav 是滚动容器的**兄弟节点**，滚轮事件落在它上面不会传给消息列表，右边缘 26px 变成滚轮死角且压住滚动条；同时它盖住了右对齐的消息操作按钮，可能误触跳转。

改为：

- `.turnRail` 与 `.turnRailList` 一律 `pointer-events: none`，只有 `.turnRailItem` 是 `auto`——滚轮与滚动条拖动全部穿透，只有行本身可点。
- 展开条件用 `:has(.turnRailItem:hover)` / `:has(.turnRailItem:focus-visible)`，不用 `:hover` / `:focus-within`：鼠标点击后按钮会保留焦点，`:focus-within` 会让浮层在鼠标移开很久之后仍挂着。
- 行之间不留 `gap`，否则指针跨行时 `:has(hover)` 会瞬时断开导致收起闪烁。
- `.messageList` 预留 `padding-right: 34px`，让目录条落在空槽里，不再压住正文与按钮。
- 行高 20px（原 16px），仍在 WCAG 2.5.8 的 24px 目标尺寸之下，作为窄面板内的紧凑导航接受，靠 `aria-label` + `title` 补足语义。

## 五、影响面

- 只改 `apps/web/src/components/agent/conversation/messageList.vue`（模板 + 脚本 + 样式）。
- 不改组件 props/emits，因此 `conversation.vue` 与 `index.vue` 无需改动。
- 不改虚拟滚动配置，避免动到现有"贴底/测量"行为。

## 六、边界与风险

| 场景 | 处理 |
| --- | --- |
| 子 Agent 会话（`subAgent`） | 同样显示；内容少时自然 <2 条不显示 |
| 删除/回退消息 | `displayedMessages` 变化后目录自动重算 |
| 流式输出中行高变化 | 目录只读用户消息，不受影响 |
| 编辑中消息 | 目录标签跟随 `messages` 更新 |
| 面板极窄（约 380px） | 收起态 22px；展开 260px 会盖住正文，但只在悬停时、移开即收 |
| 键盘 | 每行 `<button>`，Tab 可聚焦，Enter/Space 触发点击 |

## 七、验证计划

1. `vue-tsc` 0 新增错误。
2. 构造 30 轮会话：目录 30 行、点击第 1 行滚到顶部、点击最后一行回到最新；跳转后滚轮仍可正常上下。
3. 单轮会话不出现目录；展开态不遮挡"回到最新"按钮。
4. 子 Agent 面板不报错。

## 八、评审意见

- 子 agent 评审：
- 用户评审：
