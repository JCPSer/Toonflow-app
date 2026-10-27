# 需求方案：Agent 交互区易用性 + 素材库两项改进

- 记录时间：2026-10-27 17:20
- 对应需求：`1_requirements_matrix/2026-10-27-17-04-agent-ux-and-asset-improvements.md`
- 决策：历史仅当前会话、提及/附件一起恢复；⌘+方向键覆盖对话与节点输入框；macOS 用 osascript 调原生面板；文本节点仅边框动画；素材库拖入改为服务端硬链接（跨盘回退复制）；素材库新增"在访达中显示"

## 一、根因与现状

| 编号 | 根因 | 证据 |
| --- | --- | --- |
| R1 | `messages` 只存在于 `conversation.vue` 本地 ref，`messageInput` 拿不到历史；x-sender 的 `text-updown` 已占用 ↑/↓ | `conversation.vue:109`、`messageInput.vue:79` |
| R2 | x-sender 把不带 Shift 的左右键判为 `text-move` 并 `preventDefault + cursorMove`，不区分 meta/ctrl/alt；`text-updown` 也不判修饰键 | `XSender.mjs` 的 `isKeyType` 与 `_Events` 注册 |
| R3 | electrobun 原生 `openFileDialog` 只透传 canChooseFiles/canChooseDirectories/allowsMultipleSelection，未设置 `canCreateDirectories`；实测 NSOpenPanel 该属性为 false | `apps/desktop/src/index.ts:501`、electrobun v2.0.1 nativeWrapper |
| R4 | 文本节点 `generating` 只驱动发送按钮图标，节点外观无变化 | `packages/nodes/textNode/src/index.vue:102、263` |
| R5 | 拖入链路是"整块读出 → 浏览器再上传"，撞上 `/api/workspaces/files/write` 的 100 MB raw 上限 | `canvasDrop.ts:93-101、128`、`app.ts:54` |
| R6 | 素材库右键菜单没有 reveal 命令；工作区 reveal 路由依赖工作区授权，素材库不能直接复用 | `AssetContextMenu.vue:15-29`、`reveal.ts:14-23` |

## 二、方案总览

1. `conversation.vue` 把当前会话的用户消息传给 `messageInput`（R1）。
2. `messageInput` 在既有捕获阶段键盘处理里加入"历史导航"和"修饰键方向键放行"（R1+R2）；`promptInput` 只加放行逻辑（R2）。
3. 桌面端 `selectDirectory` 在 darwin 分支改用 osascript JXA 创建 NSOpenPanel 并显式开启 `canCreateDirectories`，失败回退原电 electrobun 对话框（R3）。
4. `nodeSkeleton` 新增 `running` prop，class 落在 `.contentCard`，用不占布局的 box-shadow 呼吸动画；文本节点传 `generating`（R4）。
5. 新增 `POST /api/assets/copyToWorkspace`：服务端 `link()` 硬链接，跨盘/不支持时回退 `copyFile`；前端拖拽改调该接口，不再中转文件（R5）。
6. 新增 `POST /api/assets/reveal`：解析库内相对路径后调 `desktop.showItemInFolder`；素材库右键菜单按平台显示（R6）。

## 三、详细方案

### 3.1 R1 历史消息

**数据流**
- `conversation.vue` 新增 computed：`historyMessages = messages.filter(m => m.role === "user" && !m.error)`，按时间正序传给 `messageInput` 的新 prop `history?: AgentMessage[]`。
- 历史项包含 `content/mentions/attachments`，恢复时用新增的 `restoreHistory`（重建提及 token、还原附件），保证提及/附件一起还原。
- 相邻重复 content 在构建时去重（只保留一条）。

**状态机（messageInput 内）**
```
historyIndex: number | null = null     // null = 不在历史模式；0..n-1 表示当前项
historyToken: number = 0               // 程序填充的序号，用于忽略自身触发的 change（布尔会被异步链打穿）

进入条件（↑）：
  未锁定、编辑器聚焦、未在历史模式、非编辑态、未在输入法组合
  draft 为空：getText().trim()==="" 且 draftMentions.length===0 且 draftAttachments.length===0
  history.length > 0
历史模式内（↑/↓）：
  不再要求草稿为空（inHistory 优先），但仍排除输入法组合
  ↑ → index = max(0, index-1) → 还原
  ↓ → index+1；越界 → 用 restoreHistory("", [], []) 清空并退出
退出点：发送（EVENT_COMMON_SEND）、clearDraft、失焦、Esc、用户手动编辑
```
- 不复用 `fillRewind`：它会清 `editingId` 且不处理 `editDraft`。新增 `restoreHistory(content, attachments, mentions)`，只重置草稿与焦点，不动编辑态。
- 程序填充前 `historyToken++`，CHANGE 回调里比对 token，避免把"填充触发的异步 change"当成用户编辑而退出历史模式。
- 连续按 ↑ 用 promise 串行，避免 `reset()` 未完成时重复填充。
- 去重按 `content + mentions(按 id) + attachments(按 name/mimeType/大小)` 的完整身份，避免吞掉"同文不同提及/附件"。
- 编辑态（`editingId`）下不触发历史，避免与"编辑消息"冲突。

**键位处理顺序（messageInput 现有 handleSenderKeydown 内）**
1. 行内提及按钮的 Enter/Space → 原逻辑。
2. `mentionMenu.handleKeydown` 返回 true → 直接返回（菜单优先）。
3. `skillMenu.handleKeydown`，若 `event.defaultPrevented` → 返回。
4. 修饰键方向键（R2）→ `stopPropagation()`，不 `preventDefault`。
5. 非修饰 ↑ 且满足进入/历史模式 → `preventDefault + stopPropagation` 后导航。
6. 其余保持原样。

### 3.2 R2 ⌘+方向键

**原则**：只要带修饰键（meta/ctrl/alt），就不让 x-sender 接管，交给 WebKit/WebView2 原生编辑命令；原有 @/斜杠菜单因为第 2/3 步先执行，不受影响。

**键位矩阵**

| 组合 | 行为 | 处理 |
| --- | --- | --- |
| ⌘←/→ | 行首 / 行尾 | 放行原生 |
| ⌘↑/↓ | 文首 / 文末 | 放行原生 |
| ⌘⇧←/→/↑/↓ | 选中到行首尾/文首尾 | 放行原生 |
| Ctrl+←/→（Windows） | 按词移动 | 放行原生 |
| Alt+←/→ | 按词移动（macOS） | 放行原生 |
| 无修饰 ↑/↓ | 菜单导航 / 历史 / x-sender 原有跳转 | 按 3.1 顺序 |

**实现位置**
- `messageInput.vue`：在 `.senderEditor` 的 `@keydown.capture` 处理器中加分支。该处理器位于 `chatElement.richText`（即 x-sender `ChatEditor.$el`）的祖先，捕获阶段先于其冒泡监听。
- `promptInput.vue`：修饰键分支必须放在 `handleMentionKey` 的最前面（现有实现先按 key 白名单/浮层可见性 return，放后面会被漏掉）。
- 谓词只有一行（`event.metaKey || event.ctrlKey || event.altKey`），两处各自内联，不为它新增跨包依赖/改 lockfile。

**注意**
- 只 `stopPropagation`，绝不 `preventDefault`，否则原生光标移动也被取消。
- 输入法组合中（`isComposing || keyCode===229`）不处理。
- stopPropagation 会连带挡住 x-sender 挂在 window 上的候选浮层按键；⌘←/→ 不关闭浮层可接受，记录为已知行为。
- keyup 时现有 `updateCursor()` 会刷新提及查询，光标缓存随之更新；无需额外同步。

### 3.3 R3 原生目录面板支持新建文件夹

**改造点**：`apps/desktop/src/index.ts` 的 `selectDirectory()`。

```
selectDirectory():
  if platform === darwin:
    result = await chooseMacFolder()   // undefined = 脚本失败/超时；null = 用户取消；字符串 = 路径
    if result !== undefined: return result
  return Utils.openFileDialog({ canChooseFiles:false, canChooseDirectory:true, ... })
```

`chooseMacFolder()` 用现有 `execFileAsync` 调 `/usr/bin/osascript -l JavaScript -e <script>`，`timeout: 10_000`：

```
ObjC.import('AppKit')
panel = $.NSOpenPanel.openPanel
panel.canChooseFiles = false
panel.canChooseDirectories = true
panel.canCreateDirectories = true          // 关键：补上"新建文件夹"
panel.allowsMultipleSelection = false
panel.resolveAliases = true
response = panel.runModal
if response != $.NSModalResponseOK: print("")      // 取消
else: print(ObjC.unwrap(panel.URLs.objectAtIndex(0).path))
```

- 取消：stdout 为空 → 返回 `null`（不是 `""`）。
- 成功：`stdout.trim()` 后 `realpath`；`realpath` 失败（目录已消失）→ 返回 `null` 并提示重选。
- 进程报错、超时、非零退出：返回 `undefined`，调用点回退 electrobun 原对话框。
- 不传 prompt 文案，避免桌面主进程没有 i18n 时中英混排。
- osascript 进程非 GUI 应用，`activateIgnoringOtherApps` 无意义且不应调用；弹窗层级按系统默认。
- 风险：企业策略禁用 osascript 时会走回退分支；不涉及控制其他 App，不应触发 TCC 自动化授权。

**Windows**：保持 `Utils.openFileDialog`，IFileOpenDialog 自带新建文件夹。

### 3.4 R4 文本节点运行态边框

**nodeSkeleton**
- props 增加 `running?: boolean`（`withDefaults` 默认 false）。
- 根节点 class 增加 `running`（与现有 `documentNode` 同级）。
- 样式：`.nodeSkeleton.running .contentCard` 用 `box-shadow` 呼吸动画（2px 主色 → 6px 透明），`animation: nodeRunning 1.6s ease-in-out infinite`；不改 border/尺寸，避免覆盖 `selected` 的 `border-color` 与布局抖动。
- `@media (prefers-reduced-motion: reduce)` 下改为静态 2px 描边（沿用文件内既有 reduced-motion 写法）。

**textNode**
- `<nodeSkeleton v-bind="nodeProps" ... :running="generating">`，`running` 必须写在 `v-bind` **之后**，否则会被 nodeProps 覆盖。
- `generating` 已覆盖"思考（等待首个 reasoning/text 事件）→ 流式 → 失败/停止收尾"，无需新增状态。
- 其他节点不传该 prop，行为不变。

### 3.5 R5 素材库拖入画布：服务端硬链接

**新增接口** `POST /api/assets/copyToWorkspace`
```
body（在 validateAssetFields 的 strictObject 里显式声明）:
  { library?, directory?, path, workspaceDirectory, nodeId }
1. requestLibrary(req, {library, directory})         // 复用库根解析与守卫
2. assertAssetRelativePath(path)
3. source = 现有素材存在性校验（assertAssetExists / resolveWorkspacePath 二选一，优先复用已有函数）
4. 校验 source 是普通文件（拒绝符号链接/目录）
5. 目标工作区：
   - project 库：以 library.workspace 为准；请求里的 workspaceDirectory 必须与之一致，否则 400
   - global 库：resolveWorkspace(req, workspaceDirectory)
6. nodeId 用 /^[A-Za-z0-9_-]{1,64}$/；targetRelative = `assets/${nodeId}/${uuid}${ext}`
7. resolved = resolveWorkspacePath(root, targetRelative, true)   // allowMissingParents
   mkdir(dirname(resolved.path), recursive)
8. lockWorkspaceFiles([resolved.path]) 包住写操作
9. try link(source, resolved.path)
   catch EXDEV/EPERM/EACCES/EMLINK/ENOSYS/EOPNOTSUPP → copyFile(source, resolved.path, COPYFILE_EXCL)
10. 失败 unlink 半成品
11. res.json(success({ path: targetRelative, name, size }))
```

**前端 canvasDrop**
- 新增 `copyAssetToWorkspace(assetSource, nodeId)`（带 `x-toonflow-workspace: 1`），返回工作区相对路径。
- `importCanvasFiles` 增加可选参数 `preparedPaths?: (string | undefined)[]`：
  - 有对应值时跳过 `uploadNodeFile`，直接用该路径建节点；
  - 无值时保持原逻辑（粘贴、系统文件拖入不受影响）。
- 文本类素材仍走 `GET /api/assets/read` → `file.text()` → 内联 textSnapshot（体积小，且需要正文）。
- 节点创建失败时用返回的 `path` 调 `files.remove` 清理，与现有 `copiedPath` 兜底一致。
- 网络错误提示原样透出服务端 message。

**硬链接语义**
- 同盘零额外空间；素材库删除/改名不影响工作区文件（链接仍持有一份数据）。
- 通过 App 编辑库内文件走 `writeAtomic`（临时文件 + rename），会换成新 inode，**不会**影响已拖入的节点；这与"实时同步"相反，需在文档中写清。
- 跨盘（EXDEV）自动回退复制，大小不受 100 MB 请求体限制（服务端 `copyFile` 无请求体）；复制同样加 `lockWorkspaceFiles` 防并发。
- Windows NTFS 支持硬链接；FAT/exFAT 回退复制。

**已知边界**
- 素材库自身的 save/import 仍受 `maxAssetBytes = 100 MB` 限制；174 MB 素材只可能来自"外部放入库目录/磁盘同步"这类路径，本轮的直拷接口对这类库内文件不设上限。库内上传上限不在本轮范围。

### 3.6 R6 素材库"在访达中显示"

**新增接口** `POST /api/assets/reveal`
```
body: { library?, directory?, path }
1. u.workspace.isLocalWorkspaceRequest(req) 必须为真，否则 403
   （远程浏览器 Origin host 与 req.host 相同，同源校验不足以拦住）
2. 仅桌面运行时或 nativeDevelopment 本机访问，否则 403（与 workspaces/files/reveal 一致）
3. requestLibrary(req, {library, directory}, false, {create:false})
4. assertAssetRelativePath(path) → resolveWorkspacePath(library.root, path)
5. lstat 存在后：
   desktop ? desktop.showItemInFolder(target)
           : spawn(平台命令)   // 仅 nativeDevelopment 分支
6. 返回 success
```

**前端**
- `AssetContextMenu` 增加 prop `canReveal`（默认 false）与命令 `reveal-in-os`，文案按平台："在访达中显示" / "在资源管理器中显示"。
- `assetLibrary/index.vue` 计算 `canReveal = !isMobile && !isRemoteConnection`（与文档文件树的"以资源管理器打开"保持一致；本机 dev 网页走 nativeDevelopment 分支可用），传给菜单；命令处理器调用 `api.revealEntryInOs(entry)`。
- 现有 `useAssetLibrary.revealEntry` 是"库内定位/选中"，命名冲突，新函数用 `revealEntryInOs`。
- 背景（空白处）菜单不加该命令，避免"根目录路径为空"的歧义。
- 远程/移动端因 `canReveal=false` 自动隐藏；无桌面运行时的网页端即便手动调用也会被双重守卫拦住。

## 四、兼容性与回滚

| 项 | 回滚方式 |
| --- | --- |
| R1/R2 | 纯前端，撤掉键盘分支即可；不影响既有发送链路 |
| R3 | 删除 darwin 分支即回到 electrobun 原生对话框 |
| R4 | `running` 默认 false，不传即无动画 |
| R5 | 前端改回 `assets/read + upload` 即可；新接口可保留不用 |
| R6 | 菜单项由 `canReveal` 控制，置 false 即隐藏 |

## 五、测试方案

1. 类型检查：`apps/web`、`apps/desktop`、`packages/nodes/textNode`、`packages/nodeScaffold`、`packages/nodeShared`、`apps/server`。
2. R1：空输入框 ↑/↓ 往返；连续重复去重；仅提及/仅附件/提及+附件消息还原后能正常发送；非空草稿不触发；编辑态不触发；发送/clearDraft/失焦/Esc 后 historyIndex 复位；rewind 后消息数组变化时历史仍正确。
3. R2：对话输入框与节点输入框分别验证 ⌘←/→/↑/↓、⌘⇧ 组合；@ 菜单展开时 ↑/↓ 仍切换选项；输入法组合期间不干预。
4. R3：macOS 打包版点"选择工作目录"，确认面板有"新建文件夹"、新建后可直接选中；取消返回 null；脚本超时/非零退出回退旧对话框；含空格路径正常；Windows 构建不受影响。
5. R4：文本节点生成全过程出现边框动画，停止/失败后消失；`prefers-reduced-motion` 下为静态描边；选中态边框不被覆盖。
6. R5：174 MB 视频从素材库拖入画布成功；`ls -i` 校验同盘 inode 相同；模拟跨盘（EXDEV）回退复制；并发拖入触发 EBUSY；目标已存在（EEXIST）不覆盖；project 库串库请求被拒；节点删除清理链接；文本素材仍走原路径；粘贴/系统文件拖入回归。
7. R6：素材右键"在访达中显示"选中文件/文件夹；Windows 文案为"在资源管理器中显示"；远程连接与移动端不显示；远程浏览器直接调接口返回 403；`.trash`/`.library` 路径被拒。
8. 回归：素材库上传/下载/删除/移动、项目切换、素材库同步。

注：`apps/web` 没有测试框架与 test 脚本，"单测覆盖"不可执行，以上以手测 + 类型检查为准。

## 六、风险

| 风险 | 处置 |
| --- | --- |
| osascript 弹窗不置顶 / 企业策略禁用 osascript | 失败自动回退 electrobun 对话框；超时 10s；记录日志 |
| 硬链接使工作区与库共享 inode | App 内编辑库文件走 writeAtomic 会换 inode，不影响已拖入节点；库内删除不影响工作区（链接仍在），语义需在文档中写明 |
| 跨盘复制大文件耗时/占用空间 | 服务端流式 copyFile，无内存峰值；加工作区文件锁避免并发冲突；ENOSPC 时如实报错 |
| x-sender 升级后捕获顺序变化 | 手动回归 + 类型检查；锁定依赖版本 1.4.6 |
| 高 DPI/长文本下动画影响性能 | 仅 box-shadow 动画，无布局属性；reduced-motion 降级 |
| 远程浏览器绕过同源校验调 reveal | 双重守卫：isLocalWorkspaceRequest + desktop/nativeDevelopment |

## 七、评审意见

- 子 agent 方案评审（2026-10-27 17:40）：
  - R1：`fillRewind` 会清 `editingId`、不处理 `editDraft`，且 `reset()` 的 change 是异步链，布尔标志会被打穿；越界 ↓ 不能用 `clearDraft`（默认清历史）。已改为独立 `restoreHistory` + 递增 token + 明确退出点；去重改为完整身份。采纳。
  - R2：捕获顺序成立；但 `promptInput` 的修饰键分支必须放在 key 白名单之前，且跨包共享需要改 3 个文件 + lockfile，不划算。已改为两处内联一行谓词，并记录"不关闭候选浮层"的既有行为。采纳。
  - R3：JXA 里 `POSIX path of` 是 AppleScript 语法，会直接语法错误；`activateIgnoringOtherApps` 在 osascript 进程无意义；取消与失败必须区分 null/undefined。已重写脚本与回退判定。采纳。
  - R4：`running` 必须写在 `v-bind="nodeProps"` 之后；class 落根节点而非内容卡。已统一。采纳。
  - R5：`resolveWorkspacePath` 返回对象且目标不存在需 `allowMissingParents`；strictObject 需显式声明新字段；前端要带 workspace 头；project 库要校验 workspace 一致；`writeAtomic` 换 inode 而非实时同步；复制也要加锁；`importCanvasFiles` 需要新增预拷贝入参；路由编号从 162 起。已全部写入方案。采纳。
  - R6：必须补 `isLocalWorkspaceRequest`（同源校验挡不住远程浏览器）；Windows 文案/命令要区分；`canReveal` 与文件树保持一致；新命令命名避开已有 `revealEntry`。已采纳。
  - 测试：`apps/web` 无测试框架，"单测覆盖"不可执行，已改为手测清单；并补齐 IME、并发、跨盘、串库、远程 403 等用例。
- 用户评审：2026-10-27 17:45 通过，按本方案实现（6 项全部纳入本轮）。
