# 测试记录：⌘, 打不开设置面板

- 时间：2026-11-16 16:52
- 变更：`apps/web/src/lib/overlays.ts`（新增）、`components/settings/useSettingsShortcut.ts`、`pages/home/index.vue`

## 自动化

| 项 | 命令 | 结果 |
| --- | --- | --- |
| 快捷键匹配单测 | `cd apps/web && bun test src/lib/canvasShortcuts.test.ts` | 14 pass（评审侧执行，含 Meta+Comma） |
| 类型检查 | `bun run --filter '@toonflow/web' typecheck` | 仅既有基线错误 `@/agentRuntime` |
| 构建 | `bun run --filter '@toonflow/web' build` | 成功（3.66s），已同步至桌面端 `views/mainview` |

## 证据（评审子 agent 提供）
- Element Plus 2.14.5 dialog 遮罩为 `ElOverlay + v-show`，关闭后节点常驻、仅 `display:none`；`destroyOnClose` 也只销毁内容不销毁遮罩。
- 最小 WKWebView 探针（同形原生菜单、无 ⌘, 菜单项）：`keydown key="," code="Comma" metaKey=true` 送达 WebView，`preventDefault()` 生效。
- 其他门禁（App.vue 缩放拦截、canvas capture、workspace KeyE）均不匹配 Meta+Comma。

## 手工矩阵（待用户重启验收）

| # | 场景 | 预期 |
| --- | --- | --- |
| 1 | 画布页按 ⌘, | 设置弹出 |
| 2 | 设置打开时再按 ⌘, | 设置关闭 |
| 3 | 首页按 ⌘, | 同样的开/关 |
| 4 | 先打开任意弹窗（分享导出/素材详情）并关闭，再按 ⌘, | 仍能打开设置 |
| 5 | 其他对话框打开时按 ⌘, | 不抢占，设置不弹出 |
| 6 | 设置内弹确认框时按 ⌘, | 让给确认框 |
| 7 | 打开图片查看器时按 ⌘, | 不弹设置 |
| 8 | 设置里点关闭后 0.3s 内立刻再按 ⌘, | 可能被关闭过渡吞掉（已知边界） |

## 已知边界
- 遮罩 leave 过渡期间计数仍为可见，快捷键会短暂失效；未修。
- `canvas/index.vue` 的 `hasModalOverlay` 仍用旧的 `getClientRects` 内联实现，未统一（Esc 语义绑定，另评估）。
