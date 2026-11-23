# START 记忆：⌘, 打不开设置

- 时间：2026-11-16 16:52
- 关联：`bug_analysis-2026-11-16-16-36-settings-shortcut-blocked.md`、`bug_solution-2026-11-16-16-36-settings-shortcut-blocked.md`

## Situation
画布页按 ⌘, 没有任何反应，用户怀疑事件没送达。桌面端是 WKWebView（electrobun），快捷键实现为 `useSettingsShortcut` 的 window keydown + `shortcutMatches("Meta+Comma")`。

## Task
让 ⌘, 在首页/工作区都能开、关设置，同时保留「别家弹窗优先」的互斥语义。

## Action
1. 定位根因：Element Plus 2.14.5 的 dialog 遮罩用 `v-show` 收起，设置弹窗常驻渲染后 `.el-overlay` 永远在 DOM 里（display:none），而门禁按节点数量统计，导致 `if (!isOpen() && overlays) return` 恒成立。
2. 新增 `lib/overlays.ts`：`visibleOverlayCount` / `hasVisibleOverlay`，以 `display !== none && visibility !== hidden && getClientRects().length > 0` 判定可见。
3. `useSettingsShortcut` 改用可见计数，selector 含 `.el-image-viewer__wrapper`；`pages/home/index.vue` 的 Esc 判定改用共享 helper。

## Result
- 评审确认根因，并用最小 WKWebView 探针验证 ⌘, 的 keydown 确实送达 DOM（不需要原生菜单备选）。
- typecheck 仅基线错误，构建成功并同步桌面端；`overlays.ts` 为新增未跟踪文件，提交时需 `git add`。
- 手工验收（开/关设置、其他弹窗互斥、图片查看器）待用户重启后确认；已知边界：遮罩关闭过渡 ~0.3s 内快捷键会被吞。
