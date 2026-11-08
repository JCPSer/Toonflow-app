# 测试结果：sampleFrames 误报「帧数不足」

- 时间：2026-11-02 09:10
- 对应方案：`4_bugs_fix/bug_solution-2026-11-02-09-04-sample-frames-false-frame-shortage.md`
- 结论：单测、node 包类型检查、构建与部署核对通过；**未重启应用**，需用户重启后人工验收

## 1. 现场复现与反证

| 项 | 结果 |
| --- | --- |
| 用户工程 | `/Volumes/WD_BLACK_MAC/[0]【AI Art】/2026/蕾姆Rem`，节点 `138e01e7-…/inspect` 只有 `frame-*ms.jpg`，无 `contact-*.jpg` |
| 视频 | 1920×2560、24fps、10.125s、243 帧 |
| 宿主 ffmpeg（brew）跑宫格命令 | 出图正常 |
| 应用自带 ffmpeg 6.0（`/Applications/toonflow-data/ffmpeg/darwin-arm64/ffmpeg`）跑 4/9/16 三档 | 全部 exit 0 且出图 |

结论：命令与视频都没问题，失败发生在应用内的文件结算环节。

## 2. 单元测试

```
bun test packages/nodes/videoNode/src/inspectPlan.test.ts packages/nodes/videoNode/src/inspectVideo.test.ts
→ 31 pass / 0 fail / 100 expect() calls
```

新增 `isStaleOutput` 用例：

- 同类旧产物与上一轮残留临时文件 → 清；
- 本次正在写的临时文件 → 不清（回归用例，对应本次 bug）；
- 其它类型产物与无关文件 → 不动。

新增 `clearOutputs` / `settleOutput` 用例（假 WorkspaceFiles）：

- 清理保留本次临时文件，删掉旧宫格与残留临时文件；
- 宫格与单帧两类产物互不清；
- 结算成功时删旧目标并改名；
- **临时文件不存在时报帧数不足，且不删除上一轮可用产物**（评审 P1 回归）；
- 目录列表滞后但文件已写出时，读文件兜底、不误报。

## 3. 类型检查与构建

| 包 | 命令 | 结果 |
| --- | --- | --- |
| `@toonflow/node-video` | `bun run --filter '@toonflow/node-video' typecheck` | 通过（含新增测试文件） |
| `@toonflow/node-video` | `bun run --filter '@toonflow/node-video' build` | 通过 |
| `@toonflow/node-video-generation` | `bun run --filter '@toonflow/node-video-generation' build` | 通过（共用同一份查看代码） |

## 4. 部署核对

| 产物 | md5（构建 = 应用节点目录） |
| --- | --- |
| `videoNode.umd.js` | `5917bd3384b076a1ba1bcd80be0c9e32` |
| `videoGenerationNode.umd.js` | `e6ff1106102fd58ba12cf039fff0b680` |

部署位置：`/Applications/toonflow-data/nodes/`（运行中的应用实际从这里加载节点包）。部署前已把旧包备份到任务临时目录。**未重启应用。**

产物内核对的调用顺序（评审 P1 整改后）：`… hf(e,r), await yf(a,u,f,d), await _f(a,u,Vd,d)` —— 先结算改名，再清同类旧产物，清理的 `keep` 是刚落地的 target。

## 5. 静态核对

| 断言 | 证据 |
| --- | --- |
| 临时文件不再被误删 | `clearOutputs(files, directory, gridFilePattern, temporary)` / `frameFilePattern, temporary` |
| 结算不再依赖列表 | `settleOutput` 以 `rename` 结果为准，列表只用于错误分类 |
| 两类产物互不影响 | 清理按各自 pattern 匹配，临时文件规则共用但 `keep` 只保护本次文件 |
| 失败保留上一轮 | 清理仍在 ffmpeg 成功之后执行 |

## 6. 代码审查

子 Agent 复审（2026-11-02 09:20）：**修改后通过**。

| 级别 | 意见 | 处理 |
| --- | --- | --- |
| P1 | 清理在结算之前，会先删掉上一轮可用宫格；新图失败时旧图也没了 | 已修：改成先 `settleOutput` 后 `clearOutputs(pattern, keep = target)`，并补回归用例 |
| P2 | 列表判断存在性可能滞后/失败 | 已加 `files.read` 兜底；列表请求失败时不据此判失败 |
| P2 | 同一节点在两个画布实例时，清理队列不共享，可能互删临时文件 | 未改：需要跨实例锁；概率低，列入已知限制 |
| P2 | 注释「改名前后都必须确认」与实现不一致 | 已改 |
| P2 | 测试只覆盖纯函数，没覆盖接线 | 已补 `inspectVideo.test.ts` 5 例 |
| P2 | `baseName` 只处理 `/` | 已同时处理 `\\` |

## 7. 未覆盖项（需重启后人工确认）

1. 重启后在视频节点与生成视频节点分别调 `sampleFrames`，4/9/16 都能出宫格，`read` 能打开。
2. 先 `captureFrame` 再 `sampleFrames`，单帧仍在；反过来也一样。
3. 连续两次 `sampleFrames`，目录里只有一张最新宫格，没有 `.tmp.jpg` 残留。
