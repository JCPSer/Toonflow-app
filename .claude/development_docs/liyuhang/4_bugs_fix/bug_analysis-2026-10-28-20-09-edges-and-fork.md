# Bug 分析：连线消失 + 实时回复无法分支

- 记录时间：2026-10-28 20:09
- 报告人：用户
- 代码基线：`d4562fe`
- 关联文档：`bug_solution-2026-10-28-20-09-edges-and-fork.md`

## 一、Bug 矩阵

| 编号 | 现象 | 影响面 | 优先级 | 难度 | 风险 |
| --- | --- | --- | --- | --- | --- |
| B1 | 打开应用后画布连线全部不可见（节点仍在、数据完好） | 全部画布，阻断式 | P0 | 低（一行 CSS） | 低 |
| B2 | 本次运行期间生成的回复，鼠标悬停时「复制为新会话」按钮为灰色不可点；重启应用后恢复正常 | 所有实时对话，含引用与不含引用 | P1 | 中 | 中 |

## 二、B1：连线消失

### 2.1 背景

上一轮为缓解「选中节点后平移卡顿」，给连线层加了 `contain: paint`，目的把虚线动画的重绘失效限制在该层内不冒泡到根层。

### 2.2 现象与数据

- 用户打开应用后画布上连线全部不可见，节点与端口正常。
- 数据未损坏：项目目录内 `1-前情-炒股.json` 仍为 37 节点 / 50 连线，其余画布 33/27、3/2 均完整。

### 2.3 根因

Vue Flow 官方样式给 `.vue-flow__edges` 设了 `overflow: visible`：该 SVG 元素尺寸等于可视区，但连线坐标是**画布坐标系**，元素盒子之外的部分依赖 overflow 绘制。`contain: paint` 会强制把绘制裁剪到元素自身的 padding box，平移后画布坐标普遍在几千 px，几乎全部落在盒子外，于是全部被裁掉。

### 2.4 结论

这不是「隔离程度不够」，而是**方法本身不适用于该层**：任何 canvas 坐标系的 SVG 图层都不能套 paint containment。降频只能靠 `steps()` 把失效频率从 60Hz 压到 10Hz。

## 三、B2：实时回复不能分支

### 3.1 现象

用户实测反馈：只有「复制为新会话」变灰，复制/编辑/删除/回退均正常；重启应用后恢复正常。原先怀疑与「引用节点」功能相关，实测与引用无关，是「实时生成」与「从磁盘重载」的差别。

### 3.2 证据链

1. 服务端读出这几条对话（含引用）全部 `entryId` 齐全、`running=false`（用桩 host 直接调用 `getAgentSession` 验证）。
2. 前端 `messageList.vue` 的分支按钮 `:disabled="locked || remoteRunning || !item.entryId"`；其余三颗按钮不含 `!item.entryId`，与用户「只有分支灰」的观察完全吻合。
3. `conversation.vue` 的 `messages` 只在初始化为 `props.initialSession.messages` 时从 `/api/agent/get` 获得 `entryId`；运行期间的推送走 `replyStream.ts`。
4. `createConversationStream.ensureReply()` 构造的助手消息是 `reactive({ id: crypto.randomUUID(), role: "assistant", ..., streaming: true })`，**不含 entryId**；`AgentEvent` 里也没有任何携带助手条目 id 的字段。
5. 因此本次运行期间产生的回复永远没有 `entryId`，`done` 之后也不重载，直到重新打开该对话。

### 3.3 根因

协议缺口：用户消息有 `userMessage` 事件带 `id`，助手消息的条目 id（SDK 落盘时才生成）从未下发。前端无从得知，只能等下次从磁盘重载。

## 四、非目标

- 不改 fork/rewind 的服务端语义与去重规则。
- 不为 B1 换合成层动画方案（另议，见上轮测试文档 §七）。
- 不改 `deploy-local.sh` 的 rsync `--delete` 缺失问题。

## 五、评审意见

- 子 agent 评审：
- 用户评审：
