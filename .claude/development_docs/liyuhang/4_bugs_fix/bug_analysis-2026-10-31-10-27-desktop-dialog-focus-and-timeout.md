# Bug 分析：桌面端系统对话框「不聚焦 + 一分钟报错 + 结果丢失 + 冻结应用」

- 记录时间：2026-10-31 10:27
- 环境：macOS 15.7（Sequoia）/ Apple Silicon / toonflow 2.0.7 安装版（`/Applications/toonflow-exec.app`）
- 用户原话：「在首页打开工程的时候，它弹出的框总是不能自动聚焦……它提示无法打开文件选择器，请重试，但是文件选择器开着的，只是没聚焦。」

## 一、背景

桌面端所有「选目录 / 选文件 / 另存为」都走系统原生对话框，实现分三条完全不同的路径：

| 入口 | 前端 | 服务端路由 | 桌面实现 | 是否阻塞主进程 |
| --- | --- | --- | --- | --- |
| 新建项目 / 打开已有项目 / 设置页选目录 | `workspacePicker.vue:69` | `POST /api/desktop/selectDirectory` | 随包 `folder-picker.app` 子进程（`apps/desktop/src/index.ts:535`） | 否 |
| 导入工程（.tfproj） | `home/index.vue:360` | `POST /api/desktop/selectFile` | Electrobun `Utils.openFileDialog`（同步 FFI） | **是** |
| 另存为 / 导出 / 下载 | `saveFile.ts:37` | `POST /api/desktop/selectSaveFile` | `osascript` 子进程（`apps/desktop/src/saveFile.ts:31`） | 否 |

三者共享同一个致命形态：**HTTP 响应要等用户把对话框关掉才返回**。

## 二、复现与实测证据

### 2.1 现象复现

点击首页「新建项目 / 或打开已有项目」→ 弹出「选择工作目录」面板 → **面板是灰的、键盘无响应** → 约 1 分钟后弹出「无法打开文件选择器，请重试」，此时面板仍开着 → 用户在面板里选完目录点「选择」→ **没有任何反应**。

### 2.2 实测 1：面板真的没有焦点（不是错觉）

给 `folder-picker.app` 装了一个自检探针（与生产版逐行一致，仅追加 `[NSApp isActive]` / `[panel isKeyWindow]` 日志），由用户真实点击触发：

```
t=100ms  active=0 key=0 visible=1 frontApp=Toonflow level=8
t=600ms  active=0 key=0 visible=1 frontApp=Toonflow
...
t=5600ms active=0 key=0 visible=1 frontApp=Toonflow
```

6 秒内**从未**变成 active —— 面板可见但从来不是 key window，键盘输入自然无效。
（对照组：同样代码用 curl 直接触发时 `active=1 key=1`，说明不是代码本身，而是「用户点击后的激活上下文」导致激活被拒。）

### 2.3 根因 1：macOS 14+ 的协作式激活

- Apple《AppKit Release Notes for macOS 14》：app 激活改为「由用户意图驱动的**请求**」；`NSApplication.activate(ignoringOtherApps:)` 与 `NSApplication.ActivationOptions.activateIgnoringOtherApps` **已废弃且 no effect**。
- 现有 helper（`apps/desktop/native/folderPicker.m:17-18`）恰恰只调了这个 no-op：`[NSApp setActivationPolicy:Accessory]` + `[NSApp activateIgnoringOtherApps:YES]`，之后再没有重试。
- 实测：激活请求是**延迟批准**的。把 `activateIgnoringOtherApps` 换成 `[NSApp finishLaunching]` + 每 150ms 重试 `[NSApp activate]`，面板 **0.71 秒后**变成 `active=1 key=1` 并稳定保持（5 秒采样全程 key=1）。

### 2.4 根因 2：WKWebView 对「无响应请求」有 61 秒硬上限

用 WKWebView 在本机（macOS 15.7）对同一接口做对照，同一请求分别用 XHR 与 fetch：

```
xhr timeout     61009ms
fetch error     61010ms（Load failed）
```

服务端在同一时刻仍在正常处理（另用 curl 打到 100 秒的慢接口也能正常返回 200）。

结论：**不是服务端超时，是浏览器内核在 61 秒处砍掉请求**。而对话框接口的响应被绑在「用户关掉对话框」这一刻，用户挑目录超过 1 分钟 → 请求必死 → axios 走到 catch → 弹「无法打开文件选择器，请重试」；用户随后选中的路径也一并丢失（响应没有接收方）。

这解释了用户描述的「提示报错，但选择器还开着」——报错时对话框确实还在，只是那条请求已经死了。

### 2.5 根因 3：失败回退把整个应用冻住

`apps/desktop/src/index.ts:535-550`：

```
try { selected = await chooseMacFolder() }   // 子进程
finally { mainWindow.show(); mainWindow.activate() }
...
const [path] = await Utils.openFileDialog({...})   // 子进程失败才走到这
```

`Utils.openFileDialog` 是**同步 FFI**：`.hutch/devkit/api/sdks/main/proc/native.ts:2332` 直接同步调用原生符号，原生层 `dispatch_sync` 到 Cocoa 主线程执行 `runModal`。而 Express 服务器与桌面主进程是**同一个 Bun 进程、同一个事件循环**（`apps/desktop/src/index.ts:263-267` + `connection.ts:98`）。

因此一旦 helper 启动失败或被系统杀掉，回退路径会让**整个应用冻结**：所有接口停摆、正在跑的 Agent 也停。（本次排查中已实际触发两次，用户手动点「取消」才恢复。）

### 2.6 根因 4：「导入工程…」用的就是那条阻塞路径

`selectOpenFile`（`index.ts:527`）没有任何「子进程」保护，直接调 `Utils.openFileDialog`。所以：

- 打开导入面板期间，应用所有接口冻结（Agent 停摆）；
- 面板开超过 61 秒，同样报「无法打开文件选择器」并丢失结果。

### 2.7 附带观察：层级导致「切走之后像卡死」

helper 把面板设成 `NSStatusWindowLevel`（`folderPicker.m:31`），是为了「子进程不一定是前台 App，怕被主窗口盖住」。激活修好之后这个层级不再必要，而且会带来副作用：用户切到别的窗口后，面板仍浮在所有窗口之上、渲染成灰色不可交互的样子——看起来像卡死。

## 三、Bug 矩阵

| 编号 | 描述 | 优先级 | 难度 | 风险 | 影响面 |
| --- | --- | --- | --- | --- | --- |
| B1 | 目录选择器在 macOS 14+ 永远拿不到键盘焦点（单次调用已废弃 API、无重试） | P0 | 低 | 低 | 所有选目录入口 |
| B2 | 对话框接口把 HTTP 响应绑在对话框生命周期上，超过 61 秒必被 WKWebView 掐断 → 报错误导 + 选中结果丢失 | P0 | 中 | 中（要改协议与 4 处前端调用） | 选目录 / 导入 / 另存为 |
| B3 | helper 失败时回退到同步阻塞面板，冻结整个应用（含运行中的 Agent） | P0 | 低 | 低 | 选目录 |
| B4 | 「导入工程…」直接用阻塞 FFI，面板开着期间应用完全冻结；同样受 61 秒限制 | P1 | 中 | 中 | 导入 |
| B5 | 面板层级过高：应用失活后仍浮在最上层、呈灰色，观感像卡死 | P2 | 低 | 低 | 选目录 |

## 四、目标

1. 对话框一出现就是**激活状态**，键盘直接可用，不再需要先点一次。
2. 用户无论挑多久（含超过 1 分钟），**选中的结果都能正确回传**，不再出现「重试」提示。
3. 任何对话框失败都**不得冻结应用**。
4. 以上对 Windows / 远程连接 / 移动端不产生回归（这些平台的对话框实现不同）。

## 五、不做什么

- 不改「另存为」的 osascript 实现（它已是子进程、非阻塞），只把它的接口接上两段式协议。
- 不重做 UI，不加新入口。
- 不处理「对话框长时间不关」的进程占用问题（单实例、用户主动操作）。

## 六、待确认（见方案文档）

- 是否一并把「导入工程…」从 Electrobun 阻塞面板换成随包 helper（B4）？
- 两段式协议的实现位置（服务端会话表 vs 桌面运行时）。

## 七、评审意见

| 评审人 | 结论 | 意见 |
| --- | --- | --- |
| 子 agent 初评（2026-10-31 10:35） | 需修改 | 矩阵漏了 Windows 选目录、provider 选文件；60s 表述不准；level 证据自相矛盾；部分代码引用不忠实。详见第八节修订。 |
| 用户（2026-10-31 10:40） | 通过（全修范围） | 焦点 + 61 秒 + 冻结 + 导入一起修；现在实施，改完自行重启。 |

## 八、按评审修订（2026-10-31 10:45）

### 8.1 事实修正

1. **60 秒的性质**：不是"WKWebView 硬上限"，而是 WebKit 网络进程默认的**无数据 60 秒超时**（本机 `URLSessionConfiguration.default.timeoutIntervalForRequest = 60.0`，实测 61009/61010ms 即 60s + 开销）。有数据持续到达的流式响应可以超过 60 秒。该默认值属 macOS/WebKit 口径，Windows WebView2 不一定相同。**bug 的定义是「响应被绑在对话框生命周期上」，60 秒只是触发条件。**
2. **文案**：选目录的 catch 文案实际是「无法打开**文件夹**选择器，请重试」（`workspacePicker.vue:83`）；导入路径走 `shareErrorMessage`，网络被杀时 axios 的 message 是 `Network Error`，不会落到 fallback「无法打开文件选择器」。用户原话是转述，不影响根因。
3. **回退分支的判据**：`selectDirectory` 里是 `if (selected !== undefined) return selected;` —— `null` 表示用户取消（正常返回），只有 `undefined`（helper 缺失/执行失败）才走回退。原分析 2.5 省略了这一行，容易误读。
4. **B5 降级**：探针在 `panel.level = NSStatusWindowLevel(25)` 之后实测读到 `level=8`，说明系统（面板服务）自己把层级改成了 `NSModalPanelWindowLevel`。「层级过高导致浮在最上层」**未被证据支持**，本次不作为独立 bug，只把赋值改成与系统一致的 8（无行为变化），避免文档与代码对不上。

### 8.2 补充入口（原矩阵遗漏）

| 入口 | 现状 | 归属 |
| --- | --- | --- |
| 供应商选文件 `providerDebugDialog.vue:220` → `/api/desktop/providerFile/select` | 无条件 `Utils.openFileDialog`（同步 FFI），阻塞 + 60 秒丢结果 | B4 类 |
| Windows 上选目录 `index.ts:536` 的 darwin 分支被跳过 → 落到 548 行同步 FFI | **每次选目录都冻结整个应用** | B3 类（Windows 主路径） |
| 原生开发/本机页面的 `/api/workspaces/selectDirectory`（osascript / PowerShell 子进程） | 同样是「响应绑对话框」，受 60 秒影响 | 已知、本次不改（非安装版主路径） |
| 远程连接下的 save / import / provider | `connection.ts:17-20` 的 nativePosts 由本机处理，仍走本机原生面板 | 同 B2，一并改协议 |

### 8.3 明确「看似同类但不走这条路」（避免误修）

- 分享包**拖拽/上传**导入（`shareImportDialog` + `uploadShareFile`）不经过 `selectFile`，不受影响；受影响的只有「导入工程…」按钮。
- 非桌面/远程/移动端的页内目录浏览（`el-dialog`）是应用内自绘，列表接口即时返回，不受 60 秒与焦点问题影响。
- 项目卡片直接点击打开工程不弹框；只有目录 404 触发重定位时才弹。
- 「另存为」走 osascript 子进程（`saveFile.ts:44`），不阻塞主进程，但同样受 60 秒限制。

### 8.4 优先级调整

- B4（导入/供应商选文件用阻塞 FFI）由 P1 上调为 **P0**——每次导入都会冻结应用，与 B3 同级。
- B5 由 P2 降级为「观察项」，本次只做等价化处理。

### 8.5 范围边界

- **Windows 的选目录/选文件本次不改**：仓库里没有 Windows 版原生 helper（只有 `saveFileDialog.exe`），而本次无法在本机构建/验证 exe。Windows 仍会阻塞主进程，列为已知限制，后续单独做。
- 两段式协议的先决条件是「先发起请求就能立即返回」，所以 macOS 上三条阻塞 FFI 路径（导入、供应商、目录回退）必须**先**改成子进程 helper，协议改造才有意义。实施顺序必须是 B1/B3/B4 → B2。
