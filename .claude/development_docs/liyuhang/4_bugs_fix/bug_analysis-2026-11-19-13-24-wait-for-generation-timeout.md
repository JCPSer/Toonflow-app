# Bug 分析：waitForGeneration 画布调用 120 秒超时

- 时间：2026-11-19 13:24
- 优先级：P1（长任务必失败，功能不可用）
- 难度：低

## 背景

Agent 启动图片/视频/音频生成后，按提示词用 `node:waitForGeneration` 阻塞等待真实终态。设计上该工具属于长任务，三层超时都应豁免；但用户反馈现在「很容易」报「画布调用超时，请确认画布仍然打开」。

## 现象

- 生成任务超过 2 分钟（视频尤其常见）即收到「画布调用超时，请确认画布仍然打开」。
- 该文案只由服务端画布桥 `apps/server/src/agent/bridge/canvas.ts` 的 120 秒定时器产生。

## 根因

节点函数注册时名称统一加前缀：`nodeScaffold/src/nodeTools.ts` 中 `const name = \`node:${definition.name}\``，因此注册表里的名字是 `node:waitForGeneration`。

但长任务豁免集合存的是不带前缀的名字：

```ts
const LONG_RUNNING_NODE_TOOLS = new Set(["waitForGeneration"]);
export function isLongRunningNodeTool(name) { return LONG_RUNNING_NODE_TOOLS.has(name); }
```

两处调用传入的都是 `node:waitForGeneration`：

- 服务端桥 `isLongRunningCanvasCall` 读 `request.args.name`（画布操作 `nodeTools` 的 schema 要求 `node:` 前缀）→ 未命中 → 设置 120 秒定时器。
- 画布执行层 `nodeTools.call` 读注册表名字 `node:waitForGeneration` → 未命中 → 同样套 120 秒 `AbortSignal.timeout`。

即豁免判定从引入起就没生效，只是生成较快的图片偶尔能在 120 秒内完成，才没有暴露；视频/长音频必然超时。

## 修复目标

`isLongRunningNodeTool` 对带 `node:` 前缀与不带前缀的名字都返回 true，使服务端桥、画布执行层同时生效。

## 风险

- 仅影响超时判定，不改调用协议；错误名字（如 `node:unknown`）仍按普通 120 秒处理。
- 真正卡死的节点函数不再有 120 秒兜底，只能靠用户取消本轮；这与设计一致（注释已写明「等待生成不限总时长，仍接受本轮取消」）。

## 评审意见

| 评审人 | 意见 | 结论 |
| --- | --- | --- |
| 子 agent 评审 | 待填 | |
| 用户评审 | 待填 | |
