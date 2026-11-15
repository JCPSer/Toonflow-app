# Bug 修复方案：图片生成节点接入「缩放」

- 时间：2026-11-15 14:11
- 对应分析：`bug_analysis-2026-11-15-14-11-image-generation-scale.md`
- 状态：已实施

## 1. 方案总览

```text
@toonflow/node-image/package.json
  + export "./imageScale" → ./src/components/imageScale.vue

imageGenerationNode/src/index.vue
  工具栏：调整 | 缩放 | 历史记录 | 替换图片
  组件：<imageScale ref="scale" :src="previewUrl" :source="outputFile" ... />
  状态：scaling = scale.applying
  事件：applied → 覆盖 outputs.image + 记录 previous/appliedUrl
        restore → 校验 current.url === appliedUrl 后回退
  互斥：生成/替换/选历史/裁剪/调整/删除期间禁用缩放；缩放期间反向禁用
  清理：生成新图、替换、选历史时 clearScaleHistory()
```

## 2. UI 设计

工具栏顺序与图片节点保持一致：「裁剪」「调整」「缩放」「历史记录」「替换图片」。

- 按钮：`IconResize` + 文案「缩放」，`aria-expanded` 反映弹层状态。
- 弹层：直接复用 `imageScale.vue`（倍率 0.05–8、快捷 50%/75%/100%、长边≤0–8192、目标尺寸与百分比、64MP 拦截、「应用缩放」「恢复缩放前」）。
- 无输出时按钮置灰；生成中/上传中/裁剪中/调整中/删除中/其他面板运行中置灰。

## 3. 状态与数据

```text
node.data.scale = { factor?, maxEdge?, previous?: {url,mimeType}, appliedUrl? }

handleScaleApplied(result):
    current = outputs.image
    if current.url != result.fromUrl: 删除新文件 + 提示「图片已变化」 + 返回
    scale.previous = current
    scale.appliedUrl = result.path
    outputs.image = result

handleScaleRestore():
    if current.url != scale.appliedUrl: 返回
    outputs.image = scale.previous
    delete scale.previous / appliedUrl

clearScaleHistory(): 删除 previous 与 appliedUrl（生成新图、替换、选历史时调用）
```

## 4. 互斥矩阵

| 操作 | 缩放中 | 说明 |
| --- | --- | --- |
| 生成 | 禁用 | 生成会改写输出，`fromUrl` 校验也会兜底 |
| 替换图片 | 禁用 | 同上 |
| 选择历史 | 禁用 | 同上 |
| 裁剪 / 调整 | 禁用 | 共用输出，避免并发写盘 |
| 打光 / 多角度 / 全景 / 宫格 | 禁用 | 与图片节点一致 |
| 删除节点 | 先 `scale.cancel()` 再清理 | 避免半成品文件与目录删除竞争 |

## 5. 风险与对策

- 恢复记录失效：所有改写输出的入口统一调用 `clearScaleHistory()`；恢复前再校验 `current.url === appliedUrl`。
- 生成新图不清理：在生成成功的 `.then` 里补清理，明确新图没有可恢复的缩放前状态。
- 组件重复：不复制 `imageScale.vue`，通过包导出复用，避免两节点行为漂移。

## 6. 验证

- `@toonflow/node-image` 与图片生成节点 `typecheck` 通过。
- 图片生成节点 `vite build` 成功，备份后同步 UMD。
- 手工验收：生成图片 → 缩放 50% → 应用 → 恢复；替换/选历史后「恢复缩放前」不再出现。

## 7. 评审意见（子 agent）

- 首轮不通过：P1 缩放中仍可启动生成；P2 替换入口与三个面板入口的运行期守卫缺 scaling。
- 已修：发送按钮 disabled 与 `startGeneration()` 守卫补 `scaling`；`replaceOutput` 补 `scaling/cropping/adjusting`；`openLighting`/`openMultiAngle`/`startEditor` 统一补 `scaling`。
- 复核：typecheck 通过，UMD 重建并同步。
