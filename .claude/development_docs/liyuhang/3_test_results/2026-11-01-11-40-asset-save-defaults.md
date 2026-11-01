# 测试结果：保存到素材库记住上次设置

- 时间：2026-11-01 11:40
- 对应需求/方案：`1_requirements_matrix/2026-11-01-11-40-asset-save-defaults.md`、`2_requirements_solutions/2026-11-01-11-40-asset-save-defaults.md`

## 1. 类型检查

`cd apps/web && bun run typecheck`：通过，仅剩既有报错 `apps/server/src/modules/agentAccess/singleAgent/types.ts(2,33) TS2307 Cannot find module '@/agentRuntime'`。

## 2. 构建与部署

- `bun run --cwd apps/web build` 成功（4.29s）。
- `scripts/deploy-local.sh` 同步到应用。
- 主包 `workspace-DSA9GcGx.js` md5 `ed242e94635b10f6da25be5fcdeedcf0`、样式 `workspace-DomGE5ds.css` md5 `f05ff57b86d87afae3c65b00170100bb`，构建与 Resources 一致。未重启应用。

## 3. 静态核对

- `saveDefaults` 按 `directoryKey` 分桶，persist pick 已加入。
- `open` / `openWorkspaceFile` 都调用 `restoreSaveDefaults`。
- `watch(targetLibrary)` 已移除，改为单选 `@change`，不会覆盖回填值。
- `importAsset` 与 `uploadAsset` 成功后都写入记忆；失败路径不写。
- 无项目目录时强制回落到全局库。
- 画布批量入库（选择工具条）改为读取同一份记忆作为目标库与 `targetDir`，不再写死项目库根目录。
- 回填后异步 `getTree` 探测记忆目录，失效时回落并清除错误提示。
- 保存请求与记忆写入都使用点击时的库/位置快照。

## 4. 代码审查

| 轮次 | 结论 | 意见 |
| --- | --- | --- |
| 子 Agent（code-reviewer） | 通过 | 无 P1 级设计问题，2 条 P1 级遗漏：①画布选择批量入库不走弹窗，原先既不读也不写记忆 → 改为批量入口静默读取同一份记忆；②记住的目录被删除后保存必然 ENOENT、注释描述错误 → 回填后 `getTree` 预检，失效回落并清错。3 条 P2：库回落时路径未一起回落、保存期间读取响应式值而非快照、`getSaveDefaults(undefined)` 桶语义 → 均已整改。 |

## 5. 重启后人工验收清单

1. 项目 A：节点菜单「保存到素材库」选一个非默认文件夹并保存；再次打开同一入口，保存位置已回填。
2. 素材库页收藏 / 对话附件收藏：目标库与保存位置同样回填。
3. 切换项目 B：使用 B 自己的记忆；B 首次保存时回落到当前库与浏览目录。
4. 保存失败（如无权限/重名无法处理）：再次打开仍是上一次成功设置。
5. 删除上次保存的文件夹后再保存：能成功，目录被重建。
6. 重启应用后记忆仍在（pinia persist）。
