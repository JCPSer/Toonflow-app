# 测试结果：图片生成节点接入缩放

- 时间：2026-11-15 14:20
- 对应方案：`bug_solution-2026-11-15-14-11-image-generation-scale.md`

## 1. 静态检查

| 包 | 命令 | 结果 |
| --- | --- | --- |
| `@toonflow/node-image`（图片节点） | `vue-tsc --noEmit` | 通过 |
| `imageGenerationNode` | `vue-tsc --noEmit` | 通过 |

## 2. 构建

```text
bun run --cwd packages/nodes/imageGenerationNode build
build/nodes/imageGenerationNode.umd.js 610.41 kB（gzip 165.19 kB）
```

## 3. 部署

- 备份后同步到 `/Applications/toonflow-data/nodes/` 与内置 `Resources/app/nodes/`。
- 产物核对：工具栏存在 `title:缩放`，包含 `imageScale` 组件与缩放说明文案。
- 未改 `version.json` / `data/nodes/initialized`。

## 4. 运行时验证（Chrome 连接本地服务，用户现有项目）

1. 选中 `imageGenerationNode`，顶部工具栏按钮序列：
   `添加到素材库 | 加入对话 | 全景图 | 局部重绘 | 打光 | 多角度 | 宫格切分 | 裁剪 | 调整 | 缩放 | 历史记录 | 替换图片 | 标记 | 全屏`。
2. 点击「缩放」弹层正常打开，显示原图 `2560 × 1440`、倍率快捷 50%/75%/100%、长边上限、「应用缩放」。
3. 未在用户项目上执行真实应用/恢复，避免改动现有输出。

## 5. 待人工验证

- 生成图片 → 缩放 50% → 应用，确认输出被覆盖、尺寸与提示一致。
- 点击「恢复缩放前」回退一次，按钮随后消失。
- 重新生成、替换图片、选择历史后，「恢复缩放前」不再出现。
- 缩放过程中生成/替换/裁剪/调整/删除均被禁用。

## 6. 评审后修复

- P1：缩放中可启动生成 → 发送按钮与 `startGeneration()` 都补 `scaling` 守卫（Agent 的 `generateImage` 工具同样被拦）。
- P2：`replaceOutput` 补 `scaling/cropping/adjusting`；`openLighting`/`openMultiAngle`/`startEditor` 补 `scaling`。
- 复测：`vue-tsc --noEmit` 通过；重建 610.49 kB；两个节点目录逐字节同步。
