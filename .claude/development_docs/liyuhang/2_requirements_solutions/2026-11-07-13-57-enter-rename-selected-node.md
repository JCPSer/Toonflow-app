# 需求方案：画布单选节点按 Enter 重命名

- 时间：2026-11-07 13:57
- 对应需求：`../1_requirements_matrix/2026-11-07-13-57-enter-rename-selected-node.md`
- 状态：已实施（待人工验收）

## 1. 背景与约束

标题编辑逻辑在节点包内部：`nodeSkeleton.vue` 的 `editLabel()` 负责把标题切到输入框；分组节点 `groupNode.vue` 在宿主侧，也有同样的 `editLabel()`。画布宿主与节点包是两个独立 UMD 构建，宿主不能直接 import 节点内部函数，已有先例是 `nodeBusy` / `nodeRun` 的 `Symbol.for` 全局注册表。

Enter 当前绑定给「清除未读提醒」，但只在空选、焦点在画布空白处时消费；有选区时不会拦截，因此「有选区 Enter 改名」在上下文上与它互斥。

## 2. 方案

### 2.1 新增重命名入口注册表

`packages/nodeScaffold/src/nodeRename.ts`（新）

- `Symbol.for("toonflow.nodeRename")` → `Map<nodeId, () => void>`。
- `registerNodeRename(nodeId, rename)` 返回只注销自己的清理函数。
- `getNodeRename` / `hasNodeRename` 供宿主查询。
- `package.json` 增加 `./nodeRename` 导出，`runtime.ts` 一并导出。

### 2.2 节点注册

- `nodeSkeleton.vue`：`watch(() => props.readOnly)` 维护注册；只读预览不注册，避免用预览实例覆盖画布实例的入口；`onScopeDispose` 清理。回调调用 `editLabel()`（内部已有禁用/只读守卫）。
- `groupNode.vue`：非只读时注册同样的入口，卸载时注销。

### 2.3 宿主派发

`apps/web/src/pages/workspace/panels/canvas/index.vue` 的 `updateCanvasKeys`：

```text
按键不是 keyup、未被处理、非输入法组合
  ├─ 裸 Enter（无 Ctrl/Alt/Shift/Meta）且恰好选中 1 个节点、节点未禁用、注册表有入口
  │    → action = renameNode
  └─ 否则沿用现有快捷键匹配（空选 Enter 仍匹配 clearAlerts）
复用现有守卫：
  editing（输入框/按钮/可编辑区域）→ 不触发
  inCanvas（弹窗/Agent 面板外）→ 不触发
  Agent 面板语境只放行复制/粘贴/删除 → 不触发
派发：preventDefault；repeat 忽略；调用注册表入口。
```

- 不新增 `canvasShortcuts` 字段，不参与设置页录制与冲突检测。
- 标题 span 自带 Enter 处理（Tab 聚焦场景）保持不动；宿主捕获阶段先触发一次 `editLabel()` 也无副作用。

### 2.4 撤销

画布已有 `watch(() => [node.data.label, node.data.disabled]) → canvasHistory.record()`；改名写入 `data.label` 后自动进入历史，无需新增接口。

## 3. 交付物

- 修改：`nodeSkeleton.vue`、`groupNode.vue`、`canvas/index.vue`、`nodeScaffold/package.json`、`runtime.ts`。
- 新增：`nodeRename.ts`、`nodeRename.test.ts`。
- 重建全部仓库节点 UMD（`bun run build:nodes`），同步到 `/Applications/toonflow-data/nodes/` 与仓库 `data/nodes/`（旧包备份）。
- 重建 web 并同步 `views/mainview/`。
- 需要重启应用生效。

## 4. 边界与异常

1. 多选：不响应；Enter 保持无操作（原来的清除提醒也只在空选生效）。
2. 禁用节点：不进入改名（标题提示也写明双击不可编辑）。
3. 只读预览：不注册，不响应。
4. 正在运行/生成中的节点：允许改名，不影响任务。
5. 应用数据目录里的手工节点包：未重建则不注册，Enter 无操作，不报错。
6. 输入法组合中按 Enter：不触发，交给输入法上屏。

## 5. 测试计划

- 单测：注册表注册/查询/注销/只清自己。
- 类型检查：apps/web、nodeScaffold、全部节点包。
- 构建：build:nodes、web build。
- 人工：见测试结果文档。

## 6. 实施与验证（2026-11-07 14:10）

### 6.1 落地

- 新增 `nodeRename.ts` 注册表与 `nodeRename.test.ts`；nodeScaffold 导出 `./nodeRename`。
- `nodeSkeleton.vue` 按 `readOnly` 维护注册；`editLabel` 增加 documentTarget 守卫；标题 tooltip 改为「双击或按 Enter 编辑名称」。
- `groupNode.vue` 同样按 `readOnly` 维护注册，tooltip 同步更新。
- `canvas/index.vue`：裸 Enter + 单选 + 未禁用 + 有注册表入口 → `renameNode`，复用 `editing` / `inCanvas` / Agent 面板守卫；新增 `hasModalOverlay()` 门控，弹窗打开时不触发。

### 6.2 评审发现与处理

| 级别 | 问题 | 处理 |
| --- | --- | --- |
| P2 | 提示词「展开编辑」弹窗打开、焦点在弹窗容器时，Enter 会在弹窗背后进入标题编辑 | 重命名与下拉一样受 `hasModalOverlay()` 限制 |
| P2 | 评审时节点 UMD 尚未同步，骨架节点不会注册 | 14:10 已同步 11 个仓库节点到应用与 dev 数据目录 |
| P3 | groupNode 注册未随 readOnly 变化 | 改为 watch 维护，与 nodeSkeleton 一致 |

### 6.3 验证

- apps/web 86 单测通过；apps/web typecheck 仅剩既有 `@/agentRuntime` 报错；nodeScaffold typecheck 通过。
- 11 个节点 UMD 构建成功且均包含 `toonflow.nodeRename`；web 构建成功。
- 已同步 `/Applications/toonflow-data/nodes/`、仓库 `data/nodes/`、应用 `views/mainview/`；**未重启应用**。
- 手工安装的 5 个节点包未重建，不覆盖。

## 7. 评审意见

（待用户填写）

- 是否通过：
- 其他要求：
