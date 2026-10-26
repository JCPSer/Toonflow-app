# 测试结果：代码块头部错位 + 进度条气泡残留

日期：2026-10-26 21:05
环境：dev（vite :5173 + bun :3121），WKWebView harness（Swift，窗口 520×460）加载临时测试页；测试页已在验证后删除。

## 一、代码块错位（WKWebView 实测）

复刻消息列表结构：外层 `transform: translateY(300px)` 的虚拟行 + `overflow: auto` 滚动容器。

| 条件 | header 顶部 − 代码块顶部 |
| --- | --- |
| `position: sticky`（库默认），未滚动 | 119px（已叠进正文） |
| 同上，滚动 120px 后 | 76px |
| 修复后 `position: static` | 1px（仅边框） |

修复后截图：语言行</>json 在正文之上，行号 1~4 与代码对齐，无重叠。

## 二、进度条气泡

- 代码变更：不可播放时不显示 tooltip；卸载/切海报态/闲置卸载前主动关闭悬停浮层。
- 应用内手测待做：播放中把鼠标停在进度条上等待 30s 闲置卸载，确认气泡随卸载消失。

## 三、构建与部署

- `@toonflow/node-video`、`@toonflow/web` typecheck 通过；`build:nodes`、`web build` 通过。
- `bundle-desktop.ts` + `deploy-local.sh`：运行期节点包更新 `videoNode` / `videoGenerationNode` / `frameAnalysisNode`；前端已安装。

## 四、未覆盖

1. 应用（WKWebView）内对话里的实际代码块：需重启应用后查看长代码块与全屏展开。
2. 气泡残留的另一可能来源（非播放器的 el-slider）未逐一排查，本次只处理播放器路径。
