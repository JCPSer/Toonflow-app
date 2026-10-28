# 测试结果：节点运行时长显示

日期：2026-10-28 16:52

## 一、静态检查

| 项目 | 结果 |
| --- | --- |
| `@toonflow/nodes-scaffold` typecheck | 0 |
| 9 个节点包 typecheck（`./packages/nodes/*`） | 全部 0 |
| 9 个节点包 production build | 全部成功 |

## 二、计时状态机（真实 Vue 运行时验证）

用 `effectScope` + 真实 `watch`/`computed` 复刻骨架层逻辑跑时序，避免只靠肉眼读代码：

| 步骤 | 期望 | 结果 |
| --- | --- | --- |
| 初始 `busy=false`（immediate 首次调用） | 角标不显示，不能出现「耗时 0s」 | PASS：`""`，`done=false` |
| `busy=true` 瞬间 | `00:00` | PASS |
| 运行 1.1s | `00:01` | PASS |
| 运行 2.1s | `00:02` | PASS |
| `busy=false` | 定格「耗时 2s」 | PASS：`"耗时 2s"`，`done=true` |
| 再 `busy=true` | 清零重开，不残留上次结果 | PASS：`"00:00"`，`done=false` |
| 第二次 `busy=false` | 再定格 | PASS：`"耗时 0s"` |
| `scope.stop()` 后再等 1.2s | 数字不再变化（定时器已清） | PASS：与上一行一致 |

## 三、格式化边界

| 毫秒 | 运行中 | 结束后 |
| --- | --- | --- |
| 0 / 999 | `00:00` | `耗时 0s` |
| 1 000 | `00:01` | `耗时 1s` |
| 59 999 | `00:59` | `耗时 59s` |
| 60 000 | `01:00` | `耗时 1m00s` |
| 192 000 | `03:12` | `耗时 3m12s` |
| 3 599 999 | `59:59` | `耗时 59m59s` |
| 3 600 000 | `1:00:00` | `耗时 1h00m` |
| 3 930 000 | `1:05:30` | `耗时 1h05m` |
| 7 323 000 | `2:02:03` | `耗时 2h02m` |

## 四、产物核对

9 个 `build/nodes/*.umd.js` 均包含 `durationBadge` 样式（每个打包 2 处：模板 class 与 CSS），说明骨架层改动被正确内联进每个节点包。

## 五、部署

`deploy-local.sh` 报告 9 个节点包全部 `updated`，已同步到 `/Applications/toonflow-data/nodes`，重启应用生效。

## 六、未覆盖 / 待手测

- 真实界面里 textNode / 图片生成 / 帧分析的滚秒与结束定格（本地推理环境无法自动触发一次完整生成）。
- 220px 窄节点下角标与卡片内容、右侧 handle 的视觉重叠需目测。
- 多选框选节点拖动时角标是否跟随（按设计保留显示，不随 `slotsHiddenByInteraction` 隐藏）。
- 切画布再切回后计时是否连续（代码上画布实例常驻，`backgroundCanvas` 只改 opacity/visibility）。