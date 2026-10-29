# Bug 方案：目录选择器置前 + 复制分组后的 EBUSY / 无法保存

- 记录时间：2026-10-29 09:52
- 关联分析：`bug_analysis-2026-10-29-09-50-dialog-and-ebusy-save.md`

## 一、B1：让 osascript 的 NSOpenPanel 置前

`apps/desktop/src/index.ts` 的 JXA 脚本开头加三件事，全部 `try` 包住（失败就回退到 Electrobun 自带面板，不会更差）：

```js
var app = $.NSApplication.sharedApplication
try { app.setActivationPolicy($.NSApplicationActivationPolicyAccessory) } catch (e) {}
try { app.activateIgnoringOtherApps(true) } catch (e) {}
...
try { panel.level = $.NSModalPanelWindowLevel } catch (e) {}
try { panel.makeKeyAndOrderFront(null) } catch (e) {}
```

- `setActivationPolicy(Accessory)`：osascript 默认是无 UI 的辅助进程，不改成 accessory 就永远激活不了自己，`activateIgnoringOtherApps` 也无从谈起（旧方案文档"无意义且不应调用"的判断漏了这一层）。
- 不改回 Electrobun `Utils.openFileDialog`：那条路径没有 `canCreateDirectories`，会丢掉"面板里新建文件夹"。

`selectDirectory()` 的 darwin 分支加 `finally`：面板关闭（选中或取消）后 `mainWindow.show(); mainWindow.activate();`，把焦点还给主窗口，避免应用停在后台。

没有改动前端 loading：`workspacePicker.vue` 本来就有 `try/finally`，转圈是因为 Promise 永不 settle，不是没复位。

## 二、B2：EBUSY 与"无法保存"

### 1) 服务端 mkdir 幂等短路（根因）

`apps/server/src/routes/workspaces/files/mkdir.ts`：

```
if 目录已存在 (stat().isDirectory())  → 直接 success()，不取锁
否则 → 照旧 lockWorkspaceFiles([path]) + mkdir
```

`mkdir` 是幂等操作，目录已存在时既不需要写、也不该占用祖先路径的锁。短接后，复制 N 个文本节点时的 `mkdir("assets")` 不再与 `assets/**` 的写互斥，本次 409 主路径消失。

### 2) 文本节点加载对 EBUSY 有界退避

`packages/nodes/textNode/src/index.vue`：新增 `isBusyError()` + `retryWhenBusy()`，把"建目录 + 首次写入"包成一个可重试单元（两步都幂等），最多 3 次、退避 200/400ms。真正的瞬时冲突（例如并发的媒体生成、画布另存递归复制）不会再把节点打进"文本尚未加载"的永久状态。

### 3) 画布保存不再被单个节点拖死

`apps/web/src/pages/workspace/panels/canvas/index.vue`：

```
原： await Promise.all(nodes.map(save))
新： await saveNodeStates()      // Promise.allSettled
     ├─ 有失败 → 首次弹一条 "部分节点未保存：<原因>"（去重，不影响后续流程）
     └─ 无失败 → 清掉去重标记
```

两处调用点（保存前后各一次）都替换。这样即使某个节点确实坏掉，画布 JSON（结构、位置、删除结果）仍然写盘，"删除/编组/重命名被一个坏文本节点永久卡死"的放大效应消除；节点自身的错误卡片仍然在节点上显示。

## 三、验证计划

1. `apps/web` typecheck 无新增；`apps/desktop` 随 `deploy-local.sh --build` 构建成功。
2. 产物核对：`build/desktop/main/index.js` 含 `activateIgnoringOtherApps`；`build/nodes/textNode.umd.js` 含重试逻辑且已同步到 `/Applications/toonflow-data/nodes`。
3. 手测：见测试结果文档。

## 四、风险与未覆盖

- B1 依赖 macOS 允许 accessory 进程激活；若某版本仍不置前，可退回 `choose folder`（AppleScript，服务端非桌面路径已在使用）。
- B2 的 mkdir 短路是"先 stat 再 mkdir"，极端并发下仍可能两个请求都判定不存在、后到者 409；配合第 2 条的重试可自愈。
- 文件锁仍是"抢不到立刻 409"的语义，没有排队；长操作（递归复制/删除整目录）期间其它写操作照旧会 409，只是不再产生永久 latch。
- 未处理：Agent 会话清理的 409 重试无上限（与本 bug 无关，已记录）。

## 五、评审意见

| 评审人 | 结论 | 意见 |
| --- | --- | --- |
| 排查子代理 | 通过 | 给出的 P0 方案与本实现一致（幂等 mkdir、重试、allSettled）。 |
| 用户 | 待填 | 待填 |
