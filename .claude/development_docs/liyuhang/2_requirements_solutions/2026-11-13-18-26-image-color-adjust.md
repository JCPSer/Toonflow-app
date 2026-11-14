# 需求方案：图片节点颜色调整工具

- 时间：2026-11-13 18:26
- 对应需求矩阵：`2026-11-13-18-26-image-color-adjust.md`
- 状态：已实施并同步节点包

## 1. 结构

```text
imageAdjust.ts            纯像素数学（预览与导出共用，可单测）
components/imageAdjust.vue 弹窗：缩略预览 + 五根滑杆 + 重置/恢复/应用
imageNode / imageGenerationNode  工具栏按钮 + 状态与提示
```

## 2. 像素数学

```text
顺序：白平衡（色温/色调） → 亮度 → 对比度 → 饱和度
亮度  offset = brightness * 1.28
对比度 contrast = 1 + contrast / 100          // 以 128 为中心线性缩放
饱和度 saturation = 1 + saturation / 100      // 围绕亮度分量插值
色温  R += warm, B -= warm（warm = temperature/100*36），G 微调
色调  R,B += tint*0.8，G -= tint（tint = tint/100*30）
```

- 对比度不用标准 259 公式：+100 会把中间调整片压成纯黑白，滑杆后半段失去梯级。
- `Uint8ClampedArray` 赋值自带 0-255 夹紧，循环里不做分支。

## 3. 预览与导出的一致性

```text
预览：打开时把图按长边 ≤800 下采样到离屏 canvas，取一次 getImageData 作为基准；
      之后每帧从基准复制一份再套参数，rAF 合帧，绝不累加。
导出：全尺寸 canvas 取 ImageData → 同一函数 → putImageData → toBlob。
```

两条路径共用 `applyAdjustments`，唯一差异是采样尺寸；基准像素只取一次，避免「拖一次滑杆图像就变糊/变暗」。

## 4. 落地与恢复

- 沿用裁剪的状态机：`data.adjust = { previous, appliedUrl }`；仅当当前输出仍等于 `appliedUrl` 时才显示「恢复调整前」。
- 写文件：`assets/<nodeId>/adjust-<w>x<h>-<ts>.<ext>`，格式判定复用裁剪的 `resolveOutputFormat`（以 mimeType 为准，动图落 PNG）。
- 失败/取消：未提交时删除已写入的临时文件；`fromUrl` 校验失败则提示「图片已变化，已取消本次调整」。
- 上传替换、AI 改写、选历史时统一 `clearAdjustHistory()`，与 `clearCropHistory()` 同一批点。

## 5. 交互与边界

- 弹窗只在 `props.active`、单选、未禁用、源图存在时可用；拖动节点/框选/切画布自动关闭并释放预览。
- `applying` 期间禁用关闭按钮之外的交互（`closeOnClickModal/closeOnPressEscape` 关闭）。
- 参数全为 0 时「应用」禁用、「重置」禁用；整图无变化不会产出文件。
- >64MP 直接报错，提示先缩放。

## 6. 影响面

- 新增 2 个文件；`imageNode`、`imageGenerationNode` 各加一个按钮、一个组件实例、一套状态函数。
- 新增包导出 `./imageAdjust`；需要重建两个节点 UMD。

## 7. 验证计划

- 纯函数：恒等、单参数极值、组合参数的手算抽查（bun 脚本）。
- 两个节点包 typecheck + build；备份后同步 UMD。
- 实机：滑动实时性、预览与导出一致性、恢复、切图/禁用时的关闭。

## 8. 评审意见

（待用户填写）

- 是否通过：
- 其他要求：

## 9. 子 agent 评审结论与修订（2026-11-13 18:40）

| 级别 | 问题 | 修订 |
| --- | --- | --- |
| P0 | `apply()` 在 `await` 之后才读 `props.source.url`：编码期间输出被 MCP/上传替换时，emit 的 `fromUrl` 已经是新 URL，父节点的防覆盖校验形同虚设，旧图结果会盖掉新图 | 入口快照 `src/url/mimeType/params`，`runApply(snapshot)` 全程只用快照；参数也用快照，避免中途被 `watch(src)` 重置成默认值 |
| P1 | 无取消/卸载收尾：删节点后写盘仍在继续，可能重建已删除的 `assets/<id>` | 增加 `AbortController` + `cancelApply()` + `onBeforeUnmount`；loadImage/toBlob/write 后各 `throwIfAborted()`；两个父节点的 delete 里 `await adjust.cancelApply()` |
| P1 | `applying` 未接入父节点 busy 与工具守卫：编码期间仍可上传/替换/生成/删节点 | 两个节点新增 `adjusting`，并入 `:busy`、save/delete/setImage/generateImage/上传守卫与按钮 loading |
| P1 | 标题栏 X 在 applying 时仍可关闭，用户以为取消了，实际会完成替换 | `:beforeClose` 拦下（与裁剪一致） |
| P1 | 分享包与跨项目复制未清理 `data.adjust`，会把上一版图片打进分享包 / 指向不存在的旧文件 | `sanitizeCanvas` 增加 `adjust` 的 previous/appliedUrl drop（并补上同样遗漏的 `scale`）；`nodeClipboard` 跨项目时删除 `crop/scale/adjust` |

同时修的 P2：预览帧缓冲复用（不再每帧新建 ImageData）、`dispose()` 复位 loading、`prepare` 失败只在仍可见时报错、canvas 加 `role="img"`、提示文案反映 applying、清理用入口 workspace 实例避免 `applying` 卡死、`onBeforeUnmount` 收尾。

未处理：`resolveOutputFormat`/`ignoreExists` 已是三处重复（裁剪/缩放/调整），建议后续抽 `src/imageOutput.ts`；64MP 上限下的大图内存与主线程耗时留给实机观察。
