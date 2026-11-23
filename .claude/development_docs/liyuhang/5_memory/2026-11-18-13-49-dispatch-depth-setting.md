# START 记忆：任务链上限开放为开发者设置

- 时间：2026-11-18 13:49
- 关联：`1_requirements_matrix/2026-11-18-13-41-dispatch-depth-setting.md`、`2_requirements_solutions/2026-11-18-13-44-dispatch-depth-setting.md`、`3_test_results/2026-11-18-13-49-dispatch-depth-setting.md`

## Situation
任务链深度写死 8（服务端 `MAX_DISPATCH_DEPTH`、画布 `MAX_DEPTH`），用户需要按项目调整，且不能为改数字重新构建；同时存在路由层第三处硬编码 8，调高会被 400 拦下。

## Task
在设置页开发者选项提供「任务链上限」（1–32，默认 8），服务端工具、路由硬边界、画布 dispatcher 三处统一口径；保存后新派发生效。

## Action
1. 新增 `agent/runtime/dispatchLimits.ts`（默认 8、范围 1–32、normalize）并通过 server `package.json` 导出给 web 复用；`agent/dispatchDepthSchema.ts` 作为路由硬边界（max 32）。
2. `getAgentPreferences` 增加 `dispatchMaxDepth`；runtime 构造派发上下文时注入；`sendToAgent` 用 `context.maxDepth` 判断并把生效上限随 `agentDispatch` 事件下发。
3. 路由 `dispatchDepth` 改用共享 schema；画布 dispatcher 优先用事件 `maxDepth`，其次本地设置，最后默认 8，统一 normalize。
4. 设置存储 `developerSettings.dispatchMaxDepth`；开发者页新增「派发」段（输入 + 独立保存），保存走同一 normalize，0/空值分别落到 1/8。
5. 测试：dispatchLimits 4 例、schema 2 例、sendToAgent 5 例、dispatcher 18 例；服务端全量 158 pass，typecheck 与构建通过。

## Result
- 默认行为不变（9 跳仍拒绝）；调高到 32 不再被路由拒绝；服务端与画布以同一事件快照判断，避免中途改设置导致静默丢弃。
- 已同批部署桌面入口（17,856,780 B，备份后缀 `20261118-134812`）与 `views/mainview`，未重启，由用户退出重开。
- 已知：设置不做多端实时推送，其他客户端刷新后生效；保存接口未额外清洗原始 JSON。

## 追加（14:30）

- 新增「不限制任务链深度」开关（`developer.dispatchUnlimited`），运行期以 `UNLIMITED_DISPATCH_MAX_DEPTH = 1000` 兜底；设置归一化仍 1–32，`resolveDispatchLimit` 负责运行期 1–1000。
- 路由硬边界放宽到 1000；sendToAgent/dispatcher 统一用 `resolveDispatchLimit`，避免 1000 被压回 32。
- 修复开发者页 `el-alert` 被 flex 压扁：`.developer > * { flex-shrink: 0 }`。
- 服务端 161 例、dispatcher 19 例通过；入口与视图已同批同步（备份 `20261118-143005`），未重启。
