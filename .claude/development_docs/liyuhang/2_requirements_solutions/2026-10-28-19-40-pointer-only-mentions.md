# 需求方案：引用改为纯指针 + 画布平移卡顿

- 记录时间：2026-10-28 19:40
- 对应需求：`1_requirements_matrix/2026-10-28-19-25-pointer-only-mentions.md`

## 一、引用只传指针

### 1.1 输出引用（`createCanvasMention`）

```
改造前：
  value = selected.textPath ? await readText(textPath) : selected.value
  if (typeof value === "string" && value.length > 100000) throw ...
  → 正文整体进入 value

改造后：
  value = selected.textPath !== undefined
    ? { path: selected.textPath, mimeType: "text/markdown" }
    : selected.value
  → 只给路径；去掉 readText 参数，签名从 4 参减到 3 参
```

为什么是 `text/markdown`：textNode 落盘固定为 `assets/<nodeId>/content.md`，是 Markdown。

### 1.2 素材引用（`selectMentionAsset`）

`STRING` 类型从「读全文」改为 `{ path: relativePath, mimeType: type.mimeType }`。

### 1.3 schema 放宽（`mentions.ts`）

```
新增 textPointerSchema = { path: 1..4096, mimeType: 1..128 }（strictObject）

校验分支改为：
  media 合法 → 原逻辑
  STRING 且形如指针对象 → 合法
  STRING 且是字符串 → 合法（兼容旧会话）
  其余按原类型校验
```

向后兼容是硬要求：历史消息里的 mention 已存成纯字符串，重发时必须仍能过 schema。

### 1.4 媒体不再复制

`snapshotMentions` 里删掉 `copyFile` 到 `assets/chat/<uuid>` 的整段逻辑与回滚清理。保留的能力：

- 引用可用性检查（文件存在、非空、≤100MB）——这是防呆，不是复制；
- `asset` 来源的 `library`/`assertAssetRelativePath` 校验。

`created` 数组恒为空，保留返回值形状以免改调用方。

### 1.5 附件

删除「`text/plain` 读全文塞进 `content`」的分支，附件统一只带元信息。提示词里「纯文本附件的 content 为完整正文」改成「全部附件均不含正文，必须用 read 读取」。

### 1.6 提示词

`mentionPrompt` 的公共说明改为：全部引用只提供指针、不含原文；文本引用 value 是 `{path, mimeType}`，媒体 url 是相对路径；需先用 read 读取再判断。节点引用的 `nodeHint` 保持不变。

## 二、画布平移卡顿

### 2.1 连线降频（真正有效的手段）

关键判断：**单纯拉长动画周期无效**——`stroke-dashoffset` 用 linear 插值时每帧取值都不同，浏览器照样逐帧光栅化。必须用 `steps()` 把连续插值变成离散跳变，只在跳变时失效。

```
.vue-flow__edge.animated path
  animation: canvasEdgeFlow 2s steps(20) infinite   // 20 步 / 2s = 10Hz

@keyframes canvasEdgeFlow
  from { stroke-dashoffset: 10 }   // dasharray 周期 = 5 实 + 5 虚 = 10
  to   { stroke-dashoffset: 0 }
```

offset 走完一个周期即可无缝循环。视觉效果仍是流动虚线，失效频率从 ~60Hz 降到 10Hz。

### 2.2 图层隔离

`.vue-flow__edges { contain: paint }` —— 把重绘限定在该层内，不再冒泡到根层。

### 2.3 不改的部分

- 选中时仍高亮连线颜色（`edgeActive`），视觉反馈保留。
- `canvasEdgeAnimationEnabled` 设置项保留（用户可整体关闭）。

## 三、角标位置与性能

### 3.1 位置

从 `cardContainer` 内的 `top:4px;right:4px` 改为相对 `.cardContainer` 的 `bottom: calc(100% + 3px); right: 0`：

- `.cardContainer` 只包卡片，不含标题栏，`bottom:100%` 才正好停在卡片上边框之外；
- 第一次改成相对节点根层失败，因为把标题栏（约 28px）也算进去，偏离卡片约 1/4 高度。

同时加 `max-width:100% + ellipsis`（防极窄节点溢出）、`border` 用 `--el-border-color`、文字色提到 `--el-text-color-regular`（原 `secondary` 对比度约 3:1，不到 AA）。

### 3.2 计时隔离

```
新建 durationBadge.vue：自己持有 elapsedMs / done / ticker
nodeSkeleton 只传 :busy 与 :active，渲染 <durationBadge />
```

理由：计时状态若留在 `nodeSkeleton`，每秒变化都会让骨架重渲染，进而调用 `<slot>` 函数重建节点内容（markdown 预览、播放器等）。节点运行中恰恰是内容最需要稳定的时候。

`active` 为 false（文档面板模式）时停表并清空标签，避免空转。

## 四、审查查出并修正的口径问题

子 agent 审查（针对 263907d）指出三类「计了但不该计」：

| 节点 | 原表达式 | 问题 | 修正 |
| --- | --- | --- | --- |
| imageGenerationNode | `generating \|\| lighting/multiAngle/panorama` | 打光/多角度/全景通过 `node:generateImage` **立即返回**，父节点几秒内就定格成「耗时 0s」，真正的耗时在新建的子节点上 | 只留 `generating` |
| imageNode | `lighting \|\| multiAngle \|\| panorama.busy` | 同上；且 `panorama.busy` 含上传与本地截图，会反复重置计时 | **整个移除 `busy`** |
| videoNode / videoGenerationNode | `... \|\| actions.creatingAnalysis` | 创建逐帧拉片节点只是 `addNodes/addEdges`，几百毫秒；且会覆盖上一次真实耗时 | 移除该项 |
| director3dNode | `tasks.some(task => !task.error)` | 空字符串 error 会让角标永久停在运行态 | 改为 `task.error === undefined` |

## 五、兼容性

| 场景 | 表现 |
| --- | --- |
| 旧会话纯字符串引用 | 仍过 schema；重发正常 |
| 引用文本节点但文件已被删 | `snapshotMentions` 的可用性检查会报「引用不可用」 |
| 媒体引用指向的文件后续被移动 | 引用指向真实来源，会失效（原来靠复制快照避免，这是本次接受的取舍） |
| 第三方节点未传 `busy` | 不渲染角标，行为不变 |

## 六、测试方案

1. server / scaffold / 9 节点包 typecheck。
2. schema 用例：指针形态通过、纯字符串通过、媒体仍要求 url、空 path 被拒。
3. 计时隔离：用响应式图验证父级不随秒重渲染、子级更新。
4. web 与节点包构建；产物核对 `steps(20)`、`contain:paint`、角标 aria 属性、server 产物无旧错误文案。
5. 部署后手测：选中节点平移画布、角标位置与显隐。

## 七、风险

| 风险 | 处置 |
| --- | --- |
| 模型不 read 而凭空编内容 | 提示词明确「不含原文、需先 read 再判断」 |
| 媒体引用因原文件移动而失效 | 记录为取舍；需要快照语义时可后续加开关 |
| `steps()` 在 WKWebView 的表现与 Chromium 不同 | 未实测桌面端；若视觉异常可回退到 linear 并接受卡顿，或改用合成层方案 |
| 引用 path 依赖 textNode 固定落盘位置 | textNode 的 `textPath` 由节点自身维护，引用直接透传，不硬编码 |

## 八、评审意见

- 子 agent 方案评审：
- 用户评审：已确认纯指针方案、附件同口径、媒体不复制、连线降频 + 隔离。
