# Bug 方案：库导航单一入口、跨库点击、详情非模态

对应分析：`bug_analysis-2026-10-25-14-32-asset-library-nav-and-detail.md`

## B1 跨库节点（树）

目标：节点的"库身份"必须和它的"目录身份"一致；点哪个库的节点就切到哪个库。

```
identity(library, directory, path):
    grouped && library === "project" && directory ? `${library}:${directory}:${path}`
                                                  : `${library}:${path}`

nodeDirectory(node):
    node.library === "global" ? undefined          // 全局库不携带任何项目目录
                               : node.directory ?? activeDirectory ?? directory

isForeign(node):
    node.library !== currentLibrary ? true         // 跨库一律视为外部
    grouped ? node.directory && node.directory !== activeDirectory : false
```

- `toTreeNode()` 与 `nodeKey()` 共用 `identity()`，修掉分组模式下全局节点"渲染 id 与高亮 key 不一致"。
- `onNodeClick()` 顺序：分组 → 项目根 → 根节点（切库 + 回根）→ **跨库节点（切库 + 落到该 path）** → 同库跨项目（切项目）→ 同库目录（导航）。
- `select-library` 事件增加第二个参数 `path`，父级 `setLibrary(kind, path)` 一次性写入 `{ library, path }` 再加载，避免"先回根再进目录"的两次请求与闪烁。
- `loadNode()` 对全局根/全局子节点请求 `{ library: "global", directory: undefined }`，服务端本就忽略 directory，前端也不再传。
- 跨库节点保持不可拖拽、右键屏蔽（库之间不支持移动，靠"收藏"复制）；`foreignNode` 样式沿用。

## B2 库切换入口唯一化

- 删除 `AssetToolbar` 的 `el-select.library-select`、`library` model、`libraryOptions` prop、相关 import 与样式。
- 删除 `index.vue` 的 `libraryModel` / `libraryOptions` / `projectOptionLabel`。
- `setLibrary()` 保留，只由两处调用：树根节点、空态的「切换到全局库」。
- 切库路径矩阵（改后）：

| 起点 | 目标 | 入口 |
| --- | --- | --- |
| 全局任意目录 | 项目库 | 树 →「项目」分组 → 点项目 |
| 项目库任意目录 | 全局 | 树 →「全局」根 |
| 工作区：本项目 | 全局 | 树 →「全局」根 |
| 工作区：全局 | 本项目 | 树 →「本项目」根 |
| 项目库不可用（ghost/占用） | 全局 | 空态按钮 / 树「全局」根 |

## B3 详情抽屉

UI：

```
[素材库对话框]
  ├─ 工具栏：标签筛选 · 已选 N 项 · 添加标签 · 收藏 · 取消选择 · 详情：<name>   ← 单选时出现
  ├─ 左侧目录树
  ├─ 中间网格（单击=选中，双击=预览 / 进目录）
  └─ 右侧详情抽屉（非模态，默认关闭；打开后不遮罩、不锁滚动、可与网格同时操作）
```

- 默认行为：单击只选中，**不打开任何东西**；双击文件 → 已有 `AssetPreview`；双击文件夹 → 进目录。
- 打开入口三个：右键菜单「显示详情」、工具栏「详情」按钮（单选时显示）、`⌘I / Ctrl+I`。
- 打开后：选中项变化则同步内容；选中被清空则自动关闭（避免显示已不存在的条目）。
- 抽屉属性：`:modal="false"`、`:lock-scroll="false"`、`:close-on-click-modal="false"`、`close-on-press-escape` 交给 Esc 处理；同时把外层素材库 dialog 的 `close-on-press-escape` 在抽屉打开时置 false，保证一次 Esc 只关一层。
- `index.vue` 新增 `show-detail` 事件（携带 entry），由首页弹窗打开抽屉；工作区面板没有详情抽屉，事件无人监听即无副作用。

## 测试

| # | 用例 | 期望 |
| --- | --- | --- |
| 1 | 项目库状态下点「全局」子目录 | 下拉/状态切到全局，网格显示该目录内容 |
| 2 | 全局状态下点项目子目录 | 切到该项目并落到该目录 |
| 3 | 分组模式高亮 | 点全局子目录后当前节点高亮正确 |
| 4 | 工作区面板（非分组）点「全局」下目录 | 不再用项目库路径访问 |
| 5 | 顶部下拉框 | 首页与工作区都不再出现 |
| 6 | 单击素材 | 只选中，不弹详情、不遮挡 |
| 7 | 双击文件夹 / 文件 | 进目录 / 打开预览 |
| 8 | 右键「显示详情」、⌘I | 打开非模态抽屉，网格仍可点 |
| 9 | 抽屉打开后改选其它项 | 内容跟随；清空选中则关闭 |
| 10 | 抽屉打开时按 Esc | 只关抽屉，不关素材库 |

## 方案修订（评审后实际实施）

| 项 | 原方案 | 实际实施 | 原因 |
| --- | --- | --- | --- |
| folder 视图切库 | 未覆盖 | 「更多操作」菜单增加「切换到全局库 / 切换到项目库」 | 树只在 tree 视图渲染，删下拉后 folder 视图无切库入口 |
| 抽屉非模态 | 只设 `:modal="false"` | 追加 `modal-penetrable`、`:lock-scroll="false"` | EP 2.14.5 在无遮罩分支仍渲染透明层吞掉网格点击 |
| 分组节点 | 保持不可点 | 点击 = 展开/收起 | 删下拉后它是首页唯一的项目入口 |
| 项目库不可用 | `setLibrary("project")` 静默返回 | 允许切入，由空态说明原因并给「切换到全局库」 | 静默无反应比报错更难排查 |
| 详情菜单项 | 两处都显示 | 新增 `can-show-detail` prop，工作区不显示 | 工作区没有详情宿主，避免空操作项 |
| ⌘I 位置 | 放在通用守卫之后 | 移到输入框守卫之前，并检查 `canShowDetail` | 焦点在搜索框时 ⌘I 也要生效 |
| 高亮 | "nodeKey 与 toTreeNode 不一致" | 实际两者一致；真因是 `syncCurrentKey` 在分组模式下对 global 硬编码 `root:global` | 评审纠正 |

## 评审意见

| 评审人 | 意见 | 结论 |
| --- | --- | --- |
| 子 agent | 五条必改项（folder 死角、modal-penetrable、分组节点、project 守卫、⌘I/空菜单项） | 已全部实施，见上表 |
| 用户 | 三项选择 | 已采纳 |
