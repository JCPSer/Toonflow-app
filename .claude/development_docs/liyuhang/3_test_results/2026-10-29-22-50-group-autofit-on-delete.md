# 测试结果：分组内节点删除后自动贴合

- 时间：2026-10-29 22:50
- 对应方案：`4_bugs_fix/bug_solution-2026-10-29-22-10-group-autofit-on-delete.md`

## 1. 纯函数回归（`apps/web/scripts/check-group-refit.ts`，bun 直接跑）

命令：`cd apps/web && bun scripts/check-group-refit.ts`

| # | 用例 | 结果 |
| --- | --- | --- |
| 1 | 3 子节点删 1：组宽按剩余内容 + 32/48 重算，剩余节点绝对坐标不变 | PASS |
| 2 | 删空：160×96，位置不变 | PASS |
| 3 | 嵌套组：内层删空后外层同步收缩 | PASS |
| 4 | 整组连同子节点删除：外层组重新贴合 | PASS |
| 5 | 只增不减：`refitGroupsAfterRemoval` 返回 0，组尺寸不变 | PASS |
| 6 | 重复贴合幂等：第二次无任何 position/style/dimensions diff | PASS |
| 7 | 按 id 取当前对象：基线里的旧组对象不被误改 | PASS |
| 8 | 未测量子节点不误缩组 | PASS |

结果：8/8 通过。

## 2. 类型与构建

- `bun run --filter '@toonflow/web' typecheck`：仅剩既有 `@/agentRuntime` 别名错误（`apps/server/.../singleAgent/types.ts:2`），本次改动新增错误 0。
- `bun run --filter '@toonflow/web' build`：通过（3.5s）。
- `scripts/deploy-local.sh`：安装到 `/Applications/toonflow-exec.app` 的 views。

## 3. 应用内实测（Chrome 客户端连 127.0.0.1:56743，使用临时画布夹具，测后已清理）

夹具：项目 `/Users/liyuhang/Downloads/tmp/hello` 下临时「回归-分组删除.json」——1024×512 分组 + 2 个 imageNode。测完删除夹具并还原 `.toonflow/ui.json`。

| 用例 | 期望 | 实测 |
| --- | --- | --- |
| 打开画布（组尺寸故意大于内容） | 不被重排 | 1024×512 原样保留 |
| 选中组内 1 个节点按 Backspace 删除 | 组收紧 | 1024×512 → 644×417，节点 3→2 |
| 继续删到空 | 160×96 | 160×96，位置不变 |
| 撤销一次 | 节点与组尺寸一起还原，只回退一步 | 恢复到 644×417 + 节点 |
| 解组内层组（外层少了一个直接子节点） | 外层贴合 | 960×480 → 892×264（同一监听路径） |

## 4. 观察到的环境问题（与本次改动无关）

- 用临时 textNode 夹具触发删除时，`useNodeEvent(nodeId).emit("delete")` 在第一段 save 回调处一直不返回，节点删不掉、无报错。换 imageNode 夹具删除正常。临时加日志确认卡点是 `emit`（`nodeMenu.deleteSelection` 的既有链路），不是本次监听；该夹具节点是复制出来的、三个节点共用同一个 `textPath`，属于夹具缺陷。真实画布中的 textNode 删除未受影响（用户此前一直在用）。
- 排查期间的临时 `console.log` 已全部移除并重新构建部署。

## 5. 待用户手测

- 在真实画布上删组内节点（右键 / Delete / 节点卡片删除按钮 / MCP），确认收紧与撤销。
- 把最后一个子节点拖出分组，确认空组缩到 160×96。
- 组套组场景删内层节点，确认外层跟随。
