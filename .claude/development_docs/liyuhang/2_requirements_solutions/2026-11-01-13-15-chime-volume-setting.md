# 需求方案：提示音音量可调

- 时间：2026-11-01 13:15
- 分支：`feat/exec-node`
- 对应需求：`1_requirements_matrix/2026-11-01-13-15-chime-volume-setting.md`

## 1. 方案概述

在 `general` 设置里新增 `completionSoundVolume`（0-100，默认 40，缺键回落默认），`chime.ts` 播放时读取该值换算成增益；0 直接返回不发声。设置页在「节点提示音」区块加滑杆，拖动只改本地值，松手才落盘。

## 2. 详细设计

### 2.1 设置项

```
defaultCompletionSoundVolume = 40
normalizeCompletionSoundVolume(value):
    数字且有限 → clamp(round(value), 0, 100)
    其他（缺键/非法） → 40
```

- 不能用 `value || 默认`：0 是合法值（静音）。
- 写进 `generalSettings`，随现有 `settings.general` 一起持久化，无需新增存储。

### 2.2 播放

```
playChime(kind):
    volume = completionSoundVolume / 100        // 非数字回落 40
    volume <= 0 → return                        // 静音，且不创建/不打断正在播的声音
    ...其余不变，gain.setValueAtTime(volume, ...)
```

- 关闭开关的判定仍在 `taskAlerts.shouldPlayChime`，音量与开关是两个正交维度。
- 桌面系统通知走 `desktop-notify` 的 silent 标志，本次不动。

### 2.3 UI

```
设置 > 通用 > 节点提示音
    [开启] [关闭]              ← 原有单选，不变
    音量 [========|----] 40%
```

- `el-slider` 0-100、步进 5，`aria-label="提示音音量"`，`format-tooltip` 显示百分比。
- 组件内用本地 ref 绑定 `v-model`，`@change` 时才 `updateGeneralSettings`——settings 有 deep watch 自动保存，绑到设置本体会让拖动期间每一步都发一次保存请求。
- 外部改动（例如以后的重置）通过 `watch(generalSettings.completionSoundVolume)` 回填本地值。
- 开关为「关闭」时滑杆 `disabled`，但音量值保留。

## 3. 边界

- 老配置没有该键：默认 40，升级后立即比旧版响。
- 值被写坏（字符串、负数、超大）：归一化到 0-100 或回落 40。
- 音量为 0：不发声，但「节点提示音」仍显示开启，恢复音量无需重新打开开关。
- 其他提示音调用点（提问由 `questionChime` → `playChime`；节点完成/失败由 `taskAlerts` → `playChime`）都经过 `chime.ts`，自动生效。

## 4. 影响文件

- `apps/web/src/stores/settings.ts`
- `apps/web/src/lib/chime.ts`
- `apps/web/src/components/settings/panels/general/index.vue`

不动：桌面主进程、系统通知、节点包。

## 5. 测试设计

1. `bun run typecheck`、`bun run --cwd apps/web build`、`scripts/deploy-local.sh`，核对 md5。
2. 静态核对：默认值/归一路径、0 值不被覆盖、保存时机、disabled 联动。
3. 人工验收（重启后）：需求矩阵第 5 节。

## 6. 评审意见

| 评审人 | 结论 | 意见 |
| --- | --- | --- |
| 用户（选择题确认） | 通过 | 见需求矩阵。 |
| 子 Agent 审查 | 待评审 | |
