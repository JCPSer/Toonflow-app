# 素材库首开竞态、首页项目分组、DEV mock 收窄（STAR）

## Situation

打包运行时打开素材库面板，顶部出现「找不到这个文件或文件夹」红色横幅且不自动消失，同时右侧显示"这个文件夹是空的"。首页素材库只能看到全局库，项目素材完全不可见（用户明确反馈"首页没有分项目"）。另外压测发现首次打开项目库会**额外创建 `library-assets`**，之后读写分散到两个根，表现为"刚上传的素材不见了"。

## Task

1. 首开不报错，不需要人工点重试；项目库不存在时自动创建并显示空库。
2. 同一项目只能有一个库根，兼容"用户真的占用了 library"的既有语义。
3. 首页素材库按项目分组、点开才懒加载。
4. DEV 演示数据必须显式开启，避免用假数据做功能判断。

## Action

- `utils/assets/roots.ts`：`getProjectLibraryLayout` 按项目目录加进程内互斥（Map + 链式 Promise，结束后自清理）。顺序改为 **primary 已认领 → fallback 已认领 → primary 不存在 → 残留补标记 → 占用判 fallback → 409**。`fallback` 一旦认领就固定，避免用户清空 `library` 后素材从界面消失。残留判据收紧为"只有系统噪声 + `.library`，且 `.library` 里只剩临时文件"。`create=false` 且已认领时走快路径不进锁，避免首屏缩略图排队。全局库不再受无效项目目录影响（服务端忽略、前端 `selector()` 不传 directory）。
- `useAssetLibrary.ts`：首屏失败自动重试一次（仅瞬时错误：网络/ENOENT/5xx，且只对首次 reset）；**持久化 path 指向已删除文件夹时自动退回根目录**（这才是横幅的真凶）；库根错误与列表错误分开保存；空态新增 `error` 类型（带重试 / 切全局库），有数据时才用顶部横幅；切库清空上一条错误；目录代次（`directoryToken`）防止切项目后旧请求/旧重试回写。
- `AssetTreeView.vue`：新增 grouped 模式（传入 `projects` 才启用）。根节点为「项目（分组）+ 全局」，展开分组才列项目，展开项目才请求该项目的库；节点 id / `currentKey` 在 grouped 模式下带目录；跨项目节点的拖拽、右键、落点全部禁用；点击非当前项目的目录先切项目再进入；分组展开状态用本地集合，不被"按目录分桶"打散。
- `index.vue` / `home/assetLibraryDialog.vue`：面板接受 `projects` / `projectName`，`onSelectProject` 先把目标目录的库状态设为项目根再通知父级换目录；首页默认全局库，`@closed` 重置选择。
- `api.ts`：`mockEnabled` 改为 DEV + 显式开关（`?assetMock=1` 或 localStorage `toonflow.assetLibrary.mock=1`），localStorage 读取包 try/catch。
- `AssetGridView.vue`：列表接口不返回 `childCount` 时不再显示"0 项"，改为显示"文件夹"。

## Result

- 并发 12 路 × 5 轮首开：只生成 `library/`，无 `library-assets`、无 ENOENT（修复前 3 轮命中 2 轮）。
- 占用场景仍正确退回 `library-assets`；历史残留（只有 `.library`）会被认领回 `library`。
- 界面实测：已删除目录的持久化 path 自动回根、无横幅；首页出现「项目」分组并懒加载；两个项目同名 `角色` 互不干扰；跨项目点击先切项目；ghost 项目报错后可正常切回全局库。
- server/web 类型检查与生产构建通过，已按正确配方（desktop 主进程 bundle）重打包并启动验证。

## 经验

- "文件系统即真相"的场景里，创建动作必须与判定动作原子化；否则并发下"目录已建、标记未落"会被解释成完全不同的语义。
- 语义优先级要按用户损失排序：已经认领过的 fallback 高于"看起来是空的 primary"，否则一次清理就会让素材"消失"。
- 前端持久化的浏览路径必须当成不可信输入：目录被删、项目被移动、换项目都会命中，正确的反应是退回根目录而不是报错常驻。
- 复用同一套树组件做"多根"时，节点身份必须带根（directory），否则同名目录会撞 key，右键/拖拽会用错上下文。
