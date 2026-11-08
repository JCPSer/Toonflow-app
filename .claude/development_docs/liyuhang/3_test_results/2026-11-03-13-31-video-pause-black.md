# 测试结果：画布视频节点暂停后画面变黑

- 时间：2026-11-03 13:31
- 对应：`bug_analysis-2026-11-03-13-31-video-pause-black.md`、`bug_solution-2026-11-03-13-31-video-pause-black.md`

## 1. 复现与排除（外部环境）

| # | 实验 | 结果 |
| --- | --- | --- |
| 1 | Safari 最小页：父级 `transform: translate scale` + `overflow:hidden` 卡片 + `object-fit:contain` + `max-height:240px` + `pointer-events:none` + dataURL 海报 + 暂停时改按钮图标 | 暂停后帧保留，**未复现** |
| 2 | Safari：`fetch → Blob → createObjectURL` 的 blob 源 | 帧保留（file:// 下 fetch 受限，改在 HTTP 下重测） |
| 3 | 自建 WKWebView（Swift + AppKit，`mediaTypesRequiringUserActionForPlayback = []`）加载同结构页面 | 帧保留，**未复现** |
| 4 | 同上 + 20 路视频同时播放后一起暂停 | 帧全部保留，**未复现** |
| 5 | 同上 + 用户真实工程视频（1920×2560 H.264 / 8 MB / 24fps）4 路 blob 源一起暂停 | 帧保留，**未复现** |

结论：应用代码路径与页面结构均无法解释；差异在 Electrobun 托管的 WKWebView 实例本身（暂停后最后一帧未被合成器保留），按平台行为处理，改用覆盖层兜底。

## 2. 方案可行性验证（关键假设）

在自建 WKWebView 里对**已暂停**的视频调用 `drawImage`：

| 取样点 | 8×8 采样 alpha 合计 |
| --- | --- |
| `pause` 事件处理器内同步绘制 | 16320（非空） |
| 暂停 1 秒后再绘制 | 16320（非空） |

→ 覆盖层方案成立：即使暂停帧在合成层丢失，解码帧仍可被画布取得。

## 3. 代码检查

- `bun run typecheck`（`packages/nodes/videoNode`，vue-tsc）：通过。
- `bun run build`：`videoNode.umd.js` 251.8 KB、`videoGenerationNode.umd.js` 460.6 KB，均构建成功并同步到 `/Applications/toonflow-data/nodes/`（旧文件备份为 `.bak.202611031335`）。
- 子 agent 代码评审：P0 无；P1 三项已处理（失败即撤层、暂停态 seek 不再要求层可见、改用布局尺寸并禁用全屏绘制）；P2 两项已处理（圆角、探针画布复用 + rAF 合并重绘）。

## 4. 待人工验证（需重启应用）

1. 播放 → 暂停：画面停在当前帧，节点其余部分正常。
2. 暂停态拖动进度条：覆盖层跟着换帧，不出现旧帧。
3. 继续播放：无闪黑（覆盖层在呈现首帧后才撤）。
4. 播完（ended）：停在末帧。
5. 原生全屏内暂停：**仍可能黑**（已知缺口，画布进不了 top layer）；退出全屏后若仍是暂停态会自动补画。
6. 画布缩放 / 调整节点宽度：暂停帧随盒子重画，不变形。
7. 切到别的节点、等 30 秒闲置释放后再播放：无残留覆盖层。

## 5. 已知边界

1. 原生全屏内暂停不覆盖，属平台 top-layer 限制。
2. `isBlankFrame` 只查 alpha，全黑但不透明的合法帧照常覆盖（本来就该是黑的）。
3. 覆盖层是「最后一帧」的静态快照，暂停期间不跟随解码器刷新；拖动进度条会主动重画。
