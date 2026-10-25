# 首页素材库从对话框改为主内容区页面（STAR）

## Situation

首页侧栏点「素材库」弹出 88vw 的 el-dialog，盖住整块主内容区（创建框 + 项目 + 探索），还锁滚动。用户截图圈出主区并明确「就是这块区域」——素材库应该像切换 section 一样在主区展示，而不是弹窗。

## Task

1. 点侧栏「素材库」→ 主内容区替换为素材库，侧栏保持可见。
2. 点「首页/项目/探索」→ 回到原内容。
3. 详情抽屉、批量标签等能力不丢，抽屉保持非模态。

## Action

- 新增 `pages/home/assetLibraryView.vue`：原 `assetLibraryDialog.vue` 的内部（顶部条 + `AssetLibraryContent` + 详情抽屉 + 批量标签弹窗）整体搬到 `<section class="homeAssetView">`，去掉 `el-dialog` 外壳与 `visible` model；暴露 `closeOverlays()` 供宿主收起 append-to-body 浮层。
- `pages/home/index.vue`：
  - `assetsVisible` → `assetsMode` + `assetsMounted`；素材库用 `v-if="assetsMounted" v-show="assetsMode"`，第一次进入才创建，之后保留树展开、选中与上传队列。
  - `el-scrollbar` 从"包住内容"改为"只在普通模式显示"，素材库占同一 flex 槽位（`.pageAssets`，`min-height:0`），高度用 100%。
  - `openAssets()` / `leaveAssets()`；`scrollToSection` 先退出素材库再等一帧滚动；`updateActiveSection` 在素材库模式提前返回；其它导航项高亮加 `!assetsMode`。
  - 侧栏按钮去掉 `aria-haspopup="dialog"`，改 `aria-current="location"`。
  - `window` 级 Esc：没人处理时才退出素材库（内核退回收站/清选中、抽屉与批量弹窗优先）；退出后 `nextTick(updateActiveSection)` 重算侧栏高亮。
- `assetLibraryView.vue` 根加 `position: relative`：首页雾状背景是 `absolute`，素材库根若是 static 会被背景盖住顶栏（代码审查发现）。
- 删除 `assetLibraryDialog.vue`（仓库只保留一份实现）。

## Result

- 素材库占满主区 1444×925，页面内不再出现 `.el-dialog`；无第二个滚动条。
- 回首页后素材库隐藏，再进入仍是上次的库/路径（`library=project` 已验证）。
- 详情抽屉仍是 440px 非模态；离开素材库时抽屉自动关闭、无残留遮罩。
- 560×800 窄屏：顶部条换行到 73px，树 172px，无横向溢出。
- 首页滚动 120px 后进素材库，顶栏最上层就是 `homeAssetBar`（背景雾不再压上来）；Esc 可退出并恢复侧栏高亮。
- 类型检查与构建通过。

## 经验

- "弹窗"和"页面"共用一份内容时，差别应该只在外壳；把外壳换成 section、内部不动，是最省事且不会分叉的做法。
- 需要保留状态的页面不要用 `v-if` 直接卸载：`v-if` 控制"是否创建"，`v-show` 控制"是否显示"，两者叠加才是惰性挂载。
- `append-to-body` 的浮层不受父级 `display:none` 影响，页面隐藏时必须显式关闭，否则会浮在别的页面上。
