# 记忆：代码块头部错位与进度条气泡残留

## Situation

Agent 对话里的代码块头部（语言/复制/展开）叠在正文中间，全屏展开同样错位；视频节点进度条的时间气泡偶发残留，无法关闭。

## Task

- 让代码块头部始终在正文之上，滚动与全屏都正常。
- 播放器被卸载或切回海报态时，不再残留悬停气泡。

## Action

- `apps/web/src/components/messageMarkdown.vue`：`.markdownChunk` 内 `:deep([data-stream-markdown="code-block-header"]) { position: static; }`。
- `packages/nodes/videoNode/src/components/videoPlayer.vue`：进度条 `:show-tooltip="Boolean(ready && duration)"`；新增 `closeHoverOverlays()`（派发 mouseleave/mouseout 给滑轨手柄 + 关闭 `body > .el-popper` 中无 `aria-describedby` 触发器的浮层），在组件卸载、`src` 归零、闲置卸载前调用。

## Result

- WKWebView harness 复刻「transform 虚拟行 + 滚动容器」：sticky 时 header 相对块顶偏移 119px（未滚动）/ 76px（滚动 120px），改 static 后恒为 1px。
- typecheck、build:nodes、web build 通过；运行期节点包已更新，前端已安装，需重启应用验证。

## 精度要点

- WebKit 下 `position: sticky` 在带 `transform` 的祖先里按该祖先定位，消息列表的 `translateY` 虚拟滚动会直接把 sticky 头推进正文。
- 库里的 header sticky 本来就没有作用对象：滚动容器是它下面的 `code-block-content`（`overflow: auto`），header 在外层。
- Element Plus 的 slider tooltip 挂到 `body`，参考元素被卸载时不会自动关闭；必须在卸载路径主动清理。
