# 测试结果：对话轮次目录条

- 记录时间：2026-10-28 21:05
- 关联：`1_requirements_matrix/2026-10-28-20-28-conversation-turn-rail.md`、`2_requirements_solutions/2026-10-28-20-28-conversation-turn-rail.md`

## 一、静态验证

- `apps/web` vue-tsc：仅既有的一条 `singleAgent/types.ts(2,33) Cannot find module '@/agentRuntime'`，无新增错误。
- 产物：`build/web/assets/workspace-*.css` 含 `.turnRail`，`workspace-*.js` 含 `turnRail` 与 `jumpToTurn`。
- 部署：`Resources/app/views/mainview/index.html` → `index-DfofRnbP.js` → `workspace-ntwAhpCw.css`，引用链命中新产物。

## 二、审查发现与处置

子 agent 审查（附 virtual-core 3.17.11 源码核对）共 10 条，处置如下：

| # | 问题 | 严重度 | 处置 |
| --- | --- | --- | --- |
| 1 | nav 作为滚动容器的兄弟节点，滚轮落在其上不会传给消息列表；26px 竖条成为右边缘滚轮死角，并压住滚动条 | 高 | 已修：`.turnRail` 与 `.turnRailList` 全部 `pointer-events: none`，仅 `.turnRailItem` 为 `auto`；滚轮与滚动条拖动恢复穿透 |
| 2 | 覆盖右对齐的消息操作按钮，可能误触跳转 | 高 | 已修：`.messageList` 预留 `padding-right: 34px`，目录条落在空槽内 |
| 3 | 无位移跳转时 `atLatestMessage` 残留 false，右下角挂出点不掉的「回到最新消息」 | 高 | 已修：`nextTick` 里按 `isAtEnd()` 重算 |
| 4 | `:focus-within` 让鼠标点击后浮层常驻不收起 | 中 | 已修：改用 `:has(.turnRailItem:hover)` / `:has(.turnRailItem:focus-visible)` |
| 5 | 跳到最后一轮（距底 48px 内）会被 `isAtEnd` 拉回贴底 | 中 | 接受：与「用户本来就在底部」表现一致，属预期 |
| 6 | Tab 停靠点随轮数增加、行高 16px 低于 24px 触控目标 | 中 | 部分修：行高提到 20px，语义由 `aria-label`/`title` 补足；不做 roving tabindex |
| 7 | 二次 `nextTick` 的 `scrollToIndex` 是空操作，注释理由错误 | 低 | 已修：删除该调用，改为重算 `atLatestMessage`，注释重写 |
| 8 | 注释里提到的 `overscroll-behavior` 实际不存在 | 低 | 已修：随命中区域方案整体重写注释 |
| 9 | 260px 固定展开宽度在窄面板会盖住大半对话 | 低 | 接受：只在悬停时出现，移开即收 |
| 10 | 编辑中目录标签滞后于草稿 | 低 | 接受：不影响跳转 |

审查确认无问题的部分：索引取 `displayedMessages` 下标正确；`anchorTo: end` + `followOnAppend` 在非近底位置不会强制拉回；`inset:0 + margin:auto` 居中成立；`z-index: 2` 与 `.scrollBottom`（1）不重叠；删除/回退后目录随渲染更新不错位；流式输出只影响 live 行，不重算目录。

## 三、待手测

1. 20 轮以上对话：目录行数 = 用户提问数；悬停展开显示提问首句；点击跳转落点正确。
2. 一行对话：不出现目录条。
3. 跳转后：右边缘滚轮可正常滚动消息（不被目录条吃）、右对齐的消息操作按钮不被浮层压住。
4. 鼠标点击某行后再把指针移开：浮层应收起（`:has()` 方案）。
5. 内容不满一屏的短对话点击目录：不应冒出「回到最新消息」按钮。

## 四、未覆盖

- 未做真实浏览器渲染验证（WKWebView 无法附加调试；尚未在 Chrome 下跑 vite dev 复现）。
- 目录条与 macOS overlay 滚动条、Windows 经典滚动条的重叠差异只是按几何推算，未实测。
