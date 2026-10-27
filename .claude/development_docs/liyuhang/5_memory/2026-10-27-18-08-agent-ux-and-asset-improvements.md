# 记忆：Agent 交互区易用性 + 素材库大文件拖入 / 访达定位

## Situation

Agent 交互区有四类高频摩擦：输入框不能像终端那样用 ↑/↓ 找回刚发过的消息；x-sender 1.4.6 把不带 Shift 的左右键判为 `text-move` 并 `preventDefault + cursorMove`（不判 meta/ctrl/alt），导致 macOS ⌘←/→、⌘↑/↓ 失效；macOS 新建项目走 electrobun 预编译原生面板，未开启 `canCreateDirectories`，没有"新建文件夹"；文本节点用 `runAgentLoop` 生成，但节点外观在思考/生成期间毫无变化。素材库侧：174 MB 视频从素材库拖到画布时，前端先整块 `GET /api/assets/read` 再 `uploadNodeFile`，撞上 Express raw 100 MB 上限报 entity too large；右键菜单也没有"在访达中显示"。

## Task

六件事一起收：输入框历史导航（当前会话、提及/附件一起还原）；⌘+方向键（对话输入框 + 节点提示词输入框）；macOS 原生面板支持新建文件夹；文本节点运行态边框动画；素材库拖入改服务端硬链接（跨盘回退复制）；素材库右键访达定位。

## Action

- **历史导航**：`conversation.vue` 计算 `historyMessages`（仅当前会话用户消息，按 content+提及 id+附件的完整身份去重相邻项）传给 `messageInput`。新增 `restoreHistory()` 而不是复用 `fillRewind`（后者会清 `editingId`）；索引同步推进、`reset` 放进 promise 队列；用 `historyFilling` + 多等一帧的 `nextTick` 屏蔽程序填充触发的 change；排队时按消息 id 找回，列表被压缩/删除缩短时先夹回范围。退出点：发送、clearDraft、失焦、Esc、用户编辑、切会话。
- **⌘+方向键**：在 `.senderEditor` / `.promptInput` 的捕获阶段对带 meta/ctrl/alt 的方向键只 `stopPropagation` 不 `preventDefault`，让 WebKit/WebView2 走原生行首/文首/按词；x-sender 的 keydown 绑在 `chatElement.richText` 冒泡阶段，祖先捕获能拦住。菜单优先（mention/skill handleKeydown 先执行），输入法组合期间不接管。
- **原生面板**：`apps/desktop/src/index.ts` 新增 `chooseMacFolder()`，用 `execFileAsync` 跑 `osascript -l JavaScript`，JXA 里 `$.NSOpenPanel.openPanel` 设 `canCreateDirectories = true` 后 `runModal`；取消返回 `null`、脚本失败返回 `undefined` 才回退 electrobun 面板；不设超时（用户可能慢慢新建文件夹）。
- **文本节点**：`nodeSkeleton` 新增 `running` prop，根 class 落 `running`，`.running .contentCard` 用 box-shadow 呼吸动画（不改 border/尺寸，避免覆盖 selected），reduced-motion 降级静态描边；textNode 在 `v-bind="nodeProps"` 之后传 `:running="generating"`。注意该组件 style 是普通 CSS，注释必须用 `/* */`。
- **素材库拖入**：新增 `POST /api/assets/copyToWorkspace`（strictObject 声明 library/directory/path/workspaceDirectory/nodeId；requestLibrary + assertAssetRelativePath + resolveWorkspacePath + lstat 普通文件；project 库强制 workspace 一致；目标 `assets/<nodeId>/<uuid><ext>`，allowMissingParents + mkdir + `lockWorkspaceFiles`；`link()` 失败按 EXDEV/EPERM/EACCES/EMLINK/ENOSYS/EOPNOTSUPP 回退 `copyFile(COPYFILE_EXCL)`；失败 unlink 清理）。前端媒体素材不再下载，直接调接口拿路径建节点；`importCanvasFiles` 加 `prepared` 入参，取消/失败按 `assets/<nodeId>` 目录兜底清理。
- **访达定位**：新增 `POST /api/assets/reveal`，`isLocalWorkspaceRequest` + desktop/nativeDevelopment 双重守卫，`desktop.showItemInFolder` 或 `open -R` / `explorer /select`；菜单 `canReveal = isDesktop && !isRemoteConnection`，文案按平台。
- 路由手工追加 `route162/route163`（route51 已被占用），未重排编号。

## Result

`server/desktop/nodes-scaffold/node-text/node-shared` typecheck 全 0；web 仅剩仓库既有的 `@/agent/runtime/types` 路径别名报错（HEAD 同样存在）。web 构建成功、节点包构建成功、桌面入口 23,551,977 B 并已部署到 `/Applications`。隔离实例实测：200 MB 视频 copyToWorkspace 返回 200 且源/目标 inode 相同（107629533），nodeId 非法 400、素材缺失 404、reveal 无 Origin 403、内部目录 403。代码审查发现的高/中问题（osascript 超时、普通浏览器露出菜单、abort 孤儿文件、历史索引错位、IME）已修并复检。跨盘回退、访达实际弹出、⌘ 方向键的真实 WebView 行为仍待手测。
