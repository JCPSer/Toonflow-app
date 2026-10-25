# 会话恢复：窗口几何 / 上次画布 / 面板布局 / 画布视图偏好 / 关窗闸门（STAR）

## Situation

软件每次启动都是"全新开始"：窗口按固定规则居中、进入项目固定打开根目录排序第一的画布、素材库与 Agent 面板的显隐和位置全丢、吸附开关每次复位。用户要求"打开就像离开时那样"。

调研发现画布节点/连线/viewport 本来就在画布 JSON 里落盘，真正缺的四块是：窗口几何、上次画布指针、面板布局（Agent 面板完全没存、素材库显隐没存、浮层位置存在随机端口下失效的 localStorage）、画布视图开关。

## Task

1. 窗口：尺寸 + 位置 + 最大化，跨启动还原。
2. 进入项目打开该项目上次的画布（含子目录），失败按"根目录第一张 → 递归子目录第一张 → 新建画布1"回退。
3. 素材库与 Agent 面板：宽高、停靠、浮层位置、显隐，全机一份。
4. 吸附 / 连线 / 小地图：本机偏好，所有画布实例共享。
5. 关窗时先 flush 再退出（标题栏关闭、⌘Q、菜单退出、Dock 退出全覆盖）。

## Action

**三处存储分层**（关键决定）：

- `data/windowState.json`（主进程）：窗口几何。页面未加载时就要用，且不能受 remote 代理影响。
- `/api/sessionState/get|patch`（服务端）：面板布局 + 画布视图偏好。新接口按叶子 key 深合并、64KB 上限、拒绝 `__proto__`、串行落盘，**不走 settings**（settings 每次保存会刷新模型列表并重载 MCP）。
- `<项目>/.toonflow/ui.json`：上次画布指针，随项目走。

**窗口几何**：维护 `normal`（仅在非最大化/非最小化/非全屏时更新）+ `maximized`；启动先按 normal 建窗，`show()` 之后才 `maximize()`（hidden 期间 macOS 不可靠）；`clampToDisplays` 按交集最大的显示器 workArea 收敛，允许负坐标；写盘前按 480×320 clamp，与读取阈值对齐。

**关窗闸门**：`will-close` 与 `before-quit` 同步 veto → 主进程 `executeJavascript("window.__toonflowFlush?.()")` → 前端 `Promise.allSettled([画布+文档 flush, sessionState.flush, flushAllLastCanvas])` → 回执 `flush-done` 或 4s 超时 → 落盘窗口几何 → 下个 tick 关闭。菜单 ⌘Q 改走 `requestClose()`；更新器用独立的 `updateQuitApproved` 标志且失败回滚，避免"更新失败后再也存不了盘"。

**上次画布**：恢复走 `listCanvases → loadDirectory → applyCanvas`，**绝不调用** `activateCanvas/ensureCanvas`（会与 `canvasListReady` 互等 120s 死锁）；指针由 `canvasHost` 的 `watch(canvasId)` 写入，首次加载前不写以免覆盖待恢复值；网络错误不静默换画布。

**元数据目录保护**：项目根用黑名单隐藏（`.toonflow`/`.git`/`.agent`/`.library`/`.trash`/`.thumbs` 等），而不是"隐藏所有点开头"——否则 `.env`、`.github` 会从文档树消失；write 只放行 `.toonflow/ui.json`，mkdir 只放行 `.toonflow` 本身，其余删除/移动/复制一律 403。

## Result

- 三端 typecheck 与 web/desktop 构建通过。
- 服务端隔离实例：并发 PATCH 不丢字段、原型污染被拒、`.toonflow` 隐藏与写保护符合预期。
- 真机（dev 5173 + 3121）：打开项目自动建指针文件；改指针到子目录画布后刷新直接落在该画布；删掉目标后回退到根目录第一张并改写指针；素材库面板显隐跨刷新保持；吸附状态从会话状态恢复；画布树不显示 `.toonflow`。
- 窗口几何与关窗闸门需重启打包后的 app 才能实测（已打包覆盖，备份 `/tmp/toonflow-exec-old19.app`）。

## 经验

- "记住状态"先分清楚数据属于谁：画布内容跟项目文件、UI 偏好跟机器、窗口几何跟进程（且不能依赖页面）。放错层就会出现"换端口就失效"（localStorage）或"每次拖面板都重载 MCP"（settings）。
- 半受控组件（el-dialog / 外部状态驱动面板）一定要让父级状态成为唯一真源，用 `computed` 单向派生；不要用 watch 做双向同步，多实例下必然互相覆盖。
- 退出路径要按"谁真正触发"逐个核实：这个仓库里 ⌘Q 绑的是菜单 action，不是 `before-quit`；只挂一个钩子会漏。
- 会阻塞关闭的逻辑必须单飞 + 超时 + 失败放行，否则用户会遇到"窗口关不掉"这种更严重的故障。
- 往用户项目目录写文件时，要同时解决"看不见"和"删不掉"两件事，只做前者等于埋雷。
