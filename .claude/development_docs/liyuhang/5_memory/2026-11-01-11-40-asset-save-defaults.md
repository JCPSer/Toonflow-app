# 保存到素材库记住上次设置

- 时间：2026-11-01 11:40
- 涉及文件：`apps/web/src/stores/assetLibrary.ts`、`apps/web/src/pages/workspace/panels/assetLibrary/components/SaveToLibraryDialog.vue`

## STAR

**Situation**
保存到素材库弹窗每次打开都把「目标素材库」重置为当前素材库、把「保存位置」重置为当前浏览目录；用户长期保存到固定文件夹，每次都要手动重选。

**Task**
1. 记住上次成功保存的「目标库 + 保存位置」，下次打开自动回填。
2. 按项目分别记忆，所有保存入口共用。
3. 素材名称、节点输出仍按当次内容生成；保存失败不更新记忆。

**Action**
1. `useAssetLibraryStore` 新增按目录分桶的 `saveDefaults`，提供 `getSaveDefaults` / `setSaveDefaults`，并加入 persist pick。
2. `SaveToLibraryDialog` 的 `open` / `openWorkspaceFile` 调用 `restoreSaveDefaults`：优先用记忆值，无项目目录时回落全局库，无记忆时回落到传入的当前路径。
3. 删除 `watch(targetLibrary)`，改为单选 `@change` 重置保存位置——程序化回填也会触发 watch，会把记忆值覆盖掉。
4. 工作区导入与 Blob 上传两条成功分支都写入记忆；失败不写。

**Result**
- web `vue-tsc` 通过（仅既有 `@/agentRuntime` 报错）；构建并同步到应用。
- 主包 `workspace-DSA9GcGx.js` md5 `ed242e94635b10f6da25be5fcdeedcf0`，构建与 Resources 一致；未重启。
- 子 Agent 审查通过：补充批量入库读取记忆、失效目录 `getTree` 预检回落、保存快照与库/路径成对回落。

## 教训

- 表单回填和「用户主动切换」要分开：用 `watch(model)` 重置联动字段时，程序化赋值也会触发，必须改成用户事件（`@change`）。
- 「浏览状态」和「保存偏好」是两个概念：用户可能浏览 A 却总存到 B，记忆必须独立于浏览路径。
- 偏好类数据按项目分桶，避免切项目后指向上个项目不存在的文件夹。

## 关联

- 需求/方案/测试：`1_requirements_matrix/2026-11-01-11-40-asset-save-defaults.md`、`2_requirements_solutions/2026-11-01-11-40-asset-save-defaults.md`、`3_test_results/2026-11-01-11-40-asset-save-defaults.md`。
- 前置：`5_memory/2026-10-31-22-00-asset-library-manual-open.md`（素材库面板手动开关）。
