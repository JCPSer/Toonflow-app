# 测试结果：Agent 思考死循环导致界面卡死

- 时间：2026-11-15 19:10
- 对应方案：`bug_solution-2026-11-15-19-02-agent-thinking-loop-freeze.md`

## 1. 取证数据

| 项 | 数据 |
| --- | --- |
| 问题会话 | `2026-11-11T10-13-13-873Z_6840bcd6-...jsonl`（9.4 MB） |
| 问题条目 | `7512b886` thinking 86,010 字符，「写。」20,513 次；`30eb2886` 29,548 字符、6,594 次 |
| 重复总量 | 该会话「写。」33,258 次，除 55 次工具结果外全部在 thinking |
| 解析基准 | `@markmend/ast` 解析 86 KB 重复文本约 **127 ms/次**（Bun 实测） |
| 刷新频率 | 旧实现 50 ms/次 ≈ 20 次/秒 → 每秒约 2.5 秒 CPU，主线程饱和 |

## 2. 单元测试

`apps/server/src/agent/runtime/outputLoopGuard.test.ts`（8 例）：

| 用例 | 结果 |
| --- | --- |
| 重复「写。」判定循环 | 通过 |
| 重复英文短句判定循环 | 通过 |
| 同一长句反复 140 行判定循环 | 通过 |
| 正常中文长文不误判 | 通过 |
| 正常英文长文不误判 | 通过 |
| 单块 >150,000 字符停止 | 通过 |
| 不同 block 独立计数 | 通过 |
| countUniqueGrams / isRepeatedLineLoop 边界 | 通过 |

```text
bun test src/agent/runtime/outputLoopGuard.test.ts
8 pass / 0 fail / 11 expect()
```

服务端全量：**122 pass / 0 fail / 690 expect() / 12 files**。

## 3. 流式降频与折叠（模拟）

用真实 `createReplyStream` 模拟逐 token 灌入：

```text
30,000 次 delta（60,000 字符）→ 1.2 秒内完成；
thinking 达到 32 KB 后 collapsed=true；finish 后仍保持折叠；
无异常抛出。
```

## 4. 类型检查与构建

| 项 | 结果 |
| --- | --- |
| `apps/server` tsc | 通过 |
| `apps/web` vue-tsc | 仅剩既有报错 `@/agentRuntime`（与本改动无关） |
| web build | 成功 |
| server standalone | 成功，产物含 `150000` 与「陷入循环」文案 |
| desktop build | 成功，负载内 `app/bun/index.js`、`views/mainview/assets` 均含新逻辑 |

## 5. 部署

- 备份后更新 `Resources/app/bun/index.js`（含服务端守卫）与 `Resources/app/views/mainview`（含前端降频/折叠）。
- 保留 `version.json` 与 `data/nodes`，未触发内置节点同步。
- 未重启应用。

## 6. 待人工验证

- 真实模型陷入重复时，界面保持可点击，并显示「模型输出陷入循环，已自动停止」。
- 正常长思考（<32 KB）仍流畅展开；超过后自动折叠，可手动展开。
- 停止按钮在长内容流式期间仍可点击。

## 7. 评审后修复（P1/P2）

| 问题 | 处理 |
| --- | --- |
| P1 临时对话入口无防护 | `singleAgent/index.ts` 接入同一 OutputLoopGuard；命中后停止转发、abort，catch 用命中原因覆盖 AbortError |
| P1 命中后仍重发全文 | 两个入口的 `text_end`/`thinking_end` 命中后只发 done；`message_end` 跳过 text/thinking 全文 |
| P2 漏检长句/stanza | 增加 8-gram 最大出现次数 ≥64；连续两次检查命中才算循环 |
| P2 合法重复误判 | 两次检查机制（单次重复表格/占位 JSON 不中止）；持续重复仍中止，作为保守取舍写入用例 |
| P2 自动折叠覆盖手动展开 | replyStream 用 WeakSet 只自动折叠一次；finishThinking 不再强制折回 |
| P2 延迟估算偏差 | 自适应延迟按 pending 总字符数计算 |
| P2 文案硬编码 | guard 返回 `loop` / `too-large`，两个入口用 i18n 翻译；21 个语言文件补齐词条 |
| P1 singleAgentDialog 忽略折叠 | `details` 绑定 `part.collapsed`，折叠时不挂载 messageMarkdown |

复测：

```text
bun test（apps/server）：127 pass / 0 fail / 699 expect
bun run typecheck（apps/server）：通过
web typecheck：仅既有 @/agentRuntime 基线错误
模拟 60K thinking：自动折叠恰好 1 次，用户展开后不再折回，finish 无增量丢失
```
