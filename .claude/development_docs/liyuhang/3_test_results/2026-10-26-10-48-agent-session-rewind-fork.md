# 测试结果：Agent 会话回退与复制

环境：macOS arm64 / Bun，dev server 3121（`TOONFLOW_DATA_DIR=/tmp/tf-lib/data`）+ vite 5173，chrome-devtools 实机操作

## 一、静态检查

| 项 | 命令 | 结果 |
| --- | --- | --- |
| 服务端类型检查 | `bun run typecheck`（apps/server） | 通过 |
| 前端类型检查 | `bun run typecheck`（apps/web） | 通过 |
| 路由表 | `bun run routes` | 已生成 `/api/agent/fork`、`/api/agent/rewind` |

## 二、服务端逻辑验证（真实 JSONL 树）

用 SDK 生成 3 轮会话（含 `session_info`、`model_change`、`toonflowReasoning`、`toonflowUserMessage`、`toonflowSubAgent` 与一个子会话文件），直接调用实现：

| # | 用例 | 实际 | 结论 |
| --- | --- | --- | --- |
| 1 | fork 第一轮 | 新文件 9 条（header+session_info+reasoning+model_change+user+toonflowUserMessage+assistant+model_change+新建 session_info）；名字「测试回退会话 · 副本」；源文件 sha256 不变 | 通过 |
| 2 | fork 后重开 | `SessionManager.open` 分支 8 条，叶 = 新建 session_info | 通过 |
| 3 | rewind 到第二轮之前 | 返回只剩第一轮的 2 条消息；文件重写为 9 条（原 15 条），尾部为 `custom/toonflowRewind`，`parentId` = 第二轮前的 model_change | 通过 |
| 4 | rewind 后叶指针 | 重开分支停在标记，叶 = 标记 id（新消息会挂在第一轮末尾） | 通过 |
| 5 | 派生记录 | `toonflowUserMessage` 等随锚点一起删除 | 通过 |
| 6 | 子会话连带删除 | 子 Agent `.jsonl` 被删除（`subagentRemoved=true`） | 通过 |
| 7 | 损坏文件 | `rewind` 返回 400「会话文件损坏，无法回退」 | 通过 |
| 8 | HTTP 接口 | `POST /api/agent/fork` 与 `/api/agent/rewind` 均 200 并返回会话 | 通过 |

## 三、界面验证（真实点击）

| # | 用例 | 实际 | 结论 |
| --- | --- | --- | --- |
| 9 | 用户消息悬停工具条 | 复制 / 回退到这里 / 编辑 / 删除 | 通过 |
| 10 | agent 回复悬停工具条 | 复制 / 复制为新会话 / 删除 | 通过 |
| 11 | 点用户消息「回退到这里」（第二轮） | 弹出确认框「回退到这条消息之前？它之后的对话会被永久删除，不会回滚工作区文件、画布和附件。」 | 通过 |
| 12 | 确认回退 | 列表只剩第一轮；输入框回填「第二轮问题」；磁盘只剩第一轮 + 叶标记；子会话文件消失 | 通过 |
| 13 | 点 agent 回复「复制为新会话」 | 新文件生成并自动切到「入口验证会话 · 副本」，内容为该轮及以前，原会话不变 | 通过 |

修复记录（两轮）：

1. 第一版按钮都挂在用户消息上，且复制后界面不切换——`openForkedConversation` 里 `void loadHistory()` 与 `selectConversation` 抢跑，后者因 `historyLoading` 直接返回；改为 `await loadHistory()` 并返回成功标志。
2. 用户澄清「复制属于 agent 侧（左侧）」，入口改到 assistant 消息；同时按代码审查返工了子会话归属、深拷贝、名称、叶指针重接等 12 项。

## 四、返工后的补充验证（服务端）

| # | 用例 | 实际 | 结论 |
| --- | --- | --- | --- |
| 14 | fork 在 agent 回复上（轮内含子 Agent） | 新会话条目含 `toonflowSubAgent`，其 `file`/`parentFile` 指向**新**子会话文件；新子会话 header 的 `parentSession` = 新父会话；源子会话仍在 | 通过 |
| 15 | 源会话回退 | 本会话派生的子会话被删除；fork 出来的共享子会话（parentSession 指向 fork 会话）**不会**被删 | 通过 |
| 16 | 子 Agent 会话调用两个接口 | 均 400「子 Agent 会话不支持回退/复制」 | 通过 |
| 17 | 回退到第一条消息 | 会话消息清空，文件保留 header + 叶标记 | 通过 |

## 五、未覆盖

- 生成中 / 待回答时按钮置灰与服务端 409：代码路径已实现，未构造运行中场景实测。
- 超过 32 MB 会话（413）、压缩记录与回退点交叉、label 的极端组合：按代码路径推断，未造数据实测。
- 多窗口/多实例同时操作同一会话（明确不支持，未测）。
- 子 Agent 递归派生（子会话再派生子会话）的深拷贝：代码按递归实现，未造三层数据实测。
