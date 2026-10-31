# Bug 方案：桌面端系统对话框「聚焦 + 超时 + 冻结 + 结果丢失」

- 记录时间：2026-10-31 10:35
- 关联分析：`bug_analysis-2026-10-31-10-27-desktop-dialog-focus-and-timeout.md`

## 总览

| 子问题 | 方案 | 是否已验证 |
| --- | --- | --- |
| B1 面板拿不到焦点 | `folderPicker.m` 改成「先 finishLaunching → 反复请求 activate → 拿到 active 再 makeKey」 | 已在真机验证（0.71s 拿到 `active=1 key=1`，5 秒稳定） |
| B2 61 秒请求被掐断、结果丢失 | 对话框接口改**两段式**：`start` 立即返回 id，前端短轮询取结果 | 61 秒上限已实测；两段式待实现后验证 |
| B3 失败回退冻结应用 | 删除「回退到同步 `Utils.openFileDialog`」，失败直接报错 | 冻结机制已实测复现 |
| B4 导入工程用阻塞面板 | helper 增加 `--mode file`，导入/选供应商文件也走子进程 | 待实现 |
| B5 面板层级过高 | 仅把赋值改成与系统一致的 `NSModalPanelWindowLevel`（实测系统本来就把它改成 8，**不是已证实根因**） | 不承诺效果 |

改动分三块：**原生 helper**、**桌面主进程 + 服务端**、**前端**。前两块需要重启应用才生效，部署后由用户自行重启。

---

## B1 / B5：原生选择器（`apps/desktop/native/folderPicker.m`）

### 现状问题

```
[NSApp setActivationPolicy:Accessory]
[NSApp activateIgnoringOtherApps:YES]   ← macOS 14+ 是 no-op
... makeKeyAndOrderFront ... runModal
```

`activateIgnoringOtherApps` 在 macOS 14 起被 Apple 明确标注「will have no effect」；激活变成「由用户意图驱动的请求，可能被拒绝」。实测由用户点击触发时，面板 6 秒内 `active=0 key=0`。

### 新流程

```
main:
  NSApp = sharedApplication
  setActivationPolicy(Accessory)          // 不要 Dock 图标，保持不变
  finishLaunching                          // ← 新增：AppKit 启动状态补全
  建 NSOpenPanel，配置（可建目录/中文文案/起始目录）
  panel.level = NSModalPanelWindowLevel    // ← 由 Status(25) 降到 ModalPanel(8)

  activateWithRetry():
     每 150ms 一次，最多 2 秒：
        若 !NSApp.isActive → NSApp.activate()      // 新 API，非 IgnoringOtherApps
        若 isActive → panel.makeKeyAndOrderFront() + 停止重试 + 标记已激活
     超时仍未激活 → panel.orderFrontRegardless()（至少可见，避免完全不可用）

  runModal(); 退出
```

重试计时器必须同时挂 `NSModalPanelRunLoopMode` 与 `NSDefaultRunLoopMode`，否则 `runModal` 起来后就不再触发。

### 依据

- 实测日志：`finishLaunching` + 150ms 重试 → `ACTIVE after 0.71s key=1`，随后 5 秒采样全程 `key=1`。
- Apple《AppKit Release Notes for macOS 14》：激活是请求；`ignoringOtherApps` 已无效。
- 面板仍以「自己是一个 App」的形态存在（Accessory），不改 `.regular`，避免 Dock 图标闪现。

### 回退

若某台机器上 2 秒内始终拿不到激活，面板仍会显示（orderFrontRegardless），用户点一下即可——不比现状差。

---

## B3：删除阻塞回退（`apps/desktop/src/index.ts`）

```
selectDirectory():
   darwin:  helper 成功 → 返回路径
            helper 失败/缺失 → 抛错 "无法打开目录选择器，请重试"
            不再回退 Utils.openFileDialog（同步 FFI 会冻结整个应用）

selectOpenFile(ext):
   darwin:  helper --mode file --ext <ext>
   其它平台: 维持 Utils.openFileDialog
```

`chooseMacFolder` 的返回值语义保持（成功/取消/失败），只是调用方不再回退。

**注意**：抛错要带可读文案，前端已有的 catch 会把 message 弹出来。

---

## B2：两段式对话框协议

### 为什么必须两段式

WKWebView 对无响应请求有 61 秒硬上限（实测 XHR 61009ms / fetch 61010ms），这是浏览器内核行为，前端无法配置。只要「HTTP 响应 = 对话框关闭」，用户挑满一分钟就必然丢结果。唯一可靠做法是让**每个请求都很短**。

### 服务端

新增 `apps/server/src/modules/localRuntime/desktop/dialogSessions.ts`：

```
会话表 Map<id, { state: "running"|"done", value?: string|null, error?: string, startedAt }>

start(kind, options) -> id:
    若已有 running 会话 → 抛 409 "已有选择窗口正在操作，请先完成或取消"
    建会话（id = randomUUID），**不 await** 地调用 desktop runtime：
        kind=directory  → selectDirectory()
        kind=openFile   → selectOpenFile(extension)
        kind=saveFile   → selectSaveFile(fileName)   // 返回的是 saveFile token
    成功 → state=done, value
    失败 → state=done, error = 可读文案（不吞）
    返回 id

poll(id) -> { done, value?, error? }
    不存在 → 404（前端按「已过期」处理）

清理：5 分钟未取走自动过期；取走后保留 30 秒供重复轮询；进程重启即清空。
```

新增路由：

| 路由 | 说明 |
| --- | --- |
| `POST /api/desktop/dialog` body `{ kind, fileName?, extension? }` | 返回 `{ id }`，立即返回，不等对话框 |
| `GET  /api/desktop/dialog?id=` | 返回 `{ done, value?, error? }` |

删除旧路由 `POST /api/desktop/selectDirectory`、`/selectFile`、`/selectSaveFile`（调用方全部在仓库内，一一改掉；`connection.ts` 的转发白名单同步更新）。
`POST /api/desktop/saveFile`（真正写盘）与 `providerFile/read` 不动。

### 前端

新增 `apps/web/src/lib/desktopDialog.ts`：

```
pickDesktop({ kind, fileName?, extension? }, signal) -> string | null
    { id } = POST /api/desktop/dialog
    loop:
        每 350ms 轮询 GET /api/desktop/dialog?id
        done=true → error 有值则 throw；否则返回 value（null = 用户取消）
    调用方传 AbortSignal（页面卸载即停轮询）
```

调用点（4 处）：

| 文件 | 现状 | 改为 |
| --- | --- | --- |
| `pages/home/workspacePicker.vue:69` | POST selectDirectory | `pickDesktop({kind:"directory"})` |
| `lib/projectShare.ts:66` `selectShareSourceFile` | POST selectFile | `pickDesktop({kind:"openFile", extension:"tfproj"})` |
| `lib/projectShare.ts:60` `selectShareSaveTarget` | POST selectSaveFile | `pickDesktop({kind:"saveFile", fileName})` → 得到 token |
| `lib/saveFile.ts:37` | POST selectSaveFile | 同上，复用 `selectShareSaveTarget` 或直连 |
| `components/settings/.../providerDebugDialog.vue:220` | POST providerFile/select | `pickDesktop({kind:"providerFile"})` |

> 评审补充：远程连接模式下 save / import / provider 仍由本机 `nativePosts` 处理（`connection.ts:17-20`），所以这条协议对它们同样必要，不做分支。

`workspacePicker` 已有 `selecting` 守卫，保留；错误文案区分「取消」与「失败」。

---

## B4：导入 / 选供应商文件也走 helper

`folderPicker.m` 增加模式：

```
--mode dir                         （默认，现状）
--mode file --ext tfproj[,ts]      NSOpenPanel: canChooseFiles=YES canChooseDirectories=NO
                                   allowedFileTypes = 扩展名数组
                                   → 选中后 stdout 打印绝对路径，取消则空
```

`selectOpenFile` / `selectProviderFile` 在 darwin 上改走 helper；Windows 保持 Electrobun。
这样「导入工程」面板：非阻塞、有焦点、可两段式、可长开。

> 取舍：Windows 的 `Utils.openFileDialog` 同样是同步 FFI，理论上也会冻结主进程。本次不动（用户当前环境是 macOS），在「已知限制」中记录。

---

## 实施顺序

> 评审确认的依赖：**必须先消灭同步 FFI 路径，两段式才可能「立即返回」**。顺序不能颠倒。

1. B1 + B5：改 `folderPicker.m` → `bun run build:macPicker` → 替换安装包里的 helper（**无需重启**，可立刻用真实点击验证焦点）。
2. B4 + B3：helper 文件模式；桌面主进程把 `selectOpenFile` / `selectProviderFile` 接到 helper，删掉目录选择器的阻塞回退。
3. B2：服务端会话表 + `/api/desktop/dialog` 两段式路由 + 前端 5 处调用点。
4. `deploy-local.sh` 构建部署；**由用户自行重启应用**后再做端到端验证。

## Windows / 非 macOS 边界

仓库里没有 Windows 版选择器 helper（只有 `saveFileDialog.exe`），本次无法构建与验证 exe，因此：

- Windows 的选目录 / 选文件仍走 Electrobun 同步 FFI，**仍会冻结主进程、仍受 60 秒限制**；
- 两段式协议在 Windows 上第一段会被阻塞到对话框关闭（协议本身不回归，但达不到「立即返回」）；
- 列入已知限制，后续单独做 Windows helper。

## 验证计划

| 项 | 方法 | 期望 |
| --- | --- | --- |
| 焦点 | 重启后首页点「新建项目」 | 面板出现即标题栏高亮，直接按字母能跳转；日志 `active=1 key=1` |
| 长开不丢 | 面板停留 > 90 秒再选目录 | 正常回到应用并打开该目录，无「请重试」 |
| 取消 | 面板点「取消」 | 无报错、按钮恢复可用 |
| 并发 | 快速连点两次 | 第二次提示「已有选择窗口正在操作」，不弹第二个面板 |
| 冻结 | 手动 `kill -9` 选择器进程后点「新建项目」 | 弹错误提示，应用仍可操作（接口正常响应） |
| 导入 | 首页「导入工程…」 | 面板有焦点、应用不冻结、长开不丢 |
| 回归 | 另存为 / 导出 / 节点素材保存 | 正常弹出保存面板并落盘 |

## 风险

| 风险 | 处理 |
| --- | --- |
| 两段式改动面大（4 个前端调用点 + 3 条路由） | 会话表集中在单文件，单测覆盖状态机；旧路由删除而非并存，避免长期双轨 |
| 轮询在对话框打开期间持续发请求 | 350ms 间隔、单会话、请求体极小；实测主循环不阻塞（helper 是子进程） |
| helper 更换后签名失效 | 构建脚本已用 adhoc 签名；部署脚本替换后跑 `codesign -v` 自检 |
| 用户正在跑工程 | 全程不自动重启应用；helper 可热替换，其余改动等用户重启 |

## 评审意见

| 评审人 | 结论 | 意见 |
| --- | --- | --- |
| 子 agent 初评（待填） | | |
| 用户（待填） | | |
