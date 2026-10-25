# 方案 v2：会话恢复（窗口几何 / 上次画布 / 面板布局 / 画布视图偏好）

对应需求矩阵：`../1_requirements_matrix/2026-10-25-21-22-session-restore.md`（R1–R8）
版本：v1（21:53）→ **v2（22:30，按二轮评审重写 M2/M3/M5/M6）**

## 零、冻结的决策

| 决策 | 结论 |
| --- | --- |
| D1 上次画布 | 写进项目目录 `.toonflow/ui.json` |
| D2 面板布局 | 素材库与 Agent 都 **全机一份**（布局字段全局；素材库浏览态 library/view/path/sort/expanded 仍按项目） |
| D3 面板显隐 | 记忆 |
| D4 吸附 | 本机偏好，与 showEdges/showMap 合并为"画布视图偏好" |
| D5 关窗兜底 | 全覆盖 + 超时 |
| D6 窗口几何 | 主进程 `data/windowState.json` |
| D7 会话状态 | 新接口 `/api/sessionState/*`（按叶子 key 合并、无副作用） |
| D8 画布回退 | 递归取子目录第一张 |

存储边界（修正表述）：窗口几何 → 主进程本地文件；面板布局与画布视图偏好 → **当前连接的服务端**（本地模式即本机，remote 模式为远端）；上次画布 → 项目目录文件。

## 一、模块划分

| 模块 | 文件 | 需求 |
| --- | --- | --- |
| M1 窗口几何 | `apps/desktop/src/windowState.ts`（新）、`apps/desktop/src/index.ts` | R1 |
| M2 关闭闸门 | `apps/desktop/src/index.ts`、`apps/web/src/lib/quitGuard.ts`（新） | R7 |
| M3 会话状态接口 | `apps/server/src/routes/sessionState/{get,patch}.ts`（新）、`utils/sessionState/index.ts`（新）、`app.ts`、`router.ts`（生成物） | R4/R5/R6 |
| M4 会话状态 store | `apps/web/src/stores/sessionState.ts`（新）、`main.ts` | R4/R5/R6 |
| M5 面板接入 | `floatingPanel.vue`、`floatingAssetLibrary.vue`、`floatingAgent.vue`、`workspace/index.vue`、`stores/assetLibrary.ts` | R4/R5 |
| M6 上次画布 | `apps/web/src/lib/projectUi.ts`（新）、`canvasHost.vue`、`canvasMenu.vue`、`apps/server/src/routes/workspaces/files/list.ts`、`utils/workspace/files.ts` 等 | R2/R8 |
| M7 画布视图偏好 | `canvas/index.vue`、`canvasControls.vue` | R3/R6 |

## 二、M1 窗口几何

### 2.1 文件

```
data/windowState.json
{ "version": 1, "normal": { "x": int, "y": int, "width": int, "height": int }, "maximized": bool }
```

### 2.2 启动

```
读文件（ENOENT/损坏 → null，走现有默认居中，不报错）
→ clamp（见 2.3）
→ new BrowserWindow({ frame })
→ 注册事件
→ splash 结束、desktop.ready() 里 show() **之后** 若 maximized 且 !isMaximized() → maximize()
   （窗口 hidden 期间 maximize 在 macOS 上不可靠）
```

### 2.3 clamp

```
displays = Screen.getAllDisplays()
if (!displays.length) → 回退现有默认居中
best = 交集面积最大的 display（按 workArea 计算，允许负坐标）
if (无交集) → 居中主屏，尺寸 = min(保存值, workArea - 边距)
else → 尺寸 clamp 到 best.workArea；x/y 仅在不越界方向修正
保存值必须为有限正整数，且不小于 480×320；不合法直接视为无值
```

### 2.4 运行时跟踪

```
resize/move 事件 → pendingFrame（事件自带 x/y/w/h，不调 FFI）
→ 400ms debounce →
   若 isMinimized() || isFullScreen() → 什么都不更新（全屏不污染 maximized）
   否则若 isMaximized() → maximized = true，normal 不变
   否则 → normal = pendingFrame，maximized = false
→ 静默 2s 后落盘
```

### 2.5 落盘

- 关闭闸门末端：先把未提交的 `pendingFrame` 并入 normal，再写盘
- 强制退出（Force Quit / 系统关机）不保证

## 三、M2 关闭闸门（重写）

### 3.1 四条退出路径（已按代码核实）

| 路径 | 真实入口 | 处理 |
| --- | --- | --- |
| 标题栏关闭 | 原生 `windowShouldClose` → `will-close`（`mainWindow.on`） | 同步 veto → 闸门 |
| ⌘Q / 菜单「退出 Toonflow」 | `ApplicationMenu` action=quit（`index.ts:99-101,200-203`）——**不是 before-quit** | 改为 `mainWindow.requestClose()` → 走 `will-close` |
| Dock 退出 / 系统注销 | 原生 quit → `before-quit` | 同步 veto → 闸门 |
| 安装更新并重启 | `Updater.applyUpdate` / `windowsUpdater`，只申请一次 quit 批准，被 veto 即放弃 | 更新前先跑闸门并置 `updateQuitApproved` |

### 3.2 状态机（防重入）

```
allowClose=false, gate=null, pageReady=false, forceQuit=false, flushing=false

will-close:
  if (allowClose) return
  ev.response = { allow: false }        // 必须同步，否则原生继续关窗
  void runGate("close")

before-quit:
  if (allowClose || forceQuit || !mainWindow) return
  ev.response = { allow: false }        // 必须同步
  void runGate("quit")

runGate(kind):
  if (gate) return gate                 // 单飞，绝不在 handler 内再次 requestClose
  gate = (async () => {
    if (pageReady) {
      try { mainWindow.webview?.executeJavascript("window.__toonflowFlush?.()") } catch {}
      await waitForFlushDone(timeoutMs)  // 超时按实例数：2s + 0.5s/实例，上限 8s
    }
    flushWindowState()                   // 合并 pendingFrame 后写盘
    allowClose = true
  })()
  await gate
  setTimeout(() => kind === "quit" ? Utils.quit() : mainWindow.close(), 0)
  // 不在原生 shouldClose 回调栈内同步 close，避免重入销毁
```

`pageReady` 由 `desktop.ready()` 置 true、`will-navigate` 置 false；未 ready 直接放行（启动期失败/取消不进闸门）。`forceQuit` 在启动失败 catch 里置 true 再 `Utils.quit(1)`。

### 3.3 更新器

`app.locals.desktop.updater.applyUpdate` 包一层：先 `await runGate("update")`，把 `allowClose=true` 且 `updateQuitApproved=true`，再调用真实 applyUpdate；Windows 同样在 `windowsUpdater` 外层设置该标志。否则闸门 veto 会让"安装更新并重启"100% 失败。

### 3.4 前端

```
// apps/web/src/lib/quitGuard.ts —— workspace 挂载时注册
window.__toonflowFlush = async () => {
  try {
    await canvasHost.flushSave()      // 所有已挂载实例
    await sessionState.flush()
  } finally {
    sendToHost({ type: "flush-done" })  // 无条件回执，抛错也要回执
  }
}
```

未在 workspace（首页/设置页）时注册一个立即回执的空实现。
主进程用 `host-message-${mainWindow.webview.id}` 收（**webview id，不是 window id**）。

## 四、M3 会话状态接口（重写）

### 4.1 路由与命名

`router.ts` 是生成物（`apps/server/src/core.ts` 扫描 `routes/**`），不做 kebab 转换。因此目录名用 `routes/sessionState/`，生成：

```
GET   /api/sessionState/get     → success({ state })
PATCH /api/sessionState/patch   { patch } → success({ state })
```

改完必须跑 `bun run routes` 重新生成 `router.ts`（不要手改）。

### 4.2 存储

`data/sessionState.json`，目录取 `dirname(conf.path)`（与 `utils/assets/usage.ts` 同法）。读取用内存缓存（首次懒加载），PATCH 改内存后**串行队列**落盘（模块级 promise 链），避免读-改-写竞态。

### 4.3 合并语义（明确定义）

```
- 顶层与各层必须是 plain object；数组整体替换（不按下标合并）
- null = 删除该 key（唯一删除语义）
- 拒绝 __proto__ / constructor / prototype（用 Object.create(null) 承载）
- 数字必须 Number.isFinite；面板宽高取整并 clamp 到 200–10000
- 深度上限 8 层；合并后 Buffer.byteLength(JSON.stringify(merged)) ≤ 64KB，超出 413 且不落盘
- 请求体大小：在全局 express.json({limit:"100mb"}) 之前，为 /api/sessionState 单独挂 express.json({limit:"64kb"})
```

### 4.4 鉴权与响应

- 与其它本地写接口一致：校验 `x-toonflow-workspace: 1`，`Cache-Control: no-store`
- 响应统一 `success({ state })`，前端取 `data.state`

### 4.5 数据形状与默认值

```
{
  "panels": {
    "asset": { "visible": false, "width": 360, "height": 0, "docked": true,  "floating": { "left": null, "top": null } },
    "agent": { "visible": true,  "width": 420, "height": 0, "docked": false, "floating": { "left": null, "top": null } }
  },
  "canvasView": { "snap": false, "showEdges": true, "showMap": false }
}
```

客户端 hydrate 时**深合并默认值**（不能浅展开，否则缺字段的旧数据会让 Agent 面板默认消失）。

### 4.6 客户端 patch 语义

`set(path, value)` 生成**叶子 patch**（如 `{ panels: { asset: { width: 400 } } }`），并 300ms 合并；绝不发送整棵 `panels`，否则跨客户端会互相覆盖。

### 4.7 已知限制（写进文档，不做）

移动端与桌面共用同一个服务端，`/api/sessionState` 对移动端同样可用，手机端的布局写入会改桌面布局。本期接受（布局字段体感差异小），后续如需按客户端分桶再扩展。

## 五、M4/M5 前端接入（重写）

### 5.1 store

```
apps/web/src/stores/sessionState.ts
init(): GET → 深合并默认值 → hydrated = true
set(path, value): 更新内存；hydrated 之前只更新内存不 PATCH；之后 300ms 合并成叶子 patch
flush(): 立即 PATCH
```

初始化时机：`main.ts` 的 `loadSettings()` 之后、`app.mount()` **之前** `await sessionState.init()`，避免首帧用默认值挂载后闪跳/回写覆盖。

### 5.2 素材库面板

- `visible`：**保留** `stores/assetLibrary.ts` 的 `visible` 作为唯一运行态（`canvas/index.vue` 控制条、`requestSave()` 都直接用它），单向 `watch` 镜像到 sessionState；hydrate 时反向灌一次。禁止双源。
- `docked/width/height/floating`：改为 sessionState（全局一份），删除 `stateByDirectory` 中的对应布局字段读写。
- `floatingAssetLibrary.vue`：删除 `watch(state.width/height)`、`watch(directory)`、`persistSize()` 的旧 store 写入；`width/height` 保留本地 ref（拖拽期间高频），初值来自 sessionState，`@change` 时写入。
- `floatingPanel.vue`：删除 `persist-key` / `readPersistedPosition` / `persistPosition` / `watch(positionKey)`；位置只由 props 驱动，变化通过 `@change` 上抛；恢复后显式调用 `clampFloatingPosition()`。
- 一次性迁移：若 sessionState 无 `panels.asset`，从 `stateByDirectory` 取最近使用项目的宽高/docked 作为初值，记 `migratedAt`。

### 5.3 Agent 面板

`floatingAgent.vue` 的 `visible/docked/width/height` 全部接 sessionState；`workspace/index.vue` 的 `--agentWidth/--assetWidth` 仍由这两个值驱动（不新增 CSS 变量）。

### 5.4 画布视图偏好

`canvas/index.vue` 把 `snapEnabled`、`showEdges`、`showMap` 改为 assignable computed 直连 sessionState（**不用 watch 双向同步**，避免多实例互相覆盖）。
`showMap` 当前在 `canvasControls.vue:134` 的本地 ref —— 改为 `defineModel("showMap")`，由 `canvas/index.vue` 传入。
MiniMap 的渲染仍受 `props.active` 控制，只持久化开关值（避免隐藏实例都渲染小地图）。

## 六、M6 上次画布（重写）

### 6.1 文件与读写

```
<项目>/.toonflow/ui.json  →  { "version": 1, "lastCanvas": "画布/分镜.json", "updatedAt": 1761... }
```

- 写：`files.mkdir(".toonflow")`（已存在则忽略 EEXIST）→ 再写文件；路径必须是项目内相对路径（拒绝绝对路径、`..`、空串）
- 读：失败/不存在 → 视作无值，**不在读路径上写盘**（只读项目/网络盘打开时不产生写操作）
- 指针更新：在 `canvasHost.vue` 里 `watch(activeCanvasId)`，500ms debounce 写入；删除到无时清空

### 6.2 打开流程（避免与 `ensureCanvas` 死锁）

```
canvasMenu 的 directory watch 内（即现有 init 流程）：
  savedPromise = projectUi.readLastCanvas()          // 与列表并行
  entries = await listCanvases(directory, "", false) // 先填 canvases（根目录）
  saved = await savedPromise

  若 saved 命中根目录画布 → applyCanvas(saved)
  否则若 saved 存在：
      await loadDirectory(parentOf(saved))           // 把子目录画布 merge 进共享 canvases
      命中 → applyCanvas(saved)
  否则 → 根目录排序第一张
  否则 → 递归子目录排序第一张（D8）
  否则 → 根目录无画布且无子目录 → 新建「画布1」（保持现状）
  否则 → 只剩子目录但没有画布 → 不打开，显示现有空态
```

**不要走 `activateCanvas`**：`ensureCanvas` 在 `canvases` 为空时会等 `canvasListReady`（120s 超时），而该标志正是本 watch 的 finally 才置位 —— 从 init 里调它必然死锁。
错误处理：仅 404/格式错误静默回退；网络错误要提示，不静默换画布。

### 6.3 R8：元数据目录不可见 + 不可操作

1. `routes/workspaces/files/list.ts`：项目根过滤 `.` 开头的目录/文件；`empty` 改为**过滤后**计算。
2. `utils/workspace/files.ts` 的路径保护（现 `protectWorkspaceLibraryPath`）增加 `.toonflow`：`write/rename/remove/copy` 一律拒绝。
3. 补进 skip 清单：`utils/assets/usage.ts` 的 `skippedDirectories`、`agent/mentionFiles.ts` 的递归跳过、`routes/workspaces/clone.ts` 的画布探测、`packages/tools/workspace` 的 ls/read/write。
4. `canvasMenu.normalizeFolderName` 把 `.toonflow` 列为保留名。

## 七、测试计划

| # | 场景 | 期望 |
| --- | --- | --- |
| 1 | 调窗口大小/位置 → 退出 → 重启 | 一致 |
| 2 | 最大化 → 退出 → 重启 | 最大化；还原后回到上次普通尺寸 |
| 3 | 拔掉第二显示器后重启 | 落在主屏可见区 |
| 4 | 全屏状态下退出 | 下次启动为普通尺寸（不把全屏帧当普通尺寸） |
| 5 | 打开子目录画布 B → 重启进项目 | 直接到 B，树展开高亮，<3s 无卡顿 |
| 6 | 删除 B 后重启 | 回退根目录第一张；根目录空则子目录第一张 |
| 7 | 全新项目（无 `.toonflow`）首次切换画布 | 目录被创建，文件写入成功 |
| 8 | 拖素材库宽度/隐藏/浮层拖动 → 重启 | 全部一致 |
| 9 | Agent 面板折叠/拖宽 → 重启 | 一致 |
| 10 | 吸附 + 关连线 + 关小地图 → 重启 | 一致 |
| 11 | 拖节点后 0.2s 内 ⌘Q | 节点位置已保存（走菜单→requestClose→闸门） |
| 12 | 安装更新并重启 | 更新成功（闸门不阻断） |
| 13 | 根目录放 `.toonflow`/`.git` | 画布树、文档树、搜索、Agent ls 都看不到；写/删/移动被拒 |
| 14 | 页面加载失败时关窗 | 2s 内正常关闭，不卡死 |

## 八、评审记录

### 8.1 二轮评审（子 agent，22:20）：需修改后通过

| # | 结论 | 处理 |
| --- | --- | --- |
| B1 | 从 init 调 `activateCanvas` 会与 `ensureCanvas` 的 ready 等待死锁 | 采纳，6.2 改为 list → loadDirectory → applyCanvas |
| B2 | `.toonflow` 首次写盘因父目录不存在必然失败 | 采纳，先 mkdir 再写 |
| B3 | ⌘Q 走菜单 action 而非 `before-quit`；`close()` 与 `requestClose()` 语义不可假设 | 采纳，3.1 四条路径重列；菜单改 `requestClose()` |
| B4 | 闸门 veto 会让「安装更新并重启」100% 失败 | 采纳，3.3 更新器包一层 |
| B5 | 路由是生成物且不做 kebab，`/api/session-state` 会 404 | 采纳，改 `routes/sessionState` + `bun run routes` |
| I1 | `executeJavascript` 无返回值，失败分支不可判断 | 采纳，用 `pageReady` 标志 + try/catch + 超时 |
| I2 | 防重入写法 | 采纳，3.2 单飞 + 下个 tick 收尾 |
| I3 | 启动期 quit / 异常路径 | 采纳，`forceQuit` + 未 ready 放行 |
| I4/I5/I6/I7 | 叶子 patch、串行化、合并语义、64KB 时机 | 采纳，4.3–4.6 |
| I8/I9 | hydrate 时机、恢复后重新 clamp | 采纳，5.1/5.2 |
| I10 | `persist-key` 会破坏全局一份 | 采纳，删除 |
| I11 | `visible` 有两处现有调用点，不能双源 | 采纳，保留 asset store 为唯一运行态 |
| I12 | 旧 width/height watcher 会冲掉新值 | 采纳，删除旧 watch |
| I13 | Agent 默认值缺失会让面板消失 | 采纳，默认 visible=true |
| I14 | `showMap` 在 canvasControls 而非 canvas/index | 采纳，`defineModel` |
| I15 | 指针更新挂点应 watch activeCanvasId | 采纳 |
| I16 | R8 还有其他遍历点 | 采纳，6.3 |
| I17 | `empty` 过滤前计算 | 采纳 |
| I18 | 2s 超时可能截断多画布 flush | 采纳，按实例数放宽 |

### 8.2 用户评审

| 评审人 | 结论 | 意见 |
| --- | --- | --- |
|  |  |  |
