# 需求方案：素材库面板改为纯手动开关（含滑入动画）

- 时间：2026-10-31 22:00
- 对应需求：`1_requirements_matrix/2026-10-31-22-00-asset-library-manual-open.md`
- 状态：已实现

## 一、现状

| 事实 | 位置 |
| --- | --- |
| 自动出现的唯一业务来源是 `requestSave()`，保存到素材库时强制 `visible = true` | `apps/web/src/stores/assetLibrary.ts:90` |
| 保存弹窗 `SaveToLibraryDialog` 使用 `el-dialog` + `append-to-body`，不依赖面板可见 | `components/SaveToLibraryDialog.vue:2-7` |
| 面板显隐由共用容器 `floatingPanel` 的 `v-show` 控制，没有任何过渡 | `pages/workspace/components/floatingPanel.vue:4` |
| 会话恢复逻辑在 store 初始化时从 `sessionState.state.panels.asset.visible` 灌入 | `stores/assetLibrary.ts:50-53` |

## 二、方案

### 2.1 去掉自动展开

`requestSave()` 只写入待保存请求，不再修改 `visible`。保存弹窗仍由 `floatingAssetLibrary.vue` 监听 `pendingSave` 打开，`el-dialog` 已 `append-to-body`，面板关闭时同样能显示。

### 2.2 滑入/滑出动画

`floatingPanel` 新增可选属性 `slideFrom?: "left" | "right"`：

- 有值时用 Vue `<Transition>` 包裹面板，配合 `v-show` 做进入/离开动画；
- 无值时不挂过渡类（`:css="false"`），Agent 面板显隐完全不变；
- 素材库传 `slide-from="left"`。

动画规则：

| 阶段 | 效果 |
| --- | --- |
| 打开 | `translateX(-100%) → 0`，0.24s `cubic-bezier(0.22, 1, 0.36, 1)` |
| 关闭 | `0 → translateX(-100%)` |
| 减少动态效果 | `prefers-reduced-motion: reduce` 时关闭过渡 |

只动 `transform`，不改宽高，避免拖拽/停靠状态下抖动。

### 2.3 不改的部分

- 会话状态恢复保留（用户选择）；
- 停靠/浮层、拖拽、宽度记忆、保存流程不变。

## 三、改动清单

| 文件 | 改动 |
| --- | --- |
| `apps/web/src/stores/assetLibrary.ts` | `requestSave` 不再打开面板 |
| `apps/web/src/pages/workspace/components/floatingPanel.vue` | 新增 `slideFrom` 属性 + `<Transition>` + 过渡样式 |
| `apps/web/src/pages/workspace/panels/assetLibrary/floatingAssetLibrary.vue` | 传 `slide-from="left"` |

## 四、测试计划

| 项 | 方法 | 期望 |
| --- | --- | --- |
| 类型检查 | `bun run --cwd apps/web typecheck` | 仅既有无关报错 |
| 构建 | `bun run --cwd apps/web build` | 通过，产物含过渡类 |
| 真机 | 保存到素材库；手动开关面板 | 保存只弹窗；面板手动开且带滑入动画 |

## 五、风险

| 风险 | 处理 |
| --- | --- |
| 动画影响拖拽/停靠定位 | 只做 `transform`，结束即移除；不参与布局 |
| Agent 面板被误加动画 | 动画由显式属性开启，Agent 不传 |
| 保存弹窗依赖面板挂载 | 面板内容本来就常驻挂载（v-show），弹窗又 teleport 到 body |

## 六、评审意见

| 评审人 | 结论 | 意见 |
| --- | --- | --- |
| 用户 | 通过 | 见需求评审 |
