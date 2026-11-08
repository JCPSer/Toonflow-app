# 记忆：素材库左边缘悬停入口

- 时间：2026-11-02 12:44
- 类型：需求开发

## STAR

**Situation（背景）**
素材库面板原来只能从画布左下角工具条打开；文档面板激活时工具条隐藏，面板没有任何入口。用户希望鼠标贴到窗口左边缘竖直居中时出现一个打开素材库的悬浮按钮，移开消失。

**Task（任务）**
在不影响画布拖拽/框选、不新增面板形态的前提下，加一个悬停入口：显示按钮、点击打开、打开后入口消失；画布与文档面板都要可用。

**Action（行动）**
- grill-me 逐项确认：点击才打开、打开后保持、热区 12×160、面板打开时不显示、36px 圆形按钮、两面板通用。
- 新增 `apps/web/src/pages/workspace/components/assetLibraryTrigger.vue`：`position: fixed` 工作区级组件，根容器零尺寸且 `pointer-events: none`，只让热区条与按钮接收指针。
- 显隐状态机：`mouseenter` 立即显示；离开后 160ms 切换 + 160ms 过渡；`hovering` 标记与 `document.activeElement` 双重守卫，避免指针还在按钮上或键盘聚焦时被收起。
- 边缘情况：`documentElement` 的 `mouseleave` 补 macOS 光标移出窗口（window blur 不可靠）；`window blur` 先把焦点从按钮移走再收起；`window focus` 按 `hovering` 恢复。
- 接线 `workspace/index.vue`：`v-if="!assetLibraryStore.visible"`，`@open` 置 store 可见态并在 `nextTick` 后调素材库 `content.focusRoot()`，防止入口卸载后焦点掉回 body。
- 评审整改：需求/方案先过子 Agent（P1：热区漏 `mouseleave`），实现后代码复审（P2：window blur 绕过焦点守卫）。

**Result（结果）**
web 类型检查（仅既有 `@/agentRuntime` 报错）与构建通过；产物 `workspace-CIckYTbj.js` md5 `47eef640…`、`index.html` md5 `6be82b66…` 已同步到 `/Applications/toonflow-exec.app/Contents/Resources/app/views/mainview/`；**未重启应用**，待用户重启后验收。

## 关键经验

1. 悬停显隐要同时监听热区和按钮的离开事件：只在按钮上监听，指针从未经过按钮时按钮会永久停留。
2. 收起定时器用「当前是否悬停/聚焦」状态判断，不要依赖 mouseleave → mouseenter 的派发顺序。
3. macOS 上光标移出窗口不触发 `window blur`，且 `mouseleave` 不冒泡，要挂在 `documentElement` 上。
4. 打开面板会卸载入口按钮，必须显式把焦点交给面板，否则键盘用户会被打断。
5. 隐藏态用 `opacity + pointer-events` 而不是 `visibility`，才能保留 Tab 聚焦后又用 `focus` 显示的能力。
