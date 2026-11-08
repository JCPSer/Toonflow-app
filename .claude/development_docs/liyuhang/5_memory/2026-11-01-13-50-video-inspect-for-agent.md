# 记忆：视频节点让 Agent 查看视频内容

- 时间：2026-11-01 13:50
- 类型：功能新增

## STAR

**Situation（背景）**
画布视频节点与视频生成节点只给 Agent 提供首帧/尾帧两路输出（`FRAME_OUTPUTS` 写死 first/last），Agent 只能凭两张静帧判断整段视频；系统提示本身还要求「静帧不代表看过完整视频」。内置 ffmpeg 工具虽能自己抓帧，但一次一个时间点、无引导、读图成本高；逐帧拉片节点面向分镜产出，太重。

**Task（任务）**
给两个视频节点的 Agent 增加按需「看视频」的能力：一次调用看全片（宫格），需要细节再按时间点截全分辨率单帧；产物不能无限堆积；不能影响现有首尾帧端口与逐帧拉片。

**Action（行动）**
- 在 `packages/nodes/videoNode` 新增 `inspectPlan.ts`（纯逻辑）+ `inspectVideo.ts`（执行器）+ `inspectVideoTool.ts`（两个节点工具），通过 `@toonflow/node-video` 子路径导出，视频生成节点直接复用。
- `sampleFrames(count∈{4,9,16})`：ffprobe 取时长与显示尺寸（含旋转标记），单条 ffmpeg 命令用 `fps=(count+1)/时长` + `scale` + `pad` + `tile` 出宫格；不 seek（fps 自身把首帧放在半格处）；
- `captureFrame(seconds[1..6])`：逐点 `-ss` 截全分辨率 JPEG，单点失败进 `failures` 不影响其他点。
- 产物统一写 `assets/<nodeId>/inspect/`；成功出图后才按前缀清同类旧产物（`contact-*` / `frame-*ms` / `*.tmp.jpg`），先写唯一临时名再 rename，失败清临时文件。
- 节点 `onScopeDispose` 注销并删除目录；关窗/⌘Q 时工作区 `setQuitFlush` 通过 `Symbol.for("toonflow.videoInspectCleanups")` 共享登记表把清理作为第四个并行任务，800ms 上限、异常吞掉。
- 生成中（生成节点）/上传导出中（视频节点）/无视频时直接拒绝。

**Result（结果）**
23 个单测通过，三个包类型检查通过（仅既有 `@/agentRuntime` 报错）；宿主 ffmpeg 用合成视频实测：9 格 1536×864、16 格 2048×1152、竖屏/旋转按 864×1536 出图、0.4s 短视频正常出图、单帧时间戳精确到请求值。实测发现并修正两处：`count/时长` 会少出一帧（黑格），奇数格高在 yuv420p 下补边失败。

子 Agent 复审后（无 P1）又整改：抽帧执行器抽到 `ffmpegTask.ts` 并修正「超时被 kill 的 AbortError 盖成已取消」（`frameOutput.ts`、`videoPlayer.vue` 一并改用）；视频中途替换改为报错；截帧加 90s 总预算并返回 `truncated`；同节点查看串行排队；临时文件纳入清理；probe 成功后才建目录；按 ffprobe 序号选流避开封面图；时间点先归一后校验；常量改小驼峰；清理改为首次查看才登记并按目录引用计数。

第二轮设计评审又补：时长取「视频流与容器较小值」防止音轨长尾拼不出图；滤镜补 `setsar=1`；视频变化（含重新打开项目）时 `clear()` 清旧产物；清理从通用 `quitGuard` 移回工作区 `setQuitFlush` 的第四个并行任务；工具描述注明重复调用会让旧路径失效；`未生成文件` 错误补「时长或帧数不足」。

已构建并同步 web（入口 `index-BJRmX70r.js`、工作区 `workspace-C542gZNR.js`）与两个节点 UMD 到安装目录，未重启应用。

**单格尺寸调优**：单格长边由 400 提到 512（9 帧 1536×864 / 4×4 2048×1152 / 2×2 1024×576）。上限依据是模型视觉长边（Claude 约 1568），再大只会被二次缩放；`read` 的 2048 px 与 1 MiB 限制仍满足。

**告知 Agent 的分层取舍**：系统提示保持通用（不提任何具体节点函数，首尾帧也没进），只保留「静帧不代表看过完整视频」的要求；具体用法写进画布技能——`packages/skills/canvas/SKILL.md` 的「调用节点函数」点名 `sampleFrames`/`captureFrame` 且必须 `read` 打开，`videoProduction.md` 补「先 getNodeTools 确认」。两份技能文件已同步到 `data/skills/` 与 `/Applications/toonflow-data/skills/`。

## 关键经验

1. ffmpeg `fps` 滤镜的采样点落在半格处，输入 seek 会再偏移半格——想「不贴开头」直接不 seek。
2. `fps = count / duration` 在整除或时间戳取整时会少出一帧，导致 `tile` 拼不出图；取 `(count + 1) / 时长` 更稳。
3. 补边（`pad`）在 yuv420p 协商下不接受奇数尺寸；单格长边 400、短边偶数最省事。
4. 竖屏视频按 16:9 出格会只剩中间一条，单格比例必须跟随视频比例。
5. 节点是独立 UMD 包，跨包共享清理函数只能走 `globalThis` + `Symbol.for`（与 nodeBusy/runningNodes 同一套路）。
