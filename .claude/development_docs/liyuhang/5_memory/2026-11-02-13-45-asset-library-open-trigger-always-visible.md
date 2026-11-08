# 记忆：素材库打开入口改为常驻显示

- 时间：2026-11-02 13:45
- 类型：体验调整

## STAR

**Situation（背景）**
上一轮把悬停判定区放大到 40×240、收起延迟放宽到 400ms 后，用户仍觉得打开入口不可靠，直接要求「打开素材库做成常驻式的」。

**Task（任务）**
把左侧打开入口改为常驻显示，右侧关闭入口保持悬停；不改动面板本身。

**Action（行动）**
- `assetLibraryTrigger.vue` 去掉热区、`useHoverReveal`、失焦/移出监听与显隐态，只保留一个 `position: fixed`、左 8px、竖直居中、36px 的圆形按钮，常驻显示。
- 保留 `v-if="!assetLibraryStore.visible"`（面板打开时仍整体卸载）、`aria-controls`、`translate()` 文案与 `focus-visible`。
- 右侧 `assetPanelCloseTrigger` 不变，继续用 `useHoverReveal`（40×240、400ms）。
- 移除打开入口的 `@media (hover: none)` 隐藏：常驻按钮在触屏上也有意义。

**Result（结果）**
类型检查（仅既有 `@/agentRuntime` 报错）与构建通过；`index.html` md5 `7b44a9f6…`、`workspace-Cx3Q5bW2.js` md5 `34ebe4b9…`、`workspace-CCtICbfr.css` md5 `1b9589b3…` 已同步到应用目录；**未重启应用**。

## 关键经验

1. 悬停入口依赖指针轨迹，在 WKWebView 里很容易「看得见、点不到」；高频使用的入口直接常驻更稳。
2. 常驻控件要接受它对下方画布点击的拦截，这是可见控件的固有代价。
