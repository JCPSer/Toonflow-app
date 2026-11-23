# 测试记录：模型窗口用户配置优先 + 压缩阈值修正

- 时间：2026-11-18 12:10
- 变更：`modelLimits.ts`（新）、`mediaGeneration/ai/index.ts`、`modelContextLimits.ts` 注释、`preferences.ts`（摘要预算约束）、`sessions.ts` / `runtime/index.ts`（有效压缩阈值）、`conversation.vue`（横幅阈值）、两个测试文件

## 自动化

| 项 | 命令 | 结果 |
| --- | --- | --- |
| 模型窗口单测 | `cd apps/server && bun test src/modules/mediaGeneration/ai/modelLimits.test.ts` | 12 pass / 0 fail |
| 压缩策略单测 | `cd apps/server && bun test src/agent/runtime/preferences.test.ts` | 9 pass / 0 fail |
| 服务端全量单测 | `cd apps/server && bun test` | 151 pass / 0 fail |
| 服务端类型检查 | `bun run --filter '@toonflow/server' typecheck` | 通过 |
| Web 类型检查 | `bun run --filter '@toonflow/web' typecheck` | 仅既有 `@/agentRuntime` 基线错误 |
| Web 构建 | `bun run --filter '@toonflow/web' build` | 成功 |
| 桌面构建 | `bun run build:desktop` | 成功 |

## 关键断言

- `resolveModelLimits("OpenCode-DP", { id: "deepseek-v4.1-flash", contextWindow: 512000 }, [])` → `{ contextWindow: 512000, maxTokens: 393216 }`。
- 未填窗口 → 硬编码表 `1048576 / 393216`，行为与旧版一致。
- 只填一个字段：另一字段独立回落（用户窗口 + 表输出、用户输出 + 表窗口）。
- 表未命中：精确供应商优先；无精确时仅在同 id 参数完全一致才采用；不一致回落 `262144 / 32768`。
- `0 / 负数 / NaN / Infinity / null` 视为未填。
- `compactReserveTokens(512000, 393216, 50/80/95)` 均为 `256000` → 压缩触发点 256k（窗口 50%）。
- 保留量 + reserve + 0.8×reserve 在 64k–1M、50/80 百分比下均小于窗口。

## 部署

| 项 | 内容 |
| --- | --- |
| 桌面入口 | `build/desktop` 内层 `2oa5cp21r5rhx.tar.zst` → `app/bun/index.js`（17,856,500 B，含 `BrowserWindow`） |
| Web 视图 | `build/web/` → `Resources/app/views/mainview`，入口 `assets/index-CPv9D42K.js` |
| 备份后缀 | `20261118-120847`（入口与视图各自备份） |
| 重启 | 未重启，由用户退出重开 |

## 手工验收矩阵（待用户重启）

| # | 场景 | 预期 |
| --- | --- | --- |
| 1 | 黑木项目（OpenCode-DP / deepseek-v4.1-flash）打开 Agent 面板 | 上下文分母显示 512,000，不再是 1,048,576 |
| 2 | 继续一段长会话到约 25.6 万 | 触发自动压缩，界面出现压缩状态，而不是等到 50 万 |
| 3 | 压缩完成后的保留量 | 约 4.9 万 tokens（受摘要预算约束），不会压完立刻再压 |
| 4 | 面板顶部阈值文案 | 显示有效阈值 50%，与设置里的百分比不一致时以服务端为准 |
| 5 | 其它未配置窗口的模型 | 行为与旧版一致，不出现窗口跳变 |

## 已知风险

- 用户把窗口填得比线路真实上限更大时，压缩仍会偏晚；本轮不做自动探测。
- 只填窗口、不填输出上限时，表内 393k 输出上限会让有效压缩点固定在 50%，想按更高百分比压缩需填写实际输出上限。
- `subAgent.ts` 的 128000 兜底未改；正常委派路径都使用修正后的模型窗口。
