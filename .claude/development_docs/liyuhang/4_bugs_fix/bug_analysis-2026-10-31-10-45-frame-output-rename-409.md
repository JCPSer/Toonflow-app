# Bug 分析：开启首/尾帧输出报 409

- 时间：2026-10-31 10:45
- 模块：`packages/nodes/videoNode/src/frameOutput.ts`（首/尾帧输出）
- 发现人：liyuhang（真机重启后首次验证）

## 1. 现象

重启应用后在视频节点上勾选「尾帧输出」，弹出：

> 开启尾帧输出失败：Request failed with status code 409

端口不出现，磁盘上没有任何 `frame-first.jpg` / `frame-last.jpg`，画布里的 `node.data.frameOutputs` 也没有写入。

## 2. 根因

`useFrameOutputs` 的落盘流程是「写唯一临时名 → 校验文件存在 → `rename` 到固定名」。而**工作区的 rename 接口是「不覆盖」语义**：

- 路由 `apps/server/src/routes/workspaces/files/rename.ts`
- 实现 `apps/server/src/modules/localRuntime/workspace/files.ts:41-56`，文件走 `copyFileClone()`
- `copyFileClone` 使用 `COPYFILE_EXCL`（`packages/file/src/index.ts:50-53`）
- 错误映射 `apps/server/src/lib/responseFormat.ts:34`：`EEXIST → 409`

因此**只要目标文件已存在，`rename` 必然 409**。首次抽帧目标不存在能成功；此后任何一次重抽——关掉再开、切换视频、点「重新抽取」——都会撞上。

触发链：

```
toggle("last", true)
  └ useFrameOutputs.extract()
      └ files.rename(tmp, assets/<id>/frame-last.jpg)   ← 目标已存在 → 409 EEXIST
          └ catch → ElMessage.warning("开启尾帧输出失败：Request failed with status code 409")
```

## 3. 排查过程（已复现）

在独立端口 4011 起了一份隔离服务（独立数据目录，不影响用户正在运行的应用），用 curl 复现：

| 步骤 | 结果 |
| --- | --- |
| `rename` 到**不存在**的目标 | `200`，成功 |
| `rename` 到**已存在**的目标 | `409 {"code":409,"data":{"code":"EEXIST"}}` |
| 先 `remove` 目标再 `rename` | `200`，成功 |

## 4. 附带问题

客户端用 `error.message` 展示错误，axios 只给出「Request failed with status code 409」，真正原因（「这个名称已经被占用了…」）被丢掉，导致定位困难。

## 5. 影响面

- 只影响首/尾帧输出，其它功能不经过这条 rename。
- 数据无损坏：失败时临时文件被清理，画布配置不写入。

## 6. 优先级 / 难度 / 风险

| 项 | 评估 |
| --- | --- |
| 优先级 | P0（功能完全不可用） |
| 难度 | 低 |
| 风险 | 低（改动集中在抽帧落盘的一步） |
