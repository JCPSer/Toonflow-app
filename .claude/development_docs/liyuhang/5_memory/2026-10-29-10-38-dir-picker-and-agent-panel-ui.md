# 记忆：应用内目录选择器、Agent 面板竖条与模型选择

## Situation

1. 新建项目的系统目录面板：界面英文、位置偏上。实测根因是面板跑在 `osascript` 子进程里，该进程 `NSBundle.mainBundle.localizations = ["en"]`（`NSLocale` 却是 zh_CN），AppKit 按主 bundle 决定界面语言，所以只有 AppleScript 文案是中文；`panel.center()` 在面板撑大前执行，位置也不可控。换成 AppleScript `choose folder` 同样英文。
2. Agent 节点面板（380px 宽）输入框右上一道竖条一直存在；底部模型选择消失、留空白。

## Task

目录选择改成中文且居中；去掉节点面板的竖条与空白；恢复模型选择。

## Action

- **服务端**：新增 `POST /api/desktop/listDirectory`（`route166`），只返回目录、空 path 从主目录开始，返回 `absolutePath/parent/home/entries`；挂在 `/api/desktop` 下自动继承 `desktopRequest`（仅桌面 + 同源 + `x-toonflow-desktop: 1`）。
- **前端** `workspacePicker.vue`：桌面分支不再调 `/api/desktop/selectDirectory`，改开应用内 `el-dialog`（`desktopMode`），补 `alignCenter`；新建文件夹复用 `useWorkspaceFiles(当前目录).mkdir`；桌面模式只列目录，不提供重命名/删除。
- **桌面壳**：删除 osascript/JXA 面板（`macFolderScript`/`chooseMacFolder`），`selectDirectory()` 只留进程内 `Utils.openFileDialog` 兜底，移除未使用的 `realpath` 导入。
- **Agent 面板**：移除 `:show-model-picker="false"` 恢复模型选择；`:deep(.messageList)` 隐藏原生滚动条（滚轮照常）。

## Result

web/server typecheck 均无新增；`deploy-local.sh --build` 成功；产物含 `listDirectory`（前端 chunk + 桌面 bundle）、`scrollbar-width:none`，且不再含 `show-model-picker`。

经验：判断 macOS 面板语言，直接看进程的 `NSBundle.mainBundle.localizations`，比猜 `AppleLanguages` 快得多；`NSWindow.center()` 要在窗口最终尺寸确定后调用才有意义。

## 追加（10:55）：应用内选择器被否决，改回系统面板

用户要系统原生面板，因此删除 `POST /api/desktop/listDirectory` 与 picker 的 `desktopMode`，桌面 `selectDirectory()` 保留进程内 `Utils.openFileDialog`（osascript/JXA 那段已删）。用最小 .app 实测确认：**进程内** NSOpenPanel 完全中文（个人收藏/文件夹/其他/新建文件夹/取消/打开），位置水平居中、垂直略高于屏幕中心——这是 AppKit 对打开面板的既定位置，不是偏移；要纯居中只能自绘（已被否决）。

教训：先确认「系统组件在哪个进程里」再谈本地化；`CFBundleLocalizations` 决定 AppKit 的界面语言，与 `AppleLanguages` 无关。
