# 提示音音量可调

- 时间：2026-11-01 13:15
- 涉及文件：`apps/web/src/stores/settings.ts`、`apps/web/src/lib/chime.ts`、`apps/web/src/components/settings/panels/general/index.vue`

## STAR

**Situation**
节点完成/失败与 Agent 提问的提示音增益写死 `VOLUME = 0.18`，用户觉得偏小，且没有任何调节入口。

**Task**
提高默认音量并提供设置滑杆；0 = 静音但不改开关；只影响应用内提示音。

**Action**
1. `general` 设置新增 `completionSoundVolume`（0-100，默认 40），归一化时 0 合法、缺键回落 40。
2. `chime.ts` 播放时读百分比换算增益；为 0 时先停掉正在响的一声再返回。
3. 设置页「节点提示音」区块加滑杆，本地 ref + `@change` 落盘（避免 settings deep watch 拖动期间反复保存），开关关闭时置灰。

**Result**
- web `vue-tsc` 通过（仅既有 `@/agentRuntime` 报错）。
- 工作区分块 `workspace-z4X24RxG.js` md5 `6fadc93a4a73d96e5fe0140001570228`，构建与安装一致；未重启。
- 子 Agent 审查：无 P1，整改 P2 属性命名与 4 条 P3。

## 教训

- 音量这类感知量不要做平方/对数映射：0.4 线性增益已经比原来的 0.18 响，平方反而更小。
- 「开关」和「音量 0」是两个正交维度：合并会逼用户重新打开开关，0 必须作为独立合法值保存。
- 绑定设置对象的滑杆必须在松手时才提交，否则 deep watch 会把拖动过程变成连续保存请求。

## 关联

- 需求/方案/测试：`1_requirements_matrix/2026-11-01-13-15-chime-volume-setting.md`、`2_requirements_solutions/2026-11-01-13-15-chime-volume-setting.md`、`3_test_results/2026-11-01-13-15-chime-volume-setting.md`。
- 前置：`5_memory/2026-11-01-09-50-completion-sound-always-on.md`（提示音改为开/关两档）。
