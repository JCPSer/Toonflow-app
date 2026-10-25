# Bug 方案：视频预览关闭后第二次点不开

## 一、目标

播放器显隐严格由 `v-model`（父组件的 `previewVisible`）驱动，实现「每次打开都是一次真实跳变」，关闭后可反复打开；同一会话内任意次双击、任意切换目录/项目都能打开。

## 二、方案设计

### 2.1 唯一修改点

`apps/web/src/pages/workspace/panels/assetLibrary/components/AssetPreview.vue`

新增一个受控的可见性计算属性，并把它绑定给 `el-dialog`：

```
computed playerVisible =
    props.modelValue            // 父组件真正想打开
    && !!props.entry            // 有目标
    && (kind == "video" || kind == "audio")   // 且该类型由对话框承载
```

模板 `el-dialog` 的 `:model-value` 由「entry 存在即真」改为 `playerVisible`。

`update:modelValue` 事件透传保持不变（关闭时父组件收到 false → `playerVisible` 归 false → 下一次置 true 形成真实跳变）。

### 2.2 不改的部分及理由

- **不清空 `previewEntry`**：保留上一次弹窗标题/内容可让关闭动画期间不闪空标题；显隐已由 `modelValue` 决定，残留 entry 不再有副作用。
- **图片分支不动**：`el-image-viewer` 用 `v-if="entry && kind=='image' && url"`，`url` 依赖 `modelValue`，关闭即卸载、重开即重建，本来就正确。
- **父组件 `useAssetActions.openEntry` 不动**：语义正确（设置目标 + 置可见），问题只在下游把可见性判断丢了。

### 2.3 状态机（修正后）

```
closed --openEntry(entry)--> [modelValue=true] --> dialog.open() --> 播放
   ^                                                                    |
   +-------------- 关闭（×/Esc/点击遮罩）emit false <--------------------+
重开：modelValue false→true 必然触发 el-dialog 的 watch ⇒ open() 每次都会执行
```

## 三、验证计划

| # | 用例 | 期望 |
| --- | --- | --- |
| 1 | 打开视频 A → 关闭 → 再开视频 A | 正常播放 |
| 2 | 打开视频 A → 关闭 → 打开视频 B | 正常播放，标题/内容是 B |
| 3 | 上一步后返回上级再进入该目录 → 打开视频 | 正常播放 |
| 4 | 打开视频 → 切换到另一个项目 → 回到该项目打开视频 | 正常播放 |
| 5 | 音频文件重复 1–4 | 正常 |
| 6 | 图片重复 1–2 | 仍然正常（回归） |
| 7 | 关闭方式分别为 × / Esc / 点击遮罩 | 三种都能再次打开 |

## 四、评审意见（待填写）

| 评审人 | 结论 | 意见 |
| --- | --- | --- |
|  |  |  |
