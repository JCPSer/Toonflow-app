# 记忆：Agent 热点缓存与画布写入统一（STAR）

- 时间：2026-11-18 16:10

## Situation

连接池与上下文统计优化后，仍有按会话数量/体积线性增长的开销：历史面板每次整文件解析、历史列表逐行读完所有会话、画布非主路径写入重试窗口过短、stats 每次刷新重复遍历分支。

## Task

在不改变会话内容与模型上下文的前提下，把这些可重建的派生数据缓存起来，并统一画布写入策略。

## Action

1. 新增 `lruCache.ts`：Map 顺序即 LRU，支持容量上限与 TTL（TTL 不随读取续期）。
2. `getAgentSession` 拆为缓存壳 + `buildAgentSession`：非运行会话按 `size + mtime` 缓存，LRU 6 条、单文件 8MB 上限、10 分钟兜底 TTL；命中还要求 live epoch 与设置指纹一致；运行中一律绕过且不写入。
3. 活动会话注册/注销自增 `agentLiveEpoch` 并删除对应投影，消除 check-then-act 竞态与 running/子 Agent 状态陈旧。
4. 会话列表 `SessionManager.list` 缓存 5 秒；创建、克隆、删除、重命名及 run 新建会话后主动失效；节点标记按 `path + size + mtime` 缓存 512 条。
5. `getAgentStats` / `getAgentContext` 增加可选 branch 参数，emitStats 与 `getAgentSession` 只取一次 branch。
6. `CANVAS_WRITE_RETRY`（6×120ms）上提到 `@/lib/workspaceFiles`；主保存、文档回写、复制画布、新建画布、默认画布全部使用；`copy` 增加 retry 参数。

## Result

- 服务端 178 测试通过，web 142 测试通过；typecheck 仅既有 `@/agentRuntime` 基线错误。
- 评审 2 个 P1 + 7 个 P2 全部修复。
- 入口与视图已同步（备份 20261118-160905），待用户重启。

## 关键教训

缓存派生数据必须把「非文件依赖」显式纳入命中条件（设置、运行态）；返回同一对象前要确认所有调用点只读。
