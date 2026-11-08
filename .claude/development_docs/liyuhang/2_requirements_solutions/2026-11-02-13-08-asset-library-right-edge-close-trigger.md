# 需求方案：素材库面板右边缘悬停关闭入口

- 时间：2026-11-02 13:08
- 对应需求：`1_requirements_matrix/2026-11-02-13-08-asset-library-right-edge-close-trigger.md`
- 状态：已实施并通过代码审查（修改后通过）

## 1. 方案总览

新增一个面板内组件 `assetPanelCloseTrigger.vue`，作为 `floatingAssetLibrary` 默认 slot 的第二个根节点渲染进 `floatingPanel` 的 `<aside>` 里。`aside` 是 `position: fixed` 且无 `overflow: hidden`，组件用绝对定位贴住面板右边缘，因此停靠、浮层、拖动、缩放都自动跟随，不需要监听任何几何变化。

同时把上一需求「左侧打开入口」与本次「右侧关闭入口」共用的悬停显隐状态机抽成 `useHoverReveal.ts` 组合式函数，两处复用，避免复制 40 行事件逻辑。

```
floatingAssetLibrary
  └─ floatingPanel (aside, fixed, z-index 1001)
       ├─ resizeHandles
       ├─ .assetPanelShell            ← 原有默认 slot 内容
       └─ assetPanelCloseTrigger      ← 新增：右边缘外侧热区 + 圆形按钮
```

## 2. 涉及文件

| 文件 | 变更 |
| --- | --- |
| `apps/web/src/pages/workspace/components/useHoverReveal.ts` | 新增：悬停显隐状态机（显示、160ms 收起、悬停/聚焦守卫、窗口失焦/移出兜底） |
| `apps/web/src/pages/workspace/panels/assetLibrary/assetPanelCloseTrigger.vue` | 新增：右边缘热区 + 圆形左箭头按钮 + 空间不足回退 |
| `apps/web/src/pages/workspace/panels/assetLibrary/floatingAssetLibrary.vue` | 挂载关闭入口，`@close` 置 `visible = false` |
| `apps/web/src/pages/workspace/components/assetLibraryTrigger.vue` | 改用 `useHoverReveal`，行为不变（纯重构） |

## 3. 详细设计

### 3.1 共有状态机 `useHoverReveal(button)`

```
visible = false; hovering = false; hideTimer = undefined

show():            clearTimeout; visible = true
onHoverStart():    hovering = true; show()
onHoverEnd():      hovering = false; scheduleHide()
scheduleHide():    clearTimeout; 160ms 后：if (hovering) return
                                        if (activeElement === button) return
                                        visible = false
hideNow():         clearTimeout; visible = false
window blur:       若焦点在按钮上先 blur()，再 hideNow()
window focus:      if (hovering) show()
documentElement mouseleave → scheduleHide()
onBeforeUnmount：清 timer、移除三类监听
```

- 显隐完全由状态与计时器决定，不依赖 `mouseleave → mouseenter` 的派发顺序。
- 视图层只负责 `visible` 与 `onHoverStart/onHoverEnd` 的绑定。

### 3.2 关闭入口结构与定位

```
<template>
  <div ref="rootElement" class="assetPanelCloseTrigger" :class="{ flipped }">
    <div class="hoverZone" @mouseenter="onEnter" @mouseleave="onHoverEnd" />
    <button ref="buttonElement" class="triggerButton" :class="{ visible }"
            type="button" :aria-label="translate('关闭素材库')" :title="translate('关闭素材库')"
            aria-controls="assetLibraryPanel"
            @mouseenter="onEnter" @mouseleave="onHoverEnd"
            @focus="reveal" @blur="scheduleHide" @click="emit('close')">
      <IconChevronLeft :size="18" />
    </button>
  </div>
</template>
```

| 元素 | 定位（相对 aside 右边缘） |
| --- | --- |
| 根容器 | `position: absolute; z-index: 3; top: 50%; right: 0; width/height: 0; pointer-events: none` |
| 热区 | `top: -80px; right: -12px; width: 12px; height: 160px; pointer-events: auto`（完全在面板外侧） |
| 按钮 | `top: -18px; right: -44px; width/height: 36px; border-radius: 50%` |
| 回退态 `.flipped` | 按钮改 `right: 8px`（面板内侧），只做淡入淡出（不做位移） |

- 热区与按钮在「外侧 8–12px」重叠，指针从热区移到按钮不会断开。
- 面板内最右 5px 是缩放热区；本组件全部在 `right: 0` 以外，不抢事件。

### 3.3 空间不足回退

```
updatePlacement():
  panel = root.closest(".floatingPanel")
  rect = panel.getBoundingClientRect()
  right = parseFloat(panel.style.left) + parseFloat(panel.style.width)  // 缺失时退回 rect
  flipped = right + 52 > window.innerWidth        // 8 间距 + 36 按钮 + 8 余量

onEnter():  updatePlacement(); onHoverStart()
reveal():   updatePlacement(); show()             // 键盘聚焦同样先判定回退
handleResize(): nextTick(updatePlacement)         // 等 floatingPanel 的新宽高落到 DOM
```

- 浮层被拖到贴屏幕右缘时（面板右边缘距视口 < 52px），按钮翻到面板内侧右边缘 8px，仍可点击；热区保持在面板外侧。
- **不读 `getBoundingClientRect()` 定位**：面板滑入/滑出时 `aside` 带 `translateX`，rect 是动画中间值；窗口缩放时 rect 也要等下一帧。改用 `floatingPanel` 写在 `aside` 内联样式上的 `left/width`（与 transform 无关），缺失时才退回 rect。
- 窗口缩放时 `nextTick` 后重算（`floatingPanel` 的 resize 监听先注册，但只改响应式值，DOM 在微任务里才更新）。
- 拖动面板时按钮由绝对定位跟随，无需计算；拖动结束后的下一次悬停会重新判定回退。
- 回退态按钮会覆盖面板右缘内侧 8–44px 的一小块内容，属已知取舍（面板贴屏幕右缘时才有）。

### 3.4 UI 规格

| 项 | 值 |
| --- | --- |
| 尺寸 | 36 × 36，圆角 50% |
| 图标 | `IconChevronLeft`，18px |
| 底色 | 与左侧入口一致：`color-mix(in srgb, var(--el-bg-color-overlay) 70%, transparent)` + `backdrop-filter: blur(6px)` |
| 描边 / 阴影 | `1px solid var(--el-border-color-light)` / `var(--el-box-shadow-light)` |
| 出现 | `opacity 0→1`、`translateX(-8px)→0`，160ms；回退态反向 |
| 消失 | 反向，160ms |
| reduced-motion | 去掉过渡 |

### 3.5 接线

`floatingAssetLibrary.vue`：

```
<floatingPanel …>
  <div class="assetPanelShell">…</div>
  <assetPanelCloseTrigger v-if="visible" @close="visible = false" />
</floatingPanel>
```

- `v-if` 绑定 `visible`：面板关闭时组件不存在，不残留可聚焦按钮；打开时挂载，`aside` 的 `v-show` 负责其余显隐。
- `visible = false` 是面板现有关闭路径，`slide-from="left"` 动画照常播放。
- 关闭后左侧打开入口由 `workspace/index.vue` 的 `v-if="!assetLibraryStore.visible"` 自动恢复。

### 3.6 不采用的方案

| 方案 | 不采用原因 |
| --- | --- |
| 独立 fixed 组件，监听面板 rect 定位 | 需要处理拖动中每帧几何、窗口缩放、停靠切换，复杂度高且容易漂移 |
| 改 `floatingPanel.vue` 增加具名 edge slot | 同一个 slot 直接多根节点即可，避免改公共组件 |
| 按钮放在面板内侧常驻 | 用户已选择外侧悬停；内侧会压住内容并与缩放热区冲突 |
| 拖拽把手关闭 | 用户已选择点击关闭；拖拽与缩放热区冲突 |
| 关闭按钮直接复用标题栏 `×` | 用户要的是右边缘就近入口，不复用位置 |

## 4. 边界与异常

| 场景 | 期望 |
| --- | --- |
| 停靠模式 | 按钮在面板右边缘外 8px，覆盖画布左中区域，不遮面板内容 |
| 浮层模式 | 按钮跟随浮层右边缘；拖到屏幕右缘时翻到内侧 |
| 拖动/缩放面板 | 按钮随 `aside` 移动；拖动期间不显示（指针在标题栏/边缘） |
| 指针在面板内移动 | 热区只在面板外侧，内部移动不会误触发 |
| 面板内容点击/滚轮 | 不受影响 |
| 右边缘拖拽缩放 | 不冲突（热区与按钮均在边框外） |
| 窗口失焦 | 先移走焦点再收起 |
| 键盘 Tab | 聚焦时显示，Enter 关闭 |
| 触屏 | 无 hover，入口不可见；标题栏 `×` 仍可用 |
| 关闭瞬间 | 组件随 `v-if` 卸载，面板滑出动画不受影响 |
| 极窄视口（按钮内外都放不下） | `flipped` 优先级最高，按钮贴内侧 8px；面板最小宽 320px，仍可见 |

## 5. 测试方案

1. 类型检查：`bun run --filter '@toonflow/web' typecheck`（允许既有 `@/agentRuntime` 报错）。
2. 构建：`bun run --filter '@toonflow/web' build`；产物同步到安装目录并核对 md5；不重启应用。
3. 静态核对：
   - 关闭入口作为 slot 第二根节点位于 `aside` 内；
   - 热区/按钮均在 `right: 0` 之外，不与缩放热区重叠；
   - `v-if="visible"` 与 `@close` 接线；
   - 左侧入口改用组合式函数后行为未变。
4. 人工验收（重启后）：按需求矩阵第 5 节逐条操作，重点覆盖停靠/浮层两种形态、贴右缘回退、面板内容与缩放不被打断。

## 6. 风险与对策

| 风险 | 对策 |
| --- | --- |
| 抽出组合式函数引入回归 | 保持事件与计时器逻辑逐条等价；左侧入口只改接线，不改模板结构 |
| 按钮出屏 | R5 回退到内侧 + resize 重算 |
| 与面板缩放冲突 | 全部放在边框外 |
| slot 多根节点影响面板布局 | `aside` 定位方式不变，新增节点 `position: absolute`，不参与流式布局 |
| 浮层拖到右缘后按钮闪烁 | 160ms 缓冲 + 悬停标记 |

## 7. 评审意见

子 Agent 初评（2026-11-02 13:22）：**修改后通过**，无 P1，4 个 P2、若干 P3。

| 级别 | 意见 | 处理 |
| --- | --- | --- |
| P2 | resize 回调同步读 rect 落后一帧；入场动画期间 rect 被 translateX 污染 | 已修：改用内联 `left/width`，resize 走 `nextTick` |
| P2 | 键盘聚焦路径 `@focus="show"` 不重算回退，浮层贴右缘时按钮可能在屏外 | 已修：`reveal()` 先 `updatePlacement()` |
| P2 | 裸中文违反本目录 i18n 约定 | 已修：两个入口都改用 `translate()` |
| P2 | N1「都在面板外侧」与 R5 回退矛盾 | 已改需求 N1 与验收 5，方案 §3.3 写明取舍 |
| P3 | 方案伪代码缺 `ref="rootElement"` | 已补 |
| P3 | 根容器 `translateY(-50%)` 对 0 高元素是空操作 | 已删 |
| P3 | 触屏隐形热区吞点击 | 两个入口都补 `@media (hover: none)` 隐藏 |
| P3 | 关闭后焦点落回 body | 与标题栏 `×` 一致，保留为已知行为 |
| P3 | 命名与同目录 PascalCase 不完全一致 | 与 `floatingAssetLibrary.vue` 保持一致，不改 |

实现后代码审查（2026-11-02 13:33）：**通过**，无 P1/P2，6 个 P3。

| 级别 | 意见 | 处理 |
| --- | --- | --- |
| P3 | 回退态首次入场时隐藏位移方向相反 | 已改：回退态只淡入淡出，不做位移 |
| P3 | 回退态热区与按钮间有 8px 死区（慢速移动可能超 160ms） | 接受，人工验收专门覆盖慢速移动 |
| P3 | 回退态按钮无 z-index，可能被面板内容浮层盖住 | 已加根容器 `z-index: 3` |
| P3 | 外侧热区截获画布点击/滚轮未记录 | 已补需求 §3.4 |
| P3 | 方案根容器残留 `translateY(-50%)` 空操作 | 已删 |
| P3 | 关闭后焦点落回 body | 与标题栏 `×` 一致，保留 |

## 8. 版本记录

| 版本 | 时间 | 说明 |
| --- | --- | --- |
| v1 | 2026-11-02 13:08 | 初稿 |
