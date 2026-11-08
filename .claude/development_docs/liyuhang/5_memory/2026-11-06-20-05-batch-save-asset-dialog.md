# 记忆：画布批量加入素材库改为目标选择弹窗

- 时间：2026-11-06 20:05（20:26 部署）
- 类型：Bug 修复（交互一致性 / 素材导入）

## STAR

**Situation（背景）**
画布框选多个图片/视频节点后点「加入素材库」，不弹任何目标选择框，直接写入上次单节点保存的位置。用户无法在写入前确认落点，也不知道文件去了哪里。

**Task（任务）**
批量保存也弹出目标选择框：选目标库（本项目/全局）与文件夹，回填上次位置，预览自动生成的文件名，确认后才写入。

**Action（行动）**
- `selectionAssets.ts`（新）：从批量保存逻辑里拆出纯函数（产物解析、分组展开、命名规则、`prepareSelectionAssets`）。
- `saveSelectionToAssets.ts`：改为接收 `PreparedAsset[]`，预览与写入共用同一份文件名。
- `useSaveDestination.ts` + `saveDestination.ts`（新）：抽出「目标库 + 保存位置」回填、失效回落、切换、成功记忆；单节点 `SaveToLibraryDialog` 一并改用，行为不变。
- `batchSaveToLibraryDialog.vue`（新）：目标库单选、目录树、文件名列表、保存 N 个；全部失败留在弹窗内重试。
- `selectionToolbar.vue`：「加入素材库」只负责快照选区并打开弹窗；成功提示带完整落点。
- `api.ts`：`importAsset` 在工作区来源时补回 `directory`，修复批量选「全局」必 400。
- 单测：命名预览（序号/扩展名/禁用/分组/超长标题）与落点解析规则。

**Result（结果）**
web 83 单测通过，typecheck 仅剩既有 `@/agentRuntime` 报错；web 构建并同步到应用 `views/mainview/`（20:26），**未重启**。

## 关键经验

1. 同一动作的批量入口与单节点入口必须共用同一套记忆与默认值来源；一个静默、一个弹窗，用户只会当成 bug。
2. `selectorParams` 对全局库剥掉 `directory` 是给浏览/列表接口用的；「工作区来源导入」里的 `directory` 描述的是来源工作区，必须显式补回，否则全局导入必 400（附件收藏到全局同样中招）。
3. 保存类弹窗在 `saving` 时必须禁用 ESC 与关闭按钮：在途请求完成时会执行 `visible = false`，把重新打开的弹窗和结果一起污染。
4. 文件名截断要先截标题再拼「序号.扩展名」，整串截断会切掉扩展名，素材落盘后无法识别类型。
5. `GraphNode` 递归泛型放进 `ref` 会触发 TS2589；只整体替换/读取时用 `shallowRef`。
6. 预览名与写入名必须来自同一份 `PreparedAsset`，分别计算迟早会出现「显示 A、写入 B」。
