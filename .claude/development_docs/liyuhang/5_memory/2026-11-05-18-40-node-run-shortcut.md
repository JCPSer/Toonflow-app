# 记忆：⌘Enter 运行选中节点

- 时间：2026-11-05 18:40（18:48 部署）
- 类型：功能增强（画布快捷键 / 跨 UMD 契约）

## STAR

**Situation（背景）**
生成节点必须点卡片底部的「生成」按钮才能开跑；连续调参试跑时手要在画布与节点之间来回移动。用户希望选中节点后 ⌘Enter 直接运行。

**Task（任务）**
让宿主画布能调用节点内部的生成入口；支持多选并行、运行中忽略、输入框内可用、可配置、不与裸 Enter 冲突。

**Action（行动）**
- `packages/nodeScaffold/src/nodeRun.ts`：`Symbol.for("toonflow.nodeRun")` 注册表，`registerNodeRun` 返回只注销自己的清理函数。
- `nodeSkeleton.vue`：新增可选 `run` prop，watch + `onScopeDispose` 维护注册。
- 四个生成节点传入 `runFromShortcut`（运行中直接返回，失败走各自 `showNodeError`）；文本节点直接调 `generateText`。
- `canvasShortcuts.ts`：新增 `runNode`，默认 `primaryModifier+Enter`，进设置页可改键。
- `canvas/index.vue`：白名单加入 `runNode`；`editing` 判定对它单独放行（节点输入框可用），仍受 `inCanvas`、Agent 面板、弹窗限制；`runSelectedNodes()` 并行启动、跳过运行中/禁用、全部落空时提示。
- 单测：⌘Enter 与裸 Enter/Shift/Alt 的区隔与冲突检测、注册表语义。

**Result（结果）**
web 66 单测通过、nodeScaffold 与四个节点包类型检查通过、四个节点 UMD 与 web 构建并同步到应用与仓库 data 目录（18:48），**未重启**。

## 关键经验

1. 节点包与宿主是两个 UMD 构建，不能直接 import 对方实现；跨包扩展只能走 `Symbol.for` 全局表（nodeBusy 已开先例）。
2. 注册表要返回「只注销自己」的清理函数，否则重挂载/热重载时会把别人的入口删掉。
3. 快捷键放行输入框只在「节点自己的提示词框」是合理需求；用 `inCanvas` 与 `[role=dialog]` 判定划边界，比一刀切禁 input 更符合实际。
4. 运行中再按必须忽略而不是停止：全局快捷键误触代价是中断付费任务。
5. 修饰键匹配严格全等，⌘Enter 与裸 Enter 天然不冲突，不用改 clearAlerts 的语义。
6. 节点提示词的「展开编辑」是 teleport 出去的 dialog，`role=dialog` 一刀切会把它排除；需要按具体类名放行。
7. 跨包入口的返回类型别写成 `void | Promise<void>`：节点实现常返回状态对象，回调类型用 `unknown` 才成立。
8. `data/nodes` 有两份（仓库 dev 数据与 `/Applications/toonflow-data`），部署 UMD 时两边都要更新，否则 dev 模式是旧包。
