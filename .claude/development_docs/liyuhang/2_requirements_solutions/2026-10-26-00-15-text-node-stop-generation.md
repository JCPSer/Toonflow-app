# 方案：文本节点生成中可打断

需求矩阵：`../1_requirements_matrix/2026-10-25-23-36-text-node-stop-generation.md`（R1–R14）
版本：v1（00:15）→ **v2（00:45，按二轮评审重写 2.3 / 2.4 / 四 / 五）**

## 一、总体结构

```
按钮点击（生成中）→ 本地 controller.abort()  ← 立刻停渲染
                  → 另发 POST /api/ai/generate/stop（fire-and-forget）
                          ↓
              服务端按 runId 找到 controller → abort
                          ↓
              pi-ai 的 fetch signal 被取消 → 上游 HTTP 断开
```

两条通道并行，**不互相依赖**：即使 stop 请求丢了，本地也立即停；即使 socket 关闭事件在 Bun 上没送达，stop 请求也能让服务端中止。

## 二、M1 前端节点交互（`packages/nodes/textNode/src/index.vue`）

### 2.1 状态

- `generating`：生成中
- `stopping`：已请求停止、等待保存收尾（防止连点触发第二次生成）
- `generationController: AbortController | undefined`
- `activeRunId: string | undefined`
- `stopRequested`：布尔，用于抑制错误提示

### 2.2 按钮（不用 `:loading`）

```
icon  = generating ? IconPlayerStop : IconArrowUp
title = generating ? "停止生成" : "生成"
aria-label 同步切换
disabled = generating ? false : (!prompt.trim() || !selectedModel || !textReady)
@click   = generating ? stopGeneration() : generateText()
```

理由：Element Plus 的 `loading` 会给按钮加原生 disabled，停止按钮会点不动。

### 2.3 底栏可见性（R7，v2 修正）

底栏实际由 `bottomVisible && slotsVisible` 共同决定，而 `slotsVisible` 在**框选/多选/拖动**时会被 `slotsHiddenByInteraction` 关掉 —— 只改 `bottomVisible` 不够。

改法（脚手架加一个钉住开关，改动最小且不影响其它节点）：

```
nodeSkeleton 新增 prop bottomPinned?: boolean（默认 false）
  底栏条件：bottomPinned || (bottomVisible && slotsVisible)
textNode：:bottomVisible="node.selected || generating"（单向绑定即可）
          :bottomPinned="generating"
```

`nodeSkeleton` 从不回写 `bottomVisible`，所以改成单向绑定不会打架。

### 2.4 Esc（v2 修正条件）

两级监听，覆盖 R4 的「节点激活即可停」：

1. `promptCard` 上 `@keydown.esc`：焦点在输入区时的主路径。

```
if (!generating || event.defaultPrevented) return
→ preventDefault + stopPropagation + stopGeneration()
```

2. window 上的 keydown（bubble 阶段兜底）：生成中、该节点是唯一选中项、`!defaultPrevented` 时停止。已有 Esc 处理（markdown 浮层、输入候选、菜单编辑）都在 capture 阶段 `stopPropagation` 或 `defaultPrevented`，事件到不了这里；多选时**不**响应，避免一次停掉多个节点。

监听器挂在 promptCard 上时不需要再判断 target/弹窗，因为弹窗与下拉都 teleport 到 body，冒泡不会经过这里。

### 2.5 生成与停止

```
generateText():
  if (generating || stopping) return
  controller = new AbortController()
  activeRunId = crypto.randomUUID()
  stopRequested = false; generating = true
  try:
    result = await ai.generate({ ...input, directory, runId: activeRunId, signal: controller.signal, onEvent })
    if (!controller.signal.aborted) outputs.text = result.text      // 中止时不覆盖部分文本
  catch e:
    if (!stopRequested && !controller.signal.aborted) showError(e)  // 用户主动停止不报错
  finally:
    // 节点卸载/切画布导致的隐式 abort 也要通知服务端（keepalive 能发出去）
    if (controller.signal.aborted && !stopRequested && activeRunId) void notifyGenerateStop(activeRunId)
    await saveText(outputs.text)     // 保存的是停止瞬间累计的文本
    generating = false; stopping = false; activeRunId = undefined

stopGeneration():
  if (!generating || stopping) return
  stopping = true; stopRequested = true
  controller?.abort()                       // 先本地停
  if (activeRunId) void notifyGenerateStop(activeRunId)   // 再通知服务端，失败静默
```

顺序固定：**先 abort 再发 stop**，保证 UI 立即响应；`generating` 在保存完成后才置 false，连点只会 abort 一次（R8）。

## 三、M2 生成通道（`packages/nodeScaffold/src/nodeAi.ts`）

- `NodeAiRequest` 增加 `runId?: string`，请求体带上；
- 新增 `notifyGenerateStop(runId)`：`POST /api/ai/generate/stop`，带 `Content-Type: application/json`、`x-toonflow-workspace: 1`、`AbortSignal.timeout(5000)`、`keepalive: true`，失败静默；
- 处理服务端的新事件 `{ type: "stopped" }`：转成 AbortError 语义（调用方按取消处理，不弹错）。

## 四、M3 服务端 run 注册表（新 `apps/server/src/utils/ai/runs.ts`）

```
runs: Map<runId, Set<AbortController>>   // 同一 runId 顺序多次 HTTP（带 tools 时），同一时刻仍只有一个
tombstones: Map<runId, expiry>           // stop 早于注册，60s

register(runId, controller):
  若命中未过期墓碑 → 立刻 controller.abort()，删墓碑
  runs[runId].add(controller)

detach(runId, controller): 移除；空则 delete          // 外层 finally 保证正常回收

stop(runId):
  命中 → abort 全部 controller，返回 { stopped: true }
  未命中 → 记墓碑（60s），返回 { stopped: false }      // 不 404/409

墓碑清理：查找时判过期 + 120s 扫描一次；墓碑容量上限 1000（满则丢弃新墓碑）
```

**不对活跃 run 设 TTL**（长文生成可能超过 10 分钟，TTL 会误删导致停不掉）；进程退出时 Map 自然消失。
不持有 `res`/`req` 引用。

## 五、M4 server 生成接口（`apps/server/src/routes/ai/generate.ts`，v2 修正）

1. `inputSchema` 增加 `runId: z.uuid().optional()`（**必须**，否则 Zod 会静默 strip，runId 永远 undefined）；从 `inputSchema.parse()` 的返回值取，不读 `req.body`。
2. `try` 提前到 `getConfiguredModel()` 之前：register 放在 try 内第一条（同步），第一个 await 之前完成。
3. 外层新增 `catch`：

```
catch (error) {
  if (!controller.signal.aborted) throw error
  // 用户停止：未发头则干净结束（200 空响应），已发头直接结束，不再发 error 事件
  res.end()
}
finally { detach(runId, controller); 清 interval }
```

4. **不发 `{type:"stopped"}`**（v2 决定）：前端已经 abort 本地连接，收不到这个事件；发了也是死代码。服务端只负责尽快结束响应。
5. 日志（R3 观测点）：`stop 命中`、`run abort`、`socket close` 三类各一条，带 runId。
6. heartbeat `.unref()`；现有三重 close 监听保留（幂等）。

## 六、M5 stop 路由

```
apps/server/src/routes/ai/generate/stop.ts
POST /api/ai/generate/stop   z.strictObject({ runId: z.uuid() })
  → u.mcpControl.assertAppRequest(req)      // 同源 + x-toonflow-workspace
  → u.aiRuns.stop(runId)                    // 注册表必须在 utils.ts 暴露成 u.aiRuns
  → success({ stopped: boolean })           // 幂等；stopped:false 也要打一条日志
```

`utils.ts` 增加 `import * as aiRuns from "@/utils/ai/runs"` 并加入默认导出（仓库规范：工具实现放 utils/*，经 utils.ts 暴露）。

改完在 `apps/server` 执行 `bun run routes` 重新生成 `router.ts` 并提交。路由不冲突：`/api/ai/generate` 的 `post("/")` 不匹配 `/stop`，会 next 到紧随其后的 stop 挂载点。

## 七、UI 设计

- 生成中：发送按钮图标由 ↑ 变为 ■（沿用 Element Plus 圆形按钮，与图片/视频节点一致），tooltip 显示「停止生成」；
- 点击后按钮保持停止态直到保存完成（通常 <1s），随后恢复 ↑ 并可立即再次生成；
- 不出现红色错误提示；保存失败时仍按现有逻辑提示一次。

## 八、测试计划

| # | 场景 | 期望 |
| --- | --- | --- |
| 1 | 生成中点击停止 | 200ms 内停止追加；按钮恢复；无 toast |
| 2 | 停止后内容 | 节点正文 = 停止瞬间文本；刷新后一致（等保存完成） |
| 3 | 首个 token 前停止 | 保留生成前旧正文；无报错 |
| 4 | 连点停止 | 只一次 abort，无第二个生成请求 |
| 5 | 停止后立即重新生成 | 新 runId；旧 stop 迟到不影响新生成 |
| 6 | 生成中 Esc（焦点在输入框） | 停止 |
| 7 | 生成中点击画布空白取消选中 | 底栏仍显示停止按钮，可停止 |
| 8 | 生成中多选/拖拽节点 | 同上 |
| 9 | 服务端观测 | stop 后 1s 内 run abort，日志可见，SSE 不再有新 text |
| 10 | mock provider 观测 | 停止后连接关闭且无新 chunk |
| 11 | 两个文本节点同时生成 | 停 A 不影响 B |
| 12 | 无 `x-toonflow-workspace` 调 stop | 403 |
| 13 | 已结束后再调 stop | 成功且无副作用 |
| 14 | 保存冲突（409） | 内存文本保留、有错误提示 |

## 九、评审记录

### 9.1 二轮评审（子 agent，00:40）：需修改后通过

| 级别 | 问题 | 处理 |
| --- | --- | --- |
| 阻断 | 底栏还受 `slotsVisible` / `slotsHiddenByInteraction` 控制，多选与拖拽时整个底栏被卸载，只改 bottomVisible 无效 | 采纳：nodeSkeleton 增加 `bottomPinned` prop |
| 阻断 | Esc 条件写反（`!event.defaultPrevented` 直接 return），主路径永不触发 | 采纳：改为 `event.defaultPrevented` 才 return；两级监听 |
| 阻断 | `u.aiRuns` 未在 utils.ts 暴露，stop 会 TypeError → 前端静默失败 | 采纳：utils.ts 导出 + u.aiRuns |
| 重要 | runId 漏加 schema 是静默 strip，不会 400 | 采纳：inputSchema 增加，nodeAi 两处同步 |
| 重要 | 活跃 run 设 TTL 会误删长任务，反而停不掉 | 采纳：只清墓碑，活跃 run 不淘汰 |
| 重要 | abort 发生在 SSE 头之前会冒泡成 500 | 采纳：外层 catch + `res.end()` |
| 重要 | 服务端实际发的是 `error` 不是 `stopped`，且先 abort 后该事件不可达 | 采纳：删掉 stopped，只结束响应 |
| 重要 | 删除节点/切画布的隐式 abort 不通知服务端 | 采纳：finally 里补发 stop |
| 重要 | R4 被收窄成"焦点在输入框才停" | 采纳：promptCard + window 两级，多选不响应 |
| 建议 | 墓碑查找时判过期、上限 1000；notify 内部 catch；stop 用 strictObject；controller 用普通 let | 全部采纳 |

### 9.2 用户评审

| 评审人 | 结论 | 意见 |
| --- | --- | --- |
|  |  |  |
