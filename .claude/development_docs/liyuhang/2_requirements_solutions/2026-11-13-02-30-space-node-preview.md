# 需求方案：画布空格预览选中节点

- 时间：2026-11-13 02:30
- 对应需求矩阵：`2026-11-13-02-30-space-node-preview.md`
- 状态：已实施并同步

## 1. 关键约束：空格已经是平移键

`canvasShortcuts.pan = "Space"`（hold + 拖动平移，Figma 习惯）。所以预览不能直接占用空格，必须按**手势**区分：

```text
轻点（≤400ms，期间没有指针按下/滚轮）  → 预览
按住不动或按住拖动                     → 平移（原语义）
```

快捷键设置面板的冲突校验只比对同类手势（`other.gesture === field.gesture`），
`pan` 是 wheel/hold 手势、`preview` 是普通按键，因此两者共用 Space 不会被误报。

## 2. 方案

### 2.1 纯选择函数 `pickNodePreview(node)`

```text
遍历 node.data.outputs：
  记录第一个有 url 的 VIDEO / AUDIO / IMAGE|MASK
优先级：VIDEO > AUDIO > IMAGE|MASK   （视频节点常同时带首尾帧 IMAGE，必须给主体）
返回 { kind, url, title } 或 undefined；title 取节点名，空则「节点预览」
```

不拼 URL、不读文件，纯函数便于单测（FIFO 取第一个可用的同类型输出）。

### 2.2 快捷键与轻点判定（`index.vue` 的 `updateCanvasKeys`）

```text
keydown：
  满足「在画布内 + 非文本控件 + 非输入法 + 按键匹配 preview + preview 不为 None」
  → previewTap = { code, at: now }；否则 previewTap = undefined
keyup：
  同一 code → 取出并清空；
  若 !defaultPrevented 且 (now - at) <= 400ms → openNodePreview()
```

作废条件（`window` 捕获阶段的 passive 监听）：

```text
pointerdown / wheel → cancelPreviewTap()
```

这样「按住空格拖动」全程都会在第一次 pointerdown 时作废候选，松手不会弹预览。
按住不动超过 400ms 也不弹，贴合「准备平移」的手感。

### 2.3 打开条件

```text
openNodePreview():
  选区恰好 1 个节点 + 没有 modal 浮层
  → pickNodePreview(node) 命中才打开（未命中静默忽略，不打扰）
```

禁用节点同样允许（禁用只表示不参与执行，内容仍可看）。

### 2.4 预览层 `components/nodePreview.vue`

```text
image → el-image-viewer（可缩放/旋转，Esc 关闭）
video → el-dialog + <video controls autoplay>
audio → el-dialog + <audio controls autoplay>
```

播放互斥不需要额外协调：`installMediaPlayback()` 的文档级 `play` 捕获监听会暂停其它媒体。

### 2.5 快捷键让位

- `hasModalOverlay()` 增加 `.el-image-viewer__wrapper`：图片查看器不是 `el-dialog`，
  只按 `.el-overlay` 判断会让预览打开时方向键/删除仍然生效。
- `hasVisibleOverlay()` 同样加上，避免 Esc 同时触发退出项目确认。
- keydown 路径增加「预览打开时直接 return」，画布快捷键整体让位；Esc 由预览组件自己处理。

### 2.6 生命周期

切画布 / 失活（`watch([canvasId, active])`）时清空 `previewTarget`，避免后台画布挂着播放器继续解码。

## 3. 影响面

- 新增：`nodePreview.ts`、`nodePreview.test.ts`、`components/nodePreview.vue`。
- 修改：`canvasShortcuts.ts`（新增 preview 绑定与设置项）、`index.vue`（按键仲裁 + 打开 + 模板 + 浮层判定）。
- 节点 UMD 不变，只需重建 web 产物。

## 4. 验证计划

- 7 条几何/选择单测（优先级、掩码、空值、非媒体输出、标题回退）。
- 手动：选图片节点轻点空格 → 大图；按住空格拖动 → 平移且松手不弹预览；拖完 400ms 内松手不弹。
- 手动：视频节点（带首尾帧）预览给视频；音频节点给播放器；文本节点无反应。
- 手动：预览打开时按 Delete/方向键不生效，Esc 关闭；切画布预览自动关闭。

## 5. 评审意见

（待用户填写）

- 是否通过：
- 其他要求：

## 6. 子 agent 评审结论与修订（2026-11-13 03:00）

| 级别 | 问题 | 修订 |
| --- | --- | --- |
| P0 | 产物 url 是工作区相对路径（`assets/<nodeId>/x.png`），直接给 `<img>/<video>` 会 404，预览实际打不开 | `NodePreviewTarget` 增加 `mimeType`；组件加 `directory` prop，用 `useWorkspaceFiles().acquireUrl()` 解析成 blob URL，`watch` 清理时 `release()`；绝对地址（blob/data/http）直接透传；读取失败显示 `el-alert` |
| P1 | 轻点判定误用 `pressedCodes`：按住空格时任何裸键都会命中，把候选改写成那个键，松开误弹预览 | 改用 `shortcutMatches(event, binding)`（按本事件的 code+修饰键精确匹配），并过滤 `None` 绑定 |
| P1 | 设置面板与 `settings.ts` 的升级兜底会把 preview 与 pan 判成冲突：老用户保存过 `pan=Space` 时新功能被静默清空 | 新增 `shortcutsMayShareBinding()`（只放行 preview ↔ pan），两处校验共用；preview 加 `allowNone` 便于显式关闭 |
| P1 | 节点内按钮/节点区域/画布内下拉未排除：点过节点按钮后按空格会同时激活按钮并弹预览 | 预览专用判定排除 `button/[role=button]/a[href]/[contenteditable]`、`.vue-flow__node/.vue-flow__edge`、`.el-popper/[role=menu]/[role=listbox]` |
| P2 | 多图/多端口取「对象插入顺序」 | 复用素材入库的取舍：优先端口 `video/audio/image/mask`，其余按 handles 声明顺序，无 handles 时退化为 outputs 键序 |
| P2 | 媒体读取失败/autoplay 被拒/切项目未关闭 | 失败渲染 `el-alert`；解析后主动 `play()` 并吞掉拒绝（控件仍在）；`watch` 增加 `project.directory` |
| P2 | 失活/打开设置时 `previewTap` 残留；拖动中途才按空格仍可能弹预览 | `resetCanvasKeys()` 清候选；新增 `pointerHeld` 状态，按下期间不武装候选 |
| P2 | `pickNodePreview` 未校验输出结构 | 改用 `isNodeOutput()` 统一校验；补 FILE / 空 value / 首输出为空 / 端口优先 4 组单测（共 10 条） |
