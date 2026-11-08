# Bug 修复方案：素材读取竞争与子 Agent 无上限扇出

- 时间：2026-11-02 14:20
- 对应分析：`bug_analysis-2026-11-02-14-20-asset-read-contention-and-agent-fanout.md`
- 用户决策：去重 + 请求重试 + 子 Agent 限流

## 1. 方案总览

| 编号 | 改动点 | 文件 |
| --- | --- | --- |
| S1 | 同路径在途读取共享 | `apps/server/src/modules/assetLibrary/assets/library.ts` |
| S2 | 子 Agent 单次并发上限 8 | `apps/server/src/agent/tools/subAgent.ts` |
| S3 | 工具界面列表超时 + 一次重试 | `packages/toolScaffold/src/client.ts` |

## 2. S1：同路径在途读取共享

### 设计

- 模块级 `Map<绝对路径, Promise<读取结果>>`，只保存"正在进行"的读取。
- 流程：
  1. 入口检查取消信号；解析出目标绝对路径（保持原有路径校验与越权保护）。
  2. 再次检查取消信号；查 Map。
  3. 未命中：创建读取 Promise（加文件锁 → lstat → 大小校验 → readFile → sha256），同步写入 Map；读取结束（成功或失败）后删除自身。
  4. 命中：直接复用。
  5. 每个调用方用各自的取消信号"等待"共享 Promise：自己取消时立即 reject，不影响其他等待者与共享读取。
- 共享读取本身不绑定任何调用方的 signal，避免一个 Agent 停止导致其他人的读取失败。

### 边界

- 仅合并时间上重叠的读取；先后两次读取仍会各自读盘，保证能拿到最新内容。
- 文件锁语义不变：读取期间写入仍会 409；多个读取不再互相 409。
- 失败结果同样共享（如文件不存在），与并发调用前的行为一致。

### 伪代码

```
inflight = Map<path, Promise<Result>>

readAssetEntry(library, path, signal):
  signal.throwIfAborted()
  target = resolveLibraryPath(...)
  signal.throwIfAborted()
  task = inflight.get(target.path)
  if task == null:
    task = runLockedRead(target)
    inflight.set(target.path, task)
    task.onSettled(() => inflight.deleteIfSame(target.path, task))
  return awaitAbortable(task, signal)   // 只影响当前调用方

runLockedRead(target):
  lock = lockWorkspaceFiles([target.path])
  try:
    info = lstat; size check; content = readFile（不传 signal）; revision = sha256
  finally: lock.release()
```

## 3. S2：子 Agent 单次并发上限

- 新增常量 `maxConcurrentTasks = 8`。
- 用固定 worker 数（`min(8, tasks.length)`）从任务数组取下一个索引执行，替代 `Promise.all(tasks.map(...))`。
- 任务内部仍用原来的 try/catch 写回 `results[index]`，worker 不会因单个任务失败而退出。
- 工具描述从「并发数不设固定上限」改为「单次最多同时执行 8 个任务，任务总数、执行轮次与总时长不设上限」。
- 嵌套调用（子 Agent 再调 subAgent）各自独立计数，不做全局闸门，避免跨节点互相饿死。

## 4. S3：工具界面列表超时与重试

- 抽 `fetchToolRenderers()`：`axios.get(..., { timeout: 5_000 })`。
- 仅当"没有拿到响应"（无 `response`，含超时/网络错误）或响应 5xx 时，等待 300 ms 重试一次；4xx、主动取消、非法 URL 等确定性错误直接抛出。
- 总预算约 10.3 s，避免把原本快速失败的场景拖到几十秒。
- 保留原有"并发请求合并为同一个 Promise"的行为，重试发生在同一个共享 Promise 内。
- GET 幂等，重试无副作用。

## 5. 评审意见

子 Agent 初评（2026-11-02 14:24）结论：**修改后通过**，意见已并入实现：

| 编号 | 意见 | 处理 |
| --- | --- | --- |
| R1（P1） | 共享 Promise 的清理若用丢弃返回值的 `finally`，派生拒绝会触发 unhandledRejection | 清理改为 `then(cleanup, cleanup)`；等待方也同步挂成功/失败两条分支 |
| R2（P1） | 15s 超时 + 重试最坏 30s，会把原本快速失败的场景拖长 | 改为单次 5s、退避 300ms、只重试一次，总预算约 10.3s；取消与非法 URL 不重试 |
| R3（P2） | 共享结果只应缓存 content/revision，path 由各调用方带回 | 已按此实现，避免不同 selector/大小写命中同一 realpath 时串用路径 |
| R4（P2） | 查 Map 到写 Map 之间不能有 await | 代码内加注释明确约束；并发测试覆盖 |
| R5（P2） | worker 的 index 必须在 await 前取号；进度回调抛错不能中断执行道 | 已按要求实现，`update()` 内部吞掉界面回调异常 |
| R6（P2） | 缺测试 | 新增 `abortable.test.ts`、`concurrency.test.ts`、`library.read.test.ts`，共 12 个用例 |
| R7（P3） | 嵌套 subAgent 仍是 8^n，单次限流不等于全局上限 | 已知残余风险，本次不做全局闸门，避免跨节点互相饿死 |
| R8（P3） | 工具界面脚本 `<script>` 加载仍无超时 | 不在本次范围；`timeout exceeded` 的实际来源需后续单独确认 |

## 6. 用户评审

用户已选择「去重 + 请求重试 + 子 Agent 限流（推荐）」，并明确要求「不要引发新问题」。
