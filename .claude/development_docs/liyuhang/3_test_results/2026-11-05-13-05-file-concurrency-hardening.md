# 测试结果：文件并发冲突处理加固

- 时间：2026-11-05 13:05（13:12 部署）
- 对应：`../1_requirements_matrix/2026-11-05-13-05-file-concurrency-hardening.md`、`../2_requirements_solutions/2026-11-05-13-05-file-concurrency-hardening.md`

## 1. 自动化

| 项目 | 结果 |
| --- | --- |
| `bun test src/lib/busyRetry.test.ts` | 10 pass / 0 fail（EBUSY 识别、空响应体、4 次上限、attempts=1、退避序列 60/120/240、baseDelay=0、非 EBUSY 立即抛、抖动） |
| `bun test`（apps/web 全量） | 61 pass / 0 fail |
| `bun test src/lib/responseFormat.test.ts`（server） | 4 pass / 0 fail（EBUSY→409+data.code、EBUSYTIMEOUT 非重试、EEXIST、未知 500） |
| `bun run typecheck`（web） | 仅剩既有 `@/agentRuntime` 报错 |
| typecheck（server / desktop） | 通过 |
| `bun run build:desktop` | 成功；产物含 EBUSY 映射与新重命名逻辑 |
| 部署 | `app/bun/index.js` 与 `views/mainview/` 已同步（13:12），**未重启应用** |

## 2. 变更要点

- 服务端：`EBUSY → 409`，文案「文件正在被其他操作使用，请稍后重试。」（原来落到 500）。
- 客户端：`withBusyRetry` 包住写/快照写/重命名/复制/删除/建目录，仅对 `409 + data.code=EBUSY` 退避重试（4 次，60/120/240ms + 抖动）。
- 服务端：文件重命名改为原子 `rename`（同卷），先查目标存在性保持 EEXIST 语义；`EXDEV` 回退 clone 复制 + 删除。

## 3. 代码评审（子 agent）

- P1 大小写不敏感文件系统（APFS）只改大小写会被误判重名：重命名前比较 `dev+ino`，同一 inode 直接 `rename`；顺带补符号链接拒绝。
- P1 等待锁 30 秒超时会被当成可重试 EBUSY，重试 4 次会等约 2 分钟：`packages/file` 的等待超时改用 `EBUSYTIMEOUT`，仍映射 409，但客户端不重试。
- P2 重试预算（约 0.42s）小于底层 rename 的 5s 重试：已知，由用户操作重试兜底；不改。
- P2 TOCTOU（查目标与 rename 之间的外部写入）：应用内由 `lockWorkspaceFiles` 覆盖，外部进程窗口已记录为已知边界。
- P2 目录跨卷 rename 无 EXDEV 回退、递归删除失败重试可能 404：既有行为，未在本次范围内。

## 4. 待人工验证（需重启应用）

1. 两个客户端（桌面 + 手机远程）同时写同一文本文件：后到者短暂重试后成功，或稳定报「文件正在被其他操作使用」，不再出现 500。
2. 节点批量完成时（多个视频/图片同时落盘）无意外报错。
3. 文件树里重命名文件：正常；重命名到已存在名称仍提示「名称已被占用」。
4. 重命名过程中预览该文件：画面为旧文件或新文件，不出现损坏/空文件。
5. 跨卷重命名（工作区内的挂载点/外置盘）仍成功。

## 5. 已知边界

1. 目标存在性检查在文件访问队列之外，外部程序同时在目标位置建文件时仍可能被 rename 覆盖（应用内操作由 `lockWorkspaceFiles` 覆盖）。
2. 重试只针对 EBUSY；版本冲突（ESTALE）、名称冲突（EEXIST）不会自动重试，需要用户重新载入或改名。
3. 只读操作不参与 `busyFiles`，目录级重命名/删除仍可能与子文件读并发（表现为 404，不产生损坏数据）。
