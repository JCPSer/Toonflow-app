# Bug 分析：新建项目转圈（选择器被遮挡）+ 复制分组后无法保存

- 记录时间：2026-10-29 09:50
- 来源：用户截图与口述
  - 「点击新建项目一直转圈，没有弹出文件选择框，无法新建项目」→ 用户自查补充：「文件浏览器没有放到最前面，被软件盖住了，导致看不到」
  - 「复制节点和分组，出现"文件正在…"的错误」+「点击删除，提示无法保存」（截图里另有红字「文本尚未加载，无法保存」）

## 一、B1：新建项目转圈，系统选择器被主窗口遮挡

### 背景

macOS 上「新建项目 / 打开项目 / 重新选择目录 / 克隆项目 / 设置里的目录授权」全部走同一条链路：`workspacePicker.vue` → `POST /api/desktop/selectDirectory` → 桌面壳 `selectDirectory()` → `chooseMacFolder()`。

`chooseMacFolder()` 用 `/usr/bin/osascript -l JavaScript` 起一个**独立子进程**，在子进程里 `NSOpenPanel.runModal`。子进程不是前台 App，`runModal` 也不会激活自己，于是面板排在 Toonflow 主窗口之后。

### 现象

- 点「新建项目」后按钮一直转圈（`workspacePicker.vue` 的 `selecting` / 首页的 `relocationPicker.selecting` 在等 HTTP 响应）。
- 服务端在 `execFileAsync` 上等 osascript 退出（脚本刻意不设超时），Promise 永不 settle，所以不是"失败后没复位"，而是"根本没有返回"。
- 首页根节点 `:inert="creating || opening || …"`，`opening` 期间整页不可交互，用户只能强退。
- 只看得到 Finder 的窗口，选择器不可见。

### 根因

`apps/desktop/src/index.ts` 的 JXA 脚本只创建并 `runModal` 面板，没有任何"把自己激活成前台 App"的动作；引入该实现的方案文档当时还写明「osascript 进程非 GUI 应用，activateIgnoringOtherApps 无意义且不应调用」。而 `794886b` 之前的实现走 Electrobun 的进程内 `Utils.openFileDialog`，面板由 Toonflow 自己的 NSApp 创建，自然在窗口之上——这是一次行为回归。

## 二、B2：复制含文本节点的分组后，画布保存永久失败

### 背景

文本节点把正文落在 `assets/<nodeId>/content.md`。复制节点时 `copy` 事件清空 `textPath`、把正文留在 `textSnapshot`，新节点挂载后 `loadText()` 走"把内联正文迁移到磁盘"分支，先 `mkdir("assets")`、`mkdir("assets/<id>")`、再 `write`。

服务端文件锁（`localRuntime/workspace/files.ts`）是**按祖先路径双向互斥**的进程内 `Set`：锁住 `assets` 会挡住 `assets/**` 的任何操作。

### 现象

1. 复制含 ≥2 个文本节点的分组后，画布上出现红色错误卡片「文件正在使用，请等待操作完成」，按钮为「编辑 / 查看并复制 / 重新读取」（文本节点自己的 `el-alert`）。
2. 随后任何保存动作（自动保存、删除节点、编组、重命名）都提示「无法保存」，右上角出现红字「文本尚未加载，无法保存」。

### 根因

1. **祖先锁误冲突**：每个新文本节点都无条件 `mkdir("assets")`，该请求锁住 `assets` 这个祖先目录；同批另一次 `mkdir("assets")` 或已在途的 `write("assets/<id>/content.md")` 与之互斥，后到者立刻 409 EBUSY（锁不排队、无 TTL）。
2. **失败后不可恢复的 latch**：`loadText` 抛错后 `textReady` 停留在 false，错误卡片只提供「重新读取」。
3. **整张画布被一个节点拖死**：`saveCanvasState` 用 `Promise.all` 逐节点 `emit("save")`，文本节点的 `save` 见 `!textReady` 直接抛「文本尚未加载，无法保存」，整批 reject → 画布 JSON 根本没写 → 删除/编组全部失败。

## 三、优先级 / 难度 / 风险

| 项 | 评估 |
| --- | --- |
| 优先级 | B1 P0（新建项目完全不可用，且首页会被 `inert` 卡死）；B2 P0（一次并发冲突就能让整张画布只读） |
| 难度 | 低：B1 是脚本内加两行激活；B2 是幂等短路 + 有界重试 + 保存容错 |
| 风险 | B1 中低（涉及桌面壳，需要重新构建入口并重启应用验证）；B2 低（服务器幂等短路不改变返回语义，前端改为 allSettled 需要保证错误不被吞掉） |

## 四、不做什么

- 不把 macOS 目录选择改回 Electrobun `Utils.openFileDialog`：那会丢掉「面板内新建文件夹」能力（该能力正是 `794886b` 引入 JXA 的原因），只做激活修复。
- 不改文件锁的祖先互斥语义（rename/remove/copy 依赖它），只让幂等的 mkdir 在目录已存在时短路。
- 不给 409 加服务端排队（会改变所有写操作的延迟特性），只在前端做有界退避。

## 五、评审意见

| 评审人 | 结论 | 意见 |
| --- | --- | --- |
| 排查子代理（选目录） | 通过 | 定位到 osascript 子进程未激活；建议进程内面板或显式激活。 |
| 排查子代理（EBUSY） | 通过 | 定位到 `mkdir("assets")` 祖先锁 + `Promise.all` 放大。 |
| 用户 | 待填 | 待填 |
