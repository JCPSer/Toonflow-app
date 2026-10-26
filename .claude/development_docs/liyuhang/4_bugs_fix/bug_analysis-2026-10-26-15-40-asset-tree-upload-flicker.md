# Bug 分析：上传文件后目录树闪两下

日期：2026-10-26 15:40
状态：待评审

## 一、背景

素材库拖入文件上传完成后，左侧目录树会明显闪两下：整棵树先塌成根节点，再逐级长回来，连续发生两次。用户希望上传后目录树保持稳定。

## 二、现象

- 上传完成约 250 ms 后第一次闪烁，约再 500 ms 后第二次。
- 目录结构没有变化（只是新增文件），但树被整体重建。
- 同时右侧列表也会短暂清空（loading 遮罩），卡片消失一瞬。

## 三、已核实的事实

### 3.1 树的刷新方式

`AssetTreeView.vue:8-25` 用 `:key="refreshKey"` 绑定 el-tree；`index.vue:78` 把 `treeVersion` 传入。`treeVersion` 每 +1，整个 el-tree **实例被销毁重建**，已展开分支靠 `default-expanded-keys` 重新惰性 `getTree`，视觉上就是「塌下去再长回来」。

### 3.2 两次重建的来源

| 顺序 | 触发点 | 代码 | 说明 |
| --- | --- | --- | --- |
| 第一次 | 上传成功回调 | `index.vue:254` `useAssetUpload({ onComplete: refresh })` → `useAssetUpload.ts:41-44` 250 ms 防抖 → `useAssetLibrary.ts:331-339` `refresh()` → `refreshTree()` | 无条件 `treeVersion++`，且走**非静默** `loadList(true)`，会清空 entries |
| 第二次 | 文件系统监听 | `useAssetLibrary.ts:213-215` change 事件 → `scheduleSilentRefresh()`（500 ms 去抖）→ `flushSilentRefresh()`（177-199）→ 因为 `Date.now() - treeRefreshAt > 2000` 成立，再次 `refreshTree()` | `treeRefreshAt` 只在 `flushSilentRefresh` 里写，`refresh()` 不更新它，所以拦不住紧随其后的 FS 事件 |

`treeRefreshAt` 初值为 0（`useAssetLibrary.ts:65`），所以第一次上传必然命中 2 秒节流窗口之外。

### 3.3 事件数量不是主因

服务端 watcher 300 ms 合并 + 只推目录集合，单文件上传通常只产生 1 帧 change；且临时文件 `.write-*.tmp` 被忽略。也就是说「两下」不是事件风暴，而是**两条独立刷新路径各重建一次树**。

### 3.4 副作用

- 非静默 `loadList` 会清空 `entries/selection/cursor/total`（`useAssetLibrary.ts:258-270`），造成列表闪烁与选中丢失。
- 上传只会往已存在的目录写文件，不会改变目录结构，树本身不需要重建。
- 目录树没有骨架屏，重建期间就是「空树」，所以闪得明显。

## 四、根因

1. 上传完成用了「全量 refresh」，对目录结构无影响的操作用了最重的刷新方式。
2. 手动 `refreshTree()` 与 FS 节流刷新互不感知，`treeRefreshAt` 没有被统一维护，导致同一批变更触发两次整树重建。
3. 非静默刷新清空列表，放大了视觉抖动。

## 五、修复目标

1. 上传完成后目录树不发生任何重建，列表静默刷新（不清空、不丢选中）。
2. 任何真正需要重建树的操作（新建/删除/重命名/移动目录）只重建一次，并让 FS 节流窗口感知这次重建。
3. 不引入新的全局状态；刷新语义集中在 `useAssetLibrary`。

## 六、优先级与风险

- 优先级：P2（体验问题，不影响数据）。
- 难度：低。
- 风险：把上传后的树刷新改成「不刷新」后，若上传到的目标目录此刻是新建空目录（树里已存在），无影响；跨库上传仍需刷新对应库的树（现有上传目标始终在当前库当前目录）。

## 七、评审意见

用户评审通过（2026-10-26）；计数需实时，方案已改为增量补丁。
