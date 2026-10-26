# Bug 方案：浏览器画面帧洪泛卡死 + 无法滚动

日期：2026-10-26 22:45
状态：待实施

## 一、服务端节流（`packages/tools/browser/src/host.ts`）

### 1. 采集参数降档

`Page.startScreencast` 改为 `quality: 55`、`maxWidth: 1024`、`maxHeight: 640`。面板在对话框里的显示宽度约 700–900 px，1024 宽足够；文本页单帧预计从 ~560 KB 降到 ~150–220 KB。

### 2. 用 ack 做源头节流（关键）

Chromium 收到 `Page.screencastFrameAck` 才会继续推送下一帧，因此**推迟 ack 就是限流**：

```
onFrame(event):
  pending = event                    # 只保留最新一帧
  if timer: return
  wait = MIN_INTERVAL - (now - lastSentAt)
  timer = setTimeout(flush, max(0, wait))

flush():
  timer = undefined
  frame = pending; pending = undefined
  lastSentAt = now
  ack(frame.sessionId)               # 先 ack，允许下一帧
  if frame.data === lastData: return # 静止页面不重复发
  lastData = frame.data
  session.frame = frame; emit(frame)
```

- `MIN_INTERVAL = 120ms` → 上限约 8 fps。
- 相同帧（未变化）只 ack 不发，静止页面流量趋近 0。
- `stopStream()` 清理 timer / pending / lastData，避免关流后仍 ack。

### 3. 流路由背压保持

`routes/browser/stream.ts` 现有「慢客户端只保留最新状态 + 一帧」逻辑不变；节流后单帧变小，缓冲压力同步下降。

## 二、前端（`packages/tools/browser/src/browserPanel.vue`）

### 1. 帧数据用 Blob URL

- 收到 base64 后转 `Blob`，`URL.createObjectURL`，`img.src` 用短 URL；
- 新图 `load` 后 `revokeObjectURL` 上一张，卸载时释放；
- 不再把 0.5 MB 的 `data:` 字符串挂在 DOM 属性 + Vue ref 上，降低解码与 GC 压力。

### 2. 客户端兜底丢帧

帧间隔 < 100 ms 时直接丢弃（服务端已节流，这里是双保险，防止旧版本服务端或异常突发）。

### 3. 允许「只读滚动」

- 新增 `canScroll`：`props.active && props.live !== false && status === "live" && session.status === "running" && tabId && scope`，**不要求 `interactive`**。
- `wheelScreen` 用 `canScroll` 放行；点击、键入仍要求 `canInteract`。
- `screenPoint` 增加 `allow` 参数，滚轮路径传入 `canScroll`。
- 滚动输入仍走同一输入队列与 80 ms 合并；页面滚动后帧变化自然会带来新画面。

### 4. 交互提示

`providerAgentDialog.browserHint()` 在助手运行中补充「可滚动查看页面，点击/输入请先暂停」，避免用户以为面板坏了。

## 三、验收

1. 6 MB JSON 文本页，滚轮连续滚动 5 秒：帧数 ≤ 45、总字节 ≤ 8 MB（当前 112 帧 / 61 MB）。
2. 静止 30 秒：除首帧外无新帧。
3. 滚动期间应用可点击、⌘Q 可退出。
4. 助手运行中可上下滚动页面；点击、输入仍被禁用。
5. 放大查看（el-dialog 80%）时画面清晰度可接受。

## 四、评审意见与取舍

子 agent 评审后调整：

- **ack 无条件发送**：放在转发判断之前，跳过转发（切标签、错误页、同帧去重）也必须 ack，否则 Chromium 停止推送、画面永久黑屏。`stopStream()` 清理定时器，避免 detach 后 ack。
- **`sendInput` 门禁**：原方案只改滚轮入口不够，`sendInput` 首行仍要求 `canInteract`，一并改为 `canInteract || (allowReadOnlyScroll && canScroll)`。
- **滚轮 409 静默丢弃**：助手正在操作页面时服务端会拒绝，前端不弹错、不 `resetInput`，避免打断浏览。
- **滚轮不再触发 `updateState`**：原来每次滚轮都新建 CDP 会话拉标题/历史，放开滚动后会显著加压主循环。
- **暂不改 Blob URL**：评估后认为瓶颈是帧率与分辨率，不是 DOM 字符串；Blob 的 revoke 竞态（新图未 load、切标签、卸载）风险大于收益，留作后续优化。
- **未做自适应分辨率**：折叠态与放大态共用 960×600，放大时略软；按 expanded 切换采集分辨率需要重启 screencast（会闪断），暂不做。

## 五、评审意见

（待用户填写）
