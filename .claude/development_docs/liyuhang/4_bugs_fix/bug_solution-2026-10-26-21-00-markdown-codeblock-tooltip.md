# 修复方案：代码块头部错位 + 进度条气泡残留

日期：2026-10-26 21:00
对应分析：`bug_analysis-2026-10-26-20-50-markdown-codeblock-tooltip.md`

## 一、代码块头部

- 在 `apps/web/src/components/messageMarkdown.vue` 的 `.markdownChunk` 内覆盖：
  `:deep([data-stream-markdown="code-block-header"]) { position: static; }`
- 理由：header 在外层、不在滚动容器内，sticky 没有实际作用；取消后既消除 WebKit 在 transform 祖先下的错位，也不影响长代码块滚动（滚动的是 `code-block-content`）。
- 影响面：所有使用 `messageMarkdown` 的地方（对话、工具消息、设置页 README、更新说明），视觉一致。

## 二、进度条气泡

`packages/nodes/videoNode/src/components/videoPlayer.vue`：

1. 进度条在不可播放时不再显示 tooltip：`:show-tooltip="Boolean(ready && duration)"`。
2. 新增 `closeHoverOverlays()`：向播放器内的进度条手柄/滑轨派发 `mouseleave`/`mouseout`，并关闭 `body > .el-popper` 中没有 `aria-describedby` 触发器的浮层。
3. 调用时机：组件卸载前、`src` 归零切回海报态时、闲置卸载前。

## 三、验证要点

1. 代码块：语言行始终在正文之上；全屏展开同样正常；长代码块（`maxHeight`）滚动时正文在框内滚动、头部不动。
2. 气泡：播放中把鼠标停在进度条上等待闲置卸载，气泡随卸载消失；切换节点/取消选中后画布上不再残留 `0:00`。

## 四、评审意见

（`closeHoverOverlays` 只作用于播放器自身与无触发器的 popper，不影响其它浮层。）
