# Bug 修复方案：⌘, 打不开设置面板

- 时间：2026-11-16 16:36
- 对应分析：`bug_analysis-2026-11-16-16-36-settings-shortcut-blocked.md`

## 方案
1. 新增 `apps/web/src/lib/overlays.ts`：
   - `visibleOverlayCount(selector = ".el-overlay")`：用 `getComputedStyle(element).display !== "none"` 过滤，只数真正可见的遮罩。
   - `hasVisibleOverlay(selector = ".el-overlay")`：同语义的布尔版本。
2. `components/settings/useSettingsShortcut.ts`：把 `document.querySelectorAll(".el-overlay").length` 换成 `visibleOverlayCount()`。
   - 门禁语义不变：别家可见弹窗开着 → 不打开设置；设置自身可见（计数 1）→ 允许 ⌘, 关闭；设置内又弹确认框（计数 2）→ 让给确认框。
3. `pages/home/index.vue`：Esc 退素材库的遮罩判定改用 `hasVisibleOverlay()`，消除重复实现。

伪代码：

```
onKeydown(event):
  若默认已处理/输入法组合/重复按键 → 返回
  若 !shortcutMatches(event, "Meta+Comma") → 返回
  overlays = 可见 .el-overlay 数量
  if !设置已开 且 overlays > 0 → 返回       // 别家弹窗优先
  if 设置已开 且 overlays > 1 → 返回        // 设置内确认框优先
  preventDefault(); 切换设置
```

## 不改动
- 快捷键匹配（`shortcutMatches` 基于 `event.code`，⌘, 对应 `Meta+Comma`）与设置弹窗本身。
- `canvas/index.vue` 的 `hasModalOverlay()`：它额外包含图片查看器且用 `getClientRects` 判定，语义与 Esc 冲突处理绑定，暂不并入，避免影响画布 Esc 行为。

## 风险与备选
- 若桌面端 WKWebView 根本不把 ⌘, 的 keydown 送到 DOM，本次修复无效；备选方案是在 `apps/desktop/src/index.ts` 的原生菜单里加「设置… accelerator: command+, action」，通过 `application-menu-clicked` 回调转发到 webview（需要新增事件通道），届时再评估。

## 测试
- 自动化：无 DOM 测试环境，`visibleOverlayCount` 走手工；
- 回归：web typecheck（仅既有基线错误）、`bun run --filter '@toonflow/web' build`；画布单测不受影响。

## 评审意见

| 评审人 | 意见 | 结论 |
| --- | --- | --- |
| 子 agent 评审 | 根因成立、无 P1。WKWebView 最小探针确认 ⌘, 的 keydown 会送达 DOM 且可 preventDefault，不需要原生菜单备选。P2：①可见性谓词只查自身 display，父级隐藏/visibility 会误判 → 已加 `visibility` 与 `getClientRects()`；②关闭过渡期间（~0.3s）计数仍为可见，快捷键会被吞，影响极小，记录不修；③图片查看器未计入 → 已把 selector 扩为 `.el-overlay, .el-image-viewer__wrapper`；④canvas `hasModalOverlay` 可复用但涉及 Esc 语义，本次不动，留作后续统一 | 通过 |
