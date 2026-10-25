# 素材库整改 + 节点加入上下文（STAR）

## Situation

素材库当时只是「全局 `<data>/assets` 的只读目录树」：画布内是一个挂在菜单下方的浮层（`assetLibrary.vue`），首页管理页复用同一份只读浏览（`assetBrowser.vue`）。移动/重命名共用一个 `POST /api/assets/rename`，删除只能删空目录，没有上传、回收站、标签、搜索、分页；面板宽高在样式里硬编码；`/api/assets/*` 没有任何本机/工作区鉴权——任何能访问该端口的进程都能读写真机目录。

使用侧同时存在两个高频摩擦：每次给画布加素材都只能先在根目录建目录再右键移动；想把某个节点的输出交给右侧 Agent 当上下文，必须手动打 `@` 逐级选画布→节点→输出口。

## Task

五条需求（用户原话归纳）：1) 目录树支持拖拽移动；2) 新建目录要能建在当前目录下；3) 交互优化，面板可拖拽放大而不是固定宽高；4) 不同项目要有自己的素材库，全局库保留；5) 管理页面要能编辑和新增素材。总体目标是「成为可商用的标准」。追加澄清：保留树形结构，同时要有类似电脑文件夹的目录形态，上方固定工具栏（上传、新建目录、排序、树形/目录切换等）。第二批需求：节点工具栏加一枚按钮，点击即把该节点输出作为 `@` 提及插入右侧 Agent 输入框（插入不发送，多输出时弹选择）。

## Action

服务端（`apps/server/src/utils/assets/`）：

- `roots.ts` 建立双根：全局 `<data>/assets` 与项目 `<project>/library`。项目库靠 `library/.library/index.json` 标记识别；`library` 被用户同名目录占用时自动退到 `library-assets`；两者都被无标记目录占用返回 409 `ELIBRARYOCCUPIED`，绝不改动用户目录。
- `libraryMeta.ts`：`index.json` 定位为「可重建缓存」（标签/备注/收藏/回收站元数据），串行写队列 + `writeAtomic`，损坏时从 `.bak` 重建，`reconcile`/`prune` 保持与磁盘一致。回收站每项 `.trash/<id>/.trash.json` 保存原路径与 meta。
- `library.ts`：分页/排序/搜索/过滤列表、单层树 + `childCount`、mkdir、movePath（同卷 rename，EXDEV 回退复制）、rename、save、read、remove（引用检测 → 回收站或永久，`force` 跳过扫描）、回收站 list/restore/purge、usage、importFileIntoLibrary。
- `usage.ts`：扫描项目画布 JSON 与 `.agent/sessions/*.jsonl`，token 精确匹配；预算 2000 文件/64MB/5s，结果带 `checked: complete|partial|unavailable`——partial 视为「可能被引用」，需 `force` 二次确认。
- `thumb.ts`：服务端 ffmpeg 出缩略图，缓存键 `sha1(real|size|mtime|size参数)`，ETag/Cache-Control；无 ffmpeg 返回 404，前端回退原始 `/read`。
- 鉴权（本轮评审的核心修复）：CORS 改为按请求计算、只允许同源 host，非法 Origin 直接 403；`guard.ts` 的 `assertAssetRequest` 移动端令牌放行，否则强制同源（Origin 优先、Referer 回退，以 Host 为准，不比较协议以兼容反代终止 TLS），非媒体端点再加 `x-toonflow-workspace: 1` 作为第二层标记。自定义头不再能单独授权。
- 批量契约：`move {source: string|string[], target}`、`remove {path, permanent?, force?}`、`meta {path, tags?, note?, favorite?}`；数组入参返回 `{items:[{ok,path,…}|{ok:false,path,error}]}`，字符串入参保持旧结构。
- 工作区侧：`workspaces/files/*` 的 write/copy/mkdir/remove/rename 对 `library` 路径返回 403 `EPROTECTED`；`resolveWorkspace` 媒体分支只放行「已存在且带素材库标记」的项目根，避免媒体端点变成任意目录读取器。

前端（`apps/web`）：

- `components/floatingPanel.vue` 从 floatingAgent 抽出，统一停靠/浮层/resize/拖动/位置持久化；素材库与 Agent 面板共用。
- `stores/assetLibrary.ts` 按项目分桶持久化（library/view/path/sort/order/docked/width/height/expanded），无 directory 时默认全局库。
- `pages/workspace/panels/assetLibrary/`：工具栏、树形视图（侧边目录树 + 网格）、文件夹视图（面包屑下钻）、右键菜单、移动对话框（目标树选择）、标签备注对话框、引用确认对话框、回收站视图、预览、上传队列（XHR 带进度）、收藏弹窗；自定义 DnD `application/x-toonflow-asset-move`（库内移动）与 `application/toonflow-asset`（拖到画布）分离。
- 首页 `assetLibraryDialog.vue` 重写复用内容区，新增 `assetDetailDrawer.vue`；对话附件与节点产物都可「收藏到素材库」。
- 节点上下文：`packages/nodeScaffold/src/nodeSkeleton.vue` 工具栏加 `IconAt` 按钮（无输出禁用），画布 `provide("nodeAgentContext")` 负责取实时输出、单输出直插/多输出弹端口菜单；`stores/agentComposer.ts` 用 `{mention, directory}` 队列传给 `messageInput.insertMentions`，复用既有去重与 20 条上限。

## Result

- 接口冒烟 17 项、界面点验 11 项全部通过（详见 `3_test_results/2026-10-25-10-55-asset-library-overhaul.md`）：停靠面板左移画布、双库树懒加载、缩略图、目录内新建、软删除/回收站/恢复、项目库拖到画布建节点、节点 @ 按钮的禁用/启用/插入/去重。
- 代码评审发现 2 个 critical（CORS `*` 可跨源读写全局库；生产构建下上传失败会走 mock 假成功）与 10 个 important（项目库引用匹配不到、partial 删不掉、批量 usage、写接口未保护 library、MCP 可传任意 directory、回收站丢标签、媒体 GET 建库、切画布强制关面板等），已全部修复并复验：伪造 Origin 403、同源 200、媒体端点 Referer-only 200、跨源 Referer 403。
- 已知限制：索引是缓存（外部改名会丢标签）；全局库无 directory 时只扫 `<data>/.agent/sessions`；`thumb` 固定 256px；克隆项目会复制 `library/`。

## 经验

- 素材库这类「文件系统即真相 + 元数据是缓存」的场景，索引必须允许完全重建，否则一次外部改动就永久脏。
- 安全收口时「同源」不能用 CORS 头表达——CORS 是浏览器自愿遵守的约定，服务端必须自己判断 Origin/Host，且自定义头不能当授权凭证。
- 媒体端点（`<img>`/`<video>`）带不了自定义头，鉴权必须单独设计分支（同源 + Referer 回退 + 目录标记），不能用同一套 header 规则一刀切。
- 面板从「切走就关」改成「常驻」时，布局 reflow 依赖的 CSS 变量必须由面板 `resize` 事件持续上报，否则会出现面板浮在画布上、画布不左移的假象。
