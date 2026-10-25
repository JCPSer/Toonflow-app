# 需求方案：首页素材库改为主内容区页面

对应需求：`1_requirements_matrix/2026-10-25-15-40-home-asset-library-page.md`

## 布局

```
┌──────────┬──────────────────────────────────────────────┐
│ 侧栏      │  主内容区（pageContent）                      │
│ 首页      │                                              │
│ 项目      │   普通模式：今天要做点什么 / 项目 / 探索        │
│ 探索      │   ───────────────────────────────────        │
│ ─────    │   素材库模式：                                │
│ 素材库 ◀  │     [标签筛选] [已选 N 项] [详情：xx]         │
│          │     ┌────────┬──────────────────┐            │
│          │     │ 目录树  │ 网格              │            │
│          │     └────────┴──────────────────┘            │
│          │     （详情抽屉非模态、贴右）                   │
└──────────┴──────────────────────────────────────────────┘
```

## 实现要点

1. 新组件 `pages/home/assetLibraryView.vue`：把 `assetLibraryDialog.vue` 的内部（顶部条 + `AssetLibraryContent` + 详情抽屉 + 批量标签弹窗）搬出来，外壳从 `el-dialog` 换成 `<section class="homeAssetView">`，高度 `100dvh`，内部自己滚动。
2. `pages/home/index.vue`：
   - `assetsVisible` → `assetsMode`（进入/退出）。
   - 主区用 `v-if` 二选一：普通内容（创建/项目/探索）或 `assetLibraryView`。
   - 侧栏「素材库」点击 → `assetsMode = true`；点「首页/项目/探索」→ `assetsMode = false` 后再滚动。
   - `updateActiveSection` 在素材库模式下不执行（内容区已被替换）。
3. 删除 `assetLibraryDialog.vue`，避免两套 UI。

## 状态与交互

| 场景 | 行为 |
| --- | --- |
| 第一次进入素材库 | 默认全局库根，树按项目分组（沿用现有） |
| 从素材库切到首页 | 素材库组件卸载，下次进入重建（状态从 pinia 恢复库/路径） |
| 素材库内打开详情 | 非模态抽屉贴右，不遮罩 |
| 窄窗口 | 顶部条换行，网格自适应（沿用现有 grid 逻辑） |

## 测试

| # | 用例 | 期望 |
| --- | --- | --- |
| 1 | 点侧栏「素材库」 | 主区变成素材库，不再出现 el-dialog |
| 2 | 素材库页点「首页」 | 回到创建区，素材库消失 |
| 3 | 素材库页滚动 | 只有网格区域滚动，整页不自带第二个滚动条 |
| 4 | 素材库页打开详情 | 抽屉非模态，点网格仍可选中 |
| 5 | 窗口变窄 | 顶部条换行，不溢出 |
| 6 | 侧栏高亮 | 素材库打开时只有「素材库」高亮 |

## 评审意见

| 评审人 | 意见 | 结论 |
| --- | --- | --- |
| 子 agent | ① 不要复制 dialog，直接改造原文件；② 别把素材库塞进现有 el-scrollbar（padding + 100dvh 会出第二个滚动条）；③ v-if 卸载不保留状态（store 只按 directory 分桶），要保状态用 v-show 惰性挂载；④ scroll spy 必须 early return，切 section 要等一帧；⑤ 去掉 `aria-haspopup="dialog"`，改 `aria-current`；⑥ v-show 离开时要主动关闭 append-to-body 的浮层 | 全部采纳；"不复制"未采纳——原 dialog 已被整体替换并删除，仓库里只有一份实现，无分叉风险 |

## 方案修订（评审后实际实施）

| 项 | 原方案 | 实际实施 | 原因 |
| --- | --- | --- | --- |
| 挂载方式 | `v-if` 二选一 | `v-if="assetsMounted"` + `v-show="assetsMode"` | 保留树展开、选中、上传队列；首次进入才创建 |
| 滚动容器 | 放进 el-scrollbar | `el-scrollbar` 整体 `v-show="!assetsMode"`，素材库占同一 flex 槽位 | 避免双滚动条；`min-height:0` 一路传到内容区 |
| 离开清理 | 未考虑 | 组件暴露 `closeOverlays()`，`leaveAssets()` 调用 | 详情抽屉/批量弹窗是 `append-to-body`，隐藏后仍会浮在首页 |
| 高亮 | 只改素材库按钮 | 其它三项加 `!assetsMode`、`updateActiveSection` 提前返回 | 防止双高亮、scroll spy 抢回旧 section |
| aria | `aria-haspopup="dialog"` | `aria-current="location"` | 与其它导航项一致 |
