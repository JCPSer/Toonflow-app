# 方案：图片/视频历史记录支持删除

## 目标

`mediaHistory.vue` 增加单条删除：物理删除文件 → 列表移除 → 选中项与页码回落 → 若删的是当前结果，通知节点清空输出。

## 组件改动（mediaHistory.vue）

### 新增事件

- `clear`：被删除的记录就是节点当前结果时发出，宿主持有者据此清空自己的输出。

### 新增状态

- `deleting`：删除进行中，用来禁用列表项删除图标、底部删除按钮与「设为当前结果」。
- `actionError`：删除失败提示，与列表加载失败（`loadError`）分开，避免删错一条就把整个列表判成加载失败。

### 交互结构

```
[历史列表]                 [预览区]
 ┌───────────────┬───┐
 │ v1.mp4 当前结果│ 🗑 │ ← 行悬停/聚焦时才显示删除图标
 │ v2.mp4        │ 🗑 │
 └───────────────┴───┘
 [分页]

 底部： [删除]（左）            [关闭] [设为当前结果]（右）
```

- 行删除图标：绝对定位在行右侧，`opacity: 0 → 1` 由 `:hover` / `:focus-within` 触发；行文本右侧预留 34px 避免压字。
- 底部删除按钮：`type="danger" plain`，`deleting` 时显示 loading。

### 删除流程（伪代码）

```
removeItem(item):
  if disabled || loading || deleting: return
  index = items.indexOf(item)
  deleting = true; actionError = ""
  try:
    workspace.remove(item.url)          // ENOENT 视为已删除，继续后续收敛
    if isCurrent(item): emit("clear")   // 节点侧清空输出
    remaining = items - item
    selected = remaining[min(index, remaining.length-1)]
    page = min(page, ceil(remaining.length / pageSize))
  catch e: actionError = e.message
  finally: deleting = false
```

要点：

- 删除前先记录 `index`，删除后用同一位置选下一个；删最后一条则选新的最后一条；删空则 `selected` 为 `undefined`，弹窗切到「暂无历史记录」空态。
- `ENOENT` 不报错：文件可能已被外部删除，收敛列表比报错有用。
- 删除后 `useWorkspaceFiles.remove()` 会失效该路径的 URL 缓存，重新 `acquireUrl` 不会读到旧内容。

## 节点侧改动

- 视频节点：`@clear="outputs.video = undefined"`。
- 图片节点：`@clear="outputs.image = undefined"`。

`nodeSkeleton` 的 `watchEffect` 会把 `outputs` 同步进 `node.data.outputs`，因此 JSON 序列化后该 handle 消失，重开画布不会恢复悬空引用；同时 `outputFile` 计算属性变空 → 预览清空、依赖输出的动作按钮（提取音轨/截帧/下载等）自动禁用。

## 不做的事

- 不做二次确认、不做回收站恢复（已与用户确认「直接删除」）。
- 不改服务端删除接口：`DELETE /api/workspaces/files/remove` 已满足需求，节点素材目录不属于受保护的 library 路径。

## 风险与兜底

| 风险 | 兜底 |
| --- | --- |
| 副本/粘贴节点只换 ID，输出仍指向原节点文件；直接删会毁掉原节点素材 | `isOwned()` 校验 `assets/<本节点id>/` 前缀，非归属文件不给删 |
| 删除时文件被外部删除 | `ENOENT` 静默收敛 |
| 列表项是按钮，不能再嵌按钮 | 行改为「包裹 div + 两个兄弟按钮」，图标绝对定位 |
| 触屏无 hover，隐藏的删除按钮仍可命中 | `@media (hover: none)` 常显 |
| 删除请求跨弹窗关闭/重开 | `actionToken` 代际校验，旧请求不改写新列表 |

## 评审意见

（待用户填写）
