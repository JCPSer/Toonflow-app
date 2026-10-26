# 修复方案：上传文件后目录树闪两下

日期：2026-10-26 15:55（16:50 按评审修订）
对应分析：`bug_analysis-2026-10-26-15-40-asset-tree-upload-flicker.md`

## 一、总体思路

上传只改目录内容、不改结构，因此上传完成时不重建树，只静默刷新列表；同时把「本次上传已处理过」这一信息告诉文件系统刷新通道，避免 500 ms 后又被重建一次。

## 二、详细设计

### 2.1 `refresh` 增加选项（`useAssetLibrary.ts`）

```
refresh({ tree = true, silent = false, suppressTree = false } = {}):
  if rootsFailed: await loadRoots()
  if tree: refreshTree()
  else if suppressTree: treeRefreshAt = Date.now()     // 抑制紧随其后的 FS 触发的整树重建
  await loadList(true, { silent })

refreshTree():
  treeVersion++
  treeRefreshAt = Date.now()
```

### 2.2 上传完成（`index.vue`）

```
const upload = useAssetUpload({
  selector,
  onComplete: () => refresh({ tree: false, silent: true, suppressTree: true }),
});
```

- 树不重建、不折叠；列表静默刷新，卡片不消失、选中保留。
- 紧随其后的 FS change 帧在 2 s 窗口内，不再触发整树重建。

### 2.3 节流命中时补一次延迟重建（评审新增）

`flushSilentRefresh` 当前在 2 s 窗口内直接跳过树重建，之后没有任何补偿，外部结构变更可能永远不会出现在树里。改为：

```
if now - treeRefreshAt > 2000:
    refreshTree()
else if not trailingTimer:
    trailingTimer = setTimeout(() => { trailingTimer = undefined; refreshTree() }, 2000 - (now - treeRefreshAt))
```

保证「最多延迟 2 s 更新」，而不是「可能永不更新」。上传路径因为写了 `treeRefreshAt`，同样只会被推迟、不会丢。

### 2.4 已知取舍

- 树节点上的 `childCount`（「N 项」）在上传后保持旧值，直到下一次树重建（工具栏刷新、结构变更、或 2 s 后的 trailing 重建）。愿意在实现时用 el-tree 节点级 reload 更新，但那是另一套改动，本次不做。
- 文件级操作（重命名/移动/删除文件）目前仍走 `refresh()` 整树重建，与本次「内容变更不重建树」的口径不一致，但不在本次修复范围；相关闪烁另开需求。
- 收藏/元数据仍保持原有的 `treeVersion++`（树星标依赖它），不改。

## 三、影响面

| 文件 | 改动 |
| --- | --- |
| `useAssetLibrary.ts` | `refresh` 选项、`refreshTree` 记录时间戳、trailing 重建 |
| `index.vue` | 上传 `onComplete` 改为静默 + 不重建树 |

## 四、验证要点

1. 拖入 1 个与 3 个文件：目录树全程不折叠、不重建；列表静默出现新文件（≤100 项目录）。
2. 上传后观察 2–3 s：没有第二次整树重建（DevTools 断点或日志确认 `treeVersion` 不变）。
3. 新建/重命名/删除目录：树重建一次。
4. 在 Finder 里新建目录：最迟 2 s 后出现在树里（trailing 生效）。
5. 收藏/元数据操作不引起树闪烁（保持原行为）。

## 五、评审意见

用户评审通过（2026-10-26）；实现时补了 `treeSuppressedUntil`，上传后 2.5s 内连补刷也跳过。

> 已采纳：上传路径补 `suppressTree` 写时间戳；节流命中改为 trailing 重建；明确 `childCount` 与文件级操作的取舍；不再改收藏/元数据刷新路径。
