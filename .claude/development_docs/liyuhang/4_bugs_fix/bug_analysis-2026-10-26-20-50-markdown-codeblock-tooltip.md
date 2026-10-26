# Bug 分析：代码块头部错位 + 进度条气泡残留

日期：2026-10-26 20:50
状态：已修复

## 一、现象

1. Agent 对话里的代码块渲染错位：语言标签与复制/展开按钮那一行叠在代码正文中间，展开（全屏）后同样错位。
2. 视频节点进度条上的时间气泡（`0:00`）偶尔出现后不消失，一直浮在画布上。

## 二、定位过程

### 2.1 代码块错位

- DOM 结构（`vue-stream-markdown/dist/code-block-*.js`）：`div[data-stream-markdown=code-block]` 内依次是 `header[code-block-header]`（语言、操作）与 `main[code-block-content]`（代码，`overflow: auto`）。
- header 的类里带 `sticky top-0 z-[5]`，即 `position: sticky`。
- 消息列表 `apps/web/src/components/agent/conversation/messageList.vue:35` 用虚拟滚动：每行 `:style="{ transform: translateY(${row.start}px) }"`。
- 用 WKWebView harness 复刻「transform 行 + 滚动容器」后测量：把 header 强制改回 `sticky`，滚动前后 header 相对代码块顶部的偏移为 **119px / 76px**（正常应为 0）。改为 `static` 后恒为 1px（边框）。
- 结论：WebKit 下 `position: sticky` 在带 `transform` 的祖先里按该祖先而非滚动容器定位，header 被推入正文区域。真正需要吸顶的是 `code-block-content` 自己（`overflow: auto` 才是滚动容器），header 在外层，本来也不需要 sticky。

### 2.2 进度条气泡残留

- 气泡是 Element Plus `el-slider` 的 tooltip，渲染到 `body`。
- 触发条件：鼠标停在进度条上时，播放器被切走 —— 新增的「闲置 30s 卸载」或节点分支切换（`v-if`）导致参考元素卸载，Element Plus 不会关闭已挂载的 popper。
- 复现路径与新增的按需加载能力直接相关，属于本次改动的回归面。

## 三、优先级 / 难度 / 风险

代码块错位 P1（内容可读性受损），难度低；气泡残留 P1（遮挡画布、无法关闭），难度中低。

## 四、评审意见

（两处均为样式/交互层修复，无数据结构变更。）
