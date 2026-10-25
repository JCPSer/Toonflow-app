# 素材库库导航单一入口、跨库点击、详情非模态（STAR）

## Situation

首页素材库在项目库状态下点「全局」下的子目录，顶部下拉仍显示项目名、内容区「这个文件夹是空的」——实际是拿项目库去访问全局的路径。用户同时反馈：点击素材立刻弹出模态详情抽屉，遮住网格、拦截双击，且必须手动关闭，希望改成 macOS「显示简介」那种按需、非模态的查看方式。

## Task

1. 点哪个库的目录就切到哪个库，跨库点击不许串。
2. 顶部「切换素材库」下拉取消（首页 + 工作区），导航只留树。
3. 详情改为按需打开的非模态侧栏；单击只选中，双击文件打开预览、双击文件夹进目录。

## Action

- `AssetTreeView.vue`
  - 新增 `nodeIdentity()`，`toTreeNode` 与 `nodeKey` 共用，修掉分组模式下全局节点"渲染 id"与"高亮 key"不一致。
  - `nodeDirectory()`：`library === "global"` 一律返回 `undefined`（原来回落到当前项目目录，是串库根因）。
  - `isForeign()` 先比库再比目录；新增 `isOtherProject()` 只用于灰显与切项目。
  - `onNodeClick/onNodeDoubleClick` 增加跨库分支：发 `select-library(library, path)`，一次切库并落到目标目录。
  - 分组「项目」节点点击 = 展开/收起（删下拉后它是唯一的项目入口）。
  - `syncCurrentKey()` 按 `nodeIdentity` 计算；项目库根高亮用 `project:<dir>`，不再硬编码 `root:global`。
- `useAssetLibrary.ts`：`setLibrary(kind, path = "")` 支持一次写入 `{library, path}`，同库退化为导航；项目库不可用时允许切入（由空态说明原因），不再静默返回。
- `AssetToolbar.vue`：删除 `el-select`、`library` model、`libraryOptions`；「更多操作」增加「切换到全局库 / 切换到项目库」，补齐 folder 视图（树不渲染）的切库入口。
- `AssetContextMenu.vue`：新增 `detail` 命令与 `showDetail` prop，只有宿主能展示详情时才出现。
- `index.vue`：新增 `canShowDetail` prop、`show-detail` 事件；`⌘I / Ctrl+I` 打开选中项详情（放在输入框守卫之前）。
- `home/assetLibraryDialog.vue`：去掉单选自动弹抽屉的 watch，改为"打开后跟随选中、清空即关闭"；新增 `openDetail()`；素材库 dialog 在抽屉打开时禁用 Esc 关闭。
- `assetDetailDrawer.vue`：`el-drawer` 改为 `:modal="false"` + `modal-penetrable` + `:lock-scroll="false"`，不遮挡网格、不抢焦点。

## Result

- 项目库 → 点全局子目录：`library=global`、`path=角色`、高亮正确；工作区非分组模式双向都对。
- 首页与工作区都不再有库下拉；folder 视图可用「更多操作」切库；ghost 项目切入后显示「工作目录不存在」并可一键回全局。
- 单击只选中（抽屉宽度 0）；⌘I / 右键「显示详情」打开 440px 非模态抽屉，网格仍可点选、内容跟随；Esc 只关抽屉不关素材库；双击文件夹正常进入。
- `apps/web` 类型检查与构建通过，已按 desktop 主进程配方重打包并签名。

## 经验

- 多库共用一套树，"节点身份"必须同时包含库与目录；少一个维度就会在点击时用错上下文。
- 删掉一个入口前，先枚举"可达状态矩阵"：这次差点因为在 folder 视图不渲染树而丢掉切库能力。
- Element Plus 的 `:modal="false"` 不等于"不拦截点击"，无遮罩分支仍可能留一层透明层，需要 `modal-penetrable`。
- 把"选中"和"打开详情"解耦后，模态抽屉遮挡、双击被拦、手动关闭三个抱怨一起消失。
