# 记忆：画布「显示/隐藏连线」快捷键 L（STAR）

- 时间：2026-11-21 00:49

## Situation

画布右下角已有「显示或隐藏连线」按钮，但只能鼠标点；连线多时想临时看清节点结构只能去点工具条。用户希望按 L 直接开关。

## Task

把连线显隐纳入现有画布快捷键体系（可改键、可关闭、冲突校验），默认裸 L；不新增独立键盘监听，不改数据。

## Action

- `apps/web/src/lib/canvasShortcuts.ts`：`defaultCanvasShortcuts` 新增 `toggleEdges: "KeyL"`；`canvasShortcutFields` 新增 `{ id: "toggleEdges", label: "显示/隐藏连线" }`（普通动作，非按住类）。设置存储按字段表自动归一化，老配置缺键时取默认值。
- `apps/web/src/pages/workspace/panels/canvas/index.vue`：动作匹配列表加入 `toggleEdges`；分发处取反 `showEdges`（会话级 `canvasView.showEdges`，与工具条按钮同一状态），并同步清 `edgeDisconnect`，复用工具条 `@update:showEdges` 的收尾逻辑。
- `canvasShortcuts.test.ts`：新增 2 例——默认裸 L 合法且与全部默认键不冲突；裸 L 命中、带 Meta/Shift 不命中。

## Result

- `bun test src/lib/canvasShortcuts.test.ts` 16 例通过；`build:web` 成功。
- 视图已同步到 `Resources/app/views/mainview`（备份 `mainview.bak-20261121-004932`），未重启应用。
- `vue-tsc` 仍有既有报错 `apps/server/src/modules/agentAccess/singleAgent/types.ts` 找不到 `@/agentRuntime`，与本次无关。

## 教训

画布级快捷键一律走 `canvasShortcuts` 字段表 + 动作分发，不要另挂 window keydown；新动作默认键要先扫一遍已占用字母（V/H 工具、Q/W/E 面板、G/F 组合）。
