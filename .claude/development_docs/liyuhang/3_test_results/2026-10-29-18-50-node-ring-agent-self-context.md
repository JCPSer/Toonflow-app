# 测试记录：全节点呼吸描边 + Agent 上游 self 摘要

- 时间：2026-10-29 18:50
- 关联：`2_requirements_solutions/2026-10-29-18-12-agent-upstream-context.md`

## 一、全节点呼吸描边

### 改动

`packages/nodeScaffold/src/nodeSkeleton.vue`：`running` 类改由 `ringActive` 驱动，来源是 `props.busy ∪ props.running`，并加 400ms 延迟；组件卸载清定时器。

### 覆盖核对

| 节点 | busy 表达式 | 是否覆盖 |
| --- | --- | --- |
| agentNode | thinking / running / compacting | 是（原本已传 running） |
| textNode | generating | 是（原本已传 running） |
| imageGenerationNode | generating \|\| cropping | 是 |
| imageNode | cropping / uploading / scaling / editor / lighting / multiAngle / panorama / gridSplit / inpaint | 是 |
| videoGenerationNode | generating \|\| actions.processing | 是 |
| videoNode | exporting \|\| uploading \|\| actions.processing | 是 |
| audioGenerationNode | generating \|\| transcribing \|\| actions.processing | 是 |
| audioNode | transcribing \|\| actions.processing | 是 |
| director3dNode | exportingVideo \|\| exportingImage \|\| tasks 未完成 | 是 |
| frameAnalysisNode | processing \|\| uploading | 是 |

### 构建产物核对

`/Applications/toonflow-exec.app/Contents/Resources/app/nodes/videoGenerationNode.umd.js` 中：

- 类绑定为 `documentNode:A.value,running:D.value`（已改成 ref 驱动）；
- 存在 `setTimeout(()=>{D.value=!0},400)`（延迟生效）。

10 个节点包全部重新打包并同步到 `Resources/app/nodes` 与 `toonflow-data/nodes`。

### 待重启验证

节点包由应用启动时加载，**必须重启应用**才能看到描边。重启后逐项看：图片生成中、视频生成中、视频导出中、音频转写中应出现呼吸描边；裁剪一个 0.5 秒的操作不应闪。

## 二、Agent 上游 self 摘要

### 单元验证

用 bun 直接跑 `createNodeMention`（不经过应用）：

| 用例 | 结果 |
| --- | --- |
| 文本节点（300 字快照） | `self.outputId=text`，`preview` 截到 150 字 + `…`，`dataType=STRING` |
| 图片节点 | `self.path=assets/chat/a.png`，`mimeType=image/png`，`preview=a.png` |
| 空文本节点 | 无 `self`，只有 `upstream: []`（不生成空块） |
| Agent 节点（两个上游） | `upstream` 两项各带 150 字预览；自身无输出故无 `self` |
| 文本节点带 textPath 走文件 | 分支已覆盖，按 `readText` 读取后同样截断到 150 字 |

命令：`bun /tmp/checkSelfMention.ts`（临时脚本，未入库）。

### 构建与部署

- `bun run --filter '@toonflow/server' --filter '@toonflow/nodes-scaffold' typecheck`：通过。
- `bun run --filter '@toonflow/web' typecheck`：失败，但错误在 `apps/server/src/modules/agentAccess/singleAgent/types.ts(2,33) Cannot find module '@/agentRuntime'`，是既有问题（该文件 10-27 提交，`@/agentRuntime` 是服务端 tsconfig 别名，web 侧没有），与本次改动无关。vite build 正常。
- `./scripts/deploy-local.sh --build`：web + server + 桌面入口 + 10 个节点包全部更新。

### 待重启验证

服务端改动随桌面入口打包，需重启应用。重启后：

1. 文本节点连 Agent，发「这段讲什么」，看模型能否复述前 150 字；
2. 改上游正文再发一条，看是否是新内容；
3. 图片节点连入，确认提及里是路径不是二进制；
4. 设置 → 通用 → 关掉「Agent 上游上下文」，再发一条，确认不再自动带上游；
5. 检查用户气泡与历史回放没有 JSON。

## 三、代码审查整改（19:10）

终审结论「修完可通过」，四条必须修改项已全部处理：

| 审查项 | 问题 | 整改 |
| --- | --- | --- |
| R3 不成立 | 提及只在打开面板/连线变化时构建一次，改了上游正文再发还是旧快照 | `conversation.vue` 的 `extraMentions` 改成 `loadExtraMentions()` 提供者，在**发送这一刻**现取；`agentNodePanel` 删除 250ms 去抖 watcher 与 `entry.mentions` |
| R6 不生效 | 关掉开关时面板里已有提及仍会被带出去 | 开关判断在 `buildMentions` 每次调用时现读，发送时才调用 → 关闭后下一轮立即不带上游 |
| 图片生成节点漏 busy | `:busy="generating \|\| cropping"`，打光/多角度/全景/宫格/上传/重绘都不亮 | 对齐 `imageNode` 全量口径；另外补 `uploading` 到 videoGeneration / audioGeneration / audioNode |
| 提示词误导 | 基础句说"value 是 { path, mimeType }、不含原文"，但文本引用带 summary | 明确写出 summary 只是摘录、可能被截断 |

另外采纳的建议：

- `self.preview` 为空（纯空白文本）时不生成 self；
- `self.path` 只接受工作区相对路径，绝对路径 / `../` / 协议 URL 一律丢弃（只留摘要）；
- `outputId` 截到 256、`outputName` 截到 160、路径上限 1024；
- `createNodeMention` 的 upstream / self / extra 改为并发；
- 呼吸描边亮起后至少保持 600ms，避免 500ms 的操作"第 400ms 亮、第 500ms 灭"的闪屏；
- `mentionContent.vue` 的节点引用预览新增「本节点输出」区块，空状态文案同步更新；
- `buildMentions` 取数前先 `flushCanvasSave()`（画布层新 provide），避免防抖窗口内读到旧画布。

### 整改后单元复验

| 用例 | 结果 |
| --- | --- |
| `textPath="../../etc/passwd"` | self 保留摘要，**path 被丢弃** |
| `url="https://evil.example/x.png"` | self 保留文件名，**path 被丢弃** |
| `textSnapshot="   \n  "` | 不生成 self |
| 正常文本 / 图片 / Agent 上游 | 与首次验证一致 |

`@toonflow/server`、`@toonflow/nodes-scaffold` typecheck 通过；web vite build 通过；`./scripts/deploy-local.sh --build` 完成，10 个节点包已同步。

### 已知未做（记录在案）

- 文本上游摘要每次整文件读取（上限 400KB），20 个上游最坏 8MB/轮；未加按 mtime 的摘要缓存。
- `director3dNode` 的 `modelLoading` 未计入 busy（每次挂载都为 true，计入会误亮）。

