# Bug 修复方案：waitForGeneration 超时豁免未生效

- 时间：2026-11-19 13:26
- 关联分析：`bug_analysis-2026-11-19-13-24-wait-for-generation-timeout.md`

## 方案

统一在豁免判定入口做名称归一化，而不是让每个调用点自己处理前缀：

```
isLongRunningNodeTool(name):
  normalized = name 去掉开头的 "node:"
  return LONG_RUNNING_NODE_TOOLS.has(normalized)
```

- 服务端桥 `isLongRunningCanvasCall` 继续透传 `request.args.name`，自动受益。
- 画布执行层 `nodeTools.call` 继续透传注册表名字，自动受益。
- 不改注册表、不改画布 schema，避免出现两套命名规则。

## 测试

1. 服务端新增单测：`isLongRunningCanvasCall({ name: "nodeTools", args: { name: "node:waitForGeneration" } })` 为 true；`node:getGenerationStatus` 为 false；非 `nodeTools` 操作为 false。
2. 全量服务端测试、web 测试、typecheck。
3. 构建与同步：服务端入口（drawdesktop 内层）、web 视图、全部节点 UMD（nodeScaffold 被各节点打包）。

## 发布注意

`packages/toolScaffold` 同时被服务端、web、节点 UMD 打包，三层都要重建；节点运行时副本在 `/Applications/toonflow-data/nodes`，需要与应用内 `Resources/app/nodes` 一起同步。

## 评审意见

| 评审人 | 意见 | 结论 |
| --- | --- | --- |
| 子 agent 评审 | 待填 | |
| 用户评审 | 待填 | |
