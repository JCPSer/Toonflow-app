# Bug 修复方案：回收孤立节点素材目录

## 一、背景与目标

见 `bug_analysis-2026-10-24-23-20-orphan-node-assets.md`。

目标：在「进入工作区」与「撤销历史淘汰节点」两个时机，回收 `assets/<UUID>/` 中不再被任何画布或撤销/重做历史引用的目录；撤销仍可用；只处理 UUID 目录；任何不确定都选择不删。

> 评审修订要点：画布复制存在「素材已复制、临时 JSON 未落盘」的窗口（C1）；`.agent` 与 `.toonflowCopy*` 不能作为引用来源（C2）；就绪判据不能依赖 `canvases.length`（I1）；历史回调只能来自 `commit()` 的裁剪 diff（I3）；扫描规则要与 `getCanvasAssetDirectories` 共用（I4/S1）；删除前要逐目录复核目录与运行时引用（I5）；ENOENT/EBUSY 的判定要写死（I6）。

## 二、总体设计

```
进入工作区（画布列表成功加载）
        │
删除节点 → 快照超过 101 个 → commit 裁剪 diff
        │
文件树删除画布/文件夹（performFileAction delete）
        │
        ▼
canvasHost.cleanup(directory, 候选 ids?)
        │
  ┌─────┴──────────────────────────────────────────────┐
  │ 0. 画布复制进行中 → 整体跳过（下一轮再试）          │
  │ 1. 递归读取画布 JSON（跳过 assets/.agent/.toonflowCopy*）│
  │ 2. 收集引用：节点 ID + data 中的 assets/<名称>      │
  │ 3. 合并运行时引用：所有实例 getRetainedNodes()      │
  │ 4. 列 assets/，筛 UUID 目录、未被引用、命中候选     │
  │ 5. 逐个删除：删前复核目录 + 运行时引用 + 复制状态   │
  └────────────────────────────────────────────────────┘
```

## 三、引用收集（共用实现）

### 3.1 抽取 `collectAssetReferences`

把 `apps/web/src/pages/workspace/canvasFile.ts` 的扫描逻辑抽成：

```
collectAssetReferences(nodes, visited?): Set<string>     // 返回小写名称
  for node of nodes:
      refs.add(lower(node.id))
      遍历 node.data（栈 + WeakSet，不设深度上限）
          字符串 → 归一化反斜杠、去空段与 "."；parts[0] === "assets" 且 parts[1] 合法
                  且不含 ".." → refs.add(lower(parts[1]))
  遍历工作量上限（节点数 × 值数，例如 50 万）→ 超限抛错，整轮放弃
```

- `getCanvasAssetDirectories(nodes, retainedNodes)` 改为调用同一函数（只取 `retainedNodes` 的引用），行为不变，避免出现第二套规则（评审 I4/S1）。
- **不设深度上限**：节点 `data` 里存在 `promptModel`、`outputs`、`anchors` 等深层结构，裁剪任何一层都可能误删。

### 3.2 画布来源

```
readCanvasFiles(files, "", { skipDirectories: [".agent"], skipPrefixes: [".toonflowCopy"] })
```

- 给 `readCanvasFiles` 增加可选扫描过滤，默认行为不变。
- 跳过 `.agent`（与 `canvasMenu` 的目录树过滤一致）与 `.toonflowCopy*`：崩溃残留的临时画布引用的是旧节点 ID，若计入会永久保护一批本应回收的目录（评审 C2）。
- 不带 `onError`：声明为画布但结构非法的文件、以及 400/404 之外的 IO 错误，都会使整轮放弃（宁可漏清）。

### 3.3 运行时来源

```
for panel of instances.values()
    for node of panel.getRetainedNodes()   // 当前节点 + 撤销/重做快照
        收集 id 与 data 路径引用
```

## 四、清理执行

```
cleanup(directory, candidates?):
  每次调用先校验 workspaceStore.project?.directory === directory，否则丢弃候选

  串行化：同一 directory 只允许一轮；进行中则合并候选，结束后补跑一轮
  0. 若 copyCanvasFiles 正在执行（assetCopyInProgress()）→ 不标记完成，直接返回（下轮再试）

  refs = collectReferences(all canvases + live retained)
  entries = files.list("assets")             // 404/ENOENT → 返回（本目录没有素材）
  targets = entries
      .filter(type === "directory")
      .filter(name 匹配 UUID 正则)
      .filter(candidates 为空 或 candidates 含 lower(name))
      .filter(!refs.has(lower(name)))

  for name of targets:
      if (currentDirectory !== directory) return
      if (assetCopyInProgress()) return
      if (runtimeReferences().has(lower(name))) continue      // 删除前内存补查
      files.remove(`assets/${name}`, true)
          - 404 且 data.code === "ENOENT" → 忽略
          - 409 且 data.code === "EBUSY"  → 记入 failures，下次再试
          - 其他 → 记入 failures
  汇总失败仅 console.warn
```

- UUID 正则：`/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`。
- 共享目录 `chat`、`chatImages`、`generated`、`imported` 与任何非 UUID 目录天然不命中。
- 删除前重算 `runtimeReferences()` 只读内存（`getRetainedNodes` + 路径扫描），用于挡住「引用收集完成 → 删除执行」之间粘贴/恢复节点的时间差（评审 I5）。
- 静默执行，不弹窗；失败只在开发者工具输出。

## 五、触发点

### 5.1 进入工作区

不用 `canvasListReady && canvases.length`（空白画布状态永不触发，列表加载失败也会置 ready）。改为监听 **画布列表成功加载** 的信号：

```
watch([() => canvasLoadedDirectories.value.includes(""), () => activeInstance.value?.canvasReady, () => project?.directory], () => {
  if (!directory) return
  if (!canvasLoadedDirectories.value.includes("") && !activeInstance.value?.canvasReady) return
  scheduleCleanup(directory)            // 1s 防抖
}, { immediate: true })
```

- `canvasLoadedDirectories` 只在 `listCanvases` 成功后写入 `[""]`（`canvasMenu.vue:332`），比 `initialized` 可靠；直接打开指定画布（`initialCanvasId` 提前 return）时用 `canvasReady` 兜底。
- 成功完成一次后按 directory 记录，`canvasHost` 重挂（A→B→A）会重置，等价于「每次进入工作区一次」，文档不再写「每个应用会话一次」。
- 防抖 timer 在 `lifetime`/`onScopeDispose` 清理。

### 5.2 撤销历史淘汰节点

`useCanvasHistory(flow, binding, options?)`：

```
commit():
    ...现有裁剪与 nodeReferences/edgeReferences 同步...
    dropped = 本次从 nodeReferences 删除的 id
    if (dropped.length) options?.onNodesDropped?.(directory, dropped)
```

- **只**在 `commit()` 的 diff 处上报；`watch(binding)` 里的 `nodeReferences.clear()` 不上报（评审 I3）。
- 回调带 `directory`；host 按 directory 合并 800ms 防抖，切换项目时旧候选不会落到新目录（评审 S6）。

### 5.3 文件树删除画布/文件夹

`performFileAction` 的 delete 分支在 `files.remove(path, true)` 成功后：

```
removedNodeIds = stored.canvases.flatMap(canvas => canvas.data.nodes.map(node => node.id))
                 + 受影响实例的 getRetainedNodes()（删除前采集）
requestNodeAssetsCleanup(directory, removedNodeIds)
```

- 该路径当前完全不回收素材（评审 I2），接上后与画布菜单删除行为一致。
- 候选只是提示，cleanup 仍会全量重算引用，绝不依据候选直接删。

## 六、画布复制保护（评审 C1）

```
canvasFiles.ts:
  let assetCopyDepth = 0
  export function assetCopyInProgress() { return assetCopyDepth > 0 }

  copyCanvasFiles(...):
      assetCopyDepth++
      try { ...先复制素材、再写临时 JSON、最后 rename... }
      finally { assetCopyDepth-- }
```

- 复制期间 cleanup 整体跳过，包括删前检查；复制结束后由下一次触发（历史淘汰/下次进入）补扫。
- 不依赖「扫描临时目录获得保护」，因为临时目录恰恰要跳过（C2）。

## 七、并发与安全

| 场景 | 处理 |
| --- | --- |
| 同一目录重复触发 | 单飞 + 候选合并 + 1s/800ms 防抖 |
| 画布复制进行中 | `assetCopyInProgress()` 时跳过整轮与逐项删除 |
| 切换/关闭工作区 | 入口与每个删除前都比对 `project.directory` |
| 画布 JSON 损坏 | 整轮放弃，不删任何目录 |
| 节点生成中 | 部分节点删除时不会 abort（图片节点是「忙则拒绝删除」，视频/音频只挡 busy），服务端可能在 abort 后仍 `mkdir` 并写盘：最坏结果是「目录被清后又被重建为空目录」或删除撞 EBUSY；后者记日志，下次再试 |
| 删除失败（权限/占用） | 记录并跳过，不重试、不弹窗 |
| 与「删除画布」重复清理 | `remove(..., true)` + 忽略 ENOENT |
| 多窗口同一项目 | 以磁盘画布与当前窗口运行时引用为准；其它窗口未落盘的改动属极端场景 |

## 八、UI 设计

无新增界面。唯一可见变化是磁盘占用下降；失败只在开发者工具输出 warning。

## 九、明确不做 / 已知失效面

- 不扫描 `content.md` 等正文里内嵌的 `assets/<id>/...` 路径（用户选择忽略）。
- 文档面板里已打开的节点正文标签页，节点目录被回收后读取会失败。
- 剪贴板中保存的节点快照粘贴后仍指向旧路径，源目录被回收后图片缺失。
- 不做服务端 GC：撤销/重做历史只存在于前端，打开时的全量扫描也依赖前端运行时；服务端另做一套会与真实状态脱节。
- 不清理 `assets/chat`、`chatImages`、`generated`、`imported` 与非 UUID 目录。

## 十、修改文件

| 文件 | 变更 |
| --- | --- |
| `apps/web/src/pages/workspace/canvasFile.ts` | 抽出 `collectAssetReferences`，`getCanvasAssetDirectories` 改为复用 |
| `apps/web/src/pages/workspace/panels/canvas/canvasFiles.ts` | `readCanvasFiles` 支持跳过目录/前缀；`copyCanvasFiles` 加复制期保护标记 |
| `apps/web/src/pages/workspace/panels/canvas/nodeAssetCleanup.ts` | 新增：引用收集、UUID 判断、逐项复核、单飞与候选合并、错误分类 |
| `apps/web/src/pages/workspace/panels/canvas/canvasHost.vue` | 提供清理入口；进入工作区触发；文件树删除后触发；防抖与随 scope 清理 |
| `apps/web/src/pages/workspace/panels/canvas/useCanvasHistory.ts` | 新增 `onNodesDropped(directory, ids)`，只在 commit diff 上报 |
| `apps/web/src/pages/workspace/panels/canvas/index.vue` | 注入清理入口并传给历史回调 |

服务端零改动，复用 `/api/workspaces/files/{list,remove}`。

## 十一、测试计划

| # | 用例 | 期望 |
| --- | --- | --- |
| 1 | 手工创建 `assets/<随机UUID>/x.png` 后进入工作区 | 目录被删除 |
| 2 | 删除有图片的节点后立即 ⌘Z | 图片仍在，撤销成功；目录未被删 |
| 3 | 删除节点后继续操作，第 102 个快照把最旧快照裁掉 | 该节点目录被删除，无需重启 |
| 4 | 复制画布进行中触发清理（大画布、慢磁盘） | 新目录不被删，复制结果图片完整 |
| 5 | 残留 `.toonflowCopy<uuid>/` 引用了旧节点 | 旧节点目录按真实画布判断，不被临时目录永久保护 |
| 6 | 文件树删除整个画布文件夹 | 本会话内回收该画布独占目录 |
| 7 | 删除最后一个画布后的空白画布状态 | 清理仍会触发 |
| 8 | 手动复制画布 JSON（节点 ID 相同，两个画布共用目录） | 目录保留 |
| 9 | 节点 `data.textPath` 指向另一节点目录 | 被指向目录保留 |
| 10 | 声明为画布但 JSON 结构损坏 | 不删除任何目录，仅日志 |
| 11 | `assets/chat`、`.agent`、自建非 UUID 目录 | 全部保留 |
| 12 | 清理期间切换工作区 | 立即停止，不跨目录删除 |
| 13 | 删除时命中 EBUSY | 记日志，下次进入工作区再清 |
| 14 | 清理期间粘贴引用旧路径的节点 | 运行时补查命中，目录保留 |
| 15 | 无 `assets/` 目录的新项目 | 静默跳过 |

## 十二、评审意见

| 评审人 | 意见 | 结论 |
| --- | --- | --- |
| 子 agent | C1/C2、I1–I8、S1–S7 | 已逐条修订：复制期保护、扫描跳过名单、就绪判据、扩散回调来源、共用扫描、删前复核、错误码写死、未知生成竞态与失效面如实记录 |
| 用户 | 待填写 | 待填写 |
