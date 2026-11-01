# 测试结果：Agent 提问提示音

- 时间：2026-11-01 08:25
- 分支：`feat/exec-node`
- 变更：`chime.ts`（新增 `question` 音型）、`questionChime.ts`（新增）、`taskAlerts.ts`（导出判定与合并常量）、`agentNodePanel.vue`（提问时播放）、设置页说明文案

## 1. 测试边界

按 `AGENTS.md`「测试与检查边界」：不新增 `.test.ts` / `.spec.ts` / 检查脚本。本次为前端音频触发的小改动，验证采用类型检查、构建、静态链路核对与真机手测。

## 2. 类型检查

```
cd apps/web && bun run typecheck
```

结果：仅既有错误 1 条，与本次改动无关：

```
../server/src/modules/agentAccess/singleAgent/types.ts(2,33): error TS2307: Cannot find module '@/agentRuntime' or its corresponding type declarations.
```

5 个改动文件无类型错误。

## 3. 构建与部署

| 项 | 结果 |
| --- | --- |
| `bun run build`（apps/web） | 通过，3.37s |
| 产物含提问音型 | `build/web/assets/index-CCPQMQup.js` 命中 `880,880` |
| 部署后一致性 | 构建产物 md5 `047a6ce86e42a8c79149b819c9dcd82c` = `/Applications/toonflow-exec.app/Contents/Resources/app/views/mainview/assets/index-CCPQMQup.js`；命中 1 处 |
| 部署方式 | `scripts/deploy-local.sh`（复用产物，只同步 web/nodes/tools/ext） |
| 应用重启 | **未重启**（按用户要求），需用户自行重启后生效 |

## 4. 静态核对

| 检查 | 依据 |
| --- | --- |
| 触发点唯一 | 全仓只有 `agentNodePanel.vue:62` 绑定 `@question`；主 Agent 面板 `components/agent/index.vue` 只绑 `@event`，不进入该入口 |
| 子 Agent 不漏响 | `conversation.vue:831-839` 把 `subAgentEvent` 解包后 emit 同一个 `question`，服务端 `bridge/question.ts` 每个 callId 只发一次 |
| 多画布合并 | `questionChime.ts` 的 `lastPlayedAt` 是模块级单例，后台画布不卸载，同时提问只响一声 |
| 三档开关复用 | `taskAlerts.shouldPlayChime()`：`off` 不响、`always` 恒响、`background` 看 `document.hasFocus()` |
| 无循环依赖 | `questionChime → taskAlerts → chime`；`taskAlerts` 不反向引用画布/提示音模块 |
| 音频解锁未破坏 | `main.ts:35` 首次 `pointerdown` 调 `unlockChime()`；`playChime` 播放前再 `resume()` |
| 既有音型不变 | `success [660,880]`、`failure [880,660]` 与旧三元表达式逐值一致 |
| 未新增测试文件 | `git status` 中无 `.test.ts` / `.spec.ts` / `check*.ts` |

## 5. 代码审查（子 Agent）

结论：**需修订 → 整改后复核通过**。链路核对全部通过。

| 级别 | 问题 | 处置 |
| --- | --- | --- |
| P1 | 新增常量 `NOTES`、`MERGE_WINDOW_MS` 使用全大写，违反 `AGENTS.md §5` | `NOTES` 改 `chimePitches`；合并窗口改为直接 import `taskAlerts` 的既有 `MERGE_WINDOW_MS`，删除本地副本 |
| P2 | `lastPlayedAt = 0` 在页面加载后首秒内可能吞掉第一声 | 改为 `Number.NEGATIVE_INFINITY` |
| P2 | `playQuestionChime()` 在 `entry` 守卫之后，与「声音和已读解耦」的意图不完全一致 | 提到守卫之前 |
| P2 | 方案 §3「后台画布声音照常响」措辞过宽（「仅后台」档仍看窗口焦点） | 已改为分档描述 |
| P2 | 被引用的测试结果文档不存在 | 即本文件 |

审查确认无 P0；触发点唯一、无重复/漏响、依赖无环、未新增测试文件。

第二轮复核：4 个源码文件与 2 份文档逐条核对，P1/P2 全部标记「已解决」；复核方独立重跑 `vue-tsc` 与产物 md5，结论 **通过**。仅留一条注释位置建议（已顺手调整），不阻断。

## 6. 待人工验证

需用户重启应用后执行：

1. 画布 Agent 节点调用提问器 → 听到 880Hz「叮叮」，与完成上行音、失败下行音可区分。
2. 设置「节点提示音」分别切到 总是 / 仅后台 / 关闭：总是立即响；仅后台在窗口失焦后响、前台不响；关闭不响。
3. 两个节点在 1 秒内先后提问 → 只响一声，顶部横幅仍显示两条。
4. 设置页说明显示「或画布 Agent 提问时」。
5. 主 Agent 面板（右侧对话）里提问不响，保持范围外现状。
