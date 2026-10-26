# 需求矩阵：Agent 上下文管理补齐 + 开发者全权限

## 背景

用户询问现有上下文管理是否完善、搜索工具内容会不会丢。代码事实：自动压缩来自 SDK（`contextTokens > contextWindow - 16K` 时压缩，保留最近 20K token 原文），工具输出靠工具自身硬截断（read 2000 行/50KB、grep 100 条/50KB），图片有「移出上下文」机制。差距是：子 Agent 关闭压缩、没有手动压缩、没有分级提示、没有 microcompact、大输出只截断不落盘、压缩参数写死。

## 对标调研（本机 Claude Code 二进制里的真实文案，非猜测）

- `Output too large (X). Full output saved to: <path>`、`Output exceeded the persist limit; only the first N were saved to: <path>`：**大工具输出落盘 + 指针**，超持久化上限时明确告知「其余被丢弃」。
- `Auto-compact summarizes the conversation when context usage approaches this limit. The actual threshold is the minimum of this setting and your model's maximum context window.`：**自动压缩阈值可配置**，取设置与模型窗口的较小值，可在 /config 关闭。
- `microcompact_boundary`：存在 **microcompact** 阶段（先清理旧工具结果，避免每次都整段摘要）。
- `MCP tool results stay in context for the rest of the session. /compact to flush them`：**手动 /compact** 是官方给出的清理手段。
- 用量统计里单列 `tool results over 10k tokens`：以 10k token 作为「大工具结果」的关注线。

## 需求描述

| # | 需求 | 优先级 | 难度 | 风险 |
| --- | --- | --- | --- | --- |
| R1 | 子 Agent 开启自动压缩（当前完全关闭，长任务直接撞窗） | 高 | 低 | 子会话不持久化时压缩行为需验证 |
| R2 | 手动「压缩上下文」入口（会话菜单 + 接口） | 高 | 中 | 离线压缩需要模型与密钥，失败要可恢复 |
| R3 | 上下文用量分级提示（80% 黄、90% 红 + 一键压缩） | 中 | 低 | 与现有状态条样式冲突 |
| R4 | microcompact：旧工具结果先裁成一行摘要，推迟整段压缩 | 中 | 中 | 裁剪过度会让模型重复读文件 |
| R5 | 大输出落盘：超过阈值写入 `.agent/artifacts`，上下文留预览 + 路径 | 高 | 中 | 落盘失败要降级为截断 |
| R6 | 设置项：自动压缩百分比（50-95，默认 80）、工具输出上限（默认 20KB） | 高 | 低 | 阈值换算成 reserveTokens 要留 4K 回复余量 |
| R7 | 开发者选项：开放 Agent 全部权限（项目内执行命令 + 项目外只读） | 中 | 中 | 高危能力，默认关闭 + 二次确认 |

## 已确认的决策

| 决策点 | 结论 |
| --- | --- |
| 优化范围 | 全做（R1-R7） |
| 压缩阈值默认 | 80%（设置里可改 50-95） |
| 落盘阈值 | 调研后按 Claude Code 的「大工具结果」口径定 20KB（约 8k token），可在设置里改 |
| 命令执行 | cwd 固定项目根，不允许在项目外执行 |
| 项目外访问 | 只读；写操作仍限项目内 |
| 权限开关 | 放在开发者选项，默认关闭，开启需二次确认 |
| 落盘目录 | `<项目>/.agent/artifacts` |

## 评审意见

（待用户填写）
