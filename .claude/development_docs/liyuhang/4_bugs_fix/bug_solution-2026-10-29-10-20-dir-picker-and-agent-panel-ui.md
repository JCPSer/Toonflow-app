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
