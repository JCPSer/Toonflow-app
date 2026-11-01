# Agent 提问提示音

- 时间：2026-11-01 08:10
- 涉及文件：`apps/web/src/lib/chime.ts`、`apps/web/src/lib/questionChime.ts`（新增）、`apps/web/src/lib/taskAlerts.ts`、`apps/web/src/pages/workspace/panels/canvas/components/agentNodePanel.vue`、`apps/web/src/components/settings/panels/general/index.vue`

## STAR

**Situation**
画布 Agent 节点调用 `askUser` 时只有顶部未读横幅，没有声音；节点完成/失败已有「节点提示音」，提问不在提醒链路上。全仓库没有面向提问的系统通知，用户说的「通知」就是这条横幅。

**Task**
在画布 Agent 节点提问时补一声与完成/失败可区分的提示音，复用现有三档开关，不新增配置入口，多提问合并。

**Action**
1. `chime.ts`：`ChimeKind` 增加 `question`，音高从三元表达式改为 `chimePitches` 映射，提问用 `[880, 880]` 同音双击。
2. `taskAlerts.ts`：导出已有 `shouldPlayChime`（三档 + `document.hasFocus`）与 `MERGE_WINDOW_MS`，供提问复用，避免两套后台口径。
3. 新增 `questionChime.ts`：前端 1 秒前沿合并（模块级 `lastPlayedAt = -Infinity`），通过后调 `playChime("question")`。
4. `agentNodePanel.onQuestion`：先播放再写未读状态，声音与「已读」解耦；面板开着也响（用户确认）。
5. 设置页说明补「或画布 Agent 提问时」。

**Result**
- `apps/web` typecheck 仅剩既有 `@/agentRuntime` 报错；`vite build` 通过，产物含 `880,880`。
- `scripts/deploy-local.sh` 已同步到应用 Resources，md5 `047a6ce8…` 一致；未重启应用。
- 子 Agent 审查：1 条 P1（新增常量全大写违反 AGENTS.md §5）、3 条 P2，均已整改。
- 真机听感与三档开关行为待用户重启后验证。

## 教训

- 提问的「通知」其实只是画布未读横幅，没有系统通知；先核实代码再按用户口径补声音，不要假设系统通知已存在。
- 音频合成与「该不该响」要分层：合成层只管音型，策略层（`shouldPlayChime`）复用同一份，后台判定不会漂移。
- 合并窗口这类「看起来一样」的常量要 import 同一份，注释写「保持一致」挡不住后续分叉。
- `performance.now()` 从 0 起算，节流初值不能用 0；用 `-Infinity` 才不会吞掉文档加载后的第一声。
- AGENTS.md §5 明确禁止新增全大写常量；`chime.ts` 里的旧常量只能当既有例外，不能模仿。

## 关联

- 需求/方案/测试：`1_requirements_matrix/2026-11-01-07-50-agent-question-chime.md`、`2_requirements_solutions/2026-11-01-07-50-agent-question-chime.md`、`3_test_results/2026-11-01-08-10-agent-question-chime.md`。
- 前置能力：`5_memory/2026-10-29-16-32-canvas-notify-group-batch-assets.md`（节点提醒音/通知/横幅）、`5_memory/2026-10-29-13-30-agent-toolbar-voice-question-banner.md`（提问横幅）。
