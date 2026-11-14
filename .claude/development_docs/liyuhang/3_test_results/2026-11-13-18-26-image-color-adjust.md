# 测试结果：图片节点颜色调整

- 时间：2026-11-13 18:26（评审后补测见 §4）
- 对应方案：`2026-11-13-18-26-image-color-adjust.md`

## 1. 纯函数抽查（bun 脚本，逐像素手算对照）

基准像素 `(100, 120, 140)`：

| 参数 | 输出 | 判读 |
| --- | --- | --- |
| 全 0 | `(100,120,140)` | 恒等，不改动任何通道 |
| 亮度 +50 | `(164,184,204)` | 每通道 +64（1.28/单位） |
| 亮度 -50 | `(36,56,76)` | 每通道 -64 |
| 对比度 -100 | `(128,128,128)` | 收到 128 中心，符合线性系数定义 |
| 对比度 +100 | `(72,112,152)` | 两倍对比，未截顶 |
| 饱和度 -100 | `(117,117,117)` | 按亮度加权去色（0.2126/0.7152/0.0722） |
| 色温 +100 | `(136,120,104)` | 红升蓝降（暖） |
| 色温 -100 | `(64,120,176)` | 红降蓝升（冷） |
| 色调 +100 | `(124,90,164)` | 品红方向（红蓝升、绿降） |

## 2. 编译与构建

| 项 | 结果 |
| --- | --- |
| `@toonflow/node-image` typecheck | 通过（exit 0） |
| `@toonflow/node-image-generation` typecheck | 通过（exit 0） |
| 两个包的 `vite build` | 成功，产物 518 KB / 595 KB |
| 同步 | 旧包 `.bak.<时间戳>` 备份后覆盖 `/Applications/toonflow-data/nodes/` 与 `data/nodes/` |

## 3. 逻辑核对

| 场景 | 期望 |
| --- | --- |
| 参数全 0 | 「应用」「重置」禁用，不产出文件 |
| 应用后 | 输出替换为 `assets/<nodeId>/adjust-wxh-<ts>.<ext>`，并出现「恢复调整前」 |
| 恢复后 | 输出回到调整前，恢复按钮消失 |
| 应用期间源图被重新生成/上传 | fromUrl 不匹配 → 提示「图片已变化」，删除新文件 |
| 上传 / AI 改写 / 选历史 | `clearAdjustHistory()` 与 `clearCropHistory()` 同时清 |
| 切图、禁用、切画布、拖动节点 | 弹窗自动关闭并释放预览基准 |
| 大图 >64MP | 报错提示先缩放，不产出空白文件 |

## 4. 子 agent 审查与补测（2026-11-13 18:40）

评审发现 1 个 P0 + 4 个 P1，已全部修复（见方案 §9）：

- P0：`apply()` 在 await 后读 `props.source.url`，编码期间输出被替换时 fromUrl 校验失效 → 改为入口快照。
- P1：无取消/卸载收尾 → 加 AbortController + `cancelApply()` + `onBeforeUnmount`，并在父节点 delete 中 await。
- P1：`applying` 未接入 busy/守卫 → 两个节点新增 `adjusting`。
- P1：标题栏 X 可在导出中关闭 → `:beforeClose` 拦截。
- P1：分享包/跨项目复制未清 `data.adjust`（连带 `data.scale`）→ 两处补齐。

补测：`apps/server/src/modules/workspaceShare` 67 项测试通过；`@toonflow/server` typecheck 通过；
`@toonflow/web` typecheck 仅剩既有 `@/agentRuntime`；两个节点包 typecheck 通过并已重新构建同步。

## 5. 用户验收

（待用户填写）
