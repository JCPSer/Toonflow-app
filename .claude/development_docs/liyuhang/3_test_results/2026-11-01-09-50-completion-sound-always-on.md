# 测试结果：节点提示音改为无条件播报

- 时间：2026-11-01 09:50
- 对应需求/方案：`1_requirements_matrix/2026-11-01-09-50-completion-sound-always-on.md`、`2_requirements_solutions/2026-11-01-09-50-completion-sound-always-on.md`

## 1. 类型检查

`cd apps/web && bun run typecheck`：

- 通过，仅有既有报错：`apps/server/src/modules/agentAccess/singleAgent/types.ts(2,33): TS2307 Cannot find module '@/agentRuntime'`（与本次改动无关）。

## 2. 构建与部署

- `bun run --cwd apps/web build` 成功（3.70s）。
- `scripts/deploy-local.sh`（复用产物）同步到 `/Applications/toonflow-exec.app/Contents/Resources/app/views/mainview/`。
- 产物 md5 与 Resources 一致：

| 文件 | md5 |
| --- | --- |
| `workspace-C542gZNR.js`（入口） | `e0f51d47ed1b5733ea0cae7f936c7a78` |
| `workspace-Bz82mdg_.css` | `dde8d59d0dd3861dbc42a794b8d23537` |
| `workspace-DP1k61vL.js`（主包） | `b83dde655027dfbc1bcb45c73c982ae7` |
| `general-DEvcqVLE.js`（设置面板） | `85701e1f914f8b3065b8eb6f2b7774ff` |

## 3. 静态核对

- 当前主包 `workspace-DP1k61vL.js` 中「仅后台」「档位」均出现 0 次，「提示音：开启」1 次。
- 设置面板分包 `general-DEvcqVLE.js` 中「仅后台」0 次，新描述 1 次。
- `shouldNotify()` 仍保留 `!document.hasFocus()`；只有 `shouldPlayChime()` 去掉了焦点判定。
- `questionChime.ts` 继续复用 `shouldPlayChime()`，提问音与完成音口径一致。
- 30 秒门槛 `MIN_DURATION_MS`、手动停止 `detail.cancelled`、`MERGE_WINDOW_MS` 均未改动。

## 4. 代码审查

| 轮次 | 结论 | 意见 |
| --- | --- | --- |
| 子 Agent（code-reviewer，两轮） | 通过 | 无 P1。P2：`questionChime.ts:13` 注释仍写「按三档开关判定」，已改为「按提示音开关判定（不看前后台）」；同源表述 `agentNodePanel.vue:382` 的「档位」改为「开关」；`MERGE_WINDOW_MS` 注释补充提问音共用。备注（不阻塞）：`settings.ts` / `canvasControls.vue` 中混有上一需求 `hideDisabledNodeTitles` 的未提交改动，提交时需按需求拆分；`MERGE_WINDOW_MS` 全大写为既有风格，本次不改名。 |

## 5. 重启后人工验收清单

> 应用未重启，以下需用户重启后自测。

1. 设置 → 通用 → 节点提示音：只有「开启 / 关闭」两项；描述写明无论前后台都会响。
2. 画布左下铃铛点击：开启 ↔ 关闭 两态循环，tooltip 文案对应。
3. 窗口在前台、不打开 Agent 面板：运行一个超过 30 秒的节点，完成后应响成功音。
4. 窗口在前台、Agent 面板开着：Agent 提问时应响提问音（同音双击 880）。
5. 窗口切到后台重复 3、4，声音仍应播放。
6. 关闭档下 3、4 都不响；系统通知仍只在后台出现。
7. 旧配置为「仅后台」的用户升级后，设置页显示「开启」，且前台也响。
