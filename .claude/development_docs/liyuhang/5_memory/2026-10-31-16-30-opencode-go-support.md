# 适配 OpenCode Go（Zen API）作为自定义模型供应商

- 时间：2026-10-31 16:30
- 涉及文件：`apps/server/src/modules/mediaGeneration/ai/opencode.ts`、`ai/index.ts`、`ai/models.ts`、`routes/ai/generate.ts`

## STAR

**Situation**
OpenCode Go（`https://opencode.ai/zen/go/v1`）自 2026-09 起强制要求 `x-opencode-session` 等标识头，Toonflow 自定义供应商只发 `Authorization`，直接接入会 `400 MissingSessionID`。用户要求不做通用请求头配置，只把 OpenCode Go 适配好。

**Task**
在零配置前提下，让 agent 对话、节点生成、拉取模型列表三条链路都能正常调用 OpenCode Go，且其他供应商行为不变。

**Action**
1. 读 SDK 源码确认：pi-coding-agent 0.85.1 只在 `provider` 为 `opencode`/`opencode-go` 或 baseUrl 主机名为 `opencode.ai` 时注入会话头，且只在 Agent 的 `streamFn` 内生效（`provider-attribution.js:50-59`、`sdk.js:201`）。
2. 新增 `opencode.ts`：`isOpenCodeApi` 按 hostname 判定（去根域尾点），`openCodeRequestHeaders` 产出 `x-opencode-session`（uuidv7，与 SDK 一致）与 `x-opencode-client: pi`，永不输出鉴权头。
3. `streamAi` 增加可选 `sessionId` 并传 `headers`；`/api/ai/generate` 把前端 `runId` 作为会话 ID，实现同一生成任务内多轮亲和；`fetchProviderModels` 自动合并头，保证弹窗能拉模型。
4. Agent 链路未改代码（SDK 已注入），列入真机验收。
5. 单测只测纯函数（不引入 `@/` 别名，避免仓库根 `bun test` 失败）；注入行为用 `scripts/verify-opencode-headers.ts` mock fetch 捕获请求头验证。

**Result**
- 仓库根 `bun test`：109 pass；服务端：91 pass；typecheck 通过。
- 注入脚本 6 项全 PASS（含 anthropic 分支、随机兜底、非 OpenCode 不发头、鉴权头不被覆盖）。
- 桌面入口重新打包（+303 B）并安装，md5 一致；未重启应用。

## 教训

- 先读依赖包的注入逻辑，再决定改哪里：Agent 链路白改一遍毫无收益，真正缺的只有节点生成与模型列表两个入口。
- 与 SDK 同一语义的值（会话 ID）要连**格式**一起对齐（uuidv7、无前缀），否则同一供应商在大历史/缓存路由上可能出现「对话能用、节点不能用」的割裂现象。
- 单测放在带 `@/` 别名依赖的模块上，会悄悄破坏仓库根目录的 `bun test`；纯函数单测 + 独立验证脚本能两头兼顾。

## 关联

- 需求/方案/测试：`1_requirements_matrix/2026-10-31-16-30-opencode-go-support.md`、`2_requirements_solutions/2026-10-31-16-30-opencode-go-support.md`、`3_test_results/2026-10-31-16-30-opencode-go-support.md`。
