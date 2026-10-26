# 记忆：浏览器画面帧洪泛卡死 + 只读滚动

## Situation

「AI 生成媒体供应商」对话框里浏览 ComfyUI `/history`（6 MB 级 JSON 文本页）时整个应用卡死，⌘Q 都退不掉；面板里也无法上下滚动页面。桌面端服务端跑在主 Bun 进程（`apps/desktop/src/index.ts` 的 `createApp()`），事件循环被占住就等于应用假死。

## Task

在不改变工具协议与交互语义的前提下，把画面流的开销降到 WebView 与主进程都能承受的量级，并允许助手运行期间只读滚动。

## Action

- `packages/tools/browser/src/host.ts`
  - 采集参数：1280×800/q65 → **960×600/q55**（文本页单帧 544 KB → 266 KB）。
  - **推迟 `screencastFrameAck` 做源头限流**：`frameIntervalMs = 120`，期间只保留最新一帧；Chromium 未收到 ack 不会推下一帧，所以帧率上限即 ack 频率。ack 必须无条件发送（包括切标签、错误页、同帧去重等跳过转发的分支），否则画面永久停住；`stopStream()` 清定时器。
  - 同帧去重：`lastData` 按流实例保存，先比长度再比内容。
  - `input()` 里滚轮不再调用 `updateState`（原先每次滚轮都新建 CDP 会话拉标题/历史）。
- `packages/tools/browser/src/browserPanel.vue`
  - 新增 `canScroll`（不要求 `interactive`），`screenPoint` 增加 `allow` 参数，`sendInput` 增加 `allowReadOnlyScroll` 形参；滚轮走只读通道，点击/键入仍受 `canInteract` 限制。
  - 滚轮遇到 409（助手正在操作）静默丢弃，不弹错、不 `resetInput`。
- `providerAgentDialog.vue`：提示改为「助手正在浏览，可上下滚动查看页面；需要点击或输入时，先点击暂停」。

## Result

6 MB 文本页滚动 5 秒：112 帧 / 61.1 MB → **42 帧 / 10.9 MB**；静止 4 秒新增 **0** 帧。三个包 typecheck 通过，`bun run build` 通过，桌面入口重新打包并安装。真实对话框内的滚动与卡死观感待用户复验（需要模型驱动一轮浏览）。
