# 方案：素材库「上一级」卡片接受拖拽

日期：2026-10-26 15:45（16:45 按评审修订）
对应需求：`1_requirements_matrix/2026-10-26-15-20-asset-library-parent-drop.md`

## 一、方案概述

不给「上一级」卡片复制一套拖拽逻辑，而是把「目录落点」的处理抽成共用函数，普通目录卡片与「上一级」卡片都调用它，落点路径分别是 `entry.path` 与 `parentPath`。

## 二、详细设计

### 2.1 共用落点处理（`AssetGridView.vue`）

从现有 `onCardDragOver / onCardDragLeave / onCardDrop` 抽出：

```
handleDirectoryDragOver(event, targetPath, key):
  if hasInternalDrag(event) and not canDropIntoTarget(targetPath):
      clearHighlight(); return
  if not (hasInternalDrag or hasFileDrag): return
  event.preventDefault(); event.stopPropagation()      // 仅在确认可处理时阻止冒泡
  dropActivePath = key
  dropEffect = hasInternalDrag ? "move" : "copy"

handleDirectoryDragLeave(event, key):
  if dropActivePath !== key: return
  若 relatedTarget 仍在 target 内: return              // 与现有 onCardDragLeave 一致，避免图标/文字间移动时闪
  clearHighlight()

handleDirectoryDrop(event, targetPath):
  clearHighlight()
  if hasInternalDrag:
      event.preventDefault(); event.stopPropagation()
      payload = readInternalDrag(event); clearAssetDrag()
      异库 -> 仅 return（不发请求、不提示）            // dragover 不放行异库，drop 实际不会派发
      可落 -> emit("move", payload, targetPath)
      return
  if hasFileDrag:
      event.preventDefault(); event.stopPropagation()
      emit("upload-drop", files, targetPath)
```

关键点：**不使用 `.stop` 修饰符**。Vue 的 `.stop` 在 handler 执行前就阻止冒泡，会让「Finder 文件拖到 .. 时交给空白区上传」失效。改为在 handler 内部判定后再 `stopPropagation()`。

`canDropIntoTarget(targetPath)` 读 `activeAssetDrag`（dragover 阶段拿不到 dataTransfer 内容），drop 阶段用 `readInternalDrag` 的 payload 再判一次。

### 2.2 「上一级」卡片（`AssetGridView.vue:44-59`）

```
<article v-if="currentPath"
  class="assetCard upCard"
  :class="{ dropTarget: dropActivePath === UP_DROP_KEY }"
  @dragenter="handleDirectoryDragOver($event, parentPath, UP_DROP_KEY)"
  @dragover="handleDirectoryDragOver($event, parentPath, UP_DROP_KEY)"
  @dragleave="handleDirectoryDragLeave($event, UP_DROP_KEY)"
  @drop="handleDirectoryDrop($event, parentPath)">
```

- `UP_DROP_KEY` 是模块常量 `"__up__"`，只用于高亮比对；真实记录路径只存在于 `parentPath`，注释写明它不参与路径校验。
- 卡片不加 `draggable`。
- `.upCard.dropTarget` 把 `opacity` 从 0.75 提到 1，与普通卡片高亮观感一致。

### 2.3 边界

| 场景 | 行为 | 依据 |
| --- | --- | --- |
| 库根（`currentPath === ""`） | 不渲染卡片 | 现有 `v-if` |
| 搜索模式，源条目来自子目录 | 若 `parentAssetPath(source) === parentPath` 则 `canDropInto` 返回 false，不高亮、不发请求 | `canDropInto` |
| 目录拖到自身父目录 | 同上，`canDropInto` 拒绝 | `canDropInto` |
| 跨库 | dragover 不放行 → 无高亮、无 drop | 与普通卡片现状一致（现有 `emit("error")` 分支实际不可达，不在本次修改） |
| Finder 文件拖到卡片 | handler 内 `hasInternalDrag` 为假且 `hasFileDrag` 为真时按「上传到 parentPath」处理 | 与用户确认的「只做库内移动」不同，故改为**不拦截**：文件拖拽直接 return 且不 `stopPropagation`，冒泡回空白区按当前目录上传 |

> 评审后定为：文件拖拽完全放行冒泡，保持现有「上传到当前目录」语义，不新增跨目录上传。

## 三、影响面

仅 `AssetGridView.vue`：新增共用函数、upCard 监听、一个常量与一条高亮样式。`index.vue` 的 `@move` 接线不变。

## 四、验证要点

1. 文件 / 目录拖到「上一级」：高亮出现，松手后实际移动到父目录，列表与树刷新。
2. 搜索模式下拖与当前目录同级的条目：不高亮、无 `/api/assets/move` 请求。
3. Finder 文件拖到「上一级」：仍上传到当前目录（行为不变）。
4. 同一次 drop 只发一次 `/api/assets/move`（抓包）。
5. 从卡片图标拖到文字再松手，高亮不闪断。

## 五、评审意见

用户评审通过（2026-10-26）。按子 agent 意见修订：共用落点函数、handler 内 stopPropagation、跨库静默、文件拖拽放行。

> 已采纳：去掉 `.stop` 修饰符改为 handler 内 stopPropagation；跨库改为静默禁止；补 relatedTarget 判断；抽共用函数；搜索模式与库根边界写明。
