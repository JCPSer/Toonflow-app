# 记忆：文件并发冲突加固（EBUSY 映射 / 退避重试 / 原子重命名）

- 时间：2026-11-05 13:05（13:12 部署）
- 类型：稳定性修复

## STAR

**Situation（背景）**
画布节点并发执行，节点结束时集中写产物文件、画布 JSON、文本快照。服务端按路径串行并有 busyFiles 互斥，冲突抛 EBUSY；但被长时间读挡住 30 秒超时后没有状态码映射，返回 500；客户端也没有重试，批量完成时偶发失败。文件重命名是 clone 复制 + 删除，非原子。

**Task（任务）**
把并发冲突统一成可重试的 409，客户端退避重试，重命名改为原子操作。

**Action（行动）**
- `apps/server/src/lib/responseFormat.ts`：`EBUSY → 409` + 「文件正在被其他操作使用，请稍后重试。」
- `apps/web/src/lib/busyRetry.ts`：`isBusyError`（只认 409 + data.code=EBUSY）与 `withBusyRetry`（4 次，60/120/240ms + 0–60ms 抖动）。
- `apps/web/src/lib/workspaceFiles.ts`：写、快照写、重命名、复制、删除、建目录统一包一层。
- `apps/server/src/modules/localRuntime/workspace/files.ts`：文件重命名改为同卷 `rename` 原子替换；先 `lstat(target)` 保持 EEXIST 语义；`EXDEV` 回退 clone+unlink。
- `packages/file/src/access.ts`：等锁 30 秒超时改用 `EBUSYTIMEOUT`（仍 409，但不重试）。
- `errorFromCause` 补 `EBUSYTIMEOUT`；重命名前用 `dev+ino` 判断「只改大小写」，避免 APFS 误判重名；拒绝符号链接。
- 单测：web busyRetry 10 条、server responseFormat 4 条。

**Result（结果）**
web 61 单测、server 4 单测通过，三端类型检查通过，desktop 构建并同步到已安装应用（13:12），**未重启**。

## 关键经验

1. 错误码映射漏一项，会把「可重试的冲突」伪装成 500；凡是业务里会抛 code 的地方，都要在 `errorFromCause` 的表里对齐。
2. 自动重试只适用于「尚未产生副作用」的错误：EBUSY 在取锁阶段抛出，重试安全；EEXIST/ESTALE 表示状态已变，绝不能自动重试。
3. POSIX `rename` 会静默覆盖目标，改成原子操作时必须先显式检查目标存在，否则会把「重名报错」变成「覆盖数据」。
4. `packages/file` 的读写队列按**精确路径**做 key：目录级重命名/删除不会锁住子文件，子文件读可能 404；这是已知边界。
5. 「刚被占用」和「等锁超时」要分开编码：前者重试有意义，后者再重试等于把 30 秒乘以重试次数。
6. 大小写不敏感文件系统上，改大小写会让目标路径 stat 到源文件本身，必须比较 inode 而不是直接判存在。
