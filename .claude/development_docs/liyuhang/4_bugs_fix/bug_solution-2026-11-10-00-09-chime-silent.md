# Bug 方案：提示音不响

- 时间：2026-11-10 00:09
- 对应分析：`bug_analysis-2026-11-10-00-09-chime-silent.md`
- 状态：已实施（待用户重启后按试听自证）

## 1. 方案

### 1.1 解锁改为「每次手势都试，成功才解绑」

`apps/web/src/lib/chime.ts`

```text
installChimeUnlock():
  events = pointerdown / keydown / touchstart（capture + passive）
  attempt():
    resumeChime().then(ok => ok && detach())
  若上下文已 running → 立即 detach

resumeChime(): Promise<boolean>
  取（或创建）AudioContext
  已 running → true
  await resume()
  → 返回 state === "running"（用函数读取，避免 TS 收窄）
```

`apps/web/src/main.ts`：删除 `window.addEventListener("pointerdown", unlockChime, { once: true })`，改调 `installChimeUnlock()`。

### 1.2 设置页加「试听」

`apps/web/src/components/settings/panels/general/index.vue`

- 音量行末尾加 `试听` 按钮，`completionSound === "off"` 时禁用。
- 点击流程：

```text
resumeChime()
  → 成功：playChime("success")
  → 失败：仍然尝试播放，并用 ElMessage 提示「音频上下文没有启动，请再点一次试听」
          （不支持 AudioContext 时提示「当前环境不支持提示音」）
```

按钮点击本身是用户手势，因此它能独立于节点事件验证音频链路。

### 1.3 不动的部分

- 30 秒门槛、1 秒合并、开关口径、事件名与派发时机一律不改。
- 手工安装的 5 个节点缺完成事件属于节点包自身问题，不在本次范围；如需支持要让它们的构建接入 `nodeScaffold/nodeBusy`。

## 2. 验证

- `apps/web` 类型检查：仅剩既有 `@/agentRuntime` 报错。
- `bun run --filter '@toonflow/web' build` 成功，已 rsync 到应用 `views/mainview/`（00:09）。
- 人工：重启 → 设置 → 节点提示音 → 点「试听」。

判定表：

| 试听 | 节点完成 | 结论 |
| --- | --- | --- |
| 有声音 | 不响 | 事件/门槛问题（检查是否内置节点、是否 ≥30 秒、是否手动停止） |
| 没声音 | 不响 | 音频链路问题（试听时的提示语会给出上下文状态；再查系统输出设备） |
| 有声音 | 有声音 | 已恢复（原因为一次性解锁失效） |

## 3. 评审意见

（待用户填写）

- 是否通过：
- 其他要求：
