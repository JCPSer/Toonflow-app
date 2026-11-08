# 测试结果：素材库左边缘悬停入口

- 时间：2026-11-02 13:05
- 对应需求：`1_requirements_matrix/2026-11-02-12-44-asset-library-left-edge-hover-trigger.md`
- 对应方案：`2_requirements_solutions/2026-11-02-12-44-asset-library-left-edge-hover-trigger.md`
- 结论：类型检查、构建、部署核对通过；**未重启应用**，需用户重启后人工验收

## 1. 类型检查

```
bun run --filter '@toonflow/web' typecheck
→ 仅剩既有错误：../server/src/modules/agentAccess/singleAgent/types.ts(2,33)
  Cannot find module '@/agentRuntime'
```

新增组件与接线无类型错误。

## 2. 构建

```
bun run --filter '@toonflow/web' build
→ Exited with code 0
```

产物：`build/web/assets/workspace-CIckYTbj.js`（新增组件所在 chunk）。

## 3. 部署核对

| 项 | 结果 |
| --- | --- |
| 部署命令 | `rsync -a build/web/ /Applications/toonflow-exec.app/Contents/Resources/app/views/mainview/` |
| `index.html` md5 | `6be82b6694439eb9a0d2505d46464b2d`（构建 = 应用） |
| 应用入口 | `index.html` → `assets/index-Dy6-vAW1.js` |
| chunk 引用 | `index-Dy6-vAW1.js` 引用 `workspace-CIckYTbj.js` |
| 组件产物 | `workspace-CIckYTbj.js` 内含 `assetLibraryTrigger` / `hoverZone` / `打开素材库` / `aria-controls`，md5 `47eef640…`（构建 = 应用） |

**未重启应用**，需用户自行重启后生效。

## 4. 静态核对

| 断言 | 证据 |
| --- | --- |
| 入口只在素材库关闭时渲染 | `index.vue`：`<assetLibraryTrigger v-if="!assetLibraryStore.visible" …>` |
| 打开走现有可见态 | `openAssetLibrary()` 置 `assetLibraryStore.visible = true` |
| 打开后焦点不断链 | `openAssetLibrary()` 在 `nextTick` 后调 `assetPanelRef.value?.content?.focusRoot()` |
| 热区与按钮都能收起 | 热区、按钮均挂 `@mouseleave="scheduleHide"` |
| 窗口外离开能收起 | `document.documentElement` 的 `mouseleave` + `window blur`，卸载时移除 |
| 聚焦中不隐藏 | `scheduleHide` 回调检查 `hovering` 与 `document.activeElement`；窗口失焦时先 `blur()` 再收起 |
| 悬停标记 | 热区/按钮的 enter/leave 维护 `hovering`，定时器以状态为准，不依赖事件顺序 |
| 热区不挡画布 | 根容器 `pointer-events: none`，仅热区条与按钮 `auto` |
| 隐藏按钮不可点 | 按钮默认 `pointer-events: none`，`.visible` 才恢复 |
| reduced-motion | 媒体查询内 `transition: none` |

## 5. 代码审查

子 Agent 复审（2026-11-02 13:12）：**修改后通过**，无 P1，1 个 P2、4 个 P3。

| 级别 | 意见 | 处理 |
| --- | --- | --- |
| P2 | window blur 直接 `hideNow()`，绕过焦点守卫，隐藏后仍可按 Enter 触发 | 已修：失焦先 `blur()` 按钮，再收起；补 `window focus` 按 `hovering` 恢复显示 |
| P3 | 缺 `aria-controls` | 已加 |
| P3 | 收起定时器依赖 leave/enter 顺序 | 已加 `hovering` 标记，回调按状态判断 |
| P3 | 热区吞掉画布滚轮/右键未写入边界 | 已补需求 §3.4 |
| P3 | 索引与审查记录未闭环 | 已补 INDEX 与 operation |

已核实无问题项：`focusRoot` 通过 `v-show` + teleport 始终可聚焦；`nextTick` 续体在 post-render 之后；快速连点幂等；浮层模式、窗口缩放、项目加载 `inert`、reduced-motion 均正常。

## 6. 未覆盖项（需重启后人工确认）

1. 素材库关闭时，鼠标贴到左边缘竖直居中，按钮滑入；向上/向下/向右移开后约 0.32s 完全消失。
2. 点击按钮打开素材库；打开后悬停不再出现按钮；关闭面板后恢复。
3. 文档面板激活时，悬停入口可用，点击打开正常。
4. 画布中部、节点、左下工具条、左上菜单操作不被热区拦截；拖拽节点经过左边缘不误开面板。
5. 窗口失焦、光标移出窗口后按钮收起。
6. 键盘 Tab 聚焦按钮时按钮显示，Enter 打开素材库且焦点落在素材库内容上。
