# 需求方案：Agent 可编程开启/使用视频节点「首帧 / 尾帧」输出

- 时间：2026-10-31 22:30（v1）
- 对应需求：`1_requirements_matrix/2026-10-31-22-30-agent-frame-outputs.md`
- 代码基线：`feat/exec-node`（`f50ef9e`）

## 1. 方案总览

不新增画布协议、不改宿主。只做两件事：

```
packages/nodes/videoNode/src/frameOutput.ts
  ├─ 抽出可编程核心 apply(key, on, signal) → FrameApplyResult（抛错，不弹 UI）
  ├─ toggle(key, on) 改为 UI 壳：调 apply，负责 ElMessage（行为与现状一致）
  └─ createFrameOutputTool(frames) → setFrameOutputs 的 NodeToolDefinition

两个节点：
  const frames = useFrameOutputs({...})
  nodeTools.register(createFrameOutputTool(frames))
```

Agent 的调用链：

```
getNodeTools(videoNodeId)
  → 看到 setFrameOutputs（描述写明首/尾帧、何时用、开启后要 connectNodes）
setFrameOutputs({ last: true })
  → 同步抽帧 → 返回 { last: { enabled, handleId:"lastFrame", path, pending:false } }
connectNodes({ source: videoNodeId, sourceHandle:"lastFrame", target: imageNodeId, targetHandle:"in" })
```

## 2. 可编程核心 `apply`

现有 `toggle` 混了三件事：状态校验、抽帧、UI 提示，且吞异常。拆成：

```
type FrameApplyResult = {
  key: FrameKey
  enabled: boolean          // 调用后的状态
  handleId: string          // firstFrame / lastFrame
  path: string | null       // 工作区相对路径，未出帧为 null
  pending: boolean          // true = 端口已建但无值
  removedEdges: number      // 关闭时被宿主断开的连线数
}

async function apply(key, on, signal?): FrameApplyResult   // 失败 throw
```

分支：

| 场景 | 行为 | 返回 |
| --- | --- | --- |
| 已是目标状态 | 不重复抽帧 | 当前 `enabled/path/pending` |
| 关闭 | 中止在途抽帧 → 删输出值 → 写配置 → 重建 handles → `await nextTick()` → 宿主删悬空边 | `removedEdges`（先计数再改 handles） |
| 开启、无视频 | 写配置 → 重建 handles → `await nextTick()` | `pending: true, path: null` |
| 开启、有视频 | 起 controller → 抽帧（30s 上限）→ 写配置/端口/值 → `await nextTick()` | `path` 为帧文件 |
| 抽帧被新调用/视频变化取代 | 抛 `FrameSupersededError` | 工具侧转成该项 `error` |
| 抽帧失败（ffmpeg 不可用等） | 抛原始错误 | 工具侧转成该项 `error`；配置保持关闭 |

关键点：

- **断开条数必须在 `await nextTick()` 之前读**：宿主删悬空边是 post-flush（`nodeSkeleton.vue:764-778`），同 tick 改完 handles 立即读也拿得到真实值；顺序本身不是约束，时机才是。
- **`await nextTick()` 后再返回**：`node.data.handles` 由默认 pre-flush 的 watchEffect 同步（`nodeSkeleton.vue:753-757`），删边是 post-flush；一次 `nextTick()` 跑完整轮 flush，两条都能等到。工具返回后 Agent 立刻 `connectNodes` 时，必须已经能读到新端口。
- **外部 signal 合并**：`AbortSignal.any([controller.signal, toolSignal])`，Agent 取消时能中止 ffmpeg 握手；取消优先于「结果已失效」返回。
- **错误不落 UI**：`apply` 不弹提示；`toggle` 捕获后按现有文案弹（开启失败 / 结果已失效 / 已断开 N 条）。

### 2.1 并发模型（评审后补）

UI 手动开关与 Agent 并发调用会同时进入 `apply`，全局 `controller/epoch` 会把另一路正在抽的帧连带取消。最终定稿：

| 机制 | 粒度 | 作用 |
| --- | --- | --- |
| `controllers[key]` + `epochs[key]` | 每路 | 关/开一路只作废这一路；另一路 refresh 不受影响 |
| `round` + `JobTicket{round, epochs, explicitSource}` | 整轮 refresh | 入队时快照；排队期间视频变了/被 clear/被 apply 接管，旧 job 整轮或按路跳过，绝不用旧视频回填 |
| `queuedRounds[key]` | 每路 | 区分「排队未启动」与「失败后闲置」，避免误判重试 |
| 关闭遇到在途开启 | — | 不早退，强制 `abortFrame`，保证「最后一次为准」 |
| `errors[key]` | 每路 | 关闭 A 不清掉 B 的失败原因；两路都失败时 UI 拼接显示 |
| 写回配置 | — | 重新读 `config.value` 再合并，避免入口快照覆盖另一路的并发开关 |

## 3. 工具定义 `createFrameOutputTool`

```
name: "setFrameOutputs"
description:
  开启或关闭此视频节点的首帧/尾帧输出端口。
  开启按当前视频抽帧并写入输出值，抽完才返回；节点还没有视频时先建端口并返回 pending，视频就绪后自动补帧。
  需要把首帧/尾帧交给下游图片节点时先调用本工具，再用 connectNodes 连接 firstFrame/lastFrame。
  关闭会移除端口并断开其上的连线，返回 removedEdges。
parameters: strictObject({
  first: boolean().optional(),   // 不传 = 保持不变
  last:  boolean().optional(),
})
execute(patch, { signal }):
  results = {}
  for key of ["first", "last"]:
    if patch[key] === undefined: results[key] = currentState(key); continue
    try results[key] = await frames.apply(key, patch[key], signal)
    catch e: results[key] = currentState(key) + { error: describe(e) }
  return results
```

- 未传的项返回当前状态（含 path/pending），Agent 一次调用就能看到全貌。
- 单项失败不影响另一项，且不抛整体错误，避免 Agent 看不到部分成功。
- `frames` 只需 `apply`、`enabled`、`values`、`config`，工厂函数不调用 Vue API，便于单测用桩对象。

## 4. 能力发现（不改协议）

- 工具描述是唯一发现入口：Agent 处理视频节点时用 `getNodeTools` 查询，即可看到。
- 同时在两个节点现有工具描述里不额外写死；`setFrameOutputs` 的描述自身说明「何时用」。
- 画布工具 `getCanvasNodes` 的 `ports/outputs` 已能读到开启后的端口和帧路径，无需新增读取工具。

## 5. 代码改动清单

| 文件 | 改动 |
| --- | --- |
| `packages/nodes/videoNode/src/frameOutput.ts` | 新增 `FrameApplyResult`、`FrameSupersededError`、`apply`；`toggle` 改 UI 壳；导出 `createFrameOutputTool` |
| `packages/nodes/videoNode/src/frameOutputTool.ts` | 新增：`setFrameOutputs` 定义与纯工厂（桩对象可驱动，但不新增测试文件） |
| `packages/nodes/videoNode/src/index.vue` | `nodeTools.register(createFrameOutputTool(frames))` |
| `packages/nodes/videoGenerationNode/src/index.vue` | 同上（从 `@toonflow/node-video/frameOutput` 引入） |

不改：`frameOutputPlan.ts`、`frameOutputMenu.vue`、宿主 `nodeScaffold`、画布工具协议。

## 6. UI / 交互

无新增 UI。手动菜单的文案与行为保持不变；差异只有内部改为调用 `apply` 并保留原提示。

## 7. 测试计划

按 `AGENTS.md`「测试与检查边界」，不新增 `.test.ts`，验证只用既有 typecheck、构建与手动链路：

| 层级 | 用例 |
| --- | --- |
| 类型检查 | `@toonflow/node-video`、`@toonflow/node-video-generation` 的 `vue-tsc --noEmit` |
| 构建 | 两个节点包 `vite build`，产物包含 `setFrameOutputs` |
| 既有回归 | `bun test` 跑既有 `frameOutputPlan` / `frameTarget` 用例（不新增文件） |
| 接口级 | 真实画布：`getNodeTools` 能看到工具；`nodeTools` 调用开启后 `getCanvasNodes` 的 ports/outputs 出现；关闭后端口消失、连线断开 |
| 真实会话 | 让 Agent「给这个视频节点开尾帧并接到下游图片节点」，观察是否自主发现并调用 |

## 8. 风险与兜底

- ffmpeg 不可用：该项返回 `error`，Agent 可改用现有「截取视频帧」菜单路径或提示用户。
- 大视频两帧接近 120s：单帧上限 30s + `stop()` 2s 收尾，两帧最坏约 64s，再加目录创建/ffmpeg 初始化仍在 120s 内；实测 1080p 单帧 < 2s。若超时，返回错误且配置未写入，可重试。
- 同一轮并发调用：`epoch` 保证最后一次生效；被取代的调用返回 `error` 说明「已被新的调用取代」。
- 工具注册名冲突：节点工具注册表按节点隔离，两个节点同名不冲突；若同节点重复注册同名会覆盖（现有机制）。

## 8.1 已知边界

- **生成中调用**：视频生成节点生成期间输出项菜单被禁用，但 `nodeTools` 层只拦 `disabled`。工具会先对当前（旧）视频抽帧并返回路径，生成完成后节点自动 `refreshFrames()` 重新抽帧，路径随即更新；工具描述已写明「需要最新画面请等生成结束再查询」。不额外加生成态守卫，保持 Agent 可编排。
- **节点被删除/禁用**：删除触发 `onScopeDispose → abortAll`，在途抽帧 reject，工具按项返回错误；禁用由画布工具层在调用前拦截（`useCanvasTools.ts:312-316`），不会进入节点函数。
- **`removedEdges` 前提**：`getEdges` 读当前画布边；画布显式设置 `only-render-visible-elements=false`（`canvas/index.vue:21`），否则只统计可见边。
- **显式 `sourcePath`**：保留的 API 入口，当前无调用方；该分支只靠 `round` 兜底，不比对 `currentVideoPath()`。

## 9. 评审意见

| 评审人 | 结论 | 意见 |
| --- | --- | --- |
| 子 Agent 初审 | 需修订（已整改） | 3 轮：① 跨路 controller/epoch 取消；② 排队旧 job 逃逸 + error 无条件清空；③ 关闭无法取消在途开启、排队重试竞态、写回旧 config 快照。均已按 §2.1 整改并回归。 |
| 用户 | 已通过 | 与需求矩阵一致；实现按 Grill 结论落地。 |
