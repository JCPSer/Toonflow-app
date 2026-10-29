# Bug 分析：目录选择器英文且位置偏移 + Agent 面板竖向杂条与模型选择缺失

- 记录时间：2026-10-29 10:20
- 来源：用户复测反馈
  - 「新建项目后，弹出窗口的位置不对，应该居中」「而且显示的是英文，不是系统语言」
  - Agent 节点面板截图：输入框右上一道一直存在的竖条；底部模型选择消失、留出空白

## 一、B1：系统目录面板英文 + 位置不居中

### 根因（已实测）

macOS 目录面板跑在 `osascript` **子进程**里。实测该进程：

```
NSBundle.mainBundle.bundleIdentifier = com.apple.osascript
NSBundle.mainBundle.localizations   = ["en"]        ← 关键
NSLocale.currentLocale              = zh_CN
```

AppKit 按"主 bundle 的本地化 ∩ 用户首选语言"决定界面语言，主 bundle 只有 `en`，所以面板的侧栏（Favorites/Folders）、按钮（Cancel/Open/New Folder）全部英文；而标题/提示来自 AppleScript 自己的文案，仍是中文——这就是"一半中文一半英文"的来源。

位置方面：`panel.center()` 在面板尺寸最终确定前执行，之后面板被撑大会以左上角为锚点，结果整体偏上约 240pt；换成 AppleScript `choose folder` 实测位置相同。

反观应用自身：`toonflow-exec.app` 的 `CFBundleLocalizations = [zh-Hans]`、`DevelopmentRegion = zh-Hans`、带 `zh-Hans.lproj`，进程内弹出的原生面板一定是中文。

### 结论

子进程那条路无法本地化（英文包是 Apple 的），也不可能精确控制位置。要同时满足"中文 + 居中"，只能把选择器搬到应用内自己画。

## 二、B2：Agent 节点面板的两处视觉问题

| 现象 | 根因 |
| --- | --- |
| 输入框右上一道一直存在的竖条 | 消息区原生滚动条。目录条占位 34px、`right: 2px`，系统设了「始终显示滚动条」时两者重叠；主对话面板宽，看不出来，380px 的节点面板里就像一条无主的竖条 |
| 模型选择"消失"+ 底部空白 | `agentNodePanel` 显式传了 `:show-model-picker="false"`（当初的约定是"统一跟随全局设置"），但输入区的模型行仍占位，于是留一条空白 |

## 三、优先级 / 难度 / 风险

| 项 | 评估 |
| --- | --- |
| 优先级 | B1 P1（一处只影响新建/打开项目的入口，但观感与可用性都受影响）；B2 P2（纯视觉） |
| 难度 | B1 中：需要新增一个桌面本地目录列举接口；B2 低 |
| 风险 | B1 中：新接口能列出任意本地目录，必须限定桌面客户端 + 同源 + 桌面请求头；B2 低 |

## 四、不做什么

- 不再尝试"让 osascript 面板变中文"（语言由主 bundle 决定，无解）。
- 不删除 `/api/desktop/selectDirectory` 路由（保留为兜底），只把桌面实现改回进程内面板并删除已废弃的 JXA 脚本。

## 五、评审意见

| 评审人 | 结论 | 意见 |
| --- | --- | --- |
| 用户（2026-10-29 10:15） | 通过 | 选择器改用应用内选择器；节点面板恢复模型选择；竖条要处理。 |
