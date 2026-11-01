# 需求矩阵：Agent 可编程开启/使用视频节点「首帧 / 尾帧」输出

- 时间：2026-10-31 22:30（v1，经 Grill 逐题确认）
- 提出人：liyuhang
- 模块：`packages/nodes/videoNode`、`packages/nodes/videoGenerationNode`（共用 `frameOutput.ts`）
- 代码基线：`feat/exec-node`（`f50ef9e`）

## 1. 需求背景

「首帧 / 尾帧」输出项目前只能由用户在节点卡片上点「输出项」菜单开启（`frameOutputMenu.vue` → `useFrameOutputs().toggle()`）。节点没有注册任何 `nodeTools`，画布工具也没有写 `node.data` 的通用入口，因此 Agent 无法开启、无法感知「这个节点能出首尾帧」，只能等用户先手动点开。

用户原始要求（2026-10-31）：

> 需要，而且不能让用户来，就是半自动化，一定要 Agent 和全自动化的去能够去用它。

### 1.1 仓库现状（已核实）

| 事实 | 依据 |
| --- | --- |
| 输出项唯一写入口是 `useFrameOutputs().toggle()`，写 `node.data.frameOutputs` 的只有 `writeConfig` | `packages/nodes/videoNode/src/frameOutput.ts:91,229` |
| 视频节点只注册了 `setVideo` | `packages/nodes/videoNode/src/index.vue:172` |
| 视频生成节点注册了 `getConfig`/`setConfig`/`setPrompt`/`generateVideo` | `packages/nodes/videoGenerationNode/src/index.vue:471-560` |
| 画布写操作只有 addNode/deleteNodes/moveNodes/renameNodes/connectNodes/deleteEdges/selectNodes，无「写 node.data」入口 | `packages/tools/canvas/src/runtime.ts` |
| Agent 的节点类型清单只有 `{ type, label }`，说明能力只能靠 `getNodeTools` 查 | `apps/web/src/pages/workspace/panels/canvas/canvasQueries.ts:160`、`useCanvasTools.ts:44` |
| 端口存在时，Agent 可用 `getCanvasNodes({fields:["ports","outputs"]})` 读到端口与帧路径，并用 `connectNodes` 连下游 | `canvasQueries.ts:274` |
| 节点函数总超时 120s；单次抽帧上限 30s，首/尾串行最坏 60s | `packages/nodeScaffold/src/nodeTools.ts:138`、`frameOutput.ts` `CAPTURE_TIMEOUT_MS` |
| 关闭端口时宿主自动删悬空连线，`toggle` 只弹提示、不返回条数 | `packages/nodeScaffold/src/nodeSkeleton.vue:766-774` |
| `toggle` 内部吞异常并弹 ElMessage，工具调用拿不到失败原因 | `frameOutput.ts:273-280` |

## 2. 需求目标

1. 两个视频节点各注册一个 Agent 工具 `setFrameOutputs`，可开启/关闭首帧、尾帧输出项。
2. 工具同步等待抽帧完成再返回：成功给出端口 id 与工作区相对路径；失败给出原因。
3. 节点还没有视频时允许先开启，返回 `pending`，视频就绪后由既有 `refreshFrames` 自动补帧。
4. Agent 通过 `getNodeTools` 能发现该工具，工具描述写明「需要下游使用首/尾帧时先调用」。
5. 关闭时与 UI 行为一致：移除端口、宿主断开悬空连线，返回值报告断开条数。
6. 不改画布协议、不改宿主核心、不改变用户手动开关的现有行为。

## 3. 非目标（本次不做）

- 不做「生成后自动开启首尾帧」的默认行为（用户选择按需自动）。
- 不在工具内代做下游连线（Agent 继续用 `connectNodes`）。
- 不扩展 `getCanvas` 的 nodeTypes 协议（能力发现只靠 `getNodeTools`）。
- 不新增读取工具（`getCanvasNodes` 已能读 ports/outputs）。

## 4. 需求矩阵

| 编号 | 需求描述 | 优先级 | 难度 | 风险 | 验收标准 |
| --- | --- | --- | --- | --- | --- |
| R1 | **工具形态**：单一工具 `setFrameOutputs({ first?: boolean, last?: boolean })`，未传的项保持不变（部分更新）；两个视频节点同名注册，行为一致 | P0 | 低 | 低 | 只传 `first:true` 时尾帧状态不变；两个节点工具描述与返回结构一致 |
| R2 | **自动开启范围**：仅在 Agent 显式调用时开启，不默认开启、不在生成完成时自动开启 | P0 | 低 | 低 | 未调用时节点行为与现状完全一致；调用后端口立即出现 |
| R3 | **抽帧等待**：开启且已有视频时同步等待 ffmpeg 结束再返回；两帧串行，单帧上限 30s + 2s 收尾，最坏约 64s，仍在节点函数 120s 超时内 | P0 | 中 | 中 | 工具返回时 `path` 已可读；视频 1080p 下不超时 |
| R4 | **无视频开启**：允许开启，先建端口、不抽帧，返回 `pending: true, path: null`；后续 `setVideo`/生成完成自动补帧 | P0 | 低 | 低 | 空节点调用后端口存在但值为空；`setVideo` 后帧自动出现 |
| R5 | **返回值**：每项返回 `{ enabled, handleId, path, pending, removedEdges?, error? }`；失败不抛整体错误，按项给出 `error` 字符串 | P0 | 低 | 低 | 抽帧失败时另一项仍照常返回；Agent 能读到失败原因 |
| R6 | **关闭语义**：`false` 移除端口，宿主删悬空连线，返回 `removedEdges` 条数；帧文件保留（复制节点仍可能引用） | P0 | 低 | 低 | 关闭后端口消失、下游连线消失、返回值条数正确 |
| R7 | **禁用/忙碌**：节点禁用由画布工具层拦截；抽帧进行中再次调用以最后一次为准（沿用 `toggle` 的 epoch 语义） | P0 | 低 | 低 | 禁用节点调用报「节点已禁用」；连续两次调用不产生两套文件 |
| R8 | **能力发现**：工具描述明确写「首帧/尾帧」「何时用」「开启后需再 connectNodes」，Agent 查 `getNodeTools` 即可看到 | P0 | 低 | 低 | 真实会话中问「给视频节点开尾帧并接给下游」，Agent 能自主调用 |
| R9 | **不回归**：手动菜单开关、视频变化自动重抽、复制节点、分享导出均保持原行为 | P0 | 中 | 中 | 现有 `frameOutputPlan` 单测与手动开关路径不变 |

## 5. 评审意见

| 评审人 | 结论 | 意见 |
| --- | --- | --- |
| 子 Agent 初审 | 需修订（已整改） | R7「抽帧中再次调用以最后一次为准」不可只靠 UI 的 busy 兜底；并发入口必须显式校验在途意图。已在方案中补每路 controller/epoch 与整轮 round。 |
| 用户 | 已通过 | Grill 逐题确认：单工具、按需开启、不代连线、getNodeTools 发现、同步等待、无视频允许先开、关闭直接断线。 |

## 6. 风险

- 抽帧依赖 ffmpeg 已安装且可用；不可用时工具返回 error，Agent 需能降级（改为提示用户或走现有截帧）。
- 同一轮 Agent 调用中开启后立即 `connectNodes`：依赖 `node.data.handles` 同步（`nodeSkeleton` post-flush 写入），工具返回前需 `await nextTick()`。
- 120s 上限下，若视频很大且两帧都开，可能接近上限；实测 1080p 单帧 < 2s，风险低。
