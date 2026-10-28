# 记忆：轮次目录条不可见的回归

## Situation

上一轮把右侧轮次目录条改成「高度按内容 + 垂直居中」时，把列表从 `flex: 1` 改成 `flex: 0 1 auto`，结果两个对话面板（主对话与 Agent 节点面板）的目录条都整体消失，右侧只剩一条 34px 空白槽。

## Task

恢复目录条显示，并让空白槽只在目录条真正渲染时出现。

## Action

- **根因是主轴搞错**：`.turnRail` 是横向 flex，`flex: 0 1 auto` 作用在**宽度**上。列表的宽度按内容算，而内容（按钮）靠 `align-items: stretch` 撑满列表宽度，形成循环解为 0；短横又是绝对定位不撑宽、文字 `display:none`，于是列表宽 0，短横被 `overflow: hidden` 裁光。
- 修法：`.turnRail` 加 `flex-direction: column`，子项在交叉轴上直接 stretch 到 26px 宽；高度继续用列表的 `flex: 0 1 auto` + `min-height: 0` 收缩；补 `min-width: 0` 防御再次塌陷。
- 空槽：`.messageList` 从无条件 `padding-right: 34px` 改为 `turns.length > 1` 时挂 `.hasTurnRail` 才加。

## Result

`apps/web` typecheck 0 新增；构建产物 CSS 核对含 `flex-direction:column` 与 `.messageList.hasTurnRail{padding-right:34px}`；已部署。待手测：多轮出现短横、单轮无空槽、两个面板一致。
