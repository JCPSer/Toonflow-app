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
