# Bug 分析：视频预览关闭后第二次点不开

## 一、bug 矩阵

| 项 | 内容 |
| --- | --- |
| 背景 | 素材库双击视频弹出播放器（`AssetPreview.vue` 的 `el-dialog`），关闭后再次双击同一视频或另一个视频，播放器不再出现 |
| 现象 | ① 第一次可正常打开并播放；② 关闭后再双击无任何反应；③ 返回上一级重新进目录无效；④ 切换项目重新进目录无效；⑤ 只有图片预览正常 |
| 优先级 | 高（核心预览功能在同一会话内只能使用一次，且无法自愈） |
| 难度 | 低（单点受控属性写错） |
| 风险 | 低（一行绑定修正，不涉及数据与服务端） |
| 影响范围 | 工作区素材库面板 + 首页素材库（复用同一组件），视频与音频预览 |

## 二、复现路径

1. 打开素材库，双击任一视频 → 弹出播放器。
2. 关闭播放器（右上角 × 或 Esc）。
3. 再次双击同一视频，或双击另一个视频 → 无反应。
4. 点「..」返回上一级，重新进入该文件夹 → 仍然无反应。
5. 切换项目，再进入该文件夹 → 仍然无反应。

## 三、根因

`AssetPreview.vue` 里播放器对话框的显隐写成：

```
:model-value="!!entry && (kind === 'video' || kind === 'audio')"
```

即「只要 entry 存在且是音视频就为真」，完全没接 `props.modelValue`。

- 第一次双击：父组件 `openEntry()` 设置 `previewEntry`，绑定值由 `false → true` 跳变，`el-dialog` 内部 `watch(() => props.modelValue)` 收到跳变，`open()`。
- 关闭时：`el-dialog` 内部 `visible = false`，并 `emit('update:modelValue', false)`，父组件 `previewVisible` 变 false——但 `previewEntry` 从未清空，绑定表达式仍恒为 `true`。
- 第二次双击：`openEntry()` 只是把 `previewEntry` 换成同一/另一个条目，并把 `previewVisible` 置 true；而绑定表达式值仍是 `true → true`，Vue 不派发更新，`el-dialog` 的 watch 不触发，`open()` 不会再执行。

Element Plus 源码佐证（`element-plus/es/components/dialog/src/use-dialog.mjs:144`）：`watch(() => props.modelValue, val => { if (val) { ...open() } else if (visible.value) close() })`——只认 `modelValue` 的跳变，不接受"父组件想打开"的任何其它信号。

由此可解释全部现象：entry 常驻 ⇒ 值恒 true ⇒ 一旦关闭就再也无法打开；而 `previewEntry` 不清空，所以返回上级、重进目录、切换项目都不会产生 false 值，必须整页刷新才恢复。图片分支走 `el-image-viewer` 的 `v-if="... && url"`，而 `url` 依赖 `modelValue`，关闭即卸载、重开即重建，因此不受影响。

## 四、同类风险排查

全仓仅这一处使用 `:model-value="!!entry && ..."` 形态（`grep 'model-value="!!'` 只命中本文件），其它对话框（`AssetMetaDialog`、`AssetMoveDialog`、`AssetReferenceDialog`）均为标准 `v-model` 绑定。

## 五、评审意见（待填写）

| 评审人 | 结论 | 意见 |
| --- | --- | --- |
|  |  |  |
