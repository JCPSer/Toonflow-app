# 测试记录：生成节点阻塞等待工具

- 时间：2026-11-17 19:09
- 变更：`nodeShared`（等待工具 + 纯逻辑）、三层超时豁免（toolsScaffold/nodeScaffold/web/server）、三个生成节点描述、系统提示、技能文档、nodeShared tsconfig

## 自动化

| 项 | 命令 | 结果 |
| --- | --- | --- |
| 等待纯逻辑单测 | `cd packages/nodeShared && bun test src/generationStatus.test.ts` | 6 pass / 0 fail |
| nodeShared 类型检查 | `bun run --filter '@toonflow/node-shared' typecheck` | 通过（tsconfig 增加 bun types） |
| server 类型检查 | `bun run --filter '@toonflow/server' typecheck` | 通过 |
| web 类型检查 | `bun run --filter '@toonflow/web' typecheck` | 仅既有 `@/agentRuntime` 基线错误 |
| 构建 | `build:tools`、`build:nodes`、`build:server`（含 web） | 全部成功 |
| 部署 | `bun/index.js`、`views/mainview`、`tools/canvas.tool.js`、全部 `nodes/*.umd.js` | 已同步，统一备份后缀 `.bak-20261117-190852`；未重启应用 |
| 产物核验 | 三个生成节点 UMD 均含 waitForGeneration；server bundle 含该能力 | 通过 |

## 覆盖场景
1. 已在终态 → 立即返回。
2. running → succeeded/failed 才放行。
3. signal 中断 → AbortError；入参已中断立即失败；终态后 abort 不二次结算。

## 手工矩阵（待用户重启验收）

| # | 场景 | 预期 |
| --- | --- | --- |
| 1 | 启动图片生成后调用 `node:waitForGeneration` | 图片完成即刻返回 succeeded + outputs，不再空等 |
| 2 | 视频生成（超过 2 分钟） | 等待不因 120s 超时中断，直到真实结束 |
| 3 | 生成失败 | 返回 failed + error，工具不抛错 |
| 4 | 生成中用户停止 | 等待以中断结束，节点回到空闲 |
| 5 | 生成中派活打断（同发送方 / 面板运行） | 等待结束，不悬挂 |
| 6 | 等待中删除节点/切画布 | 工具结束、不留下运行中状态 |
| 7 | 同一轮先启动多个节点生成再逐个等待 | 都能完成，不被串行阻塞 |
| 8 | 等待几分钟时的界面文案 | 不应显示成“等待模型响应”误导（已知体验缺口，未改） |

## 已知风险
- `/api/agent/abort` 纯服务端打断不会给浏览器下发 canvasCancel；同页操作路径已覆盖，跨窗口可能让等待悬挂。
- 不设超时：供应商任务永不结算且用户不停止时会一直等（用户明确选择）。
- 已安装到数据目录的旧技能副本不会随源码更新。
