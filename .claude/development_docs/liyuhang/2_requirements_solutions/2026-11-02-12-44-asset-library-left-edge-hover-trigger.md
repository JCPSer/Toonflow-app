# 需求方案：素材库左边缘悬停入口

- 时间：2026-11-02 12:44
- 对应需求：`1_requirements_matrix/2026-11-02-12-44-asset-library-left-edge-hover-trigger.md`
- 状态：已实施并通过代码审查（修改后通过）

## 1. 方案总览

新增一个工作区级展示组件 `assetLibraryTrigger.vue`，挂在 `apps/web/src/pages/workspace/index.vue` 根节点、与浮动面板同级。组件自己只管「悬停显隐 + 点击发事件」，面板开关沿用现有 `assetLibraryStore.visible`：

```
workspace/index.vue
  ├─ canvasPanel / documentPanel
  ├─ floatingAgent
  ├─ floatingAssetLibrary        ← 现有
  └─ assetLibraryTrigger         ← 新增：v-if="!assetVisible" @open="assetVisible = true"
       ├─ .hoverZone   （左边缘 12×160 隐形热区）
       └─ button       （36px 圆形，悬停滑入）
```

不改画布、不改 `floatingPanel.vue`、不新增 store 字段、不新增设置项。

## 2. 涉及文件

| 文件 | 变更 |
| --- | --- |
| `apps/web/src/pages/workspace/components/assetLibraryTrigger.vue` | 新增：热区 + 圆形按钮 + 显隐状态机 |
| `apps/web/src/pages/workspace/index.vue` | 挂载组件；引入 `useAssetLibraryStore`，`v-if` 绑定可见态，`@open` 打开面板 |

## 3. 详细设计

### 3.1 组件结构

```
<template>
  <div class="assetLibraryTrigger">
    <div class="hoverZone" @mouseenter="show" @mouseleave="scheduleHide" />
    <button class="triggerButton" :class="{ visible }" type="button"
            aria-label="打开素材库" title="打开素材库"
            @mouseenter="show" @mouseleave="scheduleHide"
            @focus="show" @blur="scheduleHide"
            @click="open">
      <IconFolders :size="18" />
    </button>
  </div>
</template>
```

> 评审 P1：热区必须同时挂 `mouseleave`。指针从热区竖直/斜向移出、从未经过按钮时，只有按钮上的 `mouseleave` 收不到事件，按钮会永久停留。

- 根容器 `position: fixed; left: 0; top: 50%; width/height: 0; pointer-events: none; z-index: 6`。
- `.hoverZone`：`left: 0; top: -80px; width: 12px; height: 160px; pointer-events: auto;`（完全透明）。
- `button`：`left: 8px; top: -18px; width/height: 36px; border-radius: 50%; pointer-events: none;`。

### 3.2 显隐状态机

```
visible = false
hideTimer = undefined

show():
  clearTimeout(hideTimer)
  visible = true

scheduleHide():
  clearTimeout(hideTimer)
  hideTimer = setTimeout(() => {
    if (document.activeElement === button) return   // 键盘聚焦中不隐藏
    visible = false
  }, 160ms)

open():
  visible = false          // 父级随即 v-if 卸载，双保险
  emit("open")

window blur / documentElement mouseleave → scheduleHide()
```

- 显示无延迟：热区只有 12px，已是明确指向意图。
- 收起 160ms：覆盖「热区 → 按钮」之间的指针过渡，以及轻微抖动；过渡本身也是 160ms，完全消失约 0.32s。
- 按钮聚焦时不因鼠标移开而隐藏（评审 P2）：否则焦点会留在一个看不见的控件上，`blur` 时再收起。
- 光标移出窗口：macOS 不会触发 window blur，且 `mouseleave` 不冒泡，所以监听 `document.documentElement` 的 `mouseleave`（评审 P2）。
- 按钮隐藏时 `pointer-events: none`，不会挡住画布；透明热区本身只有 12px 宽。

### 3.3 UI 规格

| 项 | 值 |
| --- | --- |
| 位置 | 距窗口左边缘 8px，竖直居中（视口 50%） |
| 尺寸 | 36 × 36，圆角 50% |
| 图标 | `@tabler/icons-vue` 的 `IconFolders`，18px |
| 底色 | `color-mix(in srgb, var(--el-bg-color-overlay) 70%, transparent)` + `backdrop-filter: blur(6px)`，与左下工具条、左上菜单一致 |
| 描边 | `1px solid var(--el-border-color-light)` |
| 阴影 | `var(--el-box-shadow-light)` |
| 默认色 | `var(--el-text-color-regular)`；hover/focus 时 `var(--el-color-primary)` |
| 出现 | `opacity 0 → 1`、`translateX(-12px) → 0`，160ms `ease` |
| 消失 | 反向，160ms |
| 显示态 | `.triggerButton.visible { opacity: 1; pointer-events: auto; transform: translateX(0) }`（评审 P2：方案必须写出反态，否则按钮永远点不了） |
| reduced-motion | `prefers-reduced-motion: reduce` 时去掉过渡 |

### 3.4 与现有页面的接线

`workspace/index.vue` 增加：

```
import { useAssetLibraryStore } from "@/stores/assetLibrary";
const assetLibraryStore = useAssetLibraryStore();
const assetVisible = computed(() => assetLibraryStore.visible);
```

模板中，紧跟 `floatingAssetLibrary` 挂载：

```
<floatingAssetLibrary ref="assetPanelRef" … />
<assetLibraryTrigger v-if="!assetLibraryStore.visible" @open="openAssetLibrary" />
```

```
async function openAssetLibrary():
  assetLibraryStore.visible = true
  await nextTick()
  assetPanelRef.value?.content?.focusRoot()   // 复核：content 已在 floatingAssetLibrary 暴露，focusRoot 在素材库内容组件暴露
```

- 用 `v-if` 而不是 `v-show`：面板打开时组件彻底不渲染，不会留下可 Tab 的隐藏按钮。
- 打开后把焦点交给素材库内容根节点（`tabindex="-1"`），否则入口被卸载后焦点掉回 body，键盘用户下一次 Tab 要从页面开头走。
- 项目加载中由外层 `<main :inert>` 兜底。
- 面板打开后仍可拖拽、停靠、关闭，行为完全沿用现有面板。

### 3.5 层级与冲突核对

| 元素 | z-index | 与入口的关系 |
| --- | --- | --- |
| 画布 / 文档面板 | 0 层 | 热区只覆盖左边缘 12px，其余区域透传 |
| 工作区菜单 / 面板切换 / 工具条 | 5 | 入口 6，按钮显示时在它们之上；位置不重叠（左中 vs 左上/左下/顶部居中） |
| 浮动面板（Agent / 素材库） | 1001 | 入口在下，不会盖住面板 |
| 设置弹窗 overlay | 2000+ | 打开时遮住入口，不额外处理 |

- 画布拖拽节点经过左边缘：会短暂触发悬停显示，但不会打开面板；鼠标移开即收起。可接受（需求已确认触发区为 12px）。
- 指针进入热区会让画布收到 `pointerleave`（`pointerInCanvas=false`、`pointerPosition` 清空），按评审意见记录：该瞬间自动平移为 0、快捷键新建节点回落画布中心，移出即恢复。
- 迷你地图固定在左下角，与竖直居中区域不重叠。
- 画布内浮层（选区工具条 z-index 6、Agent 节点面板 z-index 10）会在入口之下；入口 DOM 排在画布之后且同为固定层，按钮显示时会盖住贴左缘的浮层（评审 P3）。这些浮层不贴左边缘，实际不重叠，接受。
- 文档面板文件树从视口 x=0 开始（素材库关闭时），居中 12px 热区会盖住文件树左缘约 8px（展开箭头左侧一部分）的点击与滚轮（评审 P3）。热区宽度是用户明确选定值，本次不改，作为已知降级记录。

### 3.6 不采用的方案

| 方案 | 不采用原因 |
| --- | --- |
| 把入口做进 `canvasControls` 或画布内部 | 文档面板激活时不会出现，违反 R6；且会随画布 `v-if` 卸载 |
| 悬停直接打开面板 | 用户已明确选择「点击才打开」；误触成本高 |
| 用 `el-button` 组件 | Element Plus 按钮有自带 hover 背景层，不容易与工具条玻璃质感对齐；原生 button 更可控 |
| 常驻半透明按钮（不隐藏） | 违反「鼠标移开之后消失」的核心诉求 |
| 把总高度改成整条左边缘 | 与迷你地图、节点操作冲突，已在 grill 阶段排除 |

## 4. 边界与异常

| 场景 | 期望 |
| --- | --- |
| 鼠标在热区内横向快速划过 | 按钮短暂闪现后收起；不打开面板 |
| 热区 → 按钮移动 | 两者在 8–12px 重叠，且 160ms 缓冲，不闪烁 |
| 面板已打开 | 入口不渲染 |
| 关闭面板后再悬停 | 入口恢复（store 可见态变化驱动 `v-if`） |
| 文档面板激活 | 入口照常（工作区根节点之上） |
| 项目加载中 | `main` 的 `inert` 屏蔽 |
| 窗口失焦 / 鼠标移出窗口 | 立即收起 |
| 键盘 Tab | 聚焦按钮时显示，Enter/Space 触发 click |
| 视口高度小于 200px | 热区仍居中，可能超出视口，属于极端尺寸，不专门处理 |
| 触屏 | 没有 hover，入口不可见；现有左下角按钮仍可用 |

## 5. 测试方案

1. 类型检查：`bun run --filter '@toonflow/web' typecheck`（允许既有 `@/agentRuntime` 报错）。
2. 构建：`bun run --filter '@toonflow/web' build`；产物同步到安装目录并核对 md5；不重启应用。
3. 静态核对：
   - `workspace/index.vue` 中入口的渲染条件绑定 `assetLibraryStore.visible`；
   - 根容器 `pointer-events: none`，仅热区与按钮为 `auto`；
   - 热区与按钮都挂 `mouseleave`；
   - 组件位于 `workspacePage` 内、与浮动面板同级。
4. 人工验收（重启后）：按需求矩阵第 5 节逐条操作，重点覆盖「热区→按钮不闪烁」「打开后入口消失」「文档面板可用」「画布操作不被拦截」。

## 6. 风险与对策

| 风险 | 对策 |
| --- | --- |
| 热区挡住画布左边缘的点击 | 仅 12px 宽、竖直居中 160px；画布其余区域 `pointer-events` 不变 |
| 按钮隐藏时仍拦截点击 | 隐藏态 `pointer-events: none`，只在显示后可点 |
| 悬停闪烁 | 热区与按钮重叠 + 160ms 收起缓冲 |
| 面板打开后按钮残留 | `v-if` 由 store 可见态驱动 |
| 与后续右侧 Agent 入口重复造轮子 | 组件命名与结构保持通用（热区 + 按钮 + `open` 事件），后续可复制为右侧版本或抽公共组 |

## 7. 评审意见

子 Agent 初评（2026-11-02 12:52）：**修改后通过**，1 个 P1、4 个 P2、4 个 P3。

| 级别 | 意见 | 处理 |
| --- | --- | --- |
| P1 | 热区只有 `mouseenter`，指针从未经过按钮时按钮永久停留，违反 R2 | 已修：热区补 `@mouseleave="scheduleHide"` |
| P2 | 光标移出窗口不触发 window blur；`pointerleave` 不冒泡，原方案写法收不到 | 已修：监听 `document.documentElement` 的 `mouseleave`，卸载时移除 |
| P2 | 打开后触发器被 `v-if` 卸载，焦点掉回 body，Esc/键盘断链 | 已修：`@open` 改为 `openAssetLibrary()`，`nextTick` 后调素材库 `focusRoot()` |
| P2 | 方案缺 `.visible` 反态，照抄会得到不可点击按钮 | 已修：§3.3 明确写出显示态 |
| P2 | 键盘聚焦中的按钮会被 mouseleave 收起 | 已修：收起前检查 `document.activeElement` |
| P3 | 文档面板文件树左缘与 12px 热区重叠 | 未改热区宽度（用户已选定），写入 §3.5 已知降级 |
| P3 | 层级表遗漏画布内浮层（z-index 6/10） | 已补 §3.5 |
| P3 | 验收 0.16s 与 160ms+180ms 不一致 | 已统一为 160ms 过渡 + 160ms 缓冲，验收改写为「约 0.32s 完全消失」 |
| P3 | 模板缺 `type="button"`、测试命令与仓库脚本不符 | 已补；§5 改为仓库脚本 |

实现后代码审查（2026-11-02 13:12）：**修改后通过**，无 P1，1 个 P2、4 个 P3。

| 级别 | 意见 | 处理 |
| --- | --- | --- |
| P2 | `window blur → hideNow()` 绕过焦点守卫，隐藏后仍可 Enter 触发 | 已修：失焦时先 `blur()` 按钮再收起；补 `window focus` 按悬停状态恢复显示 |
| P3 | 缺 `aria-controls` | 已加 `aria-controls="assetLibraryPanel"` |
| P3 | 收起定时器依赖 leave→enter 事件顺序 | 已改：加 `hovering` 标记，定时器回调只在未悬停且未聚焦时收起 |
| P3 | 热区吞掉画布滚轮/右键未写入边界 | 已补需求 §3.4 |
| P3 | 索引与审查记录未闭环 | 已补三份 INDEX、operation 与本文档 |

## 8. 版本记录

| 版本 | 时间 | 说明 |
| --- | --- | --- |
| v1 | 2026-11-02 12:44 | 初稿 |
