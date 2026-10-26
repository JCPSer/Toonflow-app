# 测试结果：Agent 上下文管理 + 开发者全权限

日期：2026-10-26 14:30
范围：自动压缩阈值、手动压缩接口、工具大输出落盘、microcompact、只读越界与 runCommand、设置页面板

## 一、手动压缩（`POST /api/agent/compact`）

夹具：`libproj/.agent/sessions/*.jsonl`，81 条目 / 369 KB，40 轮 user+assistant，供应商 fake（mock SSE `:3999`）。

| 场景 | 结果 |
| --- | --- |
| 单次压缩 | 200，条目 81 → 82，新增 1 条 `compaction`，`firstKeptEntryId` 指向已存在条目，摘要 500+ 字符 |
| 压缩后上下文 | `contextUsage` 20347 tokens / 7.8%（压缩前约 94K tokens） |
| 二次压缩 | 400「当前对话没有可压缩的内容」，文件字节不变 |
| 缺模型字段 | 400「会话未记录模型，无法压缩」（夹具 assistant 缺 provider/model） |
| 运行中压缩 | 409「对话正在运行，请先停止后再压缩」 |

## 二、发现并修复的写回缺陷（P0）

首轮验证写入后文件出现**两条完全相同 id 的 compaction**，且 compaction 的 `parentId` 指向未落盘的 `thinking_level_change`。

根因两处：

1. `SessionManager.inMemory(cwd, undefined, entries)` 会**直接往传入数组里追加**条目，`entries` 因此被污染成 83 条，写回 `[...entries, ...appended]` 时把 compaction 拼了第二次。改为传入 `[...entries]` 副本。
2. SDK 压缩前会先追加 `thinking_level_change`，compaction 的父节点是它；只写回 compaction 会留下悬空 `parentId`，下次 `readSessionEntriesStrict` 直接判「结构无效」。

修复后：`toWrite` 里父节点不在已写集合时改挂到最后一个已存在条目。

复测（同一夹具重跑）：81 → 82，`compactions=1`，`dangling=0`，`parentId` 指向 f6c4b994（最后一条 message），`firstKeptEntryId` 有效，`getAgentSession` 读取 80 条消息、7.8%。

## 三、工具大输出落盘

- 94 KB 文本工具结果 → 写入 `.agent/artifacts/<sha256前16位>-<工具名>.txt`，上下文内只剩指针 + 4 KB 预览；`read` 回读内容与原文一致。
- 小于阈值（20 KB）的结果完全不改动；多个小文本块合计超限时合并为一个指针。
- 落盘失败降级为「保存失败，仅保留前 N 字节」，不影响工具调用返回。

## 四、权限

| 场景 | 结果 |
| --- | --- |
| 全权限关闭，读 `/etc/hosts` | 403（工作区限制） |
| 全权限开启，读 `/etc/hosts` | 允许 |
| 读项目内 `.toonflow` | 403（两种状态都拒） |
| 读应用数据目录、`/proc` `/sys` `/dev` | 403 |
| 符号链接/特殊文件 | 403 |
| 写操作 | 始终限定工作区内 |
| `runCommand` 注册 | 仅全权限开启时出现；MCP/A2A 调用传 `allowCommand=false`，无法借 MCP 打开 |

`runCommand` 使用 `bash --noprofile --norc -c`，剥离密钥类与 `BASH_ENV`/`ENV`/`PROMPT_COMMAND`，超时 120 s（上限 600 s），并发 4，输出上限 8 MB。

## 五、UI 与类型检查

- 设置 → 开发者选项：渲染出「上下文」区块（自动压缩开关、压缩阈值 %、工具输出上限 KB、保存上下文设置）与「开放 Agent 全部权限」开关（含确认文案）。实测点击进入面板并读取到上述控件。
- `apps/server` `tsc` 通过；`apps/web` `vue-tsc` 通过；`bun run build` 通过，桌面入口已重新打包并安装到 `/Applications/toonflow-exec.app`。
- 自动压缩的端到端（真实模型跑到阈值）与「压缩上下文」按钮的真实点击未在本轮执行：mock 服务已停止，留待有可用模型时验证。

## 六、收尾

已清理：7 个测试会话文件、mock 服务（:3999）、`/tmp/mock-openai.ts` 与临时脚本。
