# 需求方案：Agent 热点缓存与画布写入统一

- 时间：2026-11-18 15:58
- 关联需求矩阵：`1_requirements_matrix/2026-11-18-15-56-agent-hotpath-cache.md`

## 1. 历史面板投影缓存（R1）

把 `getAgentSession` 拆成「缓存壳 + 构建函数」：

```
getAgentSession(cwd, path):
  active = getActiveAgentSession(path)
  if active: return build(cwd, path, active)        // 运行中永远实时
  try: info = stat(path)
  catch: 删除缓存项; return build(cwd, path)
  hit = cache.get(path)
  if hit && hit.size == info.size && hit.mtimeMs == info.mtimeMs:
      刷新 LRU 顺序; return hit.value
  value = await build(cwd, path)
  if info.size <= 8MB: cache.set(path, {size, mtimeMs, value}); 淘汰到 6 条
  return value
```

- 使用 Map 的插入顺序做 LRU：命中时 delete+set。
- 超过 8MB 的会话不缓存，避免常驻内存；运行中会话不进缓存，避免看到冻结的流式内容。
- 缓存返回同一对象：调用方只读（路由序列化、compact 失败兜底），审查时逐一确认。

## 2. 会话列表缓存（R2）

```
sessionListCache: Map<"cwd\0dir", { at, items }>
listAgentSessions(cwd, directory, options):
  raw = cache 命中且 now-at < 5s ? items : await SessionManager.list(...)
  过滤 parentSessionPath / 目录可用性 / 节点标记 → 排序 → 投影
```

- 主动失效：`createAgentConversation`、`forkAgentSession`、`cloneAgentSession`、`removeAgentSession`、`renameAgentSession` 完成后清掉对应目录的缓存。
- 返回给调用方的仍是新数组与新对象，缓存只保存 SDK 原始列表。
- TTL 5 秒兜底运行中会话产生的 modified/name 变化。

## 3. 节点标记缓存（R3）

`hasAgentNodeMarkerOnDisk(path)` 先 stat，命中 `path + mtimeMs + size` 的缓存直接返回。文件被追加后 mtime 变化自然失效；读取失败仍返回 false（宁可多显示）。

缓存上限 512 条，超出按插入顺序淘汰。

## 4. 画布写入统一（R4）

在 `canvasFiles.ts` 导出：

```
CANVAS_WRITE_RETRY = { attempts: 6, baseDelayMs: 120 }
```

替换三处 `writeJson` 调用：复制画布临时文件、新建画布、文档节点回写。主保存路径原先的内联常量改为引用同一常量，避免两处再次漂移。

## 5. branch 单次遍历（R5）

`getAgentStats(history, timing?, branch?)`、`getAgentContext(history, window, maxOutput, setting?, branch?)` 增加可选 branch。`emitStats` 先 `const branch = history.getBranch()` 再分别传入；`getAgentSession` 已有 branch，直接复用。无行为变化，纯遍历次数优化（每次 flush 由 4 次降为 1 次）。

## 测试

- `contextStats.test.ts`：传 branch 与不传结果一致。
- 新增 `sessionCache.test.ts`：同 mtime 命中、改动后重建、运行中不进缓存（用临时文件）。
- web：画布重试常量被三处引用（typecheck 即可）。
- 全量服务端测试 + web 测试 + 构建。

## 风险

| 风险 | 应对 |
| --- | --- |
| 缓存返回同一对象被调用方修改 | 审查所有 `getAgentSession` 调用点，确认只读；如需防御可在测试中冻结 |
| 设置改动后命中旧阈值/窗口 | 缓存记录带设置指纹（provider/model 窗口覆盖 + compactPercent），命中时比对 |
| 运行状态变化导致 running/子 Agent 状态过期 | 活动会话 epoch，注册/注销时自增并删除对应投影 |
| 等长覆盖且保留 mtime 的文件让旧投影永久命中 | 10 分钟兜底 TTL |
| 列表 5 秒内显示旧名称/顺序 | 主动失效覆盖增删改重命名；运行中变化 5 秒内自愈 |
| 内存占用 | 单会话 8MB 上限 + 6 条 LRU；标记缓存 512 条 |
| mtime 精度不足导致漏失效 | 同时比较 size；写会话是追加，size 必变 |
| 删除文件后 stat 失败 | 捕获后清缓存并走原路径 |

## 评审意见

| 评审人 | 意见 | 结论 |
| --- | --- | --- |
| 子 agent 评审 | P1-1 运行中投影缓存竞态；P1-2 设置/运行态依赖未校验；P2-1 超限未删；P2-2 重复遍历；P2-3 列表失效遗漏；P2-4/P2-5 copy 与默认画布未覆盖；P2-6 测试缺口；P2-7 无 TTL | 已修复：缓存前复检运行态 + epoch + 设置指纹 + TTL；copy 支持 retry；常量移到 `@/lib/workspaceFiles`；补 stats branch 断言；集成用例因需注入 AgentHost 记为手工验证 |
| 用户评审 | 待填 | |
