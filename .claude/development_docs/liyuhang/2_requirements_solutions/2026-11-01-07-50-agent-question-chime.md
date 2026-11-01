# 需求方案：Agent 提问提示音

- 时间：2026-11-01 07:50
- 对应需求：`1_requirements_matrix/2026-11-01-07-50-agent-question-chime.md`
- 代码基线：`feat/exec-node`

## 1. 方案总览

不新增事件通道，也不改未读逻辑。只在「提问已经成为未读提醒」的唯一入口处补一声提示音：

```
askUser → 服务端 question 事件
  → conversation.vue emit("question")
  → agentNodePanel.onQuestion(nodeId, payload)
       ├─ playQuestionChime()          ← 新增
       └─ entry.question = 已读 ? undefined : payload   ← 原有横幅逻辑不动
```

提示音策略与音频合成分层，避免把设置判断塞进音频模块：

| 模块 | 职责 |
| --- | --- |
| `lib/chime.ts` | 只知道音高与波形；新增 `question` 音型 `[880, 880]` |
| `lib/taskAlerts.ts` | 已有 `shouldPlayChime()`（读三档开关 + `document.hasFocus()`），改为导出供复用 |
| `lib/questionChime.ts`（新增） | 问「该不该响」+「1 秒内是否已响过」，再调 `playChime("question")` |
| `agentNodePanel.vue` | 提问到达时调用一次 |

## 2. 详细设计

### 2.1 触发点

只在 `agentNodePanel.onQuestion` 播放。它是画布提问的唯一入口：

- 子 Agent 的 question 会在 `conversation.vue` 的 `subAgentEvent` 解包后同样 emit `question`，走同一入口，不需要额外处理。
- 主 Agent 面板（`components/agent/index.vue`）不经过 `agentNodePanel`，天然不响，符合范围约定。
- 面板没打开过的节点不会产生会话实例，也不会收到 question；不存在「漏掉一个本该响的入口」。

调用顺序放在 `entry` 存在判断之后、写未读状态之前：

```
function onQuestion(nodeId, payload) {
  entry = entries[nodeId]; if (!entry) return
  playQuestionChime()                       // 与是否已读解耦
  entry.question = visible && panelActive ? undefined : payload
}
```

「已读」仍按原规则（面板开着且画布在前台），但声音不受它影响——用户确认「只要有新提问就响」，是否需要出声只由三档开关决定。

### 2.2 该不该响

复用 `taskAlerts.shouldPlayChime()`：

| 档位 | 行为 |
| --- | --- |
| 总是 | 总是响 |
| 仅后台 | `!document.hasFocus()` 时才响 |
| 关闭 | 不响 |

这样「节点提示音」关掉后提问一起静音，不会出现两个开关口径不一致；`taskAlerts` 与提问音共用同一段判定，后续改默认值只需要改一处。

### 2.3 1 秒合并

`questionChime.ts` 模块级记录 `lastPlayedAt`，窗口内只保留第一声（前沿触发）：

```
playQuestionChime():
  if (!shouldPlayChime()) return
  now = performance.now()
  if (now - lastPlayedAt < 1000) return
  lastPlayedAt = now
  playChime("question")
```

- 前沿触发保证第一声立即响，不引入 1 秒延迟。
- 模块级状态覆盖同页所有画布实例（后台画布不卸载），多画布同时提问也只响一次。
- 窗口常量直接复用 `taskAlerts` 的 `MERGE_WINDOW_MS`，与节点完成提醒同源，不再各写一份。

### 2.4 音型

`chime.ts` 把 `success ? [660,880] : [880,660]` 改成 `NOTES` 映射：

| 场景 | 音高 | 听感 |
| --- | --- | --- |
| 完成 | 660 → 880 | 上行，收尾感 |
| 失败 | 880 → 660 | 下行，警示感 |
| 提问 | 880 → 880 | 同音双击，「叮叮」催促感 |

音量、包络、合并停止旧音的机制全部沿用现有 `playChime`，不引入音频文件。

### 2.5 文案

设置页「节点提示音」说明改为：

> 节点任务运行超过 30 秒后完成或失败，或画布 Agent 提问时播放提示音。手动停止不响。

画布铃铛（`canvasControls.vue`）只是同一个开关的三档切换，tooltip「提示音：总是/仅后台/关闭」仍然准确，不改。

## 3. 边界与取舍

- **面板开着时也响**：按用户选择执行；不喜欢可切到「仅后台」或「关闭」。
- **后台画布**：`panelActive` 为 false，未读状态照常写入；「总是」档下提问照常响，「仅后台」档仍按窗口焦点判定（窗口有焦点时不响）。切回画布能看到横幅。
- **音频上下文未解锁**：沿用 `main.ts` 的首次 `pointerdown` 解锁；用户能发起 Agent 对话就一定产生过手势。
- **与完成音重叠**：`playChime` 会停掉上一组振荡器，后到的提醒优先，不会叠成和弦。
- **主 Agent 面板不响**：范围外，保持现状；如果以后需要，同一 `playQuestionChime` 可直接复用。

## 4. 代码改动清单

| 文件 | 改动 |
| --- | --- |
| `apps/web/src/lib/chime.ts` | `ChimeKind` 增加 `question`；音高改 `NOTES` 映射 |
| `apps/web/src/lib/taskAlerts.ts` | `shouldPlayChime` 导出 |
| `apps/web/src/lib/questionChime.ts` | 新增：复用判定 + 1 秒前沿合并 |
| `apps/web/src/pages/workspace/panels/canvas/components/agentNodePanel.vue` | `onQuestion` 调用 `playQuestionChime` |
| `apps/web/src/components/settings/panels/general/index.vue` | 设置说明补「或画布 Agent 提问时」 |

不改：`conversation.vue` 事件流、服务端 `askUser`、未读横幅规则、桌面通知通道。

## 5. 验证方案

按 `AGENTS.md` 测试边界，不新增测试文件：

| 层级 | 内容 |
| --- | --- |
| 类型检查 | `apps/web` 的 `vue-tsc`（与基线对比，只允许既有 `@/agentRuntime` 报错） |
| 构建 | `apps/web` 的 `vite build`，产物含 `880,880` 音型 |
| 静态核对 | 触发入口唯一、`shouldPlayChime` 复用、合并窗口、无测试文件新增 |
| 真机 | 重启应用后：画布 Agent 提问 → 听见双击；三档开关各验一次；1 秒内两问只响一声；设置文案可见 |

## 6. 评审意见

| 评审人 | 结论 | 意见 |
| --- | --- | --- |
| 用户（Grill 问答） | 通过 | 见需求矩阵第 6 节，六项口径已锁定。 |
| 子 Agent 代码审查 | 已整改 | 链路核对全部通过；P1：新增常量用全大写违反 AGENTS.md §5（`NOTES`→`chimePitches`）；P2：合并窗口与 taskAlerts 各写一份、`lastPlayedAt=0` 可能吞掉加载后首秒、`playQuestionChime` 应在 entry 守卫前、文档「后台画布」措辞过宽。均已按建议修改。详见测试结果第 5 节。 |
