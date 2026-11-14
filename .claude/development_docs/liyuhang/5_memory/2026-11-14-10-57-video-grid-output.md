# 记忆：视频节点宫格输出端口与 Agent 宫格开关

- 时间：2026-11-14 10:57
- 类型：功能（节点输出 / 插件配置）

## STAR

**Situation（背景）**
视频节点只能把首帧、尾帧作为 IMAGE 端口接给下游。做连续镜头时，下游只有一张静帧，拿不到上一段视频的整体场景与人物状态，生成下一段容易场景不一致。节点里的「查看视频」宫格写在 `inspect/`、随视频变化与卸载被清理，明确不是节点输出，不能接线。同时用户反馈 Agent 读宫格联系表的准确度不稳定，希望能在插件层面整体关掉这个查看工具。

**Task（任务）**
1. 两个视频节点新增「宫格输出」IMAGE 端口：固定 2×2、不叠字、采样与查看宫格一致、可手动或 Agent 开启、视频变化自动重抽、关闭断线计数。
2. 插件配置增加全局开关，控制 Agent 的 `sampleFrames` 是否注册；默认关闭；保存即生效；不影响 `captureFrame` 与端口。

**Action（行动）**
- `frameOutputPlan` 的 `FrameKey` 增加 `grid`，`FRAME_OUTPUTS` 追加 `gridFrame / frame-grid.jpg`；`frameOutputOptions` 收窄为 `Exclude<FrameKey,"grid">`。
- 新增 `jpegOptions.ts` 作为 JPEG 参数唯一来源；新增 `videoGrid.ts` 提供 `probeVideo`/`probeVideoMeta`/`gridOutputOptions`，inspect 与端口共用探测与滤镜，临时文件与清理仍各自负责。
- `useFrameOutputs` 的四组 Record 全部由 `FRAME_OUTPUTS` 生成；错误汇总改为遍历三路（修复宫格错误静默丢失）；`extract` 增加 grid 分支（45s 超时），提交抽成 `commitTemporary`（存在性 + 两段代次/abort 校验）。
- 开启宫格与视频变化的竞态：`pendingEnables` 记录未落盘的开启意图，`refresh()` 在 `clear()` 前落盘，`apply` 的 abort 分支按 pending 返回。
- `nodeTools.register` 增加可选 `{ nodeId, flow }`：作用域外不能调 `useNodeId()/useVueFlow()`（后者会新建存储），由调用方传入；无活跃作用域时不自动回收。两个节点 watch 插件配置动态注册/注销 `sampleFrames`。
- `createVideoInspect` 增加 `cancelSamples()`，关开关时立即中止在途宫格。
- 删除节点只 `frames.cancel()`（abortAll），不 `clear()`，避免删除失败或撤销丢输出值。

**Result（结果）**
56 项单测通过（新增工具层与命令拼装用例），三个包 typecheck 通过，两个 UMD 重建并备份同步；元数据已带 `agentGridInspect=false`。需重启应用生效。

## 关键经验

1. **新增端口键时，所有按 key 派生的记录都要从端口表生成**。类型能挡住字面量，但挡不住「汇总/清理/收尾」里的手写 `first/last`——这正是本次唯一的 P0。
2. **慢操作会放大竞态**：宫格抽取几十秒，把「开启未落盘 × 视频变化」从理论变成常见。任何「先做后写」的状态机，都要考虑中途被整体重抽接管时意图怎么保留。
3. **工具注册没有响应式**：`nodeTools.register` 只能在 setup 内完成；要动态开关，必须显式传 `nodeId` 与 `flow`，并自己注销（作用域外 `useVueFlow()` 会新建一份存储，注册到错误的表）。
4. **输出产物与查看产物必须目录隔离**：`inspect/` 有卸载/换视频清理，端口文件放进去会被误删；反过来，端口文件固定命名也让复制节点共享同一路径。
5. **ffmpeg `fps+tile` 对短视频是重复补帧，不是失败**；不要用「未生成文件」猜测短视频，实测 1 帧视频也能正常出四格。
6. 宫格缩略图比例随视频（竖屏 576×1024），必须 `contain`；`cover` 会把四格裁成中间一条。
