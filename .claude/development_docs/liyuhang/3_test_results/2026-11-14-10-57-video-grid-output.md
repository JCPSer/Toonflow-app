# 测试结果：视频节点宫格输出端口与 Agent 宫格开关

- 时间：2026-11-14 11:20
- 对应方案：`2026-11-14-10-57-video-grid-output.md`

## 1. 单元测试

`packages/nodes/videoNode`：`bun test`

```text
56 pass / 0 fail / 191 expect() calls，6 个文件
```

新增用例：

| 文件 | 覆盖 |
| --- | --- |
| `frameOutputPlan.test.ts` | 三路全开顺序（firstFrame→lastFrame→gridFrame）、只开宫格、关闭尾帧后端口上移、`frameOutputMeta("grid")` 的 handleId/fileName、`GRID_OUTPUT_COUNT=4` |
| `frameOutputTool.test.ts` | `grid` 透传给 `apply`；未传项返回当前状态与 pendingReason；单项失败不阻断另一项且带可读错误 |
| `videoGrid.test.ts` | `tile=2x2`、`fps=0.500000`、`scale=512:288`、`pad`、`-frames:v 1`、`-map 0:2`；竖屏 `288:512` 与 `0:V:0` |

## 2. 类型检查

| 包 | 结果 |
| --- | --- |
| `@toonflow/nodes-scaffold` | 通过（exit 0） |
| `@toonflow/node-video` | 通过（exit 0） |
| `@toonflow/node-video-generation` | 通过（exit 0） |

## 3. 构建与部署

| 项 | 结果 |
| --- | --- |
| `videoNode` vite build | 成功，254.49 kB（gzip 77.36 kB） |
| `videoGenerationNode` vite build | 成功，463.45 kB（gzip 133.11 kB） |
| UMD 元数据 | 首行 `configRules` 已包含 `agentGridInspect`，默认 `false` |
| 同步 | 备份旧包后覆盖 `data/nodes/` 与 `/Applications/toonflow-data/nodes/`（11:27 第二次重建后重新同步） |

## 4. 逻辑核对

| 场景 | 期望 |
| --- | --- |
| 勾选宫格输出 | 端口 `gridFrame` 出现，值为 `assets/<nodeId>/frame-grid.jpg`（IMAGE/jpeg） |
| 替换视频 | `refresh` 依次重抽首帧→尾帧→宫格；宫格排在最后 |
| 关闭宫格 | 移除端口与输出值，`getEdges` 统计 `gridFrame` 上的连线数并提示 |
| 无视频开启 | 返回 `pending=true, pendingReason=no-video`；视频就绪后自动补 |
| 抽帧中视频被替换 | epoch 失效，结果作废；新一轮重抽 |
| 抽帧中取消 | `signal`/epoch 双重校验，未提交的临时文件删除 |
| 短视频 | `fps` 滤镜重复补齐四格，不误报「未生成文件」 |
| 宫格失败、首尾帧成功 | 汇总错误包含宫格原因，首/尾帧照常回填 |
| 插件开关默认关闭 | 新装环境 Agent 工具列表无 `sampleFrames` |
| 打开开关并保存 | `toonflow:node-config-updated` → 画布刷新配置 → 立即注册，无需重开项目 |
| 关闭开关 | 立即注销；`captureFrame` 与 `setFrameOutputs` 不受影响 |
| 旧画布无 `grid` 字段 | 端口不出现 |

## 5. 代码审查

子 agent 审查未发现 P0；1 个 P1 + 5 个 P2，除「composable 级状态机测试」记为已知缺口外全部修复：

| 级别 | 问题 | 处理 |
| --- | --- | --- |
| P1 | 开启宫格途中视频变化：`refresh` 看不到未落盘的开启意图，abort 后不补抽 | `pendingEnables` + `refresh` 先落盘；`apply` 的 abort 分支按 pending 返回 |
| P2 | 关闭插件开关不中止在途 `sampleFrames` | `cancelSamples()` 内部 AbortController，关闭时立即中止 |
| P2 | `commitTemporary` 只靠列表判断，列表滞后会误判未生成 | 未命中时 `read` 兜底 |
| P2 | 默认关闭时 `captureFrame` 描述仍推荐 `sampleFrames` | 改为条件式表述 |
| P2 | 缺少 `useFrameOutputs` 级回归测试 | 已知缺口：工具层已有 fake controller 测试，composable 需可注入夹具 |
| P2 | 三路最坏耗时与 120s 闸门持平 | 注释改为「典型在闸门内，最坏整体取消」 |

修复后复测：`bun test` 56 pass / 0 fail，三个包 `vue-tsc --noEmit` 全部通过，两个 UMD 已重建并重新同步。

## 6. 待实机确认

- 竖屏视频的宫格缩略图是否完整（改用 contain）。
- 拖滑杆之外：宫格抽取耗时（45s 上限）在大视频上的表现。
- 插件设置在画布打开时保存，工具列表刷新是否有可见延迟。
- 长视频上勾选宫格的同时替换视频：端口应保留为 pending，随后按新视频补抽，而不是回退勾选。
- Agent 正在看宫格时关闭插件开关：应立刻中止并返回取消，而不是跑完。
- 复制节点、跨项目粘贴、分享导入后宫格文件是否随 outputs 正常搬运。
- 删除正在抽宫格的节点，目录是否无孤儿文件。
