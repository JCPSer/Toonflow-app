# 变更记录：节点提醒 / 分组框选语义 / 批量入素材库

时间：2026-10-29
需求：`1_requirements_matrix/2026-10-29-15-07-canvas-notify-group-select-batch-assets.md`
方案：`2_requirements_solutions/2026-10-29-15-13-canvas-notify-group-select-batch-assets.md`
测试：`3_test_results/2026-10-29-16-32-canvas-notify-group-batch-assets.md`

## Situation

画布跑长任务时人在别处，完成或失败都没有任何提示；Agent 停下来等回答同样容易错过。分组把整块矩形当自己的地盘，组内空白无法起手框选、擦到一点就整组选中，用户想把组内节点框选出来只能先解组。框选出的一批图片/视频也只能一张张手动存进素材库。

## Task

1. 跑超过 30 秒的节点结束时给听觉反馈（成功/失败不同音，1 秒内合并，可关）。
2. 应用不在前台时，完成/失败/Agent 提问发系统通知；回应用后能定位到具体节点。
3. 分组只在「全部后代节点都在框内」时被框选；组内空白回归画布语义；分组自身交互收敛到标题栏。
4. 框选一批图片/视频节点批量复制进当前项目素材库。

## Action

### 提醒链路

- `packages/nodeScaffold/src/nodeBusy.ts`：全局 busy 表由 `Map<string, number>` 改为记录 `{ startedAt, outcome }`，计数归零时向 `window` 派发 `toonflow:node-task`；新增 `markNodeOutcome` 只打标记不派发。用 window 事件而不是回调，是因为节点包是独立 UMD，宿主拿不到它们的模块实例（与既有 `Symbol.for` 共享表同因）。
- `packages/nodeShared/src/useNodeGeneration.ts`：`run()` 增加 `report`，在 `status = "failed"` **之前**上报结果。审查发现的时序问题：`status` 变化触发的 busy 下降沿比外层 catch 里的 `showNodeError` 更早，晚报的结果会被当成成功。
- 图片/视频/音频生成节点补 nodeId 上报；Agent 面板把 `turnEnd(failed|cancelled)` 转成 `markNodeOutcome`。
- 宿主：`lib/chime.ts`（WebAudio 双音，无音频文件）、`lib/desktopNotify.ts`（host message）、`lib/taskAlerts.ts`（30s 阈值 + 1s 合并 + 音/通知/写 store）、`stores/taskAlerts.ts`（未读队列）、`components/taskAlertBanner.vue`（画布顶部横幅）。
- 桌面：`apps/desktop/src/index.ts` 的 host message 增加 `desktop-notify`，校验并截断 title/body 后调 `Utils.showNotification`。Electrobun 通知没有点击回调，所以「点通知定位」改为「回应用后点横幅定位」。

### 分组

- `patches/vueFlowCore.patch`：在 `onPointerMove` 里 `selectedNodeIds` 赋值之后、边集合清空之前插入过滤——分组只有全部后代（递归）都完整落在框内才保留，空组直接剔除；框矩形算法与 `getNodesInside` 完全一致（x/y 不再二次除 zoom），容差 0.5px，未测量/隐藏的后代按不满足处理。
- `groupNode.vue`：`.groupNode` 与包装层 `pointer-events:none`（`index.vue` 用 `:deep` + `!important` 压掉 Vue Flow 的内联样式），标题栏与缩放手柄 `auto`；标题栏改整条全宽 26px、背景透明（用户要求"全宽但不改视觉"）；手柄显形从 hover 改为选中态。
- 删除 `edgeIdUnderGroup / groupBodyOf / probeGroupEdgeClick / forwardGroupContextMenu`：穿透后它们永远拿不到目标，是死代码；组内右键本来就走画布菜单，连线现在能直接点中。

### 批量入库

- `saveSelectionToAssets.ts`：选中集合先展开分组取叶子，取每个节点当前展示的 IMAGE/VIDEO 输出，用 `importAsset` 让服务端复制（不把视频读进浏览器），命名「节点名 + 序号 + 扩展名」并清洗非法字符，重名以服务端自动 `(2)` 为准并统计，单项失败不中断整批，并发 2。
- `selectionToolbar.vue`：解组后加「加入素材库」，仅当展开后全部是图片/视频节点时可点。
- 服务端 `importFileIntoLibrary`：删掉 `protectWorkspaceRoot(target.root, directory.path)`——不传 `targetDir` 时目标目录就是库根，这句必然命中「不能修改工作区根目录」，导致任何导入到库根（含既有的「保存到素材库」根目录保存）都 400。

## Result

- 分组：四类框选场景与标题栏点击/拖动、组内空白点击/拖拽全部实测通过；缩放手柄选中才显形（可见性变化已记录）。
- 提醒：35s 完成事件出横幅、12s 与取消事件被忽略、失败事件红色样式与 `1m1s` 文案、点条目选中并平移、铃铛三态循环，均实测通过。
- 批量入库：按钮可用条件与置灰逻辑实测通过；端到端导入因服务端 bug 未通过，修复后用模块直连验证（根目录导入成功、同名自动 `(2)`），HTTP 链路待重启应用后复验。
- 联调改动过的用户画布已从备份还原并核对节点数与坐标。
