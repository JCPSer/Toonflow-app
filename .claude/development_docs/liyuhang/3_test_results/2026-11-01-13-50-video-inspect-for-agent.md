# 测试结果：视频节点让 Agent 查看视频内容

- 时间：2026-11-01 14:05
- 对应方案：`2_requirements_solutions/2026-11-01-13-50-video-inspect-for-agent.md`
- 结论：通过（宿主 ffmpeg 行为已用真实命令验证；未重启应用，需用户自行重启后生效）

## 1. 单元测试

命令：`bun test packages/nodes/videoNode/src/inspectPlan.test.ts`

```
23 pass / 0 fail / 84 expect() calls
```

覆盖：宫格档位与行列、采样时间点、输出帧率余量、滤镜链（fps/scale/pad/tile）、旋转后显示尺寸、单格比例与偶数边、文件名与清理规则（含临时文件）、时间点去重排序/越界/超量与四舍五入越界、ffprobe 结果解析（旋转、封面图过滤、时长回退）、流选择序号。

## 2. 类型检查

| 包 | 命令 | 结果 |
| --- | --- | --- |
| `packages/nodes/videoNode` | `bun run typecheck` | 通过 |
| `packages/nodes/videoGenerationNode` | `bun run typecheck` | 通过 |
| `apps/web` | `bun run typecheck` | 仅既有报错 `apps/server/src/modules/agentAccess/singleAgent/types.ts(2,33) TS2307 Cannot find module '@/agentRuntime'` |

## 3. 宿主 FFmpeg 行为验证（真实命令，非模拟）

用 `testsrc2` 生成合成视频后，按实现里拼出的参数直接跑宿主 ffmpeg（`/Applications/toonflow-data/ffmpeg/darwin-arm64/ffmpeg`）。

| 用例 | 输入 | 参数 | 结果 |
| --- | --- | --- | --- |
| 9 宫格（横屏） | 10s 640×360 | `fps=1.000000`、单格 512×288、`tile=3x3` | 1536×864（约 290 KB），9 格时间点 0.5/1.5/…/8.5s，画面与时间戳对应 |
| 16 宫格 | 10s 640×360 | `fps=1.700000`、`tile=4x4` | 2048×1152（约 503 KB），正好 `read` 的上限，正常出图 |
| 竖屏 9 宫格 | 6s 360×640 | 单格 288×512、`tile=3x3` | 864×1536，画面铺满格子不再只剩一条 |
| 旋转标记视频 | 640×360 + side_data rotation=90 | 单格 288×512 | 864×1536，ffmpeg 自动旋转后仍按竖屏出图 |
| 超短视频 | 0.4s 320×240 | 9 格 | 正常出图（重复帧），不会拼不出 |
| 单帧截取 | 10s 640×360 | `-ss 3.200 -frames:v 1` | 帧时间戳 3.200，与请求一致 |

**实测发现并已修正的两点**（单元测试之外的宿主行为）：

1. `fps = count / duration` 且做输入 seek 时只产出 8 帧（seek 后剩余时长乘以帧率向下取整），宫格出现黑格。改为**不 seek**（fps 自身把首帧放在半格处）+ 帧率取 `(count + 1) / duration`，多出的一帧由 `tile` 丢弃。
2. 单格高度取奇数（225）时，补边滤镜在 yuv420p 协商下报 `Padded dimensions cannot be smaller than input dimensions`；改为偶数并把长边固定、短边按视频比例计算。

3. 单格长边由 400 提到 512（默认 9 帧 1200×672 → 1536×864，约 290 KB；4×4 2048×1152，约 503 KB）。依据是模型侧视觉上限：Claude 系约 1568 长边，再大只会被二次缩放、白花 token；`read` 的 2048 px / 1 MiB 上限仍然满足。

## 4. 构建与部署核对

| 产物 | 路径 | md5 | 核对 |
| --- | --- | --- | --- |
| web 入口 | `assets/index-BJRmX70r.js` | `fc06b72edd5f8fbb722db33a021bbb2d` | 构建与安装目录一致，含 `toonflow.videoInspectCleanups` |
| web 工作区包 | `assets/workspace-C542gZNR.js` | `e0f51d47ed1b5733ea0cae7f936c7a78` | 构建与安装目录一致 |
| web 工作区包（另一分块） | `assets/workspace-CWd-p-U6.js` | `5c2c9f3e7e7c5a2d6e67f9c470d66b6b` | 构建与安装目录一致 |
| `index.html` | — | `2dee0ddf6e328bf88dac38beee65ae6b` | 引用的入口 chunk 与实际一致 |
| 视频节点 | `data/nodes/videoNode.umd.js` | `2e099311d67525268c005fb818a41155` | 构建与安装目录一致 |
| 视频生成节点 | `data/nodes/videoGenerationNode.umd.js` | `b3c341b4b89f5daad277bbd1323557a0` | 构建与安装目录一致 |

安装目录：`/Applications/toonflow-exec.app/Contents/Resources/app/views/mainview/`（web）、`/Applications/toonflow-data/nodes/`（节点）。**未重启应用**，改动在用户自行重启后生效。

另外在技能源文件补了两处说明（系统提示保持通用、不点名具体节点函数，与首尾帧的做法一致）：
- `packages/skills/canvas/SKILL.md`「调用节点函数」：点名 `node:sampleFrames` / `node:captureFrame`、必须用 `read` 打开，首尾帧不等于看过整段视频；
- `packages/skills/canvas/references/videoProduction.md`：先 `getNodeTools` 确认查看函数，再按宫格/单帧使用。

两处均已同步到 `data/skills/` 与 `/Applications/toonflow-data/skills/`（三份 `diff` 一致；技能目录只在首次初始化时同步，之后不会被覆盖）。

## 5. 静态链路核对

- 两个节点都注册了 `sampleFrames` / `captureFrame`，工具名不与其他节点函数冲突；`getNodeTools` 返回的 schema 只允许 `count ∈ {4,9,16}`、`seconds` 1–6 项。
- 工具执行路径：画布 `nodeTools` → 节点 `execute` → `createVideoInspect` → 宿主 ffmpeg；返回 JSON 里带工作区相对路径与 `note`，Agent 需再 `read` 才看得到画面。
- 拒绝路径：无视频 / 视频生成中（生成节点）/ 上传或导出中（视频节点）都返回可读错误，且不创建空的 `inspect/` 目录（`prepare` 先取视频再建目录）。
- 清理路径：
  - 调用前按前缀清同类产物（`contact-*.jpg` / `frame-*ms.jpg`），两类互不影响；
  - 节点 `onScopeDispose` 注销登记并删除 `assets/<nodeId>/inspect/`；
  - 关窗/⌘Q：`quitGuard` 在落盘同时调用 `cleanupVideoInspectFiles()`，上限 800ms、异常吞掉，不改变 `flush-done` 回执时序。

## 5.1 代码审查整改（子 Agent 复审后）

审查未发现 P1；P2/P3 已按证据整改：

| 问题 | 整改 |
| --- | --- |
| 超时原因被宿主 kill 返回的 AbortError 覆盖，Agent 永远看不到「抽帧超时」 | 新增 `ffmpegTask.ts`，先记录超时/取消原因，`end` 与 `error` 都以它为准；`frameOutput.ts`、`videoPlayer.vue` 两处旧实现一并改用 |
| 抽帧途中视频被替换仍返回旧帧 | 每条命令完成后、返回前比对 `source.getVideo()?.path`，不一致抛「视频已更换或已清空，请重新查看」；`captureFrame` 返回值补 `source` |
| 6 个时间点最坏 6×25s 逼近节点函数 120s 闸门 | 一次调用总预算 90s，单点超时取 `min(25s, 剩余预算)`；预算耗尽返回 `truncated=true` 与已成功的帧 |
| 并发查看互相删图 / rename 竞争 | 同一节点的两次查看串行排队 |
| 取消时临时文件残留 | 临时文件命名带 `.tmp.jpg`，所有同类清理都命中该后缀；取消分支先删临时文件再抛错 |
| probe 失败留下空 `inspect/` 目录 | 目录改到 probe 成功后再创建 |
| 封面图抢占 `0:v:0` | 按 ffprobe 的流序号 `-map 0:<index>`，序号缺失时退到 `0:V:0` |
| 9.999 四舍五入成 10.00 后越界却先放行 | 先归一到百分秒再校验 |
| 全大写常量违反 AGENTS.md | 新代码常量统一改为小驼峰 |
| 关键路径缺测试 | `readVideoMeta`/`streamRotation`/临时文件名/流选择移入 `inspectPlan` 并补单测（15→22） |
| 清理登记过早、同 nodeId 跨画布实例互相删 | 首次真正查看时才登记；按目录引用计数，最后一个实例卸载才删除 |
| 宫格描述「全片」与末段不采样不符 | 工具描述与返回 `note` 明确「不含片尾最后一小段，需要时用 captureFrame」 |
| 时长优先取容器时长，音轨更长时采样越过画面末帧、拼不出图 | 改取「视频流时长与容器时长的较小值」，两者都没有才报错；`未生成文件` 错误补上「视频时长或可用帧数不足」 |
| 非方形像素素材拼格后比例偏 | 滤镜链 `scale` 后加 `setsar=1` |
| 替换视频/打开项目后旧查看产物仍可被 `read` | 节点 `watch` 视频地址（`immediate`）触发 `clear()`，清掉上一次的宫格与单帧 |
| 清理逻辑硬塞进通用关闭闸门，分层倒置 | 从 `quitGuard` 抽回，改由工作区 `setQuitFlush` 作为第四个并行任务（保持 800ms 上限、异常吞掉） |
| 重复调用使旧路径失效但未提示 | 两个工具的描述与返回 `note` 都写明「再次调用会覆盖上一批产物，旧 path 失效」 |

## 6. 已知限制

- 宫格最后一个采样点在 `(count-0.5)/(count+1)` 处（9 格 85%、16 格 91%、4 格 70%），片尾最后一小段由 `captureFrame` 补看；工具描述与返回 `note` 已写明。
- 时间点按 `fps` 采样对齐，返回的 `frameTimes` 是近似值（误差 ≤ 一个采样间隔）。
- 「秒级完成」只对常规分辨率/时长成立：4K HEVC 这类素材在 CPU 上解码可能超过单条 25 秒上限，会返回超时错误，可重试或改用 `captureFrame` 局部查看。
- 未改系统提示词，Agent 需要先 `getNodeTools` 才会发现这两个工具（工具描述已写明用途与「必须 read」）。

## 7. 未覆盖项（需重启后人工确认）

- 在画布内由 Agent 实际调用两个工具并 `read` 打开的端到端表现。
- 关窗时 `inspect/` 是否被删除（依赖应用内运行，未在本次静态部署中触发）。
