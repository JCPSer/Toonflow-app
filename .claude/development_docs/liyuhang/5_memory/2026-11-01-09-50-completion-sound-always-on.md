# 节点提示音改为无条件播报

- 时间：2026-11-01 09:50
- 涉及文件：`apps/web/src/lib/taskAlerts.ts`、`apps/web/src/stores/settings.ts`、`apps/web/src/components/settings/panels/general/index.vue`、`apps/web/src/pages/workspace/panels/canvas/components/canvasControls.vue`、`apps/web/src/lib/questionChime.ts`

## STAR

**Situation**
「节点提示音」原有三档：总是 / 仅后台 / 关闭。仅后台档按 `document.hasFocus()` 判定，窗口在前台时不响；Agent 提问音复用同一判定。用户希望「全都播报」，不管窗口是否在前台、有没有打开该节点面板。

**Task**
1. 节点完成/失败与画布 Agent 提问提示音，在开关开启时一律播放，去掉焦点判定。
2. 废弃「仅后台」，设置页与画布工具条改为「开启 / 关闭」两档；旧配置 `background` 迁移为开启。
3. 保留 30 秒任务门槛、手动停止不响、1 秒合并；系统通知仍只在后台发。

**Action**
1. `shouldPlayChime()` 收敛为 `completionSound !== "off"`，`questionChime.ts` 继续复用，避免两套口径。
2. `normalizeCompletionSound()` 只返回 `"always" | "off"`；`background`、缺键、脏值统一归一为 `always`，只在读取层迁移，不改磁盘结构。
3. 设置页单选改为「开启 / 关闭」，描述补明「窗口在前台或后台、节点面板是否打开都会响」。
4. 画布工具条铃铛循环改为 `["always", "off"]`，tooltip 改为「提示音：开启 / 关闭」。
5. `shouldNotify()` 保持 `taskNotification && !document.hasFocus()`，系统通知语义不变。

**Result**
- web `vue-tsc` 通过（仅既有 `@/agentRuntime` 报错）；`vite build` 成功。
- 已同步到 `/Applications/toonflow-exec.app/.../views/mainview/`，入口与主包 md5 两边一致；未重启应用。
- 静态核对：当前主包与设置分包中「仅后台」均为 0 次，新文案存在。

## 教训

- 不要把「开关」与「前后台」两种语义塞进同一个三值枚举：用户一旦要求全量播报，第三档就变成无法解释的死值。
- 旧枚举值的迁移放在计算属性/归一函数里即可，不必写盘迁移；但要把所有读取点都过归一函数，否则工具条和设置页会出现两种状态。
- 提示音与系统通知是两个用户预期：声音可以无条件，系统通知仍应避免前台重复打扰。
- 保留防噪门槛（30 秒、手动停止、1 秒合并）比「字面上的全播」更重要，否则密集短任务会把提示音变成噪音。
- 档位改名后要顺手全局搜「三档 / 仅后台」这类描述性注释，类型检查发现不了口径不一致。

## 关联

- 需求/方案/测试：`1_requirements_matrix/2026-11-01-09-50-completion-sound-always-on.md`、`2_requirements_solutions/2026-11-01-09-50-completion-sound-always-on.md`、`3_test_results/2026-11-01-09-50-completion-sound-always-on.md`。
- 前置：`5_memory/2026-11-01-08-10-agent-question-chime.md`（Agent 提问音）。
