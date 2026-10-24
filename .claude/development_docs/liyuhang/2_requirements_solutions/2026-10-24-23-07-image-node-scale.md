# 需求方案：图片节点内置缩放

## 一、需求背景与目标

见需求矩阵 `2026-10-24-23-07-image-node-scale.md`。把已安装的「图片缩放」节点（倍率 + 长边≤、等比、lanczos）内置到图片节点工具栏弹层，覆盖当前输出、原图保留、支持一档恢复。

> 评审修订要点：画布撤销历史不覆盖节点 outputs，⌘Z 恢复不成立；子组件不能写父节点的 `outputs`；`mimeType` 必须是合法 MIME 而非扩展名。本方案已据此调整。

## 二、交互与 UI 设计

### 2.1 入口

图片节点顶部工具栏，「宫格切分」之后加一枚**图标按钮**（`IconResize`，`title/aria-label="缩放"`，`aria-expanded` 绑定弹层 visible），避免工具栏继续膨胀。

- 禁用条件：无图片、上传中、编辑器/打光/多角度/全景图/宫格切分/缩放自身忙碌。
- `@click.stop` 阻止画布拖动；点击打开弹层。

### 2.2 弹层（复用宫格切分的 popover 形态）

```
┌─ 缩放 ────────────────── 保持比例 ─┐
│ 原图          3200 × 1800          │
│ 倍率      [ 1.00 ]  50%  75%  100% │
│ 长边≤     [ 0      ]  0 表示不启用  │
│ ─────────────────────────────────  │
│ 目标          1600 × 900  (50%)    │
│ 尺寸未变化 / 超过 64 MP（红字）     │
│ [        应用缩放        ]          │
│ [      恢复缩放前（如有） ]          │
└────────────────────────────────────┘
```

- 宽度 340，`virtualTriggering`、`:persistent="false"`、`nodrag nopan nowheel`、事件阻断与 Esc 还焦点均沿用宫格切分。
- 倍率 `el-input-number`（0.05–8，step 0.05，精度 2）+ 50%/75%/100% 快捷按钮；长边 `el-input-number`（0–8192，step 64，0=关闭）。
- 目标尺寸实时展示；命中以下状态时在弹层内给出说明并禁用应用：
  - 与原图相同 →「尺寸未变化，不会重新编码」；
  - 面积 > 64 MP →「目标尺寸超过 64 MP，请降低倍率或设置长边」；
  - `disabled` → 只禁止重新打开与再次应用，不打断已发起的任务。
- 应用成功：`showNodeError` 体系之外用 `ElMessage.success`，文案包含最终尺寸；格式被回退为 PNG 时追加「已转为 PNG」。
- 失败：`showNodeError(error, "图片缩放失败")`；主动取消（`AbortError` 或 `controller.signal.aborted`）不提示。
- 关闭方式：再次点击按钮、Esc、点击外部；**关闭不中止**已在执行的任务，组件常驻不卸载，重开可看到进度与结果。

### 2.3 可访问性

- 图标按钮 `aria-label="缩放"`、`aria-expanded`（`imageScale` 需要 `expose({ open, applying, visible })`）。
- 数字输入 `aria-label="缩放倍率"`、`aria-label="长边上限"`；恢复按钮 `aria-label="恢复缩放前的图片"`。

## 三、实现设计

### 3.1 组件职责划分

```
imageNode/src/index.vue（根组件）
  ├─ 持有 outputs、files、nodeEvent、nodeTools
  ├─ 渲染 <imageScale ref="scale" :src="previewUrl" :source="outputFile" :active="node.selected" :disabled="..." />
  ├─ 处理 @applied / @restore：校验、写 outputs、记录 data.scale.previous
  └─ 全链路禁用与 save/delete/setImage 守卫

imageScale.vue（子组件）
  ├─ 仅依赖：@vue-flow/core 的 useNode（拿 node/data/id）、useNodeFfmpeg、useNodeFiles、showNodeError
  ├─ 计算尺寸、参数校验、ffmpeg 落盘、取消与并发控制
  ├─ emit("applied", { path, mimeType, fromUrl, formatChanged })
  └─ emit("restore")（点「恢复缩放前」时）
```

**禁止**在子组件里调用 scaffold 的 `useNode()` 写 `outputs`：它每次调用都会新建 ref，并按组件自身 `handles` 过滤；子组件没有 handles，写入无效（评审 C2）。

### 3.2 尺寸计算（与「图片缩放」节点一致）

```
clampFactor(v) = isFinite(v) ? clamp(v, 0.05, 8) : 1
clampMaxEdge(v) = isFinite(v) && v > 0 ? clamp(round(v), 0, 8192) : 0

target = roundSize(src.width * factor, src.height * factor)   // 最少 1px
if (maxEdge > 0 && max(target.width, target.height) > maxEdge):
    k = maxEdge / max(target.width, target.height)
    target = roundSize(target.width * k, target.height * k)   // 只缩不放

unchanged = target == src
overLimit = !unchanged && target.width * target.height > 64_000_000
```

`unchanged` 必须先判断：原图本身超过 64 MP 时不改尺寸也应当允许原样跳过，而不是报错。

### 3.3 读取原图尺寸

```
优先复用弹层内预览 <img> 的 load（与宫格切分一致，零额外 IO）
失败 → 读工作区文件生成 objectURL，decode 后取 naturalWidth/Height
浏览器无法解码的格式（TIFF 等）→ 宿主 ffprobe 读取首条视频流的 width/height
按 source.url 缓存；source 变化即失效
```

### 3.4 格式与 MIME（评审 C3）

```
MI ME = { png: image/png, jpg: image/jpeg, jpeg: image/jpeg, webp: image/webp }
扩展名 = 原文件名后缀（转小写）
if 扩展名不在 MI ME:  输出扩展名 = png，mimeType = image/png，formatChanged = true
else:                 沿用扩展名与对应 MI ME
```

- gif（会丢动画）、bmp、avif、tiff 及无扩展名统一回退 PNG；矩阵 R5 已写明。
- 任何情况下 `mimeType` 必须来自映射表，禁止写扩展名；否则节点重载会静默丢弃输出，下游读取会抛「输出端口值不符合类型声明」。

### 3.5 应用流程

```
apply():
  1. 守卫：applying || disabled || 无 source || unchanged || overLimit → 返回
  2. controller = new AbortController(); applying = true; startUrl = source.url
  3. workspace = files.getWorkspaceFiles()
     mkdir("assets")、mkdir(`assets/${node.id}`)，EEXIST 忽略
  4. path = `assets/${node.id}/resize-${w}x${h}-${Date.now()}.${ext}`   // node.id 已在画布侧校验
  5. factory = await useNodeFfmpeg()(controller.signal)
     await new Promise((resolve, reject) => {
       const command = factory(source.url)
         .videoFilters(`scale=${w}:${h}:flags=lanczos`)
         .outputOptions("-frames:v", "1", "-update", "1")
         .on("error", reject).on("end", resolve)
       signal.addEventListener("abort", () => command.kill(), { once: true })
       command.run() / save(path)
     })
  6. signal.throwIfAborted()
     emit("applied", { path, mimeType, fromUrl: startUrl, formatChanged })
  7. 成功提示；失败 → 若非 aborted，showNodeError；清理未提交的 path（带 committed 标志）
  8. finally：applying = false
```

工作区与写盘细节复用 `uploadNodeFile` 的目录规则（`assets/<节点ID>`），不另造一套路径校验。

### 3.6 父组件写入与一档恢复（评审 C1）

```
@applied(result):
  current = outputs.value.image?.value
  if (!current || current.url !== result.fromUrl):
      workspace.remove(result.path)  // 尽力而为
      ElMessage.warning("图片已变化，已取消本次缩放")
      return
  data.scale.previous = { url: current.url, mimeType: current.mimeType }
  data.scale.appliedUrl = result.path
  outputs.value.image = { dataType: "IMAGE", value: { url: result.path, mimeType: result.mimeType } }
  ElMessage.success(...)

@restore:
  previous = data.scale.previous
  if (!previous || outputs.value.image?.value.url !== data.scale.appliedUrl) return
  outputs.value.image = { dataType: "IMAGE", value: previous }
  delete data.scale.previous / appliedUrl
  ElMessage.success("已恢复缩放前的图片")
```

- 不接入 `batchCanvasHistory`：画布快照只保留 `data.label`，把 outputs 包进 batch 不会产生可撤销项，反而在 `binding()` 为空时抛错。
- 参数持久化：`data.scale = { factor, maxEdge }` 在参数变化 400ms 防抖写入，应用成功时再写一次；旧项目缺字段按默认 1 / 0。

### 3.7 生命周期与关闭（评审 I4/I5）

照搬 `imageGridSplit.vue` 的关闭条件：`src` 变化、`disabled`、节点取消选中、多选、切换画布、`onNodeDragStart` / `onSelectionStart` / `onMoveStart` 时关闭弹层；Esc 关闭并还焦点。

- 关闭只 `visible=false`，**不 abort**；正在执行的任务继续，重开可看到 loading。
- 只有 `src` 变化、节点删除/卸载、切换工作区、组件卸载才 `controller.abort()`；切换画布不会卸载后台实例，任务继续执行并写回原画布（与宿主后台任务策略一致）。
- `disabled` 只阻止打开与再次应用，不取消已发起的任务。
- 组件在父模板中**常驻渲染**（无 `v-if`），依赖 `:persistent="false"` 在关闭时销毁内容。

### 3.8 全链路禁用与守卫（评审 I1）

- 顶部/右侧所有按钮、`imageEditor`、`fileInput`、打光/多角度/全景/宫格切分的 `:disabled` 与 `open*` 早退条件统一加入 `scaling`。
- `nodeEvent.on("save")`：缩放中抛「图片处理中，请完成后再切换或刷新节点」。
- `nodeEvent.on("delete")`：先 `abort` 并 `await` 缩放完成，再走原有删除流程。
- AI 工具 `setImage`：缩放中抛「图片处理中，请稍后重试」。
- 顺带修正「替换图片」按钮当前漏掉的 editor/inpaint/gridSplit 禁用（已有漏洞，不复制）。

### 3.9 修改文件

| 文件 | 变更 |
| --- | --- |
| `packages/nodes/imageNode/src/components/imageScale.vue` | 新增：弹层、尺寸计算、FFmpeg 重采样、取消/并发、emit applied/restore |
| `packages/nodes/imageNode/src/index.vue` | 工具栏图标按钮、常驻挂载组件、outputs 写入与一档恢复、全链路禁用与守卫 |
| `packages/nodes/imageNode/readme.md` | 使用说明补「缩放」 |

服务端、扩展系统、媒体生成流程零改动。

## 四、边界与异常

| 场景 | 行为 |
| --- | --- |
| 没有图片 | 「缩放」按钮禁用 |
| 目标尺寸 == 原尺寸 | 提示「尺寸未变化」，按钮禁用，不产生新文件 |
| 目标超过 64 MP | 输入阶段红字 + 禁用应用 |
| 长边小于目标短边 | 按长边夹取，等比缩小（只缩不放） |
| gif/bmp/avif/tiff/无扩展名 | 输出 PNG，成功提示说明 |
| FFmpeg 未安装 / 启动失败 | `showNodeError` 显示原始错误 |
| 写盘失败 | 报错，节点输出不变，清理未提交文件 |
| 应用过程中切图/删节点/切画布 | 中止，不写输出，清理临时文件 |
| 应用过程中 AI 改图/上传 | 父组件比对 `fromUrl` 失败，放弃并删除新文件 |
| 关闭弹层后重开 | 任务继续，可看到进度与结果 |
| 重复点击应用 | `applying` 守卫，忽略 |
| 同一图片重复缩放 | 每次新文件（带时间戳）；节点存续期间中间文件不回收，节点目录整体被回收时一并清理 |

## 五、测试计划

| # | 用例 | 期望 |
| --- | --- | --- |
| 1 | 3200×1800 图，倍率 0.5 | 目标 1600×900，应用后节点显示新图；原文件仍在 |
| 2 | 倍率 1，长边 1024 | 目标 1024×576 |
| 3 | 倍率 2，长边 1024 | 先放大到 6400×3600 再夹到 1024×576；只缩不放 |
| 4 | 尺寸未变化 | 按钮禁用 + 提示，不新增文件 |
| 5 | 8192×8192 目标 | 输入阶段提示超过 64 MP，应用禁用 |
| 6 | 原图本身 > 64 MP 且尺寸不变 | 仍按「尺寸未变化」跳过，不报错 |
| 7 | 应用后点「恢复缩放前」 | 回到上一张图；再次点击不可用 |
| 8 | 应用后 ⌘Z | 不改变图片（明确不承诺）；恢复按钮仍可用 |
| 9 | 应用中断（切图/删节点/切画布） | 无半成品文件，输出不变；取消不弹错误 |
| 10 | 关闭弹层再打开（任务进行中） | 任务继续，loading 与结果正确 |
| 11 | 其它面板打开（disabled） | 不能再次应用，但不打断已发起任务 |
| 12 | 应用期间 AI `setImage` 抢写 | 放弃本次结果并删除新文件，提示「图片已变化」 |
| 13 | gif / webp / avif / tiff 输入 | gif/avif/tiff 输出 PNG 并提示；webp 保持 webp |
| 14 | 旧项目（无 `data.scale`） | 默认 1 / 0，正常使用 |
| 15 | FFmpeg 不可用 | 可读错误提示，不写盘 |
| 16 | 工具栏窄宽度 | 图标按钮不溢出，`aria-expanded` 正确 |

## 六、评审意见

| 评审人 | 意见 | 结论 |
| --- | --- | --- |
| 子 agent | C1–C3、I1–I8、S1–S6 全部核对代码 | 已逐条修订：去 batch、子组件 emit、MIME 映射、禁用/守卫、并发比对、生命周期、错误口径、64 MP、格式白名单、图标化入口 |
| 用户 | 待填写 | 待填写 |
