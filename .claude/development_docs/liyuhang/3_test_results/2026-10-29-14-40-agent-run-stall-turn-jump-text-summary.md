# 测试结果：轮次跳转收敛 / 文本摘要 150 字 / 同源连接探针

- 记录时间：2026-10-29 14:40
- 关联：`4_bugs_fix/bug_analysis-2026-10-29-14-10-agent-run-stall-turn-jump-text-summary.md`、`4_bugs_fix/bug_solution-2026-10-29-14-10-…md`
- 范围：本轮只做 B2、B3 与 B1 探针（用户决策：先做 B2+B3，同时埋探针）

## 一、静态验证

| 项 | 结果 |
| --- | --- |
| `apps/web` vue-tsc | 通过（仅既有 `server/.../singleAgent/types.ts(2,33) TS2307`） |
| `apps/server` tsc | 通过 |
| `deploy-local.sh --build` | 成功（本轮 3 次：初版 / 去 rAF 改定时器 / 稳定判定） |
| 服务端产物 | `bun/index.js` 含 `mimeType:"text/markdown",...summary` 分支（`mentionTextSummary`） |
| 前端产物 | `workspace-*.js` 含 150 字文案与摘要渲染分支；`netProbe` 字符串已进产物 |

## 二、B2 轮次跳转（Chrome 直连本地应用，Agent4-1 面板，22 轮）

修复前（同一次点击，冷状态）：`scrollTop=7361`，目标第 10 轮（虚拟行 index 18）在视口顶部下方 **1218px**，最近可见行是 index 17（-292px）。

修复后（冷状态点击，即列表尚未测量过）：

| 点击 | 落点行 index | 与容器顶部偏差 | 落定后 2s |
| --- | --- | --- | --- |
| 第 10 轮 | 18 | **0px** | 不变（scrollTop 8579 稳定） |
| 第 1 轮 | 0 | 0px | 稳定 |
| 第 4 轮 | 6 | 0px | 稳定 |
| 第 16 轮 | 30 | 0px | 稳定 |
| 第 22 轮 | 41 | -1px | 稳定 |

过程中量到的关键事实：首次渲染 8 行后 `scrollHeight` 会连续变化（11910 → 15275 → 17776），**落点会被后到的测量推走**，因此校正必须要求"连续 3 次稳定"才收手，而不是校正一次就结束。

排障记录：中途两版实现（rAF + 单次校正、rAF + 3 次）实测均无效，用 `Object.defineProperty(list,'scrollTop')` 拦截 + 包装 `Element.prototype.querySelector` 才定位到"循环只跑了一轮就因 delta≈0 退出，但随后测量把位置推走"。

## 三、B3 文本摘要

| 项 | 结果 |
| --- | --- |
| `mentionPreviewLength` | 200 → 150（上游摘要与文本引用摘要共用同一常量） |
| 提示词文案 | `runtime/mentions.ts:78` 改为「预览最多 150 字」 |
| `createCanvasMention` | 文本输出返回 `{ path, mimeType, summary }`；`textSnapshot` 优先，否则 `readText` 读正文，失败只省略 `summary` |
| 两条调用链传 reader | 实时画布 `canvasHost.vue`（useWorkspaceFiles.readText）、离线 `mentionFiles.ts`（readMentionText） |
| 接口实测 | `GET /api/agent/mentionSource?operation=selectCanvas…` 返回 200、`dataType=STRING`、`value={path,mimeType}`（**无 summary**） |

**接口实测未通过，原因已确认**：桌面应用当前进程跑的仍是旧服务端代码；新代码已进 `bun/index.js`，**需重启应用**才生效。重启后同一请求应返回 `summary`（正文前 150 字）。
引用气泡展示（`mentionContent.vue`）同理，需重启后验证。

## 四、B1 探针（已内置，等待复现）

`window.__toonflowNet.snapshot()` 实测（单页加载完成、未跑任何 Agent）：

```json
{"inflight":0,"streams":2,"peakInflight":24,"peakStreams":2,"blocked":0,"total":73,
 "streamsByPath":{"/api/ffmpeg/events":1,"/api/ai/media/balanceEvents?accountIds=…":1}}
```

结论性事实：**同源在飞请求峰值 24 条**，远超浏览器 HTTP/1.1 每源 6 条；起手就有 2 条常驻 EventSource。这与 B1 分析里 C4（连接池耗尽）方向一致，但只是"存在排队"，还没证明复现时正是它导致超时。

待办（需要用户复现一次有问题的 Agent 执行）：

1. 执行期间读 `window.__toonflowNet.snapshot()`，看 `inflight`/`streams`/`peakInflight`；
2. 看控制台是否出现 `[net] 同源在飞请求持续 ≥6`（探针自动打印）；
3. DevTools Network 里看失败请求是 `Queued/Stalled`（→ C4）还是 `Waiting(TTFB)` 长（→ 服务端慢）。

判据与后续修法见方案第 0.3 / 1A / 1B。

## 五、回归影响

- 轮次跳转只改 `jumpToTurn`，未动虚拟器参数与贴底逻辑；点第 22 轮（最后一轮）落点 -1px，`atLatestMessage` 末尾重算，右下角「回到最新消息」行为未变。
- 摘要改动只在服务端拼装 References 时发生，不改变节点运行时 `getTargetValues` 链路。

## 六、代码审查意见与修复（子 agent，2026-10-29 14:50）

| 级别 | 问题 | 处理 |
| --- | --- | --- |
| Critical | `textPointerSchema = z.strictObject({path,mimeType})` 不认新增的 `summary`，文本输出引用一发送就 400 | 已补 `summary: z.string().max(600).optional()`；服务端产物已核对含该 schema |
| Important | 并发跳转无取消，两个收敛循环同时写 scrollTop | 加 `jumpToken`，每轮校验；`wheel`/`touchstart` 触发 `cancelJump` |
| Important | 粗估步长可能过冲来回摆 | 步长夹到 ±max(120, clientHeight×0.8) |
| Important | `onChange` 会用 `isAtEnd()` 覆写贴底标志，与收敛循环对拉 | 加 `jumping` 标志，收敛期间 `onChange` 直接返回 |
| Important | `turn.index` 越界时会朝端点推 24 轮 | 入口加越界检查 |
| Important | XHR 用 `loadend` 计时，把传输时间算成排队 | 改用 `readystatechange` 的 `readyState===2`（首字节） |
| Important | EventSource 计数泄漏（`close()` 不减、自动重连时减了不补） | 包 `close()` 主动释放；`error` 仅在 `readyState===CLOSED` 时释放 |
| Important | 用户点「停止」的 AbortError 计入 blocked | 跳过 `AbortError` |
| Minor | 探针重复 import/HMR 会重复包装 | 加 `Symbol.for` 幂等标记 |
| Minor | 注释写「最多 8 轮」而实现是 24 轮 | 注释已对齐 |

审查后复测（重新部署 + 刷新页面）：

| 场景 | 结果 |
| --- | --- |
| 冷状态点第 10 轮 | 落点 index 18，偏差 0px |
| 快速连点第 3 轮 → 第 18 轮 | 后一次接管，落点 index 34，偏差 0px |
| 跳转中滚轮打断 | 立即停住，不再被拉回（停在 index 7，-257px） |
| 探针 | `peakInflight=24`、`streams=2`、`blocked=0`（改为首字节口径后不再把传输时间算成排队） |

未处理（记录在案，非本轮引入）：`canvasHost.vue` 的 `selectNode` 未传 `extraValue`，画布打开时创建的 Agent 节点引用没有 `agent` 会话摘要字段（走服务端离线链路才有）；`mentionContent` 的 NODE 分支不展示 `agent`。两者与本次三个 bug 无关。
