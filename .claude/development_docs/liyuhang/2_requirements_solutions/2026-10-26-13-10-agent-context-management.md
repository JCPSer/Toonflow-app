# 方案：Agent 上下文管理补齐 + 开发者全权限

## 一、共享层

`apps/server/src/agent/runtime/preferences.ts`（新增）集中读取用户偏好，避免各调用点各自解析 settings：

```
getAgentPreferences(): { compactPercent(50-95,默认80), autoCompact(默认true), toolOutputMaxBytes(默认20KB), toolOutputPreviewBytes(默认4KB), fullAccess(默认false) }
compactReserveTokens(contextWindow): 按百分比换算预留量，区间 [4096, window-4096]
agentArtifactsDirectory = ".agent/artifacts"
```

## 二、自动压缩

- `createAgentSettings(contextWindow, { retry })`：`compaction.enabled = autoCompact`，`reserveTokens = compactReserveTokens(contextWindow)`，`keepRecentTokens` 默认 20000，窗口 < 60000 时取 `floor(window/8)`。
- 主会话：`runtime/index.ts` 在拿到模型后把 `model.contextWindow` 传入。
- 子 Agent：`subAgent.ts` 去掉写死的 `compaction: false`，改用同一函数（`retry: false` 保留），窗口取模型窗口，缺失时 128000。

## 三、手动压缩

- 新增 `POST /api/agent/compact { directory, sessionFile }`。
- `compactAgentSession(cwd, path)`：
  1. 有活动会话 → 409；加文件锁；
  2. 复用 `readSessionEntriesStrict`（坏行 400、>32MB 413）；
  3. 取 `buildSessionContext().model`（provider/modelId 都要有，缺一即 400）；
  4. `createAgentModel` + `createAgentSession`（临时会话，`tools: []`）→ `session.compact()` → `dispose()`；
  5. 只把本次新增的 compaction 写回原文件：`SessionManager.inMemory` 会改传入数组，必须先 `[...entries]` 复制；SDK 压缩前追加的 `thinking_level_change` 不落盘，compaction 的父节点若指向它则改挂到最后一个已存在条目，避免悬空；最后返回最新 `getAgentSession`。
- 错误映射：`Nothing to compact` / `Already compacted` → 400「没有可压缩的内容」；鉴权/未选模型 → 400「模型不可用」。

## 四、大输出落盘

- `toolOutput.ts`：`offloadToolContent(cwd, toolName, parts)` 在 `afterToolCall` 里处理文本部分。
- 超过 `toolOutputMaxBytes` 时写 `.agent/artifacts/<sha256前16位>-<工具名>.txt`（`writeAtomic`，幂等），内容替换为：

```
[输出过大（约 N KB），已保存到 .agent/artifacts/xxx.txt]
<前 4KB 预览>
[以下省略；用 read 工具读取完整内容]
```

- 按 UTF-8 边界截断；写入失败降级为截断提示；图片等非文本部分原样保留。

## 五、microcompact

- `requests.ts` 里在每轮请求构建完 `requestContext` 后调用 `microCompactMessages`。
- 触发：toolResult 数量 > 6 且估算 tokens > `contextWindow * 50%`。
- 策略：保留最近 6 条 toolResult，更早的文本合并为一行 `[工具结果已裁剪：<工具名>，约 N 字符；需要时重新调用该工具或 read 相关文件]`；图片保留。
- 只改本次请求副本，不动会话文件、不动 UI 历史；已裁剪过的（含标记）跳过。

## 六、开发者全权限

- 开关：`settings.developer.agentFullAccess`（默认 false，开发者选项里二次确认开启）。
- `permissions.ts`：
  - `isAgentFullAccess()` 实时读取，切换即时生效。
  - `resolveAgentReadPath(cwd, path)`：默认走工作区限制；全开时允许项目外绝对路径，仍拒绝符号链接、特殊文件、`.toonflow`。
- `tools/index.ts`：`resolvePath(path, readOnly)` 仅在 `readOnly && isAgentFullAccess()` 时走放开逻辑；写操作一律仍限项目内。
- 新内置工具 `runCommand`（仅全开时注册）：`Bun.spawn(["bash","-lc",cmd], { cwd: 项目根 })`，超时默认 120s/最大 600s、全局并发 4、输出上限 8MB，非零退出码作为结果返回而不是抛错；执行时再次校验开关。

## 七、前端

- 设置页（开发者选项面板）：上下文区块（自动压缩开关、50-95% 阈值、10-512KB 输出上限）+ 全权限开关（确认框 + 警告）。
- 会话标题栏新增「压缩上下文」按钮；`conversation.vue` 暴露 `compactContext()`，成功后整体替换 messages/stats/contextUsage。
- 用量分级：≥80% 黄色提示；≥90% 红色提示 + 「立即压缩」按钮。

## 八、验收要点

1. 设置 80% 后长会话自动压缩一次，UI 出现「正在压缩上下文…」，压缩后 contextUsage 下降。
2. 手动压缩：342KB/30 轮会话 0.08s 返回，新增 compaction 且 `firstKeptEntryId` 有效。
3. 工具输出 94KB → 落盘 + 4KB 预览，read 能读回完整内容；小输出不动。
4. 子 Agent 长任务不再因为无压缩直接撞窗。
5. 全权限关闭时读项目外被拒；开启后 `/etc/hosts` 可读、`.toonflow` 仍拒；`runCommand` 只在开启后出现且 cwd 固定项目根。
6. ≥80%/≥90% 提示与「立即压缩」可用；压缩中禁止重复触发。

## 评审意见

（待用户填写）
