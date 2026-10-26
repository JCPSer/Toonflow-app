# Bug 方案：空节点可引用为「节点引用」+ 两个图标补文字

日期：2026-10-27 01:20
状态：待评审（已按首轮子 agent 评审补齐）

## 一、方案总览

引入第三种引用形态：**节点引用**（只带身份、不带内容），让空节点也有可插入对话栏的引用对象。

| 编号 | 办法 |
| --- | --- |
| B1 | 扩展 `AgentMention` 的 canvas 来源，`outputId`/`outputName` 变可选；新增 `selectNode` 链路；工具栏 `@` 与 `@` 菜单在「该节点没有可用输出」时改插节点引用 |
| B2 | 工具栏 `@` 按钮与图片节点「缩放」按钮补可见文字，保留原图标 |

## 二、B1 数据模型

`apps/server/src/agent/runtime/types.ts`

```
source: { kind: "canvas"; canvasId; canvasName; nodeId; nodeName; outputId?; outputName? }
```

- 有 `outputId` → 输出引用（现状，行为逐字不变）
- 无 `outputId` → 节点引用：`dataType = "NODE"`、`value = null`

`value` 必须显式 `null`：`isBoundedValue`（`mentions.ts:15-34`）对 `undefined` 会返回 false，`null` 则通过；`superRefine` 只对 STRING/INT/FLOAT/BOOLEAN/媒体做类型校验，`NODE` 落到末尾 `: true` 分支。`dataType` 必须**避开** `IMAGE/MASK/VIDEO/AUDIO/FILE`，否则会被 `runtime/index.ts:222-227` 当媒体值强转给 `readAiReferences`。

`mentions.ts` 的 zod schema：canvas 分支 `outputId`/`outputName` 改 `.optional()`，加对象级 refine「要么都有、要么都没有」。旧会话全部带值，不受影响；`strictObject` 也不会因新增可选字段拒绝旧数据。

## 三、B1 创建链路

### 3.1 服务端

```
createNodeMention(node, canvasId):
  canvasName = 画布文件名去扩展名
  nodeName   = data.label 或 node.id
  return { id: uuid, label: nodeName,                 // label 固定为节点名，供 mentionName 拼接
           source: {kind:"canvas", canvasId, canvasName, nodeId, nodeName},
           dataType: "NODE", value: null }
```

- `mentionSources.ts` 导出 `createNodeMention`；`MentionCanvasSource` 增加 `selectNode(canvasId, nodeId)`
- 路由 `mentionSource.ts` 增加 `operation: "selectNode"`（**不复用** `selectCanvas`：`outputId === undefined` 在 `storedMentionOutput` 里表示「列出输出」，语义重载会歧义）
- `mentionFiles.ts` 增加 `storedNodeMention(directory, canvasId, nodeId)`，节点不存在 404「节点已删除，请重新选择」

### 3.2 前端

- `components/agent/mentionSources.ts` 增加 `selectNode`（实时 provider 优先，回退接口）
- `canvasHost.vue` 的 `mentionSource` 实现 `selectNode`

## 四、B1 入口改造

### 4.1 节点工具栏 `@`（`nodeSkeleton.vue` + `canvas/index.vue`）

三处闸门都要动，缺一处按钮仍是死的：

1. `:disabled="addingToAgentContext"`（去掉 `!hasAgentContextOutput`）
2. `addToAgentContext()` 内的早退 `!hasAgentContextOutput.value`（`:488-490`）去掉
3. title 文案改为按有无可用输出切换：「将该节点的输出加入右侧 Agent 对话上下文」/「将该节点加入右侧 Agent 对话上下文」；按钮同步补可见文字「加入对话」

`canvas/index.vue` 的 `addNodeToAgentContextFromToolbar`：

```
outputs = await mentionSources.outputs(...)
available = outputs.filter(available)
if (!available.length)          -> insertNodeAgentMention(nodeId)        // 新增：节点引用
else if (available.length === 1) -> insertNodeAgentMention(nodeId, id)   // 现状
else                             -> openAgentPortMenu(...)               // 现状
```

`openAgentPortMenu` 本就把不可用输出列为禁用项，保持不动（该分支只在 ≥2 个可用输出时进入）。

### 4.2 对话框 `@` 菜单（`mentionMenu.vue`）

行主体行为**保持不变**，新能力全部走「行尾『节点』小按钮」：

| 节点情形 | 点行主体 | 行尾「节点」按钮 |
| --- | --- | --- |
| 输出数 > 1 且有可用输出 | 进输出二级面板（现状） | 插节点引用 |
| 单输出且有内容 | 直接插输出（现状） | 插节点引用 |
| 无可用输出（空节点/空端口，含 >1 输出但全空） | 原本点不动，改为插节点引用 | 插节点引用 |

实现要点：

- **不做**「二级面板首项『整个节点』」伪行：`confirmOutputs`（`:255-271`）只按 outputId 调 `selectCanvas`，伪行需要另开一套数据流；行尾按钮已覆盖同一能力，回归面更小。
- 节点行外层由 `<button>` 改为 `<div role="option" tabindex="-1">`，行尾追加真正的 `<button data-mention-node>`（按钮内嵌按钮在 HTML 上非法）。键盘高亮靠 `aria-activedescendant`（`:379-394`），不依赖真实焦点，改标签不影响上下键；虚拟滚动是绝对定位 + 固定 52px（`:24-30`、`:469-497`），与标签无关。
- `handleKeydown` 的按钮豁免（`:284`）改为「焦点在任意 button 上就不接管」，否则行尾按钮上按 Enter 会被 `chooseRow(activeRow)` 抢走、变成插输出。
- 新增 `MentionRow.interactive`（节点行恒 true，其余沿用 `available`）：`:aria-disabled`、`.unavailable` 的 `opacity:.5; cursor:not-allowed`（`:491`）、键盘跳过（`:293-301`）三处统一改用它，否则空节点行仍是灰的、进不了高亮循环。
- `chooseRow` 分支顺序：`!row.available && row.kind === "node"` → 节点引用（最前，覆盖「>1 输出但全空」）；`>1` → 面板；其余 → 现状。`outputCount === 1` 但输出不可用时不会走到 `:239-243` 的「该节点输出已不可用」。
- 行尾「暂无输出」改为走 `translate` 的灰字「无输出」，不再表示不可用。`typeLabels` 不加 `NODE`（`queryMentionNodes` 从不下发该类型，只有引用标签会用到）。

### 4.3 展示

- `mentionContent.vue:43-46` `sourceLabel`：无 `outputName` 时显示 `画布名 / 节点名`（避免渲染 `undefined`）
- `mentionContent.vue:8-17` 预览弹窗：增加 `dataType === "NODE"` 分支，显示「画布 / 节点 / 节点 id」与一句「节点引用只包含身份，内容由助手用画布工具读取」，不要落进 `textValue` 空白分支
- `mentionText.ts` 的 `mentionName` 用 `canvasName / label`，`label` 固定为节点名即可，无需改
- `messageInput.vue:176-179` `mentionIdentity`：canvas 分支改为 `canvas:${canvasId}:${nodeId}:${outputId ?? ""}`，避免节点引用与输出引用去重键相同
- 历史消息 `messageList.vue:57` 复用 `mentionContent`，随 4.3 一并修好

### 4.4 注入给模型

`mentionPrompt`（`mentions.ts:67-72`）在存在 `dataType === "NODE"` 的引用时追加一句：

> 标为 NODE 的引用是画布节点本身，只提供画布与节点身份，不含内容；需要它的输出、参数或连线时，用画布工具按 nodeId 读取。

## 五、B2 图标文字

| 文件 | 改动 |
| --- | --- |
| `packages/nodeScaffold/src/nodeSkeleton.vue:46-58` | `@` 按钮补可见文字「加入对话」，保留 `IconAt`、`title`、`aria-label` |
| `packages/nodes/imageNode/src/index.vue:19` | 「缩放」按钮补可见文字「缩放」，保留 `IconResize`、`title`、`aria-label` |

两个按钮都在节点悬浮工具栏里。工具栏是 `floatingSlot`，默认固定宽度（`topWidth="20vw"`，`nodeSkeleton.vue:235`、`:684-705`），**加字不会让工具栏变宽，而是在固定宽度内换行、工具栏增高一排**；空图片节点也没有 `max-content` 宽（`imageNode/index.vue:7` 只在有预览图且量到宽度时才设宽）。因此要验证的是「换行后是否遮住节点标题或内容」，而不是右侧超窗。

## 六、验收

1. 新建图片节点（无图）：悬浮工具栏 `@` 可点，右侧对话栏出现 `@画布名 / 节点名`；发送后模型收到的 mentions JSON 含 `canvasId`/`nodeId`，`dataType` 为 `NODE`。
2. 对话框输入 `@`：空节点行可点，行尾有「节点」按钮；有内容的单输出节点点行仍直接插输出。
3. 多输出节点：二级面板首项「整个节点」，其余输出行为不变。
4. 历史会话（全部带 `outputId`）打开、重发、复制分支正常；节点引用重发不报「提及已失效」。
5. 节点引用与同节点的输出引用可同时存在（去重键不同）。
6. 「加入对话」「缩放」显示文字，点击行为不变，工具栏不溢出。

## 七、风险与取舍

- **schema 放宽**：保留 `validateMentionTokens` 的一一对应校验；`value` 必须是 `null` 而非 `undefined`，否则会话持久化的 `safeParse` 会静默丢弃整条 mention。
- **悬空节点**：节点删除后引用只剩 id，模型调用画布工具会得到「节点不存在」——「只给身份」的固有代价，不做额外快照。
- **行结构改造**：`<button>` → `<div role="option">` 影响样式与键盘路径，需回归点击、Enter、上下键、滚动定位与「已在上下文中」去重提示。
- **不做**：节点 data 快照；`mentionSources.ts:73` 与 `nodeSkeleton.vue:483` 之间 STRING 可用性判定（`!!value.length` vs `trim()`）的不一致（独立问题，避免扩大回归面）；为「标记」「下载」「全屏」等其它纯图标按钮补文字（本轮只处理用户指出的两个）。

## 八、评审意见

子 agent 第二轮评审（方案稿）结论「需修改」，已按意见收敛：

- 路由必须显式加 `selectNode` 分支，不能只加枚举值 —— 采纳，`mentionSource.ts:33-38` 独立分支。
- `handleKeydown` 的按钮豁免会抢走行内按钮的 Enter —— 采纳，改为「焦点在任意 button 上就不接管」。
- 行级 `aria-disabled` / `.unavailable` 样式会让空节点行仍显灰 —— 采纳，新增 `interactive` 字段统一三处判定。
- `chooseRow` 分支顺序（`>1` 但全空）未定义 —— 采纳，「无可用输出」分支提到最前。
- 二级面板「整个节点」伪行数据流缺失 —— 采纳评审建议，**取消伪行**，统一由行尾「节点」按钮承担，回归面更小。
- B2「工具栏变宽 90px」表述错误 —— 已改为「固定 20vw 内换行、需验证遮挡」。
- `typeLabels` 加 NODE 属冗余 —— 采纳，不加。

用户评审意见：（待填写）
