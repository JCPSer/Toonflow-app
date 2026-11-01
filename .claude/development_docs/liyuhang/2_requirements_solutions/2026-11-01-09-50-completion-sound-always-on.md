# 需求方案：节点提示音改为无条件播报

- 时间：2026-11-01 09:50
- 分支：`feat/exec-node`
- 对应需求：`1_requirements_matrix/2026-11-01-09-50-completion-sound-always-on.md`

## 1. 方案概述

把「是否出声」收敛为一个布尔判定：开关开＝响，开关关＝不响。删除与 `document.hasFocus()` 绑定的第三档，配置层仍沿用 `completionSound` 字段和 `always` / `off` 两个值，旧值 `background` 在读取时归一为 `always`，不做磁盘数据迁移。

## 2. 详细设计

### 2.1 判定层（`lib/taskAlerts.ts`）

```
shouldPlayChime():
    return completionSound !== "off"
```

- `flush()` 与 `questionChime.ts` 继续复用这一个判定，两个事件源口径一致。
- `shouldNotify()` 不动：仍是 `taskNotification && !document.hasFocus()`。
- 30 秒门槛（`MIN_DURATION_MS`）、手动停止过滤、`MERGE_WINDOW_MS` 合并全部保留。

### 2.2 配置归一（`stores/settings.ts`）

```
normalizeCompletionSound(value):
    return value === "off" ? "off" : "always"
```

- 旧值 `background`、缺键、脏值都落到 `always`（开启），符合「升级后不能静默失声」。
- 存储结构不变，仍是字符串；不写迁移脚本，避免改动服务端设置文件。

### 2.3 UI

| 位置 | 改动 |
| --- | --- |
| 设置页「节点提示音」 | 单选改为「开启 / 关闭」；描述补充「窗口在前台或后台、节点面板是否打开都会响」 |
| 画布工具条铃铛 | 循环顺序 `always → off → always`；tooltip「提示音：开启 / 提示音：关闭」；铃铛/铃铛划掉图标沿用 |

### 2.4 数据流

```
节点完成事件 ─┐
              ├─→ shouldPlayChime() ─→ playChime(kind)
Agent 提问题 ─┘        ↑
                  completionSound（开/关）
```

## 3. 兼容与边界

- 旧 `background` 用户升级后从「仅后台」变为「总是」，并在 UI 上显示为「开启」，语义平滑。
- 关闭档仍然保留，用户在需要静音时仍可完全关闭。
- 窗口在前台且 Agent 面板正开着时也响：这是用户明确要求，不再做「已在眼前就不打扰」的抑制。

## 4. 影响文件

- `apps/web/src/lib/taskAlerts.ts`
- `apps/web/src/stores/settings.ts`
- `apps/web/src/components/settings/panels/general/index.vue`
- `apps/web/src/pages/workspace/panels/canvas/components/canvasControls.vue`
- `apps/web/src/lib/questionChime.ts`（仅注释口径）

## 5. 评审意见

| 评审人 | 结论 | 意见 |
| --- | --- | --- |
| 用户（选择题确认） | 通过 | 两档、旧值迁移为开启、保留门槛与合并、系统通知不动。 |
| 子 Agent 方案/代码审查 | 通过 | 方案与实现一致；无 P1；注释口径 P2 已整改。详见 `3_test_results/2026-11-01-09-50-completion-sound-always-on.md`。 |
