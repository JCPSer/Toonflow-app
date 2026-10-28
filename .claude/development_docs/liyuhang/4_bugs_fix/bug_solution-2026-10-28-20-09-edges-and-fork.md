# Bug 方案：连线消失 + 实时回复无法分支

- 记录时间：2026-10-28 20:09
- 代码基线：`d4562fe`
- 关联分析：`bug_analysis-2026-10-28-20-09-edges-and-fork.md`

## 一、B1 方案：撤掉连线层的 paint containment

改动只有一处：删除 `apps/web/src/pages/workspace/panels/canvas/index.vue` 里 `.vue-flow__edges { contain: paint }`，并把「为什么禁止」写进注释，避免以后又被加回来。

保留的部分：

```
:deep(.vue-flow__edge.animated path) { animation: canvasEdgeFlow 2s steps(20) infinite }
```

降频仍然有效：`linear` 插值每帧取值都不同，`steps()` 把连续插值改成离散跳变，失效频率从 ~60Hz 降到 10Hz。丢失的只是「把失效限制在该层」这一层保险，代价是平移时主线程每 100ms 多做一次连线层光栅化，量级远低于改前的 60Hz。

伪代码：

```
删除 contain: paint
保留 steps(20) 动画
注释写清：该 SVG 尺寸等于可视区、坐标却在画布坐标系，靠 overflow: visible 绘制，
paint containment 会把元素盒子之外的连线全部裁掉
```

## 二、B2 方案：服务端实时下发回复条目 id

### 2.1 时序约束

SDK 的 `_emit(message_end)` 在 `sessionManager.appendMessage()` **之前**执行，监听器里读不到刚产生的条目。现有代码已经在 `message_end` 用 `queueMicrotask` 等落盘后再算 stats，方案沿用同一时机。

### 2.2 协议

`AgentEvent` 新增一个成员：

```
{ type: "assistantEntry"; id: string }
```

只带 id，不带正文；正文仍走已有的 text 事件。

### 2.3 服务端

在 `runtime/index.ts` 的 `message_end && role === assistant` 分支内：

```
entryCount ← history.getEntries().length
queueMicrotask:
    entry ← getEntries().slice(entryCount).find(条目 type=message 且 role=assistant)
    if entry: send({ type: "assistantEntry", id: entry.id })
```

用「落盘前的条目数 + 新增条目里找助手消息」而不是 `getLeafId()`，避免同一微任务内还有别的条目追加时取错。

### 2.4 前端

`replyStream.ts` 的 `createConversationStream.receive` 前置一个分支：

```
if 事件是 assistantEntry:
    target ← 当前正在流式输出的助手消息（reply，兜底找最后一条 streaming 的 assistant）
    if target 且 target.entryId 为空: target.entryId ← 事件 id
    return
```

「已有 id 就不覆盖」是硬要求：一轮里可能有多条 SDK 助手消息（多步工具调用），服务端 `getAgentSession` 分组时保留的是**首条**的 id，前端必须与之一致，否则 fork 的截断点会偏移。

`conversation.vue` 不需要改：`assistantEntry` 走 `applyEvent` 的 default 分支，正好落到 `stream.receive`。

### 2.5 UI 影响

无。按钮禁用条件不变（仍然要求有 `entryId`），只是这次实时也能拿到。中途切换面板/重连的场景由 `reply ?? findLast(streaming)` 双保险覆盖。

## 三、验证计划

1. 服务端 typecheck、前端 typecheck 均 0 错。
2. 构建产物里 `assistantEntry` 同时出现在 server bundle 与 replyStream chunk。
3. 画布产物无 `contain:paint`，仍有 `steps(20)`。
4. 手测：新发一条消息后不重启，直接悬停该回复的「复制为新会话」，应可点击并成功复制；重启后画布连线应恢复。

## 四、评审意见

- 子 agent 评审：
- 用户评审：
