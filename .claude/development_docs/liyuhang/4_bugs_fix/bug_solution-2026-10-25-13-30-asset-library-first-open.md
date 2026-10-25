# Bug 方案：素材库首开竞态、首页项目库、DEV mock 收窄

对应分析：`bug_analysis-2026-10-25-13-30-asset-library-first-open.md`

## B2 项目库根唯一化（服务端）

目标：同一项目目录在一次进程生命周期内，判定"用哪个库根"必须串行，且要兼容"用户真的占用了 library"。

```
claimLocks: Map<项目目录, Promise>            // 进程内互斥，按目录串行
withLibraryLock(dir, fn):
    prev = claimLocks.get(dir) ?? resolved
    next = prev.catch(()=>{}).then(fn)
    claimLocks.set(dir, next.finally(() => 若仍是自己则 delete))
    return next

getProjectLibraryLayout(dir, {create}):
    return withLibraryLock(dir, () =>
        primary 已带标记 → 用 primary
        primary 不存在 → create ? 建 primary : 返回 exists:false
        primary 存在但无标记:
            若为空目录（只允许 .DS_Store 这类系统文件）→ 视作竞态残留，补标记后继续用 primary
            否则 → 原逻辑：fallback 已带标记用 fallback；fallback 不存在则 create 时建 fallback；
                   两者都被非空无标记目录占用 → 409 ELIBRARYOCCUPIED
    )
```

要点：判空只在"无标记"分支里发生，且 `create=false`（`/roots` 探测、媒体只读）不落盘，只返回推断结果。

## B1 首屏自愈（前端）

```
loadRoots / loadList / loadNode(tree):
    第一次失败 → 清空错误 → 250ms 后重试一次
    仍失败 → 按真实错误显示（横幅/空状态二选一）
```

- 新增 `retryOnce(fn)` 工具：只对"首次加载"生效，用户主动操作（移动/删除）不吞错误。
- 错误横幅与空状态互斥：`emptyKind` 在 `error` 非空时返回 `error`，由 `AssetEmptyState` 渲染"加载失败 + 重试"，横幅只用于"部分成功"（例如回收站读取失败）。

## B3 首页按项目浏览（前端）

树形：

```
[全局]                     ← 始终存在
[项目]                     ← 仅首页（传入 projects 时）
   └ 项目A  ┐              ← 懒加载：展开时才拿项目列表
       └ 角色/…           ← 点击项目节点后，才请求该项目的 library 树
```

- `AssetTreeView` 新增 `projects: Project[]`；`loadNode` 对 `root:projects` 返回项目节点（`directory` 字段），对项目节点调 `getTree({library:"project", directory})`，其子节点继续用同一 directory。
- 点击项目节点 → `emit("select-project", directory)`；首页弹窗把它写进 `activeDirectory`，内容区 `directory` 随之切换（store 本来就按目录分桶，互不串状态）。
- 顶部库选择器：未选项目时只显示「全局」；选中后显示「项目名 / 全局」，切换行为与工作区一致。
- 工作区内的 `本项目` 分支不变（不传 `projects`）。

## B4 mock 收窄

- `mockEnabled = import.meta.env.DEV && (localStorage["toonflow.assetLibrary.mock"] === "1" || location.search.includes("assetMock=1"))`。
- 单元自检：默认失败即报错；打开开关后行为同现状。

## 测试

| # | 用例 | 期望 |
| --- | --- | --- |
| 1 | 空项目并发 10 次 list/tree（3 轮） | 只生成 `library/`，不出现 `library-assets` |
| 2 | 真实占用：`library/` 有用户文件、`library-assets` 不存在 | 建 `library-assets` 并返回 `fallback:true` |
| 3 | 两者都被非空无标记目录占用 | 409 `ELIBRARYOCCUPIED` |
| 4 | 删除 `library` 后打开面板 | 自动创建，显示空库，无横幅 |
| 5 | 临时制造 500（改权限） | 横幅显示真实错误，点重试可恢复 |
| 6 | 首页素材库 | 树出现「项目」，展开才请求；点项目后网格显示该项目素材 |
| 7 | 未选项目时切换库 | 项目选项不可用，不报错 |
| 8 | 默认 dev 环境请求失败 | 不再出现演示素材 |

## 方案修订（评审后实际实施）

| 项 | 评审前 | 实施时改为 | 原因 |
| --- | --- | --- | --- |
| 库根顺序 | primary 空 → 补标记，优先于 fallback | primary 已认领 → fallback 已认领 → primary 不存在 → 残留补标记 → 占用判 fallback | 否则用户清空 `library` 后，已上传到 `library-assets` 的素材会消失 |
| 残留判据 | "目录为空（允许 .library）" | 只允许系统噪声 + `.library`，且 `.library` 内只剩临时文件 | app 的残留一定是 `mkdir .library` 留下的；用户自建空目录不该被吞 |
| 读路径加锁 | 全部串行 | `create=false` 且已认领时直接返回，不进锁 | 首屏几十张缩略图会被同一把锁排队 |
| 首屏错误 | 只重试一次 | 重试一次 + **持久化 path 失效时自动退回根目录** | 实测 404 来自"上次停留的文件夹已被删除"，这才是横幅的主因之一 |
| 错误展示 | 横幅常驻 | `entries=0` 用空态错误页（带重试/切全局），`entries>0` 才用横幅 | 避免"错误横幅 + 空文件夹"自相矛盾 |
| 全局库 | 总是带 directory | 全局不传 directory；服务端对 global 忽略无效项目目录 | 项目目录失效不能连带打挂全局库 |
| 首页分组 | 直接复用「本项目」根 | 独立 grouped 模式：分组根 + 项目节点，节点 id/展开状态/拖拽与右键按目录区分 | 两个项目同名子目录会撞 node-key，拖拽/右键会用错项目的 selector |
| 首页默认 | 沿用上次打开项目 | 默认全局库，点项目才切 | 用户要求"点开才加载" |

## 评审意见（方案）

| 评审人 | 意见 | 结论 |
| --- | --- | --- |
| 子 agent | 方案需修订后再实施（六项） | 已按上表修订并实施 |
| 用户 | 三项一起做 | 已采纳 |
