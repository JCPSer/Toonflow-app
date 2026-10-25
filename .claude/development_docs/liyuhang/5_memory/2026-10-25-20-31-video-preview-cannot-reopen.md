# 视频预览关闭后无法再次打开（STAR）

## Situation

素材库双击视频弹出播放器，关闭后再次双击同一视频或别的视频都没有任何反应；返回上一级重进目录、切换项目都不恢复，只有整页刷新才行。图片预览不受影响。

## Task

让播放器每次双击都能打开，且关闭后不残留任何"已打开"状态。

## Action

`AssetPreview.vue` 里 `el-dialog` 的显隐原本写成 `:model-value="!!entry && (kind === 'video' || kind === 'audio')"`——只要 entry 存在就恒为 `true`，根本没接 `props.modelValue`。改为新增受控计算属性：

```
playerVisible = props.modelValue && !!props.entry && (video || audio)
```

绑定 `:model-value="playerVisible"`，`update:modelValue` 透传不变。

## Result

- 修复前运行时对照：打开 a → 关闭 → 再开 a / 开 b 全部 CLOSED（完整复现用户现象）。
- 修复后：同一条目、不同条目、反复开关全部 OPEN。
- `vue-tsc` 与 `bun run build` 均通过。

## 经验

- `el-dialog` 是"半受控"组件：它内部持有 `visible`，只在 `watch(() => props.modelValue)` 看到跳变时才 `open()`。父组件把 prop 算成一个恒定表达式（哪怕恒为 true），关闭后就再也回不来——因为值没有 false→true 的边沿。
- 判断"能不能打开"的表达式里必须包含 `modelValue`，不能只由"有没有数据"推断显隐。
- 这类 bug 会伪装成"状态卡死"：换目录、换项目都无效，是因为真正的状态（entry）从未被清空；排查时先问"哪个值在两次操作之间没有变化"。
