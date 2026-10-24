# 测试结果：Agent 面板「工具后假死」修复

环境：macOS arm64 / Bun 1.3.11 / 源码 `Toonflow-app`
服务端：`NODE_ENV=dev TOONFLOW_DATA_DIR=/tmp/tf-stall/data TOONFLOW_SERVER_PORT=3117 bun src/index.ts`
假上游：`bun /tmp/tf-stall/fake.ts`（127.0.0.1:3999，OpenAI 兼容 SSE，可切换「首次请求挂起 / 先吐字再挂起 / 慢速吐字」）
测试配置：`settings.agent = { requestTimeoutMs: 3000, idleTimeoutMs: 3000, requestHardLimitMs: 60000 }`（把 180s/120s 压到 3s 便于验证）
工作区：`/tmp/tf-stall/project`

## 一、类型检查与构建

| 项 | 命令 | 结果 |
| --- | --- | --- |
| apps/server | `bun run typecheck`（tsc） | 通过 |
| apps/web | `bun run typecheck`（vue-tsc） | 通过 |
| 服务端打包 | `bun build src/index.ts --target=bun --minify ...` | 通过，23.17 MB |
| 前端构建 | `apps/web bun run build` | 通过 |

## 二、服务端行为（NDJSON 实测）

| # | 用例 | 实际 | 结论 |
| --- | --- | --- | --- |
| 1 | 假上游第 1 次请求永不响应 | 3 秒后发出 `{"type":"retry","attempt":1,"maxAttempts":2,"delayMs":2000,"errorMessage":"模型服务 3 秒无响应，已触发自动重试 [timeout]"}`；2 秒后第二次请求返回，输出 `收到，任务已完成。` 并 `done`，整轮 5.26s | 通过 |
| 2 | 假上游先吐「我在」再挂起 | 3 秒空闲后 `{"type":"error","message":"等待模型响应超时（3 秒无新内容），已保留已生成内容"}`；上游只被调用 1 次（未重试），已输出文本保留 | 通过 |
| 3 | 假上游每 500ms 吐一个字、共 20 秒 | `requestHardLimitMs=5000` 时 5 秒触发，`{"type":"error","message":"等待模型响应超时（5 秒无新内容），已保留已生成内容"}`，保留已输出内容 | 通过（硬上限文案此轮修正为「本次回复超过 N 秒上限」） |
| 4 | 用户主动停止 | 未改动该路径，仍走 `controller.abort()` → `stopReason=aborted`，`aborted` 不参与 `isRetryableAssistantError` | 代码路径核对 |

## 三、未覆盖 / 已知限制

- 浏览器端「重试提示条」「等待模型响应 Ns」「输入框解锁」未在真实界面点验：工作区面板使用自研富文本编辑器（`sender.getModel()`），CDP 程序化输入无法写入其内部模型，`sendMessage` 读取草稿为空后直接返回。已改为在打包 app 里由用户手动验证。
- 真实模型（TF-router / OpenCode-DP / MiniMax）下的长会话表现未复测；需重打包后日常使用观察。
- 子 Agent、临时对话（singleAgent）共用同一个 `configureAgentRequests`，仅做类型检查与调用链核对，未单独跑用例。
- 事件级看门狗无法区分「上游只发 SSE 注释/ping」与「完全无数据」，120 秒内只发 ping 会被判超时；属可接受取舍。

## 四、打包

- 备份：`/tmp/toonflow-exec-old11.app`（156 MB）
- 已替换 `Contents/Resources/app/bun/index.js`（含看门狗与重试设置）与 `Contents/Resources/app/views/mainview/`（含重试提示条与等待计时）
- `codesign --force --deep --sign -` 通过，`codesign -v` 校验通过
- 需 ⌘Q 退出再打开才生效
