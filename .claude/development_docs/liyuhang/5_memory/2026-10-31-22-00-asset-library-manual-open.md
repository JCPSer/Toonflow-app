# 素材库面板改为纯手动开关并加滑入动画

- 时间：2026-10-31 22:00
- 涉及文件：`stores/assetLibrary.ts`、`pages/workspace/components/floatingPanel.vue`、`pages/workspace/panels/assetLibrary/floatingAssetLibrary.vue`

## STAR

**Situation**
画布下的素材库面板会在没有点击它的时候自动出现。排查后确认自动来源只有一处：点「保存到素材库」时 `requestSave()` 顺手把面板打开；另有会话状态恢复，但用户选择保留。

**Task**
去掉保存时的自动展开，面板只由手动开关控制，并在打开/关闭时加左→右的滑动动画，同时不影响共用 `floatingPanel` 的 Agent 面板。

**Action**
1. `requestSave()` 只记录待保存请求，不再改 `visible`；保存弹窗本身是 `el-dialog append-to-body`，面板关着也能弹出。
2. `floatingPanel` 新增可选 `slideFrom?: "left" | "right"`，用 Vue `<Transition>` 包裹 `v-show` 面板；无此属性时 `:css="false"`，Agent 面板显隐完全不变。
3. 过渡只做 `transform: translateX(±100%)`，0.24s `cubic-bezier(0.22, 1, 0.36, 1)`，并在 `prefers-reduced-motion: reduce` 下关闭。
4. 素材库传 `slide-from="left"`。

**Result**
- Web typecheck 仅剩既有无关报错，构建通过（3.74 s），产物含 `floatingPanelSlide-left`。
- 已部署到安装版前端，未重启应用。

## 教训

- 「面板自己弹出来」优先查 store 里的 `visible = true` 写入点，比翻组件可靠；本次只有一处。
- 给共用容器加动画要用显式开关（可选属性），不要默认开启，否则会顺手改掉另一个使用方（Agent 面板）的行为。
- 保存弹窗能脱离面板存在，是因为它 `append-to-body`；拆耦合前先确认弹窗的挂载方式，否则去掉自动展开会把保存流程弄哑。

## 关联

- 需求/方案/测试：`1_requirements_matrix/2026-10-31-22-00-asset-library-manual-open.md`、`2_requirements_solutions/2026-10-31-22-00-asset-library-manual-open.md`、`3_test_results/2026-10-31-22-00-asset-library-manual-open.md`。
