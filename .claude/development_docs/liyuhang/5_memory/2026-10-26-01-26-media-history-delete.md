# 历史记录弹窗支持删除（STAR）

## Situation

图片/视频节点的「历史记录」只列不删，每跑一次多一个文件，用户无法清理。要求加删除功能，并明确：单条删除、当前结果也能删但要把节点结果一并清空、直接删不做确认。

## Task

在共用弹窗 `mediaHistory.vue` 上增加单条删除，删除物理文件并保持列表、预览、分页、节点输出一致。

## Action

- `mediaHistory.vue`
  - 新增 `deleting` / `actionError` 状态与 `clear` 事件；`actionError` 与列表加载错误分开显示。
  - 列表行改为「包裹 div + 文件名按钮 + 删除图标按钮」的兄弟结构（`<button>` 不能嵌套），图标悬停/聚焦时显现，行文本右侧留 34px。
  - 底部左侧加 `type="danger" plain` 删除按钮，`deleting` 时 loading；右侧保留关闭/设为当前结果。
  - `removeItem()`：先记录 index → `workspace.remove(url)`（`ENOENT` 静默收敛）→ 若是当前结果先 `emit("clear")` → 列表移除、选中取 `remaining[min(index, len-1)]`、页码取 `min(page, maxPage)`。
- `videoGenerationNode`：`@clear="outputs.video = undefined"`；`imageGenerationNode`：`@clear="outputs.image = undefined"`。`nodeSkeleton` 的 `watchEffect` 把 outputs 同步进 `node.data.outputs`，清空后重开画布不会恢复悬空引用。

## Result

- 实机验证：删非当前项只删文件；删当前项同时把 `nodes[].data.outputs` 变成 `{}`、节点回空态、依赖输出的按钮全部置灰；删到最后一条切「暂无历史记录」空态，底部按钮正确 disabled。
- 两个节点类型检查通过，`bun run build:nodes` 通过，dev 与 app 实例下发的新包都含删除逻辑。

## 返工（审查后）

- **跨节点文件必须挡**：复制/粘贴节点只换 ID 不复制 `assets`，副本的历史里唯一一行就是原节点文件且默认选中，一次点击就能删掉别人的素材。加 `isOwned()`（`assets/<本节点id>/` 前缀）校验，非归属行与底部按钮都禁用并说明原因。
- **footer slot 不是 `.mediaHistory` 的后代**：Element Plus 的 `#footer` 渲染在 `.el-dialog__footer`，scoped 嵌套选择器永远不匹配，表现为删除按钮另起一行右对齐。样式必须写在 style 顶层。
- 触屏无 hover 但隐藏按钮仍可命中 → `@media (hover: none)` 常显；删除非选中项不应改动当前预览 → 记住选中 url 优先沿用；删除期间禁用关闭与设为当前结果；跨弹窗关闭用 `actionToken` 代际校验。

## 经验

- 历史文件的 `url` 就是工作区相对路径，`WorkspaceFiles.remove()` 直接可用，不需要新接口；节点素材目录不属于受保护的 library 路径。
- 「删除当前结果」不是一个 UI 事件，而是两件事：删文件 + 清节点输出。只做前者会留下悬空引用，画布 JSON 里还能看到指向已删文件的 url。
- 行内删除图标不能塞进已有的 `<button>` 列表项里，必须把行拆成包裹层 + 两个兄弟按钮，否则 HTML 非法、点击会互相吞掉。
- 节点目录的“所有权”是隐式的：`assets/<nodeId>` 是唯一约定，复制节点不复制文件，任何按文件路径做破坏性操作的入口都要先校验归属。
