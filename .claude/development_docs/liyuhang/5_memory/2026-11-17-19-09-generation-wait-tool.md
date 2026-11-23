# START 记忆：生成节点阻塞等待工具

- 时间：2026-11-17 19:09
- 关联：`2_requirements_solutions/2026-11-17-generation-wait-tool.md`

## Situation
Agent 启动图片/视频生成后只能用 bash sleep 猜时间，生成早已完成仍在空等，浪费整轮；系统提示也因缺少等待能力要求“不承诺后台跟进”。

## Task
给生成类节点提供回调式等待：阻塞到本次生成结束，失败/取消返回状态对象而非抛错，不设超时；同时更新工具描述、系统提示与技能文档，收掉 sleep 轮询习惯。

## Action
1. 新增 `packages/nodeShared/src/generationStatus.ts`：`waitForGenerationStatus(status, signal)`，`watch(..., { flush: "sync" })` 在终态即放行，abort 清理监听并抛 AbortError；补 6 个纯逻辑测试。
2. `useNodeGeneration` 注册 `waitForGeneration` 工具，返回 `{status, cancelled, outputs, error?}`；`getGenerationStatus`/`cancelGeneration` 描述改为优先等待；`cancelled` 区分取消与失败。
3. 评审发现三层 120s 超时会让等待最多 2 分钟：在 toolsScaffold 新增 `isLongRunningNodeTool` / `isLongRunningCanvasCall`，nodeScaffold、web `useCanvasTools`、server `bridge/canvas.ts` 统一豁免 `waitForGeneration`。
4. 系统提示改为条件式（`getNodeTools` 返回 `node:waitForGeneration` 时先启动再逐个等待）；`v118workflow`、`workflow` 技能文档同步更新。

## Result
- nodeShared 6 例、nodeShared/server typecheck 通过，web 仅既有基线；tools/nodes/server（含 web）全部重建并同步到桌面端（备份 `.bak-20261117-190852`），未重启。
- 待重启验收：图片/视频/音频等待是否即时返回、超 2 分钟是否不被截断、停止/打断/删节点是否能结束等待。
- 已知风险：纯服务端 abort 不下发 canvasCancel（跨窗口悬挂）；不设超时的供应商卡死风险；已安装技能副本不自动更新。

## 补充（19:22）
用户反馈图片节点查询不到 `waitForGeneration`。根因不是代码：桌面运行时从 `/Applications/toonflow-data/nodes` 加载内置插件副本，`Resources/app/nodes` 只是初始化源；`version.json` 未变时 `initializeNodes` 会跳过同步。已把 `build/nodes`、`build/tools`、`build/skills/{v118workflow,workflow}` 同步到数据目录（备份 `.bak-20261117-192239`），`/api/nodes/files?name=imageGenerationNode` 已能返回 waitForGeneration，需重启应用生效。后续部署必须同时同步数据目录插件。
