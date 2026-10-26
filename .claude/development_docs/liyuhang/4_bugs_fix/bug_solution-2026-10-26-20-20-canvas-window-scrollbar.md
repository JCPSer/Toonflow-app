# 修复方案：画布区域偶尔出现窗口级滚动条

日期：2026-10-26 20:20
对应分析：`bug_analysis-2026-10-26-20-10-canvas-window-scrollbar.md`

## 一、方案总览

三层约束，从「治本」到「兜底」：

```
状态条（根因）  → 窄窗口折行 + 自身限高滚动
画布容器（边界）→ overflow: hidden，画布内的浮层一律不出画布
工作区路由（兜底）→ html.workspaceViewportLock 锁死文档滚动
```

## 二、详细设计

### 2.1 状态条折行（`packages/ext/comfyMonitor`）

- `.comfyMonitor` 增加 `flex-wrap: wrap`、`max-height: calc(100% - 16px)`、`overflow: auto`。
- 行为：窗口足够宽时单行不变；变窄后芯片换行，最多占满画布高度，超出部分在状态条内部滚动。
- 拖动夹取逻辑不变（`clamp` 用 `getBoundingClientRect`，折行后自动按新尺寸夹取）。

### 2.2 画布容器裁切（`apps/web/src/pages/workspace/panels/canvas/index.vue`）

- `.canvas` 增加 `overflow: hidden`。
- 作用域：仅画布容器。节点浮动面板本来就位于 Vue Flow 图层内（已被其裁切），行为不变；状态条、覆盖层等兄弟节点也不会再撑开页面。

### 2.3 工作区文档锁（`apps/web/src/App.vue`）

- `watchEffect` 按 `route.path.startsWith("/workspace")` 切换 `documentElement` 上的 `workspaceViewportLock`。
- 样式：`html.workspaceViewportLock, html.workspaceViewportLock body { height: 100%; overflow: hidden; }`。
- 只在工作区路由生效；首页/hello/设置等页面仍可正常文档滚动。

## 三、为什么放在 App.vue 而不是工作区页面内

页面内 `onMounted` 加类、`onBeforeUnmount` 去类，在路由跳转被守卫拦下、或组件因 keep-alive/过渡延迟卸载时容易残留。App.vue 以路由状态为唯一真源，天然跟随实际渲染的页面。

## 四、验证要点

1. 800×560、1024×700、1440×900、1312×812 四档窗口下，`documentElement.scrollWidth === clientWidth` 且 `scrollHeight === clientHeight`。
2. 状态条展开且窗口很窄时，芯片折行，设置/折叠/清理按钮仍在画布内可见可点。
3. 首页 `/home`、`/hello` 上 `workspaceViewportLock` 不生效（`body.overflow` 不为 hidden）。
4. 画布内选中节点弹出底部输入区、拖动浮层不影响页面尺寸。

## 五、评审意见

（子 agent 评审：本次为三处独立 CSS/样式约束，改动面小，按方案实施。）
