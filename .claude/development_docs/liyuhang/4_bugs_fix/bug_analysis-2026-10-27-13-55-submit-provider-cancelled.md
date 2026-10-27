# Bug 分析：submitProvider 100% 返回「工具调用已取消」，供应商文件无法生成

- 记录时间：2026-10-27 13:55
- 报告人：用户（Toonflow 内置「AI 生成媒体供应商」对话）
- 影响版本：桌面安装包 `/Applications/toonflow-exec.app`（Contents/Resources/app/bun/index.js，2026-10-27 12:04 构建；对应源码 commit 30139c9 + 63b410e 之后）
- 代码基线：commit `23c190f`（2026-10-27 11:50，把 server 拆成 7 个子模块，`singleAgent/index.ts`、`routes/singleAgent/*` 均有目录迁移）。评审与行号均按该提交核对

## 一、背景

「AI 生成媒体供应商」是内置在设置 → 媒体模型 → 添加自定义供应商里的临时对话（`singleAgentDialog` + `providerAgentDialog.vue`）。它只有一条「客户端工具」链路：模型调用 `submitProvider(source)` → 服务端把调用派发给前端 → 前端在浏览器里执行（静态校验 + 预览）→ 前端把结果回传给服务端。

这条链路是全仓库唯一的客户端工具（`grep SingleAgentTool` 只命中 `providerAgentDialog.vue`），因此它的任何缺陷只会在这一个入口暴露。

## 二、现象

用户报告：

1. 每次调用 `submitProvider` 都在数秒内返回工具结果「工具调用已取消」，共 7 次，参数从 40 KB 到 500 字节都试过，全部失败。
2. 从未进入静态格式检查，也没有生成预览，前端拿不到任何错误码或原因。
3. 同一会话里 `browser`（server 插件工具）多次成功；`askUser` 多数成功，其间出现过一次「提问已取消」。
4. 失败时整轮回复被终止，提示超时；右侧浏览器页签当时正在实时显示画面。
5. 期望：工具能正常成功并显示预览；失败时返回明确的错误码与原因。

## 三、bug 矩阵

| 编号 | 描述 | 优先级 | 难度 | 风险 | 状态 |
| --- | --- | --- | --- | --- | --- |
| B1 | 中止原因被吞两次：`createClientTool` 把任何中止改写成「工具调用已取消」，`run()` 的 catch 又把任何中止改写成「本次回复已停止」。用户与模型都拿不到真实原因（对话关闭 / 回复停止 / 提问取消 / 网络断开 / 未知中止源） | P0 | 低 | 低 | 已确认 |
| B2 | 中止来源无法定位：`run.ts` 的 `controller.abort()` 不带 reason，客户端工具忽略 `signal.reason`，`control(close/stop)` 与 `close()` 没有任何日志，服务端不存在可事后追查的记录 | P0 | 低 | 低 | 已确认 |
| B3 | 中止来源未知：按 HEAD 代码，SDK 运行信号只能由整轮控制器驱动（`stopSdk` / finally 的 `session.abort()`），模型请求看门狗也不触碰工具信号，因此「工具被中止」在当前代码里无法归因到任何一条已知来源。需要日志定位（见 4.4） | P0 | 中 | 中 | 待证实 |
| B4 | 客户端工具没有硬超时；叠加 B5，页面消失后整轮会**永久挂起**，session/私有目录/浏览器 owner 一起泄漏，同一会话再次发消息会 409 | P1 | 低 | 低 | 已确认 |
| B5 | Bun 的 node:http 兼容层不会上报客户端断开：`res.close` / `req.aborted` / `req.socket.close` 全都不触发，`res.destroyed` 恒为 undefined，`res.write` 一直返回成功（实测见 4.5）。`run.ts` 的三条断连监听在桌面端是死代码，`if (!res.destroyed)` 也恒真 | P1 | 中 | 中 | 已确认 |
| B6 | 前端 `executeClientTool` 回传结果时复用 run 的 signal，流转中止就丢结果；非中止类网络失败还会 `reportError` 后 abort 整轮（`singleAgentDialog.vue:169-194`） | P2 | 低 | 中 | 已确认，本轮不改 |

## 四、已确认的证据

### 4.1 「工具调用已取消」的唯一产地

`apps/server/src/modules/agentAccess/singleAgent/index.ts:86-104`：

```
execute(toolCallId, args, signal, onUpdate) {
  ...
  const abort = () => finish(new Error("工具调用已取消"));   // ← 全文唯一
  active.clientCalls.set(callId, { finish, onUpdate });
  signal?.addEventListener("abort", abort, { once: true });
  active.send({ type: "clientTool", ... });
}
```

全仓库除 i18n 词条外，只有这一处产生该字符串；`run()` 里工具被包裹成 `AbortSignal.any([args[2], active.controller.signal])`（同文件 197 行），所以中止只可能来自两条信号之一。

### 4.2 复现路径（隔离实例，不改动用户环境）

隔离启动了一份源码 server（`TOONFLOW_DATA_DIR=/tmp/ssprobe/data`、端口 3931）+ 假 OpenAI 模型，用真实 web 界面走完整个流程：

- 正常路径：`create 200 → clientTool → validate 200 (3 ms) → toolResult 200 → 模型续跑 → complete/done`，**成功**。说明客户端工具桥路本身可用，用户场景的失败不是这条链路的结构性缺陷。
- 中止路径：在客户端工具执行中途调用 `POST /api/singleAgent/control {action:"close"}` 或 `{action:"stop"}`，服务端 NDJSON 依次发出
  `tool(status=interrupted, result="工具调用已取消")` → `toolResult` → `error` → `status idle` → `done`。

**这只是"能产生相同文案"的复现路径，不能证明用户那 7 次就是这个原因**（评审指出，成立）。要把两者划等号还缺三项证据：

1. 用户看到的那行是红字（`providerAgentDialog.vue` 里 `danger` 只对应 `status === 'error'`）还是灰字（`interrupted` 走 info）——红字反而说明收尾时整轮控制器**没有**中止；
2. 「超时」的原文与秒数（`requests.ts` 的文案自带秒数，180/120/自定义值一眼可分）；
3. `settings.agent` 的读取方式（本次用 `python3 -c 'json.load(...).get("settings",{}).get("agent")'` 读到 `null`，即走默认 180 s / 120 s / 1800 s）。

### 4.3 中止来源清单（按 HEAD 代码核对）

| 来源 | 位置 | reason | 备注 |
| --- | --- | --- | --- |
| 页面连接关闭（res.close / req.aborted / socket.close） | `routes/singleAgent/run.ts:19-23` | 无（`controller.abort()` 不带参数） | **Bun 下实测完全不触发**（4.5），只在 Node/Docker 部署有意义 |
| 用户点停止 | `singleAgent/index.ts:320` | 本次回复已停止 | 可达 |
| 提问被取消 | `singleAgent/index.ts:191` | 用户取消了提问 | 可达；前端 current 代码不发 `cancelled`，需继续观察 |
| 会话被关闭（对话框关闭/卸载/重置） | `singleAgent/index.ts:361` | 临时对话已关闭 | **HEAD 下具体原因对挂起工具不可达**：`:361` 先 abort，abort 监听器已同步 finish 并删表，`:363` 的循环已无对象；本次已调整顺序修正 |
| 运行信号（SDK `agent.abort()`） | `agent-session` / `stopSdk` | 无 reason | HEAD 里只能由整轮控制器（`stopSdk`）或 finally 的 `session.abort()` 驱动，**不存在独立中止路径** |

### 4.4 为什么「超时」和「工具被中止」在代码上不能同时发生

评审核对后的结论（成立）：`agent/runtime/requests.ts` 的看门狗 controller 只用在两处——`getAuth` 的 signal 组合与本次 `fetch` 的 `attempt.signal(init?.signal)`，从不写 `options.signal`；工具拿到的是 SDK 的 `agent.activeRun.abortController.signal`，只有 `agent.abort()` 能中止它，且模型请求与工具执行在 `agent-loop.js` 里严格串行。

因此：「工具挂起 + 模型请求超时」不可能重叠发生。用户看到的「提示超时」最可能是两件事被合并记忆——整轮被 `control(close/stop)` 或提问取消中止（文案被 `run()` 的 catch 改写成「本次回复已停止」），用户记成超时。**B3 因此标记为「未知中止源」，只能靠日志定位，不做推断性修复。**

### 4.6 评审记录（子 agent 初审，2026-10-27 14:30）

评审基线 HEAD `23c190f`。结论采纳情况：

| 评审意见 | 处置 |
| --- | --- |
| 4.2 不能把「能复现」写成「结论」 | 采纳，已降级为复现路径并补三项缺失证据 |
| B3 因果链反了：看门狗不会中止工具 | 采纳，已改写为「未知中止源待日志定位」 |
| 4.3 中 close 的 reason 分支不可达 | 采纳，已标注；实现时把 finish 提到 abort 之前修正 |
| B4 应升级为「永久挂起 + session 泄漏」 | 采纳，P2→P1 |
| `index.ts:287` 的整轮文案吞因应并入 B1 | 采纳，B1 已覆盖两处吞因 |
| `control()/close()` 必须加调用方与 action 日志 | 采纳，已实现 |
| 工具结果不走 `translateError`（非中文界面仍是中文） | 记录为已知缺陷，本轮不改（见方案「非目标」） |
| 前端 toolResult POST 复用 run signal、瞬断即杀整轮 | 记录为后续项（B6，未纳入本轮） |
| 基线「自 2026-10-21 未改动」不准确（23c190f 做过目录迁移） | 采纳，改为按 23c190f 核对 |
| i18n 机制是源码抽取，不是「保留旧键防缺词」 | 采纳，风险表已改 |

### 4.5 实测：Bun 完全不上报客户端断开

用最小 Express + `app.listen`（与项目同一套 express 5.2.1）复现：客户端发 POST 后直接关掉 socket（FIN），服务端持续每秒写一次心跳：

```
tick destroyed= undefined finished= false drain= false write= true   （连续 7 秒）
```

`res.close` / `req.aborted` / `req.socket.close` / `res.error` 一个都没有触发。换成真实 run 端点（隔离实例）关掉连接后 60 秒以上，日志里也没有任何 `run.abort`，整轮继续挂着。

推论：

1. `run.ts` 的三条断连监听在 Bun 下是死代码（保留无害，但不能作为中止来源的依据）。
2. 用户看到的「被终止」**不可能**是「页面/连接断开」造成的——只可能是前端主动发了 `control(close)` 或 `control(stop)`，或者 SDK 运行信号被中止。
3. 页面异常消失时整轮会永久悬挂，必须靠客户端工具硬超时兜底（B4）。

## 五、目标与非目标

目标：

1. 任何中止都保留并回传真实原因与错误码，模型与用户都能看到（B1/B2）。
2. 服务端留下可事后追查的最小运行日志（run 生命周期、客户端工具派发/回传、中止来源），供下一次复现定性（B3）。
3. 客户端工具加硬超时，避免无限挂起（B4）。

非目标：

- 不在本次猜测性修改模型请求看门狗的超时时间。
- 不重写 `singleAgent` 的暂停/继续语义。
- 不动 `browser` / `askUser` 插件行为。

## 六、风险

- 日志文件写入磁盘：需限大小并全部 best-effort，写失败不得影响对话。
- 错误文案变化：`工具调用已取消` 会变成带原因的中文句子，i18n 词条需要保留旧键避免其他语言缺词。
- `run.ts` 若改为带 reason 的 abort，属于纯增量（不改变中止时机），风险低。

## 七、评审意见

- 子 agent 初审（2026-10-27 14:30，基线 23c190f）：结论见 4.6。**5 个问题中，Q1「唯一产地」成立（限定中文文案）；Q2「整轮控制器被中止」只对隔离复现成立、对用户事故证据不足；Q3「超时与工具中止可同时发生」不成立（看门狗不触碰工具信号）；Q4 矩阵有 7 处遗漏，已按「必须改」1-6 全部采纳；Q5 目标/非目标有缺口，已补。**
- 用户评审：（待填）

## 八、当前状态（2026-10-27 14:45 暂停，待后续捡起）

- 已完成并部署：中止原因透传（工具结果带真实原因 + `code=TOOL_ABORTED`）、`<data>/logs/agent.log` 运行日志（`run.start` / `clientTool.dispatch` / `clientTool.result` / `control` / `session.close` / `run.abort` / `run.signal.abort` / `run.failed` / `run.end` / `model.request.timeout`）、客户端工具 600 s 硬超时、`close()` 先 finish 后 abort。
- 桌面包已覆盖 `/Applications/toonflow-exec.app/Contents/Resources/app/bun/index.js`（23,545,282 B），旧包备份 `/tmp/toonflow-app-bun-index-20261027-1204.bak`。
- **根因未定**：按代码，「工具被中止」在当前 HEAD 无法归因到任何已知来源（B3），且「超时」与「工具中止」在代码上不可能同时发生。需要用户复现一次后读日志定性。
- 捡起时先看：`/Applications/data/logs/agent.log` 中对应时段的 `control` / `session.close` / `run.abort` / `run.signal.abort` 行；若用户已重启并复现，日志会直接给出中止入口。
- 用户反馈（本轮）：决定「后续遇到再反馈」，先记录现状。
