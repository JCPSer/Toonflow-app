# Bug 分析：浏览器画面帧洪泛导致应用卡死 + 画面无法滚动

日期：2026-10-26 22:30
状态：待修复

## 一、现象

「AI 生成媒体供应商」对话框右侧的浏览器画面（ComfyUI `/history` 原始 JSON 页）在浏览过程中整个应用卡死：鼠标点不动任何控件，⌘Q 也无法退出，只能强制结束进程。复现两次。用户同时在面板内无法上下滚动网页内容查看。

## 二、实测证据（本机复现，构造 6.26 MB JSON 文本页）

用 `packages/tools/browser/src/host.ts` 真实运行时，无头 Chrome 打开页面：

| 断言 | 结果 |
| --- | --- |
| 静止页面单帧大小 | **544 KB**（1280×800、JPEG quality 65） |
| 用滚轮持续滚动 5 秒（约 16 次/秒） | **112 帧、61.1 MB**，约 22 fps，单帧均值 559 KB |
| 事件循环延迟（服务端 Bun 进程） | 无操作时 2 ms，帧洪泛期间 CPU 被写流占用 |
| `read` 单页 | 26 ms / 12 KB，`total` 6.26 MB |
| 桌面端进程结构 | `apps/desktop/src/index.ts:236` 在**主 Bun 进程**里 `createApp()`，HTTP 服务、菜单（含 ⌘Q）共用同一事件循环 |

## 三、根因链

1. `Page.startScreencast` 以 `quality: 65, maxWidth: 1280, maxHeight: 800` 采集，文本密集页压缩率极低 → 单帧 0.5 MB 以上。
2. `host.ts` 收到 `Page.screencastFrame` 后**立即 ack**，Chromium 于是按合成器帧率继续推送；一次滚轮滚动就能产生 20+ fps。
3. 服务端逐帧 `JSON.stringify`（含 0.5 MB base64 字符串）并写入 NDJSON 流，约 12 MB/s 的字符串分配与写流，全部发生在**主进程事件循环**里；WebView 侧同时逐帧解析 JSON、生成 `data:image/jpeg;base64,...` 并让 `<img>` 解码 0.5 MB JPEG。
4. 主进程与 WebView 双双饱和 → 整个应用无响应，⌘Q 的菜单回调也排不上队，只能强杀。
5. 面板 `canInteract` 同时要求 `props.interactive`（`providerAgentDialog.canOperateBrowser()` 在助手运行中返回 false），所以助手工作期间滚轮被 `@wheel.prevent` 吞掉且不转发，用户无法滚动页面查看；这正是「超过一定长度无法滚动查看」。
6. 帧洪泛期间出现的「工具界面加载失败：timeout exceeded」是同一阻塞的下游症状：主进程忙 → 前端 `/api/tools/renderers` 的 XHR 被 WebKit 判超时。

## 四、目标

1. 滚动浏览大页面时应用保持可操作，⌘Q 可正常退出；帧数据量下降一个数量级。
2. 静止页面不再持续产生流量。
3. 助手运行期间允许用户**只读滚动**页面（不放开点击/输入，避免干扰助手）。
4. 不改变工具协议与既有交互语义（点击、输入仍受 `interactive` 控制）。

## 五、优先级 / 难度 / 风险

P0（应用级卡死），难度中低，风险中：

- 节流会影响「实时性」观感，需要在 ≤8 fps 内保持可用；
- 降分辨率后放大查看的清晰度下降，需要确认是否可接受；
- 放开滚轮输入会向远端页面发送真实滚动，需确认不会与助手正在执行的点击坐标冲突。

## 六、评审意见

子 agent 评审确认：根因判断成立；补充要求 ack 无条件发送、滚轮入口与 `sendInput` 门禁一并改、滚轮跳过 `updateState`。细节见方案文档「评审意见与取舍」。
