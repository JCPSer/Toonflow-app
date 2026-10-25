# 需求方案：素材库全面整改（商用标准）

对应矩阵：`1_requirements_matrix/2026-10-25-02-39-asset-library-overhaul.md`

## 一、总体结构

```
画布工作区
 ├─ 素材库面板（停靠左侧 / 浮层，可切）
 │   ├─ 顶部工具栏：库切换 · 上传 · 新建文件夹 · 排序 · 视图切换 · 搜索 · 批量 · 回收站
 │   ├─ 树形视图：左目录树 + 右内容网格
 │   └─ 文件夹视图：面包屑逐级下钻 + 网格
 └─ 画布（拖拽素材直接建节点，保持现状）

首页「素材库」弹窗 = 同一套内容区放大版（树形/文件夹两视图通用）

磁盘
 ├─ 全局库：<data>/assets/            （现有，保留）
 │    ├─ .library/index.json         元数据（tags/note/favorite/trash）
 │    ├─ .trash/<id>/<原名>          回收站
 │    └─ .thumbs/<hash>.jpg          缩略图缓存
 └─ 项目库：<project>/library/        （新增，随项目走）
      └─ 同上结构
```

## 二、数据与接口

### 2.1 库根解析

```
resolveLibrary(req, { library, directory }):
  library === "project" → 必须带 directory；root = resolveWorkspace(req, directory) + "/library"
                          以 <root>/.library/index.json 作为素材库标记
                          若 library 已存在但无标记（用户自己的同名目录）→ 改用 library-assets，返回 fallback:true
  library === "global"  → root = <data>/assets
  之后所有相对路径都走 resolveWorkspacePath(root, path) + protectWorkspaceRoot
```

- 项目根下的 `library` / `library-assets` 同时受 `/api/workspaces/files/*` 保护：禁止删除、移动、覆盖（`protectWorkspaceRoot` 只挡根本身，需要额外的保留路径判断）。
- 所有「遍历项目文件」的服务端/前端扫描（画布扫描、orphan 清理、clone、workspace 搜索、mention 列举、画布树、文档树）都要跳过这两个目录。）

- 非库文件（`.library`、`.trash`、`.thumbs`）在列取时一律跳过，且禁止通过 API 直接读写（`assertUserPath`）。
- 项目库随项目目录移动；切项目时按 `directory` 重新解析。

### 2.2 元数据

`<root>/.library/index.json`：

```
{
  "version": 1,
  "entries": {
    "角色/女主/a.png": { "tags": ["女主"], "note": "", "favorite": true, "size": 812345, "mtimeMs": 1792..., "dataType": "image", "addedAt": ... }
  },
  "trash": {
    "<uuid>": { "path": "角色/女主", "name": "a.png", "deletedAt": ..., "size": 812345, "isDirectory": false }
  }
}
```

- 定位：`index.json` 是**可重建缓存**，不是唯一事实源。标签/备注/收藏是唯一不可重建的数据，接受「外部改名即丢失」并在 UI 提示。
- 写入：串行队列 + 临时文件 rename 原子替换；批量操作 200ms 合并一次落盘；move/mkdir/remove 后立即 flush。
- 对账：列取某目录时，磁盘有而索引无 → 补建；索引有而磁盘无 → 标 stale 并在下一次同目录列取时清理（不删磁盘）。
- 索引损坏：先把损坏文件改名 `.bak` 再重建，不覆盖原文件。
- 选型说明：`bun:sqlite` 虽是内置能力，但项目库可能位于 iCloud/OneDrive/网络盘，SQLite 的锁与 WAL 在这些文件系统上不可靠，还会产生 `-wal/-shm`。v1 用 JSON + 每项回收站 manifest；仅当全局库规模超过 2 万项或需要多窗口并发时，才考虑把全局库单独换成 sqlite。

### 2.3 回收站

```
删除（软）：同卷 fs.rename → <root>/.trash/<uuid>/<basename>（EXDEV 才回退 copy+unlink）
            每项写 <root>/.trash/<uuid>/.trash.json：{ path, name, deletedAt, size, isDirectory }
            索引里的 trash 只是缓存，restore/purge 以 manifest 为准
恢复：      .trash/<uuid>/<name> → <root>/<path>；父目录不存在则重建；同名自动加 " (2)"
彻底删除：  rm -rf .trash/<uuid>（manifest 一并删除）
清空：      遍历 trash 全部删除
```

- 目录整棵进回收站（不再要求"先删空目录"）。
- 回收站占用 = 索引 size 求和，工具栏展示。

### 2.4 REST 契约（全部在 `/api/assets`，默认 `library=global` 保持旧行为）

| 方法 | 路径 | 参数 | 说明 |
| --- | --- | --- | --- |
| GET | `/roots` | directory | 返回全局/项目两个根（项目根不存在则 `exists:false`） |
| GET | `/tree` | library,directory,path | 单层子节点（懒加载），含元数据与子项计数 |
| GET | `/list` | library,directory,path,cursor,limit,sort,order,query,type,favorite | 分页列取（复用现有游标机制，扩展到库根） |
| POST | `/mkdir` | — | body `{library,directory,path}`，支持任意父级 |
| POST | `/move` | — | body `{library,directory,source,target}`，target 为目标目录；禁止自身/子孙；跨库拒绝；source 可为数组，返回逐项结果 |
| POST | `/rename` | — | body `{library,directory,path,name}`；兼容旧 `target` 全路径 |
| PUT | `/save` | library,directory,path,overwrite | 原始字节上送（沿用 100MB）；前端用 XHR 取进度 |
| DELETE | `/remove` | — | body `{library,directory,path,permanent?,force?}`；默认进回收站；path 可为数组，返回逐项结果 |
| GET | `/trash` | library,directory | 回收站列表 + 占用 |
| POST | `/restore` | — | body `{library,directory,id}` |
| POST | `/purge` | — | body `{library,directory,id? ,all?}` |
| POST | `/meta` | — | body `{library,directory,path,tags?,note?,favorite?}`；`path` 可为数组批量 |
| GET | `/usage` | library,directory,path | 引用位置（画布/会话），供删除前提示 |
| GET | `/thumb` | library,directory,path,size | 缩略图（JPEG），缓存放 `<data>/cache/thumbs/<sha1(rel|size|mtime)>`，带 ETag 与 Cache-Control |
| GET | `/read` | 现有 | 保持；新增 library/directory 参数 |

统一错误：`{code, message}`，`EEXIST` 用于同名冲突（UI 自动改名后重试），`EREFERENCED` 用于引用保护（返回引用列表）。

### 2.5 安全收口

- 与 `/api/workspaces/files/*` 一致：JSON/写接口要求 `x-toonflow-workspace: 1`；项目库必须 `resolveWorkspace(req, directory)`；全局库不要求 directory 但同样要 header。
- **不禁用远程**：服务器部署、移动端、远程连接的工作区照常可用，不做「仅本机回环」限制。
- 媒体端点（`/read`、`/thumb`）允许同源 Origin/Referer 放行（`<img>/<video>` 无法带自定义头）；`download=true` 仍要求 header。
- 新路由用 `z.strictObject`；`validateFields` 默认剥离未知字段，否则旧前端传 `library` 会被静默吞掉。
- MCP 与 agent `assetOperator` 增加 `library`/`directory`（缺省 global），`delete` 增加 `force` 透传；描述同步改为「移入回收站」；三处大小上限统一 100MB。

## 三、UI 设计

### 3.1 面板外壳（复用 agent 面板）

现状 `floatingAgent.vue` 已实现 teleport + docked/floating + 八向 resize + 拖动 + 限界。方案：抽出 `workspace/components/floatingPanel.vue`（容器 + resize + dock 开关），`floatingAgent.vue` 与新的 `floatingAssetLibrary.vue` 共用。

- 停靠：右侧或左侧二选一（素材库默认左侧 360px，agent 默认右侧 420px，同时停靠时分列两侧）。
- 浮层：可拖动、可缩放，位置与尺寸按项目记忆；浮层不与工具栏重叠（自动夹取）。
- 最小宽 320 / 最小高 240；双击分隔条复位默认尺寸。

### 3.2 工具栏（两种视图共用）

```
[本项目 ▾]  [＋新建] [⬆上传]  [排序：名称 ▾]  [☰ 树形 | ▦ 文件夹]  [🔍 搜索]  [↻]  [⋮]
  批量模式：已选 3 项   [移动到…] [删除] [取消]
```

- 「＋新建」下拉：新建文件夹 / 在本目录下新建子文件夹（等价，作用于当前目录）。
- 「上传」→ 本地文件多选；同时支持把文件直接拖进内容区（整块高亮 + 松手位置对应的目录）。
- 「⋮」更多：回收站、显示隐藏文件（默认关）、刷新索引、清空回收站。
- 搜索框展开后按名称/标签/备注过滤，回车触发服务端搜索；清空恢复目录浏览。

### 3.3 树形视图

```
┌──────────┬───────────────────────────┐
│ 本项目    │ 工具栏                     │
│  ▾ 角色   │ ┌────┐ ┌────┐ ┌────┐      │
│    ▸ 女主 │ │缩略│ │缩略│ │缩略│      │
│  ▾ 场景   │ └────┘ └────┘ └────┘      │
│ 全局      │  [ 加载更多 / 滚动加载 ]    │
└──────────┴───────────────────────────┘
```

- 目录树**只放目录**，文件只在网格（避免大目录渲染上千个 tree 节点）。两个库根在同一棵 `el-tree` 中作为真实节点。
- 拖拽：树内移动用 `el-tree` draggable；网格卡片→树节点、网格→库根、空白区 drop 全部用自定义 payload（`application/x-toonflow-asset-move`）与自定义 drop 区，不依赖 el-tree 的跨树能力（它的拖拽状态是实例私有的，且只写 text/plain）。`allow-drop` 禁止自身/子孙/跨库。
- 右键：打开 / 重命名 / 移动到… / 新建子文件夹 / 上传到此 / 标签与备注 / 收藏 / 删除。
- 空白区右键：新建文件夹 / 上传 / 粘贴（内部剪切板）。

### 3.4 文件夹视图（Finder 式）

```
本项目 › 角色 › 女主                      [🔍] [＋] [⬆] [排序] [☰▦]
┌────┐ ┌────┐ ┌────┐ ┌────┐
│    │ │    │ │    │ │    │
└────┘ └────┘ └────┘ └────┘
```

- 面包屑可点击回退；根节点显示库名徽标（本项目/全局）。
- 网格单元：缩略图 + 名称 + 类型角标 + 收藏星标；悬停显示「⋯」菜单。
- 多选：单击选中，⌘/Ctrl 点选，Shift 区间选择，⌘A 全选，Esc 取消。
- 键盘：Delete 删除、F2/Enter 重命名、Backspace 上一级、方向键移动焦点。

### 3.5 管理页（首页弹窗）

- 弹窗内复用同一内容区，额外提供：左侧树（可折叠）、右侧详情抽屉（预览、尺寸、大小、修改时间、标签、备注、引用位置）、回收站页签。
- 批量：移动、删除、加标签、收藏。
- 空状态：区分「空目录」「搜索无结果」「索引未就绪」。

### 3.6 收藏入口

- 画布节点右键「收藏到素材库」→ 弹窗选择库（本项目/全局）+ 目标目录（可新建）→ 复制文件入库，原名冲突自动改名。
- 对话附件右键「收藏」→ 同上。
- 入库后 toast 提示「已收藏到 本项目 / 角色/女主」。

### 3.7 回收站

- 工具栏「⋮ → 回收站」打开回收站视图（同一内容区）。
- 每项显示原路径、删除时间、大小；操作：恢复 / 彻底删除；顶部：清空回收站（二次确认）、占用总量。

### 3.8 状态持久化

`stores/assetLibrary.ts`（persist key `toonflow.assetLibrary`，按 `directory` 分桶）：
`{ library, view, path, sortField, sortOrder, docked, width, height, expanded: string[], showTrash }`。

## 四、实现拆分

| 阶段 | 内容 | 依赖 |
| --- | --- | --- |
| P1（T1） | `utils/assets` 重构：库根抽象、元数据、回收站、缩略图、搜索、安全收口、接口清单 | 无 |
| P2（T2） | 前端面板外壳抽取、工具栏、树/文件夹两视图、拖拽、上传队列、批量、状态持久化 | P1 契约（可并行） |
| P3（T3） | 管理页、详情抽屉、回收站视图、收藏入口、引用保护提示 | P1 |
| P4（T4） | 集成测试、代码审查、文档归档、打包 | P1–P3 |

## 五、边界与异常

| 场景 | 行为 |
| --- | --- |
| 项目库目录不存在 | 首次访问自动创建；失败则提示并回退到全局库 |
| 同名冲突 | 上传/新建/收藏自动 ` (2)`；移动整目录冲突则中止并提示 |
| 移动到自身子目录 | 服务端 400 + 前端禁止落点高亮 |
| 删除被引用素材 | 409 `EREFERENCED` + 引用列表；二次确认后 `force=true` 进回收站 |
| 项目根已有同名 `library` 且无标记 | 不接管，改用 `library-assets` 并在面板提示 |
| 扫描超时/失败 | 视为「有引用」，返回 `checked:"partial"`，不放行删除 |
| 回收站恢复父目录已删 | 自动重建父级链条 |
| 索引文件损坏 | 降级为文件系统模式，提示「标签与收藏暂不可用」 |
| 缩略图生成失败 | 返回类型图标占位，不阻塞列表 |
| 超大目录（>5000 项） | 服务端分页，前端滚动加载；树懒加载只在展开时读一层 |
| 外部 Finder 改动 | 列取时对账补建条目 |
| 跨库拖动 | 拒绝并提示"请用收藏复制" |

## 六、测试计划

| # | 用例 | 期望 |
| --- | --- | --- |
| 1 | 新建项目库并上传 3 个文件 | 文件落 `<project>/library/`，索引生成，刷新后仍在 |
| 2 | 目录拖到另一目录 | 磁盘移动 + 索引路径同步 + 展开状态保留 |
| 3 | 拖到自己子目录 | 禁止，落点不高亮 |
| 4 | 任意目录右键新建子文件夹 | 在该目录下创建 |
| 5 | 删除目录（含文件） | 整棵进回收站；恢复后结构完整 |
| 6 | 彻底删除/清空 | 磁盘占用下降，索引清理 |
| 7 | 被 mention 引用的全局素材删除 | 阻止并列出引用；强制删除后进回收站 |
| 8 | 停靠/浮层切换 + 拖拽宽高 | 重启后按项目记忆 |
| 9 | 树形/文件夹视图切换 | 当前路径与选中状态保持 |
| 10 | 搜索"女主" | 服务端返回匹配项，分页正常 |
| 11 | 500 项目录滚动 | 分页加载，无卡顿 |
| 12 | 缩略图 | 首屏生成后二次打开命中缓存 |
| 13 | 非本机请求 `/api/assets/list` | 403 |

## 七、评审意见

| 评审人 | 意见 | 结论 |
| --- | --- | --- |
| 子 agent（2026-10-25 03:0x） | ① 树不要把文件放进去，el-tree 跨树/空白 drop 不可用；② 鉴权 local-only 会让服务器/移动端/远程全 403，且 `<img>` 无法带头；③ 回收站索引不是事实源，需每项 manifest；④ rename 对文件是 copy+unlink，删大文件会白拷；⑤ 缩略图缓存放库根会进项目克隆；⑥ 全局引用裸子串误报严重；⑦ 引用承诺范围要收窄（草稿/跨项目查不到）；⑧ 缺批量 API、移动到…、上传冲突策略、空态与键盘；⑨ `validateFields` 会剥离未知字段；⑩ 项目根 `library` 需服务端保护 + 全域扫描排除 | 已全部并入本方案（见对应小节） |
| 用户 | | |


## 八、实现后代码审查与修复

审查范围：73 个改动文件（服务端 + 前端），结论按严重度记录如下，均已指派修复。

| 编号 | 级别 | 问题 | 修复 |
| --- | --- | --- | --- |
| C1 | critical | `cors()` 全开放 + 自定义头可伪造，第三方网页可跨源读写全局素材库 | CORS 收为同源/无 Origin；资产接口一律要求同源，header 降级为第二层；MCP/远程/移动端分别验证 |
| C2 | critical | 生产构建上传失败会切到 mock 并提示“已保存” | 所有 mock 分支加 `mockEnabled`（仅 DEV）；生产直接报错 |
| I1 | important | 项目库素材的会话引用检测永远匹配不到 | 会话按 `library + path` 精确匹配，目录用前缀 |
| I2 | important | `checked:"partial"` 在 UI 不可见，超预算后永远删不掉 | 错误信息透传 `checked`，partial 弹确认并允许 `force` |
| I3 | important | 批量删除引用预检 N 次全量扫描 | 新增批量 usage 接口，一次扫描；前端批量只调一次 |
| I4 | important | `write/copy/mkdir` 与 Agent 文件工具未保护项目 `library` | 全部接入 `protectWorkspaceLibraryPath` |
| I5 | important | MCP 可传任意 directory 越权读写别的项目 | 服务端注入目标工作区并校验，schema 移除 directory |
| I6 | important | 回收站恢复丢失标签/备注/收藏 | manifest 保存 meta，恢复写回索引 |
| I7 | important | 媒体端点同源放行绕过项目边界，且 GET 会创建库目录 | 媒体打开库用 `create:false`，并限制目录必须是已存在工作区 |
| I8 | important | 切换画布/文档时素材库面板被强制关闭 | 移除 canvas 的全局可见性重置，文档面板补 `--assetWidth` 留白 |
| I9 | important | 大目录 tree/list 复杂度与 `truncated` 失真 | 列取加真实上限并返回 truncated，childrenCount 按需 |
| I10 | important | 视频卡片拉全量视频、图片缩略图强依赖 ffmpeg | 视频用 /thumb，图片回退策略按方案执行 |
| 其余 | minor | restore id 校验、EFBIG 状态、索引立即 flush、stale 清理、首页默认库、保存弹窗选库、composer 队列项目隔离、浮层位置持久化、跨库拖拽提示、批量 force 范围、标签长度 | 一并修复 |
