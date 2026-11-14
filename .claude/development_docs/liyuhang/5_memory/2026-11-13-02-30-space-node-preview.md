# 记忆：画布空格轻点预览选中节点

- 时间：2026-11-13 02:30
- 类型：功能（画布快捷键 + 预览层）

## STAR

**Situation（背景）**
画布节点里的图片/视频只有很小一块，看内容要么开面板要么进播放器。用户想要 Finder 式的「看一眼」。但空格在画布上已经是「按住平移」，直接占用会毁掉核心手势。

**Task（任务）**
在不破坏平移的前提下，用空格轻点预览选中节点的媒体输出；只响应单选；禁用节点也能预览。

**Action（行动）**
- 新增纯函数 `pickNodePreview(node)`：从 `data.outputs` 里按「视频 > 音频 > 图片/掩码」取第一个带 url 的输出，标题取节点名。7 条单测覆盖优先级与空值。
- 按键仲裁放在 `updateCanvasKeys`：keydown 记候选 `{code, at}`，`window` 捕获阶段监听 `pointerdown`/`wheel` 清候选，keyup 同 code 且 ≤400ms 才打开。平移的 pointerdown 天然把候选作废，松手不会误弹。
- 新增 `components/nodePreview.vue`：图片走 `el-image-viewer`，视频/音频走 `el-dialog` + 原生播放器；播放互斥复用 `installMediaPlayback`。
- `canvasShortcuts` 新增 `preview`（默认 Space）与设置项；与 pan 同键不冲突（冲突校验只比对同类手势）。
- 浮层判定补 `.el-image-viewer__wrapper`：查看器不是 `el-dialog`，不加会让预览打开时方向键/删除仍然生效、Esc 还会弹退出确认。
- 切画布/失活时清空预览，避免后台播放器继续解码。

**Result（结果）**
7 单测通过；typecheck 仅剩既有 `@/agentRuntime`；构建成功并同步应用（02:30）；未重启。

## 关键经验

1. 抢占已有快捷键时，先弄清它是「手势键」还是「点按键」：空格在画布里是按住手势，用「轻点/按住」区分比换键更符合习惯。
2. 冲突仲裁要放在输入事件的**捕获阶段**打断：pointerdown 一来就作废候选，比事后判断位移可靠。
3. Element Plus 的图片查看器不是 `el-dialog`，`hasModalOverlay` 这类「按 .el-overlay 扫一遍」的判定会漏，遇到新浮层记得一起补。
4. 预览只读节点输出里已有的 URL，不重新解码/请求，切画布就清掉，避免后台播放器占 GPU。
5. **产物 url 是工作区相对路径，不是可请求地址**：任何把 `output.value.url` 直接塞进 `<img>/<video>/<a>` 的地方都要先过 `useWorkspaceFiles().acquireUrl()`（返回 Promise + `release()`），否则浏览器会按应用根解析成 404。纯函数单测全绿也测不出这一层。
6. `shortcutPressed()` 的语义是「绑定键仍在按住集合里」，只能用于按住类手势；单次点按必须用 `shortcutMatches()`，否则按住某键时按别的键会互相劫持。
7. 多个动作共用同一按键时，冲突校验（面板 + `stores/settings` 的升级兜底）会把它判成冲突并把新动作静默清空；放行白名单要两处共用同一个函数。
