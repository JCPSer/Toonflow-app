# 记忆：画布视频节点暂停后画面变黑（暂停帧画布覆盖）

- 时间：2026-11-03 13:31
- 类型：Electrobun WKWebView 平台行为 + 播放器兜底

## STAR

**Situation（背景）**
画布视频节点播放中点暂停，画面区不到 1 秒变纯黑；节点标题、进度条、时间、音量、截帧都正常，继续播放立刻恢复。用户确认「一直就有」，不是回归。

**Task（任务）**
先判定是应用逻辑、媒体编码还是平台渲染，再给出可用修复。

**Action（行动）**
- 代码路径取证：`@pause` 只置 `playing=false`；`useLazyFileUrl` 的闲置释放是 30 秒（线上 bundle 里确认 `3e4`），且释放后显示首帧海报而非纯黑 → 不是卸载/换源。
- 外部复现全部失败：Safari 最小页（变换祖先 + overflow 卡片 + object-fit + 指针穿透 + dataURL 海报 + 暂停改图标）、blob 源、自建 WKWebView、20 路视频、用户真实 1920×2560 工程视频 → 暂停帧都保留。
- 关键假设验证：自建 WKWebView 里对**已暂停**视频 `drawImage`，pause 处理器内与暂停 1 秒后采样 alpha 均为 16320（非空）→ 覆盖层方案可行。
- 修复：`packages/nodes/videoNode/src/components/videoPlayer.vue` 加 `.videoStage` + `canvas.pausedFrame`；暂停/结束同步画帧并显示，播放时等 `presentedFrame`（rVFC）报告首帧后再撤层；暂停态 `seeked` 等一次帧呈现后重画；进全屏隐藏、退全屏补画；`src` 变化与 error 复位；`ResizeObserver` + rAF 合并重绘；按 `clientWidth/clientHeight × DPR` 绘制（不乘画布 zoom），`object-fit: contain` 口径居中。
- 代码评审后修正：绘制失败即撤层（避免旧帧覆盖新位置）、暂停态 seek 不再要求层可见、全屏不分配整屏画布、探针画布复用。

**Result（结果）**
`videoNode.umd.js` / `videoGenerationNode.umd.js` 已重建并同步到 `/Applications/toonflow-data/nodes/`（旧包备份 `.bak.202611031335`），**未重启应用**；待用户重启后人工验收。原生全屏内暂停仍会黑，属已知缺口。

## 关键经验

1. 「暂停就黑」先分清是**解码丢了**还是**合成层没保留**：继续播放能恢复，基本就是后者。
2. 排查平台差异时，用最小页 + 自建 WKWebView 做对照，能快速把「页面写法」和「宿主 WebView」切开；两者都没复现，就该怀疑宿主实例本身而不是继续改 CSS。
3. 画布覆盖层的尺寸要按**布局尺寸 × DPR**，不能用 `getBoundingClientRect`——后者含 Vue Flow 的画布缩放，高倍缩放下位图按 zoom² 膨胀。
4. 绘制失败时宁可撤层露原生画面，也不要留着过期帧：停帧核对场景里「错的帧」比「黑屏」更危险。
