# 测试结果：目录选择器置前 + EBUSY 导致无法保存

- 记录时间：2026-10-29 10:05
- 关联：`4_bugs_fix/bug_analysis-2026-10-29-09-50-dialog-and-ebusy-save.md`、`bug_solution-2026-10-29-09-50-dialog-and-ebusy-save.md`

## 一、本轮改动

| 位置 | 改动 |
| --- | --- |
| `apps/desktop/src/index.ts` | JXA 脚本增加 `setActivationPolicy(Accessory)` + `activateIgnoringOtherApps(true)` + `panel.level/makeKeyAndOrderFront`；`selectDirectory()` 的 darwin 分支 `finally` 里 `mainWindow.show()/activate()` |
| `apps/server/src/routes/workspaces/files/mkdir.ts` | 目录已存在时直接返回，不进入 `lockWorkspaceFiles` |
| `packages/nodes/textNode/src/index.vue` | 新增 `isBusyError` / `retryWhenBusy`，"建目录 + 首次写入"作为可重试单元（最多 3 次，200/400ms 退避） |
| `apps/web/src/pages/workspace/panels/canvas/index.vue` | 节点 `save` 由 `Promise.all` 改为 `saveNodeStates()`（`allSettled` + 去重告警），画布 JSON 不再被单个坏节点阻塞；`node-drag-threshold` 4 → 8（用户复测要求） |

## 二、静态验证

| 项 | 结果 |
| --- | --- |
| `apps/web typecheck` | 仅既有 `server/.../singleAgent/types.ts(2,33)`，无新增 |
| `deploy-local.sh --build` | 成功；`textNode.umd.js` 已更新并同步到 `/Applications/toonflow-data/nodes`（提示需重启应用） |

产物核对：

| 改动 | 证据 |
| --- | --- |
| 桌面选择器激活 | `build/desktop/main/index.js` 命中 `activateIgnoringOtherApps` |
| 文本节点重试 | `build/nodes/textNode.umd.js` 命中 `EBUSY` 退避逻辑 |
| 保存容错 | `build/web/assets/workspace-Cb1eC8wB.js` 含 `部分节点未保存：{0}` 告警 |
| 拖动阈值 | 同文件含 `"node-drag-threshold":8` |

## 三、待手测清单

1. 首页点「新建项目」：主窗口之上弹出系统文件夹选择器，可翻目录、可点「新建文件夹」；取消后按钮停止转圈、页面可交互。
2. 选中目录后正常进入项目；再点一次选择器时仍然在最前面。
3. 复制一个含 2 个以上文本节点的分组：不再出现「文件正在使用，请等待操作完成」卡片；复制出的文本节点能正常显示正文。
4. 复制/编组/删除节点后画布自动保存成功，不再出现「无法保存」「文本尚未加载，无法保存」。
5. 若某节点确实保存失败：只弹一次「部分节点未保存：…」，画布结构仍能保存、删除与编组仍可用。
6. 拖动节点：起步需要移动 8px，贴边点击节点不再误触发画布平移。

## 四、未覆盖

- 目录选择器置前依赖 macOS 允许 accessory 进程激活，需在用户机器上实测；若仍被遮挡，可退回 AppleScript `choose folder`。
- 文件锁仍是"抢不到立刻 409"的语义，长操作期间其它写操作仍会 409（不再产生永久 latch）。
- `mkdir` 短接是"先 stat 再 mkdir"，极端并发下仍可能双双判定不存在，靠文本节点重试自愈。
