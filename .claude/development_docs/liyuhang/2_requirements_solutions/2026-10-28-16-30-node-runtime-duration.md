# 需求方案：节点运行时长显示

- 记录时间：2026-10-28 16:30
- 对应需求：`1_requirements_matrix/2026-10-28-16-12-node-runtime-duration.md`
- 决策：骨架层统一承担计时与渲染；各节点只传一个「是否在跑耗时任务」的布尔；浮标固定内容卡片右上角，运行中滚秒、结束留「耗时 X」；只存组件内存；不动呼吸边框

## 一、现状

`packages/nodeScaffold/src/nodeSkeleton.vue` 是全部 9 个节点的外壳，目前只有 `running?: boolean`（:216）用于呼吸描边，且全仓库仅 `textNode` 传了它（`textNode/src/index.vue:4`）。

节点的运行态口径各不相同：

| 节点 | 已有运行态字段 | 性质 |
| --- | --- | --- |
| textNode | `generating` | AI 生成 |
| imageGenerationNode | `generating`（`useNodeGeneration`）、`lighting.generating`、`multiAngle.generating`、`panorama.busy`、`gridSplit.splitting`、`editor.busy` | 混合 |
| videoGenerationNode | `generating`、`actions.processing`、`actions.creatingAnalysis` | 混合 |
| audioGenerationNode | `generating`、`transcribing`、`actions.processing` | 混合 |
| frameAnalysisNode | `processing`、`player.capturing` | 混合 |
| imageNode | `scaling`、`uploading`、`lighting.generating`、`multiAngle.generating`、`panorama.busy`、`gridSplit.splitting`、`editor.busy` | 混合 |
| videoNode | `exporting`、`uploading`、`actions.processing`、`actions.creatingAnalysis` | 混合 |
| audioNode | `uploading`、`transcribing`、`actions.processing` | 混合 |
| director3dNode | `exportingVideo`、`exportingImage`、`tasks`、`addingMannequin`、`modelLoading` | 混合 |

## 二、接口设计

骨架层新增一个 prop：

```
busy?: boolean    // 是否正在跑耗时任务；只影响计时角标，不影响呼吸边框
```

与已有的 `running` 并存、互不关联：

- `running` → 呼吸描边（保持现状，只有 textNode 用）
- `busy` → 计时角标（全部节点按需传入）

## 三、骨架层实现（`nodeSkeleton.vue`）

### 3.1 计时状态机

```
状态：idle → running → done
变量：startedAt（毫秒时间戳）、elapsedMs（渲染用）、ticker（定时器句柄）

watch(busy):
  false → true：
    若状态是 done，清掉上次结果
    startedAt = performance.now()
    状态 = running
    启动 ticker
  true → false：
    停 ticker
    elapsedMs = performance.now() - startedAt
    状态 = done
```

**定时器选型**：用 `setInterval`，间隔 1000ms，而不是 `requestAnimationFrame`。

理由：本项目在 WKWebView 下已有「低电量模式把帧率压到 30fps」的既有问题（见记忆 `2026-10-26-18-30`），`rAF` 会被节流甚至暂停；而角标只显示秒级精度，`setInterval` 足够且不受渲染帧率影响。同时 UI 上的秒数用「墙钟差值」而非「累加计数」，即使定时器被浏览器节流延迟触发，恢复后显示的秒数也仍然正确。

```
tick():
  elapsedMs = performance.now() - startedAt
```

**清理**：`onScopeDispose` 里 `clearInterval`；`busy` 转 false 时也清。

### 3.2 格式化

```
formatDuration(ms):
  total = Math.floor(ms / 1000)
  秒 = total % 60
  分 = Math.floor(total / 60) % 60
  时 = Math.floor(total / 3600)
  时 > 0 ? `${时}:${pad(分)}:${pad(秒)}` : `${pad(分)}:${pad(秒)}`
```

运行中显示 `formatDuration(elapsedMs)`（如 `00:42`、`1:05`）。
结束后显示「耗时 」+ 紧凑格式：

```
formatElapsed(ms):
  < 60s   → `${秒}s`          例如「耗时 42s」
  < 1h    → `${分}m${秒}s`    例如「耗时 3m12s」
  否则    → `${时}h${分}m`    例如「耗时 1h05m`
```

### 3.3 渲染位置与 DOM 结构

插在 `cardContainer` 内部、`el-card` 之后（与 `handle` 同级），绝对定位到卡片右上角内侧：

```html
<div class="cardContainer">
  <el-card class="contentCard"> … </el-card>
  <span v-if="!documentTarget && durationLabel" class="durationBadge nodrag nopan nowheel" aria-live="off">{{ durationLabel }}</span>
  <handle … />
</div>
```

CSS 要点（均为 `.nodeSkeleton` 作用域内）：

```
.durationBadge
  position: absolute
  top: 4px; right: 4px
  z-index: 1                     // 高于卡片，低于 floatingSlot(2)
  padding: 1px 6px
  border-radius: 999px
  background: color-mix(in srgb, var(--el-bg-color) 82%, transparent)
  backdrop-filter: blur(4px)     // 若与既有性能降级冲突则去掉
  color: var(--el-text-color-secondary)
  font-size: 11px
  line-height: 16px
  font-variant-numeric: tabular-nums   // 滚秒不抖动
  pointer-events: none           // 不拦拖拽/滚轮
  user-select: none
  white-space: nowrap

.durationBadge.isDone
  color: var(--el-text-color-placeholder)
```

`pointer-events: none` 已能保证不拦手势，`nodrag nopan nowheel` 作为双保险（若后续需要点击角标查看详情再改）。

**documentTarget 模式不显示**：`v-if="!documentTarget"`。文档面板是编辑态（纵向 flex 布局、宽度 100%），角标贴卡片右上角会与文档面板的布局语义冲突，且那一侧不是「观察节点在跑」的场景。

**与 handle 的关系**：右侧 handle 在 `right: -12px`（`:808`），角标在卡片内侧 `right: 4px`，两者水平不重叠；垂直上 handle 按 `top: (index+1)/(n+1)*100%` 分布，卡片高度最小 100px 时第一个 handle 在 50%，不会压到顶部 4px 的角标。

**与标题栏按钮的关系**：标题栏在 `cardContainer` 之上、独立的一块（`:713` `.titleBar` 有 `padding: 0 4px 8px`），角标在卡片内部而不是标题栏，因此不与刷新/删除按钮（`visibility: hidden`，hover 才显）争位置。220px 宽节点上角标最宽约 `1:00:00` ≈ 42px，远小于卡片宽度。

### 3.4 与 `slotsHiddenByInteraction` 的关系

多选拖动时 `slotsVisible` 会隐藏 top/bottom 槽位。角标是**运行状态**而非操作入口，多选拖动时保留更符合意图（用户拖着一堆节点时更需要知道谁在跑）。因此不接入 `slotsHiddenByInteraction`。

### 3.5 `prefers-reduced-motion`

角标数字变化不是动画，无需停。但要确保没有 `transition` 导致 reduced-motion 下异常；方案里不用 transition。

## 四、各节点接入

只传 `busy`，不改 `running`。逐节点取「耗时任务」字段的并集，排除上传、缩放、宫格切分、局部重绘笔刷编辑这类瞬时操作：

| 节点 | `:busy` 表达式 | 排除的字段与理由 |
| --- | --- | --- |
| textNode | `generating` | — |
| imageGenerationNode | `generating \|\| !!lighting?.generating \|\| !!multiAngle?.generating \|\| !!panorama?.busy` | 排除 `uploading`（瞬时）、`gridSplit.splitting`（本地切图，秒级）、`editor?.busy`（笔刷编辑，用户主动操作） |
| videoGenerationNode | `generating \|\| !!actions?.processing \|\| !!actions?.creatingAnalysis` | 排除 `uploading`、`deleting` |
| audioGenerationNode | `generating \|\| transcribing \|\| !!actions?.processing` | 排除 `uploading`、`deleting` |
| frameAnalysisNode | `processing` | 排除 `uploading`、`player?.capturing`（截帧，毫秒级） |
| imageNode | `!!lighting?.generating \|\| !!multiAngle?.generating \|\| !!panorama?.busy` | 排除 `scaling`（本地缩放）、`uploading`、`gridSplit.splitting`、`editor?.busy` |
| videoNode | `exporting \|\| !!actions?.processing \|\| !!actions?.creatingAnalysis` | 排除 `uploading` |
| audioNode | `transcribing \|\| !!actions?.processing` | 排除 `uploading` |
| director3dNode | `exportingVideo \|\| !!exportingImage \|\| tasks.some(t => !t.error)` | 排除 `modelLoading`（首屏加载模型）、`addingMannequin`（本地操作） |

对各节点的注释统一用同一句：`// ACT: 只把耗时任务计入运行时长；上传、缩放、切格等瞬时操作不计。`

## 五、兼容性与回归

| 场景 | 表现 |
| --- | --- |
| 未传 `busy` 的节点（如第三方插件节点） | 角标不渲染，行为与现在完全一致 |
| 节点复制 / 创建副本 | 新节点是从 `node.data` 重建的，`busy` 状态不属于 data，因此副本初始为 idle、无角标（符合预期：副本没有在跑任务） |
| 节点删除 | 组件卸载 → `onScopeDispose` 清定时器 |
| 切画布（后台画布） | 画布实例常驻（`canvasHost.vue:9` 用 `backgroundCanvas` class 隐藏，`:529` 是 opacity/visibility），组件不卸载，计时连续 |
| 画布缩放 | 角标随卡片缩放（蓝图内元素），字号会跟着变小；不额外处理 |
| 快速连续触发 | `busy` 在 true→false→true 之间抖动（例如生成失败后立刻重试）时，每次 false 都定格一次结果，每次 true 都清零重开；不会出现两个定时器（先 clear 再 set） |

## 六、测试方案

1. `@toonflow/nodes-scaffold`、`@toonflow/node-shared`、9 个节点包 typecheck 与构建。
2. `@toonflow/web` typecheck 与构建。
3. 界面实测：textNode 生成一次，观察滚秒与结束耗时；再造一次失败（断网或无效模型），确认失败也定格并保留结果。
4. 图片生成节点跑一次，确认上传替换图片不出现角标。
5. 切画布再切回，确认计时连续。
6. 220px 窄节点下目测角标不遮挡内容、不与 handle 重叠。
7. 拖动/缩放/滚轮时角标不拦截手势。
8. 文档面板模式下角标不出现。

## 七、风险

| 风险 | 处置 |
| --- | --- |
| `setInterval` 在后台窗口被节流 | 用墙钟差值计算，恢复后数值正确；角标本身不要求实时刷新 |
| 各节点 `busy` 表达式写错导致漏计/多计 | 逐节点注释说明取舍；把「排除项」写进方案表 |
| 角标与 `backdrop-filter` 触发 GPU 合成开销 | 已有性能降级历史，先用纯半透明背景，不加 blur；实测无问题再考虑 |
| `tabular-nums` 在部分字体下不生效 | 退化为默认数字间距，仅视觉轻微抖动，可接受 |
| 节点从 background 切到前台时 `performance.now()` 无问题 | 它是单调时钟，不受系统时间调整影响 |

## 八、评审意见

- 子 agent 方案评审：
- 用户评审：
