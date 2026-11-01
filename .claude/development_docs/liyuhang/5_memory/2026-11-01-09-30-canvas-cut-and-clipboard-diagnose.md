# 画布 ⌘X 剪切 + 剪贴板复制失败诊断

- 时间：2026-11-01 09:30
- 涉及文件：`apps/web/src/lib/canvasShortcuts.ts`、`apps/web/src/pages/workspace/panels/canvas/index.vue`、`apps/web/src/lib/clipboard.ts`、`apps/server/src/lib/desktop.ts`、`apps/server/src/routes/desktop/clipboard/write.ts`、`apps/server/src/routes/desktop/clipboard/diagnose.ts`（新增）、`apps/server/src/router.ts`（重新生成）、`apps/desktop/src/connection.ts`

## STAR

**Situation**
用户反馈画布没有传统 ⌘X 剪切；另在画布 Agent 问答区复制文本时会提示「复制失败，请重试」，但剪贴板里实际已有内容，无法稳定复现。

**Task**
1. 给画布加 ⌘X：复制选中节点后删除，可撤销，复制失败不删，文本选区走原生。
2. 先补剪贴板写入的诊断日志，拿到客户端失败与服务端写入的同一次请求记录。

**Action**
1. `copySelectedNodes` 改为 `Promise<boolean>`（图片分支支持 silent），剪切 = 复制成功 → `canvasHistory.batch(menu.deleteSelection(入口快照选区))`。
2. 新增 `cutSelectedNodes`、document `cut`/`beforecut` 监听；keydown action、Agent 面板白名单、选区守卫都补 cut；默认 `Meta/Ctrl+KeyX`，设置页可改。
3. 复制失败不删：复制任意步骤失败返回 false，剪切直接退出。
4. 诊断：客户端生成 `clipboardId`，写请求带 header；失败时 POST `/api/desktop/clipboard/diagnose`（状态码/原因/长度，不含正文）。服务端记录 write 的 request/done/error、桌面桥拒绝原因（no-runtime/guard），诊断路由只记录 schema 字段。
5. 按审查整改：删除用入口快照而非复制后选区；`router.ts` 用 `bun run routes` 生成；服务端经 `@/agentRuntime` 门面取 agentLog（`lib/desktop.ts` 动态加载避免启动拉起 agent 运行时）。

**Result**
- server `tsc`、desktop typecheck 通过；web 仅既有 `@/agentRuntime` 报错。
- 已重新构建并部署：桌面入口 md5 `af6fbcfc…`、workspace `456aedcf…`、settings `b7bf869c…`，与 Resources 一致；未重启应用。
- 首轮审查 2 条 P1 + 6 条 P2，均已整改；第二轮复核通过（仅注释/文档级 P3）。真机与日志复现待用户重启。

## 教训

- 「复制+删除」不能把两段各自成功的异步操作当原子；剪切必须用复制入口的选区快照删除，否则复制期间改选会删错节点。
- 复制函数吞异常、返回 void 时，任何依赖它结果的上层都只能靠猜；改成显式 boolean 是最小且必要的接口变更。
- 仓库存档的 `router.ts` 是生成物，新增路由后必须跑 `bun run routes`，手工插入会在下次生成时产生大块无关 diff。
- 诊断日志要「能对上」：一次请求一个 id，客户端与服务端两边都带；日志字段白名单，绝不整包记录可能含正文的 body。
- 应用层访问 agent 能力走 `agentRuntime` 门面；启动路径上的 `lib/` 用动态加载，避免为了一个日志函数拉起整个 agent 运行时。

## 关联

- 需求/方案/测试：`1_requirements_matrix/2026-11-01-09-00-canvas-cut-and-clipboard-diagnose.md`、`2_requirements_solutions/2026-11-01-09-00-canvas-cut-and-clipboard-diagnose.md`、`3_test_results/2026-11-01-09-30-canvas-cut-and-clipboard-diagnose.md`。
- 前置：`5_memory/2026-10-29-11-30-agent-interaction-batch.md`（Agent 面板快捷键）、`5_memory/2026-10-29-17-16-agent-slash-shortcut-compact.md`（面板内 Cmd+C/V）。
