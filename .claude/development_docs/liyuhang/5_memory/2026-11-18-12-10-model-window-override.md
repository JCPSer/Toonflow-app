# START 记忆：模型窗口用户配置优先，自动压缩不再触发过晚

- 时间：2026-11-18 12:10
- 关联：`4_bugs_fix/bug_analysis-2026-11-18-11-59-model-window-override.md`、`bug_solution-2026-11-18-12-02-model-window-override.md`、`3_test_results/2026-11-18-12-10-model-window-override.md`

## Situation
长会话在 50 万 token 左右被模型判定「上下文用尽」，Agent 拒绝继续读图核对；实际自动压缩没有在真实上限前触发。用户已在供应商里把 OpenCode-DP / deepseek-v4.1-flash 的窗口填成 512000，但被硬编码表 1048576 覆盖。

## Task
让用户显式填写的窗口/输出上限真正生效，压缩阈值与 UI 百分比使用同一口径，同时不改变未配置用户的行为。

## Action
1. 新增 `modelLimits.ts` 纯函数：窗口与输出上限按字段独立解析，顺序为「用户值 → 硬编码表 → Pi 内置目录共识值 → 兜底」，供应商比较不区分大小写。
2. `getModelLimits` 改为调用纯函数；`modelContextLimits.ts` 注释改为「仅默认值」。
3. `preferences.ts` 的 `keepRecentTokens` 追加 `- floor(0.8×reserve)`，避免保留 + 摘要预算超过压缩阈值。
4. `AgentContext` 增加 `compactPercent`，`getAgentContext` 接收 `maxOutputTokens` 并用同一 reserve 公式计算；`conversation.vue` 横幅优先用它。
5. 单测：模型窗口 12 例、压缩策略 9 例；服务端全量 151 pass，typecheck 通过，web 构建通过。

## Result
- 512k 窗口 + 393k 输出上限：reserve 封顶 256k，压缩在约 25.6 万触发；UI 分母同步为 512000。
- 未填写窗口的模型行为不变。
- 已构建 `build:desktop`，按内层 tar 提取入口（17.86MB、含 BrowserWindow）覆盖 `app/bun/index.js`，同步 `views/mainview`，备份后缀 `20261118-120847`；未重启，由用户退出重开。
- 已知：输出上限留空时有效压缩点固定 50%（表值参与 reserve）；用户填过大的窗口仍会晚压缩。
