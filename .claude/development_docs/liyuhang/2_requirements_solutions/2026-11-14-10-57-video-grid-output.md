# 需求方案：视频节点宫格图输出端口

- 时间：2026-11-14 10:57
- 对应需求矩阵：`.claude/development_docs/liyuhang/1_requirements_matrix/2026-11-14-10-57-video-grid-output.md`
- 状态：待评审

## 1. 现状与约束

`useFrameOutputs`（`frameOutput.ts`）是首/尾帧端口的唯一实现，两个视频节点共用；键类型 `FrameKey = "first" | "last"` 在多处按字面量硬编码（`errors`、`controllers`、`epochs`、`queuedRounds`）。宫格图不是「抽一帧」，需要先 ffprobe 拿时长与画面尺寸，再用 `fps+scale+pad+tile` 一次性拼图——这套逻辑已在 `inspectPlan.ts`（纯函数）与 `inspectVideo.ts`（执行）里存在。

约束：

- 宫格文件**不能**落在 `inspect/`：`videoInspect.clear()` 在视频变化与节点卸载时会整目录删除，放在那里会导致端口值指向已删除的文件。
- 采样口径必须与「查看视频」宫格一致（4 格取 10%/30%/50%/70%），否则同一视频在两处看到的画面不同。
- 端口 handleId 一旦发布不能改，画布 JSON 与已连线都以它为键。

## 2. 结构

```text
jpegOptions.ts       新增：JPEG 输出参数唯一来源（首/尾帧、宫格、查看宫格共用）
frameOutputPlan.ts   FrameKey 增加 "grid"；FRAME_OUTPUTS 增加宫格项（gridFrame / frame-grid.jpg）
videoGrid.ts         新增：probeVideo / probeVideoMeta / gridOutputOptions（inspect 与端口共用）
frameOutput.ts       三路状态机（按 FRAME_OUTPUTS 生成记录）；extract 分支：grid 走 probe+tile
frameOutputTool.ts   setFrameOutputs 增加 grid 参数与描述
frameOutputMenu.vue  菜单按 FRAME_OUTPUTS 自动多一行；宫格缩略图改 contain
inspectVideo.ts      改为复用 videoGrid.ts 与 jpegOptions，删除本地 probe 与命令拼装
nodeScaffold         nodeTools.register 支持可选 nodeId（作用域外动态注册），旧调用不变
两个视频节点         configRules 增加 agentGridInspect；watch 配置动态注册/注销 sampleFrames
```

seam 划分（评审 P1-2）：

- `videoGrid.ts` 只负责「探测 + 拼命令」：`probeVideo` 返回原始 `FfprobeData`，`probeVideoMeta` 返回 `readVideoMeta` 的 `{duration,width,height,index}`，`gridOutputOptions(meta, count)` 返回 `-vf fps,scale,pad,tile` 等输出参数。
- 临时文件名、存在性校验、rename、旧产物清理、`ensureSameVideo` 仍由调用方负责：inspect 保留自己的 `settleOutput`/`clearOutputs`；端口沿用 `extract()` 的 epoch 三段校验。**不把 inspect 的 `settleOutput` 搬到端口**（它没有代次校验）。

## 3. 端口与文件

```text
FRAME_OUTPUTS 追加（顺序在尾帧之后）：
  { key: "grid", handleId: "gridFrame", fileName: "frame-grid.jpg", label: "宫格" }
输出值：{ dataType: "IMAGE", value: { url: "assets/<nodeId>/frame-grid.jpg", mimeType: "image/jpeg" } }
```

- 与 `frame-first.jpg` / `frame-last.jpg` 同级，复制节点、分享包、跨项目搬运沿用 outputs 现有的处理。
- 固定文件名 + 临时名再 rename，沿用 `extract()` 的写法：先写 `<name>.<uuid>.tmp.jpg` → 校验存在 → 删旧 → rename。

## 4. 抽帧流程（grid 分支）

```text
extract("grid", sourcePath, signal, token):
  directory = ensureNodeDirectory(files, nodeId)
  temporary = <directory>/frame-grid.jpg.<uuid>.tmp.jpg
  factory   = await createFfmpeg(signal, { silentRequired: true })
  meta      = readVideoMeta(await probeVideo(factory, sourcePath, signal))
             // 时长取视频流与容器较小值；旋转按实际画面交换宽高
  cell      = gridCell(meta.width, meta.height)          // 长边 512，偶数边
  filter    = gridFilter(meta.duration, 4, cell)         // fps=(4+1)/d, scale→pad→tile=2x2
  task      = factory(sourcePath).noAudio()
                .outputOptions(...gridOutputOptions(meta, 4))
                .output(temporary)
  await runFfmpeg(task, signal)                          // 宫格 45s 超时（全片解码），可取消
  校验：signal 未中断 → 临时文件存在 → 代次仍有效
  remove(target) → 再校验信号与代次 → rename(temporary, target)
  失败：删除临时文件，抛可读错误
```

**代次校验必须三段齐全（评审 P1-1）**：run 后、remove 前、remove 后各一次；`remove` 与 `rename` 之间还隔着 await，过期任务若在这时删掉新任务刚写好的文件，下游会拿到上一版视频的宫格。首/尾帧与宫格共用同一个提交 helper：

```text
commitTemporary(files, temporary, target, isValid, label):
  if (!exists(temporary)) throw `${label}抽取失败：未生成文件`
  if (!isValid()) throw "抽帧已过期"
  await files.remove(target)  // 工作区 rename 不覆盖，必须先删
  if (!isValid()) throw "抽帧已过期"
  await files.rename(temporary, target)
```

`probeVideo` 与「查看视频」的时限保持一致（15s），错误文案沿用「读取视频信息超时」。

## 5. 状态机改造

现有代码把三组 Record 写死成 `{ first, last }`；新增键后类型会直接报错，但**有三处语义是静默硬编码的（评审 P0-1）**：

- `setFrameError` 汇总只拼 `errors.first` / `errors.last` → 宫格单独失败时 `error.value` 为 `undefined`，菜单常驻错误行不显示；
- `clear()` 只清两个键 → 切视频后宫格旧错误残留，`state("grid")` 返回过期 error；
- `runJob` 收尾用 `!errors.first && !errors.last` → 宫格有错误时仍会把汇总清空。

改法：四组 Record 全部由 `FRAME_OUTPUTS` 生成，并抽两个小函数：

```text
errors       = Object.fromEntries(FRAME_OUTPUTS.map(k => [k.key, undefined]))
controllers  = Record<FrameKey, AbortController | undefined>
epochs       = Object.fromEntries(FRAME_OUTPUTS.map(k => [k.key, 0]))
queuedRounds = Record<FrameKey, number | undefined>

summarizeFrameErrors()  // FRAME_OUTPUTS 里的非空错误 join("；")
clearFrameErrors()      // 全键置空并清 error.value
```

`clear()`、`setFrameError`、`runJob` 收尾全部改为遍历 `FRAME_OUTPUTS`；注释里的「两路都失败」同步改为「多路」。其余逻辑（beginOp/endOp、refresh 串行队列、apply 的开启/关闭/重试、FrameSupersededError）本身按 key 泛化，宫格自然获得「开启即抽、视频变化自动重抽、失败按路报错、关闭断线计数、busy/loading」。

`frameOutputOptions(key)` 只服务首/尾帧，签名收窄为 `Exclude<FrameKey, "grid">`。

## 6. 工具

```text
setFrameOutputs({ grid?: boolean })
```

- 未传时返回当前状态（enabled/handleId/path/pending/pendingReason/error）。
- 描述逐句改写（评审 P1-3）：开头改为「首帧/尾帧/宫格输出端口」；补「宫格是 2×2 四格联系表，按 10%/30%/50%/70% 采样，用于把上一段视频的场景/人物状态交给下游做参考」；连接示例改为 `firstFrame/lastFrame/gridFrame`；说明未传项返回当前状态。

## 6.1 Agent 宫格查看的插件级开关（R9）

```text
两个视频节点的 createNodeConfig:
  configRules: [{ type: "switch", field: "agentGridInspect", title: "允许 Agent 宫格查看", value: false }]
```

- 默认关闭：新装/升级后 Agent 的工具列表里没有 `sampleFrames`；Agent 仍可用 `captureFrame` 看单帧，也仍可用 `setFrameOutputs({grid:true})` 开端口。
- 生效路径：插件设置保存 → `pluginConfigDialog` 派发 `toonflow:node-config-updated` → 画布 `loadRemoteNodes()` 刷新 `nodeConfigs` → 节点的 `config` computed 变化 → watch 注册/注销工具。脚本不重新加载，无需重开项目。
- 框架改动（`nodeScaffold/nodeTools.ts`）：`register(definition, options?: { nodeId?: string })`
  - 有 `options.nodeId` 时不再调用 `useNodeId()`（作用域外 `inject` 不可用）；
  - 仅在存在 active scope 时 `onScopeDispose(unregister)`；注册仍返回 unregister 供调用方手动注销。
  - 旧调用（无第二参数、在 setup 内）行为不变。
- 节点实现：

```text
const { config } = useNode(...)
const gridInspectEnabled = () => config.value.agentGridInspect === true
let unregisterGrid = gridInspectEnabled() ? nodeTools.register(sampleFrames, { nodeId }) : undefined
watch(gridInspectEnabled, on => {
  unregisterGrid?.()
  unregisterGrid = on ? nodeTools.register(sampleFrames, { nodeId }) : undefined
})
onScopeDispose(() => unregisterGrid?.())
```

- 同一节点正在执行 `sampleFrames` 时关闭开关：`videoInspect.cancelSamples()` 立即中止当前宫格抽帧（内部 AbortController 与调用方 signal 合并），排队项在开始时检查已中止直接作废；`captureFrame` 不受影响。
- 视频变化与「正在开启宫格」的竞态：`apply` 在抽帧前把该路记入 `pendingEnables`；`refresh()` 在 `clear()` 前把这些意图写进 config，随新一轮一起重抽。`apply` 的 abort 分支发现该路已开启时按 `pending` 返回，不再误报「请重新开启」。

## 7. UI

「输出项」下拉增加第三行（由 FRAME_OUTPUTS 自动渲染）：

```text
[✓] 首帧输出      [缩略 64×36]
[ ] 尾帧输出      [占位]
[ ] 宫格输出      [缩略 64×36]      ← 比例随视频，contain 展示
──────────────
    重新抽取
```

- 缩略图沿用 `thumbUrl(path, 256)`。
- **宫格缩略图必须 `object-fit: contain`（评审 P1-6）**：宫格整体比例等于视频比例，竖屏视频是 576×1024，64×36 的 cover 会把四格裁成中间一条。给 `frameThumb` 增加按 key 的 modifier。
- 「重新抽取」在三路都开启时串行重抽三次；busy 期间菜单项禁用（现有逻辑）。

## 8. 边界与错误

| 场景 | 行为 |
| --- | --- |
| 无视频 | 建端口，`pending=true, pendingReason="no-video"`，视频就绪后自动补 |
| 短视频（可用帧不足 4 帧） | 不报错：`fps` 滤镜重复补齐，四格可能是相同画面；与「查看视频」宫格一致（评审实测 ffmpeg 7.1 退出 0 且正常出图） |
| 抽帧途中视频被替换/清空 | 代次校验失败 → 结果作废；`refresh` 已按新视频重抽 |
| 抽帧途中关闭端口 | 不写值、不落文件（abort + 代次） |
| ffprobe 失败/超时 | 该路报错，首/尾帧不受影响 |
| 节点禁用 | 与首/尾帧一致：不中止在途抽帧、也不触发自愈 |
| 节点卸载 / 删除 | 卸载走 `onScopeDispose` 的 `abortAll`；删除入口先 `frames.clear()` 再 `removeNodeFiles`，避免宫格写回已删除目录留下孤儿文件 |
| 旧画布无 `grid` 字段 | 默认关闭，端口不出现 |

## 9. 测试计划

- `frameOutputPlan.test.ts`：三路全开顺序、只开宫格、关闭中间一路后端口上移、`frameOutputMeta("grid")` 的 handleId/fileName 固定。
- 新增 `frameOutputTool.test.ts`（fake controller）：`{grid:true}` 会调用 `apply("grid", true)`；单项失败时另一项成功结果仍返回；未传项返回 `state`。
- 新增 `videoGrid.test.ts`：`gridOutputOptions` 含 `tile=2x2`、`fps`、`-frames:v 1`、`-map`；竖屏 meta 的 `gridCell` 尺寸正确。
- 保留 `inspectVideo.test.ts` 并跑通（验证 probe 搬到 `videoGrid.ts` 后 `clearOutputs`/`settleOutput` 语义未变）。
- typecheck：`@toonflow/node-video`、`@toonflow/node-video-generation`、`@toonflow/nodes-scaffold`。
- 实机：菜单三行开关、竖屏缩略图、替换视频后的依次重抽、关闭断线计数、Agent 工具返回、两节点一致、插件开关保存即生效、复制节点/跨项目粘贴/分享导入、禁用与删除节点。

## 10. 影响面与发布

- 改动文件：`frameOutputPlan.ts`、`frameOutput.ts`、`frameOutputTool.ts`、`inspectVideo.ts`、`inspectVideoTool.ts`（描述指向 `setFrameOutputs`）、`components/frameOutputMenu.vue`（缩略图 contain）、新增 `videoGrid.ts`、`jpegOptions.ts`、`packages/nodeScaffold/src/nodeTools.ts`、两个节点的 `vite.config.ts`（configRules）与 `src/index.vue`（动态注册）。
- 测试文件：`frameOutputPlan.test.ts`、新增 `frameOutputTool.test.ts`、`videoGrid.test.ts`、`inspectVideo.test.ts`。
- 不改画布/服务端；分享包与剪贴板无需新增清理项（宫格是普通 IMAGE 输出）。
- 需重建并同步 `videoNode`、`videoGenerationNode` 两个 UMD；`nodes-scaffold` 改动会打进这两个包（以及之后重建的其他节点），旧节点包不受影响。
- 改完提示用户自行重启应用。

## 11. 评审意见

（待用户填写）

- 是否通过：
- 其他要求：

## 12. 子 agent 评审结论与修订（2026-11-14 11:05）

| 级别 | 问题 | 修订 |
| --- | --- | --- |
| P0 | `setFrameError` 汇总、`clear()`、`runJob` 收尾仍写死 first/last，宫格错误会静默丢失或残留 | 四组 Record 由 FRAME_OUTPUTS 生成，抽 `summarizeFrameErrors`/`clearFrameErrors`，三处改为遍历 |
| P1 | grid 提交只校验一次代次，`remove` 与 `rename` 之间可能删掉新任务刚写的文件 | 三段校验 + 共用 `commitTemporary(temporary, target, isValid, label)` |
| P1 | `videoGrid.ts` 职责边界不清，易与 inspect 各写一套 | 明确只提供 probe/probeVideoMeta/gridOutputOptions；临时文件、清理、代次由调用方负责 |
| P1 | `setFrameOutputs` 描述有多处写死首/尾帧，Agent 不知道 gridFrame | 逐句改写描述并补采样与用途 |
| P1 | 测试计划缺工具/状态机/命令拼装回归 | 补 `frameOutputTool.test.ts`、`videoGrid.test.ts`、端口顺序与 meta 用例 |
| P1 | R7「短视频报错」与实测不符 | 改为「重复帧补齐四格」，与查看宫格一致 |
| P1 | 宫格缩略图比例判断错误（2×2 不等于方形） | 矩阵与方案改为「比例随视频」，宫格缩略图用 contain |
| P2 | 禁用节点不会中止在途抽帧 | §8 措辞改为禁用不中止、卸载才 abortAll；删除入口补 `frames.clear()` |
| P2 | 影响面清单不完整 | 补齐 inspectVideoTool、菜单、nodeScaffold、两个节点 vite/config 与测试 |
| P2 | JPEG 参数两份同值常量 | 新增 `jpegOptions.ts` 作为唯一来源，两处 re-export |
| P2 | 长视频宫格耗时未评估 | 宫格单独 45s 超时；三路串行 + 工具 120s 闸门在方案里记录 |
| P2 | `sampleFrames` 描述未指向新端口 | 补一句「需要可接线输出请用 setFrameOutputs 开启 grid」 |

## 13. 代码审查（2026-11-14 11:35）

| 级别 | 问题 | 修订 |
| --- | --- | --- |
| P1 | 开启宫格途中视频变化：`refresh` 按已提交 config 计算 `wanted`，宫格尚未写入 config → 开启被 abort 后不补抽，开关被静默回退 | `pendingEnables` + `refresh` 先把开启意图落盘；`apply` 的 abort 分支按 pending 返回 |
| P2 | 关闭插件开关不中止在途 `sampleFrames` | `createVideoInspect` 增加 `cancelSamples()`（内部 AbortController），节点在关闭时调用；排队项入口检查已中止 |
| P2 | `commitTemporary` 只靠列表判断临时文件，列表滞后会误判「未生成文件」 | 列表未命中时再 `read` 一次兜底（与 inspect 一致） |
| P2 | 默认关闭时 `captureFrame` 描述仍推荐 `sampleFrames` | 改为「若工具清单里还有 sampleFrames…」的中性表述 |
| P2 | 状态机缺少 composable 级回归测试 | 记为已知缺口：`frameOutputTool` 用 fake controller 覆盖了工具层；`useFrameOutputs` 需要可注入 files/ffmpeg 的夹具，留待后续 |
| P2 | 三路最坏耗时与 120s 闸门持平 | 注释改为「典型在闸门内，最坏会整体取消」；45s 上限留待实机观察 |
