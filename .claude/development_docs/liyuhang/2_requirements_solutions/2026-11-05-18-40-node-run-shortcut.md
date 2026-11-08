# 需求方案：⌘Enter 运行选中节点

- 时间：2026-11-05 18:40
- 对应需求：`../1_requirements_matrix/2026-11-05-18-40-node-run-shortcut.md`
- 状态：待评审

## 1. 背景与约束

生成动作在节点包内部（各节点自己的 `startGeneration`），而画布宿主与节点包是两个独立 UMD 构建，模块实例不共享。已有先例是 `nodeBusy`：用 `Symbol.for` 把注册表挂在 `globalThis`，宿主与节点包都能访问同一份。

## 2. 方案

### 2.1 运行入口注册表

`packages/nodeScaffold/src/nodeRun.ts`（新）

- `Symbol.for("toonflow.nodeRun")` → `Map<nodeId, () => void | Promise<void>>`。
- `registerNodeRun(nodeId, run)` 返回注销函数（只注销自己注册的那一份，避免重挂载互相清掉）。
- `getNodeRun` / `hasNodeRun` 供宿主查询。
- 通过 `package.json` exports 暴露 `./nodeRun`，`runtime.ts` 一并导出。

### 2.2 骨架注册

`nodeSkeleton.vue`

- 新增可选 prop `run?: () => void | Promise<void>`。
- `watch([() => props.run, nodeId])` 维护注册：有 run 就注册，没有就注销；`onScopeDispose` 兜底清理。
- 节点组件传入稳定函数引用，避免每次渲染重注册。

### 2.3 四个节点接入

| 节点 | 运行入口 |
| --- | --- |
| imageGenerationNode | `startGeneration().catch(showNodeError(...,"图片生成失败"))`，运行中直接返回 |
| videoGenerationNode | 同上（视频） |
| audioGenerationNode | 同上（音频） |
| textNode | `generateText()`（内部已有运行中/上游禁用守卫） |

其它节点不传 `run`，注册表里没有它们，宿主自然跳过。

### 2.4 宿主派发

`apps/web/src/pages/workspace/panels/canvas/index.vue`

- `canvasShortcuts` 增加动作 `runNode`，默认 `primaryModifier + Enter`。
- `updateCanvasKeys` 的白名单加入 `runNode`；在 `editing` 判定上**单独放行**（节点输入框内可用），但仍受 `inCanvas`/Agent 面板/弹窗判定约束。
- `runSelectedNodes()`：
  1. 取 `getSelectedNodes`；为空提示。
  2. 逐个检查：无 `run`、`data.disabled`、`isNodeBusy` → 跳过并计数。
  3. 其余 `Promise.resolve().then(run)` 并行启动，异常只记日志（节点自己负责用户提示）。
  4. 全部落空时区分「都在运行/已禁用」与「没有可运行任务」提示。
- `event.preventDefault()` + `event.repeat` 复用现有流程，只触发一次。

### 2.5 设置页

设置字段表新增 `{ id: "runNode", label: "运行选中节点" }`，复用录制、冲突检测、恢复默认；与裸 Enter 的清提醒不冲突（修饰键严格全等）。

## 3. 交付物

- 重新构建四个节点 UMD 并同步到 `/Applications/toonflow-data/nodes/`（旧包备份）。
- 重新构建 web 并同步到应用 `views/mainview/`。
- 需要重启应用生效；未改服务端与主进程，不需要更新 `index.js`。

## 4. 测试计划

- 单测：默认键、与裸 Enter/Shift+Enter/Alt+Enter 的区隔、允许性、冲突检测；注册表注册/注销/覆盖语义。
- 类型检查：web、nodeScaffold。
- 构建：build:nodes（四个 UMD 含 `toonflow.nodeRun`）、web build。
- 人工：见测试文档。

## 5. 评审意见

（待用户填写）

- 是否通过：
- 其他要求：
