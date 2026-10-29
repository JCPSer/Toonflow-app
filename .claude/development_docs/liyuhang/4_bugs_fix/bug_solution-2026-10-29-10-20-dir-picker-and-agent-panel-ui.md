# Bug 方案：应用内目录选择器 + Agent 面板视觉修正

- 记录时间：2026-10-29 10:22
- 关联分析：`bug_analysis-2026-10-29-10-20-dir-picker-and-agent-panel-ui.md`

## 一、B1：桌面端改用应用内目录选择器

### 服务端

新增 `POST /api/desktop/listDirectory`（`apps/server/src/routes/desktop/listDirectory.ts`，挂在 `/api/desktop` 下，自动继承既有的 `desktopRequest` 守卫：仅桌面客户端 + 同源 + `x-toonflow-desktop: 1`）：

```
入参：{ path?: string }        // 为空时从用户主目录开始
出参：{ absolutePath, parent, home, entries: [{ name, absolutePath }] }
       entries 只含目录（选的是工作目录），按名称本地化排序
错误：404 目录不存在 / 403 无权限 / 404 非桌面环境
```

只返回目录而不是文件，一是需求只要选工作区，二是把接口的可读范围收窄。

### 前端（`pages/home/workspacePicker.vue`）

- 桌面分支不再调 `/api/desktop/selectDirectory`，改为打开同一个 `el-dialog`，走新增的 `desktopMode`：
  - `loadDesktopDirectory(path)` 调 `/api/desktop/listDirectory`；「上一级」用返回的 `parent`；
  - 「新建文件夹」复用 `useWorkspaceFiles(当前目录).mkdir(name)`（该接口本来就是按绝对目录工作）；
  - 桌面模式只列目录，不提供重命名/删除（选择工作区用不到，减少误操作面）；
  - 确认后回传 `absolutePath`，取消/关闭走既有的 `finishSelection(null)`，并复位 `desktopMode/desktopListing`。
- `el-dialog` 补 `alignCenter`：弹窗在窗口内垂直居中。
- 语言：整个对话框是应用自身的 Element Plus 文案，天然跟随应用语言。

### 桌面壳

删除 osascript/JXA 那段实现（`macFolderScript` + `chooseMacFolder`，已无调用方），`selectDirectory()` 只剩进程内 `Utils.openFileDialog` 兜底；`realpath` 导入随之移除。`/api/desktop/selectDirectory` 路由保留。

## 二、B2：Agent 节点面板

- 恢复模型选择：移除 `agentNodePanel` 上的 `:show-model-picker="false"`，底部模型行不再空着。
- 隐藏竖条：`agentNodePanel` 内 `:deep(.messageList)` 设 `scrollbar-width: none` + `::-webkit-scrollbar { display: none }`。面板只有 380px 宽，原生滚动条正好压在轮次目录条上（系统开启"始终显示滚动条"时最明显）；滚轮/触控板滚动不受影响，目录条仍在。

## 三、验证计划

1. `apps/web` typecheck（仅既有 singleAgent 报错）、`apps/server` tsc 均无新增。
2. `deploy-local.sh --build` 成功；产物核对：picker chunk 含 `listDirectory`、服务端打包产物含路由、workspace CSS 含 `scrollbar-width:none`、workspace JS 不再含 `show-model-picker`。
3. 手测：新建项目弹出居中中文对话框、可逐级进入/新建文件夹/选中；节点面板无竖条、底部有模型选择。

## 四、风险与未覆盖

- 新接口能列出本机任意目录：靠 `desktopRequest`（仅桌面、同源、桌面头）+ 本地回环地址三重限制；不提供读取文件内容的能力。
- 桌面模式下暂不支持"最近使用位置"，每次从主目录开始；Windows 盘符切换未做特殊入口（返回的 `parent` 到盘符根即为 `null`）。
- 竖条是系统级滚动条设置导致的，只在节点面板隐藏；主对话面板保持原样。

## 五、评审意见

| 评审人 | 结论 | 意见 |
| --- | --- | --- |
| 用户（2026-10-29 10:15） | 通过 | 三项决定已确认。 |

## 六、复测后修正（2026-10-29 10:50）：改回系统面板

用户明确否决应用内选择器（「怎么是自建的浏览器？而且很难看，我要系统的」），因此本节推翻第一节的做法：

- **回退**：`workspacePicker.vue` 的桌面分支恢复调用 `/api/desktop/selectDirectory`；删除新增的 `POST /api/desktop/listDirectory` 及其路由挂载。
- **保留**：桌面 `selectDirectory()` 仍走**进程内** `Utils.openFileDialog`（osascript/JXA 那段已删）。这是"系统面板 + 中文"的唯一组合。
- **实测证据**：用一个只声明 `CFBundleLocalizations = [zh-Hans]` 的最小 .app 跑 `NSOpenPanel` 截图确认——进程内面板完全中文（个人收藏 / 文件夹 / 其他 / 新建文件夹 / 取消 / 打开）。
- **关于位置**：系统「打开面板」的默认位置就是**水平居中、垂直略高于屏幕中心**（同一个最小 app 实测与 Finder 等系统 app 一致）。这是 AppKit 的既定行为，不是我们的偏移；要严格几何居中只能自绘面板，也就是用户已否决的方案。如果确实需要更靠下，只能在 Electrobun 的原生 `openFileDialog` 上加 frame/父窗口支持（属于上游改造）。

## 七、评审意见（补充）

| 评审人 | 结论 | 意见 |
| --- | --- | --- |
| 用户（2026-10-29 10:45） | 否决应用内方案 | 要系统原生面板。 |

## 八、最终方案（2026-10-29 11:20）：随包的原生选择器

回退到 Electrobun 进程内面板后暴露出两个硬伤：面板里**没有「新建文件夹」**（`Utils.openFileDialog` 的 FFI 只有 startingFolder/allowedFileTypes/canChooseFiles/canChooseDirectory/allowsMultipleSelection，没有 `canCreateDirectories`，NSOpenPanel 当前系统默认不给建目录），用户视作"只读"。

三条路都不通：Electrobun 加不了参数；osascript 进程的 `NSBundle` 只有英文；应用内自绘被用户否决。

因此自建一个**随包的小 .app**（`apps/desktop/native/folderPicker.m` → `build/desktop/mac/folder-picker.app`）：

```
main(argv):
  --start <dir>                     起始目录（默认上次选择/主目录）
  NSApp ↔ Accessory + activate      无 Dock 图标、可激活
  NSOpenPanel:
    canChooseFiles = NO
    canChooseDirectories = YES
    canCreateDirectories = YES      ← 关键，补上「新建文件夹」
    prompt/message = 中文
    level = NSStatusWindowLevel     子进程不一定是前台 App，提层级保证可见
  居中：不用 [panel center]（多显示器下按面板自身屏幕居中，实测跑到 x=-1360），
        改为「鼠标所在屏幕的 visibleFrame 居中 + 夹在可视区内」，布局完成后再校正两次
  runModal → 选中的路径写到 stdout（取消则不输出）
```

- 本地化：包的 `Info.plist` 声明 `CFBundleLocalizations = [zh-Hans, en]`、`DevelopmentRegion = zh-Hans`，AppKit 才会把侧栏/按钮本地化（已用最小 .app 与本次实测双重确认：个人收藏 / 文件夹 / 其他 / 新建文件夹 / 取消 / 选择）。
- 构建：`apps/desktop/scripts/buildMacFolderPicker.mjs` 用 clang 现场编译并组装 .app；接入根 `package.json` 的 `build` 与 `build:macPicker`，非 macOS 直接跳过。
- 打包：`electrobun.config.ts` 增加 `"build/desktop/mac": "mac"`（仅 darwin）。
- 部署：`scripts/deploy-local.sh` 把 `build/desktop/mac` 同步到安装包的 `Resources/mac`。
- 主进程：`selectDirectory()` 在 darwin 上 `execFile` 该 helper（带 `--start` 记忆上次目录），失败/缺包返回 `undefined` 回退到 Electrobun 面板；结束后 `mainWindow.show()/activate()` 把焦点还给主窗口。

## 九、评审意见（补充）

| 评审人 | 结论 | 意见 |
| --- | --- | --- |
| 用户（2026-10-29 11:15） | 通过方向 | 要系统面板，必须能新建文件夹、中文、居中。 |
