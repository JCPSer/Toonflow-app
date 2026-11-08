# Bug 修复方案：画布批量「加入素材库」增加目标选择弹窗

- 时间：2026-11-06 20:05
- 对应分析：`./bug_analysis-2026-11-06-20-05-batch-save-asset-silent-destination.md`
- 状态：已实施（待人工验收）

## 1. 方案总览

把「目标库 + 保存位置 + 回填记忆 + 路径失效回落」抽成可复用的组合式函数，单节点保存弹窗与新的批量保存弹窗共用；批量保存前先弹出轻量目标选择框，确认后再写入。

```text
框选节点 → 点「加入素材库」
  → 快照选中集合 + 计算自动文件名
  → 打开批量保存弹窗（回填上次目标库/文件夹）
      ├─ 切换 目标库（本项目/全局）
      ├─ 选择保存位置（目录树，可新建文件夹）
      ├─ 预览将写入的文件名列表
      └─ 确认「保存 N 个素材」
  → 写入成功后记住目标位置、关闭弹窗、汇总提示
```

## 2. 详细设计

### 2.1 抽出保存位置状态 `useSaveDestination`

新文件：`apps/web/src/pages/workspace/panels/assetLibrary/components/useSaveDestination.ts`

- 输入：当前浏览库（`library`）、项目目录（`directory`）。
- 状态：`targetLibrary`、`destination`、`destinationKey`、`error`。
- 行为：
  - `restore(fallbackPath)`：读取 `assetLibrary.getSaveDefaults(directory)` 回填；目标库/路径缺失时回落到 fallback；异步 `getTree` 探测记忆目录，失效则回落到 fallback（保持单节点弹窗现有语义）。
  - `switchLibrary(currentPath)`：用户手动切换目标库时，保存位置回到「当前浏览目录或根目录」，不覆盖记忆。
  - `remember()`：保存成功后写入 `setSaveDefaults`。
- `SaveToLibraryDialog.vue` 改为使用该组合式函数，删除重复的 `restoreSaveDefaults`/`onTargetLibraryChange`/`setSaveDefaults` 代码，行为不变。

### 2.2 批量保存数据准备

`apps/web/src/pages/workspace/panels/canvas/saveSelectionToAssets.ts`

- 新增 `prepareSelectionAssets(flow, nodes)`：展开分组、剔除禁用节点，返回 `{ node, label, source, name }[]`，其中 `name` 复用现有 `assetFileName` 规则。
- `saveSelectionToAssets(flow, nodes, directory, target)` 改为先调用 `prepareSelectionAssets`，内部按 `name` 写入，不再自己重新计算名字；导出的名称预览与真实写入使用同一份数据，避免「预览 A、写入 B」。
- 保留现有重名自动改名、并发 2、失败重试语义。

### 2.3 批量保存弹窗

新文件：`apps/web/src/pages/workspace/panels/canvas/components/batchSaveToLibraryDialog.vue`（画布选区专用，复用素材库的 `AssetDestinationTree` 与 `useSaveDestination`）。

UI：

| 区域 | 内容 |
| --- | --- |
| 标题 | 保存到素材库 |
| 目标素材库 | 单选：本项目 / 全局（无项目目录时只有全局） |
| 保存位置 | 目录树；默认回填上次位置，可新建文件夹 |
| 素材预览 | 「将保存 N 个素材」+ 可滚动文件名列表（等宽字体，最多 8 行高） |
| 错误 | 目录读取/写入失败时红色 alert |
| 底部 | 取消 / 保存 N 个素材（保存中 loading，防重复点击） |

交互约束：

- `open(nodes)` 时快照选中集合与文件名；弹窗打开期间画布选区变化不影响本次保存。
- 确认后才写入；取消不产生任何副作用。
- 成功后 `remember()` + 关闭 + 由父组件提示「已加入 N 个素材（其中 X 个重名已改名）」；失败项按现有逻辑汇总为一条错误提示。
- 目标目录读取失败或服务端拒绝时不关闭弹窗，错误显示在弹窗内。

### 2.4 选区工具栏接入

`selectionToolbar.vue`

- `saveToAssets()` 不再直接写盘，改为打开 `batchSaveToLibraryDialog` 并传入当前可入库节点快照。
- 移除 `saving` 的写盘职责，按钮不再因保存中而 loading（写盘 loading 由弹窗按钮承担）。
- 保存结果的提示逻辑保留在工具栏（或弹窗 emit 后由工具栏展示），文案不变。

### 2.5 默认位置口径

- 有记忆：回填记忆（与单节点共用同一份 `saveDefaults`，按项目目录分桶）。
- 无记忆：项目库根目录（有项目目录时），否则全局库根目录。
- 不回落到「素材库面板当前浏览目录」，避免批量入口隐式依赖面板状态；该差异在文档中记录。

## 3. 边界与异常

1. 记忆目录被删除/改名：打开时探测失败回落到根目录，并在弹窗内提示一次（复用单节点逻辑）。
2. 弹窗打开期间用户在 Finder 删除目标目录：保存时报错并留在弹窗内，可改选其它目录。
3. 全部节点都无产物：按钮本就置灰，不会打开弹窗。
4. 选择里含分组：展开到叶子节点，预览与写入数量一致。
5. 禁用节点：预览中不出现，也不写入。
6. 名称超长/非法字符：沿用 `sanitizeAssetName`，预览即最终名。

## 4. 交付物

- 修改：`selectionToolbar.vue`、`SaveToLibraryDialog.vue`、`saveSelectionToAssets.ts`。
- 新增：`useSaveDestination.ts`、`batchSaveToLibraryDialog.vue`。
- 测试：`saveSelectionToAssets` 名称预览与写入一致性、`useSaveDestination` 回填/回落逻辑（可在现有测试文件补充或新增）。
- 只改 web，需要重新构建并同步 `views/mainview/`；不需要更新节点 UMD 与主进程，重启应用生效。

## 5. 测试计划

- 单测：文件名预览与 `prepareSelectionAssets` 输出一致；记忆回填、目标库回落、路径探测失败回落。
- 类型检查：apps/web。
- 构建：`bun run --filter @toonflow/web build`。
- 人工：见测试结果文档「待人工验证」。

## 6. 实施与验证（2026-11-06 20:26）

### 6.1 落地文件

- 新增：`useSaveDestination.ts`、`saveDestination.ts`、`selectionAssets.ts`、`batchSaveToLibraryDialog.vue` 及两个测试文件。
- 修改：`SaveToLibraryDialog.vue`（改用组合式函数，行为不变）、`saveSelectionToAssets.ts`（接收 `PreparedAsset[]`）、`selectionToolbar.vue`（打开弹窗、成功提示带落点）、`api.ts`（见 6.2 P1）。

### 6.2 评审发现与处理

| 级别 | 问题 | 处理 |
| --- | --- | --- |
| P1 | 批量选择「全局」时全部失败：`selectorParams` 对全局库剥掉 `directory`，服务端解析「工作区来源」时 400 | `importAsset` 在工作区来源时显式补回 `directory`；同时修复附件「收藏到素材库 → 全局」的同类问题 |
| P2 | 保存中可通过 ESC/× 关闭，在途请求会关掉重新打开的弹窗 | 两个保存弹窗在 `saving` 时禁用 ESC 与关闭按钮 |
| P2 | 全部失败时关闭弹窗、只剩第一条 toast | 改为留在弹窗内显示汇总错误，可改位置重试；部分成功仍关闭并汇总 |
| P2 | 切换「全局 → 本项目」丢掉回填文件夹 | `switchLibrary` 无当前浏览目录时回填该库上次记住的位置 |
| P2 | 超长标题整串截断会切掉「序号.扩展名」 | 先截断标题再拼序号与扩展名，并补单测 |
| P2 | `canSave` 未要求每项都有产物 | 增加 `every(item => !!item.source)` 门控 |
| P2 | 记忆目录失效时静默回落 | 保留原有静默回落（与单节点一致），不额外打扰 |

### 6.3 验证

- `bun test`（apps/web）：83 pass / 0 fail（新增命名预览、超长标题、产物解析、扩展名推断、落点解析共 17 条）。
- `bun run typecheck`：仅剩既有 `@/agentRuntime` 报错。
- `bun run --filter @toonflow/web build`：成功。
- 部署：`build/web/` 同步到 `/Applications/toonflow-exec.app/Contents/Resources/app/views/mainview/`（20:09 首次、20:26 评审修复后）；使用覆盖式同步，保留旧哈希分块，避免打断正在运行的应用。
- **未重启应用**，需用户自行重启后生效；只改 web，无需更新节点 UMD 与主进程。

## 7. 待人工验证

1. 框选两个图片/视频节点 →「加入素材库」：弹出弹窗，回填上次位置与文件名列表。
2. 切换「本项目/全局」后确认：文件落到所选库与文件夹，提示带完整落点。
3. 取消弹窗：不产生任何文件。
4. 选择全局库：批量导入成功（P1 回归）。
5. 保存中按 ESC：弹窗不关闭；保存完成后正常关闭。
6. 目标文件夹在 Finder 删除后保存：弹窗内显示失败原因，可改选其它目录重试。
7. 单节点「保存到素材库」：原有回填、改名、目标库切换行为不变。

## 8. 评审意见

（待用户填写）

- 是否通过：
- 其他要求：
