# 需求方案：保存到素材库记住上次设置

- 时间：2026-11-01 11:40
- 分支：`feat/exec-node`
- 对应需求：`1_requirements_matrix/2026-11-01-11-40-asset-save-defaults.md`

## 1. 方案概述

在 `useAssetLibraryStore` 里新增按项目目录分桶的 `saveDefaults`（与浏览状态 `stateByDirectory` 分开），保存成功后写入，弹窗打开时回填。弹窗不再用 `watch(targetLibrary)` 自动重置保存位置，改为只在用户切换单选时重置。

## 2. 详细设计

### 2.1 数据

```
AssetSaveDefaults = { library: "project" | "global", path: string }
saveDefaults: Record<directoryKey, AssetSaveDefaults>
```

- `directoryKey` 沿用现有归一化（去尾斜杠、统一分隔符）；无项目时为空串桶。
- persist pick 增加 `saveDefaults`，与素材库浏览状态一起持久化。

### 2.2 打开弹窗

```
restoreSaveDefaults(fallbackPath):
    defaults = store.getSaveDefaults(props.directory)
    fallbackLibrary = (props.library == project && 无目录) ? global : props.library
    library = defaults?.library ?? fallbackLibrary
    targetLibrary = (library == project && 无目录) ? fallbackLibrary : library
    destination = defaults?.path ?? fallbackPath
```

- 节点保存传 `currentPath` 作为兜底；附件收藏传 `""`（根目录），与原来一致。

### 2.3 切换目标库

- 原来的 `watch(targetLibrary)` 改成 `@change` 事件处理：
  - 切回当前素材库 → 保存位置回到当前浏览目录；
  - 切到另一个库 → 保存位置回到根目录。
- 原因：程序化回填 targetLibrary 也会触发 watch，把刚回填的 destination 覆盖掉。

### 2.4 保存成功

```
成功后:
    store.setSaveDefaults({ library: targetLibrary, path: destination }, props.directory)
    visible = false
    emit saved
```

- 两条分支（工作区导入 `importAsset` / Blob 上传 `uploadAsset`）都在成功返回后写入。
- 失败不写，保留上一次成功记忆。

## 3. 边界

- 目录被删：上传接口会自动 `mkdir` 父目录，不阻断保存；用户也可在树里重新选。
- 无项目目录：强制回落到全局库，本项目单选保持禁用。
- 旧持久化缓存没有 `saveDefaults` 键：缺省为空对象，回落到当前库/目录。
- 同名文件自动改名不写进记忆，避免把「(2)」后缀带进下一次名称。

## 4. 影响文件

- `apps/web/src/stores/assetLibrary.ts`
- `apps/web/src/pages/workspace/panels/assetLibrary/components/SaveToLibraryDialog.vue`

## 5. 评审意见

| 评审人 | 结论 | 意见 |
| --- | --- | --- |
| 用户（选择题确认） | 通过 | 目标库+保存位置、按项目、全入口。 |
| 子 Agent 审查 | 通过 | 方案成立；审查补充批量入口读取记忆、失效目录预检与快照写入，均已落地。 |
