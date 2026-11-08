# 需求方案：视频节点让 Agent 查看视频内容

- 时间：2026-11-01 13:50
- 对应需求：`1_requirements_matrix/2026-11-01-13-50-video-inspect-for-agent.md`
- 状态：待评审

## 1. 方案总览

在 `@toonflow/node-video` 包内新增一套「视频查看」能力，导出给视频节点与视频生成节点各注册两个 Agent 工具：

- `sampleFrames`：均匀抽 4/9/16 帧（默认 9）拼成一张宫格 JPEG，返回路径与时间点数组。
- `captureFrame`：按 1–6 个时间点各抽一张全分辨率 JPEG。

抽帧沿用节点现有链路：节点注入的 `ffmpeg`（浏览器侧 fluent API → 宿主 FFmpeg）与 `files`（工作区文件 API），不引入新的执行通道、不改服务端。

产物写入 `assets/<nodeId>/inspect/`，与节点素材同目录，删除节点/替换视频时随 `removeNodeFiles` 一起清掉。清理在三个时机发生：每次调用前清同类旧产物、节点卸载时清目录、关窗/⌘Q 时集中清一次。

## 2. 涉及文件

| 文件 | 变更 |
| --- | --- |
| `packages/nodes/videoNode/src/inspectPlan.ts` | 新增：纯逻辑（参数校验、时间点、宫格排布、文件名、ffmpeg 参数） |
| `packages/nodes/videoNode/src/inspectPlan.test.ts` | 新增：纯逻辑单测 |
| `packages/nodes/videoNode/src/inspectVideo.ts` | 新增：抽帧执行器（probe、清旧产物、写临时文件再改名、超时与取消） |
| `packages/nodes/videoNode/src/inspectVideoTool.ts` | 新增：两个工具定义（名称、描述、参数 schema、返回结构） |
| `packages/nodes/videoNode/package.json` | 新增导出 `./inspectPlan`、`./inspectVideo`、`./inspectVideoTool` |
| `packages/nodes/videoNode/src/index.vue` | 注册两个工具；首次查看时才登记清理；视频变化时清旧产物 |
| `packages/nodes/videoGenerationNode/src/index.vue` | 同上，并加「生成中拒绝」判定 |
| `apps/web/src/lib/videoInspectFiles.ts` | 新增：读共享登记表并集中清理（节点经 `Symbol.for("toonflow.videoInspectCleanups")` 登记，二者不能直接 import） |
| `packages/nodes/videoNode/src/ffmpegTask.ts` | 新增：抽帧命令统一执行器（超时原因不被 kill 改写、2s 收尾宽限），首尾帧、播放器截帧与查看共用 |
| `apps/web/src/pages/workspace/index.vue` | 关窗 flush 增加第四个并行任务：集中清理查看产物（与保存互不阻塞） |
| `packages/skills/canvas/references/videoProduction.md` | 补一条查看视频的用法，避免 Agent 沿用首尾帧下结论 |
| `packages/skills/canvas/SKILL.md` | 在「调用节点函数」里点名 `sampleFrames`/`captureFrame` 与「必须 read 打开」，系统提示保持通用不点名函数 |

## 3. 工具设计

### 3.1 `sampleFrames`

参数（严格对象，全部可选）：

- `count`：4 | 9 | 16，默认 9。分别对应 2×2、3×3、4×4 宫格。

返回：

```
{
  path: "assets/<nodeId>/inspect/contact-9.jpg",
  count, columns, rows,
  frameTimes: [0.83, 2.5, ...],   // 每格近似时间点（秒，两位小数）
  duration, width, height,
  source: "assets/<nodeId>/xxx.mp4",
  note: "需用 read 工具打开该路径查看"
}
```

### 3.2 `captureFrame`

参数：

- `seconds`：number[]，1–6 个，允许小数，按升序去重后执行；越界（<0 或 ≥时长）报错。

返回：

```
{
  frames: [{ seconds: 3.2, path: "assets/<nodeId>/inspect/frame-3200ms.jpg" }],
  failures: [{ seconds: 7.5, error: "抽帧超时…" }],   // 单点失败不影响其他点
  truncated: false,                                   // true = 预算用完，还有时间点没截
  duration, source, note
}
```

### 3.3 公共约定

- 工具描述里明确：**返回的是工作区相对路径，必须用 `read` 打开图片**；并提示先看宫格、需要细节再截单帧。
- 无视频：`该节点还没有视频，无法查看`。
- 生成中（视频生成节点）：`视频正在生成，请等生成结束再查看`。
- 视频节点上传/导出中：`视频处理中，请稍后重试`。
- 取不到时长或没有视频流：返回可读错误，不落空目录。

## 4. 实现要点

### 4.1 宫格抽帧

```
probe(source) → duration, width, height
count = 参数或 9
cell = 长边 512，短边按视频比例取偶数（横屏 512×288，竖屏 288×512）
滤镜链 = fps((count + 1) / duration)
        , scale(cell, 等比缩小)
        , pad(cell, 居中, 黑底)
        , tile(columns x rows)
输出 = 1 帧 JPEG(q2, yuvj444p, -map 0:v:0, -update 1)
```

- 实测 ffmpeg 的 `fps` 滤镜把首个输出帧放在半个间隔处（0.5 / fps），因此格 i 对应原片 `(i + 0.5) × 时长 / (count + 1)`；不做输入 seek——seek 会再偏移半格，实测会漏掉开头或错位。
- 帧率取 `(count + 1) / 时长` 而不是 `count / 时长`：多采一帧由 `tile` 丢弃，避免整除或时间戳取整时只出 count−1 帧导致拼图失败（实测 `count / 时长` 会出现 8 帧）。
- 单格尺寸跟随视频比例：竖屏视频塞进 16:9 格子后画面只剩中间一条，必须按比例缩短边；短边取偶数是因为补边滤镜在 yuv420p 下不接受奇数尺寸。
- 单格长边取 512：默认 9 帧 1536×864（约 290 KB）、4×4 2048×1152（约 503 KB）、2×2 1024×576。这是「不被模型二次缩放」的上限——Claude 系视觉长边约 1568，再大只增加 token；同时仍在 `read` 的 2048 px / 1 MiB 以内。
- 最后一个采样点在 `(count − 0.5) / (count + 1)` 处（9 格 85%、16 格 91%、4 格 70%），片尾最后一小段交给 `captureFrame`，工具描述与 `note` 都要写明这一点。
- 用 `fps` 而非场景检测：不依赖解码全片与阈值调参，几十秒的视频也在秒级完成。
- 时长取「选中视频流时长」与「容器时长」的较小值：音轨比画面长时，容器时长会让采样越过画面末帧、`tile` 拼不出图；两者都没有才报错。
- `scale` 后接 `setsar=1`：非方形像素素材拼格后比例不会偏。
- 时间点契约：秒数先归一到百分秒再校验越界，文件名按毫秒；重复时间点去重后执行，不报错（越界与超过 6 个才报错）。

### 4.2 单帧截取

```
对每个 seconds：
  ffmpeg(source).noAudio().inputOptions("-ss", 秒)
    .outputOptions(JPEG 质量参数, -frames:v 1, -map 0:v:0, -update 1, -y)
    .output(临时名)
  成功后 rename 成 frame-<毫秒>ms.jpg
```

- 逐点串行执行，任一点失败只报该点错误，其余点照常返回（与 `setFrameOutputs` 的「单项失败不阻断整体」一致）。

### 4.3 落盘与原子性

- 先写 `*.tmp.jpg` 唯一临时名，校验文件确实出现后再 `rename` 到目标名（宿主 `rename` 不覆盖，先删旧目标）。
- `-y` 只是让 ffmpeg 覆盖临时文件，避免临时名冲突时失败。
- 任何失败都清掉临时文件，不把半截图留给 Agent。

### 4.4 清理

```
inspect 目录 = assets/<nodeId>/inspect

sampleFrames 出图成功后：删除同目录旧 contact-*.jpg 与 *.tmp.jpg，再 rename 成本次文件
captureFrame 第一张出图成功后：删除旧 frame-*.jpg 与 *.tmp.jpg
```

ACT: 清理放在成功之后——失败或取消的调用不能把上一轮可用结果删掉。

- 同一节点稳态最多 1 张宫格 + 6 张单帧（约 3–4 MB），会话内反复查看不会累积；临时文件（`.tmp.jpg`）也落在同一清理规则里，取消或崩溃不会留下半截图。
- 首次真正查看时才把清理函数登记到共享表；没看过的节点不会在关窗时发起无意义的删除请求。
- 登记按目录引用计数：同一 `nodeId` 同时挂在两块画布时，只有最后一个实例卸载才删目录。
- 节点卸载（退出项目、切换画布、关闭面板）时释放登记，最后一个持有者删除整个 `inspect/`。
- 关窗/⌘Q：由工作区页面的 `setQuitFlush` 把清理作为**第四个并行任务**（与文档/画布保存、会话落盘、上次画布指针并列），内部最多等 0.8 秒、异常全部吞掉；通用的 `quitGuard` 不掺业务逻辑。清理是「尽力而为」，超时或失败不影响关闭。
- 视频被替换、生成完成或重新打开项目时，节点的 `watch`（`immediate`）触发 `clear()`，旧产物不会留在上下文路径里。
- 目录删除复用现有工作区文件 API，不新增服务端路由。

### 4.5 并发、预算与超时

- 同一节点的两次查看串行排队：并发时「清理旧产物」与「rename 到同名目标」会互相踩。
- 抽帧命令统一走 `ffmpegTask.ts` 的执行器：kill 后先记下超时/取消原因，`end`/`error` 都以它为准，保证 Agent 拿到的是「超时」而不是被 kill 改写成的「已取消」。
- `captureFrame` 一次调用总预算 90 秒，单点超时取 `min(25s, 剩余预算)`；预算耗尽返回 `truncated=true` 和已成功的帧，避免撞上节点函数 120 秒的调用闸门后整批丢失。
- 每条命令完成后比对当前视频路径，视频被替换或清空时整次查看报错，不把旧画面当新结果返回。
- 流选择按 ffprobe 的流序号 `-map 0:<index>`，避免 `0:v:0` 把封面图（attached_pic）当成视频。

### 4.6 与现有能力的关系

- 不改 `setFrameOutputs` 与首尾帧端口：那是给下游节点连线的数据出口，本次只是「查看」。
- 不替代逐帧拉片节点：拉片面向分镜产出（场景切分 + 结果节点 + 可选 AI 标注），本次是 Agent 低频查看。
- 视频生成节点生成期间直接拒绝，避免 Agent 描述上一版画面。

### 4.7 UI

本次不新增节点内 UI：工具只对 Agent 暴露，人工查看继续用现有播放器与截帧菜单。因此无界面稿。

## 5. 测试方案

1. 单测 `inspectPlan.test.ts`：宫格行列映射（4/9/16）、时间点计算与取整、时间点去重排序与越界校验、文件名生成、ffmpeg 参数包含 `fps`/`tile`/`pad`。
2. 类型检查：两个节点包 `vue-tsc --noEmit`。
3. 构建：两个节点包 UMD 构建并同步到应用；截图产物人工抽查（可选）。
4. 静态链路核对：工具注册 → 画布 `nodeTools` → Agent 调用 → 返回值结构；清理登记表在卸载与关窗两条路径都被调用。
5. 回归：首尾帧端口、逐帧拉片节点不受影响。

## 6. 风险与对策

| 风险 | 对策 |
| --- | --- |
| 宿主缺 FFmpeg 或解码失败 | 沿用节点现有 `silentRequired` 探测，直接报错并清理临时文件 |
| 视频无时长元数据（流式容器） | 明确报错「无法读取视频时长」，不猜时间点 |
| 超长视频抽帧耗时 | 单条命令 25 秒超时、截帧整次 90 秒预算；失败即返回可读错误并把已成功的帧交回 Agent，不卡住调用 |
| 并发查看互相删文件 | 同类产物覆盖式命名，单次调用内串行；清理只针对同类前缀 |
| 清理拖慢关窗 | 集中清理最多等 1 秒且吞掉异常，flush-done 照常回执 |
| 产物被 Agent 误读为节点输出 | 工具描述与返回 `note` 都强调「仅用于查看，不是节点输出」 |

## 7. 评审意见

（待填写）

## 8. 版本记录

| 版本 | 时间 | 说明 |
| --- | --- | --- |
| v1 | 2026-11-01 13:50 | 初稿 |
