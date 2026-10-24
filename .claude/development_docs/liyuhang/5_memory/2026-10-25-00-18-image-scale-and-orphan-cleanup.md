# 图片节点缩放 + 孤立素材回收（STAR）

## Situation

图片节点缺少缩放，用户只能额外拉一个自建「图片缩放」节点中转；同时删除节点后 `assets/<节点ID>/` 永久残留：画布 `provide("retainNodeFiles", true)` 让 `removeNodeFiles()` 成为空操作，只有画布菜单删除画布时才回收目录。实测一个项目 53 个目录 / 555 MB 中，35 个目录 / 266 MB 已无任何画布引用。

## Task

1. 把「倍率 + 长边≤、等比、lanczos」内置到图片节点工具栏，覆盖当前输出、原图保留、一档恢复。
2. 在进入工作区与撤销历史淘汰节点时回收无引用的 UUID 素材目录，不误删、不打断复制与生成。

## Action

**缩放**

- 新增 `imageScale.vue`：弹层 UI、尺寸计算（先倍率取整、再按长边夹取、只缩不放）、64 MP 输入期拦截、MIME 白名单（png/jpg/jpeg/webp，其余回退 PNG）、FFmpeg `scale=w:h:flags=lanczos` + 单帧输出、abort/kill、committed 清理。
- 子组件不写 `outputs`（`useNode()` 每次新建 ref 且按自身 handles 过滤，子组件写入无效），改为 `emit("applied")`；父组件比对 `fromUrl` 后写输出，并记录 `data.scale.previous/appliedUrl`。上传与 `setImage` 会清除记录，恢复按钮只在 `appliedUrl` 等于当前输出时出现。
- 不接 `batchCanvasHistory`：画布快照只保留 `label`，outputs 本就不在撤销历史里，一档恢复替代 ⌘Z。
- 工具栏图标化入口、全链路禁用、save/delete/`setImage` 守卫；删除时先 `cancel()` 中止并等待任务。

**素材回收**

- 抽出 `collectAssetReferences` 供 `getCanvasAssetDirectories` 与新清理共用；扫描不设深度上限、设 50 万工作量上限，超限时删除画布路径退化为只按节点 ID。
- 新增 `nodeAssetCleanup.ts`：单飞 + 候选合并 + 目录校验；引用来自全部画布 JSON（跳过 `.agent`、`.toonflowCopy*`）与所有实例 `getRetainedNodes()`（含撤销/重做）；删除前逐项目复核目录、复制状态与运行时引用；只删 UUID 目录；ENOENT 忽略、EBUSY 记日志。
- 触发：进入工作区（`canvasLoadedDirectories` 含空串或 `canvasReady`，1s 防抖，最多两次尝试）、历史 `commit` 裁剪 diff（800ms 防抖，带 directory）、文件树删除画布/文件夹后（候选提示）。
- 画布复制期间 `assetCopyInProgress()` 整体跳过；扫描遇到 400/404 的 `.json` 时整轮放弃（`failOnMissing`）。

## Result

- E2E：孤儿 B/C 被删、共享 `chat` 保留、被 `.toonflowCopy` 引用的 C 仍被删；空画布重开触发清理；缩放 50%/1024 长边/64 MP/gif→PNG/TIFF 经 ffprobe 取尺寸后转 PNG/恢复/参数记忆/关闭不中止/8000×6000/缩放中删除均通过，无半成品文件。
- `apps/web` 与 `imageNode` 类型检查、imageNode 构建通过。
- 未覆盖：101 步历史淘汰、文件树删除触发、EBUSY/扫描 404、打包 app 验证（未重打包）。
- 边界：gif 缩放会丢动画并转 PNG；`content.md` 正文内嵌路径与剪贴板旧快照不参与引用保护。
