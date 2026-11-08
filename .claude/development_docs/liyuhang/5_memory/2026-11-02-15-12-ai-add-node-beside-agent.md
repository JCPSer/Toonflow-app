# 记忆：AI 新建节点固定在发起 Agent 旁边

- 时间：2026-11-02 15:12
- 类型：体验修复

## STAR

**Situation（背景）**
画布 Agent 用 `addNode` 建节点时完全按模型给的坐标落位，经常出现在画布任意位置。画布工具调用链没有携带调用方身份，前端 `conversation.vue` 持有 `nodeBinding` 却没传给画布上下文。

**Task（任务）**
由画布 Agent 节点发起的新建节点固定在它右侧一列，忽略模型坐标，自动向下避让；只改 addNode，不影响手动与其他入口。

**Action（行动）**
- `CanvasContext.call` 增加可选 `origin: CanvasCallOrigin`（canvasId + nodeId）；`conversation.vue` 把 `props.nodeBinding` 传入，`useCanvasTools` 在 `execute` 中透传，重定向代理同样透传。
- `addNode` 在 origin.canvasId 与当前画布一致且节点存在时，用 `computedPosition` 取锚点绝对坐标，`findSpawnPosition` 计算「右侧 +80、顶部对齐、竖向 gap 40」的位置，x 先吸附再碰撞，向下用 `snapOffset` 上取整。
- 新节点尺寸挂载前按 360×320 估算，挂载后按实测尺寸再校正一次 y；校正或摆放失败都回退，不阻断建节点。
- 纯函数抽到 `spawnBesideNode.ts`，9 个单测覆盖顺延、吸附、边缘相接等边界。
- `packages/tools/canvas` 的 addNode 描述与 prompt 同步说明 position 会被忽略；重建 `canvas.tool.js` 并部署。

**Result（结果）**
web 与 canvas 工具构建成功；9 个单测通过；web 类型检查仅既有 `@/agentRuntime` 报错，其余类型检查通过。`views/mainview/index.html` md5 `7e6ce14e…`、`app/tools/canvas.tool.js` md5 `c9ddc333…` 已同步到应用。**未重启应用**。

## 关键经验

1. 画布几何只在 Web 端可用：`computedPosition` 是绝对坐标，`position` 是相对父节点的；新建顶层节点要写绝对坐标。
2. 吸附必须发生在碰撞判定之前，否则吸附半格会把节点重新压到右侧节点上；向下顺延要用向上取整。
3. `node.dimensions` 是 `{0,0}` 而不是 undefined，尺寸兜底必须用 `||`。
4. 调用方身份必须校验 `origin.canvasId`，否则复制画布产生的重复 nodeId 会把节点放到错误的画布实例。
5. 挂载后校正只能改位置、不能再抛错，否则节点已落盘但工具报失败。
