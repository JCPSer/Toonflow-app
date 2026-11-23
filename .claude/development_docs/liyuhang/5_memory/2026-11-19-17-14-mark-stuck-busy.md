# 记忆：标记后节点运行态卡死修复（STAR）

- 时间：2026-11-19 17:14

## Situation

图片/图片生成节点使用「标记」保存后，节点一直显示运行/生成中，Agent 侧持续等待。

## Task

保证标记保存流程任何等待点都不会把节点运行态挂死；顺带覆盖同类的重绘保存。

## Action

- `nodeScaffold/src/nodeViewport.ts`：`revealNodeInViewport` 对 `flow.setCenter` 增加 `duration + 600ms` 的 `Promise.race` 兜底。Vue Flow 的视口动画由 d3 transition 驱动，动画被打断时只在 `interrupt` 而非 `end` 回调，原 Promise 永不 resolve。
- `imageEditor.vue`：`saveMark` 与 `createInpaint` 的 finally 先复位 `operation`/`busy`，再执行失败清理；清理请求挂起不再让节点保持忙碌。
- `nodeScaffold/package.json` 新增 `./nodeViewport` 导出，便于单测。
- 新增 `apps/web/src/lib/nodeViewport.test.ts` 3 例（永不返回兜底、正常返回、视口内不触发）。

## Result

- web 145 测试通过；节点 UMD 与 web 视图已重建同步（备份 20261119-171325）。
- 需重启应用验证：标记保存后节点立即回到空闲；若仍复现，需要该会话文件与节点 ID 继续查生成侧。

## 教训

UI 动画/聚焦类 await 必须加超时或 fire-and-forget，不能作为业务 busy 的最后一个等待点；finally 中先复位状态再做清理。
