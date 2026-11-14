# Bug 分析：提示音不响

- 时间：2026-11-10 00:09
- 提出人：liyuhang
- 优先级：P1（提醒通道失效，用户不知道节点已结束/Agent 在等回答）
- 状态：已实施加固与可验证入口（根因待用户重启后确认）

## 1. 现象

用户反馈「现在没有提示音了」。应用在 2026-11-10 00:00 重启，运行的是 11-08 19:30 的 web 产物。

## 2. 已核对的证据（均正常）

| 环节 | 结论 |
| --- | --- |
| 设置 | `/Applications/toonflow-data/settings.json`：`general.completionSound=always`、`completionSoundVolume=70`，开关未关、音量非 0 |
| 部署产物 | 当前 `index.html` 引用的 `index-dWfA8xnu.js` 含 `unlockChime`/`installTaskAlerts`，`sessionState-*.js` 含 `toonflow:node-task` 与合成音代码 |
| 事件源 | `nodeSkeleton` 的 `busy` 下降沿调用 `markNodeBusy`，派发 `toonflow:node-task`；11 个内置节点 UMD（11-07 14:10 重建）都包含该事件 |
| 触发门槛 | `MIN_DURATION_MS = 30s`、1 秒合并、`cancelled` 不响；只有完成/失败或 Agent 主动提问才响，普通回复不响 |
| 系统音频 | 输出未静音（`output muted:false`、音量 50），默认输出为 Studio Display Speakers |

同时确认一个既有事实：应用数据目录里 5 个手工安装节点（`execNode`、`videoPostNode`、`imageResizeNode`、`depthCaptureNode`、`webEpisodeEditorProNode`，构建于 10-24/10-29）不包含任务完成事件，跑这些节点**永远不会**响，也不会进未读横幅。

## 3. 根因候选

1. **音频上下文没有解锁（最可疑）**：`main.ts` 用 `{ once: true }` 只尝试一次 `resume()`。桌面 WKWebView 里首次手势可能撞上音频子系统未就绪或构造失败，监听随即被消耗；之后 `playChime` 里的 `resume()` 没有用户手势会被拒绝，整轮会话静音。这与「重启后开始不响」吻合。
2. **触发条件不满足**：完成音要求任务 ≥30 秒且节点是内置节点；重启后项目里没有新的生成产物，可能今天还没有 ≥30 秒的内置任务跑完。Agent 普通回复本来就不响。
3. **系统/设备层**：输出设备切到 Studio Display 或外接设备无音量，属于环境问题，代码侧无法判定。

## 4. 目标

1. 把「音频没启动」变成可自证：设置页提供「试听」，点一下就能判断是音频链路还是事件链路。
2. 解锁不再一次性：每次用户手势都尝试恢复，直到 `AudioContext.state === "running"` 才解绑。
3. 不改变既有触发规则（30 秒门槛、合并窗口、开关口径）。

## 5. 风险

- 每次手势尝试 `resume()` 有极小开销；成功后立即解绑。
- 试听按钮点击时若音频仍未启动，明确提示，不静默失败。
- 不改事件链与门槛，避免误判为「修好了」其实只是换了条件。

## 6. 评审意见

（待用户填写）

- 是否通过：
- 其他要求：
