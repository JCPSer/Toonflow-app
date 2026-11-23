# Bug 分析：⌘, 打不开设置面板

- 时间：2026-11-16 16:36
- 范围：`apps/web/src/components/settings/useSettingsShortcut.ts`、`apps/web/src/lib/overlays.ts`（新增）、`apps/web/src/pages/home/index.vue`

## Bug 矩阵

| # | 背景 | 目标 | 描述 | 优先级 | 难度 | 风险 |
| --- | --- | --- | --- | --- | --- | --- |
| B1 | 工作区页面挂载了 `<settings>`（ElDialog），`useSettingsShortcut` 用 `document.querySelectorAll(".el-overlay").length` 判断"别家弹窗是否开着" | ⌘,（非 Mac Ctrl+,）在画布/首页都能开、关设置面板 | 按 ⌘, 无任何反应，像事件没送达。根因：Element Plus 用 `v-show` 收起遮罩，`el-dialog` 一旦挂载，`.el-overlay` 节点就一直在 DOM 里（`display:none`）；按节点数量统计会把"从未打开的设置弹窗"算成已打开的遮罩，`if (!isOpen() && overlays) return;` 永久拦截 | P1 | 低 | 低：只改可见性判定；需在真实桌面端验证 WKWebView 确实把 ⌘, 的 keydown 送到 DOM |

## 根因
- `element-plus@2.14.5` 的 dialog 模板对 `ElOverlay` 使用 `withDirectives([[vShow, visible]])`（`dialog.vue_vue_type_script_setup_true_lang.mjs` 约 151–153 行），关闭只是 `display:none`，节点不销毁。
- `workspace/index.vue` 常驻渲染 `<settings v-model="settingsVisible" />`，所以页面一加载就有至少一个隐藏 `.el-overlay`。
- `useSettingsShortcut` 只看数量 → 门禁永远成立 → `event.preventDefault()` 都不会执行，表现即为"没接收到事件"。
- 同类代码：`pages/home/index.vue` 的 Esc 退素材库判定已用 `getComputedStyle(...).display !== "none"` 过滤，本次统一。

## 影响面
- 只影响快捷键门禁的可见性判断；设置面板自身开关逻辑、其他弹窗互斥语义不变。

## 验收要点
1. 画布页按 ⌘, 弹出设置，再按 ⌘, 关闭。
2. 首页按 ⌘, 同样可开可关。
3. 打开其他对话框时按 ⌘, 不抢焦点；在设置里打开确认框时 ⌘, 不关闭设置。
4. 之前打开过任意弹窗（素材详情、分享导出等）后再按 ⌘, 仍然生效。

## 评审意见（子 agent）
（见方案文档评审栏）
