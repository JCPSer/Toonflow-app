# Bug 修复方案：网格吸附下的坐标漂移

- 时间：2026-10-29 19:46
- 关联分析：`bug_analysis-2026-10-29-19-40-grid-snap-drift.md`

## 一、原则

> 凡是项目代码写 `position` 的地方，写之前都必须经过同一个吸附函数。

Vue Flow 只吸附拖拽（`useDrag`）与指针投影（`project()`），项目自己算出来的坐标它一概不管，所以要么每处都补吸附，要么就继续漏。

## 二、新增吸附工具 `canvas/snapNodes.ts`

```
GRID 默认 16（实际取 flow.snapGrid[0]）

snapValue(v)             → Math.round(v / grid) * grid
snapPosition(position)   → { x: snapValue(x), y: snapValue(y) }
snapOffset(delta)        → Math.ceil(delta / grid) * grid     // 复制/排列这种"往外让开"的位移
normalizeNodesToGrid(flow) → 返回需要改动的 [{ id, position }]
```

`normalizeNodesToGrid` 算法（纯计算，不改状态）：

```
对每个根节点递归：
  旧绝对坐标 = 父旧绝对 + 自身 position
  新绝对坐标 = snap(旧绝对)
  新 position = 新绝对 - 父新绝对
  记录有变化的节点
  继续处理直接子节点（父新绝对向下传递）
```

性质：分组的子节点若本来就是 8px 整体偏移，各自的绝对坐标取整后会一起落到网格上，**组内间距不变**；分组本身也跟着落到网格上。小数坐标统一收敛到最近的网格点（位移 ≤8px）。

## 三、堵源改动

| 位置 | 现在 | 改成 |
| --- | --- | --- |
| `selectionNodes.ts:44-47` `fitGroupBounds` | 左/上 `-24 / -40`，右/下 `+24` | 左/上 `-32 / -48`，右/下 `+32`（均为 16 倍数），并对 `left/top` 做一次吸附 |
| `selectionToolbar.vue:131` `groupNodes` | `bounds.x - 24`、`bounds.y - 40`、宽高 `+48 / +64` | `-32 / -48`、`+64 / +80`，`position` 吸附 |
| `selectionToolbar.vue:106` `duplicateNodes` | 偏移 `bounds.width + 64` | `snapOffset(bounds.width + 64)`（向上取到 16 的倍数） |
| `arrangeSelection.ts:53-62` | 位置可能带 `.5` 或继承小数 | 最终 position 逐个吸附（相对父坐标） |
| `groupNode.vue:160-178` 缩放 | 宽高、position、子节点 `dx/dy` 都带小数 | 宽高吸附到 16，position 吸附，子节点按吸附后的 `dx/dy` 平移（位移是 16 倍数，子节点保持对齐） |
| `agentNodePanel.vue:396` 复制 Agent 节点 | `computedPosition + width + 80` | 位置吸附后再写入 |

## 四、存量纠偏（加载期归一化）

`index.vue` 新增一次性归一化：

```
watch(canvasReady)：ready 且 snapEnabled 且该画布本次会话还没归一化过 →
    changed = normalizeNodesToGrid(flow)
    changed 为空 → 什么都不做（不写盘、不进历史）
    否则 canvasHistory.batch(() => changed.forEach(updateNode))
```

- 只在 `snapEnabled` 为真时执行；关掉吸附的画布完全不受影响。
- 每个画布每次会话只跑一次，避免和用户随后的手工布局打架。
- 一次 batch = 一次撤销步。
- 不依赖节点尺寸，所以不必等布局测量完成。

## 五、验收

1. 新建分组：组与全部子节点的绝对坐标都是 16 的倍数（`% 16 === 0`）。
2. 复制节点/分组：副本坐标是 16 的倍数。
3. 排列选中节点（横向/纵向/网格）：全部落在网格上。
4. 拖动分组缩放手柄：组尺寸与位置是 16 的倍数，组内相对间距不变。
5. 打开已有错位画布（如 `蕾姆Rem/1-早上起床-特殊唤醒服务`）：一次刷新后，之前 8px 偏移的节点全部对齐，组内间距与刷新前一致；撤销可回到原样。
6. 关掉网格吸附的画布：打开后坐标完全不变。
7. 已对齐的画布：打开后不产生新的保存/撤销记录。

## 六、改动文件

| 文件 | 改动 |
| --- | --- |
| `apps/web/src/pages/workspace/panels/canvas/snapNodes.ts` | 新增吸附工具 + 归一化算法 |
| `apps/web/src/pages/workspace/panels/canvas/selectionNodes.ts` | 分组内边距改 32/48 并吸附 |
| `apps/web/src/pages/workspace/panels/canvas/components/selectionToolbar.vue` | 建组内边距、副本偏移吸附 |
| `apps/web/src/pages/workspace/panels/canvas/arrangeSelection.ts` | 结尾统一吸附 |
| `apps/web/src/pages/workspace/panels/canvas/components/groupNode.vue` | 缩放吸附 |
| `apps/web/src/pages/workspace/panels/canvas/components/agentNodePanel.vue` | 复制节点位置吸附 |
| `apps/web/src/pages/workspace/panels/canvas/index.vue` | 加载期归一化挂载点 |

## 七、评审意见

| 评审人 | 时间 | 结论 | 意见 |
| --- | --- | --- | --- |
| 用户（口径） | 2026-10-29 19:38 | 通过 | 自动纠偏存量 + 内边距 32/48 |
| 子 agent 初审 | 2026-10-29 19:30 | 修完可通过 | 见下方整改，共 11 条必须修改 |

## 八、按初审整改（19:55）

| # | 问题 | 整改 |
| --- | --- | --- |
| 1 | 归一化把 key 提前写进 `normalizedCanvases`，二次校验失败就永久跳过 | 改为成功后记账，加 `normalizing` 重入标志 |
| 2 | watch 依赖含 `snapEnabled`，运行中按网格按钮会把所有画布一起挪动写盘 | 依赖只留 `canvasReady/canvasId`，开关只在实际归一化时读；补 `props.active` 与 directory 二次校验 |
| 3 | `arrangeCanvas.ts` 自动排版写浮点坐标 | dagre 结果逐个 `snapPoint` |
| 4 | 空画布首个节点 `center - 200` 偏 8px | 改 `center - 192` 并吸附中心点 |
| 5 | 节点菜单「创建副本」用实测高度算位置 | `nodeSkeleton` 里按 `snapGrid` 吸附副本坐标 |
| 6 | `groupNodes` 只吸附组、子节点用未吸附的绝对坐标 | 子节点 = `snap(绝对) - 组位置` |
| 7 | `fitGroupBounds` 的 `left/top` 没吸附 | 对 `left/top` 做 `snapValue` |
| 8 | `finishGroupDrag` 吸附的是相对值 | 改为吸附绝对坐标再减父组真实位置 |
| 9 | `mergeGroups` 子节点用未吸附的 `bounds` | 组原点与子节点都按吸附值计算 |
| 11 | 吸附函数不看 `snapToGrid` | **明确取舍**：结构操作（建组/合并/取消分组/排列/缩放/副本）始终对齐网格；网格开关只影响拖拽与归一化。因为网格是全局固定 16，用户关开关的意图是"拖动不要被吸"，不是"建组要歪" |

补充采纳：`normalizeNodesToGrid` 加环检测（`parentNode` 数据损坏时不会栈溢出）；`finishResize` 加 moved 判据（点一下手柄不改尺寸）。

**明确不做（记录在案）**：节点包内部批量生成兄弟节点（全景、宫格切分、图片变体、标记编辑器、视频/音频动作、导演台、帧分析结果）仍按各自的像素间距摆放，不逐处改。这些位置在生成后立即使用，且分布在 6 个包 12 处；统一由"下次打开画布时的归一化"兜底。验收口径相应改为"生成后可能差几像素，重开画布即对齐"。

