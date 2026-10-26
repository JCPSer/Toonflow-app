# Bug 分析：空节点无法加入 Agent 对话上下文 + 两个图标无文字说明

日期：2026-10-27 01:06
状态：待评审

## 一、Bug 矩阵

| 编号 | 描述 | 优先级 | 难度 | 风险 |
| --- | --- | --- | --- | --- |
| B1 | 刚添加、尚无输出的节点（如图片节点未上传图片）无法加入 Agent 对话上下文：画布节点工具栏的 `@` 按钮置灰，对话框 `@` 菜单里该节点行显示「暂无输出」且点不动 | P1（功能缺失，阻断「让 agent 看这个节点」的主流工作流） | 中（涉及引用数据模型与三端 UI） | 中（引用 schema 变更影响历史会话解析与渲染） |
| B2 | 节点工具栏的「加入对话上下文」`@` 按钮与图片节点的「缩放」按钮（`IconResize` 图形形似裁剪）都只有图标、只有 `title`/`aria-label`，没有可见文字，与同排的「局部重绘 / 打光 / 多角度 / 宫格切分 / 替换图片」不一致，用户把「缩放」误认成「图像裁剪」 | P2（可读性，导致误操作） | 低 | 低 |

## 二、现象与证据

### B1 空节点无法引用

1. 节点工具栏 `@` 按钮的禁用条件（`packages/nodeScaffold/src/nodeSkeleton.vue:46-56`）：
   `:disabled="!hasAgentContextOutput || addingToAgentContext"`，title 为「暂无输出」；
   `hasAgentContextOutput`（同文件 `:482-486`）要求 `props.outputs` 中至少有一项 `isNodeOutput` 通过，且 STRING 类型需 `value.trim()` 非空。
2. 画布侧处理函数（`apps/web/src/pages/workspace/panels/canvas/index.vue:447-462`）：
   `const available = outputs.filter(output => output.available); if (!available.length) return ElMessage.info("该节点暂无输出");`
3. 对话框 `@` 菜单侧：节点行虽然会出现在列表里，但 `available` 由「是否有非空输出」决定
   （`apps/server/src/agent/mentionSources.ts:103-108`），点击被直接拦下
   （`apps/web/src/components/agent/mentionMenu.vue:208-209`；键盘导航同样跳过 `:293-300`）。
4. 引用数据结构里只有「节点输出」这一种画布来源：`AgentMention.source` 的 canvas 分支强制要求
   `outputId` / `outputName`（`apps/server/src/agent/runtime/types.ts:6-13`，运行时校验
   `apps/server/src/agent/runtime/mentions.ts:39-43`），创建入口也强制要求存在可用输出
   （`apps/server/src/agent/mentionSources.ts:116`、路由 `apps/server/src/routes/agent/mentionSource.ts:35`）。

**根因**：引用模型只表达「某个节点的某个输出值」，没有「节点本身」这种引用。输出为空时没有任何一条路径能生成引用，于是三端（工具栏、@ 菜单、服务端 schema）各自独立地把空节点挡掉，表现为同一个功能缺失。

### B2 图标无文字

- `packages/nodeScaffold/src/nodeSkeleton.vue:46-58`：「加入对话上下文」按钮为纯图标 `IconAt`。
- `packages/nodes/imageNode/src/index.vue:19`：「缩放」按钮为纯图标 `IconResize`（方框内套小方框，视觉上很像裁剪）。
- 两者均只有 `title` / `aria-label`，无可见文字；同排「局部重绘 / 打光 / 多角度 / 宫格切分 / 替换图片」都有文字。

**根因**：工具栏按钮是逐个手写的 `el-button`，没有统一的「必须带文字」约定，纯图标按钮漏了可见标签。

## 三、目标

1. 任何节点，无论是否有输出，都能加入 Agent 对话上下文；引用只携带**节点身份**（画布 id/名称、节点 id/名称），不携带节点 data 快照（用户明确选择「只给身份」）。
2. 不改变现有「有可用输出节点」的行为：工具栏 `@` 有输出时仍弹输出菜单，`@` 菜单里点有输出的节点仍按现状插入输出。
3. 工具栏与对话框 `@` 菜单两个入口行为一致。
4. 工具栏「加入对话上下文」`@` 按钮与「缩放」按钮补可见文字，与同排按钮一致。
5. 历史会话（已有 mentions 均含 outputId）解析、渲染、重发不受影响。

## 四、非目标

- 不携带节点参数/data 快照（用户选择「只给身份」，模型需要细节时用画布工具读取）。
- 不改输出的可用性判定规则，不改素材引用，不改输出多选逻辑。
- 不为「标记」「下载」等其它纯图标按钮加文字（本轮仅用户指出的两处）。

## 五、风险

- **schema 兼容**：canvas 分支的 `outputId`/`outputName` 若改为可选，必须保证旧数据（有值）与新数据（无值）都能通过校验与渲染；`strictObject` 下新增可选字段不影响旧会话。
- **历史重发**：`snapshotMentions` 对非媒体、非 assets 的引用原样透传，节点引用会一直保持身份信息，若节点之后被删除，引用成为悬空 id —— 这是「只给身份」的固有代价，需要在提示层面说明。
- **文案一致性**：`@` 菜单里空节点行原本显示「暂无输出」，放开后应改为可点的提示，否则用户仍以为点不动。

## 六、评审意见

子 agent 首轮评审结论：B1 根因判断成立；B2 目标写错（应为「@」与「缩放」，不是「缩放」与「全屏」），已改。补充了 20 处落地拦截点，其中必须写进方案的 4 处：`nodeSkeleton.vue:488-490` 的二次早退、`runtime/index.ts:222-227` 的媒体强转、`mentionSource.ts:35` + `selectCanvas` 的服务端构造路径、`mentionContent.vue:45` 的 `outputName` 渲染；并要求明确身份引用的 `dataType`/`value` 取值（`NODE` + `null`）。以上已全部并入方案文档。

用户评审意见：（待填写）
