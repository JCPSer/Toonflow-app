# 需求方案：素材库与磁盘保持一致（外部改动自动同步）

对应需求：`1_requirements_matrix/2026-10-25-16-30-asset-library-external-sync.md`

## R2 变动监听与推送

### 服务端（新增 `utils/assets/watch.ts`）

```
watchers: Map<库根绝对路径, { watcher, subscribers, pending: Set<目录>, timer }>

subscribeLibraryChanges(root, onDirs):
  若该 root 没有 watcher：
      watcher = fs.watch(root, { recursive: true })
      监听器收到 (event, filename)：
          path = normalize(filename)
          跳过：内部目录（.library/.trash/.thumbs）、隐藏文件（.DS_Store）、临时文件（.tmp/~$）
          dir = parent(path)
          pending += { dir }                // 只记父目录，够前端定位
          防抖 300ms → 回调所有订阅者([...pending]) 并清空
  订阅者 +1；返回取消函数（-1，为 0 时关闭 watcher）

watcher 出错或 root 被删：关闭并通知订阅者 { type: "gone" }
```

要点：上传大文件时会连续触发大量事件，300ms 合并只推一次；同一个库根多标签页共用一个 watcher。

### 路由（新增 `routes/assets/events.ts`）

`GET /api/assets/events?library=global|project&directory=...`

- 返回 NDJSON 流（沿用 `routes/agent.ts` 的写法），首帧 `{"type":"ready"}`，20s 心跳空行。
- 变更帧 `{"type":"change","dirs":["角色",""]}`；库根消失帧 `{"type":"gone"}`。
- 连接断开即取消订阅。

### 前端

```
subscribeAssetChanges(selector, onEvent, signal)   // api.ts
  fetch + ReadableStream 逐行 JSON；3s 后重连；AbortSignal 控制

useAssetLibrary：
  active 为 true 时订阅；false / unmount 时断开
  收到 change：
      命中当前目录（dirs 含 currentPath 或 ""）→ 500ms 合并后 loadList(true)
      命中已展开目录 → 2s 节流 refreshTree()
  收到 gone → 显示空态错误
```

`AssetLibraryContent` 新增 `active` prop（默认 true）；首页传 `assetsMode`，工作区浮动面板传 `visible`，隐藏时不再监听。

## R3 元数据跟随 inode

```
LibraryEntryRecord / LibraryEntry 增加 dev、ino

reconcile(records) 前保证 inodeIndex 可用（Map<`${dev}:${ino}`, path>，索引变化时重建）
for r of records:
    entry = entries[r.path]
    if !entry && r.ino != null:
        oldPath = inodeIndex.get(key(r))
        if oldPath && oldPath !== r.path && entries[oldPath]:
            entry = entries[oldPath]
            迁移：delete entries[oldPath]；entries[r.path] = entry
    entry ? 更新 size/mtime/dataType/dev/ino 并清 stale
          : 新建（addedAt=now）
```

- 旧索引（没有 ino 的条目）在第一次扫描时补齐，无需一次性迁移脚本。
- inode 复用兜底：类型不同（文件↔目录）或 `size` 差异过大时不迁移，按新条目处理。
- API 内部的 rename/move 仍走原来的路径迁移（更精确），inode 只兜住外部改动。

## R4 缺失条目

- `listAssetEntries` 在"非搜索、未截断"时额外返回 `missing`：
  索引里父目录等于当前目录、但本次扫描不存在的条目（`stale: true`）。
- 前端网格把 `missing` 渲染成灰色卡片 + “缺失”徽标；右键“从索引移除”调用新增的 `DELETE /api/assets/index`（只删索引，不动磁盘）。
- 顶部提示条：`N 个素材已不在磁盘（在 Finder 中删除或移动）`，可一键清理。
- 不自动修改任何引用。

## R5 性能

| 位置 | 措施 |
| --- | --- |
| `treeAssetEntries` 的 childCount | 并发上限 4；结果缓存 `Map<绝对路径, {at, count}>`，TTL 2s |
| `listAssetEntries` 的扫描 | 目录级缓存（root+path）TTL 500ms，事件风暴下复用 |
| 事件推送 | 服务端 300ms 合并，前端 500ms 合并 |
| inode 映射 | 只在索引 dirty 时重建，不随每次请求重算 |
| 索引落盘 | 沿用 200ms 防抖 + 串行 flush |

## 测试计划

| # | 用例 | 期望 |
| --- | --- | --- |
| 1 | Finder 里往当前目录拖入一个文件 | ≤1s 出现在网格，无需手动刷新 |
| 2 | Finder 里删除当前目录文件 | ≤1s 从网格消失 |
| 3 | Finder 里重命名带标签的文件 | 标签/备注/收藏跟着新名字 |
| 4 | Finder 里把文件移到子目录 | 元数据跟随，旧路径索引被清 |
| 5 | 素材库隐藏（切到首页）时改文件 | 不刷新；切回来看到最新 |
| 6 | 上传 10 个文件 | 事件合并成 1~2 次刷新，不卡 |
| 7 | 1000 个文件的目录 list | 首屏 < 300ms；重复请求命中缓存 |
| 8 | 目录下 100 个子目录的 tree | 并发受限，不出现 100 个并发读 |
| 9 | 外部删除被引用的素材 | 网格出现“缺失”条目 + 顶部提示；引用不被改动 |
| 10 | 索引缺 ino 的旧库 | 第一次读取自动补齐，元数据不丢 |

## 评审意见

| 评审人 | 意见 | 结论 |
| --- | --- | --- |
| 子 agent（方案） | ① `fs.watch` 不能当唯一机制（FSEvents 合并/丢事件、网络卷不支持）② inode 只能兜同卷改名 ③ prune 与 missing 冲突 ④ 目录改名要整棵前缀迁移 ⑤ `.library` 在监听根内会自激 ⑥ 500ms 纯尾部防抖会饿死 ⑦ 心跳空行会打挂逐行 JSON ⑧ missing 别混进 items | 全部采纳：加"恢复/重连补一次刷新"；迁移加类型/大小校验与硬链接保护；prune 改 stale；过滤按路径分段；加 2s 上限；ping 帧；missing 独立数组 |
| 子 agent（代码） | ① `normalizeIndex` 丢 dev/ino/isDirectory/staleAt（重启后全失效）② 移动被当删除（buildInodeMap 跳过 stale）③ forget 不校验磁盘 ④ 目录删除后后代永不回收 ⑤ ino<=0 会全库同键 ⑥ 卸载后重连泄漏 | 全部修复：字段回读 + stale 参与 inode 匹配 + forget 先 lstat + prune 展开后代 + ino/dev>0 且类型/大小一致才迁移 + disposed 标志 |
| 用户 | 监听+防抖 / 跟随 inode / 标缺失 | 已采纳 |
