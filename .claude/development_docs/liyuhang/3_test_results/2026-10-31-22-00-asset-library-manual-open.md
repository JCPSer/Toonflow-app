# 测试结果：素材库面板纯手动开关 + 滑入动画

- 时间：2026-10-31 22:00
- 对应需求/方案：`1_requirements_matrix/2026-10-31-22-00-asset-library-manual-open.md`、`2_requirements_solutions/2026-10-31-22-00-asset-library-manual-open.md`
- 环境：macOS 14.6 arm64 / Bun 1.3.11

## 1. 静态检查

| 项 | 命令 | 结果 |
| --- | --- | --- |
| 类型检查 | `bun run --cwd apps/web typecheck` | 仅剩既有报错 `apps/server/.../singleAgent/types.ts` 找不到 `@/agentRuntime`（与本次改动无关） |
| 构建 | `bun run --cwd apps/web build` | 通过（3.74 s） |
| 产物核对 | 搜索 `floatingPanelSlide-left` | 命中 `build/web/assets/workspace-wItusU6s.css` |
| 部署 | `scripts/deploy-local.sh` | 完成，安装目录同名 css 已更新 |

## 2. 行为核对

| 场景 | 代码路径 | 结论 |
| --- | --- | --- |
| 保存到素材库 | `requestSave()` 只写 `pendingSave`，不再改 `visible` | 面板保持原状 |
| 保存弹窗 | `floatingAssetLibrary` 监听 `pendingSave` → `openSave`；`el-dialog` `append-to-body` | 面板关闭时照常弹出 |
| 手动打开/关闭 | 画布工具条 setter → `store.visible` → `floatingPanel` 的 `<Transition>` | 左滑入、反向滑出 |
| Agent 面板 | 未传 `slideFrom`，`:css="false"` | 显隐行为不变 |
| 减少动态效果 | `prefers-reduced-motion: reduce` 关闭过渡 | 尊重系统设置 |

## 3. 部署

- 已同步前端到 `/Applications/toonflow-exec.app/Contents/Resources/app/views/mainview/`
- **未重启应用**（遵守用户要求）；重启后生效
- 服务端、节点包无改动

## 4. 待人工复验

1. 重启应用，画布上对节点执行「保存到素材库」：只出现保存弹窗，素材库面板不展开。
2. 点击画布工具条的素材库按钮：面板从左向右滑入；再次点击或点关闭：反向滑出。
3. 停靠/浮层两种形态各试一次，拖拽与宽度记忆不受影响。
