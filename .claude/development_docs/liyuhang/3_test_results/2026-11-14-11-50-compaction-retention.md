# 测试结果：放宽压缩后的上下文保留量

- 时间：2026-11-14 11:50
- 对应方案：`2026-11-14-11-50-compaction-retention.md`

## 1. 单元测试

`apps/server/src/agent/runtime/preferences.test.ts`（新增 6 例）：

| 用例 | 断言 | 结果 |
| --- | --- | --- |
| 200k 窗口，80%，无大输出 | reserve 40000，keep 50000 | 通过 |
| 1M 窗口，80% | keep 60000（命中上限） | 通过 |
| 64k / 20k 窗口 | keep 16000 / 5000（窗口 1/4） | 通过 |
| 7 档窗口 × 3 档 maxOutput | keep + reserve < window | 通过 |
| 16384 窗口 | enabled=false，keep 4096 | 通过 |
| 预留量 | 覆盖最大输出且不超过窗口一半 | 通过 |

```text
bun test src/agent/runtime/preferences.test.ts
6 pass / 0 fail / 30 expect()
```

## 2. 全量回归

```text
bun test（apps/server）
113 pass / 0 fail / 312 expect() / 11 files
```

## 3. 类型检查

```text
bun run typecheck（apps/server）
tsc 通过，无输出
```

## 4. 行为核对

- 自动压缩：`createAgentSettings()` 读 `autoCompactStrategy()`，触发阈值不变，压完保留量变大。
- 手动压缩：`compactAgentSession()` 以 `model.contextWindow + model.maxTokens` 构造 settings，同一策略生效。
- microcompact：未改动，仍为最近 3 轮、窗口 50% 触发。
- 设置页文案：未出现具体保留量，无需同步。

## 5. 待人工验证

压缩后使用真实会话观察上下文占用是否落在「窗口 1/4（上限 6 万）+ 摘要」附近，以及是否出现压完立刻再压。

## 6. 评审后补充

- preferences.test.ts 增至 7 例：新增 16,385 边界、压缩百分比 50/60/80/95 组合、默认 80% 下摘要预算约束。
- 结果：7 pass / 0 fail / 397 expect；服务端全量 114 pass / 0 fail；tsc 通过。
- 已知行为变化：手动压缩对总 token 小于保留量的会话返回「当前对话没有可压缩的内容」（旧值 2 万时可压，新值下整段保留）。符合「低于保留量无需压缩」的预期。
- 低百分比（约 ≤55%）叠加 context overflow 触发时，摘要上限（0.8×reserve）可能吃掉余量导致再压一次；默认 80% 下不会发生，暂不收紧（收紧会减少保留量）。
