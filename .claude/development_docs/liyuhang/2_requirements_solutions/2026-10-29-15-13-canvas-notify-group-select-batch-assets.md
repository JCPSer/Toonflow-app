# 需求方案：节点提醒（音/通知）、分组框选语义、批量入素材库（v2 · 初审后修订）

- 记录时间：2026-10-29 15:13（v2 修订 16:05）
- 关联需求：`1_requirements_matrix/2026-10-29-15-07-canvas-notify-group-select-batch-assets.md`
- v2 变更：按子 agent 初审结论修订失败事件时序、取消语义、重名策略、补丁落地流程、标题栏几何；并记录 2026-10-29 16:00 的四项用户决策。

## 0. 关键事实（已回代码核对）

| 事实 | 位置 |
| --- | --- |
| 无统一「节点完成」事件；图片/视频轮询、文本 SSE、Agent NDJSON | `packages/nodeScaffold/src/nodeAi.ts`、`apps/server/src/routes/agent.ts` |
| 所有内置节点都经过 `nodeSkeleton` 的 `busy`（10 个节点包全部传了 busy） | `packages/nodeScaffold/src/nodeSkeleton.vue:286` |
| 全局运行登记表 `Symbol.for("toonflow.busyNodes")`，每个节点 UMD 内联一份实现 | `packages/nodeScaffold/src/nodeBusy.ts`、`build/nodes/*.umd.js` |
| 生成失败时 `status="failed"` 先变，外层 catch 的 `showNodeError` 后跑（微任务竞态） | `packages/nodeShared/src/useNodeGeneration.ts:33-40` |
| `useNodeGeneration.run` 内已能区分 `AbortError`（取消）与真实失败 | 同上：34-38 |
| Agent 等回答 = `askUser` 工具阻塞，事件 `{type:"question"}` | `apps/server/src/agent/bridge/question.ts:30`、`conversation.vue:798` |
| 画布已有 Agent 提问横幅 + `openAgentQuestion` | `canvas/index.vue:77-100` |
| 桌面通知 `Utils.showNotification({title,body,subtitle,silent})`，无点击回调 | `.hutch/devkit/api/sdks/main/core/Utils.ts:119` |
| `__electrobunSendToHost` 由 SDK 运行时 preload 全局注入，远程模式同样可用 | `.hutch/devkit/api/preload/index.ts:68`、`native.ts:136-145` |
| 设置项是 computed 归一化层，缺字段时由前端补默认；服务端不校验 general 内部字段 | `stores/settings.ts:51-81`、`routes/settings/save.ts:9-28` |
| 框选是 Vue Flow 内建 marquee；`onPointerMove` 在 8303-8362，选中集合赋值在 8321-8325，边集合清空在 8326 | `node_modules/@vue-flow/core/dist/vue-flow-core.mjs` |
| 分组是普通可选节点，`SelectionMode.Partial` 决定「擦到即选」 | 同上 `getNodesInside` 3735 |
| 组内空白不框选，因为 `event.target !== container` | 同上 8291 |
| 仓库已有 bun patchedDependencies 机制 | `package.json:17-19`、`patches/vueFlowCore.patch` |
| 素材库导入接口 `importAsset`，服务端**自动改名** `xxx (2).ext` 而非返回 409 | `assetLibrary/api.ts:285`、`assets/library.ts:574-612` |
| 节点「当前产物」= `node.data.outputs[handleId].value.url` | `nodeSkeleton.vue:650`、`mediaHistory.vue:104` |

## 1. R1 + R2 节点提醒

### 1.0 用户决策（2026-10-29 16:00）

- 手动停止：**不响**、不发通知（按验收第 2 条）。
- 失败识别范围：只覆盖**生成类（图片/视频/音频生成）+ Agent**；其他节点的失败按普通完成处理。
- 阈值：单次运行 > 30 秒才提醒。
- 提示音：WebAudio 合成；成功上行双音、失败下行双音；1 秒内合并。
- 前台是否响：设置项三态（总是 / 仅后台 / 关闭）。
- 系统通知：仅桌面应用；三类事件；无点击回调，定位交给横幅。

### 1.1 结构

```
节点包(UMD)                              宿主(apps/web)                        主进程(desktop)
nodeBusy.ts ──window CustomEvent──▶ taskAlerts.ts ──┬─▶ chime.ts (WebAudio)
(起点/结束/结果)  "toonflow:node-task"   (≥30s、合并)  ├─▶ desktopNotify.ts ──host message──▶ Utils.showNotification
useNodeGeneration.run ──结果上报──▶     同上          └─▶ stores/taskAlerts (未读)
conversation/agentNodePanel ──失败/提问──┘                     └─▶ 画布横幅（点击定位）
```

### 1.2 节点任务信号（`packages/nodeScaffold/src/nodeBusy.ts`）

- 结构改为 `Map<string, { startedAt: number; outcome: "succeeded" | "failed" | "cancelled"; reason?: string }>`。
  - `markNodeBusy(id, true)`：首次登记时写 `startedAt`；已登记则忽略（当前 busy 是 boolean，不存在引用计数，删除原「引用计数」描述）。
  - `markNodeBusy(id, false)`：条目存在才处理，算 `durationMs`，派发 `toonflow:node-task`（`{ nodeId, ok, cancelled, durationMs }`），然后删条目。
  - 新增 `markNodeOutcome(id, outcome, reason?)`：**只改标记，不派发**。必须在 `busy=false` 之前调用。
  - `clearNodeBusy(id)`：只删条目，不派发（卸载/删节点/切项目时不该补一条完成）。
  - `hasRunningNodes` / `pruneBusyNodes` 只读 key，改为对象不影响。
- 派发前加 `typeof window !== "undefined"` 守卫；`CustomEvent` 用 `window` 派发（节点 UMD 由 `<script>` 注入 window 上下文，无 SSR，但守卫成本为零）。
- 结果默认 `succeeded`；只有显式 `markNodeOutcome` 才会是 failed/cancelled。

### 1.3 结果上报（解决时序竞态）

`packages/nodeShared/src/useNodeGeneration.ts` 的 `run()` 增参 `report?: (outcome, reason) => void`（由节点传入自己的 nodeId 包装），在 catch 里**先上报再改 status**：

```
catch (failure):
    report(AbortError ? "cancelled" : "failed", message)   // 必须在 status 变化之前
    status = "failed"
    error   = ...
    throw failure
```

- 这样 `generating=false` → busy 下降沿读取到的 outcome 已经正确，不再依赖两个微任务的先后。
- 三个调用点补 nodeId：`imageGenerationNode/src/index.vue`、`videoGenerationNode/src/index.vue`、`audioGenerationNode/src/index.vue`。
- Agent 节点：`agentNodePanel.vue` 在对话 `error` 分支调 `markNodeOutcome(nodeId, "failed")`、在 abort 分支标记 `cancelled`（若该处能拿到节点 id；拿不到就在 `conversation.vue` 的 error 事件里带上节点 id）。
- 其他节点不做上报（用户已确认范围）。

### 1.4 宿主 `apps/web/src/lib/taskAlerts.ts`

- 订阅 `toonflow:node-task`；丢弃 `cancelled`；丢弃 `durationMs < 30000`。
- 1 秒窗口合并：窗口内的成功/失败分开计数，最终各出一条（「3 个节点已完成」「1 个节点执行失败」）。
- 提示音按 `completionSound` 三态决定是否播；系统通知按 `taskNotification` + `!document.hasFocus()` + `isDesktop`。
- 无论是否发声，都写进 `stores/taskAlerts`（未读队列），供横幅使用。
- 事件不区分画布：上报里只有 nodeId，宿主用当前画布 `flow.findNode(id)` 反查节点名；查不到（已切换画布）则按 id 记录、文案用「节点」兜底。

### 1.5 `apps/web/src/lib/chime.ts`

- 懒建 `AudioContext`：`main.ts` 注册一次性 `pointerdown` 创建并 `resume()`；之后每次播放前 `resume()`。
- 成功 660→880Hz、失败 880→660Hz，每音 90/120ms，间隔 60ms，指数衰减；总音量 0.18；同一时刻只播一组（新音先停旧的）。
- 不引入音频文件。

### 1.6 `apps/web/src/lib/desktopNotify.ts`

- 条件：`isDesktop && !document.hasFocus() && taskNotification`。
- 通道：`window.__electrobunSendToHost?.({ type: "desktop-notify", title, body, silent: true })`；`lib` 内先判 `typeof window.__electrobunSendToHost === "function"`。
- 主进程 `apps/desktop/src/index.ts` 的 host message 分支加 `desktop-notify`：
  - 校验 `title`/`body` 为字符串并截断（title ≤ 120、body ≤ 300）；
  - `try { Utils.showNotification({ title, body, silent }) } catch {}`，任何异常不得让主进程退出。
- macOS 行为待实测：原生层会主动申请授权、拒绝后回退 legacy API；JS 侧无法得知是否真的展示，点击是否激活应用也取决于系统。**这些不写成保证**，横幅是可靠兜底。
- Windows：同一条 API 调用，但非 MSIX 的 toast 可能不显示，**本轮只在 macOS 验收**，Windows 标注未验证。

### 1.7 未读与横幅（UI）

- `stores/taskAlerts.ts`：`alerts: { id, canvasId, nodeId, nodeLabel, kind: "done"|"failed"|"question", meta, read }[]`，上限 50，切项目清空。
- 画布横幅（沿用现有 `agentQuestionBanner` 位置与样式语言）分两区：
  - 「M 个 Agent 正在等你回答」——保持现状，数据源不变；点击 `openAgentQuestion(nodeId)` 后 `markRead`。
  - 「N 个节点已完成 / 执行失败」——每条：`节点名 · 耗时 3m12s`，失败项红色图标；最多显示 3 条，其余折叠。
  - 点击条目：`markRead` → 若是当前画布则 `addSelectedNodes` + 平移到该节点（按节点包围盒居中、`maxZoom: 1`）→ 打开节点面板；非当前画布先 `activateCanvas` 再执行。
  - 「全部忽略」清空未读。
- Agent 提问同时进未读队列（kind=question），保证切回来能看到。

### 1.8 设置与快捷静音

- `generalSettings` 增加并**在 computed 里做归一化**：
  - `completionSound`：仅接受 `"always" | "background" | "off"`，否则 `"always"`。
  - `taskNotification`：`general.taskNotification !== false`（默认 true）。
- 设置页（`settings/panels/general/index.vue`，平铺 section 里画布相关区域）：
  - 提示音：`el-radio-group`（总是 / 仅后台 / 关闭）。
  - 系统通知：`el-switch` + 辅助文字说明「仅桌面应用；点通知只把窗口带到前台，定位请看画布顶部横幅」。
- 画布静音按钮（`canvasControls.vue` 工具条追加铃铛）：三态循环 `always → background → off → always`，tooltip 显示当前档；图标 `icon-bell` / `icon-bell-off`。
  - 只控制提示音；系统通知由设置页开关控制（一个按钮管两件事会歧义）。
- 设置随工作区配置保存（`PUT /api/settings/save`，服务端不校验 general 内部字段），多端会共享——在设置项说明里注明。

## 2. R3 分组框选与命中

### 2.1 框选判定（Vue Flow 补丁）

插入点：`onPointerMove` 内，**`selectedNodeIds.value = new Set(...)` 之后、`selectedEdgeIds.value = new Set()` 之前**（8325 与 8326 之间）。必须在这之前过滤，否则分组内部连线会先进 `selectedEdgeIds` 留下选中边。

伪代码：

```
selected = getNodesInside(nodes, rect, viewport, partial, true) 的 id 集合
paneRect = { ...pointToRendererPoint(rect, viewport), width: rect.width / zoom, height: rect.height / zoom }   // 与 getNodesInside 完全一致，x/y 不再除 zoom
childrenOf = nodes 按 parentNode 建索引
for node in nodes:
    if !selected.has(node.id) continue
    if 不是分组(按 childrenOf.has(id) || type==="canvasGroup") continue
    descendants = 递归全部后代（跳过 hidden 与尺寸未测量的节点：尺寸为 null 时按「不满足」处理，宁可暂不选组）
    ok = descendants.length > 0 且每个后代 nodeToRect 完全落在 paneRect 内（0.5px 容差）
    if !ok: selected.delete(node.id)
```

- 空分组（无后代）恒不选；嵌套分组按**全部后代**判定。
- 未测量节点（首帧 `dimensions` 为空）会让所在分组暂不可选，等测量完成后的下一帧 `pointermove` 自然恢复。
- 只改 mjs 即可运行（Vite 预构建引用 mjs）；cjs 一并改只为补丁完整，非运行必需。

补丁落地流程（写进操作记录）：

```
bun patch @vue-flow/core@1.48.2            # 取出可编辑副本
# 编辑 dist/vue-flow-core.mjs（以及 .js）
bun patch --commit node_modules/@vue-flow/core
bun install                                 # 重新套用补丁，验证 patch 文件可用
rm -rf apps/web/node_modules/.vite && 重启 dev   # 否则预构建缓存继续跑旧 dist
```

- 不得只改 node_modules 不落 patch；`deploy-local.sh --build` 走同一份 node_modules，补丁必须在安装阶段就能复现。

### 2.2 穿透与命中区域

- `groupNode.vue`：`.groupNode { pointer-events: none; }`；`.groupLabel` / `.groupLabelInput` / `.resizeCorner { pointer-events: auto; }`。
- `index.vue`：`:deep(.vue-flow__node-canvasGroup) { pointer-events: none !important; }` 覆盖 Vue Flow 内联 `pointer-events:all`（作者样式 + `!important` 可压内联非 important）。
- 标题栏几何（用户要求：**全宽、不改现有视觉**）：
  - `.groupLabel` 由 `inline-block` 文本改为 `display:flex; left:0; right:0; height:26px; align-items:center; padding:0 2px;`，**背景透明、字号/颜色/位置不变**，文字左对齐，超长省略号。
  - 命中区因此整条覆盖分组上沿，视觉上仍只有一行小字。
- 只读预览（`home/exploreProcess.vue` 的 `processGroup`）不受 `:deep` 影响，保持现状（其组节点 `selectable:false`，本来就穿透）。

### 2.3 连带影响与处置

| 影响 | 处置 |
| --- | --- |
| 穿透后 `groupBodyOf` 恒返回 undefined，`edgeIdUnderGroup` / `probeGroupEdgeClick` / `forwardGroupContextMenu` 变成死代码 | **删除**这三个函数与模板上 `@contextmenu.capture="forwardGroupContextMenu"`；连线可直接点中，右键由 Vue Flow 的 `onPaneContextMenu` 兜住，行为等价 |
| 缩放手柄原来靠 `.groupNode:hover` 显形，穿透后不再有 hover | 改为「选中时显示」（`.selected .resizeCorner { opacity: 1 }`），并在记忆文档记录该可见性变化 |
| 组内空白双击 | 现在命中 pane，会触发画布 `@dblclick="openNodeMenu"` 打开新增节点菜单；符合「回归画布语义」，进回归清单 |
| 组内空白拖动 | 框选（用户确认）；组移动走标题栏 |
| `readOnly` 预览 | 无变化 |

## 3. R4 批量加入素材库

### 3.1 入口与可用条件

- `selectionToolbar.vue` 在「解组」后加「加入素材库」（`IconLibraryPlus`），执行中 `loading`。
- 选中集合先**展开分组**：`getSelectionRoots` 得到根节点，若含 `canvasGroup` 则递归取其叶子节点；再用展开后的集合判定与执行。
- 可用条件：展开后非空，且**每个**节点都有至少一个 `IMAGE`/`VIDEO` 类型的 source 输出当前有值。
- 不满足时 `disabled`，tooltip「仅支持图片/视频节点」。
- 取产物规则：优先 handle id 为 `image`/`video`；否则按 `node.data.handles` 里 source 顺序取第一个有值的 IMAGE/VIDEO 输出（内置节点只有一个，等价于「当前展示」）。

### 3.2 执行流程

```
items = 展开后的节点 → { nodeId, nodeLabel, url, mimeType }
for item in items (并发 2):
    name = sanitize(`${nodeLabel} ${index}.${ext}`)   // 去 [\\/:*?"<>|]、去首尾空格与结尾点、截断到 200 字符
    try  importAsset({ library: "project", directory: projectDir }, { kind: "workspace", path: url }, { name })
    catch 409/EEXIST → 重试（服务端并发竞态兜底，最多 3 次）
汇总：成功 N、失败 M（附原因）
```

- **重名策略以服务端为准**：`importFileIntoLibrary` 会自动改名 `xxx (2).ext`，所以正常重名不会报错。前端通过返回 `path` 与请求 `name` 比对来统计「改名数」，不做自增拼接。
- 目标：`selector = { library: "project", directory: 项目工作区绝对路径 }`，**不传 `targetDir`**（否则会被当成库内子目录）。
- 不做文件大小预检（`NodeMediaValue` 只有 `url`/`mimeType`，拿不到 size）；>100MB 由服务端拒绝，作为单项失败汇总（413）。
- 并发 2 与 `useAssetUpload` 一致，避免写盘把接口拖死。

### 3.3 边界

- 源是工作区相对路径 → 走 `import` 复制，不经 HTTP 传字节。
- 复制满足「源节点文件删了也不失效」。
- 剪贴板式重复入库不会产生重复条目（`COPYFILE_EXCL`）。

## 4. 实施顺序与并行

| 任务 | 内容 |
| --- | --- |
| T2（先做） | 分组：补丁 + 穿透 + 标题栏全宽 + 删除死代码（独占 `canvas/index.vue`） |
| T1 / T3（并行） | T1 提醒链路（含 index.vue 横幅，T2 完成后开始）；T3 批量入库（`selectionToolbar.vue` + 新文件） |
| T4 | 联调与验证 |
| T5 | 子 agent 代码审查并修复 |

## 5. 验证

- 分组：Chrome 直连本地应用，三种场景（部分擦到 / 完全包住含嵌套 / 空组）+ 组内空白拖拽与双击 + 标题栏拖动整组。
- 提醒：控制台手派 `toonflow:node-task` 事件验证音/通知/横幅/设置/静音；真实跑一次 >30s 任务。
- 批量入库：测试项目选 3 图 + 1 视频 + 1 分组，检查 `<workspace>/library` 文件名与索引；再造同名验证 `(2)`。
- 桌面通知：`deploy-local.sh --build` + **重启应用**后在允许/拒绝权限两种情况下实测。

## 6. 评审意见

| 评审人 | 时间 | 结论 | 意见 |
| --- | --- | --- | --- |
| 子 agent 初审 | 2026-10-29 | 有条件通过 | 已按意见修订 v2（时序竞态、取消语义、重名策略、补丁落地、标题栏几何、通知需实测） |
| 用户 | 2026-10-29 16:00 | 通过（四项决策） | 停止不响；失败只覆盖生成类+Agent；分组自动展开；标题栏全宽且不改视觉 |
