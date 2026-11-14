# 测试结果：图片裁剪增加上下翻转

- 时间：2026-11-13 16:08（评审后修订 16:11）
- 对应方案：`2026-11-13-16-08-image-crop-flip-vertical.md`

## 1. 编译与构建

| 项 | 结果 |
| --- | --- |
| `bun run --filter '@toonflow/node-image' typecheck` | 通过（exit 0） |
| `bun run --filter '@toonflow/node-image-generation' typecheck` | 通过（exit 0） |
| `NODE_ENV=production bun run --filter '@toonflow/node-image' build` | 成功，产物 `build/nodes/imageNode.umd.js` |
| `NODE_ENV=production bun run --filter '@toonflow/node-image-generation' build` | 成功，产物 `build/nodes/imageGenerationNode.umd.js` |
| 同步 | 旧包按 `.bak.<时间戳>` 备份后覆盖 `/Applications/toonflow-data/nodes/` 与 `data/nodes/` |

## 2. 数学核对（评审复核）

| 组合 | 源矩形 | 画布变换 | 点映射 |
| --- | --- | --- | --- |
| 无 | `(x, y)` | 无 | `(i, j)` |
| 左右 | `(W-x-w, y)` | `translate(w,0)+scale(-1,1)` | `(w-1-i, j)` |
| 上下 | `(x, H-y-h)` | `translate(0,h)+scale(1,-1)` | `(i, h-1-j)` |
| 双向 | `(W-x-w, H-y-h)` | 两组依次左乘 | `(w-1-i, h-1-j)`，即 180° |

四种组合下屏幕预览与导出结果一致；预览依赖 `img` 的 `transform-origin` 为默认中心，已在注释中写死这个前提。

## 3. 逻辑核对

| 场景 | 期望 |
| --- | --- |
| 整图 + 只开上下 | 可直接应用（`canApply` 含 `flippedV`） |
| 关闭弹窗再打开 | 两个开关按 `data.crop.last` 还原 |
| 旧数据只有 `flipped` | `flippedV` 缺键按 false，行为不变 |
| 换源图 | 两个开关都复位 |
| 图片节点 / 图片生成节点 | 两个消费方都处理 `flippedV`，文案覆盖三种组合 |
| 恢复裁剪前的图 | 输出回滚，翻转开关随 src 变化复位 |
| 分享包 / 复制节点 | `crop.last` 保留（分享），复制时整体删除 `data.crop`，无脏状态 |

## 4. 待用户实机确认

- 四种组合各应用一次，核对方向与尺寸。
- 双向翻转 + 非对称图案，确认没有出现「预览对、导出反」。

## 5. 用户验收

（待用户填写）
