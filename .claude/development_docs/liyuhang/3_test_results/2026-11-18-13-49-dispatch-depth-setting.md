# 测试记录：Agent 任务链上限开发者设置

- 时间：2026-11-18 13:49
- 变更：`dispatchLimits.ts`（新）、`dispatchDepthSchema.ts`（新）、`sendToAgent.ts`、`runtime/index.ts`、`preferences.ts`、`routes/agent.ts`、`stores/settings.ts`、`agentDispatcher.ts`、`canvas/index.vue`、`developer/index.vue`、server `package.json` 导出

## 自动化

| 项 | 命令 | 结果 |
| --- | --- | --- |
| 派发深度纯函数 | `cd apps/server && bun test src/agent/runtime/dispatchLimits.test.ts` | 4 pass |
| 路由 schema | `cd apps/server && bun test src/agent/dispatchDepthSchema.test.ts` | 2 pass |
| sendToAgent | `cd apps/server && bun test src/agent/tools/sendToAgent.test.ts` | 5 pass（含自定义上限与事件携带 maxDepth） |
| 服务端全量 | `cd apps/server && bun test` | 158 pass / 0 fail |
| 服务端类型检查 | `bun run --filter '@toonflow/server' typecheck` | 通过 |
| 画布 dispatcher | `cd apps/web && bun test .../agentDispatcher.test.ts` | 18 pass（含事件上限优先） |
| Web 类型检查 | `bun run --filter '@toonflow/web' typecheck` | 仅既有 `@/agentRuntime` 基线错误 |
| Web / 桌面构建 | `build:web`、`build:desktop` | 成功 |

## 关键断言

- `normalizeDispatchMaxDepth`：缺省/非数字/NaN/Infinity → 8；0/-5 → 1；100 → 32；小数取整。
- 路由 `dispatchDepth`：0/8/32 通过，-1/33/1.5/字符串拒绝。
- `sendToAgent`：默认 8 拒绝第 9 跳；自定义 `maxDepth: 3` 时 depth 3 拒绝、depth 2 放行，事件带 `maxDepth: 3`。
- 画布 dispatcher：事件 `maxDepth: 2` 优先于本地 `maxDepth: 8`，depth 2 的派发被丢弃、不产生调用与箭头；depth 1 正常执行。

## 部署

| 项 | 内容 |
| --- | --- |
| 桌面入口 | `build/desktop` 内层 `3vos65l1b6yss.tar.zst` → `app/bun/index.js`（17,856,780 B，含 `BrowserWindow`） |
| Web 视图 | `build/web/` → `Resources/app/views/mainview`，入口 `assets/index-CzB7pIR3.js` |
| 备份后缀 | `20261118-134812` |
| 重启 | 未重启，由用户退出重开 |

## 手工验收矩阵（待用户重启）

| # | 场景 | 预期 |
| --- | --- | --- |
| 1 | 设置 → 开发者 → 派发 | 显示「任务链上限」默认 8，范围 1–32，有未保存提示与保存按钮 |
| 2 | 改成 3 保存，再派发第 4 跳 | 工具报「3 跳上限」，不产生派发 |
| 3 | 改成 32 保存，派发到第 9–32 跳 | 不再被路由 400 拦截，链路可继续 |
| 4 | 输入 0 / 清空后保存 | 分别落到 1 / 8，输入框回显钳制后的值 |
| 5 | 另一位已打开的客户端 | 新设置需刷新后生效；当前客户端由服务端事件携带的上限兜底 |

## 已知风险

- 上限调到 32 时链路更长，成本与等待时间上升。
- 设置保存接口未额外清洗原始 JSON；读取时 normalize，行为安全但不满足“库里绝不存脏值”的严格口径。
- 多端设置不做实时推送，其他客户端刷新后生效。

## 追加：不限制开关 + UI 压扁修复（2026-11-18 14:30）

| 项 | 命令 | 结果 |
| --- | --- | --- |
| 派发深度（含 resolve） | `bun test dispatchLimits.test.ts` | 6 pass |
| 路由 schema（上限 1000） | `bun test dispatchDepthSchema.test.ts` | 2 pass |
| sendToAgent（深度 100 / 上限 1000） | `bun test sendToAgent.test.ts` | 6 pass |
| 服务端全量 | `cd apps/server && bun test` | 161 pass / 0 fail |
| dispatcher（含 1000 不被压回 32） | `cd apps/web && bun test agentDispatcher.test.ts` | 19 pass |
| 构建与部署 | `build:web`、`build:desktop` | 成功；入口 17,856,983 B，视图入口 `assets/index-C5Hgbyby.js`，备份 `20261118-143005` |

追加验收：

| # | 场景 | 预期 |
| --- | --- | --- |
| 6 | 开启「不限制任务链深度」并保存 | 数字输入禁用、警告框完整显示；派发超过 32 跳不被路由拦截 |
| 7 | 关闭开关并保存 | 恢复按数字输入的上限（1–32）执行 |
| 8 | 开发者页内容超过面板高度 | 出现滚动条，警告框不再被压成半行 |
