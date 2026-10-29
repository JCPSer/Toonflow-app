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

## 追加（11:25）：自建随包原生选择器

Electrobun 面板没有「新建文件夹」（FFI 无 canCreateDirectories），osascript 只有英文包，应用内自绘被否决 → 自建 `folder-picker.app`（`apps/desktop/native/folderPicker.m` + 构建脚本 + electrobun copy + deploy 安装），由主进程 `execFile` 调用，stdout 返回路径。

关键坑：
- `[panel center]` 在多显示器下按「面板自身所在屏幕」居中，会把面板送到副屏（实测 x=-1360，完全看不见）；用 `[NSScreen mainScreen]` 手算也一样。必须按 `[NSEvent mouseLocation]` 找屏幕，并在布局完成后补两次校正。
- 面板语言由**主 bundle 的 `CFBundleLocalizations`** 决定；helper 的 Info.plist 声明 zh-Hans 才有中文，和系统 `AppleLanguages` 无关。
- 子进程不一定是前台 App，普通窗口会被主窗口压住；`NSStatusWindowLevel` 是可靠的做法。
- 安装路径：打包 copy 的落点是 `Contents/Resources/app`，而 `PATHS.RESOURCES_FOLDER` 是 `Contents/Resources`；要用 `resolve(PATHS.VIEWS_FOLDER, "../mac/…")` 才与 startup/tools 一致。
