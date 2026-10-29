# 需求方案：图片节点裁剪工具

- 记录时间：2026-10-29 12:30
- 对应需求矩阵：`1_requirements_matrix/2026-10-29-12-30-image-crop-tool.md`

## 一、方案总览

新增一个共享组件 `imageCrop.vue`，放在 `packages/nodes/imageNode/src/components/`，通过 `@toonflow/node-image/imageCrop` 暴露给两个节点复用。组件自身持有弹窗、裁剪框交互、编码落盘的全部逻辑；节点侧只负责「开按钮 → 接住 `applied` 事件改输出 → 提供 `restore`」。

与现有组件的分工对照：

| 组件 | 形态 | 结果 |
| --- | --- | --- |
| `imageScale` | popover 参数面板 | 替换输出 + 一层恢复 |
| `imageGridSplit` | popover + 预览 | 新建多个节点 |
| `imageEditor` | 节点内联画布 | 新建节点 / 送生成 |
| **`imageCrop`（新）** | **el-dialog 大图交互** | **替换输出 + 一层恢复** |

## 二、组件契约

```
props:  src: string            当前预览图 URL
        source?: NodeMediaValue 当前输出值（要 url + mimeType）
        active: boolean        节点是否选中（未选中自动关闭）
        disabled?: boolean     外部忙碌
emits:  applied: [CropApplied]
        restore: []
expose: open(event)           由工具栏按钮 @click 调用，event.currentTarget 作为锚点
        applying              布尔，供父级做忙碌互斥
        cancel()              父级在切画布/换图时调用
```

`CropApplied = { path, mimeType, fromUrl, formatChanged, width, height, rect }`，与 `ScaleApplied` 同构，多带一个 `rect` 方便提示文案。

## 三、数据与状态

节点侧持久化（`node.data.crop`，与 `node.data.scale` 平行）：

```
CropState = {
  last?:      { url, x, y, width, height }   // R7 上次未应用的框，按源 url 关联
  previous?:  { url, mimeType }              // R6 恢复目标
  appliedUrl?: string                        // R6 当前输出是否仍是裁剪结果
}
```

组件内部状态机：

```
idle ──open──▶ editing ──apply──▶ encoding ──ok──▶ idle(emit applied)
                 │  ▲                 │
                 │  └──失败/取消─────┘
                 └──close/Esc/换图──▶ idle(abort + 清理临时文件)
```

`editing` 内部还有手势子态：`none / creating（拉新框）/ moving（整体位移）/ resizing（八向手柄）`。

## 四、坐标系统

所有持久化与计算统一用**图片像素坐标**（`0..naturalWidth` × `0..naturalHeight`，整数），只在渲染与指针换算时投影到屏幕：

```
scale = displayedWidth / naturalWidth          // 由 img 的 clientWidth 与 naturalWidth 求得
screen→image:  x = (clientX - bounds.left) * naturalWidth / bounds.width
image→screen:  left = x * bounds.width / naturalWidth
```

好处：窗口缩放、节点缩放、弹窗尺寸变化都不影响已选的裁剪框；应用时直接用作 `drawImage` 的源矩形，不会因来回换算累积误差。

图片实际显示尺寸靠 `img` 的 `max-width:100%; max-height:62vh` 自适应，用 `ResizeObserver` 监听容器尺寸变化触发重绘覆盖层（不重算 rect）。

## 五、交互设计

弹窗布局：

```
┌──────────────────────────────────────────────────────────┐
│ 裁剪                                        原图 2732×1536 │
├──────────────────────────────────────────────────────────┤
│ [自由] [原图] [1:1] [4:3] [3:4] [16:9] [9:16]             │
├──────────────────────────────────────────────────────────┤
│        ┌───────────────┐                                 │
│        │               │  ← 框外 55% 黑遮罩               │
│        │   裁剪区域     │     四角 L 形手柄 + 四边条手柄    │
│        │               │     三分法辅助线（框内 1/3 处）    │
│        └───────────────┘                                 │
├──────────────────────────────────────────────────────────┤
│ X [ 512 ] Y [ 208 ] 宽 [ 1200 ] 高 [ 800 ]     目标 1200×800│
├──────────────────────────────────────────────────────────┤
│              [恢复裁剪前]        [取消]  [应用裁剪]        │
└──────────────────────────────────────────────────────────┘
```

手势规则：

- 在图片空白处按下并拖动 → 以起点为锚新建框（受当前比例约束）。
- 在框内按下拖动 → 整体位移，越界时贴边而非截断。
- 在八个手柄按下拖动 → 改尺寸；对角手柄改动对边固定，边手柄只改一维（比例锁时另一维联动）。
- 按住 Alt 拖角 → 以框中心为锚对称缩放。
- 方向键 ±1px、Shift+方向键 ±10px（焦点在舞台容器上，不抢数字框的键盘）。
- 尺寸下限 1 图片像素；上限为图片边界。
- Esc / 点遮罩 → 关闭（abort）。

遮罩用**四块百分比定位的 DOM**（上/下/左/右）实现，不用 `box-shadow`：阴影会在图片边缘被裁掉，八向手柄也会跟着被裁。四块遮罩的百分比必须夹紧并定点化——浮点残差会产出 `7.1e-15%` 这类非法 CSS，浏览器整条丢弃并保留上一帧的值，遮罩与裁剪框会错位（实测踩到过）。

「自由」是独立按钮，不是"再点一次取消"的开关——少一次歧义，按钮状态直接可读。

## 六、比例锁算法（伪代码）

```
onPointerMove(handle, delta):
  if ratio == null:  freeResize(handle, delta)
  else:
    anchor = 对角点（或边手柄的对边中点）
    w = |pointer.x - anchor.x|, h = |pointer.y - anchor.y|
    # 取更"跟手"的一维主导，另一维按比例推出
    if w / h > ratio: w = h * ratio else h = w / ratio
    夹紧到 [1, natural] 后再按比例回算另一维
  重绘覆盖层，同步四个数字框
```

比例切换 immediate 生效：切到 1:1 时以当前框中心为锚，取当前框的**内接**最大正方形，避免框突然越界。

## 六点五、键盘与 Esc

方向键绑在舞台容器（`tabindex=0`）上：±1px、Shift ±10px，处理内 `preventDefault` 并 `stopPropagation`。

弹窗内容根节点**不能**加 `@keydown.stop`：Element Plus 的 Esc 监听挂在 document 上，stop 会把「按 Esc 关闭弹窗」一起拦掉；而画布侧的 Esc 是捕获阶段监听并靠 `.el-overlay` / `[role=dialog]` 守卫让路，不需要 stop 兜底。关闭本身由 `closeOnPressEscape`/`closeOnClickModal`/`beforeClose` 控制，`applying` 期间一律不允许关闭。

## 六点六、左右镜像

预览用 `transform: scaleX(-1)` 只翻 `<img>`，裁剪框与遮罩保持不动——翻的是图，不是选框，用户框住的内容不会跟着跑。

`drawImage` 拿到的是未变换的原图，所以应用时要把「视图坐标」换算成「源坐标」再翻回来：

```
sx = flipped ? naturalWidth - rect.x - rect.width : rect.x
if (flipped) { ctx.translate(width, 0); ctx.scale(-1, 1); }
ctx.drawImage(image, sx, rect.y, rect.width, rect.height, 0, 0, width, height)
```

- 整图 + 已翻转：`canApply` 放行，按钮文案变「应用翻转」，文件名前缀 `flip-`；否则一律 `crop-`。
- 翻转状态随 `last` 一起记忆（同源图再次打开时恢复），换图即复位。
- `emit` 负载增加 `flipped` / `cropped` 两个布尔，父级据此组合提示文案（「已裁剪」「已左右翻转」「已裁剪并左右翻转」）。

## 七、应用流程（伪代码）

```
apply():
  rect = clampAndRound(currentRect)            # 整数像素、至少 1×1
  if rect.w * rect.h > 64MP: 提示并中止
  { ext, mimeType, formatChanged } = resolveOutputFormat(source.url, source.mimeType)
  # 以 mimeType 为准：上传名与内容不符时（.jpg 里其实是 PNG）按后缀编码会把透明区压成黑块
  path = `assets/${node.id}/crop-${w}x${h}-${Date.now()}.${ext}`
  controller = new AbortController()
  applying = true
  try:
    image = await decode(src)                  # 复用已加载的 img
    canvas = w×h; drawImage(image, x, y, w, h, 0, 0, w, h)
    blob = await canvas.toBlob(mimeType, quality)   # jpeg/webp 用 0.92，png 忽略
    mkdir assets / assets/<node.id>            # EEXIST 忽略
    workspace.write(path, blob, true)
    emit('applied', { path, mimeType, fromUrl, formatChanged, width, height, rect })
    close()
  catch e: showNodeError(e, '裁剪失败')
  finally:
    if (!committed) workspace.remove(path)     # 失败清理，ENOENT 忽略
    canvas.width = canvas.height = 0
    applying = false
```

父级 `onApplied` 校验 `current.url === result.fromUrl`，不成立则删掉新文件并提示「图片已变化」，与缩放同一套防御。

## 八、节点接入点

两个节点改动一致，仅输出写法不同（`imageNode` 用 `outputs.value.image`，`imageGenerationNode` 用 `outputs.image = ...`）：

| 位置 | 改动 |
| --- | --- |
| topActions | 新增「裁剪」按钮，`:disabled` 串里加入其余全部忙碌项 |
| script | `const crop = ref()`；`const cropping = computed(() => !!crop.value?.applying)` |
| nodeSkeleton `:busy` | 追加 `\|\| cropping` |
| 其余工具按钮 `:disabled` | 追加 `\|\| cropping` |
| `nodeEvent.on("save"/"delete")` | 忙碌判断追加 `\|\| cropping` |
| 上传 / setImage / 生成完成 | 调用 `clearCropHistory()`，清 `previous`+`appliedUrl` |
| 模板 | `<imageCrop ref="crop" :src="previewUrl" :source="outputFile" :active="node.selected" :disabled="…" @applied @restore />` |

`imageGenerationNode` 原本没有「缩放」，本次只补「裁剪」，不顺手补缩放（避免范围蔓延）。

共享包导出：`packages/nodes/imageNode/package.json` 的 `exports` 增加 `"./imageCrop": "./src/components/imageCrop.vue"`。

## 九、忙碌互斥与中断矩阵

| 场景 | 行为 |
| --- | --- |
| 裁剪中上传/替换图片 | 按钮禁用（`cropping`） |
| 裁剪中删除节点 | `nodeEvent delete` 抛「图片处理中，请稍后删除节点」 |
| 裁剪中切换节点/画布 | 组件 `watch(src)`/`watch(canvasId)` abort 并关闭 |
| 裁剪中切换项目 | 同上（src 或 canvas 变化） |
| 裁剪中按 Esc | 先关弹窗，画布的 Esc 退出项目逻辑被 `.el-overlay` 守卫拦住 |
| 生成中打开裁剪 | 按钮禁用（`generating`） |
| 裁剪应用完成但输出已被改写 | 删新文件 + 提示「图片已变化」 |

## 十、风险与对策

| 风险 | 对策 |
| --- | --- |
| 超大图 canvas 解码 OOM | 沿用 64MP 目标上限 + 源图 100MB 上限，超限直接提示不进入编码 |
| 指针坐标在缩放/滚动下漂移 | 一律用 `getBoundingClientRect()` 实时换算，不缓存屏幕坐标 |
| 弹窗内键盘事件冒泡到画布 | 弹窗根节点 `@keydown.stop`，Canvas Esc 逻辑已按 `.el-overlay` 让路 |
| 裁剪后节点宽度不更新 | 复用现有 `@load="resizeImage"`，新图加载后按新宽高比改节点宽度 |
| 原图被别的节点引用 | 只写新文件、不删原文件 |
| `last` 框与已裁剪图片错配 | `last` 按**工作区路径** `source.url` 关联（不是预览用的 blob URL），url 变了自动丢弃 |
| 浮点百分比产出非法 CSS | 百分比统一经 `pct()` 夹紧到 0–100 并定点 3 位小数 |
| 不可解码格式（TIFF 等）卡在"读取中" | 图片 `error` 置 `loadFailed`，提示转换格式并保持应用禁用 |

## 十一、验收与测试计划

静态：两节点 `bun run typecheck`；`./scripts/deploy-local.sh --build`。

运行中实测（Chrome DevTools 连 `127.0.0.1:50844`）：

1. 两节点工具栏出现「裁剪」；无图禁用。
2. 打开弹窗 → 拖拽建框 → 位移 → 八向改尺寸，框不越界。
3. 1:1 锁定后拖拽恒为正方形；「自由」后恢复。
4. 数字框改 200/100/800/600，实测输出文件尺寸为 800×600（用 `sips -g pixelWidth/pixelHeight` 校验）。
5. 应用后节点宽度变化，输出路径为 `assets/<nodeId>/crop-*`，原图仍在。
6. 「恢复裁剪前」回到原图；上传新图后按钮消失。
7. 裁剪中删除节点被拦。
8. jpg 输入裁剪后仍为 jpg；tiff 输入裁剪后为 png。

## 十二、评审意见（待填）

| 评审人 | 结论 | 意见 |
| --- | --- | --- |
| （子 agent 初评） |  |  |
| liyuhang |  |  |

## 十三、实现与方案的偏差（评审后修正）

| 方案原文 | 实际实现 | 原因 |
| --- | --- | --- |
| 遮罩用 box-shadow | 四块百分比遮罩 + `pct()` 定点化 | 阴影在图片边缘被裁、手柄被裁；浮点残差产出非法 CSS |
| 比例按钮「再点一次回到自由」 | 独立的「自由」按钮 | 状态更可读，避免与"取消选择"语义混淆 |
| `last` 按 `src` 关联 | 按 `source.url`（工作区路径）关联 | `src` 是 blob URL，重挂载/重启必然失配 |
| 格式按扩展名判定 | 优先 `source.mimeType`，其余回退 PNG | 扩展名与内容不符时会把透明区压成黑块 |
| 关闭/取消 abort 编码 | `applying` 期间禁止关闭；提交前后由 `committed` 与父级 `fromUrl` 校验兜底 | `canvas.toBlob` 与 `workspace.write` 不可中断 |
| 手势结束即持久化 `last` | 仅在关闭弹窗时持久化一次 | 每拖一下写 `node.data` 会持续触发画布自动保存 |

## 十四、评审结论（子 agent）

- 遮挡/Esc/格式/`source.url`/清理时机等阻断级问题已在实现阶段修正，详见测试结果第四节。
- 已知且接受的取舍：裁剪只保像素、不保 EXIF/ICC/DPI；GIF/APNG 等动图经 canvas 只剩首帧（落成静态 PNG）；多次裁剪会在 `assets/<nodeId>` 累积文件（与缩放一致，不做回收）。
- 不做：撤销/重做不覆盖裁剪结果（画布历史只快照结构与 label），只提供一层「恢复裁剪前」。
