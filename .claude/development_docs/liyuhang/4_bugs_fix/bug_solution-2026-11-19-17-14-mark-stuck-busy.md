# Bug 修复方案：标记后节点运行态卡死

- 时间：2026-11-19 17:14
- 关联分析：`bug_analysis-2026-11-19-17-12-mark-stuck-busy.md`

## 方案

### 1. 视口聚焦超时兜底（治本）

`revealNodeInViewport`：

```
await race([
  flow.setCenter(centerX, centerY, { zoom, duration }),
  sleep(duration + 600ms)
])
```

- 动画正常结束走原路径；被打断时最多多等 0.6 秒即返回。
- 所有调用方（标记、变化、全景、视频帧、画布工具建节点）一并受益，不再有可能被视口动画挂住的业务 await。

### 2. 失败清理不阻塞复位（加固）

`imageEditor.saveMark` 的 finally 调整顺序：

```
finally {
  operation = undefined
  busy = false
  if (!committed && workspace) await remove(...)  // 仅清理临时文件
}
```

即使清理请求挂起，节点也已经回到空闲。

## 测试

- 新增 web 单测：`revealNodeInViewport` 在 `setCenter` 永不 resolve 时仍能在约 700ms 内返回；`setCenter` 正常 resolve 时立即返回。
- 现有节点/画布测试回归。
- 节点 UMD、web 视图重建同步；服务端无改动。

## 发布注意

`nodeViewport` 与 `imageEditor` 都被打进图片节点 UMD，需要重建并同步 `Resources/app/nodes` 与 `/Applications/toonflow-data/nodes`；web 视图同步。

## 评审意见

| 评审人 | 意见 | 结论 |
| --- | --- | --- |
| 子 agent 评审 | 待填 | |
| 用户评审 | 待填 | |
