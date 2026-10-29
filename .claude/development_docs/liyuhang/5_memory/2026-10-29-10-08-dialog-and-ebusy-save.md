# 记忆：macOS 目录选择器被遮挡 + 复制分组后 EBUSY 无法保存

## Situation

1. 首页点「新建项目」一直转圈：macOS 上目录选择器由 **osascript 子进程** 里的 `NSOpenPanel.runModal` 实现（`apps/desktop/src/index.ts` 的 JXA 脚本，`794886b` 引入，为的是能「新建文件夹」）。子进程不是前台 App，`runModal` 也不会激活自己，面板被 Toonflow 主窗口盖住；`execFileAsync` 又刻意不设超时，HTTP 永不返回，`selecting` 一直为 true，首页还因为 `:inert="creating || opening"` 整页不可点。
2. 复制含多个文本节点的分组后，文本节点报「文件正在使用，请等待操作完成」，随后整张画布「无法保存」「文本尚未加载，无法保存」。

## Task

让系统选择器出现在主窗口之上；让复制分组不再触发 EBUSY，且单个节点失败不能拖死整张画布的保存。

## Action

- **桌面壳**：JXA 脚本开头 `setActivationPolicy(NSApplicationActivationPolicyAccessory)` + `activateIgnoringOtherApps(true)`，面板再补 `level = NSModalPanelWindowLevel` 与 `makeKeyAndOrderFront(null)`，全部 `try` 包住失败回退 Electrobun 面板；`selectDirectory()` 的 darwin 分支 `finally` 里 `mainWindow.show()/activate()` 把焦点还回来。
- **服务端**：`mkdir` 路由在目录已存在时直接 `success()`，不进 `lockWorkspaceFiles`。锁是**双向祖先互斥**的进程内 Set，`mkdir("assets")` 会挡住 `assets/**` 的写；每个新文本节点都无条件 mkdir 共享父目录，复制 N 个文本节点必然互撞。
- **文本节点**：`retryWhenBusy()` 把「建目录 + 首次写入」包成可重试单元（EBUSY 最多 3 次，200/400ms 退避），避免一次瞬时冲突就永久 latch 成 `textReady=false`。
- **画布保存**：节点 `save` 从 `Promise.all` 改 `Promise.allSettled`（`saveNodeStates()`），失败只提示一次「部分节点未保存」，画布 JSON 照常写盘——否则一个坏节点会让删除、编组、重命名全部被卡死。
- 顺带：`:node-drag-threshold` 4 → 8（用户复测要求，贴边点击节点不再误触发自动平移）。

## Result

typecheck 无新增；`deploy-local.sh --build` 成功；`textNode.umd.js` 已同步到 `/Applications/toonflow-data/nodes`（需重启）；`build/desktop/main/index.js` 含 `activateIgnoringOtherApps`；画布产物含 `部分节点未保存：{0}` 与 `"node-drag-threshold":8`。

坑：前端 `workspacePicker.vue` 本来就有 `try/finally`，转圈不是"没复位"，而是 Promise 永不 settle——排查时先确认请求是否返回，别急着改 loading。
