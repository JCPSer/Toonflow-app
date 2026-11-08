# 需求方案：文件并发冲突处理加固

- 时间：2026-11-05 13:05
- 对应需求：`../1_requirements_matrix/2026-11-05-13-05-file-concurrency-hardening.md`
- 状态：待评审

## 1. 背景

节点代码跑在 WKWebView（单线程事件循环），生成与 ffmpeg 在 Bun 服务端异步执行；文件通过 HTTP 落到服务端。服务端有两层保护：

- `packages/file/src/access.ts`：按规范化路径的读写队列（最多 64 读、写独占、FIFO、30 秒等待超时）。
- `workspace/files.ts` 的 `lockWorkspaceFiles`：变更类操作互斥，冲突直接抛 `{status:409, code:"EBUSY"}`。

问题在于：

1. 写操作被「长时间读」挡住时，30 秒后抛的是裸 `EBUSY`（无 status），`errorFromCause` 未映射 → HTTP **500**。
2. 客户端没有退避，节点批量完成时短时冲突直接失败。
3. 文件重命名实现是 clone 复制 + 删除源文件，不是原子操作，复制中途失败会留下不完整目标。

## 2. 方案

### 2.1 服务端：错误映射

`apps/server/src/lib/responseFormat.ts`

- 状态码表增加 `EBUSY: 409`。
- 文案表增加：`文件正在被其他操作使用，请稍后重试。`
- 现有逻辑会同时把 `{ code: "EBUSY" }` 放进 `data`，客户端可据此识别。

### 2.2 客户端：EBUSY 退避重试

`apps/web/src/lib/workspaceFiles.ts`

- 新增内部工具：
  - `isBusyError(error)`：axios 错误且 `status === 409` 且 `response.data.data.code === "EBUSY"`。
  - `withBusyRetry(action)`：最多 4 次；第 n 次失败后等待 `60 * 2^n + 随机 0–60ms`；非 EBUSY 立即抛出。
- 应用到：`write`、`writeTextSnapshot`、`rename`、`copy`、`remove`、`mkdir`。
  - 这些请求都在服务端「先取锁后执行」，EBUSY 时尚未产生副作用，重试安全。
  - `write` 的内容已整体在内存里，重试不会重复提交流式内容。

### 2.3 服务端：原子重命名

`apps/server/src/modules/localRuntime/workspace/files.ts` 的 `renameWorkspaceFile`

- 文件分支：
  1. `lstat(target)` 已存在 → 抛 `EEXIST`（保持现有「不覆盖」语义；POSIX `rename` 会静默覆盖，必须先检查）。
  2. `rename(source, target)`（同一文件系统内原子）。
  3. 捕获 `EXDEV` → 回退现有 `copyFileClone` + `unlink(source)`，删除失败回滚目标。
- 目录分支保持不变（已经是 `rename` + 存在性检查）。

## 3. 时序

```
节点 A 写 file.md ─┐
                  ├─ 服务端 access 队列：同一路径写独占 → A 完成后 B 才开始
节点 B 写 file.md ─┘

若 B 在路由层就撞上 A 的 busyFiles → 409 EBUSY
        ↓
web withBusyRetry：60/120/240ms 退避，最多 4 次
```

## 4. 影响面

- 只影响错误呈现与重试，不改变最终写入内容。
- 重命名语义不变：目标存在仍报 EEXIST；同卷下从「复制+删除」换成原子 rename，跨卷自动回退。

## 5. 测试计划

- 单测：`isBusyError` / `withBusyRetry`（可用纯函数导出，构造假错误与假 axios 错误）；重试次数与最终抛出。
- 服务端类型检查 + 现有测试。
- 手工：两个客户端同时写同一文件、节点批量落盘、重命名已存在目标。

## 6. 评审意见

（待用户填写）

- 是否通过：
- 其他要求：
