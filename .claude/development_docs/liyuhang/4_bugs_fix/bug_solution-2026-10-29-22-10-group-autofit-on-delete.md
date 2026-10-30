# Bug 修复方案：分组内节点删除后自动贴合内容

- 时间：2026-10-29 22:10
- 对应分析：`bug_analysis-2026-10-29-21-53-group-autofit-on-delete.md`
- 代码基线：`0e5fda5`

## 1. 方案总览

不逐处改删除入口（画布侧 + 节点包侧共 6 类，且插件以后还会新增），而是在画布层加一个**结构变化观测点**：

```
                ┌──────────────────────────────┐
 任意删除入口 → │ 节点数组变化（removeNodes）   │
                └──────────────┬───────────────┘
                               │ 计算「节点 → 父分组」快照，与上一份做差
                               ▼
                ┌──────────────────────────────┐
                │ 只在「减少」方向命中：        │
                │ 某组少了直接子节点            │
                └──────────────┬───────────────┘
                               │ 受影响组 + 其全部祖先（嵌套传播）
                               ▼
                ┌──────────────────────────────┐
                │ 复用 fitGroupBounds 由内向外贴合 │
                │ 空组 → 160×96 最小尺寸         │
                └──────────────────────────────┘
```

三个要点：

1. **观测点唯一**：挂在 `flow.getNodes` 的「id + parentNode」串上，覆盖 `deleteSelection`、节点卡片删除、MCP `deleteNodes`、`remoteNode` 移除、插件内部删除、解组（外层组少了一个内层组）等全部路径。
2. **只认减法**：新增/粘贴/拖入只让组变大，不触发；拖出仍由既有 `finishGroupDrag` 负责，本监听只是幂等地再算一次。
3. **贴合下沉**：空组下限写进 `fitGroupBounds` 本身，删除到空、拖出最后一个子节点、整理画布三条路径口径一致。

## 2. 详细设计

### 2.1 `selectionNodes.ts`

- 新增常量 `GROUP_MIN_WIDTH = 160`、`GROUP_MIN_HEIGHT = 96`（均为 16 的整数倍）。
- 新增 `setGroupSize(group, width, height)`：读 `group.style`（兼容函数形式），仅当宽/高与现有值不同才写 `style` 并同步 `group.dimensions`，避免每次贴合都产生一次无意义的保存/历史比对。
- 改 `fitGroupBounds`：
  - 子节点为空 → 调 `setGroupSize(group, 160, 96)` 后 `continue`（位置不动）；
  - 其余逻辑（32/48 内边距、left/top 吸附、绝对坐标补偿）保持不变；
  - 尺寸赋值统一走 `setGroupSize`。
- 新增 `captureGroupChildren(nodes): Map<groupId, Set<childId>>`：只收 `type === "canvasGroup"` 的父。
- 新增 `refitGroupsAfterRemoval(nodes, previous): number`：
  1. 用 `captureGroupChildren` 取当前快照；
  2. 对 `previous` 中每个仍存在的组，若 `previousChildIds - currentChildIds` 非空 → 加入受影响集合；
  3. 对受影响集合里每个组，沿 `parentNode` 向上补入全部祖先组（防环，用 visited）；祖先必须是 `canvasGroup`；
  4. 若集合为空返回 0；
  5. 调 `fitGroupBounds(nodes, affected)`（其内部按 `getSelectionTree(...).reverse()` 由内向外处理，空组分支已在上一步生效），返回受影响组数。

### 2.2 `useCanvasHistory.ts`

- 把内部的 `applying` ref 加入返回值（只读用途），供画布层在撤销/重做期间跳过贴合。
- 不改 `batch`/`commit` 语义。

### 2.3 `index.vue`

- 引入 `captureGroupChildren`、`refitGroupsAfterRemoval`、`canvasHistory.applying`。
- 新增模块级快照 `let groupChildren = captureGroupChildren(flow.getNodes.value)`。
- 新增监听：
  ```
  watch(成员关系串, () => {
    if (!canvasReady 或 applying) { 重新拍快照; return; }   // 加载中/撤销重做：只同步基线
    refitGroupsAfterRemoval(flow.getNodes.value, groupChildren);
    groupChildren = captureGroupChildren(flow.getNodes.value);
  }, { flush: "post" });
  ```
  成员关系串 = 所有节点 `${id}>${parentNode ?? ""}` 拼串（与既有 `nodeIdsKey` 同款做法，保证稳定感知增删与换组）。
- 画布切换时重置基线：`watch([canvasId, project.directory], ..., { flush: "sync" })`，把 `groupChildren` 重新拍一遍，避免拿上一张画布的成员关系做差。
- 不调用 `canvasHistory.batch`：
  - 批处理删除（`deleteSelection`）里，`flush: "post"` 的回调在 `batch` 的 `await nextTick()` 恢复之前执行，`grouping > 0`，贴合结果与删除同属一个撤销步；
  - 裸删除（节点卡片、MCP、`remoteNode`）与删除是同一 tick 的两次变更，`record = debounce(commit, 0)` 只会提交一次快照，同样只有一个撤销步。
- 不调用 `updateNodeInternals`：与 `finishGroupDrag` 现有写法一致，直接改 `style`/`dimensions` 即可生效，尺寸由节点自身 `ResizeObserver` 兜底。

### 2.4 时序与豁免

| 场景 | 行为 |
| --- | --- |
| 删除组内节点（任意入口） | 贴合，剩余节点绝对坐标不变 |
| 删空 | 组缩到 160×96，位置不变 |
| 拖出最后一个子节点 | `finishGroupDrag` → `fitGroupBounds` → 同样缩到 160×96 |
| 拖出/拖入、换组 | `finishGroupDrag` 先贴合，监听再算一次（幂等，无 diff 不写） |
| 建组 / 合并组 / 拆组 | 只增不减或组本身消失，不触发；拆组时外层组少了一个内层组会触发贴合（符合预期） |
| 撤销 / 重做 | `applying` 期间只同步基线，不贴合 |
| 打开 / 切换画布 | `canvasReady` 门控 + 基线重置，不贴合、不产生撤销步 |
| 粘贴 / MCP 新增 | 只增不减，不触发 |

## 3. UI 设计

无新增控件、无交互变化。唯一可见变化：组内容被删后分组矩形收紧到内容 + 内边距（32/48），空组固定为 160×96。

## 4. 测试计划

### 4.1 纯函数验证（bun 脚本，夹具为普通对象）

1. 3 子节点删 1：组宽高按剩余内容 + 32/48 重算；剩余子节点绝对坐标不变。
2. 删空：宽高 160×96，位置不变。
3. 嵌套：内层删空 → 内层 160×96 → 外层同步收缩；整组（含子节点）删除 → 外层收缩。
4. 只增不减：新增一个子节点，`refitGroupsAfterRemoval` 返回 0，组尺寸不变。
5. 幂等：连续贴合两次，第二次不产生任何位置/样式 diff。

### 4.2 构建与静态检查

- `bun run --filter '@toonflow/web' build` 通过。
- 全仓 `rg` 自检：新增符号无遗留引用、`applying` 只被读取、删除入口无残留调用。

### 4.3 应用内手测矩阵

| 用例 | 期望 |
| --- | --- |
| 右键删除组内 1 个节点 | 组立即收紧，撤销一次完整还原 |
| 选中组内节点按 Delete | 同上 |
| 节点卡片删除按钮删组内节点 | 同上（此路径不进批次） |
| 组内最后一个节点删掉 | 组变成 160×96 空框，标题栏仍可用 |
| 把最后一个节点拖出组 | 组同样缩到 160×96 |
| 组套组，删内层节点 | 内层收紧，外层跟着收紧 |
| 撤销 / 重做 | 不产生额外撤销步，组尺寸随快照还原 |
| 打开旧画布（含手工放大过的组） | 尺寸原样，不被重排 |
| 粘贴节点进组 | 组不自动拉伸 |

## 5. 风险与回退

- 性能：每次结构变化 O(N) 拍快照 + 受影响组的 `fitGroupBounds`（内部 O(N) 过滤）。画布节点数百级、删除通常个位数，可接受；批量删除每条删除一次 tick，最坏 O(k·N)。
- 误伤：只处理「减少」方向，粘贴/新增不受影响；撤销、加载均有守卫。
- 回退：改动集中在两个文件（`selectionNodes.ts`、`index.vue`）与 `useCanvasHistory.ts` 的一行导出，回退只需撤这三处，不涉及数据格式。

## 6. 评审意见（待用户填写）

### 第 2 轮（子代理方案评审，2026-10-29 22:35）

结论：需修改。已按意见修订本方案：

- **守卫改为数组引用**：`flow.getNodes.value` 在 `removeNodes`（原地 splice）时引用不变，`setNodes`（加载画布、建组/合组、撤销恢复）时换新数组。watch 同时挂「数组引用 + 成员关系串」：引用变 → 只同步基线不贴合；引用没变 → 做差分。原来的 `watch([canvasId, directory])` 在「同 id 重载」上空转，`canvasReady` 又会被插件列表刷新置 false（`index.vue:620` + `:1619-1631` + `:1713-1762`），该窗口内的删除会被静默跳过，二者都不足以做守卫。
- **组对象按 id 取当前节点**：`fitGroupBounds` 用 `groups.has(group)` 做对象身份判断，`previous` 里的组对象可能是 `setNodes` 之前的老对象，直接塞进去会出现「子节点被平移、组本身没动」。
- **行为表修正**：建组/合并组走 `setNodes`（只增不减或组本身消失，不触发）；**解组走 `removeNodes`，外层组会因少了一个内层组而触发贴合**，`mergeGroups` 若把外层组清空则缩到 160×96 —— 这批操作都在 batch 内，撤销安全，属可接受行为。
- **`setGroupSize` 判定基准**改为解析后的 `style` 宽高（兼容 number），不用 `dimensions`（`markRaw`，会被 ResizeObserver 从 DOM 覆盖）；非空组尺寸赋值也统一走它。
- **验收措辞修正**：非空组删掉最左/最上节点时，`left/top` 补偿会让组本身右移/下移贴合内容，「位置不变」只对空组成立。
- **测试计划修正**：`vite build` 不做类型检查，改为跑 `vue-tsc`（该命令当前有既有 `@/agentRuntime` 别名报错，按「新增错误数为 0」判定）；纯函数夹具验证脚本放 `apps/web/scripts/`，用 bun 直接 import（已验证类型 import 会被擦除，无 @vue-flow 运行时依赖）。
- **已知边界**（不修，写入方案）：受影响组里若有子节点尚未测量尺寸（`dimensions` 为 0，例如后台画布），`fitGroupBounds` 会跳过该组，本次不收缩；等下一次结构变化再贴合。隐藏组不做过滤，仍参与贴合。

### 第 3 轮（用户评审）

- 评审人：
- 结论：待评审
- 意见：
