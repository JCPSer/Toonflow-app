# 需求矩阵：支持 OpenCode Go（Zen API）作为自定义模型供应商

- 时间：2026-10-31 16:30
- 提出人：用户
- 状态：待评审

## 一、需求背景

OpenCode Go（opencode.ai 的 Zen API，`https://opencode.ai/zen/go/v1`）自 2026-09-05/06 起强制要求请求携带会话标识头，缺失会直接返回：

```
400 {"type":"error","error":{"type":"MissingSessionID","message":"Request is missing x-opencode-session ..."}}
```

Toonflow 的「自定义供应商」只会发送 `Authorization: Bearer <apiKey>`（`apps/server/src/modules/mediaGeneration/ai/models.ts:12`），因此填入 OpenCode Go 的地址和密钥后无法直接使用。用户希望**不做通用请求头配置**，只把 OpenCode Go 这一个服务适配好。

## 二、需求目标

在设置里新增一个自定义供应商，地址填 `https://opencode.ai/zen/go/v1`、协议选 `openai-completions`、密钥填付费 Zen Key，即可在 Toonflow 内正常对话与生成，不需要额外配置。

## 三、需求矩阵

| 编号 | 需求描述 | 优先级 | 难度 | 风险 |
| --- | --- | --- | --- | --- |
| R1 | 识别能力：供应商 `apiUrl` 主机名为 `opencode.ai` 时判定为 OpenCode，其他地址行为零变化 | P0 | 低 | 低 |
| R2 | Agent 对话链路（agent 面板）请求自动携带 `x-opencode-session` 与会话一致 | P0 | 低 | 中（依赖 SDK 是否已注入） |
| R3 | 节点生成链路（AI 文本/图片参考走 `/api/ai/generate`）请求自动携带同样的头 | P0 | 低 | 中（当前完全没有注入点） |
| R4 | 「获取模型列表」（新增/编辑供应商弹窗的 `/api/providers/models`）请求自动携带同样的头，保证能拉到模型 | P0 | 低 | 低 |
| R5 | 不新增任何 UI 配置项、不新增持久化字段；密钥展示与日志沿用现有 `apiKey` 的脱敏规则 | P0 | 低 | 低 |
| R6 | 会话 ID 语义合理：同一 agent 对话内稳定；节点生成在同一次任务（有 runId）内稳定，其余每次请求独立 | P1 | 低 | 低 |
| R7 | 不伪造 User-Agent、不绕过免费额度限制；免费额度账号若被 Cloudflare 403 属已知边界 | — | — | 中 |

### 非目标

- 不做通用「自定义请求头」配置（用户明确否决）。
- 不改媒体供应商（tfRouter / apiMart / metaso / compshare）。
- 不支持免费额度账号的 UA 指纹要求。
- 不支持 OpenCode 的 OAuth 登录，仍按 API Key 方式接。

## 四、验收标准

1. 设置里添加 `https://opencode.ai/zen/go/v1` 供应商，在弹窗里点获取模型能拉到模型列表。
2. 在 agent 面板选择该供应商的模型，可正常进行一轮对话，无 `MissingSessionID`。
3. 画布节点里选择该模型生成，可正常返回结果，无 `MissingSessionID`；带工具的多轮节点不因缺头中断。
4. 原有其他供应商（如本地 8787 代理、DeepSeek、OpenRouter）请求头集合与行为不变。
5. `bun run --cwd apps/server typecheck` 与既有 `bun test` 通过。

## 五、风险与待确认

| 风险 | 说明 | 应对 |
| --- | --- | --- |
| 付费 Key 之外的额外校验 | Zen 可能还有项目头 / 请求头要求 | 先按官方最小要求实现，真机联调时按错误码补齐 |
| SDK 自动注入是否生效 | 当前 SDK 版本按 baseUrl 域名自动加头，但依赖会话 ID 传入 | 方案阶段实机验证；不成立则在应用层显式注入 |
| 会话 ID 生成规则 | 节点生成没有「会话」概念 | 每次调用生成新的 `ses_` 前缀 ID |

## 六、评审意见

| 评审人 | 结论 | 意见 |
| --- | --- | --- |
| 子 agent 初评 | 建议修订后通过 | R4 应由 P1 提到 P0（弹窗拉模型是准入门槛）；R6「同一对话稳定」在带工具节点上不成立，已按「有 runId 则稳定、否则每次独立」改写 |
| 用户 | 待填 | |
