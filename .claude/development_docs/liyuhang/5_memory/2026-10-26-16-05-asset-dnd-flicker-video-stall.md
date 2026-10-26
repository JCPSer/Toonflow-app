# 记忆：素材库「上一级」拖拽 / 上传不闪 / 视频单播 / 文本流式节流

## Situation

- 素材库网格里的「上一级」卡片没有拖拽落点，文件/目录拖上去无反应。
- 拖文件上传到素材库后，左侧目录树会塌下去再长回来两次。
- 文本节点流式输出 + 视频播放时画布卡死，只能强杀应用。

## Task

1. 库内文件/目录拖到「上一级」= 移动到父目录，带高亮。
2. 上传完成不重建目录树，且「N 项」计数保持实时。
3. 降低文本流式对画布的重绘压力；全局同一时间只播一个视频，后台画布自动暂停。

## Action

- `AssetGridView.vue`：抽出 `highlightDropTarget / leaveDropTarget / commitDropTarget`，普通目录卡片与 `upCard` 共用；`upCard` 监听 `dragover/dragleave/drop`，落点 `parentPath`，高亮 key 用常量 `UP_DROP_KEY`。**不使用 `.stop` 修饰符**（会连带掐断 Finder 文件拖拽的冒泡），改为 handler 内 `stopPropagation`；文件拖拽在 `upCard` 上直接放行，仍上传到当前目录。
- `useAssetLibrary.ts`：`refresh({ tree, silent, suppressTree })`；`refreshTree()` 记录 `treeRefreshAt`；FS 节流命中时安排 trailing 重建（窗口结束补一次，避免事件被吞）；上传路径写 `treeSuppressedUntil`，2.5 s 内连补刷都跳过；新增 `countExtra` + `bumpCount`。
- `useAssetUpload.ts`：`onComplete` 改为回传 `{ targetPath, added }[]`，供计数补丁使用。
- `AssetTreeView.vue`：新增 `countExtra` 属性，`「N 项」= childCount + 增量`。
- `packages/nodes/textNode/src/index.vue`：delta 写本地 buffer，200 ms（>20 KB 时 400 ms）flush 到 `outputs`；收尾分三种（成功用 `result.text`、中断用 buffer、一个 delta 都没有则完全不写不存）；`save` 事件在生成中保存 buffer。
- `apps/web/src/lib/mediaPlayback.ts`（新增）+ `main.ts`：文档级捕获 `play`，暂停其它正在播的 `video/audio`；隐藏页面时全部暂停；`data-concurrent="on"` 豁免。
- `canvas/index.vue`：非活动画布切走时暂停画布内媒体。

## Result

- 实机：目录拖到「上一级」高亮并成功移动；上传后 `el-tree` 实例不变、计数就地 1→2；外部建目录约 3 s 内补刷；两段视频验证「后播暂停先播」。
- `vue-tsc` / `tsc` / web build / nodes build 通过；app 已重打包。
- 未验证：真实模型下长文生成帧率、素材库预览与画布视频的联动手测。

## 精度要点

上传会同时产生「目标目录」和「库根 `""`」两条 FS 事件（根 mtime/索引），所以上传抑制必须按「祖先包含」判断，否则永远命中不了；`countExtra` 的 key 必须用树节点身份 `library:path`（分组模式再带项目目录），否则同名目录跨库串计数。

`SessionManager.inMemory` 之外这类「传入数组会被原地修改」的坑在素材库也有镜像：`countExtra` 用整体替换而不是就地改对象，配合 Vue 的依赖追踪才能让 el-tree 行内计数立即刷新。
