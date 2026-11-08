# 测试结果：Agent 对话面板向上滚动内容跳动

- 时间：2026-11-02 10:40
- 对应方案：`4_bugs_fix/bug_solution-2026-11-02-10-30-agent-message-up-scroll-jump.md`
- 结论：类型检查、构建部署与静态核对通过；**未重启应用**，需用户重启后人工验收

## 1. 单元测试

本次改动是给虚拟器实例赋一个补偿回调，没有可独立单测的纯逻辑；回归跑既有画布用例：

```
bun test apps/web/src/pages/workspace/panels/canvas/axisLock.test.ts apps/web/src/lib/canvasShortcuts.test.ts
→ 24 pass / 0 fail / 46 expect() calls
```

## 2. 类型检查

| 包 | 命令 | 结果 |
| --- | --- | --- |
| `apps/web` | `bun run --filter '@toonflow/web' typecheck` | 仅既有报错 `apps/server/src/modules/agentAccess/singleAgent/types.ts(2,33) TS2307 Cannot find module '@/agentRuntime'`（`getScrollOffset` 为私有，已改用公开的 `scrollOffset` + `scrollAdjustments`） |

## 3. 构建与部署核对

| 产物 | md5（构建 = 安装目录） | 说明 |
| --- | --- | --- |
| `index.html` | `c47ecbbd1fcdcfaf11a68e9f150c47a8` | 引用 `assets/workspace-C542gZNR.js` |
| `assets/workspace-D7_LatSK.js` | `a3a46cc3015829b0c46081dd7bfab530` | 含 `shouldAdjustScrollPositionOnItemSizeChange` 赋值（评审整改后的最终版） |
| `assets/workspace-C542gZNR.js` | `e0f51d47ed1b5733ea0cae7f936c7a78` | 路由入口 |

部署方式：`rsync -a build/web/ <安装目录>/`（不带 `--delete`）。**未重启应用。**

## 4. 静态链路核对

| 断言 | 证据 |
| --- | --- |
| 回调确实被库读取 | virtual-core 3.17.11 `resizeItem` 读取 `this.shouldAdjustScrollPositionOnItemSizeChange`（实例属性），不用 options 字段 |
| setOptions 不会清掉 | 适配器只在 option 变化时调用 `setOptions`，只替换 `this.options` |
| 只去掉方向限制 | 谓词保留库默认的「整行在视口上方」（`item.start + size <= offset`），仅删除 `scrollDirection !== "backward"` |
| 流式长回复不被拽动 | 跨视口上沿的行不满足「整行在上方」，不补偿（对应库注释 #1218） |
| 首测与库默认一致 | `itemSizeCache.has(key)` 为假时按「顶边在视口上方」补偿；回调执行时新尺寸尚未写入缓存 |
| 私有 API 规避 | 类型层面 `getScrollOffset` 私有，改用 `scrollOffset ?? 0` + `scrollAdjustments`（本列表未设 `initialOffset` / `enabled`） |

## 5. 代码审查

子 Agent 复审（2026-11-02 10:55）：**修改后通过**。

| 级别 | 意见 | 处理 |
| --- | --- | --- |
| P1 | 初版谓词用「顶边在视口上方」无条件补偿，长回复跨上沿流式增长时会把视口一路推走 | 已修：保留「整行在视口上方」，只删方向限制，重新构建部署 |
| P2 | `scrollOffset ?? 0` 与 `getScrollOffset()` 的等价性依赖 `initialOffset=0`、`enabled=true` | 已写入代码注释 |
| P2 | 与 `restoreExpandAnchor` 手工补偿存在竞争、jump 收敛期间库也会额外写 scrollTop | 未改代码，列入人工验收项（展开聚合行、轮次目录跳转） |
| P2 | 贴底 48px 内靠 `wasAtEnd` 分支，不双重补偿；超出后走新谓词 | 已确认逻辑，列入验收 |
| P2 | 注释措辞（「只要变高了」「官方旧行为开关」）不准 | 已改 |

## 6. 已知限制

- 该回调按上游维护者说明属于「实例属性」而非 options，未来大版本若改为 options 字段需要同步调整。
- 若实测仍抖动，备选方案是升级 `@tanstack/vue-virtual` 到 3.13.51（core 3.19.x），但会牵动锁文件与提及菜单等其它虚拟列表。

## 7. 未覆盖项（需重启后人工确认）

1. 向上翻历史：滚动过程中不再一段一段错位，滚动条位置自然。
2. 向下翻、贴底跟随新消息：与现在一致。
3. 展开/收起工具聚合行、轮次目录跳转：位置行为不变（重点看「向上滚一段后再展开」）。
4. 实时回复流式增长时：视口不被拽动；长回复滚到中途继续流式输出，视口也不被推走。
5. 距底一两百像素时图片加载：位置不应卡住不动。
