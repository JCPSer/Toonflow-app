# 需求方案：支持 OpenCode Go（Zen API）作为自定义模型供应商（v2，已按初审修订）

- 时间：2026-10-31 16:30（v2 17:00 修订）
- 对应需求：`1_requirements_matrix/2026-10-31-16-30-opencode-go-support.md`
- 状态：待用户评审

## 一、现状核查（决定方案的前提）

| 事实 | 证据 |
| --- | --- |
| 自定义供应商请求默认只带 `Authorization`（以及 pi 的 UA），没有会话头 | `modules/mediaGeneration/ai/models.ts:12-20`；`streamAi` 只传 `apiKey` |
| pi SDK 已内置 OpenCode 头注入 | `pi-coding-agent@0.85.1/dist/core/provider-attribution.js:50-59` |
| 注入条件（三选一） | `model.provider === "opencode"`、`=== "opencode-go"`、或 `hostname === "opencode.ai"`；**不是前缀通配** |
| 该注入只在 SDK 的 `streamFn` 内生效 | `dist/core/sdk.js:201`，经 `transformHeaders` 合并；要求 `options.sessionId` 非空 |
| Agent 会话确实传了 sessionId（UUIDv7，无前缀） | `sdk.js:226`、`pi-agent-core/dist/agent.js:293`、`session-manager.js:12-14` |
| 节点生成完全不走 SDK 注入 | `modules/mediaGeneration/ai/index.ts:209` 直接调 `aiApis[protocol].streamSimple(...)`，`model.provider` 写死 `"toonflow"` |
| 流式请求支持自定义头，且调用方最后合并 | `pi-ai/dist/types.d.ts:78-86`；`api/openai-completions.js:569-571`「Merge options headers last」 |
| 文件上传路径不吃自定义头 | `files.ts:69` 上传请求只写 `authorization`；且 `opencode.ai` 不命中任何文件适配器（`files.ts:143-146` 直接透传，不会上传） |

结论：
- **Agent 对话链路已经能自动带上头**（域名命中 + sessionId 具备），代码不改，但必须实机验证。
- **节点生成、获取模型列表两条链路必须补**。

## 二、方案总览

| 子需求 | 方案 |
| --- | --- |
| R1 识别 | 新增 `isOpenCodeApi(apiUrl)`：`hostname === "opencode.ai"`，与 SDK 的 host 分支口径一致（不复制 SDK 按 provider id 命中的分支，见 §四） |
| R2 Agent 对话 | 不改代码；实机验证一次。若失败，再在 `agent/runtime/requests.ts` 的 stream options 里显式覆盖会话头 |
| R3 节点生成 | `streamAi` 在命中时把 `x-opencode-session` / `x-opencode-client` 放进 `streamSimple` 的 `headers` |
| R4 获取模型列表 | `fetchProviderModels` 内部按 `apiUrl` 自动加同样的头 |
| R5 不加 UI/不加字段 | 全自动判定，配置结构零变更 |
| R6 会话 ID | 与 SDK 保持一致：**裸 UUID，不加 `ses_` 前缀**。优先用调用方已有的 `runId`（同一生成任务内多轮稳定），缺省时每次请求随机 UUID |

## 三、详细设计

### 3.1 新增模块

`apps/server/src/modules/mediaGeneration/ai/opencode.ts`：

```
const OPEN_CODE_HOST = "opencode.ai"

isOpenCodeApi(apiUrl): boolean            // 纯函数
  try: return new URL(apiUrl).hostname === OPEN_CODE_HOST
  catch: return false

openCodeRequestHeaders(apiUrl, sessionId?): Record<string,string> | undefined
  if (!isOpenCodeApi(apiUrl)) return undefined
  return {
    "x-opencode-session": sessionId ?? randomUUID(),
    "x-opencode-client": "pi",
  }
```

约束：
- helper **永不输出 `Authorization` / `x-api-key`**，避免覆盖 pi-ai 用 apiKey 生成的鉴权头。
- `x-opencode-client` 取 `pi`，与 SDK 既有行为一致，不伪装官方 CLI。
- 会话 ID 格式与 SDK 一致（UUIDv7 无前缀），不自定义 `ses_` 前缀，规避网关格式校验风险。

### 3.2 节点生成链路

```
// routes/ai/generate.ts
streamAi(configured, context, controller.signal, references, { sessionId: runId })

// ai/index.ts streamAi
const headers = openCodeRequestHeaders(baseUrl, options?.sessionId)
aiApis[protocol].streamSimple(model, context, { apiKey, signal, fetch: files.fetch, headers, onPayload })
```

- `runId` 是现有可选字段（`routes/ai/generate.ts:60`），文本节点等已传；带 tools 的多轮循环因此共享同一个会话 ID。
- 未传 `runId` 的节点（如 `director3dNode`）每次 HTTP 请求各自随机，跨轮无缓存亲和——已知限制，写进风险表。
- 主请求头由 pi-ai 适配器写入 `init.headers`，`createFileTransport` 只透传；文件上传路径不经过该包装，且 opencode.ai 不命中适配器，当前不涉及。

### 3.3 获取模型列表

```
headers = { Accept: "application/json", ...(openCodeRequestHeaders(apiUrl) ?? {}) }
```

- 自定义供应商的模型列表只能从「新增/编辑供应商」弹窗拉取（`addCustomProviderDialog.vue:294`）；设置页的刷新按钮只服务 tfRouter（`languageModel/index.vue:36`），保存设置时也不会刷新非 tfRouter 供应商（`initialize.ts:13-24`）。文档与验收按此口径。

### 3.4 Agent 对话链路（不改代码，待实测）

链路：`createAgentModel` 注册 `baseUrl` → SDK `matchesHost` 命中 → `transformHeaders` 合并会话头。sessionId 为会话文件对应的 UUIDv7，非空。

- 验证：应用内真实对话一次，服务端无 `MissingSessionID`。
- 兜底（若实测失败）：在 `agent/runtime/requests.ts:307-310` 的 stream options 里显式传 `headers`（调用方最后合并，优先级最高）。

### 3.5 UI

无改动。

## 四、边界与已知限制

| 场景 | 行为 |
| --- | --- |
| 免费额度账号 | 网关还校验 User-Agent 指纹，本方案不伪造 UA，可能仍 403（用户确认使用付费密钥） |
| 用户把供应商 id 取名 `opencode-go` 但地址指向中转站 | Agent 链路会按 SDK 规则发头，节点链路不发（只看域名）。重复发头无害，判定差异写入文档 |
| 地址填 `https://opencode.ai`（无路径） | 现有逻辑补 `/v1`，与实际路由不符；应填 `/zen/go/v1` |
| 其他中转站转发 OpenCode | 不触发注入，符合「只适配 OpenCode Go」范围 |
| 带 tools 且未传 runId 的节点 | 每轮一个随机会话 ID，丢失跨轮缓存亲和，功能不受影响 |
| 未来 Zen 新增必填头 | 只改 `openCodeRequestHeaders` 一处 |

## 五、改动清单

| 文件 | 改动 |
| --- | --- |
| `apps/server/src/modules/mediaGeneration/ai/opencode.ts` | 新增（识别 + 头构造） |
| `apps/server/src/modules/mediaGeneration/ai/opencode.test.ts` | 新增（纯函数 + 头注入单测） |
| `apps/server/src/modules/mediaGeneration/ai/index.ts` | `streamAi` 支持可选 `sessionId` 并传 `headers` |
| `apps/server/src/modules/mediaGeneration/ai/models.ts` | `fetchProviderModels` 合并头 |
| `apps/server/src/routes/ai/generate.ts` | 把 `runId` 作为 `sessionId` 传给 `streamAi` |
| `apps/server/src/agent/runtime/model.ts` / `requests.ts` | 仅实测失败时兜底 |

不改前端、不改配置结构、不改媒体供应商。

## 六、测试计划

| 项 | 方法 | 期望 |
| --- | --- | --- |
| 纯函数 / 头构造 | `bun run --cwd apps/server test`（单测不依赖 `@/` 别名，仓库根 `bun test` 也不会失败） | 域名判定、空白裁剪、空串退回 uuidv7、非 OpenCode 不注入 |
| 模型列表 / 节点生成注入 | `bun --cwd apps/server scripts/verify-opencode-headers.ts`（mock fetch 捕获请求头） | 两类协议头齐全、Authorization / x-api-key 不被覆盖、非 OpenCode 不发头 |
| 真实服务 | 用付费 Key 调 `/models` 与一次补全 | 无 `MissingSessionID` |
| Agent 实测 | 应用内 agent 面板真实对话一次 | 无 `MissingSessionID`；若失败按 §3.4 兜底 |
| 回归 | `bun test`（仓库根）+ `bun run --cwd apps/server typecheck` | 全部通过；非 opencode 地址请求头不变 |

## 七、风险

| 风险 | 等级 | 处理 |
| --- | --- | --- |
| SDK 实际未注入（与源码阅读不一致） | 中 | 实测验证，失败走 §3.4 |
| 网关校验会话 ID 前缀 | 低 | 采用与 SDK 相同的裸 UUID，与官方 pi 客户端一致 |
| 依赖 SDK 内部行为（0.85.1） | 中 | 文档记录版本；升级 SDK 后回归 agent 实测 |
| 多轮节点无会话亲和 | 低 | 有 runId 的节点已共享；其余每轮独立 |

## 八、评审意见

| 评审人 | 结论 | 意见 |
| --- | --- | --- |
| 子 agent 初评 | 有条件通过 | 指出：会话 ID 格式不一致（已改为与 SDK 相同的 uuidv7）、SDK 判定非通配（已改）、files.ts 上传头说法错误（已改）、R4 应提为 P0（已改）、缺少 Agent 实测与工具节点验收（已补） |
| 子 agent 代码审查 | 无阻塞 | 会话 ID 由 v4 改 v7；空串/空白改为退回随机；根目录 `bun test` 失败已修复（集成断言移到 `scripts/verify-opencode-headers.ts`，单测不依赖别名）；补 anthropic 分支、尾点域名、随机兜底用例 |
| 用户 | 已确认按方案实施 | 2026-10-31 17:00 |
