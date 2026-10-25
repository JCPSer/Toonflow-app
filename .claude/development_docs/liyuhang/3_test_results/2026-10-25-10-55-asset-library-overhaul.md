# 测试结果：素材库整改 + 节点加入上下文

环境：macOS arm64 / Bun / 源码
服务端：`NODE_ENV=dev TOONFLOW_DATA_DIR=/tmp/tf-lib/data TOONFLOW_SERVER_PORT=3121 bun src/index.ts`
前端：`TOONFLOW_SERVER_PORT=3121 bun run dev`（vite 5173）
测试工作区：`/tmp/tf-lib/data/workspaces/libproj`（预置 `library/角色/女主/{a,b}.png`、`library/场景/c.png`，已写 `.library/index.json` 标记）
节点：`bun run build:nodes` 后同步到 `<data>/nodes`

## 一、静态检查

| 项 | 命令 | 结果 |
| --- | --- | --- |
| apps/server | `bun run typecheck` | 通过 |
| apps/web | `bun run typecheck` | 通过 |
| packages/nodeScaffold | `bun run typecheck` | 通过 |
| packages/tools/assetOperator | `bun run typecheck` | 通过 |
| 节点构建 | `bun run build:nodes` | 通过，10 个 UMD |

## 二、接口冒烟（curl）

| # | 用例 | 实际 | 结论 |
| --- | --- | --- | --- |
| 1 | 无 `x-toonflow-workspace` 调 `/assets/roots` | 403 | 通过 |
| 2 | `/roots` | 返回全局 + 项目两个根，项目 `exists:false`（首次） | 通过 |
| 3 | `mkdir 角色/女主` | 多级目录创建成功，索引补建 | 通过 |
| 4 | `PUT /save` 原始字节 | 返回 path + sha256 revision | 通过 |
| 5 | `tree` 根 / 子目录 | 单层返回，含 `childCount`、`favorite` | 通过 |
| 6 | `list` 分页 | `{items,total,truncated}`，元数据完整 | 通过 |
| 7 | `meta` 标签 + 收藏 | 写索引，`favorite=true` 过滤生效 | 通过 |
| 8 | `move` 单条 / 批量数组 | 单条旧结构；数组返回逐项 `{ok,path,target}` | 通过 |
| 9 | `remove` 软删除 | 文件进 `.trash/<uuid>/`，生成 `.trash.json` | 通过 |
| 10 | `trash` 列表 | 原路径/时间/大小/占用正确 | 通过 |
| 11 | `restore` | 文件回到原路径，trash 清空 | 通过 |
| 12 | `purge all` | 回收站清空 | 通过 |
| 13 | 项目 `library` 被用户同名目录占用 | `/roots` 返回 `library-assets` + `fallback:true`，用户目录未被改动 | 通过 |
| 14 | 文件树删除 `library` | 403 `EPROTECTED`（rename 同样拦截） | 通过 |
| 15 | `usage` | `{usages, checked:"complete"}` | 通过 |
| 16 | `thumb`（未装 ffmpeg） | 404，前端回退 `/read` | 通过 |
| 17 | `import`（workspace→project） | 复制入库、重名 ` (2)`、源文件保留 | 通过（子 agent curl 验证） |

## 三、界面点验（Chrome DevTools 实际操作）

| # | 用例 | 实际 | 结论 |
| --- | --- | --- | --- |
| 18 | 底部「素材库」按钮 | 左侧停靠 360px，画布右移；工具栏/树/网格齐全 | 通过 |
| 19 | 双库 | 树中「本项目」「全局」并列；「本项目」下 角色/场景 懒加载 | 通过 |
| 20 | 网格缩略图 | a/b/c.png 正常渲染（`/thumb` 不可用时回退） | 通过 |
| 21 | 目录内新建 | 在「角色/女主」下新建，对话框标题显示当前路径，磁盘与索引均正确 | 通过 |
| 22 | 右键菜单 | 打开/重命名/移动到…/标签与备注/收藏/下载/删除 | 通过 |
| 23 | 删除 | 二次确认后进回收站，文件从目录消失 | 通过 |
| 24 | 回收站视图 | 显示 1 项 / 176 B、原路径、恢复/彻底删除/清空 | 通过 |
| 25 | 恢复 | 文件回到 `角色/女主/b.png`，回收站清空 | 通过 |
| 26 | 从项目库拖到画布 | 合成 DnD 事件后创建图片节点，素材复制到 `assets/<nodeId>/` | 通过 |
| 27 | 节点「加入对话上下文」 | 文本节点无输出时按钮禁用（title「暂无输出」）；填入文本后启用；点击后输入框出现 `@画布1 / 文本 · 文本输出` | 通过 |
| 28 | 重复加入 | 再次点击不新增提及（仍为 1 条） | 通过 |

## 四、未覆盖 / 需打包后验证

- 上传队列的浏览器文件选择与大文件进度（XHR 逻辑已 code review，未真机选文件）。
- 批量移动 / 批量标签的界面路径（接口已实测）。
- 树/网格拖拽移动的实际指针操作（自定义 DnD 已实现，本次仅验证「拖到画布」）。
- 停靠⇄浮层切换与宽高记忆的重启恢复。
- 多输出节点的端口菜单（内置节点均为单输出；代码路径已审查）。
- 首页管理页详情抽屉、附件「收藏到素材库」、标签筛选。
- 搜索/排序的界面结果（接口已测）。

## 五、已知限制

- 索引是缓存：外部改名会丢标签/备注；外部删除会在下一次列取时标 stale。
- 全局库无 `directory` 时只扫 `<data>/.agent/sessions` 做引用检测。
- `library` 与 `library-assets` 都被无标记目录占用时返回 409，需要用户改名。
- `thumb` 固定 256px（`size` 参数暂不改变输出，保证缓存键唯一）。
- 克隆项目仍会复制 `library/` 内容（仅识别画布时排除）。
- 演示数据兜底只在 `import.meta.env.DEV` 下启用。

## 六、评审修复后的回归（2026-10-25 11:30）

| # | 用例 | 实际 | 结论 |
| --- | --- | --- | --- |
| 29 | 伪造 Origin `https://evil.example` + `x-toonflow-workspace` 访问 `/assets/list`、`/roots`、`/remove` | 全部 403，响应无 ACAO 头 | 通过（修复前为 200 + `*`） |
| 30 | 同源 Origin/Host 一致 + header 访问 `/roots` | 200 | 通过 |
| 31 | 无 Origin、Referer 同源 + header 访问 `/roots` | 200 | 通过 |
| 32 | 媒体端点：无 Origin、Referer 同源、无 header 读图 | 200 | 通过（`<img>` 场景） |
| 33 | 媒体端点：无 Origin 无 Referer / 跨源 Referer | 403 / 403 | 通过 |
| 34 | 无 Origin 无 Referer 调非媒体接口 | 403 | 通过（MCP 走 `operations.ts` 显式补 Origin/Referer） |
| 35 | 项目库引用检测（会话存 `{library:"project", path:"角色/女主/a.png"}`） | `checked:"complete"`，命中会话 | 通过（修复前永远匹配不到） |
| 36 | 引用中删除 → force 删除 → 恢复 | 409 `EREFERENCED` → 200 进回收站 → 200 回原路径 | 通过 |
| 37 | 切「文档」再切回「画布」 | 面板保持打开；文档页 `padding-left` 生效；画布恢复后 `--assetWidth` 重新上报 | 通过 |
| 38 | 浮层 ⇄ 停靠切换 | 浮层可拖动/调整大小；停靠后画布让位 360px | 通过 |
| 39 | server / web / nodeScaffold / assetOperator 类型检查 + `bun run build` | 全部通过，产物 `build/server/index.js`、`build/web`、`build/tools`、`build/ext` 均已刷新 | 通过 |
| 40 | 浏览器控制台 | 仅 1 个与本功能无关的 404（`/api/connection/connection`） | 通过 |
