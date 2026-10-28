# 记忆：轮次目录条垂直居中 + 展开高度按需

## Situation

轮次目录条（右侧竖向导航）此前用 `top: 8px; bottom: 56px;` 撑满消息区高度，条目从顶部往下排，条目少时整条看起来靠上；悬停展开时 `.turnRailList` 是 `flex: 1`，浮层被撑成几乎满高，只有三条提问也铺一整条，不是按需展开。

## Task

收起态与展开态都垂直居中；浮层高度跟随条目数，只在超过可视上限时才滚动。

## Action

- `.turnRail` 去掉 `top: 8px; bottom: 56px`，改为 `top: 50%` + `transform: translateY(-50%)` + `max-height: calc(100% - 104px)`。全局有 `* { box-sizing: border-box }`，所以 max-height 含 padding/border，四周各留 52px：上边缘不贴顶，下边缘（`H-52`）高于右下角「回到最新消息」按钮顶边（`bottom:12` 起、直径约 32px，即 `H-44`），继续不重叠。
- `.turnRailList` 由 `flex: 1` 改为 `flex: 0 1 auto`：高度按条目数收缩，撞到 nav 的 max-height 才由 `overflow-y: auto` 接管滚动。
- 收起态的裁剪规则保持原样（`overflow: hidden`，短横 20px 行高）；因为现在容器是内容高度，条目多时仍会顶到上限并裁掉尾部，展开后可滚动访问。

## Result

纯 CSS 改动，无逻辑变动。构建产物 `build/web/assets/workspace-B5F2TVoT.css` 里 `.turnRail` 含 `top:50%`、`translateY(-50%)`、`max-height:calc(100% - 104px)`，`.turnRailList` 为 `flex:0 auto`；已确认安装包 `views/mainview/index.html` → `index-Aydmvdrp.js` → `workspace-B5F2TVoT.css` 链路命中新文件。

未手测：短对话（2–3 轮）展开后浮层是否如预期只有 3 行高；长对话（≥ 上限）滚动条是否正常。
