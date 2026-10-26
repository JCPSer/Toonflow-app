# 记忆：Agent 上下文管理 + 开发者全权限

## 结构

- `apps/server/src/agent/runtime/preferences.ts`：`getAgentPreferences()` 统一读取 `settings.agent.*` 与 `settings.developer.agentFullAccess`；`compactReserveTokens` / `autoCompactStrategy` 把百分比换算成 SDK 的 `reserveTokens` 与 `keepRecentTokens`；`agentArtifactsDirectory = ".agent/artifacts"`。
- `toolOutput.ts`：`offloadToolContent` 按文本总字节判断，超限写 artifacts（sha256 前缀 + 工具名，`writeAtomic` 幂等），返回指针 + 4 KB 预览；读取 artifacts 时传 `skip`，避免读回来又落盘。
- `permissions.ts`：`resolveAgentReadPath` 默认走工作区限制，全权限时允许项目外只读；两种状态都拒符号链接、特殊文件、`.toonflow`、应用数据目录、`/proc` `/sys` `/dev`。
- `tools/index.ts`：`resolvePath(path, readOnly)` 只在 `readOnly && isAgentFullAccess()` 时放开；`runCommand` 只在全权限时注册，MCP/A2A 传 `allowCommand=false`。

## 关键坑

`SessionManager.inMemory(cwd, undefined, entries)` **会修改传入的数组**（原样保存并往后 push）。手动压缩要拿「原条目 + 新增 compaction」重写 JSONL，必须传副本 `[...entries]`，否则 compaction 会被写两次（同 id 两行）。同一文件里的 rewind/fork/clone 早已是副本写法，只有压缩这处漏了。

SDK 压缩前会先追加 `thinking_level_change`，compaction 的 `parentId` 指向它。只写回 compaction 会让 `readSessionEntriesStrict` 判「结构无效」，所以写回时父节点不在集合内就改挂到最后一个已存在条目。压缩回写不写 thinking/model 这类状态条目，避免临时会话的模型覆盖原会话。

## 判定标准

- 压缩成功的判据：新增条目里有且仅有 compaction、摘要非空、`firstKeptEntryId` 在既有 id 集合里、父节点不悬空。
- 二次压缩必然 400「没有可压缩的内容」，磁盘字节不变。
- 手动压缩用 `reserveTokens` 走 SDK 正式路径（`session.compact()`），不引用 dist 深路径；失败时磁盘文件保持原样（inMemory 副本）。
