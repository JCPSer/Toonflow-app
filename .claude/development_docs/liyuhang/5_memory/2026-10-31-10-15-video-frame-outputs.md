# 视频节点「首帧 / 尾帧」可配置输出（STAR）

- 时间：2026-10-31 10:15
- 改动文件：`packages/nodes/videoNode/src/{frameOutputPlan.ts,frameOutputPlan.test.ts,frameOutput.ts,index.vue}`、`packages/nodes/videoNode/src/components/frameOutputMenu.vue`、`packages/nodes/videoNode/package.json`、`packages/nodes/videoGenerationNode/src/index.vue`、`apps/web/src/pages/workspace/panels/canvas/index.vue`

## Situation

「视频」与「视频生成」节点只有一路 VIDEO 输出。要做「上一段的尾帧接下一段的首帧」这类续写，用户得每次手动截帧生成一个独立图片节点再连线，换一次视频就要重做一遍。

## Task

让两个节点能按实例开关首帧 / 尾帧两路 IMAGE 输出端口，帧随视频自动跟随，且不改宿主核心。

## Action

1. **端口动态化**：`handles` 本来就是插件持有的 ref，宿主会把快照同步进 `node.data.handles` 并自动删除消失端口的连线。真正要绕的坑是 `useNode` 初始化时用**声明期** handles 过滤 `node.data.outputs` —— 必须在调用 `useNode` 之前用 `useVueFlow().findNode(useNodeId())` 读出 `node.data.frameOutputs`，先把端口算好再传进去。
2. **抽帧**：复用宿主 ffmpeg，首帧不 seek、尾帧 `-sseof -1` 逐帧覆盖；JPEG `-q:v 2` + `yuvj444p`（4:4:4），原分辨率。
3. **一致性**：所有写 video 的入口（上传、替换、`setVideo` 工具、生成完成、媒体历史 select）后面统一 `refresh()`；`refresh` 内部先清空已开启端口再排队重抽；`mediaHistory @clear` 与关闭端口才调 `clear()`。
4. **状态机**：队列串行 + `epoch` 代次判断结果是否过期 + `activeOps` 计数决定 `busy`。
5. **落盘**：写唯一临时名再 `rename`，避免「文件已存在即通过」把上一版视频的旧帧当新帧。

## Result

| 指标 | 数据 |
| --- | --- |
| 单测 | 18 例 / 69 断言全过 |
| 类型检查 | 两个节点包通过；web 仅剩既有 `@/agentRuntime` 基线错误 |
| 构建 | 11 个节点 + web 全部通过 |
| 实测体积 | 1080p 合成图首帧 190 KB、尾帧 202 KB；照片 119 KB，RGB 域 PSNR 48.97 dB |
| 尾帧正确性 | 与解码末帧逐像素相同（PSNR = inf） |
| 部署 | 两个节点包 + web 视图已同步，未重启应用 |

## 经验

- **「busy 由最后一个任务归零」是陷阱**：只要有提前 `return` 的路径（此处是「视频变了但没有任何端口开启」），`busy` 就会永久为 true，UI 全部禁用且无法自救。改成在途计数，`finally` 无条件减一。
- **固定文件名 + 「存在即成功」的校验等于没有校验**：第二次抽帧起文件一定存在，任何静默失败都会被当成成功。临时名 + rename 才能同时解决「没写盘」和「半截文件」。
- **给已有节点加 IMAGE 输出会波及画布的「复制到剪贴板」**：它按「节点里有任意 IMAGE 输出」判定走图片复制路径，视频节点一旦有帧就会被劫持，节点 JSON 进不了剪贴板。
- **`el-checkbox` 在受控失败场景会失步**：`modelValue` 没变时隐藏 input 不回写，用户看到未勾选、实际 input 已 checked，下一次点击被当成取消。
- 端口开关天然不进撤销栈（快照只存 `label/disabled`），这是既有设计，不必强行支持。

## 补充（v2 修订，2026-10-31 10:45）

真机首次验证即报「开启尾帧输出失败：Request failed with status code 409」。根因：工作区 `rename` 走 `copyFileClone`（`COPYFILE_EXCL`），**目标已存在就 409 EEXIST**，所以首次抽帧成功、之后任何重抽都失败。修法：rename 前先 `remove(target)`（best-effort）；同时让错误提示优先取响应体的 message，不再只显示 axios 的通用文案。

教训：把「临时名 + rename」当作原子覆盖前，必须先确认目标平台 rename 的覆盖语义——这里的 rename 被刻意实现成不覆盖，语义与 POSIX `rename(2)` 不同。
