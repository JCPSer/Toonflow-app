# 测试结果：OpenCode Go（Zen API）供应商适配

- 时间：2026-10-31 16:30（实施/测试 18:50）
- 对应方案：`2_requirements_solutions/2026-10-31-16-30-opencode-go-support.md`
- 环境：macOS 14.6 arm64 / Bun 1.3.11 / 安装版 `/Applications/toonflow-exec.app`

## 1. 改动回顾

| 文件 | 内容 |
| --- | --- |
| `apps/server/src/modules/mediaGeneration/ai/opencode.ts` | 新增：域名判定 + `x-opencode-session` / `x-opencode-client` 构造（uuidv7） |
| `apps/server/src/modules/mediaGeneration/ai/index.ts` | `streamAi` 支持可选 `sessionId`，并把头传给 `streamSimple` |
| `apps/server/src/modules/mediaGeneration/ai/models.ts` | `fetchProviderModels` 自动合并 OpenCode 头 |
| `apps/server/src/routes/ai/generate.ts` | 把前端 `runId` 作为会话 ID 传入 |
| `apps/server/src/modules/mediaGeneration/ai/opencode.test.ts` | 新增单测（纯函数，无别名依赖） |
| `apps/server/scripts/verify-opencode-headers.ts` | 新增请求头注入验证脚本 |
| `apps/server/package.json` | 新增 `test` 脚本 |

## 2. 自动化测试

| 项 | 命令 | 结果 |
| --- | --- | --- |
| 仓库根测试（验证不破坏既有命令） | `bun test` | **109 pass / 0 fail** |
| 服务端测试（含新增单测） | `bun run --cwd apps/server test` | **91 pass / 0 fail** |
| 类型检查 | `bun run --cwd apps/server typecheck` | 通过 |
| 请求头注入验证 | `bun --cwd apps/server scripts/verify-opencode-headers.ts` | 6 项全部 PASS（见 §3） |

单测覆盖：
- 域名判定：`opencode.ai`、大写、带端口、带路径/查询、根域尾点命中；`opencode.ai.evil.com`、`api.opencode.ai`、`notopencode.ai`、`127.0.0.1:8787`、非法 URL 不命中。
- 头构造：非 OpenCode 返回 `undefined`；只产出 session + client；会话 ID 前后空白被裁掉；空串/空白/缺省退回 uuidv7；两次随机不同。

## 3. 请求头注入验证脚本（mock fetch 捕获实际发出的头）

| # | 场景 | 断言 | 结果 |
| --- | --- | --- | --- |
| 1 | `fetchProviderModels` + openai-completions | 带 session（uuid 格式）与 client=pi；`Authorization: Bearer sk-test` 未被覆盖 | PASS |
| 2 | `fetchProviderModels` + anthropic-messages | `x-api-key` 与 `anthropic-version` 保留，OpenCode 头共存，无 Authorization | PASS |
| 3 | 其他供应商（DeepSeek）拉模型 | 不发 OpenCode 头 | PASS |
| 4 | `streamAi` 传 `sessionId: run-123` | 头中原样为 `run-123`，Authorization 不变 | PASS |
| 5 | `streamAi` 未传 sessionId（连续两次） | 每次随机且不同 | PASS |
| 6 | `streamAi` + 其他供应商 | 不发 OpenCode 头 | PASS |

说明：脚本先把 `TOONFLOW_DATA_DIR` 指到临时目录再动态加载服务端模块，不读写真实 `settings.json`，结束后删除临时目录。

## 4. 静态核查（Agent 链路依赖 SDK 行为）

| 事实 | 证据 |
| --- | --- |
| SDK 按域名自动注入 | `pi-coding-agent@0.85.1/dist/core/provider-attribution.js:50-59` |
| 会话 ID 来自会话文件（uuidv7） | `sdk.js:226`、`pi-agent-core/dist/agent.js:293`、`session-manager.js:12-14` |
| Toonflow 包装未丢 sessionId | `agent/runtime/requests.ts:307-310` 展开 `...options` |
| 所有 Agent 入口都走同一注册点 | `createAgentModel`（`runtime/index.ts:100`、`sessions.ts:180`、`a2a/index.ts:44`、`singleAgent`） |

**Agent 链路未改代码，等待真机验证**（需用户重启应用并配置付费 Key）。

## 5. 构建与部署

| 项 | 结果 |
| --- | --- |
| `bun scripts/bundle-desktop.ts` | 通过，`build/desktop/main/index.js` 23,620,700 B（原 23,620,397 B，+303 B） |
| 产物核对 | 含 `x-opencode-client` / `x-opencode-session` 各 2 处 |
| `scripts/deploy-local.sh` | 完成；已安装到 `/Applications/toonflow-exec.app/Contents/Resources/app/bun/index.js` |
| 校验 | md5 两侧一致：`d63a93033585a4b0da17d3b35e13003e` |
| 应用状态 | **未重启**（遵守用户要求） |

## 6. 待人工复验

1. 重启应用 → 设置 → 语言模型 → 添加自定义供应商：
   - 地址 `https://opencode.ai/zen/go/v1`
   - 协议 `openai-completions`
   - 密钥填付费 Zen Key
   - 点「获取模型」，应能拉到列表（此前可能 400/401）。
2. Agent 面板选该模型对话一次，不应出现 `MissingSessionID`（Agent 头由 SDK 注入，属首次真机验证）。
3. 画布节点选该模型生成一次，不应出现 `MissingSessionID`。
4. 免费额度账号仍可能被 Cloudflare 403（UA 指纹），属已知边界。

## 7. 已知未覆盖

- 真实付费 Key 的端到端调用（用户自行配置后验证）。
- 带工具的多轮节点在 OpenCode 下的会话亲和（有 runId 时共享，无 runId 时每轮独立）。
