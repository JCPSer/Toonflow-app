# 测试记录：Agent 面板层叠 + 打开贴最新消息

- 时间：2026-11-16 16:24
- 变更：`apps/web/src/pages/workspace/panels/canvas/index.vue`（面板移出 `<vue-flow>`、`.canvas` 加 `isolation:isolate`）、`apps/web/src/components/agent/conversation/messageList.vue`（共享滚动 epoch + `scrollToLatest` 收敛、移除偏移恢复）

## 自动化

| 项 | 命令 | 结果 |
| --- | --- | --- |
| 画布单测（含 dispatcher/links/roles 相关） | `cd apps/web && bun test src/pages/workspace/panels/canvas` | 75 pass / 0 fail |
| 类型检查 | `bun run --filter '@toonflow/web' typecheck` | 仅既有基线错误 `@/agentRuntime`（server 侧历史问题），本次文件无新增 |
| 构建 | `bun run --filter '@toonflow/web' build` | 成功（3.99s），已同步至 `/Applications/toonflow-exec.app/Contents/Resources/app/views/mainview`（原目录已备份 `.bak-20261116-162359`） |

说明：`scrollToLatest` 依赖 DOM/虚拟器，无组件测试设施；评审建议的 mock 虚拟器测试未落地，以手工矩阵为准。

## 手工矩阵（待用户重启应用后验收）

| # | 场景 | 预期 |
| --- | --- | --- |
| 1 | 面板下方放图片节点，反复开关面板 | 面板始终完整可见，不被节点覆盖 |
| 2 | 打开「画布合成优化」后再重复 1 | 同上 |
| 3 | 画布缩放到 0.2 / 1 / 8 后打开面板 | 面板位置正确，不被节点覆盖，文字清晰 |
| 4 | 面板贴画布四边 | 面板仍完整可见，不越出画布盖住切换器/工具条 |
| 5 | 打开含图片/工具卡片的长对话 | 停在最后一条消息 |
| 6 | 点右下角「回到最新消息」 | 停在最后一条消息 |
| 7 | 打开后立刻滚轮上翻 | 不被打断后拉回底部 |
| 8 | 打开后立刻点右侧轮次目录 | 跳转到目标轮次，不被贴底抢回 |
| 9 | 打开含异步加载图片的对话，等图片加载完 | 不因图片加载被甩离底部（如仍出现，记录以便补钉） |
| 10 | 切到其他画布再切回 | 按用户选择回到最新消息 |
| 11 | 主 Agent 面板（非画布节点）打开 | 同样回到最新消息 |
| 12 | 面板打开时按 PageUp/Home | 立即接管滚动，不被程序化滚动拉回 |

## 已知未覆盖
- WKWebView 合成层行为无法在单测/浏览器自动化中复现，B1 只能靠真实桌面端手工验收。
