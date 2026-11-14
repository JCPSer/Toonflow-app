# Bug 方案：长时间运行 + 锁屏/切后台后提示音彻底不响

- 时间：2026-11-12 22:10
- 对应分析：`bug_analysis-2026-11-12-22-10-chime-dead-after-lock.md`
- 状态：待实施

## 1. 方案总览

全部改动集中在 `apps/web/src/lib/chime.ts`，对外签名（`chimeSupported` / `resumeChime` / `playChime` / `installChimeUnlock`）保持不变，调用方零改动。

四条恢复通道，任一成功即恢复：

```text
手势（常驻）        → 每次 pointerdown/keydown/touchstart，只在非 running 时尝试
唤醒（回前台/解锁） → visibilitychange(可见) / window focus / pageshow，退避重试 0/300/1500/5000ms
健康自检（60s）     → 间隔检查，非 running 时尝试（不重建，避免无手势场景反复造上下文）
播放前兜底          → playChime 内先尝试恢复，再排音
```

恢复失败时**重建上下文**：`close()` 旧实例 → `new AudioContext()`。在手势内新建的上下文最可靠；重建有 5 秒节流，避免反复造实例。

## 2. 详细设计

### 2.1 上下文生命周期

```text
ensureContext(): 无则 new + 挂 statechange 监听（记录 running→非 running 的中断次数）

rebuildContext(reason):
  距上次重建 < 5s → 返回 undefined（不重建）
  old = context；context = ensureContext() 新建；停掉旧图（stopCurrent 置空）
  old.close()（失败忽略）；记录 resurrections / lastEvent
```

### 2.2 resumeChime 改为「先恢复、后重建」

```text
resumeChime({ rebuild = true }):
  在途任务存在 → 复用同一个 Promise（防重复/防抖动）
  running → true
  tryResume(audio) → 成功即 true
  rebuild = true 且允许重建 → 新实例 → tryResume → 返回结果
```

`tryResume` = `await audio.resume()` 后**再读一次 state**（不使用 TS 收窄）。

### 2.3 手势监听常驻

- 事件：`pointerdown` / `keydown` / `touchstart`，`capture` + `passive`。
- **不再 detach**：处理函数先判 `state === "running"`，是则直接返回，开销只是一次状态读取。
- 幂等安装（`window.__toonflowChimeInstalled`），热更新重复执行不会叠加监听。

### 2.4 唤醒恢复

```text
visibilitychange → document.hidden === false 时
window focus / pageshow

→ wakeRecovery(): token 递增
   尝试序列 [0, 300, 1500, 5000]ms，每个时点 resumeChime({rebuild:false})
   成功即停止；token 变化（新一轮唤醒）则作废旧序列
```

唤醒后系统音频会话通常先于 WebView 就绪，需要退避；`rebuild:false` 是因为唤醒时没有手势，重建出来的实例也起不来，反而白丢旧实例。

### 2.5 健康自检

每 60 秒检查一次，非 running 就 `resumeChime({rebuild:false})`。WKWebView 中的 `setInterval` 在后台会被节流，属于兜底通道，不依赖它单独生效。

### 2.6 播放前兜底

```text
playChime(kind):
  非 running → suspendedChimes++
              → void resumeChime({rebuild:false})
              → 仍按原逻辑在当前上下文排音（suspended 时 currentTime 不推进，
                一旦恢复就会在恢复瞬间播出，不会「排了永远不响」）
```

不在 `playChime` 里重建：重建需要一个可能到来的手势，交给手势通道处理更安全，也避免每次播放都换实例。

### 2.7 诊断钩子

```text
window.__toonflowChime = {
  state,            // running / suspended / interrupted / unavailable
  stats,            // interruptions / resurrections / suspendedChimes / lastEvent
  resume(),         // 手动恢复（会尝试重建）
  play(kind),       // 手动播放
}
```

- 中断时 `console.warn("[chime] 音频上下文被中断:", state)`；恢复/重建打 `console.info`。
- 下次再复现，直接在控制台看 `__toonflowChime.stats`，不需要临时插桩。

## 3. 兼容与边界

- 音量 0 仍然直接 `stopCurrent()`，不恢复、不重建。
- 设置页「试听」走 `resumeChime()` 默认参数（允许重建），失败提示文案不变。
- 无 `AudioContext` 环境（`chimeSupported` 为 false）所有通道空转，不报错。
- `stopCurrent` 在重建时清空，避免对旧上下文的节点做操作。

## 4. 验证计划

1. 单元/手工：`__toonflowChime.state` 启动后应为 `running`。
2. 人为销毁上下文（`__toonflowChime.resume` 前后对比）验证重建计数递增。
3. 真实场景：部署后锁屏 1 分钟 → 解锁 → 点一下应用 → 触发一次节点完成音，听是否有声。
4. typecheck + `bun run --filter '@toonflow/web' build`，rsync 同步，未重启。

### 4.1 用户侧复现验证

1. 重启应用 → 设置 → 常规 → 点「试听」，确认有声。
2. 打开 设置 → 开发者 → 打开 DevTools，控制台执行 `__toonflowChime.state`，应为 `running`。
3. 锁屏 1~2 分钟 → 解锁 → 回到应用点一下窗口 → 再跑一次「试听」。
4. 若仍无声：看 `__toonflowChime.stats`，`interruptions` 增长说明系统确实中断过；`resurrections` 增长说明走了重建路径；`suspendedChimes` 增长说明播放时上下文没起来。把这三个数报回来即可定位。

## 5. 评审意见

（待用户填写）

- 是否通过：
- 其他要求：

## 6. 子 agent 评审结论与修订（2026-11-12 22:26）

评审确认常驻监听修掉了原 P0，但指出新引入的 `resumeTask` 去重可能把全部恢复通道锁死。已全部修订：

| 级别 | 问题 | 修订 |
| --- | --- | --- |
| P0 | `resume()` 可能永不 settle，`resumeTask` 被无限复用 → 手势/唤醒/自检/重建全部卡死，等于原 bug 换层皮 | `tryResume` 加 1.5s `Promise.race` 超时；超时按失败处理，继续走重建 |
| P1 | 去重未区分 `rebuild`：`playChime` 发起的「不重建」任务会吞掉紧接的手势重建 | 在途任务带 `rebuild` 标记；「不重建→允许重建」时等它落地后补一次 `startResume(true)` |
| P1 | 上下文 `closed` 时 `createOscillator` 抛错，会连带吞掉 `taskAlerts` 后续的桌面通知、设置页试听的失败提示 | `ensureContext` 遇 closed 直接新建（不走冷却）；`renderChime` 整段 try/catch，失败只记状态不抛 |
| P1 | 四条通道都 gate 在 `state !== running`，若 WebKit 报 running 但实际静默则全部空转 | 新增 `isFrozen`：墙钟走过 5s 而 `currentTime` 未推进即视为冻结，跳过 resume 直接重建；`stats.lastPlay` 记录音频时钟与墙钟便于取证 |
| P2 | `old.close()` 的 Promise 拒绝未处理 | 改 `void old.close().catch(...)` |
| P2 | 重建时先丢 `stopCurrent` 再 close，close 失败会留下停不掉的声音 | 先 `stopCurrent?.()` 再换实例 |
| P2 | 在途 rebuild 会关掉 `playChime` 刚排音的那个上下文 | 在途恢复未完成且当前不可用时，把排音挂到任务落地后再做（最多晚 1.5s） |
| P2 | 旧实例的 `statechange` 覆盖 `lastEvent`，干扰排障 | 只有当前实例才写 `lastEvent` |
| P2 | 固定 5s 冷却在持续失败下最多 ~12 个实例/分钟 | 连续失败指数退避 5s→30s→…上限 5min，任一恢复即清零 |
| P2 | HMR 下 window 幂等键与模块级状态分裂 | 生产单入口不受影响，本次不处理；若 dev 期复现异常需整页刷新 |
| P2 | `main.ts` 注释仍写「成功后才解绑」 | 已同步改成「监听常驻不摘除」 |
