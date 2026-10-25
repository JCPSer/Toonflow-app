# 测试结果：视频预览关闭后可重复打开

环境：macOS arm64 / vite dev 5173（用户正在运行的实例）/ Element Plus 2.14.5

## 一、静态检查

| 项 | 命令 | 结果 |
| --- | --- | --- |
| apps/web 类型检查 | `bun run typecheck`（vue-tsc） | 通过 |
| apps/web 构建 | `bun run build` | 通过（✓ built in 4.53s） |

## 二、运行时对照实验

用一个临时探针页把 `AssetPreview` 直接挂载，父组件行为与真实调用一致（`entry` 关闭后不清空，仅切换 `modelValue`），依次：打开 a → 关闭 → 再开 a → 关闭 → 打开 b → 关闭 → 再开 a。关闭动作通过点击 `el-dialog` 的关闭按钮完成，走的是真实 `emit('update:modelValue', false)` 路径。

| 步骤 | 修复前（旧绑定） | 修复后 |
| --- | --- | --- |
| 1 首次打开 a.mp4 | OPEN | OPEN |
| 2 关闭 | CLOSED | CLOSED |
| 3 再次打开 a.mp4 | **CLOSED（复现用户反馈）** | OPEN |
| 4 关闭 | CLOSED | CLOSED |
| 5 打开 b.mp4 | **CLOSED** | OPEN |
| 6 关闭 | CLOSED | CLOSED |
| 7 再次打开 a.mp4 | **CLOSED** | OPEN |

修复前第一步之后全部为 CLOSED，与用户描述的「第二次点不开、换目录/换项目都无效」完全一致；修复后每次 `modelValue` 都产生真实跳变，全部 OPEN。

## 三、覆盖与未覆盖

- 覆盖：打开→关闭→再打开（同/不同条目）的完整闭环，关闭走对话框自身事件。
- 覆盖方式说明：探针只验证「显隐受控逻辑」，未走真实磁盘视频文件（避免改动用户素材库数据）；播放本身依赖 `<video src>`，本次未改。
- 未覆盖：Esc 键与点击遮罩两种关闭路径的浏览器实拍（两者最终都走同一个 `update:modelValue(false)` 事件，代码路径一致）。

## 四、回归面

- 图片预览（`el-image-viewer` 分支）未改动；其 `v-if` 依赖 `url`，而 `url` 依赖 `modelValue`，行为不变。
- 音频预览与视频共用同一分支，同步修复。
- 首页素材库与工作区面板复用同一组件，一处修复两处生效。
