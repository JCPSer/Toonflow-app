# 需求方案：图片裁剪增加上下翻转

- 时间：2026-11-13 16:08
- 对应需求矩阵：`2026-11-13-16-08-image-crop-flip-vertical.md`
- 状态：已实施并同步节点包

## 1. 现状

`imageCrop.vue` 的左右翻转由三部分组成：

```text
预览：img.mirrored → transform: scaleX(-1)（裁剪框/遮罩是兄弟节点，不参与镜像）
应用：sourceX = W - x - w；context.translate(w,0); scale(-1,1) 后再 drawImage
状态：data.crop.last.flipped，重开时按源 url 还原
```

裁剪框坐标始终是「未镜像的自然坐标」，预览靠图形镜像让人看到最终效果——用户框的位置在屏幕上是所见即所得。

## 2. 方案

### 2.1 状态与入口

```text
flippedV = ref(false)          // 上下镜像，与 flipped 独立
比例行新增第二个开关「上下」（icon-flip-vertical），两者可同时 active
```

按钮文案从「翻转」拆成「左右」「上下」，避免一个按钮表示两种方向。

### 2.2 预览

```text
previewTransform = 无 → undefined；否则 scale(sx, sy)，sx/sy 由两个开关决定
```

用内联 transform 取代 `.mirrored` class：两个 class 会互相覆盖，单条 transform 天然可组合。
裁剪框与遮罩仍按未镜像坐标绘制，与左右翻转为同一套口径。

### 2.3 应用（关键）

```text
sourceX = mirrorX ? W - x - w : x
sourceY = mirrorY ? H - y - h : y
if (mirrorX) { translate(w, 0); scale(-1, 1) }
if (mirrorY) { translate(0, h); scale(1, -1) }
drawImage(image, sourceX, sourceY, w, h, 0, 0, w, h)
```

推导：两个变换依次左乘，点 p 最终映射为 `(w - x, h - y)`，与「从原图取镜像区域、再整体镜像」等价。

### 2.4 持久化与文案

- `data.crop.last` 增加 `flippedV`；旧数据缺该字段按 false，兼容。
- `applied` 事件增加 `flippedV`；两个消费方统一按「左右 / 上下 / 左右+上下」拼接文案，未翻转时保持原文案。
- `canApply` 在「整图」时只要任一轴翻转即可应用（保留原有的「当翻转工具用」语义）。

## 3. 影响面

- `packages/nodes/imageNode/src/components/imageCrop.vue`（共用组件）
- `packages/nodes/imageNode/src/index.vue`、`packages/nodes/imageGenerationNode/src/index.vue`（`CropApplied` 类型 + 提示文案）
- 需要重建两个节点 UMD 并同步到应用与 dev 的 `nodes/` 目录；web 产物不变。

## 4. 验证计划

- 四种组合各应用一次，核对输出尺寸、内容方向、Toast 文案。
- 整图 + 只有上下翻转 → 可直接应用。
- 关闭弹窗再打开 → 翻转开关还原；换源图 → 复位。
- 两个节点包 typecheck + vite build，备份后同步。

## 5. 评审意见

（待用户填写）

- 是否通过：
- 其他要求：

## 6. 子 agent 评审结论与修订（2026-11-13 16:11）

无 P0/P1。四种组合的源矩形换算与 canvas 变换叠加已逐项验证等价于预览（双向开时点映射为 `(w-x, h-y)`，即 180°）。
旧数据（只有 `flipped`）兼容，源图变化会复位两个开关，两个消费方的文案与事件契约均跟上。

按建议修的 P2：

| 问题 | 修订 |
| --- | --- |
| `flipLabel` 在「两个都没开」时返回 `"上下"`（当前被守卫挡住，属隐性地雷） | 改为按开启轴 join，全关时为空串 |
| 节点侧 `CropState.last` 类型缺 `flipped/flippedV`，与组件实际写入不符 | 两处类型补齐 |
| 变换注释「同时翻转两次」易被读成相互抵消 | 改为「两次镜像依次叠加，合成 180°」并注明依赖 `transform-origin` 默认居中 |
| 预设行无 `flex-wrap`，新增第二个翻转按钮后窄窗口会挤爆 | `.cropPresets` 加 `flex-wrap: wrap` |
| 「已裁剪并左右+上下翻转」读起来生硬 | 文案改为「左右、上下翻转」 |

未处理：三处方向文案仍是各自维护（AGENTS.md 只在复用价值明确时抽取），留待以后有第三种方向时再收敛。
