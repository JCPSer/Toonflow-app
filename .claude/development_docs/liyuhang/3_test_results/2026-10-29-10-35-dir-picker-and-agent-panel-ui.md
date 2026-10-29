# 测试结果：应用内目录选择器 + Agent 面板视觉修正

- 记录时间：2026-10-29 10:35
- 关联：`4_bugs_fix/bug_analysis-2026-10-29-10-20-dir-picker-and-agent-panel-ui.md`、`bug_solution-2026-10-29-10-20-dir-picker-and-agent-panel-ui.md`

## 一、本轮改动

| 位置 | 改动 |
| --- | --- |
| `apps/server/src/routes/desktop/listDirectory.ts`（新） | `POST /api/desktop/listDirectory`：列出本机目录（只返回目录），空 path 从主目录开始，返回 `absolutePath/parent/home/entries` |
| `apps/server/src/router.ts` | 挂载 `route166` → `/api/desktop/listDirectory` |
| `apps/web/src/pages/home/workspacePicker.vue` | 桌面端改走应用内选择器（`desktopMode`）；`el-dialog` 加 `alignCenter`；新增 `loadDesktopDirectory` / `desktopMkdir` / `onDialogClose` |
| `apps/web/src/pages/workspace/panels/canvas/components/agentNodePanel.vue` | 恢复模型选择（移除 `:show-model-picker="false"`）；`:deep(.messageList)` 隐藏原生滚动条 |
| `apps/desktop/src/index.ts` | 删除 osascript/JXA 目录面板（`macFolderScript`、`chooseMacFolder`），`selectDirectory()` 只用进程内 `Utils.openFileDialog`；移除未使用的 `realpath` 导入 |

## 二、诊断依据（实测）

在用户机器上跑了两次真实面板并截图对比：

| 方式 | 界面语言 | 位置 |
| --- | --- | --- |
| JXA `NSOpenPanel`（osascript） | 英文（Favorites / Folders / Cancel / Open / New Folder） | 偏上约 240pt，`panel.center()` 在面板撑大前执行，无效 |
| AppleScript `choose folder` | 标题中文、按钮「选取」，但侧栏与 Cancel/New Folder 仍英文 | 同上 |

原因直接查到进程的 bundle：

```
com.apple.osascript → localizations ["en"]，NSLocale zh_CN
toonflow-exec.app   → CFBundleLocalizations [zh-Hans]，DevelopmentRegion zh-Hans
```

所以子进程面板永远英文，只有应用内方案能同时满足中文与居中。

## 三、静态验证

| 项 | 结果 |
| --- | --- |
| `apps/web typecheck` | 仅既有 `server/.../singleAgent/types.ts(2,33)` |
| `apps/server typecheck` | 通过（无输出） |
| `deploy-local.sh --build` | 成功 |

产物核对：

| 改动 | 证据 |
| --- | --- |
| 应用内选择器 | `build/web/assets/workspacePicker-DwL4yBkb.js` 含 `listDirectory` |
| 新接口 | `build/desktop/main/index.js` 含 `listDirectory`（导入 + 路由各一处） |
| 面板滚动条 | workspace CSS 含 `scrollbar-width:none` |
| 模型选择恢复 | workspace JS 不再含 `show-model-picker` |
| JXA 已删 | `apps/desktop/src/index.ts` 中 `chooseMacFolder`/`macFolderScript` 计数为 0 |

## 四、待手测清单

1. 首页点「新建项目」：弹出的是应用内对话框，居中、全中文；显示当前目录绝对路径，可逐级进入、「上一级」、「新建文件夹」、「选择此目录」。
2. 取消/关闭后按钮停止 loading，首页可交互。
3. 选择一个非空目录：仍按原有规则提示"不为空"。
4. Agent 节点面板：输入框右上不再有竖条；底部出现模型选择；消息区仍可用滚轮滚动、轮次目录条仍可用。
5. 主对话面板（右侧浮动）滚动条与模型选择行为未变。

## 五、未覆盖

- 桌面模式暂不做"最近使用位置"与 Windows 盘符切换入口。
- 应用内选择器只能看到文件夹，看不到文件（选工作区不需要）。
- 若将来需要"在 Finder 中显示"等原生能力，需再单独接系统面板。

## 六、复测后回退（2026-10-29 10:55）：改回系统面板

用户否决了应用内选择器（「怎么是自建的浏览器？而且很难看，我要系统的」），本轮改动相应回退：

| 位置 | 最终状态 |
| --- | --- |
| `apps/web/src/pages/home/workspacePicker.vue` | 恢复桌面分支调用 `/api/desktop/selectDirectory`；移除 `desktopMode` / `desktopListing` / `loadDesktopDirectory` / `desktopMkdir` / `onDialogClose` 与 `alignCenter` |
| `apps/server/src/routes/desktop/listDirectory.ts` | 删除 |
| `apps/server/src/router.ts` | 移除 `route166` 的导入与挂载 |
| `apps/desktop/src/index.ts` | 保留回退：`selectDirectory()` 只用进程内 `Utils.openFileDialog`（osascript/JXA 已删） |
| `agentNodePanel.vue` | 保留：模型选择恢复 + 隐藏消息区原生滚动条 |

验证：

| 项 | 结果 |
| --- | --- |
| `apps/web typecheck` | 仅既有 singleAgent 报错 |
| `apps/server typecheck` | 通过 |
| `deploy-local.sh --build` | 成功；picker chunk `workspacePicker-rr5TTTIG.js` 含 `/api/desktop/selectDirectory`，不再含 `desktopMode`/`listDirectory` |
| 进程内面板语言/位置 | 用一个只声明 `CFBundleLocalizations=[zh-Hans]` 的最小 .app 实测：面板全中文（个人收藏/文件夹/其他/新建文件夹/取消/打开），位置水平居中、垂直略高于屏幕中心（与系统其他 app 一致） |

结论：现在是系统原生面板、中文、位于主窗口之上；「严格几何居中」不成立，因为 AppKit 对打开面板的默认位置就是略高于中心，要改成纯居中只能在 Electrobun 原生层加 frame/父窗口支持。

## 七、最终实现（2026-10-29 11:25）：随包的原生选择器

Electrobun 自带面板缺「新建文件夹」（FFI 没有 `canCreateDirectories`），osascript 只有英文。最终自建一个随包的小 .app：

| 位置 | 内容 |
| --- | --- |
| `apps/desktop/native/folderPicker.m`（新） | NSOpenPanel：`canCreateDirectories = YES`、中文 prompt、`NSStatusWindowLevel` 保证可见、按**鼠标所在屏**居中（`[panel center]` 在多显示器下会跑到另一块屏） |
| `apps/desktop/scripts/buildMacFolderPicker.mjs`（新） | 用 clang 现场编译并组装 `folder-picker.app`（`CFBundleLocalizations = [zh-Hans, en]`）；非 macOS 跳过 |
| `package.json` | `build` 增加 `build:macPicker`；新增同名脚本 |
| `electrobun.config.ts` | 打包复制 `build/desktop/mac → mac`（仅 darwin） |
| `scripts/deploy-local.sh` | 安装到 `$RES/mac`（即 `Contents/Resources/app/mac`） |
| `apps/desktop/src/index.ts` | `chooseMacFolder()` 用 `execFile` 调 helper（`--start` 记忆上次目录），失败回退 Electrobun 面板；结束后 `mainWindow.show()/activate()` |

### 实测截图结论

| 项 | 结果 |
| --- | --- |
| 语言 | 全中文：个人收藏 / 文件夹 / 其他 / 新建文件夹 / 取消 / 选择，标题「选择工作目录」 |
| 新建文件夹 | 有 |
| 位置 | 鼠标所在屏幕的水平/垂直居中（640×? 屏实测居中） |
| 可见性 | 提到状态窗层级，主窗口在前也可见 |

踩坑记录：`[panel center]` 在多显示器下按"面板自己所在的屏幕"居中，实测把面板送到 x=-1360（副屏）导致完全不可见；手动用 `NSScreen.mainScreen` 算 frame 同样取到了副屏。改成按 `[NSEvent mouseLocation]` 命中的屏幕计算并夹在可视区内，布局完成后再校正两次。

### 产物核对

- `build/desktop/main/index.js` 含 `../mac/folder-picker.app/Contents/MacOS/folder-picker`
- `/Applications/toonflow-exec.app/Contents/Resources/app/mac/folder-picker.app/Contents/MacOS/folder-picker` 已安装且可执行
- `deploy-local.sh` 输出「安装 macOS 目录选择器（Resources）」

### 待手测

1. 首页「新建项目」→ 弹出系统面板（中文、居中、有「新建文件夹」）；新建一个文件夹并选中 → 正常进入项目。
2. 取消 → 按钮停止转圈。
3. 多显示器：在哪个屏幕操作就在哪块屏幕居中弹出。
